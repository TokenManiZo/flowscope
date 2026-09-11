import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { SurfaceParameterGap } from "@/lib/api/types"
import { locationLabel } from "./parameterNodeCard"

interface ParameterPriorityQueueProps {
  gaps: readonly SurfaceParameterGap[]
  selectedGapId: string | null
  onSelect: (gapId: string) => void
}

export function ParameterPriorityQueue({ gaps, selectedGapId, onSelect }: ParameterPriorityQueueProps) {
  const [expanded, setExpanded] = useState(false)
  const visibleGaps = gaps.slice(0, expanded ? gaps.length : 3)

  return <>
    <ol aria-label="점검 우선순위 큐" className="space-y-1">{visibleGaps.map(gap => <li key={gap.id}>
      <Button variant="ghost" data-gap-id={gap.id} aria-pressed={selectedGapId === gap.id} className={`h-auto w-full justify-start whitespace-normal border-l-2 px-3 py-3 text-left text-sm ${selectedGapId === gap.id ? "border-emerald-400 bg-emerald-400/10" : "border-transparent"}`} onClick={() => onSelect(gap.id)}>
        <span className="min-w-0 [overflow-wrap:anywhere]"><span className="block font-semibold">{gap.endpoint.method} {gap.endpoint.pathTemplate}</span><span className="block font-mono text-xs">{locationLabel(gap.location)} {gap.canonicalPath}</span><span className="mt-1 block text-muted-foreground">{gap.source ?? "UNKNOWN"} · {gap.identity ?? "UNKNOWN"}</span><span className="mt-1 block">{gap.summary}</span></span>
      </Button>
    </li>)}</ol>
    {gaps.length > 3 && <Button variant="outline" className="mt-3 w-full" onClick={() => setExpanded(current => !current)}>{expanded ? "상위 3개만 보기" : `전체 ${gaps.length}개 보기`}</Button>}
  </>
}
