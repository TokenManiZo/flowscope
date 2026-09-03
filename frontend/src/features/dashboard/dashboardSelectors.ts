import type { Snapshot, Source } from "@/lib/api/types"

export const sourceStates: readonly { source: Source; label: string; short: string }[] = [
  { source: "human", label: "HUMAN", short: "H" },
  { source: "scanner", label: "ZAP", short: "S" },
]

export function dashboardCounts(snapshot: Snapshot) {
  const stats = snapshot.trafficStats
  return [
    { label: "수집", value: stats.captured },
    { label: "분석 대상", value: stats.coverage },
    { label: "검토 대기", value: stats.review },
    { label: "제외", value: stats.excluded },
    { label: "삭제됨", value: stats.dropped },
    { label: "Payload 메타데이터만", value: stats.payloadMetadataOnly },
  ] as const
}

export function hasDashboardData(snapshot: Snapshot): boolean {
  return snapshot.trafficStats.captured > 0 || snapshot.events.length > 0
}

export function nextRecommendation(snapshot: Snapshot): { label: string; route: "inspection" | "evidence" } {
  if (snapshot.gaps.length > 0) return { label: "갭을 검토하세요", route: "evidence" }
  if (!snapshot.activeSources.includes("human")) return { label: "HUMAN 탐색을 시작하세요", route: "inspection" }
  if (!snapshot.activeSources.includes("scanner")) return { label: "ZAP 점검을 준비하세요", route: "inspection" }
  return { label: "Evidence를 검토하세요", route: "evidence" }
}
