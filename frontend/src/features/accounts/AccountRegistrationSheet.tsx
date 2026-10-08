import { useEffect, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { AccountSaveResult } from "@/lib/api/types"
import { RoleSegment } from "./account-settings/BasicAccountTab"
import { validateTarget, type AccountRole } from "./account-settings/types"

export interface NewAccountValues { id: string; label: string; role: string; target: string }

/** 계정 등록은 이름·역할·대상 서비스만 받는다. 관측 계정 연결과 로그인 설정은 등록 후 관리 창에서 한다. */
export function AccountRegistrationSheet({ open, defaultTarget = "", pending, saveError, onOpenChange, onSave, onCreated }: {
  open: boolean
  defaultTarget?: string
  pending: boolean
  saveError: string | null
  onOpenChange: (open: boolean) => void
  onSave: (values: NewAccountValues) => Promise<AccountSaveResult>
  onCreated: (accountId: string) => void
}) {
  const [label, setLabel] = useState("")
  const [role, setRole] = useState<AccountRole>("User")
  const [target, setTarget] = useState(defaultTarget)
  const targetError = target.trim() ? validateTarget(target) : null

  useEffect(() => {
    if (open) { setLabel(""); setRole("User"); setTarget(defaultTarget) }
  }, [open, defaultTarget])

  const submit = async () => {
    if (!label.trim() || !target.trim() || targetError || pending) return
    try {
      const result = await onSave({ id: "", label: label.trim(), role, target: target.trim() })
      onCreated(result.id)
    } catch {
      // Mutation error is rendered below without claiming that creation succeeded.
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} className="flex w-full max-w-[520px] flex-col gap-0 overflow-hidden p-0">
      <header className="border-b border-border px-5 py-4 pr-12"><DialogTitle className="text-lg font-semibold">계정 등록</DialogTitle></header>
      <form className="grid gap-4 px-5 py-5" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <div className="grid gap-1.5"><Label htmlFor="new-account-label">표시 이름</Label><Input id="new-account-label" value={label} onChange={(event) => setLabel(event.target.value)} disabled={pending} autoFocus /></div>
        <div className="grid gap-1.5"><Label id="new-account-role">역할</Label><RoleSegment labelledBy="new-account-role" value={role} onChange={setRole} disabled={pending} /></div>
        <div className="grid gap-1.5"><Label htmlFor="new-account-target">대상 서비스</Label><Input id="new-account-target" value={target} onChange={(event) => setTarget(event.target.value)} className="font-mono" placeholder="http://127.0.0.1:9000" disabled={pending} />
          {targetError ? <p role="alert" className="text-xs text-destructive">{targetError}</p> : defaultTarget && <p className="text-xs text-muted-foreground">scope에서 자동으로 채웠습니다.</p>}</div>
        {saveError && <Alert variant="destructive" aria-label={saveError}><AlertDescription>계정을 등록하지 못했습니다. {saveError}</AlertDescription></Alert>}
        <button type="submit" hidden />
      </form>
      <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-2"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>취소</Button><Button onClick={() => void submit()} disabled={!label.trim() || !target.trim() || Boolean(targetError) || pending}>{pending ? "등록 중" : "등록"}</Button></footer>
    </DialogContent>
  </Dialog>
}
