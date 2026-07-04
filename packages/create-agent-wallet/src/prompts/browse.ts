import { select, isCancel } from '@clack/prompts'
import type { Activity, Category } from '../registry/types.js'

export interface BrowseContext {
  activities: Activity[]
}

export type BrowseResult = Activity | 'cancelled'

const CATEGORY_LABELS: Record<Category, string> = {
  trading: 'Trading',
  yield: 'Yield',
  governance: 'Governance',
  setup: 'Blank / custom',
  other: 'Other'
}

export async function selectActivity(
  ctx: BrowseContext
): Promise<BrowseResult> {
  if (ctx.activities.length === 0) return 'cancelled'

  const mode = await select({
    message: 'How do you want to browse?',
    options: [
      { value: 'chain', label: 'By chain' },
      { value: 'useCase', label: 'By use case' }
    ]
  })
  if (isCancel(mode)) return 'cancelled'

  if (mode === 'chain') {
    return selectByChain(ctx.activities)
  }
  return selectByUseCase(ctx.activities)
}

async function selectByChain(activities: Activity[]): Promise<BrowseResult> {
  const chains = Array.from(
    new Map(activities.map((a) => [a.chain.name, a.chain])).values()
  )
  const chainName = await select({
    message: 'Which chain?',
    options: chains.map((c) => ({ value: c.name, label: c.name }))
  })
  if (isCancel(chainName)) return 'cancelled'
  const filtered = activities.filter((a) => a.chain.name === chainName)

  const slug = await select({
    message: `What would you like to build on ${chainName}?`,
    options: filtered.map((a) => ({
      value: a.slug,
      label: a.name,
      hint: a.description
    }))
  })
  if (isCancel(slug)) return 'cancelled'
  return activities.find((a) => a.slug === slug)!
}

async function selectByUseCase(activities: Activity[]): Promise<BrowseResult> {
  const presentCategories = Array.from(
    new Set(activities.map((a) => a.category))
  )
  const category = await select({
    message: 'Which use case?',
    options: presentCategories.map((c) => ({
      value: c,
      label: CATEGORY_LABELS[c] ?? c
    }))
  })
  if (isCancel(category)) return 'cancelled'
  const filtered = activities.filter((a) => a.category === category)

  const slug = await select({
    message: 'Pick an activity',
    options: filtered.map((a) => ({
      value: a.slug,
      label: `${a.name} — ${a.chain.name}`,
      hint: a.description
    }))
  })
  if (isCancel(slug)) return 'cancelled'
  return activities.find((a) => a.slug === slug)!
}
