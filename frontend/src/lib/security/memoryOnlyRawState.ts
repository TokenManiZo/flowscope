export const REQUEST_LAB_MAX_BYTES = 1_048_576

export interface RequestLabHistoryResult {
  response: string
  status: number
  durationMs: number
}

export interface MemoryOnlyRawState {
  request: string
  response: string
  history: RequestLabHistoryResult[]
  addResult(result: RequestLabHistoryResult): void
  canSend(request: string): boolean
  clear(): void
}

/**
 * Owns sensitive Request Lab text for one mounted dialog only. It deliberately
 * has no browser storage or query-cache dependency; callers must clear it when
 * the dialog's Evidence context changes.
 */
export function createMemoryOnlyRawState(initial: Partial<Pick<MemoryOnlyRawState, "request" | "response">> = {}): MemoryOnlyRawState {
  const state: MemoryOnlyRawState = {
    request: initial.request ?? "",
    response: initial.response ?? "",
    history: [],
    addResult(result) {
      state.history.unshift({ response: result.response, status: result.status, durationMs: result.durationMs })
      if (state.history.length > 10) {
        const discarded = state.history.pop()
        if (discarded) discarded.response = ""
      }
    },
    canSend(request) { return new TextEncoder().encode(request).byteLength <= REQUEST_LAB_MAX_BYTES },
    clear() {
      state.request = ""
      state.response = ""
      for (const result of state.history) result.response = ""
      state.history.splice(0, state.history.length)
    },
  }
  return state
}
