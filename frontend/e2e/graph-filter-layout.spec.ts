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
      return { nodes: core.nodes().map(node => ({ id: node.id(), kind: node.data("kind"), x: node.position().x, hl: node.data("hl"), y: node.position().y, top: node.position().y - Number(node.data("height")) / 2, bottom: node.position().y + Number(node.data("height")) / 2, opacity: Number(node.style("opacity")) })), edges: core.edges().map(edge => ({ hl: edge.data("hl"), opacity: Number(edge.style("opacity")) })), zoom: core.zoom(), pan: core.pan() }
    })
    const rail = page.getByRole("complementary", { name: "분석 필터" })
    const alice = rail.getByRole("checkbox", { name: /^alice/ })
    const baseline = await read()
    // A first click may highlight connections, but must not move the double-click target.
    await canvas.evaluate((element, id) => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.$id(id).emit("tap"), `operation:${cells[0].op}`)
    await expect.poll(async () => (await read()).nodes.find(node => node.id === `operation:${cells[1].op}`)?.opacity).toBeLessThan(1)
    expect((await read()).nodes.map(node => [node.id, node.x, node.y])).toEqual(baseline.nodes.map(node => [node.id, node.x, node.y]))
    await canvas.evaluate(element => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.emit("tap"))
    await expect.poll(async () => (await read()).nodes.find(node => node.id === `operation:${cells[1].op}`)?.opacity).toBe(1)
    await alice.click()
    await expect.poll(async () => {
      const graph = await read(), lit = graph.nodes.filter(node => node.kind === "operation" && node.hl === "yes"), dim = graph.nodes.filter(node => node.kind === "operation" && node.hl === "no")
      return Math.max(...lit.map(node => node.y)) < Math.min(...dim.map(node => node.y))
    }).toBe(true)
    const filtered = await read()
    expect(filtered.nodes.filter(node => node.kind === "identity").map(node => [node.id, node.x, node.y])).toEqual(baseline.nodes.filter(node => node.kind === "identity").map(node => [node.id, node.x, node.y]))
    const apis = filtered.nodes.filter(node => node.kind === "operation").sort((a, b) => a.top - b.top)
    expect(apis[1].top - apis[0].bottom).toBeCloseTo(20, 4)
    expect(filtered.pan).toEqual(baseline.pan)
    expect(filtered.zoom).toBe(baseline.zoom)
    await canvas.evaluate(element => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.$id("object-group:|products").emit("dbltap"))
    await expect.poll(async () => (await read()).nodes.some(node => node.id === "resource:products:2")).toBe(true)
    const expanded = await read()
    const expandedGroup = expanded.nodes.find(node => node.id === "object-group:|products")!
    expect(expandedGroup.y).toBe(filtered.nodes.find(node => node.id === expandedGroup.id)!.y)
    expect(expanded.pan).toEqual(filtered.pan)
    expect(expanded.nodes.filter(node => node.kind === "operation").map(node => [node.id, node.x, node.y])).toEqual(filtered.nodes.filter(node => node.kind === "operation").map(node => [node.id, node.x, node.y]))
    expect(expanded.zoom).toBe(filtered.zoom)
    expect(expanded.pan.x).toBe(filtered.pan.x)
    expect(expanded.nodes.find(node => node.id === "identity:bob")?.opacity).toBe(0.3)
    expect(expanded.nodes.find(node => node.id === "resource:products:2")?.opacity).toBe(0.3)
    expect(expanded.edges.filter(edge => edge.hl === "no").every(edge => edge.opacity === 0.12)).toBe(true)
    const objectSlots = expanded.nodes.filter(node => ["object-group", "resource"].includes(node.kind)).map(node => [node.x, node.y]).sort()
    const bob = rail.getByRole("checkbox", { name: /^bob/ })
    await bob.click()
    await alice.click()
    await expect.poll(async () => (await read()).nodes.find(node => node.id === "identity:alice")?.hl).toBe("no")
    const bobFiltered = await read()
    expect(bobFiltered.nodes.filter(node => ["object-group", "resource"].includes(node.kind)).map(node => [node.x, node.y]).sort()).toEqual(objectSlots)
    expect(bobFiltered.nodes.filter(node => node.kind === "identity").every(node => Number.isFinite(node.y))).toBe(true)
    const beforeThemePositions = bobFiltered.nodes.map(node => [node.id, node.x, node.y])
    const beforeThemeImage = await canvas.evaluate(element => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.$id("resource:products:1").data("cardImage"))
    await page.evaluate(() => document.documentElement.classList.toggle("dark"))
    await expect.poll(() => canvas.evaluate(element => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.$id("resource:products:1").data("cardImage"))).not.toBe(beforeThemeImage)
    expect((await read()).nodes.map(node => [node.id, node.x, node.y])).toEqual(beforeThemePositions)
    expect((await read()).pan).toEqual(bobFiltered.pan)
    await alice.click()
    await bob.click()
    await expect.poll(async () => (await read()).nodes.find(node => node.id === "identity:bob")?.hl).toBe("no")
    const inspector = page.getByRole("complementary", { name: "선택 작업" })
    await expect(inspector).not.toContainText("bob")
    const beforeClear = (await read()).nodes.map(node => [node.id, node.y])
    await alice.click()
    await expect.poll(async () => (await read()).nodes.every(node => node.hl === "none")).toBe(true)
    expect((await read()).nodes.map(node => [node.id, node.y])).toEqual(beforeClear)
    expect((await read()).zoom).toBe(expanded.zoom)
    // An OBJ selection dims same-column siblings and unrelated API/Identity paths.
    await canvas.evaluate(element => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.$id("resource:products:1").emit("tap"))
    const visibility = () => canvas.evaluate(element => {
      const core = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
      return Object.fromEntries(core.nodes().map(node => [node.id(), Number(node.style("opacity"))]))
    })
    await expect.poll(async () => (await visibility())["resource:products:2"]).toBeLessThan(1)
    const selected = await visibility()
    expect(selected["resource:products:1"]).toBe(1)
    expect(selected["identity:alice"]).toBe(1)
    expect(selected["identity:bob"]).toBeLessThan(1)
    expect(selected[`operation:${cells[0].op}`]).toBe(1)
    expect(selected[`operation:${cells[1].op}`]).toBeLessThan(1)
    await canvas.press("Escape")
    await expect.poll(async () => (await visibility())["identity:bob"]).toBe(1)
    expect(errors).toEqual([])
  })
}

 test("API group moves only when unfolded and keeps its connected APIs highlighted", async ({ page }, testInfo) => {
  const operations = ["GET /api/orders/101", "GET /api/orders/202", "GET /api/orders/recent"]
  const cells: Cell[] = operations.map((op, i) => ({ idn: "alice", op, resource: null, perSource: { human: "allow" }, reasons: {}, overall: "allow", conflict: false, missedSources: [], evidenceIds: [`api-${i}`] }))
  const events = cells.map((cell, i) => ({ eventId: `api-${i}`, idn: cell.idn, op: cell.op, resource: null, source: "human", status: 200, method: "GET", path: cell.op.slice(4), role: "USER", timestamp: i, fp: "", sourceDetail: "BROWSER", phase: "DISCOVERY", executionTrust: "OBSERVED", classificationReasons: [], trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, objects: [] } as unknown as EventRecord))
  const navigation = { ...emptyGraphWorkspace.navigation, level: "group" as const, groupId: operationGroup(operations[0]).id }
  const groupId = "operation-group:GET /api/orders/{id}"
  const workspace = { ...emptyGraphWorkspace, navigation, views: { [graphViewKey(navigation)]: { positions: { [groupId]: { x: 540, y: 1600 }, [`operation:${operations[2]}`]: { x: 540, y: 200 } }, sizes: {}, viewport: { zoom: 0.8, pan: { x: 0, y: 0 } }, expandedGroups: [] } } }
  const responses: Record<string, unknown> = {
    "/api/snapshot": targetSnapshot({ datasetRevision: 8, cells, events }),
    "/api/graph-workspace": { datasetRevision: 8, revision: 1, workspace },
    "/api/projects": { directory: "/tmp/synthetic-api-layout", active: null, projects: [], saveState: "UNMANAGED", lastSavedAt: "", saveError: "" },
    "/api/zap-status": zapStatusFixture, "/api/human-run": humanRunFixture, "/api/scanner-run": scannerRunFixture,
  }
  const origin = new URL(testInfo.project.use.baseURL!).origin
  await page.route("**/*", async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) { await route.abort(); return }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return }
    await route.fulfill({ json: route.request().method() === "POST" ? { datasetRevision: 8, revision: 2 } : responses[url.pathname] ?? {} })
  })
  await page.goto("./?flowscope-e2e-geometry=1#graph")
  const canvas = page.getByLabel("공격면 Cytoscape 그래프", { exact: true })
  await expect(canvas).toHaveAttribute("data-graph-geometry", /"nodes":\[/)
  const read = () => canvas.evaluate(element => {
    const core = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
    return Object.fromEntries(core.nodes().map(node => [node.id(), { ...node.position(), opacity: Number(node.style("opacity")) }]))
  })
  const before = await read()
  const camera = () => canvas.evaluate((element, id) => {
    const core = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
    const node = core.$id(id)
    return { zoom: core.zoom(), pan: core.pan(), top: (node.position().y - Number(node.data("height")) / 2) * core.zoom() + core.pan().y }
  }, groupId)
  const originalCamera = await camera()
  await canvas.evaluate((element, id) => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.$id(id).emit("tap"), groupId)
  await expect.poll(async () => (await read())[`operation:${operations[2]}`].opacity).toBeLessThan(1)
  const selected = await read()
  for (const id of Object.keys(before)) expect([selected[id].x, selected[id].y]).toEqual([before[id].x, before[id].y])
  await canvas.evaluate((element, id) => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.$id(id).emit("dbltap"), groupId)
  await expect.poll(async () => Boolean((await read())[`operation:${operations[0]}`])).toBe(true)
  await expect.poll(async () => (await read())[groupId].y < (await read())[`operation:${operations[2]}`].y).toBe(true)
  const opened = await read()
  for (const op of operations.slice(0,2)) expect(opened[`operation:${op}`].opacity).toBe(1)
  const openedCamera = await camera()
  expect(openedCamera.top).toBeCloseTo(64, 3)
  expect(openedCamera.zoom).toBe(originalCamera.zoom)
  expect(openedCamera.pan.x).toBe(originalCamera.pan.x)
 })
