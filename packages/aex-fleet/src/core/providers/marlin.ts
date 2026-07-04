import { execa } from 'execa'
import pc from 'picocolors'
import type {
  AgentStatus,
  ComputeProvider,
  DeployResult,
  DeploySpec,
  LogOpts
} from './types.js'

/**
 * MarlinProvider — deploys the agent into a TEE-sealed enclave via Mysten **Nautilus** (AWS Nitro
 * Enclave) + the **Marlin** marketplace, which abstracts AWS account management: you hand it a
 * docker image and it provisions the enclave. The high-security/compliance tier, kept **parallel**
 * to Arkhai (general compute) — the user picks the target; we don't position them against each other.
 *
 * Partnership is in flight (intro pending; pricing unknown — see
 * internal-docs products/waap/prd/agent-deployment-infrastructure.md), so the concrete CLI/API is
 * not finalized. This wraps a `marlin` CLI (bin configurable) on a docker-image deploy model with
 * the same shape as ArkhaiProvider; `--dry-run` rehearses the plan until the real surface lands.
 */

export interface MarlinOptions {
  /** Container image ref to deploy (built from the agent template Dockerfile). */
  image?: string
  /** Enclave size / instance class. */
  instance?: string
  /** Lease duration in hours. */
  durationHours?: number
  /** Override the marlin binary (defaults to `marlin`). */
  bin?: string
  /** Require TEE attestation verification before marking ready. */
  attest?: boolean
}

const DEFAULTS = { durationHours: 1, instance: 'nitro.small', attest: true }

export class MarlinProvider implements ComputeProvider {
  readonly name = 'marlin-tee' as const
  private readonly opts: MarlinOptions

  constructor(opts: MarlinOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts }
  }

  private get bin(): string {
    return this.opts.bin ?? 'marlin'
  }

  async preflight(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await execa(this.bin, ['--version'], { reject: false })
      return { ok: true }
    } catch {
      return {
        ok: false,
        detail: `Marlin \`${this.bin}\` CLI not found. Marlin/Nautilus integration is partnership-pending — run with --dry-run for now.`
      }
    }
  }

  buildDeployArgs(image: string): string[] {
    const o = this.opts
    const args = ['deploy', '--image', image, '--instance', o.instance ?? DEFAULTS.instance]
    args.push('--duration-hours', String(o.durationHours ?? DEFAULTS.durationHours))
    if (o.attest) args.push('--attest')
    return args
  }

  async deploy(spec: DeploySpec): Promise<DeployResult> {
    const image = this.opts.image ?? `aex/${spec.agentId}:latest`
    const args = this.buildDeployArgs(image)
    const notes: string[] = []

    if (spec.dryRun) {
      return {
        provider: this.name,
        ref: 'dry-run-enclave',
        host: '<enclave-endpoint>',
        deployedAt: new Date().toISOString(),
        notes: [
          `${pc.bold('1.')} build + push image ${image} (from template Dockerfile)`,
          `${pc.bold('2.')} ${this.bin} ${args.join(' ')}`,
          `${pc.bold('3.')} await enclave ready + verify TEE attestation`,
          `${pc.bold('4.')} inject WaaP session as a sealed secret`,
          `${pc.dim('Marlin/Nautilus partnership pending — surface not finalized')}`
        ]
      }
    }

    const { stdout } = await execa(this.bin, args)
    const ref = parseEnclaveRef(stdout)
    notes.push(`enclave ${ref.enclaveId} (${ref.endpoint})`)
    return {
      provider: this.name,
      ref: ref.enclaveId,
      host: ref.endpoint,
      deployedAt: new Date().toISOString(),
      notes
    }
  }

  async stop(ref: string): Promise<void> {
    await execa(this.bin, ['terminate', ref], { reject: false })
  }

  async getStatus(ref: string): Promise<AgentStatus> {
    const { exitCode, stdout } = await execa(this.bin, ['status', ref], { reject: false })
    if (exitCode !== 0) return { state: 'unknown', detail: `enclave ${ref} status unavailable` }
    if (/\b(running|ready|attested)\b/i.test(stdout)) return { state: 'running' }
    if (/\b(terminated|stopped|failed)\b/i.test(stdout)) return { state: 'stopped' }
    return { state: 'unknown' }
  }

  async getLogs(_ref: string, _opts?: LogOpts): Promise<string> {
    return ''
  }
}

/** Parse a `marlin deploy` result into an enclave id + endpoint. Tolerant of text or JSON. */
export function parseEnclaveRef(stdout: string): { enclaveId: string; endpoint: string } {
  try {
    const j = JSON.parse(stdout) as Record<string, unknown>
    const enclaveId = str(j.enclave_id ?? j.enclaveId ?? j.id)
    const endpoint = str(j.endpoint ?? j.url ?? j.host)
    if (enclaveId) return { enclaveId, endpoint }
  } catch {
    /* text below */
  }
  const id = stdout.match(/enclave[_\s-]?id["':=\s]+([\w-]+)/i)?.[1]
  const ep = stdout.match(/https?:\/\/\S+/)?.[0]
  if (id) return { enclaveId: id, endpoint: ep ?? '' }
  throw new Error(`Could not parse enclave ref from marlin output:\n${stdout.slice(0, 400)}`)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}
