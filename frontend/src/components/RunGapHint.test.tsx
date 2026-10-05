import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { RunGapHint, runGapCount } from "./RunGapHint"
import { targetSnapshot } from "@/test/fixtures"

afterEach(() => { window.location.hash = "" })

it("reads the server count and treats a missing value as zero", () => {
  expect(runGapCount(undefined)).toBe(0)
  expect(runGapCount(targetSnapshot())).toBe(0)
  expect(runGapCount(targetSnapshot({ trafficStats: { ...targetSnapshot().trafficStats, humanApiOutsideRun: 7 } }))).toBe(7)
})

it("renders nothing when no attributable traffic is waiting", () => {
  const { container } = render(<RunGapHint count={0} />)
  expect(container).toBeEmptyDOMElement()
})

it("names the waiting request count and routes the operator to start a HUMAN pass", async () => {
  render(<RunGapHint count={5} />)
  expect(screen.getByRole("status", { name: "run 밖 API 트래픽 안내" })).toHaveTextContent("인증된 API 요청 5건")
  await userEvent.click(screen.getByRole("button", { name: "계정·세션에서 브라우저 열기" }))
  expect(window.location.hash).toBe("#accounts")
})
