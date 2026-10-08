import { identityLabel } from "@/lib/display/identityLabel"
import { useEffect, useMemo, useState } from "react"
import { ArrowUpRight, ShieldCheck, UserRound } from "lucide-react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { InfoHint } from "@/components/ui/info-hint"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { EventRecord, ReviewStatus, Snapshot } from "@/lib/api/types"
import { wrapPath } from "@/lib/display/pathLines"
import { useRequirementMutation, useReviewMutation, useSnapshotQuery } from "@/lib/query/hooks"
import { RequestLabDialog } from "@/features/evidence/RequestLabDialog"
import { MatrixOwnerControl } from "./MatrixOwnerControl"
import { OperationColumnResizeHandle, OPERATION_COLUMN_DEFAULT_WIDTH } from "./OperationColumnResizeHandle"
import { latestOperationEvent, requestLabEvent } from "./requestLabEvent"
import { findJudgmentItem, isReviewable, judgmentStatusDescription, judgmentStatusLabel, judgmentTone, projectJudgmentMatrix, quietStatusLabel, reviewSuffix, withoutService, type JudgmentItem, type JudgmentView } from "./judgmentProjection"

const toneClass: Record<ReturnType<typeof judgmentTone>, string> = {
  risk: "border-amber-500/60 bg-amber-500/10",
  ok: "border-emerald-500/50 bg-emerald-500/10",
  invalid: "border-red-500/50 bg-red-500/10",
  gap: "border-border/70 bg-muted/30",
  unknown: "border-border/70 bg-background/40",
}
const ROLE_OPTIONS = ["USER", "LV1", "LV2", "ADMIN"] as const
const roleLabel: Record<string, string> = { USER: "일반 사용자", LV1: "1단계 권한", LV2: "2단계 권한", ADMIN: "관리자", ANONYMOUS: "비로그인", UNKNOWN: "권한 미설정" }

const methodTone: Record<string, string> = {
  GET: "border-observation-human/40 bg-observation-human/10 text-observation-human",
  POST: "border-observation-scanner/40 bg-observation-scanner/10 text-observation-scanner",
}

/** 경로는 `/` 경계로 최대 두 줄, 넘치면 앞을 줄여 끝(자원·ID)을 남긴다. 폭 제한은 표 칸이 아니라 안쪽 블록에 건다(표 칸의 max-width는 무시된다). */

function OperationLabel({ operation, width }: { operation: string; width: number }) {
  const label = withoutService(operation)
  const separator = label.indexOf(" ")
  const method = separator > 0 ? label.slice(0, separator) : label
  const path = separator > 0 ? label.slice(separator + 1) : ""
  const lines = path ? wrapPath(path, (line) => line.length <= Math.max(8, Math.floor((width - 88) / 8))) : []
  const trimmed = lines.join("") !== path
  return <span className="flex min-w-0 items-start gap-2" title={path || undefined}>
    <Badge variant="outline" className={`shrink-0 font-mono text-sm ${methodTone[method] ?? "border-border bg-muted/40 text-foreground"}`}>{method}</Badge>
    {path && <span className="grid min-w-0 w-full font-mono text-sm leading-6">
      <span aria-hidden={trimmed || undefined} className="grid">{lines.map((line, index) => <span key={index} className="break-all">{line}</span>)}</span>
      {trimmed && <span className="sr-only">{path}</span>}
    </span>}
  </span>
}

/**
 * 접근 허용 기준. 역할은 토큰이나 경로에서 추정하지 않고 사용자가 지정한다(D-018). 계정 역할은 계정·세션에서 관리한다. /api/requirement API만 호출하며
 * 판정은 서버가 다시 계산한다. 모든 셀에서 같은 자리에 두고 현재 값을 미리 채운다.
 */
function PolicyAssignment({ item, requiredRole: currentRequiredRole, disabled }: { item: JudgmentItem; requiredRole: string | undefined; disabled: boolean }) {
  const requirement = useRequirementMutation()
  const [requiredRole, setRequiredRole] = useState<string>(currentRequiredRole && ROLE_OPTIONS.includes(currentRequiredRole as never) ? currentRequiredRole : "")
  const [message, setMessage] = useState<string | null>(null)
  const run = async (action: () => Promise<{ message?: string }>, fallback: string) => {
    setMessage(null)
    try { setMessage((await action()).message ?? fallback) }
    catch (error) { setMessage(error instanceof Error ? error.message : "저장 실패") }
  }
  const select = "h-9 min-w-0 flex-1 rounded-md border border-border/70 bg-background px-2 text-sm"
  return <section aria-label="접근 허용 기준" className="grid gap-3 border-t border-border/70 pt-4">
    <div className="flex items-center gap-1.5"><h3 className="text-sm font-semibold">접근 허용 기준</h3><InfoHint label="접근 허용 기준">이 권한 이상인 계정이 접근할 수 있어야 합니다.</InfoHint></div>
    <div className="grid gap-1.5"><label htmlFor="matrix-minimum-role" className="text-xs text-muted-foreground">최소 권한</label><div className="flex gap-2"><select id="matrix-minimum-role" aria-label="최소 권한" className={select} value={requiredRole} disabled={disabled} onChange={(event) => setRequiredRole(event.target.value)}><option value="" disabled>아직 정하지 않음</option>{ROLE_OPTIONS.map((value) => <option key={value} value={value}>{roleLabel[value]} ({value})</option>)}</select><Button type="button" size="sm" variant="outline" className="h-9" aria-label="최소 권한 저장" disabled={disabled || !requiredRole || requirement.isPending} onClick={() => void run(() => requirement.mutateAsync({ operation: item.operation, role: requiredRole }), "최소 권한을 저장했습니다.")}>저장</Button></div></div>
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>
}

function JudgmentDetail({ item, requiredRole, disabled, snapshot }: { item: JudgmentItem; requiredRole: string | undefined; disabled: boolean; snapshot: Snapshot | undefined }) {
  const review = useReviewMutation()
  const [labOpen, setLabOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(item.reviewStatus === "CONFIRMED")
  const [message, setMessage] = useState<string | null>(null)
  // 같은 cell·검토 Evidence 안에서 저장된 서버 값을 반영한다. 선택 문맥이 바뀌면 부모 key가 폼과 진행 중 응답을 분리한다.
  useEffect(() => { setConfirmed(item.reviewStatus === "CONFIRMED") }, [item.reviewStatus, item.reviewNote])
  const resource = "resource" in item ? item.resource : null
  const recommendation = item.recommendation
  // 추천 여부와 무관하게 이 칸의 근거 요청을 Request Lab으로 연다. 대상 신원은 Request Lab의 전송 인증에서 고른다(자동 전송 없음).
  const basisId = recommendation?.basisEvidenceIds[0] ?? item.evidenceIds[0]
  // 근거 기록을 보낼 수 없으면(원문이 일부만 남음) 같은 API에서 보낼 수 있는 기록을 대신 연다.
  const basisEvent = snapshot ? requestLabEvent(snapshot.events, item.operation, basisId, resource) : undefined
  // 사람 판정은 추천·공백·수동 검토 셀에서만 저장된다. 다른 셀은 같은 자리에 두되 입력을 잠근다.
  const reviewable = isReviewable(item) || judgmentTone(item.status) === "gap"
  const submit = async (status: ReviewStatus) => {
    setMessage(null)
    try {
      const result = await review.mutateAsync({ itemId: item.id, status, note: item.reviewNote })
      setConfirmed(status === "CONFIRMED")
      setMessage(result.message ?? "판정을 저장했습니다.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "판정 저장 실패")
    }
  }
  return <div className="grid content-start gap-5 p-4 text-sm">
    <header className="grid gap-4">
      <div className={`flex items-start gap-2 rounded-lg border px-3 py-3 ${confirmed ? "border-red-500/50 bg-red-500/10" : toneClass[judgmentTone(item.status)]}`}>
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <h2 className="min-w-0 flex-1 text-base font-semibold leading-6">{judgmentStatusLabel(item)}{reviewSuffix(item.reviewStatus)}</h2>
        {judgmentStatusDescription(item.status) && <InfoHint label={judgmentStatusLabel(item)}>{judgmentStatusDescription(item.status)}</InfoHint>}
      </div>
      <p className="break-all rounded-md border border-border/70 bg-background px-3 py-2.5 font-mono text-sm leading-6">{withoutService(item.operation)}</p>
      <dl className="grid gap-3">
        <div className="flex items-center justify-between gap-3"><dt className="text-xs text-muted-foreground">확인 계정</dt><dd className="flex min-w-0 items-center gap-1.5 font-medium"><UserRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="break-all">{identityLabel(item.identity, item.identityLabel)}</span></dd></div>
        {resource && <div className="flex items-start justify-between gap-3"><dt className="shrink-0 pt-0.5 text-xs text-muted-foreground">대상 데이터</dt><dd className="min-w-0 break-all text-right font-mono text-xs leading-5">{withoutService(resource)}</dd></div>}
      </dl>
    </header>
    <PolicyAssignment key={`${item.id}:${requiredRole ?? ""}`} item={item} requiredRole={requiredRole} disabled={disabled} />
    {resource && snapshot && <MatrixOwnerControl key={resource} resource={resource} snapshot={snapshot} disabled={disabled} />}
    <section aria-label="요청·응답 확인" className="grid gap-3 border-t border-border/70 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">요청·응답 확인</h3>{basisEvent && <span className="rounded-md border border-border/70 bg-background px-2 py-1 font-mono text-xs">HTTP {basisEvent.status}</span>}</div>
      {basisEvent && <div className="grid gap-1.5 text-xs"><p className="break-all font-mono leading-5">{basisEvent.method} {basisEvent.path}</p><p className="text-muted-foreground">{new Date(basisEvent.timestamp).toLocaleString("ko-KR")} · {{ human: "사용자 요청", scanner: "스캐너 요청", llm: "AI 요청", unknown: "출처 미확인" }[basisEvent.source] ?? basisEvent.source}</p></div>}
      {recommendation && <p className="text-xs">열린 창에서 {recommendation.testIdentityLabel} 계정을 선택해 확인하세요.{recommendation.stateChanging ? " 데이터를 바꾸는 요청이므로 보내기 전에 내용을 확인하세요." : ""}</p>}
      <Button type="button" size="sm" className="h-10 w-full justify-between" disabled={disabled || !basisEvent} onClick={() => setLabOpen(true)}>Request Lab 열기<ArrowUpRight aria-hidden="true" className="size-4" /></Button>
      {!basisEvent && <p className="text-xs text-muted-foreground">이 API의 요청 기록이 없어 Request Lab을 열 수 없습니다.</p>}
    </section>
    {labOpen && basisEvent && snapshot && <RequestLabDialog open onOpenChange={open => { if (!open) setLabOpen(false) }} event={basisEvent} accounts={snapshot.accounts} sessions={snapshot.managedSessions} verifications={snapshot.manualVerifications} datasetRevision={snapshot.datasetRevision ?? snapshot.identityRevision ?? 0} snapshotRevision={snapshot.revision} suspended={disabled} />}
    <section aria-label="취약점 확인" className="grid gap-3 border-t border-border/70 pt-4">
      <h3 className="text-sm font-semibold">취약점 확인</h3>
      <Button type="button" size="sm" variant={confirmed ? "outline" : "destructive"} className="h-10 w-full" aria-pressed={confirmed} disabled={disabled || !reviewable || review.isPending} onClick={() => void submit(confirmed ? "UNRESOLVED" : "CONFIRMED")}>{confirmed ? "취약점 확정 취소" : "취약점으로 확정"}</Button>
      {!reviewable && <p className="text-xs text-muted-foreground">이 결과는 취약점 확정 대상이 아닙니다.</p>}
      {message && <p role="status" className="text-xs">{message}</p>}
    </section>
  </div>
}

export function JudgmentMatrixView() {
  const snapshot = useSnapshotQuery()
  return <JudgmentMatrixWorkspace key={snapshot.data?.datasetRevision ?? "legacy"} snapshot={snapshot} />
}

function JudgmentMatrixWorkspace({ snapshot }: { snapshot: ReturnType<typeof useSnapshotQuery> }) {
  const [apiLabEvent, setApiLabEvent] = useState<EventRecord | null>(null)
  const [operationWidth, setOperationWidth] = useState(OPERATION_COLUMN_DEFAULT_WIDTH)
  const [view, setView] = useState<JudgmentView>("function")
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const matrix = snapshot.data?.authorizationMatrix ?? null
  const projection = useMemo(() => matrix ? projectJudgmentMatrix(matrix, view, attentionOnly) : null, [matrix, view, attentionOnly])
  const selected = matrix ? findJudgmentItem(matrix, selectedId) : null
  useEffect(() => { if (selectedId && !selected && !snapshot.isError) { setSelectedId(null); setInspectorOpen(false) } }, [selectedId, selected, snapshot.isError])
  const disabled = snapshot.isError
  const select = (id: string) => { setSelectedId(id); setInspectorOpen(true) }
  const summary = matrix?.summary
  const configurationWarnings = matrix?.configurationWarnings ?? []
  // 같은 판정 데이터를 다른 관점으로 바꿔 보는 상단 전환. 축 설명은 마우스 설명(title)과 접근 이름에 둔다.
  const controls = <div className="flex flex-wrap items-center gap-3">
    <Tabs value={view} onValueChange={(value) => { setView(value === "object" ? "object" : "function"); setSelectedId(null); setInspectorOpen(false) }}><TabsList aria-label="판정 매트릭스 보기" className="grid h-10 grid-cols-2 gap-1 bg-muted/50 p-1 group-data-horizontal/tabs:h-10">{([["function", "기능 권한 (BFLA)", "역할 × 기능"], ["object", "객체 권한 (BOLA/IDOR)", "계정 × 객체"]] as const).map(([value, name, axis]) => <TabsTrigger key={value} value={value} aria-label={`${name} · ${axis}`} title={axis} className="h-8 w-full px-3 text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-none">{name}</TabsTrigger>)}</TabsList></Tabs>
    <div className="flex h-10 shrink-0 items-center gap-1">
      <Button type="button" role="switch" aria-checked={attentionOnly} variant="ghost" className="h-8 gap-3 px-2 py-1" onClick={() => setAttentionOnly((current) => !current)}><span className="text-sm font-normal">확인 필요한 결과만</span><span aria-hidden="true" className={`relative block h-5 w-9 shrink-0 rounded-full border transition-colors ${attentionOnly ? "border-primary bg-primary" : "border-input bg-muted"}`}><span className={`absolute top-0.5 left-0.5 block size-3.5 rounded-full bg-background shadow-sm transition-transform ${attentionOnly ? "translate-x-4" : "translate-x-0"}`} /></span></Button><InfoHint label="확인 필요한 결과만">취약점 의심, 추가 테스트 추천, 접근 기준·소유자 미확인, 요청 기록 없음 등 확인할 결과가 있는 API 행만 표시합니다. 같은 행의 다른 계정 결과도 함께 보여줍니다.</InfoHint>
    </div>
  </div>
  const inspector = selected && matrix ? <JudgmentDetail key={JSON.stringify([selected.id, selected.reviewEvidenceIds])} item={selected} requiredRole={snapshot.data?.requiredRoles[selected.operation]} disabled={disabled} snapshot={snapshot.data} /> : <p className="p-4 text-sm text-muted-foreground">계정별 결과를 누르면 상세 내용을 볼 수 있습니다.</p>

  return <ReferenceAnalysisWorkspace ariaLabel="판정 매트릭스 분석 영역" context={null} contentOverflow="hidden" inspector={inspector} inspectorOpen={inspectorOpen} onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) setSelectedId(null) }}>
    <section className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-4" aria-labelledby="judgment-title">
      <header className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2"><h1 id="judgment-title" className="flex h-10 shrink-0 items-center text-lg font-semibold">판정 매트릭스</h1>{controls}</header>
      {snapshot.isError && <Alert variant="destructive"><AlertTitle>판정 매트릭스를 불러오지 못했습니다.</AlertTitle><AlertDescription>
        <p>{snapshot.error instanceof Error ? snapshot.error.message : "다시 시도하세요."}</p>
        {snapshot.data ? <><p>마지막으로 불러온 데이터를 표시하고 있습니다.</p><p>마지막 성공 시각: {snapshot.dataUpdatedAt > 0 && Number.isFinite(snapshot.dataUpdatedAt) ? <time dateTime={new Date(snapshot.dataUpdatedAt).toISOString()}>{new Date(snapshot.dataUpdatedAt).toLocaleString()}</time> : "기록 없음"}</p><p>갱신에 성공할 때까지 요청 기록 상세와 사람 판정 저장이 비활성화됩니다.</p></> : <p>서버 연결을 확인하고 다시 시도하세요. 아직 성공한 snapshot이 없습니다.</p>}
        <Button variant="outline" size="sm" onClick={() => void snapshot.refetch()}>snapshot 다시 시도</Button>
      </AlertDescription></Alert>}
      {snapshot.isLoading && !snapshot.isError && <p className="rounded-md border p-6 text-sm text-muted-foreground">판정 매트릭스를 불러오는 중입니다.</p>}
      {snapshot.data && !matrix && <p className="rounded-md border p-6 text-sm text-muted-foreground">이 snapshot에는 판정 매트릭스가 없습니다.</p>}
      {configurationWarnings.length > 0 && <Alert aria-label="계정 서비스 설정 경고" className="border-amber-500/50 bg-amber-500/10">
        <AlertTitle>계정 서비스 설정 확인</AlertTitle>
        <AlertDescription><ul className="grid gap-2">{configurationWarnings.map((warning) => <li key={`${warning.code}:${warning.accountId}:${warning.configuredService}`} className="rounded border border-amber-500/30 p-2">
          <span className="font-semibold text-foreground">{warning.accountLabel}</span><span className="mx-1 text-muted-foreground">·</span><span className="break-all font-mono text-xs">{warning.configuredService}</span>
          <span className="mt-1 block text-xs">{warning.message}</span>
        </li>)}</ul></AlertDescription>
      </Alert>}
      {summary && <ul role="list" aria-label="판정 요약" className="flex shrink-0 flex-wrap gap-x-6 gap-y-2 border-b border-border/70 pb-3">{[
        ["기능 권한 확인", summary.bflaTestRecommendations],
        ["데이터 권한 확인", summary.bolaIdorTestRecommendations],
        ["직접 확인 필요", summary.manualReviewPending],
        ["확정한 취약점", summary.humanConfirmed],
        ["정상·기각", summary.humanDismissed],
      ].map(([label, value]) => <li key={String(label)} className="flex items-center gap-2 text-sm"><p className="text-muted-foreground">{label}</p><p className="font-semibold tabular-nums">{value}</p></li>)}</ul>}
      {projection && (projection.rows.length ? <div role="region" aria-label="판정 매트릭스 표" data-testid="judgment-matrix-scroll" tabIndex={0} className="min-h-40 min-w-0 max-w-full flex-1 overflow-auto rounded-md border overscroll-contain"><div className="relative min-h-full w-max min-w-full" style={{ width: operationWidth + projection.identities.length * 208 }}><OperationColumnResizeHandle width={operationWidth} onWidthChange={setOperationWidth} /><Table containerClassName="w-max min-w-full overflow-visible" className="table-fixed min-w-full" style={{ width: operationWidth + projection.identities.length * 208 }}><colgroup><col style={{ width: operationWidth }} />{projection.identities.map(identity => <col key={identity.id} />)}</colgroup><TableHeader><TableRow><TableHead className="sticky top-0 z-40 bg-background py-3 pr-6 text-base">API<span className="mt-1 block text-xs font-normal text-muted-foreground">클릭하면 최신 요청 열기</span></TableHead>{projection.identities.map((identity) => <TableHead key={identity.id} className="sticky top-0 z-30 min-w-44 whitespace-normal bg-background py-3"><span className="break-all text-base">{identityLabel(identity.id, identity.label)}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{roleLabel[identity.role.toUpperCase()] ?? identity.role}</span></TableHead>)}</TableRow></TableHeader><TableBody>{projection.rows.map((row) => <TableRow key={row.key}><TableHead scope="row" className="overflow-hidden whitespace-normal bg-background py-3 pr-6 align-top"><button type="button" className="block w-full rounded-sm text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" aria-label={`${withoutService(row.operation)} 최신 요청을 Request Lab에서 열기`} disabled={disabled || !latestOperationEvent(snapshot.data?.events ?? [], row.operation)} onClick={() => setApiLabEvent(latestOperationEvent(snapshot.data?.events ?? [], row.operation) ?? null)}><OperationLabel operation={row.operation} width={operationWidth} /></button>{row.resource && <p className="mt-2 break-all text-xs font-normal text-muted-foreground">{withoutService(row.resource)}{row.ownerLabel ? ` · 객체 소유자 ${row.ownerLabel}` : ""}</p>}</TableHead>{projection.identities.map((identity) => { const cell = row.cellsByIdentity[identity.id]; const quiet = cell && cell.reviewStatus !== "CONFIRMED" && cell.reviewStatus !== "DISMISSED" ? quietStatusLabel[cell.status] : undefined; return <TableCell key={identity.id} className="whitespace-normal py-3 align-top">{cell ? <button type="button" disabled={disabled} data-tone={judgmentTone(cell.status)} aria-pressed={cell.id === selectedId} aria-label={`${judgmentStatusLabel(cell)}${reviewSuffix(cell.reviewStatus)}: ${identityLabel(cell.identity, cell.identityLabel)} · ${withoutService(cell.operation)}${"resource" in cell ? ` · ${cell.resource}` : ""}`} title={judgmentStatusDescription(cell.status) ?? judgmentStatusLabel(cell)} className={quiet ? `grid w-full min-w-28 rounded-md border border-transparent p-3 text-left text-sm text-muted-foreground hover:bg-muted/50 ${cell.id === selectedId ? "ring-2 ring-ring" : ""}` : `grid w-full min-w-44 rounded-md border p-3 text-left text-sm ${cell.reviewStatus === "CONFIRMED" ? "border-red-500/50 bg-red-500/10" : toneClass[judgmentTone(cell.status)]} ${cell.id === selectedId ? "ring-2 ring-ring" : ""}`} onClick={() => select(cell.id)}><span className={quiet ? undefined : "font-semibold"}>{quiet ?? judgmentStatusLabel(cell)}{reviewSuffix(cell.reviewStatus)}</span></button> : <span className="text-sm text-muted-foreground">데이터 없음</span>}</TableCell> })}</TableRow>)}</TableBody></Table></div></div> : <p className="rounded-md border p-6 text-sm text-muted-foreground">{view === "function" ? "현재 필터에 표시할 역할 × 기능 조합이 없습니다." : "객체 참조 요청 기록이 없거나 현재 필터에 표시할 계정 × 객체 조합이 없습니다."}</p>)}
    </section>
    {apiLabEvent && snapshot.data && <RequestLabDialog key={apiLabEvent.eventId} open onOpenChange={open => { if (!open) setApiLabEvent(null) }} event={apiLabEvent} accounts={snapshot.data.accounts} sessions={snapshot.data.managedSessions} verifications={snapshot.data.manualVerifications} datasetRevision={snapshot.data.datasetRevision ?? snapshot.data.identityRevision ?? 0} snapshotRevision={snapshot.data.revision} suspended={disabled} />}
  </ReferenceAnalysisWorkspace>
}
