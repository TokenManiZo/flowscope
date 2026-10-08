import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import type { Snapshot } from "@/lib/api/types"
import sample from "@/test/sample/sample-snapshot.json"
import { renderWithQueryClient } from "@/test/render"
import { MatrixOwnerControl } from "./MatrixOwnerControl"

const resource = "https://demo.flowscope.test:443 orders:101"
const snapshot = sample as unknown as Snapshot
afterEach(() => vi.unstubAllGlobals())

it("changes ownership through the existing owner endpoint only after saving and excludes other services", async () => {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))
  vi.stubGlobal("fetch", fetch)
  const user = userEvent.setup()
  renderWithQueryClient(<MatrixOwnerControl resource={resource} snapshot={{ ...snapshot, accounts: [...snapshot.accounts, { id: "outside", label: "외부 계정", target: "https://outside.test:443", role: "User", color: "", authArtifactCount: 0 }] }} disabled={false} />)
  await user.click(screen.getByRole("button", { name: "변경" }))
  expect(screen.queryByRole("option", { name: "외부 계정" })).not.toBeInTheDocument()
  await user.selectOptions(screen.getByRole("combobox", { name: "객체 소유자 선택" }), "acct-demo-user-b")
  expect(fetch).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "소유자 저장" }))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(fetch.mock.calls[0][0]).toBe("/api/owner")
  expect(Object.fromEntries(new URLSearchParams(String(fetch.mock.calls[0][1]?.body)))).toEqual({ resource, identity: "acct-demo-user-b" })
  expect(await screen.findByRole("status")).toHaveTextContent("객체 소유자를 저장했습니다.")
})

it("shows save failure without hiding the edit controls", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("저장 연결 실패"))))
  const user = userEvent.setup()
  renderWithQueryClient(<MatrixOwnerControl resource={resource} snapshot={snapshot} disabled={false} />)
  await user.click(screen.getByRole("button", { name: "변경" }))
  await user.click(screen.getByRole("button", { name: "소유자 저장" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("저장 연결 실패")
  expect(screen.getByRole("combobox", { name: "객체 소유자 선택" })).toBeVisible()
})
