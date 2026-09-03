import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import { ResponsiveGraphList } from "./ResponsiveGraphList"
import type { GraphProjection } from "./graphProjection"

const selection = { operation: "GET /orders/{id}", resource: "order:1", identity: "alice", source: "human" as const, evidenceIds: ["e-1", "e-2"] }
const candidateSelection = { operation: "UNKNOWN /unseen/{id}", resource: null, identity: null, source: "human" as const, evidenceIds: ["route-evidence"], routeCandidate: { id: "route-candidate:1", service: "https://api.example.test", method: "UNKNOWN", pathTemplate: "/unseen/{id}", observed: false, applicability: "REVIEW", provenanceTypes: ["SITE_MAP"], provenanceEvidenceIds: ["route-evidence"], provenance: [{ type: "SITE_MAP", evidenceId: "route-evidence", source: "human", runId: "run-1", adapter: "burp", applicability: "REVIEW", reason: "candidate" }], reviewReason: "needs review", priorityReasons: ["input"] } }
const projection: GraphProjection = {
  identities: [], resources: [], routeCandidates: [{ ...candidateSelection.routeCandidate, id: "route-candidate:1", label: "UNKNOWN /unseen/{id}", observedText: "미관측 후보", selection: candidateSelection }], edges: [{ id: "edge", sourceId: "identity:alice", targetId: "operation:GET /orders/{id}", relation: "identity-operation", source: "human", sourceText: "HUMAN", line: "solid", color: "#2563eb", count: 2, countLabel: "×2", selection }],
  operations: [{ id: "operation:GET /orders/{id}", kind: "operation", label: "GET /orders/{id}", wrappedLabel: "GET\n/orders\n/{id}", verdict: "allow", verdictText: "ALLOW", verdictColor: "#15803d", selection }],
  listItems: [{ id: "operation:GET /orders/{id}", kind: "operation", label: "GET /orders/{id}", wrappedLabel: "GET\n/orders\n/{id}", verdict: "allow", verdictText: "ALLOW", verdictColor: "#15803d", selection }],
}

it("presents the same projected operation semantics as a keyboard-accessible list", async () => {
  const select = vi.fn()
  render(<ResponsiveGraphList projection={projection} onSelect={select} />)
  await userEvent.click(screen.getByRole("button", { name: /GET \/orders\/\{id\}/ }))
  expect(screen.getByText("HUMAN · ALLOW · ×2")).toBeVisible()
  expect(screen.getByText("alice · order:1")).toBeVisible()
  expect(select).toHaveBeenCalledWith(selection)
})

it("keeps candidate Evidence IDs outside the candidate button name while rendering full provenance detail", () => {
  render(<ResponsiveGraphList projection={projection} onSelect={vi.fn()} />)
  const candidate = screen.getByRole("button", { name: /UNKNOWN \/unseen\/\{id\}/ })
  expect(candidate).not.toHaveAccessibleName(/route-evidence/)
  const evidenceId = screen.getByText("route-evidence")
  expect(evidenceId).toBeVisible()
  expect(evidenceId.closest("button")).toBeNull()
  expect(screen.getAllByText(/https:\/\/api\.example\.test/).length).toBeGreaterThan(0)
  expect(screen.getByText(/burp/)).toBeVisible()
})
