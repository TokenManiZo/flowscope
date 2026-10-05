import { afterEach, describe, expect, it, vi } from "vitest"
import { saveRequestLabWorkspace } from "@/lib/api/endpoints"
import type { RequestLabWorkspaceState } from "@/lib/api/types"
import { createMemoryOnlyRawState } from "@/lib/security/memoryOnlyRawState"
import { RequestLabPersistence } from "./requestLabPersistence"

vi.mock("@/lib/api/endpoints", () => ({ saveRequestLabWorkspace: vi.fn() }))
const save = vi.mocked(saveRequestLabWorkspace)
const initial: RequestLabWorkspaceState = { datasetRevision: 7, revision: 0, persisted: true, tab: { nextId: 1, selectedId: 0, entries: {} } }
const queues: RequestLabPersistence[] = []
function setup() {
  let revision = 0
  save.mockImplementation(async () => ({ datasetRevision: 7, revision: ++revision, persisted: true }))
  const raw = createMemoryOnlyRawState({ request: "ORIGINAL" })
  const publish = vi.fn()
  const queue = new RequestLabPersistence(raw, "evidence-1", 7, initial, publish)
  queues.push(queue)
  return { raw, queue, publish }
}
afterEach(() => { queues.splice(0).forEach(queue => queue.dispose()); vi.clearAllMocks(); vi.useRealTimers() })

describe("Request Lab durable editing queue", () => {
  it("coalesces typing and sends only a name field for a subsequent rename", async () => {
    vi.useFakeTimers()
    const { raw, queue } = setup()
    const entry = raw.addRequest("POST / HTTP/1.1\n\n{}", "ORIGINAL")!
    queue.changed(entry, ["name", "request", "credentialMode", "result", "dirty"])
    raw.editRequest(entry, "POST /orders HTTP/1.1\n\n{\"n\":2}")
    queue.changed(entry, ["request", "dirty"])
    await vi.advanceTimersByTimeAsync(799)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0].change.action).toBe("create")
    entry.name = "수량 변경"
    queue.changed(entry, ["name"])
    await queue.flush()
    expect(save.mock.calls[1]![0].change).toEqual({ action: "update", id: 1, name: "수량 변경" })
    expect(queue.status).toMatchObject({ pending: false, persisted: true, error: "" })
  })

  it("preserves newer edits made during a save and writes sequential revisions", async () => {
    const { raw, queue } = setup()
    const entry = raw.addRequest("first", "ANONYMOUS")!
    let resolve!: (value: { datasetRevision: number; revision: number; persisted: boolean }) => void
    save.mockImplementationOnce(() => new Promise(next => { resolve = next }))
    queue.changed(entry, ["name", "request", "credentialMode"])
    const flushing = queue.flush()
    raw.editRequest(entry, "newer")
    queue.changed(entry, ["request", "dirty"])
    resolve({ datasetRevision: 7, revision: 1, persisted: true })
    await flushing
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]![0]).toMatchObject({ revision: 1, change: { action: "update", id: 1, dirty: true } })
    expect(entry.request).toBe("newer")
  })

  it("keeps edits and creation order after failure, and blocks flush until retry", async () => {
    const { raw, queue } = setup()
    const first = raw.addRequest("first", "ORIGINAL")!, second = raw.addRequest("second", "ANONYMOUS")!
    queue.changed(first, ["name", "request", "credentialMode"])
    queue.changed(second, ["name", "request", "credentialMode"])
    save.mockRejectedValueOnce(new Error("DB locked"))
    await expect(queue.flush()).rejects.toThrow("DB locked")
    expect(raw.requests).toHaveLength(2)
    expect(queue.status).toMatchObject({ error: "DB locked", pending: true })
    await expect(queue.flush()).rejects.toThrow("DB locked")
    await queue.retry()
    expect(save.mock.calls.slice(1).map(([value]) => value.change.id)).toEqual([1, 2])
  })

  it("does not remove a local request before DB commit or after delete failure", async () => {
    const { raw, queue } = setup()
    const entry = raw.addRequest("editable", "ANONYMOUS")!
    queue.changed(entry, ["name", "request", "credentialMode"])
    await queue.flush()
    save.mockRejectedValueOnce(new Error("write failed"))
    await expect(queue.remove(entry, null)).rejects.toThrow("write failed")
    expect(entry.request).toBe("editable")
    expect(raw.requests).toContain(entry)
    expect(queue.status.error).toContain("삭제하지 못했습니다")
    await queue.retry()
    await queue.remove(entry, null)
    expect(save.mock.calls.at(-1)![0].change).toEqual({ action: "delete", id: 1, selectedId: 0 })
    // The owning UI removes/scrubs the entry only after the successful acknowledgement.
    raw.removeRequest(entry)
    expect(entry.request).toBe("")
  })

  it("restores sequence, names and latest response and clears all live text on disposal", async () => {
    const { raw, queue } = setup()
    expect(raw.restoreRequests([{ id: 4, name: "saved", request: "MASKED", credentialMode: "ACCOUNT", result: { response: "last", status: 200, durationMs: 8 }, dirty: true }], 5, 4)).toBe(true)
    expect(raw.request).toBe("MASKED")
    expect(raw.response).toBe("last")
    expect(raw.requests[0]).toMatchObject({ restored: true, dirty: true })
    expect(raw.addRequest("new", "ANONYMOUS")?.id).toBe(5)
    queue.dispose()
    raw.clear()
    expect(raw.request).toBe("")
    expect(raw.requests).toHaveLength(0)
    expect(() => new RequestLabPersistence(raw, "evidence-1", 8, initial, vi.fn())).toThrow("프로젝트가 변경")
  })
})
