import { useCallback, useEffect, useState } from "react"

export type Theme = "dark" | "light"

const STORAGE_KEY = "flowscope-theme"

function initialTheme(): Theme {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === "dark" || stored === "light") return stored
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

/** 라이트/다크 테마. 선택은 localStorage에 저장해 재방문 때 복원하고, 첫 방문은 기기 설정을 따른다(기본 다크). */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    window.localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }, [])

  return { theme, setTheme } as const
}
