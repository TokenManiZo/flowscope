import { act, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { RelationshipGraphView } from "@/features/graph/RelationshipGraphView"
import type { GraphSelection } from "@/features/graph/graphProjection"
import { actualEvent, demoEndpoint, surfaceSnapshot } from "@/features/parameter-map/parameterMapFixtures"
import { SurfacePage } from "@/features/surface/SurfacePage"
import { createTestQueryClient, renderWithQueryClient } from "@/test/render"
import { EvidencePage } from "./EvidencePage"

vi.mock("@/features/graph/CytoscapeGraph", () => ({
  CytoscapeGraph: ({ onSelect }: { onSelect(selection: GraphSelection, id: string): void }) => <button onClick={() => onSelect({ operation: "https://demo.test:443 PATCH /orders/{id}", resource: "https://demo.test:443 orders:101", identity: "USER A", source: "human", evidenceIds: ["actual-a"] }, "selected-evidence")}>캔버스 Evidence 선택</button>,
}))

const event = actualEvent()
const snapshot = {
  ...surfaceSnapshot({ endpoints: [demoEndpoint()], events: [event] }),
  cells: [{ idn: event.idn, op: event.op, resource: event.resource, perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: [event.eventId] }],
}
const draft = { eventId: event.eventId, service: "https://demo.test:443", request: "PATCH /orders/101 HTTP/1.1", response: "retained response", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: event.idn, reusableSession: "NONE", message: "draft" }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }))
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

it.each(["evidence", "surface", "graph-list", "graph-canvas"] as const)("suspends %s actions during a snapshot failure and preserves the unsent Request Lab draft", async kind => {
  let failed = false
  const fetch = vi.fn((input: RequestInfo | URL) => {
    const path = String(input)
    if (path === "/api/snapshot") return Promise.resolve(failed ? json({ success: false, message: "snapshot unavailable" }, 503) : json(snapshot))
    if (path.startsWith("/api/evidence?")) return Promise.resolve(json({ records: [], total: 0, offset: 0, limit: 200, hasMore: false }))
    return Promise.resolve(json(draft))
  })
  vi.stubGlobal("fetch", fetch)
  const client = createTestQueryClient()
  client.setQueryDefaults(["snapshot"], { retryDelay: 0 })
  renderWithQueryClient(kind === "evidence" ? <EvidencePage /> : kind === "surface" ? <SurfacePage /> : <RelationshipGraphView />, client)
  await waitFor(() => expect(client.getQueryState(["snapshot"])?.status).toBe("success"))

  if (kind === "graph-list") {
    await userEvent.click(screen.getByRole("button", { name: "API 목록 보기" }))
    await userEvent.click(await screen.findByRole("button", { name: /ORDERS APIs/ }))
  }
  const select = async () => {
    if (kind === "graph-canvas") await userEvent.click(screen.getByRole("button", { name: "캔버스 Evidence 선택" }))
    else if (kind === "graph-list") {
      await userEvent.click(screen.getByRole("button", { name: /PATCH \/orders\/\{id\}/ }))
      await userEvent.click(screen.getByRole("button", { name: /orders:101; Resource/ }))
    }
    else {
      await userEvent.click(await screen.findByRole("button", { name: "상세 보기" }))
      if (kind === "surface" && screen.queryByRole("button", { name: "Evidence 상세 · H · HTTP 200" })) await userEvent.click(screen.getByRole("button", { name: "Evidence 상세 · H · HTTP 200" }))
    }
    if (kind.startsWith("graph") && screen.queryByRole("tab", { name: "Evidence" })) await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))
  }
  await select()
  await userEvent.click(await screen.findByRole("button", { name: "Request Lab 열기" }))
  const request = await screen.findByLabelText("Request Lab 요청 원문")
  await userEvent.clear(request)
  await userEvent.type(request, "EDITED-DRAFT")

  failed = true
  await act(async () => { await client.invalidateQueries({ queryKey: ["snapshot"] }) })
  expect(client.getQueryState(["snapshot"])?.status).toBe("error")
  await screen.findByText("snapshot unavailable")
  expect(screen.getByLabelText("Request Lab 일시 중지")).toBeVisible()
  expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveValue("EDITED-DRAFT")
  expect(screen.getByLabelText("Request Lab 요청 원문")).toBeDisabled()
  expect(screen.getByRole("button", { name: "Request Lab 전송" })).toBeDisabled()
  expect(screen.getByText("마지막 성공 데이터 · 현재 상태 아님")).toBeVisible()
  expect(client.getQueryData(["snapshot"])).toEqual(snapshot)
  if (kind === "evidence") expect(screen.getAllByText("actual-a").length).toBeGreaterThan(0)
  if (kind === "surface") expect(screen.getAllByText("/orders/{id}").length).toBeGreaterThan(0)
  expect(screen.getByLabelText("필수 역할")).toBeDisabled()
  expect(fetch.mock.calls.filter(([input]) => String(input).startsWith("/api/request-lab?"))).toHaveLength(1)

  failed = false
  await act(async () => { await client.invalidateQueries({ queryKey: ["snapshot"] }) })
  await waitFor(() => expect(screen.queryByText("snapshot unavailable")).not.toBeInTheDocument())
  expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveValue("EDITED-DRAFT")
  expect(screen.getByLabelText("Request Lab 요청 원문")).toBeEnabled()
  expect(screen.getByRole("button", { name: "Request Lab 전송" })).toBeEnabled()
  await waitFor(() => expect(fetch.mock.calls.filter(([input]) => String(input).startsWith("/api/request-lab?"))).toHaveLength(2))
})
