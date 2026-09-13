import type { LucideIcon } from "lucide-react"
import { Activity, Bot, Braces, FileSearch, LayoutDashboard, ListTree, Network, ScanSearch, ShieldAlert, Table2, UsersRound } from "lucide-react"

export type AppRoute =
  | "dashboard"
  | "inspection"
  | "surface"
  | "graph"
  | "matrix"
  | "sequence"
  | "scenarios"
  | "evidence"
  | "accounts"
  | "explorer"
  | "runs"

export interface AppRouteDefinition {
  route: AppRoute
  label: string
  group: "overview" | "analysis" | "evidence" | "operations"
  icon: LucideIcon
}

export type NavigationGroupId = "analysis" | "inspection" | "records"

export interface NavigationGroup {
  id: NavigationGroupId
  label: string
  defaultRoute: AppRoute
  routes: readonly AppRoute[]
}

export const appRoutes: readonly AppRouteDefinition[] = [
  { route: "dashboard", label: "대시보드", group: "overview", icon: LayoutDashboard },
  { route: "inspection", label: "점검 시작", group: "overview", icon: ScanSearch },
  { route: "surface", label: "API·입력 차이", group: "analysis", icon: Braces },
  { route: "graph", label: "점검 Gap 그래프", group: "analysis", icon: Network },
  { route: "matrix", label: "권한 매트릭스", group: "analysis", icon: Table2 },
  { route: "sequence", label: "흐름 순서", group: "analysis", icon: ListTree },
  { route: "scenarios", label: "취약점 시나리오", group: "analysis", icon: ShieldAlert },
  { route: "evidence", label: "Evidence", group: "evidence", icon: FileSearch },
  { route: "accounts", label: "계정·세션", group: "operations", icon: UsersRound },
  { route: "explorer", label: "LLM Explorer", group: "operations", icon: Bot },
  { route: "runs", label: "실행 상태", group: "operations", icon: Activity },
]

/** PR#11 상단 탐색: 분석 / 점검 / 기록 세 그룹이 모든 route를 보존한다. 현행 API·입력 차이와 LLM Explorer도 같은 그룹 안에 둔다. */
export const navigationGroups = [
  { id: "analysis", label: "분석", defaultRoute: "graph", routes: ["graph", "surface", "dashboard", "matrix", "sequence", "scenarios"] },
  { id: "inspection", label: "점검", defaultRoute: "inspection", routes: ["inspection"] },
  { id: "records", label: "기록", defaultRoute: "evidence", routes: ["evidence", "runs", "explorer", "accounts"] },
] as const satisfies readonly NavigationGroup[]

const routeSet = new Set<AppRoute>(appRoutes.map(({ route }) => route))

/** `#graph`는 PR#11처럼 점검 우선순위(파라미터 맵)와 전체 관계 보기를 함께 담는다. 이식 중 임시 route였던 `#parameter-map`은 같은 화면으로 이어진다. */
export function routeFromHash(hash: string): AppRoute {
  if (!hash.startsWith("#")) return "surface"
  const candidate = hash.slice(1)
  if (candidate === "parameter-map") return "graph"
  return routeSet.has(candidate as AppRoute) ? candidate as AppRoute : "surface"
}

export function routeHash(route: AppRoute): string {
  return `#${route}`
}

export function routeLabel(route: AppRoute): string {
  return appRoutes.find((item) => item.route === route)?.label ?? "대시보드"
}
