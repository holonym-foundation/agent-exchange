import pc from 'picocolors'

// Threshold above which bulk ops emit a stderr warning so humans (and AI shells reading stderr)
// notice the scope. Override per-env via AEX_FLEET_BLAST_RADIUS. Below threshold = silent.
export function blastRadiusThreshold(): number {
  const raw = process.env.AEX_FLEET_BLAST_RADIUS
  if (!raw) return 5
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 5
}

export function warnBlastRadius(count: number, kind: string, extra?: string): void {
  const threshold = blastRadiusThreshold()
  if (count <= threshold) return
  const tail = extra ? ` (${extra})` : ''
  process.stderr.write(
    pc.yellow(
      `WARNING: this ${kind} affects ${count} agents${tail}. ` +
        `Set AEX_FLEET_BLAST_RADIUS to adjust the threshold (currently ${threshold}).\n`
    )
  )
}
