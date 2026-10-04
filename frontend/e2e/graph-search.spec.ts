import { expect, test } from "@playwright/test"
import type { Core } from "cytoscape"
import { humanRunFixture, scannerRunFixture, targetSnapshot, zapStatusFixture } from "../src/test/fixtures"
import { emptyGraphWorkspace, graphViewKey } from "../src/features/graph/graphWorkspace"
import { operationGroup } from "../src/features/graph/graphHierarchy"
import { operationShapeKey } from "../src/features/graph/graphPathShape"

const service = "https://graph-search.invalid:443"
const cells = Array.from({ length: 25 }, (_, index) => ({ idn: "USER A", op: `${service} GET /api/orders/${String(index).padStart(2, "0")}`, resource: `orders:${index}`, perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: [`synthetic-${index}`] }))
const navigation = { ...emptyGraphWorkspace.navigation, level: "group" as const, groupId: operationGroup(cells[0].op).id }

// 합성 API 응답으로 실제 캔버스·마우스·테마를 확인한다. 실행은 사용자가 수행한다.
for (const theme of ["light", "dark"] as const) for (const width of [1280, 1920]) {
  test(`graph search retains dragged coordinates at ${theme} ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    const errors: string[] = [], writes: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.setViewportSize({ width, height: 1080 })
    await page.addInitScript(theme => localStorage.setItem("flowscope-theme", theme), theme)
    const workspace = { ...emptyGraphWorkspace, navigation, views: { [graphViewKey(navigation)]: { positions: { [`operation:${cells[0].op}`]: { x: 540, y: 180 } }, sizes: {}, viewport: { zoom: 1, pan: { x: 0, y: 0 } }, expandedGroups: [`operation-group:${operationShapeKey(cells[0].op)}`] } } }
    let revision = 0
    const responses: Record<string, unknown> = {
      "/api/snapshot": targetSnapshot({ datasetRevision: 7, cells }),
      "/api/graph-workspace": { datasetRevision: 7, revision, workspace },
      "/api/projects": { directory: "/tmp/synthetic-graph-search", active: null, projects: [], saveState: "UNMANAGED", lastSavedAt: "", saveError: "" },
      "/api/human-run": humanRunFixture, "/api/zap-status": zapStatusFixture, "/api/scanner-run": scannerRunFixture,
    }
    const origin = new URL(testInfo.project.use.baseURL!).origin
    await page.route("**/*", async route => {
      const request = route.request(), target = new URL(request.url())
      if (target.origin !== origin) { await route.abort(); return }
      if (!target.pathname.startsWith("/api/")) { await route.continue(); return }
      if (request.method() === "POST") {
        if (target.pathname !== "/api/graph-workspace") { await route.abort(); return }
        writes.push(request.postData() ?? "")
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ datasetRevision: 7, revision: ++revision }) })
        return
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(responses[target.pathname] ?? {}) })
    })
    await page.goto("./?flowscope-e2e-geometry=1#graph")
    const canvas = page.getByLabel("공격면 Cytoscape 그래프", { exact: true }), input = page.getByRole("combobox", { name: "프로젝트 전체 노드 검색" })
    await expect(canvas).toHaveAttribute("data-graph-geometry", /"nodes":\[/)
    await input.fill("/orders/00")
    const first = page.getByRole("option", { name: /^API GET \/api\/orders\/00/ })
    await expect(first).toHaveAttribute("aria-disabled", "false")
    await first.click()
    await expect.poll(() => canvas.evaluate((element, id) => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.getElementById(id).selected(), `operation:${cells[0].op}`)).toBe(true)
    const point = await canvas.evaluate((element, id) => {
      const node = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.getElementById(id)
      return node.renderedPosition()
    }, `operation:${cells[0].op}`)
    const box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + point.x, box.y + point.y)
    await page.mouse.down()
    await page.mouse.move(box.x + point.x, box.y + point.y + 40, { steps: 5 })
    await page.mouse.up()
    const before = await canvas.evaluate(element => Object.fromEntries((element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.nodes().map(node => [node.id(), { ...node.position() }])))
    const draggedId = `operation:${cells[0].op}`
    await expect.poll(() => writes.some(body => {
      const changes = JSON.parse(new URLSearchParams(body).get("changes") ?? "{}")
      const positions = changes.views?.[graphViewKey(navigation)]?.positions ?? changes.viewPatches?.[graphViewKey(navigation)]?.positions
      return positions?.[draggedId]?.y === before[draggedId].y
    })).toBe(true)
    const count = writes.length
    await input.fill("/orders/24")
    const target = page.getByRole("option", { name: /^API GET \/api\/orders\/24/ })
    await expect(target).toHaveAttribute("aria-disabled", "false")
    expect(writes.length).toBe(count)
    expect(await canvas.evaluate(element => Object.fromEntries((element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.nodes().map(node => [node.id(), { ...node.position() }])))).toEqual(before)
    await target.click()
    await expect.poll(() => canvas.evaluate((element, id) => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.getElementById(id).selected(), `operation:${cells[24].op}`)).toBe(true)
    const after = await canvas.evaluate(element => Object.fromEntries((element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.nodes().map(node => [node.id(), { ...node.position() }])))
    for (const [id, position] of Object.entries(before)) expect(after[id], id).toEqual(position)
    await page.getByRole("button", { name: "노드 검색 지우기" }).click()
    expect(await canvas.evaluate((element, id) => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.getElementById(id).selected(), `operation:${cells[24].op}`)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`graph-search-${theme}-${width}.png`), animations: "disabled" })
  })
}
