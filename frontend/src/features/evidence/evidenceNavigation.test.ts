import { expect, it } from "vitest"
import { openEvidenceSelection, openSurfaceSelection, takePageSelection } from "./evidenceNavigation"
it("delivers cross-page selection once, only to its destination and current dataset", () => {
  openEvidenceSelection("e-17","GET /orders",3)
  expect(takePageSelection("surface",3)).toBeNull()
  expect(takePageSelection("evidence",3)).toMatchObject({evidenceId:"e-17",operation:"GET /orders"})
  expect(takePageSelection("evidence",3)).toBeNull()
  openSurfaceSelection("GET /orders",3)
  expect(takePageSelection("surface",4)).toBeNull()
  expect(takePageSelection("surface",3)).toBeNull()
})
