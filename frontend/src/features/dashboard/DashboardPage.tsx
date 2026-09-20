import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { NewProjectDialog } from "@/components/layout/NewProjectDialog"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { useLoadSampleMutation, useScannerRunQuery, useSnapshotQuery } from "@/lib/query/hooks"
import { dashboardCounts, hasDashboardData } from "./dashboardSelectors"
import { AuthorizationDecisionSummary, EMPTY_DASHBOARD_SUMMARY, SnapshotStrip, SourceObservationSummary, type DashboardSummaryValues } from "./DashboardSummaryBlocks"

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "데이터를 불러오지 못했습니다." }

/**
 * PR#11 대시보드: 서버 Gap 근거의 네 수치와 `Gap 그래프에서 확인` 진입만 제공한다. 퍼센트·추이·추천 문구는 만들지 않는다(D-002).
 * 삭제형 초기화 대신 보존형 새 진단(D-140)을 그대로 둔다.
 */
export function DashboardPage({ summary = EMPTY_DASHBOARD_SUMMARY }: { summary?: DashboardSummaryValues } = {}) {
  const snapshot = useSnapshotQuery()
  const scanner = useScannerRunQuery()
  const sample = useLoadSampleMutation()
  const data = snapshot.data
  return <ReferenceAnalysisWorkspace ariaLabel="대시보드 분석 영역" context={null} inspector={null}>
    <section className="min-w-0 space-y-6 p-4 sm:p-6" aria-labelledby="dashboard-title">
      <header className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-3"><h1 id="dashboard-title" className="text-2xl font-semibold">보안 점검 대시보드</h1><p className="max-w-3xl text-base leading-7 text-muted-foreground">FlowScope는 HUMAN·SCANNER·LLM의 관측 범위를 비교해 수동 확인이 필요한 API·파라미터와 권한 변형의 점검 순서를 보여 줍니다.</p></div><NewProjectDialog defaultScope={scanner.data?.scope.join("\n") ?? ""} /></header>
      <SnapshotStrip trafficStats={summary.trafficStats} />
      <SourceObservationSummary sourceCounts={summary.sourceCounts} />
      {!data && !snapshot.isError && <p role="status" aria-label="데이터를 불러오는 중">서버 점검 근거를 불러오는 중입니다.</p>}
      {snapshot.isError && <Alert variant="destructive" aria-label={errorMessage(snapshot.error)}><AlertTitle>{data ? "마지막 데이터를 표시하고 있습니다." : "데이터를 불러오지 못했습니다."}</AlertTitle><AlertDescription>{errorMessage(snapshot.error)}<span>마지막 갱신: {snapshot.dataUpdatedAt ? new Date(snapshot.dataUpdatedAt).toLocaleString("ko-KR") : "없음"}</span></AlertDescription><Button variant="outline" onClick={() => void snapshot.refetch()}>다시 시도</Button></Alert>}
      {data && <>
        {data.sampleMode && <Alert aria-label="샘플 데이터"><AlertTitle>샘플 데이터</AlertTitle><AlertDescription>HUMAN·SCANNER·LLM 표시는 실제 점검 결과가 아니며 네트워크 요청을 만들지 않습니다.</AlertDescription></Alert>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{dashboardCounts(data).map(({ label, value }) => <section role="group" aria-label={label} key={label} className="min-w-0 space-y-3 rounded-lg border border-border p-4"><h2 className="text-sm font-medium">{label}</h2><p className="font-mono text-3xl font-semibold tabular-nums">{value.toLocaleString("ko-KR")}</p></section>)}</div>
        <AuthorizationDecisionSummary authorizationSummary={summary.authorizationSummary} />
        <section aria-label="다음 점검" className="space-y-4 border-l-2 border-emerald-400 pl-4"><h2 className="font-semibold">어디부터 확인할까요?</h2><p className="text-sm leading-6 text-muted-foreground">그래프에서 첫 Gap을 선택하면 놓친 입력과 권한 조건, 연결된 Evidence를 함께 확인할 수 있습니다.</p><Button disabled={snapshot.isError} onClick={() => { window.location.hash = "#graph" }}>Gap 그래프에서 확인</Button></section>
        {!hasDashboardData(data) && <section aria-label="첫 사용 안내" className="space-y-3 border-t border-border pt-5"><h2 className="font-semibold">첫 점검을 시작하세요</h2><p className="text-sm text-muted-foreground">관측 근거가 아직 없습니다. 범위를 확인하거나 샘플로 화면을 익혀 보세요.</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={snapshot.isError} onClick={() => { window.location.hash = "#inspection" }}>빠른 시작</Button><Button variant="outline" disabled={sample.isPending || snapshot.isError} onClick={() => sample.mutate()}>샘플로 화면 익히기</Button></div></section>}
      </>}
      {!data && <AuthorizationDecisionSummary authorizationSummary={summary.authorizationSummary} />}
      {sample.isError && <Alert variant="destructive" aria-label={errorMessage(sample.error)}><AlertDescription>{errorMessage(sample.error)}</AlertDescription></Alert>}
    </section>
  </ReferenceAnalysisWorkspace>
}
