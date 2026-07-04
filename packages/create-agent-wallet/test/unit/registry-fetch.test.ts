import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createFetchRegistry } from '../../src/registry/fetch.js'

const sampleActivity = {
  slug: 'blank-project',
  name: 'Blank',
  description: 'x',
  version: '0.1.0',
  author: 'h',
  verified: true,
  chain: { family: 'any', id: null, name: 'Any' },
  category: 'setup',
  protocols: [],
  tags: [],
  runtimes: ['standalone'],
  envVars: [],
  waapFeatures: [],
  recipeUrl: null,
  minCliVersion: '0.0.1'
}

const samplePayload = {
  version: '0.1.0',
  generatedAt: new Date().toISOString(),
  activities: [sampleActivity]
}

function mockFetch(payload: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload
  }) as unknown as typeof fetch
}

function failingFetch() {
  return vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch
}

let cacheDir: string

beforeEach(async () => {
  cacheDir = await mkdtemp(resolve(tmpdir(), 'caw-cache-'))
})

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true })
})

describe('fetchRegistry', () => {
  it('fetches on first call and hits cache on second within TTL', async () => {
    const fetchImpl = mockFetch(samplePayload)
    const fetchRegistry = createFetchRegistry({
      url: 'https://example.com/registry.json',
      cacheDir,
      ttlMs: 60_000,
      fetchImpl
    })
    const first = await fetchRegistry()
    const second = await fetchRegistry()
    expect(first.activities[0].slug).toBe('blank-project')
    expect(second.activities[0].slug).toBe('blank-project')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('throws CawError if fetch fails and no cache exists', async () => {
    const fetchRegistry = createFetchRegistry({
      url: 'https://example.com/registry.json',
      cacheDir,
      ttlMs: 60_000,
      fetchImpl: failingFetch()
    })
    await expect(fetchRegistry()).rejects.toThrow(/registry unavailable/i)
  })

  it('falls back to stale cache when network fails', async () => {
    const ok = createFetchRegistry({
      url: 'https://example.com/registry.json',
      cacheDir,
      ttlMs: 1,
      fetchImpl: mockFetch(samplePayload)
    })
    await ok()
    await new Promise((r) => setTimeout(r, 10))
    const fail = createFetchRegistry({
      url: 'https://example.com/registry.json',
      cacheDir,
      ttlMs: 1,
      fetchImpl: failingFetch()
    })
    const result = await fail()
    expect(result.activities).toHaveLength(1)
  })

  it('reads from file:// URL without hitting network', async () => {
    const localDir = await mkdtemp(resolve(tmpdir(), 'caw-local-'))
    const regPath = resolve(localDir, 'registry.json')
    await writeFile(regPath, JSON.stringify(samplePayload))
    const fetchImpl = vi.fn()
    const fetchRegistry = createFetchRegistry({
      url: pathToFileURL(regPath).href,
      cacheDir,
      ttlMs: 60_000,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    const result = await fetchRegistry()
    expect(result.activities[0].slug).toBe('blank-project')
    expect(fetchImpl).not.toHaveBeenCalled()
    await rm(localDir, { recursive: true, force: true })
  })

  it('rejects malformed registry payload', async () => {
    const fetchRegistry = createFetchRegistry({
      url: 'https://example.com/registry.json',
      cacheDir,
      ttlMs: 60_000,
      fetchImpl: mockFetch({ activities: 'not an array' })
    })
    await expect(fetchRegistry()).rejects.toThrow()
  })
})

// silence unused import warning from mkdir
void mkdir
