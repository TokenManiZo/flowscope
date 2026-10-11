import { useEffect, useRef, useState } from "react"
import { ChevronDown, CircleHelp, CircleStop, ExternalLink, LogIn, MessageSquare, Play, RefreshCw, Send } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { HttpStatusBadge, MethodBadge } from "@/components/TrafficBadges"
import { useExplorerDisplay } from "./useExplorerDisplay"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { withEvidenceOrdinals, withoutUnnumberedEvidence } from "@/lib/display/operationLabel"
import { runStatusLabel } from "@/lib/display/runStatus"
import {
  useExplorerBrowserCompleteMutation,
  useExplorerBrowserLoginMutation,
  useExplorerControlMutation,
  useExplorerModelsQuery,
  useExplorerRunQuery,
  useExplorerStartMutation,
  useExplorerSteerMutation,
} from "@/lib/query/hooks"
import { SourcePassLayout, type SourceFeedItem } from "./SourcePassLayout"
import { RecordViewButton, type RecordView } from "./RecordView"
import { AccountLaneTable } from "./AccountLaneTable"

const activeStates = new Set(["AUTHENTICATING", "RUNNING"])

function formatElapsed(value: number): string {
  const seconds = Math.max(0, Math.floor(value / 1_000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다."
}

function DeclarationCounts({ endpoints, parameters }: { endpoints: number; parameters: number }) {
  const help = (label: string, text: string) => <Tooltip><TooltipTrigger asChild>
    <button type="button" aria-label={`${label} 도움말`} className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-2"><CircleHelp className="size-3.5" aria-hidden="true" /></button>
  </TooltipTrigger><TooltipContent className="max-w-72 text-xs leading-relaxed">{text}</TooltipContent></Tooltip>
  return <div><dt className="text-muted-foreground">근거로 등록한 항목</dt><dd className="mt-1 flex items-center gap-1 font-medium tabular-nums">
    <TooltipProvider delayDuration={200}>
      <span>API {endpoints}</span>{help("근거로 등록한 API", "LLM이 화면 코드나 API 문서에서 찾아, 근거와 함께 등록한 API 수입니다. API는 기능을 요청하는 주소입니다. 실제 요청으로 관측한 API와 별도로 세며, 같은 항목은 한 번만 셉니다.")}
      <span className="mx-1 text-muted-foreground">/</span>
      <span>입력 필드 {parameters}</span>{help("근거로 등록한 입력 필드", "등록한 API에 보낼 수 있는 입력 항목 수입니다. 예: 검색어, 페이지 번호, ID. 같은 API의 같은 입력 항목은 한 번만 셉니다.")}
    </TooltipProvider>
  </dd></div>
}

/**
 * 점검 시작의 LLM 스텝. 계정은 계정·세션의 등록 계정을 고르고, 세션은 FlowScope가 띄운 브라우저 창에서 사용자가
 * 직접 로그인한 뒤 [로그인 완료]로 가져온다. 그 창은 Burp를 거치지 않아 HUMAN 수집에 섞이지 않는다.
 */
export function LlmPass({ target, accounts = [], datasetRevision = 0, evidenceOrdinals, onRecordFocusChange }: {
  onRecordFocusChange?(focused: boolean): void
  /** 진행 기록의 기록 ID(ev-…)를 #N으로 바꾸는 데 쓴다. */
  evidenceOrdinals?: Readonly<Record<string, number>>
  datasetRevision?: number
  target: string
  /** 대상 서비스의 등록 계정. */
  accounts?: readonly { id: string; label: string }[]
}) {
  const query = useExplorerRunQuery()
  const start = useExplorerStartMutation()
  const control = useExplorerControlMutation()
  const steer = useExplorerSteerMutation()
  const openLogin = useExplorerBrowserLoginMutation()
  const completeLogin = useExplorerBrowserCompleteMutation()
  const [anonymous, setAnonymous] = useState<boolean | null>(null)
  const [selected, setSelected] = useState<string[] | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [selectedEffort, setSelectedEffort] = useState<string | null>(null)
  const [operatorMessage, setOperatorMessage] = useState("")
  const [chatOpen, setChatOpen] = useState(false)
  const composer = useRef<HTMLTextAreaElement>(null)
  const feedScroll = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [feedOpen, setFeedOpen] = useState(true)
  const [steerState, setSteerState] = useState<"sent" | "failed" | null>(null)

  const data = query.data
  useEffect(() => { setSteerState(null) }, [data?.run.runId, datasetRevision])
  useEffect(() => { setChatOpen(false); setOperatorMessage("") }, [datasetRevision])
  useEffect(() => { if (chatOpen) composer.current?.focus() }, [chatOpen])
  const run = data?.run
  const active = run ? activeStates.has(run.status) : false
  const chatMessages = data?.messages ?? []
  const chatVisible = (chatOpen || chatMessages.length > 0 || Boolean(data?.rawActive))
    && (!active || Boolean(data?.rawActive))
  useEffect(() => {
    if (followLatest.current && feedScroll.current) feedScroll.current.scrollTop = feedScroll.current.scrollHeight
  }, [chatMessages.length, chatMessages.at(-1)?.text, run?.activities.length])
  // Active runs show their fixed selection. Terminal runs return to editable next-run controls.
  const canConfigure = !active
  const hasRun = Boolean(run && run.status !== "IDLE")
  const readyAccounts = new Set((data?.accounts ?? []).filter((item) => item.status === "READY").map((item) => item.id))
  const availableAccounts = new Set(accounts.map((item) => item.id))
  const nextAnonymous = anonymous ?? (run && run.status !== "IDLE" ? run.anonymous : false)
  const nextSelected = (selected ?? (run && run.status !== "IDLE" ? run.accountIds : []))
    .filter((id) => readyAccounts.has(id) && availableAccounts.has(id))
  const shownAnonymous = canConfigure ? nextAnonymous : (run?.anonymous ?? nextAnonymous)
  const shownSelected = canConfigure ? nextSelected : (run?.accountIds ?? nextSelected)
  const providerReady = run?.providerReadiness === "READY"
  const models = useExplorerModelsQuery(providerReady && canConfigure)
  const modelLoading = providerReady && canConfigure && models.isPending
  const catalog = models.isError ? undefined : models.data
  const previousModel = run && run.status !== "IDLE" ? run.model : data?.chat?.model ?? ""
  const previousEffort = run && run.status !== "IDLE" ? run.effort ?? "" : data?.chat?.effort ?? ""
  const nextModel = catalog ? (selectedModel ?? (previousModel || catalog.configuredModel)) : ""
  const modelUnavailable = Boolean(nextModel && catalog
    && !catalog.models.some((item) => item.id === nextModel))
  const modelOption = catalog?.models.find((item) => item.id === nextModel)
  const effortOptions = modelOption?.efforts ?? []
  const nextEffort = selectedEffort ?? (previousModel === nextModel ? previousEffort
    : chatMessages.length > 0 ? modelOption?.defaultEffort ?? "" : "")
  const effortUnavailable = Boolean(nextEffort && !effortOptions.some((item) => item.effort === nextEffort))
  const readyToSend = providerReady && !modelLoading && !modelUnavailable && !effortUnavailable && Boolean(target)
  const readyToExplore = readyToSend && (nextAnonymous || nextSelected.length > 0)
  const failure = query.error ?? start.error ?? control.error ?? steer.error ?? openLogin.error ?? completeLogin.error

  const feedItems: readonly SourceFeedItem[] = (run?.activities ?? []).map((item) => ({
    id: String(item.sequence),
    badge: item.kind,
    title: item.title,
    status: item.durationMillis == null ? item.status : `${item.status} · ${item.durationMillis}ms`,
    detail: item.detail && withoutUnnumberedEvidence(withEvidenceOrdinals(item.detail, evidenceOrdinals)),
  }))

  const notices = <>
    {failure && <Alert variant="destructive" aria-label={message(failure)}><AlertTitle>Explorer 요청 실패</AlertTitle><AlertDescription>{message(failure)}</AlertDescription></Alert>}
    {run && !providerReady ? <Alert variant="destructive"><AlertTitle>Codex 준비가 필요합니다</AlertTitle><AlertDescription className="space-y-3">
      <p>{run.providerReadiness}</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>공식 Codex CLI를 설치합니다.</li>
        <li>Burp를 실행하는 같은 OS 사용자로 터미널에서 <code>codex</code>를 실행하고 ChatGPT 로그인을 완료합니다.</li>
        <li>아래 버튼으로 준비 상태를 다시 확인합니다.</li>
      </ol>
      <p>LLM 스텝만 시작할 수 없는 상태이며 HUMAN·ZAP 수집은 계속 사용할 수 있습니다.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={control.isPending} onClick={() => control.mutate("recheck")}><RefreshCw className="size-4" />다시 확인</Button>
        <Button asChild variant="outline" size="sm"><a href="https://learn.chatgpt.com/docs/codex/cli" target="_blank" rel="noreferrer">공식 설치 안내<ExternalLink className="size-4" /></a></Button>
      </div>
    </AlertDescription></Alert> : null}
  </>

  const display = useExplorerDisplay(data, datasetRevision)
  const browser = display.browser
  const browserCard = hasRun ? <section className="rounded-md border" aria-label="실행 세부정보">
    <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-muted/50">
      <span>실행 세부정보 <span className="ml-2 text-muted-foreground">{formatElapsed(display.elapsedMillis)} · HTTP {run?.attempts ?? 0} / {run?.responses ?? 0}</span></span>
      <span className="flex items-center gap-1 font-medium">{detailsOpen ? "접기" : "펼치기"}<ChevronDown className={`size-3.5 ${detailsOpen ? "rotate-180" : ""}`} /></span>
    </button>
    {detailsOpen && <div className="border-t px-3 py-3 text-xs">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-medium">{active ? "브라우저 탐색 중" : runStatusLabel(run?.status ?? "IDLE")}</p>
        <p className="text-muted-foreground" aria-label={active ? "요청 모델" : "지난 실행 요청 모델"}>요청 모델 <span className="font-mono">{run?.model || "Codex 기본 설정 (실제 모델 미확인)"}</span> · 추론 강도 <span className="font-mono">{run?.effort || "Codex 설정"}</span></p>
      </div>
      {browser ? <div role="group" aria-label="브라우저 탐색 진행" className="grid gap-3">
        <dl className="grid grid-cols-3 gap-x-6 gap-y-3 [&_dt]:text-[11px] [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:font-medium [&_dd]:tabular-nums" aria-label="브라우저 실행 수치">
          <div><dt>경과</dt><dd className="font-mono">{formatElapsed(browser.elapsedMillis)}</dd></div>
          <div><dt>브라우저 동작</dt><dd>{browser.actions}회</dd></div>
          <div><dt className="flex items-center gap-1">화면 상태 조회 횟수<TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger asChild><button type="button" aria-label="화면 상태 조회 횟수 도움말" className="inline-flex size-5 items-center justify-center rounded hover:bg-muted focus-visible:outline-2"><CircleHelp className="size-3.5" aria-hidden="true" /></button></TooltipTrigger><TooltipContent>브라우저 화면 상태를 읽은 횟수입니다.</TooltipContent></Tooltip></TooltipProvider></dt><dd>{browser.snapshots}회</dd></div>
          <div><dt>관측 엔드포인트</dt><dd>{browser.endpoints}개</dd></div>
          <DeclarationCounts endpoints={run?.endpointDeclarations ?? 0} parameters={run?.parameterDeclarations ?? 0} />
          <div><dt>종료 기준</dt><dd title={browser.maxActions === 0 && browser.minutes === 0
            ? "실행은 중단 버튼이나 브라우저 창을 닫으면 종료됩니다."
            : "동작 또는 시간 상한 중 먼저 도달하면 종료합니다. 창을 닫아도 종료합니다."}>
            {browser.maxActions === 0 && browser.minutes === 0 ? "직접 중단" : `${browser.maxActions}회 · ${browser.minutes}분`}
          </dd></div>
        </dl>
      </div> : <dl><DeclarationCounts endpoints={run?.endpointDeclarations ?? 0} parameters={run?.parameterDeclarations ?? 0} /></dl>}
    </div>}
  </section> : null

  const sessions = new Map((data?.accounts ?? []).map((item) => [item.id, item]))
  const loginBusy = openLogin.isPending || completeLogin.isPending
  const rows = accounts.map((account) => {
    const session = sessions.get(account.id)
    const ready = session?.status === "READY"
    const waiting = Boolean(session?.browserOpen) && !ready
    return {
      id: account.id, label: account.label, configured: ready,
      statusText: ready ? "세션 있음" : waiting ? "로그인 대기" : "로그인 필요",
      action: waiting
        ? <Button type="button" size="sm" disabled={active || loginBusy} aria-label={`${account.label} 로그인 완료`} onClick={() => completeLogin.mutate(account.id)}>로그인 완료</Button>
        : <Button type="button" size="sm" variant="outline" className="grid h-[24px] w-[110px] grid-cols-[12px_minmax(0,1fr)] gap-1 px-2 text-[11px] [&_svg]:size-[12px]" disabled={active || loginBusy || !target} aria-label={`${account.label} 브라우저 로그인`} onClick={() => openLogin.mutate({ id: account.id, url: target })}><LogIn aria-hidden="true" /><span className="text-center">{ready ? "다시 로그인" : "브라우저 로그인"}</span></Button>,
    }
  })
  const modelControl = <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
        <Button type="button" size="sm" variant="outline" disabled={!providerReady || active || !target}
          onClick={() => setChatOpen(true)}><MessageSquare className="size-4" />Codex 자유 대화</Button>
        <label className="shrink-0 text-muted-foreground" htmlFor="explorer-model">{canConfigure ? hasRun ? "다음 탐색 모델" : "탐색 모델" : "실행 모델"}</label>
        {canConfigure ? <select id="explorer-model" className="h-9 w-[250px] rounded-md border border-input bg-background px-3 text-sm"
          value={nextModel} disabled={!providerReady || !catalog?.models.length}
          onChange={(event) => { setSelectedModel(event.target.value); setSelectedEffort(null) }}>
          {(chatMessages.length === 0 || !previousModel || !nextModel) && <option value="">{chatMessages.length ? "대화 설정 유지" : "Codex 기본 설정"}{catalog?.configuredModel ? ` (${catalog.configuredModel})` : ""}</option>}
          {modelUnavailable && <option value={nextModel} disabled>{nextModel} · 현재 사용 불가</option>}
          {(catalog?.models ?? []).map((option) => <option key={option.id} value={option.id}>{option.label}{option.recommended ? " · Codex 추천" : ""}</option>)}
        </select> : <p className="font-mono text-sm" id="explorer-model">{run?.model || "Codex 기본 설정 (실제 모델 미확인)"}</p>}
        <label className="shrink-0 text-muted-foreground" htmlFor="explorer-effort">추론 강도</label>
        {canConfigure ? <select id="explorer-effort" className="h-9 w-[155px] rounded-md border border-input bg-background px-3 text-sm"
          value={nextEffort} disabled={!providerReady || !modelOption || effortOptions.length === 0}
          onChange={(event) => setSelectedEffort(event.target.value)}>
          {(chatMessages.length === 0 || !previousEffort || !nextEffort) && <option value="">{chatMessages.length ? "대화 설정 유지" : "Codex 설정 사용"}</option>}
          {effortUnavailable && <option value={nextEffort} disabled>{nextEffort} · 현재 사용 불가</option>}
          {effortOptions.map((option) => <option key={option.effort} value={option.effort} title={option.description}>{option.effort}</option>)}
        </select> : <p className="font-mono text-sm" id="explorer-effort">{run?.effort || "Codex 설정"}</p>}
        {providerReady && canConfigure && <Button type="button" variant="outline" size="icon" className="size-9" disabled={control.isPending || modelLoading} aria-label="모델 목록 다시 확인" title="모델 목록 다시 확인" onClick={() => control.mutate("recheck", { onSuccess: () => void models.refetch() })}><RefreshCw className="size-3.5" /></Button>}
      </div>
  const control_ = <div className="grid gap-2">
    <div className="flex min-h-8 items-center justify-between gap-4">
      {providerReady && <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-label="Codex 상태"><span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />Codex 준비됨</div>}
    </div>
    {models.isError && canConfigure && <p className="text-xs text-amber-800 dark:text-amber-300">모델 목록을 확인하지 못했습니다. Codex 기본 설정으로는 실행할 수 있습니다.</p>}
    {modelLoading && <p className="text-xs text-muted-foreground">현재 계정의 모델 목록을 확인 중입니다.</p>}
    {modelUnavailable && canConfigure && <p role="alert" className="text-xs text-destructive">선택 모델이 현재 목록에 없습니다. 다시 고르세요.</p>}
    {effortUnavailable && canConfigure && <p role="alert" className="text-xs text-destructive">선택한 추론 강도는 현재 모델에서 지원되지 않습니다. 다시 고르세요.</p>}
    <section className="rounded-md border">
      <button type="button" aria-expanded={accountsOpen} onClick={() => setAccountsOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-muted/50"><span className="font-medium">탐색할 계정 <span className="ml-2 font-normal text-muted-foreground">{[...(shownAnonymous ? ["비로그인"] : []), ...shownSelected.map((id) => accounts.find((account) => account.id === id)?.label ?? id)].join(" · ") || "선택 없음"}</span></span><span className="flex items-center gap-1 font-medium">{accountsOpen ? "접기" : "펼치기"}<ChevronDown className={`size-3.5 ${accountsOpen ? "rotate-180" : ""}`} /></span></button>
      {accountsOpen && <div className="grid gap-2 border-t p-3">
      <AccountLaneTable lane="LLM" rows={rows}
        anonymous={shownAnonymous} onAnonymousChange={setAnonymous} selected={shownSelected}
        onToggle={(id, value) => setSelected((current) => value
          ? [...new Set([...(current ?? nextSelected), id])]
          : (current ?? nextSelected).filter((item) => item !== id))}
        disabled={active} />
      <p className="text-xs text-muted-foreground">[브라우저 로그인] → 열린 창에서 로그인 → [로그인 완료]. 이 창의 기록은 직접 둘러보기와 섞이지 않습니다.</p>
    </div>}
    </section>
    {browserCard}
    <div className="flex flex-wrap items-center justify-start gap-2 border-t pt-3">
      <Button size="sm" disabled={!readyToExplore || active || start.isPending} onClick={() => {
        setChatOpen(false)
        start.mutate({ target, accounts: nextSelected.join(","), anonymous: nextAnonymous,
          model: nextModel, effort: nextEffort })
      }}><Play className="size-4" />탐색 시작</Button>
      {chatMessages.length > 0 && !active && <Button type="button" size="sm" variant="outline" disabled={control.isPending} onClick={() => {
        if (!window.confirm("현재 대화 표시와 이어쓰기 참조를 지웁니다. 수집된 Evidence는 유지됩니다. 새 채팅을 시작할까요?")) return
        control.mutate("new-chat", { onSuccess: () => {
          setAnonymous(nextAnonymous); setSelected(nextSelected); setSelectedModel(nextModel); setSelectedEffort(nextEffort)
          setOperatorMessage(""); setChatOpen(true)
        } })
      }}>새 채팅</Button>}
      {active ? <Button variant="destructive" onClick={() => control.mutate("cancel")}><CircleStop className="size-4" />중단</Button>
        : run && run.status !== "IDLE" && chatMessages.length === 0 ? <Button variant="outline" onClick={() => control.mutate("clear")}>실행 표시 지우기</Button> : null}
      <span className="text-xs text-muted-foreground">{(shownAnonymous ? 1 : 0) + shownSelected.length}개 선택됨</span>
    </div>
  </div>

  const sendMessage = () => {
    const text = operatorMessage.trim()
    if (!text || start.isPending || steer.isPending) return
    setSteerState(null)
    if (run?.status === "RUNNING" && data?.rawActive) {
      steer.mutate(text, { onSuccess: () => { setOperatorMessage(""); setSteerState("sent") }, onError: () => setSteerState("failed") })
    } else if (!active && readyToSend) {
      start.mutate({ target, accounts: nextSelected.join(","), anonymous: nextAnonymous || nextSelected.length === 0,
        model: nextModel, effort: nextEffort, message: text, raw: true },
        { onSuccess: () => { setOperatorMessage(""); setSteerState("sent") }, onError: () => setSteerState("failed") })
    }
  }
  const sendDisabled = !operatorMessage.trim() || start.isPending || steer.isPending
    || (active ? !data?.rawActive : !readyToSend)

  const feedFooter = <>
    {run?.unresolved.length ? <details className="border-t border-amber-400/30 bg-amber-400/5 px-4 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-amber-800 dark:text-amber-300">확인하지 못한 항목 {run.unresolved.length}건 · 펼치기</summary>
      <div className="mt-2 grid gap-3">{run.unresolved.map((item, index) => <div key={`${item.kind}-${index}`}><p className="break-words">{item.reason}</p><p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{item.kind} · {item.target}</p></div>)}</div>
    </details> : null}
    {chatVisible && <form className="grid gap-1.5 border-t p-3" onSubmit={(event) => { event.preventDefault(); sendMessage() }}>
      <div className="flex items-end gap-2"><Textarea ref={composer} aria-label={run?.status === "RUNNING" ? "Explorer에게 추가 지시" : "LLM에게 메시지"} value={operatorMessage}
        onChange={(event) => setOperatorMessage(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendMessage() } }}
        placeholder={run?.status === "RUNNING" ? "진행 중 추가할 지시를 입력하세요" : "어떤 API와 화면을 살펴볼지 직접 입력하세요"}
        className="min-h-18 max-h-48 resize-y" disabled={start.isPending || steer.isPending} />
      <Button type="submit" size="icon" aria-label="메시지 전송" disabled={sendDisabled}><Send className="size-4" /></Button></div>
      <p className="text-xs text-muted-foreground">자유 대화는 저장된 프로젝트에서 계정 없이도 시작합니다. 선택한 대상 URL과 준비된 계정 handle을 함께 전달하며, FlowScope를 실제로 거친 범위 안 요청만 LLM 그래프에 반영합니다.</p>
      <p role="status" className="text-xs text-muted-foreground">{start.isPending || steer.isPending ? "메시지 전송 중…" : steerState === "sent" ? "서버 전송 완료" : steerState === "failed" ? "전송 실패 · 내용을 확인하고 다시 전송하세요." : "Enter로 전송 · Shift+Enter로 줄바꿈"}</p>
    </form>}
  </>
  const feed = (view: RecordView) => <Card className={`flex flex-col gap-0 overflow-hidden py-0 ${feedOpen ? "min-h-32 flex-1" : "shrink-0"}`}>
    <CardHeader className="shrink-0 border-b py-3"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="text-base">진행 기록 <span className="ml-2 text-sm font-normal text-muted-foreground">{runStatusLabel(run?.status ?? "IDLE")}</span></CardTitle><div className="flex shrink-0 items-center gap-2"><RecordViewButton view={view} onExpand={() => setFeedOpen(true)} /><Button type="button" variant="outline" size="sm" aria-expanded={feedOpen} onClick={() => setFeedOpen((value) => !value)}>{feedOpen ? "진행 기록 접기" : "진행 기록 펼치기"}<ChevronDown className={`size-3.5 ${feedOpen ? "rotate-180" : ""}`} /></Button></div></div>{view.focused && <p className="text-xs text-muted-foreground">LLM 탐색 · {target} · 실행 모델 {run?.model || "Codex 기본 설정"}</p>}<p className="break-words text-sm font-medium" aria-live="polite">{run?.message ?? "Explorer 상태를 불러오는 중입니다."}</p></CardHeader>
    <CardContent className="flex min-h-0 flex-1 flex-col p-0">
      {feedOpen && <div ref={feedScroll} data-record-list className="min-h-0 flex-1 overflow-y-auto" aria-label="LLM 진행 메시지 및 수집 트래픽" onScroll={(event) => {
        const element = event.currentTarget
        followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      }}>
        {chatVisible && <div className="grid gap-4 border-b border-border/60 px-4 py-5" aria-label="LLM 대화" role="log">
          {chatMessages.length ? chatMessages.map((entry, index) => <div key={`${entry.runId}-${entry.role}-${index}`} className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[90%] rounded-xl px-4 py-3 text-sm ${entry.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
              <p className="mb-1 text-[11px] font-medium opacity-70">{entry.role === "user" ? "나" : "LLM"}</p>
              <p className="whitespace-pre-wrap break-words">{entry.text}</p>
            </div>
          </div>) : <p className="py-5 text-center text-sm text-muted-foreground">메시지를 보내면 LLM이 이 대화에서 작업을 시작합니다. 버튼만 눌러서는 요청하지 않습니다.</p>}
        </div>}
        {chatVisible && feedItems.length > 0 && <p className="px-4 py-2 text-xs font-medium text-muted-foreground">도구 실행·수집 기록</p>}
        {feedItems.length ? feedItems.slice().reverse().map((item) => {
          const http = item.badge === "HTTP" ? item.detail?.match(/\bHTTP (\d{3})/)?.[1] : undefined
          const method = item.title.split(" ")[0]
          return <article key={item.id} className="grid grid-cols-[60px_minmax(0,1fr)_1.5rem_6rem] items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0">
            {item.badge === "HTTP" && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method) ? <MethodBadge method={method} /> : <Badge variant="outline" className="h-[22px] w-[60px] justify-center text-[11px]">{item.badge}</Badge>}
            <div className="min-w-0"><p className="break-words text-sm font-medium">{item.title}</p>{item.detail && <p className="mt-1 break-words text-xs text-muted-foreground">{item.detail}</p>}</div>
            <span className="text-xs" title={item.badge === "HTTP" ? "LLM" : undefined}>{item.badge === "HTTP" ? "L" : ""}</span>
            <span className="text-right font-mono text-[11px] text-muted-foreground">{http ? <HttpStatusBadge status={http} /> : item.status}</span>
          </article>
        }) : !chatVisible && <p className="px-4 py-8 text-center text-sm text-muted-foreground">채팅을 시작하면 인증 준비, HTTP 요청과 요청 기록(#번호)이 여기에 표시됩니다.</p>}
      </div>}
      <div className="max-h-[40%] shrink-0 overflow-y-auto border-t">{feedFooter}</div>
    </CardContent>
  </Card>

  return <SourcePassLayout label="LLM" title="LLM 탐색" titleControl={modelControl} onRecordFocusChange={onRecordFocusChange} description="LLM이 서비스를 둘러보며 API 요청과 응답을 기록합니다." control={control_} notices={notices}
    feedItems={feedItems} feedTitle="진행 기록" emptyHint="" feedContent={feed} />
}
