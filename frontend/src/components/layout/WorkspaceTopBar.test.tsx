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

vi.mock("@/lib/query/hooks", () => ({
  useSnapshotQuery: () => queryState.snapshot,
  useHumanRunQuery: () => queryState.human,
  useZapStatusQuery: () => queryState.zap,
  useScannerRunQuery: () => queryState.scanner,
  useProjectsQuery: () => queryState.projects,
  useOpenProjectMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useStartProjectMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))

beforeEach(() => {
  queryState.snapshot = { data: { trafficStats: { captured: 7 }, sampleMode: false }, isPending: false, isError: false }
  queryState.human = { data: { active: true, completed: false }, isPending: false, isError: false }
  queryState.zap = { data: { connected: true, state: "READY" }, isPending: false, isError: false }
  queryState.scanner = { data: { run: { status: "RUNNING" }, scope: ["https://app.example.test"] }, isPending: false, isError: false }
  queryState.projects = { data: { directory: "/tmp/projects", active: { id: "app", name: "App", scope: ["https://app.example.test"], readable: true }, projects: [{ id: "app", name: "App", scope: ["https://app.example.test"], readable: true }], saveState: "SAVED", lastSavedAt: "2026-09-10T01:02:03Z", saveError: "" }, isPending: false, isError: false }
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
  expect(screen.getByRole("link", { name: "점검" })).toHaveAttribute("href", "#inspection")
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
  expect(screen.getByLabelText("HUMAN 상태")).toHaveTextContent("RUNNING")
  expect(screen.getByLabelText("ZAP 상태")).toHaveTextContent("READY")
  expect(screen.getByLabelText("SCANNER 상태")).toHaveTextContent("RUNNING")
  expect(screen.getByLabelText("SCOPE 상태")).toHaveTextContent("https://app.example.test")
  expect(screen.getByLabelText("SCOPE READY 상태")).toHaveTextContent("준비됨")
})

it("keeps grouped navigation, project, DB, and inspection controls discoverable", () => {
  render(<WorkspaceTopBar route="dashboard" />)

  const banner = screen.getByRole("banner", { name: "FlowScope 상단 상태" })
  expect(banner).toHaveClass("flex-wrap")
  expect(within(banner).getByLabelText("프로젝트 선택")).toBeVisible()
  expect(within(banner).getByText("저장됨")).toBeVisible()
  expect(within(banner).getByRole("link", { name: "점검" })).toHaveAttribute("href", "#inspection")
  expect(within(banner).getByRole("button", { name: "분석" })).toBeVisible()
  expect(within(banner).getByRole("button", { name: "기록" })).toBeVisible()
  expect(within(banner).queryByRole("link", { name: "빠른 시작" })).not.toBeInTheDocument()
  expect(banner.querySelector(".overflow-x-auto")).toBeNull()
})

it("shows a real persistence failure instead of claiming automatic save", () => {
  queryState.projects = { ...queryState.projects, data: { ...(queryState.projects.data as Record<string, unknown>), saveState: "FAILED", saveError: "disk full" } }

  render(<WorkspaceTopBar route="dashboard" />)

  expect(screen.getByText("저장 실패")).toBeVisible()
  expect(screen.getByText("저장 실패")).toHaveAttribute("title", "disk full")
  expect(screen.queryByText("자동 저장")).not.toBeInTheDocument()
})
