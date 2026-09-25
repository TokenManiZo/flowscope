import { useMemo, useState, type ReactNode } from "react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAccountDeleteMutation, useAccountSaveMutation, useIdentityMergeMutation, useIdentityResetMutation, useRoleMutation, useSessionBindMutation, useSessionCaptureMutation, useSessionUnbindMutation, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"
import { AccountForm, type AccountValues } from "./AccountForm"
import { SessionDiagnostics } from "./SessionDiagnostics"
import { AccountSettingsSheet } from "./account-settings/AccountSettingsSheet"
import { createAccountSettingsAdapter } from "./account-settings/accountSettingsAdapter"

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null
}

export function AccountsPage() {
  const snapshot = useSnapshotQuery()
  const zapStatus = useZapStatusQuery()
  const save = useAccountSaveMutation()
  const remove = useAccountDeleteMutation()
  const role = useRoleMutation()
  const merge = useIdentityMergeMutation()
  const bind = useSessionBindMutation()
  const unbind = useSessionUnbindMutation()
  const capture = useSessionCaptureMutation()
  const reset = useIdentityResetMutation()
  const settingsAdapter = useMemo(() => createAccountSettingsAdapter(), [])
  const [settingsAccountId, setSettingsAccountId] = useState<string | null>(null)
  const [observedRoleIdentity, setObservedRoleIdentity] = useState("")
  const [observedRole, setObservedRole] = useState("User")
  const [mergeFrom, setMergeFrom] = useState("")
  const [mergeInto, setMergeInto] = useState("")
  const accounts = snapshot.data?.accounts ?? []
  const sessions = snapshot.data?.sessions ?? []
  const identities = useMemo(() => [...new Set(sessions.map((session) => session.idn))], [sessions])
  const selectedIdentity = observedRoleIdentity || identities[0] || ""
  const selectedMergeFrom = mergeFrom || identities[0] || ""
  const matchingMergeAccounts = accounts.filter((account) => sessions.some((session) => session.idn === selectedMergeFrom && session.service === account.target))
  const selectedMergeInto = matchingMergeAccounts.some((account) => account.id === mergeInto) ? mergeInto : matchingMergeAccounts[0]?.id || ""
  const boundAccountIds = new Set(sessions.filter((session) => session.accountId).map((session) => session.accountId))

  const unavailableWorkspace = (children: ReactNode) => <ReferenceAnalysisWorkspace ariaLabel="계정·세션 작업 영역" context={null} inspector={null}>{children}</ReferenceAnalysisWorkspace>
  if (snapshot.isLoading) return unavailableWorkspace(<section className="p-3" aria-label="계정·세션 콘텐츠">불러오는 중…</section>)
  if (snapshot.isError) return unavailableWorkspace(<Alert className="m-3" variant="destructive" aria-label={errorMessage(snapshot.error) ?? "계정·세션을 불러오지 못했습니다."}><AlertDescription>{errorMessage(snapshot.error) ?? "계정·세션을 불러오지 못했습니다."}</AlertDescription></Alert>)

  const saveAccount = (values: AccountValues, onSuccess: () => void) => save.mutate(values, { onSuccess })
  const sameIdentity = selectedMergeFrom !== "" && selectedMergeFrom === selectedMergeInto

  return <ReferenceAnalysisWorkspace ariaLabel="계정·세션 작업 영역" context={null} inspector={null}><section className="space-y-4 p-3" aria-labelledby="accounts-title">
    <div><h1 id="accounts-title" className="text-2xl font-semibold">계정·세션 관리</h1><p className="text-sm text-muted-foreground">등록 계정, 관측 신원, 비가역 지문, 재사용 관리 세션은 서로 다른 상태입니다.</p></div>
    <dl role="group" aria-label="계정·세션 요약" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-border py-3 text-sm text-muted-foreground">{([["등록 계정", accounts.length], ["관측 세션", sessions.length], ["관리 세션", snapshot.data?.managedSessions.length ?? 0]] as const).map(([label, value], index) => <div key={label} className="flex items-center gap-2">{index > 0 && <span aria-hidden="true">·</span>}<dt>{label}</dt><dd className="font-mono font-medium tabular-nums text-foreground">{value}</dd></div>)}</dl>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>테스트 계정 등록</CardTitle><CardDescription>표시 이름·역할·대상 서비스만 등록합니다. 비밀값은 입력하거나 저장하지 않습니다.</CardDescription></CardHeader><CardContent><AccountForm account={null} pending={save.isPending} error={errorMessage(save.error)} onSave={saveAccount} /></CardContent></Card>
      <Card><CardHeader><CardTitle>등록 계정</CardTitle><CardDescription>삭제 전 관측 세션 binding을 해제해야 합니다.</CardDescription></CardHeader><CardContent className="space-y-3">{accounts.length ? accounts.map((account) => <article key={account.id} className="rounded-lg border p-3"><strong>{account.label}</strong><p className="mt-1 text-sm">{account.role} · {account.target}</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" onClick={() => setSettingsAccountId(account.id)}>{account.label} 수정 패널</Button>{boundAccountIds.has(account.id) ? <p className="text-sm text-muted-foreground">연결된 세션을 먼저 해제하세요.</p> : <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" disabled={remove.isPending}>{account.label} 삭제</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>등록 계정을 삭제할까요?</AlertDialogTitle><AlertDialogDescription>삭제하면 이 계정의 재사용 관리 세션도 폐기됩니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><Button variant="destructive" aria-label="계정 삭제 확인" disabled={remove.isPending} onClick={() => remove.mutate(account.id)}>계정 삭제 확인</Button></AlertDialogFooter>{errorMessage(remove.error) && <Alert variant="destructive" aria-label={errorMessage(remove.error) ?? undefined}><AlertDescription>{errorMessage(remove.error)}</AlertDescription></Alert>}</AlertDialogContent></AlertDialog>}</div></article>) : <p className="text-sm text-muted-foreground">등록된 계정이 없습니다.</p>}</CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>관측 세션과 관리 진단</CardTitle><CardDescription>비가역 fingerprint는 연결 진단용이며 재사용할 credential이 아닙니다.</CardDescription></CardHeader><CardContent><SessionDiagnostics accounts={accounts} sessions={sessions} managedSessions={snapshot.data?.managedSessions ?? []} pending={{ bind: bind.isPending, unbind: unbind.isPending, capture: capture.isPending }} bindError={errorMessage(bind.error)} unbindError={errorMessage(unbind.error)} captureError={errorMessage(capture.error)} onBind={(values) => bind.mutate(values)} onUnbind={(values) => unbind.mutate(values)} onCapture={(values) => capture.mutate(values)} /></CardContent></Card>
    <Card><CardHeader><CardTitle>세션·신원 매핑 초기화</CardTitle><CardDescription>등록 계정과 Evidence는 유지하고 현재 프로세스의 로그인 세션 및 관측 신원 연결만 해제합니다.</CardDescription></CardHeader><CardContent><AlertDialog><AlertDialogTrigger asChild><Button variant="outline" disabled={reset.isPending}>세션·신원 매핑 초기화</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>세션과 신원 매핑을 초기화할까요?</AlertDialogTitle><AlertDialogDescription>메모리의 로그인 세션과 fingerprint 연결만 해제합니다. 수집된 Evidence와 프로젝트 DB는 삭제하지 않습니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><Button variant="destructive" aria-label="세션 매핑 초기화 확인" disabled={reset.isPending} onClick={() => reset.mutate()}>세션 매핑 초기화 확인</Button></AlertDialogFooter>{reset.data?.message && <Alert aria-label={reset.data.message}><AlertDescription>{reset.data.message}</AlertDescription></Alert>}{errorMessage(reset.error) && <Alert variant="destructive" aria-label={errorMessage(reset.error) ?? undefined}><AlertDescription>{errorMessage(reset.error)}</AlertDescription></Alert>}</AlertDialogContent></AlertDialog></CardContent></Card>
    <Card><CardHeader><CardTitle>관측 신원과 병합</CardTitle><CardDescription>관측 신원은 계정이 아닙니다. 같은 서비스에서 관측된 세션만 등록 계정에 연결합니다.</CardDescription></CardHeader><CardContent className="space-y-4"><Accordion type="single" collapsible><AccordionItem value="role"><AccordionTrigger aria-label="관측 신원 역할 열기">관측 신원 역할</AccordionTrigger><AccordionContent><div className="grid gap-3 md:grid-cols-3"><div className="grid gap-1"><Label htmlFor="observed-role-identity">관측 신원</Label><Select value={selectedIdentity} onValueChange={setObservedRoleIdentity} disabled={role.isPending}><SelectTrigger id="observed-role-identity"><SelectValue placeholder="관측 신원 선택" /></SelectTrigger><SelectContent>{identities.map((identity) => <SelectItem key={identity} value={identity}>{identity}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label htmlFor="observed-role">관측 신원 역할 값</Label><Select value={observedRole} onValueChange={setObservedRole} disabled={role.isPending}><SelectTrigger id="observed-role"><SelectValue /></SelectTrigger><SelectContent>{["User", "LV1", "LV2", "Admin", "Unknown"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div><Button disabled={!selectedIdentity || role.isPending} onClick={() => role.mutate({ identity: selectedIdentity, role: observedRole })}>관측 신원 역할 저장</Button></div>{errorMessage(role.error) && <Alert className="mt-3" variant="destructive" aria-label={errorMessage(role.error) ?? undefined}><AlertDescription>{errorMessage(role.error)}</AlertDescription></Alert>}</AccordionContent></AccordionItem></Accordion><div className="grid gap-3 md:grid-cols-3"><div className="grid gap-1"><Label htmlFor="merge-from">병합할 관측 신원</Label><Select value={selectedMergeFrom} onValueChange={setMergeFrom} disabled={merge.isPending}><SelectTrigger id="merge-from"><SelectValue placeholder="관측 신원 선택" /></SelectTrigger><SelectContent>{identities.map((identity) => <SelectItem key={identity} value={identity}>{identity}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label htmlFor="merge-into">병합 대상 등록 계정</Label><Select value={selectedMergeInto} onValueChange={setMergeInto} disabled={merge.isPending}><SelectTrigger id="merge-into"><SelectValue placeholder="같은 서비스 계정 선택" /></SelectTrigger><SelectContent>{matchingMergeAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.label}</SelectItem>)}</SelectContent></Select></div><Button disabled={!selectedMergeFrom || !selectedMergeInto || sameIdentity || merge.isPending} onClick={() => merge.mutate({ from: selectedMergeFrom, into: selectedMergeInto })}>같은 사용자로 병합</Button></div>{sameIdentity && <p className="text-sm text-destructive">서로 다른 두 신원을 선택하세요.</p>}{!matchingMergeAccounts.length && selectedMergeFrom && <p className="text-sm text-muted-foreground">같은 대상 서비스의 등록 계정이 없습니다.</p>}{errorMessage(merge.error) && <Alert variant="destructive" aria-label={errorMessage(merge.error) ?? undefined}><AlertDescription>{errorMessage(merge.error)}</AlertDescription></Alert>}</CardContent></Card>
    <AccountSettingsSheet zapRuntimeAvailable={zapStatus.data ? (zapStatus.data.managedRuntime ?? zapStatus.data.connected) : false} accountId={settingsAccountId} adapter={settingsAdapter} open={settingsAccountId !== null} onOpenChange={(open) => { if (!open) setSettingsAccountId(null) }} onSaved={() => void snapshot.refetch()} onDeleted={() => { setSettingsAccountId(null); void snapshot.refetch() }} />
  </section></ReferenceAnalysisWorkspace>
}
