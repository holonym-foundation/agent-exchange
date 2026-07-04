import { Command, Option } from 'commander'
import { run } from './main.js'
import { CawError, ExitCodes } from './util/errors.js'
import { log } from './util/logger.js'
import type { Runtime } from './registry/types.js'

const PKG_VERSION = '0.0.1'

export function buildProgram(): Command {
  const program = new Command()
  program
    .name('create-agent-wallet')
    .description('Scaffold a WaaP agent project in 3 minutes')
    .version(PKG_VERSION)
    .argument('[project-name]', 'directory name for the generated project')
    .option('-a, --activity <slug>', 'activity slug (skips browse prompt)')
    .addOption(
      new Option('-r, --runtime <runtime>', 'runtime template').choices([
        'claude',
        'standalone',
        'openclaw',
        'nous'
      ])
    )
    .option('--no-session', 'skip WaaP session detection and signup')
    .option('--registry <url>', 'override registry URL (http(s):// or file://)')
    .option('--no-cache', 'bypass the registry cache')
    .option(
      '-y, --yes',
      'accept defaults; fail non-zero on missing required args'
    )
    .action(async (projectName: string | undefined, rawOpts: CliRawOptions) => {
      try {
        await run({
          projectName,
          activitySlug: rawOpts.activity,
          runtime: rawOpts.runtime as Runtime | undefined,
          noSession: rawOpts.session === false,
          registryUrl: rawOpts.registry,
          noCache: rawOpts.cache === false,
          nonInteractive: Boolean(rawOpts.yes),
          cliVersion: PKG_VERSION
        })
      } catch (err) {
        handleError(err)
      }
    })
  return program
}

interface CliRawOptions {
  activity?: string
  runtime?: string
  /** Commander uses the positive form for --no-* options. */
  session?: boolean
  registry?: string
  cache?: boolean
  yes?: boolean
}

function handleError(err: unknown): never {
  if (err instanceof CawError) {
    log.error(err.message)
    process.exit(err.code)
  }
  if (err instanceof Error) {
    log.error(err.message)
    process.exit(ExitCodes.GENERIC)
  }
  log.error(String(err))
  process.exit(ExitCodes.GENERIC)
}

export function cliEntry(argv: string[] = process.argv): void {
  buildProgram().parse(argv)
}
