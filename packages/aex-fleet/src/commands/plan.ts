import { Command } from 'commander'
import { writeFileSync } from 'node:fs'
import pc from 'picocolors'
import { warnBlastRadius } from '../core/blast-radius.js'
import { FleetManager, type SelectOptions } from '../core/FleetManager.js'
import type { Plan } from '../core/plan.js'

interface PlanSetOpts extends SelectOptions {
  dailyLimit?: string
  out?: string
}

export function planCommand(): Command {
  const plan = new Command('plan').description(
    'Build a machine-readable plan describing what a bulk op would do (no side effects)'
  )

  const policy = plan.command('policy').description('Plan a policy change')

  policy
    .command('set')
    .description('Plan a daily-limit policy change across selected agents')
    .option('--all', 'Apply to every registered agent')
    .option('--tag <tag>', 'Apply only to agents with this tag')
    .option('--agent <id>', 'Apply only to this agent')
    .requiredOption('--daily-limit <usd>', 'Daily spend limit in USD')
    .option('--out <path>', 'Write plan JSON to file (default: stdout)')
    .addHelpText(
      'after',
      `
Examples:
  $ aex-fleet plan policy set --tag yield --daily-limit 50
  $ aex-fleet plan policy set --all --daily-limit 100 --out ./tighten.plan.json
  $ aex-fleet plan policy set --all --daily-limit 50 | aex-fleet apply --json`
    )
    .action(async (opts: PlanSetOpts) => {
      const fm = new FleetManager()
      const agents = fm.selectAgents(opts)
      if (agents.length === 0) {
        console.error(pc.red('No agents matched the selector — nothing to plan.'))
        process.exit(2)
      }
      const planObj: Plan = {
        version: 1,
        createdAt: new Date().toISOString(),
        ops: agents.map((a) => ({
          op: 'policy.set' as const,
          agentId: a.agentId,
          args: { dailyLimit: opts.dailyLimit! }
        }))
      }
      warnBlastRadius(planObj.ops.length, 'plan', `policy.set --daily-limit ${opts.dailyLimit}`)
      const json = JSON.stringify(planObj, null, 2)
      if (opts.out) {
        writeFileSync(opts.out, json)
        console.error(pc.dim(`wrote ${planObj.ops.length} op(s) to ${opts.out}`))
      } else {
        process.stdout.write(json + '\n')
      }
    })

  return plan
}
