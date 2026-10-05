import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import type { ReactElement } from "react"

import type { HumanRun } from "@/lib/api/types"
import { queryKeys } from "@/lib/query/hooks"

/** 사이드바가 받아 오는 점검 상태를 캐시에 넣는다. 화면이 나중에 열려도 남도록 보관 시간을 늘린다. */
export function seedHumanRun(client: QueryClient, run: HumanRun) {
  client.setQueryDefaults(queryKeys.humanRun, { gcTime: Infinity })
  client.setQueryData(queryKeys.humanRun, run)
  return client
}

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function renderWithQueryClient(ui: ReactElement, client = createTestQueryClient()) {
  const view = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  // rerender도 같은 client 안에서 다시 그린다. 이미 provider로 감싼 요소는 그대로 쓴다.
  return { client, ...view, rerender: (next: ReactElement) => view.rerender(next.type === QueryClientProvider ? next : <QueryClientProvider client={client}>{next}</QueryClientProvider>) }
}
