import { intro, outro, note, spinner } from '@clack/prompts'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { createFetchRegistry } from './registry/fetch.js'
import { selectActivity } from './prompts/browse.js'
import { selectRuntime } from './prompts/runtime.js'
import {
  promptProjectName,
  validateProjectName
} from './prompts/project-name.js'
import { copyTemplate } from './scaffold/copy.js'
import { writeRegistrationFiles } from './scaffold/eip8004.js'
import { claudeVars } from './runtimes/claude.js'
import { standaloneVars } from './runtimes/standalone.js'
import { openclawVars } from './runtimes/openclaw.js'
import { nousVars } from './runtimes/nous.js'
import { ensureSession } from './session/bootstrap.js'
import { detectSession, type WaapSession } from './session/detect.js'
import type { Activity, Runtime } from './registry/types.js'
import { CawError, ExitCodes } from './util/errors.js'

export interface RunOptions {
  projectName?: string
  activitySlug?: string
  runtime?: Runtime
  noSession?: boolean
  registryUrl?: string
  noCache?: boolean
  nonInteractive?: boolean
  cliVersion: string
}

const DEFAULT_REGISTRY_URL = 'https://docs.waap.xyz/registry.json'
const CACHE_DIR = resolve(homedir(), '.create-agent-wallet')
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export async function run(opts: RunOptions): Promise<void> {
  intro('create-agent-wallet')

  const fetchRegistry = createFetchRegistry({
    url: opts.registryUrl ?? resolveDefaultRegistryUrl(),
    cacheDir: CACHE_DIR,
    ttlMs: opts.noCache ? 0 : DEFAULT_TTL_MS
  })

  const s = spinner()
  s.start('Loading activity registry')
  const registry = await fetchRegistry()
  s.stop(`Loaded ${registry.activities.length} activities`)

  const activity = await pickActivity(registry.activities, opts)
  const runtime = await pickRuntime(activity, opts)
  const projectName = await pickProjectName(activity, opts)
  const session = await resolveSession(opts)

  const projectDir = resolve(process.cwd(), projectName)
  const templateDir = resolveTemplateDir(activity.slug, runtime)

  const baseVars = {
    projectName,
    projectPkgName: projectName,
    chainId: activity.chain.id == null ? '' : String(activity.chain.id),
    chainName: activity.chain.name,
    walletAddress: session?.address ?? '__PENDING__',
    cliVersion: opts.cliVersion,
    recipeUrl: activity.recipeUrl ?? ''
  }
  const vars = dispatchVars(runtime, activity, baseVars)

  s.start('Copying template')
  const fileCount = await copyTemplate({
    from: templateDir,
    to: projectDir,
    vars
  })
  s.stop(`Copied ${fileCount} files`)

  s.start('Writing EIP-8004 agent registration')
  await writeRegistrationFiles(projectDir, activity, {
    projectName,
    runtime,
    chainId: activity.chain.id,
    walletAddress: session?.address
  })
  s.stop('Wrote agent-registration.json')

  const nextSteps = buildNextSteps(projectName, runtime, session)
  note(nextSteps, 'Next steps')
  outro(`Done → ./${projectName}`)
}

async function pickActivity(
  activities: Activity[],
  opts: RunOptions
): Promise<Activity> {
  if (opts.activitySlug) {
    const found = activities.find((a) => a.slug === opts.activitySlug)
    if (!found) {
      throw new CawError(
        `activity not found: ${opts.activitySlug}. available: ${activities.map((a) => a.slug).join(', ')}`,
        ExitCodes.ACTIVITY_NOT_FOUND
      )
    }
    return found
  }
  if (opts.nonInteractive) {
    throw new CawError(
      '--activity is required in non-interactive mode',
      ExitCodes.INVALID_ARGS
    )
  }
  const picked = await selectActivity({ activities })
  if (picked === 'cancelled') {
    outro('cancelled')
    process.exit(ExitCodes.OK)
  }
  return picked
}

async function pickRuntime(
  activity: Activity,
  opts: RunOptions
): Promise<Runtime> {
  if (opts.runtime) {
    if (!activity.runtimes.includes(opts.runtime)) {
      throw new CawError(
        `activity ${activity.slug} does not support runtime ${opts.runtime}. supported: ${activity.runtimes.join(', ')}`,
        ExitCodes.INVALID_ARGS
      )
    }
    return opts.runtime
  }
  if (opts.nonInteractive) {
    if (activity.runtimes.length === 1) return activity.runtimes[0]
    throw new CawError(
      '--runtime is required in non-interactive mode when activity supports multiple',
      ExitCodes.INVALID_ARGS
    )
  }
  const picked = await selectRuntime(activity)
  if (picked === 'cancelled') {
    outro('cancelled')
    process.exit(ExitCodes.OK)
  }
  return picked
}

async function pickProjectName(
  activity: Activity,
  opts: RunOptions
): Promise<string> {
  if (opts.projectName) {
    const validationErr = validateProjectName(opts.projectName)
    if (validationErr) {
      throw new CawError(validationErr, ExitCodes.DIR_EXISTS)
    }
    return opts.projectName
  }
  if (opts.nonInteractive) {
    const fallback = activity.slug
    const err = validateProjectName(fallback)
    if (err) {
      throw new CawError(err, ExitCodes.DIR_EXISTS)
    }
    return fallback
  }
  const answered = await promptProjectName(activity.slug)
  if (answered === 'cancelled') {
    outro('cancelled')
    process.exit(ExitCodes.OK)
  }
  return answered
}

async function resolveSession(opts: RunOptions): Promise<WaapSession | null> {
  if (opts.noSession) return null
  if (opts.nonInteractive) return detectSession()
  return ensureSession()
}

function buildNextSteps(
  projectName: string,
  runtime: Runtime,
  session: WaapSession | null
): string {
  const lines: string[] = [`cd ${projectName}`]
  if (!session?.address) {
    lines.push('# Run `waap-cli signup` before starting the agent')
  }
  lines.push('cp .env.example .env')
  if (runtime === 'standalone') {
    lines.push('npm install')
    lines.push('npm run dev')
  } else {
    lines.push('# Open this folder in Claude Code to discover the skill')
  }
  return lines.join('\n')
}

function resolveTemplateDir(slug: string, runtime: Runtime): string {
  // Templates are bundled next to the compiled CLI at:
  //   dist/registry/activities/<slug>/templates/<runtime>
  // During tests/dev the compiled dist may not exist; fall back to the
  // monorepo agents/ directory or the legacy registry tree.
  const here = fileURLToPath(new URL('.', import.meta.url))
  const bundled = resolve(
    here,
    'registry/activities',
    slug,
    'templates',
    runtime
  )
  // Monorepo layout: agents/ lives at repo root (../../agents/ from src/).
  const monorepoFallback = resolve(
    here,
    '../../agents',
    slug,
    'templates',
    runtime
  )
  // Legacy layout: registry/activities/ next to src/.
  const legacyFallback = resolve(
    here,
    '../registry/activities',
    slug,
    'templates',
    runtime
  )
  if (existsSync(bundled)) return bundled
  if (existsSync(monorepoFallback)) return monorepoFallback
  return legacyFallback
}

function dispatchVars(
  runtime: Runtime,
  activity: Activity,
  base: Record<string, string>
): Record<string, string> {
  switch (runtime) {
    case 'claude':
      return claudeVars(activity, base)
    case 'standalone':
      return standaloneVars(activity, base)
    case 'openclaw':
      return openclawVars(activity, base)
    case 'nous':
      return nousVars(activity, base)
  }
}

function resolveDefaultRegistryUrl(): string {
  // Offline / local-dev fallback: prefer a bundled registry.json next to the
  // compiled CLI so `npx` works even without network or a public host.
  const here = fileURLToPath(new URL('.', import.meta.url))
  const bundled = resolve(here, 'registry.json')
  if (existsSync(bundled)) return `file://${bundled}`
  return DEFAULT_REGISTRY_URL
}
