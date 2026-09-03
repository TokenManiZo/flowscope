import { Button } from "@/components/ui/button"
import { RouteCandidateDetail } from "./RouteCandidateDetail"
import type { GraphProjection, GraphSelection } from "./graphProjection"

export function ResponsiveGraphList({ projection, onSelect }: { projection: GraphProjection; onSelect(selection: GraphSelection): void }) {
  return <section className="grid gap-2" aria-label="공격면 API 목록">
    <p className="text-sm text-muted-foreground">900px 이하에서는 같은 필터 결과를 키보드 접근 가능한 API 목록으로 표시합니다.</p>
    {projection.listItems.map((item) => {
      const edges = projection.edges.filter((edge) => edge.targetId === item.id)
      const semantics = edges.map((edge) => `${edge.sourceText} · ${item.verdictText}${edge.countLabel ? ` · ${edge.countLabel}` : ""}`).join(" / ") || `UNKNOWN · ${item.verdictText}`
      const identityResource = `${item.selection.identity ?? "UNKNOWN"} · ${item.selection.resource ?? "객체 없음"}`
      return <Button key={item.id} variant="outline" className="h-auto justify-start whitespace-normal p-3 text-left" onClick={() => onSelect(item.selection)}>
        <span className="grid gap-1"><span className="font-mono break-all">{item.label}</span><span className="text-xs">{identityResource}</span><span className="text-xs">{semantics}</span></span>
      </Button>
    })}
    {projection.routeCandidates.map((candidate) => <article className="grid gap-2 rounded-md border border-dashed p-3 text-sm" key={candidate.id}><Button variant="outline" className="h-auto justify-start whitespace-normal p-3 text-left" aria-label={`경로 후보 ${candidate.service} ${candidate.method} ${candidate.pathTemplate} ${candidate.observedText} ${candidate.applicability}`} onClick={() => onSelect(candidate.selection)}><span className="grid gap-1"><span className="font-mono break-all">{candidate.service}</span><span className="font-mono break-all">{candidate.method} {candidate.pathTemplate}</span><span>{candidate.observedText} · {candidate.applicability}</span></span></Button><RouteCandidateDetail candidate={candidate.selection.routeCandidate ?? candidate} /></article>)}
    {!projection.listItems.length && !projection.routeCandidates.length && <p className="rounded-md border p-3 text-sm text-muted-foreground">현재 필터에 표시할 INCLUDE 공격면이 없습니다. Evidence의 REVIEW/EXCLUDE는 그대로 유지됩니다.</p>}
  </section>
}
