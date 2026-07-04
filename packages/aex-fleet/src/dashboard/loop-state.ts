import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getConfigDir } from '../core/config.js'

export interface PerpetualLoopState {
  totalHops: number
  lastHopAt: string
  lastTxHash: string
  lastStatus: string
  lastError: string
  paused: boolean
  amount: string
  delay: number
  chainId: number
}

export function statePath(): string {
  return join(getConfigDir(), 'perpetual-pass.state.json')
}

export function pausePath(): string {
  return join(getConfigDir(), 'perpetual-pass.paused')
}

export function logPath(): string {
  return join(getConfigDir(), 'perpetual-pass.log.jsonl')
}

export interface TxLogEntry {
  ts: string
  src: string
  dst: string
  amount: string
  chainId: number
  txHash: string
  status: string
  error: string
}

/**
 * Read the last `limit` entries from the perpetual loop's JSONL tx log. Reverse-chronological
 * (newest first). Returns [] if the log doesn't exist yet.
 */
export function readRecentTxLog(limit = 50): TxLogEntry[] {
  const p = logPath()
  if (!existsSync(p)) return []
  // Read tail efficiently — for v1 just read the whole file. With the 10MB cap in the loop
  // script, this is at most a few thousand lines / few hundred KB. Optimize later if needed.
  const raw = readFileSync(p, 'utf8').split('\n').filter(Boolean)
  const recent = raw.slice(-limit).reverse()
  const out: TxLogEntry[] = []
  for (const line of recent) {
    try {
      out.push(JSON.parse(line) as TxLogEntry)
    } catch {
      // skip malformed
    }
  }
  return out
}

export function readLoopState(): { state: PerpetualLoopState | null; isPauseFilePresent: boolean } {
  const p = statePath()
  const isPauseFilePresent = existsSync(pausePath())
  if (!existsSync(p)) return { state: null, isPauseFilePresent }
  try {
    const state = JSON.parse(readFileSync(p, 'utf8')) as PerpetualLoopState
    return { state, isPauseFilePresent }
  } catch {
    return { state: null, isPauseFilePresent }
  }
}

export function setPause(paused: boolean): { paused: boolean; pauseFile: string } {
  const p = pausePath()
  if (paused) {
    writeFileSync(p, '', { mode: 0o600 })
  } else if (existsSync(p)) {
    unlinkSync(p)
  }
  return { paused, pauseFile: p }
}
