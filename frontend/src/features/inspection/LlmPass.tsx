import { useEffect, useState } from "react"
import { ChevronDown, CircleStop, ExternalLink, LogIn, Play, RefreshCw, Send } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { HttpStatusBadge, MethodBadge } from "@/components/TrafficBadges"
import { useExplorerDisplay } from "./useExplorerDisplay"
import { Input } from "@/components/ui/input"
import { runStatusLabel } from "@/lib/display/runStatus"
import {
  useExplorerBrowserCompleteMutation,
  useExplorerBrowserLoginMutation,
  useExplorerControlMutation,
  useExplorerRunQuery,
  useExplorerStartMutation,
  useExplorerSteerMutation,
} from "@/lib/query/hooks"
import { SourcePassLayout, type SourceFeedItem } from "./SourcePassLayout"
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

/**
 * 점검 시작의 LLM 스텝. 계정은 계정·세션의 등록 계정을 고르고, 세션은 FlowScope가 띄운 브라우저 창에서 사용자가
 * 직접 로그인한 뒤 [로그인 완료]로 가져온다. 그 창은 Burp를 거치지 않아 HUMAN 수집에 섞이지 않는다.
 */
export function LlmPass({ target, accounts = [], datasetRevision = 0 }: {
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
  const [anonymous, setAnonymous] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [operatorMessage, setOperatorMessage] = useState("")
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [feedOpen, setFeedOpen] = useState(true)
  const [steerState, setSteerState] = useState<"sent" | "failed" | null>(null)

  const data = query.data
  useEffect(() => { setSteerState(null) }, [data?.run.runId, datasetRevision])
  const run = data?.run
  const active = run ? activeStates.has(run.status) : false
  // Local state is lost when this tab unmounts (graph page, other step), which showed "비로그인" while USERA was
  // actually running. Once a run exists it is the authority on what was picked.
  const settingUp = !run || run.status === "IDLE"
  const shownAnonymous = settingUp ? anonymous : run.anonymous
  const shownSelected = settingUp ? selected : run.accountIds
  const providerReady = run?.providerReadiness === "READY"
  const failure = query.error ?? start.error ?? control.error ?? steer.error ?? openLogin.error ?? completeLogin.error

  const feedItems: readonly SourceFeedItem[] = (run?.activities ?? []).map((item) => ({
    id: String(item.sequence),
    badge: item.kind,
    title: item.title,
    status: item.durationMillis == null ? item.status : `${item.status} · ${item.durationMillis}ms`,
    detail: item.detail,
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
  const browserCard = !settingUp ? <section className="rounded-md border" aria-label="실행 세부정보">
    <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-muted/50">
      <span>실행 세부정보 <span className="ml-2 text-muted-foreground">{formatElapsed(display.elapsedMillis)} · HTTP {run?.attempts ?? 0} / {run?.responses ?? 0}</span></span>
      <span className="flex items-center gap-1 font-medium">{detailsOpen ? "접기" : "펼치기"}<ChevronDown className={`size-3.5 ${detailsOpen ? "rotate-180" : ""}`} /></span>
    </button>
    {detailsOpen && <div className="grid gap-2 border-t px-3 py-3 text-xs">
      <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2"><dt className="text-muted-foreground">선언 Endpoint / Parameter</dt><dd className="tabular-nums">{run?.endpointDeclarations ?? 0} / {run?.parameterDeclarations ?? 0}</dd></dl>
      {browser && <div role="group" aria-label="브라우저 탐색 진행" className="grid gap-2 border-t pt-2">
        <p className="font-medium">{active ? "브라우저 탐색 중" : runStatusLabel(run?.status ?? "IDLE")}</p>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">경과</dt><dd className="font-mono">{formatElapsed(browser.elapsedMillis)}</dd>
          <dt className="text-muted-foreground">브라우저 동작</dt><dd>{browser.actions} / 상한 {browser.maxActions}회</dd>
          <dt className="text-muted-foreground" title="브라우저 화면 상태를 조회한 횟수">화면 상태 조회 횟수</dt><dd>{browser.snapshots}</dd>
          <dt className="text-muted-foreground">관측 엔드포인트</dt><dd>{browser.endpoints}</dd>
          <dt className="text-muted-foreground">시간 상한</dt><dd>{browser.minutes}분</dd>
        </dl>
        <p className="text-muted-foreground">화면 상태 조회 횟수는 브라우저 화면을 읽은 횟수입니다.</p>
        <p className="text-muted-foreground">동작 {browser.maxActions}회 또는 {browser.minutes}분 중 먼저 도달하면 끝납니다. 창을 닫으면 그 자리에서 끝납니다.</p>
      </div>}
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
        : <Button type="button" size="sm" variant="outline" className="grid h-6 w-[110px] grid-cols-[12px_minmax(0,1fr)] gap-1 px-2 text-[11px] [&_svg]:size-3" disabled={active || loginBusy || !target} aria-label={`${account.label} 브라우저 로그인`} onClick={() => openLogin.mutate({ id: account.id, url: target })}><LogIn aria-hidden="true" /><span className="text-center">{ready ? "다시 로그인" : "브라우저 로그인"}</span></Button>,
    }
  })
  const control_ = <div className="grid gap-2">
    {providerReady && <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-label="Codex 상태"><span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />Codex 준비됨</div>}
    <section className="rounded-md border">
      <button type="button" aria-expanded={accountsOpen} onClick={() => setAccountsOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-muted/50"><span className="font-medium">탐색할 계정 <span className="ml-2 font-normal text-muted-foreground">{[...(shownAnonymous ? ["비로그인"] : []), ...shownSelected.map((id) => accounts.find((account) => account.id === id)?.label ?? id)].join(" · ") || "선택 없음"}</span></span><span className="flex items-center gap-1 font-medium">{accountsOpen ? "접기" : "펼치기"}<ChevronDown className={`size-3.5 ${accountsOpen ? "rotate-180" : ""}`} /></span></button>
      {accountsOpen && <div className="grid gap-2 border-t p-3">
      <AccountLaneTable lane="LLM" rows={rows}
        anonymous={shownAnonymous} onAnonymousChange={setAnonymous} selected={shownSelected}
        onToggle={(id, value) => setSelected((current) => value ? [...new Set([...current, id])] : current.filter((item) => item !== id))}
        disabled={active} />
      <p className="text-xs text-muted-foreground">[브라우저 로그인] → 열린 창에서 로그인 → [로그인 완료]. 이 창의 기록은 직접 둘러보기와 섞이지 않습니다.</p>
    </div>}
    </section>
    {browserCard}
    <div className="flex flex-wrap items-center justify-start gap-2 border-t pt-3">
      <Button size="sm" disabled={!providerReady || active || start.isPending || !target || (!anonymous && selected.length === 0)} onClick={() => start.mutate({ target, accounts: selected.join(","), anonymous })}><Play className="size-4" />탐색 시작</Button>
      {active ? <Button variant="destructive" onClick={() => control.mutate("cancel")}><CircleStop className="size-4" />중단</Button>
        : run && run.status !== "IDLE" ? <Button variant="outline" onClick={() => control.mutate("clear")}>실행 표시 지우기</Button> : null}
      <span className="text-xs text-muted-foreground">{(shownAnonymous ? 1 : 0) + shownSelected.length}개 선택됨</span>
    </div>
  </div>

  const feedFooter = <>
    {run?.unresolved.length ? <details className="border-t border-amber-400/30 bg-amber-400/5 px-4 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-amber-800 dark:text-amber-300">확인하지 못한 항목 {run.unresolved.length}건 · 펼치기</summary>
      <div className="mt-2 grid gap-3">{run.unresolved.map((item, index) => <div key={`${item.kind}-${index}`}><p className="break-words">{item.reason}</p><p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{item.kind} · {item.target}</p></div>)}</div>
    </details> : null}
    <form className="grid gap-1.5 border-t p-3" onSubmit={(event) => {
      event.preventDefault()
      if (!operatorMessage.trim() || steer.isPending) return
      setSteerState(null)
      steer.mutate(operatorMessage, { onSuccess: () => { setOperatorMessage(""); setSteerState("sent") }, onError: () => setSteerState("failed") })
    }}>
      <div className="flex gap-2"><Input aria-label="Explorer에게 추가 지시" value={operatorMessage} onChange={(event) => setOperatorMessage(event.target.value)} placeholder="실행 중 추가할 사실 기반 지시" disabled={run?.status !== "RUNNING" || steer.isPending} />
      <Button type="submit" size="icon" aria-label="메시지 전송" disabled={run?.status !== "RUNNING" || !operatorMessage.trim() || steer.isPending}><Send className="size-4" /></Button></div>
      <p role="status" className="text-xs text-muted-foreground">{steer.isPending ? "추가 지시 전송 중…" : steerState === "sent" ? "서버 전송 완료" : steerState === "failed" ? "전송 실패 · 내용을 확인하고 다시 전송하세요." : ""}</p>
    </form>
  </>
  const feed = <Card className="gap-0 overflow-hidden py-0">
    <CardHeader className="border-b py-3"><div className="flex items-center justify-between gap-3"><CardTitle className="text-base">진행 기록 <span className="ml-2 text-sm font-normal text-muted-foreground">{runStatusLabel(run?.status ?? "IDLE")}</span></CardTitle><Button type="button" variant="outline" size="sm" aria-expanded={feedOpen} onClick={() => setFeedOpen((value) => !value)}>{feedOpen ? "진행 기록 접기" : "진행 기록 펼치기"}<ChevronDown className={`size-3.5 ${feedOpen ? "rotate-180" : ""}`} /></Button></div><p className="break-words text-sm font-medium" aria-live="polite">{run?.message ?? "Explorer 상태를 불러오는 중입니다."}</p></CardHeader>
    <CardContent className="p-0">
      {feedOpen && <div className="max-h-[min(24rem,32vh)] overflow-y-auto" aria-label="LLM 진행 메시지 및 수집 트래픽">
        {feedItems.length ? feedItems.slice().reverse().map((item) => {
          const http = item.badge === "HTTP" ? item.detail?.match(/\bHTTP (\d{3})/)?.[1] : undefined
          const method = item.title.split(" ")[0]
          return <article key={item.id} className="grid grid-cols-[60px_minmax(0,1fr)_6rem] items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0">
            {item.badge === "HTTP" && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method) ? <MethodBadge method={method} /> : <Badge variant="outline" className="h-[22px] w-[60px] justify-center text-[11px]">{item.badge}</Badge>}
            <div className="min-w-0"><p className="break-words text-sm font-medium">{item.title}</p>{item.detail && <p className="mt-1 break-words text-xs text-muted-foreground">{item.detail}</p>}</div>
            <span className="text-right font-mono text-[11px] text-muted-foreground">{http ? <HttpStatusBadge status={http} /> : item.status}</span>
          </article>
        }) : <p className="px-4 py-8 text-center text-sm text-muted-foreground">실행하면 인증 준비·HTTP 요청·기록 번호가 여기에 순서대로 표시됩니다.</p>}
      </div>}
      {feedFooter}
    </CardContent>
  </Card>

  return <SourcePassLayout label="LLM" title="LLM 탐색" description="LLM이 사람처럼 서비스를 둘러보며 요청을 만듭니다." control={control_} notices={notices}
    feedItems={feedItems} feedTitle="진행 기록" emptyHint="" feedContent={feed} />
}
