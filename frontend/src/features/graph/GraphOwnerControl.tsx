import { identityLabel } from "@/lib/display/identityLabel"
import { useEffect, useState } from "react"
import { AlertTriangle, CircleCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { Snapshot } from "@/lib/api/types"
import { useOwnerMutation } from "@/lib/query/hooks"

interface Props { snapshot: Snapshot; resource: string; disabled?: boolean }
interface Saved { message: string; previous: string }

/** Individual observed OBJ owners are saved only after explicit confirmation. */
export function GraphOwnerControl({ snapshot, resource, disabled = false }: Props) {
  const owner = useOwnerMutation()
  const service = resource.split(" ")[0]
  const currentOwner = snapshot.ownerOverrides?.[resource] ?? ""
  const accounts = snapshot.accounts.filter(account => account.target === service)
  const labelOf = (identity: string) => accounts.find(account => account.id === identity)?.label ?? identityLabel(identity)
  const [picked, setPicked] = useState(currentOwner)
  const [done, setDone] = useState<Saved | null>(null)
  const [editing, setEditing] = useState(false)
  useEffect(() => { setDone(null); setEditing(false) }, [resource])
  useEffect(() => { setPicked(currentOwner) }, [currentOwner, resource])
  useEffect(() => { if (!done) return; const timer = setTimeout(() => setDone(null), 10000); return () => clearTimeout(timer) }, [done])
  const pending = owner.isPending

  async function apply() {
    if (disabled || pending || !picked || picked === currentOwner) return
    try {
      await owner.mutateAsync({ resource, identity: picked })
      setDone({ message: `소유자를 ${labelOf(picked)}(으)로 확정했습니다.`, previous: currentOwner })
      setEditing(false)
    } catch { /* Mutation errors are shown below. */ }
  }
  async function undo() {
    if (!done || disabled || pending) return
    try {
      await owner.mutateAsync({ resource, identity: done.previous })
      setPicked(done.previous)
      setDone(null)
    } catch { /* Mutation errors are shown below. */ }
  }

  const resolved = !!currentOwner
  const picker = <div role="radiogroup" aria-label="소유자 선택" className="grid gap-1.5">
    {accounts.map(account => <label key={account.id} className={`flex cursor-pointer items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-sm ${picked === account.id ? "border-sky-500 ring-1 ring-sky-500" : "border-border"}`}>
      <input type="radio" name={`owner-${resource}`} value={account.id} checked={picked === account.id} disabled={disabled || pending} onChange={() => setPicked(account.id)} className="accent-sky-500" />
      <span className="min-w-0 truncate">{account.label}</span>
      <span className="ms-auto shrink-0 text-xs text-muted-foreground">등록 계정</span>
    </label>)}
    {!accounts.length && <p className="text-xs text-muted-foreground">등록된 계정이 없어 소유자를 고를 수 없어요. <a href="#accounts" className="text-sky-600 underline underline-offset-2 dark:text-sky-300">계정·세션에서 계정 등록</a></p>}
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Button size="sm" className="h-8 text-[13px]" disabled={disabled || pending || !picked || picked === currentOwner} onClick={() => void apply()}>소유자로 확정</Button>
      {resolved && <Button size="sm" variant="ghost" className="h-8 text-[13px]" disabled={disabled || pending} onClick={() => { setPicked(currentOwner); setEditing(false) }}>취소</Button>}
    </div>
  </div>

  return <section aria-label="소유자" className="mb-4 grid gap-2">
    {!resolved ? <div className="grid gap-2.5 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-300"><AlertTriangle className="size-4" aria-hidden="true" />객체 소유자 지정</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">선택한 객체의 소유자를 지정합니다.</p>
      <p className="text-xs font-medium">누가 이 객체의 주인인가요?</p>
      {picker}
    </div> : <div className="grid gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
      <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><CircleCheck className="size-4" aria-hidden="true" />소유자 {labelOf(currentOwner)}<span className="rounded-full border border-border px-2 py-px text-[11px] font-normal text-muted-foreground">직접 확정</span></h3>
      <p className="text-xs leading-relaxed text-muted-foreground">선택한 객체에 저장된 소유자입니다.</p>
      {editing ? picker : <div><Button size="sm" variant="outline" className="h-8 text-[13px]" disabled={disabled || pending} onClick={() => setEditing(true)}>소유자 바꾸기</Button></div>}
    </div>}
    {done && <p role="status" className="text-xs">{done.message} · <button type="button" className="underline underline-offset-2" disabled={disabled || pending} onClick={() => void undo()}>되돌리기</button></p>}
    {owner.error && <p role="alert" className="text-xs text-destructive">{owner.error instanceof Error ? owner.error.message : "저장하지 못했습니다."}</p>}
  </section>
}
