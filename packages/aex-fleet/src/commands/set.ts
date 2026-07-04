import { Command } from 'commander'
import pc from 'picocolors'
import { FleetManager } from '../core/FleetManager.js'
import type { AgentEntry } from '../types.js'

interface SetOptions {
  address?: string
  chain?: string
  email?: string
  tag?: string[]
  addTag?: string[]
  removeTag?: string[]
  linkedTo?: string
  unlink?: boolean
  templateId?: string
  sessionRef?: string
  json?: boolean
}

export function setCommand(): Command {
  return new Command('set')
    .description('Update fields on an existing agent (address, chain, tags, linked-to, …)')
    .argument('<agent-id>', 'Agent to update')
    .option('--address <addr>', 'Set/update the wallet address')
    .option('--chain <chain>', 'Set/update the chain (e.g. ethereum, sepolia, sui)')
    .option('--email <email>', 'Set/update the WaaP signup email')
    .option('--tag <tag>', 'Replace tags with these (repeatable)', collect, [])
    .option('--add-tag <tag>', 'Append a tag (repeatable, additive)', collect, [])
    .option('--remove-tag <tag>', 'Remove a tag (repeatable)', collect, [])
    .option('--linked-to <addr>', 'Set the operator anchor address this agent is linked to')
    .option('--unlink', 'Clear the linked-to anchor')
    .option('--template-id <id>', 'Set/update the template id')
    .option('--session-ref <ref>', 'Set/update the keychain session reference')
    .option('--json', 'Emit updated entry as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ aex-fleet set alpha --address 0xYourSepoliaAddr --chain sepolia
  $ aex-fleet set alpha --add-tag prod --remove-tag test
  $ aex-fleet set alpha --linked-to 0xOperatorAnchor
  $ aex-fleet set alpha --unlink`
    )
    .action(async (agentId: string, opts: SetOptions) => {
      const fm = new FleetManager()
      const existing = fm.getAgent(agentId)
      if (!existing) {
        console.error(pc.red(`Unknown agent: ${agentId}`))
        process.exit(2)
      }
      const patch: Partial<Omit<AgentEntry, 'agentId' | 'createdAt'>> = {}
      if (opts.address !== undefined) patch.address = opts.address
      if (opts.chain !== undefined) patch.chain = opts.chain
      if (opts.email !== undefined) patch.waapEmail = opts.email
      if (opts.templateId !== undefined) patch.templateId = opts.templateId
      if (opts.sessionRef !== undefined) patch.sessionRef = opts.sessionRef
      if (opts.unlink) patch.linkedTo = undefined
      else if (opts.linkedTo !== undefined) patch.linkedTo = opts.linkedTo

      // Tags: --tag fully replaces; --add-tag / --remove-tag additively mutate.
      if (opts.tag && opts.tag.length > 0) {
        patch.tags = dedupe(opts.tag)
      }
      if ((opts.addTag && opts.addTag.length > 0) || (opts.removeTag && opts.removeTag.length > 0)) {
        const base = patch.tags ?? existing.tags
        const removed = new Set(opts.removeTag ?? [])
        patch.tags = dedupe([...base.filter((t) => !removed.has(t)), ...(opts.addTag ?? [])])
      }

      if (Object.keys(patch).length === 0) {
        console.error(pc.yellow('Nothing to update — pass at least one --address / --chain / --tag / etc.'))
        process.exit(2)
      }

      const updated = await fm.updateAgent(agentId, patch)
      if (opts.json) {
        console.log(JSON.stringify(updated, null, 2))
        return
      }
      const changed = Object.keys(patch).join(', ')
      console.log(pc.green(`Updated ${pc.bold(agentId)} (${changed}).`))
    })
}

function collect(value: string, acc: string[]): string[] {
  acc.push(value)
  return acc
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr))
}
