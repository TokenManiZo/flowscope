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
    { label: "우선 점검 API", value: apis.size, caption: "우선순위 근거가 있는 열린 Gap의 API · 서비스·메서드·경로 중복 제외" },
    { label: "미관측 파라미터", value: unobserved.size, caption: "주체·신원·정의·조건·타입 미관측 Gap의 입력 · 중복 제외" },
    { label: "권한 변형 미검증", value: authorization.size, caption: "열린 권한 변형 Gap 수 · 같은 Gap 중복 제외" },
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
