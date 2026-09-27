import { RunStatusBadge } from "@/components/RunStatusBadge"
import type { ScannerLane } from "@/lib/api/types"
import { scannerStageLabel } from "@/lib/display/runStatus"

function text(value: string | undefined, fallback: string): string { return value?.trim() || fallback }

/** ZAP 계정별 lane 한 줄. 카드 안 카드를 만들지 않고 목록 행으로 둔다. */
export function RunLaneRow({ lane }: { lane: ScannerLane }) {
  return (
    <li className="grid gap-1 border-t border-border/70 py-2 text-sm first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{text(lane.account_label, "비로그인")}</span><RunStatusBadge status={text(lane.status, "NOT_STARTED")} /></div>
      <p className="text-xs text-muted-foreground">{scannerStageLabel(lane.stage)} · 전체 {lane.captured_records} · Client {lane.client_captures} · Alert {lane.alert_count}</p>
      {lane.warning && <p className="text-xs text-amber-700 dark:text-amber-400">주의 · {lane.warning}</p>}
      {lane.error && <p className="text-xs text-destructive">오류 · {lane.error}</p>}
    </li>
  )
}
