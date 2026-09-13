import * as React from "react"

const MOBILE_BREAKPOINT = 900
const mobileMediaQuery = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function initialMobileState(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(mobileMediaQuery).matches
    : false
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(initialMobileState)

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const mql = window.matchMedia(mobileMediaQuery)
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
