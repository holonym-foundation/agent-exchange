import { Command } from 'commander'
import pc from 'picocolors'
import { disableAutopay, enableAutopay, pauseAutopay, resumeAutopay } from '../core/autopay.js'
import { FleetManager, type BulkResult } from '../core/FleetManager.js'
import { warnBlastRadius } from '../core/blast-radius.js'
import type { AutopayState } from '../types.js'

interface SelectOpts {
  all?: boolean
  tag?: string
  agent?: string
  json?: boolean
  bin?: string
}

interface EnableOpts extends SelectOpts {
  dailyLimit: string
  perTxLimit?: string
  mode: AutopayState['mode']
  permissionToken?: string
  renewBefore?: string
}

const SELECT_FLAGS = (cmd: Command): Command =>
  cmd
    .option('--all', 'Apply to every registered agent')
    .option('--tag <tag>', 'Apply only to agents with this tag')
    .option('--agent <id>', 'Apply only to this agent (overrides --all / --tag)')
    .option('--bin <path>', 'Path to the waap-cli binary (defaults to PATH)')
    .option('--json', 'Emit results as JSON')

/**
 * `aex-fleet autopay` — WS-D / #1256 buyer autopay (Model 2).
 *
 * Arms the agent's own WaaP wallet to auto-buy + auto-renew its compute lease without a human
 * approving each tx, bounded by a daily spend cap the user consents to here. `enable` pushes the
 * cap via `waap-cli policy set --daily-spend-limit` and (for mode=no-2fa) disables the per-tx 2FA
 * prompt so the bounded session signs unattended. The actual renewals run via `aex-fleet renew`.
 */
export function autopayCommand(): Command {
  const autopay = new Command('autopay').description(
    'Arm/disarm policy-bounded buyer autopay (auto-buy + auto-renew compute lease, #1256)'
  )

  SELECT_FLAGS(
    autopay
      .command('enable')
      .description('Arm autopay: push the daily spend cap and configure non-interactive signing')
      .requiredOption('--daily-limit <usd>', 'Daily spend cap in USD (the consented bound)')
      .option('--per-tx-limit <usd>', 'Per-renewal cap in USD; a costlier lease pauses instead')
      .option(
        '--mode <mode>',
        'How the bounded session signs: no-2fa | permission-token',
        'no-2fa'
      )
      .option(
        '--permission-token <encoded>',
        'Pre-minted waap-cli --privilege token (required for mode=permission-token)'
      )
      .option('--renew-before <minutes>', 'Renew when within N minutes of expiry', '30')
      .addHelpText(
        'after',
        `
Modes:
  no-2fa            Disable 2FA for the wallet; the waap-cli daily-spend-limit is the only bound.
                    The available in-CLI non-interactive path (waap-cli has no privilege-mint cmd).
  permission-token  Keep 2FA on; supply a pre-minted --privilege token bypassed per renewal tx.

Examples:
  $ aex-fleet autopay enable --agent alpha --daily-limit 10 --per-tx-limit 4
  $ aex-fleet autopay enable --all --daily-limit 10 --mode no-2fa`
      )
      .action(async (opts: EnableOpts) => {
        if (opts.mode !== 'no-2fa' && opts.mode !== 'permission-token') {
          throw new Error(`--mode must be no-2fa or permission-token, got: ${opts.mode}`)
        }
        const dailyLimitUsd = Number(opts.dailyLimit)
        if (!Number.isFinite(dailyLimitUsd) || dailyLimitUsd <= 0) {
          throw new Error('--daily-limit must be a positive number')
        }
        await runOverSelection(opts, 'autopay enable', async (fm, agentId) =>
          enableAutopay(
            agentId,
            {
              dailyLimitUsd,
              ...(opts.perTxLimit ? { perTxLimitUsd: Number(opts.perTxLimit) } : {}),
              mode: opts.mode,
              ...(opts.permissionToken ? { permissionToken: opts.permissionToken } : {}),
              ...(opts.renewBefore ? { renewBeforeMinutes: Number(opts.renewBefore) } : {}),
              ...(opts.bin ? { bin: opts.bin } : {})
            },
            fm
          )
        )
      })
  )

  SELECT_FLAGS(
    autopay
      .command('disable')
      .description('Disarm autopay (stops renewals; leaves wallet policy as-is)')
      .action(async (opts: SelectOpts) => {
        await runOverSelection(opts, 'autopay disable', async (fm, agentId) => {
          await disableAutopay(agentId, fm)
          return { ok: true, detail: 'autopay disabled' }
        })
      })
  )

  SELECT_FLAGS(
    autopay
      .command('pause')
      .description('Pause autopay (renewals skip this agent until resumed)')
      .requiredOption('--reason <text>', 'Why it is paused (shown in status / notifications)')
      .action(async (opts: SelectOpts & { reason: string }) => {
        await runOverSelection(opts, 'autopay pause', async (fm, agentId) => {
          await pauseAutopay(agentId, opts.reason, fm)
          return { ok: true, detail: `paused: ${opts.reason}` }
        })
      })
  )

  SELECT_FLAGS(
    autopay
      .command('resume')
      .description('Clear a pause and re-arm renewals')
      .action(async (opts: SelectOpts) => {
        await runOverSelection(opts, 'autopay resume', async (fm, agentId) => {
          await resumeAutopay(agentId, fm)
          return { ok: true, detail: 'resumed' }
        })
      })
  )

  autopay
    .command('status')
    .description('Show autopay state per agent')
    .option('--all', 'Show every agent (default: all with autopay configured)')
    .option('--agent <id>', 'Show one agent')
    .option('--json', 'Emit as JSON')
    .action((opts: SelectOpts) => {
      const fm = new FleetManager()
      const agents = (opts.agent ? [fm.getAgent(opts.agent)].filter(Boolean) : fm.listAgents()) as ReturnType<
        FleetManager['listAgents']
      >
      const rows = agents
        .filter((a) => opts.all || opts.agent || a.autopay)
        .map((a) => ({
          agentId: a.agentId,
          enabled: a.autopay?.enabled ?? false,
          dailyLimitUsd: a.autopay?.dailyLimitUsd,
          mode: a.autopay?.mode,
          spentTodayUsd: a.autopay?.spentTodayUsd,
          leaseExpiresAt: a.deployment?.leaseExpiresAt,
          paused: a.autopay?.pausedReason
        }))
      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2))
        return
      }
      if (rows.length === 0) {
        console.log(pc.dim('no agents with autopay configured'))
        return
      }
      for (const r of rows) {
        const state = r.paused
          ? pc.yellow(`PAUSED (${r.paused})`)
          : r.enabled
            ? pc.green('on')
            : pc.dim('off')
        const cap = r.dailyLimitUsd != null ? `$${r.dailyLimitUsd}/day` : '—'
        const spent = r.spentTodayUsd != null ? ` spent $${r.spentTodayUsd.toFixed(2)}` : ''
        console.log(
          `${pc.bold(r.agentId)}  ${state}  ${cap}  mode=${r.mode ?? '—'}${spent}` +
            (r.leaseExpiresAt ? `  expires ${r.leaseExpiresAt}` : '')
        )
      }
    })

  return autopay
}

type ActionResult = { ok: boolean; detail: string }

/** Resolve the agent selection and run `fn` over each, with progress + JSON + exit-code handling. */
async function runOverSelection(
  opts: SelectOpts,
  op: string,
  fn: (fm: FleetManager, agentId: string) => Promise<ActionResult>
): Promise<void> {
  const fm = new FleetManager()
  const agents = fm.selectAgents(opts)
  if (agents.length === 0) {
    console.error(pc.red('No agents matched the selector.'))
    process.exit(2)
  }
  warnBlastRadius(agents.length, 'autopay', op)

  const results: Array<BulkResult<ActionResult>> = []
  for (let i = 0; i < agents.length; i++) {
    const agentId = agents[i].agentId
    if (!opts.json) process.stdout.write(pc.dim(`[${i + 1}/${agents.length}] ${agentId} … `))
    try {
      const r = await fn(fm, agentId)
      results.push({ agentId, index: i, total: agents.length, ok: r.ok, message: r.detail })
      if (!opts.json) console.log(r.ok ? pc.green(r.detail) : pc.red(`FAIL — ${r.detail}`))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({ agentId, index: i, total: agents.length, ok: false, message })
      if (!opts.json) console.log(pc.red(`FAIL — ${message}`))
    }
  }
  const failed = results.filter((r) => !r.ok).length
  if (opts.json) console.log(JSON.stringify({ op, total: results.length, failed, results }, null, 2))
  if (failed > 0) process.exit(1)
}
