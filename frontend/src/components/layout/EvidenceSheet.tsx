import { identityLabel } from "@/lib/display/identityLabel"
import { useEffect, useState, type ReactNode } from "react"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { OperationDetail } from "@/features/evidence/OperationDetail"
import { RequestLabDialog } from "@/features/evidence/RequestLabDialog"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import type { GraphSelection } from "@/features/graph/graphProjection"
import { RouteCandidateDetail } from "@/features/graph/RouteCandidateDetail"
import { evidenceOrdinalLabel, evidenceOrdinalLabels } from "@/lib/display/operationLabel"

interface BaseStructuredEvidenceSelection {
  kind: "matrix" | "sequence" | "scenario"
  evidenceIds: readonly string[]
  eventIds: readonly string[]
}

export interface StructuredEvidenceSelection extends BaseStructuredEvidenceSelection {
  kind: "matrix" | "sequence"
  identity: string
  operation: string
  resource?: string | null
  validation?: {
    state: string
    stateLabel: string
    role: string
    source: string
    subjectClass: string
    targetResource: string
    reason: string
    evidenceCount: number
    basisEvidenceIds: readonly string[]
    basisEvidenceCount: number
  }
  authorization?: {
    overall: string
    observedSources: readonly string[]
    missedSources: readonly string[]
    conflict: boolean
    gap: boolean
    reasons: readonly string[]
    requiredRole: string
    owner: string
  }
}

export interface ScenarioEvidenceSelection extends BaseStructuredEvidenceSelection { kind: "scenario" }

const INITIAL_EVIDENCE_ID_COUNT = 10
const INITIAL_DETAIL_VALUE_LENGTH = 160

interface DetailField {
  label: string
  value: string
}

function BoundedDetailFields({ fields, endpoints }: { fields: readonly DetailField[]; endpoints?: readonly [DetailField, DetailField] }) {
  const [expanded, setExpanded] = useState(false)
  const long = [...fields, ...(endpoints ?? [])].some((field) => field.value.length > INITIAL_DETAIL_VALUE_LENGTH)
  const visible = (value: string) => !expanded && value.length > INITIAL_DETAIL_VALUE_LENGTH ? `${value.slice(0, INITIAL_DETAIL_VALUE_LENGTH)}…` : value
  return <div className="grid gap-1">{fields.map((field) => <p className="break-all" key={field.label}><span>{field.label}: </span><span>{visible(field.value)}</span></p>)}{endpoints && <p className="break-all">from: {visible(endpoints[0].value)} · to: {visible(endpoints[1].value)}</p>}{long && <button type="button" className="w-fit text-xs underline" onClick={() => setExpanded((current) => !current)}>{expanded ? "선택 상세 접기" : "선택 상세 더 보기"}</button>}</div>
}

function BoundedEvidenceIds({ ids, ordinals }: { ids: readonly string[]; ordinals: Snapshot["evidenceOrdinals"] }) {
  const [expanded, setExpanded] = useState(false)
  const labels = evidenceOrdinalLabels(ordinals, ids)
  const visible = expanded ? labels : labels.slice(0, INITIAL_EVIDENCE_ID_COUNT)
  if (!labels.length) return null
  return <div className="grid gap-1"><p className="font-medium">요청 기록 {labels.length}건</p><p className="break-all font-mono">{visible.join(" ")}</p>{labels.length > INITIAL_EVIDENCE_ID_COUNT && <button type="button" className="w-fit text-xs underline" onClick={() => setExpanded((current) => !current)}>{expanded ? "요청 기록 접기" : "요청 기록 더 보기"}</button>}</div>
}

export interface EvidenceSheetProps {
  event: EventRecord | null
  snapshot: Snapshot | undefined
  selection?: GraphSelection | StructuredEvidenceSelection | ScenarioEvidenceSelection | null
  variant?: "default" | "graph"
  inline?: boolean
  contained?: boolean
  disabled?: boolean
  detailContent?: ReactNode
  compactPolicy?: boolean
  showMetadata?: boolean
  onOpenChange(open: boolean): void
}

export function EvidenceInspectorBody({ event, snapshot, selection = null, disabled = false, contained = false, detailContent, compactPolicy = false, showMetadata = true }: Omit<EvidenceSheetProps, "variant" | "inline" | "onOpenChange">) {
  const datasetRevision = snapshot?.datasetRevision ?? snapshot?.identityRevision ?? 0
  // PR#11 boundary: dataset replacement (server datasetRevision, D-140) or any coordinate change of the selected Evidence closes the draft.
  const contextKey = event ? JSON.stringify([datasetRevision, event.eventId, event.op, event.resource, event.idn, event.source, event.fp]) : null
  const [requestLabContext, setRequestLabContext] = useState<string | null>(null)
  const setRequestLabOpen = (open: boolean) => setRequestLabContext(open ? contextKey : null)
  useEffect(() => { setRequestLabContext(null) }, [contextKey])
  const structuredSelection = selection !== null && "kind" in selection
  if ((event === null && selection === null) || snapshot === undefined) return <section className="grid gap-2 p-4"><h2 className="font-semibold">선택 상세</h2><p className="text-sm text-muted-foreground">분석 결과에서 항목을 선택하면 서버가 제공한 요청 기록 상세를 표시합니다.</p></section>

  return <section className={contained ? "flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4" : "grid gap-3 p-4"} aria-label="요청 기록 상세"><header className={compactPolicy ? "grid shrink-0 gap-2 border-b pb-3" : "grid shrink-0 gap-1"}><h2 className="font-semibold">요청 기록 상세</h2>{!compactPolicy && <p className="text-sm text-muted-foreground">선택한 요청 기록, 연결 셀 및 시나리오의 정책을 확인합니다.</p>}{event && !structuredSelection && <p className="font-medium">요청 기록 {evidenceOrdinalLabel(snapshot.evidenceOrdinals, event.eventId)}</p>}</header><div className={contained ? "min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain" : "contents"}>
      {selection && "kind" in selection && <section className="grid gap-1 rounded-md border p-3 text-sm"><p className="font-medium">{selection.kind === "matrix" ? "매트릭스 선택 좌표" : selection.kind === "sequence" ? "흐름 링크 선택" : "시나리오 요청 기록 선택"}</p>{selection.kind === "scenario" ? <BoundedEvidenceIds ids={selection.evidenceIds} ordinals={snapshot.evidenceOrdinals} /> : <><BoundedDetailFields fields={selection.kind === "matrix" ? [{ label: "계정", value: identityLabel(selection.identity) }, { label: "리소스", value: selection.resource ?? "객체 없음" }, { label: "작업", value: selection.operation }] : [{ label: "계정", value: identityLabel(selection.identity) }, { label: "작업", value: selection.operation }]} endpoints={selection.kind === "sequence" ? [{ label: "from", value: evidenceOrdinalLabel(snapshot.evidenceOrdinals, selection.eventIds[0] ?? "") }, { label: "to", value: evidenceOrdinalLabel(snapshot.evidenceOrdinals, selection.eventIds[1] ?? "") }] : undefined} />{selection.kind === "matrix" && <BoundedEvidenceIds ids={selection.evidenceIds} ordinals={snapshot.evidenceOrdinals} />}</>}</section>}
      {selection && "kind" in selection && selection.kind === "matrix" && selection.validation && <section aria-label="검증 좌표 상세" className="grid gap-2 rounded-md border p-3 text-sm"><p className="font-semibold">{selection.validation.state} · {selection.validation.stateLabel}</p><BoundedDetailFields fields={[{ label: "검증 역할", value: selection.validation.role }, { label: "생성 주체", value: selection.validation.source }, { label: "대상 분류", value: selection.validation.subjectClass }, { label: "대상 리소스", value: selection.validation.targetResource }, { label: "서버 사유", value: selection.validation.reason }, { label: "실행 요청 기록", value: `${selection.validation.evidenceCount}건` }, { label: "좌표 근거", value: `${selection.validation.basisEvidenceCount}건` }]} /><BoundedEvidenceIds ids={selection.validation.basisEvidenceIds} ordinals={snapshot.evidenceOrdinals} /></section>}
      {selection && "kind" in selection && selection.kind === "matrix" && selection.authorization && <section aria-label="권한 셀 상세" className="grid gap-2 rounded-md border p-3 text-sm"><p className="font-semibold">전체 판정: {selection.authorization.overall}</p><BoundedDetailFields fields={[{ label: "탐지 source", value: selection.authorization.observedSources.join(", ") || "없음" }, { label: "미탐 source", value: selection.authorization.missedSources.join(", ") || "없음" }, { label: "필수 역할", value: selection.authorization.requiredRole }, { label: "소유자", value: selection.authorization.owner }, { label: "서버 상태", value: `${selection.authorization.conflict ? "충돌" : "충돌 없음"} · ${selection.authorization.gap ? "미점검" : "미점검 없음"}` }, ...selection.authorization.reasons.map((reason, index) => ({ label: `서버 사유 ${index + 1}`, value: reason }))]} /></section>}
      {selection && !("kind" in selection) && !selection.routeCandidate && <section className="grid gap-2 rounded-md border p-3 text-sm"><p className="font-medium">그래프 선택 좌표</p><BoundedDetailFields fields={[{ label: "계정", value: identityLabel(selection.identity ?? "UNKNOWN") }, { label: "리소스", value: selection.resource ?? "객체 없음" }, { label: "작업", value: selection.operation ?? "경로 후보" }, { label: "출처", value: selection.source ?? "UNKNOWN" }]} /><BoundedEvidenceIds ids={selection.evidenceIds} ordinals={snapshot.evidenceOrdinals} /></section>}
      {selection && !("kind" in selection) && selection.routeCandidate && <RouteCandidateDetail candidate={selection.routeCandidate} ordinals={snapshot.evidenceOrdinals} snapshot={snapshot} disabled={disabled} />}
      {event && <OperationDetail showMetadata={showMetadata} event={event} snapshot={snapshot} onOpenRequestLab={() => setRequestLabOpen(true)} showEvidenceId={!structuredSelection} evidenceLabel={compactPolicy ? evidenceOrdinalLabel(snapshot.evidenceOrdinals, event.eventId) : undefined} disabled={disabled} detailContent={detailContent} compactPolicy={compactPolicy} />}
      {event && contextKey && <RequestLabDialog key={contextKey} open={requestLabContext === contextKey} onOpenChange={setRequestLabOpen} event={event} accounts={snapshot.accounts} sessions={snapshot.managedSessions} verifications={snapshot.manualVerifications} datasetRevision={datasetRevision} snapshotRevision={snapshot.revision} suspended={disabled} />}</div>
    </section>
}

export function EvidenceSheet({ event, snapshot, selection = null, variant = "default", inline = false, contained = false, disabled = false, detailContent, compactPolicy = false, showMetadata = true, onOpenChange }: EvidenceSheetProps) {
  if (inline) return <EvidenceInspectorBody showMetadata={showMetadata} event={event} snapshot={snapshot} selection={selection} contained={contained} disabled={disabled} detailContent={detailContent} compactPolicy={compactPolicy} />
  const open = (event !== null || selection !== null) && snapshot !== undefined
  return <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
    <SheetContent className={variant === "graph" ? "w-full overflow-y-auto border-l border-border/80 bg-[var(--flowscope-pane)] p-4 text-[13px] leading-5 sm:max-w-[26rem]" : "w-full overflow-y-auto sm:max-w-xl"} aria-describedby="evidence-sheet-description" onPointerDownOutside={(event) => { if (selection && ("kind" in selection || selection.routeCandidate)) event.preventDefault() }}>
      <SheetHeader className="sr-only"><SheetTitle>요청 기록 상세</SheetTitle><SheetDescription id="evidence-sheet-description">선택한 요청 기록, 연결 셀 및 시나리오의 정책을 확인합니다.</SheetDescription></SheetHeader>
      <EvidenceInspectorBody showMetadata={showMetadata} event={event} snapshot={snapshot} selection={selection} disabled={disabled} detailContent={detailContent} compactPolicy={compactPolicy} />
    </SheetContent>
  </Sheet>
}
