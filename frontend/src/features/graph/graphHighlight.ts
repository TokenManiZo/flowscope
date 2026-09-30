import type { EventRecord, Source } from "@/lib/api/types"

/**
 * 그래프 강조 필터. 같은 축 안에서는 하나라도 맞으면(OR), 축끼리는 모두 맞아야(AND) 강조한다.
 * 비어 있는 축은 조건이 없다는 뜻이다. 데이터를 숨기지 않고 색·굵기만 바꾸므로 노드 배치는 그대로다.
 */
export interface GraphHighlight {
  sources: readonly Source[]
  identities: readonly string[]
  statuses: readonly number[]
}

export const EMPTY_HIGHLIGHT: GraphHighlight = { sources: [], identities: [], statuses: [] }

export const STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"] as const
export type StatusClass = (typeof STATUS_CLASSES)[number] | "other"

export function statusClass(status: number): StatusClass {
  const head = Math.floor(status / 100)
  return head >= 2 && head <= 5 ? `${head}xx` as StatusClass : "other"
}

/** 평소 엣지는 무채색이고, 강조된 엣지에만 아래 색을 쓴다. */
export const STATUS_CLASS_COLOR: Record<StatusClass, string> = { "2xx": "#34d399", "3xx": "#60a5fa", "4xx": "#fbbf24", "5xx": "#f87171", other: "#94a3b8" }
export const HIGHLIGHT_SOURCE_COLOR: Record<Source, string> = { human: "#60a5fa", scanner: "#f87171", llm: "#facc15", unknown: "#94a3b8" }
/** 신원에는 고유 색이 없어 한 가지 강조색만 쓴다(신원마다 색을 주면 다시 색이 많아진다). */
export const HIGHLIGHT_IDENTITY_COLOR = "#34d39a"

export function highlightActive(highlight: GraphHighlight): boolean {
  return highlight.sources.length > 0 || highlight.identities.length > 0 || highlight.statuses.length > 0
}

interface HighlightEdge {
  id: string
  source: Source | null
  selection: { identity: string | null; evidenceIds: readonly string[] }
}

/** Evidence ID(대표 ID와 묶인 ID 모두)로 이벤트를 찾는 색인. */
export function indexEventsByEvidence(events: readonly EventRecord[]): ReadonlyMap<string, readonly EventRecord[]> {
  const index = new Map<string, EventRecord[]>()
  for (const event of events) {
    for (const id of new Set([event.eventId, ...(event.clusterEvidenceIds ?? [])])) {
      const bucket = index.get(id)
      if (bucket) bucket.push(event); else index.set(id, [event])
    }
  }
  return index
}

/**
 * 엣지에 속한 요청의 응답 코드별 개수. 엣지의 Evidence ID는 셀 전체 기준이라 다른 출처·신원의 요청도 섞여 있으므로,
 * 엣지의 출처와 신원으로 한 번 더 거른다.
 */
export function edgeStatusCounts(edge: HighlightEdge, index: ReadonlyMap<string, readonly EventRecord[]>): Map<number, number> {
  const events = new Set<EventRecord>()
  for (const id of edge.selection.evidenceIds) for (const event of index.get(id) ?? []) {
    if (edge.source && event.source !== edge.source) continue
    if (edge.selection.identity && event.idn !== edge.selection.identity) continue
    events.add(event)
  }
  const counts = new Map<number, number>()
  for (const event of events) counts.set(event.status, (counts.get(event.status) ?? 0) + 1)
  return counts
}

/**
 * 강조할 엣지와 그 색. 필터가 비어 있으면 null(모두 평소 무채색).
 * 색 우선순위: 응답 코드를 골랐으면 고른 코드 중 그 엣지에서 가장 많은 코드의 계열 색, 출처만 골랐으면 출처 색, 신원만 골랐으면 강조색.
 */
export function projectHighlight(edges: readonly HighlightEdge[], events: readonly EventRecord[], highlight: GraphHighlight): ReadonlyMap<string, string> | null {
  if (!highlightActive(highlight)) return null
  const index = highlight.statuses.length ? indexEventsByEvidence(events) : null
  const matched = new Map<string, string>()
  for (const edge of edges) {
    if (!edge.source) continue
    if (highlight.sources.length && !highlight.sources.includes(edge.source)) continue
    if (highlight.identities.length && !(edge.selection.identity && highlight.identities.includes(edge.selection.identity))) continue
    if (index) {
      let best: number | null = null
      let bestCount = 0
      for (const [status, count] of edgeStatusCounts(edge, index)) {
        if (highlight.statuses.includes(status) && count > bestCount) { best = status; bestCount = count }
      }
      if (best === null) continue
      matched.set(edge.id, STATUS_CLASS_COLOR[statusClass(best)])
    } else {
      matched.set(edge.id, highlight.sources.length ? HIGHLIGHT_SOURCE_COLOR[edge.source] : HIGHLIGHT_IDENTITY_COLOR)
    }
  }
  return matched
}

/** API 노드별 관측 응답 코드(오름차순). 노드는 여러 출처·신원을 합친 것이라 Evidence 전체의 코드를 모은다. */
export function nodeStatusCodes(nodes: readonly { id: string; kind: string; selection: { evidenceIds: readonly string[] } }[], events: readonly EventRecord[]): ReadonlyMap<string, readonly number[]> {
  const index = indexEventsByEvidence(events)
  const codes = new Map<string, readonly number[]>()
  for (const node of nodes) {
    if (node.kind !== "operation") continue
    const statuses = new Set<number>()
    for (const id of node.selection.evidenceIds) for (const event of index.get(id) ?? []) statuses.add(event.status)
    if (statuses.size) codes.set(node.id, [...statuses].sort((left, right) => left - right))
  }
  return codes
}

/** 필터로 고른 응답 코드와 그 계열 색. 노드 카드의 뱃지는 여기에 있는 코드만 칠한다. */
export function statusHighlightColors(highlight: GraphHighlight): ReadonlyMap<number, string> {
  return new Map(highlight.statuses.map((status) => [status, STATUS_CLASS_COLOR[statusClass(status)]]))
}

/** 레일에 보여줄 응답 코드 묶음. 2xx~5xx는 관측이 없어도 항상 보이고, 그 밖의 코드(0 등)는 레일에 두지 않는다. */
export function statusGroups(events: readonly EventRecord[]): Array<{ cls: (typeof STATUS_CLASSES)[number]; codes: Array<{ status: number; count: number }>; total: number }> {
  const counts = new Map<number, number>()
  for (const event of events) counts.set(event.status, (counts.get(event.status) ?? 0) + 1)
  return STATUS_CLASSES.map((cls) => {
    const codes = [...counts].filter(([status]) => statusClass(status) === cls).sort(([left], [right]) => left - right).map(([status, count]) => ({ status, count }))
    return { cls, codes, total: codes.reduce((sum, code) => sum + code.count, 0) }
  })
}
