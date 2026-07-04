import { z } from 'zod'

// v1 supports a single op kind (policy.set). Add more via the discriminated union as bulk ops
// land (link, privilege.grant, etc.) — the apply command picks the handler by `op`.

export const PolicySetOpSchema = z.object({
  op: z.literal('policy.set'),
  agentId: z.string(),
  args: z.object({ dailyLimit: z.string() })
})

export const OpSchema = z.discriminatedUnion('op', [PolicySetOpSchema])

export const PlanSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  ops: z.array(OpSchema)
})

export type PolicySetOp = z.infer<typeof PolicySetOpSchema>
export type Op = z.infer<typeof OpSchema>
export type Plan = z.infer<typeof PlanSchema>

export function describeOp(op: Op): string {
  switch (op.op) {
    case 'policy.set':
      return `policy.set --daily-limit ${op.args.dailyLimit} → ${op.agentId}`
  }
}
