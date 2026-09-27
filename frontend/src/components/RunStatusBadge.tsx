import { Badge } from "@/components/ui/badge"
import { runStatusLabel, runStatusTone, type RunStatusTone } from "@/lib/display/runStatus"
import { cn } from "@/lib/utils"

const toneClass: Record<RunStatusTone, { dot: string; badge: string }> = {
  idle: { dot: "bg-muted-foreground", badge: "text-muted-foreground" },
  active: { dot: "bg-blue-600 dark:bg-blue-400", badge: "" },
  done: { dot: "bg-emerald-600 dark:bg-emerald-400", badge: "" },
  fail: { dot: "bg-destructive", badge: "border-destructive/50 text-destructive" },
}

/** 실행 상태 배지. 실패만 빨간 배지로 두고, 원래 서버 값은 title로 남긴다. */
export function RunStatusBadge({ status }: { status: string }) {
  const tone = toneClass[runStatusTone(status)]
  return <Badge variant="outline" title={status} className={cn("gap-1.5 font-medium", tone.badge)}><span aria-hidden="true" className={cn("size-1.5 rounded-full", tone.dot)} />{runStatusLabel(status)}</Badge>
}
