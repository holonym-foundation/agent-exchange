import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import pc from 'picocolors'
import { warnBlastRadius } from '../core/blast-radius.js'
import { FleetManager, type BulkResult } from '../core/FleetManager.js'
import { describeOp, type Op, PlanSchema } from '../core/plan.js'
import { runWaap } from '../core/waap-runner.js'

interface ApplyOpts {
  plan?: string
  json?: boolean
  bin?: string
  yes?: boolean
}

interface OpDetail {
  exitCode: number
  stdout: string
  stderr: string
}

export function applyCommand(): Command {
  return new Command('apply')
    .description('Execute a plan produced by `aex-fleet plan`')
    .option('--plan <path>', 'Read plan from file (default: stdin)')
    .option('--bin <path>', 'Path to the waap-cli binary (defaults to PATH)')
    .option('--json', 'Emit results as JSON')
    .option('-y, --yes', 'Skip the confirmation prompt (required for non-interactive use)')
    .addHelpText(
      'after',
      `
Examples:
  $ aex-fleet plan policy set --all --daily-limit 50 | aex-fleet apply --yes
  $ aex-fleet apply --plan ./tighten.plan.json --yes --json`
    )
    .action(async (opts: ApplyOpts) => {
      const raw = opts.plan ? readFileSync(opts.plan, 'utf8') : await readStdin()
      const plan = PlanSchema.parse(JSON.parse(raw))
      if (plan.ops.length === 0) {
        console.error(pc.yellow('Plan contains no ops — nothing to apply.'))
        return
      }
      warnBlastRadius(plan.ops.length, 'apply')
      if (!opts.yes && !opts.json) {
        console.error(pc.bold('Plan:'))
        for (const op of plan.ops) console.error('  ' + describeOp(op))
        console.error()
        console.error(pc.yellow('Re-run with --yes to apply, or pipe through `--json` for automation.'))
        process.exit(1)
      }

      const fm = new FleetManager()
      const results: Array<BulkResult<OpDetail>> = []

      for (let i = 0; i < plan.ops.length; i++) {
        const op = plan.ops[i]
        const meta = { agentId: op.agentId, index: i, total: plan.ops.length }
        fm.emit('agent:start', meta)
        if (!opts.json) {
          process.stdout.write(pc.dim(`[${i + 1}/${plan.ops.length}] ${describeOp(op)} … `))
        }

        let event: BulkResult<OpDetail>
        try {
          if (!fm.getAgent(op.agentId)) {
            event = { ...meta, ok: false, message: `unknown agent: ${op.agentId}` }
          } else {
            const r = await executeOp(op, opts.bin)
            event = { ...meta, ...r }
          }
        } catch (err) {
          event = {
            ...meta,
            ok: false,
            message: err instanceof Error ? err.message : String(err)
          }
        }
        results.push(event)
        fm.emit(event.ok ? 'agent:done' : 'agent:error', event)
        if (!opts.json) {
          console.log(event.ok ? pc.green('OK') : pc.red(`FAIL — ${event.message ?? 'unknown'}`))
        }
      }
      const failed = results.filter((r) => !r.ok).length
      fm.emit('bulk:done', { total: results.length, failed, results })

      if (opts.json) {
        console.log(JSON.stringify({ total: results.length, failed, results }, null, 2))
      } else {
        console.log()
        console.log(
          failed === 0
            ? pc.green(`${results.length} / ${results.length} succeeded`)
            : pc.yellow(`${results.length - failed} / ${results.length} succeeded, ${failed} failed`)
        )
      }
      if (failed > 0) process.exit(1)
    })
}

async function executeOp(
  op: Op,
  bin?: string
): Promise<{ ok: boolean; message?: string; detail: OpDetail }> {
  switch (op.op) {
    case 'policy.set': {
      const r = await runWaap({
        agentId: op.agentId,
        args: ['policy', 'set', '--daily-spend-limit', op.args.dailyLimit],
        bin
      })
      const ok = r.exitCode === 0
      const firstLine = (r.stderr || r.stdout || `exit ${r.exitCode}`).trim().split('\n')[0] ?? ''
      return {
        ok,
        message: ok ? undefined : firstLine,
        detail: { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
      }
    }
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error('No --plan path provided and stdin is a TTY (no piped plan).')
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
