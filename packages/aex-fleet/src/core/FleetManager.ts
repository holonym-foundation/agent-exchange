import { EventEmitter } from 'node:events'
import { getConfigPath, readConfig, withLockedConfig } from './config.js'
import type { AgentEntry, FleetConfig } from '../types.js'

export interface SelectOptions {
  /** Apply to every registered agent. */
  all?: boolean
  /** Apply only to agents whose tags include this string. */
  tag?: string
  /** Apply only to the named agent (overrides --all / --tag). */
  agent?: string
}

export interface BulkResult<T = unknown> {
  agentId: string
  index: number
  total: number
  ok: boolean
  message?: string
  detail?: T
}

export type BulkFn<T> = (
  agent: AgentEntry
) => Promise<Pick<BulkResult<T>, 'ok' | 'message' | 'detail'>>

/**
 * Events emitted during `applyToEach`:
 *   - `agent:start`  → { agentId, index, total }
 *   - `agent:done`   → BulkResult (ok=true)
 *   - `agent:error`  → BulkResult (ok=false)
 *   - `bulk:done`    → { total, failed, results }
 */
export class FleetManager extends EventEmitter {
  constructor(private readonly configPath: string = getConfigPath()) {
    super()
  }

  read(): FleetConfig {
    return readConfig(this.configPath)
  }

  listAgents(): AgentEntry[] {
    return Object.values(this.read().agents)
  }

  getAgent(agentId: string): AgentEntry | undefined {
    return this.read().agents[agentId]
  }

  getActive(): string | undefined {
    return this.read().activeAgent
  }

  /**
   * Resolve which agent a command should operate on, in priority order:
   *   explicit override → AEX_FLEET_AGENT env → activeAgent in fleet.json
   * Throws if nothing resolves or the resolved id isn't registered.
   */
  resolveAgentId(override?: string): string {
    const id = override ?? process.env.AEX_FLEET_AGENT ?? this.getActive()
    if (!id) {
      throw new Error(
        'No active agent. Use `aex-fleet use <agent-id>` first or set AEX_FLEET_AGENT.'
      )
    }
    if (!this.getAgent(id)) {
      throw new Error(`Unknown agent: ${id}`)
    }
    return id
  }

  /**
   * Select agents to operate on based on flag combinations. Precedence:
   *   --agent (single)  >  --tag (filter)  >  --all  >  active agent (default of 1)
   */
  selectAgents(opts: SelectOptions = {}): AgentEntry[] {
    if (opts.agent) {
      const a = this.getAgent(opts.agent)
      return a ? [a] : []
    }
    const list = this.listAgents()
    if (opts.tag) return list.filter((a) => a.tags.includes(opts.tag!))
    if (opts.all) return list
    const active = this.getActive()
    if (active) {
      const a = this.getAgent(active)
      return a ? [a] : []
    }
    return []
  }

  async setActive(agentId: string): Promise<void> {
    await withLockedConfig((cfg) => {
      if (!cfg.agents[agentId]) {
        throw new Error(`Unknown agent: ${agentId}`)
      }
      cfg.activeAgent = agentId
      return cfg
    }, this.configPath)
  }

  async addAgent(
    input: Omit<AgentEntry, 'createdAt' | 'tags'> & { createdAt?: string; tags?: string[] }
  ): Promise<AgentEntry> {
    const entry: AgentEntry = {
      ...input,
      tags: input.tags ?? [],
      createdAt: input.createdAt ?? new Date().toISOString()
    }
    await withLockedConfig((cfg) => {
      if (cfg.agents[entry.agentId]) {
        throw new Error(`Agent already exists: ${entry.agentId}`)
      }
      cfg.agents[entry.agentId] = entry
      if (!cfg.activeAgent) cfg.activeAgent = entry.agentId
      return cfg
    }, this.configPath)
    return entry
  }

  /**
   * Patch fields on an existing agent. Only the keys present on `patch` are updated; everything
   * else is preserved. Re-validates the merged entry before persisting. Use for retroactively
   * recording the address after a separate signup, or fixing chain/tag mistakes.
   */
  async updateAgent(
    agentId: string,
    patch: Partial<Omit<AgentEntry, 'agentId' | 'createdAt'>>
  ): Promise<AgentEntry> {
    let updated!: AgentEntry
    await withLockedConfig((cfg) => {
      const existing = cfg.agents[agentId]
      if (!existing) throw new Error(`Unknown agent: ${agentId}`)
      updated = { ...existing, ...patch, agentId, createdAt: existing.createdAt }
      cfg.agents[agentId] = updated
      return cfg
    }, this.configPath)
    return updated
  }

  async removeAgent(agentId: string): Promise<void> {
    await withLockedConfig((cfg) => {
      if (!cfg.agents[agentId]) {
        throw new Error(`Unknown agent: ${agentId}`)
      }
      delete cfg.agents[agentId]
      if (cfg.activeAgent === agentId) {
        const remaining = Object.keys(cfg.agents)
        cfg.activeAgent = remaining[0]
      }
      return cfg
    }, this.configPath)
  }

  /**
   * Sequentially run `fn` against each agent, emitting progress events. Continues on failure
   * (continue-and-report). Returns the full result set. 2FA prompts in waap-cli force
   * serialisation upstream — parallelism is not an option here.
   */
  async applyToEach<T = unknown>(
    agents: AgentEntry[],
    fn: BulkFn<T>
  ): Promise<Array<BulkResult<T>>> {
    const results: Array<BulkResult<T>> = []
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]
      this.emit('agent:start', { agentId: agent.agentId, index: i, total: agents.length })
      let event: BulkResult<T>
      try {
        const r = await fn(agent)
        event = {
          agentId: agent.agentId,
          index: i,
          total: agents.length,
          ok: r.ok,
          message: r.message,
          detail: r.detail
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        event = {
          agentId: agent.agentId,
          index: i,
          total: agents.length,
          ok: false,
          message
        }
      }
      results.push(event)
      this.emit(event.ok ? 'agent:done' : 'agent:error', event)
    }
    const failed = results.filter((r) => !r.ok).length
    this.emit('bulk:done', { total: results.length, failed, results })
    return results
  }
}
