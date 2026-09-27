import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Snapshot } from "@/lib/api/types"
import { useOwnerMutation, useResourcePolicyMutation } from "@/lib/query/hooks"

const PUBLIC = "__public__"
const READ_METHODS = new Set(["GET", "HEAD"])

interface Props { snapshot: Snapshot; operation: string; resource: string; disabled?: boolean }
interface Saved { publicRead: boolean; manualOwner: string }

/** 이 조회 API가 공개 정책인지. 소유자 표시를 "공개"로 바꿀 때도 같은 기준을 쓴다. */
export function isPublicRead(snapshot: Snapshot, operation: string, resource: string): boolean {
  return snapshot.authorizationMatrix?.objects.some(cell => cell.operation === operation && cell.resource === resource && cell.resourcePolicy === "PUBLIC") ?? false
}

/**
 * 그래프 객체 패널의 소유자 지정: 목록에서 고르고 [변경]을 눌러야 저장한다.
 * Public은 객체 소유자가 아니라 이 API 조회의 공개 정책(PUBLIC)으로 저장한다.
 * 쓰기 요청까지 공개로 두면 쓰기형 IDOR을 놓치므로(D-013) 조회 API에서만 고를 수 있다.
 */
export function GraphOwnerControl({ snapshot, operation, resource, disabled = false }: Props) {
  const owner = useOwnerMutation()
  const policy = useResourcePolicyMutation()
  const service = resource.split(" ")[0]
  const readable = READ_METHODS.has(operation.split(" ")[1] ?? "")
  const publicRead = isPublicRead(snapshot, operation, resource)
  const currentOwner = snapshot.owners[resource] ?? ""
  const manualOwner = snapshot.ownerOverrides?.[resource] ?? ""
  const current = publicRead ? PUBLIC : currentOwner
  const accounts = snapshot.accounts.filter(account => account.target === service)
  // 관측 신원이 소유자로 추정됐는데 등록 계정이 아니면 목록에 그대로 보여 준다.
  const options = [...accounts.map(account => ({ value: account.id, label: account.label })), ...(currentOwner && !accounts.some(account => account.id === currentOwner) ? [{ value: currentOwner, label: currentOwner }] : [])]
  const labelOf = (value: string) => value === PUBLIC ? "Public" : options.find(option => option.value === value)?.label ?? value
  const [picked, setPicked] = useState(current)
  const [done, setDone] = useState<{ message: string; undo: Saved; saved: Saved } | null>(null)
  useEffect(() => { setDone(null) }, [resource, operation])
  // 저장된 값이 바뀌면(다른 화면·되돌리기·새 snapshot) 선택 상자도 따라간다.
  useEffect(() => { setPicked(current) }, [current, resource, operation])
  useEffect(() => { if (!done) return; const timer = setTimeout(() => setDone(null), 10000); return () => clearTimeout(timer) }, [done])
  const pending = owner.isPending || policy.isPending
  const error = owner.error ?? policy.error

  // from은 방금 저장된 값이다. 되돌리기를 snapshot 갱신 전에 눌러도 비교 기준이 어긋나지 않는다.
  async function save(next: Saved, from: Saved) {
    if (next.publicRead !== from.publicRead) await policy.mutateAsync({ target: operation, policy: next.publicRead ? "PUBLIC" : "UNKNOWN" })
    if (!next.publicRead && next.manualOwner !== from.manualOwner) await owner.mutateAsync({ resource, identity: next.manualOwner })
  }
  async function apply() {
    const before: Saved = { publicRead, manualOwner }
    const next: Saved = picked === PUBLIC ? { publicRead: true, manualOwner } : { publicRead: false, manualOwner: picked }
    try {
      await save(next, before)
      setDone({ message: `${labelOf(picked)}(으)로 변경했습니다`, undo: before, saved: next })
    } catch { /* 오류는 아래에 표시한다 */ }
  }
  async function undo() {
    if (!done) return
    try { await save(done.undo, done.saved); setPicked(done.undo.publicRead ? PUBLIC : done.undo.manualOwner || currentOwner); setDone(null) } catch { /* 오류는 아래에 표시한다 */ }
  }

  return <section aria-label="소유자" className="grid gap-1">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">소유자</h3>
      <div className="flex items-center gap-1.5">
        <Select value={picked} onValueChange={setPicked} disabled={disabled || pending}>
          <SelectTrigger size="sm" aria-label="소유자 선택" className="h-7 w-40 text-xs"><SelectValue placeholder="미확정" /></SelectTrigger>
          <SelectContent className="max-h-44">
            {options.map(option => <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>)}
            <SelectItem value={PUBLIC} disabled={!readable} className="text-xs">Public</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" className="h-7 px-2.5 text-xs" disabled={disabled || pending || picked === current} onClick={() => void apply()}>변경</Button>
      </div>
    </div>
    <p className="text-[11px] text-muted-foreground">{publicRead ? "이 API 조회는 공개" : !currentOwner ? "소유자 미확정" : manualOwner ? "수동 지정" : "자동 추정"}</p>
    {done && <p role="status" className="text-xs">{done.message} · <button type="button" className="underline underline-offset-2" disabled={pending} onClick={() => void undo()}>되돌리기</button></p>}
    {error && <p role="alert" className="text-xs text-destructive">{error instanceof Error ? error.message : "저장하지 못했습니다."}</p>}
  </section>
}
