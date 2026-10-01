import { ChevronDown, FolderCog, Moon, PanelLeft, ScanSearch, Sun } from "lucide-react"
import { useEffect, useState } from "react"

import { appRoutes, navigationGroups, primaryNavigationRoutes, routeHash, routeLabel, type AppRoute, type NavigationGroupId } from "@/app/routes"
import { cn } from "@/lib/utils"
import type { Theme } from "@/hooks/useTheme"
import { useProjectsQuery } from "@/lib/query/hooks"
import { SidebarLiveStatus } from "./LiveStatus"
import { ProjectManagerDialog } from "./ProjectManagerDialog"

interface SidebarNavProps {
  route: AppRoute
  theme: Theme
  onToggleTheme: () => void
  onNavigate?: () => void
  /** 아이콘만 보이는 접힌 상태. 글자는 화면 읽기 이름으로만 남긴다. */
  collapsed?: boolean
  /** 데스크톱 사이드바를 펼치고 접는 버튼. 좁은 화면 오버레이에서는 넘기지 않는다. */
  onToggleSidebar?: () => void
}

/** 왼쪽 사이드바 탐색. 핵심 화면은 독립 링크로, 나머지는 '부가 기능' 드롭다운으로 묶으며 현재 화면의 그룹은 항상 펼쳐 둔다. */
export function SidebarNav({ route, theme, onToggleTheme, onNavigate, collapsed = false, onToggleSidebar }: SidebarNavProps) {
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
  const label = collapsed ? "sr-only" : "truncate"

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("flex shrink-0 border-b border-border", collapsed ? "flex-col items-center gap-2 py-3" : "h-15 items-center justify-between pe-2")}>
        <a
          href={routeHash("home")}
          aria-label="FlowScope 홈으로 이동"
          onClick={onNavigate}
          className={cn("flex items-center gap-2 font-semibold tracking-tight", !collapsed && "px-3.5")}
        >
          <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center border border-emerald-400/50 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300">
            <ScanSearch className="size-4" />
          </span>
          <span className={label}>FlowScope</span>
        </a>
        {onToggleSidebar && <button type="button" onClick={onToggleSidebar} aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"} title={`${collapsed ? "사이드바 펼치기" : "사이드바 접기"} (⌘B)`}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <PanelLeft className="size-4" aria-hidden="true" />
        </button>}
      </div>

      <nav aria-label="FlowScope 전역 탐색" className="grid min-h-0 flex-1 content-start gap-0.5 overflow-x-hidden overflow-y-auto px-2 py-3">
        {primaryNavigationRoutes.map((itemRoute) => (
          <NavLink key={itemRoute} route={itemRoute} active={route === itemRoute} collapsed={collapsed} onNavigate={onNavigate} />
        ))}

        {navigationGroups.map((group) => {
          const expanded = openGroups.includes(group.id)
          const Icon = group.icon
          return (
            <div key={group.id} className="mt-2 border-t border-border pt-2">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggleGroup(group.id)}
                className={cn(
                  "flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                  collapsed && activeGroupId === group.id && "bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className={cn(label, "flex-1 text-left")}>{group.label}</span>
                {!collapsed && <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")} aria-hidden="true" />}
              </button>
              {expanded && (
                // 접힌 막대에서는 시각적으로만 숨긴다. 링크와 현재 위치는 화면 읽기·키보드 탐색에 그대로 남고, 포커스가 들어오면 막대가 펼쳐진다.
                <div className={collapsed ? "sr-only" : "ms-4 grid gap-0.5 border-s border-border ps-2"}>
                  {group.routes.map((itemRoute) => (
                    <NavLink key={itemRoute} route={itemRoute} active={route === itemRoute} collapsed={collapsed} onNavigate={onNavigate} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <SidebarProject collapsed={collapsed} onNavigate={onNavigate} />
      <div className="shrink-0 border-t border-border p-2">
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
          className="flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="size-4 shrink-0" aria-hidden="true" /> : <Moon className="size-4 shrink-0" aria-hidden="true" />}
          <span className={label}>{theme === "dark" ? "라이트 모드" : "다크 모드"}</span>
        </button>
      </div>
    </div>
  )
}

/**
 * 사이드바 맨 아래 현재 프로젝트 블록: 이름, [프로젝트 관리], 실시간 상태(상단 상태 표시줄에서 옮김)를 한 카드에 둔다.
 * 평소 저장 상태는 숨기고, 저장 실패만 빨간색으로 남긴다.
 */
function SidebarProject({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const projects = useProjectsQuery()
  const [open, setOpen] = useState(false)
  const active = projects.data?.active
  const failed = Boolean(active) && projects.data?.saveState === "FAILED"
  return <div className="shrink-0 border-t border-border p-2">
    <div aria-label="현재 프로젝트" role="group" className={cn("rounded-lg border border-emerald-500/40 bg-emerald-500/10", collapsed ? "grid gap-1 p-1" : "p-2.5")}>
      {!collapsed && <div className="mb-2 grid gap-0.5">
        <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">현재 프로젝트</span>
        <span className="truncate font-mono text-sm font-semibold" title={active?.name}>{active?.name ?? (projects.isPending ? "불러오는 중" : "미저장 진단")}</span>
        {failed && <span title={projects.data?.saveError || undefined} className="text-[11px] font-medium text-destructive">저장 실패</span>}
      </div>}
      <button type="button" onClick={() => { setOpen(true); onNavigate?.() }} aria-label="프로젝트 관리" title={collapsed ? "프로젝트 관리" : undefined}
        className={cn("flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-background text-sm font-medium hover:bg-muted", failed && collapsed && "border-destructive")}>
        <FolderCog className="size-4 shrink-0" aria-hidden="true" />
        <span className={collapsed ? "sr-only" : "truncate"}>프로젝트 관리</span>
      </button>
      <SidebarLiveStatus collapsed={collapsed} />
    </div>
    <ProjectManagerDialog open={open} onOpenChange={setOpen} />
  </div>
}

function NavLink({ route, active, collapsed, onNavigate }: { route: AppRoute; active: boolean; collapsed: boolean; onNavigate?: () => void }) {
  const Icon = appRoutes.find((item) => item.route === route)?.icon
  return (
    <a
      href={routeHash(route)}
      title={collapsed ? routeLabel(route) : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "bg-emerald-400/10 font-medium text-emerald-600 dark:text-emerald-300",
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" aria-hidden="true" />}
      <span className={collapsed ? "sr-only" : "truncate"}>{routeLabel(route)}</span>
    </a>
  )
}
