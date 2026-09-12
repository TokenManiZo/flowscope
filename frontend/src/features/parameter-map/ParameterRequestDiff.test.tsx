import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { demoEndpoint } from "./parameterMapFixtures"
import { ParameterRequestDiff } from "./ParameterRequestDiff"
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
  expect(screen.getAllByText("SHA-256: UNKNOWN · digest 사용 불가")).toHaveLength(2)
  expect(screen.getByText(/불완전.*UNKNOWN/)).toBeVisible()
  expect(screen.getByText(/미관측 ≠ 미존재/)).toBeVisible()
})

it("reports a value change only from differing server digests and shows the digests it compared", () => {
  const parameter = { key, presence: "PRESENT" as const, shape: "SCALAR" as const, valueType: "STRING" as const, occurrenceCount: 1, digest: "a".repeat(64), byteLength: 4 }
  const context = { eventId: "a", service: key.service, method: "PATCH", operation: key.operation, identity: "A", role: "USER", source: "HUMAN", status: 200, verdict: "ALLOW", complete: true, retention: "RETAINED" as const, parameters: [parameter] }
  render(<ParameterRequestDiff left={context} right={{ ...context, eventId: "b", parameters: [{ ...parameter, digest: "b".repeat(64) }] }} />)
  expect(screen.getByText(/VALUE_CHANGED/)).toBeVisible()
  expect(screen.getByText(`SHA-256: ${"a".repeat(64)}`)).toBeVisible()
  expect(screen.getByText(`SHA-256: ${"b".repeat(64)}`)).toBeVisible()
  expect(screen.getAllByText("발생 수: 1")).toHaveLength(2)
  expect(screen.getByText(/구조화된 관측 문맥입니다/)).toBeVisible()
})

it("does not turn a missing observation into absence when completeness was not recorded", () => {
  const context = { eventId: "a", service: key.service, method: "PATCH", operation: key.operation, identity: "A", role: "USER", source: "HUMAN", status: 200, verdict: "UNDECIDED", complete: false, retention: "RETAINED" as const, completenessReason: "REQUEST_NOT_RETAINED", parameters: [{ key, presence: "PRESENT" as const, shape: "SCALAR" as const, valueType: "STRING" as const, occurrenceCount: null, digest: null }] }
  render(<ParameterRequestDiff left={context} right={{ ...context, eventId: "b", parameters: [] }} />)
  expect(screen.getByText("INCOMPLETE_CONTEXT")).toBeVisible()
  expect(screen.getByText(/REQUEST_NOT_RETAINED · 전체 추출 완전성/)).toBeVisible()
  expect(screen.queryByText("ABSENT_OBSERVED_CONTEXT")).not.toBeInTheDocument()
  expect(screen.queryByText(/PRESENCE_CHANGED/)).not.toBeInTheDocument()
})
