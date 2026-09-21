export interface DashboardSummaryValues {
  trafficStats: { captured: number; coverage: number; excluded: number; dropped: number; payloadMetadataOnly: number }
  sourceCounts: { human: number; scanner: number; llm: number }
  authorizationSummary?: { bolaIdorCandidates: number; bflaCandidates: number; manualReviewPending: number; humanConfirmed: number; humanDismissed: number }
}

// Integration boundary: intentionally not connected to snapshot/events yet.
export const EMPTY_DASHBOARD_SUMMARY: DashboardSummaryValues = {
  trafficStats: { captured: 0, coverage: 0, excluded: 0, dropped: 0, payloadMetadataOnly: 0 },
  sourceCounts: { human: 0, scanner: 0, llm: 0 },
}

const format = (value: number) => value.toLocaleString("ko-KR")

export function SnapshotStrip({ trafficStats }: Pick<DashboardSummaryValues, "trafficStats">) {
  const items = [["수집", trafficStats.captured], ["분석 대상", trafficStats.coverage], ["제외", trafficStats.excluded], ["삭제", trafficStats.dropped], ["Payload 메타", trafficStats.payloadMetadataOnly]] as const
  return <dl aria-label="현재 snapshot 요약" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-border py-3 text-sm text-muted-foreground">{items.map(([label, value], index) => <div key={label} className="flex items-center gap-2">{index > 0 && <span aria-hidden="true">·</span>}<dt>{label}</dt><dd className="font-mono font-medium tabular-nums text-foreground">{format(value)}</dd></div>)}</dl>
}

export function SourceObservationSummary({ sourceCounts }: Pick<DashboardSummaryValues, "sourceCounts">) {
  const sources = [{ key: "human", label: "HUMAN", dot: "bg-observation-human" }, { key: "scanner", label: "SCANNER", dot: "bg-observation-scanner" }, { key: "llm", label: "LLM", dot: "bg-observation-llm" }] as const
  return <section aria-labelledby="source-observation-title" className="space-y-3"><header><h2 id="source-observation-title" className="font-semibold">3소스 관측 비교</h2></header><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{sources.map(source => <div role="group" aria-label={source.label} key={source.key} className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-4"><h3 className="flex items-center gap-2 text-sm font-medium"><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${source.dot}`} />{source.label}</h3><p className="font-mono text-3xl font-semibold tabular-nums">{format(sourceCounts[source.key])}</p></div>)}</div></section>
}

export function AuthorizationDecisionSummary({ authorizationSummary }: Pick<DashboardSummaryValues, "authorizationSummary">) {
  const summary = authorizationSummary
  const tiles = [
    { label: "BOLA/IDOR 후보", value: format(summary?.bolaIdorCandidates ?? 0), candidate: (summary?.bolaIdorCandidates ?? 0) > 0 },
    { label: "BFLA 후보", value: format(summary?.bflaCandidates ?? 0), candidate: (summary?.bflaCandidates ?? 0) > 0 },
    { label: "검토 대기", value: format(summary?.manualReviewPending ?? 0), candidate: false },
    { label: "사람 확인 / 기각", value: `${format(summary?.humanConfirmed ?? 0)} / ${format(summary?.humanDismissed ?? 0)}`, candidate: false },
  ]
  return <section aria-labelledby="authorization-summary-title" className="space-y-3"><header><h2 id="authorization-summary-title" className="font-semibold">인가 판정 요약</h2></header><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{tiles.map(tile => <div role="group" aria-label={tile.label} key={tile.label} className={`min-w-0 space-y-3 rounded-lg border p-4 ${tile.candidate ? "border-candidate-border bg-candidate-surface" : "border-border bg-card"}`}><h3 className="text-sm font-medium">{tile.label}</h3><p className={`font-mono text-3xl font-semibold tabular-nums ${tile.candidate ? "text-candidate" : "text-foreground"}`}>{tile.value}</p></div>)}</div></section>
}
