import { screen, within } from "@testing-library/react"
import { expect, it } from "vitest"

import type { Cell } from "@/lib/api/types"
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

it("summarises an API group on a single click and shows the open hint only in Site view", () => {
  const projection = projectHierarchy(snapshot, filters, site)
  const group = projection.nodes.find(node => node.kind === "api-group")!
  renderWithQueryClient(<GraphInspectorPanel selection={group.selection} event={null} snapshot={snapshot} node={group} projection={projection} />)
  const summary = screen.getByRole("region", { name: "노드 요약" })
  expect(within(summary).getByText("API").nextElementSibling).toHaveTextContent("2")
  expect(within(summary).getByText("GET /api/orders/{id}")).toBeVisible()
  expect(within(summary).getByText("SUSPICIOUS")).toBeVisible()
  expect(within(summary).getByText(GRAPH_OPEN_HINT)).toBeVisible()
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
  expect(within(summary).getByText("접근 신원").nextElementSibling).toHaveTextContent("1")
  expect(within(summary).getByText(/접근한 신원/)).toBeVisible()
  expect(within(summary).getByText("SUSPICIOUS")).toBeVisible()
})

it("shows a publicly readable object as 공개 instead of naming an owner", () => {
  const operationKey = `${service} GET /api/orders/{id}`
  const publicSnapshot = { ...snapshot, owners: { ...snapshot.owners, "orders:101": "USER A" }, authorizationMatrix: { objects: [{ operation: operationKey, resource: "orders:101", resourcePolicy: "PUBLIC" }] } } as unknown as typeof snapshot
  const projection = projectHierarchy(publicSnapshot, filters, navigateHierarchy(navigateHierarchy(site, "group", group()), "operation", group(), operationKey))
  const object = projection.resources.find(node => node.selection.resource === "orders:101")!
  renderWithQueryClient(<GraphInspectorPanel selection={object.selection} event={null} snapshot={publicSnapshot} node={object} projection={projection} />)
  const summary = screen.getByRole("region", { name: "노드 요약" })
  expect(within(summary).getByText("접근한 신원 · 조회 공개")).toBeVisible()
  expect(within(summary).queryByText(/소유자 USER A|\(소유자\)/)).not.toBeInTheDocument()
})
