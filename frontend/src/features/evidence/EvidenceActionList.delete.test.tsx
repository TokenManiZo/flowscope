import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import type { EventRecord, Snapshot } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { createTestQueryClient, renderWithQueryClient } from "@/test/render"
import { EvidenceActionList } from "./EvidenceActionList"
import { GraphInspectorPanel } from "@/features/graph/GraphInspectorPanel"

vi.mock("./RequestLabDialog", () => ({ RequestLabDialog: () => null }))
afterEach(() => vi.unstubAllGlobals())

it("deletes a single-request source row without affecting another object's requests", async () => {
  const calls = mockDeletion(), user = userEvent.setup()
  renderWithQueryClient(<EvidenceActionList events={[first]} snapshot={data} allowDelete />)
  const remove = screen.getByRole("button", { name: "#1 요청 삭제" })
  expect(remove.nextElementSibling).toHaveAttribute("aria-label", "Request Lab에서 보내기")
  await user.click(remove)
  await screen.findByRole("button", { name: "영구 삭제" })
  expect(calls[0]).toEqual({ action: "preview-delete", evidenceIds: ["first"], datasetRevision: 7, revision: 3 })
  await user.click(screen.getByRole("button", { name: "영구 삭제" }))
  await waitFor(() => expect(calls.at(-1)).toEqual({ action: "delete", evidenceIds: ["first"], expectedEvidenceIds: ["first", "linked-replay"], datasetRevision: 7, revision: 3 }))
})

it("disables single-request deletion while suspended", () => {
  renderWithQueryClient(<EvidenceActionList events={[first]} snapshot={data} allowDelete disabled />)
  expect(screen.getByRole("button", { name: "#1 요청 삭제" })).toBeDisabled()
})

const event = (eventId: string, extra: Partial<EventRecord> = {}): EventRecord => ({
  eventId, method: "GET", path: "/items/1", status: 200, fp: "fp", idn: "anon", role: "Anonymous", source: "human",
  op: "GET /items/{id}", resource: "items:1", timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN",
  tool: "BROWSER", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "run", authState: "ANONYMOUS",
  trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false,
  classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: eventId,
  repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: [eventId], objects: [], verdict: "allow", ...extra,
})
const first = event("first")
const second = event("second", { timestamp: 2, clusterEvidenceIds: ["second", "repeat"], repeatCount: 2 })
const otherObject = event("other-object", { resource: "items:2", path: "/items/2" })
const data = targetSnapshot({
  revision: 3, datasetRevision: 7, events: [first, second, otherObject],
  evidenceOrdinals: { first: 1, second: 2, "other-object": 3 },
})
function mockDeletion() {
  const calls: Array<Record<string, unknown>> = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("/api/api-management")
    const change = JSON.parse(new URLSearchParams(String(init.body)).get("change")!)
    calls.push(change)
    const ids = [...change.evidenceIds, "linked-replay"]
    return new Response(JSON.stringify({ operations: [], evidenceIds: ids, records: ids.length, reviews: 0, declarations: 0 }), {
      status: 200, headers: { "Content-Type": "application/json" },
    })
  }))
  return calls
}
function panel(snapshot: Snapshot, events: EventRecord[], disabled = false) {
  const evidenceIds = [...new Set(events.flatMap(item => [item.eventId, ...(item.clusterEvidenceIds ?? [])]))]
  return <GraphInspectorPanel selection={{ operation: first.op, resource: events[0]?.resource ?? null, identity: null, source: null, evidenceIds }} event={null} snapshot={snapshot} suspended={disabled} />
}
function renderList(snapshot: Snapshot = data, events = [first, second], disabled = false) {
  const client = createTestQueryClient()
  client.setQueryDefaults(["snapshot"], { gcTime: Infinity })
  client.setQueryDefaults(["evidence"], { gcTime: Infinity })
  client.setQueryData(["snapshot"], snapshot)
  client.setQueryData(["evidence", "first"], { raw: "cached traffic" })
  const view = renderWithQueryClient(panel(snapshot, events, disabled), client)
  return { ...view, client }
}
const bulkLabel = "객체 삭제"

it("previews the whole visible request group including repeats, then deletes only that scope and clears raw caches", async () => {
  const calls = mockDeletion(), user = userEvent.setup()
  const { client } = renderList()
  const invalidate = vi.spyOn(client, "invalidateQueries")
  const bulk = screen.getByRole("button", { name: bulkLabel })
  const footer = bulk.closest("footer")!
  expect(within(footer).getAllByRole("button")).toHaveLength(3)
  expect(within(footer).getByRole("button", { name: "API 하이라이트" })).toBeInTheDocument()
  expect(within(footer).getByRole("button", { name: "취약점으로 표시" })).toBeInTheDocument()
  expect(within(screen.getByRole("region", { name: "요청 기록" })).queryByRole("button", { name: /전체 삭제/ })).not.toBeInTheDocument()
  await user.click(bulk)
  await screen.findByRole("button", { name: "영구 삭제" })
  expect(calls).toEqual([{ action: "preview-delete", evidenceIds: ["first", "second", "repeat"], datasetRevision: 7, revision: 3 }])
  await user.click(screen.getByRole("button", { name: "영구 삭제" }))
  await waitFor(() => expect(calls.at(-1)).toEqual({
    action: "delete", evidenceIds: ["first", "second", "repeat"],
    expectedEvidenceIds: ["first", "second", "repeat", "linked-replay"], datasetRevision: 7, revision: 3,
  }))
  await waitFor(() => expect(client.getQueryData(["evidence", "first"])).toBeUndefined())
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["snapshot"] })
  expect(calls.every(call => !("operations" in call))).toBe(true)
  expect(calls.flatMap(call => call.evidenceIds as string[])).not.toContain("other-object")
})

it("places per-request deletion before Send and targets the exact request rather than its repeated siblings", async () => {
  const calls = mockDeletion(), user = userEvent.setup()
  renderList()
  await user.click(screen.getByRole("button", { name: "요청 2건 펼치기" }))
  const row = screen.getByRole("listitem", { name: "요청 기록 #2" })
  const remove = within(row).getByRole("button", { name: "#2 요청 삭제" })
  expect(remove.nextElementSibling).toHaveAttribute("aria-label", "#2 Request Lab에서 보내기")
  await user.click(remove)
  await screen.findByRole("button", { name: "영구 삭제" })
  expect(calls).toEqual([{ action: "preview-delete", evidenceIds: ["second"], datasetRevision: 7, revision: 3 }])
  await user.click(screen.getByRole("button", { name: "영구 삭제" }))
  await waitFor(() => expect(calls.at(-1)).toEqual({
    action: "delete", evidenceIds: ["second"], expectedEvidenceIds: ["second", "linked-replay"], datasetRevision: 7, revision: 3,
  }))
})

it("offers deletion of every selected object request across identity and source groups", async () => {
  const calls = mockDeletion(), user = userEvent.setup()
  const scanner = event("scanner", { idn: "bob", source: "scanner", timestamp: 3 })
  renderList({ ...data, events: [...data.events, scanner] }, [first, second, scanner])
  await user.click(screen.getByRole("button", { name: bulkLabel }))
  await screen.findByRole("button", { name: "영구 삭제" })
  expect(calls[0]).toEqual({
    action: "preview-delete", evidenceIds: ["first", "second", "repeat", "scanner"], datasetRevision: 7, revision: 3,
  })
  await user.click(screen.getByRole("button", { name: "취소" }))
  expect(calls.map(call => call.action)).toEqual(["preview-delete"])
})

it("disables group and individual deletion while the snapshot is suspended", async () => {
  renderList(data, [first, second], true)
  expect(screen.getByRole("button", { name: bulkLabel })).toBeDisabled()
  await userEvent.click(screen.getByRole("button", { name: "요청 2건 펼치기" }))
  expect(screen.getByRole("button", { name: "#1 요청 삭제" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "#2 요청 삭제" })).toBeDisabled()
})

it("closes a deletion preview when the selected request group is replaced", async () => {
  const calls = mockDeletion(), user = userEvent.setup()
  const { rerender } = renderList()
  await user.click(screen.getByRole("button", { name: bulkLabel }))
  await screen.findByRole("button", { name: "영구 삭제" })
  rerender(panel(data, [otherObject]))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(calls.map(call => call.action)).toEqual(["preview-delete"])
})

it("keeps request deletion opt-in for other uses of the observation list", () => {
  renderWithQueryClient(<EvidenceActionList events={[first, second]} snapshot={data} />)
  expect(screen.queryByRole("button", { name: /삭제/ })).not.toBeInTheDocument()
})

it.each(["resource", "object-group"] as const)("keeps three footer actions for a %s connected to multiple APIs and deletes only its evidence", async kind => {
  const calls = mockDeletion(), user = userEvent.setup()
  const next = { ...second, op: "POST /items/{id}" }
  const snapshot = { ...data, events: [first, next, otherObject] }
  const selection = {
    operation: null, resource: kind === "resource" ? first.resource : null, identity: null, source: null,
    evidenceIds: ["first", "second", "repeat"],
    cells: [first, next].map(item => ({ idn: item.idn, op: item.op, resource: item.resource, perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: item.clusterEvidenceIds ?? [] })),
    cellKeys: [], gapIds: [],
  }
  const node = { id: kind + ":items", kind, label: "items", wrappedLabel: "items", verdict: "allow" as const, verdictText: "ALLOW", verdictColor: "green", selection }
  const { container } = renderWithQueryClient(<GraphInspectorPanel selection={selection} event={null} snapshot={snapshot} node={node} />)
  const footer = container.querySelector("footer")!
  expect(within(footer).getAllByRole("button")).toHaveLength(3)
  const picker = within(footer).getByRole("combobox", { name: "조작할 API" })
  expect(within(picker).getAllByRole("option")).toHaveLength(2)
  await user.selectOptions(picker, next.op)
  await user.click(within(footer).getByRole("button", { name: "객체 삭제" }))
  await screen.findByRole("button", { name: "영구 삭제" })
  expect(calls[0]).toEqual({ action: "preview-delete", evidenceIds: ["first", "second", "repeat"], datasetRevision: 7, revision: 3 })
  expect(calls[0]).not.toHaveProperty("operations")
})
