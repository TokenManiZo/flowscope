import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest"

import type { Snapshot } from "@/lib/api/types"
import sample from "@/test/sample/sample-snapshot.json"
import { renderWithQueryClient } from "@/test/render"
import { GraphOwnerControl } from "./GraphOwnerControl"

const snapshot = sample as unknown as Snapshot
const resource = "https://demo.flowscope.test:443 orders:101"
const read = "https://demo.flowscope.test:443 GET /api/orders/{id}"

function installFetch() {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(JSON.stringify({ success: true, message: "ok" }), { status: 200, headers: { "Content-Type": "application/json" } })))
  vi.stubGlobal("fetch", fetch)
  return fetch
}
const posts = (fetch: ReturnType<typeof installFetch>, path: string) => fetch.mock.calls.filter(([url]) => String(url) === path).map(([, init]) => String(init?.body))

afterEach(() => vi.unstubAllGlobals())
// Radix Select는 jsdom에 없는 포인터 캡처·스크롤 API를 부른다.
beforeAll(() => {
  Object.defineProperty(Element.prototype, "hasPointerCapture", { configurable: true, value: () => false })
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => undefined })
})
afterAll(() => {
  delete (Element.prototype as { hasPointerCapture?: unknown }).hasPointerCapture
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

it("saves the picked owner only when 변경 is pressed, then undoes it", async () => {
  const fetch = installFetch()
  const user = userEvent.setup()
  renderWithQueryClient(<GraphOwnerControl snapshot={snapshot} operation={read} resource={resource} />)
  const apply = screen.getByRole("button", { name: "변경" })
  expect(apply).toBeDisabled()
  await user.click(screen.getByRole("combobox", { name: "소유자 선택" }))
  await user.click(await screen.findByRole("option", { name: "USER B" }))
  expect(posts(fetch, "/api/owner")).toEqual([])
  await user.click(apply)
  await waitFor(() => expect(posts(fetch, "/api/owner")).toEqual([String(new URLSearchParams({ resource, identity: "acct-demo-user-b" }))]))
  expect(await screen.findByRole("status")).toHaveTextContent("USER B(으)로 변경했습니다")
  await user.click(screen.getByRole("button", { name: "되돌리기" }))
  await waitFor(() => expect(posts(fetch, "/api/owner")).toHaveLength(2))
  expect(posts(fetch, "/api/owner")[1]).toBe(String(new URLSearchParams({ resource, identity: "acct-demo-user-a" })))
})

it("stores Public as a read-API policy and offers it only for read requests", async () => {
  const fetch = installFetch()
  const user = userEvent.setup()
  const { unmount } = renderWithQueryClient(<GraphOwnerControl snapshot={snapshot} operation={read} resource={resource} />)
  await user.click(screen.getByRole("combobox", { name: "소유자 선택" }))
  await user.click(await screen.findByRole("option", { name: "Public" }))
  await user.click(screen.getByRole("button", { name: "변경" }))
  await waitFor(() => expect(posts(fetch, "/api/resource-policy")).toEqual([String(new URLSearchParams({ operation: read, resource, policy: "PUBLIC" }))]))
  expect(posts(fetch, "/api/owner")).toEqual([])
  unmount()

  renderWithQueryClient(<GraphOwnerControl snapshot={snapshot} operation="https://demo.flowscope.test:443 PATCH /api/orders/{id}" resource={resource} />)
  await user.click(screen.getByRole("combobox", { name: "소유자 선택" }))
  expect(await screen.findByRole("option", { name: "Public" })).toHaveAttribute("aria-disabled", "true")
})

it("follows the saved owner when the snapshot changes elsewhere", async () => {
  installFetch()
  const { rerender } = renderWithQueryClient(<GraphOwnerControl snapshot={snapshot} operation={read} resource={resource} />)
  expect(screen.getByRole("combobox", { name: "소유자 선택" })).toHaveTextContent("USER A")
  rerender(<GraphOwnerControl snapshot={{ ...snapshot, owners: { ...snapshot.owners, [resource]: "acct-demo-user-b" }, ownerOverrides: { ...snapshot.ownerOverrides, [resource]: "acct-demo-user-b" } }} operation={read} resource={resource} />)
  expect(screen.getByRole("combobox", { name: "소유자 선택" })).toHaveTextContent("USER B")
})

it("says where to change it when a broader matrix policy keeps the object public", async () => {
  installFetch()
  const user = userEvent.setup()
  const publicSnapshot = { ...snapshot, authorizationMatrix: { ...snapshot.authorizationMatrix, objects: [{ operation: read, resource, resourcePolicy: "PUBLIC" }] } } as unknown as Snapshot
  renderWithQueryClient(<GraphOwnerControl snapshot={publicSnapshot} operation={read} resource={resource} />)
  expect(screen.getByRole("combobox", { name: "소유자 선택" })).toHaveTextContent("Public")
  await user.click(screen.getByRole("combobox", { name: "소유자 선택" }))
  await user.click(await screen.findByRole("option", { name: "USER A" }))
  await user.click(screen.getByRole("button", { name: "변경" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("권한 매트릭스에서 바꾸세요")
})
