import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ScannerLane } from "@/lib/api/types"
import { cn } from "@/lib/utils"

function text(value: string | undefined, fallback: string): string { return value?.trim() || fallback }

/** 상태 배지 점 색. 실패·취소만 배지 전체를 빨갛게 해 여러 lane 중 문제 lane이 눈에 띄게 한다. */
export function laneStatusTone(status: string): { dot: string; badge: string } {
  switch (status.toUpperCase()) {
    case "FAILED":
    case "CANCELLED":
      return { dot: "bg-destructive", badge: "border-destructive/50 text-destructive" }
    case "COMPLETED":
      return { dot: "bg-emerald-600 dark:bg-emerald-400", badge: "" }
    case "RUNNING":
      return { dot: "bg-blue-600 dark:bg-blue-400", badge: "" }
    default:
      return { dot: "bg-muted-foreground", badge: "text-muted-foreground" }
  }
}

export function RunLaneCard({ lane }: { lane: ScannerLane }) {
  const status = text(lane.status, "NOT_STARTED")
  const tone = laneStatusTone(status)
  return (
    <Card>
      <CardHeader><CardTitle className="flex flex-wrap items-center gap-2">{text(lane.account_label, "비로그인")}<Badge variant="outline" className={cn("gap-1.5", tone.badge)}><span aria-hidden="true" className={cn("size-1.5 rounded-full", tone.dot)} />{status}</Badge></CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{text(lane.stage, "PENDING")}</p>
        <p>전체 {lane.captured_records} · Client {lane.client_captures} · Alert {lane.alert_count}</p>
        {lane.warning && <p className="text-amber-700 dark:text-amber-400">주의 · {lane.warning}</p>}
        {lane.error && <p className="text-destructive">오류 · {lane.error}</p>}
      </CardContent>
    </Card>
  )
}
