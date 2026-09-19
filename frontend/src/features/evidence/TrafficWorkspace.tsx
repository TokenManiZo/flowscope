import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getEvidenceById, getManualAttempts } from "@/lib/api/endpoints"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { AccessRulesEditor, type PolicyTarget } from "./AccessRulesEditor"
import { RequestLabDialog } from "./RequestLabDialog"

interface Props {
  snapshot: Snapshot
  evidenceIds: readonly string[]
  initialEvent?: EventRecord | null
  target: PolicyTarget
  disabled?: boolean
  trafficOnly?: boolean
  purpose?: string
  policyFollowsEvidence?: boolean
}

/** Analysis coordinates and the selected stored exchange are separate; missing IDs never fall back to another request. */
export function TrafficWorkspace(props: Props) {
  const key = JSON.stringify([props.snapshot.datasetRevision ?? 0, props.target.operation, props.target.resource, props.initialEvent?.eventId])
  return <Workspace key={key} {...props} />
}

function Workspace({ snapshot, evidenceIds, initialEvent, target, disabled = false, trafficOnly = false, purpose, policyFollowsEvidence = false }: Props) {
  const [selectedId, setSelectedId] = useState(initialEvent?.eventId ?? evidenceIds[0] ?? "")
  const [labOpen, setLabOpen] = useState(false)
  const [evidenceLimit, setEvidenceLimit] = useState(50)
  const eventById = useMemo(() => new Map(snapshot.events.map(event => [event.eventId, event])), [snapshot.events])
  const ids = [...new Set(evidenceIds)]
  const selectedResult = (snapshot.manualVerifications ?? []).find(result => result.eventId === selectedId && ids.includes(result.originEvidenceId))
  const visibleIds = ids.slice(0, evidenceLimit)
  const selectableIds = (selectedResult || ids.includes(selectedId)) && !visibleIds.includes(selectedId) ? [...visibleIds, selectedId] : visibleIds
  const event = selectableIds.includes(selectedId) ? eventById.get(selectedId) ?? null : null
  const context = event ? JSON.stringify([snapshot.datasetRevision, event.eventId, event.op, event.resource, event.idn, event.source, event.fp]) : ""
  const [labContext, setLabContext] = useState("")
  const evidence = useQuery({ queryKey: ["selected-evidence", snapshot.datasetRevision, selectedId], queryFn: ({ signal }) => getEvidenceById(selectedId, signal), enabled: !!selectedId && !disabled, gcTime: 0, retry: false })
  const attempts = useQuery({ queryKey: ["manual-attempts", snapshot.datasetRevision, snapshot.revision], queryFn: ({ signal }) => getManualAttempts(signal), enabled: !disabled, gcTime: 0, retry: false })
  const record = evidence.data?.records?.find(item => item.eventId === selectedId)
  const results = (snapshot.manualVerifications ?? []).filter(item => ids.includes(item.originEvidenceId))
  const failures = (Array.isArray(attempts.data) ? attempts.data : []).filter(item => ids.includes(item.originEvidenceId) && item.outcome !== "HTTP_RESPONSE")
  const traffic = <div className="grid min-w-0 gap-3">
    {purpose && <p className="rounded border p-2 text-xs">{purpose}</p>}
    <p className="text-xs">{ids.length}개 Evidence</p>
    {ids.length > evidenceLimit && <Button variant="outline" disabled={disabled} onClick={() => setEvidenceLimit(limit => limit + 50)}>요청 선택 목록 50개 더 보기</Button>}
    {ids.length > 0 ? <label className="grid gap-1 text-sm">확인할 요청<select className="min-w-0 max-w-full rounded border border-input bg-background p-2" aria-label="확인할 요청" value={selectedId} disabled={disabled} onChange={change => { setSelectedId(change.target.value); setLabOpen(false) }}>{selectableIds.map((id, index) => { const item = eventById.get(id); return <option key={id} value={id}>{index + 1}. {item ? `${item.idn} · HTTP ${item.status} · ` : ""}{id.length > 160 ? `${id.slice(0, 160)}…` : id}</option> })}</select></label> : <p>연결된 실행 Evidence가 없습니다. 정의·추천 근거를 실제 요청으로 취급하지 않습니다.</p>}
    {event && <><p className="break-all font-mono text-xs">{event.method} {event.path} · HTTP {event.status}</p><p className="text-xs">선택 요청 신원: {event.idn} / {event.role} · {event.source} / {event.phase}</p><Button disabled={disabled} onClick={() => { setLabContext(context); setLabOpen(true) }}>요청 수정·전송 (Request Lab)</Button></>}
    {selectedId && !event && <p>이 ID의 실행 문맥을 현재 snapshot에서 확인할 수 없어 전송을 제공하지 않습니다.</p>}
    {evidence.isPending && selectedId && <p>트래픽 불러오는 중…</p>}
    {evidence.isError && <p role="alert">선택 Evidence를 불러오지 못했습니다. <Button variant="outline" onClick={() => void evidence.refetch()}>다시 시도</Button></p>}
    {record && <section aria-label="마스킹 트래픽" className="grid min-w-0 gap-3">{[["Request", record.request || record.requestBody], ["Response", record.response || record.responseBody]].map(([label, text]) => <div key={label} className="min-w-0"><h3 className="text-sm font-medium">{label} · 마스킹</h3><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs">{text || "전문 미보존"}</pre></div>)}</section>}
    <p className="text-xs text-muted-foreground">저장된 마스킹 트래픽입니다. 원문 편집은 Request Lab에서만 현재 프로세스 메모리로 처리합니다. Repeater 열기는 전송이 아닙니다.</p>
    <section aria-label="수동 검증 이력" className="grid gap-2 border-t pt-3"><h3 className="text-sm font-semibold">수동 검증 이력 · {results.length}건</h3><p className="text-xs">원본에 연결한 요청 결과입니다. 탐색 그래프·커버리지에 합산하지 않으며 HTTP 상태만으로 취약점을 확정하지 않습니다.</p>{results.map(result => <div key={result.eventId} className="rounded border p-2 text-xs"><p className="break-all">{result.identity} · HTTP {result.status} · {result.durationMs}ms</p><p className="break-all">{result.originEvidenceId} → {result.eventId}</p><button className="underline" disabled={disabled} onClick={() => { setSelectedId(result.eventId); setLabOpen(false) }}>검증 응답 보기</button></div>)}{failures.map(result => <p key={result.sequence} className="text-xs">{result.outcome} · {result.durationMillis}ms · 응답 Evidence 없음. 대상 처리 여부를 확인한 뒤 재전송하세요.</p>)}{attempts.isError && <p className="text-xs">전송 실패 이력을 불러오지 못했습니다.</p>}</section>
    {event && <RequestLabDialog key={context} open={labOpen && labContext === context} onOpenChange={setLabOpen} event={event} sessions={snapshot.managedSessions} datasetRevision={snapshot.datasetRevision} snapshotRevision={snapshot.revision} suspended={disabled} />}
  </div>
  return trafficOnly ? traffic : <Tabs defaultValue="traffic"><TabsList className="grid w-full grid-cols-2" aria-label="선택 작업 상세 탭"><TabsTrigger value="traffic">트래픽</TabsTrigger><TabsTrigger value="rules">접근 규칙</TabsTrigger></TabsList><TabsContent value="traffic">{traffic}</TabsContent><TabsContent value="rules"><AccessRulesEditor target={policyFollowsEvidence ? { operation: event?.op ?? null, resource: event?.resource ?? null } : target} snapshot={snapshot} disabled={disabled} /></TabsContent></Tabs>
}
