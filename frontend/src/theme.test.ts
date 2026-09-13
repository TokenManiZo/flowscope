import { afterEach, expect, it } from "vitest"

import "./index.css"

afterEach(() => document.documentElement.classList.remove("dark"))

it("uses one dark base color for the center canvas, side panes, and navigation shell", () => {
  document.documentElement.classList.add("dark")
  const styles = getComputedStyle(document.documentElement)
  const background = styles.getPropertyValue("--background").trim()

  expect(background).toBe("#090b0d")
  expect(styles.getPropertyValue("--flowscope-pane").trim()).toBe(background)
  expect(styles.getPropertyValue("--flowscope-canvas").trim()).toBe(background)
  expect(styles.getPropertyValue("--sidebar").trim()).toBe(background)
})
