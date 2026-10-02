import { execa, type ExecaError } from 'execa'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'
import { getConfigDir } from './config.js'
import { ensureSessionDir } from './keychain.js'

// WaaP owns its session and pending-registration files in one canonical per-agent directory.
// Profile selection is local organization, not a sandbox against code running as this user.

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

export function sandboxDir(agentId: string): string {
  return join(getConfigDir(), 'sandboxes', agentId)
}

/**
 * Take an advisory lock on the agent's sandbox so two concurrent workers (cron, swarm) can't
 * race on the session.json. ~15s total wait (30 retries × up to 500ms) is enough for human-paced
 * 2FA approvals; longer waits should be re-thought at the caller.
 */
async function withAgentLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
  ensureSessionDir(agentId)
  mkdirSync(sandboxDir(agentId), { recursive: true, mode: 0o700 })
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

function isExecaError(err: unknown): err is ExecaError {
  return Boolean(err && typeof err === 'object' && 'exitCode' in err)
}

/** Run waap-cli capturing stdout/stderr. Used by bulk ops that render their own tables. */
export async function runWaap(opts: RunOptions): Promise<WaapRunResult> {
  return withAgentLock(opts.agentId, () => runWaapInner(opts))
}

async function runWaapInner(opts: RunOptions): Promise<WaapRunResult> {
  const bin = opts.bin ?? 'waap-cli'
  const profileDir = ensureSessionDir(opts.agentId)
  try {
    const result = await execa(bin, opts.args, {
      env: { ...process.env, WAAP_CLI_SESSION_DIR: profileDir },
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
  }
}

/** Run waap-cli with stdio inherited so the user sees live output (used by `aex-fleet waap`). */
export async function passthroughWaap(opts: RunOptions): Promise<number> {
  return withAgentLock(opts.agentId, () => passthroughWaapInner(opts))
}

async function passthroughWaapInner(opts: RunOptions): Promise<number> {
  const bin = opts.bin ?? 'waap-cli'
  const profileDir = ensureSessionDir(opts.agentId)
  try {
    const result = await execa(bin, opts.args, {
      env: { ...process.env, WAAP_CLI_SESSION_DIR: profileDir },
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
  }
}

/** Run trusted local code with the agent's WaaP profile; this is not an OS sandbox. */
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
  const profileDir = ensureSessionDir(opts.agentId)
  try {
    const result = await execa(opts.cmd, opts.args, {
      env: { ...process.env, WAAP_CLI_SESSION_DIR: profileDir },
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
  }
}
