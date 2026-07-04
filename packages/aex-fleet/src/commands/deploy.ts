import { Command } from 'commander'
import pc from 'picocolors'
import { FleetManager } from '../core/FleetManager.js'
import { getProvider, type DeploySpec, type ProviderName } from '../core/providers/index.js'
import { sandboxDir } from '../core/waap-runner.js'

/**
 * `aex-fleet deploy` — ship an agent onto a compute backend through the provider abstraction.
 * Default target is Arkhai (on-chain VM leasing); `--target local` runs it as a local process so
 * the whole flow is demoable without external compute. Records the deployment on the fleet entry.
 *
 * Design ref: internal-docs products/waap/prd/aex/deployment.md (#941, #1219).
 */
export function deployCommand(): Command {
  return new Command('deploy')
    .description('Deploy an agent onto a compute backend (Arkhai VM lease, or local)')
    .argument('[agent-id]', 'Agent to deploy (defaults to the active agent)')
    .requiredOption('-s, --source <path>', 'Path to the scaffolded agent project to ship')
    .option('-t, --target <provider>', 'Compute target: arkhai | marlin | local', 'arkhai')
    .option('--env <KEY=VAL>', 'Extra env for the agent (repeatable)', collectEnv, {})
    .option('--gpu-model <model>', 'Arkhai: GPU model filter (e.g. H200; omit for CPU-only)')
    .option('--vcpu-min <n>', 'Arkhai: minimum vCPUs', toInt)
    .option('--ram-gb-min <n>', 'Arkhai: minimum RAM (GB)', toInt)
    .option('--duration-hours <n>', 'Arkhai: lease duration in hours', toInt)
    .option('--max-price <usd>', 'Arkhai: max price per hour (human units)', toNum)
    .option('--wallet-mode <mode>', 'Arkhai: waap | buyer-toml (waap needs the signer hook)', 'buyer-toml')
    .option('--ssh-identity <path>', 'Arkhai: SSH identity file for the leased VM')
    .option('--dry-run', 'Print the deploy plan without provisioning or charging')
    .option('--json', 'Emit the deploy result as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ aex-fleet deploy alpha --source ./alpha --target arkhai --gpu-model H200 --duration-hours 2 --dry-run
  $ aex-fleet deploy beta  --source ./beta  --target local
  $ aex-fleet deploy --source ./alpha --target arkhai --vcpu-min 2 --ram-gb-min 4 --max-price 1`
    )
    .action(async (agentIdArg: string | undefined, opts: DeployOptions) => {
      const fm = new FleetManager()
      const agentId = fm.resolveAgentId(agentIdArg)
      const agent = fm.getAgent(agentId)!
      const target = opts.target as ProviderName

      // Lease term: explicit --duration-hours wins, else AEX_LEASE_HOURS (the buyer-flow env the
      // autopay renewal loop also reads), else the provider default.
      const envLeaseHours = parseLeaseHoursEnv(process.env.AEX_LEASE_HOURS)
      const durationHours = opts.durationHours ?? envLeaseHours

      const provider = getProvider(target, {
        gpuModel: opts.gpuModel,
        vcpuMin: opts.vcpuMin,
        ramGbMin: opts.ramGbMin,
        durationHours,
        maxPrice: opts.maxPrice,
        walletMode: opts.walletMode,
        sshIdentity: opts.sshIdentity
      })

      if (!opts.dryRun) {
        const pf = await provider.preflight()
        if (!pf.ok) throw new Error(pf.detail ?? `${target} preflight failed`)
      }

      // Inject the agent's WaaP wallet so the deployed agent signs through it. For the local target
      // we also point HOME at the fleet sandbox so waap-cli finds this agent's session. Shipping the
      // session to a remote VM (Arkhai) is the provider secrets-injection seam — see deployment.md.
      const env: Record<string, string> = { ...opts.env }
      if (agent.address) env.WAAP_AGENT_ADDRESS = agent.address
      if (target === 'local') env.HOME = sandboxDir(agentId)
      if (process.env.AEX_INGEST_URL) env.AEX_INGEST_URL = process.env.AEX_INGEST_URL
      if (process.env.AEX_INGEST_KEY) env.AEX_INGEST_KEY = process.env.AEX_INGEST_KEY

      const spec: DeploySpec = {
        agentId,
        agent,
        source: opts.source,
        env,
        telemetry: process.env.AEX_INGEST_URL
          ? { ingestUrl: process.env.AEX_INGEST_URL, apiKey: process.env.AEX_INGEST_KEY ?? '' }
          : undefined,
        dryRun: opts.dryRun
      }

      const result = await provider.deploy(spec)

      if (!opts.dryRun) {
        const leaseHours = result.leaseHours ?? durationHours
        const leaseExpiresAt =
          leaseHours != null
            ? new Date(Date.parse(result.deployedAt) + leaseHours * 3_600_000).toISOString()
            : undefined
        await fm.updateAgent(agentId, {
          deployment: {
            provider: result.provider,
            ref: result.ref,
            host: result.host,
            escrowUid: result.escrowUid,
            status: 'running',
            deployedAt: result.deployedAt,
            ...(leaseHours != null ? { leaseHours } : {}),
            ...(leaseExpiresAt != null ? { leaseExpiresAt } : {}),
            ...(result.priceUsd != null ? { priceUsdMonth: result.priceUsd } : {})
          }
        })
      }

      if (opts.json) {
        console.log(JSON.stringify({ agentId, dryRun: !!opts.dryRun, result }, null, 2))
        return
      }

      const head = opts.dryRun ? pc.dim('(dry-run) ') : ''
      console.log(`${head}${pc.green('deploy')} ${pc.bold(agentId)} → ${pc.cyan(target)}`)
      if (result.host) console.log(`  host:   ${result.host}`)
      if (result.escrowUid) console.log(`  escrow: ${result.escrowUid}`)
      console.log(`  ref:    ${result.ref}`)
      for (const n of result.notes ?? []) console.log(pc.dim(`  • ${n}`))
      if (!opts.dryRun) console.log(pc.dim(`  recorded on fleet entry (status=running)`))
    })
}

interface DeployOptions {
  source: string
  target: string
  env: Record<string, string>
  gpuModel?: string
  vcpuMin?: number
  ramGbMin?: number
  durationHours?: number
  maxPrice?: number
  walletMode?: 'waap' | 'buyer-toml'
  sshIdentity?: string
  dryRun?: boolean
  json?: boolean
}

function collectEnv(kv: string, acc: Record<string, string>): Record<string, string> {
  const eq = kv.indexOf('=')
  if (eq === -1) throw new Error(`--env expects KEY=VAL, got: ${kv}`)
  acc[kv.slice(0, eq)] = kv.slice(eq + 1)
  return acc
}

function toInt(v: string): number {
  const n = Number.parseInt(v, 10)
  if (Number.isNaN(n)) throw new Error(`expected an integer, got: ${v}`)
  return n
}

function toNum(v: string): number {
  const n = Number(v)
  if (Number.isNaN(n)) throw new Error(`expected a number, got: ${v}`)
  return n
}

/** Parse AEX_LEASE_HOURS into a positive number, or undefined if unset/invalid. */
function parseLeaseHoursEnv(raw: string | undefined): number | undefined {
  if (raw == null || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
}
