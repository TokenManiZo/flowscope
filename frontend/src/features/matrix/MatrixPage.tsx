import { useEffect, useMemo, useState } from "react"

import { EvidenceSheet, type StructuredEvidenceSelection } from "@/components/layout/EvidenceSheet"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useSnapshotQuery } from "@/lib/query/hooks"
import { JudgmentMatrixView } from "./JudgmentMatrixView"
import { MatrixVerdictCell } from "./MatrixVerdictCell"
import { projectMatrix, type MatrixMember, type MatrixMode } from "./matrixProjection"

interface MatrixSelection extends StructuredEvidenceSelection {
  kind: "matrix"
  identity: string
  operation: string
  resource: string | null
}

function boundedText(value: string, expanded: boolean) { return !expanded && value.length > 180 ? `${value.slice(0, 180)}…` : value }

function BoundedOperation({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = value.length > 180
  const split = value.indexOf(" ")
  const method = split > 0 ? value.slice(0, split) : null
  const path = split > 0 ? value.slice(split + 1) : value
  return <div className="grid gap-1">{method && <Badge variant="outline" className="w-fit">{method}</Badge>}<span aria-hidden="true" className="break-all font-medium">{boundedText(path, expanded)}</span><span className="sr-only">서버 작업 값</span>{long && <button type="button" className="w-fit text-xs underline" onClick={() => setExpanded((current) => !current)}>{expanded ? "작업 접기" : "작업 더 보기"}</button>}</div>
}

/** 판정 매트릭스(P/E/O, PR#12 이식)가 기본이고 기존 권한 셀 표는 둘째 탭으로 남긴다(D-144). */
export function MatrixPage() {
  return <Tabs defaultValue="judgment" className="h-full min-h-0 min-w-0 gap-0 bg-[var(--flowscope-canvas)]">
    <TabsList aria-label="매트릭스 보기" variant="line" className="mx-4 my-2 shrink-0">
      <TabsTrigger value="judgment" className="px-3">판정 매트릭스</TabsTrigger>
      <TabsTrigger value="legacy" className="px-3">기존 권한 매트릭스</TabsTrigger>
    </TabsList>
    <TabsContent value="judgment" className="min-h-0 min-w-0 flex-1"><JudgmentMatrixView /></TabsContent>
    <TabsContent value="legacy" className="min-h-0 min-w-0 flex-1"><LegacyMatrixView /></TabsContent>
  </Tabs>
}

export function LegacyMatrixView() {
  const snapshot = useSnapshotQuery()
  const [mode, setMode] = useState<MatrixMode>("identity")
  const [gapsOnly, setGapsOnly] = useState(false)
  const [selection, setSelection] = useState<MatrixSelection | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const projection = useMemo(() => snapshot.data ? projectMatrix(snapshot.data, mode, gapsOnly) : null, [snapshot.data, mode, gapsOnly])

  useEffect(() => {
    if (!selection || !snapshot.data) return
    const current = snapshot.data.cells.find((cell) => cell.idn === selection.identity && cell.op === selection.operation && cell.resource === selection.resource)
    if (!current) { setSelection(null); setInspectorOpen(false); return }
    if (current.evidenceIds !== selection.evidenceIds) setSelection({ ...selection, evidenceIds: current.evidenceIds, eventIds: current.evidenceIds })
  }, [selection, snapshot.data])

  const select = (member: MatrixMember) => { setSelection({ kind: "matrix", identity: member.identity, operation: member.cell.op, resource: member.cell.resource, evidenceIds: member.cell.evidenceIds, eventIds: member.cell.evidenceIds }); setInspectorOpen(true) }
  const selectedEvent = selection ? snapshot.data?.events.find((event) => selection.eventIds.includes(event.eventId)) ?? null : null

  const context = <section className="grid gap-3 p-3"><div><h2 className="text-sm font-semibold">표시 제어</h2><p className="text-xs text-muted-foreground">서버 역할과 기존 셀만 표시합니다.</p></div><Tabs value={mode} onValueChange={(value) => setMode(value === "role" ? "role" : "identity")}><TabsList><TabsTrigger value="identity">신원별</TabsTrigger><TabsTrigger value="role">역할별</TabsTrigger></TabsList></Tabs><label className="flex items-center gap-2"><Checkbox checked={gapsOnly} onCheckedChange={(checked) => setGapsOnly(checked === true)} /><span>갭만 표시</span></label></section>
  const inspector = <EvidenceSheet inline event={selectedEvent} snapshot={snapshot.data} selection={selection} onOpenChange={() => undefined} />
  return <TooltipProvider><ReferenceAnalysisWorkspace ariaLabel="권한 매트릭스 분석 영역" context={context} inspector={inspector} inspectorOpen={inspectorOpen} onInspectorOpenChange={(open) => { setInspectorOpen(open); if (!open) setSelection(null) }}><section className="grid gap-4 p-3" aria-labelledby="matrix-title">
    <div><h1 id="matrix-title" className="text-2xl font-semibold">권한 매트릭스</h1><p className="text-sm text-muted-foreground">판정·갭·근거는 서버 snapshot을 그대로 표시하며 화면에서 다시 계산하지 않습니다.</p></div>
    {snapshot.isError && <Alert variant="destructive"><AlertTitle>권한 매트릭스를 불러오지 못했습니다.</AlertTitle><AlertDescription>{snapshot.error instanceof Error ? snapshot.error.message : "다시 시도하세요."}</AlertDescription></Alert>}
    {snapshot.isLoading && <p className="rounded-md border p-6 text-sm text-muted-foreground">권한 매트릭스를 불러오는 중입니다.</p>}
    {projection && !projection.rows.length && <p className="rounded-md border p-6 text-sm text-muted-foreground">표시할 서버 권한 셀이 없습니다.</p>}
    {projection && projection.rows.length > 0 && <div role="region" aria-label="권한 매트릭스 표" tabIndex={0} data-testid="matrix-scroll-viewport" className="h-[calc(100svh-14rem)] min-h-48 max-h-[44rem] max-w-full overflow-auto rounded-md border overscroll-contain"><Table containerClassName="w-max min-w-full overflow-visible" className="min-w-max"><TableHeader><TableRow><TableHead className="sticky top-0 left-0 z-40 bg-background">신원 / 역할</TableHead>{projection.columns.map((column) => <TableHead className="sticky top-0 z-30 min-w-72 whitespace-normal bg-background" key={column.key}><div className="grid gap-1"><BoundedOperation value={column.operation} /><span className="break-all text-xs">필수 역할: {column.requiredRole ?? "Unknown/unset"}</span><span className="break-all text-xs">리소스: {column.resource ?? "객체 없음"}</span><span className="break-all text-xs">소유자: {column.owner ?? "확인되지 않음"}</span></div></TableHead>)}</TableRow></TableHeader><TableBody>{projection.rows.map((row) => <TableRow key={row.key}><TableHead scope="row" className="sticky left-0 z-20 min-w-40 whitespace-normal bg-background"><span className="break-all">{row.label}</span></TableHead>{projection.columns.map((column) => <TableCell className="whitespace-normal" key={column.key}>{row.membersByColumn[column.key]?.length ? <div className="flex gap-2">{row.membersByColumn[column.key].map((member) => <MatrixVerdictCell key={`${member.key}:${member.identity}`} member={member} mode={mode} onSelect={select} />)}</div> : <span className="text-muted-foreground">-</span>}</TableCell>)}</TableRow>)}</TableBody></Table></div>}
  </section></ReferenceAnalysisWorkspace></TooltipProvider>
}
