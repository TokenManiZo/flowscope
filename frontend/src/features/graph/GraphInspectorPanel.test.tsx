import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import type { ManagedSession, Snapshot } from "@/lib/api/types"
import { renderWithQueryClient } from "@/test/render"
import { GraphInspectorPanel } from "./GraphInspectorPanel"
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
  const fetch = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(json(String(input) === "/api/replay" ? { success: true, message: "", status: 200, replayId: "r-1", openedDraft: true } : body)))
  vi.stubGlobal("fetch", fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

it("shows only the selected operation and its Evidence rows, without verdict panels or raw event ids", () => {
  renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={{ ...snapshot, evidenceOrdinals: { "ev-1": 7 } }} />)
  const panel = screen.getByRole("complementary", { name: "선택 작업" })
  expect(panel).toHaveTextContent("GET /orders/{id}")
  const row = within(panel).getByRole("listitem", { name: "Evidence #7" })
  expect(row).toHaveTextContent("alice")
  expect(row).toHaveTextContent("200")
  expect(within(row).getByRole("img", { name: "HUMAN" })).toBeInTheDocument()
  expect(panel).not.toHaveTextContent("ev-1")
  expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  expect(screen.queryByRole("region", { name: "Access Check" })).not.toBeInTheDocument()
})

it("opens the raw request in Request Lab without sending anything", async () => {
  const fetch = stubFetch()
  renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={snapshot} />)
  await userEvent.click(screen.getByRole("button", { name: "원문 보기" }))
  expect(await screen.findByLabelText("Request Lab 요청 원문")).toHaveValue(secret)
  // 초안과 검증 이력 조회(GET)만 있고 전송(POST)은 없다.
  expect(fetch.mock.calls.map(([input]) => String(input))).toContain("/api/request-lab?eventId=ev-1")
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([])
})

it("opens the observed identity's current session in Repeater without keeping raw text in the query cache", async () => {
  const fetch = stubFetch()
  const { client } = renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={{ ...snapshot, managedSessions: [session] }} />)
  await userEvent.click(screen.getByRole("button", { name: "현재 세션으로 Repeater" }))
  expect(await screen.findByRole("status")).toHaveTextContent("Repeater에 열었습니다")
  const replay = fetch.mock.calls.find(([input]) => String(input) === "/api/replay")
  expect(new URLSearchParams(String(replay?.[1]?.body))).toEqual(new URLSearchParams({ eventId: "ev-1", request: secret, credentialMode: "ACCOUNT", accountId: "acct-1" }))
  expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain("SECRET-RAW")
})

it("explains a missing current session instead of opening Repeater", async () => {
  const fetch = stubFetch(draft({ reusableAccountId: undefined }))
  renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={{ ...snapshot, managedSessions: [session] }} />)
  await userEvent.click(screen.getByRole("button", { name: "현재 세션으로 Repeater" }))
  expect(await screen.findByRole("status")).toHaveTextContent("현재 세션이 없습니다")
  expect(fetch.mock.calls.some(([input]) => String(input) === "/api/replay")).toBe(false)
})

it("locks Evidence actions while the snapshot is suspended", () => {
  renderWithQueryClient(<GraphInspectorPanel selection={selection} event={event} snapshot={snapshot} suspended />)
  expect(screen.getByRole("button", { name: "원문 보기" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "현재 세션으로 Repeater" })).toBeDisabled()
})
