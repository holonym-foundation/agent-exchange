import { Command } from 'commander'
import pc from 'picocolors'
import { FleetManager } from '../core/FleetManager.js'
import { resolveRecipients } from '../core/resolve-recipient.js'
import { passthroughWaap } from '../core/waap-runner.js'

export function waapCommand(): Command {
  return new Command('waap')
    .description('Run a waap-cli invocation scoped to the active agent (or AEX_FLEET_AGENT env)')
    .argument('[args...]', 'arguments passed through to waap-cli verbatim')
    .allowUnknownOption(true)
    .passThroughOptions()
    .helpOption(false)
    .addHelpText(
      'after',
      `
Examples:
  $ aex-fleet waap whoami
  $ aex-fleet waap send-tx --to bravo --value 0.001   # 'bravo' resolves to its registered address
  $ AEX_FLEET_AGENT=alpha aex-fleet waap balance --chain 11155111`
    )
    .action(async (args: string[]) => {
      const fm = new FleetManager()
      const agentId = fm.resolveAgentId()
      const { args: resolvedArgs, substitutions } = resolveRecipients(args, fm)
      for (const s of substitutions) {
        process.stderr.write(pc.dim(`(resolved ${s.flag} ${s.from} → ${s.to})\n`))
      }
      const code = await passthroughWaap({ agentId, args: resolvedArgs })
      process.exit(code)
    })
}
