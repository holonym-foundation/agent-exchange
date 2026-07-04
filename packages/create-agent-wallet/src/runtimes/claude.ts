import type { Activity } from '../registry/types.js'
import type { Vars } from '../scaffold/vars.js'

/**
 * Claude runtime adds activity-shape vars for CLAUDE.md and SKILL.md templates.
 * The same vars are available to OpenClaw + Nous so a template author doesn't
 * have to remember which runtime exposes what.
 */
export function claudeVars(activity: Activity, base: Vars): Vars {
  return {
    ...base,
    activityName: activity.name,
    activityDescription: activity.description,
    activitySlug: activity.slug,
    recipeUrl: activity.recipeUrl ?? '(no recipe published yet)'
  }
}
