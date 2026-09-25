import { act, screen, waitFor, within } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { renderWithQueryClient } from "@/test/render"
import type { EventRecord, Snapshot, SurfaceObservation, SurfaceParameter, SurfaceParameterGap, SurfaceValidationCell } from "@/lib/api/types"
import { actualEvent, declaration, demoEndpoint, demoEndpointKey, demoOperation, demoResource, parameterSnapshot, statusParameter, surfaceSnapshot, validationCell } from "./parameterMapFixtures"
import { defaultParameterFilters, projectParameterMap } from "./parameterProjection"
import { ParameterGapInspector } from "./ParameterGapInspector"

afterEach(() => vi.unstubAllGlobals())
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
const serverKey = { service: demoEndpointKey.service, method: "PATCH", operation: demoOperation, location: "JSON_BODY", canonicalPath: "/status", stableKey: "pk:v1:status" }
const gaps = (): readonly SurfaceParameterGap[] => parameterSnapshot().surface!.parameterGaps ?? []
const observation = (evidenceId: string): SurfaceObservation => ({ evidenceId, source: "HUMAN", runId: "run", identity: evidenceId, status: 200, shape: "STRING" })
const event = (eventId: string, extra: Partial<EventRecord> = {}): EventRecord => actualEvent({ eventId, idn: eventId, resource: null, verdict: "undecided", ...extra })

interface Options { parameter?: Partial<SurfaceParameter>; cells?: readonly SurfaceValidationCell[]; events?: readonly EventRecord[]; gaps?: readonly SurfaceParameterGap[] }

/** PR#11 fixture on our surface contract: observed Evidence on the shared status input, one foreign event, one server cell. */
function actualSnapshot(observed: readonly string[] = ["observed-a", "observed-b"], options: Options = {}): Snapshot {
  const parameter = statusParameter({ observationEvidenceIds: [...observed], observations: observed.map(observation), ...options.parameter })
  return surfaceSnapshot({ endpoints: [demoEndpoint([parameter])], gaps: options.gaps ?? gaps(), cells: options.cells ?? [validationCell()], events: options.events ?? [...observed, "foreign"].map(id => event(id)), owners: { [demoResource]: "USER B" } })
}
function withGaps(snapshot: Snapshot, next: readonly SurfaceParameterGap[]): Snapshot {
  return { ...snapshot, surface: { ...snapshot.surface!, parameterGaps: [...next] } }
}
function metadata(eventId: string, service: string = demoEndpointKey.service) {
  return { eventId, request: "LEGACY-MASKED-TEXT", response: "LEGACY-RESPONSE", parameterContext: { service, method: "PATCH", operation: demoOperation, identity: eventId, role: "USER", source: "HUMAN", status: 200, complete: false, retention: "METADATA_ONLY" }, parameterObservations: [{ key: { ...serverKey, service }, presence: "PRESENT", shape: "SCALAR", valueType: "STRING", digest: "a".repeat(64), byteLength: 3, occurrenceCount: null, confidence: "OBSERVED", contextSignature: null }] }
}
const propsFor = (snapshot: Snapshot, gapId = "auth") => ({ snapshot, projection: projectParameterMap(snapshot, defaultParameterFilters, gapId), onClose: () => undefined })

it("summarizes server validation cells before expanding the unchanged matrix", async () => {
  const snapshot = actualSnapshot(undefined, { cells: [validationCell(), validationCell({ identity: "allowed", verdict: "ALLOW", evidenceCount: 27 }), validationCell({ identity: "na", applicable: false, verdict: "UNTESTED" })] })
  const props = propsFor(snapshot)
  const result = renderWithQueryClient(<ParameterGapInspector {...props} />)
  const trigger = screen.getByRole("button", { name: /검증표 펼치기/ })
  expect(trigger).toHaveAttribute("aria-expanded", "false")
  expect(trigger).toHaveTextContent("서버 좌표 3개 · 미검증 1개 · 적용 불가 1개")
  expect(screen.queryByRole("region", { name: "파라미터 커버리지 표" })).not.toBeInTheDocument()
  await userEvent.click(trigger)
  expect(screen.getByRole("region", { name: "파라미터 커버리지 표" })).toBeVisible()
  expect(screen.getByRole("button", { name: "ALLOW · 허용 상세 보기" })).toBeVisible()
  expect(screen.queryByText(/실행 Evidence 27건/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /검증표 접기/ }))
  expect(screen.queryByRole("region", { name: "파라미터 커버리지 표" })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /검증표 펼치기/ }))
  result.rerender(<QueryClientProvider client={result.client}><ParameterGapInspector {...props} projection={projectParameterMap(snapshot, defaultParameterFilters, "source")} /></QueryClientProvider>)
  expect(screen.getByRole("button", { name: /검증표 펼치기/ })).toHaveAttribute("aria-expanded", "false")
})

it("pages selected-cell actual Evidence before parameter observations and never opens basis-only witnesses", async () => {
  const observationIds = Array.from({ length: 20 }, (_, i) => `A${i + 1}`)
  const cellIds = Array.from({ length: 20 }, (_, i) => `B${i + 1}`)
  const snapshot = actualSnapshot(observationIds, {
    cells: [validationCell({ verdict: "ALLOW", evidenceIds: [...cellIds, "B1", "wrong-operation"], evidenceCount: 55, basisEvidenceIds: ["basis-only"], basisEvidenceCount: 99 })],
    gaps: gaps().map(gap => ({ ...gap, evidenceIds: ["basis-only", "A1"] })),
    events: [...observationIds, ...cellIds, "basis-only", "wrong-operation"].map(id => event(id, id === "wrong-operation" ? { op: "GET /elsewhere" } : {})),
  })
  renderWithQueryClient(<ParameterGapInspector {...propsFor(snapshot)} />)
  await userEvent.click(screen.getByRole("button", { name: /검증표 펼치기/ }))
  const select = screen.getByRole("button", { name: "ALLOW · 허용 상세 보기" })
  select.focus()
  await userEvent.keyboard("{Enter}")
  const list = screen.getByRole("region", { name: "연결된 실제 Evidence 탐색" })
  expect(within(list).getAllByRole("button", { name: /^Evidence 상세 B/ })).toHaveLength(20)
  expect(within(list).queryByRole("button", { name: /^Evidence 상세 A/ })).not.toBeInTheDocument()
  expect(list).toHaveTextContent("선택 셀 실제 Evidence")
  expect(list).toHaveTextContent("연결된 실제 EventRecord 40건")
  expect(screen.getByText(/선택 셀 실행 Evidence 55건/)).toHaveTextContent("미리보기 20개")
  expect(screen.getByText(/선택 셀 근거 · 미실행 포함 99건/)).toBeVisible()
  expect(screen.getByText(/파라미터 관측 20건/)).toBeVisible()
  expect(screen.queryByRole("button", { name: "Evidence 상세 basis-only" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Evidence 상세 wrong-operation" })).not.toBeInTheDocument()
  const next = within(list).getByRole("button", { name: "다음 연결 Evidence 페이지" })
  next.focus()
  await userEvent.keyboard("{Enter}")
  expect(within(list).getAllByRole("button", { name: /^Evidence 상세 A/ })).toHaveLength(20)
  expect(list).toHaveTextContent("파라미터 관측 · 선택 셀의 실행 근거 아님")
  expect(list).toHaveTextContent("Gap witness")
  expect(next).toBeDisabled()
  const previous = within(list).getByRole("button", { name: "이전 연결 Evidence 페이지" })
  previous.focus()
  await userEvent.keyboard("{Enter}")
  expect(within(list).getAllByRole("button", { name: /^Evidence 상세 B/ })).toHaveLength(20)
})

it("navigates every available full cell and Gap witness beyond graph ID previews", async () => {
  const cellIds = Array.from({ length: 25 }, (_, i) => `cell-${i}`)
  const gapIds = Array.from({ length: 25 }, (_, i) => `gap-${i}`)
  const snapshot = actualSnapshot([], {
    parameter: { profile: undefined },
    cells: [validationCell({ evidenceIds: cellIds, evidenceCount: 90 })],
    gaps: gaps().map(gap => ({ ...gap, evidenceIds: gapIds, evidenceCount: 100 })),
    events: [...cellIds, ...gapIds].map(id => event(id)),
  })
  renderWithQueryClient(<ParameterGapInspector {...propsFor(snapshot)} />)
  await userEvent.click(screen.getByRole("button", { name: /검증표 펼치기/ }))
  await userEvent.click(screen.getByRole("button", { name: /상세 보기$/ }))
  const list = screen.getByRole("region", { name: "연결된 실제 Evidence 탐색" })
  expect(list).toHaveTextContent("연결된 실제 EventRecord 50건")
  const reached = new Set<string>()
  for (let page = 0; page < 3; page++) {
    const actions = within(list).getAllByRole("button", { name: /^Evidence 상세 / })
    expect(actions.length).toBeLessThanOrEqual(20)
    for (const action of actions) reached.add(action.textContent!)
    if (page < 2) await userEvent.click(within(list).getByRole("button", { name: "다음 연결 Evidence 페이지" }))
  }
  expect(reached.size).toBe(50)
  expect(reached).toContain("Evidence 상세 cell-24")
  expect(reached).toContain("Evidence 상세 gap-24")
})

it("forgets removed Inspector cells and excludes same-input links at different coordinates", async () => {
  const different = statusParameter({ canonicalPath: "/different", fieldPath: "different", displayName: "different", observationEvidenceIds: ["foreign"], observations: [observation("foreign")] })
  const snapshot = surfaceSnapshot({
    endpoints: [demoEndpoint([statusParameter({ observationEvidenceIds: ["observed-a", "observed-b"], observations: ["observed-a", "observed-b"].map(observation) }), different])],
    gaps: gaps(), cells: [validationCell(), validationCell({ endpoint: { ...demoEndpointKey, service: "https://other.test:443" }, evidenceIds: ["foreign"] })],
    events: ["observed-a", "observed-b", "foreign"].map(id => event(id)), owners: { [demoResource]: "USER B" },
  })
  const props = propsFor(snapshot)
  const result = renderWithQueryClient(<ParameterGapInspector {...props} />)
  await userEvent.click(screen.getByRole("button", { name: /검증표 펼치기/ }))
  await userEvent.click(screen.getAllByRole("button", { name: /상세 보기$/ })[0])
  expect(screen.getByText(/^선택 좌표:/)).toBeVisible()
  expect(screen.queryByRole("button", { name: "Evidence 상세 foreign" })).not.toBeInTheDocument()
  const removed = { ...snapshot, surface: { ...snapshot.surface!, validationCells: [] } }
  result.rerender(<QueryClientProvider client={result.client}><ParameterGapInspector {...props} snapshot={removed} projection={projectParameterMap(removed, defaultParameterFilters, "auth")} /></QueryClientProvider>)
  result.rerender(<QueryClientProvider client={result.client}><ParameterGapInspector {...props} /></QueryClientProvider>)
  expect(screen.queryByText(/^선택 좌표:/)).not.toBeInTheDocument()
})

it("selects only exact linked Evidence, compares safe metadata, and keeps HTTP fields out of query cache", async () => {
  const snapshot = actualSnapshot()
  const fetch = vi.fn(() => Promise.resolve(json({ records: [metadata("observed-a"), metadata("observed-b"), metadata("foreign"), metadata("witness-a", "https://other.test:443")], total: 4, offset: 0, limit: 20, hasMore: false })))
  vi.stubGlobal("fetch", fetch)
  const { client } = renderWithQueryClient(<ParameterGapInspector {...propsFor(snapshot)} />)
  await userEvent.click(screen.getByRole("tab", { name: "요청 비교" }))
  const baseline = await screen.findByRole("combobox", { name: "기준 요청" })
  expect(within(baseline).getAllByRole("option")).toHaveLength(3)
  expect(baseline).not.toHaveTextContent("foreign")
  expect(baseline).not.toHaveTextContent("witness-a")
  await userEvent.selectOptions(baseline, "observed-a")
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "비교 요청" }), "observed-b")
  expect(screen.getByRole("columnheader", { name: "기준 요청 observed-a" })).toBeVisible()
  expect(screen.getAllByText(`SHA-256: ${"a".repeat(64)}`)).toHaveLength(2)
  expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.state.data))).not.toMatch(/LEGACY|request|response|maskedPreview/)
  expect(fetch.mock.calls).toHaveLength(1)
})

// Our dataset boundary is the server datasetRevision (D-140): replacing the dataset remounts the inspector and aborts in-flight metadata.
it("aborts late metadata on selection changes and dataset replacement without reviving old comparison", async () => {
  const snapshot = actualSnapshot()
  let resolve!: (value: Response) => void
  let signal: AbortSignal | undefined
  vi.stubGlobal("fetch", vi.fn((_url: unknown, init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise<Response>(done => { resolve = done }) }))
  const props = propsFor(snapshot)
  const result = renderWithQueryClient(<ParameterGapInspector {...props} />)
  await userEvent.click(screen.getByRole("tab", { name: "요청 비교" }))
  await waitFor(() => expect(signal).toBeDefined())
  result.rerender(<QueryClientProvider client={result.client}><ParameterGapInspector {...props} projection={projectParameterMap(snapshot, defaultParameterFilters, "source")} /></QueryClientProvider>)
  expect(signal?.aborted).toBe(true)
  await act(async () => resolve(json({ records: [metadata("observed-a")], total: 1, offset: 0, limit: 20, hasMore: false })))
  expect(screen.getByRole("tab", { name: "핵심 근거" })).toHaveAttribute("aria-selected", "true")
  await userEvent.click(screen.getByRole("tab", { name: "요청 비교" }))
  await waitFor(() => expect(signal?.aborted).toBe(false))
  const replaced = { ...snapshot, datasetRevision: 2 }
  result.rerender(<QueryClientProvider client={result.client}><ParameterGapInspector {...props} snapshot={replaced} projection={projectParameterMap(replaced, defaultParameterFilters, "source")} /></QueryClientProvider>)
  expect(signal?.aborted).toBe(true)
  expect(screen.queryByRole("combobox", { name: "기준 요청" })).not.toBeInTheDocument()
})

it("opens the exact existing Evidence detail and read-only Request Lab with simultaneous messages and no automatic send", async () => {
  const snapshot = actualSnapshot()
  const fetch = vi.fn(() => Promise.resolve(json({ eventId: "observed-a", service: demoEndpointKey.service, request: "MASKED-REQUEST", response: "MASKED-RESPONSE", rawRequestRetained: false, rawResponseRetained: false, requestEditable: false, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "observed-a", reusableSession: "없음", message: "마스킹된 읽기 전용 초안입니다." })))
  vi.stubGlobal("fetch", fetch)
  const { client } = renderWithQueryClient(<ParameterGapInspector {...propsFor(snapshot)} />)
  await userEvent.click(screen.getByRole("tab", { name: "Evidence" }))
  await userEvent.click(screen.getByRole("button", { name: "Evidence 상세 observed-a" }))
  const detail = screen.getByRole("dialog", { name: "Evidence 상세" })
  expect(detail).toHaveTextContent("observed-a")
  await userEvent.click(within(detail).getByRole("button", { name: "Request Lab 열기" }))
  expect(await screen.findByLabelText("Request Lab 요청 원문")).toHaveValue("MASKED-REQUEST")
  expect(screen.getByLabelText("Request Lab 응답 원문")).toHaveValue("MASKED-RESPONSE")
  expect(screen.getByRole("button", { name: "Request Lab 전송" })).toBeDisabled()
  expect(screen.getAllByRole("status").map(element => element.textContent).join(" ")).toContain("원문 일부가 보존되지 않았거나 마스킹됐습니다")
  expect(fetch).toHaveBeenCalledWith("/api/request-lab?eventId=observed-a", expect.not.objectContaining({ method: "POST" }))
  expect(JSON.stringify(client.getQueryCache().getAll())).not.toMatch(/MASKED-REQUEST|MASKED-RESPONSE/)
})

it("keeps a safe baseline across bounded pages but clears it when the selected Gap is refreshed or removed", async () => {
  const snapshot = actualSnapshot()
  const fetch = vi.fn((url: unknown) => Promise.resolve(json(String(url).includes("offset=20")
    ? { records: [metadata("observed-b")], total: 21, offset: 20, limit: 20, hasMore: false }
    : { records: [metadata("observed-a")], total: 21, offset: 0, limit: 20, hasMore: true })))
  vi.stubGlobal("fetch", fetch)
  const props = propsFor(snapshot)
  const result = renderWithQueryClient(<ParameterGapInspector {...props} />)
  await userEvent.click(screen.getByRole("tab", { name: "요청 비교" }))
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "기준 요청" }), "observed-a")
  await userEvent.click(screen.getByRole("button", { name: "다음 Evidence 페이지" }))
  await waitFor(() => expect(screen.getByRole("combobox", { name: "비교 요청" })).toHaveTextContent("observed-b"))
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "비교 요청" }), "observed-b")
  expect(screen.getByRole("columnheader", { name: "기준 요청 observed-a" })).toBeVisible()
  expect(screen.getByRole("button", { name: "다음 Evidence 페이지" })).toBeDisabled()
  const appended = { ...snapshot, revision: snapshot.revision + 1, events: [...snapshot.events, event("unrelated", { op: "https://else.test:443 GET /unrelated" })] }
  result.rerender(<QueryClientProvider client={result.client}><ParameterGapInspector {...props} snapshot={appended} projection={projectParameterMap(appended, defaultParameterFilters, "auth")} /></QueryClientProvider>)
  expect(screen.getByRole("columnheader", { name: "기준 요청 observed-a" })).toBeVisible()
  await waitFor(() => expect(screen.getByRole("button", { name: "다음 Evidence 페이지" })).toBeDisabled())
  expect(screen.getByRole("combobox", { name: "비교 요청" })).toHaveValue("observed-b")
  const refreshed = withGaps({ ...appended, revision: appended.revision + 1 }, gaps().map(gap => ({ ...gap, summary: "최신 서버 근거" })))
  result.rerender(<QueryClientProvider client={result.client}><ParameterGapInspector {...props} snapshot={refreshed} projection={projectParameterMap(refreshed, defaultParameterFilters, "auth")} /></QueryClientProvider>)
  expect(screen.queryByRole("columnheader", { name: "기준 요청 observed-a" })).not.toBeInTheDocument()
  expect(screen.getByText(/왜 집중해야 하나요.*최신 서버 근거/)).toBeVisible()
  const removed = withGaps(refreshed, [])
  result.rerender(<QueryClientProvider client={result.client}><ParameterGapInspector {...props} snapshot={removed} projection={projectParameterMap(removed, defaultParameterFilters, "auth")} /></QueryClientProvider>)
  expect(screen.queryByRole("region", { name: "Parameter Gap 상세" })).not.toBeInTheDocument()
})

it.each(["identity", "removal", "key"])("invalidates safe picks on selected Evidence %s changes without reviving them", async (change) => {
  const snapshot = actualSnapshot()
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ records: [metadata("observed-a"), metadata("observed-b")], total: 2, offset: 0, limit: 20, hasMore: false }))))
  const props = propsFor(snapshot)
  const result = renderWithQueryClient(<ParameterGapInspector {...props} />)
  await userEvent.click(screen.getByRole("tab", { name: "요청 비교" }))
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "기준 요청" }), "observed-a")
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "비교 요청" }), "observed-b")
  const events = change === "removal" ? snapshot.events.filter(item => item.eventId !== "observed-a") : snapshot.events.map(item => item.eventId === "observed-a" && change === "identity" ? { ...item, role: "ADMIN" } : item)
  const changed = withGaps({ ...snapshot, events }, change === "key" ? gaps().map(gap => ({ ...gap, canonicalPath: "/other" })) : gaps())
  result.rerender(<QueryClientProvider client={result.client}><ParameterGapInspector {...props} snapshot={changed} projection={projectParameterMap(changed, defaultParameterFilters, "auth")} /></QueryClientProvider>)
  expect(screen.queryByRole("columnheader", { name: "기준 요청 observed-a" })).not.toBeInTheDocument()
  result.rerender(<QueryClientProvider client={result.client}><ParameterGapInspector {...props} /></QueryClientProvider>)
  expect(screen.queryByRole("columnheader", { name: "기준 요청 observed-a" })).not.toBeInTheDocument()
  expect(JSON.stringify(result.client.getQueryCache().getAll().map(query => query.state.data))).not.toMatch(/LEGACY|maskedPreview/)
})

it("disables Request Lab for a selected unexecuted basis and aborts a prior unsent draft on Gap change", async () => {
  const snapshot = actualSnapshot()
  let resolve!: (value: Response) => void
  let signal: AbortSignal | undefined
  vi.stubGlobal("fetch", vi.fn((_url: unknown, init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise<Response>(done => { resolve = done }) }))
  const props = propsFor(snapshot)
  const result = renderWithQueryClient(<ParameterGapInspector {...props} />)
  await userEvent.click(screen.getByRole("button", { name: /검증표 펼치기/ }))
  await userEvent.click(screen.getByRole("button", { name: /상세 보기$/ }))
  expect(screen.getByRole("button", { name: "Request Lab 열기" })).toBeDisabled()
  result.rerender(<QueryClientProvider client={result.client}><ParameterGapInspector {...props} projection={projectParameterMap(snapshot, defaultParameterFilters, "source")} /></QueryClientProvider>)
  await userEvent.click(screen.getByRole("button", { name: "Request Lab 열기" }))
  await waitFor(() => expect(signal).toBeDefined())
  result.rerender(<QueryClientProvider client={result.client}><ParameterGapInspector {...props} /></QueryClientProvider>)
  expect(signal?.aborted).toBe(true)
  await act(async () => resolve(json({ eventId: "observed-a", service: demoEndpointKey.service, request: "LATE-RAW-SECRET", response: "LATE-RAW-RESPONSE", rawRequestRetained: true, rawResponseRetained: true, requestEditable: true, observedIdentity: "observed-a", reusableSession: "없음", message: "draft" })))
  expect(screen.queryByLabelText("Request Lab 요청 원문")).not.toBeInTheDocument()
  expect(document.body.textContent).not.toContain("LATE-RAW")
  expect(JSON.stringify(result.client.getQueryCache().getAll())).not.toContain("LATE-RAW")
})

it("explains the Gap first, preserves inferred confidence and declarations without inventing actual requests", async () => {
  const snapshot = surfaceSnapshot({
    endpoints: [demoEndpoint([statusParameter({ declarations: [declaration()], authorizationTargets: [{ resource: "order:1", confidence: "INFERRED", basis: "same request", evidenceIds: ["basis"], evidenceCount: 21 }] })])],
    gaps: gaps(), cells: [validationCell()],
  })
  renderWithQueryClient(<ParameterGapInspector {...propsFor(snapshot)} />)
  const detail = screen.getByRole("region", { name: "Parameter Gap 상세" })
  expect(detail.querySelector("p")?.textContent).toMatch(/^왜 집중해야 하나요\?/)
  expect(detail).toHaveTextContent("INFERRED")
  expect(screen.getByText("Gap 주체: USER A / USER / HUMAN")).toBeVisible()
  expect(screen.getByRole("button", { name: "Request Lab 열기" })).toBeDisabled()
  for (const name of ["핵심 근거", "Evidence", "요청 비교", "정의 근거"]) expect(screen.getByRole("tab", { name })).toBeVisible()
  await userEvent.click(screen.getByRole("tab", { name: "정의 근거" }))
  expect(screen.getByText("OpenAPI 명세 · openapi-json-yaml · INFERRED")).toBeVisible()
  expect(screen.getByText(/정의 근거 1건/)).toBeVisible()
  expect(screen.getByText("정의는 실제 요청 관측이나 서버 사용의 증명이 아닙니다.")).toBeVisible()
})
