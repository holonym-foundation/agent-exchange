import { execa, type ExecaError } from 'execa'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'
import { getConfigDir } from './config.js'
import { readSession, writeSession } from './keychain.js'

// waap-cli reads/writes ~/.waap-agent/session.json (per products/waap/prd/agentic-waap.md §4.1).
// We do not fork waap-cli. Instead we override HOME to a per-agent sandbox dir so each invocation
// sees its own session file. On entry: materialise the session from our store into the sandbox.
// On exit: persist any changes back. Sequential by default — 2FA prompts must serialise anyway.
//
// Upstream WAAP_CONFIG_DIR request will let us drop this trick later (Day 7 deliverable).

export interface WaapRunResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  agentId: string
  args: string[]
  /** Override the waap-cli binary path. Defaults to `waap-cli` (resolved via PATH). */
  bin?: string
}

const SESSION_REL = '.waap-agent/session.json'

export function sandboxDir(agentId: string): string {
  return join(getConfigDir(), 'sandboxes', agentId)
}

function sandboxSessionPath(agentId: string): string {
  return join(sandboxDir(agentId), SESSION_REL)
}

function ensureSandbox(agentId: string): string {
  const dir = sandboxDir(agentId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const waapDir = join(dir, '.waap-agent')
  if (!existsSync(waapDir)) mkdirSync(waapDir, { recursive: true, mode: 0o700 })
  return dir
}

/**
 * Take an advisory lock on the agent's sandbox so two concurrent workers (cron, swarm) can't
 * race on the session.json. ~15s total wait (30 retries × up to 500ms) is enough for human-paced
 * 2FA approvals; longer waits should be re-thought at the caller.
 */
async function withAgentLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
  ensureSandbox(agentId)
  const lockPath = join(sandboxDir(agentId), '.lock')
  if (!existsSync(lockPath)) writeFileSync(lockPath, '', { mode: 0o600 })
  const release = await lockfile.lock(lockPath, {
    retries: { retries: 30, minTimeout: 100, maxTimeout: 500 }
  })
  try {
    return await fn()
  } finally {
    await release()
  }
}

function materializeSession(agentId: string): void {
  const session = readSession(agentId)
  if (!session) return
  const p = sandboxSessionPath(agentId)
  writeFileSync(p, JSON.stringify(session, null, 2), { mode: 0o600 })
  chmodSync(p, 0o600)
}

function persistSession(agentId: string): void {
  const p = sandboxSessionPath(agentId)
  if (!existsSync(p)) return
  const session = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
  writeSession(agentId, session)
}

function isExecaError(err: unknown): err is ExecaError {
  return Boolean(err && typeof err === 'object' && 'exitCode' in err)
}

/** Run waap-cli capturing stdout/stderr. Used by bulk ops that render their own tables. */
export async function runWaap(opts: RunOptions): Promise<WaapRunResult> {
  return withAgentLock(opts.agentId, () => runWaapInner(opts))
}

async function runWaapInner(opts: RunOptions): Promise<WaapRunResult> {
  const bin = opts.bin ?? 'waap-cli'
  const home = ensureSandbox(opts.agentId)
  materializeSession(opts.agentId)
  try {
    const result = await execa(bin, opts.args, {
      env: { ...process.env, HOME: home },
      stdio: 'pipe',
      reject: false
    })
    const stdout = typeof result.stdout === 'string' ? result.stdout : ''
    const stderr = typeof result.stderr === 'string' ? result.stderr : ''
    // execa v9 with reject:false returns failed:true and exitCode:undefined on spawn errors
    // (ENOENT/EACCES). Translate that to a non-zero exit and surface shortMessage in stderr.
    if (typeof result.exitCode !== 'number') {
      return { exitCode: -1, stdout, stderr: stderr || result.shortMessage || result.message || '' }
    }
    return { exitCode: result.exitCode, stdout, stderr }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (isExecaError(err)) {
      return {
        exitCode: typeof err.exitCode === 'number' ? err.exitCode : -1,
        stdout: typeof err.stdout === 'string' ? err.stdout : '',
        stderr: (typeof err.stderr === 'string' ? err.stderr : '') || msg
      }
    }
    return { exitCode: -1, stdout: '', stderr: msg }
  } finally {
    persistSession(opts.agentId)
  }
}

/** Run waap-cli with stdio inherited so the user sees live output (used by `aex-fleet waap`). */
export async function passthroughWaap(opts: RunOptions): Promise<number> {
  return withAgentLock(opts.agentId, () => passthroughWaapInner(opts))
}

async function passthroughWaapInner(opts: RunOptions): Promise<number> {
  const bin = opts.bin ?? 'waap-cli'
  const home = ensureSandbox(opts.agentId)
  materializeSession(opts.agentId)
  try {
    const result = await execa(bin, opts.args, {
      env: { ...process.env, HOME: home },
      stdio: 'inherit',
      reject: false
    })
    return typeof result.exitCode === 'number' ? result.exitCode : -1
  } catch (err) {
    if (isExecaError(err)) {
      if (err.stderr && typeof err.stderr === 'string') process.stderr.write(err.stderr)
      return typeof err.exitCode === 'number' ? err.exitCode : -1
    }
    throw err
  } finally {
    persistSession(opts.agentId)
  }
}

/** Run an arbitrary command in the agent's HOME sandbox. */
export async function passthroughExec(opts: {
  agentId: string
  cmd: string
  args: string[]
}): Promise<number> {
  return withAgentLock(opts.agentId, () => passthroughExecInner(opts))
}

async function passthroughExecInner(opts: {
  agentId: string
  cmd: string
  args: string[]
}): Promise<number> {
  const home = ensureSandbox(opts.agentId)
  materializeSession(opts.agentId)
  try {
    const result = await execa(opts.cmd, opts.args, {
      env: { ...process.env, HOME: home },
      stdio: 'inherit',
      reject: false
    })
    return typeof result.exitCode === 'number' ? result.exitCode : -1
  } catch (err) {
    if (isExecaError(err)) {
      if (err.stderr && typeof err.stderr === 'string') process.stderr.write(err.stderr)
      return typeof err.exitCode === 'number' ? err.exitCode : -1
    }
    throw err
  } finally {
    persistSession(opts.agentId)
  }
}
