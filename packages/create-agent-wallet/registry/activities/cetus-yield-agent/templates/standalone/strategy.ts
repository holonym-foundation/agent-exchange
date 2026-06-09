// Range-decision strategy for the Cetus yield agent.
//
// Kept as a pure module (no IO, no SDK calls) so it is:
//   1. Easy to unit-test in isolation.
//   2. Easy to extend with new signals (fee tier, depth, yield-scan output,
//      external oracle) without touching agent.ts's IO loop.
//   3. The single place where "what range should we open?" is answered —
//      callers (initial open, rebalance reopen, future Phase 5 cross-pool)
//      just consume RangeDecision.

export interface TickSample {
  ts: number
  tick: number
}

export interface PoolStateForStrategy {
  currentTick: number
  tickSpacing: number
}

export interface YieldOption {
  poolId: string
  protocol: string
  symbol: string
  apy: number
  tvl: number
}

export interface YieldContext {
  currentPoolApy: number | null
  best: YieldOption | null
}

export interface RangeStrategyConfig {
  baseRangeTicks: number
  minRangeTicks: number
  maxRangeTicks: number
  volatilityMultiplier: number
  // Minimum number of tick samples before the adaptive branch kicks in.
  // Below this, fall back to baseRangeTicks.
  minSamplesForAdaptive: number
  openFraction: number
  reopenFraction: number
}

export type StrategyTrigger = 'open' | 'reopen'

export interface StrategyInput {
  pool: PoolStateForStrategy
  tickHistory: TickSample[]
  balances: { sui: number; usdc: number }
  trigger: StrategyTrigger
  config: RangeStrategyConfig
  yieldScan?: YieldContext
}

export interface RangeDecision {
  tickLower: number
  tickUpper: number
  centerTick: number
  halfWidth: number
  sizingFraction: number
  reason: string
  signals: {
    volatility: number
    volatilitySamples: number
    adaptive: boolean
  }
}

export interface VolatilityResult {
  volatility: number
  mean: number
  sampleSize: number
}

// Standard deviation of |tick_t - tick_{t-1}|. Pure function — exposed so the
// main loop can log volatility on every cycle without going through
// decideRange().
export function calculateVolatility(tickHistory: TickSample[]): VolatilityResult {
  if (tickHistory.length < 2) {
    return { volatility: 0, mean: 0, sampleSize: tickHistory.length }
  }
  const changes: number[] = []
  for (let i = 1; i < tickHistory.length; i++) {
    changes.push(Math.abs(tickHistory[i].tick - tickHistory[i - 1].tick))
  }
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length
  const variance = changes.reduce((a, b) => a + (b - mean) ** 2, 0) / changes.length
  return { volatility: Math.sqrt(variance), mean, sampleSize: tickHistory.length }
}

function snapDown(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing
}

function snapUp(tick: number, spacing: number): number {
  return Math.ceil(tick / spacing) * spacing
}

interface HalfWidthDecision {
  halfWidth: number
  volatility: number
  sampleSize: number
  adaptive: boolean
}

function decideHalfWidth(input: StrategyInput): HalfWidthDecision {
  const { config, pool, tickHistory } = input
  const { volatility, sampleSize } = calculateVolatility(tickHistory)

  if (sampleSize < config.minSamplesForAdaptive) {
    return { halfWidth: config.baseRangeTicks, volatility, sampleSize, adaptive: false }
  }

  // adaptive = volatility * multiplier * 2, clamped to [min, max], then
  // rounded up to a multiple of tickSpacing so the snapped lower/upper land
  // on valid Cetus ticks.
  const raw = Math.round(volatility * config.volatilityMultiplier * 2)
  const clamped = Math.max(config.minRangeTicks, Math.min(config.maxRangeTicks, raw))
  const snapped = snapUp(clamped, pool.tickSpacing)
  const halfWidth = snapped || config.baseRangeTicks
  return { halfWidth, volatility, sampleSize, adaptive: true }
}

// The single entry point for range / sizing decisions.
//
// Today this is volatility-driven with a fixed center (= currentTick) and
// a static open vs reopen fraction. Future signals (directional bias from
// recent drift, sizing scaled by yieldScan APY delta, asymmetric range for
// trending pools) plug in here without touching IO.
export function decideRange(input: StrategyInput): RangeDecision {
  const { pool, trigger, config } = input
  const { halfWidth, volatility, sampleSize, adaptive } = decideHalfWidth(input)

  const center = pool.currentTick
  const tickLower = snapDown(center - halfWidth, pool.tickSpacing)
  const tickUpper = snapUp(center + halfWidth, pool.tickSpacing)
  const sizingFraction = trigger === 'open' ? config.openFraction : config.reopenFraction

  const widthLabel = adaptive
    ? `adaptive halfWidth=${halfWidth} (vol=${volatility.toFixed(2)}, n=${sampleSize})`
    : `base halfWidth=${halfWidth} (only ${sampleSize}/${config.minSamplesForAdaptive} samples)`
  const sizeLabel = `${trigger}=${(sizingFraction * 100).toFixed(0)}% USDC`
  const reason = `${widthLabel}; ${sizeLabel}`

  return {
    tickLower,
    tickUpper,
    centerTick: center,
    halfWidth,
    sizingFraction,
    reason,
    signals: { volatility, volatilitySamples: sampleSize, adaptive },
  }
}
