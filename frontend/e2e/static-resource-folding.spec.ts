import { expect, test } from "@playwright/test"
import type { Core } from "cytoscape"
import type { EventRecord } from "../src/lib/api/types"
import { emptyGraphWorkspace } from "../src/features/graph/graphWorkspace"
import { staticResourceEntries } from "../src/features/graph/staticResourceGraph"
import { humanRunFixture, scannerRunFixture, targetSnapshot, zapStatusFixture } from "../src/test/fixtures"

for (const side of ["API", "resource"] as const) test(`static ${side} summary opens both lists before individual objects`, async ({ page, baseURL }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const service = "https://files.test:443"
  const events: EventRecord[] = Array.from({ length: 15 }, (_, i) => ({
    eventId: `image-${i}`, path: `/assets/${i < 12 ? "202609" : "202610"}/file${String(i).padStart(2, "0")}.gif`, op: `${service} GET /assets/{id}/{id}`,
    method: "GET", status: 200, fp: "", idn: "anon", role: "ANON", source: "human", timestamp: i,
    sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "run", authState: "ANON",
    trafficClass: "STATIC_ASSET", trafficDisposition: "EXCLUDE", coverageEligible: false, classificationOverride: false, classificationReasons: ["STATIC_RESOURCE_EXTENSION"],
    pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "shared", repeatCount: 15, firstSeen: 0, lastSeen: 14,
    clusterEvidenceIds: Array.from({ length: 15 }, (_, i) => `image-${i}`), objects: [], resource: null, verdict: "untested", rawAvailable: true,
  }))
  // More directory families must not shrink the initial view to the entire height.
  const firstEvent = events[0]
  for (let i = 0; i < 22; i++) events.push({ ...firstEvent,
    eventId: `script-${i}`, path: `/assets/zz${String.fromCharCode(97 + i)}/app.js`, op: `${service} GET /assets/zz${String.fromCharCode(97 + i)}/app.js`,
    clusterEvidenceIds: [`script-${i}`], clusterId: `script-${i}`, repeatCount: 1,
  })
  const snapshot = targetSnapshot({ datasetRevision: 9, events, displayObjects: [] })
  const entries = staticResourceEntries(snapshot, { source: ["human"], identity: [], view: "source", expanded: false, includeRouteCandidates: false, includeSupportTraffic: true })
  const origin = new URL(baseURL!).origin, errors: string[] = [], labs: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  let revision = 1
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin) { await route.abort(); return }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return }
    if (request.method() === "POST") {
      expect(url.pathname).toBe("/api/graph-workspace")
      await route.fulfill({ json: { datasetRevision: 9, revision: ++revision } }); return
    }
    if (url.pathname === "/api/request-lab") {
      const eventId = url.searchParams.get("eventId")!; labs.push(eventId)
      const event = events.find(event => event.eventId === eventId)!
      await route.fulfill({ json: { eventId, service, request: `GET ${event.path} HTTP/1.1\r\nHost: files.test\r\n\r\n`, response: "HTTP/1.1 200 OK\r\nContent-Type: image/gif\r\n\r\n", rawRequestRetained: true, rawResponseRetained: true, requestEditable: false, observedIdentity: "anon" } }); return
    }
    const responses: Record<string, unknown> = {
      "/api/snapshot": snapshot, "/api/graph-workspace": { datasetRevision: 9, revision, workspace: emptyGraphWorkspace },
      "/api/projects": { active: null, projects: [], saveState: "UNMANAGED" }, "/api/human-run": humanRunFixture,
      "/api/scanner-run": scannerRunFixture, "/api/zap-status": zapStatusFixture,
    }
    await route.fulfill({ json: responses[url.pathname] ?? {} })
  })
  await page.goto("./?flowscope-e2e-geometry=1#graph")
  const rail = page.getByRole("complementary", { name: "분석 필터" })
  await rail.getByRole("button", { name: "관측 전체", exact: true }).click()
  const canvas = page.getByLabel("공격면 Cytoscape 그래프", { exact: true })
  const read = () => canvas.evaluate(element => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.nodes().map(node => ({ id: node.id(), kind: node.data("kind"), y: node.position().y, height: node.height(), memberOf: node.data("memberOf"), opacity: Number(node.style("opacity")) })))
  await expect.poll(async () => (await read()).some(node => node.kind === "api-group")).toBe(true)
  const siteGroup = (await read()).find(node => node.kind === "api-group")!
  const open = (id: string) => canvas.evaluate((element, id) => {
    (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.$id(id).emit("dbltap")
  }, id)
  await open(siteGroup.id)
  const familyId = `operation-group:${entries[0].familyId}`, summaryId = `object-group:static-family-objects:${entries[0].familyId}`
  await expect.poll(async () => (await read()).some(node => node.id === summaryId)).toBe(true)
  expect((await read()).filter(node => node.kind === "resource")).toHaveLength(0)
  const collapsedNodes = await read()
  const familyBefore = collapsedNodes.find(node => node.id === familyId)!
  const viewport = () => canvas.evaluate(element => {
    const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy
    return { pan: cy.pan(), zoom: cy.zoom() }
  })
  const cameraBefore = await viewport()
  expect(cameraBefore.zoom).toBeGreaterThanOrEqual(0.65)
  await open(side === "API" ? familyId : summaryId)
  await expect.poll(async () => (await read()).filter(node => node.kind === "operation").length).toBe(2)
  expect((await read()).filter(node => node.kind === "object-group" && [entries[0].groupKey, entries[12].groupKey].some(key => node.id === `object-group:${key}`))).toHaveLength(2)
  expect((await read()).filter(node => node.kind === "resource")).toHaveLength(0)
  expect((await read()).find(node => node.id === familyId)!.y).toBe(familyBefore.y)
  expect(await viewport()).toEqual(cameraBefore)
  await open(familyId)
  await expect.poll(async () => (await read()).some(node => node.id === summaryId)).toBe(true)
  for (const original of collapsedNodes) expect((await read()).find(node => node.id === original.id)!.y).toBe(original.y)
  expect(await viewport()).toEqual(cameraBefore)
  await open(familyId)
  await expect.poll(async () => (await read()).filter(node => node.kind === "operation").length).toBe(2)
  const objectGroupId = `object-group:${entries[0].groupKey}`
  expect((await read()).find(node => node.id === objectGroupId)!.y).toBe(collapsedNodes.find(node => node.id === summaryId)!.y)
  const foldedNodes = await read()
  const before = foldedNodes.find(node => node.id === objectGroupId)!
  await open(objectGroupId)
  await expect.poll(async () => (await read()).filter(node => node.kind === "resource").length).toBe(10)
  const nodes = await read()
  expect(nodes.find(node => node.id === objectGroupId)!.y).toBe(before.y)
  expect(await canvas.evaluate(element => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.nodes('[kind = "resource"]').map(node => node.data("accessibleLabel")))).toEqual(Array(10).fill(expect.stringContaining(".gif; 정적 자원")))
  const sibling = nodes.find(node => node.id === `object-group:${entries[12].groupKey}`)!
  expect(sibling.opacity).toBeLessThan(1)
  const resources = nodes.filter(node => node.kind === "resource")
  expect(resources[0].y - resources[0].height / 2).toBeGreaterThan(before.y + before.height / 2)
  const siblingBefore = foldedNodes.find(node => node.id === sibling.id)!
  if (siblingBefore.y > before.y) expect(sibling.y - sibling.height / 2).toBeGreaterThan(resources.at(-1)!.y + resources.at(-1)!.height / 2)
  expect(await viewport()).toEqual(cameraBefore)
  await open(objectGroupId)
  await expect.poll(async () => (await read()).filter(node => node.kind === "resource").length).toBe(0)
  expect((await read()).find(node => node.id === sibling.id)!.y).toBe(siblingBefore.y)
  expect(await viewport()).toEqual(cameraBefore)
  await open(objectGroupId)
  await expect.poll(async () => (await read()).filter(node => node.kind === "resource").length).toBe(10)
  expect((await read()).find(node => node.id === sibling.id)!.y).toBe(sibling.y)
  await open(`resource:${entries[0].objectKey}`)
  const lab = page.getByRole("dialog", { name: "Request Lab", exact: true })
  await expect(lab).toBeVisible()
  await expect(lab.getByLabel("Request Lab 요청 원문")).toHaveValue(new RegExp(events[0].path))
  expect(labs).toEqual(["image-0"])
  expect(errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath("static-resource-folding.png") })
})
