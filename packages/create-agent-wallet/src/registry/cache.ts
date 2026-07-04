import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface CacheEntry<T> {
  savedAt: number
  payload: T
}

export class FilesystemCache<T> {
  constructor(
    private readonly dir: string,
    private readonly filename: string
  ) {}

  private path(): string {
    return resolve(this.dir, this.filename)
  }

  async read(): Promise<CacheEntry<T> | null> {
    try {
      const raw = await readFile(this.path(), 'utf8')
      return JSON.parse(raw) as CacheEntry<T>
    } catch {
      return null
    }
  }

  async write(payload: T): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const entry: CacheEntry<T> = { savedAt: Date.now(), payload }
    await writeFile(this.path(), JSON.stringify(entry, null, 2))
  }

  async ageMs(): Promise<number | null> {
    try {
      const s = await stat(this.path())
      return Date.now() - s.mtimeMs
    } catch {
      return null
    }
  }
}
