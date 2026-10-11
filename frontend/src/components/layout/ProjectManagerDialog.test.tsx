import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"

import { normalizeScopeEntry } from "./ProjectManagerDialog"
import { SidebarNav } from "./SidebarNav"

const state = vi.hoisted(() => ({ projects: {} as Record<string, unknown>, updateError: null as Error | null }))
const mutate = vi.hoisted(() => ({ open: vi.fn(), start: vi.fn(), update: vi.fn(), reset: vi.fn(), remove: vi.fn() }))
const pending = { isPending: false, error: null }

vi.mock("@/lib/query/hooks", () => ({
  useSnapshotQuery: () => ({ data: undefined, isPending: false }),
  useHumanRunQuery: () => ({ data: undefined, isPending: false }),
  useZapStatusQuery: () => ({ data: undefined, isPending: false }),
  useScannerRunQuery: () => ({ data: undefined, isPending: false }),
  useProjectsQuery: () => state.projects,
  useOpenProjectMutation: () => ({ mutate: mutate.open, ...pending }),
  useStartProjectMutation: () => ({ mutate: mutate.start, ...pending }),
  useUpdateProjectMutation: () => ({ mutate: mutate.update, ...pending, error: state.updateError }),
  useResetProjectTrafficMutation: () => ({ mutate: mutate.reset, ...pending }),
  useDeleteProjectMutation: () => ({ mutate: mutate.remove, ...pending }),
}))

const app = { id: "app", name: "App", scope: ["https://app.example.test:443"], createdAt: "2026-09-21T01:00:00Z", sizeBytes: 40960, readable: true, managed: true }
const archive = { id: "archive", name: "지난 진단", scope: ["https://old.example.test:443"], createdAt: "2026-09-18T01:00:00Z", sizeBytes: 2097152, readable: true, managed: true }

beforeEach(() => {
  Object.values(mutate).forEach(fn => fn.mockReset())
  state.updateError = null
  state.projects = { data: { directory: "/tmp/projects", active: app, projects: [app, archive], saveState: "SAVED" }, isPending: false, isError: false }
})

const openDialog = async () => {
  render(<SidebarNav route="dashboard" theme="dark" onToggleTheme={vi.fn()} />)
  await userEvent.click(screen.getByRole("button", { name: "프로젝트 관리" }))
  return screen.getByRole("dialog", { name: "프로젝트 관리" })
}

it("shows the current project at the bottom of the sidebar, hiding routine save state but keeping save failures visible", () => {
  state.projects = { data: { directory: "/tmp/projects", active: app, projects: [app], saveState: "FAILED", saveError: "disk full" }, isPending: false, isError: false }
  render(<SidebarNav route="dashboard" theme="dark" onToggleTheme={vi.fn()} />)
  const block = screen.getByRole("group", { name: "현재 프로젝트" })
  expect(block).toHaveTextContent("App")
  expect(within(block).getByText("저장 실패")).toHaveAttribute("title", "disk full")
  expect(block).not.toHaveTextContent("https://app.example.test:443")
})

it("hides routine save state in the sidebar block", () => {
  render(<SidebarNav route="dashboard" theme="dark" onToggleTheme={vi.fn()} />)
  expect(screen.getByRole("group", { name: "현재 프로젝트" })).not.toHaveTextContent("저장됨")
})

it("normalizes typed scope entries to scheme://host:port[/path]", () => {
  expect(normalizeScopeEntry("http://127.0.0.1:8888/")).toEqual({ entry: "http://127.0.0.1:8888" })
  expect(normalizeScopeEntry("https://shop.example.com/api/?q=1")).toEqual({ entry: "https://shop.example.com:443/api", note: "쿼리와 뒷부분은 제외하고 등록했습니다." })
  expect(normalizeScopeEntry("ftp://x").entry).toBeNull()
  expect(normalizeScopeEntry("Example.COM").entry).toBe("https://example.com:443")
  expect(normalizeScopeEntry("https://user:pass@example.com").entry).toBeNull()
  expect(normalizeScopeEntry("127.0.0.1").entry).toBeNull()
  expect(normalizeScopeEntry("*.example.com").entry).toBeNull()
})

it("creates a project from a bare root domain using the existing exact URL scope", async () => {
  const dialog = await openDialog()
  await userEvent.click(within(dialog).getByRole("tab", { name: "새 프로젝트" }))
  await userEvent.type(within(dialog).getByLabelText("점검 대상 주소"), "example.test{Enter}")
  await userEvent.click(within(dialog).getByRole("button", { name: "프로젝트 만들고 열기" }))
  expect(mutate.start).toHaveBeenCalledWith({ name: "example.test-443", scope: "https://example.test:443" }, expect.anything())
})

it("stages discovered origins once and saves them through the existing project update", async () => {
  state.projects = { data: { active: app, projects: [app], discoveredOrigins: ["https://api.app.example.test:443", "https://static.app.example.test:443"] }, isPending: false, isError: false }
  const dialog = await openDialog()
  const first = within(dialog).getByRole("button", { name: "https://api.app.example.test:443 범위에 추가" })
  await userEvent.click(first)
  expect(first).toBeDisabled()
  expect(mutate.update).not.toHaveBeenCalled()
  await userEvent.click(within(dialog).getByRole("button", { name: "https://static.app.example.test:443 범위에 추가" }))
  await userEvent.click(within(dialog).getByRole("button", { name: "변경 저장" }))
  expect(mutate.update).toHaveBeenCalledWith({ name: "App", scope: "https://app.example.test:443\nhttps://api.app.example.test:443\nhttps://static.app.example.test:443" }, expect.anything())
})

it("keeps rejected changes editable and shows the save error next to the save controls", async () => {
  state.updateError = new Error("활성 HUMAN·ZAP·LLM 실행을 먼저 종료하거나 취소하세요.")
  const dialog = await openDialog()
  await userEvent.click(within(dialog).getByRole("button", { name: "수정" }))
  await userEvent.type(within(dialog).getByLabelText("점검 대상 주소"), "https://auth.example.test{Enter}")
  await userEvent.click(within(dialog).getByRole("button", { name: "변경 저장" }))
  const alert = within(dialog).getByLabelText("프로젝트 변경 저장 실패")
  expect(alert).toHaveTextContent("활성 HUMAN·ZAP·LLM 실행을 먼저 종료하거나 취소하세요.")
  expect(alert.nextElementSibling).toContainElement(within(dialog).getByRole("button", { name: "변경 저장" }))
  expect(within(dialog).getByRole("list", { name: "등록한 점검 대상 주소" })).toHaveTextContent("auth.example.test:443")
  expect(within(dialog).queryByText(/프로젝트 정보를 저장했습니다/)).not.toBeInTheDocument()
})

it("rejects a duplicate root scope when the stored URL has a trailing slash", async () => {
  const rooted = { ...app, scope: ["https://app.example.test:443/"] }
  state.projects = { data: { active: rooted, projects: [rooted] }, isPending: false, isError: false }
  const dialog = await openDialog()
  await userEvent.click(within(dialog).getByRole("button", { name: "수정" }))
  await userEvent.type(within(dialog).getByLabelText("점검 대상 주소"), "app.example.test{Enter}")
  expect(within(dialog).getByText("이미 등록된 대상입니다.")).toBeInTheDocument()
  expect(within(within(dialog).getByRole("list", { name: "등록한 점검 대상 주소" })).getAllByRole("listitem")).toHaveLength(1)
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

it("lists other projects with scope and date, switches after confirmation, and deletes another project", async () => {
  const dialog = await openDialog()
  expect(within(dialog).queryByRole("combobox", { name: "기존 프로젝트 선택" })).not.toBeInTheDocument()
  const list = within(dialog).getByRole("list", { name: "프로젝트 목록" })
  expect(within(list).getAllByRole("listitem")).toHaveLength(1)
  expect(list).toHaveTextContent("지난 진단")
  expect(list).toHaveTextContent("https://old.example.test:443")

  await userEvent.click(within(list).getByRole("button", { name: "지난 진단 열기" }))
  expect(mutate.open).not.toHaveBeenCalled()
  await userEvent.click(within(dialog).getByRole("button", { name: "전환" }))
  expect(mutate.open).toHaveBeenCalledWith("archive", expect.objectContaining({ onSuccess: expect.any(Function) }))

  await userEvent.click(within(list).getByRole("button", { name: "지난 진단 삭제" }))
  await userEvent.click(screen.getByRole("button", { name: "프로젝트 삭제" }))
  expect(mutate.remove).toHaveBeenCalledWith("archive", expect.objectContaining({ onSuccess: expect.any(Function) }))
})

it("filters the project list by name or address", async () => {
  const dialog = await openDialog()
  await userEvent.type(within(dialog).getByLabelText("프로젝트 검색"), "nothing-matches")
  expect(within(dialog).queryByRole("list", { name: "프로젝트 목록" })).not.toBeInTheDocument()
  expect(dialog).toHaveTextContent("검색과 일치하는 프로젝트가 없습니다.")
  await userEvent.clear(within(dialog).getByLabelText("프로젝트 검색"))
  await userEvent.type(within(dialog).getByLabelText("프로젝트 검색"), "old.example")
  expect(within(dialog).getByRole("list", { name: "프로젝트 목록" })).toHaveTextContent("지난 진단")
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
