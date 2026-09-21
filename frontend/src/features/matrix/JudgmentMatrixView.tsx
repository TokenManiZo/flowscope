import { useEffect, useMemo, useState } from "react"

import { EvidenceSheet, type StructuredEvidenceSelection } from "@/components/layout/EvidenceSheet"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { AuthorizationMatrix, ReviewStatus } from "@/lib/api/types"
import { useAuthorizationReplayKillMutation, useAuthorizationReplayMutation, useHumanRunQuery, useRequirementMutation, useResourcePolicyMutation, useReviewMutation, useRoleMutation, useSnapshotQuery } from "@/lib/query/hooks"
import { actualLabel, confidenceCodes, expectedLabel, findJudgmentItem, isReviewable, judgmentTone, projectJudgmentMatrix, reviewSuffix, withoutService, type JudgmentItem, type JudgmentView } from "./judgmentProjection"

const toneClass: Record<ReturnType<typeof judgmentTone>, string> = {
  risk: "border-amber-500/60 bg-amber-500/10",
  ok: "border-emerald-500/50 bg-emerald-500/10",
  invalid: "border-red-500/50 bg-red-500/10",
  gap: "border-border/70 bg-muted/30",
  unknown: "border-border/70 bg-background/40",
}
const VISIBLE_EVIDENCE = 5

function EvidenceIdList({ ids }: { ids: readonly string[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? ids : ids.slice(0, VISIBLE_EVIDENCE)
  return <div className="grid gap-1">{visible.length ? visible.map((id) => <p key={id} className="break-all rounded border bg-muted/30 p-1.5 font-mono text-xs">{id}</p>) : <p className="text-xs text-muted-foreground">이 조합은 아직 미실행</p>}{ids.length > VISIBLE_EVIDENCE && <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => setExpanded((current) => !current)}>{expanded ? "Evidence 접기" : `Evidence ${ids.length - VISIBLE_EVIDENCE}개 더 보기`}</Button>}</div>
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

function OperationLabel({ operation }: { operation: string }) {
  const label = withoutService(operation)
  const separator = label.indexOf(" ")
  const method = separator > 0 ? label.slice(0, separator) : label
  const path = separator > 0 ? label.slice(separator + 1) : ""
  return <span className="flex min-w-0 items-center gap-2">
    <Badge variant="outline" className={`shrink-0 font-mono ${methodTone[method] ?? "border-border bg-muted/40 text-foreground"}`}>{method}</Badge>
    {path && <span className="break-all font-mono text-xs">{path}</span>}
  </span>
}

/**
 * BFLA 판정은 이 작업의 필수 역할(P3)과 신원의 역할이 모두 지정돼야 만들어진다. 역할은 토큰이나 경로에서 추정하지
 * 않고 사용자가 지정한다(D-018). 기존 /api/requirement·/api/role만 호출하며 판정 자체는 서버가 다시 계산한다.
 */
function PolicyAssignment({ item, identityKind, identityRole, disabled }: { item: JudgmentItem; identityKind: string | undefined; identityRole: string | undefined; disabled: boolean }) {
  const requirement = useRequirementMutation()
  const resourcePolicyMutation = useResourcePolicyMutation()
  const roleMutation = useRoleMutation()
  const [requiredRole, setRequiredRole] = useState<string>("ADMIN")
  const [role, setRole] = useState<string>("USER")
  const resourceTarget = "resource" in item ? item.resource : null
  const [resourcePolicy, setResourcePolicy] = useState<string>("resourcePolicy" in item ? item.resourcePolicy ?? "UNKNOWN" : "UNKNOWN")
  const [message, setMessage] = useState<string | null>(null)
  const needsRequirement = item.policy.level < 3
  const needsRole = (identityKind === "REGISTERED" || identityKind === "OBSERVED") && identityRole === "Unknown"
  if (!needsRequirement && !needsRole && !resourceTarget) return null
  const run = async (action: () => Promise<{ message?: string }>, fallback: string) => {
    setMessage(null)
    try { setMessage((await action()).message ?? fallback) }
    catch (error) { setMessage(error instanceof Error ? error.message : "저장 실패") }
  }
  return <section aria-label="정책·역할 지정" className="grid gap-2 rounded-md border border-sky-500/50 bg-sky-500/10 p-3">
    <h3 className="text-sm font-semibold">정책·역할 지정</h3>
    <p className="text-xs">{needsRequirement ? `정책 ${item.policy.code}: 이 작업의 필수 역할이 지정되지 않아 BFLA 판정을 만들 수 없습니다.` : ""}{needsRequirement && needsRole ? " " : ""}{needsRole ? `${item.identityLabel}의 역할이 Unknown이라 기대 판정을 세울 수 없습니다.` : ""} 역할은 추정하지 않고 사용자가 지정합니다.</p>
    {needsRequirement && <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-xs"><span>필수 역할</span><select aria-label="필수 역할" className="rounded border border-border/70 bg-background px-2 py-1 text-sm" value={requiredRole} disabled={disabled} onChange={(event) => setRequiredRole(event.target.value)}>{ROLE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><Button type="button" size="sm" disabled={disabled || requirement.isPending} onClick={() => void run(() => requirement.mutateAsync({ operation: item.operation, role: requiredRole }), "필수 역할을 저장했습니다.")}>필수 역할 저장</Button></div>}
    {needsRole && <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-xs"><span>{item.identityLabel} 역할</span><select aria-label="신원 역할" className="rounded border border-border/70 bg-background px-2 py-1 text-sm" value={role} disabled={disabled} onChange={(event) => setRole(event.target.value)}>{ROLE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><Button type="button" size="sm" disabled={disabled || roleMutation.isPending} onClick={() => void run(() => roleMutation.mutateAsync({ identity: item.identity, role }), "신원 역할을 저장했습니다.")}>신원 역할 저장</Button></div>}
    {resourceTarget && <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-xs"><span>객체 접근 정책</span><select aria-label="객체 접근 정책" className="rounded border border-border/70 bg-background px-2 py-1 text-sm" value={resourcePolicy} disabled={disabled} onChange={(event) => setResourcePolicy(event.target.value)}>{RESOURCE_POLICY_OPTIONS.map((value) => <option key={value} value={value}>{resourcePolicyLabel[value]}</option>)}</select></label><Button type="button" size="sm" disabled={disabled || resourcePolicyMutation.isPending} onClick={() => void run(() => resourcePolicyMutation.mutateAsync({ target: resourceTarget, policy: resourcePolicy }), "객체 접근 정책을 저장했습니다.")}>객체 정책 저장</Button></div>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>
}

/**
 * 확인 루프의 실제 조건을 그 자리에서 알린다. Repeater 재전송은 활성 HUMAN 탐색(run) 안에서만 관측(정본)으로 들어가고,
 * run 밖이면 D-071로 제외된다. Request Lab 재전송은 D-008에 따라 관측과 분리 저장되어 셀 status를 바꾸지 않는다.
 */
function HumanRunGuidance({ disabled }: { disabled: boolean }) {
  const humanRun = useHumanRunQuery()
  const active = humanRun.data?.active
  if (active === undefined) return null
  return active
    ? <p role="status" aria-label="확인 재전송 조건" className="text-xs">HUMAN 탐색 활성: 지금 Repeater로 재전송하면 관측으로 반영돼 이 셀의 판정이 다시 계산됩니다. Request Lab 재전송은 검증 이력으로만 분리 저장됩니다(D-008).</p>
    : <div role="status" aria-label="확인 재전송 조건" className="grid gap-2 rounded border border-amber-500/60 bg-amber-500/10 p-2 text-xs">
      <p>HUMAN 탐색이 꺼져 있습니다. run 밖에서 Repeater로 재전송한 요청은 비교에서 제외되어(D-071) 이 셀에 반영되지 않습니다. 점검에서 HUMAN 탐색을 시작한 뒤 재전송하세요.</p>
      <Button type="button" size="sm" variant="outline" className="w-fit" disabled={disabled} onClick={() => { window.location.hash = "#inspection" }}>점검에서 HUMAN 탐색 시작</Button>
    </div>
}

function JudgmentDetail({ item, matrix, disabled, onOpenEvidence }: { item: JudgmentItem; matrix: AuthorizationMatrix; disabled: boolean; onOpenEvidence(selection: StructuredEvidenceSelection): void }) {
  const review = useReviewMutation()
  const replay = useAuthorizationReplayMutation()
  const stopReplay = useAuthorizationReplayKillMutation()
  const [confirmed, setConfirmed] = useState(item.reviewStatus === "CONFIRMED")
  const [note, setNote] = useState(item.reviewNote)
  const [message, setMessage] = useState<string | null>(null)
  const [replayArmed, setReplayArmed] = useState(false)
  const [replayMessage, setReplayMessage] = useState<string | null>(null)
  // 같은 cell·검토 Evidence 안에서 저장된 서버 값을 반영한다. 선택 문맥이 바뀌면 부모 key가 폼과 진행 중 응답을 분리한다.
  useEffect(() => { setConfirmed(item.reviewStatus === "CONFIRMED"); setNote(item.reviewNote) }, [item.reviewStatus, item.reviewNote])
  const resource = "resource" in item ? item.resource : null
  const ownership = "ownership" in item ? item.ownership : undefined
  const submit = async (status: ReviewStatus) => {
    setMessage(null)
    try {
      const result = await review.mutateAsync({ itemId: item.id, status, note })
      setMessage(result.message ?? "판정을 저장했습니다.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "판정 저장 실패")
    }
  }
  const runReplay = async () => {
    setReplayMessage(null)
    try {
      const result = await replay.mutateAsync({ itemId: item.id, armed: replayArmed })
      setReplayMessage(`${result.message} 전송 ${result.run.sent} · 초안 ${result.run.drafted} · 스킵 ${result.run.skipped}`)
    } catch (error) {
      setReplayMessage(error instanceof Error ? error.message : "안전 재전송 실패")
    } finally {
      setReplayArmed(false)
    }
  }
  const stop = async () => {
    try {
      const result = await stopReplay.mutateAsync()
      setReplayMessage(result.message)
    } catch (error) {
      setReplayMessage(error instanceof Error ? error.message : "재전송 중지 실패")
    }
  }
  const evidenceSelection = (evidenceIds: readonly string[], identity: string): StructuredEvidenceSelection => ({ kind: "matrix", identity, operation: item.operation, resource, evidenceIds, eventIds: evidenceIds })
  const basisIdentity = matrix.identities.find((identity) => identity.id === item.recommendation?.basisIdentity)
  const cellIdentity = matrix.identities.find((identity) => identity.id === item.identity)
  return <div className="grid gap-4 p-4 text-sm">
    <div><h2 className="text-base font-semibold">{item.statusLabel}{reviewSuffix(item.reviewStatus)}</h2><p className="break-all text-xs text-muted-foreground">{item.identityLabel} · {withoutService(item.operation)}{resource ? ` · ${resource}` : ""}</p>{"relation" in item && <p className="text-xs text-muted-foreground">관계 {item.relation} · 기법 {item.techniques.join("/")} · 소유자 {item.ownerLabel || "미확정"} · 객체 정책 {resourcePolicyLabel[item.resourcePolicy ?? "UNKNOWN"]}</p>}</div>
    {item.recommendation && <section aria-label="테스트 추천 조합" className="grid gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
      <h3 className="text-sm font-semibold">{item.recommendation.type} 테스트 추천 조합</h3>
      <p><b>{item.recommendation.basisIdentityLabel} → {item.recommendation.testIdentityLabel}</b></p>
      <p className="text-xs">{item.recommendation.reason}</p>
      <p className="text-xs">{item.recommendation.instruction}</p>
      {item.recommendation.stateChanging && <p className="text-xs font-semibold text-amber-300">상태변경 요청: 영향과 복구 방법을 확인한 뒤 직접 전송하세요.</p>}
      <p className="text-xs text-muted-foreground">명시적으로 무장한 GET/HEAD만 자동 재전송합니다. POST/PUT/PATCH/DELETE는 Burp Repeater 초안만 열며 자동 전송하지 않습니다.</p>
      <section aria-label="안전 능동 재전송" className="grid gap-2 rounded border border-border/70 bg-background/60 p-2">
        <h4 className="text-xs font-semibold">안전 능동 재전송</h4>
        <label className="flex items-start gap-2 text-xs"><Checkbox className="mt-0.5" checked={replayArmed} disabled={disabled || replay.isPending} onCheckedChange={(checked) => setReplayArmed(checked === true)} /><span>안전 자동 재전송 허용 (이번 1회)</span></label>
        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={disabled || !replayArmed || replay.isPending} onClick={() => void runReplay()}>선택 추천 실행</Button><Button type="button" size="sm" variant="outline" disabled={disabled || stopReplay.isPending} onClick={() => void stop()}>중지</Button></div>
        <p className="text-[11px] text-muted-foreground">대상 신원 세션이 ACTIVE이고 요청이 현재 exact scope 안일 때만 실행됩니다. 결과는 CONTROLLED 후보 근거이며 취약점으로 자동 확정되지 않습니다.</p>
        {replayMessage && <p role="status" className="text-xs">{replayMessage}</p>}
      </section>
      <HumanRunGuidance disabled={disabled} />
      <EvidenceIdList ids={item.recommendation.basisEvidenceIds} />
      {item.recommendation.basisEvidenceIds.length > 0 && <Button type="button" size="sm" variant="outline" className="w-fit" disabled={disabled} onClick={() => onOpenEvidence(evidenceSelection(item.recommendation!.basisEvidenceIds, basisIdentity?.id ?? item.recommendation!.basisIdentity))}>기준 Evidence 상세 열기</Button>}
    </section>}
    <section aria-label="기대와 실제" className="grid gap-1">
      <h3 className="text-sm font-semibold">기대와 실제</h3>
      <p>기대 {expectedLabel[item.expected]} → 실제 {actualLabel[item.actual]} · HTTP {item.statusCodes.length ? item.statusCodes.join("/") : "-"}</p>
      {(item.blockingLayers?.length ?? 0) > 0 && <p className="flex flex-wrap gap-1">차단층 {item.blockingLayers?.map((layer) => <Badge key={layer} variant="outline">{layer}</Badge>)}</p>}
      <p className="text-xs text-muted-foreground">{Object.entries(item.sourceVerdicts).map(([source, verdict]) => `${source}=${verdict}`).join(" · ") || "관측 없음"}</p>
      {item.validationVerdict !== "NONE" && <p className="text-xs text-muted-foreground">과거 검증 이력 {item.validationVerdict} (읽기 전용 · 신뢰도·상태에 반영하지 않음)</p>}
    </section>
    <section aria-label="독립 신뢰도 축" className="grid gap-2">
      <h3 className="text-sm font-semibold">독립 신뢰도 축</h3>
      <div className="grid gap-2 sm:grid-cols-3">{[item.policy, item.evidence, ownership].filter((value): value is NonNullable<typeof value> => !!value).map((value) => <div key={value.code} className="rounded border border-border/70 p-2"><p className="font-mono text-xs font-semibold">{value.code} · {value.label}</p><p className="text-xs text-muted-foreground">{value.basis}</p></div>)}</div>
    </section>
    <PolicyAssignment key={`${item.id}:${item.policy.code}:${"resourcePolicy" in item ? item.resourcePolicy : ""}:${cellIdentity?.role ?? ""}`} item={item} identityKind={cellIdentity?.kind} identityRole={cellIdentity?.role} disabled={disabled} />
    <section aria-label="테스트 유효성 게이트" className="grid gap-1">
      <h3 className="text-sm font-semibold">테스트 유효성 게이트</h3>
      <ul className="grid gap-1">{item.gates.map((gate) => <li key={gate.key} className="text-xs"><Badge variant="outline" className="mr-1.5">{gate.state}</Badge><b>{gate.label}</b> <span className="text-muted-foreground">{gate.reason}</span></li>)}</ul>
    </section>
    <section aria-label="결과 오라클" className="grid gap-1">
      <h3 className="text-sm font-semibold">결과 오라클</h3>
      <p><b>{item.oracle.label}</b> · 충족 {item.oracle.satisfied ? "예" : "아니오/미확정"}</p>
      <p className="text-xs text-muted-foreground">{item.oracle.requirement}</p>
    </section>
    <section aria-label="대상 Evidence" className="grid gap-2">
      <h3 className="text-sm font-semibold">Evidence</h3>
      <EvidenceIdList ids={item.evidenceIds} />
      {item.evidenceIds.length > 0 && <Button type="button" size="sm" variant="outline" className="w-fit" disabled={disabled} onClick={() => onOpenEvidence(evidenceSelection(item.evidenceIds, item.identity))}>Evidence 상세 열기</Button>}
    </section>
    {isReviewable(item) && <section aria-label="사람 최종 판정" className="grid gap-2 rounded-md border border-border/70 p-3">
      <h3 className="text-sm font-semibold">사람 최종 판정</h3>
      <label className="flex items-start gap-2 text-xs"><Checkbox className="mt-0.5" checked={confirmed} disabled={disabled} onCheckedChange={(checked) => setConfirmed(checked === true)} /><span>Burp Repeater 결과를 확인했으며 취약점으로 확정</span></label>
      <label className="grid gap-1 text-xs"><span>검증 메모</span><input aria-label="검증 메모" className="rounded border border-border/70 bg-background px-2 py-1 text-sm" maxLength={2000} value={note} disabled={disabled} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={disabled || review.isPending} onClick={() => void submit(confirmed ? "CONFIRMED" : "UNRESOLVED")}>판정 저장</Button><Button type="button" size="sm" variant="outline" disabled={disabled || review.isPending} onClick={() => void submit("DISMISSED")}>정상·기각</Button></div>
      <p className="text-xs text-muted-foreground">검토는 서버가 정한 대상·기준 Evidence {item.reviewEvidenceIds.length}건에 묶여 저장되며 Evidence가 바뀌면 다시 확인합니다.</p>
      {message && <p role="status" className="text-xs">{message}</p>}
    </section>}
  </div>
}

export function JudgmentMatrixView() {
  const snapshot = useSnapshotQuery()
  return <JudgmentMatrixWorkspace key={snapshot.data?.datasetRevision ?? "legacy"} snapshot={snapshot} />
}

function JudgmentMatrixWorkspace({ snapshot }: { snapshot: ReturnType<typeof useSnapshotQuery> }) {
  const [view, setView] = useState<JudgmentView>("function")
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [evidenceSelection, setEvidenceSelection] = useState<StructuredEvidenceSelection | null>(null)
  const matrix = snapshot.data?.authorizationMatrix ?? null
  const projection = useMemo(() => matrix ? projectJudgmentMatrix(matrix, view, attentionOnly) : null, [matrix, view, attentionOnly])
  const selected = matrix ? findJudgmentItem(matrix, selectedId) : null
  useEffect(() => { if (selectedId && !selected && !snapshot.isError) { setSelectedId(null); setInspectorOpen(false) } }, [selectedId, selected, snapshot.isError])
  useEffect(() => { if (evidenceSelection && (!snapshot.data || !selected) && !snapshot.isError) setEvidenceSelection(null) }, [evidenceSelection, snapshot.data, snapshot.isError, selected])
  const disabled = snapshot.isError
  const select = (id: string) => { setSelectedId(id); setEvidenceSelection(null); setInspectorOpen(true) }
  const evidenceEvent = evidenceSelection ? snapshot.data?.events.find((event) => evidenceSelection.eventIds.includes(event.eventId)) ?? null : null
  const summary = matrix?.summary
  const configurationWarnings = matrix?.configurationWarnings ?? []
  const captions: Record<JudgmentView, string> = {
    function: "열=신원·역할, 행=기능. 상위 역할에서 관측된 기능을 하위 역할로 시험할 BFLA 조합을 추천합니다.",
    object: "열=신원·역할, 행=작업·객체. 한 계정에서 관측된 객체를 다른 계정·비로그인으로 시험할 BOLA/IDOR 조합을 추천합니다.",
    evidence: "실행별 상태코드·소스 판정·유효성 게이트·결과 오라클과 Evidence ID를 확인합니다.",
  }

  const context = <section className="grid gap-4 p-3">
    <h2 className="text-sm font-semibold">판정 보기</h2>
    <Tabs value={view} onValueChange={(value) => { setView(value === "object" ? "object" : value === "evidence" ? "evidence" : "function"); setSelectedId(null); setInspectorOpen(false) }}><TabsList aria-label="판정 매트릭스 보기" className="grid h-auto grid-cols-1"><TabsTrigger value="function">BFLA · 역할 × 기능</TabsTrigger><TabsTrigger value="object">BOLA/IDOR · 계정 × 객체</TabsTrigger><TabsTrigger value="evidence">실행 Evidence</TabsTrigger></TabsList></Tabs>
    <label className="flex items-center gap-2 text-sm"><Checkbox checked={attentionOnly} onCheckedChange={(checked) => setAttentionOnly(checked === true)} /><span>주의 항목만</span></label>
  </section>
  const inspector = selected && matrix ? <JudgmentDetail key={JSON.stringify([selected.id, selected.reviewEvidenceIds])} item={selected} matrix={matrix} disabled={disabled} onOpenEvidence={setEvidenceSelection} /> : <p className="p-4 text-sm text-muted-foreground">판정 셀을 선택하면 추천 조합, Repeater 검증 방법, P/E/O 근거와 사람 판정을 표시합니다.</p>

  return <ReferenceAnalysisWorkspace ariaLabel="판정 매트릭스 분석 영역" context={context} inspector={inspector} inspectorOpen={inspectorOpen} onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) setSelectedId(null) }}>
    <section className="grid gap-4 p-3" aria-labelledby="judgment-title">
      <h1 id="judgment-title" className="text-2xl font-semibold">판정 매트릭스</h1>
      {snapshot.isError && <Alert variant="destructive"><AlertTitle>판정 매트릭스를 불러오지 못했습니다.</AlertTitle><AlertDescription>
        <p>{snapshot.error instanceof Error ? snapshot.error.message : "다시 시도하세요."}</p>
        {snapshot.data ? <><p>마지막 성공 데이터 · 현재 상태 아님</p><p>마지막 성공 시각: {snapshot.dataUpdatedAt > 0 && Number.isFinite(snapshot.dataUpdatedAt) ? <time dateTime={new Date(snapshot.dataUpdatedAt).toISOString()}>{new Date(snapshot.dataUpdatedAt).toLocaleString()}</time> : "기록 없음"}</p><p>갱신에 성공할 때까지 Evidence 상세와 사람 판정 저장이 비활성화됩니다.</p></> : <p>서버 연결을 확인하고 다시 시도하세요. 아직 성공한 snapshot이 없습니다.</p>}
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
      ].map(([label, value]) => <li key={String(label)} className="rounded-md border border-border/70 p-2"><p className="text-[11px] text-muted-foreground">{label}</p><p className="text-xl font-semibold tabular-nums">{value}</p></li>)}</ul>}
      {projection && <p className="text-xs text-muted-foreground">{captions[view]}{projection.hiddenRows > 0 && ` · 주의 필터로 ${projection.hiddenRows}개 숨김`}</p>}
      {projection && view !== "evidence" && (projection.rows.length ? <div role="region" aria-label="판정 매트릭스 표" data-testid="judgment-matrix-scroll" tabIndex={0} className="max-h-[44rem] max-w-full overflow-x-auto overflow-y-auto rounded-md border overscroll-contain"><Table containerClassName="w-max min-w-full overflow-visible" className="min-w-max"><TableHeader><TableRow><TableHead className="sticky top-0 left-0 z-40 bg-background">{view === "function" ? "기능 · 기대 역할" : "작업 · 객체 · 소유자"}</TableHead>{projection.identities.map((identity) => <TableHead key={identity.id} className="sticky top-0 z-30 min-w-56 whitespace-normal bg-background"><span className="break-all">{identity.label}</span><span className="block text-xs text-muted-foreground">{identity.role}</span></TableHead>)}</TableRow></TableHeader><TableBody>{projection.rows.map((row) => <TableRow key={row.key}><TableHead scope="row" className="sticky left-0 z-20 min-w-48 whitespace-normal bg-background"><OperationLabel operation={row.operation} /></TableHead>{projection.identities.map((identity) => { const cell = row.cellsByIdentity[identity.id]; return <TableCell key={identity.id} className="whitespace-normal align-top">{cell ? <button type="button" disabled={disabled} data-tone={judgmentTone(cell.status)} aria-pressed={cell.id === selectedId} aria-label={`${cell.statusLabel}${reviewSuffix(cell.reviewStatus)}: ${cell.identityLabel} · ${withoutService(cell.operation)}${"resource" in cell ? ` · ${cell.resource}` : ""}`} className={`grid w-full min-w-48 gap-1 rounded-md border p-2 text-left text-xs ${toneClass[judgmentTone(cell.status)]} ${cell.id === selectedId ? "ring-2 ring-ring" : ""}`} onClick={() => select(cell.id)}><span className="font-semibold">{cell.statusLabel}{reviewSuffix(cell.reviewStatus)}</span><span className="text-muted-foreground">기대 {expectedLabel[cell.expected]} → 실제 {actualLabel[cell.actual]}</span>{(cell.blockingLayers?.length ?? 0) > 0 && <span className="flex flex-wrap gap-1">{cell.blockingLayers?.map((layer) => <Badge key={layer} variant="outline">{layer} 차단</Badge>)}</span>}</button> : <span className="text-xs text-muted-foreground">데이터 없음</span>}</TableCell> })}</TableRow>)}</TableBody></Table></div> : <p className="rounded-md border p-6 text-sm text-muted-foreground">{view === "function" ? "현재 필터에 표시할 역할 × 기능 조합이 없습니다." : "객체 참조 Evidence가 없거나 현재 필터에 표시할 계정 × 객체 조합이 없습니다."}</p>)}
      {projection && view === "evidence" && (projection.evidenceRows.length ? <ul role="list" aria-label="실행 Evidence 목록" className="grid gap-2">{projection.evidenceRows.map((row) => <li key={row.id}><button type="button" disabled={disabled} data-tone={judgmentTone(row.status)} aria-pressed={row.id === selectedId} className={`grid w-full gap-1 rounded-md border p-2 text-left text-xs ${toneClass[judgmentTone(row.status)]}`} onClick={() => select(row.id)}><span className="font-mono">{withoutService(row.operation)}</span><span className="text-muted-foreground">{row.identityLabel} · {row.resource ?? "객체 없음"} · HTTP {row.statusCodes.join("/") || "-"} · {row.type}</span><span className="font-semibold">{row.statusLabel}{reviewSuffix(row.reviewStatus)}</span><span className="text-muted-foreground">{confidenceCodes(row).join(" · ")}</span></button></li>)}</ul> : <p className="rounded-md border p-6 text-sm text-muted-foreground">현재 필터에 표시할 실행 Evidence가 없습니다.</p>)}
    </section>
    {evidenceSelection && snapshot.data && selected && <EvidenceSheet event={evidenceEvent} snapshot={snapshot.data} selection={evidenceSelection} disabled={disabled} onOpenChange={(open) => { if (!open) setEvidenceSelection(null) }} />}
  </ReferenceAnalysisWorkspace>
}
