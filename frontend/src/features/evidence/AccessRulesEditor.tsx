import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { saveOwner, saveRequirement, saveTrafficOverride } from "@/lib/api/endpoints"
import type { Snapshot } from "@/lib/api/types"
import { queryKeys } from "@/lib/query/hooks"

export interface PolicyTarget { operation: string | null; resource: string | null }
export const accessRoles = ["UNKNOWN", "ANONYMOUS", "USER", "LV1", "LV2", "ADMIN"] as const
export function serviceOf(operation: string) {
  try { return new URL(operation.split(" ")[0]).origin } catch { return "" }
}

export function AccessRulesEditor({ target, snapshot, disabled = false }: { target: PolicyTarget; snapshot: Snapshot; disabled?: boolean }) {
  const { operation, resource } = target
  // Policy changes refresh saved values, without resetting unrelated traffic drafts.
  const savedRole = operation ? (snapshot.requiredRoles[operation] ?? "UNKNOWN").toUpperCase() : "UNKNOWN"
  const savedOwner = resource ? snapshot.ownerOverrides?.[resource] ?? "" : ""
  return <RulesForm key={JSON.stringify([snapshot.datasetRevision, operation, resource, savedRole, savedOwner, operation ? snapshot.trafficOverrides?.[operation] : null])} target={target} snapshot={snapshot} savedRole={savedRole} savedOwner={savedOwner} disabled={disabled} />
}

function RulesForm({ target: { operation, resource }, snapshot, savedRole, savedOwner, disabled }: { target: PolicyTarget; snapshot: Snapshot; savedRole: string; savedOwner: string; disabled: boolean }) {
  const queryClient = useQueryClient()
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const [role, setRole] = useState(savedRole)
  const [owner, setOwner] = useState(savedOwner)
  const [override, setOverride] = useState(operation ? snapshot.trafficOverrides?.[operation] ?? "AUTO" : "AUTO")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [failed, setFailed] = useState(false)
  const service = serviceOf(operation ?? "")
  const choices = new Map<string, string>()
  for (const account of snapshot.accounts) if (service && serviceOf(account.target) === service) choices.set(account.id, `${account.label} · ${account.role} (${account.id})`)
  for (const event of snapshot.events) if (service && serviceOf(event.op) === service && !["UNRESOLVED", "ANONYMOUS"].includes(event.authState) && event.idn && event.idn !== "UNKNOWN") choices.set(event.idn, choices.get(event.idn) ?? `${event.idn} · 관측 신원`)
  const run = async (save: () => Promise<unknown>) => {
    setPending(true); setMessage(""); setFailed(false)
    try { await save(); if (active.current) { setMessage("저장했습니다. 관련 판정을 다시 확인하세요."); await queryClient.invalidateQueries({ queryKey: queryKeys.snapshot }) } }
    catch (error) { if (active.current) { setFailed(true); setMessage(error instanceof Error ? error.message : "저장 실패") } }
    finally { if (active.current) setPending(false) }
  }
  const locked = disabled || pending
  return <section aria-label="접근 규칙" className="grid gap-4 text-sm">
    <p>분석 대상에 대한 기대 규칙입니다. 선택 요청의 인증정보나 실제 서버 권한을 변경하지 않습니다.</p>
    {operation ? <section className="grid gap-2 rounded border p-3"><p className="break-all text-xs">적용 API: {operation}</p><label className="grid gap-1">필수 역할<select className="min-w-0 max-w-full rounded border border-input bg-background p-2" aria-label="필수 역할" value={role} disabled={locked} onChange={event => setRole(event.target.value)}>{accessRoles.map(value => <option key={value} value={value}>{value === "UNKNOWN" ? "미지정" : value === "ANONYMOUS" ? "비로그인 허용 (ANONYMOUS)" : value}</option>)}</select></label><p className="text-xs text-muted-foreground">이 API 접근에 필요한 최소 역할입니다. ANONYMOUS &lt; USER &lt; LV1 &lt; LV2 &lt; ADMIN 순서로 비교합니다. 계정에 부여한 역할과는 별개입니다.</p><Button disabled={locked} onClick={() => void run(() => saveRequirement(operation, role))}>필수 역할 저장</Button></section> : <p>API를 하나 선택하면 필수 역할을 지정할 수 있습니다.</p>}
    {resource ? <section className="grid gap-2 rounded border p-3"><p className="break-all text-xs">적용 객체: {resource}</p><p>현재 소유자: {snapshot.owners[resource] ?? "미확정"}{savedOwner ? " · 수동 지정" : " · 자동 분석"}</p><label className="grid gap-1">리소스 소유자<select className="min-w-0 max-w-full rounded border border-input bg-background p-2" aria-label="리소스 소유자" value={owner} disabled={locked} onChange={event => setOwner(event.target.value)}><option value="">수동 지정 해제 · 자동 분석</option>{savedOwner && !choices.has(savedOwner) && <option value={savedOwner} disabled>{savedOwner} · 기존 지정 (현재 선택 불가)</option>}{[...choices].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><p className="text-xs text-muted-foreground">같은 서비스의 등록 계정 또는 확인된 관측 신원입니다. 세션 만료와 소유권은 별개입니다. API 비로그인 허용과 객체의 공개 소유권은 별개입니다. 공개·공유 객체 정책은 아직 지원하지 않으며 public/other는 소유자로 저장하지 않습니다.</p><Button disabled={locked || (!!owner && !choices.has(owner))} onClick={() => void run(() => saveOwner(resource, owner))}>소유자 저장</Button></section> : <p>객체가 선택되지 않아 소유자 지정은 제공하지 않습니다.</p>}
    {operation && <details><summary>고급 · 탐색 비교 포함 정책</summary><div className="mt-2 grid gap-2"><label>트래픽 재정의<select className="min-w-0 max-w-full rounded border border-input bg-background p-2" aria-label="트래픽 재정의" value={override} disabled={locked} onChange={event => setOverride(event.target.value)}><option value="AUTO">자동 분류</option><option value="INCLUDE">비교에 포함</option><option value="EXCLUDE">비교에서 제외</option></select></label><p className="text-xs">수동 검증 요청은 이 설정과 무관하게 탐색 관측과 분리됩니다.</p><Button disabled={locked} onClick={() => void run(() => saveTrafficOverride(operation, override))}>트래픽 정책 저장</Button></div></details>}
    {message && <p role={failed ? "alert" : "status"}>{message}</p>}
  </section>
}
