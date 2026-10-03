import { useState } from "react"
import { emptyGraphWorkspace, type GraphWorkspace } from "@/features/graph/graphWorkspace"

/** Screen-only fixtures; persistence is covered separately by workspace and API regressions. */
export function useMemoryGraphWorkspace() {
  const [workspace, update] = useState<GraphWorkspace>(emptyGraphWorkspace)
  return { workspace, update, error: "", saving: false, reload: async () => {} }
}
