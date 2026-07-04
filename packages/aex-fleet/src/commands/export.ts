import { Command } from 'commander'
import { writeFileSync } from 'node:fs'
import pc from 'picocolors'
import { getConfigPath } from '../core/config.js'
import { statusDescription } from '../core/erc8004.js'
import { FleetManager } from '../core/FleetManager.js'

export function exportCommand(): Command {
  return new Command('export')
    .description("Dump the full fleet manifest as JSON — backup, audit, or share with the team")
    .option('-o, --out <path>', 'Write manifest to a file (default: stdout)')
    .option('--include-recovery-note', "Include a human-readable note about how to recover wallets from email+password")
    .addHelpText(
      'after',
      `
Examples:
  $ aex-fleet export > fleet.json.bak
  $ aex-fleet export --out ~/Dropbox/aex-fleet-backup.json --include-recovery-note
  $ aex-fleet export | jq '.agents[] | {agentId, address}'

Recovery: each agent's wallet is held in WaaP's 2PC architecture. The Sovereign Share is
derived deterministically from the email + password at signup, and the Security Share lives
in the WaaP TEE. So even if you lose fleet.json, running \`waap-cli login -e <email> -p
<password>\` on any machine recovers the wallet — fleet.json just tracks the mapping.`
    )
    .action((opts: { out?: string; includeRecoveryNote?: boolean }) => {
      const fm = new FleetManager()
      const agents = fm.listAgents()
      const manifest = {
        version: 1,
        exportedAt: new Date().toISOString(),
        configPath: getConfigPath(),
        activeAgent: fm.getActive() ?? null,
        agentCount: agents.length,
        ...(opts.includeRecoveryNote
          ? {
              recovery: {
                model: 'WaaP 2PC',
                howTo:
                  'Each wallet is recoverable on any machine via `waap-cli login -e <email> -p <password>`. The Sovereign Share is derived from these credentials; the Security Share is held in the WaaP TEE. fleet.json only tracks the local agent-id → address mapping — losing it does NOT lose the wallets.',
                whatToBackup: [
                  'This manifest (agent-id → email mapping)',
                  'The password(s) used during signup',
                  'Any external recovery factor (Telegram 2FA, hardware wallet) configured per agent'
                ]
              }
            }
          : {}),
        agents: agents.map((a) => ({
          agentId: a.agentId,
          address: a.address ?? null,
          chain: a.chain ?? null,
          waapEmail: a.waapEmail ?? null,
          templateId: a.templateId ?? null,
          tags: a.tags,
          linkedTo: a.linkedTo ?? null,
          createdAt: a.createdAt,
          erc8004: a.erc8004
            ? { ...a.erc8004, description: statusDescription(a.erc8004) }
            : null,
          lastBalanceCache: a.lastBalanceCache ?? null
        }))
      }
      const json = JSON.stringify(manifest, null, 2)
      if (opts.out) {
        writeFileSync(opts.out, json)
        console.error(pc.green(`wrote ${agents.length} agent(s) to ${opts.out}`))
      } else {
        process.stdout.write(json + '\n')
      }
    })
}
