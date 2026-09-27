import type { ReactNode } from "react"
import type { Cell, Verdict } from "@/lib/api/types"
import { stripOrigin } from "@/lib/display/operationLabel"
import { matrixVerdictTone } from "@/features/matrix/MatrixVerdictCell"
import type { HierarchyNode, HierarchyProjection } from "./graphHierarchy"

const severity: readonly Verdict[] = ["suspicious", "undecided", "untested", "deny", "allow"]
/** 여러 셀 중 가장 먼저 봐야 할 판정. 서버 판정을 합치지 않고 순서만 고른다. */
function mostUrgent(cells: readonly Cell[]): Verdict {
  return severity.find(verdict => cells.some(cell => cell.overall === verdict)) ?? "untested"
}
function groupBy(cells: readonly Cell[], key: (cell: Cell) => string | null) {
  const groups = new Map<string, Cell[]>()
  for (const cell of cells) { const value = key(cell); if (value) groups.set(value, [...(groups.get(value) ?? []), cell]) }
  return groups
}
const plain = (value: string) => stripOrigin(value) || value

interface Summary { stats: readonly [string, number][]; sources?: HierarchyProjection["groups"][number]["sourceCounts"]; listTitle: string; list: readonly [string, string | Verdict][] }

/** 한 번 클릭한 노드의 요약. 객체는 접근한 신원과 소유자를, 나머지는 통계와 하위 목록을 보여 준다. */
export function graphNodeSummary(node: HierarchyNode, projection: HierarchyProjection): Summary | null {
  if (node.kind === "target") {
    const groups = projection.groups
    return {
      stats: [["API 그룹", groups.length], ["API", groups.reduce((sum, group) => sum + group.endpointCount, 0)], ["Gap", groups.reduce((sum, group) => sum + group.gapCount, 0)]],
      listTitle: "Gap이 많은 그룹",
      list: [...groups].sort((a, b) => b.gapCount - a.gapCount).slice(0, 5).map(group => [group.label, `Gap ${group.gapCount}`]),
    }
  }
  if (node.kind === "api-group") {
    const group = projection.groups.find(item => item.id === node.groupId)
    if (!group) return null
    return {
      stats: [["API", group.endpointCount], ["Gap", group.gapCount], ["경로 후보", group.routeCandidateCount]],
      sources: group.sourceCounts,
      listTitle: "포함된 API",
      list: group.operations.slice(0, 8).map(operation => [plain(operation), mostUrgent(group.cells.filter(cell => cell.op === operation))]),
    }
  }
  const cells = node.selection.cells
  if (node.kind === "identity") {
    const byTarget = groupBy(cells, projection.kind === "operation" ? cell => cell.resource : cell => cell.op)
    return {
      stats: [[projection.kind === "operation" ? "접근 객체" : "접근 API", byTarget.size], ["주의", cells.filter(cell => cell.overall === "suspicious" || cell.overall === "undecided").length], ["허용", cells.filter(cell => cell.overall === "allow").length]],
      listTitle: projection.kind === "operation" ? "접근한 객체" : "이 신원이 접근한 API",
      list: [...byTarget].slice(0, 8).map(([target, items]) => [plain(target), mostUrgent(items)]),
    }
  }
  if (node.kind === "resource") {
    const byIdentity = groupBy(cells, cell => cell.idn)
    const owner = node.owner ?? null
    return {
      stats: [["접근 신원", byIdentity.size], ["주의", cells.filter(cell => cell.overall === "suspicious" || cell.overall === "undecided").length], ["Evidence", new Set(cells.flatMap(cell => cell.evidenceIds)).size]],
      listTitle: owner ? `접근한 신원 · 소유자 ${owner}` : "접근한 신원",
      list: [...byIdentity].slice(0, 8).map(([identity, items]) => [identity === owner ? `${identity} (소유자)` : identity, mostUrgent(items)]),
    }
  }
  if (node.kind === "operation") {
    const byIdentity = groupBy(cells, cell => cell.idn)
    return {
      stats: [["신원", byIdentity.size], ["객체", new Set(cells.map(cell => cell.resource).filter(Boolean)).size], ["주의", cells.filter(cell => cell.overall === "suspicious" || cell.overall === "undecided").length]],
      listTitle: "접근한 신원",
      list: [...byIdentity].slice(0, 8).map(([identity, items]) => [identity, mostUrgent(items)]),
    }
  }
  return null
}

const verdicts = new Set<string>(severity)

/** children은 통계 상자 바로 아래에 둔다(예: 객체 소유자 지정). */
export function GraphNodeSummary({ summary, hint, children }: { summary: Summary; hint?: string; children?: ReactNode }) {
  return <section aria-label="노드 요약" className="mb-4 grid gap-3 border-b pb-4 text-sm">
    <dl className="grid grid-cols-3 gap-2">{summary.stats.map(([label, value]) => <div key={label} className="rounded-md border border-border/70 px-2 py-1.5"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-base font-semibold tabular-nums">{value}</dd></div>)}</dl>
    {children}
    {summary.sources && <p className="flex flex-wrap gap-x-3 text-xs"><span><span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-observation-human align-middle" />HUMAN {summary.sources.human}</span><span><span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-observation-scanner align-middle" />SCANNER {summary.sources.scanner}</span><span><span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-observation-llm align-middle" />LLM {summary.sources.llm}</span></p>}
    {summary.list.length > 0 && <div><h3 className="mb-1 text-xs font-semibold text-muted-foreground">{summary.listTitle}</h3><ul className="grid">{summary.list.map(([label, value]) => {
      const tone = verdicts.has(value) ? matrixVerdictTone(value as Verdict) : null
      return <li key={label} className="flex items-center justify-between gap-2 border-t border-border/70 py-1.5 first:border-t-0"><span className="min-w-0 break-all font-mono text-xs">{label}</span>{tone ? <span className={`shrink-0 rounded px-1.5 text-[11px] font-medium ${tone.className}`}>{tone.label}</span> : <span className="shrink-0 text-xs text-muted-foreground">{value}</span>}</li>
    })}</ul></div>}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </section>
}
