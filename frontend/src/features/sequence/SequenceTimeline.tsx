import { identityLabel } from "@/lib/display/identityLabel"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { sourcePresentation } from "@/features/matrix/matrixProjection"
import type { SequenceGroup, SequenceLink } from "./sequenceProjection"

const OPERATION_LIMIT = 160
const VALUE_LIMIT = 180
const IDENTITY_LIMIT = 180

function boundedOperation(value: string, expanded: boolean) { return expanded || value.length <= OPERATION_LIMIT ? value : `${value.slice(0, OPERATION_LIMIT)}…` }

function TimelineRow({ entry, onSelect }: { entry: SequenceLink; onSelect(entry: SequenceLink): void }) {
  const [operationExpanded, setOperationExpanded] = useState(false)
  const [valueExpanded, setValueExpanded] = useState(false)
  const source = sourcePresentation(entry.link.source)
  const longOperation = entry.link.fromOp.length > OPERATION_LIMIT || entry.link.toOp.length > OPERATION_LIMIT
  const longValue = entry.link.values.length > VALUE_LIMIT
  const value = valueExpanded || !longValue ? entry.link.values : `${entry.link.values.slice(0, VALUE_LIMIT)}…`

  return <li className="relative border-l pl-5 before:absolute before:-left-1.5 before:top-5 before:size-3 before:rounded-full before:border before:bg-background">
    <article className="grid gap-3 rounded-md bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="outline" className={source.lineClass}>{source.short} · {source.label} · {source.line}</Badge>
        <Tooltip><TooltipTrigger asChild><button type="button" className="rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted" aria-label="흐름 링크 요청 기록 열기" onClick={() => onSelect(entry)}>연결 요청 기록 상세</button></TooltipTrigger><TooltipContent>생산·소비 요청 기록의 구조화된 선택을 엽니다.</TooltipContent></Tooltip>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
        <section className="min-w-0"><h3 className="text-xs font-medium text-muted-foreground">1. 생산</h3><p className="break-all font-medium">{boundedOperation(entry.link.fromOp, operationExpanded)}</p></section>
        <section className="min-w-0 rounded-md border bg-background p-2 sm:max-w-64"><h3 className="text-xs font-medium text-muted-foreground">2. 전달 값</h3><p className="break-all text-sm">{value}</p>{longValue && <button type="button" className="mt-1 text-xs underline" onClick={() => setValueExpanded((current) => !current)}>{valueExpanded ? "값 접기" : "값 더 보기"}</button>}</section>
        <section className="min-w-0"><h3 className="text-xs font-medium text-muted-foreground">3. 소비</h3><p className="break-all font-medium">{boundedOperation(entry.link.toOp, operationExpanded)}</p></section>
      </div>
      {longOperation && <button type="button" className="w-fit text-xs underline" onClick={() => setOperationExpanded((current) => !current)}>{operationExpanded ? "작업 접기" : "작업 더 보기"}</button>}
    </article>
  </li>
}

export function SequenceTimeline({ group, onSelect }: { group: SequenceGroup; onSelect(entry: SequenceLink): void }) {
  const [identityExpanded, setIdentityExpanded] = useState(false)
  const longIdentity = group.identity.length > IDENTITY_LIMIT
  const identity = identityExpanded || !longIdentity ? group.identity : `${group.identity.slice(0, IDENTITY_LIMIT)}…`
  return <Card><section aria-label="데이터 의존 타임라인"><CardHeader><CardTitle>관측 계정</CardTitle><p className="break-all text-sm font-medium">{identityLabel(identity)}</p>{longIdentity && <button type="button" className="w-fit text-xs underline" onClick={() => setIdentityExpanded((current) => !current)}>{identityExpanded ? "계정 접기" : "계정 더 보기"}</button>}<CardDescription>서버 flowLinks가 보고한 순서와 값 표시합니다.</CardDescription></CardHeader><CardContent><ol className="grid gap-3">{group.links.map((entry) => <TimelineRow entry={entry} key={entry.key} onSelect={onSelect} />)}</ol></CardContent></section></Card>
}
