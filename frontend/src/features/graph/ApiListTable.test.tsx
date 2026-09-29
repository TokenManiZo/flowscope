import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import type { EventRecord } from "@/lib/api/types"
import { ApiListTable } from "./ApiListTable"
import { groupApiRows, pathShape, shortPath } from "./graphApiRows"
import type { HierarchyNode } from "./graphHierarchy"

const operation = (label: string, evidenceIds: string[]) => ({ id: `operation:${label}`, kind: "operation", label, selection: { evidenceIds } }) as unknown as HierarchyNode
const event = (eventId: string, fields: Partial<EventRecord>) => ({ eventId, status: 200, source: "human", idn: "user-1", resource: null, objects: [], ...fields }) as EventRecord

it("turns numeric, UUID and long mixed tokens into {id} and shortens child paths", () => {
  expect(pathShape("/community/posts/TkD2RgHn3tMRp33x3KZcHP")).toBe("/community/posts/{id}")
  expect(pathShape("/orders/42/items/3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b")).toBe("/orders/{id}/items/{id}")
  expect(pathShape("/community/posts/recent")).toBe("/community/posts/recent")
  expect(shortPath("/community/api/v2/community/posts/TkD2RgHn3tMRp33x3KZcHP")).toBe("…/community/posts/TkD2R…3KZcHP")
  const groups = groupApiRows([operation("GET /posts/1", []), operation("GET /posts/recent", []), operation("GET /posts/2", []), operation("POST /posts/1", [])])
  expect(groups.map(group => [group.key, group.items.length])).toEqual([["GET /posts/{id}", 2], ["GET /posts/recent", 1], ["POST /posts/{id}", 1]])
})

it("groups same-shape APIs collapsed, merges their stats, and shows a dash when no object was touched", async () => {
  const onOpen = vi.fn()
  const operations = [...Array.from({ length: 7 }, (_, index) => operation(`GET /posts/${index + 1}`, [`e${index + 1}`])), operation("GET /posts/recent", ["r1"])]
  const events = [
    ...Array.from({ length: 7 }, (_, index) => event(`e${index + 1}`, { idn: index % 2 ? "user-2" : "user-1", resource: `posts:${index + 1}`, status: index === 6 ? 401 : 200, source: index === 6 ? "llm" : "human" })),
    event("r1", { status: 200 }),
  ]
  render(<ApiListTable operations={operations} events={events} onOpen={onOpen} />)
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
  expect(onOpen).toHaveBeenCalledWith(operations[6])
})

it("filters by path, keeping a group when only a member path matches", async () => {
  render(<ApiListTable operations={[operation("GET /posts/1", []), operation("GET /posts/2", []), operation("GET /posts/recent", [])]} events={[]} onOpen={vi.fn()} />)
  await userEvent.type(screen.getByRole("textbox", { name: "경로 검색" }), "posts/2")
  expect(screen.queryByRole("row", { name: "GET /posts/recent" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("row", { name: "GET /posts/{id} 묶음" }))
  expect(screen.getByRole("row", { name: "GET /posts/2" })).toBeVisible()
  expect(screen.queryByRole("row", { name: "GET /posts/1" })).not.toBeInTheDocument()
})
