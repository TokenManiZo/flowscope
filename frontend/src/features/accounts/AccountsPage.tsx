import { useEffect, useMemo, useState, type ReactNode } from "react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Bot, Check, Copy, HelpCircle, KeyRound, Plus, Radar, ScanLine, UserRound, Users, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAccountSaveMutation, useIdentityMergeMutation, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"
import type { AccountSettings } from "./account-settings/types"
import { EXPLORER_STATUS_META, HUMAN_STATUS_META, ZAP_STATUS_META, type StatusMeta } from "./account-settings/statusMeta"
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
  const [copied, setCopied] = useState<string | null>(null)
  const [accountSettings, setAccountSettings] = useState<Record<string, AccountSettings>>({})
  const copyTarget = async (target: string) => {
    try { await navigator.clipboard.writeText(target); setCopied(target); window.setTimeout(() => setCopied(null), 1200) } catch { /* 클립보드 미지원 환경은 무시한다. */ }
  }
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

  return <ReferenceAnalysisWorkspace ariaLabel="계정·세션 작업 영역" context={null} inspector={null}><TooltipProvider delayDuration={180}><section className="space-y-5 p-3" aria-labelledby="accounts-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 id="accounts-title" className="text-2xl font-semibold">계정·세션 관리</h1><Button className="bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => setRegistrationOpen(true)}><Plus aria-hidden="true" />계정 등록</Button></div>
    <section role="group" aria-label="계정·세션 요약" className="grid gap-3 sm:grid-cols-3">
      <SummaryTile icon={Users} label="등록 계정" value={accounts.length} help="대상 서비스에 등록한 신원 수." />
      <SummaryTile icon={Radar} label="관측된 세션" value={sessions.length} help="트래픽에서 자동으로 발견된 세션 지문. 신원에 귀속되는 관측 기록이며, 재전송에 바로 쓰지는 못함." />
      <SummaryTile icon={KeyRound} label="확보한 세션" value={snapshot.data?.managedSessions.length ?? 0} help="재전송·라이브 검증에 실제로 쓸 수 있게 확보·유지하는 세션(handle·인증 자격 보유)." />
    </section>
    <section className="space-y-3" aria-label="등록 계정 목록">
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">등록 계정</h2><span className="font-mono text-xs text-muted-foreground">{accounts.length.toLocaleString("ko-KR")}개</span></div>
      {accounts.length ? accounts.map((account) => {
        const settings = accountSettings[account.id]
        const managed = (snapshot.data?.managedSessions ?? []).find((session) => session.accountId === account.id)
        const observedCount = sessions.filter((session) => session.accountId === account.id).length
        return <article key={account.id} className="grid gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:border-ring/60 md:grid-cols-[auto_minmax(0,1fr)_auto_auto] md:items-center">
          <div className="grid size-11 place-items-center rounded-md border border-border bg-muted/50"><UserRound className="size-5 text-muted-foreground" aria-hidden="true" /></div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{account.label}</strong><span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{account.role}</span></div>
            <div className="flex min-w-0 items-center gap-1.5"><span className="truncate font-mono text-xs text-muted-foreground">{account.target}</span><Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`${account.target} 복사`} onClick={() => void copyTarget(account.target)}>{copied === account.target ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</Button></div>
            <p className="text-xs text-muted-foreground">관측 세션 {observedCount.toLocaleString("ko-KR")}{managed?.credentialConflict && <span className="ml-2 text-destructive">자격 충돌</span>}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:justify-end" aria-label={`${account.label} 연결 상태`}>{settings ? <>
            <SourceChip icon={UserRound} label="HUMAN" color="text-observation-human" meta={HUMAN_STATUS_META[settings.human.status]} />
            <SourceChip icon={ScanLine} label="ZAP" color="text-observation-scanner" meta={ZAP_STATUS_META[settings.zap.status]} />
            <SourceChip icon={Bot} label="LLM" color="text-observation-llm" meta={EXPLORER_STATUS_META[settings.llm.status]} />
          </> : <span className="text-xs text-muted-foreground">연결 상태 확인 중</span>}</div>
          <Button variant="outline" aria-label={`${account.label} 관리`} onClick={() => setSettingsAccountId(account.id)}>관리</Button>
        </article>
      }) : <div className="grid min-h-36 place-items-center rounded-lg border border-dashed border-border p-6 text-center"><div className="space-y-2"><UserRound className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-muted-foreground">새 대상 신원을 등록해 세 소스 세션을 한 곳에서 비교하세요</p></div></div>}
    </section>
    <AccountRegistrationSheet open={registrationOpen} sessions={sessions} pending={save.isPending} saveError={errorMessage(save.error)} mergePending={merge.isPending} mergeError={errorMessage(merge.error)} onOpenChange={setRegistrationOpen} onSave={(values) => save.mutateAsync(values)} onMerge={(values) => merge.mutateAsync(values)} onCreated={(accountId) => { setRegistrationOpen(false); setSettingsAccountId(accountId); void snapshot.refetch() }} />
    <AccountSettingsSheet zapRuntimeAvailable={zapStatus.data ? (zapStatus.data.managedRuntime ?? zapStatus.data.connected) : false} accountId={settingsAccountId} adapter={settingsAdapter} open={settingsAccountId !== null} observedSessions={sessions} onMergeIdentity={(values) => merge.mutateAsync(values)} onOpenChange={(open) => { if (!open) setSettingsAccountId(null) }} onSaved={() => void snapshot.refetch()} onDeleted={() => { setSettingsAccountId(null); void snapshot.refetch() }} />
  </section></TooltipProvider></ReferenceAnalysisWorkspace>
}

function SummaryTile({ icon: Icon, label, value, help }: { icon: LucideIcon; label: string; value: number; help: string }) {
  return <div className="flex min-h-24 items-center gap-4 rounded-lg border border-border bg-card p-4">
    <div className="grid size-10 shrink-0 place-items-center rounded-md bg-brand/10 text-brand"><Icon className="size-5" aria-hidden="true" /></div>
    <div className="min-w-0">
      <div className="font-mono text-2xl font-semibold tabular-nums">{value.toLocaleString("ko-KR")}</div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span>{label}</span><Tooltip><TooltipTrigger asChild><button type="button" aria-label={`${label} 설명`} className="rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><HelpCircle className="size-3.5" aria-hidden="true" /></button></TooltipTrigger><TooltipContent className="max-w-72 leading-relaxed">{help}</TooltipContent></Tooltip></div>
    </div>
  </div>
}

/** 소스별 세션 상태 칩. 색만으로 구분하지 않도록 상태 라벨(활성·미확인 등)을 함께 표시한다(statusMeta 규칙). */
function SourceChip({ icon: Icon, label, color, meta }: { icon: LucideIcon; label: string; color: string; meta: StatusMeta }) {
  const dot = meta.tone === "ok" ? "bg-emerald-500" : meta.tone === "warn" ? "bg-amber-500" : meta.tone === "bad" ? "bg-destructive" : "bg-muted-foreground/50"
  const text = meta.tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : meta.tone === "warn" ? "text-amber-600 dark:text-amber-400" : meta.tone === "bad" ? "text-destructive" : "text-muted-foreground"
  return <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 font-mono text-[11px]">
    <Icon className={cn("size-3.5", color)} aria-hidden="true" />
    <span className="text-foreground">{label}</span>
    <span className={cn("size-1.5 rounded-full", dot)} aria-hidden="true" />
    <span className={text}>{meta.label}</span>
  </span>
}
