import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it } from "vitest"

import { EvidenceSheet } from "./EvidenceSheet"

it("shows linked records only as #N and leaves out records that no longer have a number", async () => {
  const ids = Array.from({ length: 12 }, (_, index) => `ev-${index}`)
  const ordinals = Object.fromEntries(ids.slice(0, 11).map((id, index) => [id, index + 1]))

  render(
    <EvidenceSheet
      event={null}
      snapshot={{ revision: 1, evidenceOrdinals: ordinals } as never}
      selection={{ kind: "scenario", evidenceIds: [...ids, `<evidence>${"x".repeat(200)}</evidence>`], eventIds: [] }}
      onOpenChange={() => undefined}
    />
  )

  const section = screen.getByText("시나리오 요청 기록 선택").closest("section")!
  expect(section).toHaveTextContent("요청 기록 11건")
  expect(section).toHaveTextContent("#1 #2 #3 #4 #5 #6 #7 #8 #9 #10")
  expect(section).not.toHaveTextContent("#11")
  expect(section).not.toHaveTextContent("ev-")
  expect(section).not.toHaveTextContent("<evidence>")

  await userEvent.click(screen.getByRole("button", { name: "요청 기록 더 보기" }))

  expect(section).toHaveTextContent("#11")
  expect(section).not.toHaveTextContent("ev-11")
})

it("says 없음 when none of the linked records has a number", () => {
  render(
    <EvidenceSheet
      event={null}
      snapshot={{ revision: 1 } as never}
      selection={{ kind: "scenario", evidenceIds: ["ev-gone"], eventIds: [] }}
      onOpenChange={() => undefined}
    />
  )

  const section = screen.getByText("시나리오 요청 기록 선택").closest("section")!
  expect(section).toHaveTextContent("요청 기록없음")
  expect(section).not.toHaveTextContent("ev-gone")
})

it("renders the same detail body inline when the shared workspace owns the Sheet", () => {
  render(
    <EvidenceSheet
      inline
      event={null}
      snapshot={{ revision: 1 } as never}
      selection={{ kind: "scenario", evidenceIds: [], eventIds: [] }}
      onOpenChange={() => undefined}
    />
  )

  expect(screen.getByText("시나리오 요청 기록 선택")).toBeVisible()
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})

it("keeps an inline contained inspector fixed while only its detail body scrolls", () => {
  render(
    <EvidenceSheet
      inline
      contained
      event={null}
      snapshot={{ revision: 1 } as never}
      selection={{ kind: "scenario", evidenceIds: [], eventIds: [] }}
      onOpenChange={() => undefined}
    />
  )

  const detail = screen.getByLabelText("요청 기록 상세")
  expect(detail).toHaveClass("overflow-hidden")
  expect(detail.lastElementChild).toHaveClass("overflow-y-auto")
})
