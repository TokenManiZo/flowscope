import { act, render, screen, waitFor } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { EvidenceInspectorBody } from "@/components/layout/EvidenceSheet"
import { GraphInspectorPanel } from "@/features/graph/GraphInspectorPanel"
import { targetSnapshot } from "@/test/fixtures"
import { createTestQueryClient } from "@/test/render"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { loadSample, openProject, resetProjectTraffic, startProject } from "@/lib/api/endpoints"

const event: EventRecord = { eventId: "first", op: "GET /orders/{id}", resource: "order:1", idn: "alice", source: "human", method: "GET", path: "/orders/1", status: 200, fp: "fp", role: "USER", timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "LITERAL", pathTemplateReasons: [], clusterId: "first", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["first"], objects: [], verdict: "allow" }
const second = { ...event, eventId: "second", op: "PATCH /profiles/{id}", resource: "profile:2", clusterEvidenceIds: ["second"] }
// 소유자는 계정·세션에 등록한 같은 서비스 계정 중에서만 고른다. 테스트 op의 서비스 자리는 method다.
const account = (id: string, target: string) => ({ id, label: id, role: "USER", target, color: "", authArtifactCount: 0 })
const snapshot = targetSnapshot({ events: [event, second], accounts: [account("alice", "GET"), account("bob", "GET"), account("carol", "GET"), account("dave", "PATCH")], requiredRoles: { [event.op]: "USER", [second.op]: "ADMIN" }, owners: { "order:1": "alice", "profile:2": "dave" }, ownerOverrides: { "order:1": "alice", "profile:2": "dave" } })
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
const draft = { eventId: "first", service: "https://api.example.test", request: "GET /original HTTP/1.1", response: "original response", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "NONE", message: "draft" }
afterEach(() => vi.unstubAllGlobals())

function mount(kind: "evidence" | "graph") {
  const client = createTestQueryClient()
  const tree = (selected: EventRecord | null, current: Snapshot) => <QueryClientProvider client={client}>{kind === "evidence" ? <EvidenceInspectorBody event={selected} snapshot={current} /> : <GraphInspectorPanel event={selected} snapshot={current} selection={{ operation: selected?.op ?? null, resource: selected?.resource ?? null, identity: selected?.idn ?? null, source: selected?.source ?? null, evidenceIds: selected ? [selected.eventId] : [] }} />}</QueryClientProvider>
  const view = render(tree(event, snapshot))
  return { ...view, client, change: (selected: EventRecord | null, current = snapshot) => view.rerender(tree(selected, current)) }
}
// 그래프 선택 상세는 Evidence 목록의 "원문 보기"로 Request Lab을 연다. 정책 편집은 Evidence 상세에만 남아 있다.
const labButton = (kind: string) => kind === "graph" ? "원문 보기" : "Request Lab 열기"

it.each(["evidence"] as const)("isolates %s policy values, submit targets and late mutation errors across two selections", async kind => {
  let finish!: (response: Response) => void
  const fetch = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => String(input) === "/api/requirement" ? new Promise<Response>(resolve => { finish = resolve }) : Promise.resolve(json({ success: true })))
  vi.stubGlobal("fetch", fetch)
  const view = mount(kind)
  await userEvent.clear(screen.getByLabelText("필수 역할"))
  await userEvent.type(screen.getByLabelText("필수 역할"), "OLD-ROLE")
  await userEvent.selectOptions(screen.getByLabelText("리소스 소유자"), "carol")
  await userEvent.selectOptions(screen.getByLabelText("트래픽 재정의"), "EXCLUDE")
  await userEvent.click(screen.getByRole("button", { name: "필수 역할 저장" }))
  view.change(second)
  expect(screen.getByLabelText("필수 역할")).toHaveValue("ADMIN")
  expect(screen.getByLabelText("리소스 소유자")).toHaveValue("dave")
  expect(screen.getByLabelText("트래픽 재정의")).toHaveValue("AUTO")
  await act(async () => finish(new Response(JSON.stringify({ success: false, message: "old context failure" }), { status: 400 })))
  expect(screen.queryByText("old context failure")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "소유자 저장" }))
  await userEvent.click(screen.getByRole("button", { name: "트래픽 정책 저장" }))
  const bodies = fetch.mock.calls.map(([, init]) => String(init?.body))
  expect(bodies).toContain("resource=profile%3A2&identity=dave")
  expect(bodies).toContain("operation=PATCH+%2Fprofiles%2F%7Bid%7D&value=AUTO")
  expect(bodies).toContain("operation=GET+%2Forders%2F%7Bid%7D&role=OLD-ROLE")
  expect(bodies.join(" ")).not.toContain("identity=carol")
})

it("does not invalidate the new policy editor when an old-context save succeeds late", async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
  const view = mount("evidence")
  const invalidate = vi.spyOn(view.client, "invalidateQueries")
  await userEvent.click(screen.getByRole("button", { name: "필수 역할 저장" }))
  view.change(second)
  await act(async () => finish(json({ success: true })))
  expect(invalidate).not.toHaveBeenCalled()
  expect(screen.getByLabelText("필수 역할")).toHaveValue("ADMIN")
})

it.each(["evidence"] as const)("preserves %s policy edits on ordinary revisions but resets them for the same 관측 기록 in another dataset", async kind => {
  let finish!: (response: Response) => void
  const fetch = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => String(input) === "/api/requirement"
    ? new Promise<Response>(resolve => { finish = resolve })
    : Promise.resolve(json({ success: true })))
  vi.stubGlobal("fetch", fetch)
  const view = mount(kind)
  const invalidate = vi.spyOn(view.client, "invalidateQueries")
  await userEvent.clear(screen.getByLabelText("필수 역할"))
  await userEvent.type(screen.getByLabelText("필수 역할"), "OLD-ROLE")
  await userEvent.selectOptions(screen.getByLabelText("리소스 소유자"), "carol")
  await userEvent.selectOptions(screen.getByLabelText("트래픽 재정의"), "EXCLUDE")

  view.change(event, { ...snapshot, revision: 2, datasetRevision: 1 })
  expect(screen.getByLabelText("필수 역할")).toHaveValue("OLD-ROLE")
  expect(screen.getByLabelText("리소스 소유자")).toHaveValue("carol")
  expect(screen.getByLabelText("트래픽 재정의")).toHaveValue("EXCLUDE")
  await userEvent.click(screen.getByRole("button", { name: "필수 역할 저장" }))

  view.change(event, { ...snapshot, revision: 3, datasetRevision: 2, requiredRoles: { [event.op]: "ADMIN" }, owners: { [event.resource!]: "bob" }, ownerOverrides: { [event.resource!]: "bob" } })
  expect(screen.getByLabelText("필수 역할")).toHaveValue("ADMIN")
  expect(screen.getByLabelText("리소스 소유자")).toHaveValue("bob")
  expect(screen.getByLabelText("트래픽 재정의")).toHaveValue("AUTO")
  expect(screen.getByRole("button", { name: "필수 역할 저장" })).toBeEnabled()
  await act(async () => finish(json({ success: true })))
  expect(invalidate).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: "소유자 저장" }))
  expect(fetch.mock.calls.map(([, init]) => String(init?.body))).toContain("resource=order%3A1&identity=bob")
})

it.each(["raw", "session"] as const)("scrubs when revision revalidation loses %s context", async boundary => {
  let currentDraft = draft
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(currentDraft))))
  const view = mount("evidence")
  await userEvent.click(screen.getByRole("button", { name: "Request Lab 열기" }))
  await screen.findByLabelText("Request Lab 요청 원문")
  currentDraft = boundary === "raw" ? { ...draft, rawRequestRetained: false } : { ...draft, reusableSession: "REVOKED" }
  view.change(event, { ...snapshot, revision: 2 })
  await waitFor(() => expect(screen.queryByLabelText("Request Lab 요청 원문")).not.toBeInTheDocument())
})

// A coordinate change keeps the Evidence ID but is a new context; a dataset replacement is signalled by the server datasetRevision (D-140).
it.each(["coordinate", "replacement"] as const)("scrubs a surviving 기록 번호 on %s change", async boundary => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(draft))))
  const view = mount("evidence")
  await userEvent.click(screen.getByRole("button", { name: "Request Lab 열기" }))
  await screen.findByLabelText("Request Lab 요청 원문")
  view.change(boundary === "coordinate" ? { ...event, resource: "order:2" } : event, boundary === "coordinate" ? snapshot : { ...snapshot, revision: 2, datasetRevision: 2, events: [event] })
  expect(screen.queryByLabelText("Request Lab 요청 원문")).not.toBeInTheDocument()
})

it.each(["evidence", "graph"] as const)("preserves %s Request Lab edits/history on traffic revisions but closes on invalidation", async kind => {
  vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(json(init?.method === "POST" ? { response: "sent response", status: 200, durationMs: 1 } : draft))))
  const view = mount(kind)
  await userEvent.click(screen.getByRole("button", { name: labButton(kind) }))
  await userEvent.clear(await screen.findByLabelText("Request Lab 요청 원문"))
  await userEvent.type(screen.getByLabelText("Request Lab 요청 원문"), "edited request")
  await userEvent.click(screen.getByRole("button", { name: "Request Lab 전송" }))
  expect(await screen.findByText("현재 탭 전송 결과 1건 (최대 10건)")).toBeVisible()
  view.change(event, { ...snapshot, revision: 2, events: [...snapshot.events, { ...event, eventId: "ordinary-traffic" }] })
  expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveValue("edited request")
  expect(screen.getByText("현재 탭 전송 결과 1건 (최대 10건)")).toBeVisible()
  view.change(null, { ...snapshot, revision: 3, events: [] })
  expect(screen.queryByLabelText("Request Lab 요청 원문")).not.toBeInTheDocument()
  view.change(event)
  await userEvent.click(screen.getByRole("button", { name: labButton(kind) }))
  expect(await screen.findByLabelText("Request Lab 요청 원문")).toHaveValue(draft.request)
  expect(screen.queryByText("현재 탭 전송 결과 1건 (최대 10건)")).not.toBeInTheDocument()
})

it.each([loadSample, () => openProject("demo"), resetProjectTraffic])("scrubs an open editor on an explicit client dataset replacement", async replace => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(draft))))
  mount("evidence")
  await userEvent.click(screen.getByRole("button", { name: "Request Lab 열기" }))
  await screen.findByLabelText("Request Lab 요청 원문")
  await act(async () => { await replace() })
  await waitFor(() => expect(screen.queryByLabelText("Request Lab 요청 원문")).not.toBeInTheDocument())
})

it.each([loadSample, () => openProject("missing"), resetProjectTraffic, () => startProject({ name: "next", scope: "https://api.example.test" })])("keeps an open editor when the requested dataset replacement fails", async replace => {
  let replacementSignals = 0
  window.addEventListener("flowscope:dataset-replacing", () => { replacementSignals += 1 }, { once: true })
  vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
    ? Promise.resolve(new Response(JSON.stringify({ success: false, message: "project switch failed" }), { status: 500, headers: { "Content-Type": "application/json" } }))
    : Promise.resolve(json(draft))))
  mount("evidence")
  await userEvent.click(screen.getByRole("button", { name: "Request Lab 열기" }))
  const editor = await screen.findByLabelText("Request Lab 요청 원문")
  await userEvent.clear(editor)
  await userEvent.type(editor, "unsaved operator edit")

  await expect(replace()).rejects.toThrow("project switch failed")

  expect(replacementSignals).toBe(0)
  expect(screen.getByLabelText("Request Lab 요청 원문")).toBeVisible()
  expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveValue("unsaved operator edit")
})
