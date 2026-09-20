import { expect, it } from "vitest"

import { actualEvent, demoEndpoint, demoEndpointKey, parameterGap, surfaceSnapshot } from "@/features/parameter-map/parameterMapFixtures"
import type { AuthorizationMatrix } from "@/lib/api/types"
import { dashboardCounts, dashboardSummary, hasDashboardData } from "./dashboardSelectors"

it("counts distinct prioritized API coordinates, open unobserved keys, open auth gaps and server review only", () => {
  const base = surfaceSnapshot({
    gaps: [
      parameterGap("source"), parameterGap("identity", { type: "IDENTITY_MISSED" }),
      parameterGap("defined", { type: "DEFINED_NOT_OBSERVED", canonicalPath: "/other" }),
      parameterGap("auth", { type: "AUTH_VARIANT_UNTESTED" }), parameterGap("auth", { type: "AUTH_VARIANT_UNTESTED" }),
      parameterGap("other-service", { endpoint: { ...demoEndpointKey, service: "https://second.test:443" } }),
      parameterGap("no-risk", { priorityReasons: [], endpoint: { ...demoEndpointKey, method: "GET", pathTemplate: "/quiet" } }),
      parameterGap("resolved", { status: "VERIFIED", endpoint: { ...demoEndpointKey, method: "GET", pathTemplate: "/closed" } }),
      parameterGap("dismissed", { type: "AUTH_VARIANT_UNTESTED", status: "DISMISSED" }),
    ],
  })
  const snapshot = { ...base, trafficStats: { ...base.trafficStats, review: 17 } }
  expect(dashboardCounts(snapshot).map(({ label, value }) => ({ label, value }))).toEqual([
    { label: "우선 점검 API", value: 2 }, { label: "미관측 파라미터", value: 4 },
    { label: "권한 변형 미검증", value: 1 }, { label: "검토 필요", value: 17 },
  ])
})

it("moves server traffic stats, counts observations by source, and omits authorization summary when no matrix", () => {
  const base = surfaceSnapshot({ events: [actualEvent({ eventId: "h1", source: "human" }), actualEvent({ eventId: "h2", source: "human" }), actualEvent({ eventId: "s1", source: "scanner" }), actualEvent({ eventId: "l1", source: "llm" }), actualEvent({ eventId: "u1", source: "unknown" })] })
  const snapshot = { ...base, trafficStats: { ...base.trafficStats, captured: 25, coverage: 12, excluded: 3, dropped: 1, payloadMetadataOnly: 2, review: 13 } }
  const summary = dashboardSummary(snapshot)
  expect(summary.trafficStats).toEqual({ captured: 25, coverage: 12, excluded: 3, dropped: 1, payloadMetadataOnly: 2 })
  expect(summary.sourceCounts).toEqual({ human: 2, scanner: 1, llm: 1 })
  expect(summary.authorizationSummary).toBeUndefined()
})

it("fills the authorization summary from the server matrix summary only", () => {
  const matrix = { summary: { policyConfirmed: 0, policyReview: 0, bflaCandidates: 1, bolaIdorCandidates: 2, coverageGaps: 0, invalidExperiments: 0, bflaTestRecommendations: 0, bolaIdorTestRecommendations: 0, manualReviewPending: 13, humanConfirmed: 4, humanDismissed: 5 }, identities: [], functions: [], objects: [], evidence: [], policyLegend: [], evidenceLegend: [], ownershipLegend: [] } satisfies AuthorizationMatrix
  const snapshot = { ...surfaceSnapshot(), authorizationMatrix: matrix }
  expect(dashboardSummary(snapshot).authorizationSummary).toEqual({ bolaIdorCandidates: 2, bflaCandidates: 1, manualReviewPending: 13, humanConfirmed: 4, humanDismissed: 5 })
})

it("treats declared or observed surface facts as dashboard data without inventing captured counts", () => {
  expect(hasDashboardData(surfaceSnapshot())).toBe(false)
  expect(hasDashboardData(surfaceSnapshot({ gaps: [parameterGap("source")] }))).toBe(true)
  expect(hasDashboardData(surfaceSnapshot({ endpoints: [demoEndpoint()] }))).toBe(true)
})
