import { useEffect, useState, type ReactNode } from "react"
import { ChevronDown, CircleHelp, CircleStop, Gavel, LogIn, Maximize2, Minimize2, Play, RefreshCw, Send } from "lucide-react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { HttpStatusBadge, MethodBadge } from "@/components/TrafficBadges"
import { RequestLabDialog } from "@/features/evidence/RequestLabDialog"
import { openResendSelection } from "@/features/graph/resendNavigation"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AccountLaneTable } from "@/features/inspection/AccountLaneTable"
import type { RecordView } from "@/features/inspection/RecordView"
import { SourcePassLayout } from "@/features/inspection/SourcePassLayout"
import type { LlmFeedEntry, LlmFinding } from "@/lib/api/types"
import { FindingResultCard } from "./FindingResultCard"
import { findingStatus, findingStatusLabel, type FindingStatus } from "./findingResults"
import {
  useCancelLlmVerifyMutation,
  useAskLlmJudgmentMutation,
  useExplorerModelsQuery,
  useExplorerRunQuery,
  useLlmFeedQuery,
  useLlmFindingsQuery,
  useLlmVerifyStateQuery,
  useSnapshotQuery,
  useStartLlmJudgmentMutation,
  useStartLlmVerifyMutation,
} from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

type MatrixScope = "bola" | "bfla" | "all"
type GraphScope = "core" | "all"
type ResultView = "progress" | FindingStatus
const RESULT_STATUSES: readonly FindingStatus[] = ["vulnerable", "inconclusive", "not_vulnerable", "unjudged"]
const RESULT_PAGE_SIZE = 20

const MATRIX_OPTIONS: ReadonlyArray<[MatrixScope, string, string]> = [
  ["bola", "객체 조회", "IDOR·BOLA"],
  ["bfla", "기능 권한", "BFLA"],
  ["all", "전체", ""],
]
const GRAPH_OPTIONS: ReadonlyArray<[GraphScope, string]> = [
  ["core", "주요 API만"],
  ["all", "전체"],
]
const STATUS_LABEL: Record<string, string> = {
  IDLE: "대기", RUNNING: "판정 중", SUCCEEDED: "완료", FAILED: "실패", CANCELLED: "중단됨",
}
const BADGE_LABEL: Record<string, string> = { info: "진행", read: "읽기", resend: "재전송", finding: "소견", verdict: "판정", operator: "질문", assistant: "답변" }
/** LLM 자신의 판정(MCP 설계 §11). FlowScope 판정 규칙과 무관하다. */
const CODEX_OUTPUT = "Codex 출력: "
const CODEX_ANSWER = "Codex 답변: "

function message(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다."
}

/** 작업 피드 한 줄. 재전송은 메서드·HTTP 상태를 배지로, Codex 최종 출력은 접어서 보여 준다. */
function FeedRow({ entry, onOpenFinding, onOpenEvidence }: { entry: LlmFeedEntry; onOpenFinding(id: string): void; onOpenEvidence(id: string): void }) {
  const time = new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour12: false })
  const output = entry.summary.startsWith(CODEX_OUTPUT) ? entry.summary.slice(CODEX_OUTPUT.length) : null
  const answer = entry.summary.startsWith(CODEX_ANSWER) ? entry.summary.slice(CODEX_ANSWER.length) : null
  const method = entry.type === "resend" ? entry.summary.match(/\b(GET|HEAD|OPTIONS)\b/)?.[1] : undefined
  const status = entry.type === "resend" ? entry.summary.match(/HTTP (\d{3})\s*$/)?.[1] : undefined
  const linked = Boolean(entry.findingId || entry.evidenceId)
  return <article className={cn("grid grid-cols-[64px_minmax(0,1fr)_4.5rem_5.5rem] items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0",
    entry.risk && "bg-destructive/5")}>
    {method ? <MethodBadge method={method} />
      : <Badge variant="outline" className={cn("h-[22px] w-[64px] justify-center text-xs", entry.risk && "border-destructive/40 text-destructive")}>{BADGE_LABEL[entry.type] ?? entry.type}</Badge>}
    <div className="min-w-0">
      {answer != null ? <p className="whitespace-pre-wrap break-words text-sm leading-6">{answer}</p> : output == null
        ? linked ? <button type="button" className="w-full break-words text-left text-sm font-medium underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-ring" onClick={() => entry.findingId ? onOpenFinding(entry.findingId) : entry.evidenceId && onOpenEvidence(entry.evidenceId)}>{entry.summary}</button>
          : <p className="break-words text-sm font-medium">{entry.summary}</p>
        : <details>
          <summary className="cursor-pointer text-sm font-medium">Codex 최종 출력 <span className="font-normal text-muted-foreground">· 펼치기</span></summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">{output}</pre>
        </details>}
    </div>
    <span className="text-right">{status ? <HttpStatusBadge status={status} /> : null}</span>
    <span className="text-right font-mono text-xs text-muted-foreground">{time}</span>
  </article>
}

/**
 * LLM 판정 페이지. 점검이 끝난 뒤 판정 매트릭스·점검 그래프를 LLM(Codex)이 보고,
 * 판정할 계정 세션으로 GET 추천을 재전송해 취약점 소견을 남긴다. 화면 틀은 점검 시작의 LLM 탐색과 같다.
 */
export function LlmJudgmentPage() {
  const snapshot = useSnapshotQuery()
  const accounts = snapshot.data?.accounts ?? []
  const sessions = snapshot.data?.managedSessions ?? []
  const sessionReady = (accountId: string) => sessions.some((session) => session.accountId === accountId && session.replayReady === true)
  const readyIds = accounts.filter((account) => sessionReady(account.id)).map((account) => account.id)

  const [matrixScope, setMatrixScope] = useState<MatrixScope | null>("bola")
  const [graphScope, setGraphScope] = useState<GraphScope | null>(null)
  const [anonymous, setAnonymous] = useState(true)
  const [selected, setSelected] = useState<string[] | null>(null)
  const [selectedModel, setSelectedModel] = useState("")
  const [scopeOpen, setScopeOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [feedOpen, setFeedOpen] = useState(true)
  const [activeView, setActiveView] = useState<ResultView>("progress")
  const [visibleCount, setVisibleCount] = useState(RESULT_PAGE_SIZE)
  const [enlargedFinding, setEnlargedFinding] = useState<string | null>(null)
  const [requestEvidenceId, setRequestEvidenceId] = useState<string | null>(null)
  const [question, setQuestion] = useState("")
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [pickError, setPickError] = useState(false)

  const verify = useLlmVerifyStateQuery(true, true)
  const verifyStatus = verify.data?.status ?? "IDLE"
  const running = verifyStatus === "RUNNING"
  const feed = useLlmFeedQuery(true, running)
  const startVerify = useStartLlmVerifyMutation()
  const startJudgment = useStartLlmJudgmentMutation()
  const cancelVerify = useCancelLlmVerifyMutation()
  const askJudgment = useAskLlmJudgmentMutation()
  const findingsQuery = useLlmFindingsQuery(true, running)
  const findings = findingsQuery.data?.findings ?? []
  const revision = snapshot.data?.datasetRevision ?? snapshot.data?.identityRevision ?? 0

  // Codex 준비 상태와 모델 목록은 LLM 탐색과 같은 출처를 쓴다.
  const explorer = useExplorerRunQuery()
  const providerReady = explorer.data?.run.providerReadiness === "READY"
  const models = useExplorerModelsQuery(providerReady && !running)
  const catalog = models.isError ? undefined : models.data
  const modelLoading = providerReady && !running && models.isPending

  // 실행이 끝나면(완료·실패·중단) 폴링이 멈추므로, 마지막 피드(Codex 종료·출력)를 한 번 더 가져온다.
  useEffect(() => {
    if (verifyStatus === "SUCCEEDED" || verifyStatus === "FAILED" || verifyStatus === "CANCELLED") {
      void feed.refetch()
      void findingsQuery.refetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyStatus])

  // 고르지 않았으면 로그인된 계정 전체가 기본값. 로그인이 풀린 계정은 선택에서 빠진다.
  const shownSelected = (selected ?? readyIds).filter((id) => readyIds.includes(id))
  const sources = [
    matrixScope ? `matrix:${matrixScope}` : "",
    graphScope ? `graph:${graphScope}` : "",
  ].filter(Boolean).join(";")
  const identityCount = (anonymous ? 1 : 0) + shownSelected.length
  const canStart = !running && !startVerify.isPending && !startJudgment.isPending && !modelLoading && sources !== "" && identityCount > 0

  const matrixSummary = MATRIX_OPTIONS.find((option) => option[0] === matrixScope)?.[1] ?? ""
  const graphSummary = GRAPH_OPTIONS.find((option) => option[0] === graphScope)?.[1] ?? ""
  const scopeSummary = [matrixSummary && `판정 매트릭스 ${matrixSummary}`, graphSummary && `점검 그래프 ${graphSummary}`].filter(Boolean).join(" · ") || "선택 없음"
  const accountSummary = [...(anonymous ? ["비로그인"] : []), ...shownSelected.map((id) => accounts.find((account) => account.id === id)?.label ?? id)].join(" · ") || "선택 없음"

  const entries = feed.data?.entries ?? []
  const shownEntries = entries.slice().reverse()
  const counts = Object.fromEntries(RESULT_STATUSES.map(status => [status, findings.filter(finding => findingStatus(finding) === status).length])) as Record<FindingStatus, number>
  const tabFindings = activeView === "progress" ? [] : findings.filter(finding => findingStatus(finding) === activeView)
  const shownFindings = tabFindings.slice(0, visibleCount)
  const changeView = (view: ResultView) => {
    setActiveView(view)
    setVisibleCount(RESULT_PAGE_SIZE)
    setPicked(new Set())
    setPickError(false)
    setEnlargedFinding(null)
  }
  // 현재 탭에 실제로 보이는 소견만 일괄 판정 대상으로 삼는다.
  const pickedIds = shownFindings.map((finding) => finding.id).filter((id) => picked.has(id))
  const allPicked = shownFindings.length > 0 && pickedIds.length === shownFindings.length
  const judge = () => {
    if (pickedIds.length === 0) { setPickError(true); return }
    startJudgment.mutate({ findings: pickedIds, model: selectedModel })
  }
  const requestEvent = snapshot.data?.events.find(event => event.eventId === requestEvidenceId) ?? null
  const openFinding = (id: string) => {
    const finding = findings.find(item => item.id === id)
    if (!finding) return
    const status = findingStatus(finding)
    changeView(status)
    const position = findings.filter(item => findingStatus(item) === status).findIndex(item => item.id === id)
    setVisibleCount(Math.max(RESULT_PAGE_SIZE, Math.ceil((position + 1) / RESULT_PAGE_SIZE) * RESULT_PAGE_SIZE))
    setFeedOpen(true)
    setEnlargedFinding(id)
    window.requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>("[data-finding-id]")]
      .find(element => element.dataset.findingId === id)?.scrollIntoView?.({ block: "center" }))
  }

  const failure = startVerify.error ?? startJudgment.error ?? cancelVerify.error ?? askJudgment.error
  const notices = <>
    {failure && <Alert variant="destructive"><AlertDescription>{message(failure)}</AlertDescription></Alert>}
    {explorer.data && !providerReady && <Alert variant="destructive"><AlertDescription>Codex 준비가 필요합니다. 점검 시작 › LLM 탐색의 안내에 따라 Codex CLI 설치와 로그인을 마친 뒤 다시 시도하세요.</AlertDescription></Alert>}
  </>

  const modelControl = <div className="flex w-full min-w-0 items-center gap-2 text-sm sm:w-auto">
    <label className="shrink-0 text-muted-foreground" htmlFor="judgment-model">판정 모델</label>
    <select id="judgment-model" className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm sm:w-[250px] sm:flex-none"
      value={selectedModel} disabled={running || !providerReady || !catalog?.models.length}
      onChange={(event) => setSelectedModel(event.target.value)}>
      <option value="">Codex 기본 설정{catalog?.configuredModel ? ` (${catalog.configuredModel})` : ""}</option>
      {(catalog?.models ?? []).map((option) => <option key={option.id} value={option.id}>{option.label}{option.recommended ? " · Codex 추천" : ""}</option>)}
    </select>
    {providerReady && <Button type="button" variant="outline" size="icon" className="size-9" disabled={running || models.isFetching} aria-label="모델 목록 다시 확인" title="모델 목록 다시 확인" onClick={() => void models.refetch()}><RefreshCw className="size-3.5" /></Button>}
  </div>

  const rows = accounts.map((account) => {
    const ready = sessionReady(account.id)
    return {
      id: account.id, label: account.label, configured: ready,
      statusText: ready ? "세션 있음" : "로그인 필요",
      action: <Button type="button" size="sm" variant="outline" className="grid h-[24px] w-[110px] grid-cols-[12px_minmax(0,1fr)] gap-1 px-2 text-[11px] [&_svg]:size-[12px]"
        disabled={running} aria-label={`${account.label} 로그인`}
        onClick={() => { window.location.hash = "#accounts/" + encodeURIComponent(account.id) }}>
        <LogIn aria-hidden="true" /><span className="text-center">{ready ? "다시 로그인" : "로그인"}</span>
      </Button>,
    }
  })

  const section = (label: string, summary: string, open: boolean, onToggle: () => void, body: ReactNode) =>
    <section className="rounded-md border">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-muted/50">
        <span className="font-medium">{label} <span className="ml-2 font-normal text-muted-foreground">{summary}</span></span>
        <span className="flex items-center gap-1 font-medium">{open ? "접기" : "펼치기"}<ChevronDown className={cn("size-3.5", open && "rotate-180")} /></span>
      </button>
      {open && <div className="grid gap-2 border-t p-3">{body}</div>}
    </section>

  const scopeGroup = <T extends string>(title: string, options: ReadonlyArray<readonly [T, string, ...string[]]>, value: T | null, onChange: (next: T | null) => void) =>
    <div role="group" aria-label={title} className="grid gap-1">
      <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
        <Checkbox checked={value !== null} disabled={running} onCheckedChange={(checked) => onChange(checked === true ? options[0][0] : null)} />
        {title}
      </label>
      <div className="flex flex-wrap gap-x-5 gap-y-1 pl-6">{options.map(([key, label, hint]) =>
        <label key={key} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
          <input type="radio" name={title} value={key} checked={value === key} disabled={running || value === null} onChange={() => onChange(key)} className="accent-sky-500" />
          {label}{hint && <span className="text-muted-foreground">({hint})</span>}
        </label>)}
      </div>
    </div>

  const control = <div className="grid gap-2">
    <div className="flex min-h-8 items-center gap-4">
      {providerReady && <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-label="Codex 상태"><span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />Codex 준비됨</div>}
      {modelLoading && <p className="text-xs text-muted-foreground">현재 계정의 모델 목록을 확인 중입니다.</p>}
    </div>
    {section("판정 범위", scopeSummary, scopeOpen, () => setScopeOpen((value) => !value), <>
      {scopeGroup("판정 매트릭스에서 가져오기", MATRIX_OPTIONS, matrixScope, setMatrixScope)}
      {scopeGroup("점검 그래프에서 가져오기", GRAPH_OPTIONS, graphScope, setGraphScope)}
    </>)}
    {section("판정할 계정", accountSummary, accountsOpen, () => setAccountsOpen((value) => !value), <>
      <AccountLaneTable lane="LLM 판정" rows={rows} anonymous={anonymous} onAnonymousChange={setAnonymous} selected={shownSelected}
        onToggle={(id, value) => setSelected((current) => value
          ? [...new Set([...(current ?? shownSelected), id])]
          : (current ?? shownSelected).filter((item) => item !== id))}
        disabled={running} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">[로그인] → 계정·세션에서 로그인 → 돌아와 [세션 다시 확인]. 세션이 있는 계정만 재전송에 씁니다.</p>
        <Button type="button" size="sm" variant="outline" disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()}><RefreshCw className="size-3.5" />세션 다시 확인</Button>
      </div>
    </>)}
    <div className="flex flex-wrap items-center justify-start gap-2 border-t pt-3">
      {running
        ? <Button variant="destructive" size="sm" disabled={cancelVerify.isPending} onClick={() => cancelVerify.mutate()}><CircleStop className="size-4" />중단</Button>
        : <Button size="sm" disabled={!canStart} onClick={() => startVerify.mutate({
          sources, model: selectedModel, accounts: [...(anonymous ? ["anon"] : []), ...shownSelected].join(","),
        })}><Play className="size-4" />판정 시작</Button>}
      <span className="text-xs text-muted-foreground">계정 {identityCount}개 선택됨{sources === "" ? " · 판정 범위를 하나 이상 고르세요" : ""}</span>
    </div>
  </div>

  const feedCard = (view: RecordView) => <Card className={cn("flex flex-col gap-0 overflow-hidden py-0", feedOpen ? "min-h-32 flex-1" : "shrink-0")}>
    <CardHeader className="shrink-0 border-b py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">LLM 판정 <span className="ml-2 text-sm font-normal text-muted-foreground">{STATUS_LABEL[verifyStatus] ?? verifyStatus}{verifyStatus === "SUCCEEDED" ? ` · 소견 ${findings.length}건` : ""}</span></CardTitle>
        <div className="flex w-full max-w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button type="button" variant="outline" size="sm" data-record-focus aria-pressed={view.focused}
            onClick={() => { setFeedOpen(true); view.toggleFocus() }}>
            {view.focused ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            {view.focused ? "전체 화면으로" : "결과만 보기"}
          </Button>
          <Button type="button" variant="outline" size="sm" aria-expanded={feedOpen} onClick={() => setFeedOpen((value) => !value)}>{feedOpen ? "내용 접기" : "내용 펼치기"}<ChevronDown className={cn("size-3.5", feedOpen && "rotate-180")} /></Button>
        </div>
      </div>
      <p className={cn("break-words text-sm font-medium", verifyStatus === "FAILED" && "text-destructive")} aria-live="polite">{verify.data?.message || "판정 범위와 계정을 고른 뒤 판정 시작을 누르세요."}</p>
    </CardHeader>
    <CardContent className="flex min-h-0 flex-1 flex-col p-0">
      {feedOpen && <div role="tablist" aria-label="판정 결과 분류" className="flex shrink-0 gap-1 overflow-x-auto border-b px-4">
        {(["progress", ...RESULT_STATUSES] as ResultView[]).map((tab, index, tabs) => {
          const selected = activeView === tab
          const count = tab === "progress" ? entries.length : counts[tab]
          const tone = tab === "vulnerable" ? "data-[active=true]:border-destructive data-[active=true]:text-destructive"
            : tab === "inconclusive" ? "data-[active=true]:border-amber-500 data-[active=true]:text-amber-700 dark:data-[active=true]:text-amber-300"
            : tab === "not_vulnerable" ? "data-[active=true]:border-emerald-500 data-[active=true]:text-emerald-700 dark:data-[active=true]:text-emerald-300"
            : "data-[active=true]:border-foreground data-[active=true]:text-foreground"
          const tabButton = <button key={tab} type="button" role="tab" data-active={selected} aria-selected={selected} aria-controls="llm-judgment-panel"
            tabIndex={selected ? 0 : -1} className={cn("flex shrink-0 items-center gap-2 py-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", tab === "unjudged" ? "data-[active=true]:text-foreground" : cn("border-b-2 border-transparent px-3", tone))}
            onClick={() => changeView(tab)} onKeyDown={event => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
              event.preventDefault()
              const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]
              changeView(next)
              event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]?.focus()
            }}>
            {tab === "progress" ? "진행 기록" : findingStatusLabel[tab]}
            {tab !== "unjudged" && <span className="tabular-nums text-xs opacity-70">{count}</span>}
          </button>
          if (tab !== "unjudged") return tabButton
          return <div key={tab} data-active={selected} className="flex shrink-0 items-center gap-1 border-b-2 border-transparent px-3 data-[active=true]:border-foreground">
            {tabButton}
            <Popover><PopoverTrigger asChild><button type="button" aria-label="미판정 도움말" className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><CircleHelp className="size-4" aria-hidden="true" /></button></PopoverTrigger><PopoverContent align="start" className="w-72 text-xs leading-relaxed" aria-label="미판정 설명">요청·응답 기록이 있어도 취약 여부 판정은 별도로 저장됩니다. 항목을 선택하고 [선택한 소견 판정]을 누르면 다시 확인합니다. 근거가 부족하면 ‘확인 필요’로 분류되고, 실행이 실패하거나 판정이 저장되지 않으면 미판정에 남습니다.</PopoverContent></Popover>
            <span className="tabular-nums text-xs text-muted-foreground">{count}</span>
          </div>
        })}
      </div>}
      {feedOpen && activeView === "unjudged" && shownFindings.length > 0 && <div className="shrink-0 border-b bg-muted/20">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={allPicked} disabled={running} onCheckedChange={(value) => { setPickError(false); setPicked(value === true ? new Set(shownFindings.map((finding) => finding.id)) : new Set()) }} />보이는 항목 선택
          </label>
          <span className="text-sm text-muted-foreground">{pickedIds.length}건 선택됨</span>
          {pickError && <span role="alert" className="text-sm text-destructive">판정할 소견을 하나 이상 고르세요</span>}
          <Button type="button" size="sm" className="ml-auto" disabled={running || startJudgment.isPending} onClick={judge}><Gavel className="size-4" />선택한 소견 판정</Button>
        </div>
      </div>}
      {feedOpen && activeView !== "progress" && <div id="llm-judgment-panel" role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-3" aria-label="LLM 판정 결과">
        {tabFindings.length === 0
          ? <div className="grid min-h-48 place-content-center gap-1 text-center"><p className="font-medium">{findingStatusLabel[activeView]} 항목이 없습니다.</p><p className="text-sm text-muted-foreground">다른 판정 탭이나 진행 기록을 확인해 보세요.</p></div>
          : <><div className="grid gap-2">{shownFindings.map((finding) => <FindingResultCard key={finding.id} finding={finding} snapshot={snapshot.data} enlarged={enlargedFinding === finding.id} picked={picked.has(finding.id)} selectable={activeView === "unjudged"} disabled={running}
              onEnlarge={() => setEnlargedFinding(finding.id)} onCloseEnlarged={() => setEnlargedFinding(null)}
              onPick={(value) => { setPickError(false); setPicked((current) => { const next = new Set(current); if (value) next.add(finding.id); else next.delete(finding.id); return next }) }}
              onOpenRequest={setRequestEvidenceId} onOpenGraph={id => openResendSelection(id, revision)} />)}</div>
            {tabFindings.length > shownFindings.length && <div className="flex justify-center py-5"><Button type="button" variant="outline" onClick={() => setVisibleCount(count => count + RESULT_PAGE_SIZE)}>20건 더 보기 <span className="text-muted-foreground">({shownFindings.length}/{tabFindings.length})</span></Button></div>}</>}
      </div>}
      {feedOpen && activeView === "progress" && <div id="llm-judgment-panel" role="tabpanel" className="min-h-0 flex-1 overflow-y-auto" aria-label="LLM 판정 진행 기록">
        {shownEntries.length
          ? shownEntries.map((entry) => <FeedRow key={entry.seq} entry={entry} onOpenFinding={openFinding} onOpenEvidence={setRequestEvidenceId} />)
          : <p className="px-4 py-8 text-center text-sm text-muted-foreground">{running ? "LLM 동작을 기다리는 중…" : "실행하면 추천 읽기, GET 재전송과 취약점 소견이 여기에 순서대로 표시됩니다."}</p>}
      </div>}
      <form className="flex gap-2 border-t p-3" onSubmit={(event) => {
        event.preventDefault()
        const message = question.trim()
        if (!message || running || verifyStatus === "IDLE" || askJudgment.isPending) return
        askJudgment.mutate({ message, model: selectedModel }, { onSuccess: () => { setQuestion(""); changeView("progress"); setFeedOpen(true) } })
      }}>
        <Input aria-label="LLM 판정 후속 질문" value={question} maxLength={2000} onChange={event => setQuestion(event.target.value)} placeholder={running ? "진행 중에는 질문을 보낼 수 없습니다" : "판정 결과에 대해 추가로 질문하세요"} disabled={running || verifyStatus === "IDLE" || askJudgment.isPending} />
        <Button type="submit" size="icon" aria-label="질문 전송" disabled={!question.trim() || running || verifyStatus === "IDLE" || askJudgment.isPending}><Send className="size-4" /></Button>
      </form>
    </CardContent>
    {requestEvent && snapshot.data && <RequestLabDialog key={`${revision}:${requestEvidenceId}`} open onOpenChange={open => { if (!open) setRequestEvidenceId(null) }} event={requestEvent} accounts={snapshot.data.accounts} sessions={snapshot.data.managedSessions} verifications={snapshot.data.manualVerifications} datasetRevision={revision} snapshotRevision={snapshot.data.revision} suspended={running} initialView="original" />}
  </Card>

  return (
    <ReferenceAnalysisWorkspace ariaLabel="LLM 판정 작업 영역" context={null} inspector={null} contentOverflow="hidden">
      <section className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3" aria-labelledby="llm-judgment-title">
        <h1 id="llm-judgment-title" className="shrink-0 text-2xl font-semibold">LLM 판정</h1>
        <SourcePassLayout label="LLM 판정" title="판정 실행" titleControl={modelControl}
          description="점검이 끝난 뒤 판정 매트릭스·점검 그래프를 LLM이 보고, 고른 계정 세션으로 GET 추천을 재전송해 취약점 소견을 남깁니다. 쓰기 요청은 보내지 않으며, 판정 확정은 사람이 합니다."
          control={control} notices={notices} feedItems={[]} feedTitle="진행 기록" emptyHint="" feedContent={feedCard} />
      </section>
    </ReferenceAnalysisWorkspace>
  )
}
