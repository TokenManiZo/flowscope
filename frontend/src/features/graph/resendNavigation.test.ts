import { afterEach, expect, it } from "vitest"
import { openResendSelection, takeResendSelection } from "./resendNavigation"

afterEach(() => { window.location.hash = "" })

it("opens a replay once in the same project and drops it after a dataset change", () => {
  openResendSelection("ev-1", 3)
  expect(window.location.hash).toBe("#graph")
  expect(takeResendSelection(3)).toBe("ev-1")
  expect(takeResendSelection(3)).toBeNull()
  openResendSelection("ev-2", 3)
  expect(takeResendSelection(4)).toBeNull()
})
