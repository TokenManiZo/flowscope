import type { Cell, EventRecord, Snapshot } from "@/lib/api/types"
import { graphCellKey } from "./graphProjection"
import { identityLabel } from "@/lib/display/identityLabel"

/** Collection cards are display coordinates, never a replacement for authentication evidence. */
export function collectionIdentity(event: EventRecord): string {
  return event.collectionAccountId ?? event.laneAccountId ?? event.idn
}

export function graphAccountLabel(snapshot: Pick<Snapshot, "accounts">, identity: string): string {
  return identityLabel(identity, snapshot.accounts.find(account => account.id === identity)?.label ?? identity)
}

export type CollectionCell = Cell & { observedIdentity?: string }

/** A graph-local copy. Keep verdicts and canonical server cell keys; split only display membership. */
export function collectionGraphSnapshot(snapshot: Snapshot): Snapshot {
  const identities = new Map<string, string>()
  const sources = new Map(snapshot.events.map(event => [event.eventId, event.source]))
  const events = snapshot.events.map(event => {
    const idn = collectionIdentity(event)
    // Cluster siblings have their own card assignments; do not infer them from the representative.
    identities.set(event.eventId, idn)
    return idn === event.idn ? event : { ...event, idn }
  })
  const cells = snapshot.cells.flatMap(cell => {
    const groups = new Map<string, string[]>()
    for (const id of cell.evidenceIds) {
      const identity = identities.get(id) ?? cell.idn
      const ids = groups.get(identity) ?? []
      ids.push(id)
      groups.set(identity, ids)
    }
    if (!groups.size) return [cell]
    return [...groups].map(([idn, evidenceIds]): CollectionCell => {
      if (idn === cell.idn && groups.size === 1) return cell
      const memberSources = new Set(evidenceIds.map(id => sources.get(id)))
      // Keep the server's decisions; only omit sources known to belong to a different card.
      const perSource = groups.size > 1 && !memberSources.has(undefined)
        ? Object.fromEntries(Object.entries(cell.perSource).filter(([source]) => memberSources.has(source as EventRecord["source"])))
        : cell.perSource
      return { ...cell, idn, observedIdentity: cell.idn, evidenceIds, perSource }
    })
  })
  const cardsByCell = new Map<string, Set<string>>()
  for (const cell of cells) {
    const key = graphCellKey(cell)
    const cards = cardsByCell.get(key) ?? new Set<string>()
    cards.add(cell.idn)
    cardsByCell.set(key, cards)
  }
  const gaps = snapshot.gaps.flatMap(gap => {
    const cards = cardsByCell.get(graphCellKey(gap))
    return cards ? [...cards].map(idn => idn === gap.idn ? gap : { ...gap, idn, observedIdentity: gap.idn }) : [gap]
  })
  return { ...snapshot, events, cells, gaps }
}
