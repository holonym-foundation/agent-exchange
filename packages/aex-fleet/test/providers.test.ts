import { describe, expect, it } from 'vitest'
import { ArkhaiProvider, parseLease } from '../src/core/providers/arkhai.js'
import { MarlinProvider, parseEnclaveRef } from '../src/core/providers/marlin.js'
import { getProvider, PROVIDER_NAMES } from '../src/core/providers/index.js'

describe('ArkhaiProvider.buildBuyArgs', () => {
  it('builds a market buy invocation from lease options (no undocumented --json)', () => {
    const p = new ArkhaiProvider({ gpuModel: 'H200', durationHours: 2, maxPrice: 1.5 })
    expect(p.buildBuyArgs()).toEqual([
      'buy',
      '--gpu-model',
      'H200',
      '--duration-hours',
      '2',
      '--max-price',
      '1.5',
      '--price-markup',
      '1.5'
    ])
    expect(p.buildBuyArgs()).not.toContain('--json')
  })

  it('omits GPU and uses CPU mins for a CPU-only lease', () => {
    const p = new ArkhaiProvider({ vcpuMin: 2, ramGbMin: 4 })
    const args = p.buildBuyArgs()
    expect(args).not.toContain('--gpu-model')
    expect(args).toContain('--vcpu-min')
    expect(args).toContain('2')
    expect(args).toContain('--ram-gb-min')
  })
})

describe('parseLease', () => {
  it('parses a JSON lease with snake_case fields', () => {
    const out = JSON.stringify({
      escrow_uid: '0xdeadbeef',
      vm_host_ip: '203.0.113.7',
      ssh_port: 2222,
      ssh_user: 'tenant42'
    })
    expect(parseLease(out)).toEqual({
      escrowUid: '0xdeadbeef',
      vmHostIp: '203.0.113.7',
      sshPort: 2222,
      sshUser: 'tenant42'
    })
  })

  it('scrapes the documented text output (ssh line + escrow uid)', () => {
    const out = [
      'Negotiating… locked escrow.',
      'escrow_uid: 0xabc123',
      'status: ready',
      'Access your VM:',
      'ssh -i ~/.ssh/mms_buyer_id_ed25519 -p 2222 tenant7@203.0.113.7'
    ].join('\n')
    expect(parseLease(out)).toEqual({
      escrowUid: '0xabc123',
      vmHostIp: '203.0.113.7',
      sshPort: 2222,
      sshUser: 'tenant7'
    })
  })

  it('accepts camelCase variants and defaults ssh port/user', () => {
    const out = JSON.stringify({ escrowUid: 'e1', vmHostIp: '198.51.100.3' })
    const lease = parseLease(out)
    expect(lease.sshPort).toBe(22)
    expect(lease.sshUser).toBe('tenant')
  })

  it('derives priceUsd (USD/month) from agreed_amount + duration (6-dec USDC)', () => {
    // 8500 base units (0.0085 USDC) over a 1h lease → 0.0085 * 720 ≈ $6.12/mo
    const out = JSON.stringify({
      escrow_uid: '0xfee',
      vm_host_ip: '203.0.113.9',
      agreed_amount: 8500,
      agreed_duration_seconds: 3600
    })
    expect(parseLease(out).priceUsd).toBe(6.12)
  })

  it('prefers an explicit price_usd_month over derivation', () => {
    const out = JSON.stringify({
      escrow_uid: '0xfee',
      vm_host_ip: '203.0.113.9',
      price_usd_month: 3.5,
      agreed_amount: 8500,
      agreed_duration_seconds: 3600
    })
    expect(parseLease(out).priceUsd).toBe(3.5)
  })

  it('leaves priceUsd undefined when the output carries no price', () => {
    const out = JSON.stringify({ escrow_uid: 'e1', vm_host_ip: '198.51.100.3' })
    expect(parseLease(out).priceUsd).toBeUndefined()
  })

  it('throws when the lease lacks an ip or escrow id', () => {
    expect(() => parseLease(JSON.stringify({ foo: 'bar' }))).toThrow(/Could not parse lease/)
  })
})

describe('MarlinProvider', () => {
  it('builds a docker-image deploy invocation with attestation', () => {
    const p = new MarlinProvider({ instance: 'nitro.small', durationHours: 3 })
    const args = p.buildDeployArgs('aex/demo:latest')
    expect(args).toEqual([
      'deploy',
      '--image',
      'aex/demo:latest',
      '--instance',
      'nitro.small',
      '--duration-hours',
      '3',
      '--attest'
    ])
  })

  it('parses an enclave ref from text output', () => {
    const out = 'provisioning…\nenclave_id: enc-7f3\nendpoint: https://enc-7f3.marlin.run\nattested'
    expect(parseEnclaveRef(out)).toEqual({ enclaveId: 'enc-7f3', endpoint: 'https://enc-7f3.marlin.run' })
  })
})

describe('getProvider', () => {
  it('returns arkhai, marlin and local providers', () => {
    expect(getProvider('arkhai').name).toBe('arkhai')
    expect(getProvider('marlin').name).toBe('marlin-tee')
    expect(getProvider('marlin-tee').name).toBe('marlin-tee')
    expect(getProvider('local').name).toBe('local')
  })

  it('throws a helpful error for the unwrapped hetzner path', () => {
    expect(() => getProvider('hetzner-systemd')).toThrow(/deploy\.sh/)
  })

  it('throws on an unknown target', () => {
    expect(() => getProvider('nope')).toThrow(/Unknown deploy target/)
    expect(PROVIDER_NAMES).toContain('arkhai')
  })
})
