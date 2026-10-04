import { Button } from "@/components/ui/button"
import type { Snapshot } from "@/lib/api/types"

/**
 * D-155: when authenticated API traffic was observed but no HUMAN pass was active, the analysis
 * screens are empty by design (D-071 keeps run-less traffic out of coverage). Rather than showing an
 * unexplained blank, tell the operator exactly how much attributable API traffic is waiting and how to
 * include it. Reads the count the server already derives; it never turns that traffic into coverage.
 */
export function runGapCount(snapshot: Snapshot | undefined): number {
  return snapshot?.trafficStats?.humanApiOutsideRun ?? 0
}

export function RunGapHint({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <div role="status" aria-label="run 밖 API 트래픽 안내" className="max-w-xl space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <p className="text-sm leading-6">
        인증된 API 요청 {count}건이 HUMAN 탐색 밖에서 관측돼 비교에서 제외됐습니다. 점검에서 HUMAN 탐색을
        시작한 뒤 같은 화면을 다시 열면 이 요청들이 신원별 비교에 포함됩니다.
      </p>
      <Button onClick={() => { window.location.hash = "#inspection" }}>점검에서 HUMAN 탐색 시작</Button>
    </div>
  )
}
