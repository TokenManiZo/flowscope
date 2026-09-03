import type { EventRecord, Source } from "@/lib/api/types"

export const trafficClassDefaults = {
  API: true,
  AUTH_SESSION: false,
  UNKNOWN: true,
  TELEMETRY_CANDIDATE: true,
  POLLING: true,
  BACKGROUND: true,
  NAVIGATION: false,
  STATIC_ASSET: false,
  DISCOVERY_METADATA: false,
  PREFLIGHT: false,
} as const

export type EvidenceFiltersState = {
  sources: Record<Exclude<Source, "unknown">, boolean>
  dispositions: Record<"INCLUDE" | "REVIEW" | "EXCLUDE", boolean>
  trafficClasses: Record<string, boolean>
  expandRepeats: boolean
}

export const defaultEvidenceFilters = (): EvidenceFiltersState => ({
  sources: { human: true, scanner: true, llm: true },
  dispositions: { INCLUDE: true, REVIEW: true, EXCLUDE: false },
  trafficClasses: { ...trafficClassDefaults },
  expandRepeats: false,
})

export function visibleEvidence(events: readonly EventRecord[], filters: EvidenceFiltersState): readonly EventRecord[] {
  const visible = events.filter((item) => {
    const sourceVisible = item.source === "unknown" || filters.sources[item.source]
    const dispositionVisible = filters.dispositions[item.trafficDisposition as keyof typeof filters.dispositions] === true
    const trafficVisible = !(item.trafficClass in trafficClassDefaults) || filters.trafficClasses[item.trafficClass] === true
    return sourceVisible && dispositionVisible && trafficVisible
  })
  if (filters.expandRepeats) return visible

  const clusters = new Set<string>()
  return visible.filter((item) => {
    if (clusters.has(item.clusterId)) return false
    clusters.add(item.clusterId)
    return true
  })
}

export function hiddenEvidenceCount(events: readonly EventRecord[], filters: EvidenceFiltersState): number {
  return events.length - visibleEvidence(events, { ...filters, expandRepeats: true }).length
}

export function boundedText(value: unknown, maximum = 160): string {
  const text = String(value ?? "-")
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`
}
