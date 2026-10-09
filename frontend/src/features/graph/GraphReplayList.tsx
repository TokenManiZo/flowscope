import { useEffect, useState } from "react"
import { ArrowUpRight } from "lucide-react"

import { HelpHint } from "@/components/HelpHint"
import { RequestLabDialog } from "@/features/evidence/RequestLabDialog"
import type { ManualVerification, Snapshot } from "@/lib/api/types"
import { hasEvidenceOrdinal } from "@/lib/display/operationLabel"
import { graphAccountLabel } from "./graphAccounts"
import { StatusBadge } from "./httpBadges"

interface Props {
  snapshot: Snapshot
  items: readonly ManualVerification[]
  disabled?: boolean
  onOpenRequestLab?(): void
}

export function GraphReplayList({ snapshot, items, disabled = false, onOpenRequestLab }: Props) {
  const [labContext, setLabContext] = useState<string | null>(null)
  const datasetRevision = snapshot.datasetRevision ?? snapshot.identityRevision ?? 0
  const contextOf = (item: ManualVerification) => JSON.stringify([datasetRevision, item.eventId, item.operation, item.resource, item.identityId, item.timestamp])
  const selected = items.find(item => contextOf(item) === labContext)
  // 목록에서 빠진 재현도 자기 ID로 저장 원문을 연다. 원본 요청으로 대체하지 않는다.
  const event = selected ? snapshot.events.find(item => item.eventId === selected.eventId) ?? { eventId: selected.eventId } : null
  useEffect(() => { if (labContext && !selected) setLabContext(null) }, [labContext, selected])

  if (!items.length) return null
  return <section aria-label="Request Lab 재현" className="mb-4 border-b border-border/70 pb-4">
    <div className="mb-2 flex items-center gap-1">
      <h3 className="text-sm font-semibold">Request Lab 재현 <span className="font-normal text-muted-foreground">· {items.length}건</span></h3>
      <HelpHint label="Request Lab 재현">원본 요청에 연결된 응답입니다. 상태 코드만으로 취약점을 판정하지 않습니다.</HelpHint>
    </div>
    <ul className="grid gap-1.5">{items.map((item, index) => {
      const ordinal = hasEvidenceOrdinal(snapshot.evidenceOrdinals, item.eventId) ? `#${snapshot.evidenceOrdinals![item.eventId]}` : `재현 ${index + 1}`
      const identity = graphAccountLabel(snapshot, item.identityId || item.identity)
      return <li key={item.eventId}>
        <button type="button" aria-label={`${ordinal} Request Lab에서 열기`} title={`${ordinal} · ${identity} · HTTP ${item.status} — 저장된 요청과 응답 보기`} disabled={disabled}
          className="group flex w-full min-w-0 items-center gap-2.5 rounded-md border border-border/70 bg-background px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"
          onClick={() => { onOpenRequestLab?.(); setLabContext(contextOf(item)) }}>
          <span className="shrink-0 font-mono text-xs font-medium tabular-nums">{ordinal}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{identity}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">HTTP <StatusBadge code={item.status} /></span>
          <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
        </button>
      </li>
    })}</ul>
    {event && <RequestLabDialog key={labContext} open initialView="original" onOpenChange={open => { if (!open) setLabContext(null) }} event={event} accounts={snapshot.accounts} sessions={snapshot.managedSessions} verifications={snapshot.manualVerifications} datasetRevision={datasetRevision} snapshotRevision={snapshot.revision} suspended={disabled} />}
  </section>
}
