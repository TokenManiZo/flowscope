import { expect, test } from "@playwright/test"
import type { Core } from "cytoscape"
import type { Cell, EventRecord } from "../src/lib/api/types"
import { emptyGraphWorkspace, graphViewKey } from "../src/features/graph/graphWorkspace"
import { operationGroup } from "../src/features/graph/graphHierarchy"
import { humanRunFixture, scannerRunFixture, targetSnapshot, zapStatusFixture } from "../src/test/fixtures"

for (const theme of ["dark", "light"] as const) {
  test(`identity matches stay above dimmed Object paths without restoration (${theme})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.addInitScript(theme => localStorage.setItem("flowscope-theme", theme), theme)
    const cells: Cell[] = ["alice", "bob"].map((idn, index) => ({ idn, op: `GET /api/products/${index ? "second" : "first"}`, resource: `products:${index + 1}`, perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: [idn] }))
    const events = cells.map(cell => ({ eventId: cell.idn, idn: cell.idn, op: cell.op, resource: cell.resource, source: "human", status: 200, method: "GET", path: cell.op.slice(4), role: "USER", timestamp: 1, fp: "", sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "run", authState: "AUTH", classificationOverride: false, classificationReasons: [], pathTemplateStatus: "LITERAL", pathTemplateReasons: [], clusterId: cell.idn, repeatCount: 1, firstSeen: 1, lastSeen: 1, verdict: "allow", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, objects: [], clusterEvidenceIds: [cell.idn] }) as EventRecord)
    const navigation = { ...emptyGraphWorkspace.navigation, level: "group" as const, groupId: operationGroup(cells[0].op).id }
    const workspace = { ...emptyGraphWorkspace, navigation, views: { [graphViewKey(navigation)]: { positions: Object.fromEntries(cells.flatMap((cell, index) => [[`identity:${cell.idn}`, { x: 180, y: index ? 200 : 1600 }], [`operation:${cell.op}`, { x: 540, y: index ? 200 : 1600 }]])), sizes: {}, viewport: { zoom: 0.8, pan: { x: 0, y: 0 } }, expandedGroups: [] } } }
    let revision = 1
    const responses: Record<string, unknown> = {
      "/api/snapshot": targetSnapshot({ datasetRevision: 7, cells, events }),
      "/api/graph-workspace": { datasetRevision: 7, revision, workspace },
      "/api/projects": { directory: "/tmp/synthetic-filter-layout", active: null, projects: [], saveState: "UNMANAGED", lastSavedAt: "", saveError: "" },
      "/api/zap-status": zapStatusFixture, "/api/human-run": humanRunFixture, "/api/scanner-run": scannerRunFixture,
    }
    const origin = new URL(testInfo.project.use.baseURL!).origin
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) { await route.abort(); return }
      if (!url.pathname.startsWith("/api/")) { await route.continue(); return }
      if (request.method() === "POST") {
        if (url.pathname !== "/api/graph-workspace") { await route.abort(); return }
        await route.fulfill({ json: { datasetRevision: 7, revision: ++revision } }); return
      }
      await route.fulfill({ json: responses[url.pathname] ?? {} })
    })
    await page.goto("./?flowscope-e2e-geometry=1#graph")
    const canvas = page.getByLabel("공격면 Cytoscape 그래프", { exact: true })
    await expect(canvas).toHaveAttribute("data-graph-geometry", /"nodes":\[/)
    const read = () => canvas.evaluate(element => {
      const core = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
      return { nodes: core.nodes().map(node => ({ id: node.id(), hl: node.data("hl"), y: node.position().y, top: node.position().y - Number(node.data("height")) / 2, bottom: node.position().y + Number(node.data("height")) / 2, opacity: Number(node.style("opacity")) })), edges: core.edges().map(edge => ({ hl: edge.data("hl"), opacity: Number(edge.style("opacity")) })), zoom: core.zoom() }
    })
    const rail = page.getByRole("complementary", { name: "분석 필터" })
    const alice = rail.getByRole("checkbox", { name: /^alice/ })
    await alice.click()
    await expect.poll(async () => {
      const graph = await read(), lit = graph.nodes.filter(node => node.hl === "yes"), dim = graph.nodes.filter(node => node.hl === "no")
      return Math.max(...lit.map(node => node.bottom)) < Math.min(...dim.map(node => node.top))
    }).toBe(true)
    await canvas.evaluate(element => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.$id("object-group:|products").emit("dbltap"))
    await expect.poll(async () => (await read()).nodes.some(node => node.id === "resource:products:2")).toBe(true)
    const expanded = await read()
    expect(expanded.nodes.find(node => node.id === "identity:bob")?.opacity).toBe(0.3)
    expect(expanded.nodes.find(node => node.id === "resource:products:2")?.opacity).toBe(0.3)
    expect(expanded.edges.filter(edge => edge.hl === "no").every(edge => edge.opacity === 0.12)).toBe(true)
    expect(Math.max(...expanded.nodes.filter(node => node.hl === "yes").map(node => node.bottom))).toBeLessThan(Math.min(...expanded.nodes.filter(node => node.hl === "no").map(node => node.top)))
    const inspector = page.getByRole("complementary", { name: "선택 작업" })
    await expect(inspector).not.toContainText("bob")
    const beforeClear = expanded.nodes.map(node => [node.id, node.y])
    await alice.click()
    await expect.poll(async () => (await read()).nodes.every(node => node.hl === "none")).toBe(true)
    expect((await read()).nodes.map(node => [node.id, node.y])).toEqual(beforeClear)
    expect((await read()).zoom).toBe(expanded.zoom)
    expect(errors).toEqual([])
  })
}
