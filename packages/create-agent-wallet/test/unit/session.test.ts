import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { detectSession } from '../../src/session/detect.js'

let home: string

beforeEach(async () => {
  home = await mkdtemp(resolve(tmpdir(), 'caw-home-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('detectSession', () => {
  it('returns null when no session file exists', async () => {
    expect(await detectSession({ home })).toBeNull()
  })

  it('returns session info when present', async () => {
    await mkdir(resolve(home, '.waap-cli'), { recursive: true })
    await writeFile(
      resolve(home, '.waap-cli/session.json'),
      JSON.stringify({ address: '0xabc', email: 'a@b.c' })
    )
    const s = await detectSession({ home })
    expect(s?.address).toBe('0xabc')
    expect(s?.email).toBe('a@b.c')
  })

  it('tolerates missing email field', async () => {
    await mkdir(resolve(home, '.waap-cli'), { recursive: true })
    await writeFile(
      resolve(home, '.waap-cli/session.json'),
      JSON.stringify({ address: '0xabc' })
    )
    const s = await detectSession({ home })
    expect(s?.address).toBe('0xabc')
    expect(s?.email).toBeUndefined()
  })

  it('returns null on malformed JSON', async () => {
    await mkdir(resolve(home, '.waap-cli'), { recursive: true })
    await writeFile(resolve(home, '.waap-cli/session.json'), 'not json')
    expect(await detectSession({ home })).toBeNull()
  })

  it('returns null when address field is missing', async () => {
    await mkdir(resolve(home, '.waap-cli'), { recursive: true })
    await writeFile(
      resolve(home, '.waap-cli/session.json'),
      JSON.stringify({ notAddress: 'x' })
    )
    expect(await detectSession({ home })).toBeNull()
  })
})
