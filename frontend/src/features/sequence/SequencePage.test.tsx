import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { beforeEach, expect, it, vi } from "vitest"

import type { EventRecord, Snapshot } from "@/lib/api/types"
import { snapshotFixture } from "@/test/fixtures"
import { renderWithQueryClient } from "@/test/render"
import { projectSequence, sequenceLinkKey } from "./sequenceProjection"
import { SequencePage } from "./SequencePage"

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverStub)

let current: Snapshot | undefined
let queryError = false
beforeEach(() => { current = undefined; queryError = false })
vi.mock("@/lib/query/hooks", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/query/hooks")>(),
  useSnapshotQuery: () => ({ data: current, isLoading: current === undefined, isError: queryError, error: new Error("snapshot unavailable"), isStale: true }),
}))
vi.mock("@/features/evidence/RequestLabDialog", () => ({ RequestLabDialog: () => null }))

function regexLiteral(value: string) { return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }

function renderPage(ui: ReactElement) {
  const result = renderWithQueryClient(ui)
  return { ...result, rerender: (next: ReactElement) => result.rerender(<QueryClientProvider client={result.client}>{next}</QueryClientProvider>) }
}

function expectCompleteValuesAbsent(container: HTMLElement, values: readonly string[]) {
  for (const value of values) {
    expect(container.textContent).not.toContain(value)
    for (const button of within(container).queryAllByRole("button")) {
      expect(button).not.toHaveAccessibleName(regexLiteral(value))
      expect(button).not.toHaveAccessibleDescription(regexLiteral(value))
    }
    for (const element of Array.from(container.querySelectorAll("[title], [aria-label], [aria-description], [aria-live]"))) {
      expect(element.getAttribute("title") ?? "").not.toContain(value)
      expect(element.getAttribute("aria-label") ?? "").not.toContain(value)
      expect(element.getAttribute("aria-description") ?? "").not.toContain(value)
      if (element.hasAttribute("aria-live")) expect(element.textContent).not.toContain(value)
    }
  }
}

function event(eventId: string, idn: string, timestamp: number): EventRecord {
  return { eventId, method: "GET", path: `/${eventId}`, status: 200, fp: "fp", idn, role: "USER", source: "human", op: `GET /${eventId}`, resource: null, timestamp, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "run", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: eventId, repeatCount: 1, firstSeen: timestamp, lastSeen: timestamp, clusterEvidenceIds: [eventId], objects: [], verdict: "allow" }
}

function sequenceSnapshot(): Snapshot {
  return {
    ...snapshotFixture,
    revision: 7,
    events: [event("late-from", "alice", 30), event("known-to", "alice", 40), event("early-from", "alice", 10), event("unknown-to", "alice", 0), event("bob-from", "bob", 20), event("bob-to", "bob", 21)],
    flowLinks: [
      { fromEventId: "late-from", toEventId: "known-to", fromOp: "GET /late", toOp: "POST /known", idn: "alice", source: "scanner", values: "masked=***" },
      { fromEventId: "early-from", toEventId: "unknown-to", fromOp: "GET /early", toOp: "POST /unknown", idn: "alice", source: "llm", values: "token=***" },
      { fromEventId: "missing", toEventId: "known-to", fromOp: "GET /missing", toOp: "POST /known", idn: "mallory", source: "human", values: "must-not-render" },
      { fromEventId: "bob-from", toEventId: "bob-to", fromOp: "GET /bob", toOp: "POST /bob", idn: "bob", source: "human", values: "id=***" },
    ],
  }
}

it("orders known producer timestamps chronologically while retaining stable link order for unknown/equal time and partitions by observed link identity", () => {
  const projection = projectSequence(sequenceSnapshot())
  expect(projection.groups.map((group) => group.identity)).toEqual(["alice", "bob"])
  expect(projection.groups[0]?.links.map((link) => link.link.fromOp)).toEqual(["GET /early", "GET /late"])
  expect(projection.groups.flatMap((group) => group.links).map((link) => link.link.values)).not.toContain("must-not-render")
})

it("keeps deterministic server links in the reference workspace and reserves an inspector", async () => {
  current = sequenceSnapshot()
  renderPage(<SequencePage />)

  expect(await screen.findByRole("complementary", { name: "분석 필터" })).toBeVisible()
  expect(screen.getByRole("region", { name: "흐름 순서 분석 영역" })).toBeVisible()
  expect(screen.getByRole("complementary", { name: "선택 상세" })).toBeVisible()
})

it("uses a total timestamp order: known producers first, then ascending time, then stable original order for equal and unknown timestamps", () => {
  const value = sequenceSnapshot()
  const unknownFrom = event("unknown-from", "alice", 0)
  const unknownTo = event("unknown-consumer", "alice", 0)
  const equalFrom = event("equal-from", "alice", 10)
  const equalTo = event("equal-to", "alice", 11)
  const snapshot: Snapshot = { ...value, events: [...value.events, unknownFrom, unknownTo, equalFrom, equalTo], flowLinks: [
    value.flowLinks[0],
    { fromEventId: "unknown-from", toEventId: "unknown-consumer", fromOp: "GET /unknown", toOp: "POST /unknown", idn: "alice", source: "human", values: "unknown" },
    value.flowLinks[1],
    { fromEventId: "equal-from", toEventId: "equal-to", fromOp: "GET /equal", toOp: "POST /equal", idn: "alice", source: "human", values: "equal" },
  ] }
  expect(projectSequence(snapshot).groups[0]?.links.map((entry) => entry.link.fromOp)).toEqual(["GET /early", "GET /equal", "GET /late", "GET /unknown"])
})

it("assigns equal-signature links distinct occurrence keys that survive unrelated link reordering", () => {
  const value = sequenceSnapshot()
  const duplicate = { ...value.flowLinks[0] }
  const withDuplicates: Snapshot = { ...value, flowLinks: [value.flowLinks[0], duplicate, value.flowLinks[1], value.flowLinks[3]] }
  const before = projectSequence(withDuplicates).groups[0]?.links.filter((entry) => entry.link.fromOp === "GET /late").map((entry) => entry.key)
  const reordered: Snapshot = { ...withDuplicates, flowLinks: [value.flowLinks[3], value.flowLinks[1], value.flowLinks[0], duplicate] }
  const after = projectSequence(reordered).groups.find((group) => group.identity === "alice")?.links.filter((entry) => entry.link.fromOp === "GET /late").map((entry) => entry.key)
  expect(before).toEqual([sequenceLinkKey(value.flowLinks[0], 0), sequenceLinkKey(value.flowLinks[0], 1)])
  expect(after).toEqual(before)
  expect(new Set(before).size).toBe(2)
})

it("renders only server flow links with source/operation/masked values, auxiliary notice, and exact structured Evidence selection", async () => {
  current = sequenceSnapshot()
  renderPage(<SequencePage />)
  expect(await screen.findByText("데이터 의존 링크는 보조 정보이며 coverage 또는 IDOR/권한 판정을 변경하지 않습니다.")).toBeVisible()
  const aliceTimeline = screen.getAllByRole("region", { name: "데이터 의존 타임라인" })[0]
  expect(within(aliceTimeline).getAllByText("1. 생산")).toHaveLength(2)
  expect(within(aliceTimeline).getAllByText("2. 전달 값")).toHaveLength(2)
  expect(within(aliceTimeline).getAllByText("3. 소비")).toHaveLength(2)
  expect(within(aliceTimeline).getByText("GET /early")).toBeVisible()
  expect(within(aliceTimeline).getByText("POST /unknown")).toBeVisible()
  expect(screen.getByText("H · HUMAN · 실선")).toHaveClass("border-solid")
  expect(screen.getByText("S · SCANNER · 파선")).toHaveClass("border-dashed")
  expect(screen.getByText("L · LLM · 점선")).toHaveClass("border-dotted")
  expect(screen.getByText(/token=\*{3}/)).toBeVisible()
  expect(screen.queryByText("must-not-render")).not.toBeInTheDocument()
  expect(screen.queryByText("이전 snapshot을 표시 중입니다.")).not.toBeInTheDocument()
  const link = screen.getAllByRole("button", { name: "흐름 링크 Evidence 열기" })[0]
  expect(link).not.toHaveAccessibleName(/early-from|unknown-to/)
  await userEvent.click(link)
  expect(await screen.findByText("from: early-from · to: unknown-to")).toBeVisible()
})

it("keeps a selected server link through presentation rerender and clears it when either endpoint or the link disappears", async () => {
  current = sequenceSnapshot()
  const { rerender } = renderPage(<SequencePage />)
  await userEvent.click((await screen.findAllByRole("button", { name: "흐름 링크 Evidence 열기" }))[0])
  current = { ...sequenceSnapshot(), revision: 8 }
  rerender(<SequencePage />)
  expect(await screen.findByText("from: early-from · to: unknown-to")).toBeVisible()
  current = { ...sequenceSnapshot(), revision: 9, events: sequenceSnapshot().events.filter((item) => item.eventId !== "unknown-to") }
  rerender(<SequencePage />)
  await waitFor(() => expect(screen.queryByText("Evidence 상세")).not.toBeInTheDocument())
})

it("retains an open link detail but suspends its actions during a refresh failure", async () => {
  current = sequenceSnapshot()
  const { rerender } = renderPage(<SequencePage />)
  await userEvent.click((await screen.findAllByRole("button", { name: "흐름 링크 Evidence 열기" }))[0])
  queryError = true
  rerender(<SequencePage />)
  expect(screen.getByText("from: early-from · to: unknown-to")).toBeVisible()
  expect(screen.getByRole("button", { name: "요청 수정·전송 (Request Lab)" })).toBeDisabled()
})

it("retains a selected link when an unrelated earlier link is inserted and only uses an occurrence among equal link signatures", async () => {
  current = sequenceSnapshot()
  const { rerender } = renderPage(<SequencePage />)
  await userEvent.click((await screen.findAllByRole("button", { name: "흐름 링크 Evidence 열기" }))[0])
  const extraFrom = event("extra-from", "alice", 5)
  const extraTo = event("extra-to", "alice", 6)
  current = { ...sequenceSnapshot(), revision: 10, events: [extraFrom, extraTo, ...sequenceSnapshot().events], flowLinks: [{ fromEventId: "extra-from", toEventId: "extra-to", fromOp: "GET /extra", toOp: "POST /extra", idn: "alice", source: "human", values: "extra" }, ...sequenceSnapshot().flowLinks] }
  rerender(<SequencePage />)
  expect(await screen.findByText("from: early-from · to: unknown-to")).toBeVisible()
})

it("retains a selected link when unrelated links are reordered", async () => {
  current = sequenceSnapshot()
  const { rerender } = renderPage(<SequencePage />)
  await userEvent.click((await screen.findAllByRole("button", { name: "흐름 링크 Evidence 열기" }))[0])
  const value = sequenceSnapshot()
  current = { ...value, revision: 11, flowLinks: [value.flowLinks[3], value.flowLinks[2], value.flowLinks[0], value.flowLinks[1]] }
  rerender(<SequencePage />)
  expect(await screen.findByText("from: early-from · to: unknown-to")).toBeVisible()
})

it("escapes and bounds a long markup-like masked value until it is explicitly expanded", async () => {
  const longValue = `<img src=x onerror=alert(1)>${"v".repeat(220)}`
  const value = sequenceSnapshot()
  current = { ...value, flowLinks: [{ ...value.flowLinks[1], values: longValue }] }
  renderPage(<SequencePage />)
  expect(await screen.findByRole("button", { name: "값 더 보기" })).toBeVisible()
  expect(screen.queryByRole("img")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "값 더 보기" }))
  expect(screen.getByRole("button", { name: "값 접기" })).toBeVisible()
  expect(document.body.textContent).toContain(longValue)
})

it("bounds selected long sequence context until the operator explicitly expands escaped text", async () => {
  const longFrom = `<sequence-from>${"f".repeat(220)}</sequence-from>`
  const longTo = `<sequence-to>${"t".repeat(220)}</sequence-to>`
  const value = sequenceSnapshot()
  current = { ...value, flowLinks: [{ ...value.flowLinks[1], fromOp: longFrom, toOp: longTo }] }
  renderPage(<SequencePage />)
  await userEvent.click(await screen.findByRole("button", { name: "흐름 링크 Evidence 열기" }))
  expect(document.body.textContent).not.toContain(longFrom)
  expect(await screen.findByRole("button", { name: "선택 상세 더 보기" })).toBeVisible()
  expect(screen.queryByRole("sequence-from")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "선택 상세 더 보기" }))
  expect(document.body.textContent).toContain(longFrom)
  expect(document.body.textContent).toContain(longTo)
})

it("bounds every selected sequence coordinate field until the operator expands escaped text", async () => {
  const longIdentity = `<sequence-identity>${"i".repeat(220)}</sequence-identity>`
  const value = sequenceSnapshot()
  current = { ...value, flowLinks: [{ ...value.flowLinks[1], idn: longIdentity }] }
  renderPage(<SequencePage />)
  await userEvent.click(await screen.findByRole("button", { name: "흐름 링크 Evidence 열기" }))
  const detail = screen.getByText("흐름 링크 선택").closest("section")
  expect(detail?.textContent).not.toContain(longIdentity)
  expect(screen.queryByRole("sequence-identity")).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole("button", { name: "선택 상세 더 보기" }))
  expect(detail?.textContent).toContain(longIdentity)
})

it("keeps long markup-like endpoint IDs private across the entire Sheet until expanded, then hides them again on collapse", async () => {
  const longFrom = `<sequence-from data-probe="from">${"f".repeat(220)}</sequence-from>`
  const longTo = `<sequence-to data-probe="to">${"t".repeat(220)}</sequence-to>`
  const fromEvent = { ...event(longFrom, "alice", 10), path: "/safe-from", op: "GET /safe-from" }
  const toEvent = { ...event(longTo, "alice", 11), path: "/safe-to", op: "POST /safe-to" }
  const value = sequenceSnapshot()
  current = {
    ...value,
    events: [fromEvent, toEvent],
    flowLinks: [{ fromEventId: longFrom, toEventId: longTo, fromOp: fromEvent.op, toOp: toEvent.op, idn: "alice", source: "human", values: "masked=***" }],
  }
  renderPage(<SequencePage />)
  await userEvent.click(await screen.findByRole("button", { name: "흐름 링크 Evidence 열기" }))

  const sheet = await screen.findByRole("complementary", { name: "선택 상세" })
  expectCompleteValuesAbsent(sheet, [longFrom, longTo])
  expect(sheet.querySelector("sequence-from")).not.toBeInTheDocument()
  expect(sheet.querySelector("sequence-to")).not.toBeInTheDocument()
  expect(screen.getByRole("tabpanel", { name: "트래픽" })).toHaveTextContent("GET /safe-from")
  expect(screen.getByRole("button", { name: "요청 수정·전송 (Request Lab)" })).toBeVisible()
  expect(screen.getByText(/Repeater 열기는 전송이 아닙니다/)).toBeVisible()

  await userEvent.click(screen.getByRole("button", { name: "선택 상세 더 보기" }))
  expect(sheet.textContent).toContain(longFrom)
  expect(sheet.textContent).toContain(longTo)
  expect(sheet.querySelector("sequence-from")).not.toBeInTheDocument()
  expect(sheet.querySelector("sequence-to")).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: "선택 상세 접기" }))
  expectCompleteValuesAbsent(sheet, [longFrom, longTo])
})

it.each([900, 600])("keeps sequence context filtering and selected-link inspection functional at compact %ipx", async (width) => {
  const previousMatchMedia = window.matchMedia
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("1279") && width < 1280, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true })) as unknown as typeof window.matchMedia
  current = sequenceSnapshot()
  const user = userEvent.setup()
  renderPage(<SequencePage />)

  const contextTrigger = screen.getByRole("button", { name: "분석 필터 열기" })
  const inspectorTrigger = screen.getByRole("button", { name: "선택 상세 열기" })
  await user.click(contextTrigger)
  const context = screen.getByRole("dialog", { name: "분석 필터" })
  await user.selectOptions(within(context).getByRole("combobox", { name: "신원 필터" }), "bob")
  await user.click(within(context).getByRole("button", { name: "Close" }))
  expect(contextTrigger).toHaveFocus()
  expect(screen.queryByText("alice")).not.toBeInTheDocument()
  expect(screen.getByText("bob")).toBeVisible()

  await user.click(inspectorTrigger)
  expect(screen.getByRole("dialog", { name: "선택 상세" })).toHaveTextContent("분석 결과에서 항목을 선택하면")
  await user.click(within(screen.getByRole("dialog", { name: "선택 상세" })).getByRole("button", { name: "Close" }))
  expect(inspectorTrigger).toHaveFocus()
  await user.click(screen.getByRole("button", { name: "흐름 링크 Evidence 열기" }))
  const inspector = await screen.findByRole("dialog", { name: "선택 상세" })
  expect(within(inspector).getByText("흐름 링크 선택")).toBeVisible()
  await user.click(within(inspector).getByRole("button", { name: "Close" }))
  expect(screen.queryByText("흐름 링크 선택")).not.toBeInTheDocument()
  expect(inspectorTrigger).toHaveFocus()
  window.matchMedia = previousMatchMedia
})

it("retains a selected equal-signature occurrence through unrelated reordering and clears it when that occurrence disappears", async () => {
  const value = sequenceSnapshot()
  const firstDuplicate = { ...value.flowLinks[0] }
  const selectedDuplicate = { ...value.flowLinks[0] }
  current = { ...value, flowLinks: [firstDuplicate, selectedDuplicate, value.flowLinks[1], value.flowLinks[3]] }
  const { rerender } = renderPage(<SequencePage />)
  await userEvent.click((await screen.findAllByRole("button", { name: "흐름 링크 Evidence 열기" }))[2])
  expect(await screen.findByText("from: late-from · to: known-to")).toBeVisible()
  const extraFrom = event("extra-from", "alice", 5)
  const extraTo = event("extra-to", "alice", 6)
  current = { ...current, revision: 12, events: [extraFrom, extraTo, ...value.events], flowLinks: [value.flowLinks[3], { fromEventId: "extra-from", toEventId: "extra-to", fromOp: "GET /extra", toOp: "POST /extra", idn: "alice", source: "human", values: "extra" }, value.flowLinks[1], firstDuplicate, selectedDuplicate] }
  rerender(<SequencePage />)
  expect(await screen.findByText("from: late-from · to: known-to")).toBeVisible()
  current = { ...current, revision: 13, flowLinks: current.flowLinks.filter((link) => link !== selectedDuplicate) }
  rerender(<SequencePage />)
  await waitFor(() => expect(screen.queryByText("Evidence 상세")).not.toBeInTheDocument())
})

it("states loading and empty server link outcomes", async () => {
  queryError = false
  current = undefined
  const { rerender } = renderPage(<SequencePage />)
  expect(screen.getByText("흐름 순서를 불러오는 중입니다.")).toBeVisible()
  current = { ...snapshotFixture, events: [event("one", "alice", 1)] }
  rerender(<SequencePage />)
  expect(await screen.findByText("표시할 서버 데이터 의존 링크가 없습니다.")).toBeVisible()
})

it("keeps a server-query error separate from an empty flow-link result", () => {
  queryError = true
  current = sequenceSnapshot()
  renderPage(<SequencePage />)
  expect(screen.getByText("흐름 순서를 불러오지 못했습니다.")).toBeVisible()
  expect(screen.getByText("snapshot unavailable")).toBeVisible()
  queryError = false
})
