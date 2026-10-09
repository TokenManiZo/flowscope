import { expect, test } from "@playwright/test"
import { snapshotFixture, humanRunFixture, scannerRunFixture, zapStatusFixture } from "../src/test/fixtures"
const service = "https://matrix.invalid:443"
const operation = `${service} GET /api/shop/orders/{id}`
const confidence = { code: "P0", level: 0, label: "미정", basis: "사용자 지정" }
const objects = Array.from({ length: 8 }, (_, i) => ["a", "b"].map(identity => ({
  id: `cell-${i}-${identity}`, identity, identityLabel: `USER ${identity.toUpperCase()}`, role: "User", operation: `${service} GET /api/shop/orders/opaque${String.fromCharCode(97 + i)}`,
  resource: `${service} observed-object:key-${i}`, owner: "a", ownerLabel: "USER A", relation: identity === "a" ? "OWNER" : "SAME_ROLE_FOREIGN",
  techniques: ["BOLA", "IDOR"], resourcePolicy: "UNKNOWN", ownership: confidence, policy: confidence, evidence: confidence,
  expected: "UNKNOWN", actual: "UNTESTED", status: identity === "a" ? "EXPECTED_ACCESS" : i === 3 ? "BOLA_IDOR_CANDIDATE" : "BOLA_IDOR_TEST_RECOMMENDED",
  statusLabel: "서버 판정", blockingLayers: [], gates: [], statusCodes: [], sourceVerdicts: {}, evidenceIds: [],
  reviewStatus: "UNRESOLVED", reviewNote: "", reviewEvidenceIds: [], recommendation: null,
}))).flat()
const second = { ...objects[0], id: "second", operation: `${service} POST /api/auth/login`, resource: `${service} login:1` }
const displayObjects = Array.from({ length: 8 }, (_, i) => ({ eventId: `event-${i}`, operation: `${service} GET /api/shop/orders/opaque${String.fromCharCode(97 + i)}`, apiKey: operation, objectKey: `key-${i}`, groupKey: "orders", kind: "PATH", fields: ["/segments/3"], legacyResource: null, ordinal: i + 1 }))
const matrix = { summary: { bflaTestRecommendations: 0, bolaIdorTestRecommendations: 7, manualReviewPending: 8, humanConfirmed: 0, humanDismissed: 0 },
  identities: ["a", "b"].map(id => ({ id, label: `USER ${id.toUpperCase()}`, role: "User", kind: "REGISTERED" })),
  functions: [], objects: [...objects, second], evidence: [], configurationWarnings: [], policyLegend: [], evidenceLegend: [], ownershipLegend: [], }
for (const theme of ["dark", "light"] as const) for (const width of [600, 1280]) {
  test(`matrix API focus and exclusions ${theme} ${width}px`, async ({ page, baseURL }, info) => {
    await page.setViewportSize({ width, height: 850 })
    await page.addInitScript(theme => localStorage.setItem("flowscope-theme", theme), theme)
    const origin = new URL(baseURL!).origin
    const errors: string[] = [], mutations: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) { await route.abort(); return }
      if (!url.pathname.startsWith("/api/")) { await route.continue(); return }
      if (request.method() !== "GET") { mutations.push(url.pathname); await route.abort(); return }
      const body = url.pathname === "/api/snapshot" ? { ...snapshotFixture, displayObjects, authorizationMatrix: matrix }
        : url.pathname === "/api/projects" ? { directory: "/test/projects", active: { id: "matrix-project", name: "Matrix", scope: [service], managed: true, readable: true }, projects: [], saveState: "SAVED" }
          : url.pathname === "/api/scanner-run" ? scannerRunFixture
            : url.pathname === "/api/human-run" ? humanRunFixture
              : url.pathname === "/api/zap-status" ? zapStatusFixture : {}
      await route.fulfill({ json: body })
    })
    await page.goto(`${baseURL}#matrix`)
    await page.getByRole("tab", { name: /객체 권한/ }).click()
    await expect(page.getByRole("tab", { name: /객체 권한/ })).toHaveAttribute("aria-selected", "true")
    const table = page.getByRole("table")
    await expect(table.getByRole("row")).toHaveCount(3)
    await expect(table.getByText("객체 8개")).toBeVisible()
    const heights = await table.locator("button[data-tone]").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1)
    await expect(table.getByText("BOLA/IDOR 후보")).toBeVisible()
    const help = page.getByRole("button", { name: "BOLA/IDOR 후보 · USER B · GET /api/shop/orders/{id} 설명", exact: true })
    await help.scrollIntoViewIfNeeded()
    await help.focus(); await help.press("Enter")
    await expect(page.getByText("다른 계정의 데이터에 접근한 의심 근거가 있습니다. 실제 응답을 확인하세요.")).toBeVisible()
    await expect.poll(async () => {
      const box = await page.locator('[data-slot="popover-content"]').boundingBox()
      return box ? box.x >= 12 && box.x + box.width <= width - 12 : false
    }).toBe(true)
    await page.screenshot({ path: info.outputPath(`matrix-help-${theme}-${width}.png`), animations: "disabled" })
    await page.keyboard.press("Escape")
    await expect(page.getByRole("complementary", { name: "선택 상세" })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`matrix-api-${theme}-${width}.png`), animations: "disabled" })
    const open = page.getByRole("button", { name: "GET /api/shop/orders/{id} 관련 결과 보기" })
    await open.focus(); await open.press("Enter")
    await expect(table.getByRole("row")).toHaveCount(9)
    await expect(table.getByRole("button", { name: /GET \/api\/shop\/orders\/opaque.* 관련 결과 보기/ })).toHaveCount(8)
    await expect(table.getByText("/api/auth/login")).toHaveCount(0)
    await page.getByRole("button", { name: "PATH · OBJ 4 매트릭스에서 제외", exact: true }).click()
    await expect(table.getByRole("row")).toHaveCount(8)
    await page.getByRole("button", { name: "실행 취소" }).click()
    await expect(table.getByRole("row")).toHaveCount(9)
    await page.screenshot({ path: info.outputPath(`matrix-objects-${theme}-${width}.png`), animations: "disabled" })
    await page.getByRole("button", { name: "이 API 제외" }).click()
    await expect(table.getByRole("row")).toHaveCount(2)
    await page.reload()
    await page.getByRole("tab", { name: /객체 권한/ }).click()
    await expect(page.getByRole("tab", { name: /객체 권한/ })).toHaveAttribute("aria-selected", "true")
    await expect(table.getByRole("row")).toHaveCount(2)
    await page.getByRole("button", { name: "제외한 항목 1" }).click()
    await expect(page.getByText("매트릭스에서만 제외됩니다. 원본 요청과 판정 기록은 유지됩니다.")).toBeVisible()
    await page.getByRole("button", { name: "전체 복원" }).click()
    await page.keyboard.press("Escape")
    await expect(table.getByRole("row")).toHaveCount(3)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThan(3)
    expect(errors).toEqual([]); expect(mutations).toEqual([])
  })
}
