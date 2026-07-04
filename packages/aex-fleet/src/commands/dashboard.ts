import { Command } from 'commander'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import { buildState, startServer } from '../dashboard/server.js'
import { renderShell } from '../dashboard/render.js'

// Mirror of server.ts resolveAsset — find a public/ asset for inlining into a static export.
function findAsset(rel: string): string | null {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 5; i++) {
    const c = join(dir, rel)
    if (existsSync(c)) return c
    dir = dirname(dir)
  }
  const docker = join('/opt/aex-fleet', rel)
  return existsSync(docker) ? docker : null
}

export function dashboardCommand(): Command {
  return new Command('dashboard')
    .description('Boot a local HTTP dashboard (or export a static HTML snapshot with --export)')
    .option('-p, --port <port>', 'Port to listen on', '3001')
    .option('--host <addr>', 'Address to bind to (default 127.0.0.1; pass 0.0.0.0 inside Docker)', '127.0.0.1')
    .option('--export <path>', 'Write a one-shot static HTML snapshot to <path> and exit')
    .option('--no-open', "Don't try to open the browser (always off when --export is set)")
    .addHelpText(
      'after',
      `
Examples:
  $ aex-fleet dashboard                       # boot at http://localhost:3001
  $ aex-fleet dashboard --port 8080
  $ aex-fleet dashboard --export ./dash.html  # static snapshot for sharing`
    )
    .action(async (opts: { port: string; host: string; export?: string; open?: boolean }) => {
      if (opts.export) {
        const state = await buildState()
        const cssPath = findAsset('public/app.css')
        const jsPath = findAsset('public/app.js')
        const inlineAssets =
          cssPath && jsPath
            ? { css: readFileSync(cssPath, 'utf8'), js: readFileSync(jsPath, 'utf8') }
            : undefined
        if (!inlineAssets) {
          console.error(pc.yellow('warning: public/app.{css,js} not found — export will reference /static/ instead of inlining'))
        }
        const html = renderShell(state, inlineAssets ? { inlineAssets } : {})
        writeFileSync(opts.export, html)
        console.log(pc.green(`wrote ${html.length} bytes to ${opts.export}`))
        return
      }
      const port = Number(opts.port)
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        console.error(pc.red(`Invalid port: ${opts.port}`))
        process.exit(2)
      }
      const server = await startServer(port, opts.host).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(pc.red(`Failed to start server on ${opts.host}:${port}: ${msg}`))
        process.exit(1)
      })
      const displayHost = opts.host === '0.0.0.0' ? 'localhost' : opts.host
      const url = `http://${displayHost}:${server.port}`
      console.log(pc.green(`aex-fleet dashboard listening on ${url} (bound ${opts.host})`))
      console.log(pc.dim('  (Ctrl-C to stop)'))
      if (opts.open !== false && opts.host === '127.0.0.1') {
        // Best-effort browser open; don't block or error if the open command is missing.
        const { execa } = await import('execa')
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
        execa(opener, [url], { stdio: 'ignore', detached: true, reject: false }).catch(() => undefined)
      }
      const shutdown = async (sig: NodeJS.Signals) => {
        console.log(pc.dim(`\nreceived ${sig} — shutting down…`))
        await server.close()
        process.exit(0)
      }
      process.on('SIGINT', () => void shutdown('SIGINT'))
      process.on('SIGTERM', () => void shutdown('SIGTERM'))
    })
}
