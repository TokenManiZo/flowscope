import { describe, expect, it } from "vitest"
import { actualEvent, declaration, demoEndpoint, demoOperation, demoResource, parameterGap, statusParameter, surfaceSnapshot, validationCell } from "./parameterMapFixtures"
import { defaultParameterFilters, projectParameterMap, validationCellId } from "./parameterProjection"

describe("parameter map projection over snapshot.surface", () => {
  it("projects separate display-only cards for all four parameter path lanes", () => {
    const snapshot = surfaceSnapshot({ endpoints: [demoEndpoint()], gaps: [parameterGap("auth", { type: "AUTH_VARIANT_UNTESTED" })], events: [actualEvent()], owners: { [demoResource]: "USER B" } })
    const graph = projectParameterMap(snapshot, defaultParameterFilters, "auth")
    const node = (lane: string) => graph.nodes.find(item => item.lane === lane && item.focused)!
    expect(node("condition").card).toMatchObject({ kind: "condition", badge: "IDENTITY", title: "USER A", detail: "USER", footer: "7 observations", icon: "user" })
    expect(node("operation").card).toMatchObject({ kind: "operation", badge: "PATCH", title: "/orders/{id}", detail: "HTTP 200 × 1", footer: "1 Evidence", icon: "none" })
    expect(node("operation").card.accessibleLabel).toContain(demoOperation)
    expect(node("input").card).toMatchObject({ kind: "input", badge: "JSON", title: "status", detail: "Authorization variant untested", footer: "STRING · STRING", icon: "none" })
    expect(node("input").card.accessibleLabel).toContain("/status")
    expect(node("target").card).toMatchObject({ kind: "target", badge: "RESOURCE", title: "orders:101", detail: "OBSERVED", footer: "owner: USER B", icon: "box" })
    expect(node("input").card.accessibleLabel).not.toContain("USER B")
  })

  it("summarizes only matching actual event IDs and HTTP results without expanding cluster or profile counts", () => {
    const snapshot = surfaceSnapshot({
      endpoints: [demoEndpoint()], gaps: [parameterGap("gap")],
      events: [actualEvent(), actualEvent(), actualEvent({ eventId: "actual-b", status: 403 }),
        actualEvent({ eventId: "actual-validation", coverageEligible: false, phase: "VALIDATION" }),
        actualEvent({ eventId: "other-origin", op: "https://other.test:443 PATCH /orders/{id}", status: 500 }),
        actualEvent({ eventId: "other-method", method: "GET", status: 404 }),
        actualEvent({ eventId: "other-route", op: `${demoOperation}/details`, status: 201 })],
    })
    const before = JSON.stringify(snapshot)
    const card = projectParameterMap(snapshot).nodes.find(node => node.lane === "operation")!.card
    expect(card).toMatchObject({ title: "/orders/{id}", detail: "HTTP 200 × 2 · 403 × 1", footer: "3 Evidence" })
    expect(JSON.stringify(snapshot)).toBe(before)
    const unknown = projectParameterMap(surfaceSnapshot({ gaps: [parameterGap("gap")], events: [actualEvent({ status: 0 }), actualEvent({ eventId: "invalid", status: 900 })] }))
    expect(unknown.nodes.find(node => node.lane === "operation")?.card).toMatchObject({ detail: "HTTP UNKNOWN × 2", footer: "2 Evidence" })
  })

  it("keeps a missing parameter fact UNKNOWN and a declared-only fact NOT_OBSERVED without inventing observations", () => {
    const missing = projectParameterMap(surfaceSnapshot({ gaps: [parameterGap("missing")] }))
    expect(missing.nodes.find(node => node.lane === "input")).toMatchObject({ confidence: "UNKNOWN", observationState: "UNKNOWN" })
    expect(missing.nodes.find(node => node.lane === "input")?.card.footer).toBe("UNKNOWN · UNKNOWN")
    expect(missing.edges.some(edge => edge.relation === "definition")).toBe(false)
    const declaredOnly = statusParameter({ observationEvidenceIds: [], observations: [], observedSources: [], observedShapes: [], observedValueTypes: [], declarations: [declaration()], deltaState: "DECLARED_NOT_OBSERVED", profile: undefined, authorizationTargets: [] })
    const candidate = projectParameterMap(surfaceSnapshot({ endpoints: [demoEndpoint([declaredOnly], { observations: [], observedSources: [] })], gaps: [parameterGap("candidate", { type: "DEFINED_NOT_OBSERVED", source: null })] }), defaultParameterFilters, "candidate")
    expect(candidate.nodes.find(node => node.lane === "operation")).toMatchObject({ confidence: "INFERRED", observationState: "NOT_OBSERVED" })
    expect(candidate.nodes.find(node => node.lane === "input")).toMatchObject({ confidence: "INFERRED", observationState: "NOT_OBSERVED" })
    expect(candidate.nodes.find(node => node.lane === "target")).toMatchObject({ label: "UNKNOWN", confidence: "UNKNOWN", owner: null, resource: null })
    expect(candidate.edges.every(edge => edge.line === "dotted")).toBe(true)
    expect(candidate.definitions).toEqual([declaration()])
  })

  it("uses server priority dimensions and stable ID ties, independent of input order", () => {
    const rows = [parameterGap("z"), parameterGap("a"), parameterGap("write", { priorityReasons: ["WRITE_METHOD"] }), parameterGap("auth", { priorityReasons: ["AUTH_VARIANT_UNTESTED"] })]
    const project = (gaps: typeof rows) => projectParameterMap(surfaceSnapshot({ gaps })).queue.map(row => row.id)
    expect(project(rows)).toEqual(["auth", "write", "a", "z"])
    expect(project([...rows].reverse())).toEqual(["auth", "write", "a", "z"])
  })

  it("filters exact gap source, identity, type, status, reasons and declaration types without changing authority", () => {
    const declared = statusParameter({ declarations: [declaration()] })
    const other = parameterGap("write", { canonicalPath: "/other", priorityReasons: ["WRITE_METHOD"] })
    const snapshot = surfaceSnapshot({ endpoints: [demoEndpoint([declared])], gaps: [parameterGap("a"), parameterGap("b", { identity: "B" }), parameterGap("closed", { status: "VERIFIED", source: "HUMAN" }), parameterGap("unknown", { source: null, identity: null }), other] })
    const before = JSON.stringify(snapshot)
    // WRITE_METHOD precedes SOURCE_DISCREPANCY in the server priority order.
    expect(projectParameterMap(snapshot, { ...defaultParameterFilters, identity: ["USER A"], source: ["SCANNER"], gapTypes: ["SOURCE_MISSED"] }).queue.map(row => row.id)).toEqual(["write", "a"])
    expect(projectParameterMap(snapshot, { ...defaultParameterFilters, statuses: ["VERIFIED"], source: ["HUMAN"] }).queue.map(row => row.id)).toEqual(["closed"])
    expect(projectParameterMap(snapshot, { ...defaultParameterFilters, source: ["UNKNOWN"], identity: ["UNKNOWN"] }).queue.map(row => row.id)).toEqual(["unknown"])
    expect(projectParameterMap(snapshot, { ...defaultParameterFilters, priorityReasons: ["WRITE_METHOD"] }).queue.map(row => row.id)).toEqual(["write"])
    expect(projectParameterMap(snapshot, { ...defaultParameterFilters, definitionSources: ["OPENAPI"] }).queue.map(row => row.id)).toEqual(["a", "b", "unknown"])
    expect(projectParameterMap(snapshot, { ...defaultParameterFilters, definitionSources: ["JAVASCRIPT_LITERAL"] }).queue).toEqual([])
    expect(projectParameterMap(snapshot, { ...defaultParameterFilters, source: ["LLM"] }, "a").selection).toBeUndefined()
    expect(JSON.stringify(snapshot)).toBe(before)
  })

  it("shows only open risk gaps and preserves reason order, witnesses, full counts and selected cells", () => {
    const reasons = ["WRITE_METHOD", "CONFIRMED_AUTH_BOUNDARY"]
    const cell = validationCell({ basisEvidenceIds: ["ev-b", "ev-b"] })
    const snapshot = surfaceSnapshot({ endpoints: [demoEndpoint()], gaps: [parameterGap("source", { evidenceIds: ["ev-a", "ev-b", "ev-a"] }), parameterGap("dismissed", { status: "DISMISSED" }), parameterGap("no-risk", { priorityReasons: [] }), parameterGap("auth", { priorityReasons: reasons, evidenceIds: ["ev-a", "ev-b", "ev-a"] })], cells: [cell, cell] })
    const before = JSON.stringify(snapshot)
    const result = projectParameterMap(snapshot, defaultParameterFilters, "auth")
    expect(result.queue.map(row => row.id)).toEqual(["auth", "source"])
    expect(result.queue[0].priorityReasons).toEqual(reasons)
    expect(result.selection).toMatchObject({ gapId: "auth", evidenceIds: ["ev-a", "ev-b"], evidenceCount: 31 })
    expect(result.selection?.parameterKey).toMatchObject({ method: "PATCH", pathTemplate: "/orders/{id}", location: "JSON_BODY", canonicalPath: "/status", operation: demoOperation })
    expect(result.validationCells).toEqual([{ ...cell, id: validationCellId(cell), basisEvidenceIds: ["ev-b"] }])
    expect(result.parameter?.profile?.observationCount).toBe(40)
    expect(result.nodes.filter(node => node.selection.gapId === "auth").map(node => node.lane)).toEqual(["condition", "operation", "input", "target"])
    expect(JSON.stringify(snapshot)).toBe(before)
    expect(JSON.stringify(result)).not.toMatch(/percentage|coveragePercent|CONFIRMED_VULNERABILITY/)
  })

  it("deduplicates gap rows and bounds evidence without losing server counts or selected off-page paths", () => {
    const rows = Array.from({ length: 50 }, (_, index) => parameterGap(`gap-${index.toString().padStart(2, "0")}`))
    rows[49] = parameterGap("gap-49", { evidenceIds: Array.from({ length: 40 }, (_, i) => `ev-${i}`), evidenceCount: 500 })
    const result = projectParameterMap(surfaceSnapshot({ gaps: [...rows, rows[0]] }), defaultParameterFilters, "gap-49")
    expect(result.queue).toHaveLength(50)
    expect(result.visibleGapIds).toHaveLength(41)
    expect(result.hiddenGapCount).toBe(9)
    expect(result.selection?.evidenceIds).toHaveLength(20)
    expect(result.selection?.evidenceCount).toBe(500)
    expect(result.nodes.filter(node => node.focused)).toHaveLength(4)
    const conflict = projectParameterMap(surfaceSnapshot({ gaps: [parameterGap("dup"), parameterGap("dup", { status: "DISMISSED" })] }))
    expect(conflict.queue).toEqual([])
    expect(conflict.diagnostics).toEqual(["CONFLICTING_GAP_ID: dup"])
  })

  it("returns stable empty, definition-only and diagnostic states without fabricating gaps", () => {
    expect(projectParameterMap(surfaceSnapshot())).toMatchObject({ queue: [], nodes: [], edges: [], diagnostics: [], emptyState: "NO_DATA" })
    expect(projectParameterMap({ ...surfaceSnapshot(), surface: undefined })).toMatchObject({ queue: [], emptyState: "NO_DATA" })
    const declaredOnly = statusParameter({ observationEvidenceIds: [], observations: [], declarations: [declaration()], profile: undefined })
    expect(projectParameterMap(surfaceSnapshot({ endpoints: [demoEndpoint([declaredOnly])] }))).toMatchObject({ queue: [], emptyState: "DEFINITIONS_ONLY" })
    expect(projectParameterMap(surfaceSnapshot({ gaps: [parameterGap("no-risk", { priorityReasons: [] })] }))).toMatchObject({ queue: [], emptyState: "NO_MATCHING_GAPS" })
    const result = projectParameterMap(surfaceSnapshot({ diagnostics: [{ evidenceId: "ev-1", operation: "PATCH /orders/{id}", reasonCode: "INPUT_LIMIT", droppedCount: 7 }] }))
    expect(result.diagnostics).toEqual(["PATCH /orders/{id}: INPUT_LIMIT (7)"])
  })

  it("skips unresolved-coordinate facts and keeps source attribution separate from relation style", () => {
    const unresolved = statusParameter({ coordinateResolved: false, canonicalPath: "filters.active", fieldPath: "filters.active", deltaState: "UNRESOLVED_COORDINATE" })
    const snapshot = surfaceSnapshot({ endpoints: [demoEndpoint([unresolved, statusParameter({ profile: { ...statusParameter().profile!, sourceCounts: { HUMAN: 2, SCANNER: 3, LLM: 4 } } })])], gaps: [parameterGap("h", { source: "HUMAN" }), parameterGap("s"), parameterGap("l", { source: "LLM" }), parameterGap("u", { source: null })] })
    const result = projectParameterMap(snapshot, defaultParameterFilters, "h")
    expect(result.nodes.filter(node => node.lane === "target").every(node => node.owner === null)).toBe(true)
    expect(new Set(result.edges.filter(edge => edge.relation === "gap").map(edge => edge.sourceLabel))).toEqual(new Set(["H", "S", "L", "UNKNOWN"]))
    expect(result.edges.find(edge => edge.relation === "observation")).toMatchObject({ trafficSource: "UNKNOWN", sourceRole: "OBSERVATION", sourceAttribution: [
      { source: "HUMAN", label: "H", observationCount: 2 }, { source: "SCANNER", label: "S", observationCount: 3 }, { source: "LLM", label: "L", observationCount: 4 },
    ] })
    expect(result.nodes.filter(node => node.focused).map(node => node.selection.gapId)).toEqual(["h", "h", "h", "h"])
  })

  it("requires positive target evidence and a known owner instead of copying input observation onto targets", () => {
    const links = [
      { resource: null, confidence: "OBSERVED" as const, basis: "unknown", evidenceIds: [], evidenceCount: 0 },
      { resource: `${demoResource.replace("101", "1")}`, confidence: "INFERRED" as const, basis: "definition", evidenceIds: [], evidenceCount: 0 },
      { resource: demoResource, confidence: "OBSERVED" as const, basis: "exact", evidenceIds: ["ev-a"], evidenceCount: 1 },
    ]
    const result = projectParameterMap(surfaceSnapshot({ endpoints: [demoEndpoint([statusParameter({ authorizationTargets: links })])], gaps: [parameterGap("source")], owners: { [demoResource]: "USER B" } }))
    const targets = result.nodes.filter(node => node.lane === "target")
    expect(targets.map(node => node.observationState)).toEqual(["UNKNOWN", "UNKNOWN", "OBSERVED"])
    expect(targets.map(node => node.confidence)).toEqual(["UNKNOWN", "UNKNOWN", "OBSERVED"])
    expect(result.edges.find(edge => edge.relation === "unknown-target")?.line).toBe("dotted")
  })

  it("distinguishes each node's own observation from the associated input state", () => {
    // No link evidence: the target lane stays UNKNOWN even though the input itself is observed.
    const result = projectParameterMap(surfaceSnapshot({ endpoints: [demoEndpoint([statusParameter({ authorizationTargets: [] })])], events: [actualEvent()], gaps: [parameterGap("null", { identity: null }), parameterGap("missing", { identity: "B" }), parameterGap("known")] }))
    const node = (gapId: string, lane: string) => result.nodes.find(item => item.selection.gapId === gapId && item.lane === lane)!
    expect(node("null", "condition").observationState).toBe("UNKNOWN")
    expect(node("missing", "condition").observationState).toBe("UNKNOWN")
    expect(node("known", "condition").observationState).toBe("OBSERVED")
    expect(node("known", "operation").observationState).toBe("OBSERVED")
    expect(node("known", "input").observationState).toBe("OBSERVED")
    expect(node("known", "target").observationState).toBe("UNKNOWN")
  })

  it("deeply freezes every output level without freezing or changing the caller", () => {
    const snapshot = structuredClone(surfaceSnapshot({ endpoints: [demoEndpoint([statusParameter({ declarations: [declaration()] })])], gaps: [parameterGap("source")], cells: [validationCell()] }))
    const before = structuredClone(snapshot)
    const result = projectParameterMap(snapshot, defaultParameterFilters, "source")
    const outputBefore = JSON.stringify(result)
    let attempted = 0
    const attackEveryObject = (value: unknown) => {
      if (!value || typeof value !== "object") return
      for (const child of Object.values(value)) attackEveryObject(child)
      for (const field of Object.keys(value)) {
        try { (value as Record<string, unknown>)[field] = "MUTATED" } catch { /* frozen object */ }
        attempted++
      }
    }
    attackEveryObject(result)
    expect(snapshot).toEqual(before)
    expect(JSON.stringify(result)).toBe(outputBefore)
    expect(attempted).toBeGreaterThan(50)
    const callerObjectsAreMutable = (value: unknown): boolean => !value || typeof value !== "object" || (!Object.isFrozen(value) && Object.values(value).every(callerObjectsAreMutable))
    expect(callerObjectsAreMutable(snapshot)).toBe(true)
  })

  it("indexes 5,000 parameters and gaps once and bounds graph output", () => {
    const parameters = Array.from({ length: 5_000 }, (_, i) => statusParameter({ canonicalPath: `/p${i}`, fieldPath: `p${i}` }))
    const gaps = parameters.map((parameter, i) => parameterGap(`g${i}`, { canonicalPath: parameter.canonicalPath }))
    const result = projectParameterMap(surfaceSnapshot({ endpoints: [demoEndpoint(parameters)], gaps }))
    expect(result.queue).toHaveLength(5_000)
    expect(result.nodes).toHaveLength(160)
    expect(result.hiddenGapCount).toBe(4_960)
  })
})
