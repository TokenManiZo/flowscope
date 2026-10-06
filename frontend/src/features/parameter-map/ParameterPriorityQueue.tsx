import { identityLabel } from "@/lib/display/identityLabel"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { SurfaceParameterGap } from "@/lib/api/types"
import { stripOrigin } from "@/lib/display/operationLabel"
import { locationLabel } from "./parameterNodeCard"

interface ParameterPriorityQueueProps {
  gaps: readonly SurfaceParameterGap[]
  selectedGapId: string | null
  onSelect: (gapId: string) => void
}

/** Method 칩: 상단 필터 칩과 같은 파랑 계열 토큰. 위험도를 뜻하는 빨강은 쓰지 않는다. */
const methodChipClass = "inline-flex items-center rounded-md border border-observation-human/40 bg-observation-human/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-observation-human"

export function ParameterPriorityQueue({ gaps, selectedGapId, onSelect }: ParameterPriorityQueueProps) {
  const [expanded, setExpanded] = useState(false)
  const visibleGaps = gaps.slice(0, expanded ? gaps.length : 3)

  return <>
    <ol aria-label="점검 우선순위 큐" className="space-y-1">{visibleGaps.map(gap => <li key={gap.id}>
      <Button variant="ghost" data-gap-id={gap.id} aria-pressed={selectedGapId === gap.id} className={`h-auto w-full justify-start whitespace-normal border px-3 py-3 text-left text-sm ${selectedGapId === gap.id ? "border-border bg-muted" : "border-transparent"}`} onClick={() => onSelect(gap.id)}>
        <span className="min-w-0 [overflow-wrap:anywhere]"><span className="flex flex-wrap items-center gap-1.5"><span className={methodChipClass}>{gap.endpoint.method}</span>{" "}<span className="font-semibold">{stripOrigin(gap.endpoint.pathTemplate) || gap.endpoint.pathTemplate}</span></span><span className="mt-1 block font-mono text-xs">{locationLabel(gap.location)} {stripOrigin(gap.canonicalPath) || gap.canonicalPath}</span><span className="mt-1 block text-muted-foreground">{gap.source ?? "UNKNOWN"} · {identityLabel(gap.identity ?? "UNKNOWN")}</span></span>
      </Button>
    </li>)}</ol>
    {gaps.length > 3 && <Button variant="outline" className="mt-3 w-full" onClick={() => setExpanded(current => !current)}>{expanded ? "상위 3개만 보기" : `전체 ${gaps.length}개 보기`}</Button>}
  </>
}
