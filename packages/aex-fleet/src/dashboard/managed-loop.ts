import { execa, type ResultPromise } from 'execa'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve the perpetual-pass-loop.sh shipped alongside the package. When the package is
// installed via npm/npm link, it lives at <pkg>/examples/perpetual-pass-loop.sh. dist is
// bundled to dist/index.js, so we walk one level up.
function resolveLoopScript(): string {
  // dist/index.js → ../examples/perpetual-pass-loop.sh
  const distDir = dirname(fileURLToPath(import.meta.url))
  // tsup bundles everything into dist/, so import.meta.url points at the bundle (or in tests at
  // src/dashboard/managed-loop.ts). Walk up until we find an examples/ sibling.
  let dir = distDir
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, 'examples', 'perpetual-pass-loop.sh')
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }
  // Fallback (Docker): script copied to /usr/local/share/aex-fleet/perpetual-pass-loop.sh
  const fallback = '/usr/local/share/aex-fleet/perpetual-pass-loop.sh'
  if (existsSync(fallback)) return fallback
  throw new Error(
    'perpetual-pass-loop.sh not found. Set AEX_FLEET_LOOP_SCRIPT to an explicit path.'
  )
}

interface ManagedLoopState {
  managed: boolean
  pid: number | null
  startedAt: string | null
  emailBase: string | null
  lastExitCode: number | null
  lastExitedAt: string | null
}

const state: ManagedLoopState = {
  managed: false,
  pid: null,
  startedAt: null,
  emailBase: null,
  lastExitCode: null,
  lastExitedAt: null
}

let child: ResultPromise | null = null

export function managedLoopState(): ManagedLoopState {
  return { ...state }
}

export interface StartLoopOptions {
  emailBase: string
  password?: string
  delay?: number
  amount?: string
  chainId?: number
  maxHops?: number
}

export function startManagedLoop(opts: StartLoopOptions): { pid: number; script: string } {
  if (child && state.pid !== null) {
    throw new Error(`loop is already running (pid=${state.pid})`)
  }
  const script = process.env.AEX_FLEET_LOOP_SCRIPT ?? resolveLoopScript()
  if (!opts.emailBase || !opts.emailBase.includes('@')) {
    throw new Error('emailBase is required and must look like an email')
  }
  const env: Record<string, string> = {
    ...process.env,
    EMAIL_BASE: opts.emailBase,
    ...(opts.password ? { PASSWORD: opts.password } : {}),
    ...(opts.delay != null ? { DELAY: String(opts.delay) } : {}),
    ...(opts.amount != null ? { AMOUNT: opts.amount } : {}),
    ...(opts.chainId != null ? { CHAIN_ID: String(opts.chainId) } : {}),
    ...(opts.maxHops != null ? { MAX_HOPS: String(opts.maxHops) } : {})
  }
  child = execa('bash', [script], {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    reject: false,
    // detached:false so the child dies if the parent does — important for Docker / dev safety
    detached: false
  })
  const pid = child.pid ?? 0
  state.managed = true
  state.pid = pid
  state.startedAt = new Date().toISOString()
  state.emailBase = opts.emailBase
  state.lastExitCode = null
  state.lastExitedAt = null

  // When the child exits, update state so the next /api/state shows it.
  void child
    .then((result) => {
      state.pid = null
      state.lastExitCode = typeof result.exitCode === 'number' ? result.exitCode : null
      state.lastExitedAt = new Date().toISOString()
      child = null
    })
    .catch((err) => {
      state.pid = null
      state.lastExitCode = -1
      state.lastExitedAt = new Date().toISOString()
      child = null
      console.error('[managed-loop] child failed:', err instanceof Error ? err.message : err)
    })

  return { pid, script }
}

export async function stopManagedLoop(timeoutMs = 30_000): Promise<{ stopped: boolean }> {
  if (!child || state.pid === null) return { stopped: false }
  const pidAtStop = state.pid
  try {
    process.kill(pidAtStop, 'SIGTERM')
  } catch {
    // already gone
    child = null
    state.pid = null
    return { stopped: true }
  }
  // Wait up to timeoutMs for the child to exit; escalate to SIGKILL if it doesn't.
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && child) {
    await new Promise((r) => setTimeout(r, 200))
  }
  if (child && state.pid !== null) {
    try {
      process.kill(state.pid, 'SIGKILL')
    } catch {
      /* ignore */
    }
    child = null
    state.pid = null
  }
  return { stopped: true }
}
