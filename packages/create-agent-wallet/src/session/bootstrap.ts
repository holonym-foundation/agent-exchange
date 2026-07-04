import { execa } from 'execa'
import { confirm, text, password, isCancel, spinner } from '@clack/prompts'
import { detectSession, type WaapSession } from './detect.js'
import { CawError, ExitCodes } from '../util/errors.js'

export interface BootstrapOptions {
  /**
   * If true, skips the interactive signup prompt and returns the detected
   * session (or null). Used by --non-interactive / --no-session flows.
   */
  skipInteractive?: boolean
  /**
   * Path to the waap-cli binary. Defaults to the one on PATH.
   */
  waapCliBin?: string
}

/**
 * Ensures a WaaP session exists. If the user already has one, returns it.
 * Otherwise prompts to create one inline via `waap-cli signup`.
 *
 * Returns null when:
 *   - No session found AND skipInteractive is true
 *   - User declines the signup prompt
 *   - User cancels any prompt (Ctrl-C)
 */
export async function ensureSession(
  opts: BootstrapOptions = {}
): Promise<WaapSession | null> {
  const existing = await detectSession()
  if (existing) return existing
  if (opts.skipInteractive) return null

  const proceed = await confirm({
    message: 'No WaaP session found. Create an agent wallet now?',
    initialValue: true
  })
  if (isCancel(proceed) || !proceed) return null

  const email = await text({
    message: 'Email',
    validate: (v) =>
      typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
        ? undefined
        : 'Enter a valid email address.'
  })
  if (isCancel(email)) return null

  const pw = await password({
    message: 'Password (used by waap-cli signup)',
    validate: (v) =>
      typeof v === 'string' && v.length >= 8
        ? undefined
        : 'Password must be at least 8 characters.'
  })
  if (isCancel(pw)) return null

  const signupArgs = [
    'signup',
    '--email',
    email as string,
    '--password',
    pw as string
  ]

  const s = spinner()
  s.start('Creating WaaP wallet')
  try {
    await execa(opts.waapCliBin ?? 'waap-cli', signupArgs)
    s.stop('Wallet created')
  } catch (err) {
    if (isCommandNotFound(err)) {
      // waap-cli not on PATH — fall back to `npx` which will fetch it.
      s.message('waap-cli not installed — fetching via npx (first run only)')
      try {
        await execa('npx', ['-y', '@human.tech/waap-cli', ...signupArgs])
        s.stop('Wallet created (via npx)')
      } catch (npxErr) {
        s.stop('Wallet creation failed')
        throw new CawError(
          `waap-cli signup failed via npx fallback: ${npxErr instanceof Error ? npxErr.message : String(npxErr)}. Install it manually: npm install -g @human.tech/waap-cli`,
          ExitCodes.SESSION_FAILED
        )
      }
    } else {
      s.stop('Wallet creation failed')
      throw new CawError(
        `waap-cli signup failed: ${err instanceof Error ? err.message : String(err)}`,
        ExitCodes.SESSION_FAILED
      )
    }
  }

  return detectSession()
}

/**
 * Detect "command not found" style errors from execa. Covers both ENOENT
 * (binary not on PATH) and 127 exit codes (shell-style not-found).
 */
function isCommandNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; exitCode?: number; errno?: number }
  return e.code === 'ENOENT' || e.exitCode === 127
}
