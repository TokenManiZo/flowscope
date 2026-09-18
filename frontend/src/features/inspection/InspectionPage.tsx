import { useEffect, useMemo, useState, type ReactNode } from "react"

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

const stageCopy: Record<InspectionStage, { title: string; message: string }> = {
  scope: { title: "범위를 확인하세요", message: "허가된 exact scope를 Burp FlowScope 탭에서 적용하세요." },
  human: { title: "HUMAN pass", message: "HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요." },
  scanner: { title: "ZAP 기준선", message: "연결된 ZAP으로 범위 안의 신원별 기준선을 실행하세요." },
  review: { title: "Evidence 검토", message: "HUMAN·ZAP 기록과 API·입력 차이를 확인하세요. 전체 탐색 완료를 뜻하지 않습니다." },
}

const ANONYMOUS_HUMAN_ACCOUNT = "__flowscope_anonymous__"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다."
}

function stageNumber(stage: InspectionStage): number {
  return { scope: 1, human: 2, scanner: 3, review: 4 }[stage]
}

function StageWorkspace({ label, title, description, setup, status }: { label: string; title: string; description: string; setup: ReactNode; status: ReactNode }) {
  return <Card className="border-border/70 bg-card/70">
    <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
    <CardContent>
      <Tabs defaultValue="setup">
        <TabsList aria-label={`${label} 실행 보기`} className="mb-4 grid h-auto w-full max-w-sm grid-cols-2"><TabsTrigger value="setup">실행 설정</TabsTrigger><TabsTrigger value="status">실행 상태</TabsTrigger></TabsList>
        <TabsContent value="setup" className="mt-0">{setup}</TabsContent>
        <TabsContent value="status" className="mt-0">{status}</TabsContent>
      </Tabs>
    </CardContent>
  </Card>
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

export function InspectionPage() {
  const snapshot = useSnapshotQuery()
  const human = useHumanRunQuery()
  const zap = useZapStatusQuery()
  const scanner = useScannerRunQuery()
  const humanMutation = useHumanRunMutation()
  const scannerMutation = useScannerRunMutation()
  const scannerCancel = useScannerCancelMutation()
  const zapAccountSave = useZapAccountSaveMutation()
  const zapAccountDelete = useZapAccountDeleteMutation()
  const [manualStage, setManualStage] = useState<InspectionStage | null>(null)
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

  const automaticStage = automaticInspectionStage(scope, human.data, scanner.data)
  const selectedStage = manualStage ?? automaticStage
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
  const context = <section className="grid gap-3 p-3"><div><h2 className="text-sm font-semibold">현재 점검 단계</h2><p className="text-xs text-muted-foreground">자동 상태는 현재 scope와 실행 결과에서만 계산합니다.</p></div><dl className="grid gap-2 text-sm"><div className="flex justify-between gap-2"><dt>현재 단계</dt><dd>{stageCopy[automaticStage].title}</dd></div><div className="flex justify-between gap-2"><dt>적용 scope</dt><dd className="font-mono">{scope.length}</dd></div><div className="flex justify-between gap-2"><dt>HUMAN</dt><dd>{humanSummary}</dd></div><div className="flex justify-between gap-2"><dt>ZAP</dt><dd>{scanner.data?.run.status ?? "상태 없음"}</dd></div></dl></section>

  return (
    <ReferenceAnalysisWorkspace ariaLabel="점검 시작 작업 영역" context={context} inspector={null}><section className="space-y-4 p-3" aria-labelledby="inspection-title">
      <div>
        <h1 id="inspection-title" className="text-2xl font-semibold">점검 시작</h1>
        <p className="text-sm text-muted-foreground">범위 → HUMAN → ZAP → Evidence 검토 순서로 각각의 Evidence를 분리합니다.</p>
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
          <CardTitle>{stageCopy[automaticStage].title}</CardTitle>
          <CardDescription>{stageCopy[automaticStage].message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground" role="status">현재 단계 {stageNumber(automaticStage)}/4 · 단계 번호는 완료율이 아닙니다.</p>
          <div className="flex flex-wrap items-center justify-between gap-2" role="status">
            <p>{stageCopy[selectedStage].message}</p>
            <Button variant="outline" onClick={() => setManualStage(null)}>현재 단계로</Button>
          </div>
        </CardContent>
      </Card>

      <Tabs value={selectedStage} onValueChange={(value) => setManualStage(value as InspectionStage)}>
        <TabsList aria-label="점검 진행 단계" className="h-auto flex-wrap">
          <TabsTrigger value="scope">1 · 범위</TabsTrigger>
          <TabsTrigger value="human">2 · HUMAN</TabsTrigger>
          <TabsTrigger value="scanner">3 · ZAP</TabsTrigger>
          <TabsTrigger value="review">4 · Evidence 검토</TabsTrigger>
        </TabsList>
        <TabsContent value="scope">
          <StageWorkspace
            label="범위"
            title="허가된 exact scope"
            description="대상 실행 전 Burp FlowScope 탭에서 범위를 적용합니다."
            setup={scope.length ? <ul className="list-disc space-y-1 pl-5">{scope.map((value) => <li className="break-all" key={value}>{value}</li>)}</ul> : <p>아직 적용된 scope가 없습니다.</p>}
            status={<section className="grid gap-3" aria-label="범위 실행 상태"><div className="grid gap-1 rounded-lg border border-border/70 bg-background/30 p-3"><p className="font-medium">Scope 상태 · {scope.length ? "READY" : "미설정"}</p><p className="text-sm text-muted-foreground">적용된 exact scope {scope.length}개</p></div>{scope.length > 0 && <ul className="grid gap-1 text-sm text-muted-foreground">{scope.map((value) => <li className="break-all" key={value}>{value}</li>)}</ul>}<OpenRunsButton /></section>}
          />
        </TabsContent>
        <TabsContent value="human">
          <StageWorkspace
            label="HUMAN pass"
            title="HUMAN pass"
            description="선택은 표시 라벨이 아니라 ACTIVE Session Broker 계정의 검증 조건입니다."
            setup={<div className="flex flex-wrap items-end gap-2">
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
            </div>}
            status={<section className="grid gap-3" aria-label="HUMAN 실행 상태"><div className="grid gap-1 rounded-lg border border-border/70 bg-background/30 p-3"><p className="font-medium">HUMAN 상태 · {humanSummary}</p><p className="text-sm text-muted-foreground">{human.data?.active ? `run ${human.data.runId || "식별자 없음"} · ${human.data.accountId || "비로그인"}` : human.data?.completed ? "HUMAN lane 수집 완료" : "현재 실행 중인 HUMAN pass가 없습니다."}</p>{human.data?.proxy && <p className="font-mono text-xs text-muted-foreground">Proxy {human.data.proxy}</p>}</div><OpenRunsButton /></section>}
          />
        </TabsContent>
        <TabsContent value="scanner">
          <StageWorkspace
            label="ZAP 기준선"
            title="ZAP 기준선"
            description="신원마다 새 ZAP 세션을 사용합니다. 기준선은 크롤링과 Passive 분석이며 Active Scan을 실행하지 않습니다."
            setup={<div className="space-y-4">
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
              {scanner.data?.run.warning && <Alert><AlertDescription>주의 · {scanner.data.run.warning}</AlertDescription></Alert>}
              {scanner.data?.run.error && <Alert variant="destructive"><AlertDescription>{scanner.data.run.error}</AlertDescription></Alert>}
              <fieldset className="space-y-2"><legend className="text-sm font-medium">실행 신원</legend>
                <label className="flex items-center gap-2"><Checkbox id="scanner-anonymous" checked={anonymous} onCheckedChange={(checked) => setAnonymous(checked === true)} /><span>비로그인</span></label>
                {scannerAccounts.map((account) => <div className="flex flex-wrap items-center gap-2" key={account.id}><label className="flex items-center gap-2"><Checkbox id={`scanner-${account.id}`} checked={selectedAccounts.includes(account.id)} onCheckedChange={(checked) => setSelectedAccounts((current) => checked === true ? [...current, account.id] : current.filter((id) => id !== account.id))} /><span>{account.label} · {account.role} · {account.status}</span></label><Button type="button" size="sm" variant="ghost" disabled={scanner.data?.run.status === "RUNNING" || zapAccountDelete.isPending} onClick={() => zapAccountDelete.mutate(account.id)}>자격증명 폐기</Button>{account.message && <span className="w-full pl-6 text-xs text-muted-foreground">{account.message}</span>}<span className="w-full pl-6 text-xs text-muted-foreground">인증 검증 · ZAP 자동 판정 + 재사용 세션 연결</span></div>)}
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
                <Button type="button" variant="outline" disabled={!targetInScope || !zapLabel.trim() || !zapLoginUrl.trim() || !zapUsername || !zapPassword || zapAccountSave.isPending || scanner.data?.run.status === "RUNNING"} onClick={() => zapAccountSave.mutate({ id: "", label: zapLabel, role: zapRole, service: normalizedOrigin(target), loginUrl: zapLoginUrl, username: zapUsername, password: zapPassword }, { onSuccess: () => { setZapLabel(""); setZapLoginUrl(""); setZapUsername(""); setZapPassword("") } })}>로그인 계정 등록</Button>
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
              </div>
            </div>}
            status={<section className="grid gap-3" aria-label="ZAP 실행 상태">
              <div className="grid gap-1 rounded-lg border border-border/70 bg-background/30 p-3">
                <p className="font-medium">ZAP 상태 · {scanner.data?.run.status ?? "NOT_STARTED"}</p>
                <p className="text-sm text-muted-foreground">{scannerStage(scanner.data?.run.stage)} · 전체 {duration(scanner.data?.run.elapsed_seconds)} · 현재 단계 {duration(scanner.data?.run.stage_elapsed_seconds)}{scanner.data?.run.stage_timeout_seconds ? ` / 최대 ${duration(scanner.data.run.stage_timeout_seconds)}` : ""}</p>
                <p className="text-sm text-muted-foreground">작업 상태 {scanner.data?.run.activity_state ?? "확인 전"} · 신호 {age(scanner.data?.run.last_heartbeat_age_seconds)} · 수집 {scanner.data?.run.captured_records ?? "-"}건 · Alert {scanner.data?.run.alert_count ?? "-"}건</p>
                {scanner.data?.run.run_id && <p className="font-mono text-xs text-muted-foreground">run {scanner.data.run.run_id}</p>}
              </div>
              {(scanner.data?.run.lanes ?? []).map((lane) => <div className="grid gap-1 rounded-lg border border-border/70 bg-background/30 p-3" key={lane.account_id ?? "anonymous"}>
                <div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{lane.account_label}</p><p className="font-mono text-sm">{lane.status}</p></div>
                <p className="text-sm text-muted-foreground">{scannerStage(lane.stage)} · 경과 {duration(lane.elapsed_seconds)} · 수집 {lane.captured_records}건</p>
                {lane.account_id && <p className="text-sm text-muted-foreground">로그인 {lane.authentication_state ?? "UNKNOWN"}{lane.authentication_browser ? ` · ${lane.authentication_browser}` : ""}</p>}
                {lane.authentication_message && <p className="text-xs text-muted-foreground">{lane.authentication_message}</p>}
                {lane.warning && <p className="text-sm text-amber-600">주의 · {lane.warning}</p>}
                {lane.error && <p className="text-sm text-destructive">오류 · {lane.error}</p>}
              </div>)}
              {scanner.data?.run.warning && <Alert><AlertDescription>주의 · {scanner.data.run.warning}</AlertDescription></Alert>}
              {scanner.data?.run.error && <Alert variant="destructive"><AlertDescription>{scanner.data.run.error}</AlertDescription></Alert>}
              <Button variant="outline" disabled={!scannerRunning || scannerCancel.isPending} onClick={() => scannerCancel.mutate()}>ZAP 검사 취소</Button>
              <OpenRunsButton />
            </section>}
          />
        </TabsContent>
        <TabsContent value="review">
          <Card><CardHeader><CardTitle>Evidence 검토</CardTitle><CardDescription>Judge 없이 실제 HUMAN·ZAP·LLM Evidence를 비교합니다. LLM 수집은 독립 Explorer에서 실행합니다.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><Button onClick={() => { window.location.hash = "#surface" }}>API·입력 차이 보기</Button><Button variant="outline" onClick={() => { window.location.hash = "#explorer" }}>LLM Explorer 열기</Button></CardContent></Card>
        </TabsContent>
      </Tabs>

      <Accordion type="single" collapsible>
        <AccordionItem value="safety"><AccordionTrigger>실행 안전 경계</AccordionTrigger><AccordionContent>대상은 현재 scanner scope와 정확히 같아야 하며, ZAP 연결과 신원 선택을 모두 확인한 뒤에만 기준선을 시작합니다.</AccordionContent></AccordionItem>
      </Accordion>
    </section></ReferenceAnalysisWorkspace>
  )
}
