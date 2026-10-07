import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import type { Cell, EventRecord } from "@/lib/api/types"
import { EMPTY_HIGHLIGHT } from "./graphHighlight"
import { ApiListTable } from "./ApiListTable"
import { groupApiRows, pathShape, shortPath } from "./graphApiRows"
import type { HierarchyNode } from "./graphHierarchy"

const operation = (label: string, evidenceIds: string[]) => ({ id: `operation:${label}`, kind: "operation", label, selection: { operation: label, evidenceIds } }) as unknown as HierarchyNode
const event = (eventId: string, fields: Partial<EventRecord>) => ({ eventId, op: "", status: 200, source: "human", idn: "user-1", resource: null, objects: [], ...fields }) as EventRecord

it("turns numeric, UUID and long mixed tokens into {id} and shortens child paths", () => {
  expect(pathShape("/community/posts/TkD2RgHn3tMRp33x3KZcHP")).toBe("/community/posts/{id}")
  expect(pathShape("/orders/42/items/3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b")).toBe("/orders/{id}/items/{id}")
  expect(pathShape("/community/posts/recent")).toBe("/community/posts/recent")
  expect(shortPath("/community/api/v2/community/posts/TkD2RgHn3tMRp33x3KZcHP")).toBe("…/community/posts/TkD2R…3KZcHP")
  const groups = groupApiRows([operation("GET /posts/1", []), operation("GET /posts/recent", []), operation("GET /posts/2", []), operation("POST /posts/1", [])])
  expect(groups.map(group => [group.key, group.items.length])).toEqual([["GET /posts/{id}", 2], ["GET /posts/recent", 1], ["POST /posts/{id}", 1]])
})

it("groups same-shape APIs collapsed, merges their stats, and selects rows in place", async () => {
  const onSelectApi = vi.fn()
  const operations = [...Array.from({ length: 7 }, (_, index) => operation(`GET /posts/${index + 1}`, [`e${index + 1}`])), operation("GET /posts/recent", ["r1"])]
  const events = [
    ...Array.from({ length: 7 }, (_, index) => event(`e${index + 1}`, { idn: index % 2 ? "user-2" : "user-1", resource: `posts:${index + 1}`, status: index === 6 ? 401 : 200, source: index === 6 ? "llm" : "human" })),
    event("r1", { status: 200 }),
  ]
  render(<ApiListTable operations={operations} snapshot={{ events, cells: [], owners: {} }} selectedId={null} onSelectApi={onSelectApi} onSelectObject={vi.fn()} />)
  const group = screen.getByRole("row", { name: "GET /posts/{id} 묶음" })
  expect(group).toHaveAttribute("aria-expanded", "false")
  expect(within(group).queryByText(/7개/)).not.toBeInTheDocument()
  expect(within(group).getByText("200")).toBeVisible()
  expect(within(group).getByText("401")).toBeVisible()
  expect(within(group).getByText("posts 7")).toBeVisible()
  expect(within(group).getByText("2")).toBeVisible()
  expect(within(screen.getByRole("row", { name: "GET /posts/recent" })).getByText("–")).toBeVisible()
  expect(screen.queryByRole("row", { name: "GET /posts/1" })).not.toBeInTheDocument()

  await userEvent.click(group)
  expect(screen.getByRole("row", { name: "GET /posts/5" })).toBeVisible()
  expect(screen.queryByRole("row", { name: "GET /posts/6" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByText("… 2개 더"))
  await userEvent.click(screen.getByRole("row", { name: "GET /posts/7" }))
  expect(onSelectApi).toHaveBeenCalledWith(operations[6])
})

it("filters by path, keeping a group when only a member path matches", async () => {
  render(<ApiListTable operations={[operation("GET /posts/1", []), operation("GET /posts/2", []), operation("GET /posts/recent", [])]} snapshot={{ events: [], cells: [], owners: {} }} selectedId={null} onSelectApi={vi.fn()} onSelectObject={vi.fn()} />)
  await userEvent.type(screen.getByRole("textbox", { name: "경로 검색" }), "posts/2")
  expect(screen.queryByRole("row", { name: "GET /posts/recent" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("row", { name: "GET /posts/{id} 묶음" }))
  expect(screen.getByRole("row", { name: "GET /posts/2" })).toBeVisible()
  expect(screen.queryByRole("row", { name: "GET /posts/1" })).not.toBeInTheDocument()
})

it("reveals a search result beyond the group preview while keeping the original operations", async () => {
  const operations = Object.freeze(Array.from({ length: 7 }, (_, index) => operation(`GET /posts/${index + 1}`, [])))
  const onSelectApi = vi.fn()
  render(<ApiListTable operations={operations} snapshot={{ events: [], cells: [], owners: {} }} selectedId={operations[6].id} revealNodeId={operations[6].id} onSelectApi={onSelectApi} onSelectObject={vi.fn()} />)
  expect(screen.getByRole("row", { name: "GET /posts/{id} 묶음" })).toHaveAttribute("aria-expanded", "true")
  expect(screen.getByRole("row", { name: "GET /posts/5" })).toBeVisible()
  expect(screen.queryByRole("row", { name: "GET /posts/6" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("row", { name: "GET /posts/7" }))
  expect(onSelectApi).toHaveBeenCalledWith(operations[6])
  await userEvent.click(screen.getByText("… 1개 더"))
  expect(screen.getByRole("row", { name: "GET /posts/6" })).toBeVisible()
  expect(operations).toHaveLength(7)
})

it("opens an object list under the row from the chip, marking only server-suspicious access as an IDOR candidate", async () => {
  const onSelectApi = vi.fn(), onSelectObject = vi.fn()
  const orders = operation("GET /orders/all", ["o1", "o2", "o3"])
  const cell = (idn: string, resource: string, overall: Cell["overall"]) => ({ idn, op: "GET /orders/all", resource, overall, evidenceIds: [] }) as unknown as Cell
  const events = [
    event("o1", { op: "GET /orders/all", idn: "user-1", resource: "orders:101" }),
    event("o2", { op: "GET /orders/all", idn: "user-2", resource: "orders:101" }),
    event("o3", { op: "GET /orders/all", idn: "anon", resource: "orders:103", status: 401 }),
  ]
  const cells = [cell("user-1", "orders:101", "allow"), cell("user-2", "orders:101", "suspicious"), cell("anon", "orders:103", "deny"), cell("user-1", "invoices:9", "allow")]
  render(<ApiListTable operations={[orders]} snapshot={{ events, cells, owners: { "orders:101": "user-1" } }} selectedId={null} onSelectApi={onSelectApi} onSelectObject={onSelectObject} />)
  await userEvent.click(screen.getByRole("button", { name: "orders 객체 2개 펼치기" }))
  expect(onSelectApi).not.toHaveBeenCalled()
  const list = screen.getByRole("table", { name: "orders 객체 목록" })
  const owned = within(list).getByRole("row", { name: "orders:101" })
  expect(within(owned).getByText("user-1", { selector: "td" })).toBeVisible()
  expect(within(owned).getAllByText("IDOR 후보")).toHaveLength(1)
  expect(within(owned).getByText("IDOR 후보").parentElement).toHaveTextContent("user-2")
  expect(within(within(list).getByRole("row", { name: "orders:103" })).getByText("미확정")).toBeVisible()
  await userEvent.click(owned)
  expect(onSelectObject).toHaveBeenCalledWith("orders:101", [cells[0], cells[1]])
  // 다른 객체 목록을 열어도 먼저 연 목록은 그대로 열려 있다.
  await userEvent.click(screen.getByRole("button", { name: "invoices 객체 1개 펼치기" }))
  expect(screen.getByRole("table", { name: "orders 객체 목록" })).toBeVisible()
  expect(screen.getByRole("table", { name: "invoices 객체 목록" })).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "orders 객체 2개 접기" }))
  expect(screen.queryByRole("table", { name: "orders 객체 목록" })).not.toBeInTheDocument()
})


it("keeps the identity filter when opening Object rows and restores all rows when cleared", async () => {
  const op = "GET /orders/{id}"
  const events = [event("a", { op, idn: "alice", resource: "orders:1" }), event("b", { op, idn: "bob", resource: "orders:2" })]
  const cells = events.map(item => ({ idn: item.idn, op, resource: item.resource, perSource: { human: "allow" }, evidenceIds: [item.eventId], reasons: {}, overall: "allow", conflict: false, missedSources: [] }) as Cell)
  const props = { operations: [operation(op, ["a", "b"])], snapshot: { events, cells, owners: {} }, selectedId: null, onSelectApi: vi.fn(), onSelectObject: vi.fn() }
  const { rerender } = render(<ApiListTable {...props} filters={{ ...EMPTY_HIGHLIGHT, identities: ["alice"] }} />)
  await userEvent.click(screen.getByRole("button", { name: "orders 객체 1개 펼치기" }))
  const table = screen.getByRole("table", { name: "orders 객체 목록" })
  expect(within(table).getByText("alice")).toBeVisible()
  expect(within(table).queryByText("bob")).not.toBeInTheDocument()
  expect(within(table).queryByRole("row", { name: "orders:2" })).not.toBeInTheDocument()
  await userEvent.click(within(table).getByRole("row", { name: "orders:1" }))
  expect(props.onSelectObject).toHaveBeenCalledWith("orders:1", [cells[0]])
  rerender(<ApiListTable {...props} filters={EMPTY_HIGHLIGHT} />)
  expect(within(screen.getByRole("table", { name: "orders 객체 목록" })).getByText("bob")).toBeVisible()
})
