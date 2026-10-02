import { describe, it, expect } from 'vitest'
import { readdir, stat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ActivitySchema, ALL_RUNTIMES } from '../../src/registry/types.js'

// Monorepo layout: agents/ at repo root; fallback to legacy registry/activities.
import { existsSync } from 'node:fs'
const monorepoAgents = resolve(__dirname, '../../../../agents')
const legacyRegistry = resolve(__dirname, '../../registry/activities')
const REGISTRY = existsSync(monorepoAgents) ? monorepoAgents : legacyRegistry

// OpenClaw + Nous runtimes both use the AgentSkills open standard
// (agentskills.io) — a plain SKILL.md is all they need.
const REQUIRED_FILES_PER_RUNTIME: Record<string, string[]> = {
  claude: [
    'SKILL.md.tpl',
    'CLAUDE.md.tpl',
    'mcp-config.json.tpl',
    'dot-env.example'
  ],
  standalone: [
    'package.json.tpl',
    'agent.ts.tpl',
    'Dockerfile',
    'dot-env.example'
  ],
  openclaw: ['SKILL.md.tpl', 'dot-env.example', 'README.md.tpl'],
  nous: ['SKILL.md.tpl', 'dot-env.example', 'README.md.tpl']
}

async function listActivities(): Promise<string[]> {
  const entries = await readdir(REGISTRY, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  // Only include directories that have activity.json. The agents/ directory is
  // strictly templates after the 2026-05-07 JS→TS migration, but this guard is
  // retained so future non-activity directories (READMEs, shared utilities) can
  // coexist without breaking the suite.
  const activities: string[] = []
  for (const d of dirs) {
    if (existsSync(resolve(REGISTRY, d, 'activity.json'))) {
      activities.push(d)
    }
  }
  return activities
}

describe('registry coverage', () => {
  // Two agent classes share the registry:
  //   • template-class — CLI-scaffolded; must ship templates/ for every runtime they declare.
  //   • profile-class  — behavior lives in activity.json, run on the managed AEX runtime;
  //                      they ship NO scaffold templates. Marked by a `behavior` block.
  async function classify(): Promise<{ template: string[]; profile: string[] }> {
    const activities = await listActivities()
    const template: string[] = []
    const profile: string[] = []
    for (const slug of activities) {
      const raw = JSON.parse(await readFile(resolve(REGISTRY, slug, 'activity.json'), 'utf8'))
      ;(raw.behavior ? profile : template).push(slug)
    }
    return { template: template.sort(), profile: profile.sort() }
  }

  it('ships the expected template-class activities', async () => {
    const { template } = await classify()
    expect(template).toEqual(['cetus-yield-agent'])
  })

  it('ships the expected profile-class activities', async () => {
    const { profile } = await classify()
    expect(profile).toEqual([])
  })

  it('every activity.json validates against the schema', async () => {
    const activities = await listActivities()
    for (const slug of activities) {
      const path = resolve(REGISTRY, slug, 'activity.json')
      const raw = JSON.parse(await readFile(path, 'utf8'))
      const result = ActivitySchema.safeParse(raw)
      if (!result.success) {
        throw new Error(`${slug}: ${result.error.message}`)
      }
      expect(result.data.slug).toBe(slug)
    }
  })

  it('every profile-class activity ships an executable behavior task', async () => {
    const { profile } = await classify()
    for (const slug of profile) {
      const raw = JSON.parse(await readFile(resolve(REGISTRY, slug, 'activity.json'), 'utf8'))
      expect(typeof raw.behavior?.task, `${slug} behavior.task`).toBe('string')
      expect(raw.behavior.task.length, `${slug} behavior.task non-empty`).toBeGreaterThan(0)
    }
  })

  it('every template-class activity declares all 4 runtimes', async () => {
    const { template } = await classify()
    for (const slug of template) {
      const raw = JSON.parse(
        await readFile(resolve(REGISTRY, slug, 'activity.json'), 'utf8')
      )
      const runtimes = raw.runtimes as string[]
      for (const r of ALL_RUNTIMES) {
        expect(runtimes).toContain(r)
      }
    }
  })

  it('every template-class activity has a template directory per declared runtime', async () => {
    const { template } = await classify()
    for (const slug of template) {
      const raw = JSON.parse(
        await readFile(resolve(REGISTRY, slug, 'activity.json'), 'utf8')
      )
      for (const runtime of raw.runtimes as string[]) {
        const dir = resolve(REGISTRY, slug, 'templates', runtime)
        const s = await stat(dir)
        expect(s.isDirectory(), `${slug}/${runtime} missing`).toBe(true)
      }
    }
  })

  it('every template-class runtime template ships the minimum required files', async () => {
    const { template } = await classify()
    for (const slug of template) {
      for (const [runtime, required] of Object.entries(
        REQUIRED_FILES_PER_RUNTIME
      )) {
        const dir = resolve(REGISTRY, slug, 'templates', runtime)
        const present = await readdir(dir)
        for (const f of required) {
          expect(present, `${slug}/${runtime} missing ${f}`).toContain(f)
        }
      }
    }
  })

  it('documents every standalone env key in activity.json', async () => {
    const { template } = await classify()
    for (const slug of template) {
      const raw = JSON.parse(
        await readFile(resolve(REGISTRY, slug, 'activity.json'), 'utf8')
      )
      const documented = new Set(raw.envVars.map((entry: { key: string }) => entry.key))
      const envTemplate = await readFile(
        resolve(REGISTRY, slug, 'templates/standalone/dot-env.example'),
        'utf8'
      )
      const configured = [...envTemplate.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)]
        .map((match) => match[1])
      const missing = configured.filter((key) => !documented.has(key))
      expect(missing, `${slug} has undocumented standalone env keys`).toEqual([])
    }
  })
})
