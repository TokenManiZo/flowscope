import { useState } from "react"

import { Button } from "@/components/ui/button"
import { evidenceOrdinalLabels, hasEvidenceOrdinal } from "@/lib/display/operationLabel"
import { runLabel } from "@/lib/display/runStatus"
import type { GraphRouteCandidateDetail } from "./graphProjection"
import { routeCandidateTone } from "./routeCandidateTone"

const INITIAL_ITEM_LIMIT = 5
const INITIAL_TEXT_LIMIT = 160

function bounded(value: string, expanded: boolean) { return expanded || value.length <= INITIAL_TEXT_LIMIT ? value : `${value.slice(0, INITIAL_TEXT_LIMIT)}…` }

export function RouteCandidateDetail({ candidate, ordinals }: { candidate: GraphRouteCandidateDetail; ordinals?: Readonly<Record<string, number>> }) {
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
