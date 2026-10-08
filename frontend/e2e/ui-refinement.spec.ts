import { expect, test } from "@playwright/test"
import { snapshotFixture } from "../src/test/fixtures"

const service = "https://ui-review.invalid:443"
const events = Array.from({ length: 80 }, (_, index) => ({
  eventId: `record-${index}`, clusterId: `record-${index}`, op: `${service} GET /api/orders`,
  method: "GET", path: `/api/orders/${index}`, idn: "a", source: index % 2 ? "scanner" : "human",
  sourceDetail: index % 2 ? "ZAP_SPIDER" : "BROWSER", phase: "EXPLORATION", status: 200,
  timestamp: 1791302400000 + index, firstSeen: 1791302400000 + index, lastSeen: 1791302400000 + index,
  trafficDisposition: "INCLUDE", trafficClass: "API", classificationReasons: [], objects: [], verdict: "allow", repeatCount: 1,
}))
const confidence = { code: "P3", level: 3, label: "사용자 지정", basis: "사용자 지정 정책" }
const functions = Array.from({ length: 24 }, (_, index) => ({
  id: `function-${index}`, identity: "a", identityLabel: "USER A", role: "User",
  operation: `${service} GET /api/orders/${index}`, status: index % 2 ? "POLICY_ENFORCED" : "EXPECTED_ACCESS",
  statusLabel: index % 2 ? "기대 차단 관측" : "기대 허용 관측", expected: index % 2 ? "DENY" : "ALLOW",
  actual: index % 2 ? "DENIED" : "SUCCESS", policy: confidence, evidence: confidence,
  blockingLayers: [], gates: [], statusCodes: [index % 2 ? 403 : 200], sourceVerdicts: {}, evidenceIds: [],
  reviewStatus: "UNRESOLVED", reviewNote: "", reviewEvidenceIds: [], recommendation: null,
}))
const matrix = {
  summary: { bflaTestRecommendations: 3, bolaIdorTestRecommendations: 5, manualReviewPending: 8, humanConfirmed: 0, humanDismissed: 0 },
  identities: [{ id: "a", label: "USER A", role: "User", kind: "REGISTERED" }], functions, objects: [], evidence: [],
  configurationWarnings: [], policyLegend: [], evidenceLegend: [], ownershipLegend: [],
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }, { width: 600, height: 800 }]) {
  test(`inspection, observations and matrix stay usable at ${viewport.width}px`, async ({ page, baseURL }, info) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(() => localStorage.setItem("flowscope.sidebar", "open"))
    const errors: string[] = [], mutations: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    const origin = new URL(baseURL!).origin
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) { await route.abort(); return }
      if (!url.pathname.startsWith("/api/")) { await route.continue(); return }
      if (request.method() !== "GET") { mutations.push(url.pathname); await route.abort(); return }
      const body = url.pathname === "/api/snapshot" ? { ...snapshotFixture, events, authorizationMatrix: matrix,
        evidenceOrdinals: Object.fromEntries(events.map((event, index) => [event.eventId, index + 1])),
        accounts: [{ id: "a", label: "USER A", role: "User", target: service, color: "", authArtifactCount: 0 }] }
        : url.pathname === "/api/scanner-run" ? { run: { status: "NOT_STARTED" }, accounts: [], scope: [service] }
          : url.pathname === "/api/zap-status" ? { connected: true, state: "READY" }
            : url.pathname === "/api/explorer-run" ? { run: { status: "IDLE", runId: "", message: "탐색 실행 대기", providerReadiness: "READY", attempts: 0, responses: 0, unresolved: [], activities: [] }, scope: [service], accounts: [] }
              : url.pathname === "/api/explorer-models" ? { configuredModel: "gpt-6.1-sol", models: [{ id: "gpt-6.1-sol", label: "GPT-6.1 Sol", recommended: true }] }
                : url.pathname === "/api/projects" ? { active: null, projects: [], saveState: "UNMANAGED" } : {}
      await route.fulfill({ json: body })
    })
    await page.goto(`${baseURL}#inspection`)
    const list = page.getByLabel("기록된 요청 목록")
    await expect(list.getByRole("button")).toHaveCount(80)
    await expect(page.getByRole("group", { name: "점검 범위" })).toHaveCount(0)
    const bodyHeight = await list.evaluate(element => element.clientHeight)
    expect(bodyHeight).toBeGreaterThan(viewport.height * 0.5)
    const main = page.getByRole("main")
    expect(await main.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThan(3)
    await page.screenshot({ path: info.outputPath("collected.png") })
    await page.getByRole("tab", { name: "ZAP 스캔" }).click()
    await expect(list.getByRole("button")).toHaveCount(40)
    expect(await list.evaluate(element => element.clientHeight)).toBeGreaterThan(100)
    await page.screenshot({ path: info.outputPath("zap.png") })
    await page.getByRole("tab", { name: "LLM 탐색" }).click()
    const progress = page.getByLabel("LLM 진행 메시지 및 수집 트래픽")
    await expect(progress).toBeVisible()
    expect(await progress.evaluate(element => element.clientHeight)).toBeGreaterThan(150)
    await page.screenshot({ path: info.outputPath("llm.png") })
    await page.getByRole("button", { name: "크게 보기", exact: true }).click()
    await expect(page.getByRole("heading", { name: "점검 시작" })).toBeHidden()
    await progress.press("Escape")
    await expect(page.getByRole("heading", { name: "점검 시작" })).toBeVisible()
    await page.goto(`${baseURL}#evidence`)
    const search = page.getByRole("searchbox", { name: "#번호, 경로, 계정 검색" })
    await search.fill("#37")
    await expect(page.getByRole("row").filter({ hasText: "#37" })).toHaveCount(1)
    await expect(page.getByRole("row").filter({ hasText: "#36" })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath("observations.png") })
    await page.goto(`${baseURL}#matrix`)
    const table = page.getByRole("region", { name: "판정 매트릭스 표" })
    await expect(table.locator("button[aria-pressed]")).toHaveCount(24)
    await expect(page.getByRole("complementary", { name: "분석 필터" })).toHaveCount(0)
    await expect(table.locator("button[aria-pressed]").first()).toContainText("접근")
    expect(await table.evaluate(element => element.clientHeight)).toBeGreaterThan(180)
    await page.screenshot({ path: info.outputPath("matrix.png") })
    await expect(page.getByRole("button", { name: "다른 보기" })).toHaveCount(0)
    expect(errors).toEqual([])
    expect(mutations).toEqual([])
  })
}
