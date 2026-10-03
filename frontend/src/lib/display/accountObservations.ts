import type { EventRecord } from "@/lib/api/types"

const sources = ["human", "scanner", "llm"] as const
type CollectionSource = typeof sources[number]
export interface AccountObservations {
  counts: Record<CollectionSource, number>
  last: Record<CollectionSource, number>
}

/** Each stored response counts once; repeatCount and orchestrator do not affect totals. */
export function accountObservations(events: readonly EventRecord[], accountIds: readonly string[]): Map<string, AccountObservations> {
  const totals = new Map(accountIds.map((id) => [id, { counts: { human: 0, scanner: 0, llm: 0 }, last: { human: 0, scanner: 0, llm: 0 } }]))
  for (const event of events) {
    if (!sources.includes(event.source as CollectionSource) || !Number.isFinite(event.status) || event.status < 100 || event.status > 599) continue
    const row = totals.get(event.laneAccountId?.trim() || event.idn)
    if (!row) continue
    const source = event.source as CollectionSource
    row.counts[source] += 1
    row.last[source] = Math.max(row.last[source], event.timestamp)
  }
  return totals
}
