import type { Activity } from '../registry/types.js'
import type { Vars } from '../scaffold/vars.js'

/**
 * Extends the base scaffold vars with the same activity-shape extras the
 * other runtimes get. Standalone templates rarely use these (they bake values
 * into agent.ts directly), but exposing them keeps the variable catalog
 * uniform across runtimes — so a template author doesn't trip over
 * "this var is openclaw-only" inconsistencies.
 */
export function standaloneVars(activity: Activity, base: Vars): Vars {
  return {
    ...base,
    activityName: activity.name,
    activityDescription: activity.description,
    activitySlug: activity.slug,
    recipeUrl: activity.recipeUrl ?? '(no recipe published yet)'
  }
}
