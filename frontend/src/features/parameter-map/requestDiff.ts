import type { ParameterMapKey } from "./parameterProjection"

/** 관측 metadata만(PR#11): 값 원문·preview는 없다. digest는 Evidence API가 민감하지 않은 값에만 주는 SHA-256이며 값 변경 판단에만 쓴다. */
export interface StructuredParameterMetadata {
  key: ParameterMapKey | null
  presence: "PRESENT" | "EXPLICIT_NULL" | "ABSENT_OBSERVED_CONTEXT" | "UNKNOWN"
  /** 구조 형태(SCALAR/ARRAY/OBJECT/NULL/UNKNOWN). 표시 형태(INTEGER/UUID…)는 displayShape에 둔다. */
  shape: "SCALAR" | "ARRAY" | "OBJECT" | "NULL" | "UNKNOWN"
  valueType: "STRING" | "INTEGER" | "NUMBER" | "BOOLEAN" | "UUID" | "DATE_TIME" | "BINARY" | "UNKNOWN"
  occurrenceCount: number | null
  digest: string | null
}
export type ParameterRetention = "RETAINED" | "METADATA_ONLY" | "NOT_RETAINED" | "UNKNOWN"
/** Only safe server-extracted metadata. This is not an EvidenceRecord or RequestLabDraft adapter. */
export interface ParameterContext {
  parameters: readonly StructuredParameterMetadata[]
  complete: boolean
  retention: ParameterRetention
}
export type ParameterDiffChange = "PRESENCE_CHANGED" | "SHAPE_CHANGED" | "TYPE_CHANGED" | "OCCURRENCE_CHANGED" | "VALUE_CHANGED" | "RETENTION_CHANGED" | "UNKNOWN" | "UNCHANGED"
export interface ParameterDiffSide extends Omit<StructuredParameterMetadata, "key"> {
  retention: ParameterRetention
  duplicateCount: number
  unknownReason: "MISSING_KEY" | "CONFLICTING_DUPLICATE_KEY" | "INCOMPLETE_CONTEXT" | "IDENTITY_CONFLICT" | null
}
export interface ParameterDiffRow {
  id: string
  parameterKey: ParameterMapKey | null
  identityState: "CONSISTENT" | "IDENTITY_CONFLICT" | "UNKNOWN"
  path: string
  change: ParameterDiffChange
  changes: readonly ParameterDiffChange[]
  left: ParameterDiffSide
  right: ParameterDiffSide
}
const choose = <T extends string>(value: unknown, allowed: readonly T[]): T | "UNKNOWN" => allowed.includes(value as T) ? value as T : "UNKNOWN"
const retention = (value: unknown): ParameterRetention => choose(value, ["RETAINED", "METADATA_ONLY", "NOT_RETAINED", "UNKNOWN"])
const coordinate = (key: ParameterMapKey | null) => key && key.stableKey && key.service && key.method && key.operation && key.location && key.canonicalPath ? JSON.stringify([key.service, key.method, key.operation, key.location, key.canonicalPath]) : "UNKNOWN"
const unknownSide = (context: ParameterContext, reason: ParameterDiffSide["unknownReason"]): ParameterDiffSide => ({ presence: "UNKNOWN", shape: "UNKNOWN", valueType: "UNKNOWN", occurrenceCount: null, digest: null, retention: retention(context.retention), duplicateCount: 0, unknownReason: reason })

function indexContext(context: ParameterContext) {
  const rows = new Map<string, { key: ParameterMapKey | null; side: ParameterDiffSide; signature: string }>()
  for (const metadata of context.parameters) {
    const id = coordinate(metadata.key)
    const key = id === "UNKNOWN" ? null : metadata.key!
    // Explicit allowlist: extra properties (including throwing raw getters) are never read or spread.
    const side: ParameterDiffSide = {
      presence: choose(metadata.presence, ["PRESENT", "EXPLICIT_NULL", "ABSENT_OBSERVED_CONTEXT", "UNKNOWN"]),
      shape: choose(metadata.shape, ["SCALAR", "ARRAY", "OBJECT", "NULL", "UNKNOWN"]),
      valueType: choose(metadata.valueType, ["STRING", "INTEGER", "NUMBER", "BOOLEAN", "UUID", "DATE_TIME", "BINARY", "UNKNOWN"]),
      occurrenceCount: Number.isSafeInteger(metadata.occurrenceCount) && metadata.occurrenceCount! >= 0 ? metadata.occurrenceCount : null,
      digest: typeof metadata.digest === "string" && /^(?:sha256:)?[a-f0-9]{64}$/i.test(metadata.digest) ? metadata.digest.replace(/^sha256:/i, "").toLowerCase() : null,
      retention: retention(context.retention), duplicateCount: 1, unknownReason: key ? null : "MISSING_KEY",
    }
    const signature = JSON.stringify([key?.stableKey, side]), existing = rows.get(id)
    if (existing) {
      const count = existing.side.duplicateCount + 1
      if (existing.signature !== signature) {
        existing.side = unknownSide(context, "CONFLICTING_DUPLICATE_KEY")
        // No arbitrary first key survives a conflicting duplicate.
        existing.key = null
      }
      existing.side.duplicateCount = count
    } else rows.set(id, { key: key ? { service: key.service, method: key.method, pathTemplate: key.pathTemplate, operation: key.operation, location: key.location, canonicalPath: key.canonicalPath, stableKey: key.stableKey } : null, side, signature })
  }
  return rows
}
const missingSide = (context: ParameterContext) => context.complete && context.retention === "RETAINED"
  ? { ...unknownSide(context, null), presence: "ABSENT_OBSERVED_CONTEXT" as const, occurrenceCount: 0 }
  : unknownSide(context, "INCOMPLETE_CONTEXT")

/** A stable identity must resolve to one coordinate across both complete input sets. */
function conflictingCoordinates(left: ParameterContext, right: ParameterContext): Set<string> {
  const coordinatesByStableKey = new Map<string, Set<string>>()
  for (const context of [left, right]) for (const metadata of context.parameters) {
    const key = metadata.key, id = coordinate(key)
    if (!key || id === "UNKNOWN") continue
    const coordinates = coordinatesByStableKey.get(key.stableKey) ?? new Set<string>()
    coordinates.add(id)
    coordinatesByStableKey.set(key.stableKey, coordinates)
  }
  const conflicts = new Set<string>()
  for (const coordinates of coordinatesByStableKey.values()) if (coordinates.size > 1) for (const id of coordinates) conflicts.add(id)
  return conflicts
}

/** Deterministic structural comparison; unknown data never becomes absent or an unchanged value. */
export function diffParameterContexts(left: ParameterContext, right: ParameterContext): ParameterDiffRow[] {
  const a = indexContext(left), b = indexContext(right)
  const identityConflicts = conflictingCoordinates(left, right)
  return [...new Set([...a.keys(), ...b.keys()])].sort().map(id => {
    const l = a.get(id), r = b.get(id), ls = l?.side ?? missingSide(left), rs = r?.side ?? missingSide(right)
    if (identityConflicts.has(id)) return {
      id, parameterKey: null, path: l?.key?.canonicalPath ?? r?.key?.canonicalPath ?? "UNKNOWN", identityState: "IDENTITY_CONFLICT" as const,
      change: "UNKNOWN" as const, changes: ["UNKNOWN" as const],
      left: { ...unknownSide(left, "IDENTITY_CONFLICT"), duplicateCount: ls.duplicateCount },
      right: { ...unknownSide(right, "IDENTITY_CONFLICT"), duplicateCount: rs.duplicateCount },
    }
    const changes: ParameterDiffChange[] = []
    const keyConflict = l?.key && r?.key && l.key.stableKey !== r.key.stableKey
    const uncertain = keyConflict || ls.unknownReason || rs.unknownReason || ls.presence === "UNKNOWN" || rs.presence === "UNKNOWN" || ls.retention === "UNKNOWN" || rs.retention === "UNKNOWN"
    if (uncertain) changes.push("UNKNOWN")
    else {
      if (ls.presence !== rs.presence) changes.push("PRESENCE_CHANGED")
      if (ls.presence !== "ABSENT_OBSERVED_CONTEXT" && rs.presence !== "ABSENT_OBSERVED_CONTEXT") {
        if (ls.shape !== rs.shape) changes.push("SHAPE_CHANGED")
        if (ls.valueType !== rs.valueType) changes.push("TYPE_CHANGED")
        if (ls.occurrenceCount !== rs.occurrenceCount) changes.push("OCCURRENCE_CHANGED")
        if (ls.digest && rs.digest && ls.digest !== rs.digest) changes.push("VALUE_CHANGED")
        if (ls.shape === "UNKNOWN" || rs.shape === "UNKNOWN" || ls.valueType === "UNKNOWN" || rs.valueType === "UNKNOWN" || ls.occurrenceCount === null || rs.occurrenceCount === null || !ls.digest || !rs.digest) changes.push("UNKNOWN")
      }
    }
    if (ls.retention !== rs.retention) changes.push("RETENTION_CHANGED")
    if (!changes.length) changes.push("UNCHANGED")
    const key = keyConflict ? null : l?.key ?? r?.key ?? null
    return { id, parameterKey: key, path: key?.canonicalPath ?? "UNKNOWN", identityState: keyConflict ? "IDENTITY_CONFLICT" as const : key ? "CONSISTENT" as const : "UNKNOWN" as const, change: changes[0], changes, left: ls, right: rs }
  })
}
