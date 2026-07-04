import { describe, it, expect, beforeAll } from 'vitest'
import { execa } from 'execa'
import { resolve } from 'node:path'
import { mkdtemp, readFile, stat, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { buildRegistry } from '../../registry/build/build-registry.js'

const pkgRoot = resolve(__dirname, '../..')
const binPath = resolve(pkgRoot, 'dist/index.js')

let registryUrl: string

beforeAll(async () => {
  // Build CLI + generate registry for this test run.
  // `pnpm build` runs tsup + copy-registry, which populates dist/registry.json.
  // Keep this test honest by re-generating to a temp location.
  const tmpDir = await mkdtemp(resolve(tmpdir(), 'caw-reg-'))
  const regOut = resolve(tmpDir, 'registry.json')
  // buildRegistry resolves the activities directory by checking multiple
  // paths. In the monorepo, activities live at repo root agents/ directory.
  // Pass the repo root so it finds <root>/agents/.
  const repoRoot = resolve(pkgRoot, '../..')
  await buildRegistry({
    root: repoRoot,
    out: regOut
  })
  registryUrl = pathToFileURL(regOut).href
}, 60_000)

describe('scaffold blank-project (non-interactive)', () => {
  it('creates a standalone project with expected files', async () => {
    const workDir = await mkdtemp(resolve(tmpdir(), 'caw-int-std-'))
    try {
      const { exitCode } = await execa(
        'node',
        [
          binPath,
          '--activity',
          'blank-project',
          '--runtime',
          'standalone',
          '--no-session',
          '--no-cache',
          '--registry',
          registryUrl,
          '--yes',
          'my-agent'
        ],
        { cwd: workDir }
      )
      expect(exitCode).toBe(0)

      const projDir = resolve(workDir, 'my-agent')
      const pkg = JSON.parse(
        await readFile(resolve(projDir, 'package.json'), 'utf8')
      )
      expect(pkg.name).toBe('my-agent')

      const agent = await readFile(resolve(projDir, 'agent.ts'), 'utf8')
      expect(agent).toContain('[my-agent]')

      await stat(resolve(projDir, 'Dockerfile'))
      await stat(resolve(projDir, '.env.example'))
      await stat(resolve(projDir, '.gitignore'))

      // EIP-8004 registration artifacts
      const reg = JSON.parse(
        await readFile(resolve(projDir, 'agent-registration.json'), 'utf8')
      )
      expect(reg.type).toBe(
        'https://eips.ethereum.org/EIPS/eip-8004#registration-v1'
      )
      expect(reg.name).toBe('my-agent')
      expect(reg.active).toBe(true)
      expect(reg.supportedTrust).toContain('tee-attestation')
      expect(reg.registrations[0].agentId).toBe(
        '__TODO_AFTER_ON_CHAIN_REGISTRATION__'
      )

      const wellKnown = JSON.parse(
        await readFile(
          resolve(projDir, '.well-known/agent-registration.json'),
          'utf8'
        )
      )
      expect(wellKnown.type).toBe(reg.type)

      const files = await readdir(projDir)
      // No .tpl or dot- leftovers
      for (const f of files) {
        expect(f).not.toMatch(/\.tpl$/)
        expect(f).not.toMatch(/^dot-/)
      }
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  }, 30_000)

  it('creates a claude project with expected files', async () => {
    const workDir = await mkdtemp(resolve(tmpdir(), 'caw-int-claude-'))
    try {
      const { exitCode } = await execa(
        'node',
        [
          binPath,
          '--activity',
          'blank-project',
          '--runtime',
          'claude',
          '--no-session',
          '--no-cache',
          '--registry',
          registryUrl,
          '--yes',
          'claude-agent'
        ],
        { cwd: workDir }
      )
      expect(exitCode).toBe(0)
      const projDir = resolve(workDir, 'claude-agent')

      const skill = await readFile(resolve(projDir, 'SKILL.md'), 'utf8')
      expect(skill).toContain('claude-agent')

      const claudeMd = await readFile(resolve(projDir, 'CLAUDE.md'), 'utf8')
      expect(claudeMd).toContain('claude-agent')
      expect(claudeMd).toContain('Blank Project')

      await stat(resolve(projDir, 'mcp-config.json'))
      await stat(resolve(projDir, '.env.example'))
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  }, 30_000)

  it('exits non-zero on unknown activity slug', async () => {
    const workDir = await mkdtemp(resolve(tmpdir(), 'caw-int-bad-'))
    try {
      const result = await execa(
        'node',
        [
          binPath,
          '--activity',
          'does-not-exist',
          '--runtime',
          'standalone',
          '--no-session',
          '--no-cache',
          '--registry',
          registryUrl,
          '--yes',
          'should-fail'
        ],
        { cwd: workDir, reject: false }
      )
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr + result.stdout).toMatch(/activity not found/i)
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  }, 30_000)
})
