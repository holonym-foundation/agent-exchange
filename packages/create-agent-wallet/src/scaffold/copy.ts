import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { resolve, join, dirname, sep } from 'node:path'
import { substituteVars, type Vars } from './vars.js'

export interface CopyOptions {
  from: string
  to: string
  vars: Vars
}

async function walkRel(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const e of entries) {
    const full = resolve(dir, e.name)
    if (e.isDirectory()) {
      out.push(...(await walkRel(root, full)))
    } else if (e.isFile()) {
      out.push(full.slice(root.length + 1))
    }
  }
  return out
}

/**
 * Transform a relative template path into the output path:
 *   - `.tpl` suffix is stripped (file becomes a variable-substituted copy)
 *   - `dot-` basename prefix becomes `.` on output (`dot-env.example` →
 *     `.env.example`, `dot-gitignore` → `.gitignore`). This lets templates
 *     ship dotfiles without triggering source-tree tooling that treats
 *     dotfiles as secrets or ignores them.
 */
export function resolveOutputRel(rel: string): {
  outRel: string
  isTpl: boolean
} {
  const isTpl = rel.endsWith('.tpl')
  const stripped = isTpl ? rel.slice(0, -4) : rel
  const segments = stripped.split(sep)
  const base = segments[segments.length - 1]
  const renamedBase = base.startsWith('dot-') ? `.${base.slice(4)}` : base
  segments[segments.length - 1] = renamedBase
  return { outRel: segments.join(sep), isTpl }
}

/**
 * Copy a template tree to `to`, performing {{variable}} substitution on any
 * file ending in `.tpl`. Non-`.tpl` files are copied byte-for-byte.
 * `dot-` prefix on the basename is rewritten to `.` on output.
 */
export async function copyTemplate(opts: CopyOptions): Promise<number> {
  await mkdir(opts.to, { recursive: true })
  const files = await walkRel(opts.from)
  let count = 0
  for (const rel of files) {
    const src = join(opts.from, rel)
    const { outRel, isTpl } = resolveOutputRel(rel)
    const outPath = join(opts.to, outRel)
    await mkdir(dirname(outPath), { recursive: true })
    if (isTpl) {
      const raw = await readFile(src, 'utf8')
      await writeFile(outPath, substituteVars(raw, opts.vars))
    } else {
      await copyFile(src, outPath)
    }
    count++
  }
  return count
}
