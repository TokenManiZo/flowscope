import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { useSnapshotQuery } from "@/lib/query/hooks"
import type { SurfaceParameterGap, SurfaceSource } from "@/lib/api/types"
import { FocusedGraphWorkspace } from "./FocusedGraphWorkspace"
import { ParameterGapGraph } from "./ParameterGapGraph"
import { ParameterGapInspector } from "./ParameterGapInspector"
import { ParameterFilterBar } from "./ParameterFilterBar"
import { ParameterPriorityQueue } from "./ParameterPriorityQueue"
import { defaultParameterFilters, projectParameterMap, type ParameterFilters, type ParameterMapSelection } from "./parameterProjection"
import { RunGapHint, runGapCount } from "@/components/RunGapHint"

const gapTypeLabels: Record<SurfaceParameterGap["type"], string> = {
  DEFINED_NOT_OBSERVED: "정의된 입력 미관측", SOURCE_MISSED: "주체별 미관측", IDENTITY_MISSED: "신원별 미관측",
  AUTH_VARIANT_UNTESTED: "권한 변형 미검증", CONDITION_COMBINATION_UNOBSERVED: "조건 조합 미관측", TYPE_VARIANT_UNOBSERVED: "타입 변형 미관측",
}
/** 정렬 옵션. 현재는 서버 우선순위 하나이며 옵션을 추가할 수 있는 구조로 둔다. */
const sortOptions = [["RISK", "위험도(서버 우선순위)순"]] as const
const selectClass = "min-h-9 w-full min-w-0 rounded-md border border-input bg-[var(--flowscope-pane)] px-2 text-sm"


/** 권한·파라미터 Gap 그래프(PR#11 ParameterMapPage). snapshot.surface의 Gap·사실만 투영하며 서버 상태를 바꾸지 않는다. */
export function ParameterMapPage({ viewSwitcher }: { viewSwitcher?: ReactNode }) {
  const snapshot = useSnapshotQuery()
  const [filters, setFilters] = useState<ParameterFilters>(defaultParameterFilters)
  const [sort, setSort] = useState<(typeof sortOptions)[number][0]>("RISK")

  const [selectedGapId, setSelectedGapId] = useState<string | null>(null)
  const [focusVersion, setFocusVersion] = useState(0)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(() => window.matchMedia?.("(max-width: 899px)").matches !== true)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const projection = useMemo(() => snapshot.data ? projectParameterMap(snapshot.data, filters, selectedGapId) : null, [snapshot.data, filters, selectedGapId])
  const selected = projection?.queue.find(gap => gap.id === projection.selection?.gapId)
  useEffect(() => {
    if (selectedGapId && !projection?.selection && !snapshot.isError) { setSelectedGapId(null); setInspectorOpen(false) }
  }, [projection?.selection, selectedGapId, snapshot.isError])
  const select = (selection: ParameterMapSelection) => { if (snapshot.isError) return; setSelectedGapId(selection.gapId); setFocusVersion(version => version + 1); if (window.matchMedia("(max-width: 899px)").matches) { setQueueOpen(false); setAdvancedOpen(false) } setInspectorOpen(true) }
  const close = () => { setSelectedGapId(null); setInspectorOpen(false) }
  const reset = () => { setFilters(defaultParameterFilters); close() }

  const titleContent = <>{viewSwitcher}<h1 className="sr-only">권한·파라미터 Gap 그래프</h1></>
  const titleMeta = snapshot.data && !snapshot.isError && <div className="flex min-h-6 flex-wrap gap-x-4 text-xs text-muted-foreground"><span role="status" aria-label="snapshot 갱신 상태" className="inline-block min-w-16">{snapshot.isFetching ? "갱신 중" : "서버 근거"}</span><span>마지막 갱신: {snapshot.dataUpdatedAt ? <time aria-label="마지막 갱신" dateTime={new Date(snapshot.dataUpdatedAt).toISOString()}>{new Date(snapshot.dataUpdatedAt).toLocaleString("ko-KR")}</time> : "없음"}</span></div>
  const title = <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[var(--flowscope-divider)] px-4 py-2"><div className="flex items-center">{titleContent}</div>{titleMeta}</header>
  if (snapshot.isError && !projection) return <section className="h-full bg-[var(--flowscope-canvas)]">{title}<div role="alert" className="m-6 max-w-xl space-y-3 rounded-lg border border-destructive/40 p-4">
    <h2 className="font-semibold">점검 우선순위를 불러오지 못했습니다.</h2><p className="text-sm">{snapshot.error instanceof Error ? snapshot.error.message : "다시 시도하세요."}</p>
    <p className="text-sm text-muted-foreground">마지막 갱신: {snapshot.dataUpdatedAt ? new Date(snapshot.dataUpdatedAt).toLocaleString() : "없음"}.</p>
    <Button onClick={() => { void snapshot.refetch() }}>다시 불러오기</Button>
  </div></section>
  if (!projection) return <section>{title}<p role="status" className="p-6 text-sm">서버 점검 근거를 불러오는 중입니다.</p></section>

  const diagnostic = projection.diagnostics.length > 0
  if (!projection.queue.length && projection.emptyState !== "NO_MATCHING_GAPS") {
    const filtered = filters !== defaultParameterFilters
    // Only substitute the run-gap hint for the truly-empty state; keep the DEFINITIONS_ONLY message,
    // which reports a distinct fact (declared inputs exist but were never observed). (review #3)
    const pendingRunGap = !filtered && !diagnostic && projection.emptyState !== "DEFINITIONS_ONLY"
      ? runGapCount(snapshot.data) : 0
    const message = diagnostic ? "일부 입력을 분석하지 못했습니다. 누락 진단을 확인하세요."
      : projection.emptyState === "DEFINITIONS_ONLY" ? "정의된 입력이 있지만 아직 요청으로 관측되지 않음"
      : "아직 파라미터 관측 근거가 없습니다. 범위를 확인하고 HUMAN Evidence를 수집하세요."
    return <section className="h-full bg-[var(--flowscope-canvas)]">{title}<div role="status" className="m-6 max-w-xl space-y-4 rounded-lg border p-4">
      {pendingRunGap > 0 ? <RunGapHint count={pendingRunGap} /> : <>
        <p className="text-sm leading-6">{message}</p>
        {diagnostic && <ul className="space-y-2 text-sm [overflow-wrap:anywhere]">{projection.diagnostics.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        <Button onClick={filtered ? reset : () => { window.location.hash = diagnostic ? "#evidence" : "#inspection" }}>{filtered ? "필터 초기화" : diagnostic ? "Evidence에서 진단 확인" : "점검 시작으로 이동"}</Button>
      </>}
    </div></section>
  }

  const gapType = filters.gapTypes.length === 1 ? filters.gapTypes[0] : filters.gapTypes.length ? "discovery" : ""
  // 구현된(= 서버가 실제로 보낸) Gap 종류만 노출한다. 미구현 종류는 선택지에 만들지 않는다.
  const availableGapTypes = [...new Set((snapshot.data?.surface?.parameterGaps ?? []).map(gap => gap.type))].filter(type => Object.hasOwn(gapTypeLabels, type)).sort()
  const activeAdvancedCount = filters.source.length + filters.identity.length + Number(filters.gapTypes.length === 1)

  const failure = snapshot.isError && <div role="alert" className="shrink-0 space-y-2 border-b border-red-400 px-4 py-2 text-sm"><p>{snapshot.error instanceof Error ? snapshot.error.message : "다시 시도하세요."}</p><p className="text-muted-foreground">마지막으로 불러온 데이터를 표시하고 있습니다. 복구될 때까지 변경·전송을 잠급니다.</p><Button size="sm" variant="outline" onClick={() => { void snapshot.refetch() }}>다시 불러오기</Button></div>
  const toolbar = <>{failure}<div role="toolbar" aria-label="Gap 그래프 필터" className="focused-graph-filters shrink-0 border-b border-[var(--flowscope-divider)] px-4 py-2 text-sm">
    <ParameterFilterBar filters={filters} activeAdvancedCount={activeAdvancedCount} advancedOpen={advancedOpen && queueOpen} onChange={setFilters} onOpenAdvanced={() => { setAdvancedOpen(current => !current || !queueOpen); setQueueOpen(true) }} />
  </div></>
  const queue = <div className="space-y-3 p-3 text-sm">
    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
      <CollapsibleContent id="parameter-advanced-filters" className="space-y-3 pt-3">
      <label className="block space-y-2"><span>놓친 주체</span><select className={selectClass} value={filters.source[0] ?? ""} onChange={event => setFilters(current => ({ ...current, source: event.target.value ? [event.target.value as SurfaceSource] : [] }))}>
        <option value="">모든 주체</option><option value="HUMAN">H · HUMAN</option><option value="SCANNER">S · SCANNER</option><option value="LLM">L · LLM</option><option value="UNKNOWN">UNKNOWN</option>
      </select></label>
      <label className="mt-3 block space-y-2"><span>관측 신원 / Gap 신원</span><select className={selectClass} value={filters.identity[0] ?? ""} onChange={event => setFilters(current => ({ ...current, identity: event.target.value ? [event.target.value] : [] }))}>
        <option value="">모든 신원</option>{[...new Set((snapshot.data?.surface?.parameterGaps ?? []).map(gap => gap.identity ?? "UNKNOWN"))].sort().map(identity => <option key={identity}>{identity}</option>)}
      </select></label>
      <label className="block space-y-2"><span>Gap 종류</span><select className={selectClass} value={gapType} onChange={event => setFilters(current => ({ ...current, gapTypes: event.target.value ? [event.target.value as SurfaceParameterGap["type"]] : [] }))}>
        <option value="">모든 Gap 종류</option>{gapType === "discovery" && <option value="discovery" disabled>발견 범위 전체</option>}{availableGapTypes.map(value => <option key={value} value={value}>{gapTypeLabels[value]}</option>)}
      </select></label>

      <p className="mt-2 text-sm text-muted-foreground">표시 필터만 바뀝니다. owner·role·판정은 서버 값을 유지합니다.</p>
      <Button variant="outline" className="w-full" onClick={reset}>필터 초기화</Button>
      </CollapsibleContent>
    </Collapsible>
    <label className="block space-y-2"><span>정렬</span><select className={selectClass} aria-label="정렬" value={sort} onChange={event => setSort(event.target.value as typeof sort)}>{sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <div><h2 className="font-semibold">점검 우선순위 · {projection.queue.length}건</h2></div>

    <ParameterPriorityQueue gaps={projection.queue} selectedGapId={selected?.id ?? null} onSelect={gapId => { if (snapshot.isError) return; const current = projectParameterMap(snapshot.data!, filters, gapId).selection; if (current) select(current) }} />
  </div>

  const inspector = snapshot.data && selected ? <ParameterGapInspector snapshot={snapshot.data} projection={projection} suspended={snapshot.isError} onClose={close} /> : null

  return <FocusedGraphWorkspace queue={queue} header={titleContent} headerMeta={titleMeta} toolbar={toolbar} queueOpen={queueOpen} onQueueOpenChange={open => { setQueueOpen(open); if (!open) setAdvancedOpen(false) }} inspector={inspector} inspectorOpen={inspectorOpen} onInspectorOpenChange={open => { if (!open) close(); else setInspectorOpen(true) }}>
    {queueOpen && (projection.queue.length > 0 ? <section aria-label="우선 점검 이유" className="shrink-0 border-b border-[var(--flowscope-divider)] px-4 py-2 text-sm leading-5 [overflow-wrap:anywhere]"><span className="mr-2 font-semibold">{selected ? "선택한 Gap" : "먼저 확인"}</span>{(selected ?? projection.queue[0]).summary}</section>
      : <div role="status" className="shrink-0 space-y-3 border-b border-[var(--flowscope-divider)] p-4 text-sm"><p>현재 조건에 맞는 열린 위험 Gap이 없습니다.</p>{filters.riskOnly ? <Button onClick={() => setFilters(current => ({ ...current, riskOnly: false }))}>다른 열린 Gap 보기</Button> : <p>분석 필터에서 고급 조건을 조정하거나 초기화하세요.</p>}</div>)}
    {queueOpen && diagnostic && <details className="shrink-0 border-b border-[var(--flowscope-divider)] px-4 py-2 text-sm"><summary className="cursor-pointer text-amber-700 dark:text-amber-300">분석 진단 {projection.diagnostics.length}건 · 누락 근거 확인</summary><ul className="my-2 space-y-2 [overflow-wrap:anywhere]">{projection.diagnostics.map(reason => <li key={reason}>{reason}</li>)}</ul><Button size="sm" variant="outline" onClick={() => { window.location.hash = "#evidence" }}>Evidence에서 진단 확인</Button></details>}
    <ParameterGapGraph projection={projection} onSelect={select} focusVersion={focusVersion} hiddenGapCount={projection.hiddenGapCount} />
  </FocusedGraphWorkspace>
}
