import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import type { Cell, EventRecord } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { GraphInspectorPanel, GRAPH_OPEN_HINT } from "./GraphInspectorPanel"
import { navigateHierarchy, projectHierarchy, type GraphNavigation } from "./graphHierarchy"
import type { GraphFilters } from "./graphProjection"
import { renderWithQueryClient } from "@/test/render"

const service = "https://demo.test:443"
const cell = (overrides: Partial<Cell>): Cell => ({ idn: "USER A", op: `${service} GET /api/orders/{id}`, resource: "orders:101", perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: [], ...overrides })
const snapshot = targetSnapshot({ activeSources: ["human"], cells: [cell({ overall: "suspicious" }), cell({ idn: "USER B", resource: "orders:202" }), cell({ op: `${service} PATCH /api/orders/{id}` })] })
const filters: GraphFilters = { source: ["human", "scanner", "llm"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }
const site: GraphNavigation = { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }

it("summarises an API group with candidates first and opens the group from the button", async () => {
  const projection = projectHierarchy(snapshot, filters, site)
  const group = projection.nodes.find(node => node.kind === "api-group")!
  const onOpenGroup = vi.fn(), onRevealOperation = vi.fn()
  renderWithQueryClient(<GraphInspectorPanel selection={group.selection} event={null} snapshot={snapshot} node={group} projection={projection} actions={{ onOpenGroup, onRevealOperation }} />)
  const summary = screen.getByRole("region", { name: "API 그룹 요약" })
  expect(within(summary).getByText("API").nextElementSibling).toHaveTextContent("2")
  const candidates = within(summary).getByRole("list", { name: "IDOR·BFLA 후보 목록" })
  expect(within(candidates).getByText("/api/orders/{id}")).toBeVisible()
  expect(within(candidates).getByText(/후보$/)).toBeVisible()
  await userEvent.click(within(candidates).getAllByRole("button")[0])
  expect(onRevealOperation).toHaveBeenCalledWith(group.groupId, expect.stringContaining("GET /api/orders/{id}"))
  expect(screen.queryByText(GRAPH_OPEN_HINT)).not.toBeInTheDocument()
  await userEvent.click(within(summary).getByRole("button", { name: "이 그룹 열기 →" }))
  expect(onOpenGroup).toHaveBeenCalledWith(group.groupId)
})

it("summarises an identity inside a group without repeating the open hint", () => {
  const projection = projectHierarchy(snapshot, filters, navigateHierarchy(site, "group", group()))
  const identity = projection.identities.find(node => node.selection.identity === "USER A")!
  renderWithQueryClient(<GraphInspectorPanel selection={identity.selection} event={null} snapshot={snapshot} node={identity} projection={projection} />)
  const summary = screen.getByRole("region", { name: "노드 요약" })
  expect(within(summary).getByText("접근 API").nextElementSibling).toHaveTextContent("2")
  expect(screen.queryByText(GRAPH_OPEN_HINT)).not.toBeInTheDocument()
})

function group() { return projectHierarchy(snapshot, filters, site).nodes.find(node => node.kind === "api-group")!.groupId! }

it("lists who accessed an object, marking the owner", () => {
  const withOwner = { ...snapshot, owners: { ...snapshot.owners, [`orders:101`]: "USER A" } }
  const operation = navigateHierarchy(navigateHierarchy(site, "group", group()), "operation", group(), `${service} GET /api/orders/{id}`)
  const projection = projectHierarchy(withOwner, filters, operation)
  const object = projection.resources.find(node => node.selection.resource === "orders:101")!
  renderWithQueryClient(<GraphInspectorPanel selection={object.selection} event={null} snapshot={withOwner} node={object} projection={projection} />)
  const summary = screen.getByRole("region", { name: "노드 요약" })
  expect(within(summary).getByText("계정").nextElementSibling).toHaveTextContent("1")
  expect(within(summary).getByText(/접근한 계정/)).toBeVisible()
  expect(within(summary).getByText("SUSPICIOUS")).toBeVisible()
})

it("shows a publicly readable object as 공개 instead of naming an owner", () => {
  const operationKey = `${service} GET /api/orders/{id}`
  const publicSnapshot = { ...snapshot, owners: { ...snapshot.owners, "orders:101": "USER A" }, authorizationMatrix: { functions: [], evidence: [], objects: [{ operation: operationKey, resource: "orders:101", resourcePolicy: "PUBLIC" }] } } as unknown as typeof snapshot
  const projection = projectHierarchy(publicSnapshot, filters, navigateHierarchy(navigateHierarchy(site, "group", group()), "operation", group(), operationKey))
  const object = projection.resources.find(node => node.selection.resource === "orders:101")!
  renderWithQueryClient(<GraphInspectorPanel selection={object.selection} event={null} snapshot={publicSnapshot} node={object} projection={projection} />)
  const summary = screen.getByRole("region", { name: "노드 요약" })
  expect(within(summary).getByText("접근한 계정 · 조회 공개")).toBeVisible()
  expect(within(summary).queryByText(/소유자 USER A|\(소유자\)/)).not.toBeInTheDocument()
})


it("keeps anonymous verdicts and evidence on one 비로그인 card after selecting an API", () => {
  const anonymousCell = cell({ idn: "anon", overall: "deny", perSource: { human: "deny" } })
  const observed: EventRecord = { eventId: "anon-evidence", method: "GET", path: "/api/orders/101", status: 401, fp: "anon", idn: "anon", role: "Anonymous", source: "human", op: anonymousCell.op, resource: anonymousCell.resource, timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "EXPLORATION", executionTrust: "OBSERVED", runId: "run", authState: "ANONYMOUS", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "anon-cluster", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: [], objects: [], verdict: "deny" }
  anonymousCell.evidenceIds = [observed.eventId]
  const data = targetSnapshot({ cells: [anonymousCell], events: [observed] })
  const groupId = projectHierarchy(data, filters, site).groups[0].id
  const projection = projectHierarchy(data, filters, navigateHierarchy(site, "operation", groupId, anonymousCell.op))
  const api = projection.operations[0]
  renderWithQueryClient(<GraphInspectorPanel selection={api.selection} event={null} snapshot={data} node={api} projection={projection} />)
  const card = screen.getByRole("listitem", { name: "비로그인 요청 기록 1건" })
  expect(within(card).getByText("비로그인")).toBeVisible()
  expect(within(card).getByText("DENY")).toBeVisible()
  expect(screen.queryByText("anon")).not.toBeInTheDocument()
  expect(api.selection.cells[0].idn).toBe("anon")
})
