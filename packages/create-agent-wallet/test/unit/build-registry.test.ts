import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, readFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildRegistry } from '../../registry/build/build-registry.js'

let root: string
let out: string

const validActivity = {
  slug: 'blank-project',
  name: 'Blank Project',
  description: 'test',
  version: '0.1.0',
  author: 'test',
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

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'caw-build-'))
  out = resolve(root, 'dist/registry.json')
  await mkdir(resolve(root, 'activities/blank-project'), { recursive: true })
  await writeFile(
    resolve(root, 'activities/blank-project/activity.json'),
    JSON.stringify(validActivity)
  )
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe('buildRegistry', () => {
  it('aggregates activities into registry.json', async () => {
    await buildRegistry({ root, out })
    const reg = JSON.parse(await readFile(out, 'utf8'))
    expect(reg.activities).toHaveLength(1)
    expect(reg.activities[0].slug).toBe('blank-project')
    expect(reg.version).toBe('0.1.0')
    expect(reg.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('sorts activities by slug', async () => {
    await mkdir(resolve(root, 'activities/aaa-first'), { recursive: true })
    await writeFile(
      resolve(root, 'activities/aaa-first/activity.json'),
      JSON.stringify({ ...validActivity, slug: 'aaa-first' })
    )
    await buildRegistry({ root, out })
    const reg = JSON.parse(await readFile(out, 'utf8'))
    expect(reg.activities.map((a: { slug: string }) => a.slug)).toEqual([
      'aaa-first',
      'blank-project'
    ])
  })

  it('throws on invalid activity.json', async () => {
    await writeFile(
      resolve(root, 'activities/blank-project/activity.json'),
      JSON.stringify({ slug: 'blank-project' })
    )
    await expect(buildRegistry({ root, out })).rejects.toThrow(
      /schema validation failed/
    )
  })

  it('throws when slug does not match directory name', async () => {
    await writeFile(
      resolve(root, 'activities/blank-project/activity.json'),
      JSON.stringify({ ...validActivity, slug: 'wrong-slug' })
    )
    await expect(buildRegistry({ root, out })).rejects.toThrow(
      /does not match directory name/
    )
  })

  it('reproduces registry bytes using the source epoch despite different build times', async () => {
    vi.stubEnv('SOURCE_DATE_EPOCH', '1767225600')
    await buildRegistry({ root, out })
    const first = await readFile(out, 'utf8')
    expect(JSON.parse(first).generatedAt).toBe('2026-01-01T00:00:00.000Z')
    await buildRegistry({ root, out })
    expect(await readFile(out, 'utf8')).toBe(first)
  })

  it.each(['', '-1', '1.5', 'invalid', '999999999999999999999999'])('rejects invalid source epoch %j', async epoch => {
    vi.stubEnv('SOURCE_DATE_EPOCH', epoch)
    await expect(buildRegistry({ root, out })).rejects.toThrow('SOURCE_DATE_EPOCH')
  })

  it('accepts a custom version', async () => {
    await buildRegistry({ root, out, version: '9.9.9' })
    const reg = JSON.parse(await readFile(out, 'utf8'))
    expect(reg.version).toBe('9.9.9')
  })
})
