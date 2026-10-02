import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const templateDir = path.resolve(__dirname, '../../registry/activities/cetus-yield-agent/templates/standalone')
const executionSource = fs.readFileSync(path.join(templateDir, 'execution.ts.tpl'), 'utf8')
const agentSource = fs.readFileSync(path.join(templateDir, 'agent.ts.tpl'), 'utf8')
const require = createRequire(import.meta.url)

// Compile the shipped template itself. No separately maintained execution implementation.
function loadExecution() {
  const code = ts.transpileModule(executionSource, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText
  const exports: Record<string, any> = {}
  vm.runInNewContext(code, { exports, require, process, Buffer })
  return exports
}
const { IntentJournal, RecoveryRequiredError, encodeTransactionKind, parseSubmissionReceipt } = loadExecution()

// Execute actual agent functions with controlled broker/chain effects. Importing the whole
// agent would start its main loop. AST extraction keeps the tested bodies identical to shipping.
function agentFunctions(names: string[], dependencies: Record<string, unknown>) {
  const ast = ts.createSourceFile('agent.ts', agentSource, ts.ScriptTarget.Latest, true)
  const bodies = names.map(name => {
    const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    if (!node) throw new Error(`Missing shipped function ${name}`)
    return node.getText(ast)
  }).join('\n')
  const code = ts.transpileModule(bodies, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return vm.runInNewContext(`${code}; ({${names.join(',')}})`, { Buffer, createHash, RecoveryRequiredError,
    encodeTransactionKind, parseSubmissionReceipt, ...dependencies })
}
const intent = () => ({ phase: 'initial_open_pending', trigger: 'initial', owner: '0x1', poolId: '0x2', network: 'testnet', ts: '2026-01-01T00:00:00Z' })
const digest = '11111111111111111111111111111111'

describe('Cetus durable execution journal', () => {
  let root: string
  let journal: any
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'cetus-journal-'))
    journal = new IntentJournal(path.join(root, 'intent.json'))
  })
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }) })

  it('persists a private intent and refuses it after restart until explicitly cleared', () => {
    expect(journal.read()).toBeNull()
    journal.write(intent())
    expect(fs.statSync(journal.file).mode & 0o777).toBe(0o600)
    const restarted = new IntentJournal(journal.file)
    expect(() => restarted.assertClear()).toThrow('Pending execution')
    restarted.clear()
    expect(restarted.read()).toBeNull()
  })

  it.each(['openSync', 'writeFileSync', 'fsyncSync', 'renameSync'])('refuses execution after %s persistence failure', (method) => {
    vi.spyOn(fs, method as any).mockImplementation(() => { throw new Error('injected persistence failure') })
    expect(() => journal.write(intent())).toThrow('Cannot durably save')
  })

  it('retains the previous intent when atomic replacement fails', () => {
    journal.write(intent())
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('injected rename failure') })
    expect(() => journal.write({ ...intent(), phase: 'open_pending' })).toThrow('Cannot durably save')
    expect(journal.read().phase).toBe('initial_open_pending')
  })

  it.each(['{broken', '{}', 'null', '{"phase":"unknown"}'])('rejects damaged state %s', raw => {
    fs.writeFileSync(journal.file, raw)
    expect(() => journal.read()).toThrow('Invalid execution intent')
  })

  it('does not interpret permission errors as an absent intent', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) })
    expect(() => journal.read()).toThrow('Cannot read execution intent')
  })

  it('fails closed when clearing fails', () => {
    journal.write(intent())
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('denied') })
    expect(() => journal.clear()).toThrow('Cannot durably clear')
    expect(journal.read()).toEqual(intent())
  })

  it('rejects another active process and never steals an abandoned lock', () => {
    const release = journal.acquire()
    const another = new IntentJournal(journal.file)
    expect(() => another.acquire()).toThrow('Cannot acquire')
    release()
    const releaseAgain = another.acquire()
    releaseAgain()
  })

  it('dry-run wrappers cannot overwrite or clear live recovery state', () => {
    journal.write(intent())
    const api = agentFunctions(['writeIntent', 'clearIntent'], { DRY_RUN: true, intentJournal: journal, log: vi.fn() })
    api.writeIntent({ ...intent(), phase: 'open_pending' })
    api.clearIntent()
    expect(journal.read()).toEqual(intent())
  })

  it('never uses the existence of a position to clear pending execution', async () => {
    journal.write(intent())
    const getPositions = vi.fn(async () => [{ posId: 'unrelated-position' }])
    const api = agentFunctions(['reconcileIntent'], { DRY_RUN: false, intentJournal: journal, getPositions })
    await expect(api.reconcileIntent('owner')).rejects.toThrow('Pending execution')
    expect(getPositions).not.toHaveBeenCalled()
    expect(journal.read()).toEqual(intent())
  })

  it('blocks another cycle and another rebalance while execution remains pending', async () => {
    journal.write(intent())
    const getPoolState = vi.fn()
    const api = agentFunctions(['runCycle', 'rebalance', 'openInitialPosition'], {
      AGENT_MODE: 'active', DRY_RUN: false, intentJournal: journal, getPoolState,
    })
    await expect(api.runCycle('owner')).rejects.toThrow('Pending execution')
    await expect(api.rebalance('owner', {}, {})).rejects.toThrow('Pending execution')
    await expect(api.openInitialPosition('owner', {})).rejects.toThrow('Pending execution')
    expect(getPoolState).not.toHaveBeenCalled()
  })

  it.each(['timeout', 'malformed', 'missing-digest'])('retains pending state on %s without another submission', async mode => {
    journal.write(intent())
    const execa = vi.fn(async () => {
      if (mode === 'timeout') throw new Error('timeout after possible broadcast')
      return { stdout: mode === 'malformed' ? 'Transaction submitted: unknown' : '{"event":"result"}' }
    })
    const api = agentFunctions(['signAndSendTx', 'readIntent', 'writeIntent'], {
      DRY_RUN: false, NETWORK: 'testnet', chain: {}, intentJournal: journal, log: vi.fn(), execa,
    })
    const tx = { build: vi.fn(async () => new Uint8Array([0, 1])) }
    await expect(api.signAndSendTx(tx)).rejects.toThrow('reconciliation')
    await expect(api.signAndSendTx(tx)).rejects.toThrow('attempt already exists')
    expect(execa).toHaveBeenCalledTimes(1)
    expect(journal.read().submission.kindSha256).toHaveLength(64)
    expect(() => new IntentJournal(journal.file).assertClear()).toThrow('Pending execution')
  })

  it('does not invoke WaaP when the submission intent cannot be saved', async () => {
    journal.write(intent())
    const execa = vi.fn()
    vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw new Error('disk failure') })
    const api = agentFunctions(['signAndSendTx', 'readIntent', 'writeIntent'], {
      DRY_RUN: false, NETWORK: 'testnet', chain: {}, intentJournal: journal, log: vi.fn(), execa,
    })
    await expect(api.signAndSendTx({ build: async () => new Uint8Array([0]) })).rejects.toThrow('Cannot durably save')
    expect(execa).not.toHaveBeenCalled()
  })

  it.each(['failure', 'wait_error', 'no_digest'])('does not clear initial-open intent on finality %s', async status => {
    const finality = vi.fn(async () => ({ success: false, status }))
    const api = agentFunctions(['openInitialPosition', 'openLiquidityFromDecision', 'writeIntent', 'clearIntent'], {
      DRY_RUN: false, NETWORK: 'testnet', POOL_ID: '0x2', USDC_TYPE: 'usdc', MAX_DEPOSIT_USD: 100,
      intentJournal: journal, getSuiBalance: async () => 10, getUsdcBalance: async () => 10,
      decideRange: () => ({ tickLower: 1, tickUpper: 2, sizingFraction: 0.5, halfWidth: 1 }),
      tickHistory: [], STRATEGY_CONFIG: {}, log: vi.fn(), logEvent: vi.fn(),
      chain: { core: { getBalance: async () => ({ balance: { balance: '1000000' } }) } },
      BN: class { constructor(_value: unknown) {} },
      ClmmPoolUtil: { estLiquidityAndCoinAmountFromOneAmounts: () => ({ coin_amount_limit_a: '500000', coin_amount_limit_b: '1000000' }) },
      TickMath: { sqrtPriceX64ToPrice: () => ({ toNumber: () => 1 }) },
      cetus: { Position: { createAddLiquidityFixTokenPayload: async () => ({ setSender: () => {} }) } },
      signAndSendTx: async () => digest, waitForFinality: finality,
    })
    await expect(api.openInitialPosition('0x1', { coinTypeA: 'usdc', currentSqrtPrice: '1' })).rejects.toThrow('Open did not finalize')
    expect(finality).toHaveBeenCalledOnce()
    expect(journal.read().phase).toBe('initial_open_pending')
    expect(() => new IntentJournal(journal.file).assertClear()).toThrow('Pending execution')
  })

  it('records a valid receipt and retains intent until finality, sending bytes on stdin', async () => {
    journal.write(intent())
    const execa = vi.fn(async () => ({ stdout: JSON.stringify({ event: 'result', txHash: digest }) }))
    const api = agentFunctions(['signAndSendTx', 'readIntent', 'writeIntent'], {
      DRY_RUN: false, NETWORK: 'testnet', chain: {}, intentJournal: journal, log: vi.fn(), execa,
    })
    expect(await api.signAndSendTx({ build: async () => new Uint8Array([0]) })).toBe(digest)
    expect(journal.read().submission.txHash).toBe(digest)
    expect(execa.mock.calls[0]).toEqual(['waap-cli', ['send-tx', '--tx', '-', '--tx-format', 'base64', '--chain', 'sui:testnet', '--json'], { input: 'AA==', timeout: 120000 }])
  })
})

describe('Cetus transaction encoding and receipts', () => {
  it('encodes actual Sui TransactionKind, not full TransactionData', async () => {
    const tx = new Transaction()
    tx.setSender('0x1'); tx.setGasBudget(1000000); tx.setGasPrice(1000)
    tx.setGasPayment([{ objectId: '0x2', version: '1', digest }])
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1)])
    tx.transferObjects([coin], tx.pure.address('0x3'))
    const bytes = Buffer.from(await encodeTransactionKind(tx, undefined), 'base64')
    expect(Buffer.from(bcs.TransactionKind.serialize(bcs.TransactionKind.parse(bytes)).toBytes())).toEqual(bytes)
    expect(bytes).not.toEqual(Buffer.from(await tx.build()))
  })

  it.each(['', '{"event":"progress"}', '{"event":"result","txHash":"bad"}',
    JSON.stringify({ event: 'result', txHash: digest, digest: '22222222222222222222222222222222' }),
    JSON.stringify({ event: 'result', txHash: digest }) + '\n' + JSON.stringify({ event: 'error' }),
    JSON.stringify({ event: 'result', txHash: digest }) + '\n' + JSON.stringify({ event: 'result', txHash: digest }),
  ])('rejects an ambiguous receipt %s', stdout => { expect(() => parseSubmissionReceipt(stdout)).toThrow() })

  it.each(['failure', 'network'])('never returns successful simulation after %s', async mode => {
    const simulateTransaction = vi.fn(async () => {
      if (mode === 'network') throw new Error('network failure')
      return { $kind: 'FailedTransaction', FailedTransaction: { status: { success: false, error: 'Move abort' } } }
    })
    const api = agentFunctions(['simulateTx', 'stringifyExecutionError'], { chain: { simulateTransaction }, log: vi.fn(), logEvent: vi.fn() })
    await expect(api.simulateTx({}, 'test')).rejects.toThrow()
  })
})
