import { useEffect, useMemo, useState, type ReactNode } from "react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAccountSaveMutation, useIdentityMergeMutation, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"
import type { AccountSettings } from "./account-settings/types"
import { EXPLORER_STATUS_META, HUMAN_STATUS_META, StatusBadge, ZAP_STATUS_META } from "./account-settings/statusMeta"
import { AccountSettingsSheet } from "./account-settings/AccountSettingsSheet"
import { createAccountSettingsAdapter } from "./account-settings/accountSettingsAdapter"
import { AccountRegistrationSheet } from "./AccountRegistrationSheet"

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null
}

export function AccountsPage() {
  const snapshot = useSnapshotQuery()
  const zapStatus = useZapStatusQuery()
  const save = useAccountSaveMutation()
  const merge = useIdentityMergeMutation()
  const settingsAdapter = useMemo(() => createAccountSettingsAdapter(), [])
  const [settingsAccountId, setSettingsAccountId] = useState<string | null>(null)
  const [registrationOpen, setRegistrationOpen] = useState(false)
  const [accountSettings, setAccountSettings] = useState<Record<string, AccountSettings>>({})
  const accounts = snapshot.data?.accounts ?? []
  const sessions = snapshot.data?.sessions ?? []
  useEffect(() => {
    let active = true
    void Promise.all(accounts.map(async (account) => [account.id, await settingsAdapter.load(account.id)] as const)).then((entries) => {
      if (active) setAccountSettings(Object.fromEntries(entries))
    }).catch(() => undefined)
    return () => { active = false }
  }, [accounts, settingsAdapter])

  const unavailableWorkspace = (children: ReactNode) => <ReferenceAnalysisWorkspace ariaLabel="계정·세션 작업 영역" context={null} inspector={null}>{children}</ReferenceAnalysisWorkspace>
  if (snapshot.isLoading) return unavailableWorkspace(<section className="p-3" aria-label="계정·세션 콘텐츠">불러오는 중…</section>)
  if (snapshot.isError) return unavailableWorkspace(<Alert className="m-3" variant="destructive" aria-label={errorMessage(snapshot.error) ?? "계정·세션을 불러오지 못했습니다."}><AlertDescription>{errorMessage(snapshot.error) ?? "계정·세션을 불러오지 못했습니다."}</AlertDescription></Alert>)

  return <ReferenceAnalysisWorkspace ariaLabel="계정·세션 작업 영역" context={null} inspector={null}><section className="space-y-4 p-3" aria-labelledby="accounts-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 id="accounts-title" className="text-2xl font-semibold">계정·세션 관리</h1><Button onClick={() => setRegistrationOpen(true)}>계정 등록</Button></div>
    <dl role="group" aria-label="계정·세션 요약" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-border py-3 text-sm text-muted-foreground">{([["등록 계정", accounts.length], ["관측 세션", sessions.length], ["관리 세션", snapshot.data?.managedSessions.length ?? 0]] as const).map(([label, value], index) => <div key={label} className="flex items-center gap-2">{index > 0 && <span aria-hidden="true">·</span>}<dt>{label}</dt><dd className="font-mono font-medium tabular-nums text-foreground">{value}</dd></div>)}</dl>
    <Card><CardHeader><CardTitle>등록 계정</CardTitle></CardHeader><CardContent className="divide-y divide-border p-0">{accounts.length ? accounts.map((account) => {
      const settings = accountSettings[account.id]
      const managed = (snapshot.data?.managedSessions ?? []).find((session) => session.accountId === account.id)
      const observedCount = sessions.filter((session) => session.accountId === account.id).length
      return <article key={account.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3"><div className="min-w-[12rem] flex-1"><strong>{account.label}</strong><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{account.role} · {account.target}</p></div><div className="flex flex-wrap items-center gap-2" aria-label={`${account.label} 연결 상태`}><span className="text-xs text-muted-foreground">관측 {observedCount}</span>{settings ? <><span className="text-xs text-muted-foreground">HUMAN</span><StatusBadge meta={HUMAN_STATUS_META[settings.human.status]} /><span className="text-xs text-muted-foreground">ZAP</span><StatusBadge meta={ZAP_STATUS_META[settings.zap.status]} /><span className="text-xs text-muted-foreground">LLM</span><StatusBadge meta={EXPLORER_STATUS_META[settings.llm.status]} /></> : <span className="text-xs text-muted-foreground">연결 상태 확인 중</span>}{managed?.credentialConflict && <span className="text-xs text-destructive">자격 충돌</span>}</div><Button variant="outline" aria-label={`${account.label} 관리`} onClick={() => setSettingsAccountId(account.id)}>관리</Button></article>
    }) : <p className="p-4 text-sm text-muted-foreground">등록된 계정이 없습니다.</p>}</CardContent></Card>
    <AccountRegistrationSheet open={registrationOpen} sessions={sessions} pending={save.isPending} saveError={errorMessage(save.error)} mergePending={merge.isPending} mergeError={errorMessage(merge.error)} onOpenChange={setRegistrationOpen} onSave={(values) => save.mutateAsync(values)} onMerge={(values) => merge.mutateAsync(values)} onCreated={(accountId) => { setRegistrationOpen(false); setSettingsAccountId(accountId); void snapshot.refetch() }} />
    <AccountSettingsSheet zapRuntimeAvailable={zapStatus.data ? (zapStatus.data.managedRuntime ?? zapStatus.data.connected) : false} accountId={settingsAccountId} adapter={settingsAdapter} open={settingsAccountId !== null} observedSessions={sessions} onMergeIdentity={(values) => merge.mutateAsync(values)} onOpenChange={(open) => { if (!open) setSettingsAccountId(null) }} onSaved={() => void snapshot.refetch()} onDeleted={() => { setSettingsAccountId(null); void snapshot.refetch() }} />
  </section></ReferenceAnalysisWorkspace>
}
