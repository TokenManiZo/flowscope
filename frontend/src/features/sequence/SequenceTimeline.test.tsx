import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { SequenceGroup } from "./sequenceProjection"
import { SequenceTimeline } from "./SequenceTimeline"

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverStub)

const group: SequenceGroup = {
  key: '["alice"]',
  identity: "alice",
  links: [
    { key: "first", index: 3, link: { fromEventId: "producer-1", toEventId: "consumer-1", fromOp: "GET /tokens", toOp: "POST /orders", idn: "alice", source: "llm", values: "token=***" } },
    { key: "second", index: 7, link: { fromEventId: "producer-2", toEventId: "consumer-2", fromOp: "GET /orders/1", toOp: "PATCH /orders/1", idn: "alice", source: "scanner", values: "orderId=***" } },
  ],
}

it("renders each projected link as an ordered producer, masked value, and consumer row with source semantics", async () => {
  const onSelect = vi.fn()
  render(<TooltipProvider><SequenceTimeline group={group} onSelect={onSelect} /></TooltipProvider>)

  const timeline = screen.getByRole("region", { name: "데이터 의존 타임라인" })
  const rows = within(timeline).getAllByRole("listitem")
  expect(within(rows[0]).getByText("GET /tokens")).toBeVisible()
  expect(within(rows[0]).getByText("token=***")).toBeVisible()
  expect(within(rows[0]).getByText("POST /orders")).toBeVisible()
  expect(within(rows[0]).getByText("L · LLM · 점선")).toHaveClass("border-dotted")
  expect(within(rows[1]).getByText("S · SCANNER · 파선")).toHaveClass("border-dashed")
  expect(within(timeline).getAllByText("1. 생산")).toHaveLength(2)
  expect(within(timeline).getAllByText("2. 전달 값")).toHaveLength(2)
  expect(within(timeline).getAllByText("3. 소비")).toHaveLength(2)

  await userEvent.click(within(rows[1]).getByRole("button", { name: "흐름 링크 요청 기록 열기" }))
  expect(onSelect).toHaveBeenCalledWith(group.links[1])
})

it("keeps a long identity bounded in ordinary body text and out of accessible attributes until explicit expansion", async () => {
  const identity = `<identity data-probe="raw">${"i".repeat(220)}</identity>`
  render(<TooltipProvider><SequenceTimeline group={{ ...group, key: "long", identity }} onSelect={() => undefined} /></TooltipProvider>)

  expect(screen.getByRole("region", { name: "데이터 의존 타임라인" })).toBeVisible()
  expect(document.body.textContent).not.toContain(identity)
  for (const element of Array.from(document.querySelectorAll("[aria-label], [aria-description], [title], [aria-live]"))) {
    expect(element.getAttribute("aria-label") ?? "").not.toContain(identity)
    expect(element.getAttribute("aria-description") ?? "").not.toContain(identity)
    expect(element.getAttribute("title") ?? "").not.toContain(identity)
    if (element.hasAttribute("aria-live")) expect(element.textContent).not.toContain(identity)
  }
  await userEvent.click(screen.getByRole("button", { name: "계정 더 보기" }))
  expect(document.body.textContent).toContain(identity)
  expect(screen.queryByRole("identity")).not.toBeInTheDocument()
})

it("bounds producer and consumer operations independently", () => {
  const longConsumer = `POST /${"x".repeat(220)}`
  const independent: SequenceGroup = { ...group, links: [{ ...group.links[0], link: { ...group.links[0].link, fromOp: "GET /short", toOp: longConsumer } }] }
  render(<TooltipProvider><SequenceTimeline group={independent} onSelect={() => undefined} /></TooltipProvider>)

  expect(screen.getByText("GET /short")).toBeVisible()
  expect(document.body.textContent).not.toContain(longConsumer)
  expect(screen.getByRole("button", { name: "작업 더 보기" })).toBeVisible()
})
