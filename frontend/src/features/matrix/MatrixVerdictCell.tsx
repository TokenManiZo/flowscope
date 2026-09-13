import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Source, Verdict } from "@/lib/api/types"
import { sourceOrder, sourcePresentation, type MatrixMember, type MatrixMode } from "./matrixProjection"

const INITIAL_LIMIT = 3

function bounded(values: readonly string[], expanded: boolean) {
  return expanded ? values : values.slice(0, INITIAL_LIMIT)
}

function boundedText(value: string, expanded: boolean) {
  return !expanded && value.length > 180 ? `${value.slice(0, 180)}…` : value
}

export function matrixVerdictTone(verdict: Verdict | "unknown") {
  if (verdict === "allow") return { label: "ALLOW", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", accentClassName: "border-l-emerald-500" }
  if (verdict === "deny") return { label: "DENY", className: "bg-red-500/10 text-red-700 dark:text-red-300", accentClassName: "border-l-red-500" }
  if (verdict === "suspicious") return { label: "SUSPICIOUS", className: "bg-amber-500/10 text-amber-800 dark:text-amber-200", accentClassName: "border-l-amber-500" }
  if (verdict === "undecided") return { label: "UNDECIDED", className: "bg-violet-500/10 text-violet-800 dark:text-violet-200", accentClassName: "border-l-violet-500" }
  if (verdict === "untested") return { label: "UNTESTED", className: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300", accentClassName: "border-l-zinc-500" }
  return { label: "UNKNOWN", className: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300", accentClassName: "border-l-zinc-500" }
}

function SourceResultRow({ member, source }: { member: MatrixMember; source: Source }) {
  const [expanded, setExpanded] = useState(false)
  const presentation = sourcePresentation(source)
  const verdict = member.cell.perSource[source]
  const reason = member.cell.reasons[source]
  const missed = member.cell.missedSources.includes(source)
  const unobserved = verdict === undefined
  const state = verdict ?? "미관측"
  const line = `${presentation.short} · ${presentation.label} · ${state} · ${presentation.line}${missed ? " · 미관측/놓침" : ""}`
  const text = reason ? bounded([reason], expanded) : []

  return <div className={missed ? "line-through decoration-2" : ""}>
    <Badge variant="outline" className={`max-w-full whitespace-normal text-left ${presentation.lineClass} ${unobserved ? "border-zinc-500/50 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300" : ""}`}>{line}</Badge>
    {text.map((value, index) => <p className="mt-1 break-all text-xs text-muted-foreground" key={index}>{boundedText(value, expanded)}</p>)}
    {reason && reason.length > 180 && <button type="button" className="mt-1 text-xs underline" onClick={() => setExpanded((value) => !value)}>{expanded ? "사유 접기" : "사유 더 보기"}</button>}
  </div>
}

function CellStateBadges({ member }: { member: MatrixMember }) {
  if (!member.cell.conflict && !member.gap && member.cell.missedSources.length === 0) return null
  return <div className="flex flex-wrap gap-1">
    {member.cell.conflict && <Badge variant="destructive">서버 충돌</Badge>}
    {member.gap && <Badge variant="secondary">서버 갭</Badge>}
    {member.cell.missedSources.length > 0 && <Badge variant="outline">미관측/놓침</Badge>}
  </div>
}

export function MatrixVerdictCell({ member, mode, onSelect, disabled = false }: { member: MatrixMember; mode: MatrixMode; onSelect(member: MatrixMember): void; disabled?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const tone = matrixVerdictTone(member.cell.overall)
  const reasons = Object.values(member.cell.reasons).filter((value): value is string => typeof value === "string" && value.length > 0)

  return <article className={`min-w-64 space-y-2 border-l-2 p-3 ${tone.className} ${tone.accentClassName}`}>
    {mode === "role" && <p className="break-all text-xs font-medium">{member.identity}</p>}
    <Tooltip><TooltipTrigger asChild><button type="button" disabled={disabled} className="w-full rounded-md border p-2 text-left font-semibold hover:bg-background/50 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50" aria-label="권한 셀 Evidence 열기" onClick={() => onSelect(member)}><span className="block">{tone.label}</span><span className="sr-only">전체 판정: {member.cell.overall}</span><span className="block text-xs font-normal text-muted-foreground">Evidence 상세 열기</span></button></TooltipTrigger><TooltipContent>서버가 제공한 정확한 Evidence 선택을 엽니다.</TooltipContent></Tooltip>
    {sourceOrder.map((source) => <SourceResultRow key={source} source={source} member={member} />)}
    <CellStateBadges member={member} />
    {reasons.length > 1 && <div className="text-xs text-muted-foreground"><p>서버 사유 {reasons.length}건</p>{bounded(reasons, expanded).map((reason, index) => <p className="break-all" key={index}>{boundedText(reason, expanded)}</p>)}{(reasons.length > INITIAL_LIMIT || reasons.some((reason) => reason.length > 180)) && <button type="button" className="underline" onClick={() => setExpanded((value) => !value)}>{expanded ? "사유 접기" : "사유 더 보기"}</button>}</div>}
  </article>
}
