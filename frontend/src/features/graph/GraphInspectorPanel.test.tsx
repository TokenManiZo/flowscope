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
  expect(access).toHaveTextContent("surviving server denial")
})

it("shows the selected operation overview and server-projected access check", () => {
  renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={snapshot} />)

  expect(screen.getByRole("complementary", { name: "선택 작업" })).toBeVisible()
  expect(screen.getAllByText("GET /orders/{id}").length).toBeGreaterThan(0)
  expect(screen.getByRole("region", { name: "Access Check" })).toHaveTextContent("ALLOW")
  expect(screen.getByRole("region", { name: "Access Check" })).toHaveTextContent("필수 역할 USER")
  expect(screen.getByRole("region", { name: "Access Check" })).toHaveTextContent("소유자 alice")
})

it("opens traffic directly and edits policies in the separate access-rules tab", async () => {
  renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={snapshot} />)
  expect(screen.getAllByRole("tab")).toHaveLength(2)
  const traffic = screen.getByRole("tabpanel", { name: "트래픽" })
  expect(traffic).toHaveTextContent("HTTP 200")
  expect(within(traffic).getByRole("button", { name: "요청 수정·전송 (Request Lab)" })).toBeVisible()
  await userEvent.click(screen.getByRole("tab", { name: "접근 규칙" }))
  const policy = screen.getByRole("tabpanel", { name: "접근 규칙" })
  expect(within(policy).getByRole("combobox", { name: "필수 역할" })).toHaveValue("USER")
  expect(within(policy).getByRole("combobox", { name: "리소스 소유자" })).toHaveValue("")
  expect(policy).toHaveTextContent("현재 소유자: alice")
})

it("bounds collapsed Evidence by count and length without leaking hidden values into ARIA or live regions", async () => {
  const longEvidence = `ev-${"x".repeat(200)}`
  const boundedSelection = { ...selection, evidenceIds: [longEvidence, "ev-2", "ev-3", "ev-4", "ev-5"] }
  const { container } = renderWithQueryClient(<GraphInspectorPanel selection={boundedSelection} event={event} snapshot={snapshot} />)

  await userEvent.click(screen.getByRole("tab", { name: "트래픽" }))
  const evidencePanel = screen.getByRole("tabpanel", { name: "트래픽" })
  expect(evidencePanel).toHaveTextContent("5개 Evidence")
  expect(evidencePanel).toHaveTextContent(`${longEvidence.slice(0, 160)}…`)
  expect(evidencePanel).not.toHaveTextContent(longEvidence)
  expect(evidencePanel).toHaveTextContent("ev-3")
  expect(evidencePanel).toHaveTextContent("ev-4")
  expect(evidencePanel).toHaveTextContent("ev-5")

  const ariaAndLiveValues = [...container.querySelectorAll("[aria-label], [aria-labelledby], [aria-describedby], [aria-live]")]
    .flatMap((element) => ["aria-label", "aria-labelledby", "aria-describedby", "aria-live"].map((attribute) => element.getAttribute(attribute) ?? ""))
    .join(" ")
  expect(ariaAndLiveValues).not.toContain(longEvidence)
  expect(ariaAndLiveValues).not.toContain("ev-4")
  expect(container.querySelector("[aria-live]")).not.toBeInTheDocument()
})
