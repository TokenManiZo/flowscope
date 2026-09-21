import { useExplorerRunQuery, useHumanRunQuery, useScannerRunQuery, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RunLaneCard } from "./RunLaneCard"

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "요청을 완료하지 못했습니다." }
export function RunsPage() {
  const snapshot = useSnapshotQuery()
  const human = useHumanRunQuery()
  const zap = useZapStatusQuery()
  const scanner = useScannerRunQuery()
  const explorer = useExplorerRunQuery()
  const humanSummary = human.data ? human.data.active ? "진행 중" : human.data.completed ? "완료" : "대기" : human.isPending ? "불러오는 중" : "상태 확인 필요"
  const humanCardStatus = human.data ? human.data.active ? "RUNNING" : human.data.completed ? "COMPLETED" : "NOT_STARTED" : humanSummary
  const queryError = human.isError
    ? { error: human.error, hasLastSuccess: human.data !== undefined }
    : zap.isError
      ? { error: zap.error, hasLastSuccess: zap.data !== undefined }
      : scanner.isError
        ? { error: scanner.error, hasLastSuccess: scanner.data !== undefined }
        : explorer.isError
          ? { error: explorer.error, hasLastSuccess: explorer.data !== undefined }
        : undefined
  const context = <section className="grid gap-3 p-3"><div><h2 className="text-sm font-semibold">현재 실행 상태</h2><p className="text-xs text-muted-foreground">각 lane의 서버 상태를 그대로 표시합니다.</p></div><dl className="grid gap-2 text-sm"><div className="flex justify-between gap-2"><dt>HUMAN</dt><dd>{humanSummary}</dd></div><div className="flex justify-between gap-2"><dt>ZAP</dt><dd>{scanner.data?.run.status ?? zap.data?.state ?? "상태 없음"}</dd></div><div className="flex justify-between gap-2"><dt>LLM</dt><dd>{explorer.data?.run.status ?? "상태 없음"}</dd></div><div className="flex justify-between gap-2"><dt>scope</dt><dd className="font-mono">{scanner.data?.scope.length ?? 0}</dd></div></dl></section>
  const inspector = <section className="grid gap-3 p-3"><div><h2 className="text-sm font-semibold">실행 레인 안내</h2><p className="text-sm text-muted-foreground">선택한 실행 항목이 없습니다.</p></div><p className="text-xs text-muted-foreground">HUMAN 상태 · {humanSummary}</p><p className="text-xs text-muted-foreground">HUMAN·ZAP은 점검 시작, LLM은 Explorer 화면에서 제어합니다. Judge는 제공하지 않습니다.</p></section>

  return (
    <ReferenceAnalysisWorkspace ariaLabel="실행 상태 작업 영역" context={context} inspector={inspector}><section className="space-y-4 p-3" aria-labelledby="runs-title">
      <div><h1 id="runs-title" className="text-2xl font-semibold">실행 상태</h1><p className="text-sm text-muted-foreground">HUMAN·ZAP·LLM Explorer의 실행 상태와 저장된 요청 기록을 확인합니다.</p></div>
      {queryError && <Alert variant="destructive" aria-label={errorMessage(queryError.error)}><AlertTitle>{queryError.hasLastSuccess ? "마지막 성공 상태를 표시하고 있습니다." : "상태를 가져오지 못했습니다. 확인이 필요합니다."}</AlertTitle><AlertDescription>{errorMessage(queryError.error)}</AlertDescription></Alert>}

      <Tabs defaultValue="zap">
        <TabsList><TabsTrigger value="human">HUMAN</TabsTrigger><TabsTrigger value="zap">ZAP</TabsTrigger><TabsTrigger value="llm">LLM</TabsTrigger></TabsList>
        <TabsContent value="human"><Card><CardHeader><CardTitle>HUMAN · {humanCardStatus}</CardTitle></CardHeader><CardContent>{human.data?.active ? `run ${human.data.runId}` : human.data ? "브라우저 pass 상태를 점검 시작에서 제어합니다." : `HUMAN 상태 · ${humanSummary}`}</CardContent></Card></TabsContent>
        <TabsContent value="zap"><Card><CardHeader><CardTitle>ZAP · {scanner.data?.run.status ?? "UNAVAILABLE"}</CardTitle><CardDescription>{zap.data?.connected ? "연결됨" : zap.data?.state ?? "UNAVAILABLE"} · {zap.data?.message}</CardDescription></CardHeader><CardContent className="space-y-3"><p>현재 단계 {scanner.data?.run.stage ?? "대기"} · 수집 {scanner.data?.run.captured_records ?? "-"}건 · Alert {scanner.data?.run.alert_count ?? "-"}건</p><div className="grid gap-3 md:grid-cols-2">{scanner.data?.run.lanes?.map((lane, index) => <RunLaneCard key={`${lane.account_id ?? "anonymous"}-${index}`} lane={lane} />)}</div>{scanner.data?.run.warning && <Alert><AlertDescription>주의 · {scanner.data.run.warning}</AlertDescription></Alert>}{scanner.data?.run.error && <Alert variant="destructive"><AlertDescription>{scanner.data.run.error}</AlertDescription></Alert>}</CardContent></Card></TabsContent>
        <TabsContent value="llm"><Card><CardHeader><CardTitle>LLM Explorer · {explorer.data?.run.status ?? "UNAVAILABLE"}</CardTitle><CardDescription>{explorer.data?.run.message ?? "Explorer 상태를 확인하지 못했습니다."}</CardDescription></CardHeader><CardContent className="space-y-3"><p>시도 {explorer.data?.run.attempts ?? 0}건 · 응답 Evidence {explorer.data?.run.responses ?? 0}건 · 미해결 {explorer.data?.run.unresolved.length ?? 0}건</p><Button variant="outline" onClick={() => { window.location.hash = "#inspection" }}>LLM 단계 열기</Button></CardContent></Card></TabsContent>
      </Tabs>
      <Card><CardHeader><CardTitle>저장된 통제 요청 실행 기록</CardTitle><CardDescription>과거 실행 기록입니다. 현재 Explorer가 실행 중이라는 뜻이 아닙니다. HTTP 응답 전 실패와 응답 Evidence를 구분합니다.</CardDescription></CardHeader><CardContent className="space-y-3">{snapshot.data?.runExecutions?.length ? snapshot.data.runExecutions.map((summary) => <div className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[auto_minmax(0,1fr)_auto]" key={`${summary.source}:${summary.runId}`}><Badge variant={summary.quality === "ALL_FAILED" ? "destructive" : "outline"}>{summary.quality}</Badge><div className="min-w-0"><p className="break-all font-mono">{summary.source} · {summary.runId}</p><p className="text-xs text-muted-foreground">시도 {summary.attempted} · 응답 {summary.responses} · 실패 {summary.failures}</p></div><div className="text-xs text-muted-foreground">{Object.entries(summary.outcomes).map(([name, count]) => `${name} ${count}`).join(" · ") || "결과 없음"}</div></div>) : <p className="text-sm text-muted-foreground">기록된 통제 요청 실행이 없습니다. 이는 요청 실패나 성공을 추정한 값이 아닙니다.</p>}</CardContent></Card>
    </section></ReferenceAnalysisWorkspace>
  )
}
