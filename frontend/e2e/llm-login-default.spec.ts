import { expect, test } from "@playwright/test"
import { snapshotFixture } from "../src/test/fixtures"

for (const width of [1280, 360]) {
  test(`LLM login inherits settings without an address field at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(() => localStorage.setItem("flowscope.sidebar", "open"))
    const posts: URLSearchParams[] = []
    let opened = false
    const account = { id: "user-a", label: "USER A", role: "USER", loginUrl: "https://old.example.test/login",
      cookieCount: 0, headerNames: [], browserOpen: false, status: "UNVERIFIED", message: "", updatedAt: "" }
    await page.route("**/api/snapshot", route => route.fulfill({ json: { ...snapshotFixture,
      accounts: [{ id: "user-a", label: "USER A", role: "User", target: "https://example.test:443", color: "", authArtifactCount: 0 }] } }))
    await page.route("**/api/scanner-run", route => route.fulfill({ json: { run: { status: "NOT_STARTED" }, accounts: [], scope: ["https://mobile.example.test:443/", "https://example.test:443/"] } }))
    await page.route("**/api/explorer-models", route => route.fulfill({ json: { configuredModel: "gpt-6.1-sol",
      models: [{ id: "gpt-6.1-sol", label: "GPT-6.1 Sol", recommended: true }] } }))
    await page.route("**/api/explorer-run", route => route.fulfill({ json: {
      run: { status: "IDLE", runId: "", message: "탐색 실행 대기", providerReadiness: "READY", attempts: 0, responses: 0, unresolved: [], activities: [] },
      startUrl: "https://mobile.example.test/login", loginUrls: { "user-a": "https://mobile.example.test/login" },
      scope: ["https://*.example.test:443/"], accounts: [{ ...account, browserOpen: opened, status: opened ? "NEEDS_INPUT" : "UNVERIFIED" }] } }))
    await page.route("**/api/explorer-accounts", async route => {
      posts.push(new URLSearchParams(route.request().postData() ?? ""))
      opened = true
      await route.fulfill({ json: { success: true, account: { ...account, browserOpen: true, status: "NEEDS_INPUT" } } })
    })
    await page.goto("./#inspection")
    await page.getByRole("tab", { name: "LLM 탐색", exact: true }).click()
    await page.getByRole("button", { name: /^탐색할 계정/ }).click()
    const login = page.getByRole("button", { name: "USER A 브라우저 로그인", exact: true })
    await expect(login).toBeVisible()
    await expect(page.getByRole("textbox", { name: "USER A 로그인 주소" })).toHaveCount(0)
    await expect(page.getByText("USER A", { exact: true })).toBeVisible()
    expect(await page.getByRole("main").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThan(3)
    await page.screenshot({ path: info.outputPath("llm-login.png") })
    await login.click()
    await expect(page.getByRole("button", { name: "USER A 로그인 완료" })).toBeVisible()
    expect(posts[0].get("action")).toBe("browser-open")
    expect(posts[0].get("id")).toBe("user-a")
    expect(posts[0].get("url")).toBe("")
  })
}
