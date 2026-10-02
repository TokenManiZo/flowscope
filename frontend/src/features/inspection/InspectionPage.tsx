import { accountObservations } from "@/lib/display/accountObservations"
import { evidenceOrdinalLabel } from "@/lib/display/operationLabel"
import { useEffect, useMemo, useState } from "react"
import { Check, Copy } from "lucide-react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useHumanRunMutation, useHumanRunQuery, useScannerCancelMutation, useScannerRunMutation, useScannerRunQuery, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"
import { cn } from "@/lib/utils"
import { automaticInspectionStage, clockTime, HUMAN_ACCOUNT_HANDOFF, humanPassAccounts, type InspectionStage } from "./inspectionState"
import { LlmPass } from "./LlmPass"
import { durationLabel, runStatusLabel, scannerStageLabel } from "@/lib/display/runStatus"
import { SourcePassLayout, type SourceFeedItem } from "./SourcePassLayout"
import { AccountSettingsSheet } from "@/features/accounts/account-settings/AccountSettingsSheet"
import { createAccountSettingsAdapter } from "@/features/accounts/account-settings/accountSettingsAdapter"
import { HumanRequestFeed } from "./HumanRequestFeed"
import { AccountLaneTable } from "./AccountLaneTable"

/** 점검 시작 허브의 소스 스텝. */
export type InspectionStep = "human" | "scanner" | "llm" | "review"

const inspectionSteps: readonly { step: InspectionStep; label: string }[] = [
  { step: "human", label: "1 · 직접 둘러보기" },
  { step: "scanner", label: "2 · ZAP 스캔" },
  { step: "llm", label: "3 · LLM 탐색" },
  { step: "review", label: "4 · 결과 비교" },
]

const ANONYMOUS_HUMAN_ACCOUNT = "__flowscope_anonymous__"
const RELEASES_URL = "https://github.com/choewonwoo1817/testflowscope/releases"
const ZAP_COMMANDS: ReadonlyArray<[string, string]> = [["macOS · Linux", "./scripts/zap-up.sh"], ["Windows", ".\\scripts\\zap-up.ps1"]]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다."
}

function stepFromStage(stage: InspectionStage): InspectionStep {
  return stage === "scope" ? "human" : stage
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

export function InspectionPage({ humanFeedItems }: { humanFeedItems?: readonly SourceFeedItem[] } = {}) {
  const snapshot = useSnapshotQuery()
  const human = useHumanRunQuery()
  const zap = useZapStatusQuery()
  const scanner = useScannerRunQuery()
  const humanMutation = useHumanRunMutation()
  const scannerMutation = useScannerRunMutation()
  const scannerCancel = useScannerCancelMutation()
  const [manualStep, setManualStep] = useState<InspectionStep | null>(null)
  const [target, setTarget] = useState("")
  const [humanAccount, setHumanAccount] = useState(ANONYMOUS_HUMAN_ACCOUNT)
  const [anonymous, setAnonymous] = useState(false)
  const [selectedAccounts, setSelectedAccounts] = useState<readonly string[]>([])
  const [zapDefinitions, setZapDefinitions] = useState("")
  const [showZapHowTo, setShowZapHowTo] = useState(false)
  const [settings, setSettings] = useState<{ id: string; tab: "zap" } | null>(null)
  const settingsAdapter = useMemo(() => createAccountSettingsAdapter(), [])

  const scope = scanner.data?.scope ?? []
  useEffect(() => {
    if (!target && scope[0]) setTarget(scope[0])
  }, [scope, target])

  // 계정·세션의 [이 계정으로 수집]이 넘긴 계정을 한 번만 받아 HUMAN 단계에 미리 고른다.
  useEffect(() => {
    let handoff: string | null = null
    try { handoff = sessionStorage.getItem(HUMAN_ACCOUNT_HANDOFF); sessionStorage.removeItem(HUMAN_ACCOUNT_HANDOFF) } catch { /* 저장소가 막히면 미리 선택을 생략한다. */ }
    if (handoff) { setHumanAccount(handoff); setManualStep("human") }
  }, [])

  const automaticStep = stepFromStage(automaticInspectionStage(scope, human.data, scanner.data))
  const selectedStep = manualStep ?? automaticStep
  // Open on the current step once, then stay put: finishing a pass must not move the operator to the next tab.
  // HUMAN state alone decides the first tab: a slow scanner status (ZAP down) must not delay the pin.
  const stepsLoaded = human.data !== undefined
  useEffect(() => {
    if (manualStep === null && stepsLoaded) setManualStep(automaticStep)
  }, [manualStep, stepsLoaded, automaticStep])

  const events = snapshot.data?.events ?? []
  const humanAccounts = useMemo(() => humanPassAccounts(scope, snapshot.data?.accounts ?? []), [snapshot.data?.accounts, scope])
  const humanAccountIds = humanAccounts.map((account) => account.id)
  const humanAccountLabel = humanAccounts.find((account) => account.id === human.data?.accountId)?.label ?? human.data?.accountId ?? ""
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
  const humanCanStart = human.data !== undefined && !human.data.active && !humanMutation.isPending
  const humanCanEnd = human.data?.active === true && human.data.runId.trim() !== "" && !humanMutation.isPending
  const scannerHint = !zapConnected ? "ZAP을 켜면 시작할 수 있습니다."
    : !targetInScope ? "scope에 포함된 대상이 없습니다."
      : !anonymous && selectedAccounts.length === 0 ? "비로그인 또는 계정을 하나 이상 고르세요."
        : `${(anonymous ? 1 : 0) + selectedAccounts.length}개 선택됨`

  useEffect(() => {
    setSelectedAccounts((current) => current.filter((id) => scannerAccountIds.includes(id)))
    // 계정 목록을 받기 전에는 넘겨받은 계정을 지우지 않는다.
    if (snapshot.data && humanAccount !== ANONYMOUS_HUMAN_ACCOUNT && !humanAccountIds.includes(humanAccount)) {
      setHumanAccount(ANONYMOUS_HUMAN_ACCOUNT)
    }
  }, [scannerAccountIds.join(","), humanAccountIds.join(","), humanAccount, snapshot.data])

  const queryError = human.isError
    ? { error: human.error, hasLastSuccess: human.data !== undefined }
    : zap.isError
      ? { error: zap.error, hasLastSuccess: zap.data !== undefined }
      : scanner.isError
        ? { error: scanner.error, hasLastSuccess: scanner.data !== undefined }
        : undefined

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
    const who = identityLabel(event.laneAccountId?.trim() || event.idn)
    return { id: event.eventId, ordinal: evidenceOrdinalLabel(snapshot.data?.evidenceOrdinals, event.eventId), badge: event.method, title: event.path, status: String(event.status), detail: who.label, mutedDetail: who.muted,
      time: event.timestamp ? clockTime(new Date(event.timestamp).toISOString()) : undefined }
  }

  // HUMAN 작업 피드 = Burp proxy history로 기록된 HUMAN 소스 관측(events). 서버 값만 옮기며 최근순으로 상한을 둔다.
  const humanFeed = useMemo<readonly SourceFeedItem[]>(() => {
    if (humanFeedItems !== undefined) return humanFeedItems
    return events
      .filter((event) => event.source === "human")
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 200)
      .map(feedItem)
  }, [humanFeedItems, events, identityLabel, snapshot.data?.evidenceOrdinals])

  // 계정별 HUMAN 수집 건수와 마지막 기록 시각. 비로그인 기록은 anon 신원으로 모인다.
  const humanProgress = useMemo(() => {
    const rows = [...humanAccounts.map((account) => ({ id: account.id, label: account.label })), { id: "anon", label: "비로그인" }]
    const totals = accountObservations(events, rows.map((row) => row.id))
    return rows.map((row) => {
      const observations = totals.get(row.id)!
      const last = observations.last.human
      return { ...row, count: observations.counts.human, last: last ? clockTime(new Date(last).toISOString()) : "—" }
    })
  }, [humanAccounts, events])

  // ZAP 작업 피드 = SCANNER 소스로 관측된 요청. HUMAN과 같은 표를 쓴다.
  const scannerFeedItems = useMemo<readonly SourceFeedItem[]>(() => events
    .filter((event) => event.source === "scanner")
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 200)
    .map(feedItem),
    [events, identityLabel, snapshot.data?.evidenceOrdinals])


  // 서버는 실제 Burp 리스너를 찾기 전에는 주소 대신 안내 문구를 보낸다(#25). 그때는 주소를 지어내지 않는다.
  const humanProxyLabel = /^https?:\/\//.test(human.data?.proxy ?? "") ? `프록시 ${human.data!.proxy.replace(/^https?:\/\//, "")}` : "Burp 프록시"
  const humanStatus = !human.data ? human.isPending ? "불러오는 중" : "상태 확인 필요"
    : human.data.active ? `${humanAccountLabel || "비로그인"} 기록 중`
      : human.data.completed ? "완료" : "대기 중"

  return (
    <ReferenceAnalysisWorkspace ariaLabel="점검 시작 작업 영역" context={null} inspector={null}><section className="space-y-4 p-3" aria-labelledby="inspection-title">
      <div>
        <h1 id="inspection-title" className="text-2xl font-semibold">점검 시작</h1>
        <p role="group" className="mt-1 text-sm text-muted-foreground" aria-label="점검 범위">대상 <span className="font-mono text-foreground">{scope.length ? scope.map(displayOrigin).join(" · ") : "없음 · 프로젝트에서 새 진단을 만들 때 정합니다"}</span></p>
      </div>

      {queryError && (
        <Alert variant="destructive" aria-label={errorMessage(queryError.error)}>
          <AlertTitle>{queryError.hasLastSuccess ? "마지막 성공 상태를 표시하고 있습니다." : "상태를 가져오지 못했습니다. 확인이 필요합니다."}</AlertTitle>
          <AlertDescription>{errorMessage(queryError.error)}</AlertDescription>
        </Alert>
      )}
      {humanMutation.isError && <Alert variant="destructive" aria-label={errorMessage(humanMutation.error)}><AlertDescription>{errorMessage(humanMutation.error)}</AlertDescription></Alert>}
      {scannerMutation.isError && <Alert variant="destructive" aria-label={errorMessage(scannerMutation.error)}><AlertDescription>{errorMessage(scannerMutation.error)}</AlertDescription></Alert>}
      {scannerCancel.isError && <Alert variant="destructive" aria-label={errorMessage(scannerCancel.error)}><AlertDescription>{errorMessage(scannerCancel.error)}</AlertDescription></Alert>}

      <Tabs value={selectedStep} onValueChange={(value) => setManualStep(value as InspectionStep)}>
        <TabsList aria-label="점검 진행 단계" className="h-auto flex-wrap">
          {inspectionSteps.map(({ step, label }) => <TabsTrigger key={step} value={step}>{label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="human" className="mt-2">
          <SourcePassLayout
            label="HUMAN"
            title="직접 둘러보기"
            description={`계정을 고르고 시작한 뒤, ${humanProxyLabel} 브라우저로 서비스를 사용하세요.`}
            notices={human.data?.otherListenerRequests ? <Alert><AlertDescription>
              다른 포트 {human.data.otherListenerPort}에서 범위 안 요청 {human.data.otherListenerRequests}건이 들어왔어요. 이 요청은 이번 수집에 넣지 않았어요.
            </AlertDescription></Alert> : undefined}
            control={<div className="grid gap-4">
              <div className="grid gap-1.5">
                <span className="text-xs text-muted-foreground" id="human-account-label">수집할 계정</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={human.data?.active ? human.data.accountId || ANONYMOUS_HUMAN_ACCOUNT : humanAccount} onValueChange={setHumanAccount} disabled={!humanCanStart}>
                    <SelectTrigger id="human-account" aria-label="HUMAN pass 계정" className="w-56"><SelectValue placeholder="비로그인" /></SelectTrigger>
                    <SelectContent><SelectItem value={ANONYMOUS_HUMAN_ACCOUNT}>비로그인</SelectItem>{humanAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button disabled={!humanCanStart} onClick={() => humanMutation.mutate({
                    action: "begin",
                    account: humanAccount === ANONYMOUS_HUMAN_ACCOUNT ? "" : humanAccount,
                  })} aria-label="HUMAN pass 시작">시작</Button>
                  <Button variant="outline" disabled={!humanCanEnd} onClick={() => {
                    if (human.data?.runId.trim()) humanMutation.mutate({ action: "end", runId: human.data.runId })
                  }} aria-label="HUMAN pass 종료">종료</Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">계정 선택 → 시작 → 서비스 탐색 → 종료. 계정을 바꾸기 전에 종료하세요.</p>
              <p className="flex items-center gap-2 text-sm" aria-label="HUMAN 상태"><span aria-hidden="true" className={cn("size-1.5 rounded-full", human.data?.active ? "bg-emerald-500" : "bg-muted-foreground/40")} /><span className="font-medium">{humanStatus}</span><span className="text-muted-foreground">· 다른 계정은 종료 후 다시 시작</span></p>
            </div>}
            aside={<section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-label="계정별 수집">
              <h3 className="mb-2 text-sm font-semibold">계정별 수집</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-muted-foreground"><th className="py-1.5 text-left font-normal">계정</th><th className="py-1.5 text-right font-normal">요청</th><th className="py-1.5 text-right font-normal">마지막</th></tr></thead>
                <tbody>{humanProgress.map((row) => <tr key={row.id} className="border-t border-border"><td className={cn("py-2", row.id === "anon" && "text-muted-foreground")}>{row.label}</td><td className="py-2 text-right tabular-nums">{row.count}</td><td className="py-2 text-right font-mono tabular-nums text-muted-foreground">{row.last}</td></tr>)}</tbody>
              </table>
            </section>}
            feedItems={humanFeed}
            feedTitle="기록된 요청"
            emptyHint="시작하면 기록된 요청이 여기에 표시됩니다."
            feedContent={<HumanRequestFeed items={humanFeed} emptyHint="시작하면 기록된 요청이 여기에 표시됩니다." />}
          />
        </TabsContent>

        <TabsContent value="scanner" className="mt-2">
          <SourcePassLayout
            label="ZAP"
            title="ZAP 스캔"
            description="사람이 놓친 API를 스캐너로 찾습니다. 선택한 계정마다 따로 스캔합니다."
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
                  <span className="flex-1">ZAP이 꺼져 있습니다. ZAP 없이도 직접 둘러보기·LLM은 쓸 수 있습니다.</span>
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
              <div className="grid gap-1.5"><span className="text-xs text-muted-foreground">스캔할 계정</span>
                <AccountLaneTable lane="ZAP" rows={targetAccounts.map((account) => ({ id: account.id, label: account.label, configured: scannerAccountIds.includes(account.id) }))}
                  anonymous={anonymous} onAnonymousChange={setAnonymous} selected={selectedAccounts}
                  onToggle={(id, value) => setSelectedAccounts((current) => value ? [...current, id] : current.filter((item) => item !== id))}
                  onSettings={(id) => setSettings({ id, tab: "zap" })} disabled={!zapConnected || scannerRunning} />
              </div>
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
            feedTitle="기록된 요청"
            feedDescription={scannerStarted ? `${scannerStageLabel(scanner.data?.run.stage)} · 현재 단계 ${durationLabel(scanner.data?.run.stage_elapsed_seconds)}${scanner.data?.run.stage_timeout_seconds ? ` / 최대 ${durationLabel(scanner.data.run.stage_timeout_seconds)}` : ""}` : undefined}
            emptyHint="스캔을 시작하면 ZAP이 기록한 요청이 여기에 표시됩니다."
            feedContent={<HumanRequestFeed items={scannerFeedItems} searchLabel="ZAP 작업 피드 검색" description={scannerStarted ? `${scannerStageLabel(scanner.data?.run.stage)} · 현재 단계 ${durationLabel(scanner.data?.run.stage_elapsed_seconds)}${scanner.data?.run.stage_timeout_seconds ? ` / 최대 ${durationLabel(scanner.data.run.stage_timeout_seconds)}` : ""}` : undefined} emptyHint="스캔을 시작하면 ZAP이 기록한 요청이 여기에 표시됩니다." />}
          />
        </TabsContent>

        <TabsContent value="llm" className="mt-2">
          <LlmPass target={target} accounts={targetAccounts} />
        </TabsContent>

        <TabsContent value="review" className="mt-2">
          <section className="grid gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
            <div><h2 className="text-base font-semibold">결과 비교</h2><p className="mt-0.5 text-sm text-muted-foreground">사람·ZAP·LLM이 각각 찾은 API와 입력을 비교합니다.</p></div>
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
