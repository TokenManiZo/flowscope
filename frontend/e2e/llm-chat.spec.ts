import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

const origin = new URL(process.env.FLOWSCOPE_E2E_ORIGIN ?? "http://127.0.0.1:17777").origin
const target = "https://demo.flowscope.test:443/"
const idleRun = {
  status: "IDLE", runId: "", target: "", startedAt: null, endedAt: null, elapsedMillis: 0,
  message: "Explorer 실행 대기", providerReadiness: "READY", model: "", effort: "", accountIds: [],
  anonymous: false, attempts: 0, responses: 0, endpointDeclarations: 0,
  parameterDeclarations: 0, capabilityProbes: 0, unresolved: [], activities: [],
}

test("opens the real Codex terminal surface without sending an Explorer or app-server turn", async ({ page }) => {
  const starts: string[] = []
  const inputs: string[] = []
  let running = false
  let cursor = 0
  let exitCode: number | null = null
  const output = Buffer.from("\u001b[2J\u001b[HCodex CLI ready\r\n", "utf8")
  const terminal = (from = cursor) => ({
    runId: running || exitCode !== null ? "cli-test" : "", running, exitCode,
    cursor: from === 0 && running ? output.length : from,
    oldestCursor: 0, truncated: false,
    outputBase64: from === 0 && running ? output.toString("base64") : "",
  })

  await page.route("**/api/explorer-run", (route) => route.fulfill({ json: {
    run: idleRun, messages: [], chat: null, browser: null, accounts: [], scope: [target],
  } }))
  await page.route("**/api/explorer-models", (route) => route.fulfill({ json: {
    configuredModel: "gpt-6.1-sol", models: [{ id: "gpt-6.1-sol", label: "GPT-6.1 Sol", recommended: true,
      defaultEffort: "medium", efforts: [{ effort: "medium", description: "Balanced" }] }],
  } }))
  await page.route("**/api/codex-terminal**", async (route) => {
    if (route.request().method() === "GET") {
      const from = Number(new URL(route.request().url()).searchParams.get("cursor") ?? "0")
      await route.fulfill({ json: terminal(from) })
      return
    }
    const form = new URLSearchParams(route.request().postData() ?? "")
    const action = form.get("action")
    if (action === "start") {
      starts.push(form.get("resume") ?? "")
      running = true
      cursor = 0
      exitCode = null
      await route.fulfill({ status: 202, json: terminal() })
      return
    }
    if (action === "input") {
      inputs.push(Buffer.from(form.get("data") ?? "", "base64").toString("utf8"))
    }
    if (action === "stop") {
      running = false
      exitCode = 0
    }
    await route.fulfill({ json: terminal() })
  })

  await page.goto(`${origin}/#inspection`)
  await page.getByRole("tab", { name: /LLM 탐색/ }).click()
  await page.getByRole("button", { name: "Codex CLI 열기" }).click()
  await expect(page.getByRole("region", { name: "Codex CLI 터미널" })).toBeVisible()
  await expect(page.getByRole("button", { name: "탐색 시작" })).toHaveCount(0)
  expect(starts).toHaveLength(0)
  await page.getByRole("button", { name: "새 Codex CLI" }).click()
  await expect(page.getByRole("status")).toContainText("실행 중")
  await expect(page.locator(".xterm-screen")).toBeVisible()
  await expect(page.locator(".xterm-accessibility")).toContainText("Codex CLI ready")
  if (process.env.FLOWSCOPE_CLI_PREVIEW === "1")
    await page.screenshot({ path: resolve(process.cwd(), "../target/codex-cli-terminal-preview.png"), fullPage: true })
  await page.locator(".xterm-helper-textarea").press("a")
  await expect.poll(() => inputs.join("")).toContain("a")
  expect(starts).toEqual(["false"])
  await page.getByRole("button", { name: "자동 탐색 보기" }).click()
  await expect(page.getByRole("button", { name: "탐색 시작" })).toBeVisible()
  await page.getByRole("button", { name: "Codex CLI 열기" }).click()
  await expect(page.getByRole("status")).toContainText("실행 중")
  expect(starts).toHaveLength(1)
  await page.getByRole("button", { name: "CLI 종료" }).click()
  await expect(page.getByRole("status")).toContainText("종료됨")
  await page.getByRole("button", { name: "이전 대화 이어서" }).click()
  await expect(page.getByRole("status")).toContainText("실행 중")
  expect(starts).toEqual(["false", "true"])
  await page.getByRole("button", { name: "CLI 종료" }).click()
  await expect(page.getByRole("status")).toContainText("종료됨")
  await page.getByRole("button", { name: "자동 탐색 보기" }).click()
  await expect(page.getByRole("button", { name: "탐색 시작" })).toBeVisible()
})
