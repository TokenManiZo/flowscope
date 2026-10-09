import { expect, test } from "@playwright/test"
import type { Core } from "cytoscape"
import type { DisplayObject, EventRecord, RequestLabDraft } from "../src/lib/api/types"
import { humanRunFixture, scannerRunFixture, targetSnapshot, zapStatusFixture } from "../src/test/fixtures"
import { emptyGraphWorkspace, graphViewKey } from "../src/features/graph/graphWorkspace"
import { operationGroup } from "../src/features/graph/graphHierarchy"

const service = "https://owner-replay.invalid:443"
const explanation = "원본 요청에 연결된 응답입니다. 상태 코드만으로 취약점을 판정하지 않습니다."
const account = (id: string, label: string) => ({ id, label, role: "USER", target: service, color: "", authArtifactCount: 1 })
function record(eventId: string, method: string, path: string, op: string): EventRecord {
  return { eventId, method, path, op, status: 200, fp: "", idn: "user-a", role: "USER", source: "human", resource: null,
    timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "DISCOVERY", executionTrust: "OBSERVED",
    runId: "synthetic", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true,
    classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CONFIRMED", pathTemplateReasons: [],
    clusterId: eventId, repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: [eventId], objects: [], verdict: "allow", rawAvailable: true }
}
const originals = [
  record("original-path", "GET", "/api/posts/opaque", `${service} GET /api/posts/{id}`),
  record("original-query", "GET", "/api/posts?limit=20", `${service} GET /api/posts`),
  record("original-body", "POST", "/api/posts", `${service} POST /api/posts`),
]
const objects: DisplayObject[] = originals.map((event, index) => ({ eventId: event.eventId, operation: event.op,
  apiKey: event.op, groupKey: `group-${index}`, objectKey: `object-${index}`, kind: (["PATH", "QUERY", "REQUEST_BODY"] as const)[index],
  fields: [["/segments/2"], ["/limit"], ["/content"]][index], legacyResource: null, ordinal: 1,
  integerLabel: index === 0 ? "8" : null, displayOrdinal: index === 0 ? 0 : 1 }))
const replayIds = ["replay-present", "replay-not-in-events"]
function draft(eventId: string): RequestLabDraft {
  return { eventId, service, request: `GET /api/posts/opaque HTTP/1.1\r\nHost: owner-replay.invalid\r\nX-Replay-Record: ${eventId}\r\n\r\n`,
    response: `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"replay":"${eventId}"}`,
    rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, requestCharset: "UTF-8", responseCharset: "UTF-8",
    observedIdentity: "USER A", observedAccountId: "user-a", reusableSession: "", message: "synthetic recorded replay" }
}

// All API calls are fulfilled locally; selecting an owner or reading a replay never reaches a target.
for (const theme of ["dark", "light"] as const) test(`observed OBJ ownership and exact replay links in ${theme} desktop`, async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.addInitScript(theme => localStorage.setItem("flowscope-theme", theme), theme)
  const errors: string[] = [], unexpected: string[] = [], ownerWrites: { resource: string; identity: string }[] = [], draftLoads: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  let workspaceRevision = 0
  const navigation = { ...emptyGraphWorkspace.navigation, level: "group" as const, groupId: operationGroup(originals[0].op).id }
  const workspace = { ...emptyGraphWorkspace, navigation, views: { [graphViewKey(navigation)]: {
    positions: {}, sizes: {}, viewport: null, expandedGroups: [],
  } } }
  let snapshot = targetSnapshot({ datasetRevision: 7, revision: 1, activeSources: ["human"],
    accounts: [account("user-a", "USER A"), account("user-b", "USER B")], ownerOverrides: {}, displayObjects: objects,
    events: [...originals, { ...originals[0], eventId: replayIds[0], sourceDetail: "REQUEST_LAB", tool: "REQUEST_LAB", phase: "VALIDATION", trafficDisposition: "EXCLUDE", coverageEligible: false }],
    cells: originals.map(event => ({ idn: event.idn, op: event.op, resource: null, perSource: { human: "allow" as const }, reasons: {}, overall: "allow" as const, conflict: false, missedSources: [], evidenceIds: [event.eventId] })),
    evidenceOrdinals: { [replayIds[0]]: 55, [replayIds[1]]: 438 },
    manualVerifications: replayIds.map((eventId, index) => ({ eventId, originEvidenceId: originals[0].eventId, operation: originals[0].op, resource: null, identity: "USER A", identityId: "user-a", timestamp: index + 2, status: 200, durationMs: 12 })),
  })
  const origin = new URL(testInfo.project.use.baseURL!).origin
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin) { unexpected.push(url.origin); await route.abort(); return }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return }
    if (request.method() === "POST") {
      if (url.pathname === "/api/graph-workspace") {
        await route.fulfill({ json: { datasetRevision: 7, revision: ++workspaceRevision } }); return
      }
      if (url.pathname === "/api/owner") {
        const body = new URLSearchParams(request.postData() ?? "")
        const change = { resource: body.get("resource") ?? "", identity: body.get("identity") ?? "" }
        ownerWrites.push(change)
        snapshot = { ...snapshot, revision: snapshot.revision + 1, ownerOverrides: { ...snapshot.ownerOverrides, [change.resource]: change.identity } }
        await route.fulfill({ json: { success: true, message: "owner saved" } }); return
      }
      unexpected.push(`${request.method()} ${url.pathname}`)
      await route.abort(); return
    }
    if (url.pathname === "/api/request-lab") {
      const eventId = url.searchParams.get("eventId") ?? ""
      draftLoads.push(eventId)
      await route.fulfill({ json: draft(eventId) }); return
    }
    const responses: Record<string, unknown> = {
      "/api/snapshot": snapshot,
      "/api/graph-workspace": { datasetRevision: 7, revision: workspaceRevision, workspace },
      "/api/projects": { directory: "/tmp/synthetic-owner-replay", active: null, projects: [], saveState: "UNMANAGED", lastSavedAt: "", saveError: "" },
      "/api/human-run": humanRunFixture, "/api/zap-status": zapStatusFixture, "/api/scanner-run": scannerRunFixture,
      "/api/manual-attempts": [],
    }
    await route.fulfill({ json: responses[url.pathname] ?? {} })
  })
  await page.goto("./#graph")
  const canvas = page.getByLabel("공격면 Cytoscape 그래프", { exact: true })
  const inspector = page.getByRole("complementary", { name: "선택 작업", exact: true })
  async function selectObject(key: string) {
    await page.getByRole("combobox", { name: "프로젝트 전체 노드 검색" }).fill(key)
    await page.getByRole("option", { name: /^객체 / }).click()
    await expect.poll(() => canvas.evaluate((element, key) => (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.getElementById(`resource:${key}`).length, key)).toBe(1)
    await expect(inspector.getByRole("region", { name: "소유자", exact: true })).toBeVisible()
  }
  for (const [index, object] of objects.entries()) {
    await selectObject(object.objectKey)
    await inspector.getByRole("radio", { name: /USER A/ }).check()
    expect(ownerWrites).toHaveLength(index)
    await inspector.getByRole("button", { name: "소유자로 확정", exact: true }).click()
    await expect(inspector.getByRole("heading", { name: /소유자 USER A/ })).toBeVisible()
    expect(ownerWrites[index]).toEqual({ resource: `${service} observed-object:${object.objectKey}`, identity: "user-a" })
    const title = await canvas.evaluate((element, key) => String((element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy.getElementById(`resource:${key}`).data("accessibleLabel")).split(";")[0], object.objectKey)
    expect(title).toBe(index === 0 ? "8" : "OBJ 1")
  }
  await selectObject(objects[0].objectKey)
  await expect(inspector.getByRole("heading", { name: /소유자 USER A/ })).toBeVisible()
  const replays = inspector.getByRole("region", { name: "Request Lab 재현", exact: true })
  await expect(replays.getByRole("heading", { name: "Request Lab 재현 · 2건", exact: true })).toBeVisible()
  await expect(replays.getByText(explanation, { exact: true })).toHaveCount(0)
  await replays.getByRole("button", { name: "Request Lab 재현 도움말", exact: true }).click()
  await expect(page.getByText(explanation, { exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await inspector.screenshot({ path: testInfo.outputPath(`graph-owner-replay-inspector-${theme}.png`), animations: "disabled" })
  for (const [index, eventId] of replayIds.entries()) {
    await replays.getByRole("button", { name: `#${index === 0 ? 55 : 438} Request Lab에서 열기`, exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Request Lab", exact: true })
    await expect(dialog.getByLabel("Request Lab 요청 원문", { exact: true })).toHaveValue(draft(eventId).request!.replace(/\r\n/g, "\n"))
    await expect(dialog.getByLabel("Request Lab 응답 원문", { exact: true })).toHaveValue(draft(eventId).response!.replace(/\r\n/g, "\n"))
    await expect(dialog.getByLabel("Request Lab 요청 원문", { exact: true })).toHaveAttribute("readonly")
    await expect(dialog.getByRole("button", { name: "편집 화면으로", exact: true })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "요청 재전송", exact: true })).toBeDisabled()
    expect(draftLoads.at(-1)).toBe(eventId)
    expect(unexpected).toEqual([])
    await dialog.getByRole("button", { name: "닫기", exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
  expect(draftLoads).not.toContain(originals[0].eventId)
  await expect(inspector.getByRole("combobox", { name: "조작할 API" })).toHaveCount(0)
  expect(errors).toEqual([])
  expect(unexpected).toEqual([])
})
