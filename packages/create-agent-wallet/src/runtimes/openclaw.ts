import type { Activity } from '../registry/types.js'
import type { Vars } from '../scaffold/vars.js'

/**
 * OpenClaw runtime — ships an `AgentSkills`-compliant `SKILL.md` that
 * OpenClaw loads from `~/.openclaw/workspace/skills/<name>/SKILL.md`.
 *
 * OpenClaw conforms to the AgentSkills open standard (agentskills.io),
 * so the same SKILL.md works across Claude Code, Cursor, Hermes, etc.
 *
 * Tracking: internal-docs #417
 */
export function openclawVars(activity: Activity, base: Vars): Vars {
  return {
    ...base,
    activityName: activity.name,
    activityDescription: activity.description,
    activitySlug: activity.slug,
    recipeUrl: activity.recipeUrl ?? '(no recipe published yet)'
  }
}
