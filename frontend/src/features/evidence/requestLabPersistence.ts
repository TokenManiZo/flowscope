import { saveRequestLabWorkspace } from "@/lib/api/endpoints"
import type { RequestLabWorkspaceChange, RequestLabWorkspaceState } from "@/lib/api/types"
import type { MemoryOnlyRawState, RequestLabEntry } from "@/lib/security/memoryOnlyRawState"

type Field = "name" | "request" | "credentialMode" | "result" | "dirty"
export type RequestLabSaveStatus = { pending: boolean; saving: boolean; persisted: boolean; error: string }

/** Mounted-dialog save queue. Only dirty field names are retained, never extra Raw copies. */
export class RequestLabPersistence {
  private revision: number
  private savedIds: Set<number>
  private fields = new Map<number, Set<Field>>()
  private selection: number
  private selected = false
  private retired = false
  private timer?: ReturnType<typeof setTimeout>
  private request?: Promise<void>
  private controller = new AbortController()
  status: RequestLabSaveStatus

  constructor(private raw: MemoryOnlyRawState, private eventId: string, private dataset: number,
    state: RequestLabWorkspaceState, private publish: (status: RequestLabSaveStatus) => void) {
    if (dataset !== state.datasetRevision) throw new Error("프로젝트가 변경되었습니다. Request Lab을 다시 열어 주세요.")
    this.revision = state.revision
    this.savedIds = new Set(Object.keys(state.tab.entries).map(Number))
    this.selection = state.tab.selectedId
    this.status = { pending: false, saving: false, persisted: state.persisted, error: "" }
    this.update({})
  }
  private update(patch: Partial<RequestLabSaveStatus>) {
    this.status = { ...this.status, ...patch, pending: this.fields.size > 0 || this.selected || !!this.request }
    if (!this.retired) this.publish(this.status)
  }
  changed(entry: RequestLabEntry, fields: Field[]) {
    if (this.retired) return
    const changes = this.fields.get(entry.id) ?? new Set<Field>()
    fields.forEach(field => changes.add(field))
    this.fields.set(entry.id, changes)
    this.update({})
    this.schedule()
  }
  select(id: number | null) {
    if (this.retired || this.selection === (id ?? 0)) return
    this.selection = id ?? 0
    this.selected = true
    this.update({})
    this.schedule()
  }
  private schedule() {
    clearTimeout(this.timer)
    if (!this.status.error) this.timer = setTimeout(() => { void this.flush().catch(() => {}) }, 800)
  }
  private async write(change: RequestLabWorkspaceChange) {
    const saved = await saveRequestLabWorkspace({ eventId: this.eventId, datasetRevision: this.dataset, revision: this.revision, change }, this.controller.signal)
    if (this.retired) return
    if (!saved.persisted || saved.datasetRevision !== this.dataset) throw new Error("프로젝트 DB에 저장하지 못했습니다. 프로젝트 연결을 확인해 주세요.")
    this.revision = saved.revision
    this.status.persisted = true
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    if (this.retired) return
    if (this.request) { await this.request; return this.flush() }
    if (this.status.error) throw new Error(this.status.error)
    if (!this.fields.size && !this.selected) return
    this.request = this.drain()
    this.update({ saving: true })
    try { await this.request }
    finally { this.request = undefined; this.update({ saving: false }) }
  }
  private async drain() {
    try {
      while (!this.retired && (this.fields.size || this.selected)) {
        const item = [...this.fields.entries()].sort(([a], [b]) => a - b)[0]
        if (item) {
          const [id, fields] = item
          const entry = this.raw.requests.find(entry => entry.id === id)
          if (!entry) { this.fields.delete(id); continue }
          this.fields.delete(id)
          const create = !this.savedIds.has(id)
          const change: RequestLabWorkspaceChange = { action: create ? "create" : "update", id }
          for (const field of create ? ["name", "request", "credentialMode", "result", "dirty"] as const : fields) {
            if (field === "result") {
              change.clearResult = !entry.result || !!entry.result.failure
              if (!change.clearResult && entry.result) change.result = { response: entry.result.response, status: entry.result.status, durationMs: entry.result.durationMs, requestBytes: entry.result.requestBytes ?? 0, responseBytes: entry.result.responseBytes ?? 0 }
            } else if (field === "name") change.name = entry.name
            else if (field === "request") change.request = entry.request
            else if (field === "credentialMode") change.credentialMode = entry.credentialMode
            else change.dirty = entry.dirty
          }
          try { await this.write(change); if (!this.retired) this.savedIds.add(id) }
          catch (error) {
            const newer = this.fields.get(id) ?? new Set<Field>()
            fields.forEach(field => newer.add(field)); this.fields.set(id, newer)
            throw error
          } finally { change.request = undefined; if (change.result) change.result.response = "" }
        } else {
          const selectedId = this.selection
          await this.write({ action: "select", id: 0, selectedId })
          if (this.selection === selectedId) this.selected = false
        }
      }
    } catch (error) {
      if (!this.retired) this.update({ error: error instanceof Error ? error.message : "Request Lab 저장에 실패했습니다." })
      throw error
    }
  }
  async remove(entry: RequestLabEntry, nextId: number | null) {
    await this.flush()
    if (this.retired) throw new Error("프로젝트가 변경되었습니다.")
    this.request = (async () => {
      try {
        await this.write({ action: "delete", id: entry.id, selectedId: nextId ?? 0 })
        this.savedIds.delete(entry.id)
        this.selection = nextId ?? 0
      } catch (error) {
        if (!this.retired) this.update({ error: "삭제하지 못했습니다. 요청을 유지했습니다. 다시 삭제해 주세요." })
        throw error
      }
    })()
    this.update({ saving: true })
    try { await this.request }
    finally { this.request = undefined; this.update({ saving: false }) }
  }
  async retry() { this.update({ error: "" }); await this.flush() }
  dispose() {
    this.retired = true
    clearTimeout(this.timer)
    this.controller.abort()
    this.fields.clear()
    this.savedIds.clear()
  }
}
