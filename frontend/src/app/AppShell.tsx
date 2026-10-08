import { ReferenceAppShell } from "@/components/layout/ReferenceAppShell"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DashboardPage } from "@/features/dashboard/DashboardPage"
import { HomePage } from "@/features/home/HomePage"
import { InspectionPage } from "@/features/inspection/InspectionPage"
import { AccountsPage } from "@/features/accounts/AccountsPage"
import { EvidencePage } from "@/features/evidence/EvidencePage"
import { GraphPage } from "@/features/graph/GraphPage"
import { MatrixPage } from "@/features/matrix/MatrixPage"
import { routeLabel, type AppRoute } from "./routes"
import { useEffect } from "react"

function RoutePlaceholder({ route }: { route: AppRoute }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{routeLabel(route)}</CardTitle>
        <CardDescription>이 화면은 아직 준비 중이라 자리만 표시하고 있습니다.</CardDescription>
      </CardHeader>
      <CardContent>백엔드 연결 후 실제 화면이 들어갑니다.</CardContent>
    </Card>
  )
}

export function AppShell({ route = "home" }: { route?: AppRoute }) {
  useEffect(() => {
    const root = document.documentElement
    const alreadyDense = root.classList.contains("flowscope-density-90")
    root.classList.add("flowscope-density-90")
    return () => {
      if (!alreadyDense) root.classList.remove("flowscope-density-90")
    }
  }, [])

  const routeContent = route === "home" ? <HomePage /> : route === "dashboard" ? <DashboardPage /> : route === "inspection" ? <InspectionPage /> : route === "graph" ? <GraphPage /> : route === "matrix" ? <MatrixPage /> : route === "evidence" ? <EvidencePage /> : route === "accounts" ? <AccountsPage /> : <RoutePlaceholder route={route} />

  return <ReferenceAppShell route={route}>{routeContent}</ReferenceAppShell>
}
