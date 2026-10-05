import { useEffect, useMemo, useState, type ReactNode } from "react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ReviewStatus, Snapshot } from "@/lib/api/types"
import { wrapPath } from "@/lib/display/pathLines"
import { useRequirementMutation, useResourcePolicyMutation, useReviewMutation, useRoleMutation, useSnapshotQuery } from "@/lib/query/hooks"
import { RequestLabDialog } from "@/features/evidence/RequestLabDialog"
import { findJudgmentItem, isReviewable, judgmentTone, projectJudgmentMatrix, quietStatusLabel, reviewSuffix, withoutService, type JudgmentItem, type JudgmentView } from "./judgmentProjection"

const toneClass: Record<ReturnType<typeof judgmentTone>, string> = {
  risk: "border-amber-500/60 bg-amber-500/10",
  ok: "border-emerald-500/50 bg-emerald-500/10",
  invalid: "border-red-500/50 bg-red-500/10",
  gap: "border-border/70 bg-muted/30",
  unknown: "border-border/70 bg-background/40",
}
const ROLE_OPTIONS = ["USER", "LV1", "LV2", "ADMIN"] as const
const RESOURCE_POLICY_OPTIONS = ["UNKNOWN", "OWNER_ONLY", "ROLE_SHARED", "AUTHENTICATED_SHARED", "PUBLIC", "ADMIN_ONLY"] as const
const resourcePolicyLabel: Record<(typeof RESOURCE_POLICY_OPTIONS)[number], string> = {
  UNKNOWN: "미정", OWNER_ONLY: "소유자 전용", ROLE_SHARED: "동일 역할 공유",
  AUTHENTICATED_SHARED: "인증 사용자 공유", PUBLIC: "공개", ADMIN_ONLY: "관리자 전용",
}

const methodTone: Record<string, string> = {
  GET: "border-observation-human/40 bg-observation-human/10 text-observation-human",
  POST: "border-observation-scanner/40 bg-observation-scanner/10 text-observation-scanner",
}

/** 경로는 `/` 경계로 최대 두 줄, 넘치면 앞을 줄여 끝(자원·ID)을 남긴다. 폭 제한은 표 칸이 아니라 안쪽 블록에 건다(표 칸의 max-width는 무시된다). */
const PATH_LINE_CHARS = 40

function OperationLabel({ operation }: { operation: string }) {
  const label = withoutService(operation)
  const separator = label.indexOf(" ")
  const method = separator > 0 ? label.slice(0, separator) : label
  const path = separator > 0 ? label.slice(separator + 1) : ""
  const lines = path ? wrapPath(path, (line) => line.length <= PATH_LINE_CHARS) : []
  const trimmed = lines.join("") !== path
  return <span className="flex min-w-0 items-start gap-2" title={path || undefined}>
    <Badge variant="outline" className={`shrink-0 font-mono text-sm ${methodTone[method] ?? "border-border bg-muted/40 text-foreground"}`}>{method}</Badge>
    {path && <span className="grid min-w-0 max-w-[24rem] font-mono text-sm leading-6">
      <span aria-hidden={trimmed || undefined} className="grid">{lines.map((line, index) => <span key={index} className="break-all">{line}</span>)}</span>
      {trimmed && <span className="sr-only">{path}</span>}
    </span>}
  </span>
}

/**
 * 역할·정책 지정. 역할은 토큰이나 경로에서 추정하지 않고 사용자가 지정한다(D-018). 기존 /api/requirement·/api/role·객체 정책 API만 호출하며
 * 판정은 서버가 다시 계산한다. 모든 셀에서 같은 자리에 두고 현재 값을 미리 채운다.
 */
function PolicyAssignment({ item, requiredRole: currentRequiredRole, identityKind, identityRole, disabled }: { item: JudgmentItem; requiredRole: string | undefined; identityKind: string | undefined; identityRole: string | undefined; disabled: boolean }) {
  const requirement = useRequirementMutation()
  const resourcePolicyMutation = useResourcePolicyMutation()
  const roleMutation = useRoleMutation()
  const [requiredRole, setRequiredRole] = useState<string>(currentRequiredRole && ROLE_OPTIONS.includes(currentRequiredRole as never) ? currentRequiredRole : "ADMIN")
  const [role, setRole] = useState<string>(identityRole && identityRole !== "Unknown" && ROLE_OPTIONS.includes(identityRole as never) ? identityRole : "USER")
  const resourceTarget = "resource" in item ? item.resource : null
  const [resourcePolicy, setResourcePolicy] = useState<string>("resourcePolicy" in item ? item.resourcePolicy ?? "UNKNOWN" : "UNKNOWN")
  const [message, setMessage] = useState<string | null>(null)
  const roleEditable = identityKind === "REGISTERED" || identityKind === "OBSERVED"
  const run = async (action: () => Promise<{ message?: string }>, fallback: string) => {
    setMessage(null)
    try { setMessage((await action()).message ?? fallback) }
    catch (error) { setMessage(error instanceof Error ? error.message : "저장 실패") }
  }
  const select = "rounded border border-border/70 bg-background px-2 py-1 text-sm"
  return <section aria-label="정책·역할 지정" className="grid gap-3 rounded-md border border-border/70 p-3">
    <h3 className="text-sm font-semibold">역할·정책 지정</h3>
    <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-xs"><span>필수 역할</span><select aria-label="필수 역할" className={select} value={requiredRole} disabled={disabled} onChange={(event) => setRequiredRole(event.target.value)}>{ROLE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><Button type="button" size="sm" variant="outline" aria-label="필수 역할 저장" disabled={disabled || requirement.isPending} onClick={() => void run(() => requirement.mutateAsync({ operation: item.operation, role: requiredRole }), "필수 역할을 저장했습니다.")}>저장</Button></div>
    {roleEditable && <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-xs"><span>{item.identityLabel} 역할</span><select aria-label="신원 역할" className={select} value={role} disabled={disabled} onChange={(event) => setRole(event.target.value)}>{ROLE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><Button type="button" size="sm" variant="outline" aria-label="신원 역할 저장" disabled={disabled || roleMutation.isPending} onClick={() => void run(() => roleMutation.mutateAsync({ identity: item.identity, role }), "신원 역할을 저장했습니다.")}>저장</Button></div>}
    {resourceTarget && <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-xs"><span>객체 접근 정책</span><select aria-label="객체 접근 정책" className={select} value={resourcePolicy} disabled={disabled} onChange={(event) => setResourcePolicy(event.target.value)}>{RESOURCE_POLICY_OPTIONS.map((value) => <option key={value} value={value}>{resourcePolicyLabel[value]}</option>)}</select></label><Button type="button" size="sm" variant="outline" aria-label="객체 정책 저장" disabled={disabled || resourcePolicyMutation.isPending} onClick={() => void run(() => resourcePolicyMutation.mutateAsync({ target: resourceTarget, policy: resourcePolicy }), "객체 접근 정책을 저장했습니다.")}>저장</Button></div>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>
}

function JudgmentDetail({ item, requiredRole, identity, disabled, snapshot }: { item: JudgmentItem; requiredRole: string | undefined; identity: { kind: string; role: string } | undefined; disabled: boolean; snapshot: Snapshot | undefined }) {
  const review = useReviewMutation()
  const [labOpen, setLabOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(item.reviewStatus === "CONFIRMED")
  const [note, setNote] = useState(item.reviewNote)
  const [message, setMessage] = useState<string | null>(null)
  // 같은 cell·검토 Evidence 안에서 저장된 서버 값을 반영한다. 선택 문맥이 바뀌면 부모 key가 폼과 진행 중 응답을 분리한다.
  useEffect(() => { setConfirmed(item.reviewStatus === "CONFIRMED"); setNote(item.reviewNote) }, [item.reviewStatus, item.reviewNote])
  const resource = "resource" in item ? item.resource : null
  const recommendation = item.recommendation
  // 추천 여부와 무관하게 이 칸의 근거 요청을 Request Lab으로 연다. 대상 신원은 Request Lab의 전송 인증에서 고른다(자동 전송 없음).
  const basisId = recommendation?.basisEvidenceIds[0] ?? item.evidenceIds[0]
  const basisEvent = (basisId ? snapshot?.events.find(event => event.eventId === basisId || event.clusterEvidenceIds?.includes(basisId)) : undefined)
    ?? snapshot?.events.filter(event => event.op === item.operation).sort((left, right) => right.timestamp - left.timestamp)[0]
  // 사람 판정은 추천·공백·수동 검토 셀에서만 저장된다. 다른 셀은 같은 자리에 두되 입력을 잠근다.
  const reviewable = isReviewable(item) || judgmentTone(item.status) === "gap"
  const submit = async (status: ReviewStatus) => {
    setMessage(null)
    try {
      const result = await review.mutateAsync({ itemId: item.id, status, note })
      setMessage(result.message ?? "판정을 저장했습니다.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "판정 저장 실패")
    }
  }
  return <div className="grid gap-4 p-4 text-sm">
    <header><h2 className="text-base font-semibold">{item.statusLabel}{reviewSuffix(item.reviewStatus)}</h2><p className="break-all text-xs text-muted-foreground">{item.identityLabel} · {withoutService(item.operation)}{resource ? ` · ${resource}` : ""}</p></header>
    <PolicyAssignment key={`${item.id}:${requiredRole ?? ""}:${"resourcePolicy" in item ? item.resourcePolicy : ""}:${identity?.role ?? ""}`} item={item} requiredRole={requiredRole} identityKind={identity?.kind} identityRole={identity?.role} disabled={disabled} />
    <section aria-label="Request Lab 전송" className="grid gap-2 rounded-md border border-border/70 p-3">
      <h3 className="text-sm font-semibold">Request Lab 전송</h3>
      {recommendation && <p className="text-xs">{recommendation.basisIdentityLabel} → {recommendation.testIdentityLabel}: Request Lab의 전송 인증에서 {recommendation.testIdentityLabel}을(를) 고르세요.{recommendation.stateChanging ? " 상태를 바꾸는 요청이니 직접 확인한 뒤 보내세요." : ""}</p>}
      <Button type="button" size="sm" className="w-fit" disabled={disabled || !basisEvent} onClick={() => setLabOpen(true)}>Request Lab에서 보내기</Button>
      {!basisEvent && <p className="text-xs text-muted-foreground">이 API의 요청 기록이 없어 Request Lab을 열 수 없습니다.</p>}
    </section>
    {labOpen && basisEvent && snapshot && <RequestLabDialog open onOpenChange={open => { if (!open) setLabOpen(false) }} event={basisEvent} accounts={snapshot.accounts} sessions={snapshot.managedSessions} verifications={snapshot.manualVerifications} datasetRevision={snapshot.datasetRevision ?? snapshot.identityRevision ?? 0} snapshotRevision={snapshot.revision} suspended={disabled} />}
    <section aria-label="사람 최종 판정" className="grid gap-2 rounded-md border border-border/70 p-3">
      <h3 className="text-sm font-semibold">사람 최종 판정</h3>
      <label className="flex items-start gap-2 text-xs"><Checkbox className="mt-0.5" checked={confirmed} disabled={disabled || !reviewable} onCheckedChange={(checked) => setConfirmed(checked === true)} /><span>취약점으로 확정</span></label>
      <label className="grid gap-1 text-xs"><span>검증 메모</span><input aria-label="검증 메모" className="rounded border border-border/70 bg-background px-2 py-1 text-sm" maxLength={2000} value={note} disabled={disabled || !reviewable} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={disabled || !reviewable || review.isPending} onClick={() => void submit(confirmed ? "CONFIRMED" : "UNRESOLVED")}>판정 저장</Button><Button type="button" size="sm" variant="outline" disabled={disabled || !reviewable || review.isPending} onClick={() => void submit("DISMISSED")}>정상·기각</Button></div>
      {!reviewable && <p className="text-xs text-muted-foreground">검토할 추천이 없는 셀입니다.</p>}
      {message && <p role="status" className="text-xs">{message}</p>}
    </section>
  </div>
}

export function JudgmentMatrixView({ viewSwitcher }: { viewSwitcher?: ReactNode } = {}) {
  const snapshot = useSnapshotQuery()
  return <JudgmentMatrixWorkspace key={snapshot.data?.datasetRevision ?? "legacy"} snapshot={snapshot} viewSwitcher={viewSwitcher} />
}

function JudgmentMatrixWorkspace({ snapshot, viewSwitcher }: { snapshot: ReturnType<typeof useSnapshotQuery>; viewSwitcher?: ReactNode }) {
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
  // 같은 판정 데이터를 다른 관점으로 바꿔 보는 전환: 가운데 정렬한 두 알약 버튼. 축 설명은 마우스 설명(title)과 접근 이름에 둔다.
  const context = <section className="grid gap-4 p-3">
    <Tabs value={view} onValueChange={(value) => { setView(value === "object" ? "object" : "function"); setSelectedId(null); setInspectorOpen(false) }}><TabsList aria-label="판정 매트릭스 보기" className="flex h-auto w-full justify-center gap-2 bg-transparent p-0">{([["function", "BFLA", "역할 × 기능"], ["object", "BOLA/IDOR", "계정 × 객체"]] as const).map(([value, name, axis]) => <TabsTrigger key={value} value={value} aria-label={`${name} · ${axis}`} title={axis} className="h-8 flex-1 rounded-full border border-border px-3 text-sm font-semibold text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none">{name}</TabsTrigger>)}</TabsList></Tabs>
    <div>
      <Button type="button" role="switch" aria-checked={attentionOnly} variant="ghost" className="h-auto w-full justify-between px-0 py-1 hover:bg-transparent" onClick={() => setAttentionOnly((current) => !current)}><span className="text-sm font-normal">주의 항목만</span><span aria-hidden="true" className={`relative block h-5 w-9 shrink-0 rounded-full border transition-colors ${attentionOnly ? "border-primary bg-primary" : "border-input bg-muted"}`}><span className={`absolute top-0.5 left-0.5 block size-3.5 rounded-full bg-background shadow-sm transition-transform ${attentionOnly ? "translate-x-4" : "translate-x-0"}`} /></span></Button>
    </div>
  </section>
  const inspector = selected && matrix ? <JudgmentDetail key={JSON.stringify([selected.id, selected.reviewEvidenceIds])} item={selected} requiredRole={snapshot.data?.requiredRoles[selected.operation]} identity={matrix.identities.find((identity) => identity.id === selected.identity)} disabled={disabled} snapshot={snapshot.data} /> : <p className="p-4 text-sm text-muted-foreground">판정 셀을 선택하세요.</p>

  return <ReferenceAnalysisWorkspace ariaLabel="판정 매트릭스 분석 영역" context={context} contextTitle={false} inspector={inspector} inspectorOpen={inspectorOpen} onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) setSelectedId(null) }}>
    <section className="grid gap-4 p-3" aria-labelledby="judgment-title">
      {viewSwitcher}<h1 id="judgment-title" className="sr-only">판정 매트릭스</h1>
      {snapshot.isError && <Alert variant="destructive"><AlertTitle>판정 매트릭스를 불러오지 못했습니다.</AlertTitle><AlertDescription>
        <p>{snapshot.error instanceof Error ? snapshot.error.message : "다시 시도하세요."}</p>
        {snapshot.data ? <><p>마지막으로 불러온 데이터를 표시하고 있습니다.</p><p>마지막 성공 시각: {snapshot.dataUpdatedAt > 0 && Number.isFinite(snapshot.dataUpdatedAt) ? <time dateTime={new Date(snapshot.dataUpdatedAt).toISOString()}>{new Date(snapshot.dataUpdatedAt).toLocaleString()}</time> : "기록 없음"}</p><p>갱신에 성공할 때까지 관측 기록 상세와 사람 판정 저장이 비활성화됩니다.</p></> : <p>서버 연결을 확인하고 다시 시도하세요. 아직 성공한 snapshot이 없습니다.</p>}
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
      {summary && <ul role="list" aria-label="판정 요약" className="grid gap-2 sm:grid-cols-5">{[
        ["BFLA 테스트 추천", summary.bflaTestRecommendations],
        ["BOLA/IDOR 테스트 추천", summary.bolaIdorTestRecommendations],
        ["수동 검토 대기", summary.manualReviewPending],
        ["사용자 취약점 확정", summary.humanConfirmed],
        ["정상·기각", summary.humanDismissed],
      ].map(([label, value]) => <li key={String(label)} className="rounded-md border border-border/70 p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p></li>)}</ul>}
      {projection && (projection.rows.length ? <div role="region" aria-label="판정 매트릭스 표" data-testid="judgment-matrix-scroll" tabIndex={0} className="max-h-[44rem] max-w-full overflow-x-auto overflow-y-auto rounded-md border overscroll-contain"><Table containerClassName="w-max min-w-full overflow-visible" className="min-w-max"><TableHeader><TableRow><TableHead className="sticky top-0 z-40 bg-background py-3 text-base">{view === "function" ? "기능 · 기대 역할" : "작업 · 객체 · 소유자"}</TableHead>{projection.identities.map((identity) => <TableHead key={identity.id} className="sticky top-0 z-30 min-w-44 whitespace-normal bg-background py-3"><span className="break-all text-base">{identity.label}</span><span className="ml-1.5 text-sm font-normal text-muted-foreground">{identity.role}</span></TableHead>)}</TableRow></TableHeader><TableBody>{projection.rows.map((row) => <TableRow key={row.key}><TableHead scope="row" className="whitespace-normal bg-background py-3 align-top"><OperationLabel operation={row.operation} /></TableHead>{projection.identities.map((identity) => { const cell = row.cellsByIdentity[identity.id]; const quiet = cell && cell.reviewStatus !== "CONFIRMED" && cell.reviewStatus !== "DISMISSED" ? quietStatusLabel[cell.status] : undefined; return <TableCell key={identity.id} className="whitespace-normal py-3 align-top">{cell ? <button type="button" disabled={disabled} data-tone={judgmentTone(cell.status)} aria-pressed={cell.id === selectedId} aria-label={`${cell.statusLabel}${reviewSuffix(cell.reviewStatus)}: ${cell.identityLabel} · ${withoutService(cell.operation)}${"resource" in cell ? ` · ${cell.resource}` : ""}`} title={quiet ? cell.statusLabel : undefined} className={quiet ? `grid w-full min-w-28 rounded-md border border-transparent p-3 text-left text-sm text-muted-foreground hover:bg-muted/50 ${cell.id === selectedId ? "ring-2 ring-ring" : ""}` : `grid w-full min-w-44 rounded-md border p-3 text-left text-sm ${cell.reviewStatus === "CONFIRMED" ? "border-red-500/50 bg-red-500/10" : toneClass[judgmentTone(cell.status)]} ${cell.id === selectedId ? "ring-2 ring-ring" : ""}`} onClick={() => select(cell.id)}><span className={quiet ? undefined : "font-semibold"}>{quiet ?? cell.statusLabel}{reviewSuffix(cell.reviewStatus)}</span></button> : <span className="text-sm text-muted-foreground">데이터 없음</span>}</TableCell> })}</TableRow>)}</TableBody></Table></div> : <p className="rounded-md border p-6 text-sm text-muted-foreground">{view === "function" ? "현재 필터에 표시할 역할 × 기능 조합이 없습니다." : "객체 참조 관측 기록이 없거나 현재 필터에 표시할 계정 × 객체 조합이 없습니다."}</p>)}
    </section>
  </ReferenceAnalysisWorkspace>
}
