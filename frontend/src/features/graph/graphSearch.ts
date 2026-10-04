import type { Cell } from "@/lib/api/types"
import { objectGroupKey, operationGroup, navigateHierarchy, type GraphNavigation, type GraphReveal, type HierarchyProjection } from "./graphHierarchy"
import { GRAPH_MIN_ZOOM } from "./graphLanes"
import { operationShapeKey } from "./graphPathShape"

export type SearchKind = "target" | "api-group" | "operation" | "resource" | "identity" | "operation-group" | "object-group"
export const searchKindNames: Record<SearchKind, string> = { target: "Target", "api-group": "API 그룹", operation: "API", resource: "객체", identity: "신원", "operation-group": "API 묶음", "object-group": "객체 묶음" }
export interface SearchContext { groupId: string; groupLabel: string; operation: string }
export interface GraphSearchEntry {
  key: string
  kind: SearchKind
  service: string
  value: string
  title: string
  contexts: readonly SearchContext[]
  name: string
  text: string
}
export interface GraphSearchIndex { entries: readonly GraphSearchEntry[]; byKey: ReadonlyMap<string, GraphSearchEntry> }
export const searchKey = (kind: SearchKind, service: string, value: string) => JSON.stringify([kind, service, value])
const compare = (left: string, right: string) => left.localeCompare(right, "en")
const observable = (cell: Cell) => Object.values(cell.perSource).some(value => value !== undefined)

/** Evidence, 판정, owner만 바뀐 snapshot은 검색 인덱스를 다시 만들 필요가 없다. */
export function sameSearchCells(before: readonly Cell[], after: readonly Cell[]): boolean {
  return before === after || before.length === after.length && before.every((cell, index) => {
    const next = after[index]
    return cell.op === next.op && cell.idn === next.idn && cell.resource === next.resource && observable(cell) === observable(next)
  })
}

/** 제한·접힘을 적용하기 전 셀에서 식별자와 관계 문맥만 보관한다. */
export function buildGraphSearchIndex(cells: readonly Cell[]): GraphSearchIndex {
  const entries = new Map<string, Omit<GraphSearchEntry, "contexts" | "name" | "text"> & { contexts: Map<string, SearchContext> }>()
  const shapes = new Map<string, { service: string; shape: string; operations: Set<string> }>()
  const add = (kind: SearchKind, service: string, value: string, title: string, context: SearchContext) => {
    const key = searchKey(kind, service, value)
    let entry = entries.get(key)
    if (!entry) { entry = { key, kind, service, value, title, contexts: new Map() }; entries.set(key, entry) }
    entry.contexts.set(context.operation, context)
  }
  for (const cell of cells) {
    if (!observable(cell)) continue
    const group = operationGroup(cell.op)
    const context = { groupId: group.id, groupLabel: group.label, operation: cell.op }
    add("target", group.service, group.service, group.service, context)
    add("api-group", group.service, group.id, group.label, context)
    add("operation", group.service, cell.op, cell.op.replace(/^https?:\/\/\S+\s+/i, ""), context)
    add("identity", group.service, cell.idn, cell.idn, context)
    if (cell.resource) {
      add("resource", group.service, cell.resource, cell.resource, context)
      const object = objectGroupKey(cell.resource)
      if (object) add("object-group", group.service, object.id, object.key, context)
    }
    const shape = operationShapeKey(cell.op), key = JSON.stringify([group.id, shape])
    let bucket = shapes.get(key)
    if (!bucket) { bucket = { service: group.service, shape, operations: new Set() }; shapes.set(key, bucket) }
    bucket.operations.add(cell.op)
  }
  for (const bucket of shapes.values()) if (bucket.operations.size > 1) {
    for (const operation of bucket.operations) {
      const group = operationGroup(operation)
      add("operation-group", bucket.service, bucket.shape, bucket.shape.replace(/^https?:\/\/\S+\s+/i, ""), { groupId: group.id, groupLabel: group.label, operation })
    }
  }
  const result = [...entries.values()].map(entry => {
    const contexts = [...entry.contexts.values()].sort((a, b) => compare(a.operation, b.operation))
    return { ...entry, contexts, name: entry.title.toLowerCase(), text: [entry.title, entry.value, entry.service, ...contexts.map(context => `${context.groupLabel} ${context.operation}`)].join("\n").toLowerCase() }
  })
  return { entries: result, byKey: new Map(result.map(entry => [entry.key, entry])) }
}

export interface GraphSearchResults { entries: readonly GraphSearchEntry[]; keys: ReadonlySet<string>; total: number }
const kinds: readonly SearchKind[] = ["target", "api-group", "operation", "resource", "identity", "operation-group", "object-group"]
export function searchGraph(index: GraphSearchIndex, query: string, navigation: GraphNavigation, limit = 30): GraphSearchResults {
  const needle = query.trim().toLowerCase(), tokens = needle.split(/\s+/)
  if (!needle) return { entries: [], keys: new Set(), total: 0 }
  const service = navigation.level === "site" ? "" : index.entries.find(entry => entry.kind === "api-group" && entry.value === navigation.groupId)?.service ?? ""
  type Ranked = { entry: GraphSearchEntry; rank: number; local: boolean }
  const order = (a: Ranked, b: Ranked) => a.rank - b.rank
    || Number(b.entry.service === service) - Number(a.entry.service === service) || Number(b.local) - Number(a.local)
    || kinds.indexOf(a.entry.kind) - kinds.indexOf(b.entry.kind) || compare(a.entry.title, b.entry.title) || compare(a.entry.key, b.entry.key)
  const best: Ranked[] = [], keys = new Set<string>()
  for (const entry of index.entries) {
    if (!tokens.every(token => entry.text.includes(token))) continue
    keys.add(entry.key)
    const item = { entry, rank: entry.name === needle ? 0 : entry.name.startsWith(needle) ? 1 : entry.name.includes(needle) ? 2 : 3, local: entry.contexts.some(context => context.groupId === navigation.groupId) }
    let low = 0, high = best.length
    while (low < high) { const middle = (low + high) >>> 1; if (order(item, best[middle]) < 0) high = middle; else low = middle + 1 }
    if (low < limit) { best.splice(low, 0, item); if (best.length > limit) best.pop() }
  }
  return { entries: best.map(item => item.entry), keys, total: keys.size }
}

export interface SearchDestination { navigation: GraphNavigation; nodeId: string; reveal: GraphReveal; expand: readonly string[] }
export function searchDestination(entry: GraphSearchEntry, current: GraphNavigation, projection: HierarchyProjection | null, listMode: boolean): SearchDestination {
  const currentService = projection?.groups.find(group => group.id === current.groupId)?.service
  const nodeId = `${entry.kind}:${entry.value}`
  const visible = currentService === entry.service && projection?.nodes.some(node => node.id === nodeId && !node.hiddenInGraph)
  const context = entry.contexts.find(context => context.operation === current.operation)
    ?? entry.contexts.find(context => context.groupId === current.groupId) ?? entry.contexts[0]
  let navigation = current
  if (entry.kind === "target" || entry.kind === "api-group") navigation = navigateHierarchy(current, "site")
  else if (!visible || listMode && entry.kind !== "operation") {
    const level = entry.kind === "resource" || listMode && entry.kind === "identity" ? "operation" : "group"
    navigation = navigateHierarchy(current, level, context.groupId, level === "operation" ? context.operation : "")
  }
  const operations = entry.kind === "operation-group" ? entry.contexts.filter(item => item.groupId === navigation.groupId).slice(0, 2).map(item => item.operation) : [context.operation]
  return { navigation, nodeId, reveal: { operations, ...(entry.kind === "resource" ? { resource: entry.value } : {}) }, expand: entry.kind === "operation" ? [`operation-group:${operationShapeKey(entry.value)}`] : [] }
}

export function searchHighlights(projection: HierarchyProjection, keys: ReadonlySet<string>): ReadonlyMap<string, "direct" | "member"> {
  const matches = new Map<string, "direct" | "member">()
  const service = projection.groups.find(group => group.id === projection.navigation.groupId)?.service ?? "Target"
  for (const node of projection.nodes) {
    if (node.hiddenInGraph || !kinds.includes(node.kind as SearchKind)) continue
    const kind = node.kind as SearchKind
    const value = kind === "api-group" ? node.groupId! : node.id.slice(kind.length + 1)
    const ownService = node.service ?? service
    if (keys.has(searchKey(kind, ownService, value))) matches.set(node.id, "direct")
    else if (node.objectGroup?.members.some(member => keys.has(searchKey(kind === "operation-group" ? "operation" : "resource", ownService, member)))) matches.set(node.id, "member")
  }
  return matches
}

/** 레인 머리글과 화면 여백을 제외하고 카드만 노출한다. 모델 좌표는 바꾸지 않는다. */
export function graphSearchViewport(box: { x: number; y: number; width: number; height: number }, viewport: { zoom: number; pan: { x: number; y: number } }, canvas: { width: number; height: number }) {
  const width = Math.max(1, canvas.width - 32), height = Math.max(1, canvas.height - 72)
  const zoom = Math.max(GRAPH_MIN_ZOOM, Math.min(viewport.zoom, width / box.width, height / box.height))
  const x = box.x * zoom + viewport.pan.x, y = box.y * zoom + viewport.pan.y
  const w = box.width * zoom, h = box.height * zoom
  const shift = (center: number, size: number, start: number, length: number) => size > length ? start + length / 2 - center : center - size / 2 < start ? start - center + size / 2 : center + size / 2 > start + length ? start + length - center - size / 2 : 0
  return { zoom, pan: { x: viewport.pan.x + shift(x, w, 16, width), y: viewport.pan.y + shift(y, h, 56, height) } }
}
