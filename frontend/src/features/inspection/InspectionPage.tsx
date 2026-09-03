import { useEffect, useMemo, useState, type ReactNode } from "react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useHumanRunMutation, useHumanRunQuery, useLlmRunQuery, useScannerRunMutation, useScannerRunQuery, useSnapshotQuery, useZapStatusQuery } from "@/lib/query/hooks"
import { activeManagedAccountIds, automaticInspectionStage, type InspectionStage } from "./inspectionState"

const stageCopy: Record<InspectionStage, { title: string; message: string }> = {
  scope: { title: "범위를 확인하세요", message: "허가된 exact scope를 Burp FlowScope 탭에서 적용하세요." },
  human: { title: "HUMAN pass", message: "HUMAN pass를 시작해 실제 브라우저 탐색을 기록하세요." },
  scanner: { title: "ZAP 기준선", message: "연결된 ZAP으로 범위 안의 신원별 기준선을 실행하세요." },
  llm: { title: "LLM·Judge", message: "Explorer를 실행하고 세 레인이 완료된 뒤 Judge를 시작하세요." },
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다."
}

function stageProgress(stage: InspectionStage): number {
  return { scope: 25, human: 50, scanner: 75, llm: 100 }[stage]
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

export function InspectionPage() {
  const snapshot = useSnapshotQuery()
  const human = useHumanRunQuery()
  const zap = useZapStatusQuery()
  const scanner = useScannerRunQuery()
  const llm = useLlmRunQuery()
  const humanMutation = useHumanRunMutation()
  const scannerMutation = useScannerRunMutation()
  const [manualStage, setManualStage] = useState<InspectionStage | null>(null)
  const [target, setTarget] = useState("")
  const [humanAccount, setHumanAccount] = useState("")
  const [anonymous, setAnonymous] = useState(false)
  const [selectedAccounts, setSelectedAccounts] = useState<readonly string[]>([])

  const scope = scanner.data?.scope ?? llm.data?.scope ?? []
  useEffect(() => {
    if (!target && scope[0]) setTarget(scope[0])
  }, [scope, target])

  const automaticStage = automaticInspectionStage(scope, human.data, scanner.data, llm.data)
  const selectedStage = manualStage ?? automaticStage
  const activeAccounts = useMemo(() => {
    const ids = activeManagedAccountIds(target, snapshot.data?.managedSessions ?? [])
    const labels = new Map((snapshot.data?.managedSessions ?? []).map((session) => [session.accountId, session.accountLabel]))
    return ids.map((id) => ({ id, label: labels.get(id) ?? id }))
  }, [snapshot.data?.managedSessions, target])
  const activeAccountIds = activeAccounts.map((account) => account.id)
  const targetInScope = target !== "" && scope.includes(target)
  const zapCanStart = zap.data?.connected === true && targetInScope && (anonymous || selectedAccounts.length > 0) && !scannerMutation.isPending
  const humanCanStart = human.data !== undefined && !human.data.active && !humanMutation.isPending
  const humanCanEnd = human.data?.active === true && human.data.runId.trim() !== "" && !humanMutation.isPending
  const scannerDisabledReason = !zap.data?.connected
    ? "ZAP 연결을 먼저 확인하세요."
    : !targetInScope
      ? "현재 scanner scope에 정확히 포함된 대상을 선택하세요."
      : !anonymous && selectedAccounts.length === 0
        ? "비로그인 또는 하나 이상의 활성 계정을 선택하세요."
        : ""

  const removeUnavailableAccounts = (ids: readonly string[]) => ids.filter((id) => activeAccountIds.includes(id))
  useEffect(() => {
    setSelectedAccounts((current) => removeUnavailableAccounts(current))
    if (humanAccount && !activeAccountIds.includes(humanAccount)) setHumanAccount("")
  }, [activeAccountIds.join(","), humanAccount])

  const humanSummary = human.data ? human.data.active ? "진행 중" : human.data.completed ? "완료" : "대기" : human.isPending ? "불러오는 중" : "상태 확인 필요"
  const humanCardStatus = human.data ? human.data.active ? `실행 중 · ${human.data.accountId || "비로그인"}` : human.data.completed ? "COMPLETED · HUMAN lane 완료" : "NOT_STARTED · HUMAN pass 대기" : `HUMAN 상태 · ${humanSummary}`
  const queryError = human.isError
    ? { error: human.error, hasLastSuccess: human.data !== undefined }
    : zap.isError
      ? { error: zap.error, hasLastSuccess: zap.data !== undefined }
      : scanner.isError
        ? { error: scanner.error, hasLastSuccess: scanner.data !== undefined }
        : llm.isError
          ? { error: llm.error, hasLastSuccess: llm.data !== undefined }
          : undefined
  const context = <section className="grid gap-3 p-3"><div><h2 className="text-sm font-semibold">현재 점검 단계</h2><p className="text-xs text-muted-foreground">자동 상태는 현재 scope와 실행 결과에서만 계산합니다.</p></div><dl className="grid gap-2 text-sm"><div className="flex justify-between gap-2"><dt>현재 단계</dt><dd>{stageCopy[automaticStage].title}</dd></div><div className="flex justify-between gap-2"><dt>적용 scope</dt><dd className="font-mono">{scope.length}</dd></div><div className="flex justify-between gap-2"><dt>HUMAN</dt><dd>{humanSummary}</dd></div><div className="flex justify-between gap-2"><dt>ZAP</dt><dd>{scanner.data?.run.status ?? "상태 없음"}</dd></div></dl></section>

  return (
    <ReferenceAnalysisWorkspace ariaLabel="점검 시작 작업 영역" context={context} inspector={null}><section className="space-y-4 p-3" aria-labelledby="inspection-title">
      <div>
        <h1 id="inspection-title" className="text-2xl font-semibold">점검 시작</h1>
        <p className="text-sm text-muted-foreground">범위 → HUMAN → ZAP → LLM·Judge 순서로 각각의 Evidence를 분리합니다.</p>
      </div>

      {queryError && (
        <Alert variant="destructive" aria-label={errorMessage(queryError.error)}>
          <AlertTitle>{queryError.hasLastSuccess ? "마지막 성공 상태를 표시하고 있습니다." : "상태를 가져오지 못했습니다. 확인이 필요합니다."}</AlertTitle>
          <AlertDescription>{errorMessage(queryError.error)}</AlertDescription>
        </Alert>
      )}
      {humanMutation.isError && <Alert variant="destructive" aria-label={errorMessage(humanMutation.error)}><AlertDescription>{errorMessage(humanMutation.error)}</AlertDescription></Alert>}
      {scannerMutation.isError && <Alert variant="destructive" aria-label={errorMessage(scannerMutation.error)}><AlertDescription>{errorMessage(scannerMutation.error)}</AlertDescription></Alert>}

      <Card>
        <CardHeader>
          <CardTitle>{stageCopy[automaticStage].title}</CardTitle>
          <CardDescription>{stageCopy[automaticStage].message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={stageProgress(automaticStage)} aria-label="점검 진행률" />
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
          <TabsTrigger value="llm">4 · LLM·Judge</TabsTrigger>
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
                  <SelectContent><SelectItem value="">비로그인 pass</SelectItem>{activeAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.label}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <Button disabled={!humanCanStart} onClick={() => humanMutation.mutate({ action: "begin", account: humanAccount })}>HUMAN pass 시작</Button>
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
            description="신원마다 새 ZAP 세션을 사용하며 능동 스캔은 별도 Burp 승인 경계에 남아 있습니다."
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
                {activeAccounts.map((account) => <label className="flex items-center gap-2" key={account.id}><Checkbox id={`scanner-${account.id}`} checked={selectedAccounts.includes(account.id)} onCheckedChange={(checked) => setSelectedAccounts((current) => checked === true ? [...current, account.id] : current.filter((id) => id !== account.id))} /><span>{account.label}</span></label>)}
                {!activeAccounts.length && <p className="text-sm text-muted-foreground">현재 target에 ACTIVE 등록 계정이 없습니다.</p>}
              </fieldset>
              {!zapCanStart && <p className="text-sm text-muted-foreground">{scannerDisabledReason}</p>}
              <Button disabled={!zapCanStart} onClick={() => scannerMutation.mutate({ target, anonymous, accounts: selectedAccounts.join(",") })}>신원별 격리 ZAP 기준선 시작</Button>
            </div>}
            status={<section className="grid gap-3" aria-label="ZAP 실행 상태"><div className="grid gap-1 rounded-lg border border-border/70 bg-background/30 p-3"><p className="font-medium">ZAP 상태 · {scanner.data?.run.status ?? "NOT_STARTED"}</p><p className="text-sm text-muted-foreground">연결 {zap.data?.connected ? "정상" : zap.data?.state ?? "확인 필요"} · 수집 {scanner.data?.run.captured_records ?? "-"}건 · Alert {scanner.data?.run.alert_count ?? "-"}건</p>{scanner.data?.run.run_id && <p className="font-mono text-xs text-muted-foreground">run {scanner.data.run.run_id}</p>}</div>{scanner.data?.run.warning && <Alert><AlertDescription>주의 · {scanner.data.run.warning}</AlertDescription></Alert>}{scanner.data?.run.error && <Alert variant="destructive"><AlertDescription>{scanner.data.run.error}</AlertDescription></Alert>}<OpenRunsButton /></section>}
          />
        </TabsContent>
        <TabsContent value="llm">
          <StageWorkspace
            label="LLM Explorer와 Judge"
            title="LLM Explorer와 Judge"
            description="실행 상태 화면에서 provider, 시작, 취소, Judge 후속 질문을 제어합니다."
            setup={<div className="grid gap-3"><p className="text-sm text-muted-foreground">Provider와 Explorer/Judge 제어는 전체 실행 상태 화면에서 설정합니다.</p><OpenRunsButton /></div>}
            status={<section className="grid gap-3" aria-label="LLM 실행 상태"><div className="grid gap-1 rounded-lg border border-border/70 bg-background/30 p-3"><p className="font-medium">LLM 상태 · {llm.data?.run.status ?? "상태 없음"}</p><p className="text-sm text-muted-foreground">{llm.data?.run.provider ?? "공급자 없음"} · {llm.data?.run.role ?? "실행 대기"}</p>{llm.data?.run.run_id && <p className="font-mono text-xs text-muted-foreground">run {llm.data.run.run_id}</p>}</div><div className="flex flex-wrap gap-2" aria-label="LLM 완료 레인">{llm.data?.completed_lanes.length ? llm.data.completed_lanes.map((lane) => <span className="rounded-full border border-border/70 px-2 py-1 text-xs" key={lane}>{lane} 완료</span>) : <span className="text-sm text-muted-foreground">완료된 lane이 없습니다.</span>}</div>{llm.data?.run.message && <p className="text-sm text-muted-foreground">{llm.data.run.message}</p>}<OpenRunsButton /></section>}
          />
        </TabsContent>
      </Tabs>

      <Accordion type="single" collapsible>
        <AccordionItem value="safety"><AccordionTrigger>실행 안전 경계</AccordionTrigger><AccordionContent>대상은 현재 scanner scope와 정확히 같아야 하며, ZAP 연결과 신원 선택을 모두 확인한 뒤에만 기준선을 시작합니다.</AccordionContent></AccordionItem>
      </Accordion>
    </section></ReferenceAnalysisWorkspace>
  )
}
