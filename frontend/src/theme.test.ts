import { afterEach, expect, it } from "vitest"

import "./index.css"

afterEach(() => document.documentElement.classList.remove("dark"))

it("shares the page dark base between the graph canvas and side panes", () => {
  document.documentElement.classList.add("dark")
  const styles = getComputedStyle(document.documentElement)
  const background = styles.getPropertyValue("--background").trim()

  // 그래프 캔버스·페인은 페이지 베이스(네이비)와 같은 색이어야 앱과 이음매가 없다.
  expect(background).toBe("oklch(0.129 0.042 264.695)")
  expect(styles.getPropertyValue("--flowscope-pane").trim()).toBe(background)
  expect(styles.getPropertyValue("--flowscope-canvas").trim()).toBe(background)
  // 네비게이션 셸(사이드바)은 의도적으로 한 단계 elevation된 네이비(card와 동일)다.
  expect(styles.getPropertyValue("--sidebar").trim()).toBe(styles.getPropertyValue("--card").trim())
})
