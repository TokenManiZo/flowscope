import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { demoEndpointKey, parameterGap } from "./parameterMapFixtures"
import { ParameterPriorityQueue } from "./ParameterPriorityQueue"

const fiveGaps = Array.from({ length: 5 }, (_, index) => parameterGap(`gap-${index}`, {
  endpoint: { ...demoEndpointKey, method: index % 2 ? "GET" : "PATCH" },
}))

it("shows three priorities before explicit expansion without reordering the projected queue", async () => {
  const onSelect = vi.fn()
  render(<ParameterPriorityQueue gaps={fiveGaps} selectedGapId={null} onSelect={onSelect} />)

  const queue = screen.getByRole("list", { name: "점검 우선순위 큐" })
  expect(within(queue).getAllByRole("button", { name: /PATCH|GET/ })).toHaveLength(3)
  expect(within(queue).getAllByRole("button").map(button => button.getAttribute("data-gap-id"))).toEqual(["gap-0", "gap-1", "gap-2"])

  await userEvent.click(screen.getByRole("button", { name: "전체 5개 보기" }))
  expect(within(queue).getAllByRole("button", { name: /PATCH|GET/ })).toHaveLength(5)
  expect(within(queue).getAllByRole("button").map(button => button.getAttribute("data-gap-id"))).toEqual(["gap-0", "gap-1", "gap-2", "gap-3", "gap-4"])

  await userEvent.click(screen.getByRole("button", { name: "상위 3개만 보기" }))
  expect(within(queue).getAllByRole("button", { name: /PATCH|GET/ })).toHaveLength(3)
})

it("reports the selected projected gap ID", async () => {
  const onSelect = vi.fn()
  render(<ParameterPriorityQueue gaps={fiveGaps} selectedGapId={null} onSelect={onSelect} />)

  await userEvent.click(screen.getByRole("button", { name: /GET \/orders/ }))
  expect(onSelect).toHaveBeenCalledWith("gap-1")
})
