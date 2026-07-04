import { Command } from 'commander'
import pc from 'picocolors'
import { FleetManager } from '../core/FleetManager.js'
import type { AgentEntry } from '../types.js'

export function lsCommand(): Command {
  return new Command('ls')
    .alias('list')
    .description('List agents in the fleet')
    .option('--json', 'Emit the agent list as JSON')
    .action((opts: { json?: boolean }) => {
      const fm = new FleetManager()
      const agents = fm.listAgents()
      const active = fm.getActive()
      if (opts.json) {
        console.log(JSON.stringify({ activeAgent: active, agents }, null, 2))
        return
      }
      if (agents.length === 0) {
        console.log(pc.dim('No agents registered yet. Try `aex-fleet add <agent-id>`.'))
        return
      }
      const anyErc8004 = agents.some((a) => a.erc8004)
      const baseHeader = ['', 'AGENT-ID', 'CHAIN', 'ADDRESS', 'BALANCE', 'LINKED-TO', 'TAGS']
      const header = anyErc8004 ? [...baseHeader, '8004'] : baseHeader
      const rows = agents.map((a) => formatRow(a, active === a.agentId, anyErc8004))
      console.log(renderTable(header, rows))
    })
}

function formatRow(a: AgentEntry, isActive: boolean, withErc8004Col: boolean): string[] {
  const base = [
    isActive ? pc.cyan('*') : ' ',
    a.agentId,
    a.chain ?? pc.dim('—'),
    a.address ? shortAddr(a.address) : pc.dim('—'),
    a.lastBalanceCache?.value ?? pc.dim('—'),
    a.linkedTo ? shortAddr(a.linkedTo) : pc.dim('—'),
    a.tags.length ? a.tags.join(',') : pc.dim('—')
  ]
  if (!withErc8004Col) return base
  return [...base, formatErc8004Cell(a)]
}

function formatErc8004Cell(a: AgentEntry): string {
  if (!a.erc8004) return pc.dim('—')
  switch (a.erc8004.status) {
    case 'minted':
      return pc.green(`#${a.erc8004.tokenId ?? '?'}@${a.erc8004.intentChain}`)
    case 'failed':
      return pc.red(`fail@${a.erc8004.intentChain}`)
    case 'pending':
      return pc.yellow(`pending@${a.erc8004.intentChain}`)
  }
}

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function renderTable(header: string[], rows: string[][]): string {
  const widths = header.map((_, i) =>
    Math.max(visualLen(header[i] ?? ''), ...rows.map((r) => visualLen(r[i] ?? '')))
  )
  const fmt = (row: string[]) =>
    row.map((cell, i) => cell + ' '.repeat(Math.max(0, widths[i] - visualLen(cell)))).join('  ')
  return [pc.bold(fmt(header)), ...rows.map(fmt)].join('\n')
}

// ANSI SGR matcher — built via String.fromCharCode so the literal ESC byte survives any
// editor / serialization step that strips raw control characters.
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
function visualLen(s: string): number {
  return s.replace(ANSI_RE, '').length
}
