import { useEffect, useMemo, useState, type ReactNode } from "react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { InfoHint } from "@/components/ui/info-hint"
import { Button } from "@/components/ui/button"
import { Pause, Play, Plus, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAccountSaveMutation, useHumanRunMutation, useHumanRunQuery, useScannerRunQuery, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"
import type { AccountSettings } from "./account-settings/types"
import { EXPLORER_STATUS_META, ZAP_STATUS_META, type StatusMeta } from "./account-settings/statusMeta"
import { AccountSettingsSheet } from "./account-settings/AccountSettingsSheet"
import { createAccountSettingsAdapter } from "./account-settings/accountSettingsAdapter"
import { AccountRegistrationSheet } from "./AccountRegistrationSheet"
import { originOf } from "./account-settings/types"
import { clockTime, INSPECTION_RECORD_HANDOFF } from "@/features/inspection/inspectionState"

import { AnonymousAutoVerification } from "./AnonymousAutoVerification"

import { accountObservations } from "@/lib/display/accountObservations"

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null
}

function captureError(action: string | undefined): string {
  if (action === "begin") return "수집 브라우저를 열지 못했습니다. Chrome 설치와 점검 범위를 확인해 주세요."
  if (action === "end") return "브라우저 정리를 완료하지 못했습니다. 종료를 다시 시도해 주세요."
  return "수집 상태를 변경하지 못했습니다. 상태를 확인한 뒤 다시 시도해 주세요."
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

  const cardAccounts = [{ id: "anon", label: "비로그인", role: "Anonymous", target: scanner.data?.scope?.[0] ?? "" }, ...accounts]
  const events = snapshot.data?.events ?? []
  const totals = accountObservations(events, cardAccounts.map((account) => account.id))
  const zapTotals = accountObservations(events.filter((event) => event.sourceDetail !== "AUTHORIZATION_REPLAY" && event.phase !== "AUTHORIZATION_REPLAY"), cardAccounts.map((account) => account.id))
  const activeRuns = human.data?.runs ?? (human.data?.active ? [human.data] : [])
  const viewRecords = () => {
    try { sessionStorage.setItem(INSPECTION_RECORD_HANDOFF, "records") } catch { /* 저장소가 막히면 계정 미리 선택만 생략한다. */ }
    window.location.hash = "#inspection"
  }

  return <ReferenceAnalysisWorkspace ariaLabel="계정·세션 작업 영역" context={null} inspector={null}><section className="space-y-5 p-3" aria-labelledby="accounts-title">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="flex items-center gap-2"><h1 id="accounts-title" className="text-2xl font-semibold">계정·세션</h1><InfoHint label="트래픽 수집">시작을 누르면 별도 브라우저가 열려요. 그 창에서 로그인하고 사용하세요. 일시 정지는 기록만 멈춰요. 종료를 누르거나 창을 닫으면 브라우저를 정리한 뒤 받은 기록을 분석해요. 기존 기록은 유지돼요.</InfoHint></div><p className="mt-1 text-sm text-muted-foreground">테스트 계정을 등록하세요.</p></div><Button className="bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => setRegistrationOpen(true)}><Plus aria-hidden="true" />계정 등록</Button></div>
    <AnonymousAutoVerification />
    {human.isError && <Alert variant="destructive"><AlertDescription>수집 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.</AlertDescription></Alert>}
    <section className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3" aria-label="등록 계정 목록">
      {cardAccounts.map((account) => {
        const isAnonymous = account.id === "anon"
        const captureAccountId = isAnonymous ? "" : account.id
        const activeRun = activeRuns.find((run) => isAnonymous ? !run.accountId : run.accountId === account.id)
        const collecting = activeRun !== undefined
        const analyzing = !!activeRun?.analyzing
        const ending = login.isPending && login.variables?.action === "end" && login.variables.runId === activeRun?.runId
        const lastEnd = human.data?.endedRuns?.filter((run) => run.accountId === captureAccountId).at(-1)
        const actionMatchesAccount = login.variables?.action === "begin"
          ? login.variables.account === captureAccountId
          : !!activeRun && login.variables?.runId === activeRun.runId
        const settings = isAnonymous ? undefined : accountSettings[account.id]
        const observations = totals.get(account.id)!
        const last = Math.max(...Object.values(observations.last))
        const lastRecorded = last ? clockTime(new Date(last).toISOString()) : "—"
        const lanes: Array<[string, StatusMeta | null, string]> = [
          ["사람", { label: ending ? "종료 중" : analyzing ? "기록 분석 중" : collecting ? activeRun.paused ? "수집 일시 정지" : "수집 중" : lastEnd ? "수집 종료" : "수집 대기", tone: collecting && !activeRun.paused ? "warn" : "idle" }, `${observations.counts.human.toLocaleString("ko-KR")}건`],
          ["ZAP", isAnonymous ? NOT_USED : settings ? settings.zap.enabled ? ZAP_STATUS_META[settings.zap.status] : NOT_USED : null, `${zapTotals.get(account.id)!.counts.scanner.toLocaleString("ko-KR")}건`],
          ["LLM", isAnonymous ? NOT_USED : settings ? settings.llm.enabled ? EXPLORER_STATUS_META[settings.llm.status] : NOT_USED : null, `${observations.counts.llm.toLocaleString("ko-KR")}건`],
        ]
        return <article key={account.id} aria-label={`${account.label} 계정`} className="flex flex-col rounded-xl border border-border bg-card">
          <header className="flex items-center gap-3 px-4 pt-4 pb-3">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-sm font-semibold">{initials(account.label)}</span>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><strong className="truncate text-sm">{account.label}</strong><span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{account.role}</span></div><p className="truncate font-mono text-xs text-muted-foreground">{account.target ? account.target.replace(/^https?:\/\//, "").replace(/\/$/, "") : "점검 범위"}</p></div>
            {!isAnonymous && <Button className="h-10" variant="outline" aria-label={`${account.label} 관리`} onClick={() => setSettingsAccountId(account.id)}>관리</Button>}
          </header>
          <p className="px-4 pb-3 text-sm text-muted-foreground">{isAnonymous ? "로그인하지 않고 탐색하세요. 로그인 수집은 계정 카드를 사용하세요." : `이 브라우저에서는 ${account.label} 계정으로만 로그인하세요.`}</p>
          {login.isError && actionMatchesAccount && <Alert className="mx-4 mb-3 w-auto" variant="destructive"><AlertDescription>{captureError(login.variables?.action)}</AlertDescription></Alert>}
          {!activeRun && lastEnd?.message && <p role="status" className="px-4 pb-3 text-sm text-muted-foreground">{lastEnd.message}</p>}
          <dl aria-label={`${account.label} 연결 상태`} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3 text-sm">
            {lanes.map(([lane, meta, value]) => <div key={lane} className="contents"><dt className="text-muted-foreground">{lane}</dt><dd className="flex min-w-0 items-center gap-1.5"><span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", toneDot(meta))} /><span className="truncate">{meta?.label ?? "확인 중"}</span></dd><dd className="text-right tabular-nums text-muted-foreground">{value}</dd></div>)}
          </dl>
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-sm"><span className="text-muted-foreground">마지막 기록</span><span className="font-mono tabular-nums">{lastRecorded}</span></div>
          <footer className="mt-auto grid grid-cols-[1fr_1.3fr_1fr_1.2fr] gap-2 px-4 pt-1 pb-4">
            <Button className="h-10 px-2" disabled={login.isPending || human.isPending || human.isError || analyzing || (collecting && !activeRun.paused)} aria-label={`${account.label} 수집 시작`} onClick={() => login.mutate(activeRun ? { action: "resume", runId: activeRun.runId } : { action: "begin", account: captureAccountId })}><Play aria-hidden="true" />{login.isPending && login.variables?.action === "begin" && login.variables.account === captureAccountId ? "여는 중…" : "시작"}</Button>
            <Button className="h-10 px-2" variant="outline" disabled={login.isPending || human.isError || !activeRun || activeRun.paused || analyzing} aria-label={`${account.label} 일시 정지`} onClick={() => activeRun && login.mutate({ action: "pause", runId: activeRun.runId })}><Pause aria-hidden="true" />일시 정지</Button>
            <Button className="h-10 px-2" variant="outline" disabled={login.isPending || !activeRun || analyzing} aria-label={`${account.label} 수집 종료`} onClick={() => activeRun && login.mutate({ action: "end", runId: activeRun.runId })}><Square aria-hidden="true" />{ending ? "종료 중…" : "종료"}</Button>
            <Button className="h-10 px-2" variant="outline" onClick={viewRecords}>수집 보기</Button>
          </footer>
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
