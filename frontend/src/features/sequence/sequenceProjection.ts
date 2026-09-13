import type { FlowLink, Snapshot } from "@/lib/api/types"

export interface SequenceLink {
  key: string
  link: FlowLink
  index: number
}

export interface SequenceGroup {
  key: string
  identity: string
  links: readonly SequenceLink[]
}

export interface SequenceProjection {
  groups: readonly SequenceGroup[]
}

function validTimestamp(value: number) { return Number.isFinite(value) && value > 0 }

export function sequenceLinkKey(link: FlowLink, occurrence: number) {
  return JSON.stringify([link.fromEventId, link.toEventId, link.fromOp, link.toOp, link.idn, link.source, link.values, occurrence])
}

export function projectSequence(snapshot: Snapshot): SequenceProjection {
  const timestamps = new Map(snapshot.events.map((event) => [event.eventId, event.timestamp]))
  const groups = new Map<string, SequenceLink[]>()
  const occurrences = new Map<string, number>()
  snapshot.flowLinks.forEach((link, index) => {
    if (!timestamps.has(link.fromEventId) || !timestamps.has(link.toEventId)) return
    const signature = sequenceLinkKey(link, 0)
    const occurrence = occurrences.get(signature) ?? 0
    occurrences.set(signature, occurrence + 1)
    const entries = groups.get(link.idn) ?? []
    entries.push({ key: sequenceLinkKey(link, occurrence), link, index })
    groups.set(link.idn, entries)
  })
  return {
    groups: [...groups.entries()].map(([identity, links]) => ({
      key: JSON.stringify([identity]),
      identity,
      links: [...links].sort((left, right) => {
        const leftTime = timestamps.get(left.link.fromEventId) ?? 0
        const rightTime = timestamps.get(right.link.fromEventId) ?? 0
        const leftKnown = validTimestamp(leftTime)
        const rightKnown = validTimestamp(rightTime)
        if (leftKnown && rightKnown) return leftTime === rightTime ? left.index - right.index : leftTime - rightTime
        if (leftKnown) return -1
        if (rightKnown) return 1
        return left.index - right.index
      }),
    })),
  }
}
