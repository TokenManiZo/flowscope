import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Source, Verdict } from "@/lib/api/types"
import { sourceOrder, sourcePresentation, type MatrixMember, type MatrixMode } from "./matrixProjection"

export function matrixVerdictTone(verdict: Verdict | "unknown") {
  if (verdict === "allow") return { label: "ALLOW", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" }
  if (verdict === "deny") return { label: "DENY", className: "bg-red-500/10 text-red-700 dark:text-red-300" }
  if (verdict === "suspicious") return { label: "SUSPICIOUS", className: "bg-amber-500/10 text-amber-800 dark:text-amber-200" }
  if (verdict === "undecided") return { label: "UNDECIDED", className: "bg-violet-500/10 text-violet-800 dark:text-violet-200" }
  if (verdict === "untested") return { label: "UNTESTED", className: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300" }
  return { label: "UNKNOWN", className: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300" }
}

function SourceDetectionBadge({ member, source }: { member: MatrixMember; source: Source }) {
  const presentation = sourcePresentation(source)
  const verdict = member.cell.perSource[source]
  const reason = member.cell.reasons[source]
  const detected = verdict !== undefined
  const detail = detected ? `${presentation.label} 관측 · 서버 판정 ${verdict}${reason ? ` · ${reason}` : ""}` : `${presentation.label} 관측 없음`
  return <Tooltip><TooltipTrigger asChild><Badge variant="outline" className={detected ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-zinc-500/50 bg-transparent text-muted-foreground"}>{presentation.short} · {detected ? "탐지" : "미탐"}</Badge></TooltipTrigger><TooltipContent>{detail}</TooltipContent></Tooltip>
}

export function MatrixVerdictCell({ member, mode, onSelect, disabled = false }: { member: MatrixMember; mode: MatrixMode; onSelect(member: MatrixMember): void; disabled?: boolean }) {
  const tone = matrixVerdictTone(member.cell.overall)

  return <article className={`min-w-48 space-y-2 rounded-md p-2 ${tone.className}`}>
    {mode === "role" && <p className="break-all text-xs font-medium">{member.identity}</p>}
    <Tooltip><TooltipTrigger asChild><button type="button" disabled={disabled} className="w-full rounded-md border p-2 text-left font-semibold hover:bg-background/50 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50" aria-label="권한 셀 관측 기록 열기" onClick={() => onSelect(member)}><span className="block">{tone.label}</span><span className="sr-only">전체 판정: {member.cell.overall}. 상세 열기</span></button></TooltipTrigger><TooltipContent>서버 판정, 사유와 정확한 관측 기록을 엽니다.</TooltipContent></Tooltip>
    <div className="flex flex-wrap gap-1">{sourceOrder.filter((source) => source !== "unknown").map((source) => <SourceDetectionBadge key={source} source={source} member={member} />)}</div>
  </article>
}
