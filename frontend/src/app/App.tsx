import { useEffect, useState } from "react"

import { AppShell } from "./AppShell"
import { routeFromHash, routeHash } from "./routes"

export function App() {
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash))

  useEffect(() => {
    const synchronizeRoute = () => {
      const normalized = routeFromHash(window.location.hash)
      if (window.location.hash !== routeHash(normalized)) {
        window.history.replaceState(null, "", routeHash(normalized))
      }
      setRoute(normalized)
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
