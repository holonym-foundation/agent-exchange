import type { FleetManager } from './FleetManager.js'

// Detects strings we should NOT try to resolve against the fleet registry: raw EVM/Sui addresses
// (any 0x-prefixed hex), domain-style ENS names (anything containing a dot). Everything else
// — a plain identifier like `bravo` — is a candidate for agent-id resolution.
function looksLikeRawRecipient(s: string): boolean {
  if (/^0x[0-9a-fA-F]+$/.test(s)) return true
  if (s.includes('.')) return true
  return false
}

interface ResolvedToken {
  /** The new value (or the original if no substitution happened). */
  value: string
  /** The agent-id we resolved from, if any. */
  resolvedFrom?: string
  /** True if substitution happened. */
  substituted: boolean
}

function resolveOne(input: string, fm: FleetManager): ResolvedToken {
  if (looksLikeRawRecipient(input)) return { value: input, substituted: false }
  const agent = fm.getAgent(input)
  if (agent?.address) {
    return { value: agent.address, resolvedFrom: input, substituted: true }
  }
  return { value: input, substituted: false }
}

/**
 * Walk a `waap-cli` argv looking for `--to <value>` / `--to=<value>` (also `--from`) and
 * substitute fleet-registered agent-ids with their stored address. Side-effect-free; returns
 * a new array plus a list of substitutions for caller logging.
 */
export function resolveRecipients(
  args: string[],
  fm: FleetManager
): { args: string[]; substitutions: Array<{ flag: string; from: string; to: string }> } {
  const out = [...args]
  const subs: Array<{ flag: string; from: string; to: string }> = []
  const RESOLVABLE = new Set(['--to', '--from'])

  for (let i = 0; i < out.length; i++) {
    const a = out[i]
    // `--to bravo` form
    if (RESOLVABLE.has(a) && i + 1 < out.length) {
      const r = resolveOne(out[i + 1], fm)
      if (r.substituted) {
        subs.push({ flag: a, from: r.resolvedFrom!, to: r.value })
        out[i + 1] = r.value
      }
      i++
      continue
    }
    // `--to=bravo` form
    for (const flag of RESOLVABLE) {
      const prefix = `${flag}=`
      if (a.startsWith(prefix)) {
        const r = resolveOne(a.slice(prefix.length), fm)
        if (r.substituted) {
          subs.push({ flag, from: r.resolvedFrom!, to: r.value })
          out[i] = `${prefix}${r.value}`
        }
      }
    }
  }
  return { args: out, substitutions: subs }
}
