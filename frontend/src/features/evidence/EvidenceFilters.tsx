import { Checkbox } from "@/components/ui/checkbox"
import type { EvidenceFiltersState } from "./evidenceSelectors"

const sourceLabels = {
  human: "사람 H",
  scanner: "스캐너 S",
  llm: "LLM L",
} as const

const trafficLabels: Record<string, string> = {
  API: "API",
  AUTH_SESSION: "인증·세션 준비",
  UNKNOWN: "판단 보류",
  TELEMETRY_CANDIDATE: "텔레메트리 후보",
  POLLING: "반복 polling 후보",
  BACKGROUND: "반복 백그라운드 후보",
  NAVIGATION: "화면 이동",
  STATIC_ASSET: "정적 자원",
  DISCOVERY_METADATA: "탐색 메타데이터",
  PREFLIGHT: "CORS 사전 요청",
}

type Props = {
  value: EvidenceFiltersState
  onChange: (next: EvidenceFiltersState) => void
}

function FilterCheckbox({ checked, label, onCheckedChange }: { checked: boolean; label: string; onCheckedChange: (next: boolean) => void }) {
  return (
    <label className="flex min-w-0 items-start gap-2 text-sm leading-5">
      <Checkbox checked={checked} onCheckedChange={(next) => onCheckedChange(next === true)} aria-label={label} />
      <span className="min-w-0 break-keep">{label}</span>
    </label>
  )
}

export function EvidenceFilters({ value, onChange }: Props) {
  return (
    <fieldset className="grid gap-3 rounded-lg border p-3" aria-label="Evidence 표시 필터">
      <legend className="px-1 font-medium">Evidence 표시 필터</legend>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="수집 소스">
        {(Object.keys(sourceLabels) as (keyof typeof sourceLabels)[]).map((source) => (
          <FilterCheckbox
            key={source}
            label={sourceLabels[source]}
            checked={value.sources[source]}
            onCheckedChange={(checked) => onChange({ ...value, sources: { ...value.sources, [source]: checked } })}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="트래픽 판정">
        {(["INCLUDE", "REVIEW", "EXCLUDE"] as const).map((disposition) => (
          <FilterCheckbox
            key={disposition}
            label={disposition}
            checked={value.dispositions[disposition]}
            onCheckedChange={(checked) => onChange({ ...value, dispositions: { ...value.dispositions, [disposition]: checked } })}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2" role="group" aria-label="트래픽 분류">
        {Object.entries(trafficLabels).map(([trafficClass, label]) => (
          <FilterCheckbox
            key={trafficClass}
            label={label}
            checked={value.trafficClasses[trafficClass] === true}
            onCheckedChange={(checked) => onChange({ ...value, trafficClasses: { ...value.trafficClasses, [trafficClass]: checked } })}
          />
        ))}
      </div>
      <FilterCheckbox
        label="반복 Evidence 펼치기"
        checked={value.expandRepeats}
        onCheckedChange={(expandRepeats) => onChange({ ...value, expandRepeats })}
      />
      <p className="text-sm text-muted-foreground">이 필터는 표시에만 적용됩니다. 숨김 Evidence는 삭제되지 않습니다.</p>
    </fieldset>
  )
}
