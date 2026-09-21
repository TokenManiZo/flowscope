import { useEffect, useMemo, useState } from "react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useHumanRunMutation, useHumanRunQuery, useScannerCancelMutation, useScannerRunMutation, useScannerRunQuery, useSnapshotQuery, useZapAccountDeleteMutation, useZapAccountSaveMutation, useZapStatusQuery } from "@/lib/query/hooks"
import { activeManagedAccountIds, automaticInspectionStage, type InspectionStage } from "./inspectionState"
import { LlmPass } from "./LlmPass"
import { SourcePassLayout, type SourceFeedItem } from "./SourcePassLayout"

/** 점검 시작 허브의 소스 스텝. 범위는 상단 표시로 대체했다. */
export type InspectionStep = "human" | "scanner" | "llm" | "review"

const stepCopy: Record<InspectionStep, { title: string; message: string }> = {
  human: { title: "HUMAN pass", message: "HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요." },
  scanner: { title: "ZAP 기준선", message: "연결된 ZAP으로 범위 안의 신원별 기준선을 실행하세요." },
  llm: { title: "LLM 탐색", message: "Codex 준비를 확인한 뒤 LLM 탐색을 실행하세요." },
  review: { title: "Evidence 검토", message: "HUMAN·ZAP·LLM 기록과 API·입력 차이를 확인하세요. 전체 탐색 완료를 뜻하지 않습니다." },
}

const ANONYMOUS_HUMAN_ACCOUNT = "__flowscope_anonymous__"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다."
}

function stepNumber(step: InspectionStep): number {
  return { human: 1, scanner: 2, llm: 3, review: 4 }[step]
}

function stepFromStage(stage: InspectionStage): InspectionStep {
  return stage === "scope" ? "human" : stage
}

function OpenRunsButton() {
  return <Button variant="outline" onClick={() => { window.location.hash = "#runs" }}>전체 실행 상태 열기</Button>
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

function duration(seconds?: number): string {
  if (seconds === undefined || seconds < 0) return "확인 전"
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes > 0 ? `${minutes}분 ${remainder}초` : `${remainder}초`
}

function age(seconds?: number): string {
  return seconds === undefined || seconds < 0 ? "확인 전" : `${duration(seconds)} 전`
}

function scannerStage(stage?: string): string {
  return {
    SESSION_SETUP: "격리 세션 설정",
    API_DEFINITION_IMPORT: "API 정의 가져오기",
    AUTHENTICATION: "ZAP 브라우저 로그인",
    CLIENT_SPIDER: "Client Spider",
    PASSIVE_SCAN_QUEUE: "Passive Scan 대기",
    ALERTS_READY: "Alert 집계 완료",
    CLEANUP: "종료 처리 · 임시 상태 정리 중",
    CANCELLED: "검사 취소",
    FAILED: "실패",
  }[stage ?? ""] ?? stage ?? "대기"
}

export function InspectionPage({ humanFeedItems }: { humanFeedItems?: readonly SourceFeedItem[] } = {}) {
  const snapshot = useSnapshotQuery()
  const human = useHumanRunQuery()
  const zap = useZapStatusQuery()
  const scanner = useScannerRunQuery()
  const humanMutation = useHumanRunMutation()
  const scannerMutation = useScannerRunMutation()
  const scannerCancel = useScannerCancelMutation()
  const zapAccountSave = useZapAccountSaveMutation()
  const zapAccountDelete = useZapAccountDeleteMutation()
  const [manualStep, setManualStep] = useState<InspectionStep | null>(null)
  const [target, setTarget] = useState("")
  const [humanAccount, setHumanAccount] = useState(ANONYMOUS_HUMAN_ACCOUNT)
  const [anonymous, setAnonymous] = useState(false)
  const [selectedAccounts, setSelectedAccounts] = useState<readonly string[]>([])
  const [zapDefinitions, setZapDefinitions] = useState("")
  const [zapLabel, setZapLabel] = useState("")
  const [zapRole, setZapRole] = useState("USER")
  const [zapLoginUrl, setZapLoginUrl] = useState("")
  const [zapUsername, setZapUsername] = useState("")
  const [zapPassword, setZapPassword] = useState("")

  const scope = scanner.data?.scope ?? []
  useEffect(() => {
    if (!target && scope[0]) setTarget(scope[0])
  }, [scope, target])

  const automaticStep = stepFromStage(automaticInspectionStage(scope, human.data, scanner.data))
  const selectedStep = manualStep ?? automaticStep
  const humanAccounts = useMemo(() => {
    const ids = activeManagedAccountIds(target, snapshot.data?.managedSessions ?? [])
    const labels = new Map((snapshot.data?.managedSessions ?? []).map((session) => [session.accountId, session.accountLabel]))
    return ids.map((id) => ({ id, label: labels.get(id) ?? id }))
  }, [snapshot.data?.managedSessions, target])
  const humanAccountIds = humanAccounts.map((account) => account.id)
  const scannerAccounts = useMemo(() => (scanner.data?.accounts ?? []).filter((account) =>
    normalizedOrigin(account.service) === normalizedOrigin(target)), [scanner.data?.accounts, target])
  const scannerAccountIds = scannerAccounts.map((account) => account.id)
  const targetInScope = target !== "" && scope.includes(target)
  const scannerRunning = scanner.data?.run.status === "RUNNING"
  const scannerCleaning = scannerRunning && scanner.data?.run.stage === "CLEANUP"
  const zapCanStart = zap.data?.connected === true && targetInScope && (anonymous || selectedAccounts.length > 0) && !scannerRunning && !scannerMutation.isPending
  const humanCanStart = human.data !== undefined && !human.data.active && !humanMutation.isPending
  const humanCanEnd = human.data?.active === true && human.data.runId.trim() !== "" && !humanMutation.isPending
  const scannerDisabledReason = !zap.data?.connected
    ? "ZAP 연결을 먼저 확인하세요."
    : !targetInScope
      ? "현재 scanner scope에 정확히 포함된 대상을 선택하세요."
      : !anonymous && selectedAccounts.length === 0
        ? "비로그인 또는 하나 이상의 활성 계정을 선택하세요."
        : ""

  const removeUnavailableAccounts = (ids: readonly string[]) => ids.filter((id) => scannerAccountIds.includes(id))
  useEffect(() => {
    setSelectedAccounts((current) => removeUnavailableAccounts(current))
    if (humanAccount !== ANONYMOUS_HUMAN_ACCOUNT && !humanAccountIds.includes(humanAccount)) {
      setHumanAccount(ANONYMOUS_HUMAN_ACCOUNT)
    }
  }, [scannerAccountIds.join(","), humanAccountIds.join(","), humanAccount])

  const humanSummary = human.data ? human.data.active ? "진행 중" : human.data.completed ? "완료" : "대기" : human.isPending ? "불러오는 중" : "상태 확인 필요"
  const humanCardStatus = human.data ? human.data.active ? `실행 중 · ${human.data.accountId || "비로그인"}` : human.data.completed ? "COMPLETED · HUMAN lane 완료" : "NOT_STARTED · HUMAN pass 대기" : `HUMAN 상태 · ${humanSummary}`
  const queryError = human.isError
    ? { error: human.error, hasLastSuccess: human.data !== undefined }
    : zap.isError
      ? { error: zap.error, hasLastSuccess: zap.data !== undefined }
      : scanner.isError
        ? { error: scanner.error, hasLastSuccess: scanner.data !== undefined }
        : undefined

  // HUMAN 작업 피드 = Burp proxy history로 기록된 HUMAN 소스 관측(events). 서버 값만 옮기며 최근순으로 상한을 둔다.
  const humanFeed = useMemo<readonly SourceFeedItem[]>(() => {
    if (humanFeedItems !== undefined) return humanFeedItems
    return (snapshot.data?.events ?? [])
      .filter((event) => event.source === "human")
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 200)
      .map((event) => ({ id: event.eventId, badge: event.method, title: event.path, status: String(event.status), detail: `${event.idn} · ${event.op}` }))
  }, [humanFeedItems, snapshot.data?.events])

  const scannerFeedItems: readonly SourceFeedItem[] = (scanner.data?.run.lanes ?? []).map((lane) => ({
    id: lane.account_id ?? "anonymous",
    badge: lane.account_id ? "ACCOUNT" : "ANON",
    title: lane.account_label,
    status: lane.status,
    detail: [
      `${scannerStage(lane.stage)} · 경과 ${duration(lane.elapsed_seconds)} · 수집 ${lane.captured_records}건`,
      lane.account_id ? `로그인 ${lane.authentication_state ?? "UNKNOWN"}${lane.authentication_browser ? ` · ${lane.authentication_browser}` : ""}` : "",
      lane.authentication_message,
      lane.warning ? `주의 · ${lane.warning}` : "",
      lane.error ? `오류 · ${lane.error}` : "",
    ].filter(Boolean).join(" · "),
  }))

  return (
    <ReferenceAnalysisWorkspace ariaLabel="점검 시작 작업 영역" context={null} inspector={null}><section className="space-y-4 p-3" aria-labelledby="inspection-title">
      <div className="space-y-2">
        <h1 id="inspection-title" className="text-2xl font-semibold">점검 시작</h1>
        <dl role="group" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-border/70 bg-background/30 px-3 py-2 text-sm" aria-label="점검 범위">
          <dt className="text-muted-foreground">범위</dt>
          <dd className="font-mono break-all">{scope.length ? scope.join(" · ") : "적용된 scope 없음"}</dd>
          <dd className="text-xs text-muted-foreground">범위 변경은 프로젝트에서 새 진단을 시작할 때만 가능합니다.</dd>
        </dl>
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
      {zapAccountSave.isError && <Alert variant="destructive" aria-label={errorMessage(zapAccountSave.error)}><AlertDescription>{errorMessage(zapAccountSave.error)}</AlertDescription></Alert>}
      {zapAccountDelete.isError && <Alert variant="destructive" aria-label={errorMessage(zapAccountDelete.error)}><AlertDescription>{errorMessage(zapAccountDelete.error)}</AlertDescription></Alert>}

      <Card>
        <CardHeader>
          <CardTitle>{stepCopy[automaticStep].title}</CardTitle>
          <CardDescription>{stepCopy[automaticStep].message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground" role="status">현재 단계 {stepNumber(automaticStep)}/4 · 단계 번호는 완료율이 아닙니다.</p>
          <div className="flex flex-wrap items-center justify-between gap-2" role="status">
            <p>{stepCopy[selectedStep].message}</p>
            <Button variant="outline" onClick={() => setManualStep(null)}>현재 단계로</Button>
          </div>
        </CardContent>
      </Card>

      <Tabs value={selectedStep} onValueChange={(value) => setManualStep(value as InspectionStep)}>
        <TabsList aria-label="점검 진행 단계" className="h-auto flex-wrap">
          <TabsTrigger value="human">1 · HUMAN</TabsTrigger>
          <TabsTrigger value="scanner">2 · ZAP</TabsTrigger>
          <TabsTrigger value="llm">3 · LLM</TabsTrigger>
          <TabsTrigger value="review">4 · Evidence 검토</TabsTrigger>
        </TabsList>

        <TabsContent value="human">
          <SourcePassLayout
            label="HUMAN pass"
            title="HUMAN pass"
            description="선택은 표시 라벨이 아니라 ACTIVE Session Broker 계정의 검증 조건입니다."
            statusTiles={[
              { label: "상태", value: humanSummary },
              { label: "run", value: human.data?.runId || "없음", mono: true },
              { label: "신원", value: human.data?.active ? human.data.accountId || "비로그인" : "대기" },
              { label: "Proxy", value: human.data?.proxy || "확인 전", mono: true },
            ]}
            control={<div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-sm" htmlFor="human-account">HUMAN pass 계정
                <Select value={humanAccount} onValueChange={setHumanAccount} disabled={!humanCanStart}>
                  <SelectTrigger id="human-account" aria-label="HUMAN pass 계정"><SelectValue placeholder="비로그인 pass" /></SelectTrigger>
                  <SelectContent><SelectItem value={ANONYMOUS_HUMAN_ACCOUNT}>비로그인 pass</SelectItem>{humanAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.label}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <Button disabled={!humanCanStart} onClick={() => humanMutation.mutate({
                action: "begin",
                account: humanAccount === ANONYMOUS_HUMAN_ACCOUNT ? "" : humanAccount,
              })}>HUMAN pass 시작</Button>
              <Button variant="outline" disabled={!humanCanEnd} title={!humanCanEnd ? "현재 HUMAN run ID가 있을 때만 종료할 수 있습니다." : undefined} onClick={() => {
                if (human.data?.runId.trim()) humanMutation.mutate({ action: "end", runId: human.data.runId })
              }}>HUMAN pass 종료</Button>
              <p className="w-full text-sm text-muted-foreground">{humanCardStatus}</p>
              <OpenRunsButton />
            </div>}
            feedItems={humanFeed}
            feedTitle="작업 피드"
            feedDescription="HUMAN pass 중 Burp proxy history로 기록된 요청이 순서대로 표시됩니다."
            emptyHint="HUMAN pass를 시작하면 기록된 요청이 여기에 표시됩니다."
          />
        </TabsContent>

        <TabsContent value="scanner">
          <SourcePassLayout
            label="ZAP 기준선"
            title="ZAP 기준선"
            description="신원마다 새 ZAP 세션을 사용합니다. 기준선은 크롤링과 Passive 분석이며 Active Scan을 실행하지 않습니다."
            statusTiles={[
              { label: "상태", value: scanner.data?.run.status ?? "NOT_STARTED" },
              { label: "소요 시간", value: duration(scanner.data?.run.elapsed_seconds), mono: true },
              { label: "수집 / Alert", value: `${scanner.data?.run.captured_records ?? "-"} / ${scanner.data?.run.alert_count ?? "-"}` },
              { label: "현재 단계", value: scannerStage(scanner.data?.run.stage) },
            ]}
            notices={<>
              {scanner.data?.run.warning && <Alert><AlertDescription>주의 · {scanner.data.run.warning}</AlertDescription></Alert>}
              {scanner.data?.run.error && <Alert variant="destructive"><AlertDescription>{scanner.data.run.error}</AlertDescription></Alert>}
            </>}
            control={<div className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-sm" htmlFor="scanner-target">대상
                  <Select value={target} onValueChange={setTarget}>
                    <SelectTrigger id="scanner-target" aria-label="ZAP 대상"><SelectValue placeholder="scope를 먼저 적용하세요" /></SelectTrigger>
                    <SelectContent>{scope.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                <Button variant="outline" onClick={() => void zap.refetch()} disabled={zap.isFetching}>ZAP 연결 새로 고침</Button>
                <span className="text-sm">{zap.data?.connected ? "연결됨" : zap.data?.state ?? "UNAVAILABLE"} · {zap.data?.message ?? "연결 상태 확인 중"}</span>
              </div>
              <p role="status" aria-label="ZAP 기준선 상태">{scanner.data?.run.status ?? "NOT_STARTED"} · 수집 {scanner.data?.run.captured_records ?? "-"}건 · Alert {scanner.data?.run.alert_count ?? "-"}건</p>
              <p className="text-sm text-muted-foreground">작업 상태 {scanner.data?.run.activity_state ?? "확인 전"} · 신호 {age(scanner.data?.run.last_heartbeat_age_seconds)}{scanner.data?.run.run_id ? ` · run ${scanner.data.run.run_id}` : ""}</p>
              <fieldset className="space-y-2"><legend className="text-sm font-medium">실행 신원</legend>
                <label className="flex items-center gap-2"><Checkbox id="scanner-anonymous" checked={anonymous} onCheckedChange={(checked) => setAnonymous(checked === true)} /><span>비로그인</span></label>
                {scannerAccounts.map((account) => <div className="flex flex-wrap items-center gap-2" key={account.id}><label className="flex items-center gap-2"><Checkbox id={`scanner-${account.id}`} checked={selectedAccounts.includes(account.id)} onCheckedChange={(checked) => setSelectedAccounts((current) => checked === true ? [...current, account.id] : current.filter((id) => id !== account.id))} /><span>{account.label} · {account.role} · {account.status}</span></label><Button type="button" size="sm" variant="ghost" disabled={scannerRunning || zapAccountDelete.isPending} onClick={() => zapAccountDelete.mutate(account.id)}>자격증명 폐기</Button>{account.message && <span className="w-full pl-6 text-xs text-muted-foreground">{account.message}</span>}<span className="w-full pl-6 text-xs text-muted-foreground">인증 검증 · ZAP 자동 판정 + 재사용 세션 연결</span></div>)}
                {!scannerAccounts.length && <p className="text-sm text-muted-foreground">현재 target에 등록된 ZAP 로그인 계정이 없습니다.</p>}
              </fieldset>
              <section className="grid gap-3 rounded-lg border border-border/70 bg-background/30 p-3" aria-label="ZAP 로그인 계정 등록">
                <div><p className="font-medium">ZAP 브라우저 로그인 계정</p><p className="text-xs text-muted-foreground">모든 lane은 bundle이 제공하는 Docker Chromium Client Spider로 실행됩니다. ID·비밀번호는 Burp 메모리에서 ZAP의 휘발성 tmpfs 작업공간으로 전송되며 프로젝트·Evidence·로그에는 저장하지 않습니다.</p></div>
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="grid gap-1 text-sm">계정 이름<Input value={zapLabel} onChange={(event) => setZapLabel(event.target.value)} autoComplete="off" /></label>
                  <label className="grid gap-1 text-sm">역할<Select value={zapRole} onValueChange={setZapRole}><SelectTrigger aria-label="ZAP 계정 역할"><SelectValue /></SelectTrigger><SelectContent>{["USER", "LV1", "LV2", "ADMIN", "UNKNOWN"].map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent></Select></label>
                  <label className="grid gap-1 text-sm md:col-span-2">로그인 URL<Input value={zapLoginUrl} onChange={(event) => setZapLoginUrl(event.target.value)} placeholder={target ? `${normalizedOrigin(target)}/login` : "https://target.example/login"} autoComplete="off" /></label>
                  <label className="grid gap-1 text-sm">로그인 ID<Input value={zapUsername} onChange={(event) => setZapUsername(event.target.value)} autoComplete="username" /></label>
                  <label className="grid gap-1 text-sm">비밀번호<Input type="password" value={zapPassword} onChange={(event) => setZapPassword(event.target.value)} autoComplete="new-password" /></label>
                </div>
                <p className="text-xs text-muted-foreground">로그인 성공은 ZAP의 인증 결과와 실제 재사용 세션 연결을 함께 확인합니다. 실패하면 ANON으로 대체하지 않고 해당 계정을 FAILED로 표시하며 검사를 시작하지 않습니다.</p>
                <Button type="button" variant="outline" disabled={!targetInScope || !zapLabel.trim() || !zapLoginUrl.trim() || !zapUsername || !zapPassword || zapAccountSave.isPending || scannerRunning} onClick={() => zapAccountSave.mutate({ id: "", label: zapLabel, role: zapRole, service: normalizedOrigin(target), loginUrl: zapLoginUrl, username: zapUsername, password: zapPassword }, { onSuccess: () => { setZapLabel(""); setZapLoginUrl(""); setZapUsername(""); setZapPassword("") } })}>로그인 계정 등록</Button>
              </section>
              <details className="rounded-lg border border-border/70 bg-background/30 p-3">
                <summary className="cursor-pointer text-sm font-medium">명세 기반 탐색 추가 (선택)</summary>
                <label className="mt-3 grid gap-1 text-sm" htmlFor="scanner-definitions">exact-scope API 정의
                  <textarea id="scanner-definitions" className="min-h-28 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm" value={zapDefinitions} onChange={(event) => setZapDefinitions(event.target.value)} spellCheck={false} placeholder={"OPENAPI https://target/openapi.json\nGRAPHQL https://target/graphql [schema URL]\nPOSTMAN 또는 SOAP https://target/definition"} />
                </label>
                <p className="mt-2 text-xs text-muted-foreground">이미 알고 있는 정의만 입력합니다. 명세 import가 상태 변경 요청을 만들 수 있어 Burp 승인창에서 다시 확인합니다.</p>
              </details>
              {!zapCanStart && <p className="text-sm text-muted-foreground">{scannerDisabledReason}</p>}
              <div className="flex flex-wrap gap-2">
                <Button disabled={!zapCanStart} onClick={() => scannerMutation.mutate({ target, anonymous, accounts: selectedAccounts.join(","), definitions: zapDefinitions })}>신원별 격리 ZAP 기준선 시작</Button>
                <Button variant="outline" disabled={!scannerRunning || scannerCleaning || scannerCancel.isPending} onClick={() => scannerCancel.mutate()}>ZAP 검사 취소</Button>
                <OpenRunsButton />
              </div>
            </div>}
            feedItems={scannerFeedItems}
            feedTitle="작업 피드"
            feedDescription={`${scannerStage(scanner.data?.run.stage)} · 현재 단계 ${duration(scanner.data?.run.stage_elapsed_seconds)}${scanner.data?.run.stage_timeout_seconds ? ` / 최대 ${duration(scanner.data.run.stage_timeout_seconds)}` : ""}`}
            emptyHint="기준선을 시작하면 신원별 lane 진행이 여기에 표시됩니다."
          />
        </TabsContent>

        <TabsContent value="llm">
          <LlmPass target={target} />
        </TabsContent>

        <TabsContent value="review">
          <Card><CardHeader><CardTitle>Evidence 검토</CardTitle><CardDescription>Judge 없이 실제 HUMAN·ZAP·LLM Evidence를 비교합니다.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><Button onClick={() => { window.location.hash = "#surface" }}>API·입력 차이 보기</Button><Button variant="outline" onClick={() => setManualStep("llm")}>LLM 단계 열기</Button></CardContent></Card>
        </TabsContent>
      </Tabs>

      <Accordion type="single" collapsible>
        <AccordionItem value="safety"><AccordionTrigger>실행 안전 경계</AccordionTrigger><AccordionContent>대상은 현재 scanner scope와 정확히 같아야 하며, ZAP 연결과 신원 선택을 모두 확인한 뒤에만 기준선을 시작합니다.</AccordionContent></AccordionItem>
      </Accordion>
    </section></ReferenceAnalysisWorkspace>
  )
}
