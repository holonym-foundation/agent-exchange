import { Command } from 'commander'
import pc from 'picocolors'
import { defaultIdentityChain, recordIntent } from '../core/erc8004.js'
import { FleetManager } from '../core/FleetManager.js'

export function addCommand(): Command {
  return new Command('add')
    .description('Register a new agent in the fleet')
    .argument('<agent-id>', 'Unique agent identifier')
    .option('-t, --template <id>', 'Template ID from the aex registry')
    .option('-c, --chain <chain>', 'Target chain (e.g. ethereum, sui)')
    .option('-e, --email <email>', 'WaaP signup email')
    .option('-a, --address <address>', 'Wallet address (auto-populated via waap-cli signup once wired)')
    .option('--tag <tag>', 'Tag for grouping (repeatable)', collect, [])
    .option('--session-ref <ref>', 'Keychain reference for the WaaP session')
    .option('--json', 'Emit the added entry as JSON')
    .option('--dry-run', 'Show what would be added without writing fleet.json')
    .option('--register-erc8004', 'Also record ERC-8004 identity intent (chain inferred from --chain)')
    .option(
      '--erc8004-chain <chain>',
      'Override the ERC-8004 chain for --register-erc8004 (defaults to sepolia for EVM)'
    )
    .addHelpText(
      'after',
      `
Examples:
  $ aex-fleet add alpha --chain ethereum --tag yield
  $ aex-fleet add beta --chain ethereum --email user+beta@example.com --tag yield --tag test
  $ aex-fleet add gamma --chain ethereum --dry-run --json`
    )
    .action(async (agentId: string, opts: AddOptions) => {
      const entryDraft = {
        agentId,
        templateId: opts.template,
        chain: opts.chain,
        waapEmail: opts.email,
        address: opts.address,
        tags: opts.tag,
        sessionRef: opts.sessionRef
      }
      if (opts.dryRun) {
        const preview = { ...entryDraft, createdAt: new Date().toISOString() }
        if (opts.json) {
          console.log(JSON.stringify({ dryRun: true, wouldAdd: preview }, null, 2))
        } else {
          console.log(pc.dim('(dry-run) would add:'))
          console.log(JSON.stringify(preview, null, 2))
        }
        return
      }
      const fm = new FleetManager()
      const entry = await fm.addAgent(entryDraft)
      let erc8004Note: string | undefined
      if (opts.registerErc8004) {
        const chain = opts.erc8004Chain ?? defaultIdentityChain(entry.chain)
        if (!chain) {
          erc8004Note = `skipped ERC-8004 intent — can't infer chain for agent.chain=${entry.chain}`
        } else {
          const state = await recordIntent({ agentId, intentChain: chain })
          erc8004Note = `ERC-8004 intent recorded on ${chain} (status=${state.status})`
        }
      }
      if (opts.json) {
        const reread = fm.getAgent(agentId)
        console.log(JSON.stringify({ ...reread, erc8004Note }, null, 2))
        return
      }
      console.log(pc.green(`Added ${pc.bold(agentId)} to fleet.`))
      if (!entry.address) {
        console.log(pc.dim('  No address yet — populate via waap-cli signup or pass --address.'))
      }
      if (erc8004Note) console.log(pc.dim(`  ${erc8004Note}`))
    })
}

interface AddOptions {
  template?: string
  chain?: string
  email?: string
  address?: string
  tag: string[]
  sessionRef?: string
  json?: boolean
  dryRun?: boolean
  registerErc8004?: boolean
  erc8004Chain?: string
}

function collect(value: string, acc: string[]): string[] {
  acc.push(value)
  return acc
}
