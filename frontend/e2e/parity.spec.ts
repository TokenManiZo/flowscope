import { expect, test as base } from "@playwright/test"
import type { Locator, Page } from "@playwright/test"
import type { Core } from "cytoscape"

const origin = new URL(process.env.FLOWSCOPE_E2E_ORIGIN ?? "http://127.0.0.1:17777").origin
const forbiddenActivePaths = new Set(["/api/human-run", "/api/scanner-run", "/api/llm-run", "/api/request-lab", "/api/replay"])
const rawRequestMarker = "E2E-RAW-REQUEST-MARKER-9d6c"
const rawResponseMarker = "E2E-RAW-RESPONSE-MARKER-9d6c"
type Monitor = { consoleErrors: string[]; external: string[]; forbidden: string[]; pageErrors: string[] }
const monitors = new WeakMap<Page, Monitor>()
const test = base.extend({})

async function openDashboard(page: Page) {
  await page.goto(`${origin}/?flowscope-e2e-geometry=1#dashboard`)
  await expect(page.getByRole("heading", { name: "보안 점검 대시보드" })).toBeVisible()
}
type GraphGeometry = { width: number; height: number; maxZoom: number; nodes: Array<{ id: string; kind: "identity" | "resource" | "operation" | "route-candidate" | "target" | "api-group" | "support-operation"; index: number; selected: boolean; center: { x: number; y: number }; bounds: { left: number; right: number; top: number; bottom: number } }> }
async function readGraphGeometry(canvas: Locator): Promise<GraphGeometry> {
  await expect(canvas).toHaveAttribute("data-graph-geometry", /"nodes":\[/)
  return JSON.parse(await canvas.getAttribute("data-graph-geometry") ?? "null") as GraphGeometry
}
function expectGraphNodesInLanes(snapshot: GraphGeometry) {
  expect(new Set(snapshot.nodes.map((node) => node.kind))).toEqual(new Set(["identity", "resource", "operation"]))
  for (const node of snapshot.nodes) {
    const laneIndex = node.kind === "identity" ? 0 : node.kind === "operation" ? 1 : 2
    const third = snapshot.width / 3
    const left = laneIndex * third + 24
    const right = (laneIndex + 1) * third - 24
    expect(node.center.x, `${node.kind} center left`).toBeGreaterThanOrEqual(left - 1)
    expect(node.center.x, `${node.kind} center right`).toBeLessThanOrEqual(right + 1)
    expect(node.bounds.left, `${node.kind} bounds left`).toBeGreaterThanOrEqual(left - 1)
    expect(node.bounds.right, `${node.kind} bounds right`).toBeLessThanOrEqual(right + 1)
  }
}
function expectActualGraphSelection(snapshot: GraphGeometry) {
  expect(snapshot.nodes.filter((node) => node.selected), "one Cytoscape node must retain its selected border").toHaveLength(1)
}
type MatrixStickyGeometry = { viewport: { left: number; top: number }; corner: { left: number; top: number }; operation: { top: number } }
async function readMatrixStickyGeometry(viewport: Locator): Promise<MatrixStickyGeometry> {
  return viewport.evaluate((element) => {
    const [corner, operation] = Array.from(element.querySelectorAll("thead th"))
    if (!(corner instanceof HTMLElement) || !(operation instanceof HTMLElement)) throw new Error("Matrix sticky headers are missing")
    const viewportRect = element.getBoundingClientRect()
    const cornerRect = corner.getBoundingClientRect()
    const operationRect = operation.getBoundingClientRect()
    return {
      viewport: { left: viewportRect.left, top: viewportRect.top },
      corner: { left: cornerRect.left, top: cornerRect.top },
      operation: { top: operationRect.top },
    }
  })
}
async function navigate(page: Page, label: string, heading: string) {
  const navigation = page.getByRole("navigation", { name: "주요 분석 탐색" })
  let link = navigation.getByRole("link", { name: label, exact: true })
  if (await navigation.count() === 0 || !await link.isVisible()) {
    await page.locator('button[aria-current="page"][aria-haspopup="dialog"]').click()
    link = page.getByRole("menu", { name: "분석 경로" }).getByRole("menuitem", { name: label, exact: true })
  }
  await link.click()
  if (label === "권한 매트릭스") await page.getByRole("tab", { name: "기존 권한 매트릭스", exact: true }).click()
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible()
}
async function closeSheet(page: Page) { await page.keyboard.press("Escape"); await expect(page.getByRole("dialog", { name: "Evidence 상세" })).toBeHidden() }
// Site Overview → API View (ORDERS group) → Object View (exact GET /api/orders/{id}) through the shared keyboard list.
async function drillIntoOrders(page: Page) {
  const list = page.getByRole("region", { name: "공격면 API 목록" })
  await list.getByRole("button", { name: /^ORDERS APIs/ }).click()
  await expect(page.getByRole("navigation", { name: "그래프 계층" })).toContainText("API View")
  await list.locator(':scope > button[aria-label*="GET /api/orders/{id}"]').click()
  await expect(page.getByRole("navigation", { name: "그래프 계층" })).toContainText("Object View")
}
async function deleteAccountIfPresent(page: Page, label: string) {
  const remove = page.getByRole("button", { name: `${label} 삭제` })
  if (await remove.count() === 0) return
  await remove.click()
  await expect(page.getByRole("alertdialog", { name: "등록 계정을 삭제할까요?" })).toBeVisible()
  await page.getByRole("button", { name: "계정 삭제 확인" }).click()
  await expect(remove).toHaveCount(0)
}
function xmlFixture() {
  const newline = String.fromCharCode(10)
  const request = ["GET /metadata-only HTTP/1.1", "Host: e2e.invalid", `X-Test-Request-Marker: ${rawRequestMarker}`, ""].join(newline)
  const response = ["HTTP/1.1 200 OK", "Content-Type: text/plain", "", rawResponseMarker].join(newline)
  return `<?xml version="1.0"?><items><item><host>e2e.invalid</host><port>443</port><protocol>https</protocol><method>GET</method><path>/metadata-only</path><status>200</status><request base64="false"><![CDATA[${request}]]></request><response base64="false"><![CDATA[${response}]]></response></item></items>`
}

test.describe.configure({ mode: "serial" })
test.beforeEach(async ({ page }) => {
  const monitor: Monitor = { consoleErrors: [], external: [], forbidden: [], pageErrors: [] }
  monitors.set(page, monitor)
  page.on("console", (message) => { if (message.type() === "error") monitor.consoleErrors.push(message.text()) })
  page.on("pageerror", (error) => monitor.pageErrors.push(error.message))
  await page.route("**/*", async (route) => {
    const request = route.request()
    const target = new URL(request.url())
    if (target.origin !== origin) { monitor.external.push(target.origin); await route.abort(); return }
    if (request.method() === "POST" && forbiddenActivePaths.has(target.pathname)) { monitor.forbidden.push(`${request.method()} ${target.pathname}`); await route.abort(); return }
    await route.continue()
  })
})
test.afterEach(async ({ page }) => {
  const monitor = monitors.get(page)
  expect(monitor?.external, "external origins must be aborted").toEqual([])
  expect(monitor?.forbidden, "active target requests must be aborted").toEqual([])
  expect(monitor?.consoleErrors, "browser console errors").toEqual([])
  expect(monitor?.pageErrors, "uncaught page errors").toEqual([])
  const capability = await page.locator('meta[name="flowscope-capability"]').getAttribute("content")
  const hasSecretStorage = await page.evaluate((needles) => {
    const values = [localStorage, sessionStorage].flatMap((storage) => Array.from({ length: storage.length }, (_, index) => `${storage.key(index) ?? ""}\u0000${storage.getItem(storage.key(index) ?? "") ?? ""}`))
    return values.some((value) => needles.some((needle) => needle.length > 0 && value.includes(needle)))
  }, [capability ?? "", rawRequestMarker, rawResponseMarker])
  expect(hasSecretStorage, "storage must not retain the capability or raw XML markers").toBe(false)
})

test("opens the packaged reference shell, loads the sample, navigates every route, and preserves legacy", async ({ page }) => {
  await openDashboard(page)
  await expect(page.getByRole("link", { name: "FlowScope", exact: true })).toBeVisible()
  const density = await page.evaluate(() => ({
    rootClasses: Array.from(document.documentElement.classList),
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    bodyFontSize: getComputedStyle(document.body).fontSize,
    mainFontSize: getComputedStyle(document.querySelector("main")!).fontSize,
  }))
  expect(density.rootClasses).toContain("flowscope-density-90")
  expect(Number.parseFloat(density.rootFontSize)).toBeCloseTo(14.4, 1)
  expect(Number.parseFloat(density.bodyFontSize)).toBeCloseTo(14.4, 1)
  expect(Number.parseFloat(density.mainFontSize)).toBeCloseTo(14.4, 1)
  await page.getByRole("button", { name: "새 진단 시작" }).first().click()
  await page.getByLabel("프로젝트 이름 (선택)").fill("Playwright 격리 진단")
  await page.getByLabel("Exact scope").fill("https://e2e.invalid/")
  await page.getByRole("button", { name: "보존하고 시작" }).click()
  await expect(page.getByRole("button", { name: "샘플로 화면 익히기" })).toBeVisible()
  await page.getByRole("button", { name: "샘플로 화면 익히기" }).click()
  await expect(page.getByLabel("샘플 데이터")).toBeVisible()
  const routes = [["대시보드", "보안 점검 대시보드"], ["점검 시작", "점검 시작"], ["공격면 그래프", "공격면 그래프"], ["권한 매트릭스", "권한 매트릭스"], ["흐름 순서", "흐름 순서"], ["취약점 시나리오", "취약점 시나리오"], ["Evidence", "Evidence"], ["계정·세션", "계정·세션 관리"], ["실행 상태", "실행 상태"]] as const
  for (const [label, heading] of routes) await navigate(page, label, heading)
  await page.goto(`${origin}/legacy/`)
  await expect(page.locator("h1", { hasText: "FlowScope" })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "주요 분석 탐색" })).toHaveCount(0)
})

test("keeps dashboard coverage as counts without percentages", async ({ page }) => {
  await openDashboard(page)
  const loadSample = page.getByRole("button", { name: "샘플로 화면 익히기" })
  if (await loadSample.count() > 0) await loadSample.click()
  const dashboard = page.locator('section[aria-labelledby="dashboard-title"]')
  await expect(dashboard).not.toContainText("%")
  await expect(dashboard.getByText("총 Evidence", { exact: true })).toBeVisible()
  await expect(dashboard.getByText(/^수집 \d+건$/)).toBeVisible()
  await expect(page.getByRole("complementary", { name: "선택 상세" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "선택 상세 열기" })).toHaveCount(0)
})

test("keeps graph lanes through zoom and fit, then selects real matrix, sequence, scenario, and Evidence items", async ({ page }) => {
  await openDashboard(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await navigate(page, "공격면 그래프", "공격면 그래프")
  await page.getByRole("button", { name: "권한 판정", exact: true }).click()
  const graphWorkspace = page.getByRole("region", { name: "접근 그래프 작업면" })
  const graphCanvas = graphWorkspace.getByLabel("공격면 Cytoscape 그래프")
  const laneHeadings = graphWorkspace.locator('div[aria-hidden="true"] span')
  await expect(laneHeadings).toHaveText(["TARGET", "API GROUP"])
  const siteCards = await graphCanvas.evaluate((element) => {
    const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
    return cy.nodes().map((node) => {
      const svg = new DOMParser().parseFromString(decodeURIComponent(String(node.data("cardImage")).split(",")[1]), "image/svg+xml")
      return { kind: node.data("kind"), label: node.data("accessibleLabel"), width: node.data("width"), height: node.data("height"), unsafe: svg.querySelectorAll("parsererror, script, image, foreignObject, [href]").length }
    })
  })
  expect(new Set(siteCards.map((card) => card.kind))).toEqual(new Set(["target", "api-group"]))
  for (const card of siteCards) { expect(card).toMatchObject({ width: 224, height: 124, unsafe: 0 }); expect(card.label).not.toBe("") }
  await graphWorkspace.getByRole("button", { name: "API 목록 보기" }).click()
  await drillIntoOrders(page)
  await graphWorkspace.getByRole("button", { name: "그래프 보기" }).click()
  await expect(laneHeadings).toHaveText(["IDENTITY", "API", "OBJECT"])
  const initialGeometry = await readGraphGeometry(graphCanvas)
  expectGraphNodesInLanes(initialGeometry)
  const relationshipCards = await graphCanvas.evaluate((element) => {
    const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
    return cy.nodes().map((node) => ({ kind: node.data("kind"), label: node.data("accessibleLabel"), cardImage: String(node.data("cardImage")) }))
  })
  expect(new Set(relationshipCards.map((card) => card.kind))).toEqual(new Set(["identity", "operation", "resource"]))
  expect(relationshipCards.find((card) => card.kind === "operation")?.label).toMatch(/\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|UNKNOWN) \//)
  for (const card of relationshipCards) expect(card.cardImage).toMatch(/^data:image\/svg\+xml,/)
  const initiallySelectedNode = initialGeometry.nodes.find((node) => node.kind === "operation")
  const initialCanvasBox = await graphCanvas.boundingBox()
  expect(initiallySelectedNode).toBeDefined()
  expect(initialCanvasBox).not.toBeNull()
  await page.mouse.click(initialCanvasBox!.x + initiallySelectedNode!.center.x, initialCanvasBox!.y + initiallySelectedNode!.center.y)
  await expect.poll(async () => (await readGraphGeometry(graphCanvas)).nodes.filter((node) => node.selected).length).toBe(1)
  expectActualGraphSelection(await readGraphGeometry(graphCanvas))
  const graphInspector = page.getByRole("complementary", { name: "선택 상세" })
  await graphInspector.getByRole("tab", { name: "Evidence" }).click()
  await expect(graphInspector.getByRole("region", { name: "선택 Evidence 작업" })).toBeVisible()
  await expect(graphInspector.getByRole("button", { name: "Request Lab 열기" })).toBeVisible()
  await expect(graphInspector.getByRole("button", { name: "Repeater 초안 열기" })).toBeVisible()
  const zoom = graphWorkspace.getByText(/^\d+%$/)
  const initialZoom = Number((await zoom.textContent())?.replace("%", ""))
  expect(initialZoom, "initial graph zoom").toBeGreaterThanOrEqual(40)
  expect(initialZoom).toBeLessThanOrEqual(200)
  // A drilled-down API can already be fitted to its lane-safe maximum.
  if (await graphWorkspace.getByRole("button", { name: "확대" }).isDisabled()) {
    expect(initialZoom).toBe(Math.round((await readGraphGeometry(graphCanvas)).maxZoom * 100))
    await graphWorkspace.getByRole("button", { name: "축소" }).click()
    await expect(zoom).not.toHaveText(`${initialZoom}%`)
  }
  const initialGeometryText = await graphCanvas.getAttribute("data-graph-geometry")
  const zoomBeforeIncrease = await zoom.textContent()
  await graphWorkspace.getByRole("button", { name: "확대" }).click()
  await expect(zoom).not.toHaveText(zoomBeforeIncrease ?? "")
  await expect.poll(() => graphCanvas.getAttribute("data-graph-geometry")).not.toBe(initialGeometryText)
  expectGraphNodesInLanes(await readGraphGeometry(graphCanvas))
  expectActualGraphSelection(await readGraphGeometry(graphCanvas))
  const beforeFit = await graphCanvas.getAttribute("data-graph-geometry")
  await graphWorkspace.getByRole("button", { name: "그래프 맞추기" }).click()
  await expect.poll(() => graphCanvas.getAttribute("data-graph-geometry")).not.toBe(beforeFit)
  expectGraphNodesInLanes(await readGraphGeometry(graphCanvas))
  expectActualGraphSelection(await readGraphGeometry(graphCanvas))
  const zoomBeforeDecrease = await zoom.textContent()
  await graphWorkspace.getByRole("button", { name: "축소" }).click()
  await expect(zoom).not.toHaveText(zoomBeforeDecrease ?? "")
  const beforeResize = await graphCanvas.getAttribute("data-graph-geometry")
  await page.setViewportSize({ width: 1360, height: 840 })
  await expect.poll(() => graphCanvas.getAttribute("data-graph-geometry")).not.toBe(beforeResize)
  const resizedGeometry = await readGraphGeometry(graphCanvas)
  expectGraphNodesInLanes(resizedGeometry)
  expectActualGraphSelection(resizedGeometry)
  const draggedBefore = resizedGeometry.nodes.find((node) => node.kind === "identity")
  const canvasBox = await graphCanvas.boundingBox()
  expect(draggedBefore).toBeDefined()
  expect(canvasBox).not.toBeNull()
  await page.mouse.move(canvasBox!.x + draggedBefore!.center.x, canvasBox!.y + draggedBefore!.center.y)
  await page.mouse.down()
  await page.mouse.move(Math.min(canvasBox!.x + canvasBox!.width - 8, canvasBox!.x + draggedBefore!.center.x + canvasBox!.width * 0.45), canvasBox!.y + draggedBefore!.center.y + 80, { steps: 12 })
  await page.mouse.up()
  await expect.poll(async () => (await readGraphGeometry(graphCanvas)).nodes.find((node) => node.kind === draggedBefore!.kind && node.index === draggedBefore!.index)?.center.y).not.toBe(draggedBefore!.center.y)
  const draggedAfter = (await readGraphGeometry(graphCanvas)).nodes.find((node) => node.kind === draggedBefore!.kind && node.index === draggedBefore!.index)!
  expect(Math.abs(draggedAfter.center.y - draggedBefore!.center.y)).toBeGreaterThan(20)
  expectGraphNodesInLanes(await readGraphGeometry(graphCanvas))
  expectActualGraphSelection(await readGraphGeometry(graphCanvas))
  await page.getByRole("button", { name: "위치 잠금" }).click()
  expectActualGraphSelection(await readGraphGeometry(graphCanvas))
  await page.getByRole("button", { name: "그래프 저장값 초기화" }).click()
  await expect.poll(async () => (await readGraphGeometry(graphCanvas)).nodes.filter((node) => node.selected).length).toBe(1)
  expectActualGraphSelection(await readGraphGeometry(graphCanvas))
  const increase = graphWorkspace.getByRole("button", { name: "확대" })
  for (let index = 0; index < 20 && await increase.isEnabled(); index += 1) await increase.click()
  await expect(increase).toBeDisabled()
  const maxGeometry = await readGraphGeometry(graphCanvas)
  expectGraphNodesInLanes(maxGeometry)
  expectActualGraphSelection(maxGeometry)
  const maxSupportedZoom = Number((await zoom.textContent())?.replace("%", ""))
  expect(maxSupportedZoom).toBe(Math.round(maxGeometry.maxZoom * 100))
  expect(maxSupportedZoom).toBeGreaterThanOrEqual(40)
  expect(maxSupportedZoom).toBeLessThanOrEqual(200)
  const beforeMaxFit = await graphCanvas.getAttribute("data-graph-geometry")
  await graphWorkspace.getByRole("button", { name: "그래프 맞추기" }).click()
  await expect.poll(() => graphCanvas.getAttribute("data-graph-geometry")).not.toBe(beforeMaxFit)
  expectGraphNodesInLanes(await readGraphGeometry(graphCanvas))
  expectActualGraphSelection(await readGraphGeometry(graphCanvas))
  await graphWorkspace.getByRole("button", { name: "API 목록 보기" }).click()
  const graphList = graphWorkspace.getByRole("region", { name: "공격면 API 목록" })
  await expect(graphList).toBeVisible()
  await graphList.locator(":scope > button").first().click()
  const inspector = page.getByRole("complementary", { name: "선택 상세" })
  await expect(inspector.getByText("선택 작업", { exact: true })).toBeVisible()
  await inspector.getByRole("tab", { name: "Summary" }).click()
  await expect(inspector.getByRole("region", { name: "Access Check" })).toBeVisible()
  const [selectedOperation = "", selectedIdentity = "", selectedResource = ""] = await inspector.locator("dd").evaluateAll((values) => values.slice(0, 3).map((value) => value.textContent?.trim() ?? ""))
  expect(selectedOperation, "selected operation").not.toBe("")
  expect(selectedIdentity, "selected identity").not.toBe("")
  expect(selectedResource, "selected resource").not.toBe("")
  await expect(inspector.locator("dd").nth(0)).toHaveText(selectedOperation)
  await expect(inspector.locator("dd").nth(1)).toHaveText(selectedIdentity)
  await expect(inspector.locator("dd").nth(2)).toHaveText(selectedResource)
  await graphWorkspace.getByRole("button", { name: "그래프 보기" }).click()
  await expect(laneHeadings).toHaveText(["IDENTITY", "API", "OBJECT"])
  await expect(inspector.locator("dd").nth(0)).toHaveText(selectedOperation)
  await expect(inspector.locator("dd").nth(1)).toHaveText(selectedIdentity)
  await expect(inspector.locator("dd").nth(2)).toHaveText(selectedResource)
  await navigate(page, "권한 매트릭스", "권한 매트릭스")
  await page.setViewportSize({ width: 600, height: 420 })
  const matrixViewport = page.getByRole("region", { name: "권한 매트릭스 표" })
  await expect(matrixViewport).toBeVisible()
  await expect(matrixViewport.getByRole("columnheader", { name: "신원 / 역할" })).toBeVisible()
  const stickyBefore = await readMatrixStickyGeometry(matrixViewport)
  const matrixScroll = await matrixViewport.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event("scroll"))
    return { left: element.scrollLeft, top: element.scrollTop }
  })
  expect(matrixScroll.left).toBeGreaterThan(0)
  expect(matrixScroll.top).toBeGreaterThan(0)
  await page.waitForTimeout(50)
  const stickyAfter = await readMatrixStickyGeometry(matrixViewport)
  expect(Math.abs((stickyAfter.corner.left - stickyAfter.viewport.left) - (stickyBefore.corner.left - stickyBefore.viewport.left))).toBeLessThanOrEqual(2)
  expect(Math.abs((stickyAfter.corner.top - stickyAfter.viewport.top) - (stickyBefore.corner.top - stickyBefore.viewport.top))).toBeLessThanOrEqual(2)
  expect(Math.abs((stickyAfter.operation.top - stickyAfter.viewport.top) - (stickyBefore.operation.top - stickyBefore.viewport.top))).toBeLessThanOrEqual(2)
  await page.getByRole("button", { name: "권한 셀 Evidence 열기" }).first().click()
  const compactInspectorSheet = page.getByRole("dialog", { name: "선택 상세" })
  await expect(compactInspectorSheet.getByRole("region", { name: "Evidence 상세" })).toBeVisible()
  await page.keyboard.press("Escape"); await expect(compactInspectorSheet).toBeHidden()
  await page.setViewportSize({ width: 1360, height: 840 })
  await navigate(page, "흐름 순서", "흐름 순서")
  await expect(page.getByText("이전 snapshot을 표시 중입니다.", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("region", { name: "데이터 의존 타임라인" })).toBeVisible()
  await page.getByRole("button", { name: "흐름 링크 Evidence 열기" }).first().click()
  await expect(page.getByRole("region", { name: "Evidence 상세" })).toBeVisible()
  await navigate(page, "취약점 시나리오", "취약점 시나리오")
  await expect(page.getByText("이전 snapshot을 표시 중입니다.", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "시나리오 생성" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "MCP Judge 입력 미리보기" })).toHaveCount(0)
  await page.getByRole("region", { name: "시나리오 후보 목록" }).getByRole("button").first().click()
  const generatedScenario = page.locator("article").filter({ has: page.getByText("후보 Evidence", { exact: true }) }).first()
  await expect(generatedScenario).toBeVisible()
  const candidateEvidenceGroup = generatedScenario.getByRole("heading", { name: "후보 Evidence", exact: true }).locator("xpath=..")
  const showAllCandidateEvidence = candidateEvidenceGroup.getByRole("button", { name: "Evidence 더 보기" })
  if (await showAllCandidateEvidence.count() > 0) {
    await showAllCandidateEvidence.click()
    await expect(candidateEvidenceGroup.getByRole("button", { name: "Evidence 접기" })).toBeVisible()
  }
  const candidateEvidenceCount = await candidateEvidenceGroup.locator(":scope > div").count()
  expect(candidateEvidenceCount).toBeGreaterThan(0)
  const candidateEvidenceButton = candidateEvidenceGroup.getByRole("button", { name: "Evidence 열기" }).first()
  const candidateEvidenceId = (await candidateEvidenceButton.locator("xpath=preceding-sibling::span").textContent())?.trim() ?? ""
  expect(candidateEvidenceId).not.toBe("")
  await candidateEvidenceButton.click()
  const scenarioDetailSheet = page.getByRole("region", { name: "Evidence 상세" })
  await expect(scenarioDetailSheet).toBeVisible()
  const scenarioEvidenceSection = scenarioDetailSheet.getByText("시나리오 Evidence 선택", { exact: true }).locator("xpath=..")
  await expect(scenarioEvidenceSection.getByText(`Evidence IDs (${candidateEvidenceCount})`, { exact: true })).toBeVisible()
  const showAllScenarioEvidence = scenarioEvidenceSection.getByRole("button", { name: "Evidence ID 더 보기" })
  if (await showAllScenarioEvidence.count() > 0) await showAllScenarioEvidence.click()
  await expect(scenarioEvidenceSection.getByText(candidateEvidenceId, { exact: true })).toBeVisible()
  await navigate(page, "Evidence", "Evidence")
  const evidenceRows = page.getByRole("row").filter({ has: page.getByRole("button", { name: "상세 보기" }) })
  const selectedRow = evidenceRows.nth(1)
  await expect(selectedRow).toBeVisible()
  const evidenceId = (await selectedRow.locator("td").nth(6).textContent())?.trim() ?? ""
  expect(evidenceId).not.toBe("")
  await selectedRow.getByRole("button", { name: "상세 보기" }).click()
  await expect(selectedRow).toHaveAttribute("data-state", "selected")
  const detailSheet = page.getByRole("region", { name: "Evidence 상세" })
  await expect(detailSheet).toBeVisible()
  await expect(detailSheet.getByText(`선택 Evidence: ${evidenceId}`, { exact: true })).toBeVisible()
})

test("shows the judgment matrix with server recommendations and a server-bound review form", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openDashboard(page)
  await navigate(page, "권한 매트릭스", "권한 매트릭스")
  await page.getByRole("tab", { name: "판정 매트릭스", exact: true }).click()
  await expect(page.getByRole("heading", { name: "판정 매트릭스", exact: true })).toBeVisible()
  const summary = page.getByRole("list", { name: "판정 요약" })
  await expect(summary).toContainText("BOLA/IDOR 테스트 추천")
  await page.getByRole("tab", { name: "BOLA/IDOR · 계정 × 객체", exact: true }).click()
  const table = page.getByRole("region", { name: "판정 매트릭스 표" })
  const candidate = table.getByRole("button", { name: /^BOLA\/IDOR (후보|수동 테스트 추천|수동 결과 검토)/ }).first()
  await expect(candidate).toBeVisible()
  await candidate.click()
  const inspector = page.getByRole("complementary", { name: "선택 상세" })
  await expect(inspector.getByRole("region", { name: "독립 신뢰도 축" })).toBeVisible()
  await expect(inspector.getByRole("region", { name: "테스트 유효성 게이트" })).toBeVisible()
  await expect(inspector.getByRole("region", { name: "사람 최종 판정" })).toBeVisible()
  await expect(inspector.getByRole("button", { name: "판정 저장" })).toBeEnabled()
  await expect(inspector).not.toContainText("E3")
})

test("opens Request Lab as a two-column disabled standalone draft", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openDashboard(page); await navigate(page, "Evidence", "Evidence")
  await page.getByRole("button", { name: "상세 보기" }).first().click()
  await page.getByRole("button", { name: "Request Lab 열기" }).click()
  const dialog = page.getByRole("dialog", { name: "Request Lab" })
  await expect(dialog).toBeVisible()
  const metadata = dialog.getByRole("region", { name: "Request Lab 메타데이터" })
  const workbench = dialog.getByRole("region", { name: "Request Lab 원문 작업면" })
  const [metadataBox, workbenchBox] = await Promise.all([metadata.boundingBox(), workbench.boundingBox()])
  expect(metadataBox).not.toBeNull()
  expect(workbenchBox).not.toBeNull()
  expect(metadataBox!.x + metadataBox!.width).toBeLessThanOrEqual(workbenchBox!.x + 1)
  expect(Math.abs(metadataBox!.y - workbenchBox!.y)).toBeLessThan(2)
  const request = dialog.getByLabel("Request Lab 요청 원문")
  const response = dialog.getByLabel("Request Lab 응답 원문")
  await expect(request).toBeVisible()
  await expect(response).toBeVisible()
  const [requestBox, responseBox] = await Promise.all([request.boundingBox(), response.boundingBox()])
  expect(requestBox).not.toBeNull()
  expect(responseBox).not.toBeNull()
  expect(requestBox!.x + requestBox!.width).toBeLessThanOrEqual(responseBox!.x + 2)
  await expect(dialog.getByRole("button", { name: "Request Lab 전송" })).toBeDisabled()
  await expect(dialog).toContainText(/초안|사용할 수 없|unavailable/i)
  await dialog.getByRole("button", { name: "닫기" }).click(); await closeSheet(page)
})

test("creates, edits, refreshes, and removes a metadata-only account", async ({ page }, testInfo) => {
  const suffix = `${testInfo.retry}-${Date.now()}`
  const initialLabel = `e2e-metadata-account-${suffix}`
  const editedLabel = `e2e-metadata-account-edited-${suffix}`
  await openDashboard(page); await navigate(page, "계정·세션", "계정·세션 관리")
  try {
    await expect(page.getByText("비밀값은 입력하거나 저장하지 않습니다.")).toBeVisible()
    await page.getByLabel("등록 계정 표시 이름").fill(initialLabel)
    await page.getByLabel("등록 계정 대상 서비스").fill("https://e2e.invalid")
    await page.getByRole("button", { name: "계정 저장" }).click()
    await expect(page.getByRole("button", { name: `${initialLabel} 수정` })).toBeVisible()
    await page.getByRole("button", { name: `${initialLabel} 수정` }).click()
    await page.getByLabel("등록 계정 표시 이름").fill(editedLabel)
    await page.getByLabel("등록 계정 역할").click(); await page.getByRole("option", { name: "Admin", exact: true }).click()
    await page.getByRole("button", { name: "계정 저장" }).click()
    await expect(page.getByRole("button", { name: `${editedLabel} 수정` })).toBeVisible()
  } finally {
    await deleteAccountIfPresent(page, editedLabel)
    await deleteAccountIfPresent(page, initialLabel)
  }
})

test("keeps ZAP setup and the independent Explorer while removing obsolete Judge controls", async ({ page }) => {
  await openDashboard(page); await navigate(page, "점검 시작", "점검 시작")
  await expect(page.getByRole("complementary", { name: "선택 상세" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "선택 상세 열기" })).toHaveCount(0)
  await page.getByRole("tab", { name: /3 · ZAP/ }).click()
  const zapPanel = page.getByRole("tabpanel", { name: "3 · ZAP" })
  await expect(zapPanel.getByRole("tab", { name: "실행 설정" })).toBeVisible()
  await zapPanel.getByRole("tab", { name: "실행 상태" }).click()
  await expect(zapPanel.getByText(/^ZAP 상태 · /)).toBeVisible()
  await zapPanel.getByRole("tab", { name: "실행 설정" }).click()
  await expect(zapPanel.getByText(/^UNAVAILABLE · (?:ZAP 연결 확인 기능을 사용할 수 없습니다\.|연결 상태 확인 중)$/)).toBeVisible()
  await expect(page.getByRole("button", { name: "신원별 격리 ZAP 기준선 시작" })).toBeDisabled()
  await navigate(page, "실행 상태", "실행 상태")
  await expect(page.getByRole("tab", { name: "LLM" })).toBeVisible()
  await page.getByRole("tab", { name: "LLM" }).click()
  await expect(page.getByText(/^LLM Explorer · IDLE$/)).toBeVisible()
  await expect(page.getByText("Standalone 데모에서는 LLM Explorer를 실행할 수 없습니다.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "LLM Explorer 열기" })).toBeVisible()
  await expect(page.getByRole("button", { name: "LLM Explorer 시작" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Judge/ })).toHaveCount(0)
  await expect(page.getByRole("tab", { name: "ZAP" })).toBeVisible()
})

test("imports an in-memory XML fixture and reports the aggregate without persisting its raw marker", async ({ page }) => {
  await openDashboard(page); await navigate(page, "Evidence", "Evidence")
  await page.getByRole("button", { name: "XML 가져오기" }).click()
  await page.getByLabel("XML 파일 선택").setInputFiles({ name: "metadata-only.xml", mimeType: "application/xml", buffer: Buffer.from(xmlFixture()) })
  await page.getByRole("button", { name: "XML 가져오기 실행" }).click()
  await expect(page.getByText("가져오기 결과")).toBeVisible()
  await expect(page.getByText(/가져옴 1 · 응답 없음 0 · 실패 0/)).toBeVisible()
})

test("keeps the reference frame current-route semantics, Sheets, and layout usable at desktop, 900px, and 600px", async ({ page }) => {
  const routes = [["대시보드", "보안 점검 대시보드"], ["점검 시작", "점검 시작"], ["공격면 그래프", "공격면 그래프"], ["권한 매트릭스", "권한 매트릭스"], ["흐름 순서", "흐름 순서"], ["취약점 시나리오", "취약점 시나리오"], ["Evidence", "Evidence"], ["계정·세션", "계정·세션 관리"], ["실행 상태", "실행 상태"]] as const
  await page.setViewportSize({ width: 1280, height: 720 }); await openDashboard(page)
  await navigate(page, "계정·세션", "계정·세션 관리")
  const longWorkspace = page.getByRole("region", { name: "계정·세션 작업 영역" })
  const finalControl = page.getByRole("button", { name: "세션·신원 매핑 초기화" })
  await expect(finalControl).not.toBeInViewport()
  await longWorkspace.focus()
  await page.keyboard.press("End")
  await expect(finalControl).toBeInViewport()
  await navigate(page, "공격면 그래프", "공격면 그래프")
  const desktopCanvas = page.getByLabel("공격면 Cytoscape 그래프")
  const desktopCanvasBox = await desktopCanvas.boundingBox()
  expect(desktopCanvasBox).not.toBeNull()
  expect(desktopCanvasBox!.height, "desktop graph keeps a useful full-height canvas").toBeGreaterThan(450)
  expect(desktopCanvasBox!.y + desktopCanvasBox!.height).toBeLessThanOrEqual(721)
  for (const width of [1280, 900, 600]) {
    await page.setViewportSize({ width, height: 760 }); await openDashboard(page)
    const logo = page.getByRole("link", { name: "FlowScope", exact: true })
    await logo.focus(); await expect(logo).toBeFocused(); await expect(logo).toBeVisible()
    const banner = page.getByRole("banner", { name: "FlowScope 상단 상태" })
    await expect(banner).toBeVisible()
    if (width <= 900) {
      for (const label of ["SCOPE", "SCOPE READY", "LIVE", "HUMAN", "ZAP", "SCANNER"]) await expect(banner.getByLabel(`${label} 상태`)).toBeVisible()
      await expect(banner.getByLabel("프로젝트 선택")).toBeVisible()
      await expect(banner.getByText(/^(저장 대기|저장 중|저장됨|저장 실패|새 진단 필요)$/)).toBeVisible()
      await expect(banner.getByRole("link", { name: /빠른 시작|점검 계속/ })).toBeVisible()
      expect(await banner.evaluate((element) => element.scrollWidth <= element.clientWidth), `top bar hidden strip at ${width}px`).toBe(true)
    }
    for (const [label, heading] of routes) {
      await navigate(page, label, heading)
      await expect(page.getByRole("main")).toBeVisible()
      if (width >= 1024) {
        await expect(page.getByRole("navigation", { name: "주요 분석 탐색" }).getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page")
      } else {
        const closedRoute = page.getByRole("button", { name: label, exact: true })
        await expect(closedRoute).toBeVisible()
        await expect(closedRoute).toHaveAttribute("aria-current", "page")
        await expect(page.getByRole("menu", { name: "분석 경로" })).toHaveCount(0)
      }
      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.body.scrollWidth <= document.body.clientWidth)
      expect(noOverflow, `horizontal overflow at ${width}px for ${label}`).toBe(true)
    }
    await navigate(page, "공격면 그래프", "공격면 그래프")
    if (width <= 900) {
      await expect(page.getByRole("region", { name: "공격면 API 목록" })).toBeVisible()
      await expect(page.getByLabel("공격면 Cytoscape 그래프")).toHaveCount(0)
      await page.getByRole("button", { name: "분석 필터 열기" }).click()
      await expect(page.getByRole("dialog", { name: "분석 필터" })).toBeVisible()
      await page.keyboard.press("Escape")
      await drillIntoOrders(page)
      await page.getByRole("region", { name: "공격면 API 목록" }).locator(":scope > button").first().click()
      await expect(page.getByRole("dialog", { name: "선택 상세" })).toBeVisible()
      await page.keyboard.press("Escape")
    } else await expect(page.getByLabel("공격면 Cytoscape 그래프")).toBeVisible()
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.body.scrollWidth <= document.body.clientWidth)
    expect(noOverflow, `horizontal overflow at ${width}px`).toBe(true)
  }
})
