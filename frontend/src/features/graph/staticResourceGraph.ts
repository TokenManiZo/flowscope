import type { EventRecord, Snapshot } from "@/lib/api/types"
import { pathShape } from "./graphPathShape"
import { graphAccountLabel } from "./graphAccounts"
import { graphCellSelection, sourceStyles, verdictStyles, wrapOperationLabel, type GraphFilters } from "./graphProjection"
import { isGraphObservation, type ApiGroupDescriptor, type GraphNavigation, type GraphReveal, type HierarchyEdge, type HierarchyNode, type HierarchySelection } from "./graphHierarchy"
import { MAX_VISIBLE_OBJECTS } from "./observedObjects"

export interface StaticResourceEntry {
  event: EventRecord
  service: string
  apiPath: string
  apiId: string
  apiLabel: string
  familyId: string
  familyLabel: string
  groupKey: string
  objectKey: string
}

/** No extension heuristics here: the backend owns STATIC_ASSET classification.
 * Raw target, service and method identify the observed file. Identity/source only add evidence.
 * Directory templates are display groups, never claims that routes or objects are equivalent. */
export function staticResourceEntries(snapshot: Snapshot, filters: GraphFilters): StaticResourceEntry[] {
  if (!filters.includeSupportTraffic) return []
  return snapshot.events.flatMap(event => {
    if (event.trafficClass !== "STATIC_ASSET" || !isGraphObservation(event, true)
      || !filters.source.includes(event.source) || filters.identity.length && !filters.identity.includes(event.idn)) return []
    const service = event.op.match(/^(https?:\/\/\S+)\s+/i)?.[1] ?? "Target"
    // Cut query/fragment before splitting; do not decode encoded slashes into route separators.
    const rawPath = event.path.split(/[?#]/, 1)[0].replace(/^https?:\/\/[^/]*(?=\/|$)/i, "") || "/"
    const slash = rawPath.lastIndexOf("/")
    const apiPath = rawPath.endsWith("/") ? rawPath : `${rawPath.slice(0, slash + 1)}{file}`
    const method = event.method.toUpperCase()
    const apiId = `static-api:${JSON.stringify([service, method, apiPath])}`
    const familyPath = pathShape(apiPath)
    const familyId = `static-family:${JSON.stringify([service, method, familyPath])}`
    return [{ event, service, apiPath, apiId, apiLabel: `${service} ${method} ${apiPath}`,
      familyId, familyLabel: `${service} ${method} ${familyPath}`,
      groupKey: `static-objects:${apiId}`, objectKey: `static-object:${JSON.stringify([service, method, event.path])}` }]
  })
}

/** Display only the filename extension; never use it to classify or merge resources. */
export function staticResourceExtension(target: string): string {
  const path = target.split(/[?#]/, 1)[0]
  let filename = path.slice(path.lastIndexOf("/") + 1)
  try { filename = decodeURIComponent(filename) } catch { /* Keep malformed encoding as captured. */ }
  if (filename.includes("/") || filename.includes("\\")) return "확장자 없음"
  const extension = filename.match(/[^.](\.[a-z0-9]+(?:\.(?:gz|br|zst))?)$/i)?.[1]
  return extension?.toLowerCase() ?? "확장자 없음"
}

const compare = (a: string, b: string) => a.localeCompare(b, "en")
const by = <T,>(items: readonly T[], key: (item: T) => string) => {
  const groups = new Map<string, T[]>()
  for (const item of items) { const id = key(item); const bucket = groups.get(id) ?? []; bucket.push(item); groups.set(id, bucket) }
  return groups
}

/** Adds only graph nodes with empty judgment coordinates. Existing matrix/objects remain untouched. */
export function applyStaticResources(snapshot: Snapshot, all: readonly StaticResourceEntry[], filters: GraphFilters, nav: GraphNavigation,
  resolve: (service: string, path: string) => ApiGroupDescriptor, nodes: HierarchyNode[], edges: HierarchyEdge[], list: HierarchyNode[], reveal: GraphReveal): number {
  if (nav.level !== "group") return 0
  const entries = all.filter(entry => resolve(entry.service, entry.apiPath).id === nav.groupId)
  const select = (items: readonly StaticResourceEntry[], extra: Partial<HierarchySelection> = {}): HierarchySelection => {
    const operations = new Set(items.map(item => item.event.op))
    return { ...graphCellSelection([]), gapIds: [], operation: operations.size === 1 ? [...operations][0] : null,
      // Clusters may span other raw targets. Each resource must retain only its own records.
      evidenceIds: [...new Set(items.map(item => item.event.eventId))].sort(compare), ...extra }
  }
  const node = (kind: HierarchyNode["kind"], key: string, label: string, items: readonly StaticResourceEntry[], extra: Partial<HierarchyNode> = {}) => {
    const made: HierarchyNode = { id: `${kind}:${key}`, kind, label, wrappedLabel: kind === "operation" || kind === "operation-group" ? wrapOperationLabel(label) : label,
      verdict: "unknown", verdictText: verdictStyles.unknown.text, verdictColor: verdictStyles.unknown.color,
      selection: select(items), staticResource: true, ...extra }
    nodes.push(made); return made
  }
  const edge = (from: string, to: string, items: readonly StaticResourceEntry[], relation: HierarchyEdge["relation"]) => {
    for (const bucket of by(items, item => JSON.stringify([item.event.idn, item.event.source])).values()) {
      const { idn, source } = bucket[0].event
      const count = new Set(bucket.map(item => item.event.eventId)).size
      edges.push({ id: JSON.stringify(["static", from, to, idn, source]), sourceId: from, targetId: to, relation, source, structural: false,
        ...sourceStyles[source], count, countLabel: count > 1 ? `×${count}` : "", selection: select(bucket, { identity: idn, source }) })
    }
  }
  const access = (target: HierarchyNode, items: readonly StaticResourceEntry[]) => {
    for (const [identity, bucket] of by(items, item => item.event.idn)) {
      const id = `identity:${identity}`
      if (!nodes.some(item => item.id === id)) node("identity", identity, graphAccountLabel(snapshot, identity), bucket, { staticResource: false, selection: select(bucket, { identity }) })
      edge(id, target.id, bucket, "identity-operation")
    }
  }
  const open = new Set(filters.expandedObjectGroups ?? [])
  const families = [...by(entries, entry => entry.familyId)].sort((a, b) => compare(a[0], b[0]))
  const visible = families.filter(([, items], i) => i < nav.operationLimit || items.some(item => reveal.staticApiId === item.apiId || reveal.resource === item.objectKey))
  let hidden = families.length - visible.length
  let shown = nodes.filter(node => node.kind === "resource" && !node.hiddenInGraph).length
  for (const [familyId, items] of visible) {
    const apis = [...by(items, item => item.apiId)].sort((a, b) => compare(a[0], b[0]))
    const familyNodeId = `operation-group:${familyId}`
    const expanded = open.has(familyNodeId)
    if (nav.level === "group") {
      const family = node("operation-group", familyId, items[0].familyLabel, items, {
        objectGroup: { key: items[0].familyLabel, members: apis.map(([key]) => key), owners: {}, expanded },
        displayOperations: [...new Set(items.map(item => item.event.op))],
      })
      list.push(family)
      if (!expanded) {
        access(family, items)
        const summary = node("object-group", `static-family-objects:${familyId}`, "정적 자원", items, {
          expandGroupId: familyNodeId,
          objectGroup: { key: "정적 자원", members: [...new Set(items.map(item => item.objectKey))], owners: {}, expanded: false },
        })
        edge(family.id, summary.id, items, "operation-resource")
        continue
      }
    }
    const visibleApis = apis.filter(([id, observations], i) => i < nav.operationLimit || reveal.staticApiId === id || observations.some(item => reveal.resource === item.objectKey))
    hidden += apis.length - visibleApis.length
    for (const [apiId, observations] of visibleApis) {
      const first = observations[0]
      const api = node("operation", apiId, first.apiLabel, observations, {
        expandGroupId: `object-group:${first.groupKey}`,
        displayOperations: [...new Set(observations.map(item => item.event.op))].sort(compare), selection: select(observations, { displayApiKey: apiId }),
      })
      list.push(api); access(api, observations)
      const objects = [...by(observations, item => item.objectKey)].sort((a, b) => compare(a[0], b[0]))
      const groupId = `object-group:${first.groupKey}`
      const expanded = open.has(groupId)
      const group = node("object-group", first.groupKey, "정적 자원", observations, {
        layoutAnchorId: `object-group:static-family-objects:${familyId}`,
        selection: select(observations, { displayApiKey: apiId }),
        objectGroup: { key: "정적 자원", members: objects.map(([key]) => key), owners: {}, expanded },
      })
      edge(api.id, group.id, observations, "operation-resource")
      for (const [i, [key, records]] of objects.entries()) {
        if (i >= MAX_VISIBLE_OBJECTS || shown >= MAX_VISIBLE_OBJECTS || !expanded && reveal.resource !== key) continue
        shown++
        const resource = node("resource", key, staticResourceExtension(records[0].event.path), records, {
          selection: select(records, { displayApiKey: apiId, displayObjectKey: key }),
        })
        edge(api.id, resource.id, records, "operation-resource")
        list.push(resource)
      }
    }
  }
  return hidden
}
