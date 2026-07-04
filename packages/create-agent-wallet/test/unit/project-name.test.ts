import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { validateProjectName } from '../../src/prompts/project-name.js'

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(resolve(tmpdir(), 'caw-name-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

describe('validateProjectName', () => {
  it('accepts kebab-case names', () => {
    expect(validateProjectName('my-agent', cwd)).toBeUndefined()
    expect(validateProjectName('agent01', cwd)).toBeUndefined()
  })

  it('rejects uppercase', () => {
    expect(validateProjectName('My-Agent', cwd)).toMatch(/lowercase/)
  })

  it('rejects names starting with dash', () => {
    expect(validateProjectName('-agent', cwd)).toMatch(/lowercase/)
  })

  it('rejects names with spaces', () => {
    expect(validateProjectName('my agent', cwd)).toMatch(/lowercase/)
  })

  it('rejects name if directory exists', async () => {
    await mkdir(resolve(cwd, 'my-agent'))
    expect(validateProjectName('my-agent', cwd)).toMatch(/already exists/)
  })
})
