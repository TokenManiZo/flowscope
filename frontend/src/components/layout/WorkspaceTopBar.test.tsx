import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"

import { WorkspaceTopBar } from "./WorkspaceTopBar"

const queryState = vi.hoisted(() => ({
  snapshot: {} as Record<string, unknown>,
  human: {} as Record<string, unknown>,
  zap: {} as Record<string, unknown>,
  scanner: {} as Record<string, unknown>,
  projects: {} as Record<string, unknown>,
}))
const openProjectMutate = vi.hoisted(() => vi.fn())
const startProjectMutate = vi.hoisted(() => vi.fn())
const resetTrafficMutate = vi.hoisted(() => vi.fn())
const deleteProjectMutate = vi.hoisted(() => vi.fn())

vi.mock("@/lib/query/hooks", () => ({
  useSnapshotQuery: () => queryState.snapshot,
  useHumanRunQuery: () => queryState.human,
  useZapStatusQuery: () => queryState.zap,
  useScannerRunQuery: () => queryState.scanner,
  useProjectsQuery: () => queryState.projects,
  useOpenProjectMutation: () => ({ mutate: openProjectMutate, isPending: false, error: null }),
  useResetProjectTrafficMutation: () => ({ mutate: resetTrafficMutate, isPending: false, error: null }),
  useDeleteProjectMutation: () => ({ mutate: deleteProjectMutate, isPending: false, error: null }),
  useStartProjectMutation: () => ({ mutate: startProjectMutate, isPending: false, error: null }),
}))

beforeEach(() => {
  openProjectMutate.mockReset()
  startProjectMutate.mockReset()
  resetTrafficMutate.mockReset()
  deleteProjectMutate.mockReset()
  queryState.snapshot = { data: { trafficStats: { captured: 7 }, sampleMode: false }, isPending: false, isError: false }
  queryState.human = { data: { active: true, completed: false }, isPending: false, isError: false }
  queryState.zap = { data: { connected: true, state: "READY" }, isPending: false, isError: false }
  queryState.scanner = { data: { run: { status: "RUNNING" }, scope: ["https://app.example.test"] }, isPending: false, isError: false }
  queryState.projects = { data: { directory: "/tmp/projects", active: { id: "app", name: "App", scope: ["https://app.example.test"], readable: true, managed: true }, projects: [{ id: "app", name: "App", scope: ["https://app.example.test"], readable: true, managed: true }, { id: "archive", name: "지난 진단", scope: ["https://old.example.test"], readable: true, managed: true }], saveState: "SAVED", lastSavedAt: "2026-09-10T01:02:03Z", saveError: "" }, isPending: false, isError: false }
})

it("keeps detailed live analysis statuses inside the accessible 상태 popover", async () => {
  render(<WorkspaceTopBar route="dashboard" />)

  expect(screen.getByRole("banner", { name: "FlowScope 상단 상태" })).toBeVisible()
  expect(screen.queryByText("https://app.example.test")).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "상태" }))
  expect(screen.getByText("https://app.example.test")).toBeVisible()
  expect(screen.getByText("LIVE")).toBeVisible()
  expect(screen.getByText("HUMAN")).toBeVisible()
  expect(screen.getByText("ZAP")).toBeVisible()
  expect(screen.queryByLabelText("LLM 상태")).not.toBeInTheDocument()
  expect(screen.getByLabelText("SCOPE 상태")).toHaveTextContent("https://app.example.test")
  expect(screen.getByLabelText("SCOPE READY 상태")).toHaveTextContent("준비됨")
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
})

it("reports each query lane as loading without inventing scope, counts, or waiting runs", async () => {
  for (const key of Object.keys(queryState) as Array<keyof typeof queryState>) queryState[key] = { data: undefined, isPending: true, isError: false }

  render(<WorkspaceTopBar route="dashboard" />)
  await userEvent.click(screen.getByRole("button", { name: "상태" }))

  for (const label of ["SCOPE", "SCOPE READY", "LIVE", "HUMAN", "ZAP", "SCANNER"]) {
    expect(screen.getByLabelText(`${label} 상태`)).toHaveTextContent("불러오는 중")
  }
  expect(screen.queryByText("WAITING")).not.toBeInTheDocument()
  expect(screen.queryByText("등록된 exact scope 없음")).not.toBeInTheDocument()
  expect(screen.getByLabelText("LIVE 상태")).not.toHaveTextContent(/\b0\b/)
})

it("reports unavailable per query lane when no server data exists", async () => {
  for (const key of Object.keys(queryState) as Array<keyof typeof queryState>) queryState[key] = { data: undefined, isPending: false, isError: true }

  render(<WorkspaceTopBar route="dashboard" />)
  await userEvent.click(screen.getByRole("button", { name: "상태" }))

  for (const label of ["SCOPE", "SCOPE READY", "LIVE", "HUMAN", "ZAP", "SCANNER"]) {
    expect(screen.getByLabelText(`${label} 상태`)).toHaveTextContent("확인 불가")
  }
  expect(screen.queryByText("WAITING")).not.toBeInTheDocument()
})

it("keeps cached server values authoritative during refetch failures", async () => {
  for (const key of Object.keys(queryState) as Array<keyof typeof queryState>) queryState[key] = { ...queryState[key], isFetching: true, isError: true }

  render(<WorkspaceTopBar route="dashboard" />)
  await userEvent.click(screen.getByRole("button", { name: "상태" }))

  expect(screen.getByLabelText("LIVE 상태")).toHaveTextContent("7")
  expect(screen.getByLabelText("HUMAN 상태")).toHaveTextContent("진행 중")
  expect(screen.getByLabelText("ZAP 상태")).toHaveTextContent("준비됨")
  expect(screen.getByLabelText("SCANNER 상태")).toHaveTextContent("진행 중")
  expect(screen.getByLabelText("SCOPE 상태")).toHaveTextContent("https://app.example.test")
  expect(screen.getByLabelText("SCOPE READY 상태")).toHaveTextContent("준비됨")
})

it("keeps only live status in the top bar: the project area moved to the sidebar", () => {
  render(<WorkspaceTopBar route="dashboard" />)

  const banner = screen.getByRole("banner", { name: "FlowScope 상단 상태" })
  expect(banner).toHaveClass("flex-wrap")
  expect(within(banner).queryByRole("navigation")).not.toBeInTheDocument()
  expect(within(banner).queryByLabelText("프로젝트 선택")).not.toBeInTheDocument()
  expect(within(banner).queryByRole("button", { name: "프로젝트 관리" })).not.toBeInTheDocument()
  expect(within(banner).queryByText("저장됨")).not.toBeInTheDocument()
  expect(within(banner).getByRole("button", { name: "상태" })).toBeVisible()
})

it("marks sample data in the top bar on every screen instead of a dashboard banner", () => {
  const { rerender } = render(<WorkspaceTopBar route="graph" />)
  expect(screen.queryByRole("note", { name: "샘플 데이터" })).not.toBeInTheDocument()
  queryState.snapshot = { data: { trafficStats: { captured: 7 }, sampleMode: true }, isPending: false, isError: false }
  rerender(<WorkspaceTopBar route="graph" />)
  expect(screen.getByRole("note", { name: "샘플 데이터" })).toHaveTextContent("실제 점검 결과 아님")
})

it("shows the HUMAN pass recording account while a pass runs", () => {
  queryState.snapshot = { data: { trafficStats: { captured: 7 }, sampleMode: false, accounts: [{ id: "user-a", label: "USER A" }] }, isPending: false, isError: false }
  queryState.human = { data: { active: true, completed: false, accountId: "user-a" }, isPending: false, isError: false }
  render(<WorkspaceTopBar route="dashboard" />)
  expect(screen.getByRole("status", { name: "HUMAN 기록 계정" })).toHaveTextContent("기록 중: USER A")
})
