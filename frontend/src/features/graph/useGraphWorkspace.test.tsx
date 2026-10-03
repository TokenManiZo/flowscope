import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { notifyDatasetReplacing, prepareDatasetReplacement } from "@/lib/security/datasetBoundary"
import { emptyGraphView, emptyGraphWorkspace, type GraphWorkspaceChange } from "./graphWorkspace"
import { useGraphWorkspace } from "./useGraphWorkspace"

afterEach(() => { cleanup(); notifyDatasetReplacing(); vi.unstubAllGlobals(); localStorage.clear() })
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })

it("serializes saves, retains edits made in flight and flushes them before project replacement", async () => {
  let release: () => void = () => {}
  const firstSave = new Promise<void>(resolve => { release = resolve })
  const calls: { revision: number; changes: GraphWorkspaceChange }[] = []
  vi.stubGlobal("fetch", vi.fn(async (_path, init?: RequestInit) => {
    if (init?.method !== "POST") return json({ datasetRevision: 801, revision: 3, workspace: emptyGraphWorkspace })
    const form = init.body as URLSearchParams
    calls.push({ revision: Number(form.get("revision")), changes: JSON.parse(form.get("changes")!) })
    if (calls.length === 1) await firstSave
    return json({ datasetRevision: 801, revision: 3 + calls.length })
  }))
  const { result, unmount } = renderHook(() => useGraphWorkspace(801))
  await waitFor(() => expect(result.current.workspace).not.toBeNull())
  act(() => result.current.update(current => ({ ...current, views: { site: { ...emptyGraphView, positions: { node: { x: 10, y: 20 } } } } })))
  let finished = false
  const drain = prepareDatasetReplacement().then(() => { finished = true })
  await waitFor(() => expect(calls).toHaveLength(1))
  act(() => result.current.update(current => ({ ...current, views: { site: { ...current.views.site, positions: { node: { x: 30, y: 40 } } } } })))
  expect(finished).toBe(false)
  release()
  await act(async () => { await drain })
  expect(calls.map(call => call.revision)).toEqual([3, 4])
  expect(calls[1].changes.views.site.positions.node).toEqual({ x: 30, y: 40 })
  unmount()
  const reopened = renderHook(() => useGraphWorkspace(801))
  expect(reopened.result.current.workspace?.views.site.positions.node).toEqual({ x: 30, y: 40 })
})

it("keeps unsaved geometry visible on a rejected save and blocks replacing that project", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_path, init?: RequestInit) => init?.method === "POST"
    ? json({ success: false, message: "workspace revision changed" }, 409)
    : json({ datasetRevision: 802, revision: 0, workspace: emptyGraphWorkspace })))
  const { result } = renderHook(() => useGraphWorkspace(802))
  await waitFor(() => expect(result.current.workspace).not.toBeNull())
  act(() => result.current.update(current => ({ ...current, views: { site: { ...emptyGraphView, positions: { node: { x: 3, y: 4 } } } } })))
  await act(async () => { await expect(prepareDatasetReplacement()).rejects.toThrow("workspace revision changed") })
  expect(result.current.workspace?.views.site.positions.node).toEqual({ x: 3, y: 4 })
  expect(result.current.error).toBe("workspace revision changed")
})

it("does not install another dataset's response", async () => {
  const fetch = vi.fn(async () => json({ datasetRevision: 999, revision: 0, workspace: emptyGraphWorkspace }))
  vi.stubGlobal("fetch", fetch)
  const { result } = renderHook(() => useGraphWorkspace(803))
  await waitFor(() => expect(result.current.error).toContain("프로젝트가 변경"))
  expect(result.current.workspace).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(1)
})
