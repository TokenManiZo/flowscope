import { Play } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DashboardPage } from "@/features/dashboard/DashboardPage"
import { useSnapshotQuery } from "@/lib/query/hooks"

export interface HomeSnapshotState {
  observationEvidenceCount: number
  phase: "idle" | "running" | "complete"
}

export interface HomePageProps {
  snapshot?: HomeSnapshotState
}

/**
 * Home(랜딩): 관측 근거가 없는 빈 상태에서는 점검 시작 hero를, 근거가 생기면 상태 요약을 보여 준다.
 * 하단 본문은 대시보드와 같은 DashboardPage 컴포넌트를 그대로 재사용한다(모의 대시보드를 만들지 않는다).
 */
export function HomePage({ snapshot }: HomePageProps) {
  // 실데이터 배선: 서버 snapshot의 관측 근거(수집 수)로 빈 상태(hero)/상태 요약을 가른다.
  // 테스트는 snapshot prop으로 상태를 주입해 오버라이드한다.
  const query = useSnapshotQuery()
  const captured = query.data?.trafficStats.captured ?? 0
  const live: HomeSnapshotState = {
    observationEvidenceCount: captured,
    phase: captured > 0 ? "complete" : "idle",
  }
  const state = snapshot ?? live
  const isEmpty = state.observationEvidenceCount === 0

  return (
    // 대시보드 본문(DashboardPage)이 자기 여백을 갖는다. 시작 박스도 같은 여백 안에 둬야 좌우 가장자리가 맞는다.
    <div className="min-w-0">
      {isEmpty ? (
        <div className="px-4 pt-4 sm:px-6 sm:pt-6"><section
          aria-labelledby="home-hero-title"
          className="rounded-lg border border-border bg-card px-5 py-7 sm:px-8 sm:py-9"
        >
          <div className="max-w-2xl">
            <h1 id="home-hero-title" className="text-2xl font-semibold sm:text-3xl">
              점검을 시작하세요
            </h1>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              요청을 관측하고 계정별 권한 차이를 확인합니다.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button onClick={() => { window.location.hash = "#inspection" }}>
                <Play className="size-4" aria-hidden="true" />
                빠른 시작
              </Button>
            </div>
          </div>
        </section></div>
      ) : null}

      <DashboardPage />
    </div>
  )
}

export default HomePage
