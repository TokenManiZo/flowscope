import { screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { VerificationPage } from "./VerificationPage"
import { appRoutes, navigationGroups, routeFromHash, routeHash } from "@/app/routes"
import { createTestQueryClient, renderWithQueryClient } from "@/test/render"
import { snapshotFixture } from "@/test/fixtures"

const service = "https://demo.flowscope.test:443"

function renderVerification() {
  const fetchStub = vi.fn((path: string) => {
    if (path === "/api/snapshot") {
      return Promise.resolve(new Response(JSON.stringify({
        ...snapshotFixture,
        accounts: [{ id: "account-a", label: "계정 A", role: "User", target: service, color: "", authArtifactCount: 1 }],
        managedSessions: [{ handle: "h", accountId: "account-a", accountLabel: "계정 A", service, status: "ACTIVE", verificationSource: "OPERATOR_ASSERTED", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
    }
    return Promise.reject(new Error(`unexpected endpoint: ${path}`))
  })
  vi.stubGlobal("fetch", fetchStub)
  return renderWithQueryClient(<VerificationPage />, createTestQueryClient())
}

afterEach(() => vi.unstubAllGlobals())

describe("cross-identity verification route", () => {
  it("keeps #verification in the inspection navigation group", () => {
    expect(routeFromHash("#verification")).toBe("verification")
    expect(routeHash("verification")).toBe("#verification")
    expect(navigationGroups[0]?.routes).toContain("verification")
    expect(appRoutes.some((entry) => entry.route === "verification" && entry.label === "교차 신원 검증")).toBe(true)
  })

  it("renders the real live replay card with registered accounts", async () => {
    renderVerification()

    expect(await screen.findByRole("heading", { name: "교차 신원 검증" })).toBeVisible()
    expect(await screen.findByText("계정 A")).toBeVisible()
  })
})
