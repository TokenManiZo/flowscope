import type { GraphNavigation } from "./graphHierarchy"
import type { GraphPreferences, NodeSize } from "./graphPreferences"

export const initialGraphNavigation: GraphNavigation = { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
export type GraphWorkspaceView = {
  positions: GraphPreferences["positions"]
  sizes: Record<string, NodeSize>
  viewport: GraphPreferences["viewport"]
  expandedGroups: readonly string[]
}
export type GraphWorkspace = {
  version: 1
  navigation: GraphNavigation
  views: Record<string, GraphWorkspaceView>
  locked: boolean
  inputMode: GraphPreferences["inputMode"]
}
export type GraphWorkspaceState = { datasetRevision: number; revision: number; workspace: GraphWorkspace }
export type GraphWorkspaceViewPatch = {
  positions?: GraphWorkspaceView["positions"]; deletedPositions?: string[]
  sizes?: GraphWorkspaceView["sizes"]; deletedSizes?: string[]
  viewport?: NonNullable<GraphWorkspaceView["viewport"]>; clearViewport?: boolean
  expandedGroups?: readonly string[]
}
export type GraphWorkspaceChange = { navigation?: GraphNavigation; views: GraphWorkspace["views"]; viewPatches: Record<string, GraphWorkspaceViewPatch>; deletedViews: string[]; locked?: boolean; inputMode?: GraphWorkspace["inputMode"] }
export function graphWorkspaceChanges(before: GraphWorkspace, after: GraphWorkspace): GraphWorkspaceChange {
  const views: GraphWorkspace["views"] = {}, viewPatches: GraphWorkspaceChange["viewPatches"] = {}
  for (const [key, view] of Object.entries(after.views)) {
    const previous = before.views[key]
    if (view === previous) continue
    if (!previous) { views[key] = view; continue }
    const patch: GraphWorkspaceViewPatch = {}
    if (view.positions !== previous.positions) {
      const positions = Object.fromEntries(Object.entries(view.positions).filter(([id, point]) => point.x !== previous.positions[id]?.x || point.y !== previous.positions[id]?.y))
      const removed = Object.keys(previous.positions).filter(id => !Object.hasOwn(view.positions, id))
      if (Object.keys(positions).length) patch.positions = positions
      if (removed.length) patch.deletedPositions = removed
    }
    if (view.sizes !== previous.sizes) {
      const sizes = Object.fromEntries(Object.entries(view.sizes).filter(([id, size]) => size.width !== previous.sizes[id]?.width || size.height !== previous.sizes[id]?.height))
      const removed = Object.keys(previous.sizes).filter(id => !Object.hasOwn(view.sizes, id))
      if (Object.keys(sizes).length) patch.sizes = sizes
      if (removed.length) patch.deletedSizes = removed
    }
    if (view.viewport?.zoom !== previous.viewport?.zoom || view.viewport?.pan.x !== previous.viewport?.pan.x || view.viewport?.pan.y !== previous.viewport?.pan.y) {
      if (view.viewport) patch.viewport = view.viewport
      else patch.clearViewport = true
    }
    if (view.expandedGroups.length !== previous.expandedGroups.length || view.expandedGroups.some((id, index) => id !== previous.expandedGroups[index])) patch.expandedGroups = view.expandedGroups
    if (Object.keys(patch).length) viewPatches[key] = patch
  }
  return { views, viewPatches,
    deletedViews: Object.keys(before.views).filter(key => !(key in after.views)),
    ...(before.navigation !== after.navigation ? { navigation: after.navigation } : {}),
    ...(before.locked !== after.locked ? { locked: after.locked } : {}),
    ...(before.inputMode !== after.inputMode ? { inputMode: after.inputMode } : {}),
  }
}
export const emptyGraphView: GraphWorkspaceView = { positions: {}, sizes: {}, viewport: null, expandedGroups: [] }
export const emptyGraphWorkspace: GraphWorkspace = { version: 1, navigation: initialGraphNavigation, views: {}, locked: false, inputMode: "auto" }
const legacyViewKey = "legacy"

export function graphViewKey(navigation: GraphNavigation): string {
  return JSON.stringify([navigation.level, navigation.level === "site" ? "" : navigation.groupId, navigation.level === "operation" ? navigation.operation : ""])
}

/** Preserve legacy coordinates in this project; seed newly visited views without borrowing their viewport. */
export function importLegacyLayout(workspace: GraphWorkspace, legacy: GraphPreferences | null): GraphWorkspace {
  if (!legacy || Object.keys(workspace.views).length) return workspace
  return { ...workspace, locked: legacy.locked, inputMode: legacy.inputMode, views: {
    [legacyViewKey]: { positions: legacy.positions, sizes: legacy.sizes ?? {}, viewport: null, expandedGroups: [] },
    [graphViewKey(workspace.navigation)]: { ...emptyGraphView, viewport: legacy.viewport },
  } }
}

export function graphView(workspace: GraphWorkspace, navigation: GraphNavigation): GraphWorkspaceView {
  const view = workspace.views[graphViewKey(navigation)] ?? emptyGraphView
  const legacy = workspace.views[legacyViewKey]
  return legacy ? { ...view, positions: { ...legacy.positions, ...view.positions }, sizes: { ...legacy.sizes, ...view.sizes } } : view
}

/** Hidden/folded nodes keep their saved geometry. Empty size updates do not erase another view. */
export function mergeGraphLayout(view: GraphWorkspaceView, update: Pick<GraphPreferences, "positions" | "viewport" | "sizes">): GraphWorkspaceView {
  const moved = Object.entries(update.positions).some(([id, point]) => view.positions[id]?.x !== point.x || view.positions[id]?.y !== point.y)
  const resized = Object.entries(update.sizes ?? {}).some(([id, size]) => view.sizes[id]?.width !== size.width || view.sizes[id]?.height !== size.height)
  const previous = view.viewport, next = update.viewport
  const viewportChanged = previous?.zoom !== next?.zoom || previous?.pan.x !== next?.pan.x || previous?.pan.y !== next?.pan.y
  if (!moved && !resized && !viewportChanged) return view
  return { ...view, positions: moved ? { ...view.positions, ...update.positions } : view.positions,
    sizes: resized ? { ...view.sizes, ...update.sizes } : view.sizes, viewport: update.viewport }
}
