import type { JudgmentCell, JudgmentRow, JudgmentView } from "./judgmentProjection"

export interface MatrixExclusion { key: string; view: JudgmentView; operation: string; resource: string | null; label: string }
export interface ApiJudgmentRow extends JudgmentRow { objectCount: number; countsByIdentity: Record<string, readonly { label: string; count: number }[]> }
export const exclusionKey = (view: JudgmentView, operation: string, resource: string | null) => JSON.stringify([view, operation, resource])
export function isExcluded(row: JudgmentRow, view: JudgmentView, exclusions: readonly MatrixExclusion[]) {
  return exclusions.some(entry => entry.view === view && entry.operation === row.operation && (entry.resource === null || entry.resource === row.resource))
}
function priority(cell: JudgmentCell): number {
  if (cell.reviewStatus === "CONFIRMED") return 100
  if (cell.reviewStatus === "DISMISSED") return 0
  if (cell.status.includes("REPRODUCED")) return 90
  if (cell.status.includes("CANDIDATE")) return 80
  if (cell.status.includes("REVIEW_REQUIRED")) return 70
  if (cell.status.includes("TEST_RECOMMENDED")) return 60
  if (["POLICY_ENFORCED", "EXPECTED_ACCESS"].includes(cell.status)) return 10
  return 40
}
function countLabel(cell: JudgmentCell) {
  if (cell.reviewStatus === "CONFIRMED") return "사용자 확정"
  if (cell.reviewStatus === "DISMISSED") return "정상·기각"
  if (cell.status.includes("REPRODUCED")) return "재현"
  if (cell.status.includes("CANDIDATE")) return "의심"
  if (cell.status === "POLICY_ENFORCED") return "접근 차단"
  if (cell.status === "EXPECTED_ACCESS") return "접근 허용"
  if (["UNTESTED", "COVERAGE_GAP"].includes(cell.status)) return "확인 전"
  return "확인 필요"
}
/** Summary selects an existing cell for display; it never changes authority, evidence or review IDs. */
export function groupApiJudgments(rows: readonly JudgmentRow[]): ApiJudgmentRow[] {
  const groups = new Map<string, JudgmentRow[]>()
  for (const row of rows) { const group = groups.get(row.operation) ?? []; group.push(row); groups.set(row.operation, group) }
  return [...groups].map(([operation, rows]) => {
    const cellsByIdentity: Record<string, JudgmentCell> = {}
    const counts: Record<string, Map<string, number>> = {}
    for (const row of rows) for (const [identity, cell] of Object.entries(row.cellsByIdentity)) {
      const previous = cellsByIdentity[identity]
      if (!previous || priority(cell) > priority(previous)) cellsByIdentity[identity] = cell
      const counter = counts[identity] ??= new Map()
      const label = countLabel(cell); counter.set(label, (counter.get(label) ?? 0) + 1)
    }
    return { ...rows[0], key: JSON.stringify([operation, null]), operation, resource: null, ownerLabel: null,
      cellsByIdentity, attention: rows.some(row => row.attention), objectCount: rows.filter(row => row.resource !== null).length,
      countsByIdentity: Object.fromEntries(Object.entries(counts).map(([identity, counter]) => [identity, [...counter].map(([label, count]) => ({ label, count }))])) }
  })
}
const MAX_EXCLUSIONS = 5000
const storageKey = (scope: string) => `flowscope.matrix.exclusions.v1:${scope}`
export function loadMatrixExclusions(scope: string | null): MatrixExclusion[] {
  if (!scope) return []
  try {
    const raw = localStorage.getItem(storageKey(scope))
    if (!raw || raw.length > 2_000_000) return []
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value) || value.length > MAX_EXCLUSIONS) return []
    return value.filter((entry): entry is MatrixExclusion => entry && ["function", "object"].includes(entry.view)
      && typeof entry.operation === "string" && entry.operation.length <= 16384
      && (entry.resource === null || typeof entry.resource === "string" && entry.resource.length <= 16384)
      && typeof entry.label === "string" && entry.label.length <= 16384
      && entry.key === exclusionKey(entry.view, entry.operation, entry.resource))
  } catch { return [] }
}
export function saveMatrixExclusions(scope: string | null, entries: readonly MatrixExclusion[]): boolean {
  if (!scope) return false
  try {
    const raw = JSON.stringify(entries)
    if (entries.length > MAX_EXCLUSIONS || raw.length > 2_000_000) return false
    localStorage.setItem(storageKey(scope), raw); return true
  } catch { return false }
}
