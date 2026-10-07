import { expect, test } from "@playwright/test"
import { snapshotFixture } from "../src/test/fixtures"

const events = Array.from({ length: 60 }, (_, index) => ({
  eventId: `alignment-${index}`, op: "GET /api/items", method: "GET", path: `/api/items/${index}`,
  idn: "anon", source: index % 3 === 0 ? "human" : index % 3 === 1 ? "scanner" : "llm",
  sourceDetail: index % 3 === 1 ? "AUTHORIZATION_REPLAY" : "BURP", phase: "OBSERVED",
  status: 200, timestamp: 1_759_000_000_000 + index, objects: [], verdict: "undecided",
}))

test("keeps source, collection method and time headers aligned with scrollable rows", async ({ page, baseURL }, testInfo) => {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith("/api/")) { await route.continue(); return }
    const body = path === "/api/snapshot" ? { ...snapshotFixture, events }
      : path === "/api/scanner-run" ? { run: { status: "NOT_STARTED" }, accounts: [], scope: [] }
        : path === "/api/zap-status" ? { connected: false, state: "UNAVAILABLE" } : {}
    await route.fulfill({ json: body })
  })
  await page.goto(`${baseURL}#inspection`)
  await page.addStyleTag({ content: "::-webkit-scrollbar { width: 16px; height: 16px; }" })
  const list = page.getByLabel("기록된 요청 목록")
  await expect(list.locator(":scope > button")).toHaveCount(60)
  for (const width of [1024, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 })
    for (const scrollLeft of [0, 400]) {
      const geometry = await list.evaluate((element, offset) => {
        element.scrollTop = 100
        element.parentElement!.scrollLeft = offset
        const header = element.previousElementSibling!
        return Array.from(element.querySelectorAll(":scope > button")).slice(0, 3).flatMap(row => [3, 4, 7].map(index => {
          const title = header.children[index] as HTMLElement
          const value = row.children[index] as HTMLElement
          const a = title.getBoundingClientRect(), b = value.getBoundingClientRect()
          return { title: title.textContent, titleAlign: getComputedStyle(title).textAlign,
            valueAlign: getComputedStyle(value).textAlign,
            delta: Math.abs(a.left + a.width / 2 - b.left - b.width / 2) }
        }))
      }, scrollLeft)
      for (const cell of geometry) {
        expect(cell.titleAlign, `${width}px ${cell.title} title`).toBe("center")
        expect(cell.valueAlign, `${width}px ${cell.title} value`).toBe("center")
        expect(cell.delta, `${width}px ${cell.title} column centers`).toBeLessThanOrEqual(1)
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await list.evaluate(element => { element.scrollTop = 0; element.parentElement!.scrollLeft = 0 })
  await list.locator("..").screenshot({ path: testInfo.outputPath("feed-alignment.png") })
})
