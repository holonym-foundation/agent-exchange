import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export class RecoveryRequiredError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RecoveryRequiredError'
  }
}

export interface ExecutionIntent {
  phase: 'remove_pending' | 'open_pending' | 'initial_open_pending'
  ts: string
  owner: string
  poolId: string
  network: 'mainnet' | 'testnet'
  trigger: 'rebalance' | 'initial'
  originalPosId?: string
  removeTxHash?: string
  plannedTickLower?: number
  plannedTickUpper?: number
  plannedSizingFraction?: number
  submission?: { label: string; kindSha256: string; txHash?: string }
}

/** Durable local journal. It is not a wallet authorization boundary. */
export class IntentJournal {
  readonly file: string
  constructor(file: string) { this.file = path.resolve(file) }

  private syncDirectory(): void {
    const fd = fs.openSync(path.dirname(this.file), 'r')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  }

  read(): ExecutionIntent | null {
    let raw: string
    try { raw = fs.readFileSync(this.file, 'utf8') }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new RecoveryRequiredError('Cannot read execution intent; reconcile before resuming', { cause })
    }
    try {
      const intent = JSON.parse(raw) as ExecutionIntent
      if (!intent || !['remove_pending', 'open_pending', 'initial_open_pending'].includes(intent.phase)
        || !['rebalance', 'initial'].includes(intent.trigger) || typeof intent.ts !== 'string'
        || typeof intent.owner !== 'string' || typeof intent.poolId !== 'string'
        || !['mainnet', 'testnet'].includes(intent.network)) {
        throw new Error('Invalid execution intent')
      }
      return intent
    } catch (cause) {
      throw new RecoveryRequiredError('Invalid execution intent; preserve it for reconciliation', { cause })
    }
  }

  write(intent: ExecutionIntent): void {
    const temporary = `${this.file}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      fd = fs.openSync(temporary, 'wx', 0o600)
      fs.writeFileSync(fd, JSON.stringify(intent, null, 2))
      fs.fsyncSync(fd)
      fs.closeSync(fd)
      fd = undefined
      fs.renameSync(temporary, this.file)
      this.syncDirectory()
    } catch (cause) {
      throw new RecoveryRequiredError('Cannot durably save execution intent; no further submission permitted', { cause })
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
      try { fs.unlinkSync(temporary) } catch { /* Only a temporary file; never remove the intent. */ }
    }
  }

  clear(): void {
    try { fs.unlinkSync(this.file); this.syncDirectory() }
    catch (cause) {
      throw new RecoveryRequiredError('Cannot durably clear execution intent; reconcile before resuming', { cause })
    }
  }

  assertClear(): void {
    if (this.read()) throw new RecoveryRequiredError(`Pending execution in ${this.file}; reconcile its exact outcome before resuming`)
  }

  /** No stale-lock timeout: an interrupted owner may have submitted a transaction. */
  acquire(): () => void {
    const lock = `${this.file}.lock`
    try { fs.mkdirSync(lock, { mode: 0o700 }) }
    catch (cause) { throw new RecoveryRequiredError(`Cannot acquire ${lock}; stop duplicate processes and reconcile stale state`, { cause }) }
    try {
      fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 })
      this.syncDirectory()
    } catch (cause) {
      // Retain the lock on uncertainty; no automatic stealing or cleanup.
      throw new RecoveryRequiredError('Cannot persist execution lock', { cause })
    }
    return () => { fs.rmSync(lock, { recursive: true }); this.syncDirectory() }
  }
}

/** WaaP 2.2.1 accepts Sui TransactionKind input and prepares sender/gas remotely. */
export async function encodeTransactionKind(
  tx: { build(options: { client: any; onlyTransactionKind: true }): Promise<Uint8Array> },
  client: unknown,
): Promise<string> {
  return Buffer.from(await tx.build({ client, onlyTransactionKind: true })).toString('base64')
}

/** A process exit or progress event is not a successful submission receipt. */
export function parseSubmissionReceipt(stdout: string): string {
  const results: Array<Record<string, unknown>> = []
  for (const line of stdout.split(/\r?\n/).filter((line) => line.trim())) {
    let event: Record<string, unknown>
    try { event = JSON.parse(line) } catch (cause) {
      throw new RecoveryRequiredError('Malformed WaaP submission output; outcome is uncertain', { cause })
    }
    if (!event || typeof event !== 'object' || event.event === 'error') {
      throw new RecoveryRequiredError('WaaP reported an uncertain submission')
    }
    if (event.event === 'result') results.push(event)
  }
  const result = results[0]
  const digest = result?.txHash ?? result?.digest
  if (results.length !== 1 || typeof digest !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(digest)
    || (result.txHash !== undefined && result.digest !== undefined && result.txHash !== result.digest)) {
    throw new RecoveryRequiredError('Missing or conflicting WaaP transaction digest; outcome is uncertain')
  }
  return digest
}
