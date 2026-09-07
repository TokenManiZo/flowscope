import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { App } from "@/app/App"
import type { Snapshot } from "@/lib/api/types"
import { snapshotFixture } from "@/test/fixtures"
import { createTestQueryClient, renderWithQueryClient } from "@/test/render"

const representativeSnapshot: Snapshot = {
  ...snapshotFixture,
  revision: 7,
  sampleMode: true,
  activeSources: ["human", "scanner", "llm"],
  events: [
    {
      eventId: "human-1", method: "GET", path: "/identity/api/v2/user/dashboard", status: 200,
      fp: "fp-human", idn: "member-a", role: "USER", source: "human", op: "GET /identity/api/v2/user/dashboard",
      resource: null, timestamp: 1_700_000_000_000, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER",
      phase: "EXPLORATION", executionTrust: "OBSERVED", runId: "human-run", authState: "AUTHENTICATED",
      trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false,
      classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "human-1",
      repeatCount: 5, firstSeen: 1_700_000_000_000, lastSeen: 1_700_000_000_000, clusterEvidenceIds: ["human-1"],
      objects: [], verdict: "allow",
    },
    {
      eventId: "zap-1", method: "POST", path: "/community/api/v2/community/posts/recent", status: 200,
      fp: "fp-zap", idn: "anonymous", role: "ANONYMOUS", source: "scanner", op: "POST /community/api/v2/community/posts/recent",
      resource: null, timestamp: 1_700_000_060_000, sourceDetail: "ZAP", orchestrator: "SCANNER", tool: "ZAP",
      phase: "SCANNING", executionTrust: "OBSERVED", runId: "zap-run", authState: "ANONYMOUS",
      trafficClass: "API", trafficDisposition: "REVIEW", coverageEligible: false, classificationOverride: false,
      classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "zap-1",
      repeatCount: 1, firstSeen: 1_700_000_060_000, lastSeen: 1_700_000_060_000, clusterEvidenceIds: ["zap-1"],
      objects: [], verdict: "suspicious",
    },
  ],
  trafficStats: { captured: 18, coverage: 11, review: 3, excluded: 2, dropped: 1, payloadMetadataOnly: 4 },
  cells: [
    {
      idn: "member-a",
      op: "GET /accounts/{id}",
      resource: "account-17",
      perSource: { human: "allow", scanner: "undecided", llm: "suspicious" },
      reasons: {},
      overall: "suspicious",
      conflict: true,
      missedSources: [],
      evidenceIds: ["e-1"],
    },
  ],
  gaps: [{ id: "gap-1", type: "MISSING_SOURCE", risk: 8, idn: "member-a", op: "GET /accounts/{id}", resource: "account-17", missedSources: ["llm"], summary: "LLM 탐색이 아직 없습니다." }],
  scenarios: [{ id: "finding-1", tag: "BOLA", title: "계정 조회 인가 확인", proposal: "", evidence: "e-1", risk: "HIGH", evidenceIds: ["e-1"], reviewStatus: "UNRESOLVED", reviewNote: "" }],
}

function capabilityMeta() {
  const meta = document.createElement("meta")
  meta.name = "flowscope-capability"
  meta.content = "a".repeat(64)
  document.head.append(meta)
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function installTransport(snapshot: Snapshot, failSnapshotOnce = false, failAfterFirstSnapshot = false, failOperationalQueries = false) {
  let remainingSnapshotFailures = failSnapshotOnce ? 2 : 0
  let snapshotRequests = 0
  const fetchStub = vi.fn((path: string, init?: RequestInit) => {
    if (path === "/api/snapshot") {
      snapshotRequests += 1
      if (failAfterFirstSnapshot && snapshotRequests > 1) {
        return Promise.resolve(response({ success: false, message: "스냅샷을 가져올 수 없습니다." }, 503))
      }
      if (remainingSnapshotFailures > 0) {
        remainingSnapshotFailures -= 1
        return Promise.resolve(response({ success: false, message: "스냅샷을 가져올 수 없습니다." }, 503))
      }
      return Promise.resolve(response(snapshot))
    }
    if (failOperationalQueries && (path === "/api/human-run" || path === "/api/scanner-run")) return Promise.resolve(response({ success: false, message: "운영 상태를 가져올 수 없습니다." }, 503))
    if (path === "/api/human-run") return Promise.resolve(response({ active: false, completed: false, runId: "", accountId: "", proxy: "http://127.0.0.1:8080" }))
    if (path === "/api/zap-status") return Promise.resolve(response({ connected: true, state: "READY", message: "ZAP 연결됨" }))
    if (path === "/api/scanner-run") return Promise.resolve(response({ run: { status: "IDLE" }, scope: ["https://demo.flowscope.test"] }))
    if (path === "/api/sample" || path === "/api/clear") return Promise.resolve(response({ success: true, message: "완료" }))
    return Promise.reject(new Error(`unexpected endpoint: ${path} ${init?.method ?? "GET"}`))
  })
  vi.stubGlobal("fetch", fetchStub)
  return fetchStub
}

function renderDashboard(snapshot = representativeSnapshot, failSnapshotOnce = false, failAfterFirstSnapshot = false, failOperationalQueries = false) {
  window.location.hash = "#dashboard"
  capabilityMeta()
  const fetchStub = installTransport(snapshot, failSnapshotOnce, failAfterFirstSnapshot, failOperationalQueries)
  renderWithQueryClient(<App />, createTestQueryClient())
  return fetchStub
}

function setCompactViewport(width: number) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("1279") && width < 1280,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia)
}

afterEach(() => {
  document.head.querySelector('meta[name="flowscope-capability"]')?.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.location.hash = ""
})

describe("dashboard shell", () => {
  it("exposes the reference rail route set and normalizes unsafe hashes to the API delta work surface", async () => {
    const user = userEvent.setup()
    renderDashboard()

    await screen.findByRole("heading", { name: "보안 점검 대시보드" })
    expect(screen.getByRole("banner", { name: "FlowScope 상단 상태" })).toBeVisible()
    expect(screen.getByRole("navigation", { name: "주요 분석 탐색" })).toBeVisible()
    const routes = [
      ["대시보드", "dashboard"], ["점검 시작", "inspection"], ["공격면 그래프", "graph"],
      ["권한 매트릭스", "matrix"], ["흐름 순서", "sequence"], ["취약점 시나리오", "scenarios"],
      ["Evidence", "evidence"], ["계정·세션", "accounts"], ["실행 상태", "runs"],
    ] as const

    for (const [label, route] of routes) {
      const link = screen.getByRole("link", { name: label })
      expect(link).toHaveAttribute("href", `#${route}`)
      await user.click(link)
      expect(window.location.hash).toBe(`#${route}`)
    }

    for (const unsafeHash of ["#", "#unknown", "#/assets/evil.js", "#%2Fassets%2Fevil.js"]) {
      window.location.hash = unsafeHash
      window.dispatchEvent(new HashChangeEvent("hashchange"))
      await waitFor(() => expect(window.location.hash).toBe("#surface"))
    }
    window.history.pushState(null, "", "#runs")
    window.dispatchEvent(new PopStateEvent("popstate"))
    await waitFor(() => expect(screen.getByRole("heading", { name: "실행 상태" })).toBeVisible())
    window.history.pushState(null, "", "#dashboard")
    window.dispatchEvent(new PopStateEvent("popstate"))
    await waitFor(() => expect(screen.getByRole("link", { name: "대시보드" })).toHaveAttribute("aria-current", "page"))
    expect(screen.getByRole("heading", { name: "보안 점검 대시보드" })).toBeVisible()
  }, 15_000)

  it("shows exact evidence counts, text source states, summaries, sample warning, and a next action without coverage percentages", async () => {
    renderDashboard()

    await screen.findByText("수집 18건")
    expect(screen.getByText("분석 대상 11건")).toBeVisible()
    expect(screen.getByText("검토 대기 3건")).toBeVisible()
    expect(screen.getByText("제외 2건")).toBeVisible()
    expect(screen.getByText("삭제됨 1건")).toBeVisible()
    expect(screen.getByText("Payload 메타데이터만 4건")).toBeVisible()
    expect(screen.getAllByText("https://demo.flowscope.test").length).toBeGreaterThan(0)
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    expect(screen.getByText(/H · HUMAN/)).toBeVisible()
    expect(screen.getByText(/S · ZAP/)).toBeVisible()
    expect(screen.getByText(/L · LLM/)).toBeVisible()
    expect(screen.getByText("LLM 탐색이 아직 없습니다.")).toBeVisible()
    expect(screen.getByText("계정 조회 인가 확인")).toBeVisible()
    expect(screen.getByRole("alert", { name: /샘플 데이터/ })).toBeVisible()
    expect(screen.getByText("다음 권장 작업: 갭을 검토하세요")).toBeVisible()
  })

  it("presents the security overview as scan KPIs, an evidence trend, and recent activity", async () => {
    renderDashboard()

    expect(await screen.findByRole("heading", { name: "보안 점검 대시보드" })).toBeVisible()
    expect(screen.getByText("총 Evidence")).toBeVisible()
    expect(screen.getByText("분석 대상")).toBeVisible()
    expect(screen.getByText("검토 대기")).toBeVisible()
    expect(screen.getByText("활성 세션")).toBeVisible()
    expect(screen.getByRole("img", { name: "HUMAN, ZAP, LLM Evidence 수집 추이" })).toBeVisible()
    expect(screen.getByRole("heading", { name: "Evidence 수집 현황" })).toBeVisible()
    expect(screen.getByRole("progressbar", { name: "HUMAN Evidence 1건" })).toBeVisible()
    expect(screen.getByRole("heading", { name: "트래픽 분류 분포" })).toBeVisible()
    expect(screen.getByRole("progressbar", { name: "INCLUDE Evidence 11건" })).toBeVisible()
    expect(screen.getByRole("heading", { name: "최근 Evidence" })).toBeVisible()
    expect(screen.getByText("/identity/api/v2/user/dashboard")).toBeVisible()
    expect(screen.getByText("/community/api/v2/community/posts/recent")).toBeVisible()
  })

  it("shows the LLM lane and excludes unknown-source activity from the three-way dashboard", async () => {
    const llmEvent = { ...representativeSnapshot.events[0], eventId: "llm-1", source: "llm" as const, path: "/llm-only", timestamp: 1_700_000_120_000 }
    const unknownEvent = { ...representativeSnapshot.events[0], eventId: "unknown-1", source: "unknown" as const, path: "/unknown-only", timestamp: 1_700_000_180_000 }
    renderDashboard({ ...representativeSnapshot, events: [...representativeSnapshot.events, llmEvent, unknownEvent] })

    await screen.findByRole("heading", { name: "보안 점검 대시보드" })
    expect(screen.getByText(/L · LLM/)).toBeVisible()
    expect(screen.queryByText(/LLM Explorer/)).not.toBeInTheDocument()
    expect(screen.getByText("/llm-only")).toBeVisible()
    expect(screen.queryByText("/unknown-only")).not.toBeInTheDocument()
  })

  it("does not fabricate operational zero or connected states when HUMAN and scanner queries fail", async () => {
    renderDashboard(representativeSnapshot, false, false, true)

    await screen.findByRole("heading", { name: "보안 점검 대시보드" })
    await waitFor(() => {
      expect(screen.getByLabelText("HUMAN 상태")).toHaveTextContent("확인 불가")
      expect(screen.getByLabelText("SCANNER 상태")).toHaveTextContent("확인 불가")
    }, { timeout: 3_000 })
    expect(screen.getAllByText("사용 불가").length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText("미실행")).not.toBeInTheDocument()
  })

  it("routes the recommended HUMAN action to inspection", async () => {
    const user = userEvent.setup()
    renderDashboard({ ...representativeSnapshot, gaps: [], activeSources: ["scanner"] })

    const action = await screen.findByRole("button", { name: /다음 권장 작업: HUMAN 탐색을 시작하세요/ })
    await user.click(action)
    expect(window.location.hash).toBe("#inspection")
  })

  it("keeps a gap recommendation label and destination aligned when a source is inactive", async () => {
    const user = userEvent.setup()
    renderDashboard({ ...representativeSnapshot, activeSources: ["scanner"] })

    const action = await screen.findByRole("button", { name: /다음 권장 작업: 갭을 검토하세요/ })
    await user.click(action)
    expect(window.location.hash).toBe("#evidence")
  })

  it("shows empty onboarding, loads a sample, and requires confirmation before clearing", async () => {
    const user = userEvent.setup()
    const fetchStub = renderDashboard(snapshotFixture)

    await screen.findByText("첫 점검을 시작하세요")
    expect(screen.getByRole("button", { name: "빠른 시작" })).toBeVisible()
    expect(screen.getByRole("button", { name: "샘플로 화면 익히기" })).toBeVisible()
    expect(screen.queryByText("갭 요약")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "샘플로 화면 익히기" }))
    await waitFor(() => expect(fetchStub).toHaveBeenCalledWith("/api/sample", expect.objectContaining({ method: "POST" })))

    await user.click(screen.getByRole("button", { name: "트래픽 초기화" }))
    expect(fetchStub).not.toHaveBeenCalledWith("/api/clear", expect.anything())
    expect(screen.getByRole("alertdialog", { name: "트래픽을 초기화할까요?" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "초기화" }))
    await waitFor(() => expect(fetchStub).toHaveBeenCalledWith("/api/clear", expect.objectContaining({ method: "POST" })))
  })

  it("announces loading and lets the user recover from a snapshot error", async () => {
    const user = userEvent.setup()
    renderDashboard(representativeSnapshot, true)

    expect(screen.getByRole("status", { name: "데이터를 불러오는 중" })).toBeVisible()
    expect(await screen.findByRole("alert", { name: "스냅샷을 가져올 수 없습니다." }, { timeout: 3_000 })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "다시 시도" }))
    expect(await screen.findByText("수집 18건")).toBeVisible()
  })

  it("shows Korean top-bar loading and terminal-unavailable states", async () => {
    capabilityMeta()
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})))
    const loadingView = renderWithQueryClient(<App />, createTestQueryClient())

    expect(screen.getByLabelText("LIVE 상태")).toHaveTextContent("불러오는 중")
    expect(screen.getByLabelText("HUMAN 상태")).toHaveTextContent("불러오는 중")

    loadingView.unmount()
    document.head.querySelector('meta[name="flowscope-capability"]')?.remove()
    vi.unstubAllGlobals()
    renderDashboard(representativeSnapshot, true)
    await waitFor(() => expect(screen.getByLabelText("LIVE 상태")).toHaveTextContent("확인 불가"), { timeout: 3_000 })
  })

  it("shows both terminal-unavailable and still-pending top-bar query states", async () => {
    capabilityMeta()
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/api/snapshot") return Promise.resolve(response({ success: false, message: "스냅샷을 가져올 수 없습니다." }, 503))
      if (path === "/api/human-run") return new Promise<Response>(() => {})
      if (path === "/api/zap-status") return Promise.resolve(response({ connected: true, state: "READY", message: "ZAP 연결됨" }))
      if (path === "/api/scanner-run") return Promise.resolve(response({ run: { status: "IDLE" }, scope: [] }))
      return Promise.resolve(response({ run: { status: "IDLE", providers: { CODEX: true, CLAUDE: true } }, scope: [], completed_lanes: [] }))
    }))
    renderWithQueryClient(<App />, createTestQueryClient())

    await waitFor(() => expect(screen.getByLabelText("LIVE 상태")).toHaveTextContent("확인 불가"), { timeout: 3_000 })
    expect(screen.getByLabelText("HUMAN 상태")).toHaveTextContent("불러오는 중")
  })

  it("retains dashboard values after a failed background snapshot poll and marks the stale state", async () => {
    vi.useFakeTimers()
    renderDashboard(representativeSnapshot, false, true)

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText("수집 18건")).toBeVisible()
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })

    expect(screen.getByText("수집 18건")).toBeVisible()
    expect(screen.getByText("총 Evidence")).toBeVisible()
    expect(screen.getByRole("alert", { name: "스냅샷을 가져올 수 없습니다." })).toHaveTextContent("마지막 데이터를 표시하고 있습니다.")
    expect(screen.queryByText("첫 점검을 시작하세요")).not.toBeInTheDocument()
    expect(screen.queryByRole("status", { name: "데이터를 불러오는 중" })).not.toBeInTheDocument()
  })

  it("keeps the reference status and route rail available below 900px", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      addEventListener: vi.fn(), dispatchEvent: vi.fn(), matches: true, media: "(max-width: 899px)", onchange: null, removeEventListener: vi.fn(),
    }))
    renderDashboard()

    expect(await screen.findByRole("banner", { name: "FlowScope 상단 상태" })).toBeVisible()
    expect(screen.getByRole("navigation", { name: "주요 분석 탐색" })).toBeVisible()
    expect(screen.getByRole("link", { name: /^FlowScope$/ })).toBeVisible()
    expect(screen.getByRole("button", { name: "대시보드" })).toHaveAttribute("aria-current", "page")
    expect(screen.queryByRole("button", { name: "사이드바 전환" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("link", { name: "점검 시작" }))
    expect(window.location.hash).toBe("#inspection")
    await waitFor(() => expect(screen.getByRole("link", { name: "점검 시작" })).toHaveAttribute("aria-current", "page"))
    expect(screen.getByRole("button", { name: "점검 시작" })).toHaveAttribute("aria-current", "page")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps the dashboard summary and main content without an empty selection inspector", async () => {
    renderDashboard(representativeSnapshot)

    await screen.findByText("Evidence 수집 추이")
    expect(await screen.findByRole("complementary", { name: "분석 필터" })).toHaveTextContent("현재 snapshot 요약")
    expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "선택 상세 열기" })).not.toBeInTheDocument()
    expect(screen.getByText("Evidence 수집 추이")).toBeVisible()
  })

  it.each([900, 600])("keeps dashboard summary and evidence trend reachable without an inspector Sheet at %ipx", async (width) => {
    setCompactViewport(width)
    const user = userEvent.setup()
    renderDashboard()

    await screen.findByText("Evidence 수집 추이")
    const contextTrigger = screen.getByRole("button", { name: "분석 필터 열기" })
    await user.click(contextTrigger)
    const contextDialog = screen.getByRole("dialog", { name: "분석 필터" })
    expect(contextDialog).toHaveTextContent("현재 snapshot 요약")
    await user.click(within(contextDialog).getByRole("button", { name: "Close" }))
    expect(contextTrigger).toHaveFocus()

    expect(screen.queryByRole("button", { name: "선택 상세 열기" })).not.toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "선택 상세" })).not.toBeInTheDocument()
    expect(screen.getByText("Evidence 수집 추이")).toBeVisible()
  })
})
