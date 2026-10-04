import { useState, type ReactNode } from "react"

import { useCollectionDiffQuery, useExplorerRunQuery, useHumanRunQuery, useScannerRunQuery, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { RunStatusBadge } from "@/components/RunStatusBadge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { CollectionRunReport, RunExecutionSummary } from "@/lib/api/types"
import { durationLabel, runStatusTone, scannerStageLabel } from "@/lib/display/runStatus"
import { RunLaneRow } from "./RunLaneRow"

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "요청을 완료하지 못했습니다." }

const qualityLabels: Record<RunExecutionSummary["quality"], string> = {
  NOT_ATTEMPTED: "시도 없음", ALL_FAILED: "전부 실패", PARTIAL_FAILURE: "일부 실패", RESPONSES_OBSERVED: "응답 있음",
}

function openInspection() { window.location.hash = "#inspection" }

function CollectionRunComparison({ runs, datasetRevision, unitVersion }: {
  runs: readonly CollectionRunReport[]; datasetRevision: number; unitVersion: number
}) {
  const [before, setBefore] = useState("")
  const [after, setAfter] = useState("")
  const diff = useCollectionDiffQuery(before, after, datasetRevision)
  const options = runs.map(run => <option key={run.runId} value={run.runId}>{run.runId}</option>)
  const changes = diff.data ? [
    ["추가 관측", diff.data.observedAdded], ["이전에만 관측", diff.data.observedRemoved],
    ["미관측 선언 추가", diff.data.declaredUnobservedAdded], ["이전에만 미관측 선언", diff.data.declaredUnobservedRemoved],
    ["메서드 미확정 경로 추가", diff.data.unknownMethodAdded], ["이전에만 메서드 미확정 경로", diff.data.unknownMethodRemoved],
  ] as const : []
  return <Card><CardHeader><CardTitle>LLM 수집 결과 비교</CardTitle><CardDescription>집계 단위: 서비스 × HTTP 메서드 × 정규화 경로 · v{unitVersion}. UNKNOWN은 메서드 미확정 경로로 따로 셉니다.</CardDescription></CardHeader>
    <CardContent className="grid gap-4 text-sm">
      <div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">run</th><th className="p-2">관측 API</th><th className="p-2">미관측 선언</th><th className="p-2">메서드 미확정 경로</th><th className="p-2">미결합 조각</th></tr></thead>
        <tbody>{runs.map(run => <tr className="border-t" key={run.runId}><td className="break-all p-2 font-mono">{run.runId}</td><td className="p-2 tabular-nums">{run.observedOperations}</td><td className="p-2 tabular-nums">{run.declaredUnobservedOperations}</td><td className="p-2 tabular-nums">{run.unknownMethodPaths}</td><td className="p-2 tabular-nums">{run.retainedHints}</td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap gap-3"><label className="grid min-w-0 gap-1 text-xs">비교 기준 LLM run<select aria-label="비교 기준 LLM run" className="max-w-full rounded-md border bg-background p-2" value={before} onChange={event => setBefore(event.target.value)}><option value="">기준 실행 선택</option>{options}</select></label>
        <label className="grid min-w-0 gap-1 text-xs">비교할 LLM run<select aria-label="비교할 LLM run" className="max-w-full rounded-md border bg-background p-2" value={after} onChange={event => setAfter(event.target.value)}><option value="">비교 실행 선택</option>{options}</select></label></div>
      {before && before === after && <p role="status" className="text-xs text-muted-foreground">서로 다른 두 실행을 선택하세요.</p>}
      {diff.isError && <Alert variant="destructive"><AlertTitle>수집 결과 비교를 불러오지 못했습니다.</AlertTitle><AlertDescription>{errorMessage(diff.error)}<Button type="button" variant="outline" size="sm" onClick={() => void diff.refetch()}>다시 시도</Button></AlertDescription></Alert>}
      {before && after && before !== after && diff.isPending && <p role="status">수집 결과 비교 중…</p>}
      {changes.map(([label, change]) => <details className="rounded-md border p-2 text-xs" key={label}><summary className="cursor-pointer font-medium">{label} {change.count}개</summary>
        <ul className="mt-2 grid gap-1">{change.items.map(item => <li className="break-all font-mono" key={`${item.service}:${"method" in item ? item.method : "UNKNOWN"}:${item.pathTemplate}`}>{"method" in item ? item.method : "UNKNOWN"} {item.service}{item.pathTemplate}</li>)}</ul>
        {change.truncated && <p className="mt-2 text-muted-foreground">전체 {change.count}개 중 앞 100개를 표시합니다.</p>}</details>)}
      <p className="text-xs text-muted-foreground">선언이 관측으로 바뀐 항목도 상태 변화에 포함됩니다. 수집 결과의 차이는 서비스 전체 완성률이나 취약점 수를 뜻하지 않습니다.</p>
    </CardContent></Card>
}

/** 소스 하나의 상태 카드: 제목 옆 상태 배지, 핵심 값 목록, 메시지, 제어 화면으로 가는 버튼. */
function SourceRunCard({ title, status, facts, children, message, failed, action }: { title: string; status: string; facts: readonly [string, ReactNode][]; children?: ReactNode; message?: string; failed?: boolean; action: ReactNode }) {
  return <Card className="gap-3">
    <CardHeader><CardTitle className="flex flex-wrap items-center gap-2 text-base">{title}<RunStatusBadge status={status} /></CardTitle></CardHeader>
    <CardContent className="flex flex-1 flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1">{facts.map(([name, value]) => <div className="contents" key={name}><dt className="text-muted-foreground">{name}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}</dl>
      {children}
      {message && <p className={failed ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{message}</p>}
      <div className="mt-auto pt-1">{action}</div>
    </CardContent>
  </Card>
}

export function RunsPage() {
  const snapshot = useSnapshotQuery()
  const human = useHumanRunQuery()
  const zap = useZapStatusQuery()
  const scanner = useScannerRunQuery()
  const explorer = useExplorerRunQuery()
  const queryError = human.isError
    ? { error: human.error, hasLastSuccess: human.data !== undefined }
    : zap.isError
      ? { error: zap.error, hasLastSuccess: zap.data !== undefined }
      : scanner.isError
        ? { error: scanner.error, hasLastSuccess: scanner.data !== undefined }
        : explorer.isError
          ? { error: explorer.error, hasLastSuccess: explorer.data !== undefined }
        : undefined
  const loading = (pending: boolean, fallback: string) => pending ? "불러오는 중" : fallback

  const humanStatus = human.data ? human.data.active ? "RUNNING" : human.data.completed ? "COMPLETED" : "NOT_STARTED" : loading(human.isPending, "UNAVAILABLE")
  const run = scanner.data?.run
  const scannerStatus = run?.status ?? loading(scanner.isPending, "UNAVAILABLE")
  const zapConnection = zap.data ? zap.data.connected ? "CONNECTED" : zap.data.state || "UNAVAILABLE" : loading(zap.isPending, "UNAVAILABLE")
  const stageElapsed = runStatusTone(scannerStatus) === "active" && run?.stage_elapsed_seconds !== undefined ? ` · ${durationLabel(run.stage_elapsed_seconds)}` : ""
  const llm = explorer.data?.run
  const llmStatus = llm?.status ?? loading(explorer.isPending, "UNAVAILABLE")

  return (
    <ReferenceAnalysisWorkspace ariaLabel="실행 상태 작업 영역" context={null} inspector={null}><section className="space-y-4 p-4" aria-labelledby="runs-title">
      <div><h1 id="runs-title" className="text-2xl font-semibold">실행 상태</h1><p className="text-sm text-muted-foreground">HUMAN·ZAP·LLM Explorer의 실행 상태와 저장된 요청 기록을 확인합니다.</p></div>
      {queryError && <Alert variant="destructive" aria-label={errorMessage(queryError.error)}><AlertTitle>{queryError.hasLastSuccess ? "마지막 성공 상태를 표시하고 있습니다." : "상태를 가져오지 못했습니다. 확인이 필요합니다."}</AlertTitle><AlertDescription>{errorMessage(queryError.error)}</AlertDescription></Alert>}

      <div className="grid gap-4 lg:grid-cols-3">
        <SourceRunCard title="HUMAN" status={humanStatus}
          facts={[["계정", human.data?.active ? human.data.accountId || "비로그인" : "—"], ["run", human.data?.runId ? <span className="font-mono text-xs">{human.data.runId}</span> : "—"], ["Proxy", human.data?.proxy ? <span className="font-mono text-xs">{human.data.proxy}</span> : "—"]]}
          action={<Button variant="outline" size="sm" onClick={openInspection}>점검 시작에서 제어</Button>} />
        <SourceRunCard title="ZAP" status={scannerStatus}
          facts={[["연결", <RunStatusBadge key="zap" status={zapConnection} />], ["단계", `${scannerStageLabel(run?.stage)}${stageElapsed}`], ["수집", run?.captured_records === undefined ? "아직 없음" : `${run.captured_records}건 · Alert ${run.alert_count ?? 0}건`]]}
          message={run?.error || run?.warning || zap.data?.message} failed={Boolean(run?.error)}
          action={<Button variant="outline" size="sm" onClick={openInspection}>점검 시작에서 제어</Button>}>
          {run?.lanes?.length ? <ul aria-label="ZAP 계정별 실행">{run.lanes.map((lane, index) => <RunLaneRow key={`${lane.account_id ?? "anonymous"}-${index}`} lane={lane} />)}</ul> : null}
        </SourceRunCard>
        <SourceRunCard title="LLM Explorer" status={llmStatus}
          facts={[["시도", `${llm?.attempts ?? 0}건`], ["응답", `${llm?.responses ?? 0}건`], ["미해결", `${llm?.unresolved.length ?? 0}건`]]}
          message={llm?.message ?? (explorer.isPending ? undefined : "Explorer 상태를 확인하지 못했습니다.")} failed={runStatusTone(llmStatus) === "fail"}
          action={<Button variant="outline" size="sm" onClick={openInspection}>LLM 단계 열기</Button>} />
      </div>

      <Card><CardHeader><CardTitle>저장된 통제 요청 실행 기록</CardTitle><CardDescription>지난 실행 기록입니다. 응답 전 실패와 응답 관측 기록을 나눠 셉니다.</CardDescription></CardHeader><CardContent className="space-y-3">{snapshot.data?.runExecutions?.length ? snapshot.data.runExecutions.map((summary) => <div className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[auto_minmax(0,1fr)_auto]" key={`${summary.source}:${summary.runId}`}><Badge variant={summary.quality === "ALL_FAILED" ? "destructive" : "outline"} title={summary.quality}>{qualityLabels[summary.quality] ?? summary.quality}</Badge><div className="min-w-0"><p className="break-all font-mono">{summary.source} · {summary.runId}</p><p className="text-xs text-muted-foreground">시도 {summary.attempted} · 응답 {summary.responses} · 실패 {summary.failures}</p></div><div className="text-xs text-muted-foreground">{Object.entries(summary.outcomes).map(([name, count]) => `${name} ${count}`).join(" · ") || "결과 없음"}</div></div>) : <p className="text-sm text-muted-foreground">기록된 실행이 없습니다.</p>}</CardContent></Card>
      {snapshot.data?.collectionProgress?.runs.length ? <CollectionRunComparison key={snapshot.data.datasetRevision ?? 0}
        runs={snapshot.data.collectionProgress.runs} datasetRevision={snapshot.data.datasetRevision ?? 0}
        unitVersion={snapshot.data.collectionProgress.unitVersion} /> : null}
    </section></ReferenceAnalysisWorkspace>
  )
}
