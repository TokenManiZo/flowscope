import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { renderWithQueryClient } from "@/test/render"
import { snapshotFixture } from "@/test/fixtures"
import { actualEvent } from "@/features/parameter-map/parameterMapFixtures"
import { TrafficWorkspace } from "./TrafficWorkspace"
import type { Snapshot } from "@/lib/api/types"

afterEach(() => vi.unstubAllGlobals())
const first = actualEvent({ eventId: "first" })
const second = actualEvent({ eventId: "second", idn: "Bob", status: 403 })
const snapshot: Snapshot = { ...snapshotFixture, datasetRevision: 1, events: [first, second], accounts: [
  { id: "bob", label: "Bob", role: "USER", target: "https://demo.test", color: "", authArtifactCount: 0 },
  { id: "foreign", label: "Foreign", role: "ADMIN", target: "https://foreign.test", color: "", authArtifactCount: 0 },
] }
function transport() {
  const fetch = vi.fn((input: unknown) => {
    const url = new URL(String(input), "http://localhost")
    const id = url.searchParams.get("eventId")
    return Promise.resolve(new Response(JSON.stringify(url.pathname === "/api/manual-attempts" ? [] : {
      records: [{ eventId: id, request: `GET /masked/${id}`, response: `response-${id}` }], total: 1, offset: 0, limit: 1, hasMore: false,
    }), { headers: { "Content-Type": "application/json" } }))
  })
  vi.stubGlobal("fetch", fetch)
  return fetch
}

it("selects exact stored traffic and never sends merely by selecting it", async () => {
  const fetch = transport()
  renderWithQueryClient(<TrafficWorkspace snapshot={snapshot} evidenceIds={["first", "second"]} initialEvent={first} target={{ operation: first.op, resource: first.resource }} />)
  expect(await screen.findByText("response-first")).toBeVisible()
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "확인할 요청" }), "second")
  expect(await screen.findByText("response-second")).toBeVisible()
  expect(screen.queryByText("response-first")).not.toBeInTheDocument()
  expect(fetch.mock.calls.some(([url]) => String(url).includes("eventId=second"))).toBe(true)
  expect(fetch.mock.calls.some(([url]) => String(url).includes("request-lab"))).toBe(false)
})

it("does not borrow a representative object's ownership when an API-only node is selected", async () => {
  transport()
  renderWithQueryClient(<TrafficWorkspace snapshot={snapshot} evidenceIds={["first"]} initialEvent={first} target={{ operation: first.op, resource: null }} />)
  await userEvent.click(screen.getByRole("tab", { name: "접근 규칙" }))
  expect(screen.getByRole("combobox", { name: "필수 역할" })).toHaveValue("UNKNOWN")
  expect(screen.queryByRole("combobox", { name: "리소스 소유자" })).not.toBeInTheDocument()
})

it("offers same-service registered owners without requiring an active session or inventing public/other", async () => {
  transport()
  renderWithQueryClient(<TrafficWorkspace snapshot={snapshot} evidenceIds={["first"]} initialEvent={first} target={{ operation: first.op, resource: first.resource }} />)
  await userEvent.click(screen.getByRole("tab", { name: "접근 규칙" }))
  const owner = screen.getByRole("combobox", { name: "리소스 소유자" })
  expect(within(owner).getByRole("option", { name: "Bob · USER (bob)" })).toHaveValue("bob")
  expect(owner).not.toHaveTextContent(/Foreign|public|other/)
  const roles = within(screen.getByRole("combobox", { name: "필수 역할" })).getAllByRole("option").map(option => (option as HTMLOptionElement).value)
  expect(roles).toEqual(["UNKNOWN", "ANONYMOUS", "USER", "LV1", "LV2", "ADMIN"])
})

it("shows linked verification responses separately and preserves selection when another witness arrives", async () => {
  transport()
  const result = actualEvent({ eventId: "result", phase: "VALIDATION", coverageEligible: false })
  const current = { ...snapshot, events: [...snapshot.events, result], manualVerifications: [{ eventId: "result", originEvidenceId: "first", operation: first.op, resource: first.resource, identity: first.idn, identityId: first.idn, status: 200, durationMs: 15, timestamp: 1 }] }
  const view = renderWithQueryClient(<TrafficWorkspace snapshot={current} evidenceIds={["first"]} initialEvent={first} target={{ operation: first.op, resource: first.resource }} />)
  expect(screen.getByRole("region", { name: "수동 검증 이력" })).toHaveTextContent("first → result")
  await userEvent.click(screen.getByRole("button", { name: "검증 응답 보기" }))
  expect(await screen.findByText("response-result")).toBeVisible()
  view.rerender(<TrafficWorkspace snapshot={{ ...current, revision: 2 }} evidenceIds={["first", "second"]} initialEvent={first} target={{ operation: first.op, resource: first.resource }} />)
  await waitFor(() => expect(screen.getByRole("combobox", { name: "확인할 요청" })).toHaveValue("result"))
  expect(snapshot.events).toHaveLength(2)
})

it("does not replace an unavailable Evidence ID with a different representative request", () => {
  transport()
  renderWithQueryClient(<TrafficWorkspace snapshot={snapshot} evidenceIds={["missing"]} target={{ operation: first.op, resource: first.resource }} />)
  expect(screen.queryByRole("button", { name: "요청 수정·전송 (Request Lab)" })).not.toBeInTheDocument()
})
