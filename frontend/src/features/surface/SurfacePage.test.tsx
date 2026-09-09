import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import { AppProviders } from "@/app/AppProviders"
import type { Snapshot } from "@/lib/api/types"
import { snapshotFixture } from "@/test/fixtures"
import { SurfacePage } from "./SurfacePage"

vi.mock("@/lib/query/hooks", () => ({ useSnapshotQuery: () => ({ data: (globalThis as { surfaceFixture?: Snapshot }).surfaceFixture, isLoading: false, isError: false }) }))

it("shows server-provided endpoint and parameter deltas without inventing coverage percentages", async () => {
  ;(globalThis as { surfaceFixture?: Snapshot }).surfaceFixture = { ...snapshotFixture, surface: { extractions: [], probes: [], endpoints: [{ key: { service: "https://api.example.test:443", method: "POST", pathTemplate: "/api/order/search" }, observedSources: ["HUMAN"], observations: [{ evidenceId: "ev-human", source: "HUMAN", runId: "human-1", identity: "user-a", status: 200 }], declarations: [{ evidenceId: "ev-js", source: "HUMAN", runId: "human-1", type: "JAVASCRIPT", adapter: "fetch", reason: "static call" }], deltaState: "ONE_SOURCE_OBSERVED", parameters: [{ location: "JSON_BODY", fieldPath: "product_id", displayName: "product_id", requirement: "UNKNOWN", observedShapes: ["INTEGER"], observedSources: ["HUMAN"], observationEvidenceIds: ["ev-human"], observations: [{ evidenceId: "ev-human", source: "HUMAN", runId: "human-1", identity: "user-a", status: 200, shape: "INTEGER" }], declarations: [], deltaState: "ONE_SOURCE_OBSERVED" }] }] } }

  render(<AppProviders><SurfacePage /></AppProviders>)

  expect(screen.getByRole("heading", { name: "API·입력 차이" })).toBeVisible()
  expect(screen.getByText("/api/order/search")).toBeVisible()
  expect(screen.getAllByText("H").length).toBeGreaterThan(0)
  expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  screen.getByRole("button", { name: "상세 보기" }).click()
  expect(await screen.findByText(/product_id/)).toBeVisible()
  expect(screen.getByText("ev-human")).toBeVisible()
})

it("recomputes source deltas and exposes controlled-request failure quality without creating Evidence", async () => {
  ;(globalThis as { surfaceFixture?: Snapshot }).surfaceFixture = { ...snapshotFixture, runExecutions: [{ source: "LLM", runId: "llm-failed", attempted: 3, responses: 0, failures: 3, quality: "ALL_FAILED", outcomes: { TLS_FAILURE: 3 } }], surface: { extractions: [], probes: [], endpoints: [{ key: { service: "https://api.example.test:443", method: "GET", pathTemplate: "/api/orders/{id}" }, observedSources: ["HUMAN", "LLM"], observations: [{ evidenceId: "ev-human", source: "HUMAN", runId: "human-1", identity: "user-a", status: 200 }, { evidenceId: "ev-llm", source: "LLM", runId: "llm-1", identity: "user-a", status: 404 }], declarations: [{ evidenceId: "ev-js", source: "HUMAN", runId: "human-1", type: "JAVASCRIPT", adapter: "fetch", reason: "static call" }], deltaState: "MULTI_SOURCE_OBSERVED", parameters: [] }] } }

  render(<AppProviders><SurfacePage /></AppProviders>)

  expect(screen.getByText("복수 소스 관측")).toBeVisible()
  expect(screen.getByText(/LLM 실행 · ALL_FAILED/)).toBeVisible()
  expect(screen.getByText(/시도 3 · 응답 0 · 실패 3 · TLS_FAILURE 3/)).toBeVisible()
  await userEvent.setup().click(screen.getByRole("checkbox", { name: "L · LLM" }))
  expect(screen.getByText("한 소스만 관측")).toBeVisible()
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
  expect(screen.getByText("선언됨 · 미관측")).toBeVisible()
  expect(screen.getByText("OPTIONS probe").parentElement).toHaveTextContent("1")
  await userEvent.setup().click(screen.getByRole("checkbox", { name: "L · LLM" }))
  expect(screen.queryByText("/api/declared")).not.toBeInTheDocument()
  expect(screen.getByText("OPTIONS probe").parentElement).toHaveTextContent("0")
})
