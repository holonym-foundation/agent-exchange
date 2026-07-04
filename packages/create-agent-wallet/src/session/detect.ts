import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

export interface WaapSession {
  address: string
  email?: string
}

export interface DetectOptions {
  home?: string
}

/**
 * Read the WaaP CLI session at `~/.waap-cli/session.json`. Returns null
 * when the file is missing or malformed. Intentionally permissive: we never
 * want detection to fail — absence is a valid state.
 */
export async function detectSession(
  opts: DetectOptions = {}
): Promise<WaapSession | null> {
  const home = opts.home ?? homedir()
  const path = resolve(home, '.waap-cli/session.json')
  try {
    const raw = await readFile(path, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      'address' in parsed &&
      typeof (parsed as { address: unknown }).address === 'string'
    ) {
      const obj = parsed as { address: string; email?: unknown }
      return {
        address: obj.address,
        email: typeof obj.email === 'string' ? obj.email : undefined
      }
    }
    return null
  } catch {
    return null
  }
}
