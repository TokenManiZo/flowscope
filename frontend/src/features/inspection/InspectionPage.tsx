import { evidenceOrdinalLabel } from "@/lib/display/operationLabel"
import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Copy } from "lucide-react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useScannerCancelMutation, useScannerRunMutation, useScannerRunQuery, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"
import type { EventRecord } from "@/lib/api/types"
import { clockTime, INSPECTION_RECORD_HANDOFF } from "./inspectionState"
import { LlmPass } from "./LlmPass"
import { durationLabel, runStatusLabel, scannerStageLabel } from "@/lib/display/runStatus"
import { SourcePassLayout, type SourceFeedItem } from "./SourcePassLayout"
import { AccountSettingsSheet } from "@/features/accounts/account-settings/AccountSettingsSheet"
import { createAccountSettingsAdapter } from "@/features/accounts/account-settings/accountSettingsAdapter"
import { HumanRequestFeed } from "./HumanRequestFeed"
import { AccountLaneTable } from "./AccountLaneTable"
import { useRecordView } from "./RecordView"

/** 점검 시작 허브의 소스 스텝. */
export type InspectionStep = "records" | "scanner" | "llm" | "review"

const inspectionSteps: readonly { step: InspectionStep; label: string }[] = [
  { step: "records", label: "수집 기록" },
  { step: "scanner", label: "ZAP 스캔" },
  { step: "llm", label: "LLM 탐색" },
  { step: "review", label: "결과 비교" },
]

const RELEASES_URL = "https://github.com/TokenManiZo/flowscope/releases"
const ZAP_COMMANDS: ReadonlyArray<[string, string]> = [["macOS · Linux", "./scripts/zap-up.sh"], ["Windows", ".\\scripts\\zap-up.ps1"]]

function isAuthorizationReplay(event: EventRecord): boolean {
  return event.sourceDetail === "AUTHORIZATION_REPLAY" || event.phase === "AUTHORIZATION_REPLAY"
}

function isZapRequest(event: EventRecord): boolean {
  // SCANNER나 tool=ZAP만으로는 Burp Scanner·출처 미상 기록과 구분되지 않는다.
  return event.source === "scanner" && !isAuthorizationReplay(event)
    && (event.sourceDetail.startsWith("ZAP_") || event.sourceDetail === "HAR_IMPORT")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다."
}

function OpenRunsButton() {
  return <Button variant="outline" onClick={() => { window.location.hash = "#runs" }}>실행 기록</Button>
}

function normalizedOrigin(value: string): string {
  try {
    const url = new URL(value)
    const port = url.port || (url.protocol === "https:" ? "443" : "80")
    return `${url.protocol}//${url.hostname.toLowerCase()}:${port}`
  } catch {
    return ""
  }
}

function displayOrigin(value: string): string {
  try { return new URL(value).origin } catch { return value }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    try {
      void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200) }, () => undefined)
    } catch { /* 클립보드가 막힌 환경은 직접 선택해 복사한다. */ }
  }
  return <button type="button" aria-label={`${value} 복사`} title="복사" className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" onClick={copy}>
    {copied ? <Check className="size-3.5 text-emerald-500" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
  </button>
}

function CollectedRecords({ items, onFocusChange }: { items: readonly SourceFeedItem[]; onFocusChange(focused: boolean): void }) {
  const root = useRef<HTMLElement>(null)
  const view = useRecordView(root, onFocusChange)
  return <section ref={root} onKeyDown={view.onKeyDown} className={view.focused ? "flex h-full min-h-0 flex-col" : "grid gap-3"} aria-label="수집 기록 영역">
    {!view.focused && <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">브라우저·ZAP·LLM의 최근 요청을 함께 확인합니다.</p><Button variant="ghost" onClick={() => { window.location.hash = "#accounts" }}>계정·세션 열기</Button></div>}
    <HumanRequestFeed view={view} showSource title="수집 기록" context="전체 수집 기록" items={items} searchLabel="수집 기록 검색" emptyHint="아직 기록된 요청이 없습니다. 계정 브라우저를 열거나 ZAP·LLM을 실행하세요." />
  </section>
}

export function InspectionPage() {
  const snapshot = useSnapshotQuery()
  const zap = useZapStatusQuery()
  const scanner = useScannerRunQuery()
  const scannerMutation = useScannerRunMutation()
  const scannerCancel = useScannerCancelMutation()
  const [selectedStep, setSelectedStep] = useState<InspectionStep>("records")
  useEffect(() => {
    try { sessionStorage.removeItem(INSPECTION_RECORD_HANDOFF) } catch { /* 저장소가 막히면 다음 진입 때 다시 확인한다. */ }
  }, [])
  const [target, setTarget] = useState("")
  const [recordFocused, setRecordFocused] = useState(false)
  const [anonymous, setAnonymous] = useState(false)
  const [selectedAccounts, setSelectedAccounts] = useState<readonly string[]>([])
  const [zapDefinitions, setZapDefinitions] = useState("")
  const [showZapHowTo, setShowZapHowTo] = useState(false)
  const [zapAccountsOpen, setZapAccountsOpen] = useState(true)
  const [settings, setSettings] = useState<{ id: string; tab: "zap" } | null>(null)
  const settingsAdapter = useMemo(() => createAccountSettingsAdapter(), [])

  const scope = scanner.data?.scope ?? []
  useEffect(() => {
    if (!target && scope[0]) setTarget(scope[0])
  }, [scope, target])

  const events = snapshot.data?.events ?? []
  const targetAccounts = useMemo(() => (snapshot.data?.accounts ?? []).filter((account) =>
    normalizedOrigin(account.target) === normalizedOrigin(target)), [snapshot.data?.accounts, target])
  const scannerAccountIds = (scanner.data?.accounts ?? []).filter((account) =>
    normalizedOrigin(account.service) === normalizedOrigin(target)).map((account) => account.id)
  const targetInScope = target !== "" && scope.includes(target)
  const zapConnected = zap.data?.connected === true
  const scannerRunning = scanner.data?.run.status === "RUNNING"
  const scannerCleaning = scannerRunning && scanner.data?.run.stage === "CLEANUP"
  const scannerStarted = scanner.data !== undefined && scanner.data.run.status !== "NOT_STARTED"
  const zapCanStart = zapConnected && targetInScope && (anonymous || selectedAccounts.length > 0) && !scannerRunning && !scannerMutation.isPending
  const scannerHint = !zapConnected ? "ZAP을 켜면 시작할 수 있습니다."
    : !targetInScope ? "scope에 포함된 대상이 없습니다."
      : !anonymous && selectedAccounts.length === 0 ? "비로그인 또는 계정을 하나 이상 고르세요."
        : `${(anonymous ? 1 : 0) + selectedAccounts.length}개 선택됨`

  useEffect(() => {
    setSelectedAccounts((current) => current.filter((id) => scannerAccountIds.includes(id)))
  }, [scannerAccountIds.join(",")])

  const queryError = zap.isError
    ? { error: zap.error, hasLastSuccess: zap.data !== undefined }
    : scanner.isError ? { error: scanner.error, hasLastSuccess: scanner.data !== undefined } : undefined

  // 신원 표시: 등록 계정은 표시 이름, 비로그인은 그대로, 어느 계정에도 연결되지 않은 서버 임시 신원(user-c 등)은
  // 등록 계정 ID와 헷갈리지 않게 "미등록 로그인 N"으로 바꾼다.
  const identityLabel = useMemo(() => {
    const labels = new Map((snapshot.data?.accounts ?? []).map((account) => [account.id, account.label]))
    const unregistered = [...new Set(events.map((event) => event.laneAccountId?.trim() || event.idn).filter((idn) => idn && idn !== "anon" && !labels.has(idn)))].sort()
    return (idn: string): { label: string; muted: boolean } => {
      if (!idn || idn === "anon") return { label: "비로그인", muted: true }
      const label = labels.get(idn)
      return label ? { label, muted: false } : { label: `미등록 로그인 ${unregistered.indexOf(idn) + 1}`, muted: true }
    }
  }, [snapshot.data?.accounts, events])
  const feedItem = (event: (typeof events)[number]): SourceFeedItem => {
    const identity = event.laneAccountId?.trim() || event.idn
    const who = identityLabel(identity)
    return { id: event.eventId, ordinal: evidenceOrdinalLabel(snapshot.data?.evidenceOrdinals, event.eventId), badge: event.method, title: event.path, status: String(event.status), detail: who.label, mutedDetail: who.muted,
      sourceCode: event.source === "human" ? "H" : event.source === "scanner" ? "S" : event.source === "llm" ? "L" : "—",
      sourceLabel: isAuthorizationReplay(event) ? (!identity || identity === "anon" ? "비로그인 자동 검증" : "자동 검증")
        : event.source === "human" ? "Human" : event.source === "scanner" ? "ZAP" : event.source === "llm" ? "LLM" : "미확인",
      time: event.timestamp ? clockTime(new Date(event.timestamp).toISOString()) : undefined }
  }

  const collectedFeed = useMemo<readonly SourceFeedItem[]>(() => events.slice()
    .sort((a, b) => b.timestamp - a.timestamp).slice(0, 200).map(feedItem),
    [events, identityLabel, snapshot.data?.evidenceOrdinals])

  // 저장된 수집 방식으로 ZAP 요청을 먼저 고른 뒤 최근 200건을 표시한다.
  const scannerFeedItems = useMemo<readonly SourceFeedItem[]>(() => events
    .filter(isZapRequest)
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 200)
    .map(feedItem),
    [events, identityLabel, snapshot.data?.evidenceOrdinals])


  return (
    <ReferenceAnalysisWorkspace ariaLabel="점검 시작 작업 영역" context={null} inspector={null} contentOverflow={recordFocused ? "hidden" : "auto"}><section className={recordFocused ? "flex h-full min-h-0 flex-col p-3" : "space-y-4 p-3"} aria-label={recordFocused ? "점검 기록 크게 보기" : undefined} aria-labelledby={recordFocused ? undefined : "inspection-title"}>
      <div hidden={recordFocused}>
        <h1 id="inspection-title" className="text-2xl font-semibold">점검 시작</h1>
        <p role="group" className="mt-1 text-sm text-muted-foreground" aria-label="점검 범위">대상 <span className="font-mono text-foreground">{scope.length ? scope.map(displayOrigin).join(" · ") : "없음 · 프로젝트에서 새 진단을 만들 때 정합니다"}</span></p>
      </div>

      {queryError && (
        <Alert variant="destructive" aria-label={errorMessage(queryError.error)}>
          <AlertTitle>{queryError.hasLastSuccess ? "마지막 성공 상태를 표시하고 있습니다." : "상태를 가져오지 못했습니다. 확인이 필요합니다."}</AlertTitle>
          <AlertDescription>{errorMessage(queryError.error)}</AlertDescription>
        </Alert>
      )}
      {scannerMutation.isError && <Alert variant="destructive" aria-label={errorMessage(scannerMutation.error)}><AlertDescription>{errorMessage(scannerMutation.error)}</AlertDescription></Alert>}
      {scannerCancel.isError && <Alert variant="destructive" aria-label={errorMessage(scannerCancel.error)}><AlertDescription>{errorMessage(scannerCancel.error)}</AlertDescription></Alert>}

      <Tabs className={recordFocused ? "h-full min-h-0 flex-1" : undefined} value={selectedStep} onValueChange={(value) => { setRecordFocused(false); setSelectedStep(value as InspectionStep) }}>
        <TabsList hidden={recordFocused} aria-label="점검 진행 단계" className={recordFocused ? "hidden" : "h-auto flex-wrap"}>
          {inspectionSteps.map(({ step, label }) => <TabsTrigger key={step} value={step}>{label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="records" className={recordFocused ? "mt-0 min-h-0" : "mt-2"}>
          <CollectedRecords items={collectedFeed} onFocusChange={setRecordFocused} />
        </TabsContent>

        <TabsContent value="scanner" className={recordFocused ? "mt-0 min-h-0" : "mt-2"}>
          <SourcePassLayout
            label="ZAP"
            onRecordFocusChange={setRecordFocused}
            title="ZAP 스캔"
            description="Human이 놓친 API를 스캐너로 찾습니다. 선택한 계정마다 따로 스캔합니다."
            statusTiles={scannerStarted ? [
              { label: "상태", value: runStatusLabel(scanner.data?.run.status ?? "NOT_STARTED") },
              { label: "소요 시간", value: durationLabel(scanner.data?.run.elapsed_seconds), mono: true },
              { label: "수집 / Alert", value: `${scanner.data?.run.captured_records ?? "-"} / ${scanner.data?.run.alert_count ?? "-"}` },
              { label: "현재 단계", value: scannerStageLabel(scanner.data?.run.stage) },
            ] : []}
            notices={<>
              {(scanner.data?.run.lanes ?? []).map((lane) => (
                <p key={lane.account_id ?? "anon"} className="text-sm text-muted-foreground">
                  {lane.account_label} · {scannerStageLabel(lane.stage)}{lane.account_id ? ` · 로그인 ${lane.authentication_state ?? "UNKNOWN"}${lane.authentication_browser ? ` · ${lane.authentication_browser}` : ""}` : ""}{lane.authentication_message ? ` · ${lane.authentication_message}` : ""}{lane.warning ? ` · 주의 ${lane.warning}` : ""}{lane.error ? ` · 오류 ${lane.error}` : ""}
                </p>
              ))}
              {scanner.data?.run.warning && <Alert><AlertDescription>주의 · {scanner.data.run.warning}</AlertDescription></Alert>}
              {scanner.data?.run.error && <Alert variant="destructive"><AlertDescription>{scanner.data.run.error}</AlertDescription></Alert>}
            </>}
            control={<div className="grid gap-4">
              {zapConnected
                ? <div className="flex min-h-10 items-center gap-2 rounded-lg bg-emerald-500/10 px-3 text-sm" aria-label="ZAP 상태"><span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />ZAP 연결됨</div>
                : <div title={zap.data?.message} className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm" aria-label="ZAP 상태">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />
                  <span className="flex-1">ZAP이 꺼져 있습니다. 계정 브라우저와 LLM은 계속 사용할 수 있습니다.</span>
                  <button type="button" className="underline underline-offset-4" aria-expanded={showZapHowTo} onClick={() => setShowZapHowTo((value) => !value)}>켜는 방법</button>
                  <Button size="sm" variant="outline" disabled={zap.isFetching} onClick={() => void zap.refetch()}>다시 확인</Button>
                </div>}
              {!zapConnected && showZapHowTo && <div className="grid gap-2 rounded-lg border border-border p-3 text-sm" aria-label="ZAP 켜는 방법">
                <p className="font-medium">FlowScope 폴더에서 실행</p>
                {ZAP_COMMANDS.map(([os, command]) => <div key={os} className="grid grid-cols-[7.5rem_16rem] items-center gap-3">
                  <span className="text-muted-foreground">{os}</span>
                  <span className="flex items-center justify-between gap-2 rounded-md border border-border bg-background py-0.5 ps-2.5 pe-1 font-mono text-xs"><span>{command}</span><CopyButton value={command} /></span>
                </div>)}
                <p className="text-muted-foreground">폴더가 없다면 → <a className="text-foreground underline underline-offset-4" href={RELEASES_URL} target="_blank" rel="noreferrer">전체 파일 받기</a> <span className="text-xs">(Docker 필요)</span></p>
              </div>}
              {scope.length > 1 && <div className="grid gap-1.5"><span className="text-xs text-muted-foreground">대상</span>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger id="scanner-target" aria-label="ZAP 대상" className="w-72"><SelectValue /></SelectTrigger>
                  <SelectContent>{scope.map((value) => <SelectItem key={value} value={value}>{displayOrigin(value)}</SelectItem>)}</SelectContent>
                </Select></div>}
              <section className="rounded-md border">
                <button type="button" aria-label={`ZAP 계정 ${zapAccountsOpen ? "접기" : "펼치기"}`} aria-expanded={zapAccountsOpen} onClick={() => setZapAccountsOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-muted/50"><span className="font-medium">스캔할 계정 <span className="ml-2 font-normal text-muted-foreground">{[...(anonymous ? ["비로그인"] : []), ...selectedAccounts.map((id) => targetAccounts.find((account) => account.id === id)?.label ?? id)].join(" · ") || "선택 없음"}</span></span><span className="flex items-center gap-1 font-medium">{zapAccountsOpen ? "접기" : "펼치기"}<ChevronDown className={`size-3.5 ${zapAccountsOpen ? "rotate-180" : ""}`} /></span></button>
                {zapAccountsOpen && <div className="grid gap-2 border-t p-3"><AccountLaneTable lane="ZAP" rows={targetAccounts.map((account) => ({ id: account.id, label: account.label, configured: scannerAccountIds.includes(account.id) }))}
                  anonymous={anonymous} onAnonymousChange={setAnonymous} selected={selectedAccounts}
                  onToggle={(id, value) => setSelectedAccounts((current) => value ? [...current, id] : current.filter((item) => item !== id))}
                  onSettings={(id) => setSettings({ id, tab: "zap" })} disabled={!zapConnected || scannerRunning} /></div>}
              </section>
              <details className="rounded-lg border border-border px-3 py-2.5 text-sm">
                <summary className="cursor-pointer">명세로 API 추가 <span className="text-xs text-muted-foreground">OpenAPI · GraphQL · 선택</span></summary>
                <textarea id="scanner-definitions" aria-label="API 정의" className="mt-3 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm" value={zapDefinitions} onChange={(event) => setZapDefinitions(event.target.value)} spellCheck={false} placeholder={"OPENAPI https://target/openapi.json\nGRAPHQL https://target/graphql [schema URL]"} />
              </details>
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={!zapCanStart} onClick={() => scannerMutation.mutate({ target, anonymous, accounts: selectedAccounts.join(","), definitions: zapDefinitions })}>스캔 시작</Button>
                {scannerRunning && <Button variant="outline" disabled={scannerCleaning || scannerCancel.isPending} onClick={() => scannerCancel.mutate()}>스캔 취소</Button>}
                <span className="text-sm text-muted-foreground">{scannerHint}</span>
                <span className="ms-auto"><OpenRunsButton /></span>
              </div>
            </div>}
            feedItems={scannerFeedItems}
            feedTitle="ZAP 요청 기록"
            feedDescription={scannerStarted ? `${scannerStageLabel(scanner.data?.run.stage)} · 현재 단계 ${durationLabel(scanner.data?.run.stage_elapsed_seconds)}${scanner.data?.run.stage_timeout_seconds ? ` / 최대 ${durationLabel(scanner.data.run.stage_timeout_seconds)}` : ""}` : undefined}
            emptyHint="아직 기록된 ZAP 요청이 없습니다."
            feedContent={(view) => <HumanRequestFeed view={view} title="ZAP 요청 기록" titleBadge="ZAP 전용" showCount context="이 프로젝트의 ZAP 요청" items={scannerFeedItems} searchLabel="ZAP 작업 피드 검색" description={`이 프로젝트에서 ZAP이 보낸 요청만 표시합니다.${scannerStarted ? ` ${scannerStageLabel(scanner.data?.run.stage)} · 현재 단계 ${durationLabel(scanner.data?.run.stage_elapsed_seconds)}${scanner.data?.run.stage_timeout_seconds ? ` / 최대 ${durationLabel(scanner.data.run.stage_timeout_seconds)}` : ""}` : ""}`} emptyHint="아직 기록된 ZAP 요청이 없습니다." />}
          />
        </TabsContent>

        <TabsContent value="llm" className={recordFocused ? "mt-0 min-h-0" : "mt-2"}>
          <LlmPass onRecordFocusChange={setRecordFocused} datasetRevision={snapshot.data?.datasetRevision ?? snapshot.data?.identityRevision ?? 0} target={target} accounts={targetAccounts} />
        </TabsContent>

        <TabsContent value="review" className="mt-2">
          <section className="grid gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
            <div><h2 className="text-base font-semibold">결과 비교</h2><p className="mt-0.5 text-sm text-muted-foreground">Human·ZAP·LLM이 각각 찾은 API와 입력을 비교합니다.</p></div>
            <div className="flex flex-wrap gap-2"><Button onClick={() => { window.location.hash = "#surface" }}>API·입력 차이 보기</Button></div>
          </section>
        </TabsContent>
      </Tabs>

      <AccountSettingsSheet
        zapRuntimeAvailable={zap.data ? (zap.data.managedRuntime ?? zap.data.connected) : false}
        accountId={settings?.id ?? null}
        initialTab={settings?.tab ?? "basic"}
        adapter={settingsAdapter}
        open={settings !== null}
        onOpenChange={(open) => { if (!open) setSettings(null) }}
        onSaved={() => { void snapshot.refetch(); void scanner.refetch() }}
        onDeleted={() => { setSettings(null); void snapshot.refetch(); void scanner.refetch() }}
      />
    </section></ReferenceAnalysisWorkspace>
  )
}
