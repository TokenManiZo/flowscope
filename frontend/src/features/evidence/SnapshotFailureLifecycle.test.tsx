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

it.each(["evidence", "surface", "graph-list", "graph-canvas"] as const)("closes %s actions after a real snapshot failure and keeps the confirmed display available for retry", async kind => {
  let failed = false
  const fetch = vi.fn((input: RequestInfo | URL) => Promise.resolve(String(input) === "/api/snapshot"
    ? failed ? json({ success: false, message: "snapshot unavailable" }, 503) : json(snapshot)
    : json(draft)))
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
    else if (kind === "graph-list") await userEvent.click(screen.getByRole("button", { name: /HUMAN · USER A.*API 접근/ }))
    else {
      await userEvent.click(await screen.findByRole("button", { name: "상세 보기" }))
      if (kind === "surface" && screen.queryByRole("button", { name: "Evidence 상세 · H · HTTP 200" })) await userEvent.click(screen.getByRole("button", { name: "Evidence 상세 · H · HTTP 200" }))
    }
    if (kind.startsWith("graph") && screen.queryByRole("tab", { name: "Evidence" })) await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))
  }
  await select()
  await userEvent.click(await screen.findByRole("button", { name: "Request Lab 열기" }))
  await screen.findByLabelText("Request Lab 요청 원문")

  failed = true
  await act(async () => { await client.invalidateQueries({ queryKey: ["snapshot"] }) })
  expect(client.getQueryState(["snapshot"])?.status).toBe("error")
  await screen.findByText("snapshot unavailable")
  expect(screen.queryByLabelText("필수 역할")).not.toBeInTheDocument()
  expect(screen.queryByLabelText("Request Lab 요청 원문")).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Request Lab 열기" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Repeater 초안 열기" })).not.toBeInTheDocument()
  expect(screen.getByText("마지막 성공 데이터 · 현재 상태 아님")).toBeVisible()
  expect(client.getQueryData(["snapshot"])).toEqual(snapshot)
  if (kind === "evidence") expect(screen.getByText("actual-a")).toBeVisible()
  if (kind === "surface") expect(screen.getByText("/orders/{id}")).toBeVisible()
  if (kind === "evidence" || kind === "surface") expect(screen.getByRole("button", { name: "상세 보기" })).toBeDisabled()
  await select()
  expect(screen.queryByLabelText("필수 역할")).not.toBeInTheDocument()
  expect(fetch.mock.calls.filter(([input]) => String(input).startsWith("/api/request-lab?"))).toHaveLength(1)

  failed = false
  await userEvent.click(screen.getByRole("button", { name: "snapshot 다시 시도" }))
  await waitFor(() => expect(screen.queryByText("snapshot unavailable")).not.toBeInTheDocument())
  expect(screen.queryByLabelText("필수 역할")).not.toBeInTheDocument()
  await select()
  expect(await screen.findByLabelText("필수 역할")).toBeVisible()
})
