import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EvidenceActionList } from "@/features/evidence/EvidenceActionList"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { stripOrigin } from "@/lib/display/operationLabel"
import { locationLabel } from "./parameterNodeCard"
import { validationCellId, type ParameterGraphProjection } from "./parameterProjection"

interface Props { snapshot: Snapshot; projection: ParameterGraphProjection; suspended?: boolean; onClose(): void }

/** 선택 Gap 상세. 데이터셋 교체(datasetRevision)나 다른 Gap 선택은 열린 초안·선택 셀을 버린다(D-140). */
export function ParameterGapInspector(props: Props) {
  const datasetRevision = props.snapshot.datasetRevision ?? props.snapshot.identityRevision ?? 0
  return <InspectorBody key={JSON.stringify([datasetRevision, props.projection.selection?.gapId, props.projection.parameterKey?.stableKey])} {...props} />
}

function InspectorBody({ snapshot, projection, suspended = false, onClose }: Props) {
  const gap = projection.queue.find(item => item.id === projection.selection?.gapId)
  const key = projection.parameterKey
  const parameter = projection.parameter
  // Graph links are previews (PR#11): resolve only projection-approved cells at the exact key, but keep every
  // currently available snapshot witness so the list can reach all of them.
  const approvedCells = new Set(projection.validationCells.map(item => item.id))
  const cells = (snapshot.surface?.validationCells ?? []).map(item => ({ ...item, id: validationCellId(item) })).filter(item => approvedCells.has(item.id))
  const actualIds = new Set([...(parameter?.observationEvidenceIds ?? []), ...cells.flatMap(item => item.evidenceIds)])
  const basisIds = new Set([...cells.flatMap(item => item.basisEvidenceIds), ...(parameter?.declarations.map(item => item.evidenceId) ?? [])])
  // Basis-only links do not become executable witnesses merely because an EventRecord shares their ID.
  const linkedIds = new Set([...actualIds, ...(gap?.evidenceIds ?? []).filter(id => !basisIds.has(id))])
  const eventById = new Map<string, EventRecord>()
  for (const event of snapshot.events) {
    if (linkedIds.has(event.eventId) && event.op === key?.operation && event.method === key?.method && !eventById.has(event.eventId)) eventById.set(event.eventId, event)
  }
  if (!gap || !projection.selection || !key) return null
  return <section aria-label="Parameter Gap 상세" data-gap-id={gap.id} className="min-w-0 space-y-4 p-4 text-sm [overflow-wrap:anywhere]">
    <header className="flex items-start justify-between gap-2">
      <div className="min-w-0"><h2 className="break-all font-mono font-semibold">{key.method} {stripOrigin(key.pathTemplate) || key.pathTemplate}</h2><p className="text-muted-foreground">{locationLabel(key.location)} {stripOrigin(parameter?.fieldPath ?? key.canonicalPath) || key.canonicalPath} · {gap.identity ?? "UNKNOWN"}</p></div>
      <Button variant="ghost" size="icon-sm" aria-label="선택 상세 닫기" onClick={onClose}><X /></Button>
    </header>
    <EvidenceActionList events={[...eventById.values()]} snapshot={snapshot} disabled={suspended} />
  </section>
}
