import { expect, test } from "@playwright/test"
import type { Core } from "cytoscape"
import { humanRunFixture, scannerRunFixture, zapStatusFixture, targetSnapshot } from "../src/test/fixtures"
import { emptyGraphWorkspace } from "../src/features/graph/graphWorkspace"
import { operationGroup } from "../src/features/graph/graphHierarchy"

const service = "https://panel.invalid:443"
const cells = Array.from({ length: 12 }, (_, index) => ({
  idn: "USER A", op: `${service} GET /api/projects/{id}`,
  resource: `projects:synthetic-project-${index}/modules:${"long-identifier-".repeat(8)}${index}`,
  perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const,
  conflict: false, missedSources: [], evidenceIds: [],
}))

for (const width of [1280, 1920]) test(`graph filters and long object identifiers fit at ${width}px`, async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width, height: 1080 })
  await page.addInitScript(() => {
    localStorage.setItem("flowscope-theme", "dark")
    localStorage.setItem("flowscope.sidebar", "open")
  })
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  const origin = new URL(baseURL!).origin
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin) { await route.abort(); return }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return }
    if (request.method() !== "GET") {
      if (url.pathname === "/api/graph-workspace") await route.fulfill({ json: { datasetRevision: 7, revision: 1 } })
      else await route.abort()
      return
    }
    const body = url.pathname === "/api/snapshot"
      ? targetSnapshot({ datasetRevision: 7, cells, owners: { [cells[0].resource]: "USER A" } })
      : url.pathname === "/api/graph-workspace"
        ? { datasetRevision: 7, revision: 0, workspace: { ...emptyGraphWorkspace, navigation: { ...emptyGraphWorkspace.navigation, level: "group", groupId: operationGroup(cells[0].op).id } } }
        : url.pathname === "/api/projects" ? { active: null, projects: [], saveState: "UNMANAGED" }
          : url.pathname === "/api/human-run" ? humanRunFixture
            : url.pathname === "/api/scanner-run" ? scannerRunFixture
              : url.pathname === "/api/zap-status" ? zapStatusFixture : {}
    await route.fulfill({ json: body })
  })
  await page.goto(`${baseURL}?flowscope-e2e-geometry=1#graph`)
  await expect(page.getByRole("alert")).toHaveCount(0)
  const modes = page.getByRole("group", { name: "그래프 기록 보기" })
  await expect(modes).toBeVisible()
  await expect(page.getByRole("navigation", { name: "그래프 계층" }).getByRole("button", { name: "수집 그래프" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "수집 그래프", exact: true })).toHaveAttribute("aria-pressed", "true")
  const canvas = page.getByLabel("공격면 Cytoscape 그래프", { exact: true })
  await expect(canvas).toHaveAttribute("data-graph-geometry", /"nodes":\[/)
  await canvas.evaluate(element => {
    const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
    const node = cy.nodes().filter(node => node.id().startsWith("object-group:"))[0]
    if (!node) throw new Error("Object group missing")
    node.emit("tap")
  })
  const summary = page.getByRole("region", { name: "노드 요약" })
  await expect(summary.getByRole("listitem")).toHaveCount(12)
  await expect(summary.getByText(cells[0].resource, { exact: true })).toBeVisible()
  expect(await summary.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThan(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThan(2)
  const toggle = summary.locator("summary").filter({ hasText: "객체 · 소유자" })
  await toggle.click()
  await expect(summary.getByText(cells[0].resource, { exact: true })).toBeHidden()
  await toggle.press("Enter")
  await expect(summary.getByText(cells[0].resource, { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("objects-and-filters.png"), animations: "disabled" })
  await modes.getByRole("button", { name: "재전송 보기", exact: true }).click()
  await expect(modes.getByRole("button", { name: "재전송 보기", exact: true })).toHaveAttribute("aria-pressed", "true")
  expect(errors).toEqual([])
})
