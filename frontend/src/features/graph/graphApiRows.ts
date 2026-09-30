import type { Cell, Snapshot, Source } from "@/lib/api/types"
import { indexEventsByEvidence } from "./graphHighlight"
import { objectGroupKey } from "./graphHierarchy"
import { operationParts } from "./relationshipNodeCard"

/** API 목록 표 한 줄의 관측 요약. 응답 코드·출처·신원·객체는 노드의 Evidence에 묶인 요청에서 모은다. */
export interface ApiRowStats {
  codes: readonly number[]
  sources: ReadonlySet<Source>
  identities: ReadonlySet<string>
  /** 객체 종류(`orders:101`의 `orders`)별 서로 다른 객체. */
  objects: ReadonlyMap<string, ReadonlySet<string>>
}

interface StatsNode { id: string; selection: { operation?: string | null; evidenceIds: readonly string[] } }

function addObject(objects: Map<string, Set<string>>, resource: string | null) {
  const key = resource ? objectGroupKey(resource)?.key : undefined
  if (key) objects.set(key, (objects.get(key) ?? new Set()).add(resource!))
}

/**
 * 노드별 관측 요약. 묶음 줄은 안에 든 노드의 요청을 합쳐 다시 계산한다(합계가 아니라 중복을 뺀 값).
 * 객체는 요청 기록과 서버 셀 모두에서 모은다(셀에만 남은 객체도 목록에서 펼칠 수 있게).
 */
export function apiRowStats(nodes: readonly StatsNode[], snapshot: Pick<Snapshot, "events" | "cells">) {
  const index = indexEventsByEvidence(snapshot.events)
  const eventsOf = (node: StatsNode) => node.selection.evidenceIds.flatMap(id => index.get(id) ?? [])
  return (group: readonly StatsNode[]): ApiRowStats => {
    const codes = new Set<number>(), sources = new Set<Source>(), identities = new Set<string>(), objects = new Map<string, Set<string>>()
    for (const event of new Set(group.flatMap(eventsOf))) {
      codes.add(event.status); sources.add(event.source); identities.add(event.idn)
      for (const resource of new Set([event.resource, ...event.objects.map(object => object.resource)])) addObject(objects, resource)
    }
    const ops = new Set(group.flatMap(node => node.selection.operation ? [node.selection.operation] : []))
    for (const cell of snapshot.cells) if (ops.has(cell.op)) addObject(objects, cell.resource)
    return { codes: [...codes].sort((left, right) => left - right), sources, identities, objects }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isIdSegment(segment: string) {
  return /^\d+$/.test(segment) || UUID.test(segment) || (segment.length >= 16 && /^[a-z0-9]+$/i.test(segment) && /[a-z]/i.test(segment) && /\d/.test(segment))
}

/** 숫자·UUID·16자 이상 영문+숫자 토큰 구간을 `{id}`로 바꾼 경로 형식. */
export function pathShape(path: string) {
  return path.split("/").map(segment => isIdSegment(segment) ? "{id}" : segment).join("/")
}

/** 펼친 줄에 쓰는 짧은 경로: 뒤 세 구간만 남기고 긴 토큰은 가운데를 줄인다. */
export function shortPath(path: string) {
  const parts = path.split("/").map(segment => segment.length > 14 ? `${segment.slice(0, 5)}…${segment.slice(-6)}` : segment)
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : parts.join("/")
}

export interface ApiRowGroup<T> { key: string; method: string; path: string; items: readonly T[] }

/** 메서드 + 경로 형식이 같은 API를 묶는다. 순서는 각 묶음의 첫 API가 있던 자리를 따른다. */
export function groupApiRows<T extends { label: string }>(items: readonly T[]): ApiRowGroup<T>[] {
  const groups = new Map<string, { method: string; path: string; items: T[] }>()
  for (const item of items) {
    const { method, path } = operationParts(item.label)
    const key = `${method} ${pathShape(path)}`
    const group = groups.get(key)
    if (group) group.items.push(item); else groups.set(key, { method, path: pathShape(path), items: [item] })
  }
  return [...groups].map(([key, group]) => ({ key, ...group }))
}

export interface ObjectRow {
  resource: string
  /** 서비스 접두어를 뺀 표시 이름(`orders:101`). */
  label: string
  owner: string | null
  cells: readonly Cell[]
  identities: ReadonlyArray<{ name: string; codes: readonly number[]; suspicious: boolean }>
}

/**
 * 한 API(또는 묶음)의 한 객체 종류에 대한 객체 목록. 소유자는 서버 추정값(snapshot.owners)을 쓰고,
 * IDOR 후보는 화면에서 다시 판단하지 않고 서버 셀 판정이 suspicious인 신원에만 붙인다.
 */
export function objectRows(operations: readonly string[], type: string, snapshot: Pick<Snapshot, "events" | "cells" | "owners">): ObjectRow[] {
  const ops = new Set(operations)
  const ofType = (resource: string | null): resource is string => !!resource && objectGroupKey(resource)?.key === type
  const rows = new Map<string, { cells: Cell[]; codes: Map<string, Set<number>> }>()
  const row = (resource: string) => rows.get(resource) ?? rows.set(resource, { cells: [], codes: new Map() }).get(resource)!
  for (const cell of snapshot.cells) if (ops.has(cell.op) && ofType(cell.resource)) row(cell.resource).cells.push(cell)
  for (const event of snapshot.events) {
    if (!ops.has(event.op)) continue
    for (const resource of new Set([event.resource, ...event.objects.map(object => object.resource)])) {
      if (!ofType(resource)) continue
      const codes = row(resource).codes
      codes.set(event.idn, (codes.get(event.idn) ?? new Set()).add(event.status))
    }
  }
  return [...rows].sort(([left], [right]) => left.localeCompare(right)).map(([resource, { cells, codes }]) => {
    const names = [...new Set([...cells.map(cell => cell.idn), ...codes.keys()])].sort()
    return {
      resource, label: resource.slice(resource.lastIndexOf(" ") + 1), owner: snapshot.owners[resource] ?? null, cells,
      identities: names.map(name => ({ name, codes: [...(codes.get(name) ?? [])].sort((left, right) => left - right), suspicious: cells.some(cell => cell.idn === name && cell.overall === "suspicious") })),
    }
  })
}
