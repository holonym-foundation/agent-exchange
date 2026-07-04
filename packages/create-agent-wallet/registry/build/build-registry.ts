import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { ActivitySchema, type Activity } from '../../src/registry/types.js'

export interface BuildOptions {
  root: string
  out: string
  version?: string
}

export async function buildRegistry(opts: BuildOptions): Promise<void> {
  // Resolution order for the activities directory:
  //   1. dist/registry/activities (populated by copy-registry.mjs during build)
  //   2. <root>/activities (legacy layout, used by unit tests)
  //   3. <root>/agents (monorepo layout — aex repo root)
  const distActivities = resolve(opts.root, '../dist/registry/activities')
  const legacyActivities = resolve(opts.root, 'activities')
  const monorepoAgents = resolve(opts.root, 'agents')
  const activitiesDir = existsSync(distActivities)
    ? distActivities
    : existsSync(legacyActivities)
      ? legacyActivities
      : monorepoAgents
  const entries = await readdir(activitiesDir, { withFileTypes: true })
  const activities: Activity[] = []
  const errors: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const jsonPath = resolve(activitiesDir, entry.name, 'activity.json')
    // Skip directories without activity.json (e.g. non-activity agent dirs
    // in the monorepo agents/ directory).
    if (!existsSync(jsonPath)) continue
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(jsonPath, 'utf8'))
    } catch (err) {
      errors.push(`${entry.name}: failed to read activity.json — ${(err as Error).message}`)
      continue
    }
    const parsed = ActivitySchema.safeParse(raw)
    if (!parsed.success) {
      errors.push(
        `${entry.name}: schema validation failed — ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      )
      continue
    }
    if (parsed.data.slug !== entry.name) {
      errors.push(
        `${entry.name}: slug "${parsed.data.slug}" does not match directory name`,
      )
      continue
    }
    activities.push(parsed.data)
  }

  if (errors.length) {
    throw new Error(`registry build failed:\n  - ${errors.join('\n  - ')}`)
  }

  activities.sort((a, b) => a.slug.localeCompare(b.slug))

  const registry = {
    version: opts.version ?? '0.1.0',
    generatedAt: new Date().toISOString(),
    activities,
  }

  await mkdir(dirname(opts.out), { recursive: true })
  await writeFile(opts.out, JSON.stringify(registry, null, 2) + '\n')
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const root = resolve(process.cwd(), 'registry')
  const out = resolve(process.cwd(), 'dist/registry.json')
  buildRegistry({ root, out })
    .then(() => console.log(`✓ wrote ${out}`))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
