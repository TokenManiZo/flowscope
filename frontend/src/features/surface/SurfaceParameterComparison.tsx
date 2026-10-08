import { ChevronDown, ChevronRight } from "lucide-react"

import { SourceMarks } from "@/components/TrafficBadges"
import { Button } from "@/components/ui/button"
import type { SurfaceParameter } from "@/lib/api/types"

function normalizedType(type: string) {
  const value = type.toUpperCase()
  return value === "BOOL" ? "BOOLEAN" : value === "INT" ? "INTEGER" : value
}
export function parameterComparison(parameter: SurfaceParameter) {
  if (parameter.coordinateResolved === false) return "좌표 미확정"
  if (parameter.observations.length === 0) return "선언만"
  if (parameter.declarations.length === 0) return "관측만"
  const declared = parameter.declarations.map(item => item.declaredType).filter((value): value is string => Boolean(value)).map(normalizedType)
  const observed = parameter.observations.map(item => item.valueType).filter((value): value is string => Boolean(value)).map(normalizedType)
  if (declared.length && observed.some(type => !declared.some(expected => expected === type || expected === "NUMBER" && ["INTEGER", "DECIMAL", "FLOAT"].includes(type)))) return "형식 차이"
  return declared.length && observed.length ? "형식 일치" : "형식 근거 부족"
}
export function hasInputDifference(parameters: readonly SurfaceParameter[]) {
  return parameters.some(parameter => ["선언만", "관측만", "형식 차이"].includes(parameterComparison(parameter)))
}

export function SurfaceParameterComparison({ parameters, ordinal, onEvidence, disabled }: { parameters: readonly SurfaceParameter[]; /** 번호가 없는 기록이면 빈 문자열. */ ordinal(id: string): string; onEvidence(id: string): void; disabled: boolean }) {
  return <div className="grid min-w-0 gap-3">{parameters.map(parameter => {
    const comparison = parameterComparison(parameter)
    const declarations = [...new Set(parameter.declarations.map(item => item.declaredType || item.declaredShape).filter(Boolean))]
    return <details key={`${parameter.location}:${parameter.coordinateResolved === false ? "?" : ""}${parameter.canonicalPath}`} className="group min-w-0 rounded-md border border-border/80 bg-card">
      <summary className="grid cursor-pointer list-none gap-1.5 rounded-t-md bg-muted/30 px-3 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-wrap items-center gap-2"><span className="rounded border px-1.5 text-[10px] text-muted-foreground">{parameter.location}</span><span className="min-w-0 break-all font-mono text-xs">{parameter.fieldPath}</span><span className="ml-auto text-[11px] text-muted-foreground">{comparison}</span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground group-open:rotate-180" /></span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"><span><span className="text-muted-foreground">선언 </span>{declarations.join(" / ") || (parameter.declarations.length ? "형식 미지정" : "없음")}<span className="px-1.5 text-muted-foreground">→</span><span className="text-muted-foreground">관측 </span>{parameter.observedShapes.join(" / ") || "없음"}</span><span className="ml-auto flex items-center gap-2"><SourceMarks sources={parameter.observedSources} /><span className="text-muted-foreground">{parameter.observations.length}건</span></span></span>
      </summary>
      <div className="grid gap-3 border-t border-border/80 bg-background/40 p-3 text-xs">
        <p className="break-all font-mono text-[11px] text-muted-foreground">{parameter.canonicalPath} · {parameter.requirement}</p>
        {parameter.coordinateResolved === false && <p className="text-xs text-amber-800 dark:text-amber-300">선언 좌표 미확정 · 관측 비교 제외</p>}
        <p className="text-muted-foreground">관측 값의 형식과 근거를 표시합니다. 실제 값은 근거 원문에서 확인하세요.</p>
        {parameter.observations.map((item, index) => <Button key={`${item.evidenceId}:${index}`} type="button" variant="outline" className="h-auto min-w-0 w-full justify-start gap-2 border-border/80 bg-muted/20 px-3 py-2.5 text-xs hover:bg-muted/60" disabled={disabled} onClick={() => onEvidence(item.evidenceId)} aria-label={`입력 근거 기록 ${ordinal(item.evidenceId)} 보기`}><SourceMarks sources={[item.source]} /><span className="break-all whitespace-normal font-mono">{item.valueType || item.shape || "형식 미상"}</span><span className="text-muted-foreground">{item.presence || ""}</span><span className="ml-auto shrink-0 font-mono">{ordinal(item.evidenceId)}</span><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /></Button>)}
        {parameter.declarations.map((item,index) => <p key={`${item.evidenceId}:${index}`} className="break-words text-[11px] text-muted-foreground">{["선언", item.type, item.adapter, item.declaredType || item.declaredShape || "형식 미지정", ordinal(item.evidenceId)].filter(Boolean).join(" · ")}</p>)}
      </div>
    </details>
  })}</div>
}
