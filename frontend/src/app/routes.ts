import type { LucideIcon } from "lucide-react"
import { Activity, Braces, FileSearch, House, LayoutDashboard, ListTree, Network, Radar, ScanSearch, ShieldAlert, Table2, UsersRound } from "lucide-react"

export type AppRoute =
  | "home"
  | "dashboard"
  | "inspection"
  | "surface"
  | "graph"
  | "matrix"
  | "sequence"
  | "scenarios"
  | "evidence"
  | "accounts"
  | "verification"
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
  { route: "home", label: "홈", group: "overview", icon: House },
  { route: "dashboard", label: "대시보드", group: "overview", icon: LayoutDashboard },
  { route: "inspection", label: "점검 시작", group: "overview", icon: ScanSearch },
  { route: "surface", label: "API·입력 차이", group: "analysis", icon: Braces },
  { route: "graph", label: "점검 Gap 그래프", group: "analysis", icon: Network },
  { route: "matrix", label: "권한 매트릭스", group: "analysis", icon: Table2 },
  { route: "sequence", label: "흐름 순서", group: "analysis", icon: ListTree },
  { route: "scenarios", label: "취약점 시나리오", group: "analysis", icon: ShieldAlert },
  { route: "evidence", label: "Evidence", group: "evidence", icon: FileSearch },
  { route: "accounts", label: "계정·세션", group: "operations", icon: UsersRound },
  { route: "verification", label: "교차 신원 검증", group: "operations", icon: Radar },
  { route: "runs", label: "실행 상태", group: "operations", icon: Activity },
]

/** 사이드바 탐색 그룹. 순서는 점검 → 분석 → 기록. 흐름 순서(#sequence)는 주소로만 열리고 사이드바에는 표시하지 않는다. */
export const navigationGroups = [
  { id: "inspection", label: "점검", defaultRoute: "inspection", routes: ["inspection", "accounts", "verification"] },
  { id: "analysis", label: "분석", defaultRoute: "matrix", routes: ["matrix", "graph", "surface", "scenarios"] },
  { id: "records", label: "기록", defaultRoute: "evidence", routes: ["evidence", "runs"] },
] as const satisfies readonly NavigationGroup[]

const routeSet = new Set<AppRoute>(appRoutes.map(({ route }) => route))

/** 알 수 없는 주소나 빈 주소는 Home(첫 화면, #home)으로 돌아온다. `#parameter-map`은 예전 그래프, `#explorer`는 점검 시작 LLM 스텝 별칭으로 유지한다. */
export function routeFromHash(hash: string): AppRoute {
  if (!hash.startsWith("#")) return "home"
  const candidate = hash.slice(1)
  if (candidate === "parameter-map") return "graph"
  if (candidate === "explorer") return "inspection"
  return routeSet.has(candidate as AppRoute) ? candidate as AppRoute : "home"
}

export function routeHash(route: AppRoute): string {
  return `#${route}`
}

export function routeLabel(route: AppRoute): string {
  return appRoutes.find((item) => item.route === route)?.label ?? "대시보드"
}
