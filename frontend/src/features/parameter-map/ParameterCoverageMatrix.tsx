import { useState } from "react"
import { Check, CircleHelp, CircleMinus, Clock, ShieldAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { evidenceOrdinalLabel } from "@/lib/display/operationLabel"
import { resourceLabel } from "./parameterNodeCard"
import type { ProjectedValidationCell } from "./parameterProjection"

const columns = [["SELF", "자기 값"], ["OTHER_OWNER", "타인 값"], ["ANONYMOUS", "미인증"], ["OTHER_ROLE", "다른 역할"]] as const
const states = {
  ALLOW: { icon: Check, label: "허용", color: "text-emerald-700 dark:text-emerald-300" },
  DENY: { icon: X, label: "거부", color: "text-blue-700 dark:text-blue-300" },
  SUSPICIOUS: { icon: ShieldAlert, label: "의심", color: "text-red-700 dark:text-red-300" },
  UNDECIDED: { icon: CircleHelp, label: "판정 보류", color: "text-amber-700 dark:text-amber-300" },
  UNTESTED: { icon: Clock, label: "미검증", color: "text-orange-700 dark:text-orange-300" },
  NOT_APPLICABLE: { icon: CircleMinus, label: "적용 불가", color: "text-muted-foreground" },
}
export function validationCellState(cell: ProjectedValidationCell) { return cell.applicable ? cell.verdict : "NOT_APPLICABLE" }
export function validationStateLabel(state: keyof typeof states) { return states[state].label }
export function EvidenceIdsPreview({ label, ids, count, ordinals }: { label: string; ids: readonly string[]; count: number; ordinals?: Readonly<Record<string, number>> }) {
  const preview = [...new Set(ids)].slice(0, 20)
  return <div className="space-y-1"><p>{label} {count}건 · 순번 미리보기 {preview.length}개</p><ul className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{preview.map(id => <li key={id}>{evidenceOrdinalLabel(ordinals, id)}</li>)}</ul></div>
}

/** 선택 입력의 subject × source 검증 좌표. 빈 칸은 서버 좌표 없음이며 미검증 판정을 만들지 않는다. */
export function ParameterCoverageMatrix({ cells, onSelect }: { cells: readonly ProjectedValidationCell[]; onSelect?: (cell: ProjectedValidationCell) => void }) {
  const [mode, setMode] = useState("source")
  const rowKey = (cell: ProjectedValidationCell) => mode === "source" ? cell.source ?? "UNKNOWN" : `${cell.identity ?? "UNKNOWN"} / ${cell.role ?? "UNKNOWN"}`
  const rows = mode === "source" ? ["HUMAN", "SCANNER", "LLM", ...(cells.some(cell => !cell.source || cell.source === "UNKNOWN") ? ["UNKNOWN"] : [])] : [...new Set(cells.map(rowKey))].sort()
  const sourceLabel: Record<string, string> = { HUMAN: "H · HUMAN", SCANNER: "S · SCANNER", LLM: "L · LLM", UNKNOWN: "UNKNOWN" }
  const grouped = new Map<string, ProjectedValidationCell[]>()
  for (const cell of cells) {
    const key = JSON.stringify([rowKey(cell), cell.subjectClass]), group = grouped.get(key) ?? []
    group.push(cell)
    grouped.set(key, group)
  }
  return <section aria-label="선택 입력 검증 근거" className="min-w-0 space-y-3">
    <Tabs value={mode} onValueChange={setMode}><TabsList aria-label="파라미터 행 기준"><TabsTrigger value="source">H / S / L</TabsTrigger><TabsTrigger value="identity">신원 / 역할</TabsTrigger></TabsList></Tabs>
    <p className="text-xs text-muted-foreground">빈 칸 = 서버 좌표 없음</p>
    <div role="region" aria-label="파라미터 커버리지 표" tabIndex={0} className="max-h-[36rem] min-w-0 max-w-full overflow-auto overscroll-contain rounded-md border">
      <Table containerClassName="w-max min-w-full overflow-visible" className="min-w-[48rem]">
        <TableHeader><TableRow><TableHead className="sticky left-0 bg-background">{mode === "source" ? "요청 생성 주체" : "신원 / 역할"}</TableHead>{columns.map(([key, label]) => <TableHead key={key}>{label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{rows.map(row => <TableRow key={row}><TableHead scope="row" className="sticky left-0 max-w-40 whitespace-normal bg-background [overflow-wrap:anywhere]">{mode === "source" ? sourceLabel[row] : row}</TableHead>{columns.map(([subject]) => <TableCell key={subject} className="w-56 whitespace-normal align-top">
          {(grouped.get(JSON.stringify([row, subject])) ?? []).map(cell => {
            const state = validationCellState(cell), presentation = states[state], Icon = presentation.icon
            const target = cell.targetResource ? resourceLabel(cell.targetResource, cell.endpoint.service) : "UNKNOWN"
            const label = `${state} · ${presentation.label}`
            return <div role="group" key={cell.id} aria-label={`검증 좌표 ${cell.identity ?? "UNKNOWN"} / ${cell.role ?? "UNKNOWN"} / ${cell.source ?? "UNKNOWN"} / ${cell.subjectClass} / ${cell.targetResource ?? "UNKNOWN"}`} className="mb-2 max-w-64">
              <Button type="button" size="sm" variant="outline" disabled={!onSelect} aria-label={`${label} 상세 보기`} className={`h-auto w-full justify-start whitespace-normal py-2 text-left ${presentation.color}`} onClick={() => onSelect?.(cell)}><Icon aria-hidden="true" className="size-4" /><span><b>{state}</b><span className="block text-xs font-normal">{presentation.label}</span><span className="sr-only"> · 검증 신원 {cell.identity ?? "UNKNOWN"} · 검증 역할 {cell.role ?? "UNKNOWN"} · {cell.source} · {target}</span></span></Button>
            </div>
          })}
          {!grouped.has(JSON.stringify([row, subject])) && <span className="text-muted-foreground">— 서버 좌표 없음</span>}
        </TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </div>
  </section>
}
