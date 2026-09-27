import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react"

import type { AppRoute } from "@/app/routes"
import { useTheme } from "@/hooks/useTheme"
import { SidebarNav } from "./SidebarNav"
import { WorkspaceTopBar } from "./WorkspaceTopBar"

export interface ReferenceAppShellProps {
  route: AppRoute
  children: ReactNode
}

/**
 * 사이드바 셸: 데스크톱은 아이콘 막대(56px)만 자리를 차지하고, 커서를 올리거나 키보드로 들어오면 본문 위에 겹쳐 펼친다.
 * 본문 폭이 바뀌지 않아 그래프 캔버스가 다시 그려지지 않는다. 좁은 화면은 햄버거로 여는 오버레이를 쓴다.
 */
export function ReferenceAppShell({ route, children }: ReferenceAppShellProps) {
  const { theme, setTheme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  const expanded = hovered || focused

  useEffect(() => {
    setMobileOpen(false)
  }, [route])

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark")
  // 마우스로 누른 링크·버튼에 남은 포커스가 사이드바를 펼친 채로 붙잡지 않도록, 커서가 떠나면 포커스도 놓는다.
  const leaveRail = () => {
    setHovered(false)
    const active = document.activeElement
    if (active instanceof HTMLElement && railRef.current?.contains(active)) active.blur()
    setFocused(false)
  }
  const blurRail = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
  }

  return (
    <div className="flex h-svh min-h-svh min-w-0 overflow-x-hidden bg-background text-foreground">
      <aside className="relative hidden w-14 shrink-0 lg:block">
        <div
          ref={railRef}
          data-expanded={expanded}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={leaveRail}
          onFocus={() => setFocused(true)}
          onBlur={blurRail}
          className={`absolute inset-y-0 start-0 z-50 overflow-hidden border-e border-border bg-card transition-[width,box-shadow] duration-150 ${expanded ? "w-60 shadow-xl" : "w-14"}`}
        >
          <SidebarNav route={route} theme={theme} onToggleTheme={toggleTheme} collapsed={!expanded} />
        </div>
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
