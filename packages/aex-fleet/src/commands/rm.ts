import { Command } from 'commander'
import pc from 'picocolors'
import { FleetManager } from '../core/FleetManager.js'

export function rmCommand(): Command {
  return new Command('rm')
    .alias('remove')
    .description('Remove an agent from the fleet registry (does NOT touch the wallet)')
    .argument('<agent-id>', 'Agent to remove')
    .option('--dry-run', 'Show what would be removed without writing fleet.json')
    .addHelpText(
      'after',
      `
Examples:
  $ aex-fleet rm beta
  $ aex-fleet rm beta --dry-run`
    )
    .action(async (agentId: string, opts: { dryRun?: boolean }) => {
      const fm = new FleetManager()
      const entry = fm.getAgent(agentId)
      if (!entry) {
        console.error(pc.red(`Unknown agent: ${agentId}`))
        process.exit(2)
      }
      if (opts.dryRun) {
        console.log(pc.dim(`(dry-run) would remove ${pc.bold(agentId)} from fleet registry.`))
        console.log(pc.dim('  Wallet itself would not be touched.'))
        return
      }
      await fm.removeAgent(agentId)
      console.log(pc.green(`Removed ${pc.bold(agentId)} from fleet registry.`))
      console.log(pc.dim('  The wallet itself is untouched.'))
    })
}
