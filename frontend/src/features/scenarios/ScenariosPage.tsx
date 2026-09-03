import { useEffect, useRef, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { EvidenceSheet, type ScenarioEvidenceSelection } from "@/components/layout/EvidenceSheet"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { createAiScenarios, getAiPreview } from "@/lib/api/endpoints"
import type { AiPreview, AiScenariosEnvelope } from "@/lib/api/types"
import { useSnapshotQuery } from "@/lib/query/hooks"
import { ScenarioWorkspace } from "./ScenarioWorkspace"

const TEXT_LIMIT = 180
const PREVIEW_LIST_LIMIT = 3

function BoundedPreviewText({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = value.length > TEXT_LIMIT
  return <div className="grid gap-1"><p className="break-all whitespace-pre-wrap">{expanded || !long ? value : `${value.slice(0, TEXT_LIMIT)}…`}</p>{long && <Button type="button" variant="link" size="sm" className="h-auto w-fit p-0" onClick={() => setExpanded((current) => !current)}>{expanded ? "미리보기 접기" : "미리보기 더 보기"}</Button>}</div>
}

function PreviewDetail({ preview }: { preview: AiPreview }) {
  const [expanded, setExpanded] = useState(false)
  const entries = [
    ...preview.findings.map((finding) => <section className="grid gap-1 rounded-md border p-3" key={`finding:${finding.id}`}><h4 className="font-medium">서버 finding</h4><BoundedPreviewText value={`id: ${finding.id}`} /><BoundedPreviewText value={`type: ${finding.type}`} /><BoundedPreviewText value={`severity: ${finding.severity}`} /><BoundedPreviewText value={`title: ${finding.title}`} /><BoundedPreviewText value={`cell identity: ${finding.cell.identity}`} /><BoundedPreviewText value={`cell operation: ${finding.cell.operation}`} /><BoundedPreviewText value={`cell resource: ${finding.cell.resource ?? "객체 없음"}`} /><BoundedPreviewText value={`reason: ${finding.reason}`} /><BoundedPreviewText value={`evidenceIds: ${finding.evidenceIds.join(", ") || "없음"}`} /><BoundedPreviewText value={`confirmed: ${String(finding.confirmed)}`} /></section>),
    ...preview.gaps.map((gap) => <section className="grid gap-1 rounded-md border p-3" key={`gap:${gap.id}`}><h4 className="font-medium">서버 gap</h4><BoundedPreviewText value={`id: ${gap.id}`} /><BoundedPreviewText value={`type: ${gap.type}`} /><BoundedPreviewText value={`identity: ${gap.identity}`} /><BoundedPreviewText value={`operation: ${gap.operation}`} /><BoundedPreviewText value={`resource: ${gap.resource ?? "객체 없음"}`} /><BoundedPreviewText value={`missedBy: ${gap.missedBy.join(", ") || "없음"}`} /><BoundedPreviewText value={`risk: ${String(gap.risk)}`} /><BoundedPreviewText value={`reason: ${gap.reason}`} /></section>),
  ]
  const visible = expanded ? entries : entries.slice(0, PREVIEW_LIST_LIMIT)
  return <div className="grid gap-2 rounded-md border p-3"><BoundedPreviewText value={preview.notice} /><p>레코드: {preview.records} · coverage 셀: {preview.coverageCells}</p><p>서버 finding: {preview.findings.length} · gap: {preview.gaps.length}</p>{visible}{entries.length > PREVIEW_LIST_LIMIT && <Button type="button" variant="link" size="sm" className="h-auto w-fit p-0" onClick={() => setExpanded((current) => !current)}>{expanded ? "미리보기 목록 접기" : "미리보기 목록 더 보기"}</Button>}</div>
}

export function ScenariosPage() {
  const snapshot = useSnapshotQuery()
  const [preview, setPreview] = useState<AiPreview | null>(null)
  const [previewRevision, setPreviewRevision] = useState<number | null>(null)
  const [previewError, setPreviewError] = useState("")
  const [previewPending, setPreviewPending] = useState(false)
  const [generated, setGenerated] = useState<AiScenariosEnvelope | null>(null)
  const [generatedRevision, setGeneratedRevision] = useState<number | null>(null)
  const [generationError, setGenerationError] = useState("")
  const [generationPending, setGenerationPending] = useState(false)
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null)
  const [changedRevision, setChangedRevision] = useState(false)
  const [selection, setSelection] = useState<ScenarioEvidenceSelection | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const revision = snapshot.data?.revision ?? null
  const revisionRef = useRef(revision)
  const previousRevisionRef = useRef<number | null>(revision)
  const previewEligibilityRef = useRef(false)
  revisionRef.current = revision

  useEffect(() => {
    if (previousRevisionRef.current !== null && revision !== previousRevisionRef.current) {
      previewEligibilityRef.current = false
      setPreview(null)
      setPreviewRevision(null)
      setPreviewError("")
      setPreviewPending(false)
      setGenerated(null)
      setGeneratedRevision(null)
      setGenerationError("")
      setGenerationPending(false)
      setSelectedScenarioId(null)
      setSelection(null)
      setInspectorOpen(false)
      setChangedRevision(true)
    }
    previousRevisionRef.current = revision
  }, [revision])

  useEffect(() => {
    if (!selection) return
    if (!snapshot.data?.events.some((event) => event.eventId === selection.eventIds[0])) { setSelection(null); setInspectorOpen(false) }
  }, [selection, snapshot.data?.events])

  async function previewJudgeInput() {
    if (previewPending || revision === null) return
    const requestRevision = revision
    previewEligibilityRef.current = false
    setPreview(null)
    setPreviewRevision(null)
    setPreviewPending(true)
    setPreviewError("")
    setChangedRevision(false)
    try {
      const result = await getAiPreview()
      if (revisionRef.current !== requestRevision) return
      previewEligibilityRef.current = true
      setPreview(result)
      setPreviewRevision(requestRevision)
    } catch (reason) {
      if (revisionRef.current === requestRevision) setPreviewError(reason instanceof Error ? reason.message : "미리보기를 불러오지 못했습니다.")
    } finally {
      if (revisionRef.current === requestRevision) setPreviewPending(false)
    }
  }

  const previewReady = !previewPending && previewEligibilityRef.current && revision !== null && preview !== null && previewRevision === revision

  async function generateScenarios() {
    if (generationPending || previewPending || !previewEligibilityRef.current || !previewReady || revision === null) return
    const requestRevision = revision
    setGenerationPending(true)
    setGenerationError("")
    setChangedRevision(false)
    try {
      const result = await createAiScenarios()
      if (revisionRef.current !== requestRevision) return
      setGenerated(result)
      setGeneratedRevision(requestRevision)
      setSelectedScenarioId(result.result.scenarios[0]?.id ?? null)
    } catch (reason) {
      if (revisionRef.current === requestRevision) setGenerationError(reason instanceof Error ? reason.message : "시나리오를 생성하지 못했습니다.")
    } finally {
      if (revisionRef.current === requestRevision) setGenerationPending(false)
    }
  }

  function evidenceAction(ids: readonly string[], eventId: string) {
    if (!snapshot.data?.events.some((event) => event.eventId === eventId)) return null
    return () => { setSelection({ kind: "scenario", evidenceIds: ids, eventIds: [eventId] }); setInspectorOpen(true) }
  }

  const generatedForRevision = generated !== null && generatedRevision === revision
  const scenarios = generatedForRevision ? generated.result.scenarios : []
  const activeSelection = generatedForRevision ? selection : null
  const selectedEvent = activeSelection ? snapshot.data?.events.find((event) => event.eventId === activeSelection.eventIds[0]) ?? null : null
  const context = <section className="grid gap-4 p-3"><div><h2 className="text-sm font-semibold">Judge 작업</h2><p className="text-xs text-muted-foreground">현재 revision의 서버 입력과 반환 묶음만 사용합니다.</p></div><div className="grid gap-2"><Button type="button" disabled={previewPending || revision === null || snapshot.isError} onClick={() => void previewJudgeInput()}>{previewPending ? "미리보기 불러오는 중" : "MCP Judge 입력 미리보기"}</Button>{previewError && <Alert variant="destructive"><AlertTitle>미리보기를 불러오지 못했습니다.</AlertTitle><AlertDescription><BoundedPreviewText value={previewError} /></AlertDescription><Button type="button" variant="outline" onClick={() => void previewJudgeInput()}>미리보기 재시도</Button></Alert>}</div><div className="grid gap-2 border-t pt-3"><Button type="button" disabled={generationPending || !previewReady || snapshot.isError} onClick={() => void generateScenarios()}>{generationPending ? "시나리오 생성 중" : "시나리오 생성"}</Button>{generationError && <Alert variant="destructive"><AlertTitle>시나리오를 생성하지 못했습니다.</AlertTitle><AlertDescription><BoundedPreviewText value={generationError} /></AlertDescription><Button type="button" variant="outline" disabled={!previewReady} onClick={() => void generateScenarios()}>시나리오 재시도</Button></Alert>}</div></section>
  const inspector = <EvidenceSheet inline event={selectedEvent} snapshot={snapshot.data} selection={activeSelection} onOpenChange={() => undefined} />
  return <ReferenceAnalysisWorkspace ariaLabel="시나리오 분석 영역" context={context} inspector={inspector} inspectorOpen={inspectorOpen} onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) setSelection(null) }}><section className="grid gap-4 p-3" aria-labelledby="scenarios-title"><div><h1 id="scenarios-title" className="text-2xl font-semibold">취약점 시나리오</h1><p className="text-sm text-muted-foreground">서버 후보, LLM 평가, 최종 검증, 사람 검토를 서로 바꾸거나 추론하지 않습니다.</p></div>
    {snapshot.isLoading && <p className="rounded-md border p-6 text-sm text-muted-foreground">시나리오 데이터를 불러오는 중입니다.</p>}
    {snapshot.isError && <Alert variant="destructive"><AlertTitle>시나리오 snapshot을 불러오지 못했습니다.</AlertTitle><AlertDescription>{snapshot.error instanceof Error ? snapshot.error.message : "다시 시도하세요."}</AlertDescription></Alert>}
    {changedRevision && <Alert><AlertTitle>snapshot 변경</AlertTitle><AlertDescription>snapshot이 변경되어 미리보기와 생성 결과를 다시 확인해야 합니다.</AlertDescription></Alert>}
    {previewReady && <section className="grid gap-2 rounded-md border p-3"><h2 className="font-medium">MCP Judge 입력 미리보기</h2><PreviewDetail preview={preview} /></section>}
    {generatedForRevision && <Alert><AlertTitle>{generated.usedLlm ? "기존 MCP 평가·검증 상태 포함" : "결정론적 폴백"}</AlertTitle><AlertDescription>{generated.usedLlm ? "반환 묶음에 기존 MCP 평가/검증 상태가 포함됩니다. 이 버튼이 모델 실행 성공을 뜻하지는 않습니다." : "MCP LLM 평가 또는 검증이 없어 결정론적 후보만 반환되었습니다."}</AlertDescription></Alert>}
    {!snapshot.isLoading && !snapshot.isError && !generatedForRevision && <p className="rounded-md border p-6 text-sm text-muted-foreground">시나리오 생성을 시작하면 서버 반환 후보를 표시합니다.</p>}
    {generatedForRevision && scenarios.length === 0 && <p className="rounded-md border p-6 text-sm text-muted-foreground">반환된 시나리오가 없습니다.</p>}
    {scenarios.length > 0 && <ScenarioWorkspace scenarios={scenarios} selectedId={selectedScenarioId} onSelect={(id) => { setSelectedScenarioId(id); setSelection(null); setInspectorOpen(false) }} onOpenEvidence={evidenceAction} />}
  </section></ReferenceAnalysisWorkspace>
}
