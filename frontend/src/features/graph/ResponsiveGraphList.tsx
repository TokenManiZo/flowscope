import { identityLabel } from "@/lib/display/identityLabel"
import { graphAccountLabel } from "./graphAccounts"
import { apiConfirmed, apiTint } from "@/features/api-management/apiAppearance"
import { Button } from "@/components/ui/button"
import type { Snapshot } from "@/lib/api/types"
import type { GraphHighlight } from "./graphHighlight"
import { ApiListTable } from "./ApiListTable"
import { RouteCandidateDetail } from "./RouteCandidateDetail"
import { graphCellSelection, type GraphProjection, type GraphSelection } from "./graphProjection"
import type { HierarchyNode, HierarchyProjection } from "./graphHierarchy"
import { relationshipNodeCard } from "./relationshipNodeCard"

function CompactNodeCard({ badge, title, detail, footer, meta = [] }: { badge: string; title: string; detail: string; footer: string; meta?: readonly string[] }) {
  return <span className="grid w-full min-w-0 gap-2">
    <span className="flex min-w-0 items-center gap-2">
      <span data-node-badge={badge} className="shrink-0 rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{badge}</span>
      <span className="min-w-0 break-all font-mono text-sm font-semibold text-foreground">{title}</span>
    </span>
    <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{detail}</span>{footer && <span>{footer}</span>}
    </span>
    {!!meta.length && <span className="grid gap-1 border-t border-border/70 pt-2 text-xs text-muted-foreground">{meta.map(line => <span key={line}>{line}</span>)}</span>}
  </span>
}

export function ResponsiveGraphList({ projection, snapshot, selectedId = null, revealNodeId, searchMatches, highlight, filters, onRevealDismiss, onSelect, onNavigate }: { projection: GraphProjection | HierarchyProjection; snapshot?: Pick<Snapshot, "events" | "cells" | "owners" | "apiMarks" | "authorizationMatrix"> & Partial<Pick<Snapshot, "accounts">>; selectedId?: string | null; revealNodeId?: string; searchMatches?: ReadonlyMap<string, "direct" | "member">; highlight?: ReadonlyMap<string, string> | null; filters?: GraphHighlight; onRevealDismiss?(): void; onSelect(selection: GraphSelection, elementId?: string): void; onNavigate?(node: HierarchyNode): void }) {
  const hierarchy = "kind" in projection ? projection : null
  const matchedSiteNodes = hierarchy?.kind === "site" && highlight ? new Set(hierarchy.edges.filter(edge => highlight.has(edge.id)).flatMap(edge => [edge.sourceId, edge.targetId])) : null
  const items = hierarchy?.kind === "operation" ? hierarchy.listItems.filter(item => !item.selection.resource || hierarchy.resources.some(resource => resource.selection.resource === item.selection.resource)) : projection.listItems
  const summaryId = revealNodeId ?? selectedId
  const summary = summaryId && hierarchy?.nodes.find(node => node.id === summaryId && ["target", "identity", "object-group", "operation-group"].includes(node.kind))
  return <section className="grid gap-2" aria-label="공격면 API 목록">
    {summary && <Button data-graph-node-id={summary.id} variant="outline" className={`h-auto justify-start whitespace-normal p-3 text-left ${matchedSiteNodes && !matchedSiteNodes.has(summary.id) ? "opacity-30" : ""}`} onClick={() => onSelect(summary.selection, summary.id)}><CompactNodeCard badge={relationshipNodeCard(summary, projection).badge} title={summary.label} detail="검색으로 선택한 노드" footer="" /></Button>}
    {/* 그룹 화면의 API는 표로 보여준다(경로 형식 묶음). 줄을 누르면 화면을 옮기지 않고 선택만 한다. 요청 기록이 없으면 카드로 둔다. */}
    {hierarchy?.kind === "group" && snapshot && <ApiListTable operations={(items as HierarchyNode[]).filter(item => item.kind === "operation")} snapshot={snapshot} filters={filters} selectedId={selectedId} revealNodeId={revealNodeId} searchMatches={searchMatches} onRevealDismiss={onRevealDismiss} onSelectApi={node => onSelect(node.selection, node.id)} onSelectObject={(resource, cells) => { if (cells.length) onSelect(graphCellSelection(cells), `resource:${resource}`) }} />}
    {hierarchy?.kind === "group" && snapshot && (items as HierarchyNode[]).filter(item => item.kind === "observed-operation" || item.kind === "support-operation").map(item => {
      const card = relationshipNodeCard(item, projection)
      const op = item.selection.operation ?? ""
      return <Button key={item.id} data-graph-node-id={item.id} aria-label={card.accessibleLabel} variant="outline" className={`h-auto justify-start whitespace-normal border-border/80 bg-card/80 p-3 text-left ${snapshot ? apiTint(snapshot, op) : ""} ${searchMatches?.has(item.id) ? "outline-2 outline-dashed outline-emerald-600 dark:outline-emerald-300" : ""}`} onClick={() => onSelect(item.selection, item.id)}><CompactNodeCard badge={card.badge} title={card.title} detail={card.detail} footer={card.footer} /></Button>
    })}
    {!(hierarchy?.kind === "group" && snapshot) && items.map((item) => {
      if (hierarchy && item.kind === "api-group") {
        const group = hierarchy.groups.find(group => group.id === (item as HierarchyNode).groupId)
        const card = relationshipNodeCard(item, hierarchy)
        return <Button key={item.id} data-graph-node-id={item.id} aria-label={card.accessibleLabel} variant="outline" className={`h-auto justify-start whitespace-normal border-border/80 bg-card/80 p-3 text-left ${matchedSiteNodes && !matchedSiteNodes.has(item.id) ? "opacity-30" : ""} ${searchMatches?.has(item.id) ? "outline-2 outline-dashed outline-emerald-600 dark:outline-emerald-300" : ""}`} onClick={() => onNavigate?.(item as HierarchyNode)}><CompactNodeCard badge={card.badge} title={card.title} detail={card.detail} footer={card.footer} meta={group?.service ? [group.service] : []} /></Button>
      }
      const edges = hierarchy ? hierarchy.edges.filter(edge => (hierarchy.kind === "group" ? edge.targetId === item.id : edge.relation === (item.selection.resource ? "operation-resource" : "identity-operation") && edge.selection.cellKeys.some(key => (item as HierarchyNode).selection.cellKeys.includes(key)))) : projection.edges.filter((edge) => edge.targetId === item.id)
      const semantics = edges.map((edge) => `${edge.sourceText} · ${item.verdictText}${edge.countLabel ? ` · ${edge.countLabel}` : ""}`).join(" / ") || `UNKNOWN · ${item.verdictText}`
      const identityResource = hierarchy?.kind === "group" ? (snapshot?.accounts ? graphAccountLabel({ accounts: snapshot.accounts }, item.selection.identity ?? "복수 신원") : identityLabel(item.selection.identity ?? "복수 신원")) : `${(snapshot?.accounts ? graphAccountLabel({ accounts: snapshot.accounts }, item.selection.identity ?? "UNKNOWN") : identityLabel(item.selection.identity ?? "UNKNOWN"))} · ${item.selection.resource ?? "객체 없음"}`
      const card = relationshipNodeCard(item, projection)
      const op = ["operation", "observed-operation"].includes(item.kind) ? item.selection.operation ?? "" : ""
      const nodeId = ["observed-operation", "support-operation"].includes(item.kind) ? item.id : item.selection.resource ? `resource:${item.selection.resource}` : `operation:${item.selection.operation}`
      return <Button key={item.id} data-graph-node-id={nodeId} aria-label={card.accessibleLabel} variant="outline" className={`h-auto justify-start whitespace-normal border-border/80 bg-card/80 p-3 text-left ${snapshot ? apiTint(snapshot, op) : ""} ${searchMatches?.has(nodeId) ? "outline-2 outline-dashed outline-emerald-600 dark:outline-emerald-300" : ""}`} onClick={() => hierarchy?.kind === "group" ? onNavigate?.(item as HierarchyNode) : hierarchy ? onSelect(item.selection, item.id) : onSelect(item.selection)}>
        <CompactNodeCard badge={card.badge} title={card.title} detail={card.detail} footer={card.footer} meta={[identityResource, semantics, ...(snapshot && op && apiConfirmed(snapshot, op) ? ["취약점 확정"] : [])]} />
      </Button>
    })}
    {projection.routeCandidates.map((candidate) => <article className="grid gap-2 rounded-md border border-dashed p-3 text-sm" key={candidate.id}><Button data-graph-node-id={candidate.id} variant="outline" className={`h-auto justify-start whitespace-normal p-3 text-left ${snapshot ? apiTint(snapshot, `${candidate.service} ${candidate.method} ${candidate.pathTemplate}`) : ""} ${searchMatches?.has(candidate.id) ? "outline-2 outline-dashed outline-emerald-600 dark:outline-emerald-300" : ""}`} aria-label={`경로 후보 ${candidate.service} ${candidate.method} ${candidate.pathTemplate} ${candidate.observedText} ${candidate.applicability}`} onClick={() => onSelect(candidate.selection)}><span className="grid gap-1"><span className="font-mono break-all">{candidate.service}</span><span className="font-mono break-all">{candidate.method} {candidate.pathTemplate}</span><span>{candidate.observedText} · {candidate.applicability}</span></span></Button><RouteCandidateDetail candidate={candidate.selection.routeCandidate ?? candidate} /></article>)}
    {!projection.listItems.length && !projection.routeCandidates.length && <p className="rounded-md border p-3 text-sm text-muted-foreground">현재 필터에 표시할 INCLUDE 공격면이 없습니다. 관측 기록의 REVIEW/EXCLUDE는 그대로 유지됩니다.</p>}
  </section>
}
