import { useEffect, useState } from "react"

import { AppShell } from "./AppShell"
import { canonicalHash, routeFromHash } from "./routes"

export function App() {
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash))

  useEffect(() => {
    const synchronizeRoute = () => {
      const canonical = canonicalHash(window.location.hash)
      if (window.location.hash !== canonical) {
        window.history.replaceState(null, "", canonical)
      }
      setRoute(routeFromHash(canonical))
    }
    synchronizeRoute()
    window.addEventListener("hashchange", synchronizeRoute)
    window.addEventListener("popstate", synchronizeRoute)
    return () => {
      window.removeEventListener("hashchange", synchronizeRoute)
      window.removeEventListener("popstate", synchronizeRoute)
    }
  }, [])

  return <AppShell route={route} />
}
