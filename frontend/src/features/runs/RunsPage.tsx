import { useEffect, useMemo, useState } from "react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCancelLlmRunMutation, useFollowUpLlmJudgeMutation, useHumanRunQuery, useLlmRunQuery, useScannerRunQuery, useSnapshotQuery, useStartLlmRunMutation, useZapStatusQuery } from "@/lib/query/hooks"
import { activeManagedAccountIds } from "@/features/inspection/inspectionState"
import { RunLaneCard } from "./RunLaneCard"

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "요청을 완료하지 못했습니다." }
function isCompleted(status: string | undefined): boolean { return status === "COMPLETED" || status === "COMPLETED_WITH_WARNINGS" || status === "SUCCEEDED" }
function completedLaneLabel(lane: string): string {
  return { HUMAN: "HUMAN", SCANNER: "ZAP 기준선", LLM: "LLM" }[lane] ?? lane
}

export function RunsPage() {
  const snapshot = useSnapshotQuery()
  const human = useHumanRunQuery()
  const zap = useZapStatusQuery()
  const scanner = useScannerRunQuery()
  const llm = useLlmRunQuery()
  const start = useStartLlmRunMutation()
  const cancel = useCancelLlmRunMutation()
  const followUp = useFollowUpLlmJudgeMutation()
  const [provider, setProvider] = useState<"CODEX" | "CLAUDE">("CODEX")
  const [target, setTarget] = useState("")
  const [account, setAccount] = useState("")
  const [message, setMessage] = useState("")
  const scope = llm.data?.scope ?? scanner.data?.scope ?? []
  const run = llm.data?.run
  useEffect(() => {
    if (!target && scope[0]) setTarget(scope[0])
  }, [scope, target])
  const activeAccounts = useMemo(() => {
    const ids = activeManagedAccountIds(target, snapshot.data?.managedSessions ?? [])
    const labels = new Map((snapshot.data?.managedSessions ?? []).map((session) => [session.accountId, session.accountLabel]))
    return ids.map((id) => ({ id, label: labels.get(id) ?? id }))
  }, [snapshot.data?.managedSessions, target])
  useEffect(() => { if (account && !activeAccounts.some((value) => value.id === account)) setAccount("") }, [account, activeAccounts])

  const providerAvailable = run?.providers?.[provider] === true
  const targetInScope = target !== "" && scope.includes(target)
  const lanesReady = ["HUMAN", "SCANNER", "LLM"].every((lane) => llm.data?.completed_lanes.includes(lane))
  const running = run?.status === "RUNNING"
  const judgeEligible = !running && isCompleted(run?.status) && run?.role === "JUDGE" && Boolean(run?.provider_session_id)
  const outputTail = run?.output_tail ? run.output_tail.slice(-1_500) : ""
  const requestStart = (role: "EXPLORER" | "JUDGE") => start.mutate({ provider, role, target, account })
  const explorerDisabledReason = running
    ? "Explorer 시작 대기: 현재 LLM 실행이 끝날 때까지 기다리세요."
    : !providerAvailable
      ? `Explorer 시작 대기: ${provider} provider를 사용할 수 없습니다.`
      : !target
        ? "Explorer 시작 대기: 대상 scope를 먼저 적용하세요."
        : !targetInScope
          ? "현재 scope에 정확히 포함된 대상을 선택하세요."
        : start.isPending
          ? "Explorer 시작 대기: 시작 요청을 보내고 있습니다."
          : ""

  const humanSummary = human.data ? human.data.active ? "진행 중" : human.data.completed ? "완료" : "대기" : human.isPending ? "불러오는 중" : "상태 확인 필요"
  const humanCardStatus = human.data ? human.data.active ? "RUNNING" : human.data.completed ? "COMPLETED" : "NOT_STARTED" : humanSummary
  const queryError = human.isError
    ? { error: human.error, hasLastSuccess: human.data !== undefined }
    : zap.isError
      ? { error: zap.error, hasLastSuccess: zap.data !== undefined }
      : scanner.isError
        ? { error: scanner.error, hasLastSuccess: scanner.data !== undefined }
        : llm.isError
          ? { error: llm.error, hasLastSuccess: llm.data !== undefined }
          : undefined
  const context = <section className="grid gap-3 p-3"><div><h2 className="text-sm font-semibold">현재 실행 상태</h2><p className="text-xs text-muted-foreground">각 lane의 서버 상태를 그대로 표시합니다.</p></div><dl className="grid gap-2 text-sm"><div className="flex justify-between gap-2"><dt>HUMAN</dt><dd>{humanSummary}</dd></div><div className="flex justify-between gap-2"><dt>ZAP</dt><dd>{scanner.data?.run.status ?? zap.data?.state ?? "상태 없음"}</dd></div><div className="flex justify-between gap-2"><dt>LLM</dt><dd>{run?.status ?? "상태 없음"}</dd></div><div className="flex justify-between gap-2"><dt>scope</dt><dd className="font-mono">{scope.length}</dd></div></dl></section>
  const inspector = <section className="grid gap-3 p-3"><div><h2 className="text-sm font-semibold">실행 레인 안내</h2><p className="text-sm text-muted-foreground">선택한 실행 항목이 없습니다.</p></div><p className="text-xs text-muted-foreground">HUMAN 상태 · {humanSummary}</p><p className="text-xs text-muted-foreground">HUMAN은 점검 시작에서, ZAP은 승인된 기준선에서, LLM은 현재 provider와 exact scope 조건에서만 제어합니다.</p></section>

  return (
    <ReferenceAnalysisWorkspace ariaLabel="실행 상태 작업 영역" context={context} inspector={inspector}><section className="space-y-4 p-3" aria-labelledby="runs-title">
      <div><h1 id="runs-title" className="text-2xl font-semibold">실행 상태</h1><p className="text-sm text-muted-foreground">HUMAN, ZAP, LLM의 lane 상태와 실행 결과를 각각 확인합니다.</p></div>
      {queryError && <Alert variant="destructive" aria-label={errorMessage(queryError.error)}><AlertTitle>{queryError.hasLastSuccess ? "마지막 성공 상태를 표시하고 있습니다." : "상태를 가져오지 못했습니다. 확인이 필요합니다."}</AlertTitle><AlertDescription>{errorMessage(queryError.error)}</AlertDescription></Alert>}
      {(start.isError || cancel.isError || followUp.isError) && <Alert variant="destructive" aria-label={errorMessage(start.error ?? cancel.error ?? followUp.error)}><AlertDescription>{errorMessage(start.error ?? cancel.error ?? followUp.error)}</AlertDescription></Alert>}

      <Tabs defaultValue="zap">
        <TabsList><TabsTrigger value="human">HUMAN</TabsTrigger><TabsTrigger value="zap">ZAP</TabsTrigger><TabsTrigger value="llm">LLM</TabsTrigger></TabsList>
        <TabsContent value="human"><Card><CardHeader><CardTitle>HUMAN · {humanCardStatus}</CardTitle></CardHeader><CardContent>{human.data?.active ? `run ${human.data.runId}` : human.data ? "브라우저 pass 상태를 점검 시작에서 제어합니다." : `HUMAN 상태 · ${humanSummary}`}</CardContent></Card></TabsContent>
        <TabsContent value="zap"><Card><CardHeader><CardTitle>ZAP · {scanner.data?.run.status ?? "UNAVAILABLE"}</CardTitle><CardDescription>{zap.data?.connected ? "연결됨" : zap.data?.state ?? "UNAVAILABLE"} · {zap.data?.message}</CardDescription></CardHeader><CardContent className="space-y-3"><p>현재 단계 {scanner.data?.run.stage ?? "대기"} · 수집 {scanner.data?.run.captured_records ?? "-"}건 · Alert {scanner.data?.run.alert_count ?? "-"}건</p><div className="grid gap-3 md:grid-cols-2">{scanner.data?.run.lanes?.map((lane, index) => <RunLaneCard key={`${lane.account_id ?? "anonymous"}-${index}`} lane={lane} />)}</div>{scanner.data?.run.warning && <Alert><AlertDescription>주의 · {scanner.data.run.warning}</AlertDescription></Alert>}{scanner.data?.run.error && <Alert variant="destructive"><AlertDescription>{scanner.data.run.error}</AlertDescription></Alert>}</CardContent></Card></TabsContent>
        <TabsContent value="llm"><Card><CardHeader><CardTitle>LLM · {run?.status ?? "UNAVAILABLE"}</CardTitle><CardDescription>{run?.provider ?? "공급자 없음"} · {run?.role ?? "실행 대기"}</CardDescription></CardHeader><CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3"><label className="grid gap-1 text-sm" htmlFor="llm-provider">공급자<Select value={provider} onValueChange={(value) => setProvider(value as "CODEX" | "CLAUDE")} disabled={running}><SelectTrigger id="llm-provider" aria-label="LLM 공급자"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CODEX">CODEX</SelectItem><SelectItem value="CLAUDE">CLAUDE</SelectItem></SelectContent></Select></label><label className="grid gap-1 text-sm" htmlFor="llm-target">대상<Select value={target} onValueChange={setTarget} disabled={running}><SelectTrigger id="llm-target" aria-label="LLM 대상"><SelectValue placeholder="scope를 먼저 적용하세요" /></SelectTrigger><SelectContent>{scope.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label><label className="grid gap-1 text-sm" htmlFor="llm-account">계정<Select value={account} onValueChange={setAccount} disabled={running}><SelectTrigger id="llm-account" aria-label="LLM 계정"><SelectValue placeholder="비로그인" /></SelectTrigger><SelectContent><SelectItem value="">비로그인</SelectItem>{activeAccounts.map((value) => <SelectItem key={value.id} value={value.id}>{value.label}</SelectItem>)}</SelectContent></Select></label></div>
          <p className="text-sm">{run?.providers?.CODEX ? "CODEX CLI 사용 가능" : "CODEX CLI 사용할 수 없음"} · {run?.providers?.CLAUDE ? "CLAUDE CLI 사용 가능" : "CLAUDE CLI 사용할 수 없음"}</p>
          <div className="flex flex-wrap gap-2" aria-label="완료 레인 상태">{llm.data?.completed_lanes.map((lane) => <span className="rounded-full border px-2 py-1 text-xs" key={lane}>완료 레인 · {completedLaneLabel(lane)} 완료</span>)}</div>
          {!providerAvailable && <Alert variant="destructive"><AlertDescription>{provider} CLI를 찾지 못했습니다. Burp 실행 PATH 또는 시스템 속성에서 경로를 지정하세요.</AlertDescription></Alert>}
          {!lanesReady && !running && <p className="text-sm text-muted-foreground">Judge 대기: HUMAN·SCANNER·LLM 완료 레인이 모두 필요합니다.</p>}
          {explorerDisabledReason && <p className="text-sm text-muted-foreground">{explorerDisabledReason}</p>}
          {!targetInScope && target && <p role="status" aria-label="LLM 대상 scope 상태" className="flex w-full max-w-full items-center gap-1 text-sm text-muted-foreground"><span className="shrink-0">현재 범위 아님 ·</span>{" "}<span className="min-w-0 truncate" title={target}>{target}</span></p>}
          <div className="flex flex-wrap gap-2"><Button disabled={running || !providerAvailable || !targetInScope || start.isPending} onClick={() => requestStart("EXPLORER")}>LLM Explorer 시작</Button><Button disabled={running || !providerAvailable || !targetInScope || !lanesReady || start.isPending} onClick={() => requestStart("JUDGE")}>Judge 시작</Button><Button variant="destructive" disabled={!running || cancel.isPending} onClick={() => cancel.mutate()}>LLM 실행 취소</Button></div>
          <p className="text-sm">실행 상태 · {run?.status ?? "UNAVAILABLE"}{run?.started_at ? ` · 시작 ${run.started_at}` : ""}</p>
          {run?.message && <p className="text-sm">{run.message}</p>}
          {run?.session_metadata_may_remain && <Alert><AlertDescription>Claude 비지속 옵션에도 공급자 메타데이터 파일이 남을 수 있으며 다음 실행에 재사용하지 않습니다.</AlertDescription></Alert>}
          {outputTail && <Accordion type="single" collapsible><AccordionItem value="output"><AccordionTrigger>출력 tail 보기 (최대 1500자)</AccordionTrigger><AccordionContent><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words">{outputTail}</pre></AccordionContent></AccordionItem></Accordion>}
          <div className="space-y-2"><label className="grid gap-1 text-sm" htmlFor="judge-followup">Judge 후속 질문<Input id="judge-followup" aria-label="Judge 후속 질문" value={message} onChange={(event) => setMessage(event.target.value)} disabled={!judgeEligible || followUp.isPending} /></label><Button disabled={!judgeEligible || !message.trim() || followUp.isPending} onClick={() => { const value = message.trim(); if (value) followUp.mutate(value, { onSuccess: () => setMessage("") }) }}>Judge 계속</Button>{!judgeEligible && <p className="text-sm text-muted-foreground">완료된 Judge session에서만 후속 질문을 보낼 수 있습니다.</p>}</div>
        </CardContent></Card></TabsContent>
      </Tabs>
      <Card><CardHeader><CardTitle>통제 요청 실행 품질</CardTitle><CardDescription>HTTP 응답이 없었던 실행과 실제 응답 Evidence를 구분합니다.</CardDescription></CardHeader><CardContent className="space-y-3">{snapshot.data?.runExecutions?.length ? snapshot.data.runExecutions.map((summary) => <div className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[auto_minmax(0,1fr)_auto]" key={`${summary.source}:${summary.runId}`}><Badge variant={summary.quality === "ALL_FAILED" ? "destructive" : "outline"}>{summary.quality}</Badge><div className="min-w-0"><p className="break-all font-mono">{summary.source} · {summary.runId}</p><p className="text-xs text-muted-foreground">시도 {summary.attempted} · 응답 {summary.responses} · 실패 {summary.failures}</p></div><div className="text-xs text-muted-foreground">{Object.entries(summary.outcomes).map(([name, count]) => `${name} ${count}`).join(" · ") || "결과 없음"}</div></div>) : <p className="text-sm text-muted-foreground">기록된 통제 요청 실행이 없습니다. 이는 요청 실패나 성공을 추정한 값이 아닙니다.</p>}</CardContent></Card>
    </section></ReferenceAnalysisWorkspace>
  )
}
