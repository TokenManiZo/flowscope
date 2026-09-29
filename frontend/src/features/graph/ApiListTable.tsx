import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { EventRecord } from "@/lib/api/types"
import { apiRowStats, groupApiRows, shortPath, type ApiRowStats } from "./graphApiRows"
import { HIGHLIGHT_SOURCE_COLOR, STATUS_CLASS_COLOR, statusClass } from "./graphHighlight"
import type { HierarchyNode } from "./graphHierarchy"
import { operationParts } from "./relationshipNodeCard"

const SOURCE_LETTERS = [["human", "H"], ["scanner", "S"], ["llm", "L"]] as const
const GROUP_PREVIEW = 5

function Method({ method }: { method: string }) {
  return <span className="inline-block whitespace-nowrap rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold">{method}</span>
}

function StatCells({ stats }: { stats: ApiRowStats }) {
  return <>
    <td className="px-2"><div className="flex gap-1">{stats.codes.slice(0, 4).map(code => { const color = STATUS_CLASS_COLOR[statusClass(code)]; return <span key={code} className="rounded px-1 font-mono text-[11px]" style={{ color, background: `${color}22` }}>{code}</span> })}{stats.codes.length > 4 && <span className="rounded bg-muted px-1 font-mono text-[11px] text-muted-foreground">+{stats.codes.length - 4}</span>}</div></td>
    <td className="px-2 font-mono text-xs font-semibold">{SOURCE_LETTERS.filter(([source]) => stats.sources.has(source)).map(([source, letter], index) => <span key={source}>{index > 0 && <span className="text-muted-foreground"> · </span>}<span style={{ color: HIGHLIGHT_SOURCE_COLOR[source] }}>{letter}</span></span>)}</td>
    <td className="px-2 font-mono text-xs">{stats.identities.size}</td>
    <td className="px-2"><div className="flex gap-1">{stats.objects.size ? [...stats.objects].map(([type, members]) => <span key={type} className="whitespace-nowrap rounded border border-border px-1 font-mono text-[11px]">{type} {members.size}</span>) : <span className="text-muted-foreground/60">–</span>}</div></td>
  </>
}

/**
 * 그룹 화면의 API 목록 표. 메서드 + 경로 형식이 같은 API는 한 줄로 묶어 접어 두고, 펼치면 실제 경로가 들여 써져 나온다.
 * 줄을 누르면 카드 목록과 같이 그 API 화면으로 들어간다(onOpen).
 */
export function ApiListTable({ operations, events, onOpen }: { operations: readonly HierarchyNode[]; events: readonly EventRecord[]; onOpen(node: HierarchyNode): void }) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<readonly string[]>([])
  const [showAll, setShowAll] = useState<readonly string[]>([])
  const groups = useMemo(() => groupApiRows(operations), [operations])
  const statsOf = useMemo(() => apiRowStats(operations, events), [operations, events])
  const needle = query.trim().toLowerCase()
  const hit = (path: string) => path.toLowerCase().includes(needle)
  const pathOf = (node: HierarchyNode) => operationParts(node.label).path
  const toggle = (key: string) => setOpen(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])
  const row = "h-9 border-b border-border/70"
  const apiRow = (node: HierarchyNode, child: boolean) => <tr key={node.id} title={pathOf(node)} tabIndex={0} aria-label={node.label} className={cn(row, "cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none")} onClick={() => onOpen(node)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(node) } }}>
    <td />
    <td className="px-2">{!child && <Method method={operationParts(node.label).method} />}</td>
    <td className={cn("truncate px-2 font-mono text-xs", child && "pl-6")}>{child ? shortPath(pathOf(node)) : pathOf(node)}</td>
    <StatCells stats={statsOf([node])} />
  </tr>

  return <div className="grid gap-2">
    <div className="relative max-w-md"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" aria-hidden="true" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="경로 검색" aria-label="경로 검색" className="h-9 pl-8" /></div>
    <div className="overflow-auto rounded-md border border-border">
      <table className="w-full min-w-[680px] table-fixed text-left text-xs" aria-label="API 목록 표">
        <colgroup><col className="w-6" /><col className="w-[72px]" /><col /><col className="w-[110px]" /><col className="w-14" /><col className="w-12" /><col className="w-[140px]" /></colgroup>
        <thead className="sticky top-0 z-10 bg-card text-muted-foreground"><tr className={row}><th /><th className="px-2 font-medium">메서드</th><th className="px-2 font-medium">경로</th><th className="px-2 font-medium">응답</th><th className="px-2 font-medium">출처</th><th className="px-2 font-medium">신원</th><th className="px-2 font-medium">객체</th></tr></thead>
        <tbody>{groups.map(group => {
          if (group.items.length === 1) return hit(pathOf(group.items[0])) ? apiRow(group.items[0], false) : null
          const shapeHit = needle !== "" && hit(group.path)
          const shown = needle && !shapeHit ? group.items.filter(node => hit(pathOf(node))) : group.items
          if (!shown.length) return null
          const expanded = open.includes(group.key)
          const visible = showAll.includes(group.key) ? shown : shown.slice(0, GROUP_PREVIEW)
          return [
            <tr key={group.key} tabIndex={0} aria-expanded={expanded} aria-label={`${group.method} ${group.path} 묶음`} className={cn(row, "cursor-pointer bg-muted/30 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none")} onClick={() => toggle(group.key)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(group.key) } }}>
              <td className="pl-1">{expanded ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}</td>
              <td className="px-2"><Method method={group.method} /></td>
              <td className="truncate px-2 font-mono text-xs">{group.path}</td>
              <StatCells stats={statsOf(group.items)} />
            </tr>,
            ...(expanded ? visible.map(node => apiRow(node, true)) : []),
            expanded && shown.length > visible.length ? <tr key={`${group.key}:more`} className={cn(row, "cursor-pointer text-muted-foreground hover:bg-muted/40")} onClick={() => setShowAll(current => [...current, group.key])}><td /><td /><td className="pl-6 font-mono" colSpan={5}>… {shown.length - visible.length}개 더</td></tr> : null,
          ]
        })}</tbody>
      </table>
    </div>
  </div>
}
