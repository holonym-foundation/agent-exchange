import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  readdir
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { copyTemplate, resolveOutputRel } from '../../src/scaffold/copy.js'
import { substituteVars } from '../../src/scaffold/vars.js'
import { writeEnvExample } from '../../src/scaffold/env.js'

let src: string
let dest: string

beforeEach(async () => {
  const base = await mkdtemp(resolve(tmpdir(), 'caw-scaffold-'))
  src = join(base, 'src')
  dest = join(base, 'dest')
  await mkdir(src, { recursive: true })
})

afterEach(async () => {
  await rm(src, { recursive: true, force: true }).catch(() => {})
  await rm(dest, { recursive: true, force: true }).catch(() => {})
})

describe('substituteVars', () => {
  it('replaces known vars', () => {
    expect(substituteVars('hello {{name}}', { name: 'world' })).toBe(
      'hello world'
    )
  })

  it('handles whitespace inside braces', () => {
    expect(substituteVars('{{ name }}', { name: 'x' })).toBe('x')
  })

  it('throws on undefined var', () => {
    expect(() => substituteVars('{{missing}}', {})).toThrow(/template variable/)
  })
})

describe('resolveOutputRel', () => {
  it('strips .tpl suffix', () => {
    expect(resolveOutputRel('pkg.json.tpl')).toEqual({
      outRel: 'pkg.json',
      isTpl: true
    })
  })
  it('rewrites dot- prefix', () => {
    expect(resolveOutputRel('dot-env.example')).toEqual({
      outRel: '.env.example',
      isTpl: false
    })
  })
  it('combines dot- prefix with .tpl', () => {
    expect(resolveOutputRel('dot-gitignore.tpl')).toEqual({
      outRel: '.gitignore',
      isTpl: true
    })
  })
  it('only touches the basename, not directory names', () => {
    expect(resolveOutputRel('dot-config/inner.txt')).toEqual({
      outRel: 'dot-config/inner.txt',
      isTpl: false
    })
  })
})

describe('copyTemplate', () => {
  beforeEach(async () => {
    await writeFile(
      join(src, 'package.json.tpl'),
      '{"name":"{{projectPkgName}}"}'
    )
    await writeFile(join(src, 'agent.ts'), 'console.log("verbatim")')
    await writeFile(join(src, 'dot-env.example'), 'FOO=bar\n')
    await mkdir(join(src, 'nested'), { recursive: true })
    await writeFile(join(src, 'nested/deep.md.tpl'), '# {{projectName}}')
  })

  it('substitutes into .tpl files, copies others verbatim', async () => {
    const count = await copyTemplate({
      from: src,
      to: dest,
      vars: { projectPkgName: 'my-agent', projectName: 'my-agent' }
    })
    expect(count).toBe(4)
    const pkg = await readFile(join(dest, 'package.json'), 'utf8')
    expect(pkg).toBe('{"name":"my-agent"}')
    const agent = await readFile(join(dest, 'agent.ts'), 'utf8')
    expect(agent).toBe('console.log("verbatim")')
    const deep = await readFile(join(dest, 'nested/deep.md'), 'utf8')
    expect(deep).toBe('# my-agent')
    const env = await readFile(join(dest, '.env.example'), 'utf8')
    expect(env).toBe('FOO=bar\n')
  })

  it('strips .tpl extension', async () => {
    await copyTemplate({
      from: src,
      to: dest,
      vars: { projectPkgName: 'x', projectName: 'x' }
    })
    const files = await readdir(dest)
    expect(files).toContain('package.json')
    expect(files).not.toContain('package.json.tpl')
  })

  it('creates parent directories as needed', async () => {
    await copyTemplate({
      from: src,
      to: dest,
      vars: { projectPkgName: 'x', projectName: 'x' }
    })
    const nested = await readdir(join(dest, 'nested'))
    expect(nested).toContain('deep.md')
  })
})

describe('writeEnvExample', () => {
  it('writes header + activity-specific vars', async () => {
    const projectDir = await mkdtemp(resolve(tmpdir(), 'caw-env-'))
    await writeEnvExample(
      projectDir,
      {
        slug: 'x',
        name: 'X',
        description: 'y',
        version: '0.1.0',
        author: 'a',
        verified: true,
        chain: { family: 'evm', id: 1, name: 'Ethereum' },
        category: 'trading',
        protocols: [],
        tags: [],
        runtimes: ['standalone'],
        envVars: [
          { key: 'API_URL', required: true, description: 'API endpoint' },
          {
            key: 'POLL_INTERVAL',
            required: false,
            default: '60000',
            description: 'ms between polls'
          }
        ],
        waapFeatures: [],
        recipeUrl: null,
        minCliVersion: '0.0.1'
      },
      { walletAddress: '0xabc' }
    )
    const text = await readFile(resolve(projectDir, '.env.example'), 'utf8')
    expect(text).toContain('# Wallet: 0xabc')
    expect(text).toContain('# API endpoint\nAPI_URL=')
    expect(text).toContain('# ms between polls\n# POLL_INTERVAL=60000')
    await rm(projectDir, { recursive: true, force: true })
  })
})
