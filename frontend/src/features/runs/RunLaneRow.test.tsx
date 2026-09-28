import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import type { ScannerLane } from "@/lib/api/types"
import { RunLaneRow } from "./RunLaneRow"

const lane = (status: string): ScannerLane => ({ account_id: null, account_label: "USER A", status, stage: "CLIENT_SPIDER", captured_records: 4, client_captures: 3, alert_count: 1 }) as ScannerLane

it("shows lane status in plain words and marks only failed lanes in red", () => {
  const { unmount } = render(<ul><RunLaneRow lane={lane("RUNNING")} /></ul>)
  expect(screen.getByText("진행 중")).toHaveAttribute("title", "RUNNING")
  expect(screen.getByText("진행 중")).not.toHaveClass("text-destructive")
  expect(screen.getByText("Client Spider · 전체 4 · Client 3 · Alert 1")).toBeVisible()
  unmount()
  render(<ul><RunLaneRow lane={lane("FAILED")} /></ul>)
  expect(screen.getByText("실패")).toHaveClass("text-destructive")
})
