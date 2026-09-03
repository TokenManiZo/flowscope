import { useEffect, useRef, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ReviewStatus, Scenario } from "@/lib/api/types"
import { useReviewMutation } from "@/lib/query/hooks"

const TEXT_LIMIT = 180
const LIST_LIMIT = 3
const REVIEW_NOTE_LIMIT = 2000

const reviewLabels: Record<ReviewStatus, string> = { UNRESOLVED: "미해결", CONFIRMED: "확인됨", DISMISSED: "기각됨" }

function BoundedText({ value, moreLabel = "텍스트 더 보기", lessLabel = "텍스트 접기" }: { value: string; moreLabel?: string; lessLabel?: string }) {
  const [open, setOpen] = useState(false)
  const truncated = value.length > TEXT_LIMIT
  if (!truncated) return <p className="break-all whitespace-pre-wrap">{value}</p>
  return <Collapsible open={open} onOpenChange={setOpen}>{!open && <p className="break-all whitespace-pre-wrap">{`${value.slice(0, TEXT_LIMIT)}…`}</p>}<CollapsibleContent><p className="break-all whitespace-pre-wrap">{value}</p></CollapsibleContent><CollapsibleTrigger asChild><Button type="button" variant="link" size="sm" className="h-auto w-fit p-0">{open ? lessLabel : moreLabel}</Button></CollapsibleTrigger></Collapsible>
}

export type ScenarioEvidenceAction = (ids: readonly string[], eventId: string) => (() => void) | null

function EvidenceGroup({ label, ids, onOpen }: { label: string; ids: readonly string[]; onOpen: ScenarioEvidenceAction }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? ids : ids.slice(0, LIST_LIMIT)
  const hasMore = ids.length > LIST_LIMIT || ids.some((id) => id.length > TEXT_LIMIT)
  return <section className="grid gap-2 rounded-md border p-3"><h4 className="font-medium">{label}</h4>{ids.length === 0 ? <p className="text-sm text-muted-foreground">서버가 제공한 Evidence가 없습니다.</p> : visible.map((id, index) => {
    const exact = onOpen(ids, id)
    const text = !expanded && id.length > TEXT_LIMIT ? `${id.slice(0, TEXT_LIMIT)}…` : id
    return <div className="flex flex-wrap items-center gap-2" key={`${index}:${id}`}><span className="max-w-full break-all text-sm">{text}</span>{exact ? <Button type="button" size="sm" variant="outline" aria-label="Evidence 열기" onClick={exact}>Evidence 열기</Button> : <Badge variant="secondary">사용 불가</Badge>}</div>
  })}{hasMore && <Button type="button" variant="link" size="sm" className="h-auto w-fit p-0" onClick={() => setExpanded((value) => !value)}>{expanded ? "Evidence 접기" : "Evidence 더 보기"}</Button>}</section>
}

const VALIDATION_PLACEHOLDER_REASON = "LLM 검증 번들이 아직 제출되지 않음"
const FINAL_VERDICTS = new Set(["CONFIRMED", "INCONCLUSIVE", "REJECTED"])

function validationFields(scenario: Scenario) {
  const verdict = scenario.finalVerdict?.trim().toUpperCase() ?? ""
  if (!FINAL_VERDICTS.has(verdict)) return false
  const reason = scenario.validationReason?.trim() ?? ""
  const runId = scenario.validationRunId?.trim() ?? ""
  const hasEvidence = (scenario.validationEvidenceIds?.length ?? 0) > 0 || (scenario.controlEvidenceIds?.length ?? 0) > 0
  if (verdict === "INCONCLUSIVE" && reason === VALIDATION_PLACEHOLDER_REASON && !runId && !hasEvidence) return false
  return Boolean(reason || runId || hasEvidence)
}

type BadgeTone = { variant: "destructive" | "outline" | "secondary"; className: string }

export function scenarioRiskTone(risk: string): BadgeTone {
  switch (risk.trim().toUpperCase()) {
    case "CRITICAL": return { variant: "destructive", className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300" }
    case "HIGH": return { variant: "destructive", className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300" }
    case "MEDIUM": return { variant: "outline", className: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200" }
    case "LOW": return { variant: "outline", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" }
    default: return { variant: "secondary", className: "text-muted-foreground" }
  }
}

export function scenarioValidationTone(scenario: Scenario): BadgeTone & { label: string } {
  return validationFields(scenario)
    ? { label: "서버 최종 검증", variant: "outline", className: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300" }
    : { label: "LLM 비최종 평가", variant: "outline", className: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200" }
}

interface Props {
  scenario: Scenario
  onOpenEvidence: ScenarioEvidenceAction
}

export function ScenarioCard({ scenario, onOpenEvidence }: Props) {
  const review = useReviewMutation()
  const activeScenarioId = useRef<string | null>(scenario.id)
  const [status, setStatus] = useState<ReviewStatus>(scenario.reviewStatus)
  const [note, setNote] = useState(scenario.reviewNote)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    setStatus(scenario.reviewStatus)
    setNote(scenario.reviewNote)
    setError("")
    setSuccess("")
  }, [scenario.id, scenario.reviewStatus, scenario.reviewNote])

  useEffect(() => {
    activeScenarioId.current = scenario.id
    return () => { activeScenarioId.current = null }
  }, [scenario.id])

  async function saveReview() {
    if (review.isPending) return
    const capped = note.slice(0, REVIEW_NOTE_LIMIT)
    const requestScenarioId = scenario.id
    setError("")
    setSuccess("")
    try {
      const result = await review.mutateAsync({ itemId: scenario.id, status, note: capped })
      if (activeScenarioId.current !== requestScenarioId) return
      setNote(capped)
      setSuccess(result.message)
    } catch (reason) {
      if (activeScenarioId.current !== requestScenarioId) return
      setError(reason instanceof Error ? reason.message : "검토를 저장하지 못했습니다.")
    }
  }

  const final = validationFields(scenario)
  const riskTone = scenarioRiskTone(scenario.risk)
  const validationTone = scenarioValidationTone(scenario)
  return <Card><article className="grid gap-1"><CardHeader><div className="flex flex-wrap gap-2"><Badge variant="outline"><BoundedText value={scenario.tag} /></Badge><Badge variant={riskTone.variant} className={riskTone.className}><BoundedText value={scenario.risk} /></Badge><Badge variant={validationTone.variant} className={validationTone.className}>{validationTone.label}</Badge></div><CardTitle><BoundedText value={scenario.title} /></CardTitle><CardDescription>서버가 보낸 시나리오 값을 표시하며 위험도나 문구로 사람 검토 상태를 추론하지 않습니다.</CardDescription></CardHeader><CardContent className="grid gap-4">
    <section className="grid gap-2 rounded-md border p-3"><h3 className="font-medium">규칙 후보</h3><BoundedText value={scenario.proposal} /><p className="text-sm text-muted-foreground">후보 근거</p><BoundedText value={scenario.evidence} /></section>
    {final ? <section className="grid gap-2 rounded-md border p-3"><h3 className="font-medium">서버 최종 검증</h3><p>판정: <span className="break-all">{scenario.finalVerdict ?? "서버 값 없음"}</span></p><div><p>실행 ID</p><BoundedText value={scenario.validationRunId || "서버 값 없음"} moreLabel="실행 ID 더 보기" lessLabel="실행 ID 접기" /></div><p className="font-medium">사유</p><BoundedText value={scenario.validationReason ?? "서버 값 없음"} /><EvidenceGroup label="서버 최종 검증 Evidence" ids={scenario.validationEvidenceIds ?? []} onOpen={onOpenEvidence} /><EvidenceGroup label="정상 제어 Evidence" ids={scenario.controlEvidenceIds ?? []} onOpen={onOpenEvidence} /></section> : <section className="grid gap-2 rounded-md border p-3"><h3 className="font-medium">LLM 비최종 평가</h3><p className="text-sm text-muted-foreground">서버가 제공한 LLM 평가이며 최종 검증 또는 사람 확인이 아닙니다.</p></section>}
    <EvidenceGroup label="후보/평가 Evidence" ids={scenario.evidenceIds} onOpen={onOpenEvidence} />
    <section className="grid gap-3 rounded-md border p-3"><h3 className="font-medium">사람 검토</h3><p className="text-sm text-muted-foreground">현재 서버 상태: {reviewLabels[scenario.reviewStatus]}</p><div className="grid gap-1"><Label htmlFor={`review-status-${scenario.id}`}>사람 검토 상태</Label><Select value={status} onValueChange={(value) => setStatus(value as ReviewStatus)}><SelectTrigger id={`review-status-${scenario.id}`} aria-label="사람 검토 상태"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNRESOLVED">미해결</SelectItem><SelectItem value="CONFIRMED">확인됨</SelectItem><SelectItem value="DISMISSED">기각됨</SelectItem></SelectContent></Select></div><div className="grid gap-1"><Label htmlFor={`review-note-${scenario.id}`}>검토 메모</Label><Input id={`review-note-${scenario.id}`} value={note} maxLength={REVIEW_NOTE_LIMIT} onChange={(change) => setNote(change.target.value.slice(0, REVIEW_NOTE_LIMIT))} /></div><Button type="button" disabled={review.isPending} onClick={() => void saveReview()}>{review.isPending ? "검토 저장 중" : "검토 저장"}</Button>{error && <Alert variant="destructive"><AlertTitle>검토를 저장하지 못했습니다.</AlertTitle><AlertDescription><BoundedText value={error} /></AlertDescription></Alert>}{success && <Alert><AlertTitle>사람 검토 저장</AlertTitle><AlertDescription><BoundedText value={success} /></AlertDescription></Alert>}</section>
  </CardContent></article></Card>
}
