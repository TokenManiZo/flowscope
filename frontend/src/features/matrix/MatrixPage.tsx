import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useEffect, useMemo, useState, type ReactNode } from "react"

import { EvidenceSheet, type StructuredEvidenceSelection } from "@/components/layout/EvidenceSheet"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ParameterCoverageMatrix, validationCellState, validationStateLabel } from "@/features/parameter-map/ParameterCoverageMatrix"
import { locationLabel } from "@/features/parameter-map/parameterNodeCard"
import { parameterMapKey, validationCellId, type ProjectedValidationCell } from "@/features/parameter-map/parameterProjection"
import { useSnapshotQuery } from "@/lib/query/hooks"
import type { Cell } from "@/lib/api/types"
import { JudgmentMatrixView } from "./JudgmentMatrixView"
import { MatrixVerdictCell } from "./MatrixVerdictCell"
import { operationDisplay, projectMatrix, type MatrixMember, type MatrixMode } from "./matrixProjection"

interface MatrixSelection extends StructuredEvidenceSelection {
  kind: "matrix"
  identity: string
  operation: string
  resource: string | null
}

function boundedText(value: string, expanded: boolean) { return !expanded && value.length > 180 ? `${value.slice(0, 180)}…` : value }

function BoundedOperation({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false)
  const { method, path } = operationDisplay(value)
  const long = path.length > 180
  return <div className="grid gap-1">{method && <Badge variant="outline" className="w-fit">{method}</Badge>}<span aria-hidden="true" className="break-all font-medium">{boundedText(path, expanded)}</span><span className="sr-only">서버 작업 값</span>{long && <button type="button" className="w-fit text-xs underline" onClick={() => setExpanded((current) => !current)}>{expanded ? "작업 접기" : "작업 더 보기"}</button>}</div>
}

/**
 * 판정 매트릭스가 기본이며 파라미터 커버리지와 기존 권한 표는 다른 보기에서 연다.
 */
export function MatrixPage() {
  // 파라미터 커버리지·기존 권한 표 보기는 UI에서 내렸다(판정 매트릭스만 노출). 함수는 재사용 대비 남겨 둔다.
  return <div className="h-full min-h-0 min-w-0 bg-[var(--flowscope-canvas)]">
    <JudgmentMatrixView />
  </div>
}

interface ParameterMatrixGroup { service: string; method: string; pathTemplate: string; location: string; canonicalPath: string; operation: string; cells: ProjectedValidationCell[] }

/**
 * PR#11 파라미터 커버리지: `snapshot.surface.validationCells`를 입력 좌표별로 묶어 subject × source 검증표로 보인다.
 * 셀 id는 좌표·판정 전부로 만든 표시용 파생값이며(validationCellId), 서버 셀이 사라지면 선택도 닫힌다.
 */
export function ParameterMatrixView({ viewSwitcher }: { viewSwitcher?: ReactNode } = {}) {
  const snapshot = useSnapshotQuery()
  const [selection, setSelection] = useState<string | null>(null)
  const groups = useMemo(() => {
    const result = new Map<string, ParameterMatrixGroup>()
    for (const cell of snapshot.data?.surface?.validationCells ?? []) {
      const key = parameterMapKey(cell.endpoint, cell.location, cell.canonicalPath)
      const group = result.get(key.stableKey) ?? { service: key.service, method: key.method, pathTemplate: key.pathTemplate, location: locationLabel(key.location), canonicalPath: key.canonicalPath, operation: key.operation, cells: [] }
      group.cells.push({ ...cell, id: validationCellId(cell) })
      result.set(key.stableKey, group)
    }
    return result
  }, [snapshot.data])
  const currentGroup = selection ? [...groups.values()].find(group => group.cells.some(cell => cell.id === selection)) : undefined
  const current = currentGroup?.cells.find(cell => cell.id === selection)
  useEffect(() => { if (selection && !current && !snapshot.isError) setSelection(null) }, [selection, current, snapshot.isError])
  const event = current && currentGroup ? snapshot.data?.events.find(item => current.evidenceIds.includes(item.eventId) && item.op === currentGroup.operation && item.method === current.endpoint.method) ?? null : null
  return <section className="min-w-0 space-y-4 p-4">{viewSwitcher}<h1 className="sr-only">파라미터 커버리지</h1>
    {snapshot.isLoading && !snapshot.isError && <p role="status">파라미터 커버리지 불러오는 중…</p>}
    {snapshot.isError && <SnapshotFailure title="파라미터 커버리지를 불러오지 못했습니다." retained={!!snapshot.data} updatedAt={snapshot.dataUpdatedAt} retry={() => void snapshot.refetch()} />}
    {!snapshot.isLoading && !snapshot.isError && !groups.size && <p>표시할 서버 파라미터 검증 좌표가 없습니다.</p>}
    {[...groups].map(([key, group]) => <section key={key} className="min-w-0 space-y-3"><header aria-label={`${group.service} ${group.method} ${group.pathTemplate}`} className="grid gap-1 rounded-md border border-border/70 bg-card/40 p-3"><div className="flex min-w-0 items-start gap-2"><Badge variant="outline" className="shrink-0">{group.method}</Badge><h2 className="min-w-0 break-all text-sm font-semibold">{group.pathTemplate}</h2></div><p className="break-all text-xs text-muted-foreground">{group.location} {group.canonicalPath}</p></header><ParameterCoverageMatrix cells={group.cells} onSelect={snapshot.isError ? undefined : cell => setSelection(cell.id)} /></section>)}
    {current && currentGroup && snapshot.data && <EvidenceSheet event={event} snapshot={snapshot.data} selection={{ kind: "matrix", identity: current.identity ?? "UNKNOWN", operation: currentGroup.operation, resource: current.targetResource, evidenceIds: current.evidenceIds, eventIds: current.evidenceIds, validation: { state: validationCellState(current), stateLabel: validationStateLabel(validationCellState(current)), role: current.role ?? "UNKNOWN", source: current.source ?? "UNKNOWN", subjectClass: current.subjectClass, targetResource: current.targetResource ?? "UNKNOWN", reason: current.reason, evidenceCount: current.evidenceCount, basisEvidenceIds: current.basisEvidenceIds, basisEvidenceCount: current.basisEvidenceCount } }} disabled={snapshot.isError} onOpenChange={open => { if (!open) setSelection(null) }} />}
  </section>
}

function SnapshotFailure({ title, retained, updatedAt, retry, detail }: { title: string; retained: boolean; updatedAt: number; retry(): void; detail?: string }) {
  return <Alert variant="destructive" className="sticky top-0 z-50 bg-background"><AlertTitle>{title}</AlertTitle><AlertDescription>
    {detail && <p>{detail}</p>}
    {retained ? <><p>마지막으로 불러온 데이터를 표시하고 있습니다.</p><p>마지막 성공 시각: {updatedAt > 0 && Number.isFinite(updatedAt) ? <time dateTime={new Date(updatedAt).toISOString()}>{new Date(updatedAt).toLocaleString()}</time> : "기록 없음"}</p><p>열린 상세와 초안은 유지되며 갱신에 성공할 때까지 변경·전송 동작이 비활성화됩니다.</p></> : <p>서버 연결을 확인하고 다시 시도하세요. 아직 성공한 snapshot이 없습니다.</p>}
    <Button variant="outline" size="sm" onClick={retry}>snapshot 다시 시도</Button>
  </AlertDescription></Alert>
}

export function LegacyMatrixView({ viewSwitcher }: { viewSwitcher?: ReactNode } = {}) {
  const snapshot = useSnapshotQuery()
  const [mode, setMode] = useState<MatrixMode>("identity")
  const [gapsOnly, setGapsOnly] = useState(false)
  const [selection, setSelection] = useState<MatrixSelection | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const projection = useMemo(() => snapshot.data ? projectMatrix(snapshot.data, mode, gapsOnly) : null, [snapshot.data, mode, gapsOnly])
  const selectionFor = (cell: Cell): MatrixSelection => {
    const observedSources = (["human", "scanner", "llm"] as const).filter((source) => cell.perSource[source] !== undefined).map((source) => source.toUpperCase())
    const missedSources = (["human", "scanner", "llm"] as const).filter((source) => cell.perSource[source] === undefined).map((source) => source.toUpperCase())
    const gap = snapshot.data?.gaps.some((item) => item.idn === cell.idn && item.op === cell.op && item.resource === cell.resource) ?? false
    return { kind: "matrix", identity: cell.idn, operation: cell.op, resource: cell.resource, evidenceIds: cell.evidenceIds, eventIds: cell.evidenceIds, authorization: { overall: cell.overall, observedSources, missedSources, conflict: cell.conflict, gap, reasons: Object.entries(cell.reasons).filter((entry): entry is [string, string] => typeof entry[1] === "string").map(([source, reason]) => `${source.toUpperCase()}: ${reason}`), requiredRole: snapshot.data?.requiredRoles[cell.op] ?? "Unknown/unset", owner: cell.resource ? snapshot.data?.owners[cell.resource] ?? "확인되지 않음" : "객체 없음" } }
  }

  useEffect(() => {
    if (snapshot.isError) return
    if (!selection || !snapshot.data) return
    const current = snapshot.data.cells.find((cell) => cell.idn === selection.identity && cell.op === selection.operation && cell.resource === selection.resource)
    if (!current) { setSelection(null); setInspectorOpen(false); return }
    const next = selectionFor(current)
    if (JSON.stringify(next) !== JSON.stringify(selection)) setSelection(next)
  }, [selection, snapshot.data, snapshot.isError])

  const select = (member: MatrixMember) => { setSelection(selectionFor(member.cell)); setInspectorOpen(true) }
  const selectedEvent = selection ? snapshot.data?.events.find((event) => selection.eventIds.includes(event.eventId)) ?? null : null

  const context = <section className="grid gap-3 p-3"><div><h2 className="text-sm font-semibold">표시 제어</h2><p className="text-xs text-muted-foreground">서버 역할과 기존 셀만 표시합니다.</p></div><Tabs value={mode} onValueChange={(value) => setMode(value === "role" ? "role" : "identity")}><TabsList><TabsTrigger value="identity">계정별</TabsTrigger><TabsTrigger value="role">역할별</TabsTrigger></TabsList></Tabs><label className="flex items-center gap-2"><Checkbox checked={gapsOnly} onCheckedChange={(checked) => setGapsOnly(checked === true)} /><span>미점검만 표시</span></label></section>
  const inspector = <EvidenceSheet inline contained event={selectedEvent} snapshot={snapshot.data} selection={selection} disabled={snapshot.isError} onOpenChange={() => undefined} />
  return <TooltipProvider><ReferenceAnalysisWorkspace ariaLabel="권한 매트릭스 분석 영역" context={context} inspector={inspector} inspectorOpen={inspectorOpen} contentOverflow="hidden" inspectorOverflow="hidden" onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) setSelection(null) }}><section className="flex h-full min-h-0 flex-col gap-3 p-3" aria-labelledby="matrix-title">
    <div className="shrink-0">{viewSwitcher}<h1 id="matrix-title" className="sr-only">권한 매트릭스</h1></div>
    {snapshot.isError && <SnapshotFailure title="권한 매트릭스를 불러오지 못했습니다." retained={!!snapshot.data} updatedAt={snapshot.dataUpdatedAt} retry={() => void snapshot.refetch()} detail={snapshot.error instanceof Error ? snapshot.error.message : undefined} />}
    {snapshot.isLoading && <p className="rounded-md border p-6 text-sm text-muted-foreground">권한 매트릭스를 불러오는 중입니다.</p>}
    {projection && !snapshot.isError && !projection.rows.length && <p className="rounded-md border p-6 text-sm text-muted-foreground">표시할 서버 권한 셀이 없습니다.</p>}
    {projection && projection.rows.length > 0 && <div role="region" aria-label="권한 매트릭스 표" tabIndex={0} data-testid="matrix-scroll-viewport" className="min-h-48 min-w-0 flex-1 overflow-auto rounded-md border overscroll-contain"><Table containerClassName="w-max min-w-full overflow-visible" className="min-w-max"><TableHeader><TableRow><TableHead className="sticky top-0 left-0 z-40 min-w-24 max-w-56 whitespace-normal bg-background">계정 / 역할</TableHead>{projection.columns.map((column) => <TableHead className="sticky top-0 z-30 min-w-56 whitespace-normal bg-background" key={column.key}><BoundedOperation value={column.operation} /></TableHead>)}</TableRow></TableHeader><TableBody>{projection.rows.map((row) => <TableRow key={row.key}><TableHead scope="row" className="sticky left-0 z-20 min-w-24 max-w-56 whitespace-normal bg-background"><span className="break-all">{row.label}</span></TableHead>{projection.columns.map((column) => <TableCell className="whitespace-normal" key={column.key}>{row.membersByColumn[column.key]?.length ? <div className="flex gap-2">{row.membersByColumn[column.key].map((member) => <MatrixVerdictCell key={`${member.key}:${member.identity}`} member={member} mode={mode} onSelect={select} disabled={snapshot.isError} />)}</div> : <span className="text-muted-foreground">-</span>}</TableCell>)}</TableRow>)}</TableBody></Table></div>}
  </section></ReferenceAnalysisWorkspace></TooltipProvider>
}
