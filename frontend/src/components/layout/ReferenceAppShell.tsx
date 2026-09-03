import type { ReactNode } from "react"

import type { AppRoute } from "@/app/routes"
import { RouteIconRail } from "./RouteIconRail"
import { WorkspaceTopBar } from "./WorkspaceTopBar"

export interface ReferenceAppShellProps {
  route: AppRoute
  children: ReactNode
}

export function ReferenceAppShell({ route, children }: ReferenceAppShellProps) {
  return <div className="flex h-svh min-h-svh min-w-0 flex-col overflow-x-hidden bg-background text-foreground">
    <WorkspaceTopBar route={route} />
    <div className="flex min-h-0 min-w-0 flex-1">
      <RouteIconRail route={route} />
      <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  </div>
}
