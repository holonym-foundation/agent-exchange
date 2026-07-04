import { spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentStatus, ComputeProvider, DeployResult, DeploySpec } from './types.js'

/**
 * LocalProvider — runs the agent as a detached local process. Not for production; it's the
 * always-available fallback so `aex-fleet deploy` is demoable end-to-end (provision → run →
 * telemetry) without any external compute. Proves the provider seam; swap `--target arkhai`
 * to ship the same agent onto a leased VM.
 */
export class LocalProvider implements ComputeProvider {
  readonly name = 'local' as const

  async preflight(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true }
  }

  async deploy(spec: DeploySpec): Promise<DeployResult> {
    const entry = detectEntry(spec.source)
    const pidFile = join(spec.source, '.aex-fleet.pid')
    const logFile = join(spec.source, 'agent.log')

    if (spec.dryRun) {
      return {
        provider: this.name,
        ref: 'dry-run-pid',
        host: 'local',
        deployedAt: new Date().toISOString(),
        notes: [`would run: ${entry.cmd} ${entry.args.join(' ')} (cwd ${spec.source})`]
      }
    }

    const out = openAppend(logFile)
    const child = spawn(entry.cmd, entry.args, {
      cwd: spec.source,
      env: { ...process.env, ...spec.env },
      detached: true,
      stdio: ['ignore', out, out]
    })
    child.unref()
    const pid = child.pid ?? 0
    writeFileSync(pidFile, String(pid), { mode: 0o600 })
    return {
      provider: this.name,
      ref: String(pid),
      host: 'local',
      deployedAt: new Date().toISOString(),
      notes: [`started pid ${pid}, logs → ${logFile}`]
    }
  }

  async stop(ref: string): Promise<void> {
    const pid = Number(ref)
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        /* already gone */
      }
    }
  }

  async getStatus(ref: string): Promise<AgentStatus> {
    const pid = Number(ref)
    if (!Number.isInteger(pid) || pid <= 0) return { state: 'unknown' }
    try {
      process.kill(pid, 0) // probe without signalling
      return { state: 'running', detail: `pid ${pid}` }
    } catch {
      return { state: 'stopped', detail: `pid ${pid} not alive` }
    }
  }
}

function detectEntry(source: string): { cmd: string; args: string[] } {
  if (existsSync(join(source, 'agent.ts'))) return { cmd: 'npx', args: ['tsx', 'agent.ts'] }
  if (existsSync(join(source, 'agent.js'))) return { cmd: 'node', args: ['agent.js'] }
  // Fall back to the package.json start script.
  const pkgPath = join(source, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
    if (pkg.scripts?.start) return { cmd: 'npm', args: ['start'] }
  }
  throw new Error(`No agent entrypoint found in ${source} (looked for agent.ts, agent.js, npm start)`)
}

function openAppend(path: string): number {
  return openSync(path, 'a')
}
