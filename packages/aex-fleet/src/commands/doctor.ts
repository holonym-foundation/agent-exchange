import { Command } from 'commander'
import { execa } from 'execa'
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'
import { getConfigDir, getConfigPath, readConfig } from '../core/config.js'
import { closeNeonPool, getNeonPool } from '../core/neon-client.js'

interface CheckResult {
  name: string
  status: 'ok' | 'warn' | 'fail' | 'pending'
  detail: string
}

export function doctorCommand(): Command {
  return new Command('doctor')
    .description("Health-check the aex-fleet runtime (waap-cli, Neon, session store, linkage SDK)")
    .option('--json', 'Emit results as JSON')
    .option('--bin <path>', 'Path to the waap-cli binary (defaults to PATH)')
    .action(async (opts: { json?: boolean; bin?: string }) => {
      const checks: CheckResult[] = []
      checks.push(await checkWaapCli(opts.bin))
      checks.push(checkConfigDir())
      checks.push(checkFleetJson())
      checks.push(await checkNeon())
      checks.push(checkLinkage())

      const failed = checks.filter((c) => c.status === 'fail').length
      try {
        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                healthy: failed === 0,
                checks
              },
              null,
              2
            )
          )
        } else {
          for (const c of checks) console.log(renderLine(c))
          console.log()
          console.log(failed === 0 ? pc.green('healthy') : pc.red(`${failed} check(s) failed`))
        }
      } finally {
        await closeNeonPool()
      }
      if (failed > 0) process.exit(1)
    })
}

async function checkWaapCli(bin = 'waap-cli'): Promise<CheckResult> {
  try {
    const r = await execa(bin, ['--version'], { reject: false, stdio: 'pipe' })
    if (typeof r.exitCode !== 'number') {
      return { name: 'waap-cli', status: 'fail', detail: r.shortMessage ?? 'spawn failed' }
    }
    if (r.exitCode === 0) {
      const version = (r.stdout ?? '').toString().trim() || 'installed'
      return { name: 'waap-cli', status: 'ok', detail: version }
    }
    return {
      name: 'waap-cli',
      status: 'fail',
      detail: `${bin} --version exited ${r.exitCode}`
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { name: 'waap-cli', status: 'fail', detail: msg }
  }
}

function checkConfigDir(): CheckResult {
  const dir = getConfigDir()
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
    const probe = join(dir, `.doctor-probe-${process.pid}`)
    writeFileSync(probe, 'ok', { mode: 0o600 })
    unlinkSync(probe)
    const mode = statSync(dir).mode & 0o777
    const looseMode = mode & 0o077
    return {
      name: 'session-store dir',
      status: looseMode === 0 ? 'ok' : 'warn',
      detail: looseMode === 0 ? `${dir} (mode ${mode.toString(8)})` : `${dir} is world-readable (mode ${mode.toString(8)})`
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { name: 'session-store dir', status: 'fail', detail: `${dir}: ${msg}` }
  }
}

function checkFleetJson(): CheckResult {
  const p = getConfigPath()
  if (!existsSync(p)) {
    return { name: 'fleet.json', status: 'ok', detail: `not yet created (${p})` }
  }
  try {
    const cfg = readConfig(p)
    const count = Object.keys(cfg.agents).length
    return { name: 'fleet.json', status: 'ok', detail: `${count} agent(s) registered` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { name: 'fleet.json', status: 'fail', detail: msg }
  }
}

async function checkNeon(): Promise<CheckResult> {
  const pool = getNeonPool()
  if (!pool) {
    return {
      name: 'Neon telemetry',
      status: 'warn',
      detail: 'AEX_FLEET_NEON_DSN_RO not set — status command will degrade gracefully'
    }
  }
  try {
    await pool.query('SELECT 1')
    return { name: 'Neon telemetry', status: 'ok', detail: 'reachable' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { name: 'Neon telemetry', status: 'fail', detail: msg }
  }
}

function checkLinkage(): CheckResult {
  // Lucian's wallet-linking SDK methods (waap_linkAddress / waap_getLinkedAddresses) are not yet
  // wired in v1 — gated behind --feature linking. Surface as 'pending' so operators know it's
  // explicitly deferred, not silently missing.
  return {
    name: 'wallet linking',
    status: 'pending',
    detail: 'deferred to v1.x — gated behind --feature linking once @human.tech/waap-sdk ships waap_linkAddress'
  }
}

function renderLine(c: CheckResult): string {
  const tag =
    c.status === 'ok'
      ? pc.green('  OK   ')
      : c.status === 'warn'
        ? pc.yellow(' WARN  ')
        : c.status === 'pending'
          ? pc.dim('PENDING')
          : pc.red(' FAIL  ')
  return `${tag} ${pc.bold(c.name.padEnd(20))}  ${c.detail}`
}
