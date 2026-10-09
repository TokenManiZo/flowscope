import { useState } from "react"
import { Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { EvidenceActionList } from "@/features/evidence/EvidenceActionList"
import { RequestLabDialog } from "@/features/evidence/RequestLabDialog"
import type { Snapshot } from "@/lib/api/types"
import { evidenceOrdinalLabels, hasEvidenceOrdinal } from "@/lib/display/operationLabel"
import { runLabel } from "@/lib/display/runStatus"
import { collectionIdentity, graphAccountLabel } from "./graphAccounts"
import type { GraphRouteCandidateDetail } from "./graphProjection"
import { routeCandidateTone } from "./routeCandidateTone"

const INITIAL_ITEM_LIMIT = 5
const INITIAL_TEXT_LIMIT = 160

function bounded(value: string, expanded: boolean) { return expanded || value.length <= INITIAL_TEXT_LIMIT ? value : `${value.slice(0, INITIAL_TEXT_LIMIT)}…` }

/** 서버 provenance enum을 "발견한 곳" 쉬운 말로 바꾼다. 모르는 값은 그대로 보여 준다. */
const FOUND_LABELS: Readonly<Record<string, string>> = {
  OBSERVED_REQUEST: "실제 요청", BURP_UNREQUESTED: "Burp 목록",
  HTML_LINK: "HTML 링크", HTML_FORM: "HTML 폼", HTML_EMBED: "HTML 임베드",
  LOCATION: "리디렉션", JAVASCRIPT_LITERAL: "JS 코드", HTML_SCRIPT: "JS 코드", SCRIPT_DEPENDENCY: "JS 코드",
  ROBOTS_OR_SITEMAP: "robots·사이트맵", WEB_MANIFEST: "웹 매니페스트", FRAMEWORK_MANIFEST_ASSET: "웹 매니페스트",
  OPENAPI: "API 문서", XML_ROUTE: "API 문서", BROWSER_RUNTIME: "브라우저 실행 중", LLM_ARTIFACT_ANALYSIS: "LLM 분석",
  LEGACY_UNMAPPED: "분류 안 됨",
}
function foundLabel(type: string) { return FOUND_LABELS[type] ?? type }

/**
 * 선택한 경로 후보(미요청 API)의 상세. snapshot이 있으면(노드 클릭 인스펙터·시트) 다른 노드와 같은 요청 기록 양식을 쓴다:
 * "왜 후보인지" 요약 + 발견에 쓰인 요청을 계정별 카드로 묶고 각 요청을 Request Lab으로 보낼 수 있다. snapshot이 없으면(목록)
 * 좌표만 아는 압축 텍스트로 보여 준다.
 */
export function RouteCandidateDetail({ candidate, ordinals, snapshot, disabled = false, onOpenRequestLab }: { candidate: GraphRouteCandidateDetail; ordinals?: Readonly<Record<string, number>>; snapshot?: Snapshot; disabled?: boolean; onOpenRequestLab?(): void }) {
  if (snapshot) return <RouteCandidateInspector candidate={candidate} snapshot={snapshot} disabled={disabled} onOpenRequestLab={onOpenRequestLab} />
  return <RouteCandidateSummary candidate={candidate} ordinals={ordinals} />
}

/** 다른 노드와 같은 요청 기록 UI로 통일한 버전. 후보 맥락은 위에 얇게, 발견에 쓰인 요청은 EvidenceActionList로 보여 준다. */
function RouteCandidateInspector({ candidate, snapshot, disabled, onOpenRequestLab }: { candidate: GraphRouteCandidateDetail; snapshot: Snapshot; disabled: boolean; onOpenRequestLab?(): void }) {
  const [sendOpen, setSendOpen] = useState(false)
  const ids = new Set(candidate.provenanceEvidenceIds)
  const events = snapshot.events.filter((item) => ids.has(item.eventId))
  const hasWhy = candidate.reviewReason.trim().length > 0 || candidate.priorityReasons.length > 0
  const foundLabels = [...new Set(candidate.provenanceTypes.map(foundLabel))]
  const foundText = foundLabels.join(" · ") || "알 수 없는 곳"
  // 후보를 발견한 요청(같은 호스트) 하나를 전송 seed로 쓴다. 다른 노드와 같은 Request Lab 모달을 열되, 요청문을 후보 경로로 미리 채워 그 엔드포인트로 보낸다.
  const seedEvent = events[0] ?? null
  const sendMethod = candidate.method && candidate.method !== "UNKNOWN" ? candidate.method : "GET"
  const sendHost = (() => { try { return new URL(candidate.service).host } catch { return candidate.service } })()
  const prefillRequest = `${sendMethod} ${candidate.pathTemplate} HTTP/1.1\r\nHost: ${sendHost}\r\n\r\n`
  return <section className="grid gap-3" aria-label="경로 후보 상세">
    <div className="grid gap-2 rounded-md border p-3" data-testid="route-candidate-status">
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">{candidate.observed ? "관측됨" : "미요청"}</span>
        {foundLabels.map((label) => <span key={label} className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">{label}에서 발견</span>)}
      </div>
      <p className="text-xs text-muted-foreground">{candidate.observed ? `${foundText}에서 찾았고 실제 요청도 관측된 API입니다.` : `${foundText}에서 찾은, 아직 안 보낸 API입니다.`}</p>
      {hasWhy && <details className="mt-0.5">
        <summary className="cursor-pointer text-xs text-muted-foreground">왜 점검 대상인가</summary>
        <div className="mt-2 grid gap-1 text-xs">{candidate.reviewReason.trim() && <div className="break-all"><span className="font-medium">검토: </span>{candidate.reviewReason}</div>}{candidate.priorityReasons.length > 0 && <div className="break-all"><span className="font-medium">우선순위: </span>{candidate.priorityReasons.join(", ")}</div>}</div>
      </details>}
    </div>
    {/* 아직 안 보낸 후보 경로를 처음으로 직접 보내 본다(②의 발견 요청 재전송과 같은 Request Lab 모달, 경로만 후보로 프리필). */}
    <Button size="sm" className="w-fit" disabled={disabled || !seedEvent} onClick={() => setSendOpen(true)}><Send className="size-4" />이 경로로 요청 보내기</Button>
    {!seedEvent && <p className="text-xs text-muted-foreground">이 후보를 발견한 캡처 요청이 없어 바로 보낼 수 없습니다.</p>}
    {seedEvent && <RequestLabDialog open={sendOpen} onOpenChange={setSendOpen} event={seedEvent} prefillRequest={prefillRequest} accounts={snapshot.accounts} sessions={snapshot.managedSessions} verifications={snapshot.manualVerifications} datasetRevision={snapshot.datasetRevision ?? snapshot.identityRevision ?? 0} snapshotRevision={snapshot.revision} suspended={disabled} />}
    <p className="text-xs text-muted-foreground">아래는 이 후보를 발견한 요청입니다. 응답 코드는 접근 허용이나 취약점 판정이 아닙니다.</p>
    <EvidenceActionList events={events} snapshot={snapshot} disabled={disabled} onOpenRequestLab={onOpenRequestLab} identityOf={collectionIdentity} labelIdentity={(identity) => graphAccountLabel(snapshot, identity)} />
  </section>
}

/** 목록용 압축 요약. 좌표·근거만 아는 상태라 요청 기록 카드 없이 텍스트로만 보여 준다. */
function RouteCandidateSummary({ candidate, ordinals }: { candidate: GraphRouteCandidateDetail; ordinals?: Readonly<Record<string, number>> }) {
  const [expanded, setExpanded] = useState(false)
  // 번호가 없는 기록(삭제됐거나 지금 분석에 없는 기록)은 열 수 없어 세지도 보여 주지도 않는다.
  const evidenceLabels = evidenceOrdinalLabels(ordinals, candidate.provenanceEvidenceIds)
  const evidenceIds = expanded ? evidenceLabels : evidenceLabels.slice(0, INITIAL_ITEM_LIMIT)
  const provenance = expanded ? candidate.provenance : candidate.provenance.slice(0, INITIAL_ITEM_LIMIT)
  const applicabilityTone = routeCandidateTone(candidate.applicability)
  const hasHidden = !expanded && (evidenceLabels.length > INITIAL_ITEM_LIMIT || candidate.provenance.length > INITIAL_ITEM_LIMIT || [candidate.service, candidate.method, candidate.pathTemplate, candidate.applicability, candidate.reviewReason, ...candidate.priorityReasons, ...candidate.provenance.flatMap((item) => [item.type, item.source, item.adapter, item.applicability, item.reason])].some((value) => value.length > INITIAL_TEXT_LIMIT))
  return <section className="grid gap-2 rounded-md border p-3 text-sm" aria-label="경로 후보 상세">
    <p className="font-medium">경로 후보 상세</p>
    <dl className="grid gap-1"><div><dt className="inline font-medium">서비스: </dt><dd className="inline break-all">{bounded(candidate.service, expanded)}</dd></div><div><dt className="inline font-medium">메서드/경로: </dt><dd className="inline break-all">{bounded(candidate.method, expanded)} {bounded(candidate.pathTemplate, expanded)}</dd></div><div><dt className="inline font-medium">점검 대상: </dt><dd data-testid="route-candidate-applicability" className={`inline ${applicabilityTone.className}`}>{candidate.observed ? "관측됨" : "미관측 후보"} · {bounded(candidate.applicability, expanded)}</dd></div><div><dt className="inline font-medium">찾은 곳: </dt><dd className="inline">{candidate.provenanceTypes.map((value) => bounded(value, expanded)).join(", ") || "UNKNOWN"}</dd></div>{evidenceLabels.length > 0 && <div><dt className="inline font-medium">찾은 요청 기록 {evidenceLabels.length}건: </dt><dd className="inline break-all font-mono">{evidenceIds.join(" ")}</dd></div>}{provenance.map((item, index) => <div className="break-all" key={`${item.evidenceId}:${index}`}>{[bounded(item.type, expanded), ...(hasEvidenceOrdinal(ordinals, item.evidenceId) ? [`#${ordinals![item.evidenceId]}`] : []), bounded(item.source, expanded), runLabel(item.runId, item.source), bounded(item.adapter, expanded), bounded(item.applicability, expanded), bounded(item.reason, expanded)].join(" · ")}</div>)}<div><dt className="inline font-medium">검토: </dt><dd className="inline">{bounded(candidate.reviewReason, expanded) || "-"}</dd></div><div><dt className="inline font-medium">우선순위: </dt><dd className="inline">{candidate.priorityReasons.map((value) => bounded(value, expanded)).join(", ") || "-"}</dd></div></dl>
    {hasHidden && <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>후보 상세 펼치기</Button>}
    {expanded && <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>후보 상세 접기</Button>}
  </section>
}
