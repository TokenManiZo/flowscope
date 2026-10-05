export const REQUEST_LAB_MAX_BYTES = 1_048_576
export const REQUEST_LAB_WORKSPACE_BYTES = 40 * 1_048_576
export const REQUEST_LAB_MAX_REQUESTS = 32

export interface RequestLabResult {
  requestBytes?: number
  responseBytes?: number
  response: string
  status: number
  durationMs: number
  failure?: string
}

export interface RequestLabEntry {
  id: number
  name: string
  request: string
  credentialMode: "ORIGINAL" | "ANONYMOUS" | "ACCOUNT" | "RAW"
  accountId: string
  result: RequestLabResult | null
  restored?: boolean
  dirty: boolean
  editRejected: boolean
  position: { start: number; end: number; top: number; left: number; responseTop: number; responseLeft: number }
}

export interface MemoryOnlyRawState {
  originalRequest: string
  originalResponse: string
  selectedId: number | null
  readonly request: string
  readonly response: string
  jsonViews: { request: { text: string; message: string } | null; response: { text: string; message: string } | null }
  requests: RequestLabEntry[]
  addRequest(request: string, credentialMode: RequestLabEntry["credentialMode"], accountId?: string): RequestLabEntry | null
  editRequest(entry: RequestLabEntry, request: string): boolean
  replaceResult(entry: RequestLabEntry, result: RequestLabResult | null): boolean
  restoreRequests(entries: (Pick<RequestLabEntry, "id" | "name" | "request" | "credentialMode" | "result" | "dirty">)[], nextId: number, selectedId: number): boolean
  removeRequest(entry: RequestLabEntry): void
  clearJson(pane?: "request" | "response"): void
  canSend(request: string): boolean
  clear(): void
}

/** Sensitive text belongs only to the mounted dialog, never storage or query cache. */
export function createMemoryOnlyRawState(initial: { request?: string; response?: string } = {}): MemoryOnlyRawState {
  let sequence = 0
  const scrubResult = (result: RequestLabResult | null) => { if (result) { result.response = ""; result.failure = "" } }
  const scrubEntry = (entry: RequestLabEntry) => { entry.name = ""; entry.request = ""; entry.accountId = ""; scrubResult(entry.result); entry.result = null }
  // Reserve formatter outputs and one in-flight submitted request conservatively as UTF-16.
  const bytes = () => 6 * REQUEST_LAB_MAX_BYTES + 2 * (state.originalRequest.length + state.originalResponse.length
    + state.requests.reduce((size, entry) => size + entry.request.length + (entry.result?.response.length ?? 0) + (entry.result?.failure?.length ?? 0), 0))
  const state: MemoryOnlyRawState = {
    originalRequest: initial.request ?? "",
    originalResponse: initial.response ?? "",
    selectedId: null,
    get request() { return state.selectedId === null ? state.originalRequest : state.requests.find(entry => entry.id === state.selectedId)?.request ?? "" },
    get response() { return state.selectedId === null ? state.originalResponse : state.requests.find(entry => entry.id === state.selectedId)?.result?.response ?? "" },
    jsonViews: { request: null, response: null },
    requests: [],
    addRequest(request, credentialMode, accountId = "") {
      if (state.requests.length >= REQUEST_LAB_MAX_REQUESTS || request.length > REQUEST_LAB_MAX_BYTES || bytes() + 2 * request.length > REQUEST_LAB_WORKSPACE_BYTES) return null
      const id = ++sequence
      const entry: RequestLabEntry = { id, name: `요청 ${id}`, request, credentialMode, accountId: credentialMode === "ACCOUNT" ? accountId : "", result: null, dirty: false, editRejected: false, position: { start: 0, end: 0, top: 0, left: 0, responseTop: 0, responseLeft: 0 } }
      state.requests.push(entry)
      return entry
    },
    restoreRequests(entries, nextId, selectedId) {
      if (entries.length > REQUEST_LAB_MAX_REQUESTS || !Number.isSafeInteger(nextId) || nextId < 1
        || entries.some(entry => !Number.isSafeInteger(entry.id) || entry.id < 1 || entry.id >= nextId || entry.request.length > REQUEST_LAB_MAX_BYTES)
        || new Set(entries.map(entry => entry.id)).size !== entries.length
        || selectedId !== 0 && !entries.some(entry => entry.id === selectedId)
        || bytes() + 2 * entries.reduce((size, entry) => size + entry.request.length + (entry.result?.response.length ?? 0), 0) > REQUEST_LAB_WORKSPACE_BYTES) return false
      for (const entry of state.requests) scrubEntry(entry)
      state.requests = entries.map(entry => ({ ...entry, accountId: "", result: entry.result ? { ...entry.result } : null, restored: true, editRejected: false, position: { start: 0, end: 0, top: 0, left: 0, responseTop: 0, responseLeft: 0 } }))
      state.selectedId = selectedId || null
      sequence = nextId - 1
      return true
    },
    editRequest(entry, request) {
      if (!state.requests.includes(entry) || request.length > REQUEST_LAB_MAX_BYTES || bytes() + 2 * (request.length - entry.request.length) > REQUEST_LAB_WORKSPACE_BYTES) return false
      entry.request = request
      entry.dirty = true
      state.clearJson("request")
      return true
    },
    replaceResult(entry, result) {
      if (!state.requests.includes(entry)) { scrubResult(result); return false }
      scrubResult(entry.result)
      entry.result = null
      state.clearJson("response")
      if (result && bytes() + 2 * (result.response.length + (result.failure?.length ?? 0)) > REQUEST_LAB_WORKSPACE_BYTES) {
        scrubResult(result)
        return false
      }
      entry.result = result
      entry.dirty = false
      return true
    },
    removeRequest(entry) {
      const index = state.requests.indexOf(entry)
      if (index < 0) return
      scrubEntry(entry)
      state.requests.splice(index, 1)
      if (state.selectedId === entry.id) state.selectedId = null
      state.clearJson()
    },
    clearJson(pane) {
      for (const key of pane ? [pane] : ["request", "response"] as const) {
        const view = state.jsonViews[key]
        if (view) { view.text = ""; view.message = "" }
        state.jsonViews[key] = null
      }
    },
    canSend(request) { return new TextEncoder().encode(request).byteLength <= REQUEST_LAB_MAX_BYTES },
    clear() {
      state.clearJson()
      state.originalRequest = ""
      state.originalResponse = ""
      state.selectedId = null
      for (const entry of state.requests) scrubEntry(entry)
      state.requests.splice(0, state.requests.length)
      sequence = 0
    },
  }
  return state
}
