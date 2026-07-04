import { execa } from 'execa'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchEvmBalance } from '../core/balance-fetcher.js'
import { getConfigDir, getConfigPath } from '../core/config.js'
import { hasSession } from '../core/keychain.js'
import { CONTRACTS_BY_CHAIN, contractsDeployed, statusDescription } from '../core/erc8004.js'
import { FleetManager } from '../core/FleetManager.js'
import { closeNeonPool, fetchFleetStatus, getNeonPool, type AgentStatusRow } from '../core/neon-client.js'
import { runWaap } from '../core/waap-runner.js'
import { readLoopState, readRecentTxLog, setPause, type PerpetualLoopState, type TxLogEntry } from './loop-state.js'
import { managedLoopState, startManagedLoop, stopManagedLoop } from './managed-loop.js'
import { renderShell } from './render.js'

// The agent treated as the funding source. Tag any funded agent `treasury` (or override the
// id via env) to enable one-click funding in the dashboard.
function treasuryAgentId(): string {
  return process.env.AEX_FLEET_TREASURY_AGENT ?? 'treasury'
}

// Resolve a file shipped under the package's public/ (CSS/JS) or examples/ (scripts). Walks up
// from the bundle dir; falls back to the Docker install path.
function resolveAsset(rel: string): string | null {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, rel)
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }
  const dockerPath = join('/opt/aex-fleet', rel)
  return existsSync(dockerPath) ? dockerPath : null
}

export interface DashboardState {
  fleetSize: number
  activeAgent: string | null
  telemetryConnected: boolean
  contractsDeployedOn: string[]
  totalErrorsLast24h: number
  agentsWithErc8004Intent: number
  agentsWithErrors: string[]
  configDir: string
  configPath: string
  aexFleetHomeOverride: string | null
  loop: {
    state: PerpetualLoopState | null
    isPauseFilePresent: boolean
    managed: ReturnType<typeof managedLoopState>
  }
  recentTxs: TxLogEntry[]
  allTags: string[]
  treasury: { exists: boolean; agentId: string; address: string | null; balance: number | null; hasSession: boolean }
  // Wallet-linking demonstrator. PROTOTYPE: linkedTo is written to fleet.json locally; swaps to
  // silk#904 (waap_linkAddress via AppKit signer) + silk#903 (cluster read) when those merge.
  linkingMode: 'prototype' | 'live'
  operator: { anchorAgentId: string | null; anchorAddress: string | null; clusterSize: number; email: string | null }
  agents: Array<{
    agentId: string
    chain: string | null
    address: string | null
    tags: string[]
    isTreasury: boolean
    hasSession: boolean
    linkedTo: string | null
    erc8004: { status: string; intentChain: string; tokenId: string | null } | null
    erc8004Description: string
    telemetry: AgentStatusRow
  }>
}

export async function buildState(): Promise<DashboardState> {
  const fm = new FleetManager()
  const agents = fm.listAgents()
  const ids = agents.map((a) => a.agentId)
  const pool = getNeonPool()

  // Run Neon telemetry + per-agent live RPC balance lookups concurrently. Balance lookups
  // are individually wrapped in try/null so a single RPC failure doesn't poison the dashboard.
  const [telemetryRows, liveBalances] = await Promise.all([
    fetchFleetStatus(ids),
    Promise.all(
      agents.map(async (a) => {
        if (!a.address || !a.chain) return null
        try {
          return await fetchEvmBalance(a.address, a.chain)
        } catch {
          return null
        }
      })
    )
  ])

  const tByAgent = new Map(telemetryRows.map((r) => [r.agentId, r]))

  // Live RPC balance takes precedence over the Neon snapshot (which can be stale by minutes).
  agents.forEach((a, i) => {
    const live = liveBalances[i]
    if (!live) return
    const row = tByAgent.get(a.agentId)
    if (row) {
      row.lastBalance = live.value
      row.lastBalanceTs = live.fetchedAt
    }
  })

  // Treasury: the agent named by AEX_FLEET_TREASURY_AGENT, or any agent tagged `treasury`.
  const tId = treasuryAgentId()
  const treasuryAgent = agents.find((a) => a.agentId === tId || a.tags.includes('treasury'))
  const isTreasury = (id: string) =>
    Boolean(treasuryAgent && treasuryAgent.agentId === id)

  return {
    fleetSize: agents.length,
    activeAgent: fm.getActive() ?? null,
    telemetryConnected: Boolean(pool),
    contractsDeployedOn: Object.keys(CONTRACTS_BY_CHAIN),
    totalErrorsLast24h: telemetryRows.reduce((s, r) => s + r.errorsLast24h, 0),
    agentsWithErc8004Intent: agents.filter((a) => a.erc8004).length,
    agentsWithErrors: telemetryRows.filter((r) => r.errorsLast24h > 0).map((r) => r.agentId),
    configDir: getConfigDir(),
    configPath: getConfigPath(),
    aexFleetHomeOverride: process.env.AEX_FLEET_HOME ?? null,
    loop: { ...readLoopState(), managed: managedLoopState() },
    recentTxs: readRecentTxLog(50),
    allTags: Array.from(new Set(agents.flatMap((a) => a.tags))).sort(),
    treasury: {
      exists: Boolean(treasuryAgent),
      agentId: treasuryAgent?.agentId ?? tId,
      address: treasuryAgent?.address ?? null,
      balance: treasuryAgent ? (tByAgent.get(treasuryAgent.agentId)?.lastBalance ?? null) : null,
      hasSession: treasuryAgent ? hasSession(treasuryAgent.agentId) : false
    },
    // The operator's identity anchor = the treasury wallet's address. The cluster is every agent
    // currently linked to it (+1 for the anchor). PROTOTYPE — see linkingMode note above.
    linkingMode: 'prototype',
    operator: {
      anchorAgentId: treasuryAgent?.agentId ?? null,
      anchorAddress: treasuryAgent?.address ?? null,
      clusterSize: treasuryAgent?.address
        ? agents.filter((a) => a.linkedTo === treasuryAgent.address).length + 1
        : 0,
      email: treasuryAgent?.waapEmail ?? null
    },
    agents: agents.map((a) => ({
      agentId: a.agentId,
      chain: a.chain ?? null,
      address: a.address ?? null,
      tags: a.tags,
      isTreasury: isTreasury(a.agentId),
      hasSession: hasSession(a.agentId),
      linkedTo: a.linkedTo ?? null,
      erc8004: a.erc8004
        ? { status: a.erc8004.status, intentChain: a.erc8004.intentChain, tokenId: a.erc8004.tokenId ?? null }
        : null,
      erc8004Description: statusDescription(a.erc8004),
      telemetry: tByAgent.get(a.agentId) ?? {
        agentId: a.agentId,
        lastBalance: null,
        lastBalanceTs: null,
        lastEventTs: null,
        errorsLast24h: 0
      }
    }))
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

export async function startServer(
  port: number,
  host: string = '127.0.0.1'
): Promise<{ port: number; host: string; close: () => Promise<void> }> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const method = req.method ?? 'GET'
      const url = req.url ?? '/'

      // GET routes (read-only)
      if (method === 'GET') {
        if (url === '/' || url === '/index.html') {
          const state = await buildState()
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(renderShell(state))
          return
        }
        if (url === '/static/app.css' || url === '/static/app.js') {
          const isCss = url.endsWith('.css')
          const p = resolveAsset(isCss ? 'public/app.css' : 'public/app.js')
          if (!p) { res.writeHead(404); res.end('asset not found'); return }
          res.writeHead(200, {
            'Content-Type': isCss ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
            'Cache-Control': 'no-store'
          })
          res.end(readFileSync(p, 'utf8'))
          return
        }
        if (url === '/api/state') {
          const state = await buildState()
          sendJson(res, 200, state)
          return
        }
      }

      // POST routes (mutations). No auth — server binds to 127.0.0.1; behind Authelia when hosted.
      if (method === 'POST') {
        if (url === '/api/control/pause') {
          const r = setPause(true)
          sendJson(res, 200, { ok: true, ...r })
          return
        }
        if (url === '/api/control/resume') {
          const r = setPause(false)
          sendJson(res, 200, { ok: true, ...r })
          return
        }
        // POST /api/agents/create { emailBase, count?, prefix?, tag? } — signs up demo agents
        // (no loop) via examples/setup-agents.sh. Long-running (signup ~30s each).
        if (url === '/api/agents/create') {
          const body = (await readJsonBody(req)) as Partial<{
            emailBase: string; count: number; prefix: string; tag: string
          }>
          const emailBase = String(body.emailBase ?? '').trim()
          if (!emailBase.includes('@')) {
            sendJson(res, 400, { ok: false, error: 'emailBase must look like an email' })
            return
          }
          const script = resolveAsset('examples/setup-agents.sh')
          if (!script) {
            sendJson(res, 500, { ok: false, error: 'setup-agents.sh not found' })
            return
          }
          const count = Math.max(1, Math.min(20, Number(body.count ?? 3)))
          const args = [script, String(count), String(body.prefix ?? 'pass'), String(body.tag ?? 'perpetual')]
          const result = await execa('bash', args, {
            env: { ...process.env, EMAIL_BASE: emailBase },
            reject: false,
            timeout: 5 * 60_000
          })
          if (result.exitCode === 0) {
            sendJson(res, 200, { ok: true, created: count, stdout: String(result.stdout).split('\n').slice(-5).join('\n') })
          } else {
            sendJson(res, 502, { ok: false, error: (String(result.stderr) || `exit ${result.exitCode}`).split('\n').slice(-3).join(' ') })
          }
          return
        }
        // POST /api/operator/connect { address, agentId? } — register the operator's signed-in
        // Human Wallet (from the embedded @silk-wallet/silk-wallet-sdk sign-in) as the identity
        // anchor. Stored as an address-only agent tagged `treasury` (= anchor + funding source).
        // No CLI session — it's browser-controlled, so funding from it happens client-side via
        // window.silk. hasSession will report false, which the client uses to route funding.
        if (url === '/api/operator/connect') {
          const body = (await readJsonBody(req)) as Partial<{ address: string; agentId: string; email: string }>
          const address = String(body.address ?? '').trim()
          if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
            sendJson(res, 400, { ok: false, error: 'a valid 0x EVM address is required' })
            return
          }
          const agentId = String(body.agentId ?? 'operator').trim()
          const email = body.email && String(body.email).includes('@') ? String(body.email).trim() : undefined
          const fm = new FleetManager()
          for (const a of fm.listAgents()) {
            if (a.agentId !== agentId && a.tags.includes('treasury')) {
              await fm.updateAgent(a.agentId, { tags: a.tags.filter((t) => t !== 'treasury') })
            }
          }
          if (fm.getAgent(agentId)) {
            const a = fm.getAgent(agentId)!
            await fm.updateAgent(agentId, { address, chain: 'sepolia', tags: Array.from(new Set([...a.tags, 'treasury', 'operator'])), ...(email ? { waapEmail: email } : {}) })
          } else {
            await fm.addAgent({ agentId, address, chain: 'sepolia', tags: ['treasury', 'operator'], ...(email ? { waapEmail: email } : {}) })
          }
          sendJson(res, 200, { ok: true, agentId, address, email: email ?? null, mode: 'human-wallet' })
          return
        }
        // POST /api/operator/disconnect — sign out: drop treasury+operator tags from the anchor.
        if (url === '/api/operator/disconnect') {
          const fm = new FleetManager()
          let cleared = null
          for (const a of fm.listAgents()) {
            if (a.tags.includes('treasury') || a.tags.includes('operator')) {
              await fm.updateAgent(a.agentId, { tags: a.tags.filter((t) => t !== 'treasury' && t !== 'operator') })
              cleared = a.agentId
            }
          }
          sendJson(res, 200, { ok: true, cleared })
          return
        }
        // POST /api/treasury/set { agentId } — designate the funding source. Adds the `treasury`
        // tag to the chosen agent and removes it from any others, so there's exactly one.
        if (url === '/api/treasury/set') {
          const body = (await readJsonBody(req)) as Partial<{ agentId: string }>
          const agentId = String(body.agentId ?? '').trim()
          const fm = new FleetManager()
          if (!fm.getAgent(agentId)) {
            sendJson(res, 404, { ok: false, error: `unknown agent: ${agentId}` })
            return
          }
          for (const a of fm.listAgents()) {
            const hasTag = a.tags.includes('treasury')
            if (a.agentId === agentId && !hasTag) {
              await fm.updateAgent(a.agentId, { tags: [...a.tags, 'treasury'] })
            } else if (a.agentId !== agentId && hasTag) {
              await fm.updateAgent(a.agentId, { tags: a.tags.filter((t) => t !== 'treasury') })
            }
          }
          sendJson(res, 200, { ok: true, treasury: agentId })
          return
        }
        // POST /api/fund { amount? } — treasury sweeps `amount` ETH to every non-treasury agent.
        if (url === '/api/fund') {
          const body = (await readJsonBody(req)) as Partial<{ amount: string }>
          const amount = String(body.amount ?? '0.05').trim()
          if (!/^\d+(\.\d+)?$/.test(amount)) {
            sendJson(res, 400, { ok: false, error: 'amount must be a positive number' })
            return
          }
          const fm = new FleetManager()
          const tId = treasuryAgentId()
          const all = fm.listAgents()
          const treasury = all.find((a) => a.agentId === tId || a.tags.includes('treasury'))
          if (!treasury) {
            sendJson(res, 400, { ok: false, error: 'no treasury agent (tag one `treasury` or set AEX_FLEET_TREASURY_AGENT)' })
            return
          }
          const recipients = all.filter((a) => a.agentId !== treasury.agentId && a.address)
          if (recipients.length === 0) {
            sendJson(res, 400, { ok: false, error: 'no recipient agents with addresses' })
            return
          }
          const results: Array<{ agentId: string; ok: boolean; message?: string }> = []
          for (const r of recipients) {
            const out = await runWaap({
              agentId: treasury.agentId,
              args: ['send-tx', '--to', r.address as string, '--value', amount, '--chain', '11155111']
            })
            const ok = out.exitCode === 0
            results.push({ agentId: r.agentId, ok, ...(ok ? {} : { message: (out.stderr || out.stdout || `exit ${out.exitCode}`).trim().split('\n')[0] }) })
          }
          const failed = results.filter((x) => !x.ok).length
          sendJson(res, failed === 0 ? 200 : 207, { ok: failed === 0, total: results.length, failed, amount, from: treasury.agentId, results })
          return
        }
        // POST /api/loop/start { emailBase, password?, delay?, amount?, chainId?, maxHops? }
        if (url === '/api/loop/start') {
          const body = (await readJsonBody(req)) as Partial<{
            emailBase: string
            password: string
            delay: number
            amount: string
            chainId: number
            maxHops: number
          }>
          try {
            const r = startManagedLoop({
              emailBase: String(body.emailBase ?? '').trim(),
              password: body.password,
              delay: body.delay,
              amount: body.amount,
              chainId: body.chainId,
              maxHops: body.maxHops
            })
            sendJson(res, 200, { ok: true, ...r })
          } catch (err) {
            sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
          }
          return
        }
        if (url === '/api/loop/stop') {
          const r = await stopManagedLoop()
          sendJson(res, 200, { ok: true, ...r })
          return
        }
        // POST /api/fleet/policy { tag?: string, all?: boolean, dailyLimit: string }
        // Applies waap-cli policy set across every agent matching the selector. Returns
        // per-agent results in the body. Sequential — no parallel waap-cli (2FA serialises).
        if (url === '/api/fleet/policy') {
          const body = (await readJsonBody(req)) as {
            tag?: unknown
            all?: unknown
            dailyLimit?: unknown
          }
          const limit = String(body.dailyLimit ?? '').trim()
          if (!limit || !/^\d+(\.\d+)?$/.test(limit)) {
            sendJson(res, 400, { ok: false, error: 'dailyLimit must be a positive number' })
            return
          }
          const fm = new FleetManager()
          const selector = body.tag ? { tag: String(body.tag) } : body.all ? { all: true } : {}
          const targets = fm.selectAgents(selector)
          if (targets.length === 0) {
            sendJson(res, 400, { ok: false, error: 'no agents matched selector' })
            return
          }
          const results: Array<{ agentId: string; ok: boolean; message?: string }> = []
          for (const agent of targets) {
            const r = await runWaap({
              agentId: agent.agentId,
              args: ['policy', 'set', '--daily-spend-limit', limit]
            })
            const ok = r.exitCode === 0
            results.push({
              agentId: agent.agentId,
              ok,
              ...(ok
                ? {}
                : { message: (r.stderr || r.stdout || `exit ${r.exitCode}`).trim().split('\n')[0] })
            })
          }
          const failed = results.filter((x) => !x.ok).length
          sendJson(res, failed === 0 ? 200 : 207, {
            ok: failed === 0,
            total: results.length,
            failed,
            dailyLimit: limit,
            selector,
            results
          })
          return
        }
        // ── Wallet-linking demonstrator (PROTOTYPE) ─────────────────────────────────────────
        // These mirror the shape of silk#904 (linkAddress/unlinkAddress) so the swap is a
        // drop-in: replace the fleet.json write below with a waap_linkAddress SDK call (which
        // does the SIWE/AppKit signer flow) once #904 publishes. The anchor defaults to the
        // operator/treasury address.
        //
        // POST /api/fleet/link { anchor?, tag?, all? } — link selected agents to the anchor.
        if (url === '/api/fleet/link' || url === '/api/fleet/unlink') {
          const unlink = url.endsWith('/unlink')
          const body = (await readJsonBody(req)) as Partial<{ anchor: string; tag: string; all: boolean }>
          const fm = new FleetManager()
          const tId = treasuryAgentId()
          const treasury = fm.listAgents().find((a) => a.agentId === tId || a.tags.includes('treasury'))
          const anchor = String(body.anchor ?? treasury?.address ?? '').trim()
          if (!unlink && !anchor) {
            sendJson(res, 400, { ok: false, error: 'no anchor — set a treasury wallet first (it is your identity anchor)' })
            return
          }
          const selector = body.tag ? { tag: String(body.tag) } : { all: true }
          // Never link/unlink the anchor agent itself.
          const targets = fm.selectAgents(selector).filter((a) => a.address !== anchor)
          for (const a of targets) {
            await fm.updateAgent(a.agentId, { linkedTo: unlink ? undefined : anchor })
          }
          sendJson(res, 200, { ok: true, mode: 'prototype', anchor, linked: unlink ? 0 : targets.length, unlinked: unlink ? targets.length : 0, agents: targets.map((a) => a.agentId) })
          return
        }
        // POST /api/agents/:id/link { anchor? } / /unlink — single agent.
        const linkMatch = url.match(/^\/api\/agents\/([^/]+)\/(link|unlink)$/)
        if (linkMatch) {
          const agentId = decodeURIComponent(linkMatch[1])
          const unlink = linkMatch[2] === 'unlink'
          const body = (await readJsonBody(req)) as Partial<{ anchor: string }>
          const fm = new FleetManager()
          if (!fm.getAgent(agentId)) { sendJson(res, 404, { ok: false, error: `unknown agent: ${agentId}` }); return }
          const tId = treasuryAgentId()
          const treasury = fm.listAgents().find((a) => a.agentId === tId || a.tags.includes('treasury'))
          const anchor = String(body.anchor ?? treasury?.address ?? '').trim()
          if (!unlink && !anchor) { sendJson(res, 400, { ok: false, error: 'no anchor — set a treasury wallet first' }); return }
          const updated = await fm.updateAgent(agentId, { linkedTo: unlink ? undefined : anchor })
          sendJson(res, 200, { ok: true, mode: 'prototype', agentId, linkedTo: updated.linkedTo ?? null })
          return
        }
        // POST /api/agents/:id/tags { add?: string[], remove?: string[] } — edit labels.
        const tagsMatch = url.match(/^\/api\/agents\/([^/]+)\/tags$/)
        if (tagsMatch) {
          const agentId = decodeURIComponent(tagsMatch[1])
          const body = (await readJsonBody(req)) as { add?: unknown; remove?: unknown }
          const add = Array.isArray(body.add) ? body.add.map(String).map((s) => s.trim()).filter(Boolean) : []
          const remove = new Set(Array.isArray(body.remove) ? body.remove.map(String) : [])
          const fm = new FleetManager()
          const agent = fm.getAgent(agentId)
          if (!agent) { sendJson(res, 404, { ok: false, error: `unknown agent: ${agentId}` }); return }
          const next = Array.from(new Set([...agent.tags.filter((t) => !remove.has(t)), ...add]))
          const updated = await fm.updateAgent(agentId, { tags: next })
          sendJson(res, 200, { ok: true, agentId, tags: updated.tags })
          return
        }
        // POST /api/agents/:id/policy { dailyLimit: "<usd>" }
        const policyMatch = url.match(/^\/api\/agents\/([^/]+)\/policy$/)
        if (policyMatch) {
          const agentId = decodeURIComponent(policyMatch[1])
          const body = (await readJsonBody(req)) as { dailyLimit?: unknown }
          const limit = String(body.dailyLimit ?? '').trim()
          if (!limit || !/^\d+(\.\d+)?$/.test(limit)) {
            sendJson(res, 400, { ok: false, error: 'dailyLimit must be a positive number' })
            return
          }
          const fm = new FleetManager()
          if (!fm.getAgent(agentId)) {
            sendJson(res, 404, { ok: false, error: `unknown agent: ${agentId}` })
            return
          }
          const result = await runWaap({
            agentId,
            args: ['policy', 'set', '--daily-spend-limit', limit]
          })
          if (result.exitCode === 0) {
            sendJson(res, 200, { ok: true, agentId, dailyLimit: limit, stdout: result.stdout.trim() })
          } else {
            sendJson(res, 502, {
              ok: false,
              agentId,
              exitCode: result.exitCode,
              error: (result.stderr || result.stdout || `exit ${result.exitCode}`).trim().split('\n')[0]
            })
          }
          return
        }
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      sendJson(res, 500, { ok: false, error: msg })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    // Default 127.0.0.1: mutation endpoints aren't reachable from the LAN. Pass 0.0.0.0 when
    // running inside a container (Docker network isolation is the security boundary) or behind
    // a reverse proxy that needs to reach the host's exposed port.
    server.listen(port, host, () => resolve())
  })
  return {
    port,
    host,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await closeNeonPool()
      await stopManagedLoop()
    }
  }
}
// re-export so commands/dashboard.ts can consume contractsDeployed for the --export shape too
export { contractsDeployed }
