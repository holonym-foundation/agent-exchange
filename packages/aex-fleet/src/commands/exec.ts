import { Command } from 'commander'
import { FleetManager } from '../core/FleetManager.js'
import { passthroughExec } from '../core/waap-runner.js'

export function execCommand(): Command {
  return new Command('exec')
    .description("Run trusted local code using the active agent's WaaP session directory")
    .argument('<cmd>', 'binary to run (resolved via PATH)')
    .argument('[args...]', 'arguments passed through verbatim')
    .allowUnknownOption(true)
    .passThroughOptions()
    .helpOption(false)
    .action(async (cmd: string, args: string[]) => {
      const fm = new FleetManager()
      const agentId = fm.resolveAgentId()
      const code = await passthroughExec({ agentId, cmd, args })
      process.exit(code)
    })
}
