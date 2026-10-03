import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { App } from "@/app/App"
import { parameterGap } from "@/features/parameter-map/parameterMapFixtures"
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
  surface: { endpoints: [], extractions: [], probes: [], parameterDiagnostics: [], validationCells: [], parameterGaps: [parameterGap("source"), parameterGap("auth", { type: "AUTH_VARIANT_UNTESTED" })] },
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
    if (path === "/api/projects" && (!init || init.method === undefined)) return Promise.resolve(response({ directory: "/tmp/projects", active: null, projects: [] }))
    if (path === "/api/projects") return Promise.resolve(response({ directory: "/tmp/projects", active: { id: "demo", name: "Demo", scope: ["https://demo.flowscope.test"], readable: true }, projects: [{ id: "demo", name: "Demo", scope: ["https://demo.flowscope.test"], readable: true }] }))
    if (path === "/api/sample") return Promise.resolve(response({ success: true, message: "완료" }))
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
  it("explains first use and offers one graph-first primary action with server gap counts", async () => {
    renderDashboard()
    // 목록은 데이터가 온 뒤에만 그려진다(흐름 칸은 로딩 중에도 0으로 보인다).
    await screen.findByRole("region", { name: "우선 점검 API" })
    for (const [label, value] of [["우선 점검 API", "1"], ["미관측 파라미터", "1"], ["권한 변형 미검증", "1"], ["검토 필요 트래픽", "3"]] as const) {
      expect(within(screen.getByRole("group", { name: label })).getByText(value)).toBeVisible()
    }
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+%|취약점 확정/)).not.toBeInTheDocument()
    // 버튼 대신 단계 칸 전체가 해당 화면으로 가는 링크다.
    expect(screen.getByRole("link", { name: "비교 · Gap 그래프" })).toHaveAttribute("href", "#graph")
    expect(screen.queryByRole("button", { name: "Gap 그래프에서 확인" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "점검 Gap 그래프" })).toHaveAttribute("href", "#graph")
  })

  it("exposes the grouped sidebar route set and normalizes unsafe hashes to home", async () => {
    const user = userEvent.setup()
    renderDashboard()

    await screen.findByRole("heading", { name: "보안 점검 대시보드" })
    expect(screen.queryByRole("banner", { name: "FlowScope 상단 상태" })).not.toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "FlowScope 전역 탐색" })).toBeVisible()
    expect(screen.getByRole("link", { name: "FlowScope 홈으로 이동" })).toHaveAttribute("href", "#home")
    expect(screen.queryByRole("link", { name: "대시보드" })).not.toBeInTheDocument()
    const routes = [
      ["점검 시작", "inspection", null], ["계정·세션", "accounts", null], ["점검 Gap 그래프", "graph", null],
      ["권한 매트릭스", "matrix", null],
      ["API·입력 차이", "surface", "부가 기능"], ["교차 신원 검증", "verification", "부가 기능"], ["관측 기록", "evidence", "부가 기능"],
    ] as const

    for (const [label, route, group] of routes) {
      if (group && screen.getByRole("button", { name: group }).getAttribute("aria-expanded") === "false") {
        await user.click(screen.getByRole("button", { name: group }))
      }
      const link = screen.getByRole("link", { name: label })
      expect(link).toHaveAttribute("href", `#${route}`)
      await user.click(link)
      expect(window.location.hash).toBe(`#${route}`)
    }
    const nav = screen.getByRole("navigation", { name: "FlowScope 전역 탐색" })
    expect(within(nav).queryByRole("link", { name: "취약점 시나리오" })).not.toBeInTheDocument()
    expect(within(nav).queryByRole("link", { name: "실행 상태" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "흐름 순서" })).not.toBeInTheDocument()

    for (const unsafeHash of ["#", "#unknown", "#/assets/evil.js", "#%2Fassets%2Fevil.js"]) {
      window.location.hash = unsafeHash
      window.dispatchEvent(new HashChangeEvent("hashchange"))
      await waitFor(() => expect(window.location.hash).toBe("#home"))
    }
    window.history.pushState(null, "", "#runs")
    window.dispatchEvent(new PopStateEvent("popstate"))
    await waitFor(() => expect(screen.getByRole("heading", { name: "실행 상태" })).toBeVisible())
    window.history.pushState(null, "", "#dashboard")
    window.dispatchEvent(new PopStateEvent("popstate"))
    await waitFor(() => expect(screen.getByRole("heading", { name: "보안 점검 대시보드" })).toBeVisible())
  }, 15_000)

  it("does not fabricate operational zero or connected states when HUMAN and scanner queries fail", async () => {
    renderDashboard(representativeSnapshot, false, false, true)

    await screen.findByRole("heading", { name: "보안 점검 대시보드" })
    await userEvent.click(screen.getByRole("button", { name: "실시간 상태" }))
    await waitFor(() => {
      expect(screen.getByLabelText("HUMAN 상태")).toHaveTextContent("확인 불가")
      expect(screen.getByLabelText("SCANNER 상태")).toHaveTextContent("확인 불가")
    }, { timeout: 3_000 })
    expect(screen.queryByText("미실행")).not.toBeInTheDocument()
  })

  it("keeps onboarding on Home and lets a new project start only after its scope is entered", async () => {
    const user = userEvent.setup()
    const fetchStub = renderDashboard(snapshotFixture)

    await screen.findByRole("heading", { name: "보안 점검 대시보드" })
    // 온보딩·샘플 블록은 제거됐다(빈 상태 안내는 Home hero가 담당).
    expect(screen.queryByText("첫 점검을 시작하세요")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "샘플로 화면 익히기" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "프로젝트 관리" }))
    const dialog = screen.getByRole("dialog", { name: "프로젝트 관리" })
    await user.click(within(dialog).getByRole("tab", { name: "새 프로젝트" }))
    expect(within(dialog).getByRole("button", { name: "프로젝트 만들고 열기" })).toBeDisabled()
    expect(fetchStub).not.toHaveBeenCalledWith("/api/clear", expect.anything())
  })

  it("announces loading and lets the user recover from a snapshot error", async () => {
    const user = userEvent.setup()
    renderDashboard(representativeSnapshot, true)

    expect(screen.getByRole("status", { name: "데이터를 불러오는 중" })).toBeVisible()
    expect(await screen.findByRole("alert", { name: "스냅샷을 가져올 수 없습니다." }, { timeout: 3_000 })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "다시 시도" }))
    expect(await screen.findByRole("group", { name: "검토 필요 트래픽" })).toBeVisible()
  })

  it("shows Korean live-status loading and terminal-unavailable states", async () => {
    capabilityMeta()
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})))
    const loadingView = renderWithQueryClient(<App />, createTestQueryClient())

    await userEvent.click(screen.getByRole("button", { name: "실시간 상태" }))
    expect(screen.getByLabelText("LIVE 상태")).toHaveTextContent("불러오는 중")
    expect(screen.getByLabelText("HUMAN 상태")).toHaveTextContent("불러오는 중")

    loadingView.unmount()
    document.head.querySelector('meta[name="flowscope-capability"]')?.remove()
    vi.unstubAllGlobals()
    renderDashboard(representativeSnapshot, true)
    await userEvent.click(screen.getByRole("button", { name: "실시간 상태" }))
    await waitFor(() => expect(screen.getByLabelText("LIVE 상태")).toHaveTextContent("확인 불가"), { timeout: 3_000 })
  })

  it("shows both terminal-unavailable and still-pending live-status query states", async () => {
    capabilityMeta()
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/api/snapshot") return Promise.resolve(response({ success: false, message: "스냅샷을 가져올 수 없습니다." }, 503))
      if (path === "/api/human-run") return new Promise<Response>(() => {})
      if (path === "/api/zap-status") return Promise.resolve(response({ connected: true, state: "READY", message: "ZAP 연결됨" }))
      if (path === "/api/scanner-run") return Promise.resolve(response({ run: { status: "IDLE" }, scope: [] }))
      if (path === "/api/projects") return Promise.resolve(response({ directory: "/tmp/projects", active: null, projects: [] }))
      return Promise.resolve(response({ run: { status: "IDLE", providerReadiness: "READY", model: "" }, accounts: [], scope: [] }))
    }))
    renderWithQueryClient(<App />, createTestQueryClient())

    await userEvent.click(screen.getByRole("button", { name: "실시간 상태" }))
    await waitFor(() => expect(screen.getByLabelText("LIVE 상태")).toHaveTextContent("확인 불가"), { timeout: 3_000 })
    expect(screen.getByLabelText("HUMAN 상태")).toHaveTextContent("불러오는 중")
  })

  it("retains dashboard values after a failed background snapshot poll and marks the stale state", async () => {
    vi.useFakeTimers()
    renderDashboard(representativeSnapshot, false, true)

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByRole("group", { name: "검토 필요 트래픽" })).toHaveTextContent("3")
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })

    expect(screen.getByRole("group", { name: "검토 필요 트래픽" })).toHaveTextContent("3")
    expect(screen.getByRole("alert", { name: "스냅샷을 가져올 수 없습니다." })).toHaveTextContent("마지막 데이터를 표시하고 있습니다.")
    expect(screen.queryByText("첫 점검을 시작하세요")).not.toBeInTheDocument()
    expect(screen.queryByRole("status", { name: "데이터를 불러오는 중" })).not.toBeInTheDocument()
  })

  it("keeps the reference status and mobile sidebar available below 900px", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      addEventListener: vi.fn(), dispatchEvent: vi.fn(), matches: true, media: "(max-width: 899px)", onchange: null, removeEventListener: vi.fn(),
    }))
    renderDashboard()

    await user.click(await screen.findByRole("button", { name: "메뉴 열기" }))
    expect(screen.getAllByRole("navigation", { name: "FlowScope 전역 탐색" })).toHaveLength(2)
    await user.click(within(screen.getAllByRole("navigation", { name: "FlowScope 전역 탐색" }).at(-1)!).getByRole("link", { name: "점검 시작" }))
    expect(window.location.hash).toBe("#inspection")
    await waitFor(() => expect(screen.getByRole("button", { name: "메뉴 열기" })).toBeVisible())
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps the dashboard summary and main content without an empty selection inspector", async () => {
    renderDashboard(representativeSnapshot)

    await screen.findByRole("link", { name: "비교 · Gap 그래프" })
    expect(screen.queryByRole("complementary", { name: "분석 필터" })).not.toBeInTheDocument()
    expect(screen.getByLabelText("현재 snapshot 요약")).toBeVisible()
    expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "선택 상세 열기" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "비교 · Gap 그래프" })).toBeVisible()
  })

  it.each([900, 600])("keeps dashboard summary and graph entry reachable without an inspector Sheet at %ipx", async (width) => {
    setCompactViewport(width)
    renderDashboard()

    await screen.findByRole("link", { name: "비교 · Gap 그래프" })
    expect(screen.queryByRole("button", { name: "분석 필터 열기" })).not.toBeInTheDocument()
    expect(screen.getByLabelText("현재 snapshot 요약")).toBeVisible()

    expect(screen.queryByRole("button", { name: "선택 상세 열기" })).not.toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "선택 상세" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "비교 · Gap 그래프" })).toBeVisible()
  })
})
