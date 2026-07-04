import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type {
  Activity,
  Eip8004Block,
  Eip8004Service,
  Runtime
} from '../registry/types.js'

export const EIP8004_TYPE =
  'https://eips.ethereum.org/EIPS/eip-8004#registration-v1'
export const TODO_PLACEHOLDER = '__TODO_AFTER_ON_CHAIN_REGISTRATION__'

export interface RegistrationContext {
  projectName: string
  runtime: Runtime
  chainId: number | null
  walletAddress?: string
}

interface RegistrationService {
  name: string
  endpoint: string
  version?: string
  skills: string[]
  domains: string[]
}

interface RegistrationFile {
  type: string
  name: string
  description: string
  image: string
  services: RegistrationService[]
  x402Support: boolean
  active: boolean
  registrations: Array<{
    agentId: string
    agentRegistry: string
  }>
  supportedTrust: string[]
}

/**
 * Default EIP-8004 services generated per runtime when the activity does
 * not declare its own.
 */
function defaultServicesFor(runtime: Runtime): Eip8004Service[] {
  if (runtime === 'claude') {
    return [
      {
        type: 'MCP',
        endpointTemplate: 'stdio://@human.tech/waap-mcp',
        version: '1.0',
        skills: [],
        domains: []
      }
    ]
  }
  return [
    {
      type: 'A2A',
      endpointTemplate: 'https://__TODO_HOST__/a2a',
      version: '0.1',
      skills: [],
      domains: []
    }
  ]
}

/**
 * Build the EIP-8004 agent-registration-v1 JSON shape from an Activity and
 * per-generation context. Fields the developer must fill in after deploy
 * (agentId, agentRegistry, hosted endpoints) are marked with
 * `__TODO_*__` placeholders so the file is always syntactically valid.
 */
export function buildRegistrationFile(
  activity: Activity,
  ctx: RegistrationContext
): RegistrationFile {
  const block: Eip8004Block = activity.eip8004 ?? {
    supportedTrust: ['tee-attestation'],
    x402Support: false,
    services: []
  }

  const declaredServices =
    block.services.length > 0 ? block.services : defaultServicesFor(ctx.runtime)

  const services: RegistrationService[] = declaredServices.map((s) => ({
    name: s.type,
    endpoint: substituteEndpoint(s.endpointTemplate, ctx),
    ...(s.version ? { version: s.version } : {}),
    skills: s.skills,
    domains: s.domains
  }))

  const chainIdStr =
    ctx.chainId == null ? '__TODO_CHAIN_ID__' : String(ctx.chainId)

  return {
    type: EIP8004_TYPE,
    name: ctx.projectName,
    description: activity.description,
    image: '',
    services,
    x402Support: block.x402Support ?? false,
    active: true,
    registrations: [
      {
        agentId: TODO_PLACEHOLDER,
        agentRegistry: `eip155:${chainIdStr}:__TODO_IDENTITY_REGISTRY_ADDRESS__`
      }
    ],
    supportedTrust: block.supportedTrust ?? ['tee-attestation']
  }
}

function substituteEndpoint(
  template: string,
  ctx: RegistrationContext
): string {
  const wallet = ctx.walletAddress ?? '__TODO_WALLET__'
  return template
    .replace(/\{\{\s*host\s*\}\}/g, '__TODO_HOST__')
    .replace(/\{\{\s*walletAddress\s*\}\}/g, wallet)
}

/**
 * Writes two files to the scaffolded project:
 *   - `agent-registration.json` at the project root (dev edits this)
 *   - `.well-known/agent-registration.json` for standalone-runtime projects
 *     (served at `https://{host}/.well-known/agent-registration.json` for
 *     domain verification per EIP-8004)
 */
export async function writeRegistrationFiles(
  projectDir: string,
  activity: Activity,
  ctx: RegistrationContext
): Promise<void> {
  const reg = buildRegistrationFile(activity, ctx)
  const json = JSON.stringify(reg, null, 2) + '\n'

  await writeFile(join(projectDir, 'agent-registration.json'), json)

  if (ctx.runtime === 'standalone') {
    const wellKnown = join(projectDir, '.well-known/agent-registration.json')
    await mkdir(dirname(wellKnown), { recursive: true })
    await writeFile(wellKnown, json)
  }
}
