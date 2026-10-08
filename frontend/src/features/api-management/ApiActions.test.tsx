import { screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { renderWithQueryClient } from "@/test/render"
import { snapshotFixture } from "@/test/fixtures"
import sample from "@/test/sample/sample-snapshot.json"
import type { Snapshot } from "@/lib/api/types"
import { ApiActions, DeleteTrafficButton } from "./ApiActions"
import { apiConfirmed, apiTint } from "./apiAppearance"

const op = "https://api.test:443 GET /api/orders"
const snapshot: Snapshot = { ...sample as unknown as Snapshot, revision: 7, datasetRevision: 3, events: [{ ...(sample.events[0] as Snapshot["events"][number]), op, eventId: "ev-basis", status: 200 }], evidenceOrdinals: { "ev-basis": 4 } }
function mockAction() {
  const calls: Record<string, unknown>[] = []
  const fetch = vi.fn(async (_url, init: RequestInit) => {
    const request = JSON.parse(new URLSearchParams(String(init.body)).get("change")!)
    calls.push(request)
    return new Response(JSON.stringify({ operations: [op], evidenceIds: ["ev-basis"], records: 1, reviews: 1, declarations: 0 }), { status: 200, headers: { "Content-Type": "application/json" } })
  })
  vi.stubGlobal("fetch", fetch)
  return calls
}
afterEach(() => vi.unstubAllGlobals())
it("saves a canonical API highlight with project revisions and exposes its selected color", async () => {
  const calls = mockAction(), user = userEvent.setup()
  renderWithQueryClient(<ApiActions snapshot={{ ...snapshot, apiMarks: { [op]: { color: "yellow", registered: false, evidenceIds: [] } } }} operation={`${op}#variant`} />)
  await user.click(screen.getByRole("button", { name: "API 하이라이트" }))
  expect(screen.getByRole("button", { name: "노랑 하이라이트" })).toHaveAttribute("aria-pressed", "true")
  await user.click(screen.getByRole("button", { name: "보라 하이라이트" }))
  await waitFor(() => expect(calls).toContainEqual({ action: "highlight", operations: [op], color: "purple", datasetRevision: 3, revision: 7 }))
  expect(apiTint({ ...snapshot, apiMarks: { [op]: { color: "purple", registered: false, evidenceIds: [] } } }, op)).toContain("purple")
})
it("requires explicit observation selection before registering a vulnerability", async () => {
  const calls = mockAction(), user = userEvent.setup()
  renderWithQueryClient(<ApiActions snapshot={snapshot} operation={op} />)
  await user.click(screen.getByRole("button", { name: "취약점으로 표시" }))
  const dialog = screen.getByRole("dialog")
  expect(within(dialog).getByRole("button", { name: "0건 근거로 표시" })).toBeDisabled()
  await user.click(within(dialog).getByRole("checkbox", { name: "#4 요청 기록 선택" }))
  await user.click(within(dialog).getByRole("button", { name: "1건 근거로 표시" }))
  await waitFor(() => expect(calls).toContainEqual({ action: "register", operations: [op], evidenceIds: ["ev-basis"], datasetRevision: 3, revision: 7 }))
  expect(apiConfirmed({ ...snapshotFixture, apiMarks: { [op]: { color: "", registered: true, evidenceIds: ["ev-basis"] } } }, op)).toBe(true)
})
it("previews deletion and blocks confirmation after a snapshot change", async () => {
  const calls = mockAction(), user = userEvent.setup()
  const { rerender } = renderWithQueryClient(<DeleteTrafficButton snapshot={snapshot} operations={[op]} />)
  await user.click(screen.getByRole("button", { name: "API 삭제" }))
  await screen.findByRole("button", { name: "영구 삭제" })
  expect(calls.map(call => call.action)).toEqual(["preview-delete"])
  rerender(<DeleteTrafficButton snapshot={{ ...snapshot, revision: 8 }} operations={[op]} />)
  expect(screen.queryByRole("button", { name: "영구 삭제" })).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "범위 다시 확인" }))
  await user.click(await screen.findByRole("button", { name: "영구 삭제" }))
  await waitFor(() => expect(calls.at(-1)).toEqual({ action: "delete", operations: [op], expectedEvidenceIds: ["ev-basis"], datasetRevision: 3, revision: 8 }))
})

it.each([
  ["dataset", { ...snapshot, datasetRevision: 4 }, op],
  ["API", snapshot, op + "/{id}"],
])("dismisses the registration draft after its %s scope changes", async (_kind, nextSnapshot, nextOp) => {
  mockAction()
  const user = userEvent.setup()
  const { rerender } = renderWithQueryClient(<ApiActions snapshot={snapshot} operation={op} />)
  await user.click(screen.getByRole("button", { name: "취약점으로 표시" }))
  await user.click(screen.getByRole("checkbox", { name: "#4 요청 기록 선택" }))
  rerender(<ApiActions snapshot={nextSnapshot} operation={nextOp} />)
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})
it.each([
  ["dataset", { ...snapshot, datasetRevision: 4 }, [op]],
  ["API", snapshot, [op + "/{id}"]],
])("invalidates the deletion preview after its %s scope changes at the same revision", async (_kind, nextSnapshot, nextOps) => {
  const calls = mockAction(), user = userEvent.setup()
  const { rerender } = renderWithQueryClient(<DeleteTrafficButton snapshot={snapshot} operations={[op]} />)
  await user.click(screen.getByRole("button", { name: "API 삭제" }))
  await screen.findByRole("button", { name: "영구 삭제" })
  rerender(<DeleteTrafficButton snapshot={nextSnapshot} operations={nextOps} />)
  expect(screen.queryByRole("button", { name: "영구 삭제" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "범위 다시 확인" })).toBeEnabled()
  expect(calls.map(call => call.action)).toEqual(["preview-delete"])
})


it("indexes matrix confirmation once and refreshes it for a replacement matrix", () => {
  type Matrix = NonNullable<Snapshot["authorizationMatrix"]>
  let reads = 0
  const confirmed = { operation: op + "#variant", status: "BOLA_IDOR_CANDIDATE", get reviewStatus() { reads++; return "CONFIRMED" } } as Matrix["functions"][number]
  const allowed = { operation: op + "/allowed", status: "EXPECTED_ACCESS", reviewStatus: "CONFIRMED" } as Matrix["functions"][number]
  const unresolved = { operation: op + "/pending", status: "BFLA_CANDIDATE", reviewStatus: "UNRESOLVED" } as Matrix["functions"][number]
  const matrix = { functions: [confirmed, allowed, unresolved], objects: [], evidence: [] } as unknown as Matrix
  const current = { authorizationMatrix: matrix }
  for (let index = 0; index < 100; index++) {
    expect(apiConfirmed(current, op)).toBe(true)
    expect(apiConfirmed(current, op + "/allowed")).toBe(false)
    expect(apiConfirmed(current, op + "/pending")).toBe(false)
  }
  expect(reads).toBe(1)
  const replaced = { authorizationMatrix: { ...matrix, functions: [{ ...confirmed, reviewStatus: "DISMISSED" as const }] } }
  expect(apiConfirmed(replaced, op)).toBe(false)
  expect(apiConfirmed(current, op)).toBe(true)
})


it("applies acknowledged marks and revision without refetching the whole snapshot", async () => {
  const marked = { [op]: { color: "purple", registered: false, evidenceIds: [] } }
  const fetch = vi.fn(async () => new Response(JSON.stringify({ operations: [op], evidenceIds: [], records: 0, reviews: 0, declarations: 0, revision: 8, datasetRevision: 3, apiMarks: marked }), { status: 200, headers: { "Content-Type": "application/json" } }))
  vi.stubGlobal("fetch", fetch)
  const user = userEvent.setup()
  const { client } = renderWithQueryClient(<ApiActions snapshot={snapshot} operation={op} />)
  client.setQueryDefaults(["snapshot"], { gcTime: Infinity })
  client.setQueryData(["snapshot"], snapshot)
  const invalidate = vi.spyOn(client, "invalidateQueries")
  await user.click(screen.getByRole("button", { name: "API 하이라이트" }))
  await user.click(screen.getByRole("button", { name: "보라 하이라이트" }))
  await waitFor(() => expect(client.getQueryData<Snapshot>(["snapshot"])?.revision).toBe(8))
  expect(client.getQueryData<Snapshot>(["snapshot"])?.apiMarks).toEqual(marked)
  expect(invalidate).not.toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it("applies object highlight and registration to its API while restricting deletion to object evidence", async () => {
  const calls = mockAction(), user = userEvent.setup()
  renderWithQueryClient(<ApiActions snapshot={snapshot} operation={op} deleteEvidenceIds={["object-request"]} deleteLabel="객체 삭제" size="lg" />)
  await user.click(screen.getByRole("button", { name: "API 하이라이트" }))
  await user.click(screen.getByRole("button", { name: "보라 하이라이트" }))
  await waitFor(() => expect(calls).toContainEqual({ action: "highlight", operations: [op], color: "purple", datasetRevision: 3, revision: 7 }))
  await user.keyboard("{Escape}")
  await user.click(screen.getByRole("button", { name: "취약점으로 표시" }))
  await user.click(screen.getByRole("checkbox", { name: "#4 요청 기록 선택" }))
  await user.click(screen.getByRole("button", { name: "1건 근거로 표시" }))
  await waitFor(() => expect(calls).toContainEqual({ action: "register", operations: [op], evidenceIds: ["ev-basis"], datasetRevision: 3, revision: 7 }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  await user.click(screen.getByRole("button", { name: "객체 삭제" }))
  await screen.findByRole("button", { name: "영구 삭제" })
  expect(calls.at(-1)).toEqual({ action: "preview-delete", evidenceIds: ["object-request"], datasetRevision: 3, revision: 7 })
})

it("uses the chosen original API key for actions on a displayed API bundle", async () => {
  const calls = mockAction(), user = userEvent.setup(), second = op + "/{id}"
  renderWithQueryClient(<ApiActions snapshot={snapshot} operations={[op + "#variant", op, second]} />)
  const picker = screen.getByRole("combobox", { name: "조작할 API" })
  expect(within(picker).getAllByRole("option")).toHaveLength(2)
  await user.selectOptions(picker, second)
  await user.click(screen.getByRole("button", { name: "API 하이라이트" }))
  await user.click(screen.getByRole("button", { name: "보라 하이라이트" }))
  await waitFor(() => expect(calls.at(-1)).toMatchObject({ action: "highlight", operations: [second] }))
  await user.click(screen.getByRole("button", { name: "API 하이라이트" }))
  await user.click(screen.getByRole("button", { name: "API 삭제" }))
  await waitFor(() => expect(calls.at(-1)).toMatchObject({ action: "preview-delete", operations: [second] }))
})
