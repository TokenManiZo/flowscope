import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { SurfaceParameterGap } from "@/lib/api/types"
import type { ParameterFilters } from "./parameterProjection"

const authorizationTypes = ["AUTH_VARIANT_UNTESTED"] as const
const discoveryTypes = ["DEFINED_NOT_OBSERVED", "SOURCE_MISSED", "IDENTITY_MISSED", "CONDITION_COMBINATION_UNOBSERVED", "TYPE_VARIANT_UNOBSERVED"] as const

interface ParameterFilterBarProps {
  filters: ParameterFilters
  activeAdvancedCount: number
  advancedOpen: boolean
  onChange: (filters: ParameterFilters) => void
  onOpenAdvanced: () => void
}

function isCategoryActive(gapTypes: readonly SurfaceParameterGap["type"][], category: readonly SurfaceParameterGap["type"][]) {
  return gapTypes.length === 0 || category.some(type => gapTypes.includes(type))
}

export function ParameterFilterBar({ filters, activeAdvancedCount, advancedOpen, onChange, onOpenAdvanced }: ParameterFilterBarProps) {
  const authorizationActive = isCategoryActive(filters.gapTypes, authorizationTypes)
  const discoveryActive = isCategoryActive(filters.gapTypes, discoveryTypes)
  const toggleCategory = (category: "authorization" | "discovery") => {
    const nextAuthorization = category === "authorization" ? !authorizationActive : authorizationActive
    const nextDiscovery = category === "discovery" ? !discoveryActive : discoveryActive
    if (!nextAuthorization && !nextDiscovery) return
    const gapTypes = nextAuthorization && nextDiscovery ? []
      : nextAuthorization ? [...authorizationTypes]
        : [...discoveryTypes]
    onChange({ ...filters, gapTypes })
  }
  const advancedLabel = activeAdvancedCount > 0 ? `필터 더보기 · ${activeAdvancedCount}개 적용` : "필터 더보기"

  return <fieldset className="space-y-3 border-b border-[var(--flowscope-divider)] pb-4">
    <legend className="mb-3 font-semibold">집중할 항목</legend>
    <label className="flex items-center gap-2"><Checkbox checked={filters.riskOnly} onCheckedChange={checked => onChange({ ...filters, riskOnly: checked === true })} />위험 Gap</label>
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      <label className="flex items-center gap-2"><Checkbox checked={authorizationActive} onCheckedChange={() => toggleCategory("authorization")} />권한 검증</label>
      <label className="flex items-center gap-2"><Checkbox checked={discoveryActive} onCheckedChange={() => toggleCategory("discovery")} />발견 범위</label>
    </div>
    <p className="text-muted-foreground">열린 Gap부터 봅니다.</p>

    <Button type="button" variant="ghost" className="w-full justify-between px-0" aria-expanded={advancedOpen} aria-controls="parameter-advanced-filters" onClick={onOpenAdvanced}>{advancedLabel}<span aria-hidden="true">⌄</span></Button>
  </fieldset>
}
