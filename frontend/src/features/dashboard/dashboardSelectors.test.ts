import { expect, it } from "vitest"

import { demoEndpoint, demoEndpointKey, parameterGap, surfaceSnapshot } from "@/features/parameter-map/parameterMapFixtures"
import { dashboardCounts, hasDashboardData } from "./dashboardSelectors"

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

it("treats declared or observed surface facts as dashboard data without inventing captured counts", () => {
  expect(hasDashboardData(surfaceSnapshot())).toBe(false)
  expect(hasDashboardData(surfaceSnapshot({ gaps: [parameterGap("source")] }))).toBe(true)
  expect(hasDashboardData(surfaceSnapshot({ endpoints: [demoEndpoint()] }))).toBe(true)
})
