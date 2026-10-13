import { identityLabel } from "@/lib/display/identityLabel"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ArrowUpRight, ChevronRight, RotateCcw, ShieldCheck, UserRound } from "lucide-react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { InfoHint } from "@/components/ui/info-hint"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { exclusionKey, groupApiJudgments, matrixApiResolver, loadMatrixExclusions, saveMatrixExclusions, type ApiJudgmentRow, type MatrixExclusion } from "./apiJudgmentProjection"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { EventRecord, ReviewStatus, Snapshot } from "@/lib/api/types"
import { wrapPath } from "@/lib/display/pathLines"
import { useProjectsQuery, useRequirementMutation, useReviewMutation, useSnapshotQuery } from "@/lib/query/hooks"
import { RequestLabDialog } from "@/features/evidence/RequestLabDialog"
import { observedObjectLabel } from "@/features/graph/observedObjectLabel"
import { MatrixOwnerControl } from "./MatrixOwnerControl"
import { OperationColumnResizeHandle, OPERATION_COLUMN_DEFAULT_WIDTH } from "./OperationColumnResizeHandle"
import { latestOperationEvent, requestLabEvent } from "./requestLabEvent"
import { findJudgmentItem, isReviewable, judgmentStatusDescription, judgmentStatusLabel, judgmentTone, projectJudgmentMatrix, quietStatusLabel, reviewSuffix, withoutService, type JudgmentItem, type JudgmentView } from "./judgmentProjection"

function objectLabel(snapshot: Snapshot | undefined, resource: string) {
  const object = snapshot?.displayObjects?.find(object => `${object.operation.split(" ")[0]} observed-object:${object.objectKey}` === resource)
  return object ? `${object.kind} · ${observedObjectLabel(object)}` : withoutService(resource)
}

const toneClass: Record<ReturnType<typeof judgmentTone>, string> = {
  risk: "border-amber-500/60 bg-amber-500/10",
  ok: "border-emerald-500/50 bg-emerald-500/10",
  invalid: "border-red-500/50 bg-red-500/10",
  gap: "border-border bg-muted/50",
  unknown: "border-border bg-card",
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
  return <section aria-label="접근 허용 기준" className="grid gap-3 border-t border-border pt-5">
    <div className="flex items-center gap-1.5"><h3 className="text-sm font-semibold">접근 허용 기준</h3><InfoHint label="접근 허용 기준">이 권한 이상의 계정만 접근 할 수 있어야 합니다</InfoHint></div>
    <div className="grid gap-1.5"><label htmlFor="matrix-minimum-role" className="text-xs text-muted-foreground">최소 권한</label><div className="flex gap-2"><select id="matrix-minimum-role" aria-label="최소 권한" className={select} value={requiredRole} disabled={disabled} onChange={(event) => setRequiredRole(event.target.value)}><option value="" disabled>아직 정하지 않음</option>{ROLE_OPTIONS.map((value) => <option key={value} value={value}>{roleLabel[value]} ({value})</option>)}</select><Button type="button" size="sm" variant="outline" className="h-10" aria-label="최소 권한 저장" disabled={disabled || !requiredRole || requirement.isPending} onClick={() => void run(() => requirement.mutateAsync({ operation: item.operation, role: requiredRole }), "최소 권한을 저장했습니다.")}>저장</Button></div></div>
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
  // 추천 여부와 무관하게 이 칸의 근거 요청을 Request Lab으로 연다. 대상 신원은 Request Lab의 전송 계정에서 고른다(자동 전송 없음).
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
  return <div className="grid content-start gap-6 p-5 text-sm leading-6">
    <header className="grid gap-4">
      <div className={`flex items-start gap-2 rounded-lg border px-3 py-3 ${confirmed ? "border-red-500/50 bg-red-500/10" : toneClass[judgmentTone(item.status)]}`}>
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <h2 className="min-w-0 flex-1 text-base font-semibold leading-6">{judgmentStatusLabel(item)}{reviewSuffix(item.reviewStatus)}</h2>
        {judgmentStatusDescription(item.status) && <InfoHint label={judgmentStatusLabel(item)}>{judgmentStatusDescription(item.status)}</InfoHint>}
      </div>
      <p className="break-all rounded-md border border-border bg-card px-3 py-3 font-mono text-sm leading-6">{withoutService(item.operation)}</p>
      <dl className="grid gap-3">
        <div className="flex items-center justify-between gap-3"><dt className="text-sm text-muted-foreground">확인 계정</dt><dd className="flex min-w-0 items-center gap-1.5 font-medium"><UserRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="break-all">{identityLabel(item.identity, item.identityLabel)}</span></dd></div>
        {resource && <div className="grid gap-1.5"><dt className="shrink-0 pt-0.5 text-sm text-muted-foreground">대상 데이터</dt><dd className="min-w-0 break-all text-left font-mono text-sm leading-6">{objectLabel(snapshot, resource)}</dd></div>}
      </dl>
    </header>
    <PolicyAssignment key={`${item.id}:${requiredRole ?? ""}`} item={item} requiredRole={requiredRole} disabled={disabled} />
    {resource && snapshot && <MatrixOwnerControl key={`${item.operation}:${resource}`} operation={item.operation} resource={resource} snapshot={snapshot} disabled={disabled} />}
    <section aria-label="요청·응답 확인" className="grid gap-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">요청·응답 확인</h3>{basisEvent && <span className="rounded-md border border-border/70 bg-background px-2 py-1 font-mono text-xs">HTTP {basisEvent.status}</span>}</div>
      {basisEvent && <div className="grid gap-2 text-sm"><p className="break-all font-mono leading-5">{basisEvent.method} {basisEvent.path}</p><p className="text-muted-foreground">{new Date(basisEvent.timestamp).toLocaleString("ko-KR")} · {{ human: "사용자 요청", scanner: "스캐너 요청", llm: "AI 요청", unknown: "출처 미확인" }[basisEvent.source] ?? basisEvent.source}</p></div>}
      {recommendation && <p className="text-xs">열린 창에서 {recommendation.testIdentityLabel} 계정을 선택해 확인하세요.{recommendation.stateChanging ? " 데이터를 바꾸는 요청이므로 보내기 전에 내용을 확인하세요." : ""}</p>}
      <Button type="button" size="sm" className="h-10 w-full justify-between" disabled={disabled || !basisEvent} onClick={() => setLabOpen(true)}>Request Lab 열기<ArrowUpRight aria-hidden="true" className="size-4" /></Button>
      {!basisEvent && <p className="text-xs text-muted-foreground">이 API의 요청 기록이 없어 Request Lab을 열 수 없습니다.</p>}
    </section>
    {labOpen && basisEvent && snapshot && <RequestLabDialog open onOpenChange={open => { if (!open) setLabOpen(false) }} event={basisEvent} accounts={snapshot.accounts} sessions={snapshot.managedSessions} verifications={snapshot.manualVerifications} datasetRevision={snapshot.datasetRevision ?? snapshot.identityRevision ?? 0} snapshotRevision={snapshot.revision} suspended={disabled} />}
    <section aria-label="취약점 확인" className="grid gap-3 border-t border-border pt-5">
      <h3 className="text-sm font-semibold">취약점 확인</h3>
      <Button type="button" size="sm" variant={confirmed ? "outline" : "destructive"} className="h-10 w-full" aria-pressed={confirmed} disabled={disabled || !reviewable || review.isPending} onClick={() => void submit(confirmed ? "UNRESOLVED" : "CONFIRMED")}>{confirmed ? "취약점 확정 취소" : "취약점으로 확정"}</Button>
      {!reviewable && <p className="text-sm leading-6 text-muted-foreground">이 결과는 취약점 확정 대상이 아닙니다.</p>}
      {message && <p role="status" className="text-xs">{message}</p>}
    </section>
  </div>
}

export function JudgmentMatrixView() {
  const snapshot = useSnapshotQuery()
  const projects = useProjectsQuery()
  const project = projects.data
  const currentProject = project && (project.datasetRevision === undefined || project.datasetRevision === snapshot.data?.datasetRevision) ? project : null
  const storageScope = currentProject?.active ? JSON.stringify([currentProject.directory, currentProject.active.id]) : null
  return <JudgmentMatrixWorkspace key={JSON.stringify([snapshot.data?.datasetRevision ?? "legacy", storageScope])} snapshot={snapshot} storageScope={storageScope} />
}

function JudgmentMatrixWorkspace({ snapshot, storageScope }: { snapshot: ReturnType<typeof useSnapshotQuery>; storageScope: string | null }) {
  const [apiLabEvent, setApiLabEvent] = useState<EventRecord | null>(null)
  const [operationWidth, setOperationWidth] = useState(OPERATION_COLUMN_DEFAULT_WIDTH)
  const scroll = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(0)
  const [api, setApi] = useState<string | null>(null)
  const [exclusions, setExclusions] = useState(() => loadMatrixExclusions(storageScope))
  const [exclusionMessage, setExclusionMessage] = useState("")
  const [undo, setUndo] = useState<MatrixExclusion[] | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const listPosition = useRef({ page: 0, top: 0, left: 0 })
  const pendingRestore = useRef(false)
  const [view, setView] = useState<JudgmentView>("function")
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const matrix = snapshot.data?.authorizationMatrix ?? null
  const projection = useMemo(() => matrix ? projectJudgmentMatrix(matrix, view, false) : null, [matrix, view])
  const objectLabels = useMemo(() => new Map(snapshot.data?.displayObjects?.map(object => [`${object.operation.split(" ")[0]} observed-object:${object.objectKey}`, `${object.kind} · ${observedObjectLabel(object)}`])), [snapshot.data?.displayObjects])
  const rowObjectLabel = (resource: string) => objectLabels.get(resource) ?? withoutService(resource)
  const apiKey = useMemo(() => matrixApiResolver(snapshot.data?.displayObjects), [snapshot.data?.displayObjects])
  const excludedKeys = useMemo(() => new Set(exclusions.filter(entry => entry.view === view).map(entry => entry.key)), [exclusions, view])
  const includedRows = useMemo(() => projection?.rows.filter(row => !excludedKeys.has(exclusionKey(view, apiKey(row), null)) && !excludedKeys.has(exclusionKey(view, row.operation, null))
    && !excludedKeys.has(exclusionKey(view, row.operation, row.resource))) ?? [], [projection, view, excludedKeys, apiKey])
  const displayRows = useMemo(() => (api ? includedRows.filter(row => apiKey(row) === api) : groupApiJudgments(includedRows, apiKey))
    .filter(row => !attentionOnly || row.attention), [includedRows, api, attentionOnly, apiKey])
  const excludedHere = exclusions.filter(entry => entry.view === view)
  const pageCount = Math.max(1, Math.ceil(displayRows.length / 50))
  const currentPage = Math.min(page, pageCount - 1)
  const visibleRows = displayRows.slice(currentPage * 50, (currentPage + 1) * 50)
  useLayoutEffect(() => {
    if (scroll.current) {
      scroll.current.scrollTop = pendingRestore.current ? listPosition.current.top : 0
      scroll.current.scrollLeft = pendingRestore.current ? listPosition.current.left : 0
    }
    pendingRestore.current = false
  }, [currentPage, api, view, attentionOnly])
  useEffect(() => { setPage(0); setApi(null) }, [view, attentionOnly])
  const openApi = (operation: string) => {
    if (!api) listPosition.current = { page: currentPage, top: scroll.current?.scrollTop ?? 0, left: scroll.current?.scrollLeft ?? 0 }
    setApi(operation); setPage(0); setSelectedId(null); setInspectorOpen(false)
  }
  const backToList = () => { pendingRestore.current = true; setApi(null); setPage(listPosition.current.page); setSelectedId(null); setInspectorOpen(false) }
  const updateExclusions = (next: MatrixExclusion[]) => {
    setExclusions(next)
    return saveMatrixExclusions(storageScope, next)
  }
  const exclude = (operation: string, resource: string | null) => {
    const key = exclusionKey(view, operation, resource)
    if (exclusions.some(entry => entry.key === key)) return
    setUndo(exclusions)
    const label = resource ? `${withoutService(operation)} · ${rowObjectLabel(resource)}` : withoutService(operation)
    const saved = updateExclusions([...exclusions, { key, view, operation, resource, label }])
    setExclusionMessage(`${resource ? "객체 행을" : "API를"} 매트릭스에서 제외했습니다.${saved ? "" : " 설정은 현재 화면에서만 유지됩니다."}`)
    setSelectedId(null); setInspectorOpen(false)
    if (api && resource === null) backToList()
  }
  const restore = (key?: string) => {
    updateExclusions(key ? exclusions.filter(entry => entry.key !== key) : exclusions.filter(entry => entry.view !== view))
    setUndo(null); setExclusionMessage("제외한 항목을 복원했습니다.")
  }
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
    <Popover open={restoreOpen} onOpenChange={setRestoreOpen}>
      <PopoverTrigger asChild><Button size="sm" variant="outline" disabled={disabled || excludedHere.length === 0}><RotateCcw aria-hidden="true" className="size-3.5" />제외한 항목 {excludedHere.length}</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0" aria-label="제외한 항목 복원">
        <div className="flex items-center justify-between gap-3 border-b p-3"><p className="text-sm font-semibold">제외한 항목 {excludedHere.length}</p><Button size="sm" variant="ghost" disabled={disabled || excludedHere.length === 0} onClick={() => restore()}>전체 복원</Button></div>
        <p className="px-3 pt-3 text-xs text-muted-foreground">매트릭스에서만 제외됩니다. 원본 요청과 판정 기록은 유지됩니다.</p>
        <ul className="max-h-80 overflow-auto p-2">{excludedHere.map(entry => <li key={entry.key} className="flex items-center gap-3 rounded-md p-2"><span className="min-w-0 flex-1 break-all text-sm"><span className="mr-2 text-xs text-muted-foreground">{entry.resource ? "객체" : "API"}</span>{entry.label}</span><Button size="sm" variant="outline" disabled={disabled} aria-label={`${entry.label} 복원`} onClick={() => restore(entry.key)}>복원</Button></li>)}</ul>
      </PopoverContent>
    </Popover>
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
      {summary && <ul title="제외 여부와 관계없이 전체 판정 기록의 집계입니다." role="list" aria-label="판정 요약" className="flex shrink-0 flex-wrap gap-x-6 gap-y-2 border-b border-border/70 pb-3">{[
        ["기능 권한 확인", summary.bflaTestRecommendations],
        ["데이터 권한 확인", summary.bolaIdorTestRecommendations],
        ["직접 확인 필요", summary.manualReviewPending],
        ["확정한 취약점", summary.humanConfirmed],
        ["정상·기각", summary.humanDismissed],
      ].map(([label, value]) => <li key={String(label)} className="flex items-center gap-2 text-sm"><p className="text-muted-foreground">{label}</p><p className="font-semibold tabular-nums">{value}</p></li>)}<li><InfoHint label="전체 판정 집계">제외 여부와 관계없이 전체 판정 기록을 집계합니다. 제외는 매트릭스의 표시만 바꿉니다.</InfoHint></li></ul>}
      {projection && <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 text-sm">
        {api ? <nav aria-label="판정 매트릭스 경로" className="flex min-w-0 flex-wrap items-center gap-2"><Button size="sm" variant="ghost" onClick={backToList}><ArrowLeft aria-hidden="true" className="size-4" />목록으로</Button><ChevronRight aria-hidden="true" className="size-3.5 text-muted-foreground" /><span className="break-all font-mono">{withoutService(api)}</span></nav> : <p className="text-muted-foreground">API {displayRows.length}개{view === "object" ? ` · 객체 ${displayRows.reduce((count, row) => count + (row as ApiJudgmentRow).objectCount, 0)}개` : ""}<InfoHint label="API별 판정 요약">수집된 객체의 판정 결과를 API별로 요약합니다. 의심·재현 결과를 우선 표시하며, API를 누르면 객체별 결과를 볼 수 있습니다. 요약은 API 전체의 정상 여부를 확정하지 않습니다.</InfoHint></p>}
        {api && <Button size="sm" variant="outline" disabled={disabled} onClick={() => exclude(api, null)}>이 API 제외</Button>}
      </div>}
      {exclusionMessage && <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm"><span>{exclusionMessage}</span>{undo && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { const saved = updateExclusions(undo); setUndo(null); setExclusionMessage(`제외를 취소했습니다.${saved ? "" : " 설정은 현재 화면에서만 유지됩니다."}`) }}>실행 취소</Button>}</div>}
      {projection && pageCount > 1 && <nav aria-label="판정 매트릭스 페이지" className="flex shrink-0 items-center justify-between gap-3 text-sm"><span>{currentPage * 50 + 1}–{Math.min((currentPage + 1) * 50, displayRows.length)} / {displayRows.length}</span><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전 페이지</Button><span>{currentPage + 1} / {pageCount}</span><Button size="sm" variant="outline" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>다음 페이지</Button></div></nav>}
      {projection && (displayRows.length ? <div ref={scroll} role="region" aria-label="판정 매트릭스 표" data-testid="judgment-matrix-scroll" tabIndex={0} className="min-h-40 min-w-0 max-w-full flex-1 overflow-auto rounded-md border overscroll-contain">
        <div className="relative min-h-full w-max min-w-full" style={{ width: operationWidth + projection.identities.length * 208 }}>
          <OperationColumnResizeHandle width={operationWidth} onWidthChange={setOperationWidth} />
          <Table containerClassName="w-max min-w-full overflow-visible" className="table-fixed min-w-full" style={{ width: operationWidth + projection.identities.length * 208 }}>
            <colgroup><col style={{ width: operationWidth }} />{projection.identities.map(identity => <col key={identity.id} />)}</colgroup>
            <TableHeader><TableRow><TableHead className="sticky top-0 z-40 bg-background py-3 pr-6 text-base">{api && view === "object" ? "객체" : "API"}<span className="mt-1 block text-xs font-normal text-muted-foreground">{api ? "결과를 누르면 상세 확인" : "API를 누르면 관련 결과 보기"}</span></TableHead>{projection.identities.map(identity => <TableHead key={identity.id} className="sticky top-0 z-30 min-w-44 whitespace-normal bg-background py-3"><span className="break-all text-base">{identityLabel(identity.id, identity.label)}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{roleLabel[identity.role.toUpperCase()] ?? identity.role}</span></TableHead>)}</TableRow></TableHeader>
            <TableBody>{visibleRows.map(row => {
              const group = api ? null : row as ApiJudgmentRow
              const aggregated = !api && (view === "object" || (group?.operations.length ?? 0) > 1)
              const latest = latestOperationEvent(snapshot.data?.events ?? [], group?.operations ?? row.operation, row.resource ? Object.values(row.cellsByIdentity).flatMap(cell => cell.evidenceIds) : undefined)
              return <TableRow key={row.key}>
                <TableHead scope="row" className="overflow-hidden whitespace-normal bg-background px-4 py-3 align-middle">
                  <div className="grid gap-2">
                    <button type="button" className="min-h-12 min-w-0 rounded-sm text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" aria-label={`${withoutService(row.operation)} 관련 결과 보기`} disabled={disabled} onClick={() => openApi(apiKey(row))}><OperationLabel operation={row.operation} width={operationWidth - 32} /></button>
                    {row.resource && <p className="line-clamp-2 text-sm font-normal leading-5 text-muted-foreground" title={`${rowObjectLabel(row.resource)}${row.ownerLabel ? ` · 객체 소유자 ${row.ownerLabel}` : ""}`}>{rowObjectLabel(row.resource)}{row.ownerLabel ? ` · 객체 소유자 ${row.ownerLabel}` : ""}</p>}
                    <div className="flex min-h-8 items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">{group && group.objectCount > 0 ? <>객체 {group.objectCount}개<ChevronRight aria-hidden="true" className="size-3.5" /></> : group ? group.operations.length > 1 ? `요청 경로 ${group.operations.length}개` : "기능 판정" : "객체별 결과"}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button size="icon" variant="ghost" className="size-8" aria-label={`${withoutService(row.operation)} 최신 요청을 Request Lab에서 열기`} title="최신 요청 열기" disabled={disabled || !latest} onClick={() => setApiLabEvent(latest ?? null)}><ArrowUpRight aria-hidden="true" className="size-4" /></Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2 font-normal text-muted-foreground" aria-label={`${row.resource ? rowObjectLabel(row.resource) : withoutService(row.operation)} 매트릭스에서 제외`} title="매트릭스에서만 제외" disabled={disabled} onClick={() => exclude(row.operation, row.resource)}>제외</Button>
                      </div>
                    </div>
                  </div>
                </TableHead>
                {projection.identities.map(identity => {
                  const cell = row.cellsByIdentity[identity.id]
                  const quiet = cell && cell.reviewStatus !== "CONFIRMED" && cell.reviewStatus !== "DISMISSED" ? quietStatusLabel[cell.status] : undefined
                  const counts = group?.countsByIdentity[identity.id]
                  return <TableCell key={identity.id} className="whitespace-normal px-3 py-3 align-middle">{cell ? <div className="relative"><button type="button" disabled={disabled} data-tone={judgmentTone(cell.status)} aria-pressed={!aggregated && cell.id === selectedId} aria-label={`${judgmentStatusLabel(cell)}${reviewSuffix(cell.reviewStatus)}: ${identityLabel(cell.identity, cell.identityLabel)} · ${withoutService(aggregated ? row.operation : cell.operation)}${!aggregated && "resource" in cell ? ` · ${rowObjectLabel(cell.resource ?? "")}` : ""}`} title={judgmentStatusDescription(cell.status) ?? judgmentStatusLabel(cell)} className={quiet ? `flex h-24 w-full min-w-44 flex-col justify-center gap-1.5 rounded-md border border-border bg-muted/30 px-4 py-3 pr-10 text-left text-sm leading-5 text-muted-foreground hover:bg-muted/50 ${!aggregated && cell.id === selectedId ? "ring-2 ring-ring" : ""}` : `flex h-24 w-full min-w-44 flex-col justify-center gap-1.5 rounded-md border px-4 py-3 pr-10 text-left text-sm leading-5 ${cell.reviewStatus === "CONFIRMED" ? "border-red-500/50 bg-red-500/10" : toneClass[judgmentTone(cell.status)]} ${!aggregated && cell.id === selectedId ? "ring-2 ring-ring" : ""}`} onClick={() => aggregated ? openApi(row.operation) : select(cell.id)}>
                    <span className="line-clamp-2 text-base font-semibold leading-6">{quiet ?? judgmentStatusLabel(cell)}{reviewSuffix(cell.reviewStatus)}</span>
                    {aggregated && counts && (group.objectCount > 1 || group.operations.length > 1) && <span className="truncate text-sm font-normal leading-5 opacity-90" title={counts.map(({ label, count }) => `${label} ${count}`).join(" · ")}>{counts.map(({ label, count }) => `${label} ${count}`).join(" · ")}</span>}
                  </button><span className="absolute top-3 right-3" title={judgmentStatusDescription(cell.status)}><InfoHint label={`${judgmentStatusLabel(cell)} · ${identityLabel(cell.identity, cell.identityLabel)} · ${withoutService(aggregated ? row.operation : cell.operation)}${!aggregated && row.resource ? ` · ${rowObjectLabel(row.resource)}` : ""}`}>{judgmentStatusDescription(cell.status)}</InfoHint></span></div> : <span className="flex h-24 min-w-44 items-center rounded-md border border-dashed border-border px-4 text-sm text-muted-foreground">데이터 없음</span>}</TableCell>
                })}
              </TableRow>
            })}</TableBody>
          </Table>
        </div>
      </div> : <div className="grid justify-items-start gap-3 rounded-md border p-6 text-sm text-muted-foreground"><p>{api ? "현재 API에 표시할 객체가 없습니다. 필터 또는 제외한 항목을 확인하세요." : "현재 필터에 표시할 API가 없습니다. 필터 또는 제외한 항목을 확인하세요."}</p>{api && <Button variant="outline" size="sm" onClick={backToList}>목록으로</Button>}</div>)}
    </section>
    {apiLabEvent && snapshot.data && <RequestLabDialog key={apiLabEvent.eventId} open onOpenChange={open => { if (!open) setApiLabEvent(null) }} event={apiLabEvent} accounts={snapshot.data.accounts} sessions={snapshot.data.managedSessions} verifications={snapshot.data.manualVerifications} datasetRevision={snapshot.data.datasetRevision ?? snapshot.data.identityRevision ?? 0} snapshotRevision={snapshot.data.revision} suspended={disabled} />}
  </ReferenceAnalysisWorkspace>
}
