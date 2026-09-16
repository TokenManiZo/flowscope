import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it } from "vitest"

import { EvidenceSheet } from "./EvidenceSheet"

it("keeps selected Evidence IDs bounded in ordinary sheet body content until expanded", async () => {
  const longEvidenceId = `<evidence>${"x".repeat(200)}</evidence>`

  render(
    <EvidenceSheet
      event={null}
      snapshot={{ revision: 1 } as never}
      selection={{ kind: "scenario", evidenceIds: [longEvidenceId], eventIds: [] }}
      onOpenChange={() => undefined}
    />
  )

  expect(screen.getByText("시나리오 Evidence 선택").closest("section")).not.toHaveTextContent(longEvidenceId)
  expect(screen.getByRole("button", { name: "Evidence ID 더 보기" })).toBeVisible()
  expect(screen.getByText("Evidence IDs (1)").closest("div")?.querySelector("textarea")).toBeNull()

  await userEvent.click(screen.getByRole("button", { name: "Evidence ID 더 보기" }))

  expect(screen.getByText(longEvidenceId)).toBeVisible()
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

  expect(screen.getByText("시나리오 Evidence 선택")).toBeVisible()
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

  const detail = screen.getByLabelText("Evidence 상세")
  expect(detail).toHaveClass("overflow-hidden")
  expect(detail.lastElementChild).toHaveClass("overflow-y-auto")
})
