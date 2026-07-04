import { Command } from 'commander'
import pc from 'picocolors'
import { warnBlastRadius } from '../core/blast-radius.js'
import { FleetManager, type BulkResult, type SelectOptions } from '../core/FleetManager.js'
import { runWaap } from '../core/waap-runner.js'

interface BaseOpts extends SelectOptions {
  json?: boolean
  bin?: string
  dryRun?: boolean
}

interface SetOpts extends BaseOpts {
  dailyLimit?: string
}

const SELECT_FLAGS = (cmd: Command): Command =>
  cmd
    .option('--all', 'Apply to every registered agent')
    .option('--tag <tag>', 'Apply only to agents with this tag')
    .option('--agent <id>', 'Apply only to this agent (overrides --all / --tag)')
    .option('--bin <path>', 'Path to the waap-cli binary (defaults to PATH)')

export function policyCommand(): Command {
  const policy = new Command('policy').description('Inspect or set wallet policy per agent or in bulk')

  SELECT_FLAGS(
    policy
      .command('get')
      .description('Run `waap-cli policy get` against each selected agent')
      .option('--json', 'Emit results as JSON')
      .addHelpText(
        'after',
        `
Examples:
  $ aex-fleet policy get --all
  $ aex-fleet policy get --tag yield --json`
      )
      .action(async (opts: BaseOpts) => {
        await runBulk(opts, ['policy', 'get'])
      })
  )

  SELECT_FLAGS(
    policy
      .command('set')
      .description('Run `waap-cli policy set` against each selected agent')
      .requiredOption('--daily-limit <usd>', 'Daily spend limit in USD')
      .option('--json', 'Emit results as JSON')
      .option('--dry-run', 'Show what would change without invoking waap-cli')
      .addHelpText(
        'after',
        `
Examples:
  $ aex-fleet policy set --all --daily-limit 50
  $ aex-fleet policy set --tag yield --daily-limit 100 --dry-run
  $ aex-fleet policy set --tag yield --daily-limit 100 --json | jq '.failed'`
      )
      .action(async (opts: SetOpts) => {
        if (!opts.dailyLimit) {
          throw new Error('--daily-limit is required for `policy set`')
        }
        if (opts.dryRun) {
          await runDryRun(opts, 'policy.set', { dailyLimit: opts.dailyLimit })
          return
        }
        await runBulk(opts, ['policy', 'set', '--daily-spend-limit', opts.dailyLimit])
      })
  )

  return policy
}

async function runDryRun(
  opts: BaseOpts,
  op: string,
  args: Record<string, string>
): Promise<void> {
  const fm = new FleetManager()
  const agents = fm.selectAgents(opts)
  if (agents.length === 0) {
    console.error(pc.red(`No agents matched (${describeSelectorMiss(opts)}).`))
    process.exit(2)
  }
  const argSummary = Object.entries(args)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  warnBlastRadius(agents.length, 'dry-run', `${op} (${argSummary})`)
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          op,
          args,
          targets: agents.map((a) => a.agentId)
        },
        null,
        2
      )
    )
    return
  }
  console.log(pc.dim(`(dry-run) would ${op} (${argSummary}) on ${agents.length} agent(s):`))
  for (const a of agents) console.log(`  ${a.agentId}`)
}

interface PolicyDetail {
  exitCode: number
  stdout: string
  stderr: string
}

async function runBulk(opts: BaseOpts, waapArgs: string[]): Promise<void> {
  const fm = new FleetManager()
  const agents = fm.selectAgents(opts)
  if (agents.length === 0) {
    const why = describeSelectorMiss(opts)
    console.error(pc.red(`No agents matched (${why}).`))
    process.exit(2)
  }
  warnBlastRadius(agents.length, 'bulk op', waapArgs.join(' '))

  // Incremental progress for humans; results table after.
  fm.on('agent:start', (e: BulkResult) => {
    if (opts.json) return
    process.stdout.write(pc.dim(`[${e.index + 1}/${e.total}] ${e.agentId} … `))
  })
  fm.on('agent:done', (e: BulkResult) => {
    if (opts.json) return
    console.log(pc.green('OK'))
  })
  fm.on('agent:error', (e: BulkResult) => {
    if (opts.json) return
    console.log(pc.red(`FAIL — ${e.message ?? 'unknown'}`))
  })

  const results = await fm.applyToEach<PolicyDetail>(agents, async (agent) => {
    const r = await runWaap({ agentId: agent.agentId, args: waapArgs, bin: opts.bin })
    const ok = r.exitCode === 0
    const firstLine = (r.stderr || r.stdout || `exit ${r.exitCode}`).trim().split('\n')[0] ?? ''
    return {
      ok,
      message: ok ? undefined : firstLine,
      detail: { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
    }
  })

  const failed = results.filter((r) => !r.ok).length
  if (opts.json) {
    console.log(JSON.stringify({ total: results.length, failed, results }, null, 2))
  } else {
    console.log()
    console.log(renderSummary(results))
  }
  if (failed > 0) process.exit(1)
}

function describeSelectorMiss(opts: SelectOptions): string {
  if (opts.agent) return `no agent named '${opts.agent}'`
  if (opts.tag) return `no agents tagged '${opts.tag}'`
  if (opts.all) return 'fleet is empty'
  return 'no active agent — use `aex-fleet use <id>` or `--all` / `--tag` / `--agent`'
}

function renderSummary(results: Array<BulkResult<PolicyDetail>>): string {
  const failed = results.filter((r) => !r.ok).length
  if (failed === 0) return pc.green(`${results.length} / ${results.length} succeeded`)
  return pc.yellow(`${results.length - failed} / ${results.length} succeeded, ${failed} failed`)
}
