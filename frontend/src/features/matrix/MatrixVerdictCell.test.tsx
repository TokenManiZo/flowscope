import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { MatrixVerdictCell, matrixVerdictTone } from "./MatrixVerdictCell"
import type { MatrixMember } from "./matrixProjection"

it("maps server verdicts to readable semantic tones", () => {
  expect(matrixVerdictTone("allow").label).toBe("ALLOW")
  expect(matrixVerdictTone("deny").className).toContain("bg-red-500/10")
  expect(matrixVerdictTone("suspicious").className).toContain("bg-amber-500/10")
  expect(matrixVerdictTone("undecided").className).toContain("bg-violet-500/10")
  expect(matrixVerdictTone("untested").className).toContain("bg-zinc-500/10")
  expect(matrixVerdictTone("unknown").className).toContain("bg-zinc-500/10")
})

it("renders unobserved source rows with a readable zinc-neutral badge", () => {
  const member: MatrixMember = {
    key: "untested-member",
    identity: "alice",
    cell: { idn: "alice", op: "GET /orders", resource: null, perSource: {}, reasons: {}, overall: "untested", conflict: false, missedSources: [], evidenceIds: [] },
    gap: undefined,
  }

  render(<TooltipProvider><MatrixVerdictCell member={member} mode="identity" onSelect={() => {}} /></TooltipProvider>)

  expect(screen.getByText("H · HUMAN · 미관측 · 실선")).toHaveClass("border-zinc-500/50", "bg-zinc-500/10", "text-zinc-700")
})
