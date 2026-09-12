import { describe, expect, it } from "vitest"
import { demoEndpointKey } from "./parameterMapFixtures"
import { parameterMapKey } from "./parameterProjection"
import { diffParameterContexts, type ParameterContext, type StructuredParameterMetadata } from "./requestDiff"

const key = parameterMapKey(demoEndpointKey, "JSON_BODY", "/status")
const row = (extra: Partial<StructuredParameterMetadata> = {}): StructuredParameterMetadata => ({ key, presence: "PRESENT", shape: "SCALAR", valueType: "STRING", occurrenceCount: 1, digest: "a".repeat(64), ...extra })
const context = (parameters: StructuredParameterMetadata[], extra: Partial<ParameterContext> = {}): ParameterContext => ({ parameters, complete: true, retention: "RETAINED", ...extra })

describe("structured metadata diff", () => {
  it("compares digest without accepting or reading raw scalar/request text", () => {
    const left = context([row()])
    const right = context([row({ digest: "b".repeat(64) })])
    Object.defineProperty(right, "request", { get() { throw new Error("raw request read") } })
    Object.defineProperty(right.parameters[0], "value", { get() { throw new Error("raw scalar read") } })
    const rows = diffParameterContexts(left, right)
    expect(rows).toContainEqual(expect.objectContaining({ path: "/status", change: "VALUE_CHANGED", changes: ["VALUE_CHANGED"] }))
    expect(JSON.stringify(rows)).not.toMatch(/request|valueSummary|preview|READY-SECRET/)
  })

  it("keeps value comparison UNKNOWN when digests are not exposed (production contract)", () => {
    const rows = diffParameterContexts(context([row({ digest: null, occurrenceCount: null })]), context([row({ digest: null, occurrenceCount: null })]))
    expect(rows[0].changes).toEqual(["UNKNOWN"])
    expect(rows[0].left.digest).toBeNull()
  })

  it("reports presence, shape/type and occurrence independently", () => {
    const rows = diffParameterContexts(context([row()]), context([row({ presence: "EXPLICIT_NULL", shape: "NULL", valueType: "UNKNOWN", occurrenceCount: 2, digest: null })]))
    expect(rows[0].changes).toEqual(["PRESENCE_CHANGED", "SHAPE_CHANGED", "OCCURRENCE_CHANGED", "UNKNOWN"])
  })

  it("keeps unrecorded shape, type and occurrence unknown without fabricating changes", () => {
    const unknown = row({ shape: "UNKNOWN", valueType: "UNKNOWN", occurrenceCount: null })
    const rows = diffParameterContexts(context([unknown]), context([row()]))
    expect(rows[0].changes).toEqual(["UNKNOWN"])
    expect(rows[0].left.presence).toBe("PRESENT")
    expect(rows[0].right.shape).toBe("SCALAR")
    expect(diffParameterContexts(context([row()]), context([unknown]))[0].changes).toEqual(["UNKNOWN"])
  })

  it("does not claim absent from an incomplete or metadata-only context", () => {
    expect(diffParameterContexts(context([row()]), context([]))[0]).toMatchObject({ change: "PRESENCE_CHANGED", right: { presence: "ABSENT_OBSERVED_CONTEXT" } })
    expect(diffParameterContexts(context([row()]), context([], { complete: false, retention: "METADATA_ONLY" }))[0]).toMatchObject({ change: "UNKNOWN", right: { presence: "UNKNOWN", unknownReason: "INCOMPLETE_CONTEXT" } })
  })

  it("handles duplicate identical and conflicting keys deterministically", () => {
    expect(diffParameterContexts(context([row(), row()]), context([row()]))[0]).toMatchObject({ change: "UNCHANGED", left: { duplicateCount: 2 } })
    const a = row(), b = row({ shape: "ARRAY" })
    const forward = diffParameterContexts(context([a, b]), context([a]))
    expect(forward[0]).toMatchObject({ change: "UNKNOWN", left: { unknownReason: "CONFLICTING_DUPLICATE_KEY" } })
    expect(diffParameterContexts(context([b, a]), context([a]))).toEqual(forward)
  })

  it("keeps missing/invalid keys unknown and never emits non-digest values", () => {
    const invalid = row({ digest: "READY-SECRET" })
    const result = diffParameterContexts(context([invalid]), context([row({ digest: "Bearer TOKEN-SECRET" })]))
    expect(result[0].change).toBe("UNKNOWN")
    expect(JSON.stringify(result)).not.toMatch(/READY-SECRET|TOKEN-SECRET/)
    expect(diffParameterContexts(context([row({ key: null })]), context([]))[0]).toMatchObject({ path: "UNKNOWN", change: "UNKNOWN" })
  })

  it("sorts by full canonical coordinates, keeps unknown explicit, and has an empty result for empty contexts", () => {
    const first = row({ key: parameterMapKey(demoEndpointKey, "JSON_BODY", "/a") })
    expect(diffParameterContexts(context([row(), first]), context([row(), first])).map(item => item.path)).toEqual(["/a", "/status"])
    expect(diffParameterContexts(context([row({ shape: "UNKNOWN" })]), context([row({ shape: "UNKNOWN" })]))[0].change).toBe("UNKNOWN")
    expect(diffParameterContexts(context([]), context([]))).toEqual([])
  })

  it("does not claim unchanged when retention is unknown", () => {
    expect(diffParameterContexts(context([row()], { retention: "UNKNOWN" }), context([row()], { retention: "UNKNOWN" }))[0].change).toBe("UNKNOWN")
  })

  it("marks conflicting stable keys unknown without input-order-dependent key output", () => {
    const first = row(), second = row({ key: { ...key, stableKey: "conflict" } })
    const result = diffParameterContexts(context([first, second]), context([row()]))
    expect(result[0]).toMatchObject({ change: "UNKNOWN", left: { unknownReason: "CONFLICTING_DUPLICATE_KEY" } })
    expect(result).toEqual(diffParameterContexts(context([second, first]), context([row()])))
  })

  it("detects one stable key mapped to different coordinates across contexts without presence claims", () => {
    const a = row(), b = row({ key: { ...key, canonicalPath: "/other" }, digest: "b".repeat(64) })
    const result = diffParameterContexts(context([a]), context([b]))
    expect(result).toHaveLength(2)
    expect(result.every(item => item.change === "UNKNOWN" && item.identityState === "IDENTITY_CONFLICT" && item.parameterKey === null)).toBe(true)
    expect(diffParameterContexts(context([b]), context([a])).map(item => [item.id, item.change, item.identityState])).toEqual(result.map(item => [item.id, item.change, item.identityState]))
  })
})
