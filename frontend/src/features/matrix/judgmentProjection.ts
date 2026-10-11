import type { AuthorizationMatrix, MatrixActual, MatrixConfidence, MatrixEvidenceRow, MatrixExpected, MatrixFunctionCell, MatrixObjectCell, MatrixStatus, ReviewStatus } from "@/lib/api/types"

/** 판정 매트릭스 표시 projection(PR#12 legacy 화면 의미 이식). 서버 값을 정렬·필터만 하고 상태·점수를 다시 계산하지 않는다. */
export type JudgmentView = "function" | "object" | "evidence"
export type JudgmentCell = MatrixFunctionCell | MatrixObjectCell
export type JudgmentItem = JudgmentCell | MatrixEvidenceRow
export type JudgmentTone = "risk" | "ok" | "invalid" | "gap" | "unknown"

export const JUDGMENT_ATTENTION: ReadonlySet<MatrixStatus> = new Set<MatrixStatus>([
  "BFLA_REPRODUCED", "BFLA_CANDIDATE", "BFLA_TEST_RECOMMENDED", "BFLA_REVIEW_REQUIRED",
  "BOLA_REPRODUCED", "BOLA_IDOR_CANDIDATE", "BOLA_IDOR_TEST_RECOMMENDED", "BOLA_IDOR_REVIEW_REQUIRED",
  "POLICY_CONFIRMATION_REQUIRED", "UNKNOWN_POLICY", "OWNERSHIP_UNKNOWN", "INVALID_EXPERIMENT", "COVERAGE_GAP", "EXPECTED_ACCESS_DENIED",
])
const RISK: ReadonlySet<MatrixStatus> = new Set<MatrixStatus>(["BFLA_REPRODUCED", "BFLA_CANDIDATE", "BFLA_TEST_RECOMMENDED", "BFLA_REVIEW_REQUIRED", "BOLA_REPRODUCED", "BOLA_IDOR_CANDIDATE", "BOLA_IDOR_TEST_RECOMMENDED", "BOLA_IDOR_REVIEW_REQUIRED"])
const REVIEWABLE: ReadonlySet<MatrixStatus> = new Set<MatrixStatus>(["BFLA_CANDIDATE", "BFLA_REVIEW_REQUIRED", "BOLA_IDOR_CANDIDATE", "BOLA_IDOR_REVIEW_REQUIRED"])

/** Display copy only: preserve server status, recommendations and review decisions. */
export function judgmentStatusLabel(item: Pick<JudgmentItem, "status" | "statusLabel">): string {
  const labels: Record<MatrixStatus, string> = {
    POLICY_ENFORCED: "접근 차단됨", EXPECTED_ACCESS: "접근 허용됨",
    EXPECTED_ACCESS_DENIED: "허용 계정 접근 실패",
    OWNERSHIP_UNKNOWN: "소유자 확인 필요", UNKNOWN_POLICY: "허용 계정 확인 필요",
    POLICY_CONFIRMATION_REQUIRED: "허용 계정 확인 필요",
    BFLA_TEST_RECOMMENDED: "접근 테스트 필요", BOLA_IDOR_TEST_RECOMMENDED: "접근 테스트 필요",
    BFLA_CANDIDATE: "BFLA 후보", BFLA_REPRODUCED: "BFLA 재현", BFLA_REVIEW_REQUIRED: "응답 확인 필요",
    BOLA_IDOR_CANDIDATE: "BOLA/IDOR 후보", BOLA_REPRODUCED: "BOLA/IDOR 재현", BOLA_IDOR_REVIEW_REQUIRED: "응답 확인 필요",
    INVALID_EXPERIMENT: "테스트 설정 확인", COVERAGE_GAP: "요청 기록 없음", UNTESTED: "확인 전",

  }
  return labels[item.status] ?? item.statusLabel
}

export function judgmentStatusDescription(status: MatrixStatus): string | undefined {
  const descriptions: Record<MatrixStatus, string> = {
    EXPECTED_ACCESS: "접근이 허용된 계정의 요청이 성공했습니다. 이 결과가 다른 객체의 접근까지 보장하지는 않습니다.",
    POLICY_ENFORCED: "접근하면 안 되는 계정의 요청이 차단됐습니다.",
    EXPECTED_ACCESS_DENIED: "접근이 허용된 계정인데 요청이 실패했습니다. 로그인 상태와 응답 내용을 확인하세요.",
    BFLA_TEST_RECOMMENDED: "더 높은 권한의 계정에서는 요청이 성공했습니다. 이 계정으로도 접근되는지 확인하세요.",
    BOLA_IDOR_TEST_RECOMMENDED: "다른 계정의 요청 기록이 있습니다. 이 계정으로도 해당 데이터에 접근되는지 확인하세요.",
    BFLA_CANDIDATE: "필요한 권한이 없는 계정이 기능을 사용한 의심 근거가 있습니다. 실제 응답을 확인하세요.",
    BOLA_IDOR_CANDIDATE: "다른 계정의 데이터에 접근한 의심 근거가 있습니다. 실제 응답을 확인하세요.",
    BFLA_REVIEW_REQUIRED: "요청은 성공했지만 권한 없이 기능을 사용했는지 확인이 필요합니다. 응답 내용을 확인하세요.",
    BOLA_IDOR_REVIEW_REQUIRED: "요청은 성공했지만 다른 계정의 데이터가 포함됐는지 확인이 필요합니다. 응답 내용을 확인하세요.",
    BFLA_REPRODUCED: "권한 없이 기능을 사용한 결과가 재현됐습니다. 접근 허용 기준도 확인하세요.",
    BOLA_REPRODUCED: "다른 계정의 데이터에 접근한 결과가 재현됐습니다. 공개·공유 데이터인지도 확인하세요.",
    OWNERSHIP_UNKNOWN: "이 데이터가 누구의 것인지 지정하세요. 공개 데이터라면 Public을 선택하세요.",
    UNKNOWN_POLICY: "어떤 권한의 계정이 접근할 수 있어야 하는지 정하세요.",
    POLICY_CONFIRMATION_REQUIRED: "요청 결과를 판단하려면 접근을 허용할 계정의 권한이나 공개·공유 여부를 확인하세요.",
    INVALID_EXPERIMENT: "로그인 상태 등 판정에 필요한 조건을 확인하세요. 현재 결과로는 취약점을 판단하기 어렵습니다.",
    COVERAGE_GAP: "이 계정의 요청 기록이 없어 접근 결과를 알 수 없습니다.",
    UNTESTED: "아직 판단할 근거가 충분하지 않습니다. 요청 기록과 응답을 확인하세요.",
  }
  return descriptions[status]
}

export const expectedLabel: Record<MatrixExpected, string> = { ALLOW: "허용", DENY: "차단", UNKNOWN: "미정" }
export const actualLabel: Record<MatrixActual, string> = { SUCCESS: "성공", DENIED: "차단", CONFLICT: "결과 다름", AMBIGUOUS: "근거 부족", UNTESTED: "미점검" }

export function judgmentTone(status: MatrixStatus): JudgmentTone {
  if (RISK.has(status)) return "risk"
  if (status === "POLICY_ENFORCED" || status === "EXPECTED_ACCESS") return "ok"
  if (status === "INVALID_EXPERIMENT") return "invalid"
  if (status === "COVERAGE_GAP" || status === "UNTESTED") return "gap"
  return "unknown"
}

/** 판단할 것이 없는 흔한 상태는 칸에 짧은 회색 글자로만 둔다(전체 문구는 aria-label·툴팁·상세에 유지). */
export const quietStatusLabel: Partial<Record<MatrixStatus, string>> = { UNKNOWN_POLICY: "허용 계정 확인 필요", COVERAGE_GAP: "요청 기록 없음", UNTESTED: "확인 전" }

export function reviewSuffix(status: ReviewStatus): string {
  return status === "CONFIRMED" ? " · 사용자 확정" : status === "DISMISSED" ? " · 정상/기각" : ""
}

/** 사람 판정은 추천이 있거나 후보/수동 검토 상태인 cell에만 연다(legacy 화면과 동일). */
export function isReviewable(item: Pick<JudgmentItem, "recommendation" | "status">): boolean {
  return item.recommendation !== null || REVIEWABLE.has(item.status)
}

export function withoutService(operation: string): string { return operation.replace(/^https?:\/\/\S+\s+/i, "") }

export function confidenceCodes(item: Pick<JudgmentItem, "policy" | "evidence"> & { ownership?: MatrixConfidence }): readonly string[] {
  return [item.policy?.code, item.evidence?.code, item.ownership?.code].filter((code): code is string => !!code)
}

export interface JudgmentRow {
  key: string
  operation: string
  resource: string | null
  policy: MatrixConfidence | null
  ownerLabel: string | null
  cellsByIdentity: Readonly<Record<string, JudgmentCell>>
  attention: boolean
}

export interface JudgmentProjection {
  view: JudgmentView
  identities: AuthorizationMatrix["identities"]
  rows: readonly JudgmentRow[]
  evidenceRows: readonly MatrixEvidenceRow[]
  hiddenRows: number
}

const rowKey = (operation: string, resource: string | null) => JSON.stringify([operation, resource])

export function projectJudgmentMatrix(matrix: AuthorizationMatrix, view: JudgmentView, attentionOnly: boolean): JudgmentProjection {
  const rows = new Map<string, JudgmentRow>()
  const cells: readonly JudgmentCell[] = view === "function" ? matrix.functions : view === "object" ? matrix.objects : []
  for (const cell of cells) {
    const resource = "resource" in cell ? cell.resource : null
    const key = rowKey(cell.operation, resource)
    const row = rows.get(key) ?? { key, operation: cell.operation, resource, policy: view === "function" ? cell.policy : null, ownerLabel: "ownerLabel" in cell ? cell.ownerLabel : null, cellsByIdentity: {}, attention: false }
    rows.set(key, { ...row, cellsByIdentity: { ...row.cellsByIdentity, [cell.identity]: cell }, attention: row.attention || JUDGMENT_ATTENTION.has(cell.status) })
  }
  const all = [...rows.values()]
  const visible = attentionOnly ? all.filter((row) => row.attention) : all
  const evidenceRows = view === "evidence" ? (attentionOnly ? matrix.evidence.filter((row) => JUDGMENT_ATTENTION.has(row.status)) : matrix.evidence) : []
  const hiddenRows = view === "evidence" ? matrix.evidence.length - evidenceRows.length : all.length - visible.length
  return { view, identities: matrix.identities, rows: visible, evidenceRows, hiddenRows }
}

export function findJudgmentItem(matrix: AuthorizationMatrix, id: string | null): JudgmentItem | null {
  if (!id) return null
  return matrix.functions.find((cell) => cell.id === id) ?? matrix.objects.find((cell) => cell.id === id) ?? matrix.evidence.find((row) => row.id === id) ?? null
}
