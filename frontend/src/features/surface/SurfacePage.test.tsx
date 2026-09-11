import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import { AppProviders } from "@/app/AppProviders"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { snapshotFixture } from "@/test/fixtures"
import { SurfacePage } from "./SurfacePage"

vi.mock("@/lib/query/hooks", () => ({
  useSnapshotQuery: () => ({ data: (globalThis as { surfaceFixture?: Snapshot }).surfaceFixture, isLoading: false, isError: false }),
  useRequirementMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTrafficOverrideMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOwnerMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  queryKeys: { snapshot: ["snapshot"] },
}))

const surfaceEvent: EventRecord = {
  eventId: "ev-human", method: "POST", path: "/api/order/search", status: 200,
  fp: "anon", idn: "anon", role: "ANONYMOUS", source: "human",
  op: "POST /api/order/search", resource: "products:1", timestamp: 1,
  sourceDetail: "BURP_BROWSER", orchestrator: "HUMAN", tool: "BURP", phase: "EXPLORATION",
  executionTrust: "OBSERVED", runId: "human-1", authState: "ANONYMOUS",
  trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true,
  classificationOverride: false, classificationReasons: [], pathTemplateStatus: "LITERAL",
  pathTemplateReasons: [], clusterId: "cluster-human", repeatCount: 1, firstSeen: 1, lastSeen: 1,
  objects: [{ resource: "products:1", evidence: "BODY_ID" }], verdict: "untested",
}

it("shows server-provided endpoint and parameter deltas without inventing coverage percentages", async () => {
  ;(globalThis as { surfaceFixture?: Snapshot }).surfaceFixture = { ...snapshotFixture, events: [surfaceEvent], surface: { extractions: [], probes: [], endpoints: [{ key: { service: "https://api.example.test:443", method: "POST", pathTemplate: "/api/order/search" }, observedSources: ["HUMAN"], observations: [{ evidenceId: "ev-human", source: "HUMAN", runId: "human-1", identity: "user-a", status: 200 }], declarations: [{ evidenceId: "ev-js", source: "HUMAN", runId: "human-1", type: "JAVASCRIPT", adapter: "fetch", reason: "static call" }], deltaState: "ONE_SOURCE_OBSERVED", parameters: [{ location: "JSON_BODY", fieldPath: "/product_id", displayName: "product_id", requirement: "UNKNOWN", observedShapes: ["INTEGER"], observedSources: ["HUMAN"], observationEvidenceIds: ["ev-human"], observations: [{ evidenceId: "ev-human", source: "HUMAN", runId: "human-1", identity: "user-a", status: 200, shape: "INTEGER", valueType: "INTEGER", presence: "PRESENT", byteLength: 3, masked: false }], declarations: [], deltaState: "ONE_SOURCE_OBSERVED", canonicalPath: "/product_id", observedValueTypes: ["INTEGER"], distinctValueCount: 1 }] }] } }

  render(<AppProviders><SurfacePage /></AppProviders>)

  expect(screen.getByRole("heading", { name: "API·입력 차이" })).toBeVisible()
  expect(screen.getByText("/api/order/search")).toBeVisible()
  expect(screen.getAllByText("H").length).toBeGreaterThan(0)
  expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  screen.getByRole("button", { name: "상세 보기" }).click()
  expect(await screen.findByText(/product_id/)).toBeVisible()
  expect(screen.getByText("ev-human")).toBeVisible()
  await userEvent.setup().click(screen.getByRole("button", { name: "Evidence 상세 · H · HTTP 200" }))
  expect(screen.getByRole("button", { name: "Request Lab 열기" })).toBeVisible()
  expect(screen.getByRole("button", { name: "Repeater 초안 열기" })).toBeVisible()
})

it("recomputes source deltas and exposes controlled-request failure quality without creating Evidence", async () => {
  ;(globalThis as { surfaceFixture?: Snapshot }).surfaceFixture = { ...snapshotFixture, runExecutions: [{ source: "LLM", runId: "llm-failed", attempted: 3, responses: 0, failures: 3, quality: "ALL_FAILED", outcomes: { TLS_FAILURE: 3 } }], surface: { extractions: [], probes: [], endpoints: [{ key: { service: "https://api.example.test:443", method: "GET", pathTemplate: "/api/orders/{id}" }, observedSources: ["HUMAN", "LLM"], observations: [{ evidenceId: "ev-human", source: "HUMAN", runId: "human-1", identity: "user-a", status: 200 }, { evidenceId: "ev-llm", source: "LLM", runId: "llm-1", identity: "user-a", status: 404 }], declarations: [{ evidenceId: "ev-js", source: "HUMAN", runId: "human-1", type: "JAVASCRIPT", adapter: "fetch", reason: "static call" }], deltaState: "MULTI_SOURCE_OBSERVED", parameters: [] }] } }

  render(<AppProviders><SurfacePage /></AppProviders>)

  expect(screen.getByText("실제 응답 있음 · 두 source")).toBeVisible()
  expect(screen.getByText(/LLM 실행 · ALL_FAILED/)).toBeVisible()
  expect(screen.getByText(/시도 3 · 응답 0 · 실패 3 · TLS_FAILURE 3/)).toBeVisible()
  await userEvent.setup().click(screen.getByRole("checkbox", { name: "L · LLM" }))
  expect(screen.getByText("실제 응답 있음 · 한 source")).toBeVisible()
  expect(screen.queryByText(/LLM 실행 · ALL_FAILED/)).not.toBeInTheDocument()
})

it("filters LLM-only declarations and probes without turning them into observations", async () => {
  ;(globalThis as { surfaceFixture?: Snapshot }).surfaceFixture = {
    ...snapshotFixture,
    surface: {
      extractions: [],
      probes: [{ key: { service: "https://api.example.test:443", method: "OPTIONS", pathTemplate: "/api/orders" }, evidenceId: "ev-probe", source: "LLM", runId: "llm-1", identity: "anon", status: 204 }],
      endpoints: [{
        key: { service: "https://api.example.test:443", method: "GET", pathTemplate: "/api/declared" },
        observedSources: [],
        observations: [],
        declarations: [{ evidenceId: "ev-artifact", source: "LLM", runId: "llm-1", type: "LLM_ARTIFACT_ANALYSIS", adapter: "llm-javascript", reason: "main.js:1" }],
        deltaState: "DECLARED_NOT_OBSERVED",
        parameters: [],
      }],
    },
  }

  render(<AppProviders><SurfacePage /></AppProviders>)

  expect(screen.getByText("/api/declared")).toBeVisible()
  expect(screen.getByText("산출물에서 발견 · 아직 요청 없음")).toBeVisible()
  expect(screen.getByText("OPTIONS probe").parentElement).toHaveTextContent("1")
  await userEvent.setup().click(screen.getByRole("checkbox", { name: "L · LLM" }))
  expect(screen.queryByText("/api/declared")).not.toBeInTheDocument()
  expect(screen.getByText("OPTIONS probe").parentElement).toHaveTextContent("0")
})
