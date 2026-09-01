import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { FilesystemCache } from './cache.js'
import { RegistrySchema, type Registry } from './types.js'
import { CawError, ExitCodes } from '../util/errors.js'

export interface FetchRegistryOptions {
  url: string
  cacheDir: string
  ttlMs: number
  fetchImpl?: typeof globalThis.fetch
}

export type FetchRegistry = () => Promise<Registry>

/**
 * Returns a fetchRegistry function. Strategy:
 *   1. If cache present and fresh → return cached
 *   2. Otherwise fetch from URL, validate, write cache, return
 *   3. If network fails but stale cache exists → return stale (log warn)
 *   4. If network fails and no cache → throw CawError
 *
 * `file://` URLs are supported — useful for tests and for bundled/fallback
 * local registry shipped with the package.
 */
export function createFetchRegistry(opts: FetchRegistryOptions): FetchRegistry {
  const cache = new FilesystemCache<Registry>(opts.cacheDir, 'registry.json')
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch

  async function readLocal(fileUrl: string): Promise<Registry> {
    const path = fileURLToPath(fileUrl)
    const raw = JSON.parse(await readFile(path, 'utf8'))
    return RegistrySchema.parse(raw)
  }

  return async function fetchRegistry(): Promise<Registry> {
    // A bundled file is versioned with the installed package and is therefore
    // authoritative. Never let a cache written by an older CLI release mask it.
    if (opts.url.startsWith('file://')) {
      return readLocal(opts.url)
    }

    // ttlMs=0 is a real cache bypass: do not read or fall back to stale data.
    const cached = opts.ttlMs > 0 ? await cache.read() : null
    const age = opts.ttlMs > 0 ? await cache.ageMs() : null
    const fresh = age !== null && age < opts.ttlMs
    if (cached && fresh) return cached.payload

    try {
      let data: unknown
      const res = await fetchImpl(opts.url)
      if (!res.ok) throw new Error(`registry HTTP ${res.status}`)
      data = await res.json()
      const parsed = RegistrySchema.parse(data)
      await cache.write(parsed)
      return parsed
    } catch (err) {
      if (cached) return cached.payload
      const detail = err instanceof Error ? err.message : String(err)
      throw new CawError(
        `registry unavailable and no cache present: ${detail}`,
        ExitCodes.NETWORK
      )
    }
  }
}
