import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { useSnapshotQuery } from "@/lib/query/hooks"
import { dashboardCounts, dashboardSummary } from "./dashboardSelectors"
import { AuthorizationDecisionSummary, EMPTY_DASHBOARD_SUMMARY, SnapshotStrip, SourceObservationSummary, type DashboardSummaryValues } from "./DashboardSummaryBlocks"

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "데이터를 불러오지 못했습니다." }

/**
 * PR#11 대시보드: 서버 Gap 근거의 네 수치와 `Gap 그래프에서 확인` 진입만 제공한다. 퍼센트·추이·추천 문구는 만들지 않는다(D-002).
 * 프로젝트 생성·초기화·삭제는 상단 프로젝트 관리와 Burp 제어면에서 수행한다.
 */
export function DashboardPage({ summary }: { summary?: DashboardSummaryValues } = {}) {
  const snapshot = useSnapshotQuery()
  const data = snapshot.data
  // 실데이터 배선: 서버 snapshot에서 3블록 값을 계산한다. 테스트는 summary prop으로 오버라이드한다.
  const values = summary ?? (data ? dashboardSummary(data) : EMPTY_DASHBOARD_SUMMARY)
  return <ReferenceAnalysisWorkspace ariaLabel="대시보드 분석 영역" context={null} inspector={null}>
    <section className="min-w-0 space-y-8 p-4 sm:p-6" aria-labelledby="dashboard-title">
      <header><h1 id="dashboard-title" className="text-2xl font-semibold">보안 점검 대시보드</h1><p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">FlowScope는 HUMAN·SCANNER·LLM의 관측 범위를 비교해 수동 확인이 필요한 API·파라미터와 권한 변형의 점검 순서를 보여 줍니다.</p></header>
      <SnapshotStrip trafficStats={values.trafficStats} />
      <SourceObservationSummary sourceCounts={values.sourceCounts} />
      {!data && !snapshot.isError && <p role="status" aria-label="데이터를 불러오는 중">서버 점검 근거를 불러오는 중입니다.</p>}
      {snapshot.isError && <Alert variant="destructive" aria-label={errorMessage(snapshot.error)}><AlertTitle>{data ? "마지막 데이터를 표시하고 있습니다." : "데이터를 불러오지 못했습니다."}</AlertTitle><AlertDescription>{errorMessage(snapshot.error)}<span>마지막 갱신: {snapshot.dataUpdatedAt ? new Date(snapshot.dataUpdatedAt).toLocaleString("ko-KR") : "없음"}</span></AlertDescription><Button variant="outline" onClick={() => void snapshot.refetch()}>다시 시도</Button></Alert>}
      {data && <>
        {data.sampleMode && <Alert aria-label="샘플 데이터"><AlertTitle>샘플 데이터</AlertTitle><AlertDescription>HUMAN·SCANNER·LLM 표시는 실제 점검 결과가 아니며 네트워크 요청을 만들지 않습니다.</AlertDescription></Alert>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{dashboardCounts(data).map(({ label, value }) => <section role="group" aria-label={label} key={label} className="min-w-0 space-y-3 rounded-lg border border-border p-4"><h2 className="text-sm font-medium">{label}</h2><p className="font-mono text-3xl font-semibold tabular-nums">{value.toLocaleString("ko-KR")}</p></section>)}</div>
        <AuthorizationDecisionSummary authorizationSummary={values.authorizationSummary} />
        <section aria-label="다음 점검" className="space-y-4 border-l-2 border-emerald-400 pl-4"><h2 className="font-semibold">어디부터 확인할까요?</h2><p className="text-sm leading-6 text-muted-foreground">그래프에서 첫 Gap을 선택하면 놓친 입력과 권한 조건, 연결된 Evidence를 함께 확인할 수 있습니다.</p><Button disabled={snapshot.isError} onClick={() => { window.location.hash = "#graph" }}>Gap 그래프에서 확인</Button></section>
      </>}
      {!data && <AuthorizationDecisionSummary authorizationSummary={values.authorizationSummary} />}
    </section>
  </ReferenceAnalysisWorkspace>
}
