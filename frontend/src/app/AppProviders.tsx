import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { flowScopeQueryClient } from "@/lib/query/client"

export function AppProviders({ children, client = flowScopeQueryClient }: { children: ReactNode; client?: QueryClient }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
