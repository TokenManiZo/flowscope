import { useState } from "react"
import { CircleStop, ExternalLink, Globe, LogIn, Play, RefreshCw, Send } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
export function LlmPass({ target, accounts = [] }: {
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

  const data = query.data
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

  const browser = data?.browser ?? null
  const browserCard = browser ? <div role="group" aria-label="브라우저 탐색 진행" className="grid gap-3 rounded-lg border border-primary/40 bg-background p-3">
    <div className="flex items-baseline gap-2">
      <Globe className="size-4 text-primary" aria-hidden="true" />
      <span className="text-sm font-medium">브라우저 탐색 중</span>
      <span className="ml-auto text-sm text-muted-foreground">동작 <span className="font-medium text-foreground">{browser.actions}</span> / {browser.maxActions}</span>
    </div>
    <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="브라우저 동작 진행률"
      aria-valuenow={browser.actions} aria-valuemin={0} aria-valuemax={browser.maxActions}>
      <div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.round((browser.actions / Math.max(1, browser.maxActions)) * 100))}%` }} />
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div><p className="text-xs text-muted-foreground">경과</p><p className="font-mono text-base font-medium">{formatElapsed(browser.elapsedMillis)}</p></div>
      <div><p className="text-xs text-muted-foreground">둘러본 횟수</p><p className="text-base font-medium">{browser.snapshots}</p></div>
      <div><p className="text-xs text-muted-foreground">관측 엔드포인트</p><p className="text-base font-medium">{browser.endpoints}</p></div>
      <div><p className="text-xs text-muted-foreground">시간 상한</p><p className="text-base font-medium">{browser.minutes}분</p></div>
    </div>
    <p className="border-t pt-2 text-xs text-muted-foreground">동작 {browser.maxActions}회 또는 {browser.minutes}분 중 먼저 도달하면 끝납니다. <span className="text-foreground">창을 닫으면 그 자리에서 끝납니다.</span></p>
  </div> : null

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
        : <Button type="button" size="sm" variant="outline" disabled={active || loginBusy || !target} aria-label={`${account.label} 브라우저 로그인`} onClick={() => openLogin.mutate({ id: account.id, url: target })}><LogIn className="size-4" />{ready ? "다시 로그인" : "브라우저 로그인"}</Button>,
    }
  })
  const control_ = <div className="grid gap-4">
    {providerReady && <div className="flex min-h-10 items-center gap-2 rounded-lg bg-emerald-500/10 px-3 text-sm" aria-label="Codex 상태"><span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />Codex 준비됨</div>}
    <div className="grid gap-1.5"><span className="text-xs text-muted-foreground">탐색할 계정</span>
      <AccountLaneTable lane="LLM" rows={rows}
        anonymous={shownAnonymous} onAnonymousChange={setAnonymous} selected={shownSelected}
        onToggle={(id, value) => setSelected((current) => value ? [...new Set([...current, id])] : current.filter((item) => item !== id))}
        disabled={active} />
      <p className="text-xs text-muted-foreground">[브라우저 로그인] → 열린 창에서 로그인 → [로그인 완료]. 이 창의 기록은 직접 둘러보기와 섞이지 않습니다.</p>
    </div>
    {browserCard}
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={!providerReady || active || start.isPending || !target || (!anonymous && selected.length === 0)} onClick={() => start.mutate({ target, accounts: selected.join(","), anonymous })}><Play className="size-4" />탐색 시작</Button>
      {active ? <Button variant="destructive" onClick={() => control.mutate("cancel")}><CircleStop className="size-4" />중단</Button>
        : run && run.status !== "IDLE" ? <Button variant="outline" onClick={() => control.mutate("clear")}>실행 표시 지우기</Button> : null}
      <span className="text-sm text-muted-foreground">{(shownAnonymous ? 1 : 0) + shownSelected.length}개 선택됨</span>
    </div>
  </div>

  const feedFooter = <>
    {run?.unresolved.length ? <div className="border-t border-amber-400/30 bg-amber-400/5 p-3 text-sm">
      <p className="mb-2 font-medium text-amber-600 dark:text-amber-300">미해결 {run.unresolved.length}건</p>
      {run.unresolved.map((item, index) => <p className="break-all text-muted-foreground" key={`${item.kind}-${index}`}>{item.kind} · {item.target} · {item.reason}</p>)}
    </div> : null}
    <form className="flex gap-2 border-t p-3" onSubmit={(event) => {
      event.preventDefault()
      if (!operatorMessage.trim()) return
      steer.mutate(operatorMessage, { onSuccess: () => setOperatorMessage("") })
    }}>
      <Input aria-label="Explorer에게 추가 지시" value={operatorMessage} onChange={(event) => setOperatorMessage(event.target.value)} placeholder="실행 중 추가할 사실 기반 지시" disabled={run?.status !== "RUNNING"} />
      <Button type="submit" size="icon" aria-label="메시지 전송" disabled={run?.status !== "RUNNING" || !operatorMessage.trim()}><Send className="size-4" /></Button>
    </form>
  </>

  return <SourcePassLayout
    label="LLM"
    title="LLM 탐색"
    description="LLM이 사람처럼 서비스를 둘러보며 요청을 만듭니다."
    statusTiles={!run || run.status === "IDLE" ? [] : [
      { label: "상태", value: run ? runStatusLabel(run.status) : "불러오는 중" },
      { label: "소요 시간", value: formatElapsed(run?.elapsedMillis ?? 0), mono: true },
      { label: "HTTP 시도 / 응답", value: `${run?.attempts ?? 0} / ${run?.responses ?? 0}` },
      { label: "선언 Endpoint / Parameter", value: `${run?.endpointDeclarations ?? 0} / ${run?.parameterDeclarations ?? 0}` },
    ]}
    control={control_}
    notices={notices}
    feedItems={feedItems}
    feedTitle="진행 기록"
    feedDescription={run?.message ?? "Explorer 상태를 불러오는 중입니다."}
    feedBadge={<Badge variant={providerReady ? "outline" : "destructive"}>Codex {run?.providerReadiness ?? "확인 중"}</Badge>}
    emptyHint="실행하면 인증 준비·HTTP 요청·기록 번호가 여기에 순서대로 표시됩니다."
    feedFooter={feedFooter}
  />
}

