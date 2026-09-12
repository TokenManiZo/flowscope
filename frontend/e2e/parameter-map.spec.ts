import { expect, test } from "@playwright/test"
import type { Core } from "cytoscape"
import type { EventRecord, Snapshot, SurfaceGapType, SurfaceParameterGap } from "../src/lib/api/types"
import { humanRunFixture, scannerRunFixture, targetSnapshot, zapStatusFixture } from "../src/test/fixtures"

// PR#11 parameter-map e2e on the current `snapshot.surface` contract (D-143): the API is mocked, the packaged app is real.
const service = "https://demo.test:443"
const endpoint = { service, method: "PATCH", pathTemplate: "/orders/{id}" }
const operation = `${service} PATCH /orders/{id}`
const gap = (id: string, extra: Partial<SurfaceParameterGap> = {}): SurfaceParameterGap => ({ id, type: "SOURCE_MISSED", endpoint, location: "JSON_BODY", canonicalPath: "/status", identity: "USER A", role: "USER", source: "SCANNER", status: "OPEN", priorityReasons: ["SOURCE_DISCREPANCY"], summary: "서버가 보고한 source 관측 차이", evidenceIds: ["witness-a"], evidenceCount: 31, ...extra })
const withGaps = (gaps: readonly SurfaceParameterGap[], extra: Partial<Snapshot> = {}): Snapshot => targetSnapshot({ surface: { endpoints: [], extractions: [], probes: [], parameterDiagnostics: [], validationCells: [], parameterGaps: [...gaps] }, ...extra })
const snapshot = withGaps(["auth", "source", "source-2", "source-3"].map((id, index) => gap(id, { source: index ? "SCANNER" : "HUMAN", priorityReasons: index ? ["SOURCE_DISCREPANCY"] : ["CONFIRMED_AUTH_BOUNDARY"], summary: index ? "서버가 보고한 source 관측 차이" : "타인 소유 값이 아직 검증되지 않았습니다" })))
const projectsFixture = { directory: "/tmp/projects", active: null, projects: [], saveState: "UNMANAGED", lastSavedAt: "", saveError: "" }

test("keeps the focused graph largest and preserves Gap sheet selection", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  const responses: Record<string, unknown> = { "/api/snapshot": snapshot, "/api/human-run": humanRunFixture, "/api/zap-status": zapStatusFixture, "/api/scanner-run": scannerRunFixture, "/api/projects": projectsFixture }
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname
    return path.startsWith("/api/") ? route.fulfill({ contentType: "application/json", body: JSON.stringify(responses[path] ?? {}) }) : route.continue()
  })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto("./#graph")
  const canvas = page.getByLabel("파라미터 Cytoscape 그래프", { exact: true })
  await expect(page.getByRole("navigation", { name: "FlowScope 작업 탐색" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "점검 우선순위", exact: true })).toHaveAttribute("aria-selected", "true")
  const workspace = page.getByRole("region", { name: "그래프 중심 점검 작업면", includeHidden: true })
  await expect(workspace).toBeVisible()
  const queue = page.getByRole("list", { name: "점검 우선순위 큐" })
  await expect(queue.getByRole("button")).toHaveCount(3)
  await expect(page.getByRole("region", { name: "Parameter Gap 상세" })).toHaveCount(0)
  await page.getByRole("button", { name: "전체 4개 보기" }).click()
  await expect(queue.getByRole("button")).toHaveCount(4)
  await page.getByRole("button", { name: "상위 3개만 보기" }).click()
  await expect(queue.getByRole("button")).toHaveCount(3)
  await expect.poll(async () => (await canvas.boundingBox())?.height ?? 0).toBeGreaterThan(400)
  await expect.poll(async () => canvas.locator("canvas").first().evaluate(element => (element as HTMLCanvasElement).height)).toBeGreaterThan(400)
  await queue.getByRole("button").first().click()
  await expect(page.getByRole("region", { name: "Parameter Gap 상세" })).toHaveAttribute("data-gap-id", "auth")
  await expect(canvas).toBeVisible()
  await page.getByRole("button", { name: "Gap 그래프 맞추기" }).click()
  for (const [width, height] of [[1920, 1080], [1440, 900]] as const) {
    await page.setViewportSize({ width, height })
    await expect(canvas).toBeVisible()
    await queue.locator('[data-gap-id="auth"]').click()
    const queuePane = workspace.getByRole("complementary", { name: "점검 우선순위", exact: true })
    const inspectorPane = workspace.getByRole("complementary", { name: "선택 상세", exact: true })
    await expect(inspectorPane).toBeVisible()
    await expect.poll(async () => (await canvas.boundingBox())!.width - Math.max((await queuePane.boundingBox())!.width, (await inspectorPane.boundingBox())!.width)).toBeGreaterThan(0)
    await expect(page.getByRole("region", { name: "Parameter Gap 상세" })).toHaveAttribute("data-gap-id", "auth")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), `focused workspace overflow at ${width}px`).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`focused-workspace-${width}x${height}.png`), animations: "disabled" })
  }
  const expandedCanvasWidth = (await canvas.boundingBox())!.width
  await page.getByRole("button", { name: "점검 큐 접기" }).click()
  await expect(queue).toHaveCount(0)
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(expandedCanvasWidth)
  await expect(page.getByRole("region", { name: "Parameter Gap 상세" })).toHaveAttribute("data-gap-id", "auth")
  await page.getByRole("button", { name: "점검 큐 열기" }).click()
  for (const [width, height] of [[1280, 800], [600, 900]] as const) {
    await page.setViewportSize({ width, height })
    const inspector = page.getByRole("dialog", { name: "선택 상세" })
    await expect(inspector).toBeVisible()
    await expect(inspector.getByRole("region", { name: "Parameter Gap 상세" })).toHaveAttribute("data-gap-id", "auth")
    await expect(workspace).toHaveAttribute("data-queue-open", width === 1280 ? "true" : "false")
    if (width === 1280) {
      const queuePane = workspace.getByRole("complementary", { name: "점검 우선순위", exact: true, includeHidden: true })
      await expect(queuePane).toBeVisible()
      await expect(page.getByRole("dialog", { name: "점검 우선순위", exact: true })).toHaveCount(0)
      await expect(canvas).toBeVisible()
      await expect.poll(async () => (await canvas.boundingBox())!.width - Math.max((await queuePane.boundingBox())!.width, (await inspector.boundingBox())!.width)).toBeGreaterThan(0)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`focused-workspace-${width}x${height}.png`), animations: "disabled" })
  }
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "선택 상세" })).toBeHidden()
  await expect(page.getByRole("list", { name: "Gap 경로 목록" })).toBeVisible()
  await expect(canvas).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("canonical-paths-600x900.png"), animations: "disabled" })
  await page.getByRole("button", { name: "점검 큐 열기" }).click()
  const queueSheet = page.getByRole("dialog", { name: "점검 우선순위", exact: true })
  await expect(queueSheet).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("priority-queue-sheet-600x900.png"), animations: "disabled" })
  await expect(queueSheet.getByRole("list", { name: "점검 우선순위 큐" }).getByRole("button")).toHaveCount(3)
  await queueSheet.locator('[data-gap-id="auth"]').click()
  await expect(queueSheet).toBeHidden()
  await expect(page.getByRole("dialog", { name: "선택 상세" }).getByRole("region", { name: "Parameter Gap 상세" })).toHaveAttribute("data-gap-id", "auth")
  expect(errors).toEqual([])
})

test("focuses off-page and reselected paths in a 45 Gap canvas without crossing lanes", async ({ page }, testInfo) => {
  const many = withGaps(Array.from({ length: 45 }, (_, index) => gap(`gap-${String(index + 1).padStart(2, "0")}`, { source: "HUMAN", priorityReasons: ["CONFIRMED_AUTH_BOUNDARY"], summary: "타인 소유 값이 아직 검증되지 않았습니다" })))
  const responses: Record<string, unknown> = { "/api/snapshot": many, "/api/human-run": humanRunFixture, "/api/zap-status": zapStatusFixture, "/api/scanner-run": scannerRunFixture, "/api/projects": projectsFixture }
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname
    return path.startsWith("/api/") ? route.fulfill({ contentType: "application/json", body: JSON.stringify(responses[path] ?? {}) }) : route.continue()
  })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto("./#graph")
  const canvas = page.getByLabel("파라미터 Cytoscape 그래프", { exact: true })
  await expect(canvas.locator("canvas").first()).toBeVisible()
  await page.getByRole("button", { name: "전체 45개 보기" }).click()
  const queue = page.getByRole("list", { name: "점검 우선순위 큐" })
  const assertVisible = async () => {
    await expect.poll(async () => canvas.evaluate(element => {
      const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
      const selected = cy.nodes().filter(node => node.data("focused") === "yes")
      const lanes = ["condition", "operation", "input", "target"]
      return selected.length === 4 && cy.zoom() <= cy.maxZoom() && selected.every(node => {
        const point = node.renderedPosition()
        const lane = lanes.indexOf(node.data("lane"))
        return point.y - node.renderedOuterHeight() / 2 >= 0 && point.y + node.renderedOuterHeight() / 2 <= element.clientHeight
          && point.x - node.renderedOuterWidth() / 2 >= lane * element.clientWidth / 4
          && point.x + node.renderedOuterWidth() / 2 <= (lane + 1) * element.clientWidth / 4
      })
    })).toBe(true)
  }
  await queue.locator('[data-gap-id="gap-41"]').click()
  await expect(page.getByRole("region", { name: "Parameter Gap 상세" })).toHaveAttribute("data-gap-id", "gap-41")
  await assertVisible()
  await page.screenshot({ path: testInfo.outputPath("gap-41-selected.png") })
  await canvas.evaluate(element => { (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.pan({ x: -300, y: -9000 }) })
  await queue.locator('[data-gap-id="gap-02"]').click()
  await assertVisible()
  for (const kind of ["node", "edge"] as const) {
    await canvas.evaluate((element, target) => {
      const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
      cy.pan({ x: -400, y: -9000 })
      cy.elements(`${target}[focused = "yes"]`).first().emit("tap")
    }, kind)
    await assertVisible()
  }
})

test("renders card icons and actual HTTP summaries while preserving granular Gap filters", async ({ page }) => {
  const types: SurfaceGapType[] = ["DEFINED_NOT_OBSERVED", "SOURCE_MISSED", "IDENTITY_MISSED", "AUTH_VARIANT_UNTESTED", "CONDITION_COMBINATION_UNOBSERVED", "TYPE_VARIANT_UNOBSERVED"]
  let current = withGaps(types.map(type => gap(type, { type })))
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/api/**", route => {
    const responses: Record<string, unknown> = { "/api/snapshot": current, "/api/human-run": humanRunFixture, "/api/zap-status": zapStatusFixture, "/api/scanner-run": scannerRunFixture, "/api/projects": projectsFixture }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(responses[new URL(route.request().url()).pathname] ?? {}) })
  })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto("./#graph")
  const canvas = page.getByLabel("파라미터 Cytoscape 그래프", { exact: true })
  await expect(canvas.locator("canvas").first()).toBeVisible()
  const cards = await canvas.evaluate(element => {
    const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
    return ["condition", "operation", "input", "target"].map(lane => {
      const node = cy.nodes().filter(item => item.data("lane") === lane).first()
      const svg = new DOMParser().parseFromString(decodeURIComponent(node.data("cardImage").split(",")[1]), "image/svg+xml")
      return { lane, label: node.data("accessibleLabel"), circles: svg.querySelectorAll("circle").length, paths: svg.querySelectorAll("path").length,
        badge: svg.querySelector("g rect")?.getAttribute("fill"), badgeWidth: Number(svg.querySelector("g rect")?.getAttribute("width")),
        unsafe: svg.querySelectorAll("parsererror, script, image, foreignObject, [href]").length }
    })
  })
  expect(cards[0]).toMatchObject({ circles: 1, paths: 1, unsafe: 0 })
  expect(cards[3]).toMatchObject({ circles: 0, paths: 2, unsafe: 0 })
  expect(cards[1].label).toContain("HTTP UNKNOWN · no observations; 0 Evidence")
  expect(cards[1].badge).not.toEqual(cards[2].badge)
  for (const card of cards) { expect(card.badgeWidth).toBeGreaterThan(0); expect(card.badgeWidth).toBeLessThanOrEqual(210); expect(card.unsafe).toBe(0) }
  const magnification = page.getByLabel("Gap 그래프 배율", { exact: true })
  await expect(magnification).toHaveText(/^\d+%$/)
  await page.getByRole("button", { name: "Gap 그래프 축소", exact: true }).click()
  await expect(magnification).toHaveText("95%")
  await page.getByRole("button", { name: "Gap 그래프 확대", exact: true }).click()
  await expect.poll(async () => Number.parseInt(await magnification.textContent() ?? "0")).toBeGreaterThan(95)
  await page.getByRole("button", { name: "필터 더보기", exact: true }).click()
  const filter = page.getByRole("combobox", { name: "Gap 종류", exact: true })
  for (const type of types) {
    await filter.selectOption(type)
    await expect(page.getByRole("list", { name: "점검 우선순위 큐" }).getByRole("button")).toHaveCount(1)
    await expect(page.getByRole("list", { name: "점검 우선순위 큐" }).getByRole("button")).toHaveAttribute("data-gap-id", type)
    await page.getByRole("button", { name: "필터 더보기 · 1개 적용", exact: true }).click()
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/snapshot" && response.status() === 200)
    current = { ...current, revision: current.revision + 1 }
    await refreshed
    await expect(filter).toBeHidden()
    await page.getByRole("button", { name: "필터 더보기 · 1개 적용", exact: true }).click()
    await expect(filter).toHaveValue(type)
  }
  const actual: EventRecord = { eventId: "actual-200", method: endpoint.method, path: "/orders/101", status: 200, fp: "anon", idn: "USER A", role: "USER", source: "human", op: operation, resource: null, timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "EXPLORATION", executionTrust: "OBSERVED", runId: "run", authState: "ANONYMOUS", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "INFERRED", pathTemplateReasons: [], clusterId: "orders", repeatCount: 20, firstSeen: 1, lastSeen: 20, clusterEvidenceIds: ["actual-200", "not-loaded"], objects: [], verdict: "allow" }
  current = { ...current, revision: current.revision + 1, events: [actual, actual, { ...actual, eventId: "actual-403", status: 403 }, { ...actual, eventId: "actual-no-response", status: 0 }, { ...actual, eventId: "other-operation", op: `${service} PATCH /other`, status: 500 }] }
  await expect.poll(() => canvas.evaluate(element => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.nodes().filter(node => node.data("lane") === "operation").first().data("accessibleLabel"))).toContain("HTTP 200 × 1 · 403 × 1 · UNKNOWN × 1; 3 Evidence")
  await expect(filter).toHaveValue("TYPE_VARIANT_UNOBSERVED")
  expect(errors).toEqual([])
})

test("keeps long card tooltips pointer and keyboard scrollable and clears them at UI boundaries", async ({ page }, testInfo) => {
  const coordinate = `/${"long-coordinate-".repeat(600)}<strong>literal</strong>/unique-end`
  let current = withGaps([gap("long", { canonicalPath: coordinate, source: "HUMAN", priorityReasons: ["CONFIRMED_AUTH_BOUNDARY"] })])
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/api/**", route => {
    const responses: Record<string, unknown> = { "/api/snapshot": current, "/api/human-run": humanRunFixture, "/api/zap-status": zapStatusFixture, "/api/scanner-run": scannerRunFixture, "/api/projects": projectsFixture }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(responses[new URL(route.request().url()).pathname] ?? {}) })
  })
  await page.setViewportSize({ width: 1920, height: 700 })
  await page.goto("./#graph")
  const canvas = page.getByLabel("파라미터 Cytoscape 그래프", { exact: true })
  await expect(canvas.locator("canvas").first()).toBeVisible()
  const shortTitle = await canvas.evaluate(element => {
    const node = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.nodes().filter(item => item.data("lane") === "input").first()
    const svg = new DOMParser().parseFromString(decodeURIComponent(node.data("cardImage").split(",")[1]), "image/svg+xml")
    return svg.querySelectorAll("text")[1].textContent
  })
  expect(shortTitle).toContain("…")
  expect(shortTitle).toContain("/unique-end")
  await canvas.focus()
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  const tooltip = page.getByRole("tooltip")
  await expect(tooltip).toContainText(coordinate)
  await expect(tooltip.locator("strong")).toHaveCount(0)
  await page.keyboard.press("Tab")
  await expect(tooltip).toBeFocused()
  await expect.poll(() => tooltip.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
  await page.keyboard.press("End")
  await expect.poll(() => tooltip.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath("long-tooltip-keyboard-end.png"), animations: "disabled" })
  await page.keyboard.press("Home")
  await expect.poll(() => tooltip.evaluate(element => element.scrollTop)).toBe(0)
  await page.keyboard.press("Escape")
  await expect(tooltip).toHaveCount(0)
  await expect(canvas).toBeFocused()
  await page.getByRole("button", { name: "점검 큐 접기", exact: true }).focus()
  const position = await canvas.evaluate(element => {
    const node = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.nodes().filter(item => item.data("lane") === "input").first()
    const box = element.getBoundingClientRect(), point = node.renderedPosition()
    return { x: box.left + point.x, y: box.top + point.y }
  })
  await page.mouse.move(position.x, position.y)
  await expect(tooltip).toContainText(coordinate)
  await tooltip.hover()
  await page.mouse.wheel(0, 600)
  await expect.poll(() => tooltip.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await tooltip.focus()
  current = { ...current, revision: current.revision + 1 }
  await expect(tooltip).toHaveCount(0)
  await canvas.focus()
  await expect(tooltip).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(tooltip).toHaveCount(0)
  await canvas.focus()
  await page.keyboard.press("ArrowRight")
  await expect(tooltip).toBeVisible()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("region", { name: "Parameter Gap 상세" })).toHaveAttribute("data-gap-id", "long")
  await expect(tooltip).toHaveCount(0)
  await page.setViewportSize({ width: 600, height: 900 })
  await expect(canvas).toHaveCount(0)
  await expect(tooltip).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("list", { name: "Gap 경로 목록" })).toBeVisible()
  await page.goto("./#dashboard")
  await expect(tooltip).toHaveCount(0)
  expect(errors).toEqual([])
})
