import { Fragment, useMemo, useState, type KeyboardEvent } from "react"
import { ChevronDown, ChevronRight, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { Cell, Snapshot } from "@/lib/api/types"
import { apiRowStats, groupApiRows, objectRows, shortPath, type ApiRowStats } from "./graphApiRows"
import { HIGHLIGHT_SOURCE_COLOR } from "./graphHighlight"
import type { HierarchyNode } from "./graphHierarchy"
import { MethodBadge as Method, StatusBadge } from "./httpBadges"
import { operationParts } from "./relationshipNodeCard"

const SOURCE_LETTERS = [["human", "H"], ["scanner", "S"], ["llm", "L"]] as const
const GROUP_PREVIEW = 5
const OBJECT_PREVIEW = 10

const activate = (action: () => void) => (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action() } }

function StatCells({ stats, rowKey, openObjects, onObject }: { stats: ApiRowStats; rowKey: string; openObjects: readonly string[]; onObject(key: string): void }) {
  return <>
    <td className="px-2"><div className="flex gap-1">{stats.codes.slice(0, 4).map(code => <StatusBadge key={code} code={code} />)}{stats.codes.length > 4 && <span className="rounded bg-muted px-1 font-mono text-[13px] text-muted-foreground">+{stats.codes.length - 4}</span>}</div></td>
    {/* H·S·L은 자리를 고정해 없는 출처는 빈칸으로 둔다. 줄마다 같은 출처가 같은 세로 위치에 온다. */}
    <td className="px-2"><span className="grid w-12 grid-cols-3 font-mono text-sm font-semibold">{SOURCE_LETTERS.map(([source, letter]) => <span key={source} style={{ color: HIGHLIGHT_SOURCE_COLOR[source] }}>{stats.sources.has(source) ? letter : ""}</span>)}</span></td>
    <td className="px-2 font-mono text-[15px]">{stats.identities.size}</td>
    <td className="px-2"><div className="flex flex-wrap gap-1">{stats.objects.size ? [...stats.objects].map(([type, members]) => {
      const key = `${rowKey}|${type}`, open = openObjects.includes(key)
      // 칩은 줄 선택과 따로 객체 목록만 펼친다.
      return <button key={type} type="button" aria-expanded={open} aria-label={`${type} 객체 ${members.size}개 ${open ? "접기" : "펼치기"}`} onClick={event => { event.stopPropagation(); onObject(key) }} onKeyDown={event => event.stopPropagation()} className={cn("inline-flex items-center gap-0.5 whitespace-nowrap rounded border px-1 font-mono text-[13px] hover:bg-muted", open ? "border-sky-500 text-sky-600 dark:text-sky-300" : "border-border")}>{type} {members.size}{open ? <ChevronDown className="size-3" aria-hidden="true" /> : <ChevronRight className="size-3" aria-hidden="true" />}</button>
    }) : <span className="text-muted-foreground/60">–</span>}</div></td>
  </>
}

type TableSnapshot = Pick<Snapshot, "events" | "cells" | "owners">

function ObjectRows({ operations, type, snapshot, selectedId, onSelectObject }: { operations: readonly string[]; type: string; snapshot: TableSnapshot; selectedId: string | null; onSelectObject(resource: string, cells: readonly Cell[]): void }) {
  const [all, setAll] = useState(false)
  const rows = useMemo(() => objectRows(operations, type, snapshot), [operations, type, snapshot])
  const shown = all ? rows : rows.slice(0, OBJECT_PREVIEW)
  return <tr><td colSpan={2} /><td colSpan={5} className="py-2 pr-2">
    <table className="w-full table-fixed text-left text-[13px]" aria-label={`${type} 객체 목록`}>
      <colgroup><col className="w-[130px]" /><col className="w-[100px]" /><col /></colgroup>
      <thead className="text-muted-foreground"><tr className="h-10 border-b border-border"><th className="px-2 font-normal">객체</th><th className="px-2 font-normal">소유자</th><th className="px-2 font-normal">접근한 신원</th></tr></thead>
      <tbody>
        {shown.map(row => <tr key={row.resource} tabIndex={0} aria-label={row.label} aria-selected={selectedId === `resource:${row.resource}`} onClick={() => onSelectObject(row.resource, row.cells)} onKeyDown={activate(() => onSelectObject(row.resource, row.cells))} className={cn("h-10 cursor-pointer border-b border-border/70 last:border-0 hover:bg-muted/40", selectedId === `resource:${row.resource}` && "bg-sky-500/10")}>
          <td className="truncate px-2 font-mono text-sm" title={row.resource}>{row.label}</td>
          <td className="truncate px-2">{row.owner ?? <span className="text-muted-foreground/70">미확정</span>}</td>
          <td className="px-2"><div className="flex flex-wrap gap-x-3 gap-y-1">{row.identities.map(identity => <span key={identity.name} className="inline-flex items-center gap-1 whitespace-nowrap">{identity.name}{identity.codes.map(code => <StatusBadge key={code} code={code} />)}{identity.suspicious && <span className="rounded border border-red-500/50 bg-red-500/15 px-1 text-[11px] font-semibold text-red-600 dark:text-red-300">IDOR 후보</span>}</span>)}</div></td>
        </tr>)}
        {!all && rows.length > OBJECT_PREVIEW && <tr tabIndex={0} className="h-10 cursor-pointer text-muted-foreground hover:bg-muted/40" onClick={() => setAll(true)} onKeyDown={activate(() => setAll(true))}><td colSpan={3} className="px-2 font-mono">… {rows.length - OBJECT_PREVIEW}개 더</td></tr>}
      </tbody>
    </table>
  </td></tr>
}

/**
 * 그룹 화면의 API 목록 표. 메서드 + 경로 형식이 같은 API는 한 줄로 묶어 접어 두고, 펼치면 실제 경로가 들여 써져 나온다.
 * 줄을 누르면 화면을 옮기지 않고 그 API를 선택한다(상세는 오른쪽 패널). 객체 칩은 그 줄 아래에 객체 목록을 펼친다.
 */
export function ApiListTable({ operations, snapshot, selectedId, onSelectApi, onSelectObject }: { operations: readonly HierarchyNode[]; snapshot: TableSnapshot; selectedId: string | null; onSelectApi(node: HierarchyNode): void; onSelectObject(resource: string, cells: readonly Cell[]): void }) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<readonly string[]>([])
  const [showAll, setShowAll] = useState<readonly string[]>([])
  const [openObjects, setOpenObjects] = useState<readonly string[]>([])
  const groups = useMemo(() => groupApiRows(operations), [operations])
  const statsOf = useMemo(() => apiRowStats(operations, snapshot), [operations, snapshot])
  const needle = query.trim().toLowerCase()
  const hit = (path: string) => path.toLowerCase().includes(needle)
  const pathOf = (node: HierarchyNode) => operationParts(node.label).path
  const opsOf = (nodes: readonly HierarchyNode[]) => nodes.flatMap(node => node.selection.operation ? [node.selection.operation] : [])
  const toggle = (key: string) => setOpen(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])
  // 객체 목록은 칩마다 따로 열고 닫는다(여러 개를 동시에 펼칠 수 있다).
  const toggleObject = (key: string) => setOpenObjects(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])
  const objectRow = (rowKey: string, nodes: readonly HierarchyNode[]) => openObjects.filter(key => key.startsWith(`${rowKey}|`)).map(key => <ObjectRows key={key} operations={opsOf(nodes)} type={key.slice(rowKey.length + 1)} snapshot={snapshot} selectedId={selectedId} onSelectObject={onSelectObject} />)
  const apiRow = (node: HierarchyNode, child: boolean) => <Fragment key={node.id}>
    <tr title={pathOf(node)} tabIndex={0} aria-label={node.label} aria-selected={selectedId === node.id} className={cn("cursor-pointer border-b border-border/70 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none", child ? "h-10" : "h-12", selectedId === node.id && "bg-sky-500/10 shadow-[inset_3px_0_0_rgb(14_165_233)]")} onClick={() => onSelectApi(node)} onKeyDown={activate(() => onSelectApi(node))}>
      <td />
      <td className="px-2">{!child && <Method method={operationParts(node.label).method} />}</td>
      <td className={cn("truncate px-2 font-mono", child ? "pl-6 text-sm" : "text-[15px]")}>{child ? shortPath(pathOf(node)) : pathOf(node)}</td>
      <StatCells stats={statsOf([node])} rowKey={node.id} openObjects={openObjects} onObject={toggleObject} />
    </tr>
    {objectRow(node.id, [node])}
  </Fragment>

  return <div className="grid gap-2">
    <div className="relative max-w-md"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" aria-hidden="true" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="경로 검색" aria-label="경로 검색" className="h-10 pl-8 text-[15px]" /></div>
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[800px] table-fixed text-left text-[13px]" aria-label="API 목록 표">
        <colgroup><col className="w-6" /><col className="w-[80px]" /><col /><col className="w-[140px]" /><col className="w-[76px]" /><col className="w-14" /><col className="w-[160px]" /></colgroup>
        <thead className="sticky top-0 z-10 bg-card text-muted-foreground"><tr className="h-12 border-b border-border"><th /><th className="px-2 font-normal">메서드</th><th className="px-2 font-normal">경로</th><th className="px-2 font-normal">응답</th><th className="px-2 font-normal">출처</th><th className="px-2 font-normal">신원</th><th className="px-2 font-normal">객체</th></tr></thead>
        <tbody>{groups.map(group => {
          if (group.items.length === 1) return hit(pathOf(group.items[0])) ? apiRow(group.items[0], false) : null
          const shapeHit = needle !== "" && hit(group.path)
          const shown = needle && !shapeHit ? group.items.filter(node => hit(pathOf(node))) : group.items
          if (!shown.length) return null
          const expanded = open.includes(group.key)
          const visible = showAll.includes(group.key) ? shown : shown.slice(0, GROUP_PREVIEW)
          return <Fragment key={group.key}>
            <tr tabIndex={0} aria-expanded={expanded} aria-label={`${group.method} ${group.path} 묶음`} className="h-12 cursor-pointer border-b border-border/70 bg-muted/30 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none" onClick={() => toggle(group.key)} onKeyDown={activate(() => toggle(group.key))}>
              <td className="pl-1">{expanded ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}</td>
              <td className="px-2"><Method method={group.method} /></td>
              <td className="truncate px-2 font-mono text-[15px]">{group.path}</td>
              <StatCells stats={statsOf(group.items)} rowKey={group.key} openObjects={openObjects} onObject={toggleObject} />
            </tr>
            {objectRow(group.key, group.items)}
            {expanded && visible.map(node => apiRow(node, true))}
            {expanded && shown.length > visible.length && <tr tabIndex={0} className="h-10 cursor-pointer border-b border-border/70 text-muted-foreground hover:bg-muted/40" onClick={() => setShowAll(current => [...current, group.key])} onKeyDown={activate(() => setShowAll(current => [...current, group.key]))}><td /><td /><td className="pl-6 font-mono" colSpan={5}>… {shown.length - visible.length}개 더</td></tr>}
          </Fragment>
        })}</tbody>
      </table>
    </div>
  </div>
}
