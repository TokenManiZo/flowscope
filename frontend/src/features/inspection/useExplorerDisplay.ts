import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { ExplorerBrowserBudget, ExplorerRunEnvelope } from "@/lib/api/types"
import { DATASET_REPLACING } from "@/lib/security/datasetBoundary"

interface Display { datasetRevision: number; runId: string; elapsedMillis: number; browser: ExplorerBrowserBudget | null; frozen: boolean }
const key = ["explorer-display"] as const

/** One bounded, numeric display cache. Never stores activities, credentials or operator text. */
export function useExplorerDisplay(data: ExplorerRunEnvelope | undefined, datasetRevision: number) {
  const client = useQueryClient()
  const run = data?.run
  const cached = client.getQueryData<Display>(key)
  const matches = cached?.datasetRevision === datasetRevision && cached?.runId === run?.runId
  const active = run?.status === "RUNNING" || run?.status === "AUTHENTICATING"
  const browser = data?.browser ?? (!active && matches ? cached.browser : null)
  const display = matches && cached.frozen && !active && run?.status !== "IDLE" ? cached : {
    datasetRevision, runId: run?.runId ?? "", elapsedMillis: run?.elapsedMillis ?? 0, browser,
    frozen: Boolean(run && run.status !== "IDLE" && !active),
  }
  useEffect(() => {
    if (!run || run.status === "IDLE") client.removeQueries({ queryKey: key })
    else { client.setQueryDefaults(key, { gcTime: Infinity }); client.setQueryData(key, display) }
  }, [client, run, datasetRevision, data?.browser])
  useEffect(() => {
    const clear = () => client.removeQueries({ queryKey: key })
    window.addEventListener(DATASET_REPLACING, clear)
    window.addEventListener("beforeunload", clear)
    return () => { window.removeEventListener(DATASET_REPLACING, clear); window.removeEventListener("beforeunload", clear) }
  }, [client])
  return display
}
