import { useEffect, useRef, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ReviewStatus, Scenario } from "@/lib/api/types"
import { evidenceOrdinalLabel, hasEvidenceOrdinal, withEvidenceOrdinals } from "@/lib/display/operationLabel"
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

function EvidenceGroup({ label, ids, ordinals, onOpen }: { label: string; ids: readonly string[]; ordinals?: Readonly<Record<string, number>>; onOpen: ScenarioEvidenceAction }) {
  const [expanded, setExpanded] = useState(false)
  // 번호가 없는 기록(삭제됐거나 지금 분석에 없는 기록)은 열 수 없어 보여 주지 않는다.
  const present = [...new Set(ids)].filter((id) => hasEvidenceOrdinal(ordinals, id))
  const visible = expanded ? present : present.slice(0, LIST_LIMIT)
  if (!present.length) return null
  return <section className="grid gap-2 rounded-md border p-3"><h4 className="font-medium">{label}</h4>{visible.map((id) => {
    const exact = onOpen(ids, id)
    return <div className="flex flex-wrap items-center gap-2" key={id}><span className="font-mono text-sm">{evidenceOrdinalLabel(ordinals, id)}</span>{exact ? <Button type="button" size="sm" variant="outline" aria-label={`요청 기록 ${evidenceOrdinalLabel(ordinals, id)} 열기`} onClick={exact}>요청 기록 열기</Button> : <Badge variant="secondary">사용 불가</Badge>}</div>
  })}{present.length > LIST_LIMIT && <Button type="button" variant="link" size="sm" className="h-auto w-fit p-0" onClick={() => setExpanded((value) => !value)}>{expanded ? "요청 기록 접기" : "요청 기록 더 보기"}</Button>}</section>
}

type BadgeTone = { variant: "destructive" | "outline" | "secondary"; className: string }

/** 규칙 후보 제목 "후보: 요청"을 이름과 요청으로 나눠 경로가 단어 중간에서 끊기지 않게 한다. */
export function scenarioTitleParts(title: string) {
  const split = title.indexOf(": ")
  return split > 0 ? { name: title.slice(0, split), target: title.slice(split + 2) } : { name: title, target: "" }
}

export function scenarioRiskTone(risk: string): BadgeTone {
  switch (risk.trim().toUpperCase()) {
    case "CRITICAL": return { variant: "destructive", className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300" }
    case "HIGH": return { variant: "destructive", className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300" }
    case "MEDIUM": return { variant: "outline", className: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200" }
    case "LOW": return { variant: "outline", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" }
    default: return { variant: "secondary", className: "text-muted-foreground" }
  }
}

interface Props {
  scenario: Scenario
  ordinals?: Readonly<Record<string, number>>
  onOpenEvidence: ScenarioEvidenceAction
}

export function ScenarioCard({ scenario, ordinals, onOpenEvidence }: Props) {
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

  const riskTone = scenarioRiskTone(scenario.risk)
  const title = scenarioTitleParts(scenario.title)
  return <Card><article className="grid gap-1"><CardHeader><div className="flex flex-wrap gap-2"><Badge variant="outline"><BoundedText value={scenario.tag} /></Badge><Badge variant={riskTone.variant} className={riskTone.className}><BoundedText value={scenario.risk} /></Badge><Badge variant="outline">규칙 후보 · 사람 검토 필요</Badge></div><CardTitle><BoundedText value={title.name} />{title.target && <span className="mt-1 block break-all font-mono text-sm font-normal text-muted-foreground"><BoundedText value={title.target} /></span>}</CardTitle></CardHeader><CardContent className="grid gap-4">
    <section className="grid gap-2 rounded-md border p-3"><h3 className="font-medium">규칙 후보</h3><BoundedText value={scenario.proposal} /><p className="text-sm text-muted-foreground">후보 근거</p><BoundedText value={withEvidenceOrdinals(scenario.evidence, ordinals)} /></section>
    <EvidenceGroup label="후보 요청 기록" ids={scenario.evidenceIds} ordinals={ordinals} onOpen={onOpenEvidence} />
    <section className="grid gap-3 rounded-md border p-3"><h3 className="font-medium">사람 검토</h3><p className="text-sm text-muted-foreground">현재 서버 상태: {reviewLabels[scenario.reviewStatus]}</p><div className="grid gap-1"><Label htmlFor={`review-status-${scenario.id}`}>사람 검토 상태</Label><Select value={status} onValueChange={(value) => setStatus(value as ReviewStatus)}><SelectTrigger id={`review-status-${scenario.id}`} aria-label="사람 검토 상태"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNRESOLVED">미해결</SelectItem><SelectItem value="CONFIRMED">확인됨</SelectItem><SelectItem value="DISMISSED">기각됨</SelectItem></SelectContent></Select></div><div className="grid gap-1"><Label htmlFor={`review-note-${scenario.id}`}>검토 메모</Label><Input id={`review-note-${scenario.id}`} value={note} maxLength={REVIEW_NOTE_LIMIT} onChange={(change) => setNote(change.target.value.slice(0, REVIEW_NOTE_LIMIT))} /></div><Button type="button" disabled={review.isPending} onClick={() => void saveReview()}>{review.isPending ? "검토 저장 중" : "검토 저장"}</Button>{error && <Alert variant="destructive"><AlertTitle>검토를 저장하지 못했습니다.</AlertTitle><AlertDescription><BoundedText value={error} /></AlertDescription></Alert>}{success && <Alert><AlertTitle>사람 검토 저장</AlertTitle><AlertDescription><BoundedText value={success} /></AlertDescription></Alert>}</section>
  </CardContent></article></Card>
}
