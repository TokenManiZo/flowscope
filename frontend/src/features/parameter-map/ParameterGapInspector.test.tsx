import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { renderWithQueryClient } from "@/test/render"
import type { EventRecord, Snapshot, SurfaceObservation, SurfaceParameter, SurfaceParameterGap, SurfaceValidationCell } from "@/lib/api/types"
import { actualEvent, demoEndpoint, demoEndpointKey, demoOperation, demoResource, parameterSnapshot, statusParameter, surfaceSnapshot, validationCell } from "./parameterMapFixtures"
import { defaultParameterFilters, projectParameterMap } from "./parameterProjection"
import { ParameterGapInspector } from "./ParameterGapInspector"

afterEach(() => vi.unstubAllGlobals())
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
const gaps = (): readonly SurfaceParameterGap[] => parameterSnapshot().surface!.parameterGaps ?? []
const observation = (evidenceId: string): SurfaceObservation => ({ evidenceId, source: "HUMAN", runId: "run", identity: evidenceId, status: 200, shape: "STRING" })
const event = (eventId: string, extra: Partial<EventRecord> = {}): EventRecord => actualEvent({ eventId, idn: eventId, resource: null, verdict: "undecided", ...extra })

interface Options { parameter?: Partial<SurfaceParameter>; cells?: readonly SurfaceValidationCell[]; events?: readonly EventRecord[]; gaps?: readonly SurfaceParameterGap[] }

/** PR#11 fixture on our surface contract: observed Evidence on the shared status input, one foreign event, one server cell. */
function actualSnapshot(observed: readonly string[] = ["observed-a", "observed-b"], options: Options = {}): Snapshot {
  const parameter = statusParameter({ observationEvidenceIds: [...observed], observations: observed.map(observation), ...options.parameter })
  return surfaceSnapshot({ endpoints: [demoEndpoint([parameter])], gaps: options.gaps ?? gaps(), cells: options.cells ?? [validationCell()], events: options.events ?? [...observed, "foreign"].map(id => event(id)), owners: { [demoResource]: "USER B" } })
}
const propsFor = (snapshot: Snapshot, gapId = "auth") => ({ snapshot, projection: projectParameterMap(snapshot, defaultParameterFilters, gapId), onClose: () => undefined })

const rowIds = () => within(screen.getByRole("region", { name: "관측 기록" })).getAllByRole("listitem").map(row => row.getAttribute("aria-label"))

it("shows the selected input and lists only actual 관측 기록 of that exact operation", () => {
  const cell = validationCell({ evidenceIds: ["cell-actual"], basisEvidenceIds: ["basis-only"] })
  const snapshot = actualSnapshot(["observed-a", "observed-b"], { cells: [cell], events: [
    event("observed-a", { timestamp: 1 }), event("observed-b", { timestamp: 3 }), event("cell-actual", { timestamp: 2 }), event("basis-only"),
    event("foreign"), event("other-method", { method: "GET" }), event("observed-a-copy-other-op", { op: `${demoEndpointKey.service} PATCH /elsewhere` }),
  ] })
  renderWithQueryClient(<ParameterGapInspector {...propsFor(snapshot)} />)
  const panel = screen.getByRole("region", { name: "Parameter Gap 상세" })
  expect(within(panel).getByRole("heading", { level: 2 })).toHaveTextContent("PATCH /orders/{id}")
  expect(panel).not.toHaveTextContent("왜 집중해야 하나요?")
  expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  // 최신 Evidence가 먼저 오고, 좌표 근거만 있는 ID·다른 operation·연결되지 않은 이벤트는 목록에 없다.
  // 관측 기록은 신원별 카드로 묶인다. 이 픽스처는 요청마다 신원이 달라 카드도 요청 수만큼 나온다.
  expect(rowIds()).toEqual(["observed-b 관측 기록 1건", "cell-actual 관측 기록 1건", "observed-a 관측 기록 1건"])
})

it("opens the read-only raw request from a row without sending anything", async () => {
  const fetch = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(json(String(input) === "/api/manual-attempts" ? [] : { eventId: "observed-a", service: demoEndpointKey.service, request: "MASKED-REQUEST", response: "MASKED-RESPONSE", rawRequestRetained: true, rawResponseRetained: true, requestEditable: false, requestCharset: "UTF-8", responseCharset: "UTF-8", observedIdentity: "observed-a", reusableSession: "none", message: "draft" })))
  vi.stubGlobal("fetch", fetch)
  const { client } = renderWithQueryClient(<ParameterGapInspector {...propsFor(actualSnapshot(["observed-a"]))} />)
  await userEvent.click(screen.getByRole("button", { name: "Request Lab에서 보내기" }))
  expect(await screen.findByLabelText("Request Lab 응답 원문")).toHaveValue("MASKED-RESPONSE")
  expect(screen.getByRole("button", { name: "요청 재전송" })).toBeDisabled()
  // 초안과 검증 이력 조회(GET)만 있고 전송(POST)은 없다.
  expect(fetch.mock.calls.map(([input]) => String(input))).toContain("/api/request-lab?eventId=observed-a")
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([])
  expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain("MASKED-RESPONSE")
})

it("locks row actions while the snapshot is suspended and shows an empty state without actual 관측 기록", () => {
  const { unmount } = renderWithQueryClient(<ParameterGapInspector {...propsFor(actualSnapshot(["observed-a"]))} suspended />)
  expect(screen.getByRole("button", { name: "Request Lab에서 보내기" })).toBeDisabled()
  unmount()
  renderWithQueryClient(<ParameterGapInspector {...propsFor(actualSnapshot([], { events: [] }))} />)
  expect(screen.getByText("연결된 관측 기록이 없습니다.")).toBeVisible()
})
