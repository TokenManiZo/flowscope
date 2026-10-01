import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"

import { normalizeScopeEntry } from "./ProjectManagerDialog"
import { SidebarNav } from "./SidebarNav"

const state = vi.hoisted(() => ({ projects: {} as Record<string, unknown> }))
const mutate = vi.hoisted(() => ({ open: vi.fn(), start: vi.fn(), update: vi.fn(), reset: vi.fn(), remove: vi.fn() }))
const pending = { isPending: false, error: null }

vi.mock("@/lib/query/hooks", () => ({
  useProjectsQuery: () => state.projects,
  useOpenProjectMutation: () => ({ mutate: mutate.open, ...pending }),
  useStartProjectMutation: () => ({ mutate: mutate.start, ...pending }),
  useUpdateProjectMutation: () => ({ mutate: mutate.update, ...pending }),
  useResetProjectTrafficMutation: () => ({ mutate: mutate.reset, ...pending }),
  useDeleteProjectMutation: () => ({ mutate: mutate.remove, ...pending }),
}))

const app = { id: "app", name: "App", scope: ["https://app.example.test:443"], readable: true, managed: true }
const archive = { id: "archive", name: "지난 진단", scope: ["https://old.example.test:443"], readable: true, managed: true }

beforeEach(() => {
  Object.values(mutate).forEach(fn => fn.mockReset())
  state.projects = { data: { directory: "/tmp/projects", active: app, projects: [app, archive], saveState: "SAVED" }, isPending: false, isError: false }
})

const openDialog = async () => {
  render(<SidebarNav route="dashboard" theme="dark" onToggleTheme={vi.fn()} />)
  await userEvent.click(screen.getByRole("button", { name: "프로젝트 관리" }))
  return screen.getByRole("dialog", { name: "프로젝트 관리" })
}

it("shows the current project and its save state at the bottom of the sidebar, keeping save failures visible", () => {
  state.projects = { data: { directory: "/tmp/projects", active: app, projects: [app], saveState: "FAILED", saveError: "disk full" }, isPending: false, isError: false }
  render(<SidebarNav route="dashboard" theme="dark" onToggleTheme={vi.fn()} />)
  const block = screen.getByRole("group", { name: "현재 프로젝트" })
  expect(block).toHaveTextContent("App")
  expect(within(block).getByText("저장 실패")).toHaveAttribute("title", "disk full")
})

it("normalizes typed scope entries to scheme://host:port[/path]", () => {
  expect(normalizeScopeEntry("http://127.0.0.1:8888/")).toEqual({ entry: "http://127.0.0.1:8888" })
  expect(normalizeScopeEntry("https://shop.example.com/api/?q=1")).toEqual({ entry: "https://shop.example.com:443/api", note: "쿼리와 뒷부분은 제외하고 등록했습니다." })
  expect(normalizeScopeEntry("ftp://x").entry).toBeNull()
})

it("creates a project from a typed name and scope list", async () => {
  const dialog = await openDialog()
  await userEvent.click(within(dialog).getByRole("tab", { name: "새 프로젝트" }))
  const create = within(dialog).getByRole("button", { name: "프로젝트 만들고 열기" })
  expect(create).toBeDisabled()
  await userEvent.type(within(dialog).getByLabelText("점검 대상 주소"), "https://shop.example.com{Enter}")
  await userEvent.type(within(dialog).getByLabelText("점검 대상 주소"), "http://127.0.0.1:8888")
  await userEvent.click(within(dialog).getByRole("button", { name: "추가" }))
  expect(within(dialog).getByLabelText("프로젝트 이름")).toHaveValue("shop.example.com-443")
  await userEvent.click(create)
  expect(mutate.start).toHaveBeenCalledWith({ name: "shop.example.com-443", scope: "https://shop.example.com:443\nhttp://127.0.0.1:8888" }, expect.objectContaining({ onSuccess: expect.any(Function) }))
})

it("edits the current project's name and scope, and resets its traffic after confirmation", async () => {
  const dialog = await openDialog()
  await userEvent.click(within(dialog).getByRole("button", { name: "수정" }))
  const nameInput = within(dialog).getByLabelText("프로젝트 이름")
  await userEvent.clear(nameInput)
  await userEvent.type(nameInput, "App 2차")
  await userEvent.type(within(dialog).getByLabelText("점검 대상 주소"), "https://auth.example.test{Enter}")
  await userEvent.click(within(dialog).getByRole("button", { name: "변경 저장" }))
  expect(mutate.update).toHaveBeenCalledWith({ name: "App 2차", scope: "https://app.example.test:443\nhttps://auth.example.test:443" }, expect.objectContaining({ onSuccess: expect.any(Function) }))

  await userEvent.click(within(dialog).getByRole("button", { name: "기록 비우기" }))
  await userEvent.click(screen.getByRole("button", { name: "기록 비우기" }))
  expect(mutate.reset).toHaveBeenCalled()
})

it("switches after confirmation and deletes another project", async () => {
  const dialog = await openDialog()
  expect(within(dialog).getByLabelText("기존 프로젝트 선택")).toHaveValue("archive")
  await userEvent.click(within(dialog).getByRole("button", { name: "열기" }))
  expect(mutate.open).not.toHaveBeenCalled()
  await userEvent.click(within(dialog).getByRole("button", { name: "전환" }))
  expect(mutate.open).toHaveBeenCalledWith("archive", expect.objectContaining({ onSuccess: expect.any(Function) }))

  await userEvent.click(within(dialog).getByRole("button", { name: "삭제" }))
  await userEvent.click(screen.getByRole("button", { name: "프로젝트 삭제" }))
  expect(mutate.remove).toHaveBeenCalledWith("archive", expect.objectContaining({ onSuccess: expect.any(Function) }))
})

it("deletes the open project by switching to the chosen project first, then deleting it", async () => {
  mutate.open.mockImplementation((_id: string, options: { onSuccess(): void }) => options.onSuccess())
  const dialog = await openDialog()
  await userEvent.click(within(dialog).getByRole("button", { name: "수정" }))
  await userEvent.click(within(dialog).getByRole("button", { name: "프로젝트 삭제" }))
  expect(screen.getByLabelText("삭제 후 열 프로젝트")).toHaveValue("archive")
  await userEvent.click(screen.getByRole("button", { name: "전환하고 삭제" }))
  expect(mutate.open).toHaveBeenCalledWith("archive", expect.anything())
  expect(mutate.remove).toHaveBeenCalledWith("app", expect.anything())
})
