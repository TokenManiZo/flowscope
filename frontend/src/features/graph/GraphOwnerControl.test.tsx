import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import type { Snapshot } from "@/lib/api/types"
import sample from "@/test/sample/sample-snapshot.json"
import { renderWithQueryClient } from "@/test/render"
import { GraphOwnerControl } from "./GraphOwnerControl"

const service = "https://demo.flowscope.test:443"
const resource = `${service} observed-object:obj-v1-owner-test`
const snapshot = { ...(sample as unknown as Snapshot), ownerOverrides: { [resource]: "acct-demo-user-a" } } as Snapshot
const unknown = { ...snapshot, ownerOverrides: {} }

function response(status = 200, message = "ok") {
  return new Response(JSON.stringify({ success: status === 200, message }), { status, headers: { "Content-Type": "application/json" } })
}
function installFetch() {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(response()))
  vi.stubGlobal("fetch", fetch)
  return fetch
}
const posts = (fetch: ReturnType<typeof installFetch>) => fetch.mock.calls.filter(([url]) => String(url) === "/api/owner").map(([, init]) => String(init?.body))
const ownerForm = (identity: string) => String(new URLSearchParams({ resource, identity }))

afterEach(() => vi.unstubAllGlobals())

it("changes a confirmed owner only after confirmation and undoes before the snapshot refresh", async () => {
  const fetch = installFetch()
  const user = userEvent.setup()
  renderWithQueryClient(<GraphOwnerControl snapshot={snapshot} resource={resource} />)
  expect(screen.getByRole("heading", { name: /소유자 USER A/ })).toHaveTextContent("직접 확정")
  expect(screen.queryByRole("radiogroup", { name: "소유자 선택" })).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "소유자 바꾸기" }))
  const apply = screen.getByRole("button", { name: "소유자로 확정" })
  expect(apply).toBeDisabled()
  await user.click(screen.getByRole("radio", { name: /USER B/ }))
  expect(posts(fetch)).toEqual([])
  await user.click(apply)
  await waitFor(() => expect(posts(fetch)).toEqual([ownerForm("acct-demo-user-b")]))
  expect(await screen.findByRole("status")).toHaveTextContent("소유자를 USER B(으)로 확정했습니다")
  await user.click(screen.getByRole("button", { name: "되돌리기" }))
  await waitFor(() => expect(posts(fetch)).toEqual([ownerForm("acct-demo-user-b"), ownerForm("acct-demo-user-a")]))
})

it("assigns an unknown OBJ and undo clears that assignment before a snapshot refresh", async () => {
  const fetch = installFetch()
  const user = userEvent.setup()
  renderWithQueryClient(<GraphOwnerControl snapshot={unknown} resource={resource} />)
  expect(screen.getByRole("heading", { name: "객체 소유자 지정" })).toBeVisible()
  expect(screen.getByRole("button", { name: "소유자로 확정" })).toBeDisabled()
  await user.click(screen.getByRole("radio", { name: /USER A/ }))
  expect(posts(fetch)).toEqual([])
  await user.click(screen.getByRole("button", { name: "소유자로 확정" }))
  await user.click(await screen.findByRole("button", { name: "되돌리기" }))
  await waitFor(() => expect(posts(fetch)).toEqual([ownerForm("acct-demo-user-a"), ownerForm("")]))
  expect(screen.getByRole("radio", { name: /USER A/ })).not.toBeChecked()
})

it("shows the shared confirmed OBJ owner and offers Public for read APIs", () => {
  installFetch()
  renderWithQueryClient(<GraphOwnerControl snapshot={{ ...unknown, owners: { [resource]: "acct-demo-user-a" } }} resource={resource} />)
  expect(screen.getByRole("heading", { name: /소유자 USER A/ })).toHaveTextContent("자동 추정")
  expect(screen.getByRole("button", { name: "소유자 바꾸기" })).toBeVisible()
  expect(screen.queryByText(/판정|미점검|IDOR/)).not.toBeInTheDocument()
  expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument()
})

it("follows the saved observed owner when the snapshot changes elsewhere", () => {
  installFetch()
  const { rerender } = renderWithQueryClient(<GraphOwnerControl snapshot={snapshot} resource={resource} />)
  expect(screen.getByRole("heading", { name: /소유자 USER A/ })).toBeVisible()
  rerender(<GraphOwnerControl snapshot={{ ...snapshot, ownerOverrides: { [resource]: "acct-demo-user-b" } }} resource={resource} />)
  expect(screen.getByRole("heading", { name: /소유자 USER B/ })).toBeVisible()
  rerender(<GraphOwnerControl snapshot={unknown} resource={resource} />)
  expect(screen.getByRole("heading", { name: "객체 소유자 지정" })).toBeVisible()
  expect(screen.getByRole("radio", { name: /USER B/ })).not.toBeChecked()
})

it("filters out accounts from other services and asks for registration when none are available", () => {
  installFetch()
  const foreign = { ...snapshot.accounts[0], id: "foreign", label: "FOREIGN", target: "https://foreign.example.test:443" }
  const { rerender } = renderWithQueryClient(<GraphOwnerControl snapshot={{ ...unknown, accounts: [...snapshot.accounts, foreign] }} resource={resource} />)
  expect(screen.queryByRole("radio", { name: /FOREIGN/ })).not.toBeInTheDocument()
  rerender(<GraphOwnerControl snapshot={{ ...unknown, accounts: [foreign] }} resource={resource} />)
  expect(screen.getAllByRole("radio")).toHaveLength(1)
  expect(screen.getByRole("radio", { name: /Public/ })).toBeDisabled()
  expect(screen.getByRole("link", { name: "계정·세션에서 계정 등록" })).toHaveAttribute("href", "#accounts")
  expect(screen.getByRole("button", { name: "소유자로 확정" })).toBeDisabled()
})

it("cancels an edited selection without saving", async () => {
  const fetch = installFetch()
  const user = userEvent.setup()
  renderWithQueryClient(<GraphOwnerControl snapshot={snapshot} resource={resource} />)
  await user.click(screen.getByRole("button", { name: "소유자 바꾸기" }))
  await user.click(screen.getByRole("radio", { name: /USER B/ }))
  await user.click(screen.getByRole("button", { name: "취소" }))
  expect(posts(fetch)).toEqual([])
  expect(screen.getByRole("heading", { name: /소유자 USER A/ })).toBeVisible()
  expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument()
})

it("disables owner changes while suspended", () => {
  installFetch()
  const { rerender } = renderWithQueryClient(<GraphOwnerControl snapshot={unknown} resource={resource} disabled />)
  for (const option of screen.getAllByRole("radio")) expect(option).toBeDisabled()
  expect(screen.getByRole("button", { name: "소유자로 확정" })).toBeDisabled()
  rerender(<GraphOwnerControl snapshot={snapshot} resource={resource} disabled />)
  expect(screen.getByRole("button", { name: "소유자 바꾸기" })).toBeDisabled()
})

it("shows a save error and retains the selection for retry", async () => {
  const fetch = installFetch()
  fetch.mockResolvedValueOnce(response(400, "같은 서비스의 확인된 계정을 선택하세요."))
  const user = userEvent.setup()
  renderWithQueryClient(<GraphOwnerControl snapshot={unknown} resource={resource} />)
  await user.click(screen.getByRole("radio", { name: /USER A/ }))
  await user.click(screen.getByRole("button", { name: "소유자로 확정" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("같은 서비스의 확인된 계정을 선택하세요.")
  expect(screen.getByRole("radio", { name: /USER A/ })).toBeChecked()
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "소유자로 확정" }))
  expect(await screen.findByRole("status")).toHaveTextContent("소유자를 USER A(으)로 확정했습니다")
  expect(posts(fetch)).toEqual([ownerForm("acct-demo-user-a"), ownerForm("acct-demo-user-a")])
})

it("blocks duplicate confirmation and option changes while a save is pending", async () => {
  const fetch = installFetch()
  let finish!: (value: Response) => void
  fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const user = userEvent.setup()
  renderWithQueryClient(<GraphOwnerControl snapshot={unknown} resource={resource} />)
  await user.click(screen.getByRole("radio", { name: /USER A/ }))
  await user.click(screen.getByRole("button", { name: "소유자로 확정" }))
  expect(screen.getByRole("button", { name: "소유자로 확정" })).toBeDisabled()
  for (const option of screen.getAllByRole("radio")) expect(option).toBeDisabled()
  expect(posts(fetch)).toEqual([ownerForm("acct-demo-user-a")])
  finish(response())
  expect(await screen.findByRole("status")).toHaveTextContent("소유자를 USER A(으)로 확정했습니다")
})

const operation = `${service} GET /posts/{id}`
const policyKey = `${operation} @ ${resource}`
it("saves and undoes public read for this API and OBJ without clearing its owner", async () => {
  const fetch = installFetch(), user = userEvent.setup()
  renderWithQueryClient(<GraphOwnerControl snapshot={snapshot} operation={operation} resource={resource} />)
  await user.click(screen.getByRole("button", { name: "소유자 바꾸기" }))
  await user.click(screen.getByRole("radio", { name: /Public/ }))
  expect(fetch).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "공개로 설정" }))
  await screen.findByRole("status")
  await user.click(screen.getByRole("button", { name: "되돌리기" }))
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url) === "/api/resource-policy").map(([, init]) => new URLSearchParams(String(init?.body)).get("policy"))).toEqual(["PUBLIC", "UNKNOWN"]))
  expect(posts(fetch)).toEqual([])
  expect(new URLSearchParams(String(fetch.mock.calls[0][1]?.body)).get("resource")).toBe(resource)
  expect(new URLSearchParams(String(fetch.mock.calls[0][1]?.body)).get("operation")).toBe(operation)
})
it("restores Public from a snapshot and clears it when choosing an owner", async () => {
  const fetch = installFetch(), user = userEvent.setup()
  renderWithQueryClient(<GraphOwnerControl snapshot={{ ...snapshot, resourcePolicyOverrides: { [policyKey]: "PUBLIC" } }} operation={operation} resource={resource} />)
  expect(screen.getByRole("heading", { name: /누구나 조회 가능/ })).toBeVisible()
  await user.click(screen.getByRole("button", { name: "공개 설정 바꾸기" }))
  expect(screen.getByRole("radio", { name: /Public/ })).toBeChecked()
  await user.click(screen.getByRole("radio", { name: /USER B/ }))
  await user.click(screen.getByRole("button", { name: "소유자로 확정" }))
  await screen.findByRole("status")
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(["/api/resource-policy", "/api/owner"])
  expect(posts(fetch)).toEqual([ownerForm("acct-demo-user-b")])
})
it.each(["POST", "PUT", "PATCH", "DELETE"])("disables Public for %s even when body OBJ ownership is available", method => {
  installFetch()
  renderWithQueryClient(<GraphOwnerControl snapshot={unknown} operation={`${service} ${method} /posts`} resource={resource} />)
  expect(screen.getByRole("radio", { name: /Public/ })).toBeDisabled()
  expect(screen.getByRole("radio", { name: /USER A/ })).toBeEnabled()
})
