import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { actualEvent, demoEndpoint, statusParameter } from "./parameterMapFixtures"
import { evidenceParameterContext, ParameterRequestDiff } from "./ParameterRequestDiff"
import { parameterMapKey } from "./parameterProjection"

const key = parameterMapKey(demoEndpoint().key, "JSON_BODY", "/status")

it("compares structured metadata side by side and never reads HTTP fields", () => {
  const parameter = { key, presence: "PRESENT" as const, shape: "SCALAR" as const, valueType: "STRING" as const, occurrenceCount: null, digest: null, byteLength: 3, confidence: "OBSERVED", contextSignature: "ctx" }
  const left = { eventId: "a", service: key.service, method: "PATCH", operation: key.operation, identity: "A", role: "USER", source: "HUMAN", status: 200, verdict: "UNDECIDED", complete: false, retention: "METADATA_ONLY" as const, parameters: [parameter] }
  Object.defineProperty(left, "request", { get() { throw new Error("raw must not be read") } })
  render(<ParameterRequestDiff left={left} right={{ ...left, eventId: "b", status: 403, verdict: "DENY", parameters: [{ ...parameter, presence: "EXPLICIT_NULL", shape: "NULL", valueType: "UNKNOWN" }] }} />)
  expect(screen.getByRole("columnheader", { name: "기준 요청 a" })).toBeVisible()
  expect(screen.getByRole("columnheader", { name: "비교 요청 b" })).toBeVisible()
  expect(screen.getByText(/PRESENCE_CHANGED/)).toHaveTextContent("SHAPE_CHANGED")
  expect(screen.getByText(/PRESENCE_CHANGED/)).toHaveTextContent("TYPE_CHANGED")
  expect(screen.getByText(/200 · UNDECIDED/)).toBeVisible()
  expect(screen.getByText(/403 · DENY/)).toBeVisible()
  expect(screen.getByText(/STATUS_CHANGED/)).toHaveTextContent("VERDICT_CHANGED")
  expect(screen.getAllByText("길이: 3 bytes")).toHaveLength(2)
  expect(screen.getAllByText(/문맥: ctx/)).toHaveLength(2)
  expect(screen.getAllByText("관측 신뢰: OBSERVED")).toHaveLength(2)
  expect(screen.getByText(/불완전.*UNKNOWN/)).toBeVisible()
  expect(screen.getByText(/미관측 ≠ 미존재/)).toBeVisible()
})

it("does not turn a missing observation into absence when completeness was not recorded", () => {
  const context = { eventId: "a", service: key.service, method: "PATCH", operation: key.operation, identity: "A", role: "USER", source: "HUMAN", status: 200, verdict: "UNDECIDED", complete: false, retention: "RETAINED" as const, parameters: [{ key, presence: "PRESENT" as const, shape: "SCALAR" as const, valueType: "STRING" as const, occurrenceCount: null, digest: null }] }
  render(<ParameterRequestDiff left={context} right={{ ...context, eventId: "b", parameters: [] }} />)
  expect(screen.getByText("INCOMPLETE_CONTEXT")).toBeVisible()
  expect(screen.queryByText("ABSENT_OBSERVED_CONTEXT")).not.toBeInTheDocument()
  expect(screen.queryByText(/PRESENCE_CHANGED/)).not.toBeInTheDocument()
})

it("builds evidence contexts from Surface facts and endpoint request contexts without values", () => {
  const endpoint = demoEndpoint([statusParameter({ observations: [
    { evidenceId: "actual-a", source: "HUMAN", runId: "run", identity: "USER A", status: 200, shape: "INTEGER", presence: "PRESENT", valueType: "STRING", byteLength: 1, contextSignature: "ctx:v1:sha256:aa", confidence: "OBSERVED" },
    { evidenceId: "actual-b", source: "SCANNER", runId: "run", identity: "USER B", status: 403, shape: "NULL", presence: "EXPLICIT_NULL", valueType: "UNKNOWN", byteLength: 0 },
  ] })], { requestContexts: [{ evidenceId: "actual-a", complete: true, retained: true, discovery: true, contextSignature: "ctx:v1:sha256:aa" }, { evidenceId: "actual-c", complete: false, retained: false, discovery: true, contextSignature: "ctx:v1:sha256:cc" }] })
  const header = (event: ReturnType<typeof actualEvent>) => ({ identity: event.idn, role: event.role, source: event.source.toUpperCase(), status: event.status, verdict: event.verdict.toUpperCase() })
  const a = evidenceParameterContext(endpoint, "actual-a", header(actualEvent()))
  expect(a).toMatchObject({ complete: true, retention: "RETAINED", operation: key.operation })
  expect(a.parameters[0]).toMatchObject({ key, presence: "PRESENT", shape: "SCALAR", displayShape: "INTEGER", valueType: "STRING", digest: null, occurrenceCount: null, byteLength: 1, confidence: "OBSERVED" })
  const b = evidenceParameterContext(endpoint, "actual-b", header(actualEvent({ eventId: "actual-b" })))
  expect(b).toMatchObject({ complete: false, retention: "UNKNOWN", completenessReason: "COMPLETENESS_NOT_RECORDED" })
  expect(b.parameters[0]).toMatchObject({ presence: "EXPLICIT_NULL", shape: "NULL", valueType: "UNKNOWN" })
  const c = evidenceParameterContext(endpoint, "actual-c", header(actualEvent({ eventId: "actual-c" })))
  expect(c).toMatchObject({ complete: false, retention: "METADATA_ONLY", parameters: [] })
  expect(JSON.stringify([a, b, c])).not.toMatch(/READY|digest":"[a-f0-9]/)
})
