import { useEffect, useState, type ReactNode } from "react"
import { ChevronDown, CircleStop, Gavel, LogIn, Play, RefreshCw, Send, ShieldAlert } from "lucide-react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { HttpStatusBadge, MethodBadge } from "@/components/TrafficBadges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { AccountLaneTable } from "@/features/inspection/AccountLaneTable"
import { RecordViewButton, type RecordView } from "@/features/inspection/RecordView"
import { SourcePassLayout } from "@/features/inspection/SourcePassLayout"
import { openEvidenceSelection } from "@/features/evidence/evidenceNavigation"
import type { LlmFeedEntry, LlmFinding } from "@/lib/api/types"
import {
  useCancelLlmVerifyMutation,
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
type FeedFilter = "all" | "risk"

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
const BADGE_LABEL: Record<string, string> = { info: "진행", read: "읽기", resend: "재전송", finding: "소견", verdict: "판정" }
/** LLM 자신의 판정(MCP 설계 §11). FlowScope 판정 규칙과 무관하다. */
const JUDGMENT_BADGE: Record<Exclude<LlmFinding["judgment"], "">, [string, string]> = {
  vulnerable: ["LLM 판정 · 취약", "border-destructive/40 bg-destructive/10 text-destructive"],
  not_vulnerable: ["LLM 판정 · 취약 아님", "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"],
  inconclusive: ["LLM 판정 · 판단 불가", "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"],
}
const CODEX_OUTPUT = "Codex 출력: "

function message(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다."
}

function toggle<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

/** 작업 피드 한 줄. 재전송은 메서드·HTTP 상태를 배지로, Codex 최종 출력은 접어서 보여 준다. */
function FeedRow({ entry }: { entry: LlmFeedEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour12: false })
  const output = entry.summary.startsWith(CODEX_OUTPUT) ? entry.summary.slice(CODEX_OUTPUT.length) : null
  const method = entry.type === "resend" ? entry.summary.match(/\b(GET|HEAD|OPTIONS)\b/)?.[1] : undefined
  const status = entry.type === "resend" ? entry.summary.match(/HTTP (\d{3})\s*$/)?.[1] : undefined
  return <article className={cn("grid grid-cols-[64px_minmax(0,1fr)_4.5rem_5.5rem] items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0",
    entry.risk && "bg-destructive/5")}>
    {method ? <MethodBadge method={method} />
      : <Badge variant="outline" className={cn("h-[22px] w-[64px] justify-center text-xs", entry.risk && "border-destructive/40 text-destructive")}>{BADGE_LABEL[entry.type] ?? entry.type}</Badge>}
    <div className="min-w-0">
      {output == null
        ? <p className={cn("break-words text-sm font-medium", entry.risk && "text-destructive")}>{entry.summary}</p>
        : <details>
          <summary className="cursor-pointer text-sm font-medium">Codex 최종 출력 <span className="font-normal text-muted-foreground">· 펼치기</span></summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">{output}</pre>
        </details>}
    </div>
    <span className="text-right">{status ? <HttpStatusBadge status={status} /> : null}</span>
    <span className="text-right font-mono text-xs text-muted-foreground">{time}</span>
  </article>
}

/** 위험 목록의 소견 한 줄. 고를 수 있고, LLM이 판정했으면 판정 배지·이유·근거 기록 링크를 붙인다.
 *  행을 누르면 대표 근거 기록을 Request Lab(요청 기록)에서 연다. */
function FindingRow({ finding, picked, disabled, onPick, onOpenEvidence }: {
  finding: LlmFinding
  picked: boolean
  disabled: boolean
  onPick(value: boolean): void
  onOpenEvidence(evidenceId: string): void
}) {
  const badge = finding.judgment ? JUDGMENT_BADGE[finding.judgment] : null
  const evidence = finding.judgment && finding.judgmentEvidenceIds.length ? finding.judgmentEvidenceIds : finding.evidenceIds
  const primary = evidence[0]
  return <article
    className={cn("grid grid-cols-[1rem_64px_minmax(0,1fr)_auto] items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0", primary && "cursor-pointer hover:bg-muted/40")}
    role={primary ? "button" : undefined} tabIndex={primary ? 0 : undefined}
    aria-label={primary ? `${finding.resource ?? finding.operation} 요청 기록 열기` : undefined}
    onClick={primary ? () => onOpenEvidence(primary) : undefined}
    onKeyDown={primary ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenEvidence(primary) } } : undefined}>
    <span onClick={(event) => event.stopPropagation()}>
      <Checkbox className="mt-0.5" aria-label={`${finding.resource ?? finding.operation} 선택`} checked={picked} disabled={disabled} onCheckedChange={(value) => onPick(value === true)} />
    </span>
    <Badge variant="outline" className="h-[22px] w-[64px] justify-center border-destructive/40 text-xs text-destructive">소견</Badge>
    <div className="min-w-0">
      <p className="break-words text-sm font-medium">{finding.resource ?? finding.operation}</p>
      <p className="mt-0.5 break-words text-xs text-muted-foreground">{finding.identity} · {finding.operation}{finding.verdict ? ` · 소견 ${finding.verdict}` : ""}</p>
      {badge
        ? <p className="mt-1.5 break-words text-sm">{finding.judgmentReason || "판정 이유가 없습니다."}</p>
        : finding.note && <p className="mt-1 break-words text-xs text-muted-foreground">{finding.note}</p>}
      {evidence.length > 0 && <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        근거{evidence.map((id) => <button key={id} type="button" className="rounded border px-1.5 py-0.5 font-mono hover:bg-muted" onClick={(event) => { event.stopPropagation(); onOpenEvidence(id) }}>{id}</button>)}
      </div>}
    </div>
    <span className={cn("rounded-md border px-2 py-0.5 text-xs whitespace-nowrap", badge ? badge[1] : "border-destructive/40 text-destructive")}>{badge ? badge[0] : "판정 전"}</span>
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

  const [matrixScope, setMatrixScope] = useState<Set<MatrixScope>>(new Set(["bola"]))
  const [graphScope, setGraphScope] = useState<Set<GraphScope>>(new Set())
  const [anonymous, setAnonymous] = useState(true)
  const [selected, setSelected] = useState<string[] | null>(null)
  const [selectedModel, setSelectedModel] = useState("")
  const [scopeOpen, setScopeOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [feedOpen, setFeedOpen] = useState(true)
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all")
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [pickError, setPickError] = useState(false)
  const [verdictFilter, setVerdictFilter] = useState<"all" | "vulnerable" | "not_vulnerable" | "inconclusive" | "unjudged">("all")

  const verify = useLlmVerifyStateQuery(true, true)
  const verifyStatus = verify.data?.status ?? "IDLE"
  const running = verifyStatus === "RUNNING"
  const feed = useLlmFeedQuery(true, running)
  const startVerify = useStartLlmVerifyMutation()
  const startJudgment = useStartLlmJudgmentMutation()
  const cancelVerify = useCancelLlmVerifyMutation()
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
    matrixScope.size ? `matrix:${[...matrixScope].join(",")}` : "",
    graphScope.size ? `graph:${[...graphScope].join(",")}` : "",
  ].filter(Boolean).join(";")
  const identityCount = (anonymous ? 1 : 0) + shownSelected.length
  const canStart = !running && !startVerify.isPending && !startJudgment.isPending && !modelLoading && sources !== "" && identityCount > 0

  const matrixSummary = [...matrixScope].map((value) => MATRIX_OPTIONS.find((option) => option[0] === value)?.[1]).join(", ")
  const graphSummary = [...graphScope].map((value) => GRAPH_OPTIONS.find((option) => option[0] === value)?.[1]).join(", ")
  const scopeSummary = [matrixSummary && `판정 매트릭스 ${matrixSummary}`, graphSummary && `점검 그래프 ${graphSummary}`].filter(Boolean).join(" · ") || "선택 없음"
  const accountSummary = [...(anonymous ? ["비로그인"] : []), ...shownSelected.map((id) => accounts.find((account) => account.id === id)?.label ?? id)].join(" · ") || "선택 없음"

  const entries = feed.data?.entries ?? []
  const riskCount = entries.filter((entry) => entry.risk).length
  const shownEntries = entries.slice().reverse()
  // 판정 값으로 거른 목록. 선택·전체 선택·판정은 "지금 보이는" 소견만 대상으로 한다.
  const judgedCount = (value: LlmFinding["judgment"]) => findings.filter((finding) => finding.judgment === value).length
  const shownFindings = verdictFilter === "all" ? findings
    : verdictFilter === "unjudged" ? findings.filter((finding) => finding.judgment === "")
    : findings.filter((finding) => finding.judgment === verdictFilter)
  // 사라졌거나 지금 필터에서 안 보이는 소견은 선택에서 뺀다.
  const pickedIds = shownFindings.map((finding) => finding.id).filter((id) => picked.has(id))
  const allPicked = shownFindings.length > 0 && pickedIds.length === shownFindings.length
  const judge = () => {
    if (pickedIds.length === 0) { setPickError(true); return }
    startJudgment.mutate({ findings: pickedIds, model: selectedModel })
  }
  const VERDICT_FILTERS: ReadonlyArray<[typeof verdictFilter, string, number]> = [
    ["all", "전체", findings.length],
    ["vulnerable", "취약", judgedCount("vulnerable")],
    ["not_vulnerable", "취약 아님", judgedCount("not_vulnerable")],
    ["inconclusive", "판단 불가", judgedCount("inconclusive")],
    ["unjudged", "미판정", judgedCount("")],
  ]

  const failure = startVerify.error ?? startJudgment.error ?? cancelVerify.error
  const notices = <>
    {failure && <Alert variant="destructive"><AlertDescription>{message(failure)}</AlertDescription></Alert>}
    {explorer.data && !providerReady && <Alert variant="destructive"><AlertDescription>Codex 준비가 필요합니다. 점검 시작 › LLM 탐색의 안내에 따라 Codex CLI 설치와 로그인을 마친 뒤 다시 시도하세요.</AlertDescription></Alert>}
  </>

  const modelControl = <div className="flex shrink-0 items-center gap-2 text-sm">
    <label className="shrink-0 text-muted-foreground" htmlFor="judgment-model">판정 모델</label>
    <select id="judgment-model" className="h-9 w-[250px] rounded-md border border-input bg-background px-3 text-sm"
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

  const scopeGroup = <T extends string>(title: string, options: ReadonlyArray<readonly [T, string, ...string[]]>, value: ReadonlySet<T>, onChange: (next: Set<T>) => void) =>
    <div role="group" aria-label={title} className="grid gap-1">
      <p className="text-xs text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-1">{options.map(([key, label, hint]) =>
        <label key={key} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
          <Checkbox checked={value.has(key)} disabled={running} onCheckedChange={() => onChange(toggle(value, key))} />
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
        <CardTitle className="text-base">진행 기록 <span className="ml-2 text-sm font-normal text-muted-foreground">{STATUS_LABEL[verifyStatus] ?? verifyStatus}{verifyStatus === "SUCCEEDED" ? ` · 소견 ${riskCount}건` : ""}</span></CardTitle>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {(["all", "risk"] as const).map((value) => <Button key={value} type="button" size="sm" variant="outline" aria-pressed={feedFilter === value}
            onClick={() => setFeedFilter(value)}
            className={cn(feedFilter === value && (value === "risk" ? "border-destructive/40 bg-destructive/10 text-destructive hover:text-destructive" : "bg-muted"))}>
            {value === "risk" && <ShieldAlert className="size-3.5" />}{value === "all" ? "전체" : "위험"}
            <span className="tabular-nums text-muted-foreground">{value === "all" ? entries.length : findings.length}</span>
          </Button>)}
          <RecordViewButton view={view} onExpand={() => setFeedOpen(true)} />
          <Button type="button" variant="outline" size="sm" aria-expanded={feedOpen} onClick={() => setFeedOpen((value) => !value)}>{feedOpen ? "진행 기록 접기" : "진행 기록 펼치기"}<ChevronDown className={cn("size-3.5", feedOpen && "rotate-180")} /></Button>
        </div>
      </div>
      <p className={cn("break-words text-sm font-medium", verifyStatus === "FAILED" && "text-destructive")} aria-live="polite">{verify.data?.message || "판정 범위와 계정을 고른 뒤 판정 시작을 누르세요."}</p>
    </CardHeader>
    <CardContent className="flex min-h-0 flex-1 flex-col p-0">
      {feedOpen && feedFilter === "risk" && findings.length > 0 && <div className="shrink-0 border-b bg-muted/40">
        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2">
          {VERDICT_FILTERS.map(([value, label, count]) => <button key={value} type="button" aria-pressed={verdictFilter === value}
            onClick={() => { setVerdictFilter(value); setPickError(false) }}
            className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
              verdictFilter === value
                ? value === "vulnerable" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-background font-medium"
                : "border-border/70 text-muted-foreground hover:text-foreground")}>
            {label}<span className="tabular-nums text-muted-foreground">{count}</span>
          </button>)}
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={allPicked} disabled={running} onCheckedChange={(value) => { setPickError(false); setPicked(value === true ? new Set(shownFindings.map((finding) => finding.id)) : new Set()) }} />전체 선택
          </label>
          <span className="text-sm text-muted-foreground">{pickedIds.length}건 선택됨</span>
          {pickError && <span role="alert" className="text-sm text-destructive">판정할 소견을 하나 이상 고르세요</span>}
          <Button type="button" size="sm" className="ml-auto" disabled={running || startJudgment.isPending} onClick={judge}><Gavel className="size-4" />선택 항목 LLM 판정</Button>
        </div>
      </div>}
      {feedOpen && feedFilter === "risk" && <div className="min-h-0 flex-1 overflow-y-auto" aria-label="LLM 소견 목록">
        {findings.length === 0
          ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">아직 소견이 없습니다. 판정 범위를 골라 판정 시작을 먼저 실행하세요.</p>
          : shownFindings.length === 0
            ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">이 필터에 해당하는 소견이 없습니다.</p>
            : shownFindings.map((finding) => <FindingRow key={finding.id} finding={finding} picked={picked.has(finding.id)} disabled={running}
              onPick={(value) => { setPickError(false); setPicked((current) => { const next = new Set(current); if (value) next.add(finding.id); else next.delete(finding.id); return next }) }}
              onOpenEvidence={(id) => openEvidenceSelection(id, finding.operation, revision)} />)}
      </div>}
      {feedOpen && feedFilter === "all" && <div className="min-h-0 flex-1 overflow-y-auto" aria-label="LLM 판정 진행 기록">
        {shownEntries.length
          ? shownEntries.map((entry) => <FeedRow key={entry.seq} entry={entry} />)
          : <p className="px-4 py-8 text-center text-sm text-muted-foreground">{running ? "LLM 동작을 기다리는 중…" : "실행하면 추천 읽기, GET 재전송과 취약점 소견이 여기에 순서대로 표시됩니다."}</p>}
      </div>}
      <form className="flex gap-2 border-t p-3" onSubmit={(event) => event.preventDefault()}>
        <Input aria-label="LLM 판정에게 추가 지시" placeholder="판정 중 추가할 지시 (준비 중)" disabled />
        <Button type="submit" size="icon" aria-label="메시지 전송" disabled><Send className="size-4" /></Button>
      </form>
    </CardContent>
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
