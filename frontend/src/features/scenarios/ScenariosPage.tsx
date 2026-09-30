import { useEffect, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { EvidenceSheet, type ScenarioEvidenceSelection } from "@/components/layout/EvidenceSheet"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { useSnapshotQuery } from "@/lib/query/hooks"
import { ScenarioWorkspace } from "./ScenarioWorkspace"

export function ScenariosPage() {
  const snapshot = useSnapshotQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selection, setSelection] = useState<ScenarioEvidenceSelection | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [historyLimit, setHistoryLimit] = useState(30)
  const scenarios = snapshot.data?.scenarios ?? []

  useEffect(() => {
    setSelectedId(null)
    setSelection(null)
    setInspectorOpen(false)
    setHistoryLimit(30)
  }, [snapshot.data?.datasetRevision])
  // 트래픽이 들어와 revision만 바뀌면 선택을 유지하고, 선택한 시나리오가 사라졌을 때만 닫는다.
  useEffect(() => {
    if (!snapshot.isError && selectedId && !scenarios.some(item => item.id === selectedId)) {
      setSelectedId(null); setSelection(null); setInspectorOpen(false)
    }
  }, [selectedId, scenarios, snapshot.isError])

  function evidenceAction(ids: readonly string[], eventId: string) {
    if (snapshot.isError || !snapshot.data?.events.some((event) => event.eventId === eventId)) return null
    return () => {
      setSelection({ kind: "scenario", evidenceIds: ids, eventIds: [eventId] })
      setInspectorOpen(true)
    }
  }

  const selectedEvent = selection ? snapshot.data?.events.find((event) => event.eventId === selection.eventIds[0]) ?? null : null
  const history = snapshot.data?.legacyLlm
  const historicalEntries = [
    ...(history?.assessments ?? []).map((item) => ({ key: "assessment:" + item.id, title: item.title, id: item.id, verdict: item.verdict, reason: item.reason, at: item.createdAt, evidenceIds: item.evidenceIds })),
    ...(history?.validations ?? []).map((item, index) => ({ key: "validation:" + item.candidateId + ":" + index, title: "과거 판정", id: item.candidateId + " · " + item.runId, verdict: item.verdict, reason: item.reason, at: item.decidedAt, evidenceIds: [...item.originalEvidenceIds, ...item.validationEvidenceIds, ...item.controlEvidenceIds] })),
  ]
  const context = (
    <section className="grid gap-3 p-3">
      <h2 className="font-semibold">규칙 후보 검토</h2>
      <p className="text-sm text-muted-foreground">현재 관측 기록과 역할·소유자 정책에서 계산한 후보입니다. 원 요청·응답을 확인하고 사람 검토를 기록하세요.</p>
      <p className="text-sm">후보 {scenarios.length}개</p>
    </section>
  )
  const inspector = <EvidenceSheet inline event={selectedEvent} snapshot={snapshot.data} selection={selection} disabled={snapshot.isError} onOpenChange={() => undefined} />

  return (
    <ReferenceAnalysisWorkspace
      ariaLabel="시나리오 분석 영역"
      context={context}
      inspector={inspector}
      inspectorOpen={inspectorOpen}
      onInspectorOpenChange={(open) => {
        setInspectorOpen(open)
        if (!open) setSelection(null)
      }}
    >
      <section className="grid gap-4 p-3" aria-labelledby="scenarios-title">
        <div>
          <h1 id="scenarios-title" className="text-2xl font-semibold">취약점 시나리오</h1>
          <p className="text-sm text-muted-foreground">규칙 후보와 사람 검토를 표시합니다.</p>
        </div>
        {snapshot.isLoading && <p>시나리오 데이터를 불러오는 중입니다.</p>}
        {snapshot.isError && (
          <Alert variant="destructive">
            <AlertTitle>시나리오 snapshot을 불러오지 못했습니다.</AlertTitle>
            <AlertDescription>{snapshot.error instanceof Error ? snapshot.error.message : "다시 시도하세요."}</AlertDescription>
          </Alert>
        )}
        {!snapshot.isLoading && !snapshot.isError && scenarios.length === 0 && (
          <p>규칙에 해당하는 후보가 없습니다.</p>
        )}
        {scenarios.length > 0 && (
          <ScenarioWorkspace
            scenarios={scenarios}
            selectedId={selectedId ?? scenarios[0].id}
            onSelect={(id) => {
              setSelectedId(id)
              setSelection(null)
              setInspectorOpen(false)
            }}
            ordinals={snapshot.data?.evidenceOrdinals}
            onOpenEvidence={evidenceAction}
          />
        )}
        {historicalEntries.length > 0 && (
          <details className="rounded-md border p-3">
            <summary>과거 LLM 기록 · 읽기 전용 ({historicalEntries.length}개)</summary>
            <p className="my-3 text-sm text-muted-foreground">이전 프로젝트에서 가져온 읽기 전용 기록입니다.</p>
            <div className="grid gap-3">
              {historicalEntries.slice(0, historyLimit).map((entry) => (
                <article key={entry.key} className="grid gap-2 rounded-md border p-3 text-sm">
                  <h3 className="font-medium break-words">{entry.title} · {entry.verdict}</h3>
                  <p className="font-mono break-all">{entry.id} · {entry.at}</p>
                  <p className="whitespace-pre-wrap break-words">{entry.reason}</p>
                  <details>
                    <summary>저장된 기록 번호</summary>
                    {entry.evidenceIds.map((id, index) => {
                      const open = evidenceAction(entry.evidenceIds, id)
                      return (
                        <div className="flex flex-wrap items-center gap-2" key={id + index}>
                          <span className="break-all font-mono">{id}</span>
                          {open
                            ? <Button size="sm" variant="outline" onClick={open}>관측 기록 열기</Button>
                            : <span>현재 데이터에 없음</span>}
                        </div>
                      )
                    })}
                  </details>
                </article>
              ))}
            </div>
            {historyLimit < historicalEntries.length && (
              <Button className="mt-3" variant="outline" onClick={() => setHistoryLimit((limit) => limit + 30)}>과거 기록 더 보기</Button>
            )}
          </details>
        )}
      </section>
    </ReferenceAnalysisWorkspace>
  )
}
