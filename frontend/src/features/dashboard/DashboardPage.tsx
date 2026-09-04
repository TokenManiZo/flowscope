import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { ReactNode } from "react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import type { EventRecord, ScannerRunEnvelope, Snapshot, Source } from "@/lib/api/types"
import { useClearTrafficMutation, useHumanRunQuery, useLoadSampleMutation, useScannerRunQuery, useSnapshotQuery } from "@/lib/query/hooks"
import { Activity, AlertTriangle, ArrowRight, FileSearch, ScanSearch, ShieldCheck, UsersRound } from "lucide-react"
import { EvidenceTrendChart } from "./EvidenceTrendChart"
import { hasDashboardData, nextRecommendation, sourceStates } from "./dashboardSelectors"

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "데이터를 불러오지 못했습니다." }

function scannerAlerts(run: ScannerRunEnvelope): number {
  if (typeof run.run.alert_count === "number") return run.run.alert_count
  return run.run.lanes?.reduce((sum, lane) => sum + lane.alert_count, 0) ?? 0
}

function activeSessions(snapshot: Snapshot): number { return snapshot.managedSessions.filter((session) => session.status.toUpperCase() === "ACTIVE").length }
function sourceCount(snapshot: Snapshot, source: Source): number { return snapshot.events.filter((event) => event.source === source).length }

function methodTone(method: string): string {
  if (method === "GET") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
  if (method === "POST") return "border-sky-500/25 bg-sky-500/10 text-sky-400"
  if (method === "DELETE") return "border-red-500/25 bg-red-500/10 text-red-400"
  return "border-zinc-500/25 bg-zinc-500/10 text-zinc-300"
}

function EvidenceRow({ event }: { event: EventRecord }) {
  const source = event.source === "scanner" ? "ZAP" : event.source === "llm" ? "LLM" : event.source === "human" ? "HUMAN" : "UNKNOWN"
  return <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 py-3 last:border-0"><Badge variant="outline" className={`font-mono text-[10px] ${methodTone(event.method)}`}>{event.method}</Badge><div className="min-w-0"><p className="truncate font-mono text-xs text-foreground/90" title={event.path}>{event.path}</p><p className="mt-1 text-[11px] text-muted-foreground">{source} · {event.idn || "UNKNOWN"}</p></div><span className={`font-mono text-xs ${event.status >= 400 ? "text-amber-400" : "text-emerald-400"}`}>{event.status || "-"}</span></div>
}

function MetricCard({ icon: Icon, label, value, caption, tone = "neutral" }: { icon: typeof Activity; label: string; value: number | string; caption: string; tone?: "neutral" | "success" | "warning" }) {
  const toneClass = tone === "success" ? "text-emerald-400" : tone === "warning" ? "text-amber-400" : "text-zinc-300"
  return <Card className="min-h-36 border-border/70 bg-card/80 py-0 shadow-none ring-0"><CardContent className="flex h-full flex-col justify-between p-5"><div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{label}</p><Icon className={`size-4 ${toneClass}`} aria-hidden="true" /></div><p className="mt-4 font-mono text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">{typeof value === "number" ? value.toLocaleString("ko-KR") : value}</p><p className={`mt-4 text-xs ${toneClass}`}>{caption}</p></CardContent></Card>
}

export function DashboardPage() {
  const snapshot = useSnapshotQuery()
  const human = useHumanRunQuery()
  const scanner = useScannerRunQuery()
  const sample = useLoadSampleMutation()
  const clear = useClearTrafficMutation()

  const unavailableWorkspace = (children: ReactNode) => <ReferenceAnalysisWorkspace ariaLabel="대시보드 분석 영역" context={<section className="grid gap-2 p-3"><h2 className="text-sm font-semibold">현재 snapshot 요약</h2><p className="text-xs text-muted-foreground">snapshot 상태를 확인하는 동안 수집 상태를 변경하지 않습니다.</p></section>} inspector={null}>{children}</ReferenceAnalysisWorkspace>
  if (snapshot.isPending && !snapshot.data) {
    return unavailableWorkspace(<section className="space-y-4 p-3" aria-label="점검 대시보드"><div role="status" aria-label="데이터를 불러오는 중" className="space-y-3"><Skeleton className="h-10 w-56" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-36" />)}</div><Skeleton className="h-[420px] w-full" /></div></section>)
  }
  if (snapshot.isError && !snapshot.data) return unavailableWorkspace(<Alert className="m-3" variant="destructive" aria-label={errorMessage(snapshot.error)}><AlertTitle>데이터를 불러오지 못했습니다.</AlertTitle><AlertDescription>{errorMessage(snapshot.error)}</AlertDescription><Button variant="outline" onClick={() => void snapshot.refetch()}>다시 시도</Button></Alert>)

  const data = snapshot.data
  if (!data) return null
  const hasData = hasDashboardData(data)
  const humanEvents = sourceCount(data, "human")
  const scannerEvents = sourceCount(data, "scanner")
  const llmEvents = sourceCount(data, "llm")
  const totalLaneEvents = Math.max(1, humanEvents + scannerEvents + llmEvents)
  const recent = data.events.filter((event) => event.source === "human" || event.source === "scanner" || event.source === "llm").sort((a, b) => b.timestamp - a.timestamp).slice(0, 4)
  const scannerUnavailable = scanner.isError && !scanner.data
  const scannerLoading = scanner.isPending && !scanner.data
  const scannerDetail = scannerLoading ? "불러오는 중" : scannerUnavailable ? "사용 불가" : scanner.isError ? "동기화 오류" : scanner.data?.run.status ?? "상태 없음"
  const humanUnavailable = human.isError && !human.data
  const humanLoading = human.isPending && !human.data
  const humanDetail = humanLoading ? "불러오는 중" : humanUnavailable ? "사용 불가" : human.isError ? "동기화 오류" : human.data?.completed ? "완료" : human.data?.active ? "진행 중" : "대기"
  const alerts = scanner.data ? scannerAlerts(scanner.data) : null
  const recommendation = nextRecommendation(data)
  const context = <section className="grid gap-3 p-3"><div><h2 className="text-sm font-semibold">현재 snapshot 요약</h2><p className="text-xs text-muted-foreground">서버 snapshot의 수집·검토 상태만 표시합니다.</p></div><dl className="grid gap-2 text-sm"><div className="flex justify-between gap-2"><dt>Evidence</dt><dd className="font-mono">{data.trafficStats.captured}</dd></div><div className="flex justify-between gap-2"><dt>REVIEW</dt><dd className="font-mono">{data.trafficStats.review}</dd></div><div className="flex justify-between gap-2"><dt>활성 관리 세션</dt><dd className="font-mono">{activeSessions(data)}</dd></div></dl><p className="border-t border-[var(--flowscope-divider)] pt-3 text-xs text-muted-foreground">HUMAN {humanDetail} · ZAP {scannerDetail} · LLM Evidence {llmEvents}건</p></section>
  return <ReferenceAnalysisWorkspace ariaLabel="대시보드 분석 영역" context={context} inspector={null}><section className="space-y-5 p-3" aria-labelledby="dashboard-title">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-medium text-emerald-400"><ShieldCheck className="size-4" />SECURITY OVERVIEW</div><h1 id="dashboard-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">보안 점검 대시보드</h1><p className="mt-2 text-sm text-muted-foreground">현재 범위의 권한 검증 Evidence와 분석 진행 상태입니다.</p></div><AlertDialog><AlertDialogTrigger asChild><Button variant="outline" size="sm" className="border-border/80 bg-card/70 text-muted-foreground hover:text-destructive">트래픽 초기화</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>트래픽을 초기화할까요?</AlertDialogTitle><AlertDialogDescription>수집된 화면 상태를 비웁니다. 서버의 기존 안전 확인도 계속 적용됩니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={() => clear.mutate()}>초기화</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>

    {snapshot.isError && <Alert variant="destructive" aria-label={errorMessage(snapshot.error)}><AlertTitle>마지막 데이터를 표시하고 있습니다.</AlertTitle><AlertDescription>{errorMessage(snapshot.error)}</AlertDescription><Button variant="outline" onClick={() => void snapshot.refetch()}>다시 시도</Button></Alert>}
    {data.sampleMode && <Alert aria-label="샘플 데이터" className="border-amber-500/25 bg-amber-500/5"><AlertTitle className="text-amber-300">샘플 데이터</AlertTitle><AlertDescription>현재 HUMAN/ZAP/LLM 표시는 실제 점검 결과가 아니며 네트워크 요청을 만들지 않습니다.</AlertDescription></Alert>}

    {!hasData ? <Card className="border-dashed border-border bg-card/40 py-12 text-center ring-0"><CardHeader><CardTitle className="text-xl">첫 점검을 시작하세요</CardTitle><CardDescription>범위를 확인한 뒤 HUMAN과 ZAP Evidence를 수집합니다.</CardDescription></CardHeader><CardContent className="flex flex-wrap justify-center gap-2"><Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={() => { window.location.hash = "#inspection" }}>빠른 시작</Button><Button variant="outline" disabled={sample.isPending} onClick={() => sample.mutate()}>샘플로 화면 익히기</Button></CardContent></Card> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><MetricCard icon={FileSearch} label="총 Evidence" value={data.trafficStats.captured} caption={`수집 ${data.trafficStats.captured}건`} /><MetricCard icon={ShieldCheck} label="분석 대상" value={data.trafficStats.coverage} caption={`분석 대상 ${data.trafficStats.coverage}건`} tone="success" /><MetricCard icon={AlertTriangle} label="검토 대기" value={data.trafficStats.review} caption={`검토 대기 ${data.trafficStats.review}건`} tone="warning" /><MetricCard icon={ScanSearch} label="ZAP 경고" value={alerts ?? "—"} caption={scannerDetail} tone={alerts !== null && alerts > 0 ? "warning" : "neutral"} /><MetricCard icon={UsersRound} label="활성 세션" value={activeSessions(data)} caption={`등록 계정 ${data.accounts.length}개`} tone="success" /></div>

      <Card className="border-border/70 bg-card/70 py-0 shadow-none ring-0"><CardHeader className="border-b border-border/60 px-5 py-5 sm:px-6"><div><CardTitle className="text-base">Evidence 수집 추이</CardTitle><CardDescription className="mt-1">HUMAN, ZAP, LLM 누적 수집량 · 현재 점검</CardDescription></div><Badge variant="outline" className="border-border/80 bg-background/30 font-normal">실제 snapshot</Badge></CardHeader><CardContent className="px-5 py-5 sm:px-6"><EvidenceTrendChart events={data.events} /></CardContent></Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1.45fr]">
        <Card className="border-border/70 bg-card/70 ring-0"><CardHeader><CardTitle><h2>Evidence 수집 현황</h2></CardTitle><CardDescription>source별 Evidence 분포와 실행 상태</CardDescription></CardHeader><CardContent className="space-y-6">{[{ label: "HUMAN", value: humanEvents, detail: humanDetail }, { label: "ZAP", value: scannerEvents, detail: scannerDetail }, { label: "LLM", value: llmEvents, detail: llmEvents > 0 ? "관측됨" : "대기" }].map((lane) => <div key={lane.label} className="space-y-2"><div className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2 font-medium"><span className={`size-2 rounded-full ${lane.value > 0 ? "bg-emerald-400" : "bg-zinc-600"}`} />{lane.label}</span><span className={`text-xs ${lane.detail === "사용 불가" ? "text-red-400" : lane.detail === "동기화 오류" ? "text-amber-400" : "text-emerald-400"}`}>{lane.detail}</span></div><Progress aria-label={`${lane.label} Evidence ${lane.value}건`} value={(lane.value / totalLaneEvents) * 100} className="h-1.5 [&_[data-slot=progress-indicator]]:bg-emerald-400" /><p className="text-xs text-muted-foreground">Evidence {lane.value.toLocaleString("ko-KR")}건 · 세 source 관측 중 분포</p></div>)}<div className="border-t border-border/60 pt-4 text-xs text-muted-foreground">{sourceStates.map(({ source, label, short }) => { const observed = sourceCount(data, source) > 0; return <span className="mr-3" key={source}>{short} · {label} · {observed ? "관측됨" : "대기"}</span> })}</div></CardContent></Card>

        <Card className="border-border/70 bg-card/70 ring-0"><CardHeader><CardTitle><h2>트래픽 분류 분포</h2></CardTitle><CardDescription>서버가 분류한 트래픽 disposition</CardDescription></CardHeader><CardContent className="space-y-5">{[{ label: "INCLUDE", value: data.trafficStats.coverage, color: "[&_[data-slot=progress-indicator]]:bg-emerald-400" }, { label: "REVIEW", value: data.trafficStats.review, color: "[&_[data-slot=progress-indicator]]:bg-amber-400" }, { label: "EXCLUDE", value: data.trafficStats.excluded, color: "[&_[data-slot=progress-indicator]]:bg-zinc-500" }].map((item) => <div className="space-y-2" key={item.label}><div className="flex justify-between text-sm"><span>{item.label}</span><span className="font-mono tabular-nums">{item.value.toLocaleString("ko-KR")}</span></div><Progress aria-label={`${item.label} Evidence ${item.value}건`} value={(item.value / Math.max(1, data.trafficStats.captured)) * 100} className={`h-1.5 ${item.color}`} /></div>)}<div className="grid grid-cols-1 gap-1 border-t border-border/60 pt-4 text-xs text-muted-foreground"><span>제외 {data.trafficStats.excluded}건</span><span>삭제됨 {data.trafficStats.dropped}건</span><span>Payload 메타데이터만 {data.trafficStats.payloadMetadataOnly}건</span></div></CardContent></Card>

        <Card className="border-border/70 bg-card/70 ring-0"><CardHeader className="flex-row items-center justify-between"><div><CardTitle><h2>최근 Evidence</h2></CardTitle><CardDescription>최신 관측 요청</CardDescription></div><Button variant="ghost" size="sm" className="text-emerald-400" onClick={() => { window.location.hash = "#evidence" }}>전체 보기 <ArrowRight /></Button></CardHeader><CardContent>{recent.length ? recent.map((event) => <EvidenceRow event={event} key={event.eventId} />) : <p className="py-8 text-center text-sm text-muted-foreground">표시할 Evidence가 없습니다.</p>}</CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3"><Card className="border-border/70 bg-card/50 ring-0"><CardHeader><CardTitle>갭 요약</CardTitle><CardDescription>{data.gaps.length}건</CardDescription></CardHeader><CardContent className="space-y-2">{data.gaps.slice(0, 3).map((gap) => <p key={gap.id} className="wrap-break-word text-sm text-muted-foreground">{gap.summary}</p>)}</CardContent></Card><Card className="border-border/70 bg-card/50 ring-0"><CardHeader><CardTitle>Finding 요약</CardTitle><CardDescription>{data.scenarios.length}건</CardDescription></CardHeader><CardContent className="space-y-2">{data.scenarios.slice(0, 3).map((scenario) => <p key={scenario.id} className="wrap-break-word text-sm text-muted-foreground">{scenario.title}</p>)}</CardContent></Card><Card className="border-border/70 bg-card/50 ring-0"><CardHeader><CardTitle>다음 행동</CardTitle><CardDescription>현재 데이터 기준 추천</CardDescription></CardHeader><CardContent><Button variant="outline" className="w-full justify-between" onClick={() => { window.location.hash = `#${recommendation.route}` }}>다음 권장 작업: {recommendation.label} <ArrowRight /></Button></CardContent></Card></div>
    </>}
    {sample.isError && <Alert variant="destructive" aria-label={errorMessage(sample.error)}><AlertDescription>{errorMessage(sample.error)}</AlertDescription></Alert>}
    {clear.isError && <Alert variant="destructive" aria-label={errorMessage(clear.error)}><AlertDescription>{errorMessage(clear.error)}</AlertDescription></Alert>}
  </section></ReferenceAnalysisWorkspace>
}
