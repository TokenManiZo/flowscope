import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const origin = new URL(process.env.FLOWSCOPE_E2E_ORIGIN ?? "http://127.0.0.1:17778").origin

test("real installed Codex TUI answers terminal queries inside FlowScope", async ({ page }) => {
  test.skip(process.env.FLOWSCOPE_REAL_CLI_GATE !== "1", "opt-in real CLI gate");
  await page.goto(`${origin}/#inspection`)
  await page.getByRole("tab", { name: /LLM 탐색/ }).click()
  await page.getByRole("button", { name: "Codex CLI 열기" }).click()
  await page.getByRole("button", { name: "새 Codex CLI" }).click()
  try {
    await expect(page.getByRole("status")).toContainText("실행 중", { timeout: 15_000 })
    const text = page.locator(".xterm-accessibility")
    await expect(text).toContainText(/OpenAI Codex|Folder access|Update available/, { timeout: 20_000 })
    expect(await text.innerText()).not.toContain('TERM is set to "dumb"')
    if (process.env.FLOWSCOPE_CLI_PREVIEW === "1")
      await page.screenshot({ path: resolve(process.cwd(), "../target/codex-cli-real-preview.png"), fullPage: true })
    const inputRequest = page.waitForRequest((request) => request.url().includes("/api/codex-terminal")
      && request.method() === "POST"
      && new URLSearchParams(request.postData() ?? "").get("action") === "input")
    await page.locator(".xterm-helper-textarea").press("ArrowDown")
    const sent = await inputRequest
    expect(Buffer.from(new URLSearchParams(sent.postData() ?? "").get("data") ?? "", "base64").length)
      .toBeGreaterThan(0)
  } finally {
    const stop = page.getByRole("button", { name: "CLI 종료" })
    if (await stop.isEnabled()) await stop.click()
  }
  await expect(page.getByRole("status")).toContainText("종료됨", { timeout: 10_000 })
})
