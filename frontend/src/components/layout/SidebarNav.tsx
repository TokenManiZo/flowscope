import { ChevronDown, Moon, ScanSearch, Sun } from "lucide-react"
import { useEffect, useState } from "react"

import { navigationGroups, routeHash, routeLabel, type AppRoute, type NavigationGroupId } from "@/app/routes"
import { cn } from "@/lib/utils"
import type { Theme } from "@/hooks/useTheme"

interface SidebarNavProps {
  route: AppRoute
  theme: Theme
  onToggleTheme: () => void
  onNavigate?: () => void
}

/** 왼쪽 사이드바 탐색. 그룹 라벨을 눌러 접고 펼치며, 여러 그룹을 동시에 펼칠 수 있고 현재 화면의 그룹은 항상 펼쳐 둔다. */
export function SidebarNav({ route, theme, onToggleTheme, onNavigate }: SidebarNavProps) {
  const activeGroupId = navigationGroups.find((group) => (group.routes as readonly AppRoute[]).includes(route))?.id
  const [openGroups, setOpenGroups] = useState<readonly NavigationGroupId[]>(() =>
    activeGroupId ? [activeGroupId] : [],
  )

  useEffect(() => {
    if (!activeGroupId) return
    setOpenGroups((previous) => (previous.includes(activeGroupId) ? previous : [...previous, activeGroupId]))
  }, [activeGroupId])

  const toggleGroup = (id: NavigationGroupId) => {
    setOpenGroups((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <a
        href={routeHash("dashboard")}
        aria-label="FlowScope 대시보드로 이동"
        onClick={onNavigate}
        className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-4 font-semibold tracking-tight"
      >
        <span aria-hidden="true" className="grid size-7 place-items-center border border-emerald-400/50 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300">
          <ScanSearch className="size-4" />
        </span>
        <span>FlowScope</span>
      </a>

      <nav aria-label="FlowScope 전역 탐색" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <NavLink route="dashboard" active={route === "dashboard"} onNavigate={onNavigate} />

        {navigationGroups.map((group) => {
          const expanded = openGroups.includes(group.id)
          return (
            <div key={group.id} className="mt-1">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted"
              >
                {group.label}
                <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
              </button>
              {expanded && (
                <div className="ms-2 grid gap-0.5 border-s border-border ps-2">
                  {group.routes.map((itemRoute) => (
                    <NavLink key={itemRoute} route={itemRoute} active={route === itemRoute} onNavigate={onNavigate} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="shrink-0 border-t border-border p-2">
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
          {theme === "dark" ? "라이트 모드" : "다크 모드"}
        </button>
      </div>
    </div>
  )
}

function NavLink({ route, active, onNavigate }: { route: AppRoute; active: boolean; onNavigate?: () => void }) {
  return (
    <a
      href={routeHash(route)}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "bg-emerald-400/10 font-medium text-emerald-600 dark:text-emerald-300",
      )}
    >
      {routeLabel(route)}
    </a>
  )
}
