import { identityLabel } from "@/lib/display/identityLabel"
import { useEffect, useState } from "react"
import { AlertTriangle, CircleCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { Snapshot } from "@/lib/api/types"
import { useOperationObjectPolicyMutation, useOwnerMutation } from "@/lib/query/hooks"
import { isPublicRead } from "./graphHierarchy"

const PUBLIC = "__public__"
const READ_METHODS = new Set(["GET", "HEAD"])

/** operation이 없으면(그룹 화면 객체: 여러 API가 합쳐짐) 소유자만 고를 수 있고 API별 Public은 고를 수 없다. */
interface Props { snapshot: Snapshot; operation?: string | null; resource: string; disabled?: boolean }
interface Saved { publicRead: boolean; manualOwner: string }

/**
 * 그래프 객체 패널의 소유자 지정: 목록에서 고르고 [소유자로 확정]을 눌러야 저장한다.
 * 소유자를 모르면 다른 계정의 접근을 판정할 수 없으므로(UNTESTED) 미확정일 때는 이유와 함께 눈에 띄게 묻고,
 * 정해진 뒤에는 현재 소유자와 [소유자 바꾸기]만 보여 준다. 저장하면 서버가 판정을 다시 계산한다.
 * Public은 객체 소유자가 아니라 "이 API로 이 객체를 조회할 때만" 공개 정책(PUBLIC)으로 저장한다.
 * 같은 API의 다른 객체와 이 객체의 수정·삭제 요청은 그대로 판정한다.
 * 쓰기 요청까지 공개로 두면 쓰기형 IDOR을 놓치므로(D-013) 조회 API에서만 고를 수 있다.
 */
export function GraphOwnerControl({ snapshot, operation, resource, disabled = false }: Props) {
  const owner = useOwnerMutation()
  const policy = useOperationObjectPolicyMutation()
  const service = resource.split(" ")[0]
  const readable = !!operation && READ_METHODS.has(operation.split(" ")[1] ?? "")
  const publicRead = !!operation && isPublicRead(snapshot, operation, resource)
  const currentOwner = snapshot.owners[resource] ?? ""
  const manualOwner = snapshot.ownerOverrides?.[resource] ?? ""
  const current = publicRead ? PUBLIC : currentOwner
  const accounts = snapshot.accounts.filter(account => account.target === service)
  // 관측 계정이 소유자로 추정됐는데 등록 계정이 아니면 목록에 그대로 보여 준다.
  const options = [...accounts.map(account => ({ value: account.id, label: account.label })), ...(currentOwner && !accounts.some(account => account.id === currentOwner) ? [{ value: currentOwner, label: identityLabel(currentOwner) }] : [])]
  const labelOf = (value: string) => value === PUBLIC ? "Public" : options.find(option => option.value === value)?.label ?? value
  const [picked, setPicked] = useState(current)
  const [done, setDone] = useState<{ message: string; undo: Saved; saved: Saved } | null>(null)
  const [editing, setEditing] = useState(false)
  useEffect(() => { setDone(null); setEditing(false) }, [resource, operation])
  // 저장된 값이 바뀌면(다른 화면·되돌리기·새 snapshot) 선택 상자도 따라간다.
  useEffect(() => { setPicked(current) }, [current, resource, operation])
  useEffect(() => { if (!done) return; const timer = setTimeout(() => setDone(null), 10000); return () => clearTimeout(timer) }, [done])
  const pending = owner.isPending || policy.isPending
  const error = owner.error ?? policy.error

  // from은 방금 저장된 값이다. 되돌리기를 snapshot 갱신 전에 눌러도 비교 기준이 어긋나지 않는다.
  async function save(next: Saved, from: Saved) {
    if (operation && next.publicRead !== from.publicRead) await policy.mutateAsync({ operation, resource, policy: next.publicRead ? "PUBLIC" : "UNKNOWN" })
    if (!next.publicRead && next.manualOwner !== from.manualOwner) await owner.mutateAsync({ resource, identity: next.manualOwner })
  }
  async function apply() {
    const before: Saved = { publicRead, manualOwner }
    const next: Saved = picked === PUBLIC ? { publicRead: true, manualOwner } : { publicRead: false, manualOwner: picked }
    try {
      await save(next, before)
      setDone({ message: picked === PUBLIC ? "이 API 조회를 공개로 정했습니다. 판정을 다시 계산합니다." : `소유자를 ${labelOf(picked)}(으)로 확정했습니다. 판정을 다시 계산합니다.`, undo: before, saved: next })
      setEditing(false)
    } catch { /* 오류는 아래에 표시한다 */ }
  }
  async function undo() {
    if (!done) return
    try { await save(done.undo, done.saved); setPicked(done.undo.publicRead ? PUBLIC : done.undo.manualOwner || currentOwner); setDone(null) } catch { /* 오류는 아래에 표시한다 */ }
  }

  const resolved = publicRead || !!currentOwner
  // 이 객체를 소유자 근거가 없어 판정 보류한 계정 수(서버 셀 판정 그대로).
  const untested = new Set(snapshot.cells.filter(cell => cell.resource === resource && (!operation || cell.op === operation) && cell.overall === "untested").map(cell => cell.idn)).size
  const choosing = !resolved || editing
  const picker = <div role="radiogroup" aria-label="소유자 선택" className="grid gap-1.5">
    {options.map(option => <label key={option.value} className={`flex cursor-pointer items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-sm ${picked === option.value ? "border-sky-500 ring-1 ring-sky-500" : "border-border"}`}>
      <input type="radio" name={`owner-${resource}`} value={option.value} checked={picked === option.value} disabled={disabled || pending} onChange={() => setPicked(option.value)} className="accent-sky-500" />
      <span className="min-w-0 truncate">{option.label}</span>
      <span className="ms-auto shrink-0 text-xs text-muted-foreground">{accounts.some(account => account.id === option.value) ? "등록 계정" : "관측 계정"}</span>
    </label>)}
    <label className={`flex items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-sm ${readable ? "cursor-pointer" : "cursor-not-allowed opacity-50"} ${picked === PUBLIC ? "border-sky-500 ring-1 ring-sky-500" : "border-border"}`}>
      <input type="radio" name={`owner-${resource}`} value={PUBLIC} checked={picked === PUBLIC} disabled={disabled || pending || !readable} onChange={() => setPicked(PUBLIC)} className="accent-sky-500" />
      <span>누구나 조회 가능 (Public)</span>
      <span className="ms-auto shrink-0 text-xs text-muted-foreground">조회 API만</span>
    </label>
    {!options.length && <p className="text-xs text-muted-foreground">등록된 계정이 없어 소유자를 고를 수 없어요. <a href="#accounts" className="text-sky-600 underline underline-offset-2 dark:text-sky-300">계정·세션에서 계정 등록</a></p>}
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Button size="sm" className="h-8 text-[13px]" disabled={disabled || pending || !picked || picked === current} onClick={() => void apply()}>소유자로 확정</Button>
      {resolved && <Button size="sm" variant="ghost" className="h-8 text-[13px]" disabled={pending} onClick={() => { setPicked(current); setEditing(false) }}>취소</Button>}
      <span className="text-xs text-muted-foreground">판정 매트릭스·시나리오에도 반영돼요</span>
    </div>
  </div>

  return <section aria-label="소유자" className="mb-4 grid gap-2">
    {!resolved ? <div className="grid gap-2.5 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-300"><AlertTriangle className="size-4" aria-hidden="true" />소유자를 정해야 판정할 수 있어요</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">이 객체의 주인을 모르면 다른 계정의 접근을 IDOR로 판단할 수 없어요.{untested > 0 && <> 지금 계정 {untested}개가 <span className="font-medium text-foreground">미점검</span>이에요.</>}</p>
      <p className="text-xs font-medium">누가 이 객체의 주인인가요?</p>
      {picker}
    </div> : <div className="grid gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
      <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><CircleCheck className="size-4" aria-hidden="true" />{publicRead ? "이 API 조회는 공개" : `소유자 ${labelOf(currentOwner)}`}<span className="rounded-full border border-border px-2 py-px text-[11px] font-normal text-muted-foreground">{publicRead ? "공개 정책" : manualOwner ? "직접 확정" : "자동 추정"}</span></h3>
      <p className="text-xs leading-relaxed text-muted-foreground">{publicRead ? "이 API로 조회하는 요청은 누구나 허용으로 봐요. 수정·삭제 요청은 그대로 판정해요." : `${labelOf(currentOwner)} 외 계정이 이 객체를 열면 IDOR 후보로 판정해요.`}</p>
      {choosing ? picker : <div><Button size="sm" variant="outline" className="h-8 text-[13px]" disabled={disabled || pending} onClick={() => setEditing(true)}>소유자 바꾸기</Button></div>}
    </div>}
    {done && !done.saved.publicRead && publicRead && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">권한 매트릭스의 객체·API 정책으로 공개돼 있어 여기서는 풀리지 않습니다. 권한 매트릭스에서 바꾸세요.</p>}
    {done && <p role="status" className="text-xs">{done.message} · <button type="button" className="underline underline-offset-2" disabled={pending} onClick={() => void undo()}>되돌리기</button></p>}
    {error && <p role="alert" className="text-xs text-destructive">{error instanceof Error ? error.message : "저장하지 못했습니다."}</p>}
  </section>
}
