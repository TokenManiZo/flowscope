import { QueryClient } from "@tanstack/react-query"

export const FLOW_SCOPE_POLL_INTERVAL_MS = 1_000
export const FLOW_SCOPE_STALE_TIME_MS = 500

export function createFlowScopeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: FLOW_SCOPE_STALE_TIME_MS,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
}

export const flowScopeQueryClient = createFlowScopeQueryClient()
