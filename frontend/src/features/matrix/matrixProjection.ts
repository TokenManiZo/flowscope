import { identityLabel } from "@/lib/display/identityLabel"
import type { Cell, Gap, Snapshot, Source } from "@/lib/api/types"

export type MatrixMode = "identity" | "role"

export interface MatrixColumn {
  key: string
  operation: string
  resource: string | null
  requiredRole: string | undefined
  owner: string | undefined
}

export interface MatrixMember {
  key: string
  identity: string
  cell: Cell
  gap: Gap | undefined
}

export interface MatrixRow {
  key: string
  label: string
  membersByColumn: Readonly<Record<string, readonly MatrixMember[]>>
}

export interface MatrixProjection {
  columns: readonly MatrixColumn[]
  rows: readonly MatrixRow[]
}

export const matrixCellKey = (mode: MatrixMode, group: string, operation: string, resource: string | null) => JSON.stringify([mode, group, operation, resource])
export const matrixCoordinateKey = (operation: string, resource: string | null) => JSON.stringify([operation, resource])

/** Canonical coordinates retain service internally; matrix labels show only method and API path. */
export function operationDisplay(operation: string) {
  const value = operation.replace(/^https?:\/\/\S+\s+/i, "")
  const match = value.match(/^([A-Z]+)\s+(.+)$/)
  return match ? { method: match[1], path: match[2] } : { method: null, path: value }
}

function sameCoordinate(left: Pick<Cell, "idn" | "op" | "resource">, right: Pick<Gap, "idn" | "op" | "resource">) {
  return left.idn === right.idn && left.op === right.op && left.resource === right.resource
}

function matrixMember(snapshot: Snapshot, mode: MatrixMode, group: string, cell: Cell): MatrixMember {
  return {
    key: matrixCellKey(mode, group, cell.op, cell.resource),
    identity: cell.idn,
    cell,
    gap: snapshot.gaps.find((gap) => sameCoordinate(cell, gap)),
  }
}

export function projectMatrix(snapshot: Snapshot, mode: MatrixMode, gapsOnly: boolean): MatrixProjection {
  const visibleCells = gapsOnly ? snapshot.cells.filter((cell) => cell.missedSources.length > 0 || snapshot.gaps.some((gap) => sameCoordinate(cell, gap))) : snapshot.cells
  const columns: MatrixColumn[] = []
  const knownColumns = new Set<string>()
  for (const cell of visibleCells) {
    const key = matrixCoordinateKey(cell.op, cell.resource)
    if (knownColumns.has(key)) continue
    knownColumns.add(key)
    columns.push({ key, operation: cell.op, resource: cell.resource, requiredRole: snapshot.requiredRoles[cell.op], owner: cell.resource === null ? undefined : snapshot.owners[cell.resource] })
  }

  const groups = new Map<string, Cell[]>()
  for (const cell of visibleCells) {
    const group = mode === "identity" ? cell.idn : snapshot.roles[cell.idn] ?? "Unknown/unset"
    const cells = groups.get(group) ?? []
    cells.push(cell)
    groups.set(group, cells)
  }
  return {
    columns,
    rows: [...groups.entries()].map(([group, cells]) => {
      const membersByColumn: Record<string, MatrixMember[]> = {}
      for (const cell of cells) {
        const key = matrixCoordinateKey(cell.op, cell.resource)
        ;(membersByColumn[key] ??= []).push(matrixMember(snapshot, mode, group, cell))
      }
      return { key: JSON.stringify([mode, group]), label: mode === "identity" ? identityLabel(group) : `역할: ${group}`, membersByColumn }
    }),
  }
}

export const sourceOrder: readonly Source[] = ["human", "scanner", "llm", "unknown"]

export function sourcePresentation(source: Source) {
  if (source === "human") return { short: "H", label: "HUMAN", line: "실선", lineClass: "border-solid" }
  if (source === "scanner") return { short: "S", label: "SCANNER", line: "파선", lineClass: "border-dashed" }
  if (source === "llm") return { short: "L", label: "LLM", line: "점선", lineClass: "border-dotted" }
  return { short: "?", label: "UNKNOWN", line: "실선", lineClass: "border-solid" }
}
