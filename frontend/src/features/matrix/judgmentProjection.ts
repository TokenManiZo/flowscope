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

export const expectedLabel: Record<MatrixExpected, string> = { ALLOW: "허용", DENY: "차단", UNKNOWN: "미정" }
export const actualLabel: Record<MatrixActual, string> = { SUCCESS: "성공", DENIED: "차단", CONFLICT: "응답 갈림", AMBIGUOUS: "해석 불가", UNTESTED: "미실행" }

export function judgmentTone(status: MatrixStatus): JudgmentTone {
  if (RISK.has(status)) return "risk"
  if (status === "POLICY_ENFORCED" || status === "EXPECTED_ACCESS") return "ok"
  if (status === "INVALID_EXPERIMENT") return "invalid"
  if (status === "COVERAGE_GAP" || status === "UNTESTED") return "gap"
  return "unknown"
}

/** 판단할 것이 없는 흔한 상태는 칸에 짧은 회색 글자로만 둔다(전체 문구는 aria-label·툴팁·상세에 유지). */
export const quietStatusLabel: Partial<Record<MatrixStatus, string>> = { UNKNOWN_POLICY: "정책 미정", COVERAGE_GAP: "공백", UNTESTED: "미검증" }

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
