import type { AuthorizationMatrix, Cell, MatrixCellBase, Source, Verdict } from "@/lib/api/types"
import { operationParts } from "./relationshipNodeCard"

/**
 * 사이트·API 그룹 요약 패널의 판정 정리. 판정은 화면에서 다시 계산하지 않고 서버 셀의 overall·출처별 이유를 그대로 나눈다.
 * - 후보: overall이 SUSPICIOUS인 셀. 이유에 "BFLA"가 있으면 BFLA 후보, 아니면 IDOR 후보(객체층).
 * - 확인 필요: overall이 UNDECIDED인 셀. 서버 이유 문장으로 네 갈래로 나눈다.
 */
export type CandidateType = "IDOR" | "BFLA"
export type UndecidedReason = "object" | "server" | "options" | "other"

export interface ScopeCandidate { key: string; op: string; method: string; path: string; resource: string | null; idn: string; type: CandidateType }
export interface ScopeUndecided { key: string; op: string; method: string; path: string; resource: string | null; idn: string; reason: UndecidedReason }
/** 신원별 요약. counts는 API마다 그 신원의 가장 급한 판정 하나로 센 값이라, 모두 더하면 apis와 같다. */
export interface ScopeIdentity { idn: string; sources: readonly Source[]; apis: number; counts: Readonly<Partial<Record<Verdict, number>>> }
export type RecommendationType = "BFLA" | "BOLA/IDOR"
export interface ScopeRecommendation { id: string; op: string; method: string; path: string; resource: string | null; type: RecommendationType; basis: string; test: string }

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"])
/** 한 API 안에서 셀 판정이 여럿이면 가장 급한 것 하나로 센다. */
const URGENCY: readonly Verdict[] = ["suspicious", "undecided", "untested", "deny", "allow"]
const SOURCES: readonly Source[] = ["human", "scanner", "llm", "unknown"]
const cellKey = (cell: Cell) => JSON.stringify([cell.idn, cell.op, cell.resource])
const reasonsOf = (cell: Cell) => SOURCES.flatMap(source => cell.reasons[source] ? [cell.reasons[source]!] : [])

/** 확인 필요 이유 분류. 서버 이유 문장(AuthorizationAnalyzer)이 바뀌면 함께 맞춘다. */
export function undecidedReason(cell: Cell): UndecidedReason {
  const reasons = reasonsOf(cell).join(" ")
  if (reasons.includes("대상 객체 포함 여부")) return "object"
  if (reasons.includes("OPTIONS/HEAD")) return "options"
  if (/404|429|5xx|해석 불가능/.test(reasons)) return "server"
  return "other"
}

export const UNDECIDED_REASON_LABEL: Record<UndecidedReason, string> = {
  object: "객체 포함 여부 미확인",
  server: "서버 오류·없는 경로",
  options: "OPTIONS·HEAD 요청",
  other: "기타",
}
export const UNDECIDED_REASON_ORDER: readonly UndecidedReason[] = ["object", "server", "options", "other"]

/** 셀 목록에서 후보·확인 필요·신원별 요약을 만든다. 후보는 상태를 바꾸는 요청이 먼저 오도록 정렬한다. */
export function scopeFindings(cells: readonly Cell[]) {
  const candidates: ScopeCandidate[] = [], undecided: ScopeUndecided[] = []
  const identities = new Map<string, { sources: Set<Source>; apis: Map<string, Verdict[]> }>()
  for (const cell of cells) {
    const { method, path } = operationParts(cell.op)
    if (cell.overall === "suspicious") candidates.push({ key: cellKey(cell), op: cell.op, method, path, resource: cell.resource, idn: cell.idn, type: reasonsOf(cell).some(reason => reason.includes("BFLA")) ? "BFLA" : "IDOR" })
    if (cell.overall === "undecided") undecided.push({ key: cellKey(cell), op: cell.op, method, path, resource: cell.resource, idn: cell.idn, reason: undecidedReason(cell) })
    const entry = identities.get(cell.idn) ?? identities.set(cell.idn, { sources: new Set(), apis: new Map() }).get(cell.idn)!
    for (const source of SOURCES) if (cell.perSource[source]) entry.sources.add(source)
    entry.apis.set(cell.op, [...(entry.apis.get(cell.op) ?? []), cell.overall])
  }
  candidates.sort((left, right) => Number(WRITE.has(right.method)) - Number(WRITE.has(left.method)) || left.path.localeCompare(right.path) || left.idn.localeCompare(right.idn))
  return {
    candidates,
    undecided,
    identities: [...identities].sort(([left], [right]) => left.localeCompare(right)).map(([idn, entry]): ScopeIdentity => {
      const counts: Partial<Record<Verdict, number>> = {}
      for (const verdicts of entry.apis.values()) { const worst = URGENCY.find(verdict => verdicts.includes(verdict)) ?? "untested"; counts[worst] = (counts[worst] ?? 0) + 1 }
      return { idn, sources: SOURCES.filter(source => entry.sources.has(source)), apis: entry.apis.size, counts }
    }),
  }
}

/**
 * 판정 매트릭스의 테스트 추천(아직 해 보지 않은 교차 조합) 중 주어진 API에 속한 것. 매트릭스와 같은 셀·상태를 그대로 쓴다.
 * 기능층은 BFLA_TEST_RECOMMENDED, 객체층은 BOLA_IDOR_TEST_RECOMMENDED만 센다. 상태를 바꾸는 요청이 먼저 온다.
 */
export function scopeRecommendations(matrix: AuthorizationMatrix | null | undefined, operations: ReadonlySet<string>): ScopeRecommendation[] {
  if (!matrix) return []
  const pick = (cells: readonly (MatrixCellBase & { resource?: string | null })[], status: string, type: RecommendationType) => cells
    .filter(cell => cell.status === status && cell.recommendation && operations.has(cell.operation))
    .map((cell): ScopeRecommendation => {
      const { method, path } = operationParts(cell.operation)
      return { id: cell.id, op: cell.operation, method, path, resource: cell.resource ?? null, type, basis: cell.recommendation!.basisIdentityLabel, test: cell.recommendation!.testIdentityLabel }
    })
  return [...pick(matrix.functions, "BFLA_TEST_RECOMMENDED", "BFLA"), ...pick(matrix.objects, "BOLA_IDOR_TEST_RECOMMENDED", "BOLA/IDOR")]
    .sort((left, right) => Number(WRITE.has(right.method)) - Number(WRITE.has(left.method)) || left.path.localeCompare(right.path) || left.id.localeCompare(right.id))
}
