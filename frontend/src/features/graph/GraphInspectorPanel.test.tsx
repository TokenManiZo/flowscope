import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it } from "vitest"

import type { Snapshot } from "@/lib/api/types"
import { renderWithQueryClient } from "@/test/render"
import { GraphInspectorPanel } from "./GraphInspectorPanel"
import { graphCellSelection, type GraphSelection } from "./graphProjection"

const event: Snapshot["events"][number] = {
  eventId: "ev-1", method: "GET", path: "/orders/1", status: 200, fp: "fp", idn: "alice", role: "USER", source: "human", op: "GET /orders/{id}", resource: "order:1", timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["ev-1"], objects: [{ resource: "order:1", evidence: "id" }], verdict: "allow",
}

const snapshot: Snapshot = {
  revision: 1, identityRevision: 1, sampleMode: true, trafficStats: { captured: 1, coverage: 1, excluded: 0, review: 0, dropped: 0, payloadMetadataOnly: 0 }, replays: [], flowLinks: [], roles: { alice: "USER" }, owners: { "order:1": "alice" }, requiredRoles: { "GET /orders/{id}": "USER" }, activeSources: ["human"], gaps: [], scenarios: [], accounts: [], sessions: [], managedSessions: [], routeCandidates: [], verifications: [], events: [event], cells: [{ idn: "alice", op: "GET /orders/{id}", resource: "order:1", perSource: { human: "allow" }, reasons: { human: "owner access" }, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["ev-1"] }],
}

const selection: GraphSelection = { operation: "GET /orders/{id}", resource: "order:1", identity: "alice", source: "human", evidenceIds: ["ev-1"] }

it("keeps collapsed raw cells and gaps distinct without inventing an aggregate verdict or UNKNOWN source", () => {
  const cells = [snapshot.cells[0], { ...snapshot.cells[0], resource: "order:2", overall: "deny" as const, evidenceIds: ["raw-2"] }]
  const aggregated = { ...graphCellSelection(cells), gapIds: ["gap-raw"] }
  renderWithQueryClient(<GraphInspectorPanel selection={aggregated} event={event} snapshot={{ ...snapshot, cells }} />)
  expect(screen.getByRole("region", { name: "Access Check" })).toHaveTextContent("복수 셀")
  expect(screen.getByRole("region", { name: "서버 원본 셀" })).toHaveTextContent("order:1")
  expect(screen.getByRole("region", { name: "서버 원본 셀" })).toHaveTextContent("order:2")
  expect(screen.getByRole("region", { name: "서버 원본 셀" })).toHaveTextContent("DENY")
  expect(screen.getByText("gap-raw")).toBeVisible()
  expect(screen.queryByText("UNKNOWN")).not.toBeInTheDocument()
})

it("refreshes collapsed cell verdicts from the current snapshot using canonical keys", () => {
  const cells = [snapshot.cells[0], { ...snapshot.cells[0], resource: "order:2", overall: "deny" as const, evidenceIds: ["raw-2"] }]
  const aggregated = { ...graphCellSelection(cells), gapIds: [] }
  renderWithQueryClient(<GraphInspectorPanel selection={aggregated} event={event} snapshot={{ ...snapshot, revision: 2, cells: [cells[0], { ...cells[1], overall: "suspicious" }] }} />)
  expect(screen.getByRole("region", { name: "서버 원본 셀" })).toHaveTextContent("SUSPICIOUS")
  expect(screen.getByRole("region", { name: "서버 원본 셀" })).not.toHaveTextContent("DENY")
})

it("uses the surviving canonical cell's verdict and reasons when an aggregate shrinks to one cell", () => {
  const survivor = { ...snapshot.cells[0], resource: "order:2", overall: "deny" as const, reasons: { human: "surviving server denial" }, evidenceIds: ["raw-survivor"] }
  const aggregate = { ...graphCellSelection([snapshot.cells[0], survivor]), gapIds: [] }
  const { rerender } = renderWithQueryClient(<GraphInspectorPanel selection={aggregate} event={event} snapshot={{ ...snapshot, cells: [snapshot.cells[0], survivor] }} />)
  rerender(<GraphInspectorPanel selection={aggregate} event={event} snapshot={{ ...snapshot, revision: 2, cells: [survivor] }} />)
  const access = screen.getByRole("region", { name: "Access Check" })
  expect(access).toHaveTextContent("DENY")
  expect(access).not.toHaveTextContent("ALLOW")
  expect(access).toHaveTextContent("surviving server denial")
  expect(screen.getByText("order:2")).toBeVisible()
})

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
  expect(within(evidencePanel).getByRole("button", { name: "현재 세션으로 Repeater 준비" })).toBeVisible()

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

it("shows the Evidence ordinal only and never the raw event id or a live region", async () => {
  const boundedSelection = { ...selection, evidenceIds: ["ev-1", "ev-2", "ev-3", "ev-4", "ev-5"] }
  const { container } = renderWithQueryClient(<GraphInspectorPanel selection={boundedSelection} event={event} snapshot={{ ...snapshot, evidenceOrdinals: { "ev-1": 7 } }} />)

  await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))
  const evidencePanel = screen.getByRole("tabpanel", { name: "Evidence" })
  expect(evidencePanel).toHaveTextContent("#7")
  expect(evidencePanel).not.toHaveTextContent("ev-1")
  expect(evidencePanel).not.toHaveTextContent("ev-4")

  const ariaAndLiveValues = [...container.querySelectorAll("[aria-label], [aria-labelledby], [aria-describedby], [aria-live]")]
    .flatMap((element) => ["aria-label", "aria-labelledby", "aria-describedby", "aria-live"].map((attribute) => element.getAttribute(attribute) ?? ""))
    .join(" ")
  expect(ariaAndLiveValues).not.toContain("ev-4")
  expect(container.querySelector("[aria-live]")).not.toBeInTheDocument()
})
