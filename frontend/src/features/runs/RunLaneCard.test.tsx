import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import type { ScannerLane } from "@/lib/api/types"
import { RunLaneCard } from "./RunLaneCard"

const lane = (status: string): ScannerLane => ({ account_id: null, account_label: "USER A", status, stage: "CLIENT_SPIDER", captured_records: 4, client_captures: 3, alert_count: 1 }) as ScannerLane

it("marks only failed lanes in red instead of striping every lane", () => {
  const { container, unmount } = render(<RunLaneCard lane={lane("RUNNING")} />)
  expect(screen.getByText("RUNNING")).not.toHaveClass("text-destructive")
  expect(container.querySelector("[class*='border-l-']")).toBeNull()
  unmount()
  render(<RunLaneCard lane={lane("FAILED")} />)
  expect(screen.getByText("FAILED")).toHaveClass("text-destructive")
})
