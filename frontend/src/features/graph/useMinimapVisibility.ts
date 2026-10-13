import {useSyncExternalStore} from "react"
import {PROJECT_OPENED} from "@/lib/security/datasetBoundary"

const KEY = "flowscope.graph.minimap-expanded"
function readExpanded() {
  try { return sessionStorage.getItem(KEY) !== "false" } catch { return true }
}
let expanded = readExpanded()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const snapshot = () => expanded
function setExpanded(next: boolean | ((current: boolean) => boolean)) {
  expanded = typeof next === "function" ? next(expanded) : next
  try { sessionStorage.setItem(KEY, String(expanded)) } catch { /* Keep the in-memory choice when storage is unavailable. */ }
  listeners.forEach(listener => listener())
}
// The renderer remounts during navigation and graph changes, so visibility belongs to the project session.
window.addEventListener(PROJECT_OPENED, () => setExpanded(true))
export function useMinimapVisibility() {
  return [useSyncExternalStore(subscribe, snapshot, () => true), setExpanded] as const
}
