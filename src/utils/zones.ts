import type { ResolvedZones } from '../config/index.js'

/**
 * Returns true if `relPath` falls within one of the KB's declared zones or
 * staging areas. The check is purely against the first path segment — files and
 * folders must live under a zone root (e.g. "Pillars/...") or staging root
 * ("+/..." or "-/..."). Paths that sit directly at the KB root or outside any
 * zone are rejected.
 */
export const isInScope = (relPath: string, zones: ResolvedZones): boolean => {
  const first = relPath.replace(/\\/g, '/').split('/')[0]
  if (!first) return false
  const allowed = new Set([
    zones.Calendar,
    zones.Pillars,
    zones.Resources,
    zones.Streams,
    zones.Admin,
    zones.inbound,
    zones.outbound
  ])
  return allowed.has(first)
}

export const outOfScopeError = (zones: ResolvedZones): string => {
  const names = [
    zones.Calendar,
    zones.Pillars,
    zones.Resources,
    zones.Streams,
    zones.Admin,
    zones.inbound,
    zones.outbound
  ]
  return `Path is outside KB zones. Accessible roots: ${names.join(', ')}`
}
