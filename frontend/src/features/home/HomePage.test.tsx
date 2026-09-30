import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { HomePage } from "./HomePage"
import { createTestQueryClient, renderWithQueryClient } from "@/test/render"

afterEach(() => { vi.unstubAllGlobals(); window.location.hash = "" })

it("sends an empty project's quick start to account registration first", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)))
  const user = userEvent.setup()
  renderWithQueryClient(<HomePage snapshot={{ observationEvidenceCount: 0, phase: "idle" }} />, createTestQueryClient())

  await user.click(screen.getByRole("button", { name: "빠른 시작" }))

  expect(window.location.hash).toBe("#accounts")
})
