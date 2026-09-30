import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

export interface LaneAccountRow { id: string; label: string; configured: boolean }

const ROW = "grid min-h-12 grid-cols-[1.25rem_minmax(0,1fr)_8rem_4.5rem] items-center gap-3 border-t border-border px-4 text-sm first:border-t-0"

/**
 * ZAP·LLM 단계가 같이 쓰는 계정 표. 로그인 설정이 있는 계정만 고를 수 있고, 없으면 [설정]으로 관리 창을 바로 연다.
 * 비로그인은 설정이 필요 없어 항상 고를 수 있다.
 */
export function AccountLaneTable({ lane, rows, anonymous, onAnonymousChange, selected, onToggle, onSettings, disabled = false }: {
  lane: string
  rows: readonly LaneAccountRow[]
  anonymous: boolean
  onAnonymousChange: (value: boolean) => void
  selected: readonly string[]
  onToggle: (id: string, value: boolean) => void
  onSettings: (id: string) => void
  disabled?: boolean
}) {
  return <div role="group" aria-label={`${lane} 대상 계정`} className={cn("overflow-hidden rounded-lg border border-border", disabled && "opacity-50")}>
    <div className={cn(ROW, "min-h-9 bg-muted text-xs text-muted-foreground")}><span /><span>계정</span><span>{lane} 로그인</span><span /></div>
    <label className={ROW}>
      <Checkbox aria-label="비로그인" checked={anonymous} disabled={disabled} onCheckedChange={(value) => onAnonymousChange(value === true)} />
      <span>비로그인</span><span className="text-muted-foreground">필요 없음</span><span />
    </label>
    {rows.map((row) => <div key={row.id} className={ROW}>
      <Checkbox aria-label={row.label} checked={selected.includes(row.id)} disabled={disabled || !row.configured} onCheckedChange={(value) => onToggle(row.id, value === true)} />
      <span className="truncate">{row.label}</span>
      <span className={cn("flex items-center gap-1.5", !row.configured && "text-muted-foreground")}><span aria-hidden="true" className={cn("size-1.5 rounded-full", row.configured ? "bg-emerald-500" : "bg-muted-foreground/40")} />{row.configured ? "설정됨" : "설정 필요"}</span>
      <Button type="button" size="sm" variant="outline" aria-label={`${row.label} ${lane} 로그인 설정`} onClick={() => onSettings(row.id)}>설정</Button>
    </div>)}
  </div>
}
