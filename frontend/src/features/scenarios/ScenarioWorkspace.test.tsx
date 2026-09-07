import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { expect, it } from "vitest"

import type { Scenario, Snapshot } from "@/lib/api/types"
import { renderWithQueryClient } from "@/test/render"
import { ScenarioWorkspace } from "./ScenarioWorkspace"

function scenario(id: string, values: Partial<Snapshot["scenarios"][number]> = {}): Scenario {
  return { id, tag: "RULE", title: `후보 ${id}`, proposal: "서버 제안", evidence: "서버 근거", risk: "HIGH", evidenceIds: [], reviewStatus: "UNRESOLVED", reviewNote: "", ...values }
}

function Harness({ scenarios }: { scenarios: readonly Scenario[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(scenarios[0]?.id ?? null)
  return <ScenarioWorkspace scenarios={scenarios} selectedId={selectedId} onSelect={setSelectedId} onOpenEvidence={() => null} />
}

it("shows generated candidates separately from the selected detail and switches detail without changing the list", async () => {
  const scenarios = [
    scenario("rule", { title: "규칙 후보", risk: "CRITICAL" }),
    scenario("final", { title: "검증 후보", risk: "LOW" }),
  ]
  renderWithQueryClient(<Harness scenarios={scenarios} />)

  const list = screen.getByRole("region", { name: "시나리오 후보 목록" })
  const detail = screen.getByRole("region", { name: "선택한 시나리오 상세" })
  expect(within(list).getByText("CRITICAL")).toBeVisible()
  expect(within(list).getByText("LOW")).toBeVisible()
  expect(within(detail).getAllByText("규칙 후보").length).toBeGreaterThan(0)

  await userEvent.click(within(list).getByRole("button", { name: /검증 후보/ }))
  expect(within(detail).getByText("검증 후보")).toBeVisible()
  expect(within(list).getAllByText("규칙 후보").length).toBeGreaterThan(0)
})

it("keeps the generated candidate list bounded until explicit expansion", async () => {
  renderWithQueryClient(<Harness scenarios={Array.from({ length: 8 }, (_, index) => scenario(String(index)))} />)
  const list = screen.getByRole("region", { name: "시나리오 후보 목록" })
  expect(within(list).queryByText("후보 7")).not.toBeInTheDocument()
  await userEvent.click(within(list).getByRole("button", { name: "시나리오 목록 더 보기" }))
  expect(within(list).getByText("후보 7")).toBeVisible()
})

it("uses semantic risk and validation tones in both candidate and selected-detail status badges", () => {
  const scenarios = [
    scenario("critical", { risk: "CRITICAL" }),
    scenario("medium", { risk: "MEDIUM" }),
    scenario("low", { risk: "LOW" }),
  ]
  renderWithQueryClient(<Harness scenarios={scenarios} />)

  const list = screen.getByRole("region", { name: "시나리오 후보 목록" })
  const detail = screen.getByRole("region", { name: "선택한 시나리오 상세" })
  expect(within(list).getByText("CRITICAL").closest("[data-slot=badge]")).toHaveClass("text-red-700")
  expect(within(list).getByText("MEDIUM").closest("[data-slot=badge]")).toHaveClass("text-amber-800")
  expect(within(list).getByText("LOW").closest("[data-slot=badge]")).toHaveClass("text-emerald-700")
  expect(within(detail).getByText("CRITICAL").closest("[data-slot=badge]")).toHaveClass("text-red-700")
})
