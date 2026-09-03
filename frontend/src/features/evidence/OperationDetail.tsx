import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { openReplay } from "@/lib/api/endpoints"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { queryKeys, useOwnerMutation, useRequirementMutation, useTrafficOverrideMutation } from "@/lib/query/hooks"
import { boundedText } from "./evidenceSelectors"

interface Props {
  event: EventRecord
  snapshot: Snapshot
  onOpenRequestLab(): void
  showEvidenceId?: boolean
}

export function OperationDetail({ event, snapshot, onOpenRequestLab, showEvidenceId = true }: Props) {
  const queryClient = useQueryClient()
  const requirement = useRequirementMutation()
  const traffic = useTrafficOverrideMutation()
  const owner = useOwnerMutation()
  const [role, setRole] = useState(snapshot.requiredRoles[event.op] ?? "")
  const [override, setOverride] = useState<"AUTO" | "INCLUDE" | "EXCLUDE">("AUTO")
  const [identity, setIdentity] = useState(event.resource ? snapshot.owners[event.resource] ?? event.idn : "")
  const [error, setError] = useState("")
  const [replayMessage, setReplayMessage] = useState("")
  const [replayPending, setReplayPending] = useState(false)

  async function refreshSelection() { await queryClient.invalidateQueries({ queryKey: queryKeys.snapshot }) }
  async function submitRequirement() { setError(""); try { await requirement.mutateAsync({ operation: event.op, role }); await refreshSelection() } catch (reason) { setError(reason instanceof Error ? reason.message : "필수 역할 저장에 실패했습니다.") } }
  async function submitTraffic() { setError(""); try { await traffic.mutateAsync({ operation: event.op, value: override }); await refreshSelection() } catch (reason) { setError(reason instanceof Error ? reason.message : "트래픽 정책 저장에 실패했습니다.") } }
  async function submitOwner() { if (!event.resource) return; setError(""); try { await owner.mutateAsync({ resource: event.resource, identity }); await refreshSelection() } catch (reason) { setError(reason instanceof Error ? reason.message : "소유자 저장에 실패했습니다.") } }
  async function replay() { if (replayPending) return; setReplayPending(true); setError(""); setReplayMessage(""); try { const result = await openReplay(event.eventId); setReplayMessage(result.openedDraft ? "Burp Repeater에 전송되지 않은 초안을 열었습니다. 아직 요청은 전송되지 않았습니다." : result.message) } catch (reason) { setError(reason instanceof Error ? reason.message : "Repeater 초안을 열지 못했습니다.") } finally { setReplayPending(false) } }

  const relatedCell = snapshot.cells.find((cell) => cell.idn === event.idn && cell.op === event.op && cell.resource === event.resource)
  const relatedScenarios = snapshot.scenarios.filter((scenario) => scenario.evidenceIds.includes(event.eventId))
  const metadata: [string, string][] = [["메서드", event.method], ["경로", event.path], ["HTTP 상태", String(event.status)], ["신원 / 역할", `${event.idn} / ${event.role}`], ["리소스", event.resource ?? "-"], ["분류", `${event.trafficClass} / ${event.trafficDisposition}`], ["실행", `${event.orchestrator} / ${event.tool} / ${event.phase}`]]
  if (showEvidenceId) metadata.unshift(["Evidence ID", event.eventId])

  return <div className="grid gap-4">
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[9rem_1fr]">{metadata.map(([name, value]) => <div className="contents" key={name}><dt className="font-medium">{name}</dt><dd className="break-words">{boundedText(value, 320)}</dd></div>)}</dl>
    {relatedCell && <p className="text-sm">연결 셀: {relatedCell.idn} · {relatedCell.op} · {relatedCell.overall}</p>}
    {relatedScenarios.length > 0 && <p className="text-sm">연결 시나리오: {relatedScenarios.map((scenario) => boundedText(scenario.title, 80)).join(" · ")}</p>}
    {error && <Alert variant="destructive"><AlertTitle>작업을 완료하지 못했습니다.</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {replayMessage && <Alert><AlertTitle>Repeater 초안</AlertTitle><AlertDescription>{replayMessage}</AlertDescription></Alert>}
    <section className="grid gap-2 rounded-md border p-3" aria-label="정책 작업">
      <h3 className="font-medium">정책</h3>
      <div className="flex flex-wrap items-end gap-2"><div className="grid gap-1"><Label htmlFor="required-role">필수 역할</Label><Input id="required-role" value={role} onChange={(change) => setRole(change.target.value)} /></div><Button type="button" disabled={requirement.isPending} onClick={() => void submitRequirement()}>필수 역할 저장</Button></div>
      <div className="flex flex-wrap items-end gap-2"><div className="grid gap-1"><Label htmlFor="traffic-override">트래픽 재정의</Label><select id="traffic-override" value={override} onChange={(change) => setOverride(change.target.value as "AUTO" | "INCLUDE" | "EXCLUDE")}><option value="AUTO">AUTO</option><option value="INCLUDE">INCLUDE</option><option value="EXCLUDE">EXCLUDE</option></select></div><Button type="button" disabled={traffic.isPending} onClick={() => void submitTraffic()}>트래픽 정책 저장</Button></div>
      {event.resource && <div className="flex flex-wrap items-end gap-2"><div className="grid gap-1"><Label htmlFor="resource-owner">리소스 소유자</Label><Input id="resource-owner" value={identity} onChange={(change) => setIdentity(change.target.value)} /></div><Button type="button" disabled={owner.isPending} onClick={() => void submitOwner()}>소유자 저장</Button></div>}
    </section>
    <section className="flex flex-wrap gap-2"><Button type="button" onClick={onOpenRequestLab}>Request Lab 열기</Button><Button type="button" variant="outline" disabled={replayPending} onClick={() => void replay()}>{replayPending ? "Repeater 초안 여는 중" : "Repeater 초안 열기"}</Button></section>
    <p className="text-sm text-muted-foreground">원문 요청과 응답은 Request Lab에서만 현재 탭 메모리로 처리합니다.</p>
  </div>
}
