import { ReferenceAppShell } from "@/components/layout/ReferenceAppShell"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DashboardPage } from "@/features/dashboard/DashboardPage"
import { InspectionPage } from "@/features/inspection/InspectionPage"
import { RunsPage } from "@/features/runs/RunsPage"
import { SurfacePage } from "@/features/surface/SurfacePage"
import { AccountsPage } from "@/features/accounts/AccountsPage"
import { EvidencePage } from "@/features/evidence/EvidencePage"
import { GraphPage } from "@/features/graph/GraphPage"
import { MatrixPage } from "@/features/matrix/MatrixPage"
import { SequencePage } from "@/features/sequence/SequencePage"
import { ScenariosPage } from "@/features/scenarios/ScenariosPage"
import { ExplorerPage } from "@/features/explorer/ExplorerPage"
import { routeLabel, type AppRoute } from "./routes"
import { useEffect } from "react"

function RoutePlaceholder({ route }: { route: AppRoute }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{routeLabel(route)}</CardTitle>
        <CardDescription>이 작업면은 다음 동등성 작업에서 실제 기능을 연결합니다.</CardDescription>
      </CardHeader>
      <CardContent>현재는 안전한 탐색 자리표시자입니다.</CardContent>
    </Card>
  )
}

export function AppShell({ route = "surface" }: { route?: AppRoute }) {
  useEffect(() => {
    const root = document.documentElement
    const alreadyDark = root.classList.contains("dark")
    const alreadyDense = root.classList.contains("flowscope-density-90")
    root.classList.add("dark")
    root.classList.add("flowscope-density-90")
    return () => {
      if (!alreadyDark) root.classList.remove("dark")
      if (!alreadyDense) root.classList.remove("flowscope-density-90")
    }
  }, [])

  const routeContent = route === "dashboard" ? <DashboardPage /> : route === "inspection" ? <InspectionPage /> : route === "surface" ? <SurfacePage /> : route === "graph" ? <GraphPage /> : route === "matrix" ? <MatrixPage /> : route === "sequence" ? <SequencePage /> : route === "scenarios" ? <ScenariosPage /> : route === "evidence" ? <EvidencePage /> : route === "accounts" ? <AccountsPage /> : route === "explorer" ? <ExplorerPage /> : route === "runs" ? <RunsPage /> : <RoutePlaceholder route={route} />

  return <ReferenceAppShell route={route}>{routeContent}</ReferenceAppShell>
}
