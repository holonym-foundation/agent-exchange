import { select, isCancel } from '@clack/prompts'
import type { Activity, Runtime } from '../registry/types.js'

const RUNTIME_LABELS: Record<Runtime, string> = {
  claude: 'Claude (SKILL.md — discovered by Claude Code / Cursor)',
  standalone: 'Standalone (Node.js + Dockerfile)',
  openclaw: 'OpenClaw (AgentSkills-compliant SKILL.md)',
  nous: 'Nous / Hermes Agent (AgentSkills-compliant SKILL.md)'
}

export type RuntimeResult = Runtime | 'cancelled'

export async function selectRuntime(
  activity: Activity
): Promise<RuntimeResult> {
  if (activity.runtimes.length === 1) return activity.runtimes[0]
  const choice = await select({
    message: 'Runtime:',
    options: activity.runtimes.map((r) => ({
      value: r,
      label: RUNTIME_LABELS[r]
    }))
  })
  if (isCancel(choice)) return 'cancelled'
  return choice as Runtime
}
