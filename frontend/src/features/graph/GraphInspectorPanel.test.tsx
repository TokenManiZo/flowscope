import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import type { ManagedSession, Snapshot } from "@/lib/api/types"
import { anonymousInspectionFixture } from "@/test/fixtures"
import { createTestQueryClient, renderWithQueryClient, seedHumanRun } from "@/test/render"
import { EvidenceActionList } from "@/features/evidence/EvidenceActionList"
import { GraphInspectorPanel } from "./GraphInspectorPanel"
import { navigateHierarchy, projectHierarchy } from "./graphHierarchy"
import type { GraphSelection } from "./graphProjection"

const event: Snapshot["events"][number] = {
  eventId: "ev-1", method: "GET", path: "/orders/1", status: 200, fp: "fp", idn: "alice", role: "USER", source: "human", op: "GET /orders/{id}", resource: "order:1", timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "r", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["ev-1"], objects: [{ resource: "order:1", evidence: "id" }], verdict: "allow",
}

const snapshot: Snapshot = {
  revision: 1, identityRevision: 1, sampleMode: true, trafficStats: { captured: 1, coverage: 1, excluded: 0, review: 0, dropped: 0, payloadMetadataOnly: 0 }, replays: [], flowLinks: [], roles: { alice: "USER" }, owners: { "order:1": "alice" }, requiredRoles: { "GET /orders/{id}": "USER" }, activeSources: ["human"], gaps: [], scenarios: [], accounts: [], sessions: [], managedSessions: [], routeCandidates: [], verifications: [], events: [event], cells: [{ idn: "alice", op: "GET /orders/{id}", resource: "order:1", perSource: { human: "allow" }, reasons: { human: "owner access" }, overall: "allow", conflict: false, missedSources: [], evidenceIds: ["ev-1"] }],
}

const selection: GraphSelection = { operation: "GET /orders/{id}", resource: "order:1", identity: "alice", source: "human", evidenceIds: ["ev-1"] }

const secret = "GET /orders/1 HTTP/1.1\nCookie: SECRET-RAW"
const session: ManagedSession = { handle: "opaque", accountId: "acct-1", accountLabel: "alice", service: "https://api.example.test", status: "ACTIVE", verificationSource: "OPERATOR_ASSERTED", createdAt: "now", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false }
const draft = (extra: Record<string, unknown> = {}) => ({ eventId: "ev-1", service: "https://api.example.test", request: secret, response: "RAW-RESPONSE", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "alice", reusableSession: "managed", reusableAccountId: "acct-1", message: "draft", ...extra })
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
function stubFetch(body = draft()) {
  const fetch = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(json(String(input) === "/api/request-lab/credentials" ? { headers: [] } : body)))
  vi.stubGlobal("fetch", fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

it("shows only the selected operation and its 관측 기록 rows, without verdict panels or raw event ids", () => {
  renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={{ ...snapshot, evidenceOrdinals: { "ev-1": 7 } }} />)
  const panel = screen.getByRole("complementary", { name: "선택 작업" })
  expect(panel).toHaveTextContent("GET /orders/{id}")
  const row = within(panel).getByRole("listitem", { name: "alice 관측 기록 1건" })
  expect(row).toHaveTextContent("alice")
  expect(row).toHaveTextContent("200")
  expect(within(row).getByRole("img", { name: "HUMAN" })).toBeInTheDocument()
  expect(panel).not.toHaveTextContent("ev-1")
  expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  expect(screen.queryByRole("region", { name: "Access Check" })).not.toBeInTheDocument()
})

it("opens Request Lab ready to send without logging in, and sends nothing until asked", async () => {
  const fetch = stubFetch(draft({ request: `${secret}\n\n` }))
  renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={snapshot} />, seedHumanRun(createTestQueryClient(), anonymousInspectionFixture))
  await userEvent.click(screen.getByRole("button", { name: "Request Lab에서 보내기" }))
  await screen.findByLabelText("Request Lab 요청 원문")
  // 비로그인으로 점검 중이면 원본에서 비로그인 편집본이 바로 준비된다: 관리 인증 헤더(Cookie)가 빠진다.
  await waitFor(() => expect(screen.getByRole("combobox", { name: "전송 인증" })).toHaveTextContent("비로그인"))
  expect(screen.getByLabelText("Request Lab 요청 원문")).toHaveValue("GET /orders/1 HTTP/1.1\n\n")
  expect(screen.queryByRole("button", { name: "Original" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /Repeater/ })).not.toBeInTheDocument()
  expect(fetch.mock.calls.map(([input]) => String(input))).toContain("/api/request-lab?eventId=ev-1")
  // 대상 서버로 보내는 요청(POST /api/request-lab)은 없다. 인증 적용 미리보기만 있다.
  expect(fetch.mock.calls.filter(([input, init]) => String(input) === "/api/request-lab" && init?.method === "POST")).toEqual([])
})

it("locks 관측 기록 actions while the snapshot is suspended", () => {
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

it("groups 관측 기록 into one card per identity with a row per source, acting on each row's latest request", async () => {
  const fetch = stubFetch()
  const events = [
    { ...event, eventId: "ev-1", timestamp: 1 },
    { ...event, eventId: "ev-2", timestamp: 3, status: 404, path: "/orders/2" },
    { ...event, eventId: "ev-4", timestamp: 0, source: "llm" as const },
    { ...event, eventId: "ev-3", timestamp: 2, idn: "bob", source: "scanner" as const, status: 401 },
  ]
  const verdicts = new Map([["alice", "allow"], ["bob", "deny"], ["carol", "deny"]] as const)
  renderWithQueryClient(<EvidenceActionList events={events} snapshot={{ ...snapshot, evidenceOrdinals: { "ev-1": 1, "ev-2": 2, "ev-3": 3, "ev-4": 4 } }} identityVerdicts={verdicts} />)
  const section = screen.getByRole("region", { name: "관측 기록" })
  expect(within(section).getByRole("heading", { name: "관측 기록" })).toBeVisible()
  // 신원마다 카드 하나. 요청 기록이 없어도 판정이 있는 신원(carol)은 카드로 남는다.
  expect(within(section).getAllByRole("listitem").map(item => item.getAttribute("aria-label"))).toEqual(["alice 관측 기록 3건", "bob 관측 기록 1건", "carol 관측 기록 0건"])
  const alice = within(section).getByRole("listitem", { name: "alice 관측 기록 3건" })
  expect(within(alice).getByText("ALLOW")).toBeVisible()
  expect(within(alice).getAllByRole("group").map(group => group.getAttribute("aria-label"))).toEqual(["alice · HUMAN 2건", "alice · LLM 1건"])
  const human = within(alice).getByRole("group", { name: "alice · HUMAN 2건" })
  expect(within(human).getByRole("img", { name: "HUMAN" })).toBeInTheDocument()
  expect(within(human).getByText("404")).toBeVisible()
  expect(within(screen.getByRole("listitem", { name: "carol 관측 기록 0건" })).getByText("연결된 요청 기록이 없습니다.")).toBeVisible()

  await userEvent.click(within(human).getByRole("button", { name: "요청 2건 펼치기" }))
  const requests = within(human).getByRole("list", { name: "alice · HUMAN 요청 목록" })
  expect(within(requests).getAllByRole("listitem").map(item => item.getAttribute("aria-label"))).toEqual(["관측 기록 #2", "관측 기록 #1"])
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
  const alice = screen.getByRole("listitem", { name: "alice 관측 기록 1건" })
  expect(alice).toHaveTextContent("ALLOW")
  const bobRecord = screen.getByRole("listitem", { name: "bob 관측 기록 1건" })
  expect(bobRecord).not.toHaveTextContent("ALLOW")
  expect(node.selection.cells).toEqual(snapshot.cells)
  expect(graph.edges.find(edge => edge.selection.identity === "bob")?.selection.cells).toEqual([])
  expect(data.events).toContain(bob)
})

it.each(["UNKNOWN", "POLLING"])("shows B's neutral evidence in a folded quiet-group detail (%s)", trafficClass => {
  const bob = { ...event, eventId: "bob-quiet", clusterEvidenceIds: ["bob-quiet"], idn: "bob", resource: null, trafficClass, trafficDisposition: "REVIEW", verdict: "untested" as const }
  const data = { ...snapshot, events: [event, bob] }
  const filters = { source: ["human" as const], identity: [], view: "source" as const, includeSupportTraffic: true, includeRouteCandidates: false, expanded: false }
  const navigation = { level: "site" as const, groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
  const site = projectHierarchy(data, filters, navigation)
  const graph = projectHierarchy(data, filters, navigateHierarchy(navigation, "group", site.groups[0].id))
  const node = graph.nodes.find(node => node.kind === "quiet-group")!
  expect(node.objectGroup?.expanded).toBe(false)
  expect(graph.identities).toEqual([])
  expect(graph.edges).toEqual([])
  expect(node.selection.cells).toEqual(snapshot.cells)
  expect(node.selection.evidenceIds).toEqual(["bob-quiet", "ev-1"])
  renderWithQueryClient(<GraphInspectorPanel selection={node.selection} event={null} snapshot={data} node={node} projection={graph} />)
  expect(screen.getByRole("listitem", { name: "alice 관측 기록 1건" })).toBeVisible()
  expect(screen.getByRole("listitem", { name: "bob 관측 기록 1건" })).not.toHaveTextContent("ALLOW")
  expect(screen.getByText(/인가 판정에 포함되지 않은 관측 기록 1건/)).toBeVisible()
})
