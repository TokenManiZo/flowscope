import { useEffect, useState } from "react"
import { Bot, Check, ChevronDown, LogIn, Play, Send, ShieldAlert, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { InfoHint } from "@/components/ui/info-hint"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useSnapshotQuery, useLlmVerifyStateQuery, useLlmFeedQuery, useStartLlmVerifyMutation, useCancelLlmVerifyMutation } from "@/lib/query/hooks"
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

/**
 * LLM 판정 페이지. 점검이 끝난 뒤 판정 매트릭스·점검 그래프를 LLM(Codex)이 보고,
 * 보내는 계정 세션으로 GET 추천을 재전송해 취약점을 찾아 소견을 남긴다.
 */
export function LlmJudgmentPage() {
  const snapshot = useSnapshotQuery()
  const accounts = snapshot.data?.accounts ?? []
  const sessions = snapshot.data?.managedSessions ?? []
  const sessionReady = (accountId: string) => sessions.some(session => session.accountId === accountId && session.replayReady === true)
  const readyCount = accounts.filter(account => sessionReady(account.id)).length

  const [matrixScope, setMatrixScope] = useState<Set<MatrixScope>>(new Set(["bola"]))
  const [graphScope, setGraphScope] = useState<Set<GraphScope>>(new Set())
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all")
  const [loginConfirmed, setLoginConfirmed] = useState(false)
  const [forceStart, setForceStart] = useState(false)

  const verify = useLlmVerifyStateQuery(true, true)
  const running = verify.data?.status === "RUNNING"
  const feed = useLlmFeedQuery(true, running)
  const startVerify = useStartLlmVerifyMutation()
  const cancelVerify = useCancelLlmVerifyMutation()
  const canStart = ((loginConfirmed && readyCount > 0) || forceStart) && !running

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set)
    next.has(value) ? next.delete(value) : next.add(value)
    return next
  }
  const matrixSummary = matrixScope.size === 0 ? "선택 안 함"
    : [...matrixScope].map(value => MATRIX_OPTIONS.find(option => option[0] === value)?.[1]).join(", ")
  const graphSummary = graphScope.size === 0 ? "선택 안 함"
    : [...graphScope].map(value => GRAPH_OPTIONS.find(option => option[0] === value)?.[1]).join(", ")

  const sources = [
    matrixScope.size ? `matrix:${[...matrixScope].join(",")}` : "",
    graphScope.size ? `graph:${[...graphScope].join(",")}` : "",
  ].filter(Boolean).join(";")

  // 실행이 끝나면(완료·실패·중단) 폴링이 멈추므로, 마지막 피드(Codex 종료·출력)를 한 번 더 가져온다.
  const verifyStatus = verify.data?.status
  useEffect(() => {
    if (verifyStatus === "SUCCEEDED" || verifyStatus === "FAILED" || verifyStatus === "CANCELLED") {
      void feed.refetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyStatus])

  const entries = feed.data?.entries ?? []
  const shownEntries = feedFilter === "risk" ? entries.filter(entry => entry.risk) : entries
  const riskCount = entries.filter(entry => entry.risk).length
  const dotColor = (type: string, risk: boolean) => risk ? "bg-destructive"
    : type === "resend" ? "bg-sky-500" : "bg-muted-foreground"

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4" aria-labelledby="llm-judgment-title">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        <h1 id="llm-judgment-title" className="flex items-center gap-1.5 text-2xl font-semibold">
          <Bot aria-hidden="true" className="size-6" />LLM 판정
          <InfoHint label="LLM 판정">점검이 끝난 뒤 판정 매트릭스·점검 그래프를 LLM이 보고, 보내는 계정 세션으로 GET 추천을 재전송해 취약점을 찾습니다. 판정 확정은 사람이 합니다.</InfoHint>
        </h1>
      </header>

      {/* 소스 선택 + 로그인/시작 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-10 gap-2 text-sm">판정 매트릭스<span className="text-sm text-muted-foreground">{matrixSummary}</span><ChevronDown aria-hidden="true" className="size-4" /></Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium">판정 매트릭스에서 가져오기 <span className="text-muted-foreground">· 중복 선택</span></div>
            <div className="p-1">{MATRIX_OPTIONS.map(([value, label, hint]) => (
              <label key={value} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2.5 text-sm hover:bg-muted/50">
                <Checkbox checked={matrixScope.has(value)} onCheckedChange={() => setMatrixScope(set => toggle(set, value))} />
                <span>{label}{hint && <span className="ml-1 text-sm text-muted-foreground">({hint})</span>}</span>
              </label>
            ))}</div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-10 gap-2 text-sm">점검 그래프<span className="text-sm text-muted-foreground">{graphSummary}</span><ChevronDown aria-hidden="true" className="size-4" /></Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-0">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium">점검 그래프에서 가져오기 <span className="text-muted-foreground">· 중복 선택</span></div>
            <div className="p-1">{GRAPH_OPTIONS.map(([value, label]) => (
              <label key={value} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2.5 text-sm hover:bg-muted/50">
                <Checkbox checked={graphScope.has(value)} onCheckedChange={() => setGraphScope(set => toggle(set, value))} />
                <span>{label}</span>
              </label>
            ))}</div>
          </PopoverContent>
        </Popover>
        <div className="ml-auto flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 gap-1.5 text-sm">
                {loginConfirmed && readyCount > 0 ? <Check aria-hidden="true" className="size-4 text-emerald-600" /> : <LogIn aria-hidden="true" className="size-4" />}
                {loginConfirmed && readyCount > 0 ? `로그인 확인됨 (${readyCount})` : "로그인 확인"}
                <InfoHint label="로그인 확인">검증에 쓸 계정을 계정·세션에서 점검 시작으로 로그인해 주세요. 로그인 후 "로그인 확인 완료"를 누르면 세션이 살아있는지 확인하고 LLM 판정 시작을 활성화합니다.</InfoHint>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="border-b border-border px-3 py-2.5">
                <p className="text-sm font-medium">계정 로그인이 필요합니다</p>
                <p className="mt-0.5 text-sm text-muted-foreground">계정·세션에서 등록한 계정을 <span className="font-medium text-foreground">점검 시작</span>으로 로그인해 주세요. 로그인된 계정만 LLM이 그 계정으로 재전송할 수 있습니다.</p>
              </div>
              <ul className="max-h-56 overflow-auto p-1">
                {accounts.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">등록된 계정이 없습니다. 계정·세션에서 먼저 등록하세요.</li>}
                {accounts.map(account => {
                  const ready = sessionReady(account.id)
                  return <li key={account.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{account.label}<span className="ml-1.5 text-sm text-muted-foreground">{account.role}</span></span>
                    {ready
                      ? <span className="flex items-center gap-1 text-sm text-emerald-600"><Check aria-hidden="true" className="size-3.5" />로그인됨</span>
                      : <Button size="sm" variant="outline" className="h-8 px-2 text-sm" onClick={() => { window.location.hash = "#accounts/" + encodeURIComponent(account.id) }}>로그인</Button>}
                  </li>
                })}
              </ul>
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5">
                <Button size="sm" variant="ghost" className="h-9 px-2 text-sm" onClick={() => { window.location.hash = "#accounts" }}>계정·세션으로 이동</Button>
                <Button size="sm" className="h-9" onClick={() => { void snapshot.refetch(); setLoginConfirmed(true) }}>로그인 확인 완료</Button>
              </div>
            </PopoverContent>
          </Popover>
          {running
            ? <Button size="sm" variant="outline" className="h-10 gap-1.5 border-destructive/40 text-sm text-destructive hover:text-destructive" disabled={cancelVerify.isPending} onClick={() => cancelVerify.mutate()}><Square aria-hidden="true" className="size-4" />중단</Button>
            : <Button size="sm" className="h-10 gap-1.5 text-sm" disabled={!canStart} onClick={() => startVerify.mutate(sources)}><Play aria-hidden="true" className="size-4" />LLM 판정 시작<InfoHint label="LLM 판정 시작">끝나면 열었던 세션을 자동 종료합니다(창 닫고 포트 정리).</InfoHint></Button>}
        </div>
      </div>
      {startVerify.isError && <p role="alert" className="shrink-0 text-sm text-destructive">시작하지 못했습니다: {startVerify.error instanceof Error ? startVerify.error.message : "알 수 없는 오류"}</p>}
      {!running && (verify.data?.status === "SUCCEEDED" || verify.data?.status === "FAILED" || verify.data?.status === "CANCELLED") && <p className={cn("shrink-0 text-sm", verify.data?.status === "FAILED" ? "text-destructive" : verify.data?.status === "SUCCEEDED" ? "text-emerald-600" : "text-muted-foreground")}>{verify.data?.status === "SUCCEEDED" ? `검증 완료 · 소견 ${riskCount}건` : verify.data?.status === "CANCELLED" ? "중단됨" : `검증 실패: ${verify.data?.message}`}</p>}
      <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Checkbox checked={forceStart} onCheckedChange={value => setForceStart(value === true)} />로그인 확인이 안 돼도 그냥 시작 (로그인 안 된 계정이 보낼 테스트는 건너뜁니다)
      </label>

      {/* 작업 피드 */}
      <div className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-card">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="mr-auto text-sm text-muted-foreground">작업 피드 · LLM 동작</span>
          {(["all", "risk"] as const).map(value => (
            <button key={value} type="button" aria-pressed={feedFilter === value}
              onClick={() => setFeedFilter(value)}
              className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
                feedFilter === value
                  ? value === "risk" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-muted font-medium"
                  : "border-border/70 text-muted-foreground hover:text-foreground")}>
              {value === "risk" && <ShieldAlert aria-hidden="true" className="size-3.5" />}{value === "all" ? "전체" : "위험"}
              <span className="text-muted-foreground">{value === "all" ? entries.length : riskCount}</span>
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {shownEntries.length === 0
            ? <p className="py-6 text-center text-sm text-muted-foreground">{running ? "LLM 동작을 기다리는 중…" : feedFilter === "risk" ? "아직 위험(취약점 추천) 항목이 없습니다." : "소스를 고르고 로그인 확인 후 LLM 판정 시작을 누르면 여기에 LLM 동작이 표시됩니다."}</p>
            : <ul>{shownEntries.map(entry => (
                <li key={entry.seq} className={cn("flex gap-2.5 border-b border-border/70 py-2.5 text-sm leading-relaxed last:border-b-0", entry.risk && "rounded-md bg-destructive/5 px-1")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dotColor(entry.type, entry.risk))} />
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour12: false })}</span>
                  <span className={cn("min-w-0 break-words", entry.risk && "text-destructive")}>{entry.summary}</span>
                </li>
              ))}</ul>}
        </div>
      </div>

      {/* 채팅 */}
      <div className="flex shrink-0 items-center gap-2">
        <Input placeholder="LLM에게 지시하거나 질문 (예: BFLA 위주로 다시 봐 줘)" className="h-11 text-sm" disabled />
        <Button className="h-11 gap-1.5 px-5 text-sm" disabled><Send aria-hidden="true" className="size-4" />보내기</Button>
      </div>
    </section>
  )
}
