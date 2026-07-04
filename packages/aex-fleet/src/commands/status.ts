import { Command } from 'commander'
import pc from 'picocolors'
import { FleetManager } from '../core/FleetManager.js'
import {
  closeNeonPool,
  fetchFleetStatus,
  getNeonPool,
  type AgentStatusRow
} from '../core/neon-client.js'
import type { AgentEntry } from '../types.js'

export function statusCommand(): Command {
  return new Command('status')
    .description('Aggregate fleet status from Neon: latest balance, last activity, errors (24h)')
    .option('--json', 'Emit aggregate status as JSON')
    .action(async (opts: { json?: boolean }) => {
      const fm = new FleetManager()
      const agents = fm.listAgents()
      if (agents.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ summary: { fleetSize: 0 }, agents: [] }, null, 2))
        } else {
          console.log(pc.dim('No agents registered. Try `aex-fleet add <agent-id>`.'))
        }
        return
      }

      const pool = getNeonPool()
      const rows = await fetchFleetStatus(agents.map((a) => a.agentId))
      const byId = new Map(rows.map((r) => [r.agentId, r]))
      const totalErrors = rows.reduce((s, r) => s + r.errorsLast24h, 0)
      const withErrors = rows.filter((r) => r.errorsLast24h > 0).map((r) => r.agentId)

      try {
        if (opts.json) {
          renderJson(fm, agents, rows, totalErrors, withErrors, Boolean(pool))
        } else {
          renderHuman(fm, agents, byId, totalErrors, withErrors, Boolean(pool))
        }
      } finally {
        await closeNeonPool()
      }
    })
}

function renderJson(
  fm: FleetManager,
  agents: AgentEntry[],
  rows: AgentStatusRow[],
  totalErrors: number,
  withErrors: string[],
  telemetryConnected: boolean
): void {
  const byId = new Map(rows.map((r) => [r.agentId, r]))
  const active = fm.getActive()
  console.log(
    JSON.stringify(
      {
        summary: {
          fleetSize: agents.length,
          telemetryConnected,
          totalErrorsLast24h: totalErrors,
          agentsWithErrorsLast24h: withErrors,
          activeAgent: active
        },
        agents: agents.map((a) => ({
          agentId: a.agentId,
          chain: a.chain,
          tags: a.tags,
          address: a.address,
          linkedTo: a.linkedTo,
          telemetry: byId.get(a.agentId) ?? null
        }))
      },
      null,
      2
    )
  )
}

function renderHuman(
  fm: FleetManager,
  agents: AgentEntry[],
  byId: Map<string, AgentStatusRow>,
  totalErrors: number,
  withErrors: string[],
  telemetryConnected: boolean
): void {
  if (!telemetryConnected) {
    console.log(pc.yellow('Telemetry unavailable.') + pc.dim(' Set AEX_FLEET_NEON_DSN_RO to enable.'))
    console.log()
  }
  const active = fm.getActive()
  const header = ['', 'AGENT-ID', 'CHAIN', 'BALANCE', 'LAST EVENT', 'ERR/24h']
  const rows = agents.map((a): string[] => {
    const r = byId.get(a.agentId)
    return [
      active === a.agentId ? pc.cyan('*') : ' ',
      a.agentId,
      a.chain ?? pc.dim('—'),
      formatBalance(r),
      r?.lastEventTs ? relativeAge(r.lastEventTs) : pc.dim('—'),
      formatErrCount(r)
    ]
  })
  console.log(renderTable(header, rows))
  console.log()
  if (!telemetryConnected) return
  if (totalErrors === 0) {
    console.log(pc.green('No errors across the fleet in last 24h'))
  } else {
    console.log(
      pc.yellow(
        `${totalErrors} error event(s) across ${withErrors.length} agent(s) in last 24h: ${withErrors.join(', ')}`
      )
    )
  }
}

function formatBalance(r?: AgentStatusRow): string {
  if (!r || r.lastBalance == null) return pc.dim('—')
  const v = r.lastBalance
  return Number.isFinite(v) ? v.toFixed(4) : String(v)
}

function formatErrCount(r?: AgentStatusRow): string {
  if (!r) return pc.dim('—')
  if (r.errorsLast24h === 0) return '0'
  return pc.red(String(r.errorsLast24h))
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}

function renderTable(header: string[], rows: string[][]): string {
  const widths = header.map((_, i) =>
    Math.max(visualLen(header[i] ?? ''), ...rows.map((r) => visualLen(r[i] ?? '')))
  )
  const fmt = (row: string[]) =>
    row.map((cell, i) => cell + ' '.repeat(Math.max(0, widths[i] - visualLen(cell)))).join('  ')
  return [pc.bold(fmt(header)), ...rows.map(fmt)].join('\n')
}

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
function visualLen(s: string): number {
  return s.replace(ANSI_RE, '').length
}
