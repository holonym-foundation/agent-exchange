import { z } from 'zod'

export const ChainFamilySchema = z.enum([
  'evm',
  'sui',
  'solana',
  'stellar',
  'any'
])
export type ChainFamily = z.infer<typeof ChainFamilySchema>

export const ChainSpecSchema = z.object({
  family: ChainFamilySchema,
  id: z.union([z.number().int().positive(), z.null()]),
  name: z.string().min(1)
})
export type ChainSpec = z.infer<typeof ChainSpecSchema>

export const RuntimeSchema = z.enum([
  'claude',
  'standalone',
  'openclaw',
  'nous'
])
export type Runtime = z.infer<typeof RuntimeSchema>

export const ALL_RUNTIMES: Runtime[] = [
  'claude',
  'standalone',
  'openclaw',
  'nous'
]

export const EnvVarSchema = z.object({
  key: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/, 'env keys must be UPPER_SNAKE_CASE'),
  required: z.boolean(),
  default: z.string().optional(),
  description: z.string()
})
export type EnvVar = z.infer<typeof EnvVarSchema>

export const WaapFeatureSchema = z.enum([
  'signup',
  'sign-message',
  'sign-typed-data',
  'send-tx',
  'policy',
  'permission-token'
])
export type WaapFeature = z.infer<typeof WaapFeatureSchema>

export const CategorySchema = z.enum([
  'trading',
  'yield',
  'governance',
  'setup',
  'other'
])
export type Category = z.infer<typeof CategorySchema>

/**
 * EIP-8004 ("Trustless Agents") optional metadata block.
 *
 * The agent-registration.json file emitted during scaffolding mirrors the
 * EIP-8004 registration-v1 shape. This block captures activity-level
 * defaults so the generated file can be as complete as possible before
 * on-chain registration.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-8004
 */
export const Eip8004ServiceTypeSchema = z.enum([
  'web',
  'A2A',
  'MCP',
  'OASF',
  'ENS',
  'DID',
  'email'
])
export type Eip8004ServiceType = z.infer<typeof Eip8004ServiceTypeSchema>

export const Eip8004TrustModelSchema = z.enum([
  'reputation',
  'crypto-economic',
  'tee-attestation'
])
export type Eip8004TrustModel = z.infer<typeof Eip8004TrustModelSchema>

export const Eip8004ServiceSchema = z.object({
  type: Eip8004ServiceTypeSchema,
  /**
   * URI or template. May contain `{{host}}` and `{{walletAddress}}` which
   * the scaffold engine substitutes at generation time, or leaves as
   * `__TODO__` placeholders the developer must fill in.
   */
  endpointTemplate: z.string().min(1),
  version: z.string().optional(),
  skills: z.array(z.string()).default([]),
  domains: z.array(z.string()).default([])
})
export type Eip8004Service = z.infer<typeof Eip8004ServiceSchema>

export const Eip8004BlockSchema = z.object({
  supportedTrust: z.array(Eip8004TrustModelSchema).default(['tee-attestation']),
  x402Support: z.boolean().default(false),
  services: z.array(Eip8004ServiceSchema).default([])
})
export type Eip8004Block = z.infer<typeof Eip8004BlockSchema>

/**
 * Optional behavior block — the scheduled task the agent runtime executes. The
 * registry is the source of truth for BOTH catalog metadata and behavior; when
 * present, the deploy path uses this (else the host app falls back to its own
 * recipe-task map). `{ENV_KEY}` placeholders in `task` are interpolated from the
 * user's config at deploy time.
 */
export const RecipeBehaviorSchema = z.object({
  task: z.string().min(1),
  /** Default natural-language schedule (e.g. "every 6h"). A config interval key
   *  (e.g. RESEARCH_INTERVAL_MS, *_HOURS) overrides this when present. */
  schedule: z.string().optional(),
  /** One-line mandate for the agent's SOUL.md (falls back to `description`). */
  soulMandate: z.string().optional()
})
export type RecipeBehavior = z.infer<typeof RecipeBehaviorSchema>

export const ActivitySchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]*$/, 'slug must be kebab-case'),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver'),
  author: z.string().min(1),
  verified: z.boolean(),
  chain: ChainSpecSchema,
  category: CategorySchema,
  protocols: z.array(z.string()),
  tags: z.array(z.string()),
  runtimes: z.array(RuntimeSchema).min(1),
  envVars: z.array(EnvVarSchema),
  waapFeatures: z.array(WaapFeatureSchema),
  recipeUrl: z.string().url().nullable(),
  minCliVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Optional EIP-8004 registration metadata. Defaults applied when omitted. */
  eip8004: Eip8004BlockSchema.optional(),
  /** Optional behavior block — the scheduled task the runtime executes (registry = SoT). */
  behavior: RecipeBehaviorSchema.optional()
})
export type Activity = z.infer<typeof ActivitySchema>

export const RegistrySchema = z.object({
  version: z.string(),
  generatedAt: z.string().datetime(),
  activities: z.array(ActivitySchema)
})
export type Registry = z.infer<typeof RegistrySchema>
