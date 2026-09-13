import { Button } from "@/components/ui/button"
import { RouteCandidateDetail } from "./RouteCandidateDetail"
import type { GraphProjection, GraphSelection } from "./graphProjection"
import type { HierarchyNode, HierarchyProjection } from "./graphHierarchy"
import { deriveGraphFocus } from "./graphFocus"
import { relationshipNodeCard } from "./relationshipNodeCard"

function CompactNodeCard({ badge, title, detail, footer, meta = [] }: { badge: string; title: string; detail: string; footer: string; meta?: readonly string[] }) {
  return <span className="grid w-full min-w-0 gap-2">
    <span className="flex min-w-0 items-center gap-2">
      <span data-node-badge={badge} className="shrink-0 rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-300">{badge}</span>
      <span className="min-w-0 break-all font-mono text-sm font-semibold text-foreground">{title}</span>
    </span>
    <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{detail}</span><span>{footer}</span>
    </span>
    {!!meta.length && <span className="grid gap-1 border-t border-border/70 pt-2 text-xs text-muted-foreground">{meta.map(line => <span key={line}>{line}</span>)}</span>}
  </span>
}

export function ResponsiveGraphList({ projection, onSelect, onNavigate, selectedElementId = null }: { projection: GraphProjection | HierarchyProjection; onSelect(selection: GraphSelection, elementId?: string): void; onNavigate?(node: HierarchyNode): void; selectedElementId?: string | null }) {
  const hierarchy = "kind" in projection ? projection : null
  const focus = deriveGraphFocus(hierarchy, selectedElementId)
  const items = hierarchy?.kind === "operation" ? hierarchy.listItems.filter(item => !item.selection.resource || hierarchy.resources.some(resource => resource.selection.resource === item.selection.resource)) : projection.listItems
  return <section className="grid gap-2" aria-label="공격면 API 목록">
    <p className="text-sm text-muted-foreground">900px 이하에서는 같은 필터 결과를 키보드 접근 가능한 API 목록으로 표시합니다.</p>
    {hierarchy && hierarchy.kind !== "site" && <div className="flex flex-wrap gap-2" aria-label="Identity focus">{hierarchy.identities.map(node => <Button variant={focus.identityNodeId === node.id ? "secondary" : "outline"} aria-pressed={focus.identityNodeId === node.id} key={node.id} onClick={() => onSelect(node.selection, node.id)}>{node.label}</Button>)}</div>}
    {items.map((item) => {
      if (hierarchy && item.kind === "api-group") {
        const group = hierarchy.groups.find(group => group.id === (item as HierarchyNode).groupId)
        const card = relationshipNodeCard(item, hierarchy)
        return <Button key={item.id} aria-label={card.accessibleLabel} variant="outline" className="h-auto justify-start whitespace-normal border-border/80 bg-card/80 p-3 text-left" onClick={() => onNavigate?.(item as HierarchyNode)}><CompactNodeCard badge={card.badge} title={card.title} detail={card.detail} footer={card.footer} meta={group?.service ? [group.service] : []} /></Button>
      }
      const edges = hierarchy ? hierarchy.edges.filter(edge => (hierarchy.kind === "group" ? edge.targetId === item.id : edge.relation === (item.selection.resource ? "operation-resource" : "identity-operation") && edge.selection.cellKeys.some(key => (item as HierarchyNode).selection.cellKeys.includes(key)))) : projection.edges.filter((edge) => edge.targetId === item.id)
      const semantics = edges.map((edge) => `${edge.sourceText} · ${item.verdictText}${edge.countLabel ? ` · ${edge.countLabel}` : ""}`).join(" / ") || `UNKNOWN · ${item.verdictText}`
      const identityResource = hierarchy?.kind === "group" ? `${item.selection.identity ?? "복수 신원"} · ${item.selection.evidenceIds.length} Evidence` : `${item.selection.identity ?? "UNKNOWN"} · ${item.selection.resource ?? "객체 없음"}`
      const card = relationshipNodeCard(item, projection)
      return <Button key={item.id} aria-label={card.accessibleLabel} variant="outline" className="h-auto justify-start whitespace-normal border-border/80 bg-card/80 p-3 text-left" onClick={() => hierarchy?.kind === "group" ? onNavigate?.(item as HierarchyNode) : hierarchy ? onSelect(item.selection, item.id) : onSelect(item.selection)}>
        <CompactNodeCard badge={card.badge} title={card.title} detail={card.detail} footer={card.footer} meta={[identityResource, semantics]} />
      </Button>
    })}
    {hierarchy && hierarchy.kind !== "site" && <div className="grid gap-1" aria-label="Source Evidence 경로">{hierarchy.edges.filter(edge => !edge.structural).map(edge => {
      const focused = focus.edgeState(edge.id)
      const selected = selectedElementId === edge.id
      const destination = hierarchy.resources.some(node => node.id === edge.targetId) ? edge.selection.resource : edge.relation === "candidate" ? `API 접근 → ${edge.selection.resource ?? "객체 없음"}` : "API 접근"
      return <Button key={edge.id} variant={selected ? "secondary" : "ghost"} aria-pressed={selected} data-focused={focused} className={`h-auto justify-start whitespace-normal text-left text-xs ${focused === "yes" ? "border border-foreground/60 bg-muted/60" : focused === "no" ? "opacity-45" : ""}`} onClick={() => onSelect(edge.selection, edge.id)}><span className="grid gap-1"><span className="flex items-center gap-2"><i role="img" aria-label={`${edge.sourceText || "중립"} ${edge.line}`} className="inline-block w-5 shrink-0 border-t-2" style={{ borderTopStyle: edge.line, borderTopColor: edge.color }} /><span>{edge.sourceText || "미교차 후보"} · {edge.selection.identity} · {edge.selection.operation} · {destination} {edge.countLabel}</span></span>{focused === "yes" && <span className="font-semibold">포커스 경로</span>}</span></Button>
    })}</div>}
    {projection.routeCandidates.map((candidate) => <article className="grid gap-2 rounded-md border border-dashed p-3 text-sm" key={candidate.id}><Button variant="outline" className="h-auto justify-start whitespace-normal p-3 text-left" aria-label={`경로 후보 ${candidate.service} ${candidate.method} ${candidate.pathTemplate} ${candidate.observedText} ${candidate.applicability}`} onClick={() => onSelect(candidate.selection)}><span className="grid gap-1"><span className="font-mono break-all">{candidate.service}</span><span className="font-mono break-all">{candidate.method} {candidate.pathTemplate}</span><span>{candidate.observedText} · {candidate.applicability}</span></span></Button><RouteCandidateDetail candidate={candidate.selection.routeCandidate ?? candidate} /></article>)}
    {!projection.listItems.length && !projection.routeCandidates.length && <p className="rounded-md border p-3 text-sm text-muted-foreground">현재 필터에 표시할 INCLUDE 공격면이 없습니다. Evidence의 REVIEW/EXCLUDE는 그대로 유지됩니다.</p>}
  </section>
}
