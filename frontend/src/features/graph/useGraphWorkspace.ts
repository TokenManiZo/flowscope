import { useEffect, useSyncExternalStore } from "react"
import { apiFetch } from "@/lib/api/client"
import { DATASET_REPLACING, DATASET_WILL_REPLACE } from "@/lib/security/datasetBoundary"
import { loadGraphPreferences, resetGraphPreferences } from "./graphPreferences"
import { graphWorkspaceChanges, importLegacyLayout, type GraphWorkspace, type GraphWorkspaceState } from "./graphWorkspace"

type Entry = {
  dataset: number
  value: { workspace: GraphWorkspace | null; error: string; saving: boolean }
  revision: number
  dirty: boolean
  migrating: boolean
  retired?: boolean
  acknowledged?: GraphWorkspace
  listeners: Set<() => void>
  timer?: ReturnType<typeof setTimeout>
  deadline?: ReturnType<typeof setTimeout>
  request?: Promise<void>
}
const entries = new Map<number, Entry>()
function entryFor(dataset: number): Entry {
  let entry = entries.get(dataset)
  if (!entry) {
    for (const [key, old] of entries) {
      clearTimeout(old.timer)
      clearTimeout(old.deadline)
      old.retired = true
      old.dirty = false
      entries.delete(key)
    }
    entry = { dataset, value: { workspace: null, error: "", saving: false }, revision: 0, dirty: false, migrating: false, listeners: new Set() }
    entries.set(dataset, entry)
  }
  return entry
}
function publish(entry: Entry, patch: Partial<Entry["value"]>) {
  entry.value = { ...entry.value, ...patch }
  updateUnloadGuard()
  entry.listeners.forEach(listener => listener())
}
function message(error: unknown) { return error instanceof Error ? error.message : "그래프 배치를 저장하지 못했습니다." }

async function load(entry: Entry) {
  if (entry.request) return entry.request
  publish(entry, { error: "" })
  entry.request = (async () => {
    try {
      const saved = await apiFetch<GraphWorkspaceState>("/api/graph-workspace")
      if (entry.retired) return
      if (saved.datasetRevision !== entry.dataset) throw new Error("프로젝트가 변경되었습니다. 그래프 화면을 다시 열어 주세요.")
      entry.revision = saved.revision
      entry.acknowledged = saved.workspace
      const workspace = importLegacyLayout(saved.workspace, loadGraphPreferences())
      entry.migrating = workspace !== saved.workspace
      entry.dirty = entry.migrating
      publish(entry, { workspace, error: "" })
    } catch (error) { publish(entry, { error: message(error) }) }
    finally { entry.request = undefined; if (entry.dirty && !entry.value.error) schedule(entry) }
  })()
  return entry.request
}

function schedule(entry: Entry) {
  clearTimeout(entry.timer)
  entry.timer = setTimeout(() => { void flush(entry).catch(() => {}) }, 250)
  entry.deadline ??= setTimeout(() => { void flush(entry).catch(() => {}) }, 1000)
}
async function flush(entry: Entry): Promise<void> {
  clearTimeout(entry.timer)
  clearTimeout(entry.deadline)
  entry.deadline = undefined
  if (entry.retired) return
  if (entry.request) { await entry.request; return flush(entry) }
  if (!entry.dirty || !entry.value.workspace) return
  if (entry.value.error) throw new Error(entry.value.error)
  const workspace = entry.value.workspace
  publish(entry, { saving: true })
  entry.request = (async () => {
    try {
      const changes = JSON.stringify(graphWorkspaceChanges(entry.acknowledged!, workspace))
      if (new TextEncoder().encode(changes).byteLength > 2 * 1024 * 1024) throw new Error("그래프 변경이 저장 크기 제한(2MiB)을 초과했습니다.")
      const body = new URLSearchParams({ datasetRevision: String(entry.dataset), revision: String(entry.revision), changes })
      const saved = await apiFetch<Pick<GraphWorkspaceState, "revision" | "datasetRevision">>("/api/graph-workspace", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body,
        // This is only a best-effort tail send; the fetch group also shares a 64KiB in-flight quota.
        keepalive: new TextEncoder().encode(body.toString()).byteLength <= 32 * 1024,
      })
      if (entry.retired) return
      if (saved.datasetRevision !== entry.dataset) throw new Error("프로젝트가 변경되었습니다. 그래프 화면을 다시 열어 주세요.")
      entry.revision = saved.revision
      entry.acknowledged = workspace
      entry.dirty = entry.value.workspace !== workspace
      if (entry.migrating) { resetGraphPreferences(); entry.migrating = false }
    } catch (error) { publish(entry, { error: message(error) }); throw error }
  })()
  try { await entry.request }
  finally { entry.request = undefined; publish(entry, { saving: false }) }
  if (entry.dirty) return flush(entry)
}

// Drain layout changes before the server preserves/replaces the active project.
window.addEventListener(DATASET_WILL_REPLACE, event => {
  const pending = [...entries.values()].filter(entry => entry.dirty || entry.request)
  ;(event as CustomEvent<{ waitUntil(promise: Promise<unknown>): void }>).detail.waitUntil(Promise.all(pending.map(flush)))
})
window.addEventListener(DATASET_REPLACING, () => {
  for (const entry of entries.values()) {
    clearTimeout(entry.timer)
    clearTimeout(entry.deadline)
    entry.retired = true
    entry.dirty = false
    publish(entry, { workspace: null })
  }
  entries.clear()
  updateUnloadGuard()
})
window.addEventListener("pagehide", () => { for (const entry of entries.values()) void flush(entry).catch(() => {}) })
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") for (const entry of entries.values()) void flush(entry).catch(() => {})
})
function warnBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
  event.returnValue = ""
}
function updateUnloadGuard() {
  // Register only while there are edits the server has not acknowledged.
  const dirty = [...entries.values()].some(entry => !entry.retired && entry.dirty)
  if (dirty) window.addEventListener("beforeunload", warnBeforeUnload)
  else window.removeEventListener("beforeunload", warnBeforeUnload)
}

export function useGraphWorkspace(dataset: number) {
  const entry = entryFor(dataset)
  const value = useSyncExternalStore(listener => { entry.listeners.add(listener); return () => { entry.listeners.delete(listener) } }, () => entry.value)
  useEffect(() => {
    if (!entry.value.workspace && !entry.value.error) void load(entry)
    return () => { void flush(entry).catch(() => {}) }
  }, [entry])
  return { ...value,
    update: (change: (current: GraphWorkspace) => GraphWorkspace) => {
      if (entry.retired || !entry.value.workspace) return
      const workspace = change(entry.value.workspace)
      if (workspace === entry.value.workspace) return
      const previous = entry.value.workspace
      entry.dirty = true
      publish(entry, { workspace })
      // Gesture completion should not wait for a debounce; continuous viewport updates still batch.
      if (Object.entries(workspace.views).some(([key, view]) => view.positions !== previous.views[key]?.positions || view.sizes !== previous.views[key]?.sizes)) {
        void flush(entry).catch(() => {})
      } else schedule(entry)
    },
    retry: async () => {
      if (!entry.value.workspace) return load(entry)
      if (entry.request) { try { await entry.request } catch { /* Retry retains the unacknowledged layout. */ } }
      publish(entry, { error: "" })
      await flush(entry)
    },
    reload: async () => {
      if (entry.request) { try { await entry.request } catch { /* Keep the reload available after a failed save. */ } }
      clearTimeout(entry.timer)
      clearTimeout(entry.deadline)
      entry.dirty = false
      publish(entry, { workspace: null })
      await load(entry)
    },
  }
}
