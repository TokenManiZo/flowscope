import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const origin = new URL(process.env.FLOWSCOPE_E2E_ORIGIN ?? "http://127.0.0.1:17777").origin
const target = "https://demo.flowscope.test:443/"
const idleRun = {
  status: "IDLE", runId: "", target: "", startedAt: null, endedAt: null, elapsedMillis: 0,
  message: "Explorer 실행 대기", providerReadiness: "READY", model: "", effort: "", accountIds: [],
  anonymous: false, attempts: 0, responses: 0, endpointDeclarations: 0,
  parameterDeclarations: 0, capabilityProbes: 0, unresolved: [], activities: [],
}

test("chat starts only after a user message and keeps the conversation visible", async ({ page }) => {
  let run = idleRun
  let messages: Array<{ role: "user" | "assistant"; text: string; runId: string; at: string }> = []
  const starts: string[] = []
  const modes: string[] = []
  const efforts: string[] = []
  await page.route("**/api/explorer-run", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { run, messages, rawActive: false, browser: null, accounts: [], scope: [target] } })
      return
    }
    const form = new URLSearchParams(route.request().postData() ?? "")
    if (form.get("action") === "start") {
      const instruction = form.get("message") ?? ""
      starts.push(instruction)
      modes.push(form.get("raw") ?? "")
      efforts.push(form.get("effort") ?? "")
      run = { ...idleRun, status: "COMPLETED", runId: `chat-${starts.length}`, target,
        anonymous: true, model: form.get("model") ?? "", effort: form.get("effort") ?? "" }
      messages = [...messages,
        { role: "user", text: instruction, runId: run.runId, at: "2026-10-10T00:00:00Z" },
        { role: "assistant", text: "샘플 응답: 실제 수집은 Burp에서 확인하세요.", runId: run.runId, at: "2026-10-10T00:00:01Z" },
      ]
      await route.fulfill({ status: 202, json: { run } })
      return
    }
    await route.fulfill({ status: 400, json: { message: "unexpected action" } })
  })
  await page.route("**/api/explorer-models", (route) => route.fulfill({ json: {
    configuredModel: "gpt-6.1-sol", models: [{ id: "gpt-6.1-sol", label: "GPT-6.1 Sol", recommended: true,
      defaultEffort: "medium", efforts: [{ effort: "medium", description: "Balanced" },
        { effort: "high", description: "Deeper" }] }],
  } }))

  await page.goto(`${origin}/#inspection`)
  await page.getByRole("tab", { name: /LLM 탐색/ }).click()
  await expect(page.getByRole("button", { name: "Codex 자유 대화" })).toBeEnabled()
  await expect(page.getByRole("button", { name: "탐색 시작" })).toBeDisabled()
  if (process.env.FLOWSCOPE_CHAT_PREVIEW === "1") {
    await page.screenshot({ path: resolve(process.cwd(), "../target/llm-chat-start-preview.png"), fullPage: true })
  }
  await page.getByRole("combobox", { name: "추론 강도" }).selectOption("high")
  await page.getByRole("button", { name: "Codex 자유 대화" }).click()
  await expect(page.getByRole("button", { name: /^탐색할 계정/ })).toHaveAttribute("aria-expanded", "false")
  expect(starts).toHaveLength(0)
  await expect(page.getByRole("textbox", { name: "LLM에게 메시지" })).toBeVisible()
  await page.getByRole("textbox", { name: "LLM에게 메시지" }).fill("이 범위의 공개 API를 살펴봐")
  await page.getByRole("button", { name: "메시지 전송" }).click()
  await expect(page.getByRole("log", { name: "LLM 대화" })).toContainText("이 범위의 공개 API를 살펴봐")
  await expect(page.getByRole("log", { name: "LLM 대화" })).toContainText("샘플 응답")
  await expect(page.getByRole("textbox", { name: "LLM에게 메시지" })).toHaveValue("")
  expect(starts).toEqual(["이 범위의 공개 API를 살펴봐"])
  expect(modes).toEqual(["true"])
  expect(efforts).toEqual(["high"])
  if (process.env.FLOWSCOPE_CHAT_PREVIEW === "1") {
    await page.screenshot({ path: resolve(process.cwd(), "../target/llm-chat-preview.png"), fullPage: true })
  }
})
