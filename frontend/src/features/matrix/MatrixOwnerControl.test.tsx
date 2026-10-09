import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import type { Snapshot } from "@/lib/api/types"
import sample from "@/test/sample/sample-snapshot.json"
import { renderWithQueryClient } from "@/test/render"
import { MatrixOwnerControl } from "./MatrixOwnerControl"

const resource = (sample as unknown as Snapshot).authorizationMatrix!.objects.find(cell => cell.owner === "acct-demo-user-a")!.resource
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

it("saves Public for the selected API and object without changing its owner", async () => {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))
  vi.stubGlobal("fetch", fetch)
  const user = userEvent.setup(), operation = "https://demo.flowscope.test:443 GET /orders/{id}"
  const { rerender } = renderWithQueryClient(<MatrixOwnerControl operation={operation} resource={resource} snapshot={snapshot} disabled={false} />)
  await user.click(screen.getByRole("button", { name: "변경" }))
  await user.selectOptions(screen.getByRole("combobox", { name: "객체 소유자 선택" }), "__PUBLIC__")
  expect(fetch).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "공개로 설정" }))
  await screen.findByRole("status")
  expect(fetch.mock.calls[0]).toMatchObject(["/api/resource-policy", { method: "POST" }])
  expect(Object.fromEntries(new URLSearchParams(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)))).toEqual({ operation, resource, policy: "PUBLIC" })
  expect(fetch).toHaveBeenCalledTimes(1)
  rerender(<MatrixOwnerControl operation={operation} resource={resource} snapshot={{ ...snapshot, resourcePolicyOverrides: { [`${operation} @ ${resource}`]: "PUBLIC" } }} disabled={false} />)
  expect(screen.getByText("누구나 조회 가능 (Public)")).toBeVisible()
})
it.each(["POST", "PUT", "DELETE"])("disables the Public option for %s", method => {
  renderWithQueryClient(<MatrixOwnerControl operation={`https://demo.flowscope.test:443 ${method} /orders`} resource={resource} snapshot={{ ...snapshot, owners: {} }} disabled={false} />)
  expect(screen.getByRole("option", { name: "누구나 조회 가능 (Public)" })).toBeDisabled()
})
