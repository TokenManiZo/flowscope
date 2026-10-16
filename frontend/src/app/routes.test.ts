import { expect, it } from "vitest"

import { canonicalHash, routeFromHash } from "./routes"

it("keeps the 요청 기록 review alias in the address so the page can open its review tab", () => {
  expect(routeFromHash("#evidence-review")).toBe("evidence")
  expect(canonicalHash("#evidence-review")).toBe("#evidence-review")
  expect(canonicalHash("#parameter-map")).toBe("#graph")
  expect(canonicalHash("#nope")).toBe("#home")
})

it("does not expose the removed surface page through an old hash", () => {
  expect(routeFromHash("#surface")).toBe("home")
  expect(canonicalHash("#surface")).toBe("#home")
})

it("preserves old AI bookmarks and account login handoffs", () => {
  expect(routeFromHash("#ai-tools")).toBe("llm-judgment")
  expect(canonicalHash("#llm-judgment")).toBe("#ai-tools")
  expect(canonicalHash("#accounts/user-b?from=ai-tools")).toBe("#accounts/user-b?from=ai-tools")
})
