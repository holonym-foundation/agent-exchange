import { Command } from 'commander'
import pc from 'picocolors'
import { renewAll, type RenewAllResult } from '../core/renewal.js'

/**
 * `aex-fleet renew` — WS-D / #1256 autopay renewal loop.
 *
 * One sweep (default) or a long-running watcher (`--watch`) that, for each autopay-enabled agent
 * whose lease is near expiry, re-buys the next term within the consented cap (signed by the agent's
 * own WaaP wallet). Pauses + notifies on cap-hit / funds / renewal failure — never a silent drop.
 *
 * Cron-friendly: a "every 10 minutes" crontab line running `aex-fleet renew --json` (see README).
 */
export function renewCommand(): Command {
  return new Command('renew')
    .description('Run the autopay renewal loop: re-buy near-expiry leases within the consented cap')
    .option('--watch', 'Run continuously, sweeping on an interval (instead of one shot)')
    .option('--interval <seconds>', 'Watch mode sweep interval in seconds', '300')
    .option('--bin <path>', 'Path to the waap-cli binary (defaults to PATH)')
    .option('--json', 'Emit each sweep result as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ aex-fleet renew                      # one sweep, then exit (use from cron)
  $ aex-fleet renew --watch --interval 600
  $ aex-fleet renew --json | jq '.[] | select(.outcome.status == "paused")'`
    )
    .action(async (opts: { watch?: boolean; interval: string; bin?: string; json?: boolean }) => {
      const intervalMs = Math.max(1, Number(opts.interval)) * 1000

      const sweep = async (): Promise<void> => {
        const results = await renewAll({ ...(opts.bin ? { bin: opts.bin } : {}) })
        report(results, opts.json)
        const paused = results.filter((r) => r.outcome.status === 'paused')
        if (paused.length > 0 && !opts.watch) process.exitCode = 1
      }

      if (!opts.watch) {
        await sweep()
        return
      }

      // Watch mode: sweep on an interval until SIGINT/SIGTERM. Each sweep is independent and
      // continue-and-report, so a single agent's failure never stops the loop.
      let stopping = false
      const stop = (): void => {
        stopping = true
      }
      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)
      if (!opts.json) console.log(pc.dim(`autopay watch: sweeping every ${opts.interval}s (Ctrl-C to stop)`))
      while (!stopping) {
        await sweep()
        if (stopping) break
        await new Promise((r) => setTimeout(r, intervalMs))
      }
      if (!opts.json) console.log(pc.dim('autopay watch stopped'))
    })
}

function report(results: RenewAllResult[], json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(results, null, 2))
    return
  }
  if (results.length === 0) {
    console.log(pc.dim('no autopay-enabled agents'))
    return
  }
  for (const { agentId, outcome } of results) {
    switch (outcome.status) {
      case 'renewed':
        console.log(
          `${pc.green('renewed')} ${pc.bold(agentId)}` +
            (outcome.chargedUsd != null ? ` ($${outcome.chargedUsd.toFixed(2)})` : '') +
            (outcome.expiresAt ? ` → expires ${outcome.expiresAt}` : '')
        )
        break
      case 'paused':
        console.log(`${pc.yellow('PAUSED')} ${pc.bold(agentId)} — ${outcome.reason}`)
        break
      case 'not-due':
        console.log(pc.dim(`not-due ${agentId} (expires ${outcome.expiresAt})`))
        break
      case 'skipped':
        console.log(pc.dim(`skipped ${agentId} (${outcome.reason})`))
        break
    }
  }
}
