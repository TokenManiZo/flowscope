import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { useSnapshotQuery } from "@/lib/query/hooks"
import { dashboardCounts, dashboardSummary, openGapCount, priorityApiRows, recentEvents, sourceCoverageRows } from "./dashboardSelectors"
import { CandidateList, DashboardPipeline, EMPTY_DASHBOARD_SUMMARY, PriorityApiList, RecentEventList, SnapshotFootnote, SourceCoverageList, type DashboardSummaryValues, type PipelineCounts } from "./DashboardSummaryBlocks"

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "데이터를 불러오지 못했습니다." }

/**
 * 대시보드: 관측 → 비교 → 판정 한 판과 우선 점검 API·인가 후보 목록. 서버 수치만 옮기며 퍼센트·추이·추천 문구는 만들지 않는다(D-002).
 * 프로젝트 생성·초기화·삭제는 상단 프로젝트 관리와 Burp 제어면에서 수행한다. 샘플 여부는 상단 바가 표시한다.
 */
export function DashboardPage({ summary }: { summary?: DashboardSummaryValues } = {}) {
  const snapshot = useSnapshotQuery()
  const data = snapshot.data
  // 실데이터 배선: 서버 snapshot에서 값을 계산한다. 테스트는 summary prop으로 오버라이드한다.
  const values = summary ?? (data ? dashboardSummary(data) : EMPTY_DASHBOARD_SUMMARY)
  const [priorityApis, unobserved, authVariants, review] = data ? dashboardCounts(data).map(item => item.value) : [0, 0, 0, 0]
  const counts: PipelineCounts = { openGaps: data ? openGapCount(data) : 0, priorityApis, authVariants, unobserved, review }
  return <ReferenceAnalysisWorkspace ariaLabel="대시보드 분석 영역" context={null} inspector={null}>
    <section className="min-w-0 space-y-4 p-4 sm:p-6" aria-labelledby="dashboard-title">
      <header className="flex flex-wrap items-baseline justify-between gap-2"><h1 id="dashboard-title" className="text-2xl font-semibold">보안 점검 대시보드</h1><p className="text-sm text-muted-foreground">관측 근거 {values.trafficStats.captured.toLocaleString("ko-KR")}건 · <a href="#runs" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">실행 상태</a></p></header>
      {!data && !snapshot.isError && <p role="status" aria-label="데이터를 불러오는 중">서버 점검 근거를 불러오는 중입니다.</p>}
      {snapshot.isError && <Alert variant="destructive" aria-label={errorMessage(snapshot.error)}><AlertTitle>{data ? "마지막 데이터를 표시하고 있습니다." : "데이터를 불러오지 못했습니다."}</AlertTitle><AlertDescription>{errorMessage(snapshot.error)}<span>마지막 갱신: {snapshot.dataUpdatedAt ? new Date(snapshot.dataUpdatedAt).toLocaleString("ko-KR") : "없음"}</span></AlertDescription><Button variant="outline" onClick={() => void snapshot.refetch()}>다시 시도</Button></Alert>}
      <div className="space-y-1.5"><DashboardPipeline values={values} counts={counts} /><SnapshotFootnote trafficStats={values.trafficStats} /></div>
      {data && <div className="grid gap-4 lg:grid-cols-[3fr_2fr]"><PriorityApiList rows={priorityApiRows(data)} /><CandidateList scenarios={data.scenarios} /><SourceCoverageList rows={sourceCoverageRows(data)} /><RecentEventList events={recentEvents(data)} ordinals={data.evidenceOrdinals} /></div>}
    </section>
  </ReferenceAnalysisWorkspace>
}
