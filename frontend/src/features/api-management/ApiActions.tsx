import { identityLabel } from "@/lib/display/identityLabel"
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Highlighter, Trash2, Check, CircleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { postForm } from "@/lib/api/client"
import type { Snapshot } from "@/lib/api/types"
import { evidenceOrdinalLabel } from "@/lib/display/operationLabel"
import { apiColors, apiConfirmed, apiOperation } from "./apiAppearance"

type Targets = { operations?: readonly string[]; evidenceIds?: readonly string[] }
type Change = Targets & { action: "highlight" | "register" | "unregister" | "preview-delete" | "delete"; color?: string; expectedEvidenceIds?: readonly string[] }
interface Preview { operations: readonly string[]; evidenceIds: readonly string[]; records: number; reviews: number; declarations: number; revision?: number; datasetRevision?: number; apiMarks?: Snapshot["apiMarks"] }
function useApiAction(snapshot: Snapshot) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (change: Change) => postForm<Preview>("/api/api-management", { change: JSON.stringify({ ...change, datasetRevision: snapshot.datasetRevision ?? snapshot.identityRevision, revision: snapshot.revision }) }),
    onSuccess: async (result, change) => {
      if (change.action === "preview-delete") return
      if (result.apiMarks && result.revision !== undefined && result.datasetRevision !== undefined) {
        await client.cancelQueries({ queryKey: ["snapshot"] })
        let updated = false
        client.setQueryData<Snapshot>(["snapshot"], current => {
          if (!current || current.revision !== snapshot.revision || (current.datasetRevision ?? current.identityRevision) !== result.datasetRevision) return current
          updated = true
          return { ...current, revision: result.revision!, apiMarks: result.apiMarks }
        })
        if (updated) return
      }
      // A removed record must disappear from cached raw HTTP pages as well as the snapshot.
      if (change.action === "delete") {
        await client.cancelQueries({ queryKey: ["evidence"] })
        client.removeQueries({ queryKey: ["evidence"] })
      }
      await client.invalidateQueries({ queryKey: ["snapshot"] })
    },
  })
}
function ActionError({ error }: { error: Error | null }) {
  return error && <p role="alert" className="text-xs text-destructive">{error.message}</p>
}
export function DeleteTrafficButton({ snapshot, operations, evidenceIds, label = "API 삭제", iconOnly = false, disabled = false, className = "", onDeleted }: Targets & { snapshot: Snapshot; label?: string; iconOnly?: boolean; disabled?: boolean; className?: string; onDeleted?(): void }) {
  const action = useApiAction(snapshot)
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewRevision, setPreviewRevision] = useState(-1)
  const [previewScope, setPreviewScope] = useState("")
  const scope = JSON.stringify([snapshot.datasetRevision ?? snapshot.identityRevision, operations ?? [], evidenceIds ?? []])
  const stale = previewRevision !== snapshot.revision || previewScope !== scope
  const prepare = () => {
    setPreview(null); action.reset()
    action.mutate({ action: "preview-delete", operations, evidenceIds }, { onSuccess: value => { setPreview(value); setPreviewRevision(snapshot.revision); setPreviewScope(scope) } })
  }
  return <Dialog open={open} onOpenChange={value => { if (action.isPending) return; setOpen(value); if (value) prepare() }}>
    <Button type="button" variant="outline" size={iconOnly ? "icon" : "sm"} aria-label={label} title={label} disabled={disabled} onClick={() => { setOpen(true); prepare() }} className={`${iconOnly ? "size-9" : ""} ${className}`}><Trash2 className={iconOnly ? "size-5" : "size-4"} strokeWidth={2.25} />{!iconOnly && label}</Button>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{operations?.length ? "API와 연결 기록을 삭제할까요?" : "선택한 요청 기록을 삭제할까요?"}</DialogTitle><DialogDescription>{operations?.length ? "선택 API의 요청·응답, 선언 근거, 하이라이트와 관련 취약점 등록을 삭제합니다." : "선택 기록의 요청·응답과 연결된 재현 기록, 관련 판정을 삭제합니다."} 프로젝트에 저장되며 되돌릴 수 없습니다.</DialogDescription></DialogHeader>
      {action.isPending && !preview && <p className="text-sm" role="status">삭제 범위를 확인하는 중…</p>}
      {preview && <dl className="grid grid-cols-3 divide-x rounded-lg border bg-muted/30 py-3 text-center">{[["요청 기록", preview.records], ["관련 판정", preview.reviews], ["API", preview.declarations]].map(([label, count]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{count}</dd></div>)}</dl>}
      {preview && stale && <p role="status" className="text-xs text-muted-foreground">데이터가 변경되었습니다. 삭제 범위를 다시 확인해 주세요.</p>}
      <ActionError error={action.error} />
      <DialogFooter><Button variant="outline" disabled={action.isPending} onClick={() => setOpen(false)}>취소</Button>{!preview || stale || action.isError ? <Button variant="outline" disabled={action.isPending} onClick={prepare}>범위 다시 확인</Button> : <Button variant="destructive" disabled={action.isPending} onClick={() => action.mutate({ action: "delete", operations, evidenceIds, expectedEvidenceIds: preview.evidenceIds }, { onSuccess: () => { setOpen(false); onDeleted?.() } })}>{action.isPending ? "삭제 중…" : "영구 삭제"}</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>
}
export function ApiActions({ snapshot, operation, operations, disabled = false }: { snapshot: Snapshot; operation?: string; operations?: readonly string[]; disabled?: boolean }) {
  const targets = [...new Set((operations ?? (operation ? [operation] : [])).map(apiOperation))]
  const [selected, setSelected] = useState("")
  const current = targets.includes(selected) ? selected : targets[0]
  if (!current) return null
  return <div className="flex flex-wrap items-center justify-end gap-2">
    {targets.length > 1 && <select aria-label="조작할 API" value={current} disabled={disabled} onChange={event => setSelected(event.target.value)} className="h-9 max-w-64 rounded-md border border-border bg-background px-2 text-xs" title={current}>{targets.map(op => <option key={op} value={op}>{op}</option>)}</select>}
    <SingleApiActions key={current} snapshot={snapshot} operation={current} disabled={disabled} />
  </div>
}
function SingleApiActions({ snapshot, operation, disabled = false }: { snapshot: Snapshot; operation: string; disabled?: boolean }) {
  const op = apiOperation(operation), action = useApiAction(snapshot)
  const selectedColor = snapshot.apiMarks?.[op]?.color ?? ""
  const scope = JSON.stringify([snapshot.datasetRevision ?? snapshot.identityRevision, op])
  return <div className="flex items-center gap-1">
    <Popover><PopoverTrigger asChild><Button size="icon" variant="outline" className="size-9" aria-label="API 하이라이트" title="API 하이라이트" disabled={disabled}><Highlighter className="size-5" strokeWidth={2.25} style={{ color: apiColors.find(color => color.id === selectedColor)?.swatch }} /></Button></PopoverTrigger><PopoverContent align="end" className="w-60 p-3" aria-label="하이라이트 색상">
      <h3 className="text-sm font-semibold">API 하이라이트</h3><p className="my-2 text-xs text-muted-foreground">그래프와 API 비교에 함께 적용합니다.</p>
      <div className="grid grid-cols-4 gap-2">{apiColors.map(color => <button key={color.id} type="button" aria-label={`${color.label} 하이라이트`} aria-pressed={selectedColor === color.id} disabled={action.isPending} className="flex h-9 items-center justify-center rounded-md border border-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50" style={{ backgroundColor: color.swatch }} onClick={() => action.mutate({ action: "highlight", operations: [op], color: color.id })}>{selectedColor === color.id && <Check className="size-4 text-black" />}</button>)}</div>
      <Button size="sm" variant="ghost" className="mt-2 w-full" disabled={action.isPending || !selectedColor} onClick={() => action.mutate({ action: "highlight", operations: [op], color: "" })}>하이라이트 해제</Button><ActionError error={action.error} />
    </PopoverContent></Popover>
    <ApiRegistration key={"register:" + scope} snapshot={snapshot} operation={op} disabled={disabled} />
    <DeleteTrafficButton key={"delete:" + scope} snapshot={snapshot} operations={[op]} iconOnly disabled={disabled} />
  </div>
}
function ApiRegistration({ snapshot, operation, disabled = false }: { snapshot: Snapshot; operation: string; disabled?: boolean }) {
  const op = apiOperation(operation), action = useApiAction(snapshot)
  const mark = snapshot.apiMarks?.[op]
  const confirmed = apiConfirmed(snapshot, op)
  const [open, setOpen] = useState(false), [ids, setIds] = useState<string[]>([])
  const events = snapshot.events.filter(event => apiOperation(event.op) === op && event.status > 0)
  const label = mark?.registered ? "표시 해제" : "취약점으로 표시"
  const status = confirmed ? "확정됨" : "표시 없음"
  const detail = mark?.registered ? `내가 등록한 요청 기록 ${mark.evidenceIds.length}건` : confirmed ? "판정 매트릭스에서 확정된 항목이 있습니다." : "확인한 요청 기록을 골라 등록합니다."
  return <Dialog open={open} onOpenChange={setOpen}>
      <Button size="icon" variant="outline" className={`size-9 ${confirmed ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" : ""}`} aria-label={label} title={`${status} · ${detail}`} disabled={disabled || action.isPending || (!mark?.registered && events.length === 0)} onClick={() => { action.reset(); setIds([]); setOpen(true) }}><CircleAlert className="size-5" strokeWidth={2.25} /><span className="sr-only">{status}</span></Button>
      <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{mark?.registered ? "사용자 취약점 등록을 해제할까요?" : "취약점 근거로 쓸 요청 기록 선택"}</DialogTitle><DialogDescription>{mark?.registered ? "직접 등록한 표시를 해제합니다. 판정 매트릭스의 별도 확정은 해당 판정에서 변경합니다." : "직접 확인한 요청·응답을 선택하세요. 응답 코드만으로 취약점을 판정하지 않습니다. 최대 20건을 저장합니다."}</DialogDescription></DialogHeader>
        {!mark?.registered && <div className="max-h-72 overflow-y-auto rounded-md border">{events.map(event => <label key={event.eventId} className="flex cursor-pointer items-center gap-3 border-b px-3 py-3 text-xs last:border-b-0 hover:bg-muted/40"><Checkbox aria-label={`${evidenceOrdinalLabel(snapshot.evidenceOrdinals, event.eventId)} 요청 기록 선택`} checked={ids.includes(event.eventId)} disabled={!ids.includes(event.eventId) && ids.length >= 20} onCheckedChange={checked => setIds(current => checked ? [...current, event.eventId] : current.filter(id => id !== event.eventId))} /><span className="font-mono">{evidenceOrdinalLabel(snapshot.evidenceOrdinals, event.eventId)}</span><span className="min-w-0 flex-1 truncate">{identityLabel(event.idn)} · {event.source.toUpperCase()}</span><span>HTTP {event.status}</span></label>)}</div>}
        <ActionError error={action.error} /><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>취소</Button><Button disabled={action.isPending || (!mark?.registered && ids.length === 0)} onClick={() => action.mutate({ action: mark?.registered ? "unregister" : "register", operations: [op], evidenceIds: ids }, { onSuccess: () => setOpen(false) })}>{action.isPending ? "저장 중…" : mark?.registered ? "표시 해제" : `${ids.length}건 근거로 표시`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
}
