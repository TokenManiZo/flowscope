import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { InfoHint } from "@/components/ui/info-hint"
import type { Snapshot } from "@/lib/api/types"
import { useOwnerMutation, useOperationObjectPolicyMutation } from "@/lib/query/hooks"

const PUBLIC = "__PUBLIC__"

export function MatrixOwnerControl({ operation, resource, snapshot, disabled }: { operation?: string; resource: string; snapshot: Snapshot; disabled: boolean }) {
  const owner = useOwnerMutation()
  const policy = useOperationObjectPolicyMutation()
  const readable = !!operation && ["GET", "HEAD"].includes(operation.split(" ")[1])
  const publicRead = readable && (snapshot.resourcePolicyOverrides?.[`${operation} @ ${resource}`] === "PUBLIC" || !!snapshot.authorizationMatrix?.objects.some(cell => cell.operation === operation && cell.resource === resource && cell.resourcePolicy === "PUBLIC"))
  const pending = owner.isPending || policy.isPending
  const current = snapshot.owners[resource] ?? ""
  const override = snapshot.ownerOverrides?.[resource] ?? ""
  const accounts = snapshot.accounts.filter(account => account.target === resource.split(" ")[0])
  const savedChoice = publicRead ? PUBLIC : override || current
  const [picked, setPicked] = useState(savedChoice)
  const [editing, setEditing] = useState(!current && !publicRead)
  const [message, setMessage] = useState("")
  useEffect(() => { setPicked(savedChoice) }, [savedChoice, resource, operation])
  const label = accounts.find(account => account.id === current)?.label ?? current
  async function save() {
    if (disabled || pending || (picked === PUBLIC && !readable)) return
    setMessage("")
    try {
      if (operation && (picked === PUBLIC) !== !!publicRead) await policy.mutateAsync({ operation, resource, policy: picked === PUBLIC ? "PUBLIC" : "UNKNOWN" })
      if (picked !== PUBLIC) await owner.mutateAsync({ resource, identity: picked })
      setEditing(false)
      setMessage(picked === PUBLIC ? "이 API의 객체 조회를 공개로 설정했습니다." : "객체 소유자를 저장했습니다.")
    } catch (error) { setMessage(error instanceof Error ? error.message : "소유자를 저장하지 못했습니다.") }
  }
  return <section aria-label="객체 소유자" className="grid gap-3 border-t border-border pt-5">
    <div className="flex items-center gap-1.5"><h3 className="text-sm font-semibold">객체 소유자</h3><InfoHint label="객체 소유자">이 객체의 주인인 계정입니다. 변경하면 서버가 이 객체의 접근 판정을 다시 계산합니다.</InfoHint></div>
    <div className="flex items-center justify-between gap-3"><div className="grid gap-1"><span className="font-medium">{publicRead ? "누구나 조회 가능 (Public)" : label || "아직 확인되지 않음"}</span><span className="text-sm leading-6 text-muted-foreground">{publicRead ? "이 API로 해당 객체를 조회하는 접근만 공개됩니다." : current ? override ? "직접 지정" : "자동 추정" : "계정을 선택해 소유자를 지정하세요"}</span></div>{!editing && <Button size="sm" variant="outline" disabled={disabled} onClick={() => setEditing(true)}>변경</Button>}</div>
    {editing && <div className="grid gap-2"><select aria-label="객체 소유자 선택" className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm" value={picked} disabled={disabled || pending} onChange={event => setPicked(event.target.value)}><option value="">자동 추정 사용</option><option value={PUBLIC} disabled={!readable}>누구나 조회 가능 (Public)</option>{current && !accounts.some(account => account.id === current) && <option value={current} disabled>{label} (등록되지 않은 계정)</option>}{accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}</select><div className="flex gap-2"><Button size="sm" disabled={disabled || pending || (!!picked && picked !== PUBLIC && !accounts.some(account => account.id === picked))} onClick={() => void save()}>{picked === PUBLIC ? "공개로 설정" : "소유자 저장"}</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => { setPicked(savedChoice); setEditing(false) }}>취소</Button></div>{!accounts.length && <a href="#accounts" className="text-xs text-primary underline underline-offset-2">계정·세션에서 계정 등록</a>}</div>}
    {message && <p role={(owner.isError || policy.isError) ? "alert" : "status"} className="text-xs">{message}</p>}
  </section>
}
