import { text, isCancel } from '@clack/prompts'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/

export function validateProjectName(
  name: string,
  cwd: string = process.cwd()
): string | undefined {
  if (!NAME_RE.test(name)) {
    return 'Use lowercase letters, digits, and dashes only.'
  }
  if (existsSync(resolve(cwd, name))) {
    return `Directory "${name}" already exists.`
  }
  return undefined
}

export type ProjectNameResult = string | 'cancelled'

export async function promptProjectName(
  defaultName: string
): Promise<ProjectNameResult> {
  const answered = await text({
    message: 'Project name',
    defaultValue: defaultName,
    placeholder: defaultName,
    validate(value) {
      const name = (value ?? defaultName).trim()
      return validateProjectName(name)
    }
  })
  if (isCancel(answered)) return 'cancelled'
  return ((answered as string) || defaultName).trim()
}
