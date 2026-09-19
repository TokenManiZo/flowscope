import { useEffect, useState, type ReactNode } from "react"

import type { AppRoute } from "@/app/routes"
import { useTheme } from "@/hooks/useTheme"
import { SidebarNav } from "./SidebarNav"
import { WorkspaceTopBar } from "./WorkspaceTopBar"

export interface ReferenceAppShellProps {
  route: AppRoute
  children: ReactNode
}

/** 사이드바 셸: 왼쪽 고정 탐색(좁은 화면에서는 햄버거로 여는 오버레이) + 오른쪽 상태 표시줄과 화면 본문. */
export function ReferenceAppShell({ route, children }: ReferenceAppShellProps) {
  const { theme, setTheme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
  }, [route])

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark")

  return (
    <div className="flex h-svh min-h-svh min-w-0 overflow-x-hidden bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 border-e border-border bg-card lg:block">
        <SidebarNav route={route} theme={theme} onToggleTheme={toggleTheme} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-background/70"
          />
          <aside className="absolute inset-y-0 start-0 w-60 border-e border-border bg-card">
            <SidebarNav route={route} theme={theme} onToggleTheme={toggleTheme} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspaceTopBar route={route} onOpenSidebar={() => setMobileOpen(true)} />
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
