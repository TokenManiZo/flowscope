import { useEffect, useRef, useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { HttpStatusBadge, MethodBadge } from "@/components/TrafficBadges"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { saveOwner, saveRequirement, saveTrafficOverride } from "@/lib/api/endpoints"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { queryKeys } from "@/lib/query/hooks"
import { stripOrigin } from "@/lib/display/operationLabel"
import { boundedText } from "./evidenceSelectors"

interface Props {
  event: EventRecord
  snapshot: Snapshot
  onOpenRequestLab(): void
  showEvidenceId?: boolean
  /** 표시용 Evidence 순번(#N). 없으면 원본 eventId로 폴백한다. */
  evidenceLabel?: string
  disabled?: boolean
  compactPolicy?: boolean
  detailContent?: ReactNode
}

export function OperationDetail(props: Props) {
  const datasetRevision = props.snapshot.datasetRevision ?? props.snapshot.identityRevision ?? 0
  return <OperationEditor key={JSON.stringify([datasetRevision, props.event.eventId, props.event.op, props.event.resource, props.event.idn, props.event.source])} {...props} />
}

function OperationEditor({ event, snapshot, onOpenRequestLab, showEvidenceId = true, evidenceLabel, disabled = false, compactPolicy = false, detailContent }: Props) {
  const queryClient = useQueryClient()
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const requirement = useMutation({ mutationFn: ({ operation, role }: { operation: string; role: string }) => saveRequirement(operation, role) })
  const traffic = useMutation({ mutationFn: ({ operation, value }: { operation: string; value: string }) => saveTrafficOverride(operation, value) })
  const owner = useMutation({ mutationFn: ({ resource, identity }: { resource: string; identity: string }) => saveOwner(resource, identity) })
  const [role, setRole] = useState(snapshot.requiredRoles[event.op] ?? "")
  // 서버는 사용자 재정의를 분류 이유(USER_INCLUDE/USER_EXCLUDE)로 돌려준다. 저장 뒤 새 snapshot이 오면 다시 맞춘다.
  const savedOverride = event.classificationReasons.includes("USER_INCLUDE") ? "INCLUDE" : event.classificationReasons.includes("USER_EXCLUDE") ? "EXCLUDE" : "AUTO"
  const [override, setOverride] = useState<"AUTO" | "INCLUDE" | "EXCLUDE">(savedOverride)
  useEffect(() => setOverride(savedOverride), [savedOverride])
  // 자동 추정값을 초기값으로 쓰면 저장 한 번에 수동 지정으로 굳는다. 수동 지정만 채운다.
  const [identity, setIdentity] = useState(event.resource ? snapshot.ownerOverrides?.[event.resource] ?? "" : "")
  const [error, setError] = useState("")

  async function refreshSelection() { if (active.current) await queryClient.invalidateQueries({ queryKey: queryKeys.snapshot }) }
  async function submitRequirement() { setError(""); try { await requirement.mutateAsync({ operation: event.op, role }); await refreshSelection() } catch (reason) { setError(reason instanceof Error ? reason.message : "필수 역할 저장에 실패했습니다.") } }
  async function submitTraffic() { setError(""); try { await traffic.mutateAsync({ operation: event.op, value: override }); await refreshSelection() } catch (reason) { setError(reason instanceof Error ? reason.message : "트래픽 정책 저장에 실패했습니다.") } }
  async function submitOwner() { if (!event.resource) return; setError(""); try { await owner.mutateAsync({ resource: event.resource, identity }); await refreshSelection() } catch (reason) { setError(reason instanceof Error ? reason.message : "소유자 저장에 실패했습니다.") } }
  // 소유자는 계정·세션에 등록한 같은 서비스 계정 중에서 고른다. 서버도 같은 조건으로 검증한다(D-005).
  const service = event.op.split(" ")[0]
  const ownerChoices = new Map(snapshot.accounts.filter(account => account.target === service).map(account => [account.id, `${account.label} (${account.role})`]))
  const roleChoices = [...new Set(["", "Anonymous", "User", "LV1", "LV2", "Admin", ...snapshot.accounts.map((account) => account.role), role])]
  const currentOwner = event.resource ? snapshot.owners[event.resource] : undefined
  const manualOwner = event.resource ? snapshot.ownerOverrides?.[event.resource] : undefined
  const relatedCell = snapshot.cells.find((cell) => cell.idn === event.idn && cell.op === event.op && cell.resource === event.resource)
  const relatedScenarios = snapshot.scenarios.filter((scenario) => scenario.evidenceIds.includes(event.eventId))
  const metadata: [string, string][] = [["메서드", event.method], ["경로", stripOrigin(event.path) || event.path], ["HTTP 상태", String(event.status)], ["신원 / 역할", `${event.idn} / ${event.role}`], ["리소스", event.resource ?? "-"], ["분류", `${event.trafficClass} / ${event.trafficDisposition}`], ["실행", `${event.orchestrator} / ${event.tool} / ${event.phase}`]]
  if (showEvidenceId) metadata.unshift(["기록 번호", evidenceLabel ?? event.eventId])

  const policyContent = <>
      {compactPolicy && <div role="group" aria-label="필수 역할 선택" className="flex flex-wrap gap-1">{roleChoices.map((choice) => <button key={choice} type="button" disabled={disabled || requirement.isPending} aria-pressed={role === choice} onClick={() => setRole(choice)} className={cn("rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-50", role === choice ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{choice === "" ? "미지정" : choice === "Anonymous" ? "Anony" : choice}</button>)}</div>}
      <div className="flex flex-wrap items-end gap-2"><div className="grid gap-1"><Label htmlFor="required-role">필수 역할</Label><Input id="required-role" value={role} disabled={disabled} onChange={(change) => setRole(change.target.value)} /></div><Button type="button" disabled={disabled || requirement.isPending} onClick={() => void submitRequirement()}>필수 역할 저장</Button></div>
      <div className="flex flex-wrap items-end gap-2"><div className="grid gap-1"><Label htmlFor="traffic-override">트래픽 재정의</Label><select id="traffic-override" value={override} disabled={disabled} onChange={(change) => setOverride(change.target.value as "AUTO" | "INCLUDE" | "EXCLUDE")}><option value="AUTO">AUTO</option><option value="INCLUDE">INCLUDE</option><option value="EXCLUDE">EXCLUDE</option></select></div><Button type="button" disabled={disabled || traffic.isPending} onClick={() => void submitTraffic()}>트래픽 정책 저장</Button></div>
      {event.resource && <div className="flex flex-wrap items-end gap-2"><div className="grid gap-1"><Label htmlFor="resource-owner">리소스 소유자</Label><select id="resource-owner" value={identity} disabled={disabled} onChange={(change) => setIdentity(change.target.value)}><option value="">지정 안 함</option>{identity && !ownerChoices.has(identity) && <option value={identity} disabled>{identity} (선택 불가)</option>}{[...ownerChoices].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div><Button type="button" disabled={disabled || owner.isPending || (!!identity && !ownerChoices.has(identity))} onClick={() => void submitOwner()}>소유자 저장</Button><p className="basis-full text-xs text-muted-foreground">현재: {currentOwner ? `${currentOwner} · ${manualOwner ? "수동 지정" : "자동 추정"}` : "미확정"}{ownerChoices.size === 0 ? " · 계정·세션에서 이 서비스 계정을 먼저 등록하세요" : ""}</p></div>}
  </>

  return <div className="grid gap-4">
    <dl className={compactPolicy ? "grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-md border bg-muted/20 p-3 text-xs" : "grid gap-x-4 gap-y-2 sm:grid-cols-[9rem_1fr]"}>{metadata.map(([name, value]) => <div className="contents" key={name}><dt className={compactPolicy ? "text-muted-foreground" : "font-medium"}>{name}</dt><dd className="min-w-0 break-words">{compactPolicy && name === "메서드" ? <MethodBadge method={value} /> : compactPolicy && name === "HTTP 상태" ? <HttpStatusBadge status={value} /> : compactPolicy && name === "경로" ? <span className="break-all font-mono text-xs">{value}</span> : boundedText(value, 320)}</dd></div>)}</dl>
    {detailContent}
    {relatedCell && <p className="text-sm">연결 셀: {relatedCell.idn} · {relatedCell.op} · {relatedCell.overall}</p>}
    {relatedScenarios.length > 0 && <p className="text-sm">연결 시나리오: {relatedScenarios.map((scenario) => boundedText(scenario.title, 80)).join(" · ")}</p>}
    {error && <Alert variant="destructive"><AlertTitle>작업을 완료하지 못했습니다.</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {compactPolicy ? <details className="rounded-md border p-3" aria-label="정책 작업"><summary className="cursor-pointer text-sm font-medium">정책 편집 · 펼치기/접기</summary><div className="mt-3 grid gap-3">{policyContent}</div></details>
      : <section className="grid gap-2 rounded-md border p-3" aria-label="정책 작업"><h3 className="font-medium">정책</h3>{policyContent}</section>}
    <section className="flex flex-wrap gap-2"><Button type="button" disabled={disabled} onClick={onOpenRequestLab}>Request Lab 열기</Button></section>
    <p className="text-sm text-muted-foreground">{compactPolicy ? "Request Lab의 HTTP 편집 원문은 현재 탭 메모리에서만 처리합니다." : "원문 요청과 응답은 Request Lab에서만 현재 탭 메모리로 처리합니다."}</p>
  </div>
}
