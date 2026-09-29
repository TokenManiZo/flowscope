import { useEffect, useMemo, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { AccountSaveResult, ObservedSession } from "@/lib/api/types"
import { validateTarget } from "./account-settings/types"

const roles = ["User", "LV1", "LV2", "Admin"] as const
const NO_IDENTITY = "__none__"
function sameOrigin(left: string, right: string) {
  try { return new URL(left.trim()).origin === new URL(right.trim()).origin } catch { return false }
}

export interface NewAccountValues { id: string; label: string; role: string; target: string }

export function AccountRegistrationSheet({ open, sessions, pending, saveError, mergePending, mergeError, onOpenChange, onSave, onMerge, onCreated }: {
  open: boolean
  sessions: readonly ObservedSession[]
  pending: boolean
  saveError: string | null
  mergePending: boolean
  mergeError: string | null
  onOpenChange: (open: boolean) => void
  onSave: (values: NewAccountValues) => Promise<AccountSaveResult>
  onMerge: (values: { from: string; into: string }) => Promise<unknown>
  onCreated: (accountId: string) => void
}) {
  const [label, setLabel] = useState("")
  const [role, setRole] = useState("User")
  const [target, setTarget] = useState("")
  const [identity, setIdentity] = useState(NO_IDENTITY)
  const [createdId, setCreatedId] = useState("")
  const [partialMessage, setPartialMessage] = useState("")
  const [confirmClose, setConfirmClose] = useState(false)
  const targetError = target.trim() ? validateTarget(target) : null
  const identities = useMemo(() => [...new Set(sessions.filter((session) => sameOrigin(session.service, target) && !session.accountId).map((session) => session.idn))], [sessions, target])
  const dirty = Boolean(label || target || identity !== NO_IDENTITY || createdId)
  const busy = pending || mergePending

  useEffect(() => {
    if (identity !== NO_IDENTITY && !identities.includes(identity)) setIdentity(NO_IDENTITY)
  }, [identities, identity])

  const reset = () => { setLabel(""); setRole("User"); setTarget(""); setIdentity(NO_IDENTITY); setCreatedId(""); setPartialMessage("") }
  const finish = (accountId: string) => { reset(); onCreated(accountId) }
  const close = () => { reset(); onOpenChange(false) }
  const requestClose = () => { if (dirty && !createdId) setConfirmClose(true); else close() }
  const submit = async () => {
    if (!label.trim() || targetError || busy || createdId) return
    setPartialMessage("")
    try {
      const result = await onSave({ id: "", label: label.trim(), role, target: target.trim() })
      setCreatedId(result.id)
      if (identity !== NO_IDENTITY) {
        try { await onMerge({ from: identity, into: result.id }) }
        catch { setPartialMessage("계정은 등록됐지만 관측 신원 연결은 완료되지 않았습니다. 계정 설정에서 다시 연결해 주세요."); return }
      }
      finish(result.id)
    } catch {
      // Mutation error is rendered below without claiming that creation succeeded.
    }
  }
  const retryMerge = async () => {
    if (!createdId || identity === NO_IDENTITY || busy) return
    setPartialMessage("")
    try { await onMerge({ from: identity, into: createdId }); finish(createdId) }
    catch { setPartialMessage("계정은 등록됐지만 관측 신원 연결은 완료되지 않았습니다. 다시 시도하거나 계정 설정에서 연결해 주세요.") }
  }

  return <>
    <Sheet open={open} onOpenChange={(next) => next ? onOpenChange(true) : requestClose()}><SheetContent side="right" className="flex w-full max-w-none flex-col gap-0 overflow-hidden p-0 lg:max-w-3xl" aria-label="계정 등록">
      <SheetHeader className="border-b"><SheetTitle>계정 등록</SheetTitle><SheetDescription>기본 정보를 등록한 뒤 같은 서비스의 관측 신원을 연결하고 HUMAN·ZAP·LLM 설정을 이어서 관리합니다.</SheetDescription></SheetHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section className="space-y-3 rounded-lg border border-border/70 p-3" aria-labelledby="new-account-basic"><h3 id="new-account-basic" className="font-semibold">기본 정보</h3>
          <div className="grid gap-1.5"><Label htmlFor="new-account-label">표시 이름</Label><Input id="new-account-label" value={label} onChange={(event) => setLabel(event.target.value)} disabled={busy || Boolean(createdId)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="new-account-role">역할</Label><Select value={role} onValueChange={setRole} disabled={busy || Boolean(createdId)}><SelectTrigger id="new-account-role"><SelectValue /></SelectTrigger><SelectContent>{roles.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="new-account-target">대상 서비스 (exact origin)</Label><Input id="new-account-target" value={target} onChange={(event) => setTarget(event.target.value)} className="font-mono" placeholder="https://service.example" disabled={busy || Boolean(createdId)} />{targetError && <p role="alert" className="text-xs text-destructive">{targetError}</p>}</div>
        </section>
        <section className="space-y-3 rounded-lg border border-border/70 p-3" aria-labelledby="new-account-identity"><div><h3 id="new-account-identity" className="font-semibold">관측 신원 연결</h3><p className="text-xs text-muted-foreground">입력한 exact-origin과 같은 서비스에서 아직 연결되지 않은 신원만 표시합니다.</p></div>
          <Select value={identity} onValueChange={setIdentity} disabled={!target || busy || Boolean(createdId)}><SelectTrigger aria-label="같은 서비스 관측 신원"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NO_IDENTITY}>나중에 연결</SelectItem>{identities.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
        </section>
        <section className="rounded-lg border border-border/70 p-3"><h3 className="font-semibold">로그인 설정</h3><p className="mt-1 text-sm text-muted-foreground">계정을 등록하면 같은 창의 HUMAN·ZAP·LLM 탭에서 설정할 수 있습니다.</p></section>
        {saveError && !createdId && <Alert variant="destructive" aria-label={saveError}><AlertDescription>계정을 등록하지 못했습니다. {saveError}</AlertDescription></Alert>}
        {partialMessage && <Alert variant="destructive" aria-label="계정 등록 부분 성공"><AlertDescription>{partialMessage}{mergeError ? ` ${mergeError}` : ""}</AlertDescription></Alert>}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3"><Button variant="outline" onClick={requestClose} disabled={busy}>{createdId ? "닫기" : "취소"}</Button>{createdId ? <>{partialMessage && <Button variant="outline" onClick={() => void retryMerge()} disabled={busy}>{mergePending ? "연결 중" : "신원 연결 다시 시도"}</Button>}<Button onClick={() => finish(createdId)}>계정 설정 계속</Button></> : <Button onClick={() => void submit()} disabled={!label.trim() || !target.trim() || Boolean(targetError) || busy}>{busy ? "등록 중" : "등록하고 설정 계속"}</Button>}</footer>
    </SheetContent></Sheet>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>입력 내용을 버릴까요?</AlertDialogTitle><AlertDialogDescription>저장하지 않은 계정 정보는 삭제됩니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>계속 편집</AlertDialogCancel><Button variant="destructive" onClick={() => { setConfirmClose(false); close() }}>입력 내용 버리기</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>
}
