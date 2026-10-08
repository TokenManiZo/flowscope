import { identityLabel } from "@/lib/display/identityLabel"
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
  /** 경로·메서드·계정 부분 일치 검색. 비어 있으면 거르지 않는다. */
  query?: string
}

export const defaultEvidenceFilters = (): EvidenceFiltersState => ({
  sources: { human: true, scanner: true, llm: true },
  dispositions: { INCLUDE: true, REVIEW: false, EXCLUDE: false },
  trafficClasses: { ...trafficClassDefaults },
  expandRepeats: false,
})

export interface EvidenceSearchContext {
  ordinals?: Readonly<Record<string, number>>
  accountLabels?: Readonly<Record<string, string>>
}

export function visibleEvidence(events: readonly EventRecord[], filters: EvidenceFiltersState, search: EvidenceSearchContext = {}): readonly EventRecord[] {
  const visible = events.filter((item) => {
    const sourceVisible = item.source === "unknown" || filters.sources[item.source]
    const dispositionVisible = filters.dispositions[item.trafficDisposition as keyof typeof filters.dispositions] === true
    const trafficVisible = !(item.trafficClass in trafficClassDefaults) || filters.trafficClasses[item.trafficClass] === true
    const query = filters.query?.trim().toLowerCase()
    const number = query?.match(/^#?(\d+)$/)?.[1]
    const queryVisible = !query || (number
      ? search.ordinals?.[item.eventId] === Number(number)
      : `${item.method} ${item.path} ${item.idn} ${identityLabel(item.idn)} ${search.accountLabels?.[item.laneAccountId || item.idn] ?? ""}`.toLowerCase().includes(query))
    return sourceVisible && dispositionVisible && trafficVisible && queryVisible
  })
  if (filters.expandRepeats) return visible

  const clusters = new Set<string>()
  return visible.filter((item) => {
    if (clusters.has(item.clusterId)) return false
    clusters.add(item.clusterId)
    return true
  })
}

export function hiddenEvidenceCount(events: readonly EventRecord[], filters: EvidenceFiltersState, search: EvidenceSearchContext = {}): number {
  return events.length - visibleEvidence(events, { ...filters, expandRepeats: true }, search).length
}

export function boundedText(value: unknown, maximum = 160): string {
  const text = String(value ?? "-")
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`
}

export type EvidenceTab = "INCLUDE" | "REVIEW" | "EXCLUDE" | "ALL"

/** 탭은 판정 체크박스를 대신한다. ALL은 세 판정을 모두 켠다. */
export function tabDispositions(tab: EvidenceTab): EvidenceFiltersState["dispositions"] {
  return { INCLUDE: tab === "INCLUDE" || tab === "ALL", REVIEW: tab === "REVIEW" || tab === "ALL", EXCLUDE: tab === "EXCLUDE" || tab === "ALL" }
}

export function dispositionCounts(events: readonly EventRecord[]): Record<EvidenceTab, number> {
  const counts = { INCLUDE: 0, REVIEW: 0, EXCLUDE: 0, ALL: events.length }
  for (const event of events) if (event.trafficDisposition === "INCLUDE" || event.trafficDisposition === "REVIEW" || event.trafficDisposition === "EXCLUDE") counts[event.trafficDisposition] += 1
  return counts
}

/** Index the already-filtered records once; each row must not rescan the dataset. */
export function repeatEvidenceIds(events: readonly EventRecord[]): ReadonlyMap<string, readonly string[]> {
  const groups = new Map<string, string[]>()
  for (const event of events) {
    const ids = groups.get(event.clusterId)
    if (ids) ids.push(event.eventId)
    else groups.set(event.clusterId, [event.eventId])
  }
  return groups
}
