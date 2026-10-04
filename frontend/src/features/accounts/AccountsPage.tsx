import { useEffect, useMemo, useState, type ReactNode } from "react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAccountSaveMutation, useHumanRunMutation, useHumanRunQuery, useScannerRunQuery, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"
import type { AccountSettings } from "./account-settings/types"
import { EXPLORER_STATUS_META, HUMAN_STATUS_META, ZAP_STATUS_META, type StatusMeta } from "./account-settings/statusMeta"
import { AccountSettingsSheet } from "./account-settings/AccountSettingsSheet"
import { createAccountSettingsAdapter } from "./account-settings/accountSettingsAdapter"
import { AccountRegistrationSheet } from "./AccountRegistrationSheet"
import { originOf } from "./account-settings/types"
import { clockTime, HUMAN_ACCOUNT_HANDOFF } from "@/features/inspection/inspectionState"

import { AnonymousAutoVerification } from "./AnonymousAutoVerification"

import { accountObservations } from "@/lib/display/accountObservations"

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null
}

export function AccountsPage() {
  const snapshot = useSnapshotQuery()
  const zapStatus = useZapStatusQuery()
  const scanner = useScannerRunQuery()
  const save = useAccountSaveMutation()
  const human = useHumanRunQuery()
  const login = useHumanRunMutation()
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
  }, [accounts, settingsAdapter, snapshot.data?.revision])

  const unavailableWorkspace = (children: ReactNode) => <ReferenceAnalysisWorkspace ariaLabel="계정·세션 작업 영역" context={null} inspector={null}>{children}</ReferenceAnalysisWorkspace>
  if (snapshot.isLoading) return unavailableWorkspace(<section className="p-3" aria-label="계정·세션 콘텐츠">불러오는 중…</section>)
  if (snapshot.isError) return unavailableWorkspace(<Alert className="m-3" variant="destructive" aria-label={errorMessage(snapshot.error) ?? "계정·세션을 불러오지 못했습니다."}><AlertDescription>{errorMessage(snapshot.error) ?? "계정·세션을 불러오지 못했습니다."}</AlertDescription></Alert>)

  const totals = accountObservations(snapshot.data?.events ?? [], accounts.map((account) => account.id))
  const activeRuns = human.data?.runs ?? (human.data?.active ? [human.data] : [])
  const collectAs = async (accountId: string) => {
    if (!activeRuns.some((run) => run.accountId === accountId)) {
      try { await login.mutateAsync({ action: "begin", account: accountId }); return }
      catch { return }
    }
    try { sessionStorage.setItem(HUMAN_ACCOUNT_HANDOFF, accountId) } catch { /* 저장소가 막히면 계정 미리 선택만 생략한다. */ }
    window.location.hash = "#inspection"
  }

  return <ReferenceAnalysisWorkspace ariaLabel="계정·세션 작업 영역" context={null} inspector={null}><section className="space-y-5 p-3" aria-labelledby="accounts-title">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 id="accounts-title" className="text-2xl font-semibold">계정·세션</h1><p className="mt-1 text-sm text-muted-foreground">권한 비교에 쓸 테스트 계정입니다. 2개 이상 등록하세요.</p></div><Button className="bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => setRegistrationOpen(true)}><Plus aria-hidden="true" />계정 등록</Button></div>
    <p className="text-sm text-muted-foreground">이 계정으로 로그인을 누르고, 열린 브라우저에서 직접 로그인한 뒤 서비스를 사용하세요. 다른 계정도 여기서 별도 창으로 열 수 있습니다.</p>
    <AnonymousAutoVerification />
    <p className="text-xs text-muted-foreground">현재 프로젝트의 저장 HTTP 응답 관측 · 반복 요청 포함 · 연결 상태와 별도로 집계</p>
    {login.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(login.error) ?? "수집 브라우저를 열지 못했습니다."}</AlertDescription></Alert>}
    {human.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(human.error) ?? "수집 상태를 확인하지 못했습니다."}</AlertDescription></Alert>}
    <section className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3" aria-label="등록 계정 목록">
      {accounts.map((account) => {
        const collecting = activeRuns.some((run) => run.accountId === account.id)
        const settings = accountSettings[account.id]
        const observations = totals.get(account.id)!
        const last = Math.max(...Object.values(observations.last))
        const lastRecorded = last ? clockTime(new Date(last).toISOString()) : "—"
        const lanes: Array<[string, StatusMeta | null, string]> = [
          ["HUMAN", settings ? HUMAN_STATUS_META[settings.human.status] : null, `${observations.counts.human.toLocaleString("ko-KR")}건`],
          ["ZAP", settings ? settings.zap.enabled ? ZAP_STATUS_META[settings.zap.status] : NOT_USED : null, `${observations.counts.scanner.toLocaleString("ko-KR")}건`],
          ["LLM", settings ? settings.llm.enabled ? EXPLORER_STATUS_META[settings.llm.status] : NOT_USED : null, `${observations.counts.llm.toLocaleString("ko-KR")}건`],
        ]
        return <article key={account.id} aria-label={`${account.label} 계정`} className="flex flex-col rounded-xl border border-border bg-card">
          <header className="flex items-center gap-3 px-4 pt-4 pb-3">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-sm font-semibold">{initials(account.label)}</span>
            <div className="min-w-0"><div className="flex items-center gap-1.5"><strong className="truncate text-sm">{account.label}</strong><span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{account.role}</span></div><p className="truncate font-mono text-xs text-muted-foreground">{account.target.replace(/^https?:\/\//, "")}</p></div>
          </header>
          <dl aria-label={`${account.label} 연결 상태`} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3 text-sm">
            {lanes.map(([lane, meta, value]) => <div key={lane} className="contents"><dt className="text-muted-foreground">{lane}</dt><dd className="flex min-w-0 items-center gap-1.5"><span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", toneDot(meta))} /><span className="truncate">{meta?.label ?? "확인 중"}</span></dd><dd className="text-right tabular-nums text-muted-foreground">{value}</dd></div>)}
          </dl>
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-sm"><span className="text-muted-foreground">마지막 기록</span><span className="font-mono tabular-nums">{lastRecorded}</span></div>
          <div className="mt-auto grid grid-cols-[1fr_auto] gap-2 px-4 pt-1 pb-4"><Button disabled={login.isPending || human.isPending || human.isError} onClick={() => void collectAs(account.id)}>{collecting ? "수집 보기" : login.isPending && login.variables?.action === "begin" && login.variables.account === account.id ? "브라우저 여는 중…" : "이 계정으로 로그인"}</Button><Button variant="outline" aria-label={`${account.label} 관리`} onClick={() => setSettingsAccountId(account.id)}>관리</Button></div>
        </article>
      })}
      <button type="button" onClick={() => setRegistrationOpen(true)} className="grid min-h-56 place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:border-ring/60 hover:text-foreground"><span className="flex items-center gap-2"><Plus className="size-4" aria-hidden="true" />계정 추가</span></button>
    </section>
    <AccountRegistrationSheet open={registrationOpen} defaultTarget={scanner.data?.scope?.[0] ? originOf(scanner.data.scope[0]) : ""} pending={save.isPending} saveError={errorMessage(save.error)} onOpenChange={setRegistrationOpen} onSave={(values) => save.mutateAsync(values)} onCreated={() => { setRegistrationOpen(false); void snapshot.refetch() }} />
    <AccountSettingsSheet zapRuntimeAvailable={zapStatus.data ? (zapStatus.data.managedRuntime ?? zapStatus.data.connected) : false} accountId={settingsAccountId} adapter={settingsAdapter} open={settingsAccountId !== null} observedSessions={sessions} onOpenChange={(open) => { if (!open) setSettingsAccountId(null) }} onSaved={() => void snapshot.refetch()} onDeleted={() => { setSettingsAccountId(null); void snapshot.refetch() }} />
  </section></ReferenceAnalysisWorkspace>
}

const NOT_USED: StatusMeta = { label: "사용 안 함", tone: "idle" }

function initials(label: string): string {
  const words = label.trim().split(/\s+/)
  return (words.length > 1 ? words[words.length - 1] : label).slice(0, 2).toUpperCase()
}

function toneDot(meta: StatusMeta | null): string {
  if (!meta) return "bg-muted-foreground/40"
  return meta.tone === "ok" ? "bg-emerald-500" : meta.tone === "warn" ? "bg-amber-500" : meta.tone === "bad" ? "bg-destructive" : "bg-muted-foreground/40"
}
