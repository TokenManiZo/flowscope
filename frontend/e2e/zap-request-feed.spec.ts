import { expect, test } from "@playwright/test"
import type { EventRecord } from "../src/lib/api/types"
import { snapshotFixture } from "../src/test/fixtures"

const target = "https://demo.flowscope.test"
const event = (eventId: string, source: EventRecord["source"], sourceDetail: string, timestamp: number): EventRecord => ({
  eventId, source, sourceDetail, timestamp, path: `/api/${eventId}`, method: "GET", status: 200,
  fp: "", idn: "qa-a", role: "USER", op: `${target} GET /api/${eventId}`, resource: null,
  orchestrator: "SYSTEM", tool: source === "scanner" ? "ZAP" : "BROWSER", phase: "EXPLORATION",
  executionTrust: "CONTROLLED", runId: "synthetic-run", authState: "AUTHENTICATED",
  trafficClass: "API", trafficDisposition: "INCLUDED", coverageEligible: true,
  classificationOverride: false, classificationReasons: [], pathTemplateStatus: "RESOLVED",
  pathTemplateReasons: [], clusterId: eventId, repeatCount: 1, firstSeen: timestamp, lastSeen: timestamp,
  objects: [], verdict: "undecided",
})

// Exercise the real UI with synthetic responses; no scanner or target traffic is sent.
for (const theme of ["dark", "light"] as const) {
  test(`ZAP records stay separate without removing existing controls (${theme})`, async ({ page, baseURL }, testInfo) => {
    const errors: string[] = [], mutations: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 1080 })
    await page.addInitScript(theme => localStorage.setItem("flowscope-theme", theme), theme)
    let events = [event("browser", "human", "BROWSER", 6), event("other-scanner", "scanner", "OTHER_SCANNER", 5),
      event("llm", "llm", "LLM_EXPLORER", 4), event("automatic", "scanner", "AUTHORIZATION_REPLAY", 3),
      event("zap-items", "scanner", "ZAP_CLIENT_SPIDER", 2),
      { ...event("zap-profile", "scanner", "ZAP_SPIDER", 1), orchestrator: "LLM" }]
    const origin = new URL(baseURL!).origin
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) { await route.abort(); return }
      if (!url.pathname.startsWith("/api/")) { await route.continue(); return }
      if (request.method() !== "GET") { mutations.push(url.pathname); await route.abort(); return }
      const body = url.pathname === "/api/snapshot" ? { ...snapshotFixture, events,
        accounts: [{ id: "qa-a", label: "QA A", role: "USER", target, color: "", authArtifactCount: 0 }] }
        : url.pathname === "/api/scanner-run" ? { run: { status: "NOT_STARTED" }, accounts: [], scope: [target] }
          : url.pathname === "/api/zap-status" ? { connected: true, state: "READY", message: "ZAP 연결됨" }
            : url.pathname === "/api/projects" ? { active: null, projects: [], saveState: "UNMANAGED" }
              : url.pathname === "/api/request-lab" ? { eventId: url.searchParams.get("eventId"), service: target,
                request: "GET /api/zap-items HTTP/1.1\r\nHost: demo.flowscope.test\r\n\r\n",
                response: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"synthetic":true}',
                rawRequestRetained: true, rawResponseRetained: true, requestEditable: false, observedIdentity: "QA A" } : {}
      await route.fulfill({ json: body })
    })
    await page.goto(`${baseURL}#inspection`)
    const list = page.getByLabel("기록된 요청 목록")
    await expect(list.getByRole("button")).toHaveCount(6)
    await page.getByRole("tab", { name: "ZAP 스캔" }).click()
    await expect(page.getByLabel("ZAP 상태")).toContainText("ZAP 연결됨")
    await expect(page.getByRole("button", { name: "ZAP 계정 접기" })).toBeVisible()
    await expect(page.getByText("명세로 API 추가")).toBeVisible()
    await expect(page.getByRole("button", { name: "스캔 시작", exact: true })).toBeVisible()
    await expect(page.getByText("ZAP 전용", { exact: true })).toBeVisible()
    await expect(page.getByLabel("ZAP 요청 기록 건수")).toHaveText("2건")
    await expect(list.getByRole("button")).toHaveCount(2)
    await expect(list.getByRole("button").first()).toHaveAccessibleName(/zap-items/)
    await page.screenshot({ path: testInfo.outputPath(`zap-screen-${theme}.png`), fullPage: true, animations: "disabled" })

    const search = page.getByLabel("ZAP 작업 피드 검색")
    await search.fill("zap-items")
    await expect(page.getByLabel("표시된 요청 건수")).toHaveText("1 / 2건 표시")
    await page.getByRole("button", { name: "작업 피드 접기" }).click()
    await expect(list).not.toBeVisible()
    await page.getByRole("button", { name: "작업 피드 펼치기" }).click()
    await page.getByRole("button", { name: "크게 보기", exact: true }).click()
    await expect(search).toHaveValue("zap-items")
    await page.getByRole("button", { name: "원래 크기", exact: true }).click()
    await list.getByRole("button").click()
    await expect(page.getByRole("dialog", { name: "원문 보기" })).toBeVisible()
    await expect(page.getByLabel("응답 원문", { exact: true })).toContainText('"synthetic":true')
    await page.getByRole("button", { name: "닫기", exact: true }).click()
    await search.fill("browser")
    await expect(page.getByText("검색 결과가 없습니다.")).toBeVisible()
    await expect(page.getByLabel("표시된 요청 건수")).toHaveText("0 / 2건 표시")
    await search.clear()
    await page.setViewportSize({ width: 1024, height: 900 })
    await expect(list.getByRole("button")).toHaveCount(2)
    await expect(page.getByText("ZAP 전용", { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`zap-screen-compact-${theme}.png`), fullPage: true, animations: "disabled" })
    await page.getByRole("tab", { name: "수집 기록" }).click()
    await expect(list.getByRole("button")).toHaveCount(6)
    await expect(page.getByText("ZAP 전용", { exact: true })).not.toBeVisible()
    events = [event("browser", "human", "BROWSER", 6)]
    await page.reload()
    await page.getByRole("tab", { name: "ZAP 스캔" }).click()
    await expect(page.getByText("아직 기록된 ZAP 요청이 없습니다.")).toBeVisible()
    await expect(page.getByLabel("ZAP 요청 기록 건수")).toHaveText("0건")
    expect(mutations).toEqual([])
    expect(errors).toEqual([])
  })
}
