import { useEffect, useMemo, useState } from "react"

import { EvidenceSheet, type StructuredEvidenceSelection } from "@/components/layout/EvidenceSheet"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { AuthorizationMatrix, MatrixLegendItem, ReviewStatus } from "@/lib/api/types"
import { useHumanRunQuery, useRequirementMutation, useReviewMutation, useRoleMutation, useSnapshotQuery } from "@/lib/query/hooks"
import { actualLabel, confidenceCodes, expectedLabel, findJudgmentItem, isReviewable, judgmentTone, projectJudgmentMatrix, reviewSuffix, withoutService, type JudgmentItem, type JudgmentView } from "./judgmentProjection"

const toneClass: Record<ReturnType<typeof judgmentTone>, string> = {
  risk: "border-amber-500/60 bg-amber-500/10",
  ok: "border-emerald-500/50 bg-emerald-500/10",
  invalid: "border-red-500/50 bg-red-500/10",
  gap: "border-border/70 bg-muted/30",
  unknown: "border-border/70 bg-background/40",
}
const VISIBLE_EVIDENCE = 5

function Legend({ title, items }: { title: string; items: readonly MatrixLegendItem[] }) {
  return <section className="grid gap-1" aria-label={title}><h3 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">{title}</h3>{items.map((item) => <p key={item.code} className="text-xs"><b>{item.code}</b> {item.title} — <span className="text-muted-foreground">{item.description}</span></p>)}</section>
}

function EvidenceIdList({ ids }: { ids: readonly string[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? ids : ids.slice(0, VISIBLE_EVIDENCE)
  return <div className="grid gap-1">{visible.length ? visible.map((id) => <p key={id} className="break-all rounded border bg-muted/30 p-1.5 font-mono text-xs">{id}</p>) : <p className="text-xs text-muted-foreground">이 조합은 아직 미실행</p>}{ids.length > VISIBLE_EVIDENCE && <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => setExpanded((current) => !current)}>{expanded ? "Evidence 접기" : `Evidence ${ids.length - VISIBLE_EVIDENCE}개 더 보기`}</Button>}</div>
}

const ROLE_OPTIONS = ["USER", "LV1", "LV2", "ADMIN"] as const

/**
 * BFLA 판정은 이 작업의 필수 역할(P3)과 신원의 역할이 모두 지정돼야 만들어진다. 역할은 토큰이나 경로에서 추정하지
 * 않고 사용자가 지정한다(D-018). 기존 /api/requirement·/api/role만 호출하며 판정 자체는 서버가 다시 계산한다.
 */
function PolicyAssignment({ item, identityKind, identityRole, disabled }: { item: JudgmentItem; identityKind: string | undefined; identityRole: string | undefined; disabled: boolean }) {
  const requirement = useRequirementMutation()
  const roleMutation = useRoleMutation()
  const [requiredRole, setRequiredRole] = useState<string>("ADMIN")
  const [role, setRole] = useState<string>("USER")
  const [message, setMessage] = useState<string | null>(null)
  const needsRequirement = item.policy.level < 3
  const needsRole = (identityKind === "REGISTERED" || identityKind === "OBSERVED") && identityRole === "Unknown"
  if (!needsRequirement && !needsRole) return null
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
  const [confirmed, setConfirmed] = useState(item.reviewStatus === "CONFIRMED")
  const [note, setNote] = useState(item.reviewNote)
  const [message, setMessage] = useState<string | null>(null)
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
  const evidenceSelection = (evidenceIds: readonly string[], identity: string): StructuredEvidenceSelection => ({ kind: "matrix", identity, operation: item.operation, resource, evidenceIds, eventIds: evidenceIds })
  const basisIdentity = matrix.identities.find((identity) => identity.id === item.recommendation?.basisIdentity)
  const cellIdentity = matrix.identities.find((identity) => identity.id === item.identity)
  return <div className="grid gap-4 p-4 text-sm">
    <div><h2 className="text-base font-semibold">{item.statusLabel}{reviewSuffix(item.reviewStatus)}</h2><p className="break-all text-xs text-muted-foreground">{item.identityLabel} · {withoutService(item.operation)}{resource ? ` · ${resource}` : ""}</p>{"relation" in item && <p className="text-xs text-muted-foreground">관계 {item.relation} · 기법 {item.techniques.join("/")} · 소유자 {item.ownerLabel || "미확정"}</p>}</div>
    {item.recommendation && <section aria-label="테스트 추천 조합" className="grid gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
      <h3 className="text-sm font-semibold">{item.recommendation.type} 테스트 추천 조합</h3>
      <p><b>{item.recommendation.basisIdentityLabel} → {item.recommendation.testIdentityLabel}</b></p>
      <p className="text-xs">{item.recommendation.reason}</p>
      <p className="text-xs">{item.recommendation.instruction}</p>
      {item.recommendation.stateChanging && <p className="text-xs font-semibold text-amber-300">상태변경 요청: 영향과 복구 방법을 확인한 뒤 직접 전송하세요.</p>}
      <p className="text-xs text-muted-foreground">FlowScope는 요청을 자동 전송하지 않습니다. 기준 Evidence에서 Request Lab 또는 Repeater 초안을 열어 직접 실행하세요.</p>
      <HumanRunGuidance disabled={disabled} />
      <EvidenceIdList ids={item.recommendation.basisEvidenceIds} />
      {item.recommendation.basisEvidenceIds.length > 0 && <Button type="button" size="sm" variant="outline" className="w-fit" disabled={disabled} onClick={() => onOpenEvidence(evidenceSelection(item.recommendation!.basisEvidenceIds, basisIdentity?.id ?? item.recommendation!.basisIdentity))}>기준 Evidence 상세 열기</Button>}
    </section>}
    <section aria-label="기대와 실제" className="grid gap-1">
      <h3 className="text-sm font-semibold">기대와 실제</h3>
      <p>기대 {expectedLabel[item.expected]} → 실제 {actualLabel[item.actual]} · HTTP {item.statusCodes.length ? item.statusCodes.join("/") : "-"}</p>
      <p className="text-xs text-muted-foreground">{Object.entries(item.sourceVerdicts).map(([source, verdict]) => `${source}=${verdict}`).join(" · ") || "관측 없음"}</p>
      {item.validationVerdict !== "NONE" && <p className="text-xs text-muted-foreground">과거 검증 이력 {item.validationVerdict} (읽기 전용 · 신뢰도·상태에 반영하지 않음)</p>}
    </section>
    <section aria-label="독립 신뢰도 축" className="grid gap-2">
      <h3 className="text-sm font-semibold">독립 신뢰도 축</h3>
      <div className="grid gap-2 sm:grid-cols-3">{[item.policy, item.evidence, ownership].filter((value): value is NonNullable<typeof value> => !!value).map((value) => <div key={value.code} className="rounded border border-border/70 p-2"><p className="font-mono text-xs font-semibold">{value.code} · {value.label}</p><p className="text-xs text-muted-foreground">{value.basis}</p></div>)}</div>
    </section>
    <PolicyAssignment key={`${item.id}:${item.policy.code}:${cellIdentity?.role ?? ""}`} item={item} identityKind={cellIdentity?.kind} identityRole={cellIdentity?.role} disabled={disabled} />
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
    <div><h2 className="text-sm font-semibold">판정 보기</h2><p className="text-xs text-muted-foreground">정책 P·실행 E·소유권 O를 합산하지 않습니다. 후보는 서버 권한 셀의 판정만 따릅니다.</p></div>
    <Tabs value={view} onValueChange={(value) => { setView(value === "object" ? "object" : value === "evidence" ? "evidence" : "function"); setSelectedId(null); setInspectorOpen(false) }}><TabsList aria-label="판정 매트릭스 보기" className="grid h-auto grid-cols-1"><TabsTrigger value="function">BFLA · 역할 × 기능</TabsTrigger><TabsTrigger value="object">BOLA/IDOR · 계정 × 객체</TabsTrigger><TabsTrigger value="evidence">실행 Evidence</TabsTrigger></TabsList></Tabs>
    <label className="flex items-center gap-2 text-sm"><Checkbox checked={attentionOnly} onCheckedChange={(checked) => setAttentionOnly(checked === true)} /><span>주의 항목만</span></label>
    {matrix && <div className="grid gap-3 border-t border-border/70 pt-3"><Legend title="정책 신뢰도 P" items={matrix.policyLegend} /><Legend title="실행 증거 E" items={matrix.evidenceLegend} /><Legend title="소유권 O" items={matrix.ownershipLegend} /></div>}
  </section>
  const inspector = selected && matrix ? <JudgmentDetail key={JSON.stringify([selected.id, selected.reviewEvidenceIds])} item={selected} matrix={matrix} disabled={disabled} onOpenEvidence={setEvidenceSelection} /> : <p className="p-4 text-sm text-muted-foreground">판정 셀을 선택하면 추천 조합, Repeater 검증 방법, P/E/O 근거와 사람 판정을 표시합니다.</p>

  return <ReferenceAnalysisWorkspace ariaLabel="판정 매트릭스 분석 영역" context={context} inspector={inspector} inspectorOpen={inspectorOpen} onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) setSelectedId(null) }}>
    <section className="grid gap-4 p-3" aria-labelledby="judgment-title">
      <div><h1 id="judgment-title" className="text-2xl font-semibold">판정 매트릭스</h1><p className="text-sm text-muted-foreground">관측 결과의 신원·기능·객체 공백을 비교해 IDOR/BOLA/BFLA 수동 테스트 조합을 추천합니다. FlowScope는 요청을 자동 전송하지 않으며 점수를 합산하지 않습니다.</p></div>
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
        ["BFLA 테스트 추천", summary.bflaTestRecommendations, "상위 역할 → 하위 역할"],
        ["BOLA/IDOR 테스트 추천", summary.bolaIdorTestRecommendations, "관측 객체 → 다른 계정"],
        ["수동 검토 대기", summary.manualReviewPending, "Burp Repeater 확인 필요"],
        ["사용자 취약점 확정", summary.humanConfirmed, "사람이 결과를 확인함"],
        ["정상·기각", summary.humanDismissed, "사람이 후보를 종료함"],
      ].map(([label, value, hint]) => <li key={String(label)} className="rounded-md border border-border/70 p-2"><p className="text-[11px] text-muted-foreground">{label}</p><p className="text-xl font-semibold tabular-nums">{value}</p><p className="text-[11px] text-muted-foreground">{hint}</p></li>)}</ul>}
      {projection && <p className="text-xs text-muted-foreground">{captions[view]}{projection.hiddenRows > 0 && ` · 주의 필터로 ${projection.hiddenRows}개 숨김`}</p>}
      {projection && view !== "evidence" && (projection.rows.length ? <div role="region" aria-label="판정 매트릭스 표" tabIndex={0} className="max-h-[44rem] max-w-full overflow-auto rounded-md border overscroll-contain"><Table containerClassName="w-max min-w-full overflow-visible" className="min-w-max"><TableHeader><TableRow><TableHead className="sticky top-0 left-0 z-40 bg-background">{view === "function" ? "기능 · 기대 역할" : "작업 · 객체 · 소유자"}</TableHead>{projection.identities.map((identity) => <TableHead key={identity.id} className="sticky top-0 z-30 min-w-56 whitespace-normal bg-background"><span className="break-all">{identity.label}</span><span className="block text-xs text-muted-foreground">{identity.role}</span></TableHead>)}</TableRow></TableHeader><TableBody>{projection.rows.map((row) => <TableRow key={row.key}><TableHead scope="row" className="sticky left-0 z-20 min-w-48 whitespace-normal bg-background"><span className="break-all font-mono text-xs">{withoutService(row.operation)}</span><span className="block text-xs text-muted-foreground">{view === "function" ? `${row.policy?.code ?? "P0"} · ${row.policy?.label ?? "정책 미정"}` : `${row.resource} · 소유 ${row.ownerLabel || "미확정"}`}</span></TableHead>{projection.identities.map((identity) => { const cell = row.cellsByIdentity[identity.id]; return <TableCell key={identity.id} className="whitespace-normal align-top">{cell ? <button type="button" disabled={disabled} data-tone={judgmentTone(cell.status)} aria-pressed={cell.id === selectedId} aria-label={`${cell.statusLabel}${reviewSuffix(cell.reviewStatus)}: ${cell.identityLabel} · ${withoutService(cell.operation)}${"resource" in cell ? ` · ${cell.resource}` : ""}`} className={`grid w-full min-w-48 gap-1 rounded-md border p-2 text-left text-xs ${toneClass[judgmentTone(cell.status)]} ${cell.id === selectedId ? "ring-2 ring-ring" : ""}`} onClick={() => select(cell.id)}><span className="font-semibold">{cell.statusLabel}{reviewSuffix(cell.reviewStatus)}</span><span className="text-muted-foreground">기대 {expectedLabel[cell.expected]} → 실제 {actualLabel[cell.actual]}</span><span className="flex flex-wrap gap-1">{confidenceCodes(cell).map((code) => <Badge key={code} variant="outline" className="font-mono">{code}</Badge>)}</span></button> : <span className="text-xs text-muted-foreground">데이터 없음</span>}</TableCell> })}</TableRow>)}</TableBody></Table></div> : <p className="rounded-md border p-6 text-sm text-muted-foreground">{view === "function" ? "현재 필터에 표시할 역할 × 기능 조합이 없습니다." : "객체 참조 Evidence가 없거나 현재 필터에 표시할 계정 × 객체 조합이 없습니다."}</p>)}
      {projection && view === "evidence" && (projection.evidenceRows.length ? <ul role="list" aria-label="실행 Evidence 목록" className="grid gap-2">{projection.evidenceRows.map((row) => <li key={row.id}><button type="button" disabled={disabled} data-tone={judgmentTone(row.status)} aria-pressed={row.id === selectedId} className={`grid w-full gap-1 rounded-md border p-2 text-left text-xs ${toneClass[judgmentTone(row.status)]}`} onClick={() => select(row.id)}><span className="font-mono">{withoutService(row.operation)}</span><span className="text-muted-foreground">{row.identityLabel} · {row.resource ?? "객체 없음"} · HTTP {row.statusCodes.join("/") || "-"} · {row.type}</span><span className="font-semibold">{row.statusLabel}{reviewSuffix(row.reviewStatus)}</span><span className="text-muted-foreground">{confidenceCodes(row).join(" · ")}</span></button></li>)}</ul> : <p className="rounded-md border p-6 text-sm text-muted-foreground">현재 필터에 표시할 실행 Evidence가 없습니다.</p>)}
    </section>
    {evidenceSelection && snapshot.data && selected && <EvidenceSheet event={evidenceEvent} snapshot={snapshot.data} selection={evidenceSelection} disabled={disabled} onOpenChange={(open) => { if (!open) setEvidenceSelection(null) }} />}
  </ReferenceAnalysisWorkspace>
}
