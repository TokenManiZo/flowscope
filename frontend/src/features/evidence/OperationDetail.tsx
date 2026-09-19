import type { EventRecord, Snapshot } from "@/lib/api/types"
import { TrafficWorkspace } from "./TrafficWorkspace"

/** Single-exchange entry point retained for the surface workspace. */
export function OperationDetail({ event, snapshot, disabled = false }: {
  event: EventRecord
  snapshot: Snapshot
  disabled?: boolean
}) {
  return <TrafficWorkspace snapshot={snapshot} evidenceIds={[event.eventId]} initialEvent={event} target={{ operation: event.op, resource: event.resource }} disabled={disabled} />
}
