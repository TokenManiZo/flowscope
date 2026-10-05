import { expect, test } from "@playwright/test"
import type { Core } from "cytoscape"
import type { Cell, EventRecord, Source } from "../src/lib/api/types"
import { humanRunFixture, scannerRunFixture, targetSnapshot, zapStatusFixture } from "../src/test/fixtures"
import { emptyGraphWorkspace } from "../src/features/graph/graphWorkspace"

const first = "https://one.invalid", second = "https://two.invalid"
const groupId = (service: string, name: string) => `api-group:${JSON.stringify([service, name])}`
const cell = (op: string, idn: string, perSource: Cell["perSource"], evidenceIds: string[]): Cell => ({ op, idn, resource: null, perSource, evidenceIds, reasons: {}, overall: "allow", conflict: false, missedSources: [] })
const cells = [
  cell(`${first} GET /api/orders`, "alice", { human: "allow", scanner: "deny" }, ["order-a", "order-scan"]),
  cell(`${first} GET /api/orders`, "bob", { human: "deny" }, ["order-b"]),
  cell(`${first} GET /api/products`, "bob", { scanner: "deny" }, ["product"]),
  cell(`${second} GET /api/orders`, "carol", { llm: "allow" }, ["other-order"]),
]
const event = (eventId: string, source: Source, idn: string, status: number, op: string): EventRecord => ({ eventId, source, idn, status, op, method: "GET", path: op.split(" GET ")[1], resource: null, fp: "", role: "USER", timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "run", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "LITERAL", pathTemplateReasons: [], clusterId: eventId, repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: [eventId], objects: [], verdict: "untested" })
const events = [event("order-a", "human", "alice", 200, cells[0].op), event("order-scan", "scanner", "alice", 500, cells[0].op), event("order-b", "human", "bob", 403, cells[1].op), event("product", "scanner", "bob", 403, cells[2].op), event("other-order", "llm", "carol", 302, cells[3].op), event("observed-product", "human", "bob", 201, `${first} GET /api/products/preview`)]

// 실제 그래프 렌더러와 합성 API 응답만 사용하며, 대상 서버에는 요청하지 않는다.
for (const theme of ["dark", "light"] as const) {
  test(`Site Overview dims only unmatched nodes without recoloring or moving them (${theme})`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.addInitScript(theme => localStorage.setItem("flowscope-theme", theme), theme)
    let revision = 0
    const responses: Record<string, unknown> = {
      "/api/snapshot": targetSnapshot({ datasetRevision: 7, cells, events }),
      "/api/graph-workspace": { datasetRevision: 7, revision, workspace: emptyGraphWorkspace },
      "/api/projects": { directory: "/tmp/synthetic-site-filters", active: null, projects: [], saveState: "UNMANAGED", lastSavedAt: "", saveError: "" },
      "/api/human-run": humanRunFixture, "/api/zap-status": zapStatusFixture, "/api/scanner-run": scannerRunFixture,
    }
    const origin = new URL(testInfo.project.use.baseURL!).origin
    await page.route("**/*", async route => {
      const request = route.request(), target = new URL(request.url())
      if (target.origin !== origin) { await route.abort(); return }
      if (!target.pathname.startsWith("/api/")) { await route.continue(); return }
      if (request.method() === "POST") {
        if (target.pathname !== "/api/graph-workspace") { await route.abort(); return }
        await route.fulfill({ json: { datasetRevision: 7, revision: ++revision } })
        return
      }
      await route.fulfill({ json: responses[target.pathname] ?? {} })
    })
    await page.goto("./?flowscope-e2e-geometry=1#graph")
    const canvas = page.getByLabel("공격면 Cytoscape 그래프", { exact: true })
    await expect(canvas).toHaveAttribute("data-graph-geometry", /"nodes":\[/)
    const readGraph = () => canvas.evaluate(element => {
      const core = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
      return {
        nodes: core.nodes().map(node => ({ id: node.id(), position: { ...node.position() }, opacity: Number(node.style("opacity")), image: node.data("cardImage"), border: node.style("border-color") })),
        edges: core.edges().map(edge => ({ id: edge.id(), source: edge.source().id(), target: edge.target().id(), sourceType: edge.data("src"), opacity: Number(edge.style("opacity")), color: edge.style("line-color"), width: edge.style("width") })),
      }
    })
    const baseline = await readGraph()
    expect(baseline.nodes).toHaveLength(5)
    const expectMatches = async (matched: string[] | null) => {
      await expect.poll(async () => (await readGraph()).nodes.map(node => [node.id, node.opacity])).toEqual(baseline.nodes.map(node => [node.id, matched === null || matched.includes(node.id) ? 1 : 0.3]))
      const current = await readGraph()
      expect(current.nodes.map(({ opacity: _, ...node }) => node)).toEqual(baseline.nodes.map(({ opacity: _, ...node }) => node))
      expect(current.edges.map(({ opacity: _, ...edge }) => edge)).toEqual(baseline.edges.map(({ opacity: _, ...edge }) => edge))
      for (const edge of current.edges) expect(edge.opacity).toBe(matched === null || matched.includes(edge.target) ? 0.9 : 0.12)
    }
    const rail = page.getByRole("complementary", { name: "분석 필터" })
    const human = rail.getByRole("checkbox", { name: /^HUMAN/ }), scanner = rail.getByRole("checkbox", { name: /^SCANNER/ }), alice = rail.getByRole("checkbox", { name: /^alice/ }), serverError = rail.getByRole("checkbox", { name: /^5xx/ })
    const ordersOnly = [`target:${first}`, groupId(first, "orders")]
    await human.click()
    await expectMatches([...ordersOnly, groupId(first, "products")])
    await alice.click()
    await serverError.click()
    await expectMatches([])
    await scanner.click()
    await expectMatches(ordersOnly)
    await page.screenshot({ path: testInfo.outputPath(`site-overview-${theme}.png`), animations: "disabled" })
    for (const checkbox of [human, scanner, alice, serverError]) await checkbox.click()
    await expectMatches(null)
    await rail.getByRole("checkbox", { name: /^4xx/ }).click()
    await expectMatches([...ordersOnly, groupId(first, "products")])
    await page.getByRole("button", { name: "목록", exact: true }).click()
    const otherGroup = page.locator("[data-graph-node-id]").filter({ hasText: second })
    await expect(otherGroup).toHaveClass(/opacity-30/)
    await rail.getByRole("button", { name: "초기화", exact: true }).click()
    await expect(otherGroup).not.toHaveClass(/opacity-30/)

    // API 그룹·상세 화면의 기존 신원·출처·응답 코드 색 강조는 유지한다.
    await page.locator("[data-graph-node-id]").filter({ hasText: first }).filter({ hasText: "ORDERS APIs" }).click()
    await page.getByRole("button", { name: "그래프", exact: true }).click()
    await expect(canvas).toHaveAttribute("data-graph-geometry", /"nodes":\[/)
    const groupBaseline = await readGraph()
    expect(groupBaseline.nodes).toHaveLength(3)
    await alice.click()
    await expect.poll(async () => (await readGraph()).edges.map(edge => [edge.color, edge.opacity, edge.width])).toEqual(groupBaseline.edges.map(edge => edge.source === "identity:alice" ? ["rgb(52,211,154)", 1, "2.6px"] : [edge.color, 0.12, edge.width]))
    await page.screenshot({ path: testInfo.outputPath(`api-group-colors-${theme}.png`), animations: "disabled" })
    await alice.click()
    await human.click()
    await expect.poll(async () => (await readGraph()).edges.filter(edge => edge.sourceType === "human").map(edge => edge.color)).toEqual(["rgb(96,165,250)", "rgb(96,165,250)"])
    await scanner.click()
    await serverError.click()
    await expect.poll(async () => (await readGraph()).edges.map(edge => [edge.color, edge.opacity])).toEqual(groupBaseline.edges.map(edge => edge.sourceType === "scanner" ? ["rgb(248,113,113)", 1] : [edge.color, 0.12]))
    expect((await readGraph()).nodes.find(node => node.id.startsWith("operation:"))?.image).not.toBe(groupBaseline.nodes.find(node => node.id.startsWith("operation:"))?.image)
    for (const checkbox of [human, scanner, serverError]) await checkbox.click()
    await expect.poll(readGraph).toEqual(groupBaseline)
    expect(errors).toEqual([])
  })
}
