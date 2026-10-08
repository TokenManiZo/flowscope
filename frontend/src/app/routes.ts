import type { LucideIcon } from "lucide-react"
import { FileSearch, House, LayoutDashboard, Network, ScanSearch, Table2, UsersRound } from "lucide-react"

export type AppRoute =
  | "home"
  | "dashboard"
  | "inspection"
  | "graph"
  | "matrix"
  | "evidence"
  | "accounts"

export interface AppRouteDefinition {
  route: AppRoute
  label: string
  group: "overview" | "analysis" | "evidence" | "operations"
  icon: LucideIcon
}

export const appRoutes: readonly AppRouteDefinition[] = [
  { route: "home", label: "홈", group: "overview", icon: House },
  { route: "dashboard", label: "대시보드", group: "overview", icon: LayoutDashboard },
  { route: "inspection", label: "점검 시작", group: "overview", icon: ScanSearch },
  { route: "graph", label: "점검 Gap 그래프", group: "analysis", icon: Network },
  { route: "matrix", label: "판정 매트릭스", group: "analysis", icon: Table2 },
  { route: "evidence", label: "요청 기록", group: "evidence", icon: FileSearch },
  { route: "accounts", label: "계정·세션", group: "operations", icon: UsersRound },
]

/** 점검 흐름 순서의 직접 링크. */
export const primaryNavigationRoutes = ["inspection", "accounts", "graph", "matrix", "evidence"] as const satisfies readonly AppRoute[]

const routeSet = new Set<AppRoute>(appRoutes.map(({ route }) => route))

/** 알 수 없는 주소나 빈 주소는 Home(첫 화면, #home)으로 돌아온다. `#parameter-map`은 예전 그래프, `#explorer`는 점검 시작 LLM 스텝, `#evidence-review`는 Evidence 검토 탭 별칭이다. */
export function routeFromHash(hash: string): AppRoute {
  if (!hash.startsWith("#")) return "home"
  const candidate = hash.slice(1)
  if (candidate === "parameter-map") return "graph"
  if (candidate === "explorer") return "inspection"
  if (candidate === "evidence-review") return "evidence"
  return routeSet.has(candidate as AppRoute) ? candidate as AppRoute : "home"
}

/** 주소창에 남길 hash. 화면 안의 상태를 여는 별칭(#evidence-review)은 그 화면이 읽을 수 있게 지우지 않는다. */
export function canonicalHash(hash: string): string {
  return hash === "#evidence-review" ? hash : routeHash(routeFromHash(hash))
}

export function routeHash(route: AppRoute): string {
  return `#${route}`
}

export function routeLabel(route: AppRoute): string {
  return appRoutes.find((item) => item.route === route)?.label ?? "대시보드"
}
