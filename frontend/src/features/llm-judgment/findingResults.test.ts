import { describe, expect, it } from "vitest"
import type { LlmFinding } from "@/lib/api/types"
import { findingService, findingStatus, findingStatusLabel } from "./findingResults"

const finding = (operation: string, judgment: LlmFinding["judgment"]): LlmFinding => ({
  id: operation, operation, identity: "user-a", verdict: "", confidence: "", note: "",
  evidenceIds: [], createdAt: 1, judgment, judgmentReason: "", judgmentEvidenceIds: [], judgedAt: 0,
})

describe("white-box result labels", () => {
  it("shows crAPI and multi-service cases without assuming an /api prefix", () => {
    expect(findingService(finding("http://localhost:8888 GET /identity/api/v2/vehicle/{id}/location", "vulnerable"))).toBe("localhost:8888")
    expect(findingService(finding("https://shop.test GET /rest/basket/4", "not_vulnerable"))).toBe("shop.test")
    expect(findingService(finding("GET /orders/{id}", "inconclusive"))).toBe("")
  })

  it("labels all result states, including an unjudged candidate", () => {
    expect(findingStatusLabel[findingStatus(finding("GET /orders/1", "vulnerable"))]).toBe("취약")
    expect(findingStatusLabel[findingStatus(finding("GET /orders/2", "inconclusive"))]).toBe("확인 필요")
    expect(findingStatusLabel[findingStatus(finding("GET /orders/3", "not_vulnerable"))]).toBe("정상")
    expect(findingStatusLabel[findingStatus(finding("GET /orders/4", ""))]).toBe("미판정")
  })
})
