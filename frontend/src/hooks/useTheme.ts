import { useCallback, useEffect, useState, useSyncExternalStore } from "react"

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

function subscribeDocumentTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

/** 실제 적용된 테마(html.dark). 캔버스처럼 CSS 변수를 못 쓰는 그림이 테마 전환에 맞춰 다시 그리도록 한다. */
export function useDocumentTheme(): Theme {
  return useSyncExternalStore(subscribeDocumentTheme, () => document.documentElement.classList.contains("dark") ? "dark" : "light")
}
