import { gapParameterKey } from "@/features/parameter-map/parameterProjection"
import type { Snapshot } from "@/lib/api/types"
import type { DashboardSummaryValues } from "./DashboardSummaryBlocks"

/**
 * PR#11 대시보드 수치. 서버 `snapshot.surface.parameterGaps`의 열린 Gap만 세며 퍼센트나 완료율을 만들지 않는다(D-002).
 * 우선 점검 API는 우선순위 근거가 있는 열린 Gap의 endpoint(service·method·경로) 중복 제외, 미관측 파라미터는 권한 변형이 아닌
 * 열린 Gap의 입력 좌표 중복 제외, 권한 변형 미검증은 열린 AUTH_VARIANT_UNTESTED Gap id 중복 제외, 검토 필요는 서버 REVIEW 분류 수다.
 */
export function dashboardCounts(snapshot: Snapshot) {
  const open = (snapshot.surface?.parameterGaps ?? []).filter(gap => gap.status === "OPEN")
  const prioritized = open.filter(gap => gap.priorityReasons.length > 0)
  const apis = new Set(prioritized.map(gap => JSON.stringify([gap.endpoint.service, gap.endpoint.method, gap.endpoint.pathTemplate])))
  const unobserved = new Set(open.filter(gap => gap.type !== "AUTH_VARIANT_UNTESTED").map(gap => gapParameterKey(gap).stableKey))
  const authorization = new Set(open.filter(gap => gap.type === "AUTH_VARIANT_UNTESTED").map(gap => gap.id))
  return [
    { label: "우선 점검 API", value: apis.size, caption: "우선순위 근거가 있는 미점검 API · 서비스·메서드·경로 중복 제외" },
    { label: "미점검 파라미터", value: unobserved.size, caption: "주체·계정·정의·조건·타입별로 아직 점검하지 않은 입력 · 중복 제외" },
    { label: "권한 변형 미점검", value: authorization.size, caption: "아직 점검하지 않은 권한 변형 수 · 같은 항목 중복 제외" },
    { label: "검토 필요", value: snapshot.trafficStats.review, caption: "서버가 REVIEW로 분류한 트래픽 수" },
  ] as const
}

/**
 * 대시보드 상단 3블록(snapshot 띠·3소스 관측 비교·인가 판정 요약)의 실데이터 값. 서버 관측 수치만 옮기며 퍼센트를 만들지 않는다(D-002).
 * 소스별 관측 수는 이벤트를 source(human/scanner/llm)별로 셈하고, 인가 판정 요약은 서버 매트릭스 summary가 있을 때만 채운다.
 */
export function dashboardSummary(snapshot: Snapshot): DashboardSummaryValues {
  const sourceCounts = { human: 0, scanner: 0, llm: 0 }
  for (const event of snapshot.events) {
    if (event.source === "human" || event.source === "scanner" || event.source === "llm") sourceCounts[event.source] += 1
  }
  const matrix = snapshot.authorizationMatrix?.summary
  const stats = snapshot.trafficStats
  return {
    trafficStats: { captured: stats.captured, coverage: stats.coverage, excluded: stats.excluded, dropped: stats.dropped, payloadMetadataOnly: stats.payloadMetadataOnly },
    sourceCounts,
    authorizationSummary: matrix
      ? { bolaIdorCandidates: matrix.bolaIdorCandidates, bflaCandidates: matrix.bflaCandidates, manualReviewPending: matrix.manualReviewPending, humanConfirmed: matrix.humanConfirmed, humanDismissed: matrix.humanDismissed }
      : undefined,
  }
}

export function hasDashboardData(snapshot: Snapshot): boolean {
  const surface = snapshot.surface
  return snapshot.trafficStats.captured > 0 || snapshot.events.length > 0
    || (surface?.parameterGaps?.length ?? 0) > 0
    || (surface?.endpoints ?? []).some(endpoint => endpoint.declarations.length > 0 || endpoint.parameters.length > 0)
}

export function openGapCount(snapshot: Snapshot): number {
  return (snapshot.surface?.parameterGaps ?? []).filter(gap => gap.status === "OPEN").length
}

export interface PriorityApiRow { key: string; method: string; path: string; gapCount: number; reasons: readonly string[] }

// 서버 ParameterGap.PRIORITY_ORDER와 같은 순서. 이유를 새로 만들지 않고 서버가 준 이유만 정렬·요약한다.
const priorityOrder = ["CONFIRMED_AUTH_BOUNDARY", "AUTH_VARIANT_UNTESTED", "WRITE_METHOD", "CORROBORATED_EVIDENCE", "SOURCE_DISCREPANCY", "HUMAN_REVIEW_REQUIRED"]
const rank = (reasons: readonly string[]) => priorityOrder.map(reason => reasons.includes(reason) ? 0 : 1).join("")

/** 우선순위 근거가 있는 열린 Gap을 API(서비스·메서드·경로)별로 묶는다. 더 강한 이유가 먼저, 같으면 Gap이 많은 API가 먼저. */
export function priorityApiRows(snapshot: Snapshot, limit = 5): PriorityApiRow[] {
  const rows = new Map<string, { method: string; path: string; gapCount: number; reasons: Set<string> }>()
  for (const gap of snapshot.surface?.parameterGaps ?? []) {
    if (gap.status !== "OPEN" || gap.priorityReasons.length === 0) continue
    const key = JSON.stringify([gap.endpoint.service, gap.endpoint.method, gap.endpoint.pathTemplate])
    const row = rows.get(key) ?? { method: gap.endpoint.method, path: gap.endpoint.pathTemplate, gapCount: 0, reasons: new Set<string>() }
    row.gapCount += 1
    for (const reason of gap.priorityReasons) row.reasons.add(reason)
    rows.set(key, row)
  }
  return [...rows].map(([key, row]) => ({ key, method: row.method, path: row.path, gapCount: row.gapCount, reasons: [...row.reasons] }))
    .sort((a, b) => rank(a.reasons).localeCompare(rank(b.reasons)) || b.gapCount - a.gapCount || a.key.localeCompare(b.key))
    .slice(0, limit)
}

export interface SourceCoverageRow { key: string; method: string; path: string; sources: readonly ("HUMAN" | "SCANNER" | "LLM")[] }

/** 실제 응답이 있는 API마다 어느 소스가 관측했는지. 일부 소스만 본 API를 먼저 둔다(서버 observedSources 그대로, 조합 공간을 만들지 않음). */
export function sourceCoverageRows(snapshot: Snapshot, limit = 8): SourceCoverageRow[] {
  const known = ["HUMAN", "SCANNER", "LLM"] as const
  return (snapshot.surface?.endpoints ?? [])
    .filter(endpoint => endpoint.observedSources.length > 0)
    .map(endpoint => ({ key: JSON.stringify([endpoint.key.service, endpoint.key.method, endpoint.key.pathTemplate]), method: endpoint.key.method, path: endpoint.key.pathTemplate, sources: known.filter(source => endpoint.observedSources.includes(source)) }))
    .sort((a, b) => a.sources.length - b.sources.length || a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
    .slice(0, limit)
}

/** 메인 비교(INCLUDE)에 들어간 최근 관측. 마지막 관측 시각 순. */
export function recentEvents(snapshot: Snapshot, limit = 6) {
  return snapshot.events.filter(event => event.trafficDisposition === "INCLUDE").sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit)
}
