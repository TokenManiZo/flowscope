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
  await user.click(screen.getByRole("button", { name: "취약점 등록" }))
  const dialog = screen.getByRole("dialog")
  expect(within(dialog).getByRole("button", { name: "0건 근거로 등록" })).toBeDisabled()
  await user.click(within(dialog).getByRole("checkbox", { name: "#4 관측 근거" }))
  await user.click(within(dialog).getByRole("button", { name: "1건 근거로 등록" }))
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
  await user.click(screen.getByRole("button", { name: "취약점 등록" }))
  await user.click(screen.getByRole("checkbox", { name: "#4 관측 근거" }))
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
