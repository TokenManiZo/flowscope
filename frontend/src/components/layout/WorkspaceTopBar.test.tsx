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

it("keeps project, DB, and inspection controls discoverable without duplicating sidebar navigation", async () => {
  render(<WorkspaceTopBar route="dashboard" />)

  const banner = screen.getByRole("banner", { name: "FlowScope 상단 상태" })
  expect(banner).toHaveClass("flex-wrap")
  expect(within(banner).getByLabelText("프로젝트 선택")).toBeVisible()
  expect(within(banner).getByText("저장됨")).toBeVisible()
  expect(within(banner).queryByRole("navigation")).not.toBeInTheDocument()
  expect(within(banner).getByRole("button", { name: "프로젝트 관리" })).toBeVisible()
  expect(within(banner).queryByRole("link", { name: "빠른 시작" })).not.toBeInTheDocument()
  expect(banner.querySelector(".overflow-x-auto")).toBeNull()

  await userEvent.click(within(banner).getByRole("button", { name: "프로젝트 관리" }))
  const dialog = screen.getByRole("dialog", { name: "프로젝트 관리" })
  expect(within(dialog).getByText("현재 프로젝트: App")).toBeVisible()
  expect(within(dialog).getByRole("option", { name: "App" })).toBeVisible()
  expect(within(dialog).queryByLabelText("새 프로젝트 이름 (선택)")).not.toBeInTheDocument()
  expect(within(dialog).queryByLabelText("Exact scope")).not.toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole("button", { name: "새 트래픽 진단 시작" }))
  await userEvent.click(screen.getByRole("button", { name: "새 진단 시작" }))
  expect(startProjectMutate).toHaveBeenCalledWith({ name: "", scope: "https://app.example.test" }, expect.objectContaining({ onSuccess: expect.any(Function) }))
  await userEvent.selectOptions(within(dialog).getByLabelText("기존 프로젝트 선택"), "archive")
  await userEvent.click(within(dialog).getByRole("button", { name: "열기" }))
  expect(openProjectMutate).toHaveBeenCalledWith("archive", expect.objectContaining({ onSuccess: expect.any(Function) }))
  await userEvent.click(within(dialog).getByRole("button", { name: "선택한 프로젝트 삭제" }))
  await userEvent.click(screen.getByRole("button", { name: "프로젝트 삭제" }))
  expect(deleteProjectMutate).toHaveBeenCalledWith("archive", expect.objectContaining({ onSuccess: expect.any(Function) }))
  await userEvent.selectOptions(within(dialog).getByLabelText("기존 프로젝트 선택"), "app")
  await userEvent.click(within(dialog).getByRole("button", { name: "현재 프로젝트 트래픽 초기화" }))
  await userEvent.click(screen.getByRole("button", { name: "트래픽 초기화" }))
  expect(resetTrafficMutate).toHaveBeenCalled()
})

it("shows a real persistence failure instead of claiming automatic save", () => {
  queryState.projects = { ...queryState.projects, data: { ...(queryState.projects.data as Record<string, unknown>), saveState: "FAILED", saveError: "disk full" } }

  render(<WorkspaceTopBar route="dashboard" />)

  expect(screen.getByText("저장 실패")).toBeVisible()
  expect(screen.getByText("저장 실패")).toHaveAttribute("title", "disk full")
  expect(screen.queryByText("자동 저장")).not.toBeInTheDocument()
})

it("marks sample data in the top bar on every screen instead of a dashboard banner", () => {
  const { rerender } = render(<WorkspaceTopBar route="graph" />)
  expect(screen.queryByRole("note", { name: "샘플 데이터" })).not.toBeInTheDocument()
  queryState.snapshot = { data: { trafficStats: { captured: 7 }, sampleMode: true }, isPending: false, isError: false }
  rerender(<WorkspaceTopBar route="graph" />)
  expect(screen.getByRole("note", { name: "샘플 데이터" })).toHaveTextContent("실제 점검 결과 아님")
})
