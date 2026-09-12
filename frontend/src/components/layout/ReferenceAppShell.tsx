import type { ReactNode } from "react"

import type { AppRoute } from "@/app/routes"
import { WorkspaceTopBar } from "./WorkspaceTopBar"

export interface ReferenceAppShellProps {
  route: AppRoute
  children: ReactNode
}

/** PR#11 집중 작업면: 상단 바의 그룹 탐색이 유일한 route 탐색이며 별도 rail을 두지 않는다. */
export function ReferenceAppShell({ route, children }: ReferenceAppShellProps) {
  return <div className="flex h-svh min-h-svh min-w-0 flex-col overflow-x-hidden bg-background text-foreground">
    <WorkspaceTopBar route={route} />
    <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
  </div>
}
