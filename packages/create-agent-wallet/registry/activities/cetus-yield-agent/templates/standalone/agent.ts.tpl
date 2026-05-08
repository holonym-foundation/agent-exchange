import 'dotenv/config'
import { execa } from 'execa'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { initCetusSDK, ClmmPoolUtil } from '@cetusprotocol/cetus-sui-clmm-sdk'
import BN from 'bn.js'
import fs from 'node:fs'

// -----------------------------------------------------------------------------
// Config — see https://docs.wallet.human.tech/recipes/cetus-yield-agent
// -----------------------------------------------------------------------------

const AGENT_ID = '{{projectName}}'
const POOL_ID = process.env.CETUS_POOL_ID
const AGENT_MODE = (process.env.AGENT_MODE ?? 'monitor') as 'monitor' | 'active'
const POSITION_RANGE = Number(process.env.POSITION_RANGE_TICKS ?? 200)
const REBALANCE_THRESHOLD = Number(process.env.REBALANCE_THRESHOLD_TICKS ?? 100)
const CHECK_INTERVAL = Number(process.env.CHECK_INTERVAL_MS ?? 5 * 60 * 1000)
const NETWORK = (process.env.NETWORK ?? 'mainnet') as 'mainnet' | 'testnet'
const SUI_RPC = process.env.SUI_RPC ?? getFullnodeUrl(NETWORK)
const LOG_FILE = process.env.LOG_FILE ?? `${AGENT_ID}.log`
const MAX_DEPOSIT_USD = process.env.AGENT_MAX_DEPOSIT_USD
  ? Number(process.env.AGENT_MAX_DEPOSIT_USD)
  : undefined
const USDC_TYPE = process.env.USDC_TYPE
  ?? '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

// Volatility-adaptive range parameters
const VOLATILITY_WINDOW = Number(process.env.VOLATILITY_WINDOW ?? 60)
const MIN_RANGE_TICKS = Number(process.env.MIN_RANGE_TICKS ?? 100)
const MAX_RANGE_TICKS = Number(process.env.MAX_RANGE_TICKS ?? 400)
const VOLATILITY_MULTIPLIER = Number(process.env.VOLATILITY_MULTIPLIER ?? 3.0)
const STARTUP_COOLDOWN_MS = Number(process.env.STARTUP_COOLDOWN_MS ?? 60_000)
const YIELD_SCAN_INTERVAL = Number(process.env.YIELD_SCAN_INTERVAL ?? 6) // every Nth cycle
const USDC_OPEN_FRACTION = Number(process.env.USDC_OPEN_FRACTION ?? 0.40)
const USDC_REOPEN_FRACTION = Number(process.env.USDC_REOPEN_FRACTION ?? 0.50)
const ESTIMATED_GAS_SUI = Number(process.env.ESTIMATED_GAS_SUI ?? 0.01)

if (!POOL_ID) {
  console.error(`[${AGENT_ID}] CETUS_POOL_ID is required`)
  process.exit(1)
}
if (AGENT_MODE !== 'monitor' && AGENT_MODE !== 'active') {
  console.error(`[${AGENT_ID}] AGENT_MODE must be 'monitor' or 'active'`)
  process.exit(1)
}
if (!Number.isFinite(POSITION_RANGE) || POSITION_RANGE <= 0) {
  console.error(`[${AGENT_ID}] POSITION_RANGE_TICKS must be a positive integer`)
  process.exit(1)
}

// -----------------------------------------------------------------------------
// Logging — JSON-line to stdout + optional file. Same shape as the canonical
// recipe so dashboards/log scrapers can parse uniformly.
// -----------------------------------------------------------------------------

type LogLevel = 'info' | 'event' | 'warn' | 'error'

function log(level: LogLevel, message: string, data: Record<string, unknown> = {}): void {
  const entry = { ts: new Date().toISOString(), agent: AGENT_ID, level, message, ...data }
  const line = JSON.stringify(entry)
  console.log(line)
  try { fs.appendFileSync(LOG_FILE, line + '\n') } catch {}
}

function logEvent(message: string, data: Record<string, unknown> = {}): void {
  log('event', message, data)
}

// -----------------------------------------------------------------------------
// Matrix alerting — fire-and-forget; never blocks the agent loop on failure.
// -----------------------------------------------------------------------------

async function sendMatrixAlert(message: string): Promise<void> {
  const homeserver = process.env.MATRIX_HOMESERVER
  const token = process.env.MATRIX_ACCESS_TOKEN
  const room = process.env.MATRIX_ALERT_ROOM
  if (!homeserver || !token || !room) return
  try {
    const txnId = `${Date.now()}${Math.random().toString(36).slice(2)}`
    const url = `${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.room.message/${txnId}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.text', body: `[${AGENT_ID}] ${message}` }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
  } catch (err) {
    log('warn', 'matrix_alert_failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

// -----------------------------------------------------------------------------
// waap-cli helpers — parses the newline-delimited JSON event stream emitted by
// `waap-cli ... --json` and returns the `result` event payload.
// -----------------------------------------------------------------------------

function parseWaapJson<T>(stdout: string): T {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{'))
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as { event?: string }
      if (obj.event === 'result') return obj as T
    } catch {}
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]) as T } catch {}
  }
  throw new Error(`Could not parse waap-cli JSON: ${stdout.slice(0, 200)}`)
}

async function whoami(): Promise<string> {
  // Allow operators to skip the whoami session check by setting
  // WAAP_AGENT_ADDRESS in env. Useful when the agent is deployed alongside a
  // long-running waap-cli session (e.g. credentials in env, no interactive
  // login) — `whoami --json` requires an active session that the agent
  // wouldn't normally maintain.
  const override = process.env.WAAP_AGENT_ADDRESS?.trim()
  if (override) return override

  const { stdout } = await execa('waap-cli', ['whoami', '--json'])
  const parsed = parseWaapJson<{ suiWalletAddress?: string }>(stdout)
  if (!parsed.suiWalletAddress) {
    throw new Error('no Sui wallet address — set WAAP_AGENT_ADDRESS or run `waap-cli signup`')
  }
  return parsed.suiWalletAddress
}

interface WaapSendTxResult {
  event?: string
  txHash?: string
  digest?: string
}

async function signAndSendTx(b64TxBytes: string): Promise<string | null> {
  const { stdout } = await execa(
    'waap-cli',
    ['send-tx', '--tx-bytes', b64TxBytes, '--chain', `sui:${NETWORK}`, '--json'],
    { timeout: 120_000 },
  )
  try {
    const parsed = parseWaapJson<WaapSendTxResult>(stdout)
    return parsed.txHash ?? parsed.digest ?? null
  } catch {
    const m = stdout.match(/(?:Transaction submitted|TxHash|digest):\s*(\S+)/i)
    return m ? m[1] : null
  }
}

// -----------------------------------------------------------------------------
// Sui + Cetus clients
// -----------------------------------------------------------------------------

const sui = new SuiClient({ url: SUI_RPC })
const cetus = initCetusSDK({ network: NETWORK })

// -----------------------------------------------------------------------------
// State (in-memory; per-process)
// -----------------------------------------------------------------------------

interface TickSample { ts: number; tick: number }
const tickHistory: TickSample[] = []
let totalGasSpent = 0
let rebalanceCount = 0
let positionOpenedAt: string | null = null
let cyclesInRange = 0
let cyclesTotal = 0
const startupTime = Date.now()

// -----------------------------------------------------------------------------
// Pool + balance reads
// -----------------------------------------------------------------------------

interface PoolState {
  currentTick: number
  currentSqrtPrice: string
  tickSpacing: number
  coinTypeA: string
  coinTypeB: string
  raw: Record<string, unknown>
}

async function getPoolState(): Promise<PoolState> {
  const pool = await cetus.Pool.getPool(POOL_ID!) as Record<string, unknown>
  const tickRaw = pool.current_tick_index as { fields?: { bits?: number | string } } | number | string
  const currentTick = typeof tickRaw === 'object' && tickRaw?.fields?.bits !== undefined
    ? Number(tickRaw.fields.bits)
    : Number(tickRaw)
  return {
    currentTick,
    currentSqrtPrice: String(pool.current_sqrt_price ?? '0'),
    tickSpacing: Number(pool.tickSpacing ?? pool.tick_spacing ?? 60),
    coinTypeA: String(pool.coinTypeA ?? ''),
    coinTypeB: String(pool.coinTypeB ?? ''),
    raw: pool,
  }
}

async function getSuiBalance(owner: string): Promise<number> {
  const r = await sui.getBalance({ owner, coinType: '0x2::sui::SUI' })
  return Number(r.totalBalance) / 1e9
}

async function getUsdcBalance(owner: string): Promise<number> {
  const r = await sui.getBalance({ owner, coinType: USDC_TYPE })
  return Number(r.totalBalance) / 1e6
}

interface Position {
  posId: string
  liquidity: string
  tickLower: number
  tickUpper: number
  pool: string
}

async function getPositions(owner: string): Promise<Position[]> {
  const objects = await sui.getOwnedObjects({
    owner,
    filter: { StructType: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb::position::Position' },
    options: { showContent: true },
  })
  const positions: Position[] = []
  for (const o of objects.data) {
    const content = o.data?.content
    if (!content || content.dataType !== 'moveObject') continue
    const fields = (content as { fields: Record<string, unknown> }).fields
    const liq = Number(fields.liquidity ?? 0)
    if (!liq) continue
    const decode = (raw: unknown): number => {
      if (typeof raw === 'object' && raw !== null && 'fields' in raw) {
        const f = (raw as { fields?: { bits?: number | string } }).fields
        return Number(f?.bits ?? 0)
      }
      return Number(raw)
    }
    const pos: Position = {
      posId: o.data!.objectId,
      liquidity: String(liq),
      tickLower: decode(fields.tick_lower_index),
      tickUpper: decode(fields.tick_upper_index),
      pool: String(fields.pool ?? ''),
    }
    if (pos.pool === POOL_ID) positions.push(pos)
  }
  return positions
}

// -----------------------------------------------------------------------------
// Volatility-adaptive range
// -----------------------------------------------------------------------------

interface VolatilityResult { volatility: number; sampleSize: number; mean: number }

function calculateVolatility(): VolatilityResult {
  if (tickHistory.length < 2) return { volatility: 0, mean: 0, sampleSize: tickHistory.length }
  const changes: number[] = []
  for (let i = 1; i < tickHistory.length; i++) {
    changes.push(Math.abs(tickHistory[i].tick - tickHistory[i - 1].tick))
  }
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length
  const variance = changes.reduce((a, b) => a + (b - mean) ** 2, 0) / changes.length
  return { volatility: Math.sqrt(variance), mean, sampleSize: tickHistory.length }
}

function getAdaptiveRange(tickSpacing: number): number {
  const { volatility, sampleSize } = calculateVolatility()
  if (sampleSize < 10) return POSITION_RANGE
  const adaptive = Math.round(volatility * VOLATILITY_MULTIPLIER * 2)
  const clamped = Math.max(MIN_RANGE_TICKS, Math.min(MAX_RANGE_TICKS, adaptive))
  const snapped = Math.ceil(clamped / tickSpacing) * tickSpacing
  return snapped || POSITION_RANGE
}

// -----------------------------------------------------------------------------
// Rebalance logic (active mode)
// -----------------------------------------------------------------------------

function needsRebalance(position: Position, currentTick: number): boolean {
  const center = Math.floor((position.tickLower + position.tickUpper) / 2)
  const drift = Math.abs(currentTick - center)
  const outOfRange = currentTick < position.tickLower || currentTick > position.tickUpper

  if (outOfRange) {
    logEvent('out_of_range', { currentTick, tickLower: position.tickLower, tickUpper: position.tickUpper, drift })
    return true
  }
  if (drift > REBALANCE_THRESHOLD) {
    logEvent('drift_detected', { currentTick, drift, threshold: REBALANCE_THRESHOLD })
    return true
  }
  log('info', 'position_in_range', { currentTick, drift, threshold: REBALANCE_THRESHOLD })
  return false
}

async function rebalance(owner: string, pool: PoolState, position: Position): Promise<void> {
  logEvent('rebalance_start', { posId: position.posId })

  const balanceBefore = await getSuiBalance(owner)
  const usdcBefore = await getUsdcBalance(owner)

  // Step 1 — remove liquidity + collect fees
  log('info', 'removing_liquidity', { posId: position.posId })
  const removeTx = await cetus.Position.removeLiquidityTransactionPayload({
    pool_id: POOL_ID!,
    pos_id: position.posId,
    coinTypeA: pool.coinTypeA,
    coinTypeB: pool.coinTypeB,
    delta_liquidity: position.liquidity,
    min_amount_a: '0',
    min_amount_b: '0',
    collect_fee: true,
    rewarder_coin_types: [],
  })
  removeTx.setSender(owner)
  const removeBytes = Buffer.from(await removeTx.build({ client: sui })).toString('base64')
  const removeTxHash = await signAndSendTx(removeBytes)

  // Wait for state to settle
  await new Promise((r) => setTimeout(r, 5000))

  const balanceAfterRemove = await getSuiBalance(owner)
  const usdcAfterRemove = await getUsdcBalance(owner)
  totalGasSpent += ESTIMATED_GAS_SUI * 2 // remove + open

  logEvent('remove_liquidity_complete', {
    txHash: removeTxHash,
    suiBefore: balanceBefore,
    suiAfter: balanceAfterRemove,
    usdcBefore,
    usdcAfter: usdcAfterRemove,
  })

  // Step 2 — open new position with adaptive range
  const freshPool = await getPoolState()
  const range = getAdaptiveRange(freshPool.tickSpacing)
  const { volatility, sampleSize } = calculateVolatility()

  const tickLower = Math.floor((freshPool.currentTick - range) / freshPool.tickSpacing) * freshPool.tickSpacing
  const tickUpper = Math.ceil((freshPool.currentTick + range) / freshPool.tickSpacing) * freshPool.tickSpacing

  log('info', 'opening_new_position', {
    tickLower, tickUpper, currentTick: freshPool.currentTick, range,
    volatility: volatility.toFixed(2),
  })

  const usdcRaw = await sui.getBalance({ owner, coinType: USDC_TYPE })
  const usdcAvailable = Number(usdcRaw.totalBalance)
  const usdcToUse = Math.floor(usdcAvailable * USDC_REOPEN_FRACTION).toString()

  if (Number(usdcToUse) < 10_000) {
    log('warn', 'insufficient_usdc_for_reopen', { usdcAvailable })
    logEvent('rebalance_skipped', { reason: 'insufficient_usdc', usdcAvailable })
    return
  }

  if (MAX_DEPOSIT_USD !== undefined && Number(usdcToUse) / 1e6 > MAX_DEPOSIT_USD) {
    log('warn', 'usdc_exceeds_max_deposit_cap', { usdcToUse, maxDepositUsd: MAX_DEPOSIT_USD })
    logEvent('rebalance_skipped', { reason: 'max_deposit_cap', usdcToUse, cap: MAX_DEPOSIT_USD })
    return
  }

  const curSqrt = new BN(freshPool.currentSqrtPrice)
  const liqInput = ClmmPoolUtil.estLiquidityAndcoinAmountFromOneAmounts(
    tickLower, tickUpper,
    new BN(usdcToUse),
    true, true, 0.1, curSqrt,
  )

  // SDK 5.4 typed against AddLiquidityParams which doesn't declare `is_open` /
  // `pos_id`, but the runtime accepts them when opening a new position.
  // TODO: migrate to openPositionTransactionPayload + addLiquidity once the
  // recipe is updated.
  const openPayload = await cetus.Position.createAddLiquidityPayload({
    pool_id: POOL_ID!,
    coinTypeA: freshPool.coinTypeA,
    coinTypeB: freshPool.coinTypeB,
    tick_lower: tickLower.toString(),
    tick_upper: tickUpper.toString(),
    is_open: true,
    pos_id: '',
    max_amount_a: liqInput.tokenMaxA.toString(),
    max_amount_b: liqInput.tokenMaxB.toString(),
    delta_liquidity: liqInput.liquidityAmount.toString(),
    rewarder_coin_types: [],
    collect_fee: false,
  } as unknown as Parameters<typeof cetus.Position.createAddLiquidityPayload>[0])
  openPayload.setSender(owner)
  const openBytes = Buffer.from(await openPayload.build({ client: sui })).toString('base64')
  const openTxHash = await signAndSendTx(openBytes)

  rebalanceCount++
  positionOpenedAt = new Date().toISOString()
  cyclesInRange = 0
  cyclesTotal = 0

  logEvent('rebalance_complete', {
    txHash: openTxHash,
    newTickLower: tickLower,
    newTickUpper: tickUpper,
    usdcDeposited: usdcToUse,
    rangeUsed: range,
    volatility: volatility.toFixed(2),
    volatilitySamples: sampleSize,
    rebalanceNumber: rebalanceCount,
  })
  log('info', 'rebalance_complete', { tickLower, tickUpper, txHash: openTxHash })
}

async function openInitialPosition(owner: string, pool: PoolState): Promise<void> {
  const range = getAdaptiveRange(pool.tickSpacing)
  const { volatility } = calculateVolatility()
  const tickLower = Math.floor((pool.currentTick - range) / pool.tickSpacing) * pool.tickSpacing
  const tickUpper = Math.ceil((pool.currentTick + range) / pool.tickSpacing) * pool.tickSpacing

  const usdcRaw = await sui.getBalance({ owner, coinType: USDC_TYPE })
  const usdcAvailable = Number(usdcRaw.totalBalance)
  const usdcToUse = Math.floor(usdcAvailable * USDC_OPEN_FRACTION).toString()

  if (Number(usdcToUse) < 10_000) {
    log('warn', 'insufficient_usdc_to_open', { usdcAvailable })
    logEvent('insufficient_funds', { usdcAvailable })
    return
  }
  if (MAX_DEPOSIT_USD !== undefined && Number(usdcToUse) / 1e6 > MAX_DEPOSIT_USD) {
    log('warn', 'usdc_exceeds_max_deposit_cap_initial', { usdcToUse, maxDepositUsd: MAX_DEPOSIT_USD })
    return
  }

  const curSqrt = new BN(pool.currentSqrtPrice)
  const liqInput = ClmmPoolUtil.estLiquidityAndcoinAmountFromOneAmounts(
    tickLower, tickUpper,
    new BN(usdcToUse),
    true, true, 0.1, curSqrt,
  )

  log('info', 'opening_initial_position', { tickLower, tickUpper, usdc: usdcToUse, range, volatility: volatility.toFixed(2) })
  const openPayload = await cetus.Position.createAddLiquidityPayload({
    pool_id: POOL_ID!,
    coinTypeA: pool.coinTypeA,
    coinTypeB: pool.coinTypeB,
    tick_lower: tickLower.toString(),
    tick_upper: tickUpper.toString(),
    is_open: true,
    pos_id: '',
    max_amount_a: liqInput.tokenMaxA.toString(),
    max_amount_b: liqInput.tokenMaxB.toString(),
    delta_liquidity: liqInput.liquidityAmount.toString(),
    rewarder_coin_types: [],
    collect_fee: false,
  } as unknown as Parameters<typeof cetus.Position.createAddLiquidityPayload>[0])
  openPayload.setSender(owner)
  const txBytes = Buffer.from(await openPayload.build({ client: sui })).toString('base64')
  const txHash = await signAndSendTx(txBytes)
  positionOpenedAt = new Date().toISOString()
  totalGasSpent += ESTIMATED_GAS_SUI
  logEvent('position_opened', { txHash, tickLower, tickUpper, usdc: usdcToUse, range })
  log('info', 'position_opened', { txHash, tickLower, tickUpper })
}

// -----------------------------------------------------------------------------
// Cross-protocol yield scan (DeFi Llama)
// -----------------------------------------------------------------------------

interface LlamaPool {
  chain: string
  project: string
  symbol: string
  apy?: number
  tvlUsd?: number
  pool?: string
}

async function fetchDefiLlamaYields(): Promise<LlamaPool[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetch('https://yields.llama.fi/pools', { signal: ctrl.signal })
    const json = await res.json() as { data?: LlamaPool[] }
    return json.data ?? []
  } finally {
    clearTimeout(timer)
  }
}

async function scanYields(): Promise<void> {
  try {
    const allPools = await fetchDefiLlamaYields()
    const suiPools = allPools.filter((p) => p.chain === 'Sui')

    const cetusLpPools = suiPools
      .filter((p) => p.project === 'cetus-clmm')
      .sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))
      .slice(0, 10)
      .map((p) => ({
        symbol: p.symbol,
        apy: Number((p.apy ?? 0).toFixed(2)),
        tvl: Math.round(p.tvlUsd ?? 0),
        pool: p.pool,
      }))

    const protocols: Record<string, LlamaPool[]> = {}
    for (const p of suiPools) {
      const proj = p.project
      if (!protocols[proj]) protocols[proj] = []
      protocols[proj].push(p)
    }

    const crossProtocol: Array<{ protocol: string; type: string; asset: string; apy: number; tvl: number }> = []

    for (const proj of ['navi-lending', 'scallop-lend', 'current', 'kai-finance']) {
      const pools = protocols[proj] ?? []
      const suiPool = pools.find((p) => p.symbol === 'SUI' || p.symbol === 'HASUI')
      const usdcPool = pools.find((p) => p.symbol === 'USDC')
      if (suiPool) {
        crossProtocol.push({
          protocol: proj, type: 'lending', asset: suiPool.symbol,
          apy: Number((suiPool.apy ?? 0).toFixed(2)), tvl: Math.round(suiPool.tvlUsd ?? 0),
        })
      }
      if (usdcPool) {
        crossProtocol.push({
          protocol: proj, type: 'lending', asset: usdcPool.symbol,
          apy: Number((usdcPool.apy ?? 0).toFixed(2)), tvl: Math.round(usdcPool.tvlUsd ?? 0),
        })
      }
    }

    for (const proj of ['cetus-clmm', 'bluefin-spot', 'turbos', 'flowx-v3', 'full-sail']) {
      const pools = protocols[proj] ?? []
      const suiUsdc = pools.find((p) => /SUI.*USDC|USDC.*SUI/i.test(p.symbol ?? ''))
      if (suiUsdc) {
        crossProtocol.push({
          protocol: proj, type: 'lp', asset: suiUsdc.symbol,
          apy: Number((suiUsdc.apy ?? 0).toFixed(2)), tvl: Math.round(suiUsdc.tvlUsd ?? 0),
        })
      }
    }

    crossProtocol.sort((a, b) => b.apy - a.apy)

    const allCetusPools = suiPools
      .filter((p) => p.project === 'cetus-clmm')
      .sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))
      .map((p) => ({
        symbol: p.symbol,
        apy: Number((p.apy ?? 0).toFixed(2)),
        tvl: Math.round(p.tvlUsd ?? 0),
        pool: p.pool,
      }))
    const ourPool = allCetusPools.find((p) => /USDC.*SUI|SUI.*USDC/i.test(p.symbol ?? ''))
    const ourPoolRank = ourPool ? allCetusPools.indexOf(ourPool) + 1 : null

    if (ourPool && !cetusLpPools.find((p) => p.pool === ourPool.pool)) {
      cetusLpPools.push(ourPool)
    }

    logEvent('yield_scan', {
      cetusTopPools: cetusLpPools,
      crossProtocol,
      currentPool: {
        symbol: 'SUI/USDC', protocol: 'cetus-clmm',
        apy: ourPool?.apy ?? null, tvl: ourPool?.tvl ?? null, rank: ourPoolRank,
      },
      bestAlternative: crossProtocol[0] ?? null,
      totalSuiPools: suiPools.length,
      scanTime: new Date().toISOString(),
    })
    log('info', 'yield_scan_complete', {
      cetusPoolsFound: cetusLpPools.length,
      crossProtocolOptions: crossProtocol.length,
      bestApy: crossProtocol[0]?.apy ?? 0,
      bestProtocol: crossProtocol[0]?.protocol ?? 'none',
    })
  } catch (err) {
    log('warn', 'yield_scan_failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

// -----------------------------------------------------------------------------
// Monitor mode (read-only simulation)
// -----------------------------------------------------------------------------

interface SimPosition { tickLower: number; tickUpper: number; center: number; openedAt: string }
let simPosition: SimPosition | null = null

function simulatePositionCheck(currentTick: number, tickSpacing: number): void {
  const align = (t: number) => Math.round(t / tickSpacing) * tickSpacing
  if (!simPosition) {
    simPosition = {
      tickLower: align(currentTick - POSITION_RANGE),
      tickUpper: align(currentTick + POSITION_RANGE),
      center: currentTick,
      openedAt: new Date().toISOString(),
    }
    logEvent('sim_position_opened', { ...simPosition })
    return
  }
  const drift = Math.abs(currentTick - simPosition.center)
  const outOfRange = currentTick < simPosition.tickLower || currentTick > simPosition.tickUpper
  if (outOfRange || drift > REBALANCE_THRESHOLD) {
    logEvent('sim_drift_detected', { currentTick, drift, threshold: REBALANCE_THRESHOLD, outOfRange })
    simPosition = {
      tickLower: align(currentTick - POSITION_RANGE),
      tickUpper: align(currentTick + POSITION_RANGE),
      center: currentTick,
      openedAt: new Date().toISOString(),
    }
    logEvent('sim_rebalance', { ...simPosition })
  } else {
    log('info', 'sim_position_in_range', { currentTick, drift, threshold: REBALANCE_THRESHOLD })
  }
}

// -----------------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------------

let stopping = false
let consecutiveErrors = 0
const MAX_CONSECUTIVE_ERRORS = 3
let cycleCount = 0

async function runCycle(owner: string | null): Promise<void> {
  const pool = await getPoolState()

  // Track tick history for volatility
  tickHistory.push({ ts: Date.now(), tick: pool.currentTick })
  if (tickHistory.length > VOLATILITY_WINDOW) tickHistory.shift()
  const { volatility, sampleSize } = calculateVolatility()

  const balance = owner ? await getSuiBalance(owner) : 0
  const usdcBalance = owner ? await getUsdcBalance(owner) : 0

  log('info', 'cycle', {
    mode: AGENT_MODE,
    tick: pool.currentTick,
    sqrtPrice: pool.currentSqrtPrice,
    balance: balance.toFixed(4),
    usdcBalance: usdcBalance.toFixed(4),
    volatility: volatility.toFixed(2),
    volatilitySamples: sampleSize,
  })
  if (owner) logEvent('balance_snapshot', { balance, usdcBalance })

  if (AGENT_MODE === 'monitor') {
    simulatePositionCheck(pool.currentTick, pool.tickSpacing)
    return
  }

  // Active mode — owner is non-null because main() resolved whoami() up front
  const positions = await getPositions(owner!)
  log('info', 'positions_found', { count: positions.length })

  if (positions.length === 0) {
    const sinceStartup = Date.now() - startupTime
    if (sinceStartup < STARTUP_COOLDOWN_MS) {
      log('info', 'startup_cooldown_active', {
        sinceStartupMs: sinceStartup, cooldownMs: STARTUP_COOLDOWN_MS,
      })
      return
    }
    log('info', 'no_active_positions_opening_initial')
    logEvent('no_positions_opening', {})
    await openInitialPosition(owner!, pool)
    return
  }

  cyclesTotal++
  for (const pos of positions) {
    const inRange = !needsRebalance(pos, pool.currentTick)
    if (inRange) {
      cyclesInRange++
      const center = Math.floor((pos.tickLower + pos.tickUpper) / 2)
      logEvent('position_status', {
        tickLower: pos.tickLower,
        tickUpper: pos.tickUpper,
        currentTick: pool.currentTick,
        drift: Math.abs(pool.currentTick - center),
        threshold: REBALANCE_THRESHOLD,
        liquidity: pos.liquidity,
        rangeWidth: pos.tickUpper - pos.tickLower,
        inRange: true,
        timeInRangePct: cyclesTotal > 0 ? Math.round((cyclesInRange / cyclesTotal) * 100) : 100,
        positionOpenedAt,
        rebalanceCount,
        totalGasSpent: totalGasSpent.toFixed(4),
        volatility: volatility.toFixed(2),
        volatilitySamples: sampleSize,
        adaptiveRange: getAdaptiveRange(pool.tickSpacing),
        baseRange: POSITION_RANGE,
      })
    } else {
      log('info', 'rebalancing')
      await rebalance(owner!, pool, pos)
    }
  }
}

async function main(): Promise<void> {
  // Phase 1 (monitor) is read-only — no signup needed. Resolve the WaaP wallet
  // address only when active mode will submit transactions.
  const owner = AGENT_MODE === 'active' ? await whoami() : null
  if (owner) cetus.senderAddress = owner

  log('info', 'agent_starting', {
    mode: AGENT_MODE,
    pool: POOL_ID,
    owner: owner ?? '(not required for monitor mode)',
    network: NETWORK,
    checkIntervalMs: CHECK_INTERVAL,
    positionRangeTicks: POSITION_RANGE,
    rebalanceThresholdTicks: REBALANCE_THRESHOLD,
    volatilityWindow: VOLATILITY_WINDOW,
    minRangeTicks: MIN_RANGE_TICKS,
    maxRangeTicks: MAX_RANGE_TICKS,
    maxDepositUsd: MAX_DEPOSIT_USD ?? null,
  })

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      log('info', 'shutdown_signal', { signal: sig })
      stopping = true
    })
  }

  // Initial yield scan happens before the main loop so the dashboard has data.
  await scanYields()

  while (!stopping) {
    try {
      await runCycle(owner)
      cycleCount++
      if (cycleCount % YIELD_SCAN_INTERVAL === 0) await scanYields()
      consecutiveErrors = 0
    } catch (err) {
      consecutiveErrors++
      const msg = err instanceof Error ? err.message : String(err)
      log('error', 'cycle_failed', { error: msg, consecutiveErrors })
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        const fatal = `${consecutiveErrors} consecutive failures. last: ${msg}. stopping.`
        log('error', 'too_many_consecutive_errors', { consecutiveErrors, fatal })
        await sendMatrixAlert(`CRITICAL: ${fatal}`)
        process.exit(1)
      } else {
        await sendMatrixAlert(`Error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${msg}`)
      }
    }
    if (stopping) break
    log('info', 'next_check', { inMs: CHECK_INTERVAL })
    // Chunked sleep so SIGTERM is honored within ~1s
    const slices = Math.max(1, Math.ceil(CHECK_INTERVAL / 1000))
    for (let i = 0; i < slices && !stopping; i++) {
      await new Promise((r) => setTimeout(r, Math.min(1000, CHECK_INTERVAL)))
    }
  }

  log('info', 'agent_stopped', {})
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err)
  log('error', 'fatal', { error: msg })
  await sendMatrixAlert(`FATAL: ${msg}`)
  process.exit(1)
})
