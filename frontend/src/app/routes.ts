import type { LucideIcon } from "lucide-react"
import { Activity, FileSearch, LayoutDashboard, ListTree, Network, ScanSearch, ShieldAlert, Table2, UsersRound } from "lucide-react"

export type AppRoute =
  | "dashboard"
  | "inspection"
  | "graph"
  | "matrix"
  | "sequence"
  | "scenarios"
  | "evidence"
  | "accounts"
  | "runs"

export interface AppRouteDefinition {
  route: AppRoute
  label: string
  group: "overview" | "analysis" | "evidence" | "operations"
  icon: LucideIcon
}

export const appRoutes: readonly AppRouteDefinition[] = [
  { route: "dashboard", label: "대시보드", group: "overview", icon: LayoutDashboard },
  { route: "inspection", label: "점검 시작", group: "overview", icon: ScanSearch },
  { route: "graph", label: "공격면 그래프", group: "analysis", icon: Network },
  { route: "matrix", label: "권한 매트릭스", group: "analysis", icon: Table2 },
  { route: "sequence", label: "흐름 순서", group: "analysis", icon: ListTree },
  { route: "scenarios", label: "취약점 시나리오", group: "analysis", icon: ShieldAlert },
  { route: "evidence", label: "Evidence", group: "evidence", icon: FileSearch },
  { route: "accounts", label: "계정·세션", group: "operations", icon: UsersRound },
  { route: "runs", label: "실행 상태", group: "operations", icon: Activity },
]

const routeSet = new Set<AppRoute>(appRoutes.map(({ route }) => route))

export function routeFromHash(hash: string): AppRoute {
  if (!hash.startsWith("#")) return "dashboard"
  const candidate = hash.slice(1)
  return routeSet.has(candidate as AppRoute) ? candidate as AppRoute : "dashboard"
}

export function routeHash(route: AppRoute): string {
  return `#${route}`
}

export function routeLabel(route: AppRoute): string {
  return appRoutes.find((item) => item.route === route)?.label ?? "대시보드"
}
