import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, CheckCircle2, Copy, Eye, EyeOff, FileText, KeyRound, LogIn, RefreshCw, Send, Square, Unplug } from "lucide-react"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RequestLabDialog } from "@/features/evidence/RequestLabDialog"
import { cancelLlmDiagnosis, disconnectMcp, downloadLlmReport, getMcpConnection, sendLlmChat, setMcpPermission, startLlmDiagnosis, verifyMcpSession } from "@/lib/api/endpoints"
import type { LlmChatMessage, LlmFeedEntry, McpConnection, McpMethod, McpSettings } from "@/lib/api/types"
import { queryKeys, useExplorerModelsQuery, useHumanRunMutation, useHumanRunQuery, useLlmChatQuery, useLlmDiagnosisQuery, useLlmFeedQuery, useLlmFindingsQuery, useLlmReportsQuery, useMcpSettingsQuery, useSnapshotQuery } from "@/lib/query/hooks"
import { DATASET_REPLACING } from "@/lib/security/datasetBoundary"
import { cn } from "@/lib/utils"
import { findingStatus } from "./findingResults"
import { McpFindingRow } from "./McpFindingRow"

const METHODS: readonly McpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"]
const labels: Record<string, string> = { read: "근거 조회", resend: "재전송", finding: "소견", verdict: "판정", info: "진행", error: "오류" }
const message = (error: unknown) => error instanceof Error ? error.message : "요청을 처리하지 못했습니다."
type Account = McpSettings["accounts"][number]
type TimelineItem =
  | { kind: "activity"; timestamp: number; seq: number; entry: LlmFeedEntry }
  | { kind: "message"; timestamp: number; seq: number; message: LlmChatMessage }

function timelineOrder(item: TimelineItem) {
  return item.kind === "activity" ? 1 : item.message.role === "USER" ? 0 : 2
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("ko-KR", { hour12: false })
}

export function AiToolsPage() {
  const client = useQueryClient()
  const settings = useMcpSettingsQuery()
  const snapshot = useSnapshotQuery()
  const diagnosis = useLlmDiagnosisQuery()
  const feed = useLlmFeedQuery(true, true)
  const chat = useLlmChatQuery()
  const findings = useLlmFindingsQuery(true, true)
  const reports = useLlmReportsQuery()
  const models = useExplorerModelsQuery(true)
  const human = useHumanRunQuery()
  const login = useHumanRunMutation()
  const [tab, setTab] = useState("diagnosis")
  const [model, setModel] = useState("")
  const [loginAccount, setLoginAccount] = useState<Account | null>(null)
  const [loginError, setLoginError] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [connection, setConnection] = useState<McpConnection | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [chatDraft, setChatDraft] = useState("")
  const [chatError, setChatError] = useState("")
  const [evidenceId, setEvidenceId] = useState<string | null>(null)
  const conversationRef = useRef<HTMLOListElement>(null)
  const followConversation = useRef(true)
  const dataset = settings.data?.datasetRevision
  const previousDataset = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (previousDataset.current !== undefined && dataset !== previousDataset.current) {
      setConnection(null); setRevealed(false); setEvidenceId(null); setLoginAccount(null)
      setChatDraft(""); setChatError(""); client.setQueryData(queryKeys.llmChat, { messages: [] }); client.setQueryData(queryKeys.llmReports, { reports: [] })
    }
    previousDataset.current = dataset
  }, [client, dataset])
  useEffect(() => {
    const clear = () => { setConnection(null); setRevealed(false); setEvidenceId(null); setLoginAccount(null); setChatDraft(""); setChatError(""); client.setQueryData(queryKeys.llmChat, { messages: [] }); client.setQueryData(queryKeys.llmReports, { reports: [] }) }
    window.addEventListener(DATASET_REPLACING, clear)
    return () => window.removeEventListener(DATASET_REPLACING, clear)
  }, [client])
  const permission = useMutation({ mutationFn: setMcpPermission,
    onSuccess: data => { client.setQueryData(queryKeys.mcp, data); setError("") },
    onError: cause => setError(message(cause)),
    onSettled: () => { void client.invalidateQueries({ queryKey: queryKeys.mcp }) },
  })
  const start = useMutation({ mutationFn: startLlmDiagnosis,
    onSuccess: data => { client.setQueryData(queryKeys.llmDiagnosis, data); client.setQueryData(queryKeys.llmChat, { messages: [] }); client.setQueryData(queryKeys.llmFeed, { entries: [] }); followConversation.current = true; setTab("conversation"); setError(""); setChatDraft(""); setChatError(""); void chat.refetch(); void feed.refetch(); void findings.refetch() },
    onError: cause => setError(message(cause)),
  })
  const stop = useMutation({ mutationFn: cancelLlmDiagnosis,
    onSuccess: data => { client.setQueryData(queryKeys.llmDiagnosis, data); void feed.refetch() },
    onError: cause => setError(message(cause)),
  })
  const sendChat = useMutation({ mutationFn: sendLlmChat,
    onSuccess: () => { setChatDraft(""); setChatError(""); void chat.refetch(); void feed.refetch(); void diagnosis.refetch(); void reports.refetch() },
    onError: cause => setChatError(message(cause)),
  })
  const connect = useMutation({ mutationFn: getMcpConnection,
    onSuccess: data => { setConnection(data); setRevealed(true); setError("") }, onError: cause => setError(message(cause)) })
  const disconnect = useMutation({ mutationFn: disconnectMcp,
    onSuccess: data => { setConnection(null); setRevealed(false); client.setQueryData(queryKeys.mcp, data); setNotice("연결 키를 재발급했습니다.") },
    onError: cause => setError(message(cause)) })
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setNotice(`${label} 복사됨`); setError("") }
    catch { setError("클립보드에 복사하지 못했습니다.") }
  }
  const downloadReport = async (id: string, format: "md" | "pdf") => {
    try {
      const blob = await downloadLlmReport(id, format)
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url; link.download = `${id}.${format}`; document.body.append(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) { setError(message(cause)) }
  }
  const data = settings.data
  const run = diagnosis.data
  const running = run?.status === "RUNNING"
  const busy = running || run?.status === "CHATTING"
  const chatReady = run?.chatReady ?? (running || run?.status === "SUCCEEDED" || run?.status === "CHATTING")
  const selectedMethods = METHODS.filter(method => data?.methods[method])
  const events = snapshot.data?.events ?? []
  const counts = events.reduce((sum, item) => {
    const source = item.source.toUpperCase()
    sum[source] = (sum[source] ?? 0) + 1
    return sum
  }, {} as Record<string, number>)
  const findingRows = findings.data?.findings ?? []
  const visibleReports = reports.data && data?.projectId && reports.data.projectId
    && data.projectId !== reports.data.projectId ? [] : reports.data?.reports ?? []
  const feedRows = feed.data?.entries ?? []
  const timeline: TimelineItem[] = [
    ...feedRows.map(entry => ({ kind: "activity" as const, timestamp: entry.timestamp, seq: entry.seq, entry })),
    ...(chat.data?.messages ?? []).map(message => ({ kind: "message" as const, timestamp: message.timestamp, seq: message.seq, message })),
  ].sort((a, b) => a.timestamp - b.timestamp || timelineOrder(a) - timelineOrder(b) || a.seq - b.seq)
  const lastTimelineKey = timeline.length ? `${timeline.at(-1)?.kind}-${timeline.at(-1)?.seq}` : ""
  const readCount = feedRows.filter(entry => entry.type === "read").length
  const event = events.find(item => item.eventId === evidenceId)
  useEffect(() => {
    const list = conversationRef.current
    if (tab === "conversation" && list && followConversation.current) list.scrollTop = list.scrollHeight
  }, [tab, lastTimelineKey, timeline.length])
  const openLogin = async (account: Account) => {
    setLoginAccount(account)
    setLoginError("")
    login.reset()
    const current = (await human.refetch()).data
    const runs = current?.runs ?? (current?.active ? [current] : [])
    if (!runs.some(run => run.accountId === account.accountId))
      await login.mutateAsync({ action: "begin", account: account.accountId }).catch(cause => setLoginError(message(cause)))
  }
  const confirmLogin = async () => {
    if (!loginAccount || !data) return
    setVerifying(true); setLoginError("")
    try {
      const updated = await verifyMcpSession(loginAccount.accountId, data.datasetRevision)
      client.setQueryData(queryKeys.mcp, updated)
      if (updated.accounts.find(account => account.accountId === loginAccount.accountId)?.usable) {
        setLoginAccount(null); setNotice(`${loginAccount.label} 로그인 확인 완료`)
      } else setLoginError("대상 서비스에서 로그인을 마치고 다시 확인하세요.")
    } catch (cause) { setLoginError(message(cause)) }
    finally { setVerifying(false); void settings.refetch() }
  }

  return <ReferenceAnalysisWorkspace ariaLabel="AI 취약점 진단 작업 영역" context={null} inspector={null}>
    <section className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6" aria-labelledby="diagnosis-title">
      <header className="flex items-start justify-between gap-3"><div><h1 id="diagnosis-title" className="text-2xl font-semibold">AI 취약점 진단</h1><p className="mt-1 text-sm text-muted-foreground">수집한 요청·응답을 근거로 조사하고, 후속 작업을 대화로 이어갑니다.</p></div><Button variant="ghost" size="icon" aria-label="상태 새로고침" onClick={() => { void settings.refetch(); void snapshot.refetch(); void diagnosis.refetch(); void feed.refetch(); void chat.refetch(); void findings.refetch(); void reports.refetch() }}><RefreshCw className={cn(diagnosis.isFetching && "animate-spin")} /></Button></header>
      {(error || settings.isError || diagnosis.isError) && <Alert variant="destructive"><AlertDescription>{error || message(settings.error || diagnosis.error)}</AlertDescription></Alert>}
      {notice && <p role="status" className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400"><Check className="size-4" />{notice}</p>}
      <section aria-labelledby="diagnosis-sessions" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="diagnosis-sessions" className="text-base font-semibold">재전송에 사용할 세션</h2><span className="text-xs text-muted-foreground">계정 카드를 누르면 로그인 브라우저가 열립니다.</span></div>
        {settings.isPending ? <p role="status" className="text-sm text-muted-foreground">세션 확인 중…</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data?.accounts.map(account => account.accountId === "anon"
            ? <div key="anon" className="flex min-h-24 items-center gap-3 rounded-lg border border-emerald-500/35 bg-card px-4 py-3"><CheckCircle2 className="size-5 shrink-0 text-emerald-500" /><div><strong className="text-sm">{account.label}</strong><p className="text-xs text-emerald-600 dark:text-emerald-400">사용 가능</p></div><span className="ml-auto text-xs text-muted-foreground">로그인 불필요</span></div>
            : <button key={account.accountId} type="button" onClick={() => void openLogin(account)} aria-label={`${account.label} ${account.usable ? "다시 로그인" : "로그인"}`} className={cn("flex min-h-24 min-w-0 items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left hover:border-ring focus-visible:outline-2 focus-visible:outline-ring", account.usable ? "border-emerald-500/35" : "border-amber-500/40")}>
              {account.usable ? <CheckCircle2 className="size-5 shrink-0 text-emerald-500" /> : <LogIn className="size-5 shrink-0 text-amber-500" />}
              <div className="min-w-0 flex-1"><strong className="break-all text-sm">{account.label}</strong><p className={cn("text-xs", account.usable ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>{account.usable ? "사용 가능" : account.reason || "로그인 필요"}</p>{account.service && <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{account.service}</p>}</div><span className="shrink-0 text-xs text-muted-foreground">{account.usable ? "다시 로그인 ›" : "로그인 ›"}</span>
            </button>)}
        </div>}
        {data && data.accounts.length === 1 && <a href="#accounts" className="inline-flex items-center gap-2 text-sm underline underline-offset-4"><LogIn className="size-4" />계정 등록</a>}
      </section>
      <Tabs value={tab} onValueChange={setTab} className="gap-5">
        <TabsList variant="line"><TabsTrigger value="conversation">작업 대화</TabsTrigger><TabsTrigger value="diagnosis">진단 설정</TabsTrigger><TabsTrigger value="results">진단 결과</TabsTrigger><TabsTrigger value="connection">MCP 연결</TabsTrigger></TabsList>
        <TabsContent value="conversation" className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,.65fr)]">
          <section className="flex min-h-[34rem] flex-col rounded-lg border bg-card" aria-labelledby="project-conversation-title">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4"><div><h2 id="project-conversation-title" className="text-base font-semibold">프로젝트 대화</h2><p className="mt-1 text-xs text-muted-foreground">최초 진단부터 후속 요청까지 대화와 MCP 작업 기록을 시간순으로 표시합니다.</p></div><Badge variant="outline">{running ? "진단 진행 중" : run?.status === "CHATTING" ? "작업 처리 중" : run?.status === "FAILED" ? "진단 실패" : chatReady ? "대화 가능" : "진단 시작 필요"}</Badge></div>
            <p className="border-b bg-muted/20 px-5 py-3 text-xs text-muted-foreground">{running ? "진단 중 메시지를 보내면 현재 작업에 반영됩니다." : chatReady ? "진단이 끝나도 같은 프로젝트에서 다음 질문이나 조사를 이어갈 수 있습니다." : "진단 설정에서 수집 근거를 확인하고 취약점 진단을 시작하세요."}</p>
            <ol ref={conversationRef} aria-label="프로젝트 대화와 작업 기록" onScroll={event => { const list = event.currentTarget; followConversation.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80 }} className="max-h-[35rem] min-h-60 flex-1 space-y-3 overflow-auto p-5 text-sm">
              {timeline.length ? timeline.map(item => item.kind === "activity"
                ? <li key={`activity-${item.seq}`} className={cn("ml-2 border-l-2 py-1 pl-4", item.entry.type === "error" ? "border-destructive" : "border-border")}>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs"><span className={cn("font-medium", item.entry.type === "error" && "text-destructive")}>작업 · {labels[item.entry.type] ?? item.entry.type}</span><time className="text-muted-foreground" dateTime={new Date(item.timestamp).toISOString()}>{formatTime(item.timestamp)}</time></div>
                    {item.entry.evidenceId ? <button type="button" className="break-words text-left underline-offset-4 hover:underline" onClick={() => setEvidenceId(item.entry.evidenceId!)}>{item.entry.summary}</button> : <p className="break-words">{item.entry.summary}</p>}
                  </li>
                : <li key={`message-${item.seq}`} className={cn("max-w-[90%] rounded-lg border p-3", item.message.role === "USER" ? "ml-auto border-emerald-500/30 bg-emerald-500/10" : "mr-auto bg-muted/30")}>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs font-medium"><span>{item.message.role === "USER" ? "나" : "LLM"}</span><div className="flex gap-2"><time className="font-normal text-muted-foreground" dateTime={new Date(item.timestamp).toISOString()}>{formatTime(item.timestamp)}</time>{item.message.role === "USER" && <span className={cn("font-normal", item.message.status === "FAILED" ? "text-destructive" : "text-muted-foreground")}>{item.message.status === "QUEUED" ? "연결 대기" : item.message.status === "SENT" ? "전달 중" : item.message.status === "DELIVERED" ? "전달됨" : "전달 실패"}</span>}</div></div><p className="whitespace-pre-wrap break-words">{item.message.text}</p>
                  </li>) : <li className="grid h-full min-h-48 place-items-center text-center text-muted-foreground">{running ? "최초 진단의 작업 기록을 기다리는 중입니다." : "진단을 시작하면 작업 기록과 대화가 여기에 표시됩니다."}</li>}
            </ol>
            <form onSubmit={event => { event.preventDefault(); if (chatReady && dataset !== undefined && chatDraft.trim() && !sendChat.isPending) { followConversation.current = true; sendChat.mutate({ datasetRevision: dataset, message: chatDraft.trim() }) } }} className="space-y-2 border-t p-5">
              <label htmlFor="project-chat-input" className="text-sm font-medium">다음 작업 또는 질문</label>
              <textarea id="project-chat-input" aria-label="프로젝트 대화에 질문 또는 작업 지시" value={chatDraft} onChange={event => setChatDraft(event.target.value)} disabled={!chatReady || sendChat.isPending} maxLength={4000} rows={3} placeholder={chatReady ? "예: 차량 위치 API를 계정별로 검증하고, 근거를 포함한 보고서를 만들어줘" : "먼저 진단 설정에서 취약점 진단을 시작하세요."} className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50" />
              {chatError && <p role="alert" className="text-xs text-destructive">{chatError}</p>}
              <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">현재 프로젝트 · FlowScope MCP 도구 사용 기록</span><Button type="submit" size="sm" disabled={!chatReady || !chatDraft.trim() || sendChat.isPending}><Send />{sendChat.isPending ? "전송 중…" : "보내기"}</Button></div>
            </form>
          </section>
          <aside className="space-y-4" aria-label="현재 작업 범위">
            <section className="rounded-lg border bg-card p-5"><h2 className="text-base font-semibold">현재 작업 범위</h2><p className="mt-1 text-xs text-muted-foreground">대화 중에도 점검 범위와 계정 상태가 적용됩니다.</p><div className="mt-4 space-y-3 border-t pt-4 text-sm"><div><span className="text-xs text-muted-foreground">재전송 허용</span><p className="mt-1 font-mono">{selectedMethods.join(" · ") || "없음"}</p></div><div><span className="text-xs text-muted-foreground">사용 가능한 세션</span><p className="mt-1">{data?.accounts.filter(account => account.usable).map(account => account.label).join(" · ") || "없음"}</p></div><div><span className="text-xs text-muted-foreground">요청 예시</span><p className="mt-1">새 요청 수집 · 특정 API 조사 · 계정 간 비교 · 스캐너 결과 확인 · 소견 재검토 · 보고서 생성</p><p className="mt-2 text-xs text-muted-foreground">예시 외에도 현재 프로젝트에서 지원하는 분석과 작업을 요청할 수 있습니다.</p></div></div><Button variant="outline" size="sm" className="mt-4" onClick={() => setTab("diagnosis")}>진단 설정 보기</Button></section>
            <section className="rounded-lg border bg-card p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">생성된 보고서</h2><span className="text-xs text-muted-foreground">{visibleReports.length}건</span></div>{visibleReports.length ? <ol className="mt-3 space-y-3">{visibleReports.map(report => <li key={report.id} className="rounded-md border p-3"><p className="break-words text-sm font-medium">{report.title}</p><p className="mt-1 text-xs text-muted-foreground">소견 {report.findingCount}건 · 근거 {report.evidenceCount}건</p><div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={() => void downloadReport(report.id, "md")}>Markdown</Button><Button size="sm" variant="outline" onClick={() => void downloadReport(report.id, "pdf")}>PDF</Button></div></li>)}</ol> : <p className="mt-3 text-xs text-muted-foreground">대화에서 근거를 바탕으로 보고서 생성을 요청하세요.</p>}</section>
          </aside>
        </TabsContent>
        <TabsContent value="diagnosis" className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
          <section className="space-y-4 rounded-lg border bg-card p-5" aria-labelledby="diagnosis-evidence">
            <div className="flex items-center justify-between gap-2"><h2 id="diagnosis-evidence" className="text-base font-semibold">진단에 사용할 근거</h2><Badge variant="outline">수집됨</Badge></div>
            <div><strong className="text-3xl tabular-nums">{events.length.toLocaleString("ko-KR")}</strong><span className="ml-1 text-sm text-muted-foreground">건 현재 프로젝트의 요청·응답</span></div>
            <div className="flex flex-wrap gap-2">{["HUMAN", "SCANNER", "LLM"].map(source => <span key={source} className="rounded bg-muted px-2 py-1 font-mono text-xs">{source} {(counts[source] ?? 0).toLocaleString("ko-KR")}</span>)}</div>
            <p className="text-sm text-muted-foreground">LLM은 MCP로 필요한 근거를 조회합니다. 매트릭스에서 제외한 항목은 진단 대상에서 빠집니다.</p>
            <div className="border-t pt-4"><label htmlFor="diagnosis-model" className="mb-2 block text-sm font-medium">진단 모델</label><select id="diagnosis-model" value={model} onChange={event => setModel(event.target.value)} disabled={busy} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">사용 가능한 모델 자동 선택</option>{(models.data?.models ?? []).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>{models.isError && <p className="mt-2 text-xs text-muted-foreground">모델 목록을 가져오지 못했습니다. 진단 시작 시 사용 가능한 모델을 확인합니다.</p>}</div>
            <div className="space-y-2"><h3 className="text-sm font-medium">재전송 허용 메서드 · {selectedMethods.length}개 선택</h3><div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{METHODS.map(method => <label key={method} className={cn("grid cursor-pointer gap-1 rounded-md border p-2 text-xs", data?.methods[method] ? "border-emerald-500/60 bg-emerald-500/10" : "border-border bg-muted/30")}><input type="checkbox" aria-label={method} checked={data?.methods[method] ?? false} disabled={!data || permission.isPending || busy} onChange={event => data && permission.mutate({ datasetRevision: data.datasetRevision, method, enabled: event.target.checked })} className="accent-emerald-500" /><span className="font-mono">{method}</span><span className={data?.methods[method] ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>{data?.methods[method] ? "ON" : "OFF"}</span></label>)}</div><p className="text-xs text-muted-foreground">선택한 메서드만 점검 범위 안에서 재전송할 수 있습니다.</p></div>
            <div className="flex flex-wrap items-center gap-3 pt-1"><Button className="bg-brand text-brand-foreground hover:bg-brand/90" disabled={!data || !events.length || !selectedMethods.length || busy || start.isPending || (busy && run?.datasetRevision !== dataset)} onClick={() => data && start.mutate({ datasetRevision: data.datasetRevision, model })}>{start.isPending ? "시작 중…" : "취약점 진단 시작"}</Button>{running && <Button variant="outline" disabled={stop.isPending} onClick={() => stop.mutate()}><Square />중단</Button>}<span className="text-xs text-muted-foreground">로그인 필요 계정은 재전송에서 제외됩니다.</span></div>
          </section>
          <section className="flex min-h-80 flex-col rounded-lg border bg-card p-5" aria-labelledby="diagnosis-progress">
            <div className="flex items-center justify-between gap-2"><h2 id="diagnosis-progress" className="text-base font-semibold">진행 기록</h2><Badge variant="outline">{running ? "진행 중" : run?.status === "CHATTING" ? "후속 작업 중" : run?.status === "SUCCEEDED" ? "완료" : run?.status === "FAILED" ? "실패" : run?.status === "CANCELLED" ? "중단" : "대기"}</Badge></div>
            <p className="mt-4 text-sm">MCP 근거 조회 <strong>{readCount}회</strong></p><div className="my-4 border-t" />
            {feedRows.length ? <ol className="max-h-96 space-y-3 overflow-auto text-sm">{[...feedRows].reverse().map(entry => <li key={entry.seq} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2"><span className="text-xs text-muted-foreground">{labels[entry.type] ?? entry.type}</span>{entry.evidenceId ? <button className="break-words text-left underline-offset-4 hover:underline" onClick={() => setEvidenceId(entry.evidenceId!)}>{entry.summary}</button> : <span className="break-words">{entry.summary}</span>}</li>)}</ol> : <div className="grid flex-1 place-items-center text-center text-sm text-muted-foreground"><p>진단을 시작할 준비가 됐습니다.<br />MCP 조회, 재전송, 소견 작성 순서가 여기에 표시됩니다.</p></div>}
            {run && run.status !== "IDLE" && <p role="status" className="mt-auto border-t pt-3 text-xs text-muted-foreground">{run.message}</p>}
          </section>
        </TabsContent>
        <TabsContent value="results" className="space-y-4"><section className="rounded-lg border bg-card p-5" aria-labelledby="diagnosis-results"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="diagnosis-results" className="text-base font-semibold">LLM 진단 결과</h2><div className="flex gap-2 text-xs"><Badge variant="outline">취약 {findingRows.filter(item => findingStatus(item) === "vulnerable").length}</Badge><Badge variant="outline">판단 불가 {findingRows.filter(item => findingStatus(item) === "inconclusive").length}</Badge></div></div>{findings.isError && <Alert variant="destructive" className="mt-4"><AlertDescription>{message(findings.error)}</AlertDescription></Alert>}{!findingRows.length ? <p className="py-10 text-center text-sm text-muted-foreground">아직 저장된 LLM 소견이 없습니다.</p> : <div className="mt-3 divide-y border-t">{findingRows.map(finding => <McpFindingRow key={finding.id} finding={finding} ordinals={snapshot.data?.evidenceOrdinals} onOpenEvidence={setEvidenceId} />)}</div>}</section></TabsContent>
        <TabsContent value="connection" className="space-y-5">
          <section className="space-y-4 rounded-lg border bg-card p-5" aria-labelledby="mcp-server"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="mcp-server" className="text-base font-semibold">로컬 MCP 서버</h2><Badge variant="outline">{data ? "실행 중" : "확인 중"}</Badge></div><dl className="grid gap-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]"><dt className="text-muted-foreground">서버 주소</dt><dd className="flex min-w-0 items-center gap-2"><code className="min-w-0 flex-1 break-all rounded-md border bg-muted/30 px-3 py-2">{data?.url ?? "—"}</code><Button size="icon" variant="outline" aria-label="서버 주소 복사" disabled={!data} onClick={() => data && void copy(data.url, "서버 주소")}><Copy /></Button></dd><dt className="text-muted-foreground">점검 범위</dt><dd className="space-y-1 font-mono text-xs">{data?.scope.map(scope => <div key={scope} className="break-all">{scope}</div>)}</dd><dt className="text-muted-foreground">최근 클라이언트</dt><dd>{data?.clients.length ? data.clients.map(item => <div key={item.name}>{item.name} {item.version}</div>) : "연결 이력 없음"}</dd></dl><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={connect.isPending || !data} onClick={() => connect.mutate()}><KeyRound />연결 정보</Button><Button variant="outline" disabled={disconnect.isPending || !data || busy} onClick={() => disconnect.mutate()}><Unplug />연결 키 재발급</Button></div>{connection && connection.datasetRevision === dataset && <div className="space-y-3 rounded-lg border p-4" aria-label="MCP 연결 정보"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">Authorization</span><Button size="icon" variant="ghost" aria-label={revealed ? "연결 키 숨기기" : "연결 키 표시"} onClick={() => setRevealed(!revealed)}>{revealed ? <EyeOff /> : <Eye />}</Button><Button className="ml-auto" size="sm" variant="outline" onClick={() => void copy(JSON.stringify(connection.config, null, 2), "MCP 설정")}><Copy />설정 복사</Button></div><code className="block break-all font-mono text-xs">{revealed ? `Bearer ${connection.token}` : "••••••••••••••••"}</code>{revealed && <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-xs">{JSON.stringify(connection.config, null, 2)}</pre>}</div>}</section>
          <section className="space-y-2 rounded-lg border bg-card p-5"><h2 className="text-base font-semibold">MCP 활동</h2>{!feedRows.length ? <p className="text-sm text-muted-foreground">활동 기록 없음</p> : <ol className="divide-y">{[...feedRows].reverse().map(entry => <li key={entry.seq} className="flex gap-3 py-2 text-sm"><span className="w-16 shrink-0 text-xs text-muted-foreground">{labels[entry.type] ?? entry.type}</span><span className="break-words">{entry.summary}</span></li>)}</ol>}</section>
        </TabsContent>
      </Tabs>
      <Dialog open={loginAccount !== null} onOpenChange={open => { if (!open) setLoginAccount(null) }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>로그인 브라우저 · {loginAccount?.label}</DialogTitle><DialogDescription>별도 브라우저 창에서 대상 서비스에 직접 로그인하세요. FlowScope 화면에는 비밀번호를 입력하지 않습니다.</DialogDescription></DialogHeader><div className="space-y-3"><p className="break-all rounded border bg-muted/30 p-2 font-mono text-xs">{loginAccount?.service ?? "대상 서비스"}</p><p className="text-sm">{login.isPending ? "로그인 브라우저를 여는 중…" : "로그인을 마친 뒤 아래에서 세션을 확인하세요."}</p>{!loginAccount?.proofConfigured && <p className="text-xs text-amber-700 dark:text-amber-400">로그인 확인 규칙이 필요합니다. 계정 설정에서 본인 확인 주소와 응답 표식을 저장하세요.</p>}{loginError && <p role="alert" className="text-sm text-destructive">{loginError}</p>}<div className="flex flex-wrap gap-2"><Button disabled={login.isPending || verifying} onClick={() => void confirmLogin()}><CheckCircle2 />{verifying ? "확인 중…" : "FlowScope에서 로그인 확인"}</Button><Button variant="outline" onClick={() => loginAccount && void openLogin(loginAccount)} disabled={login.isPending}><LogIn />브라우저 상태 확인</Button>{loginAccount?.loginUrl && <Button variant="ghost" asChild><a href={loginAccount.loginUrl}><FileText />계정 설정</a></Button>}</div></div></DialogContent></Dialog>
      {evidenceId && !event && <Alert><AlertDescription>현재 요청 기록에서 이 근거를 찾지 못했습니다.</AlertDescription></Alert>}
      {event && snapshot.data && <RequestLabDialog open onOpenChange={open => !open && setEvidenceId(null)} event={event} accounts={snapshot.data.accounts} sessions={snapshot.data.managedSessions} datasetRevision={snapshot.data.datasetRevision} snapshotRevision={snapshot.data.revision} initialView="original" />}
    </section>
  </ReferenceAnalysisWorkspace>
}
