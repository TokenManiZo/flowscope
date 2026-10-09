import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import type { Snapshot } from "@/lib/api/types"
import { anonymousInspectionFixture } from "@/test/fixtures"
import { createTestQueryClient, renderWithQueryClient, seedHumanRun } from "@/test/render"
import { EvidenceActionList } from "@/features/evidence/EvidenceActionList"
import { GraphInspectorPanel } from "./GraphInspectorPanel"
import { navigateHierarchy, projectHierarchy } from "./graphHierarchy"
import { graphCellSelection, type GraphSelection } from "./graphProjection"
import type { HierarchyNode } from "./graphHierarchy"

const event: Snapshot["events"][number] = {
  eventId: "ev-1", method: "GET", path: "/orders/1", status: 200, fp: "fp", idn: "alice", role: "USER", source: "human", op: "GET /orders/{id}", resource: "order:1", timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["ev-1"], objects: [{ resource: "order:1", evidence: "id" }], verdict: "allow",
}

const snapshot: Snapshot = {
  revision: 1, identityRevision: 1, sampleMode: true, trafficStats: { captured: 1, coverage: 1, excluded: 0, review: 0, dropped: 0, payloadMetadataOnly: 0 }, replays: [], flowLinks: [], roles: { alice: "USER" }, owners: { "order:1": "alice" }, requiredRoles: { "GET /orders/{id}": "USER" }, activeSources: ["human"], gaps: [], scenarios: [], accounts: [], sessions: [], managedSessions: [], routeCandidates: [], verifications: [], events: [event], cells: [{ idn: "alice", op: "GET /orders/{id}", resource: "order:1", perSource: { human: "allow" }, reasons: { human: "owner access" }, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["ev-1"] }],
}

const selection: GraphSelection = { operation: "GET /orders/{id}", resource: "order:1", identity: "alice", source: "human", evidenceIds: ["ev-1"] }

const secret = "GET /orders/1 HTTP/1.1\nCookie: SECRET-RAW"
const draft = (extra: Record<string, unknown> = {}) => ({ eventId: "ev-1", service: "https://api.example.test", request: secret, response: "RAW-RESPONSE", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", reusableAccountId: "acct-1", message: "draft", ...extra })
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
function stubFetch(body = draft()) {
  const fetch = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(json(String(input) === "/api/request-lab/credentials" ? { headers: [] } : body)))
  vi.stubGlobal("fetch", fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

it("shows only the selected operation and its 요청 기록 rows, without verdict panels or raw event ids", () => {
  renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={{ ...snapshot, evidenceOrdinals: { "ev-1": 7 } }} />)
  const panel = screen.getByRole("complementary", { name: "선택 작업" })
  expect(panel).toHaveTextContent("GET /orders/{id}")
  const row = within(panel).getByRole("listitem", { name: "alice 요청 기록 1건" })
  expect(row).toHaveTextContent("alice")
  expect(row).toHaveTextContent("200")
  expect(within(row).getByRole("img", { name: "사람" })).toBeInTheDocument()
  expect(panel).not.toHaveTextContent("ev-1")
  expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  expect(screen.queryByRole("region", { name: "Access Check" })).not.toBeInTheDocument()
})

it.each(["human", "scanner", "llm"] as const)("hides the origin in observed API titles for %s without changing coordinates", source => {
  const op = "http://127.0.0.1:8888 GET /workshop/api/shop/orders/{id}"
  const record = { ...event, source, op }
  const selected = { ...selection, operation: op, resource: null, source, displayApiKey: op }
  const node: HierarchyNode = {
    id: `operation:${op}`, kind: "operation", label: op, wrappedLabel: op,
    verdict: "allow", verdictText: "ALLOW", verdictColor: "green",
    selection: { ...selected, cells: [], cellKeys: [], gapIds: [] },
  }
  renderWithQueryClient(<GraphInspectorPanel selection={selected} node={node} event={record} snapshot={{ ...snapshot, events: [record], cells: [] }} />)
  const panel = screen.getByRole("complementary", { name: "선택 작업" })
  expect(within(panel).getByText("GET /workshop/api/shop/orders/{id}")).toBeVisible()
  expect(within(panel).queryByText(op)).not.toBeInTheDocument()
  expect(node.label).toBe(op)
  expect(record.op).toBe(op)
})

it("shows a route candidate with the shared 요청 기록 UI plus a why-candidate summary, not the compact text dump", () => {
  const routeCandidate = { id: "route-candidate:1", service: "https://api.example.test", method: "GET", pathTemplate: "/api/v2/users/{id}/export", observed: false, applicability: "REVIEW", provenanceTypes: ["JAVASCRIPT"], provenanceEvidenceIds: ["ev-1"], provenance: [{ type: "JAVASCRIPT", evidenceId: "ev-1", source: "scanner", runId: "scan-1", adapter: "fetch", applicability: "REVIEW", reason: "번들에서 발견" }], reviewReason: "민감 export 경로", priorityReasons: ["input"] }
  const candidateSelection: GraphSelection = { operation: "GET /api/v2/users/{id}/export", resource: null, identity: null, source: "scanner", evidenceIds: ["ev-1"], routeCandidate }
  renderWithQueryClient(<GraphInspectorPanel selection={candidateSelection} event={null} snapshot={{ ...snapshot, evidenceOrdinals: { "ev-1": 7 } }} />)
  const panel = screen.getByRole("complementary", { name: "선택 작업" })
  expect(panel).toHaveTextContent("GET /api/v2/users/{id}/export")
  // 후보 맥락은 얇은 요약으로 남긴다.
  expect(within(panel).getByTestId("route-candidate-applicability")).toHaveTextContent("미관측 후보 · REVIEW")
  expect(panel).toHaveTextContent("찾은 곳: JAVASCRIPT")
  // 발견에 쓰인 요청은 다른 노드와 같은 요청 기록 카드로 보여 주고 Request Lab으로 보낼 수 있다.
  const row = within(panel).getByRole("listitem", { name: "alice 요청 기록 1건" })
  expect(within(row).getByRole("img", { name: "사람" })).toBeInTheDocument()
  expect(within(panel).getByRole("button", { name: "Request Lab에서 보내기" })).toBeInTheDocument()
  // 압축 텍스트 덤프(번호 나열·adapter 원문)는 더 이상 쓰지 않는다.
  expect(panel).not.toHaveTextContent("찾은 요청 기록")
  expect(panel).not.toHaveTextContent("fetch")
})

it("opens the shared Request Lab for a candidate, prefilled with the candidate path even over a seed workspace", async () => {
  // seed(발견) 요청의 원본과, 그 요청에 저장돼 있던 다른 엔드포인트 초안(decoy)을 둘 다 준다.
  const decoy = "POST /community/api/v2/community/posts/{id}/comment HTTP/1.1\r\nHost: api.example.test\r\n\r\n"
  stubFetch(draft({ request: "GET /orders/1 HTTP/1.1\r\nHost: api.example.test\r\n\r\n", workspace: { datasetRevision: 0, revision: 1, persisted: true, tab: { nextId: 2, selectedId: 1, entries: { "1": { name: "작성 중", request: decoy, credentialMode: "RAW", result: null, dirty: false } } } } }))
  const routeCandidate = { id: "route-candidate:1", service: "https://api.example.test", method: "POST", pathTemplate: "/exec/front/manage/a2hs", observed: false, applicability: "REVIEW", provenanceTypes: ["JAVASCRIPT_LITERAL"], provenanceEvidenceIds: ["ev-1"], provenance: [{ type: "JAVASCRIPT_LITERAL", evidenceId: "ev-1", source: "human", runId: "r", adapter: "browser", applicability: "REVIEW", reason: "literal" }], reviewReason: "", priorityReasons: [] }
  const candidateSelection: GraphSelection = { operation: "POST /exec/front/manage/a2hs", resource: null, identity: null, source: "human", evidenceIds: ["ev-1"], routeCandidate }
  renderWithQueryClient(<GraphInspectorPanel selection={candidateSelection} event={null} snapshot={snapshot} />)
  await userEvent.click(screen.getByRole("button", { name: "이 경로로 요청 보내기" }))
  // ②와 같은 Request Lab 모달이 열리고, 요청문은 선택한 후보 경로로 프리필된다(seed 원본·저장 초안이 아니라).
  const editor = await screen.findByLabelText("Request Lab 요청 원문") as HTMLTextAreaElement
  await waitFor(() => expect(editor.value).toContain("POST /exec/front/manage/a2hs"))
  expect(editor.value).not.toContain("/orders/1")
  expect(editor.value).not.toContain("posts/{id}/comment")
})

it("opens Request Lab ready to send without logging in, and sends nothing until asked", async () => {
  const fetch = stubFetch(draft({ request: `${secret}\n\n` }))
  renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={snapshot} />, seedHumanRun(createTestQueryClient(), anonymousInspectionFixture))
  await userEvent.click(screen.getByRole("button", { name: "Request Lab에서 보내기" }))
  await screen.findByLabelText("Request Lab 요청 원문")
  // 비로그인으로 점검 중이면 원본에서 비로그인 편집본이 바로 준비된다: 관리 인증 헤더(Cookie)가 빠진다.
  await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 계정" })).toHaveTextContent("비로그인"))
  expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveValue("GET /orders/1 HTTP/1.1\n\n")
  expect(screen.queryByRole("button", { name: "Original" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /Repeater/ })).not.toBeInTheDocument()
  expect(fetch.mock.calls.map(([input]) => String(input))).toContain("/api/request-lab?eventId=ev-1")
  // 대상 서버로 보내는 요청(POST /api/request-lab)은 없다. 인증 적용 미리보기만 있다.
  expect(fetch.mock.calls.filter(([input, init]) => String(input) === "/api/request-lab" && init?.method === "POST")).toEqual([])
})

it("locks 요청 기록 actions while the snapshot is suspended", () => {
  renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={snapshot} suspended />)
  expect(screen.getByRole("button", { name: "Request Lab에서 보내기" })).toBeDisabled()
})

it("links Request Lab POST replay status to its original node without adding a verdict", () => {
  const original = { ...event, eventId: "post-original", method: "POST", path: "/update", op: "POST /update", resource: null, verdict: "untested" as const }
  const replay = { ...original, eventId: "post-replay", phase: "VALIDATION", trafficDisposition: "EXCLUDE" as const, coverageEligible: false, status: 200 }
  renderWithQueryClient(<GraphInspectorPanel selection={{ operation: original.op, resource: null, identity: "alice", source: "human", evidenceIds: [original.eventId] }} event={original}
    snapshot={{ ...snapshot, events: [original, replay], manualVerifications: [{ eventId: replay.eventId, originEvidenceId: original.eventId, operation: original.op, resource: null, identity: "alice", identityId: "alice", timestamp: 2, status: 200, durationMs: 10 }] }} />)
  const panel = screen.getByRole("complementary", { name: "선택 작업" })
  expect(within(panel).getByRole("region", { name: "Request Lab 재현" })).toHaveTextContent("HTTP 200")
  expect(panel).not.toHaveTextContent("취약점 확정")
})

it("groups 요청 기록 into one card per identity with a row per source, acting on each row's latest request", async () => {
  const fetch = stubFetch()
  const events = [
    { ...event, eventId: "ev-1", timestamp: 1 },
    { ...event, eventId: "ev-2", timestamp: 3, status: 404, path: "/orders/2" },
    { ...event, eventId: "ev-4", timestamp: 0, source: "llm" as const },
    { ...event, eventId: "ev-3", timestamp: 2, idn: "bob", source: "scanner" as const, status: 401 },
  ]
  const verdicts = new Map([["alice", "allow"], ["bob", "deny"], ["carol", "deny"]] as const)
  renderWithQueryClient(<EvidenceActionList events={events} snapshot={{ ...snapshot, evidenceOrdinals: { "ev-1": 1, "ev-2": 2, "ev-3": 3, "ev-4": 4 } }} identityVerdicts={verdicts} />)
  const section = screen.getByRole("region", { name: "요청 기록" })
  expect(within(section).getByRole("heading", { name: "요청 기록" })).toBeVisible()
  // 신원마다 카드 하나. 요청 기록이 없어도 판정이 있는 신원(carol)은 카드로 남는다.
  expect(within(section).getAllByRole("listitem").map(item => item.getAttribute("aria-label"))).toEqual(["alice 요청 기록 3건", "bob 요청 기록 1건", "carol 요청 기록 0건"])
  const alice = within(section).getByRole("listitem", { name: "alice 요청 기록 3건" })
  expect(within(alice).getByText("ALLOW")).toBeVisible()
  expect(within(alice).getAllByRole("group").map(group => group.getAttribute("aria-label"))).toEqual(["alice · 사람 2건", "alice · LLM 1건"])
  const human = within(alice).getByRole("group", { name: "alice · 사람 2건" })
  expect(within(human).getByRole("img", { name: "사람" })).toBeInTheDocument()
  expect(within(human).getByText("404")).toBeVisible()
  expect(within(screen.getByRole("listitem", { name: "carol 요청 기록 0건" })).getByText("연결된 요청 기록이 없습니다.")).toBeVisible()

  await userEvent.click(within(human).getByRole("button", { name: "요청 2건 펼치기" }))
  const requests = within(human).getByRole("list", { name: "alice · 사람 요청 목록" })
  expect(within(requests).getAllByRole("listitem").map(item => item.getAttribute("aria-label"))).toEqual(["요청 기록 #2", "요청 기록 #1"])
  expect(within(requests).getByRole("button", { name: "#1 Request Lab에서 보내기" })).toBeVisible()

  // 줄의 보내기 버튼은 그 출처의 가장 최근 요청(ev-2)을 Request Lab으로 연다.
  await userEvent.click(within(human).getByRole("button", { name: "Request Lab에서 보내기" }))
  expect(fetch.mock.calls.map(([input]) => String(input))).toContain("/api/request-lab?eventId=ev-2")
})

it.each(["UNKNOWN", "POLLING"])("preserves unjudged account records without assigning the judged account verdict (%s)", trafficClass => {
  const bob = { ...event, eventId: "bob-unjudged", clusterEvidenceIds: ["bob-unjudged"], idn: "bob", resource: null, trafficClass, trafficDisposition: "REVIEW", verdict: "untested" as const }
  const data = { ...snapshot, events: [event, bob] }
  const filters = { source: ["human" as const], identity: [], view: "source" as const, includeSupportTraffic: true, includeRouteCandidates: false, expanded: false }
  const navigation = { level: "site" as const, groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
  const site = projectHierarchy(data, filters, navigation)
  const graph = projectHierarchy(data, filters, navigateHierarchy(navigation, "operation", site.groups[0].id, event.op))
  const node = graph.nodes.find(node => node.kind === "operation")!
  renderWithQueryClient(<GraphInspectorPanel selection={node.selection} event={null} snapshot={data} node={node} projection={graph} />)
  const alice = screen.getByRole("listitem", { name: "alice 요청 기록 1건" })
  expect(alice).toHaveTextContent("ALLOW")
  const bobRecord = screen.getByRole("listitem", { name: "bob 요청 기록 1건" })
  expect(bobRecord).not.toHaveTextContent("ALLOW")
  expect(node.selection.cells).toEqual(snapshot.cells)
  expect(graph.edges.find(edge => edge.selection.identity === "bob")?.selection.cells).toEqual([])
  expect(data.events).toContain(bob)
})

it.each(["UNKNOWN", "POLLING"])("shows B's neutral evidence in the API card detail without folding it (%s)", trafficClass => {
  const bob = { ...event, eventId: "bob-quiet", clusterEvidenceIds: ["bob-quiet"], idn: "bob", resource: null, trafficClass, trafficDisposition: "REVIEW", verdict: "untested" as const }
  const data = { ...snapshot, events: [event, bob] }
  const filters = { source: ["human" as const], identity: [], view: "source" as const, includeSupportTraffic: true, includeRouteCandidates: false, expanded: false }
  const navigation = { level: "site" as const, groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
  const site = projectHierarchy(data, filters, navigation)
  const graph = projectHierarchy(data, filters, navigateHierarchy(navigation, "group", site.groups[0].id))
  const node = graph.nodes.find(node => node.kind === "operation" && node.selection.operation === event.op)!
  expect(node.hiddenInGraph).not.toBe(true)
  expect(graph.nodes.some(node => node.objectGroup?.key === "신호 없는 기능")).toBe(false)
  expect(node.selection.cells).toEqual(snapshot.cells)
  expect(node.selection.evidenceIds).toEqual(["bob-quiet", "ev-1"])
  renderWithQueryClient(<GraphInspectorPanel selection={node.selection} event={null} snapshot={data} node={node} projection={graph} />)
  expect(screen.getByRole("listitem", { name: "alice 요청 기록 1건" })).toBeVisible()
  expect(screen.getByRole("listitem", { name: "bob 요청 기록 1건" })).not.toHaveTextContent("ALLOW")
  expect(screen.getByText(/권한 판정에 포함되지 않은 요청 기록 1건/)).toBeVisible()
})


function ownerPanelFixture() {
  const service = "https://owner.example.test:443", resource = `${service} orders:1`
  const record = { ...event, service, op: `${service} GET /orders/{id}`, resource }
  const cell = { ...snapshot.cells[0], op: record.op, resource }
  const data: Snapshot = { ...snapshot, events: [record], cells: [cell], owners: {}, ownerOverrides: {}, accounts: [
    { id: "alice", label: "USER A", role: "User", target: service, color: "", authArtifactCount: 1 },
  ], displayObjects: [{ eventId: record.eventId, operation: record.op, apiKey: record.op, groupKey: "group", objectKey: "display-object-1", kind: "PATH", fields: ["id"], legacyResource: resource, ordinal: 1 }] }
  const node: HierarchyNode = { id: "resource:display-object-1", kind: "resource", label: "OBJ 1", wrappedLabel: "OBJ 1",
    verdict: "untested", verdictText: "미점검", verdictColor: "#64748b", displayObjectKind: "PATH",
    selection: { ...graphCellSelection([cell]), gapIds: [], displayObjectKey: "display-object-1" } }
  return { data, node, record, resource: `${service} observed-object:display-object-1` }
}

it("stores ownership by OBJ key even when a legacy resource exists", async () => {
  const fetch = stubFetch()
  const user = userEvent.setup()
  const { data, node, record, resource } = ownerPanelFixture()
  const { rerender } = renderWithQueryClient(<GraphInspectorPanel selection={node.selection} event={record} snapshot={data} node={node} />)
  expect(screen.getByRole("region", { name: "소유자" })).toBeVisible()
  const apply = screen.getByRole("button", { name: "소유자로 확정" })
  expect(apply).toBeDisabled()
  await user.click(screen.getByRole("radio", { name: /USER A/ }))
  expect(fetch.mock.calls.filter(([url]) => String(url) === "/api/owner")).toHaveLength(0)
  await user.click(apply)
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url) === "/api/owner")).toHaveLength(1))
  const [, request] = fetch.mock.calls.find(([url]) => String(url) === "/api/owner")!
  expect(String(request?.body)).toBe(String(new URLSearchParams({ resource, identity: "alice" })))
  rerender(<GraphInspectorPanel selection={node.selection} event={record} snapshot={{ ...data, owners: { [resource]: "alice" }, ownerOverrides: { [resource]: "alice" } }} node={node} />)
  expect(screen.getByRole("heading", { name: /소유자 USER A/ })).toHaveTextContent("직접 확정")
  expect(screen.getByRole("button", { name: "소유자 바꾸기" })).toBeVisible()
})

it.each(["static", "group"])("does not offer owner assignment for %s objects", kind => {
  const { data, node, record } = ownerPanelFixture()
  const selected: HierarchyNode = kind === "static" ? { ...node, staticResource: true } : { ...node, kind: "object-group" }
  renderWithQueryClient(<GraphInspectorPanel selection={selected.selection} event={record} snapshot={data} node={selected} />)
  expect(screen.queryByRole("region", { name: "소유자" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "소유자로 확정" })).not.toBeInTheDocument()
})

it("keeps mapped object owner controls disabled while data is suspended", async () => {
  const { data, node, record } = ownerPanelFixture()
  renderWithQueryClient(<GraphInspectorPanel selection={node.selection} event={record} snapshot={data} node={node} suspended />)
  expect(screen.getByRole("radio", { name: /USER A/ })).toBeDisabled()
  expect(screen.getByRole("button", { name: "소유자로 확정" })).toBeDisabled()
})

it.each(["PATH", "QUERY", "REQUEST_BODY"] as const)("assigns and restores the owner of an unlinked %s OBJ independently", async kind => {
  const { data, node, record } = ownerPanelFixture()
  const key = "unlinked-" + kind, resource = `${record.service} observed-object:${key}`
  const selected = { ...node, displayObjectKind: kind, selection: { ...node.selection, resource: null, cells: [], displayObjectKey: key } }
  const current: Snapshot = { ...data, displayObjects: [{ eventId: record.eventId, operation: record.op, apiKey: record.op, groupKey: "group", objectKey: key, kind, fields: ["id"], legacyResource: null, ordinal: 1 }] }
  const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(json({ success: true })))
  vi.stubGlobal("fetch", fetch)
  const user = userEvent.setup()
  const { rerender } = renderWithQueryClient(<GraphInspectorPanel selection={selected.selection} event={record} snapshot={current} node={selected} />)
  await user.click(screen.getByRole("radio", { name: /USER A/ }))
  await user.click(screen.getByRole("button", { name: "소유자로 확정" }))
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url) === "/api/owner")).toBe(true))
  const request = fetch.mock.calls.find(([url]) => String(url) === "/api/owner")![1] as RequestInit
  expect(new URLSearchParams(String(request.body)).get("resource")).toBe(resource)
  rerender(<GraphInspectorPanel selection={selected.selection} event={record} snapshot={{ ...current, ownerOverrides: { [resource]: "alice" } }} node={selected} />)
  expect(screen.getByRole("heading", { name: /소유자 USER A/ })).toHaveTextContent("직접 확정")
  expect(screen.queryByRole("radio", { name: /Public/ })).not.toBeInTheDocument()
})
