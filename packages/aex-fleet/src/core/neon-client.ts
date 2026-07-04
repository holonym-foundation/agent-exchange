import pg from 'pg'

const { Pool } = pg
type PgPool = pg.Pool

// undefined = not yet attempted; null = no DSN, telemetry disabled.
let cachedPool: PgPool | null | undefined

function readDsn(): string | undefined {
  // Prefer the explicit aex-fleet read-only DSN; fall back to DATABASE_URL for parity with the
  // dashboards (so operators who already have it configured don't need to set a second var).
  return process.env.AEX_FLEET_NEON_DSN_RO ?? process.env.DATABASE_URL
}

export function getNeonPool(): PgPool | null {
  if (cachedPool !== undefined) return cachedPool
  const dsn = readDsn()
  if (!dsn) {
    cachedPool = null
    return null
  }
  cachedPool = new Pool({
    connectionString: dsn,
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: { rejectUnauthorized: false }
  })
  return cachedPool
}

export async function closeNeonPool(): Promise<void> {
  if (cachedPool) {
    const p = cachedPool
    cachedPool = undefined
    await p.end()
  }
}

export interface AgentStatusRow {
  agentId: string
  lastBalance: number | null
  lastBalanceTs: string | null
  lastEventTs: string | null
  errorsLast24h: number
}

function asIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

/**
 * Three aggregate queries against agent_balance_snapshots + agent_events, one row per requested
 * agent. Agents with no telemetry return null fields (not omitted). Safe when pool is null —
 * returns zero-filled rows so callers can render gracefully.
 */
export async function fetchFleetStatus(agentIds: string[]): Promise<AgentStatusRow[]> {
  const empty = agentIds.map(
    (id): AgentStatusRow => ({
      agentId: id,
      lastBalance: null,
      lastBalanceTs: null,
      lastEventTs: null,
      errorsLast24h: 0
    })
  )
  const pool = getNeonPool()
  if (!pool || agentIds.length === 0) return empty

  const balancesQ = `
    SELECT DISTINCT ON (agent_id) agent_id, ts, balance
      FROM agent_balance_snapshots
     WHERE agent_id = ANY($1::text[])
     ORDER BY agent_id, ts DESC`
  const eventsQ = `
    SELECT agent_id, MAX(ts) AS last_ts
      FROM agent_events
     WHERE agent_id = ANY($1::text[])
     GROUP BY agent_id`
  const errorsQ = `
    SELECT agent_id, COUNT(*)::int AS n
      FROM agent_events
     WHERE agent_id = ANY($1::text[])
       AND level = 'error'
       AND ts > now() - interval '24 hours'
     GROUP BY agent_id`

  const [balRes, evtRes, errRes] = await Promise.all([
    pool.query(balancesQ, [agentIds]),
    pool.query(eventsQ, [agentIds]),
    pool.query(errorsQ, [agentIds])
  ])

  const balByAgent = new Map<string, { ts: string; balance: number }>()
  for (const row of balRes.rows) {
    balByAgent.set(row.agent_id, { ts: asIso(row.ts), balance: Number(row.balance) })
  }
  const evtByAgent = new Map<string, string>()
  for (const row of evtRes.rows) evtByAgent.set(row.agent_id, asIso(row.last_ts))
  const errByAgent = new Map<string, number>()
  for (const row of errRes.rows) errByAgent.set(row.agent_id, Number(row.n))

  return agentIds.map(
    (id): AgentStatusRow => ({
      agentId: id,
      lastBalance: balByAgent.get(id)?.balance ?? null,
      lastBalanceTs: balByAgent.get(id)?.ts ?? null,
      lastEventTs: evtByAgent.get(id) ?? null,
      errorsLast24h: errByAgent.get(id) ?? 0
    })
  )
}

/** Test-only: drop the cached pool so a subsequent env change is picked up. */
export function resetNeonClientForTests(): void {
  cachedPool = undefined
}
