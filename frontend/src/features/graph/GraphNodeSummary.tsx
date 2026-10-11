import { identityLabel } from "@/lib/display/identityLabel"
import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
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

interface Summary { objectOwners?: boolean; stats: readonly [string, number][]; sources?: HierarchyProjection["groups"][number]["sourceCounts"]; listTitle: string; list: readonly [string, string | Verdict][] }

/** 한 번 클릭한 노드의 요약. 객체는 접근한 신원과 소유자를, 나머지는 통계와 하위 목록을 보여 준다. */
export function graphNodeSummary(node: HierarchyNode, projection: HierarchyProjection): Summary | null {
  if (node.kind === "target") {
    const groups = projection.groups
    return {
      stats: [["API 그룹", groups.length], ["API", groups.reduce((sum, group) => sum + group.endpointCount, 0)], ["미점검", groups.reduce((sum, group) => sum + group.gapCount, 0)]],
      listTitle: "미점검이 많은 그룹",
      list: [...groups].sort((a, b) => b.gapCount - a.gapCount).slice(0, 5).map(group => [group.label, `미점검 ${group.gapCount}`]),
    }
  }
  if (node.kind === "api-group") {
    const group = projection.groups.find(item => item.id === node.groupId)
    if (!group) return null
    return {
      stats: [["API", group.endpointCount], ...(group.observedCount ? [["관측 기능", group.observedCount] as [string, number]] : []), ["미점검", group.gapCount], ["경로 후보", group.routeCandidateCount]],
      sources: group.endpointCount ? group.sourceCounts : undefined,
      listTitle: "포함된 API",
      list: group.operations.slice(0, 8).map(operation => [plain(operation), mostUrgent(group.cells.filter(cell => cell.op === operation))]),
    }
  }
  if (node.staticResource) return {
    stats: [[node.kind === "operation-group" ? "경로" : "자원", node.objectGroup?.members.length ?? 1], ["관측 기록", node.selection.evidenceIds.length]],
    listTitle: "정적 자원 · 판정 제외", list: [],
  }
  if (node.kind === "resource" && node.selection.displayObjectKey) {
    const accesses = projection.edges.filter(edge => edge.targetId === node.id)
    const identities = [...new Set(accesses.map(edge => edge.selection.identity).filter((value): value is string => !!value))]
    return { stats: [["접근 신원", identities.length], ["관측 기록", node.selection.evidenceIds.length]], listTitle: "접근한 신원",
      list: identities.map(identity => [identity, "관측됨"] as [string, string]) }
  }
  if (node.kind === "object-group" && node.selection.displayApiKey && node.objectGroup) {
    return { stats: [["객체", node.objectGroup.members.length], ["관측 기록", node.selection.evidenceIds.length]], listTitle: "관측 객체",
      list: [], }
  }
  const cells = node.selection.cells
  if (node.kind === "identity") {
    const byTarget = groupBy(cells, projection.kind === "operation" ? cell => cell.resource : cell => cell.op)
    return {
      stats: [[projection.kind === "operation" ? "접근 객체" : "접근 API", byTarget.size], ["주의", cells.filter(cell => cell.overall === "suspicious" || cell.overall === "undecided").length], ["허용", cells.filter(cell => cell.overall === "allow").length]],
      listTitle: projection.kind === "operation" ? "접근한 객체" : "이 계정이 접근한 API",
      list: [...byTarget].slice(0, 8).map(([target, items]) => [plain(target), mostUrgent(items)]),
    }
  }
  if (node.kind === "operation-group" && node.objectGroup) {
    // API 묶음: 묶인 API와 그 API의 가장 급한 판정.
    return {
      stats: [["API", node.objectGroup.members.length], ["계정", groupBy(cells, cell => cell.idn).size], ["주의", cells.filter(cell => cell.overall === "suspicious" || cell.overall === "undecided").length]],
      listTitle: "묶음 API",
      list: node.objectGroup.members.map(member => [plain(member), mostUrgent(cells.filter(cell => cell.op === member))] as [string, string]),
    }
  }
  if (node.kind === "object-group" && node.objectGroup) {
    // 묶음 안 객체 목록과 소유자. 펼치지 않아도 어떤 객체가 묶였는지 확인할 수 있다.
    return {
      stats: [["객체", node.objectGroup.members.length], ["계정", groupBy(cells, cell => cell.idn).size], ["주의", cells.filter(cell => cell.overall === "suspicious" || cell.overall === "undecided").length]],
      objectOwners: true,
      listTitle: "객체 · 소유자",
      list: node.objectGroup.members.map(member => [stripOrigin(member) || member, identityLabel(node.objectGroup?.owners[member] ?? "소유자 확인 필요")] as [string, string]),
    }
  }
  if (node.kind === "resource") {
    const byIdentity = groupBy(cells, cell => cell.idn)
    const owner = node.owner ?? null
    return {
      stats: [["계정", byIdentity.size], ["주의", cells.filter(cell => cell.overall === "suspicious" || cell.overall === "undecided").length], ["요청 기록", new Set(cells.flatMap(cell => cell.evidenceIds)).size]],
      listTitle: owner ? `접근한 계정 · 소유자 ${identityLabel(owner)}` : "접근한 계정",
      list: [...byIdentity].slice(0, 8).map(([identity, items]) => [identity === owner ? `${identityLabel(identity)} (소유자)` : identity, mostUrgent(items)]),
    }
  }
  if (node.kind === "operation") {
    const byIdentity = groupBy(cells, cell => cell.idn)
    return {
      stats: [["계정", byIdentity.size], ["객체", node.displayObjectCount ?? new Set(cells.map(cell => cell.resource).filter(Boolean)).size], ["주의", cells.filter(cell => cell.overall === "suspicious" || cell.overall === "undecided").length]],
      listTitle: "접근한 계정",
      // 상세 패널의 identityVerdicts 조회 키로도 쓰므로 원본 신원을 유지한다.
      list: [...byIdentity].slice(0, 8).map(([identity, items]) => [identity, mostUrgent(items)]),
    }
  }
  return null
}

const verdicts = new Set<string>(severity)

/** children은 통계 상자 바로 아래에 둔다(예: 객체 소유자 지정). */
export function GraphNodeSummary({ summary, hint, children, labelIdentity = identityLabel }: { summary: Summary; hint?: string; children?: ReactNode; labelIdentity?: (identity: string) => string }) {
  const list = <ul className={summary.objectOwners ? "grid min-w-0 gap-2" : "grid"}>{summary.list.map(([label, value]) => {
      if (summary.objectOwners) return <li key={label} className="min-w-0 rounded-md border border-border/70 bg-muted/20 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-all text-xs font-medium text-muted-foreground">{label.split(":")[0]}</span><span className="rounded-md bg-muted px-2 py-1 text-xs"><span className="text-muted-foreground">소유자 </span>{value === "소유자 확인 필요" ? "미확정" : labelIdentity(value)}</span></div>
        <span className="block break-all font-mono text-xs leading-5 select-text" title={label}>{label}</span>
      </li>
      const tone = verdicts.has(value) ? matrixVerdictTone(value as Verdict) : null
      return <li key={label} className="flex items-center justify-between gap-2 border-t border-border/70 py-2 first:border-t-0"><span className="min-w-0 flex-1 truncate font-mono text-sm" title={labelIdentity(label)}>{labelIdentity(label)}</span>{tone ? <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${tone.className}`}>{tone.label}</span> : <span className="shrink-0 text-sm text-muted-foreground">{value}</span>}</li>
    })}</ul>
  return <section aria-label="노드 요약" className="mb-4 grid gap-3 border-b pb-4 text-sm">
    <dl className="grid grid-cols-3 gap-2">{summary.stats.map(([label, value]) => <div key={label} className="rounded-md border border-border/70 px-2 py-1.5"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-base font-semibold tabular-nums">{value}</dd></div>)}</dl>
    {children}
    {summary.sources && <p className="flex flex-wrap gap-x-3 text-xs"><span><span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-observation-human align-middle" />사람 {summary.sources.human}</span><span><span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-observation-scanner align-middle" />스캐너 {summary.sources.scanner}</span><span><span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-observation-llm align-middle" />LLM {summary.sources.llm}</span></p>}
    {summary.list.length > 0 && (summary.objectOwners
      ? <details open className="group min-w-0">
        <summary className="mb-2 flex cursor-pointer list-none items-center gap-2 rounded-md py-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <span>{summary.listTitle}</span><span className="text-xs font-normal tabular-nums">{summary.list.length}개</span>
          <span className="ml-auto text-xs font-normal group-open:hidden">펼치기</span><span className="ml-auto hidden text-xs font-normal group-open:inline">접기</span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-90" />
        </summary>
        {list}
      </details>
      : <div><h3 className="mb-1 text-sm font-semibold text-muted-foreground">{summary.listTitle}</h3>{list}</div>)}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </section>
}
