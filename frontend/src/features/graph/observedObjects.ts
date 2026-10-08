import type { DisplayObject, EventRecord, Snapshot, Source } from "@/lib/api/types"
import { graphAccountLabel } from "./graphAccounts"
import { graphCellKey, graphCellSelection, sourceStyles, verdictStyles, wrapOperationLabel, type GraphFilters } from "./graphProjection"
import { isObservedTraffic, type HierarchyEdge, type HierarchyNode, type HierarchySelection, type GraphNavigation, type GraphReveal } from "./graphHierarchy"

export const MAX_VISIBLE_OBJECTS = 10

export interface ObjectEntry { object: DisplayObject; event: EventRecord }
export function observedObjectEntries(snapshot: Snapshot, filters: GraphFilters): readonly ObjectEntry[] {
  const events = new Map(snapshot.events.map(event => [event.eventId, event]))
  const judged = new Set(snapshot.cells.filter(cell => !filters.reviewStates || filters.reviewStates.includes(cell.overall)).flatMap(cell => cell.evidenceIds))
  return (snapshot.displayObjects ?? []).flatMap(object => {
    const event = events.get(object.eventId)
    if (!event || !isObservedTraffic(event) || !filters.source.includes(event.source) || filters.identity.length && !filters.identity.includes(event.idn)) return []
    if (!filters.includeSupportTraffic && ![event.eventId, ...(event.clusterEvidenceIds ?? [])].some(id => judged.has(id))) return []
    return [{ object, event }]
  })
}

/** Mutates only the display graph, never the snapshot's canonical cells or request coordinates. */
export function applyObservedObjects(snapshot: Snapshot, filters: GraphFilters, navigation: GraphNavigation,
  nodes: HierarchyNode[], edges: HierarchyEdge[], list: HierarchyNode[], reveal: GraphReveal): number {
  if (snapshot.displayObjects === undefined || navigation.level === "site") return 0
  const visibleOps = new Set(nodes.filter(node => ["operation", "observed-operation"].includes(node.kind)).map(node => node.selection.operation).filter(Boolean))
  const all = observedObjectEntries(snapshot, filters)
  const apis = new Set(all.filter(entry => visibleOps.has(entry.object.operation) || entry.object.operation === navigation.operation).map(entry => entry.object.apiKey))
  const entries = all.filter(entry => apis.has(entry.object.apiKey))
  const replaced = new Set(entries.map(entry => entry.object.operation))
  const removed = new Set(nodes.filter(node => node.kind === "resource" || node.kind === "object-group"
    || ["operation", "observed-operation"].includes(node.kind) && replaced.has(node.selection.operation ?? "")
    || node.kind === "operation-group" && node.objectGroup?.members.some(op => replaced.has(op))).map(node => node.id))
  for (let i = nodes.length - 1; i >= 0; i--) if (removed.has(nodes[i].id)) nodes.splice(i, 1)
  for (let i = edges.length - 1; i >= 0; i--) if (removed.has(edges[i].sourceId) || removed.has(edges[i].targetId)) edges.splice(i, 1)
  for (let i = list.length - 1; i >= 0; i--) if (removed.has(list[i].id) || list[i].selection.resource) list.splice(i, 1)
  const select = (items: readonly ObjectEntry[], source: Source | null = null, isObject = false): HierarchySelection => {
    const ids = new Set(items.map(item => item.event.eventId))
    const resources = new Set(items.map(item => item.object.legacyResource))
    const legacy = isObject && resources.size === 1 ? [...resources][0] : null
    const cells = snapshot.cells.filter(cell => cell.evidenceIds.some(id => ids.has(id)) && (!isObject || legacy !== null && cell.resource === legacy))
    const ops = new Set(items.map(item => item.object.operation)), identities = new Set(items.map(item => item.event.idn))
    return { ...graphCellSelection(cells, source), operation: ops.size === 1 ? [...ops][0] : null, resource: legacy,
      identity: identities.size === 1 ? [...identities][0] : null, source, evidenceIds: [...ids], gapIds: [] }
  }
  const node = (kind: HierarchyNode["kind"], key: string, label: string, selection: HierarchySelection, extra: Partial<HierarchyNode> = {}) => {
    const verdict = selection.cells.length ? selection.cells.reduce((chosen, cell) => ["suspicious", "undecided", "deny", "untested", "allow"].indexOf(cell.overall) < ["suspicious", "undecided", "deny", "untested", "allow"].indexOf(chosen) ? cell.overall : chosen, selection.cells[0].overall) : "unknown"
    const made: HierarchyNode = { id: `${kind}:${key}`, kind, label, wrappedLabel: kind === "operation" ? wrapOperationLabel(label) : label,
      selection, verdict, verdictText: verdictStyles[verdict].text, verdictColor: verdictStyles[verdict].color, ...extra }
    nodes.push(made); return made
  }
  const edge = (relation: HierarchyEdge["relation"], from: string, to: string, items: readonly ObjectEntry[], isObject = false) => {
    const buckets = new Map<string, ObjectEntry[]>()
    for (const item of items) {
      const key = JSON.stringify([item.event.source, item.event.idn])
      const bucket = buckets.get(key) ?? []; bucket.push(item); buckets.set(key, bucket)
    }
    for (const bucket of buckets.values()) {
      const source = bucket[0].event.source, selection = select(bucket, source, isObject)
      const count = new Set(bucket.map(item => item.event.eventId)).size
      edges.push({ id: JSON.stringify(["display", relation, from, to, source, selection.identity]), relation, sourceId: from, targetId: to,
        source, structural: false, ...sourceStyles[source], count, countLabel: count > 1 ? `×${count}` : "", selection })
    }
  }
  const byApi = new Map<string, ObjectEntry[]>()
  for (const entry of entries) {
    const bucket = byApi.get(entry.object.apiKey) ?? []; bucket.push(entry); byApi.set(entry.object.apiKey, bucket)
  }
  const familyByApi = new Map<string, string>()
  const familyItems = new Map<string, ObjectEntry[]>()
  for (const [api, items] of byApi) {
    const family = items.find(item => item.object.apiFamily)?.object.apiFamily
    if (!family) continue
    familyByApi.set(api, family)
    const bucket = familyItems.get(family) ?? []; bucket.push(...items); familyItems.set(family, bucket)
  }
  const closedFamilies = new Set<string>()
  if (navigation.level === "group") for (const [family, items] of familyItems) {
    const expanded = (filters.expandedObjectGroups ?? []).includes(`operation-group:${family}`)
    const apis = [...new Set(items.map(item => item.object.apiKey))]
    const group = node("operation-group", family, family, { ...select(items), displayApiKey: family }, {
      objectGroup: { key: family, members: apis, owners: {}, expanded },
      displayOperations: [...new Set(items.map(item => item.object.operation))],
    })
    if (!expanded) {
      closedFamilies.add(family)
      list.push(group)
      for (const identity of new Set(items.map(item => item.event.idn))) {
        if (!nodes.some(n => n.id === `identity:${identity}`)) node("identity", identity, graphAccountLabel(snapshot, identity), { ...select(items.filter(item => item.event.idn === identity)), identity })
        edge("identity-operation", `identity:${identity}`, group.id, items.filter(item => item.event.idn === identity))
      }
    }
  }
  let visibleObjects = 0
  for (const [api, items] of byApi) {
    const family = familyByApi.get(api)
    if (family && closedFamilies.has(family)) continue
    const operations = [...new Set(items.map(item => item.object.operation))].sort()
    const apiNode = node("operation", family ? api : operations[0], api, { ...select(items), displayApiKey: api }, { displayOperations: operations, displayObjectCount: new Set(items.map(item => item.object.objectKey)).size })
    if (navigation.level === "group") list.push(apiNode)
    for (const identity of new Set(items.map(item => item.event.idn))) {
      if (!nodes.some(n => n.id === `identity:${identity}`)) node("identity", identity, graphAccountLabel(snapshot, identity), { ...select(items.filter(item => item.event.idn === identity)), identity })
      edge("identity-operation", `identity:${identity}`, apiNode.id, items.filter(item => item.event.idn === identity))
    }
    const groups = new Map<string, ObjectEntry[]>()
    for (const item of items) {
      const bucket = groups.get(item.object.groupKey) ?? []; bucket.push(item); groups.set(item.object.groupKey, bucket)
    }
    for (const [groupKey, members] of groups) {
      const objects = new Map<string, ObjectEntry[]>()
      for (const item of members) {
        const bucket = objects.get(item.object.objectKey) ?? []; bucket.push(item); objects.set(item.object.objectKey, bucket)
      }
      const first = members[0].object, expanded = (filters.expandedObjectGroups ?? []).includes(`object-group:${groupKey}`)
      const label = first.kind === "PATH" ? (family ? family.match(/\{id_\d+\}/g)?.at(-1)?.slice(1, -1) ?? "id" : "id") : first.kind === "RESPONSE_BODY" ? "OBJ" : [...new Set(first.fields.map(field => field.replace(/^\//, "").replace(/\//g, ".")))].join(" · ") || "OBJ"
      const groupNode = node("object-group", groupKey, label, { ...select(members), displayApiKey: api }, { displayObjectKind: first.kind, objectGroup: { key: label, members: [...objects.keys()], owners: {}, expanded } })
      edge("operation-resource", apiNode.id, groupNode.id, members)
      let shown = 0
      for (const [key, observations] of [...objects].sort((a, b) => a[1][0].object.ordinal - b[1][0].object.ordinal)) {
        const forced = reveal.resource === key
        if (shown++ >= MAX_VISIBLE_OBJECTS) continue
        if (!expanded && !forced) continue
        if (visibleObjects >= MAX_VISIBLE_OBJECTS) continue
        visibleObjects++
        const selection = { ...select(observations, null, true), displayObjectKey: key, displayApiKey: api }
        const owner = selection.resource ? snapshot.owners[selection.resource] : null
        const label = `OBJ ${observations[0].object.ordinal}${owner ? ` - ${graphAccountLabel(snapshot, owner)}` : ""}`
        const objectNode = node("resource", key, label, selection, { owner, displayObjectKind: first.kind })
        edge("operation-resource", apiNode.id, objectNode.id, observations, true)
        if (navigation.level === "operation") list.push(objectNode)
      }
    }
  }
  return 0
}
