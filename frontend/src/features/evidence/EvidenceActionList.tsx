import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { getRequestLabDraft, openReplay } from "@/lib/api/endpoints"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { evidenceOrdinalLabel, stripOrigin } from "@/lib/display/operationLabel"
import { activeAccounts, RequestLabDialog } from "./RequestLabDialog"
import { SourceIcon } from "./SourceIcon"

interface Props {
  events: readonly EventRecord[]
  snapshot: Snapshot
  disabled?: boolean
}

/**
 * 선택 항목에 연결된 실제 Evidence 목록. 행마다 원문 보기(Request Lab)와 현재 세션 Repeater만 둔다.
 * 현재 세션은 관측 신원의 재사용 가능한 ACTIVE 세션이며, 원문은 요청 동안만 지역 변수로 다루고 캐시에 두지 않는다.
 */
export function EvidenceActionList({ events, snapshot, disabled = false }: Props) {
  const [labContext, setLabContext] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Readonly<Record<string, string>>>({})
  const datasetRevision = snapshot.datasetRevision ?? snapshot.identityRevision ?? 0
  // 데이터셋 교체나 Evidence 좌표 변경은 열린 초안을 닫는다(D-140). 사라졌다 돌아온 Evidence도 다시 열리지 않는다.
  const contextOf = (event: EventRecord) => JSON.stringify([datasetRevision, event.eventId, event.op, event.resource, event.idn, event.source, event.fp])
  const labEvent = events.find(event => contextOf(event) === labContext) ?? null
  useEffect(() => { if (labContext && !labEvent) setLabContext(null) }, [labContext, labEvent])
  const sorted = [...events].sort((left, right) => right.timestamp - left.timestamp)
  const note = (eventId: string, message: string) => setMessages(current => ({ ...current, [eventId]: message }))

  async function sendToRepeater(event: EventRecord) {
    if (disabled || pendingId) return
    setPendingId(event.eventId)
    note(event.eventId, "")
    try {
      const draft = await getRequestLabDraft(event.eventId)
      const account = activeAccounts(snapshot.managedSessions, draft.service).find(session => session.accountId === draft.reusableAccountId)
      if (!draft.rawRequestRetained || !draft.request) { note(event.eventId, "요청 원문이 보존되지 않아 보낼 수 없습니다."); return }
      if (!account) { note(event.eventId, "현재 세션이 없습니다. 원문 보기에서 계정을 고르세요."); return }
      const result = await openReplay({ eventId: event.eventId, request: draft.request, credentialMode: "ACCOUNT", accountId: account.accountId })
      note(event.eventId, result.openedDraft ? "Repeater에 열었습니다. 아직 보내지 않았습니다." : result.message)
    } catch (reason) {
      note(event.eventId, reason instanceof Error ? reason.message : "Repeater로 보내지 못했습니다.")
    } finally {
      setPendingId(null)
    }
  }

  if (!sorted.length) return <p className="text-sm text-muted-foreground">연결된 Evidence가 없습니다.</p>
  return <section aria-label="Evidence" className="grid gap-2">
    <h3 className="text-sm font-semibold">Evidence <span className="font-normal text-muted-foreground">{sorted.length}</span></h3>
    <ul className="grid gap-2">{sorted.map(event => <li key={event.eventId} aria-label={`Evidence ${evidenceOrdinalLabel(snapshot.evidenceOrdinals, event.eventId)}`} className="grid gap-2 rounded-md border border-border/70 p-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{evidenceOrdinalLabel(snapshot.evidenceOrdinals, event.eventId)}</span>
        <SourceIcon source={event.source} labelled />
        <span className="truncate font-medium">{event.idn}</span>
        <span className="ms-auto shrink-0 font-mono text-xs">{event.status}</span>
      </div>
      <p className="truncate font-mono text-xs" title={`${event.method} ${stripOrigin(event.path) || event.path}`}>{event.method} {stripOrigin(event.path) || event.path}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setLabContext(contextOf(event))}>원문 보기</Button>
        <Button type="button" size="sm" disabled={disabled || pendingId !== null} onClick={() => void sendToRepeater(event)}>{pendingId === event.eventId ? "여는 중…" : "현재 세션으로 Repeater"}</Button>
      </div>
      {messages[event.eventId] && <p role="status" className="text-xs text-muted-foreground">{messages[event.eventId]}</p>}
    </li>)}</ul>
    {labEvent && <RequestLabDialog key={labContext} open onOpenChange={open => { if (!open) setLabContext(null) }} event={labEvent} sessions={snapshot.managedSessions} datasetRevision={datasetRevision} snapshotRevision={snapshot.revision} suspended={disabled} />}
  </section>
}
