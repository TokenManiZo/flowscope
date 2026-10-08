import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { trafficClassLabels } from "@/lib/display/traffic"
import { cn } from "@/lib/utils"
import { trafficClassDefaults, type EvidenceFiltersState } from "./evidenceSelectors"

const sourceLabels = {
  human: "사람 H",
  scanner: "스캐너 S",
  llm: "LLM L",
} as const

type Props = {
  value: EvidenceFiltersState
  onChange: (next: EvidenceFiltersState) => void
}

function ChipCheckbox({ checked, label, onCheckedChange }: { checked: boolean; label: string; onCheckedChange: (next: boolean) => void }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", checked ? "border-border bg-card" : "border-dashed text-muted-foreground")}>
      <Checkbox className="size-3.5" checked={checked} onCheckedChange={(next) => onCheckedChange(next === true)} aria-label={label} />
      {label}
    </label>
  )
}

/** 표 위 한 줄 도구 모음: 소스, 검색, 분류(팝오버), 반복 펼치기. 판정은 탭이 맡는다. */
export function EvidenceFilters({ value, onChange }: Props) {
  const classes = Object.keys(trafficClassDefaults)
  const shown = classes.filter((trafficClass) => value.trafficClasses[trafficClass] === true).length
  return (
    <div role="group" aria-label="요청 기록 표시 필터" className="flex flex-wrap items-center gap-2">
      {(Object.keys(sourceLabels) as (keyof typeof sourceLabels)[]).map((source) => (
        <ChipCheckbox key={source} label={sourceLabels[source]} checked={value.sources[source]}
          onCheckedChange={(checked) => onChange({ ...value, sources: { ...value.sources, [source]: checked } })} />
      ))}
      <Input type="search" aria-label="#번호, 경로, 계정 검색" placeholder="#번호, 경로, 계정 검색" value={value.query ?? ""} className="h-8 w-full sm:w-64 text-sm"
        onChange={(event) => onChange({ ...value, query: event.target.value })} />
      <Popover>
        <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="h-8 gap-1">분류 {shown}/{classes.length}<ChevronDown className="size-3.5" /></Button></PopoverTrigger>
        <PopoverContent align="start" className="grid w-56 gap-2 p-3" aria-label="트래픽 분류">
          {classes.map((trafficClass) => (
            <label key={trafficClass} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={value.trafficClasses[trafficClass] === true} aria-label={trafficClassLabels[trafficClass]}
                onCheckedChange={(checked) => onChange({ ...value, trafficClasses: { ...value.trafficClasses, [trafficClass]: checked === true } })} />
              {trafficClassLabels[trafficClass]}
            </label>
          ))}
        </PopoverContent>
      </Popover>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Checkbox checked={value.expandRepeats} aria-label="반복 요청 기록 펼치기" onCheckedChange={(next) => onChange({ ...value, expandRepeats: next === true })} />
        반복 펼치기
      </label>
    </div>
  )
}
