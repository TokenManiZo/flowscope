import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EvidencePage } from "./EvidencePage"
import { ImportXmlDialog } from "./ImportXmlDialog"
import { renderWithQueryClient } from "@/test/render"
import { observedTimeLabel } from "@/lib/display/operationLabel"
import type { EvidencePage as EvidencePageData, EventRecord, Snapshot } from "@/lib/api/types"

const rawSentinel = "RAW-REQUEST-SECRET-DO-NOT-RENDER"

function event(overrides: Partial<EventRecord>): EventRecord {
  return {
    eventId: "event-1",
    method: "GET",
    path: "/orders/1",
    status: 200,
    fp: "fingerprint",
    idn: "user-a",
    role: "User",
    source: "human",
    op: "GET /orders/{id}",
    resource: "order:1",
    timestamp: 1,
    sourceDetail: "BROWSER",
    orchestrator: "HUMAN",
    tool: "BROWSER",
    phase: "EXPLORATION",
    executionTrust: "OBSERVED",
    runId: "human-1",
    authState: "AUTHENTICATED",
    trafficClass: "API",
    trafficDisposition: "INCLUDE",
    coverageEligible: true,
    classificationOverride: false,
    classificationReasons: ["API_RESPONSE"],
    pathTemplateStatus: "CORROBORATED",
    pathTemplateReasons: ["RESPONSE_ID_MATCH"],
    clusterId: "cluster-1",
    repeatCount: 2,
    firstSeen: 1,
    lastSeen: 2,
    clusterEvidenceIds: ["event-1", "event-2"],
    objects: [{ resource: "order:1", evidence: "PATH_ID" }],
    verdict: "allow",
    ...overrides,
  }
}

function snapshot(events: readonly EventRecord[]): Snapshot {
  return {
    revision: 1,
    identityRevision: 1,
    sampleMode: false,
    events,
    trafficStats: { captured: events.length, coverage: 0, excluded: 0, review: 0, dropped: 0, payloadMetadataOnly: 0 },
    replays: [], flowLinks: [], roles: {}, owners: {}, requiredRoles: {}, activeSources: [], cells: [],
    verifications: [], gaps: [], scenarios: [], accounts: [], sessions: [], managedSessions: [], routeCandidates: [],
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function installFetch(events: readonly EventRecord[], evidencePage: EvidencePageData = { records: [], total: 0, offset: 0, limit: 200, hasMore: false }) {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input) => {
    const path = String(input)
    if (path === "/api/snapshot") return Promise.resolve(json(snapshot(events)))
    if (path.startsWith("/api/evidence?")) return Promise.resolve(json(evidencePage))
    return Promise.resolve(json({ success: true, imported: 1, candidates: 0, failed: 0 }))
  })
  vi.stubGlobal("fetch", fetch)
  return fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => vi.stubGlobal("ResizeObserver", ResizeObserverStub))

describe("EvidencePage", () => {
  it("uses one reference workspace state tree for filters, rows, and selected detail", async () => {
    installFetch([event({ eventId: "workspace-evidence" })])
    renderWithQueryClient(<EvidencePage />)

    const context = await screen.findByRole("complementary", { name: "분석 필터" })
    expect(within(context).getByRole("checkbox", { name: "사람 H" })).toBeVisible()
    expect(screen.getByRole("region", { name: "Evidence 분석 영역" })).toBeVisible()
    expect(screen.getByRole("complementary", { name: "선택 상세" })).toBeVisible()
    await userEvent.click(within(context).getByRole("checkbox", { name: "사람 H" }))
    expect(screen.queryByText("workspace-evidence")).not.toBeInTheDocument()
  })

  it("uses legacy source, disposition, and traffic-class defaults without deleting hidden Evidence", async () => {
    installFetch([
      event({ eventId: "human-api", source: "human", trafficClass: "API" }),
      event({ eventId: "scanner-review", source: "scanner", trafficClass: "UNKNOWN", trafficDisposition: "REVIEW", clusterId: "scanner-cluster" }),
      event({ eventId: "llm-hidden", source: "llm", trafficClass: "STATIC_ASSET", trafficDisposition: "EXCLUDE", clusterId: "llm-cluster" }),
      event({ eventId: "unknown-source", source: "unknown", trafficClass: "UNRECOGNIZED", clusterId: "unknown-cluster" }),
    ])

    renderWithQueryClient(<EvidencePage />)

    expect(await screen.findByText("human-api")).toBeVisible()
    expect(screen.getByText("scanner-review")).toBeVisible()
    expect(screen.queryByText("llm-hidden")).not.toBeInTheDocument()
    expect(screen.getByText("unknown-source")).toBeVisible()
    expect(screen.getByText("UNRECOGNIZED")).toBeVisible()
    expect(screen.getByRole("checkbox", { name: "INCLUDE" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "REVIEW" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "EXCLUDE" })).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "사람 H" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "스캐너 S" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "LLM L" })).toBeChecked()
    expect(screen.getByText("숨김 1건 · 삭제되지 않았습니다.")).toBeVisible()

    await userEvent.click(screen.getByRole("checkbox", { name: "스캐너 S" }))
    expect(screen.queryByText("scanner-review")).not.toBeInTheDocument()
    expect(screen.getByText("unknown-source")).toBeVisible()

    const exclude = screen.getByRole("checkbox", { name: "EXCLUDE" })
    await userEvent.click(exclude)
    expect(screen.queryByText("llm-hidden")).not.toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "정적 자원" })).not.toBeChecked()
    await userEvent.click(screen.getByRole("checkbox", { name: "정적 자원" }))
    expect(await screen.findByText("llm-hidden")).toBeVisible()
  })

  it("collapses stable repeat clusters with first/last observations and selects the exact visible row", async () => {
    installFetch([
      event({ eventId: "event-1", path: "/orders/1", clusterId: "same", clusterEvidenceIds: ["event-1", "event-2"], repeatCount: 2, firstSeen: 101, lastSeen: 202 }),
      event({ eventId: "event-2", path: "/orders/2", clusterId: "same", clusterEvidenceIds: ["event-1", "event-2"], repeatCount: 2, firstSeen: 101, lastSeen: 202 }),
      event({ eventId: "event-3", path: "/orders/3", clusterId: "other", repeatCount: 1, clusterEvidenceIds: ["event-3"] }),
    ])
    renderWithQueryClient(<EvidencePage />)

    expect(await screen.findByText("event-1")).toBeVisible()
    expect(screen.queryByText("event-2")).not.toBeInTheDocument()
    expect(within(screen.getByText("event-1").closest("tr") as HTMLTableRowElement).getByText(observedTimeLabel(101, 202))).toBeVisible()
    await userEvent.click(screen.getByRole("checkbox", { name: "반복 Evidence 펼치기" }))
    expect(await screen.findByText("event-2")).toBeVisible()
    const eventTwoRow = screen.getByText("event-2").closest("tr")
    expect(eventTwoRow).not.toBeNull()
    const detail = within(eventTwoRow as HTMLTableRowElement).getByRole("button", { name: "상세 보기" })
    expect(detail).not.toHaveAccessibleName(/event-2/)
    await userEvent.click(detail)
    expect(await screen.findByText("선택 Evidence: event-2")).toBeVisible()
    expect(screen.getAllByText("/orders/2")).toHaveLength(2)
  })

  it("uses server pagination metadata without exposing Request Lab raw data", async () => {
    const fetch = installFetch([event({ eventId: "event-1", op: "GET /space path" })], {
      records: [{ eventId: "event-1", query: "", requestBody: "", request: "Authorization: [REDACTED]", responseBody: "", response: "Set-Cookie: [REDACTED]", location: "", requestPayload: null, responsePayload: null, trafficClass: "API", trafficDisposition: "INCLUDE", classificationReasons: [] }],
      total: 406, offset: 80, limit: 200, hasMore: true,
    })
    renderWithQueryClient(<EvidencePage />)
    const eventOneRow = (await screen.findByText("event-1")).closest("tr")
    expect(eventOneRow).not.toBeNull()
    await userEvent.click(within(eventOneRow as HTMLTableRowElement).getByRole("button", { name: "상세 보기" }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/evidence?operation=GET+%2Fspace+path&offset=0&limit=200", expect.any(Object),
    ))
    expect(await screen.findByText("총 406건 · 81번째부터 표시")).toBeVisible()
    expect(screen.queryByText(rawSentinel)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(rawSentinel)
    expect(Object.values(localStorage)).not.toContain(rawSentinel)
    expect(Object.values(sessionStorage)).not.toContain(rawSentinel)
  })

  it("discards the prior operation page when selecting a different operation", async () => {
    const fetch = installFetch([
      event({ eventId: "first", op: "GET /first", clusterId: "first" }),
      event({ eventId: "second", op: "GET /second", clusterId: "second" }),
    ])
    const { client } = renderWithQueryClient(<EvidencePage />)
    const firstRow = (await screen.findByText("first")).closest("tr")
    expect(firstRow).not.toBeNull()
    await userEvent.click(within(firstRow as HTMLTableRowElement).getByRole("button", { name: "상세 보기" }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/evidence?operation=GET+%2Ffirst&offset=0&limit=200", expect.any(Object)))
    const secondRow = (await screen.findByText("second")).closest("tr")
    expect(secondRow).not.toBeNull()
    await userEvent.click(within(secondRow as HTMLTableRowElement).getByRole("button", { name: "상세 보기" }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/evidence?operation=GET+%2Fsecond&offset=0&limit=200", expect.any(Object)))

    expect(client.getQueryCache().findAll({ queryKey: ["evidence"] })).toHaveLength(1)
  })

  it("uses generic Korean live status without placing the selected Evidence ID in ARIA", async () => {
    installFetch([event({ eventId: "private-selected-id" })])
    renderWithQueryClient(<EvidencePage />)
    const row = (await screen.findByText("private-selected-id")).closest("tr")
    expect(row).not.toBeNull()
    await userEvent.click(within(row as HTMLTableRowElement).getByRole("button", { name: "상세 보기" }))
    const live = document.querySelector("[aria-live='polite']")
    expect(live).toHaveTextContent("선택한 Evidence 상세를")
    expect(live).not.toHaveTextContent("private-selected-id")
  })

  it("restores the same selected Evidence after a successful policy invalidates the snapshot", async () => {
    let snapshots = 0
    const selected = event({ eventId: "restored-event" })
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input) => {
      if (String(input) === "/api/snapshot") { snapshots += 1; return Promise.resolve(json(snapshot([selected]))) }
      if (String(input).startsWith("/api/evidence?")) return Promise.resolve(json({ records: [], total: 0, offset: 0, limit: 200, hasMore: false }))
      return Promise.resolve(json({ success: true, message: "저장됨" }))
    })
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderWithQueryClient(<EvidencePage />)
    const row = (await screen.findByText("restored-event")).closest("tr")
    expect(row).not.toBeNull()
    await user.click(within(row as HTMLTableRowElement).getByRole("button", { name: "상세 보기" }))
    await user.clear(await screen.findByLabelText("필수 역할"))
    await user.type(screen.getByLabelText("필수 역할"), "admin")
    await user.click(screen.getByRole("button", { name: "필수 역할 저장" }))
    await waitFor(() => expect(snapshots).toBeGreaterThan(1))
    expect(screen.getByText("선택 Evidence: restored-event")).toBeVisible()
  })

  it("removes stale selected detail synchronously and does not refetch its Request Lab draft after dataset replacement", async () => {
    const selected = event({ eventId: "stale-event", op: "GET /stale" })
    const fetch = installFetch([selected])
    const { client } = renderWithQueryClient(<EvidencePage />)
    const row = (await screen.findByText("stale-event")).closest("tr")
    expect(row).not.toBeNull()
    await userEvent.click(within(row as HTMLTableRowElement).getByRole("button", { name: "상세 보기" }))
    await userEvent.click(await screen.findByRole("button", { name: "Request Lab 열기" }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).startsWith("/api/request-lab?")).length).toBe(1))

    act(() => { client.setQueryData(["snapshot"], { ...snapshot([]), revision: 2 }) })

    await waitFor(() => {
      expect(screen.queryByText("선택 Evidence: stale-event")).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Request Lab 열기" })).not.toBeInTheDocument()
    })
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).startsWith("/api/request-lab?")).length).toBe(1))
  })

  it("imports every selected XML file independently with its encoded name and keeps per-file server errors", async () => {
    const fetch = installFetch([event({ eventId: "imported-event" })])
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, _init?: RequestInit) => {
      const path = String(input)
      if (path === "/api/snapshot") return Promise.resolve(json(snapshot([event({ eventId: "imported-event" })])))
      if (path.includes("first+file.xml")) return Promise.resolve(json({ success: true, imported: 3, candidates: 1, failed: 0 }))
      if (path.includes("second+file.xml")) return Promise.resolve(json({ success: false, message: "두 번째 XML 형식 오류" }, 400))
      return Promise.resolve(json({ records: [], total: 0, offset: 0, limit: 200, hasMore: false }))
    })
    renderWithQueryClient(<EvidencePage />)
    const user = userEvent.setup({ applyAccept: false })
    await user.click(await screen.findByRole("button", { name: "XML 가져오기" }))
    await user.selectOptions(screen.getByLabelText("가져올 소스"), "scanner")
    const input = screen.getByLabelText("XML 파일 선택")
    const first = new File(["<items />"], "first file.xml", { type: "application/xml" })
    const second = new File(["<items />"], "second file.xml", { type: "application/xml" })
    Object.defineProperty(first, "text", { value: async () => "<items />" })
    Object.defineProperty(second, "text", { value: async () => "<items />" })
    await user.upload(input, [
      first,
      second,
    ])
    await user.click(screen.getByRole("button", { name: "XML 가져오기 실행" }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/import-xml?source=scanner&name=first+file.xml",
      expect.objectContaining({ method: "POST", headers: expect.any(Headers), body: "<items />" }),
    ))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/import-xml?source=scanner&name=second+file.xml",
      expect.objectContaining({ method: "POST", headers: expect.any(Headers), body: "<items />" }),
    ))
    const imports = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).startsWith("/api/import-xml"))
    expect(new Headers(imports[0]?.[1]?.headers).get("Content-Type")).toBe("application/xml;charset=UTF-8")
    expect(await screen.findByText("가져옴 3 · 응답 없음 1 · 실패 0")).toBeVisible()
    expect(screen.getByText("second file.xml: 두 번째 XML 형식 오류")).toBeVisible()
  })

  it("rejects unsupported files before any XML transport begins", async () => {
    const fetch = installFetch([event({ eventId: "event-1" })])
    renderWithQueryClient(<EvidencePage />)
    const user = userEvent.setup({ applyAccept: false })
    await user.click(await screen.findByRole("button", { name: "XML 가져오기" }))
    const unsupported = new File(["not xml"], "notes.txt", { type: "text/plain" })
    await user.upload(screen.getByLabelText("XML 파일 선택"), unsupported)
    await user.click(screen.getByRole("button", { name: "XML 가져오기 실행" }))

    expect(await screen.findByText("XML 파일만 선택하세요.")).toBeVisible()
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).startsWith("/api/import-xml"))).toBe(false)
  })

  it("keeps XML import pending until the snapshot acknowledgement settles", async () => {
    let acknowledge!: () => void
    const acknowledgement = new Promise<void>((resolve) => { acknowledge = resolve })
    const importFile = vi.fn().mockResolvedValue({ success: true, imported: 1, candidates: 0, failed: 0 })
    renderWithQueryClient(<ImportXmlDialog importFile={importFile} afterImport={() => acknowledgement} />)
    const user = userEvent.setup({ applyAccept: false })
    await user.click(screen.getByRole("button", { name: "XML 가져오기" }))
    const file = new File(["<items />"], "one.xml", { type: "application/xml" })
    Object.defineProperty(file, "text", { value: async () => "<items />" })
    await user.upload(screen.getByLabelText("XML 파일 선택"), file)
    await user.click(screen.getByRole("button", { name: "XML 가져오기 실행" }))

    expect(await screen.findByRole("button", { name: "XML 가져오는 중" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "XML 가져오는 중" }))
    expect(importFile).toHaveBeenCalledTimes(1)
    acknowledge()
    expect(await screen.findByRole("button", { name: "XML 가져오기 실행" })).toBeEnabled()
  })

  it.each([900, 600])("keeps Evidence filters and selected detail functional at compact %ipx", async (width) => {
    const previousMatchMedia = window.matchMedia
    window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("1279") && width < 1280, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })) as unknown as typeof window.matchMedia
    installFetch([event({ eventId: "compact-evidence" })])
    const user = userEvent.setup()
    renderWithQueryClient(<EvidencePage />)

    const contextTrigger = screen.getByRole("button", { name: "분석 필터 열기" })
    const inspectorTrigger = screen.getByRole("button", { name: "선택 상세 열기" })
    await user.click(contextTrigger)
    const context = screen.getByRole("dialog", { name: "분석 필터" })
    await user.click(within(context).getByRole("checkbox", { name: "사람 H" }))
    expect(await screen.findByText("현재 필터에 표시할 Evidence가 없습니다. 숨김은 삭제되지 않았습니다.")).toBeVisible()
    await user.click(within(context).getByRole("button", { name: "Close" }))
    expect(contextTrigger).toHaveFocus()

    await user.click(inspectorTrigger)
    expect(screen.getByRole("dialog", { name: "선택 상세" })).toHaveTextContent("분석 결과에서 항목을 선택하면")
    await user.click(within(screen.getByRole("dialog", { name: "선택 상세" })).getByRole("button", { name: "Close" }))
    await user.click(contextTrigger)
    await user.click(within(screen.getByRole("dialog", { name: "분석 필터" })).getByRole("checkbox", { name: "사람 H" }))
    await user.click(within(screen.getByRole("dialog", { name: "분석 필터" })).getByRole("button", { name: "Close" }))
    const row = (await screen.findByText("compact-evidence")).closest("tr")
    expect(row).not.toBeNull()
    await user.click(within(row as HTMLTableRowElement).getByRole("button", { name: "상세 보기" }))
    const inspector = await screen.findByRole("dialog", { name: "선택 상세" })
    expect(within(inspector).getByText("선택 Evidence: compact-evidence")).toBeVisible()
    await user.click(within(inspector).getByRole("button", { name: "Close" }))
    expect(screen.queryByText("선택 Evidence: compact-evidence")).not.toBeInTheDocument()
    expect(inspectorTrigger).toHaveFocus()
    window.matchMedia = previousMatchMedia
  })
})
