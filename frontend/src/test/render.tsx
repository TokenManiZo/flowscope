import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import type { ReactElement } from "react"

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
  return { client, ...view, rerender: (next: ReactElement) => view.rerender(next.type === QueryClientProvider ? next : <QueryClientProvider client={client}>{next}</QueryClientProvider>) }
}
