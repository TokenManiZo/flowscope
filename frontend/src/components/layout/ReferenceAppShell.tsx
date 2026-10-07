import { Menu } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"

import type { AppRoute } from "@/app/routes"
import { useTheme } from "@/hooks/useTheme"
import { SidebarNav } from "./SidebarNav"

export interface ReferenceAppShellProps {
  route: AppRoute
  children: ReactNode
}

const SIDEBAR_KEY = "flowscope.sidebar"

function readSidebarOpen(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) === "open" } catch { return false }
}

function typingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
}

/**
 * 사이드바 셸: 데스크톱은 버튼(또는 ⌘B/Ctrl+B)으로만 펼치고 접으며, 펼치면 본문을 옆으로 밀어낸다(덮지 않음).
 * 펼침 상태는 브라우저에 기억한다. 그래프 캔버스는 ResizeObserver로 폭 변화를 따라간다. 좁은 화면은 햄버거로 여는 오버레이를 쓴다.
 */
export function ReferenceAppShell({ route, children }: ReferenceAppShellProps) {
  const { theme, setTheme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expanded, setExpanded] = useState(readSidebarOpen)

  useEffect(() => {
    setMobileOpen(false)
  }, [route])

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, expanded ? "open" : "closed") } catch { /* 저장소가 막힌 환경은 기억하지 않는다. */ }
  }, [expanded])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "b" && !typingTarget(event.target)) {
        event.preventDefault()
        setExpanded((value) => !value)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark")

  return (
    <div className="flex h-svh min-h-svh min-w-0 overflow-x-hidden bg-background text-foreground">
      <aside data-expanded={expanded} className={`hidden shrink-0 overflow-hidden border-e border-border bg-card transition-[width] duration-150 lg:block ${expanded ? "w-[18vw] min-w-60" : "w-14"}`}>
        <SidebarNav route={route} theme={theme} onToggleTheme={toggleTheme} collapsed={!expanded} onToggleSidebar={() => setExpanded((value) => !value)} />
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
        {/* 상단 상태 표시줄은 없앴다(상태는 사이드바 프로젝트 블록). 좁은 화면에서만 사이드바를 여는 줄을 남긴다. */}
        <div className="flex shrink-0 items-center border-b border-border px-2 py-1.5 lg:hidden">
          <button type="button" aria-label="메뉴 열기" onClick={() => setMobileOpen(true)}
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </div>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
