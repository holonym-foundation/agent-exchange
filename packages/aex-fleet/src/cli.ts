import { Command } from 'commander'
import { addCommand } from './commands/add.js'
import { applyCommand } from './commands/apply.js'
import { autopayCommand } from './commands/autopay.js'
import { dashboardCommand } from './commands/dashboard.js'
import { deployCommand } from './commands/deploy.js'
import { doctorCommand } from './commands/doctor.js'
import { erc8004Command } from './commands/erc8004.js'
import { execCommand } from './commands/exec.js'
import { exportCommand } from './commands/export.js'
import { lsCommand } from './commands/ls.js'
import { planCommand } from './commands/plan.js'
import { policyCommand } from './commands/policy.js'
import { renewCommand } from './commands/renew.js'
import { rmCommand } from './commands/rm.js'
import { setCommand } from './commands/set.js'
import { statusCommand } from './commands/status.js'
import { useCommand } from './commands/use.js'
import { waapCommand } from './commands/waap.js'

export function cliEntry(): void {
  const program = new Command()
  program
    .name('aex-fleet')
    .description('Multi-agent operator CLI for WaaP wallets')
    .version('0.0.1')
    .enablePositionalOptions() // required for `waap` and `exec` to pass options through verbatim

  program.addCommand(addCommand())
  program.addCommand(lsCommand())
  program.addCommand(useCommand())
  program.addCommand(setCommand())
  program.addCommand(rmCommand())
  program.addCommand(policyCommand())
  program.addCommand(autopayCommand())
  program.addCommand(renewCommand())
  program.addCommand(planCommand())
  program.addCommand(applyCommand())
  program.addCommand(statusCommand())
  program.addCommand(deployCommand())
  program.addCommand(waapCommand())
  program.addCommand(execCommand())
  program.addCommand(doctorCommand())
  program.addCommand(erc8004Command())
  program.addCommand(dashboardCommand())
  program.addCommand(exportCommand())

  program.parseAsync(process.argv).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(message)
    process.exit(1)
  })
}
