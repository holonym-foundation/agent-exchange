import { Command } from 'commander'
import pc from 'picocolors'
import { FleetManager } from '../core/FleetManager.js'

export function useCommand(): Command {
  return new Command('use')
    .description('Set the active agent for subsequent commands')
    .argument('<agent-id>', 'Agent to make active')
    .action(async (agentId: string) => {
      const fm = new FleetManager()
      await fm.setActive(agentId)
      console.log(pc.green(`Active agent: ${pc.bold(agentId)}`))
    })
}
