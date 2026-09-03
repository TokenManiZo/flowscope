import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it } from "vitest"

import type { Snapshot } from "@/lib/api/types"
import { renderWithQueryClient } from "@/test/render"
import { GraphInspectorPanel } from "./GraphInspectorPanel"
import type { GraphSelection } from "./graphProjection"

const event: Snapshot["events"][number] = {
  eventId: "ev-1", method: "GET", path: "/orders/1", status: 200, fp: "fp", idn: "alice", role: "USER", source: "human", op: "GET /orders/{id}", resource: "order:1", timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["ev-1"], objects: [{ resource: "order:1", evidence: "id" }], verdict: "allow",
}

const snapshot: Snapshot = {
  revision: 1, identityRevision: 1, sampleMode: true, trafficStats: { captured: 1, coverage: 1, excluded: 0, review: 0, dropped: 0, payloadMetadataOnly: 0 }, replays: [], flowLinks: [], roles: { alice: "USER" }, owners: { "order:1": "alice" }, requiredRoles: { "GET /orders/{id}": "USER" }, activeSources: ["human"], gaps: [], scenarios: [], accounts: [], sessions: [], managedSessions: [], routeCandidates: [], verifications: [], events: [event], cells: [{ idn: "alice", op: "GET /orders/{id}", resource: "order:1", perSource: { human: "allow" }, reasons: { human: "owner access" }, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["ev-1"] }],
}

const selection: GraphSelection = { operation: "GET /orders/{id}", resource: "order:1", identity: "alice", source: "human", evidenceIds: ["ev-1"] }

it("shows the selected operation overview and server-projected access check", () => {
  renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={snapshot} />)

  expect(screen.getByRole("complementary", { name: "선택 작업" })).toBeVisible()
  expect(screen.getAllByText("GET /orders/{id}").length).toBeGreaterThan(0)
  expect(screen.getByRole("region", { name: "Access Check" })).toHaveTextContent("ALLOW")
  expect(screen.getByRole("region", { name: "Access Check" })).toHaveTextContent("필수 역할 USER")
  expect(screen.getByRole("region", { name: "Access Check" })).toHaveTextContent("소유자 alice")
})

it("keeps Summary, Evidence, Request, Response, and Policy details in accessible tabs", async () => {
  renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={snapshot} />)

  expect(screen.getByRole("tab", { name: "Summary" })).toBeVisible()
  expect(screen.getByRole("tab", { name: "Policy" })).toBeVisible()

  await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))
  const evidencePanel = screen.getByRole("tabpanel", { name: "Evidence" })
  expect(evidencePanel).toHaveTextContent("ev-1")
  expect(evidencePanel).toHaveTextContent("메서드GET")
  expect(evidencePanel).toHaveTextContent("경로/orders/1")
  expect(evidencePanel).toHaveTextContent("HTTP 상태200")
  expect(within(evidencePanel).getByRole("button", { name: "Request Lab 열기" })).toBeVisible()
  expect(within(evidencePanel).getByRole("button", { name: "Repeater 초안 열기" })).toBeVisible()

  await userEvent.click(screen.getByRole("tab", { name: "Request" }))
  expect(screen.getByRole("tabpanel", { name: "Request" })).toHaveTextContent("GET /orders/1")
  expect(screen.getByRole("tabpanel", { name: "Request" })).toHaveTextContent("Request Lab")

  await userEvent.click(screen.getByRole("tab", { name: "Response" }))
  expect(screen.getByRole("tabpanel", { name: "Response" })).toHaveTextContent("HTTP 200")
  expect(screen.getByRole("tabpanel", { name: "Response" })).toHaveTextContent("Request Lab")

  await userEvent.click(screen.getByRole("tab", { name: "Policy" }))
  const policy = screen.getByRole("tabpanel", { name: "Policy" })
  expect(policy).toHaveTextContent("필수 역할")
  expect(policy).toHaveTextContent("USER")
  expect(policy).toHaveTextContent("소유자")
  expect(policy).toHaveTextContent("alice")
})

it("bounds collapsed Evidence by count and length without leaking hidden values into ARIA or live regions", async () => {
  const longEvidence = `ev-${"x".repeat(200)}`
  const boundedSelection = { ...selection, evidenceIds: [longEvidence, "ev-2", "ev-3", "ev-4", "ev-5"] }
  const { container } = renderWithQueryClient(<GraphInspectorPanel selection={boundedSelection} event={event} snapshot={snapshot} />)

  await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))
  const evidencePanel = screen.getByRole("tabpanel", { name: "Evidence" })
  expect(evidencePanel).toHaveTextContent("5개 Evidence")
  expect(evidencePanel).toHaveTextContent(`${longEvidence.slice(0, 160)}…`)
  expect(evidencePanel).not.toHaveTextContent(longEvidence)
  expect(evidencePanel).toHaveTextContent("ev-3")
  expect(evidencePanel).not.toHaveTextContent("ev-4")
  expect(evidencePanel).not.toHaveTextContent("ev-5")

  const ariaAndLiveValues = [...container.querySelectorAll("[aria-label], [aria-labelledby], [aria-describedby], [aria-live]")]
    .flatMap((element) => ["aria-label", "aria-labelledby", "aria-describedby", "aria-live"].map((attribute) => element.getAttribute(attribute) ?? ""))
    .join(" ")
  expect(ariaAndLiveValues).not.toContain(longEvidence)
  expect(ariaAndLiveValues).not.toContain("ev-4")
  expect(container.querySelector("[aria-live]")).not.toBeInTheDocument()
})
