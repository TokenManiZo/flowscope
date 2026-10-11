import { identityLabel } from "@/lib/display/identityLabel"
import type { ReactNode } from "react"

import type { EventRecord, ReviewStatus, Scenario } from "@/lib/api/types"
import { evidenceOrdinalLabel, observedTimeLabel } from "@/lib/display/operationLabel"
import { cn } from "@/lib/utils"
import { scenarioTitleParts } from "@/features/scenarios/ScenarioCard"
import type { PriorityApiRow, SourceCoverageRow } from "./dashboardSelectors"

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

export interface PipelineCounts { openGaps: number; priorityApis: number; authVariants: number; unobserved: number; review: number }

const format = (value: number) => value.toLocaleString("ko-KR")

type Row = { label: ReactNode; name: string; value: string; tone?: "candidate" | "zero"; href?: string }

function StageRows({ rows }: { rows: readonly (Row | "divider")[] }) {
  return <div className="grid content-start gap-1.5 text-sm">{rows.map((row, index) => row === "divider"
    ? <hr key={`divider-${index}`} className="my-0.5 border-border/70" />
    : <div role="group" aria-label={row.name} key={row.name} className="flex items-center justify-between gap-3">{row.href ? <a href={row.href} className="relative z-10 underline decoration-border underline-offset-4 hover:decoration-foreground">{row.label}</a> : <span>{row.label}</span>}<span className={cn("font-semibold tabular-nums", row.tone === "candidate" && "text-candidate", row.tone === "zero" && "font-normal text-muted-foreground")}>{row.value}</span></div>)}</div>
}

// 칸 전체를 덮는 링크(오버레이) 위에 행 링크를 따로 올린다. 링크 안에 링크를 넣지 않기 위한 구조다.
function Stage({ step, href, go, value, unit, hot, rows, notch }: { step: string; href: string; go: string; value: number; unit: string; hot?: boolean; rows: readonly (Row | "divider")[]; notch?: boolean }) {
  return <div className={cn(
    "group relative grid grid-rows-[auto_auto_1fr] gap-3.5 p-5 transition-colors hover:bg-muted/50 has-[a[data-stage]:focus-visible]:bg-muted/50",
    notch && "border-t border-border lg:border-t-0 lg:border-l lg:before:absolute lg:before:-left-[9px] lg:before:top-6 lg:before:z-10 lg:before:size-4 lg:before:rotate-45 lg:before:rounded-tr-[3px] lg:before:border-t lg:before:border-r lg:before:border-border lg:before:bg-card lg:before:content-['']",
  )}>
    <a data-stage href={href} aria-label={`${step} · ${go}`} className="absolute inset-0 focus-visible:outline-none" />
    <div className="flex items-center justify-between text-sm font-semibold text-muted-foreground"><span>{step}</span><span aria-hidden="true" className="text-xs font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-has-[a[data-stage]:focus-visible]:opacity-100">{go} →</span></div>
    <p className={cn("pointer-events-none text-4xl font-bold leading-none tabular-nums", hot && "text-candidate")}>{format(value)}<span className="ml-1.5 text-sm font-medium text-muted-foreground">{unit}</span></p>
    <div className="pointer-events-none [&_a]:pointer-events-auto"><StageRows rows={rows} /></div>
  </div>
}

const sourceDot = (className: string, label: string) => <><span aria-hidden="true" className={cn("mr-2 inline-block size-1.5 rounded-full align-middle", className)} />{label}</>

/** 관측 → 비교 → 판정 한 판. 칸 전체가 해당 화면으로 가는 링크이며 퍼센트는 만들지 않는다(D-002). */
export function DashboardPipeline({ values, counts }: { values: DashboardSummaryValues; counts: PipelineCounts }) {
  const auth = values.authorizationSummary
  const candidates = (auth?.bolaIdorCandidates ?? 0) + (auth?.bflaCandidates ?? 0)
  const zero = (value: number): Row["tone"] => value === 0 ? "zero" : undefined
  return <section aria-label="점검 흐름" className="grid overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-3">
    <Stage step="관측" href="#evidence" go="요청 기록" value={values.trafficStats.captured} unit="건 수집" rows={[
      { name: "HUMAN", label: sourceDot("bg-observation-human", "HUMAN"), value: format(values.sourceCounts.human) },
      { name: "SCANNER", label: sourceDot("bg-observation-scanner", "SCANNER"), value: format(values.sourceCounts.scanner) },
      { name: "LLM", label: sourceDot("bg-observation-llm", "LLM"), value: format(values.sourceCounts.llm) },
      "divider",
      { name: "검토 필요 트래픽", label: "검토 필요 트래픽", value: format(counts.review), tone: zero(counts.review), href: counts.review > 0 ? "#evidence-review" : undefined },
    ]} />
    <Stage notch step="비교" href="#graph" go="점검 그래프" value={counts.openGaps} unit="미점검" rows={[
      { name: "우선 점검 API", label: "우선 점검 API", value: format(counts.priorityApis), tone: zero(counts.priorityApis) },
      { name: "권한 변형 미점검", label: "권한 변형 미점검", value: format(counts.authVariants), tone: zero(counts.authVariants) },
      { name: "미점검 파라미터", label: "미점검 파라미터", value: format(counts.unobserved), tone: zero(counts.unobserved) },
    ]} />
    <Stage notch step="판정" href="#matrix" go="판정 매트릭스" value={candidates} unit="IDOR·BFLA 의심" hot={candidates > 0} rows={[
      { name: "BOLA/IDOR 후보", label: "BOLA/IDOR 후보", value: format(auth?.bolaIdorCandidates ?? 0), tone: (auth?.bolaIdorCandidates ?? 0) > 0 ? "candidate" : "zero" },
      { name: "BFLA 후보", label: "BFLA 후보", value: format(auth?.bflaCandidates ?? 0), tone: (auth?.bflaCandidates ?? 0) > 0 ? "candidate" : "zero" },
      { name: "검토 대기", label: "검토 대기", value: format(auth?.manualReviewPending ?? 0), tone: zero(auth?.manualReviewPending ?? 0) },
      { name: "사람 확인 · 기각", label: "사람 확인 · 기각", value: `${format(auth?.humanConfirmed ?? 0)} · ${format(auth?.humanDismissed ?? 0)}`, tone: (auth?.humanConfirmed ?? 0) + (auth?.humanDismissed ?? 0) === 0 ? "zero" : undefined },
    ]} />
  </section>
}

/** 수집 수는 관측 칸의 큰 숫자가 맡고, 나머지 snapshot 통계는 한 줄 각주로 둔다. */
export function SnapshotFootnote({ trafficStats }: Pick<DashboardSummaryValues, "trafficStats">) {
  const items = [["분석 대상", trafficStats.coverage], ["제외", trafficStats.excluded], ["삭제", trafficStats.dropped], ["Payload 메타", trafficStats.payloadMetadataOnly]] as const
  return <dl aria-label="현재 요약" className="flex flex-wrap gap-x-1.5 px-0.5 text-xs text-muted-foreground">{items.map(([label, value], index) => <div key={label} className="flex gap-1">{index > 0 && <span aria-hidden="true">·</span>}<dt>{label}</dt><dd className="tabular-nums">{format(value)}</dd></div>)}</dl>
}

const reasonLabels: Record<string, string> = {
  WRITE_METHOD: "쓰기 요청", AUTH_VARIANT_UNTESTED: "권한 변형 미점검", SOURCE_DISCREPANCY: "도구마다 결과 다름", HUMAN_REVIEW_REQUIRED: "직접 확인 필요",
}
const methodTone: Record<string, string> = { GET: "text-observation-human", POST: "text-observation-scanner" }

function ListCard({ title, href, linkLabel, empty, children }: { title: string; href?: string; linkLabel?: string; empty: string; children: ReactNode[] }) {
  return <section aria-label={title} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
    <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2>{href && linkLabel && <a href={href} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{linkLabel}</a>}</header>
    {children.length ? <ul>{children}</ul> : <p className="px-4 py-6 text-sm text-muted-foreground">{empty}</p>}
  </section>
}

export function PriorityApiList({ rows }: { rows: readonly PriorityApiRow[] }) {
  return <ListCard title="우선 점검 API" href="#graph" linkLabel="점검 그래프에서 모두 보기" empty="우선순위 근거가 있는 미점검 항목이 없습니다.">{rows.map(row => <li key={row.key} className="border-t border-border first:border-t-0"><a href="#graph" className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50">
    <span className={cn("rounded border border-border px-1.5 text-center font-mono text-[11px]", methodTone[row.method] ?? "text-muted-foreground")}>{row.method}</span>
    <span className="flex min-w-0 flex-wrap items-center gap-1.5"><span className="break-all font-mono text-xs">{row.path}</span>{row.reasons.filter(reason => reasonLabels[reason]).map(reason => <span key={reason} className="rounded border border-border px-1.5 text-[11px] text-muted-foreground">{reasonLabels[reason]}</span>)}</span>
    <span className="text-xs tabular-nums text-muted-foreground">미점검 {format(row.gapCount)}</span>
  </a></li>)}</ListCard>
}

const reviewLabels: Record<ReviewStatus, string> = { UNRESOLVED: "검토 전", CONFIRMED: "확인됨", DISMISSED: "기각" }

/** 규칙 후보 목록. 제목은 이름과 요청 두 줄로 나눈다. */
export function CandidateList({ scenarios }: { scenarios: readonly Scenario[] }) {
  return <ListCard title="IDOR·BFLA 의심" empty="규칙에 해당하는 후보가 없습니다.">{scenarios.slice(0, 5).map(scenario => {
    const { name, target } = scenarioTitleParts(scenario.title)
    return <li key={scenario.id} className="border-t border-border first:border-t-0"><div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-sm">
      <span className="rounded border border-candidate-border px-1.5 text-[11px] font-semibold text-candidate">{scenario.risk}</span>
      <span className="min-w-0"><span className="block">{name}</span>{target && <span className="block break-all font-mono text-xs text-muted-foreground">{target}</span>}</span>
      <span className="text-xs text-muted-foreground">{reviewLabels[scenario.reviewStatus] ?? scenario.reviewStatus}</span>
    </div></li>
  })}</ListCard>
}

const sourceMarks = [["HUMAN", "H", "bg-observation-human"], ["SCANNER", "S", "bg-observation-scanner"], ["LLM", "L", "bg-observation-llm"]] as const

/** 3-way 비교: API마다 어느 소스가 관측했는지. 빈 칸은 그 소스가 아직 보지 못한 API다(취약점 판정 아님). */
export function SourceCoverageList({ rows }: { rows: readonly SourceCoverageRow[] }) {
  return <ListCard title="출처별 발견" empty="실제 응답이 있는 API가 아직 없습니다.">{rows.length === 0 ? [] : [
    <li key="head" aria-hidden="true" className="grid grid-cols-[4.5rem_minmax(0,1fr)_repeat(3,1.75rem)] items-center gap-3 px-4 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground"><span /><span />{sourceMarks.map(([, short]) => <span key={short} className="text-center">{short}</span>)}</li>,
    ...rows.map(row => <li key={row.key} className="border-t border-border/70"><div aria-label={`${row.method} ${row.path} · ${row.sources.join(", ")} 관측`} className="grid grid-cols-[4.5rem_minmax(0,1fr)_repeat(3,1.75rem)] items-center gap-3 px-4 py-2 text-sm">
      <span className={cn("rounded border border-border px-1.5 text-center font-mono text-[11px]", methodTone[row.method] ?? "text-muted-foreground")}>{row.method}</span>
      <span className="min-w-0 break-all font-mono text-xs">{row.path}{row.sources.length < 3 && <span className="ml-2 font-sans text-[11px] text-muted-foreground">일부만 발견</span>}</span>
      {sourceMarks.map(([source, , color]) => <span key={source} className="grid place-items-center">{row.sources.includes(source) ? <span className={cn("size-2 rounded-full", color)} /> : <span className="size-2 rounded-full border border-border" />}</span>)}
    </div></li>),
  ]}</ListCard>
}

const sourceShort: Record<string, string> = { human: "H", scanner: "S", llm: "L" }
const sourceColor: Record<string, string> = { human: "text-observation-human", scanner: "text-observation-scanner", llm: "text-observation-llm" }

export function RecentEventList({ events, ordinals }: { events: readonly EventRecord[]; ordinals?: Readonly<Record<string, number>> }) {
  return <ListCard title="최근 관측" href="#evidence" linkLabel="요청 기록 모두 보기" empty="아직 관측된 요청이 없습니다.">{events.map(event => <li key={event.eventId} className="border-t border-border first:border-t-0"><a href="#evidence" className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm hover:bg-muted/50">
    <span className={cn("text-center text-xs font-semibold", sourceColor[event.source] ?? "text-muted-foreground")}>{sourceShort[event.source] ?? "?"}</span>
    <span className="min-w-0"><span className="block truncate font-mono text-xs">{event.method} {event.path} <span className="text-muted-foreground">({event.status})</span></span><span className="block truncate text-[11px] text-muted-foreground">{evidenceOrdinalLabel(ordinals, event.eventId)} · {identityLabel(event.idn)}</span></span>
    <span className="text-[11px] tabular-nums text-muted-foreground">{observedTimeLabel(event.lastSeen, event.lastSeen)}</span>
  </a></li>)}</ListCard>
}
