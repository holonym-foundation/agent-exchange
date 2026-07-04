import { ArkhaiProvider, type ArkhaiOptions } from './arkhai.js'
import { LocalProvider } from './local.js'
import { MarlinProvider, type MarlinOptions } from './marlin.js'
import type { ComputeProvider, ProviderName } from './types.js'

export * from './types.js'
export { ArkhaiProvider } from './arkhai.js'
export { LocalProvider } from './local.js'
export { MarlinProvider } from './marlin.js'

export const PROVIDER_NAMES: ProviderName[] = ['arkhai', 'marlin-tee', 'local', 'hetzner-systemd']

/**
 * Resolve a compute provider by name. Arkhai (general compute) and Marlin (TEE) are parallel peers.
 * `hetzner-systemd` is the existing manual deploy.sh path and isn't wrapped yet — it throws with a
 * pointer rather than pretending to exist.
 */
export function getProvider(name: string, options: Record<string, unknown> = {}): ComputeProvider {
  switch (name) {
    case 'arkhai':
      return new ArkhaiProvider(options as ArkhaiOptions)
    case 'marlin':
    case 'marlin-tee':
      return new MarlinProvider(options as MarlinOptions)
    case 'local':
      return new LocalProvider()
    case 'hetzner-systemd':
      throw new Error(
        'hetzner-systemd provider not wrapped yet — use the per-agent deploy.sh under deployments/ for now.'
      )
    default:
      throw new Error(`Unknown deploy target: ${name}. Known: ${PROVIDER_NAMES.join(', ')}`)
  }
}
