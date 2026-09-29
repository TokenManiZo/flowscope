import { useState } from "react"

import { Button } from "@/components/ui/button"
import type { GraphRouteCandidateDetail } from "./graphProjection"
import { routeCandidateTone } from "./routeCandidateTone"

const INITIAL_ITEM_LIMIT = 5
const INITIAL_TEXT_LIMIT = 160

function bounded(value: string, expanded: boolean) { return expanded || value.length <= INITIAL_TEXT_LIMIT ? value : `${value.slice(0, INITIAL_TEXT_LIMIT)}…` }

export function RouteCandidateDetail({ candidate }: { candidate: GraphRouteCandidateDetail }) {
  const [expanded, setExpanded] = useState(false)
  const evidenceIds = expanded ? candidate.provenanceEvidenceIds : candidate.provenanceEvidenceIds.slice(0, INITIAL_ITEM_LIMIT)
  const provenance = expanded ? candidate.provenance : candidate.provenance.slice(0, INITIAL_ITEM_LIMIT)
  const applicabilityTone = routeCandidateTone(candidate.applicability)
  const hasHidden = !expanded && (candidate.provenanceEvidenceIds.length > INITIAL_ITEM_LIMIT || candidate.provenance.length > INITIAL_ITEM_LIMIT || [candidate.service, candidate.method, candidate.pathTemplate, candidate.applicability, candidate.reviewReason, ...candidate.provenanceEvidenceIds, ...candidate.priorityReasons, ...candidate.provenance.flatMap((item) => [item.type, item.evidenceId, item.source, item.runId, item.adapter, item.applicability, item.reason])].some((value) => value.length > INITIAL_TEXT_LIMIT))
  return <section className="grid gap-2 rounded-md border p-3 text-sm" aria-label="경로 후보 상세">
    <p className="font-medium">경로 후보 상세</p>
    <dl className="grid gap-1"><div><dt className="inline font-medium">서비스: </dt><dd className="inline break-all">{bounded(candidate.service, expanded)}</dd></div><div><dt className="inline font-medium">메서드/경로: </dt><dd className="inline break-all">{bounded(candidate.method, expanded)} {bounded(candidate.pathTemplate, expanded)}</dd></div><div><dt className="inline font-medium">관측/적용: </dt><dd data-testid="route-candidate-applicability" className={`inline ${applicabilityTone.className}`}>{candidate.observed ? "관측됨" : "미관측 후보"} · {bounded(candidate.applicability, expanded)}</dd></div><div><dt className="inline font-medium">근거 유형: </dt><dd className="inline">{candidate.provenanceTypes.map((value) => bounded(value, expanded)).join(", ") || "UNKNOWN"}</dd></div><div><dt className="inline font-medium">근거 기록 번호 ({candidate.provenanceEvidenceIds.length}): </dt><dd className="inline break-all">{evidenceIds.map((value) => bounded(value, expanded)).join(", ") || "없음"}</dd></div>{provenance.map((item, index) => <div className="break-all" key={`${item.evidenceId}:${index}`}>{bounded(item.type, expanded)} · {bounded(item.evidenceId, expanded)} · {bounded(item.source, expanded)} · {bounded(item.runId, expanded)} · {bounded(item.adapter, expanded)} · {bounded(item.applicability, expanded)} · {bounded(item.reason, expanded)}</div>)}<div><dt className="inline font-medium">검토: </dt><dd className="inline">{bounded(candidate.reviewReason, expanded) || "-"}</dd></div><div><dt className="inline font-medium">우선순위: </dt><dd className="inline">{candidate.priorityReasons.map((value) => bounded(value, expanded)).join(", ") || "-"}</dd></div></dl>
    {hasHidden && <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>후보 상세 펼치기</Button>}
    {expanded && <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>후보 상세 접기</Button>}
  </section>
}
