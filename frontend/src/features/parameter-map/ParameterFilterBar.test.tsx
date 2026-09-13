import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { defaultParameterFilters } from "./parameterProjection"
import { ParameterFilterBar } from "./ParameterFilterBar"

it("keeps at least one category active and exposes advanced count", async () => {
  const onChange = vi.fn()
  const onOpenAdvanced = vi.fn()
  render(<ParameterFilterBar filters={defaultParameterFilters} activeAdvancedCount={2} advancedOpen={false} onChange={onChange} onOpenAdvanced={onOpenAdvanced} />)

  expect(screen.getByRole("checkbox", { name: "위험 Gap" })).toBeChecked()
  expect(screen.getByRole("checkbox", { name: "권한 검증" })).toBeChecked()
  expect(screen.getByRole("checkbox", { name: "발견 범위" })).toBeChecked()
  expect(screen.getByRole("button", { name: "필터 더보기 · 2개 적용" })).toBeVisible()

  await userEvent.click(screen.getByRole("checkbox", { name: "권한 검증" }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ gapTypes: ["DEFINED_NOT_OBSERVED", "SOURCE_MISSED", "IDENTITY_MISSED", "CONDITION_COMBINATION_UNOBSERVED", "TYPE_VARIANT_UNOBSERVED"] }))
})

it("does not disable the final active category", async () => {
  const onChange = vi.fn()
  render(<ParameterFilterBar filters={{ ...defaultParameterFilters, gapTypes: ["AUTH_VARIANT_UNTESTED"] }} activeAdvancedCount={0} advancedOpen={false} onChange={onChange} onOpenAdvanced={vi.fn()} />)

  await userEvent.click(screen.getByRole("checkbox", { name: "권한 검증" }))
  expect(onChange).not.toHaveBeenCalled()
})

it("exposes the controlled advanced disclosure state", async () => {
  const onOpenAdvanced = vi.fn()
  render(<ParameterFilterBar filters={defaultParameterFilters} activeAdvancedCount={0} advancedOpen={false} onChange={vi.fn()} onOpenAdvanced={onOpenAdvanced} />)

  const button = screen.getByRole("button", { name: "필터 더보기" })
  expect(button).toHaveAttribute("aria-expanded", "false")
  expect(button).toHaveAttribute("aria-controls", "parameter-advanced-filters")
  await userEvent.click(button)
  expect(onOpenAdvanced).toHaveBeenCalledOnce()
})
