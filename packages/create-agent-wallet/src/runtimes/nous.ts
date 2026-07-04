import type { Activity } from '../registry/types.js'
import type { Vars } from '../scaffold/vars.js'

/**
 * Nous runtime — targets Hermes Agent by Nous Research
 * (https://hermes-agent.nousresearch.com/).
 *
 * Hermes uses the `AgentSkills` open standard (agentskills.io), so the
 * same `SKILL.md` format works across Claude Code, Cursor, OpenClaw,
 * and any other AgentSkills-compatible runtime.
 *
 * Hermes loads skills via its Skills Hub. After scaffolding, install
 * the skill with `hermes skills add <path>` (see Hermes docs for the
 * exact command on your version).
 */
export function nousVars(activity: Activity, base: Vars): Vars {
  return {
    ...base,
    activityName: activity.name,
    activityDescription: activity.description,
    activitySlug: activity.slug,
    recipeUrl: activity.recipeUrl ?? '(no recipe published yet)'
  }
}
