export type Vars = Record<string, string>

const VAR_RE = /\{\{\s*(\w+)\s*\}\}/g

export function substituteVars(content: string, vars: Vars): string {
  return content.replace(VAR_RE, (_, key: string) => {
    if (!(key in vars)) {
      throw new Error(`undefined template variable: {{${key}}}`)
    }
    return vars[key]
  })
}
