import { expect, test } from "@playwright/test"
import type { EventRecord } from "../src/lib/api/types"
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
    const workspace = { ...emptyGraphWorkspace, navigation, views: { [graphViewKey(navigation)]: { positions: { [`operation:${cells[0].op}`]: { x: 540, y: 180 } }, sizes: {}, viewport: { zoom: 1, pan: { x: 0, y: 0 } }, expandedGroups: [`quiet-group:${navigation.groupId}`, `operation-group:${operationShapeKey(cells[0].op)}`] } } }
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

for (const width of [1280, 820]) test(`observed POST search opens neutral evidence at ${width}px`, async ({ page }, testInfo) => {
  const event: EventRecord = { eventId: "observed-post", method: "POST", path: "/api/orders/update", status: 201, fp: "", idn: "USER B", role: "USER", source: "human", op: `${service} POST /api/orders/update`, resource: null, timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "synthetic", authState: "AUTH", trafficClass: "UNKNOWN", trafficDisposition: "EXCLUDE", coverageEligible: false, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "LITERAL", pathTemplateReasons: [], clusterId: "synthetic", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["observed-post"], objects: [], verdict: "untested" }
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.setViewportSize({ width, height: 1080 })
  const responses: Record<string, unknown> = {
    "/api/snapshot": targetSnapshot({ datasetRevision: 7, cells, events: [event] }),
    "/api/graph-workspace": { datasetRevision: 7, revision: 0, workspace: emptyGraphWorkspace },
    "/api/projects": { directory: "/tmp/synthetic-observed-search", active: null, projects: [], saveState: "UNMANAGED", lastSavedAt: "", saveError: "" },
    "/api/human-run": humanRunFixture, "/api/zap-status": zapStatusFixture, "/api/scanner-run": scannerRunFixture,
  }
  const origin = new URL(testInfo.project.use.baseURL!).origin
  await page.route("**/*", async route => {
    const request = route.request(), target = new URL(request.url())
    if (target.origin !== origin) { await route.abort(); return }
    if (!target.pathname.startsWith("/api/")) { await route.continue(); return }
    if (request.method() === "POST") {
      if (target.pathname !== "/api/graph-workspace") { await route.abort(); return }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ datasetRevision: 7, revision: 1 }) })
      return
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(responses[target.pathname] ?? {}) })
  })
  await page.goto("./#graph")
  if (width <= 900) await page.getByRole("button", { name: "그래프 필터" }).click()
  await page.getByRole("button", { name: "관측 전체", exact: true }).click()
  if (width <= 900) await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByRole("combobox", { name: "프로젝트 전체 노드 검색" }).fill("POST /api/orders/update")
  const result = page.getByRole("option", { name: /^관측 API POST/ })
  await expect(result).toHaveAttribute("aria-disabled", "false")
  await result.click()
  await expect(page.getByText("인가 판정에 포함되지 않은 관측 기록 1건이 있습니다. 응답 코드는 접근 허용이나 취약점 판정이 아닙니다.")).toBeVisible()
  await expect(page.getByRole("listitem", { name: "USER B 관측 기록 1건" })).toBeVisible()
  if (width > 900) {
    const canvas = page.getByLabel("공격면 Cytoscape 그래프", { exact: true })
    await expect.poll(() => canvas.evaluate((element, id) => {
      const node = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.getElementById(id)
      return { selected: node.selected(), verdict: node.data("verdictText") }
    }, `observed-operation:${event.op}`)).toEqual({ selected: true, verdict: "UNKNOWN" })
  } else {
    await page.getByRole("button", { name: "Close", exact: true }).click()
    await expect(page.locator(`[data-graph-node-id="observed-operation:${event.op}"]`)).toBeVisible()
  }
  expect(errors).toEqual([])
})

test("ROOT search and HUMAN priority work together at 1280px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1080 })
  const human = { ...cells[0], op: `${service} GET /human`, resource: null, perSource: { human: "suspicious" as const }, overall: "suspicious" as const }
  const scanners = Array.from({ length: 18 }, (_, index) => ({ ...human, op: `${service} GET /scanner_${String.fromCharCode(97 + index)}`, perSource: { scanner: "suspicious" as const }, evidenceIds: [`s-${index}-1`, `s-${index}-2`, `s-${index}-3`] }))
  const root = JSON.stringify([service, "root"])
  const workspace = { ...emptyGraphWorkspace, navigation: { ...emptyGraphWorkspace.navigation, level: "group", groupId: root } }
  const responses: Record<string, unknown> = {
    "/api/snapshot": targetSnapshot({ datasetRevision: 7, cells: [human, ...scanners] }),
    "/api/graph-workspace": { datasetRevision: 7, revision: 0, workspace },
    "/api/projects": { directory: "/tmp/synthetic-human-priority", active: null, projects: [], saveState: "UNMANAGED", lastSavedAt: "", saveError: "" },
    "/api/human-run": humanRunFixture, "/api/zap-status": zapStatusFixture, "/api/scanner-run": scannerRunFixture,
  }
  const origin = new URL(testInfo.project.use.baseURL!).origin
  await page.route("**/*", async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) { await route.abort(); return }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(responses[url.pathname] ?? { datasetRevision: 7, revision: 1 }) })
  })
  await page.goto("./#graph")
  const canvas = page.getByLabel("공격면 Cytoscape 그래프", { exact: true })
  await expect.poll(() => canvas.evaluate((element, id) => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.getElementById(id).length, `operation:${human.op}`)).toBe(1)
  const input = page.getByRole("combobox", { name: "프로젝트 전체 노드 검색" })
  await input.fill("ROOT")
  await page.getByRole("option", { name: /^API 그룹 ROOT APIs/ }).click()
  await expect.poll(() => canvas.evaluate((element, id) => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.getElementById(id).selected(), `api-group:${root}`)).toBe(true)
  await input.fill("GET /human")
  await page.getByRole("option", { name: /^API GET \/human/ }).click()
  await expect.poll(() => canvas.evaluate((element, id) => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.getElementById(id).selected(), `operation:${human.op}`)).toBe(true)
})


test("B polling search preserves neutral evidence on A's API at 1280px", async ({ page }, testInfo) => {
  const event: EventRecord = { eventId: "bob-poll", method: "GET", path: "/api/orders/00", status: 200, fp: "", idn: "USER B", role: "USER", source: "human", op: cells[0].op, resource: null, timestamp: 1, sourceDetail: "browser", orchestrator: "HUMAN", tool: "browser", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "synthetic", authState: "AUTH", trafficClass: "POLLING", trafficDisposition: "EXCLUDE", coverageEligible: false, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "LITERAL", pathTemplateReasons: [], clusterId: "synthetic", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: ["bob-poll"], objects: [], verdict: "untested" }
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.setViewportSize({ width: 1280, height: 1080 })
  const responses: Record<string, unknown> = {
    "/api/snapshot": targetSnapshot({ datasetRevision: 7, cells, events: [event] }),
    "/api/graph-workspace": { datasetRevision: 7, revision: 0, workspace: { ...emptyGraphWorkspace, navigation } },
    "/api/projects": { directory: "/tmp/synthetic-account-evidence", active: null, projects: [], saveState: "UNMANAGED", lastSavedAt: "", saveError: "" },
    "/api/human-run": humanRunFixture, "/api/zap-status": zapStatusFixture, "/api/scanner-run": scannerRunFixture,
  }
  const origin = new URL(testInfo.project.use.baseURL!).origin
  await page.route("**/*", async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) { await route.abort(); return }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(responses[url.pathname] ?? { datasetRevision: 7, revision: 1 }) })
  })
  await page.goto("./#graph")
  await page.getByRole("button", { name: "관측 전체", exact: true }).click()
  const input = page.getByRole("combobox", { name: "프로젝트 전체 노드 검색" })
  const canvas = page.getByLabel("공격면 Cytoscape 그래프", { exact: true })
  await expect.poll(() => canvas.evaluate((element, id) => {
    const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
    const quiet = cy.getElementById(id)
    if (!quiet.length) return false
    quiet.emit("tap")
    return quiet.data("groupState") === "closed" && cy.getElementById("identity:USER B").length === 0
  }, `quiet-group:${navigation.groupId}`)).toBe(true)
  await expect(page.getByRole("listitem", { name: "USER B 관측 기록 1건" })).toBeVisible()
  await input.fill("USER B")
  await page.getByRole("option", { name: /^신원 USER B/ }).click()
  await expect.poll(() => canvas.evaluate(element => {
    const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
    const b = cy.getElementById("identity:USER B")
    return { selected: b.selected(), verdict: b.data("verdictText"), connections: b.connectedEdges().length }
  })).toEqual({ selected: true, verdict: "UNKNOWN", connections: 1 })
  await input.fill("GET /api/orders/00")
  await page.getByRole("option", { name: /^API GET \/api\/orders\/00/ }).click()
  await expect(page.getByRole("listitem", { name: "USER B 관측 기록 1건" })).toBeVisible()
  await expect.poll(() => canvas.evaluate((element, op) => {
    const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
    const api = cy.getElementById(`operation:${op}`)
    return { selected: api.selected(), verdict: api.data("verdictText"), duplicate: cy.getElementById(`observed-operation:${op}`).length, bConnected: api.connectedEdges().some(edge => edge.source().id() === "identity:USER B") }
  }, cells[0].op)).toEqual({ selected: true, verdict: "ALLOW", duplicate: 0, bConnected: true })
  expect(errors).toEqual([])
})
