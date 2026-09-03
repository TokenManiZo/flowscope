import { routeHash, type AppRoute } from "@/app/routes"
import { Activity, FileSearch, Gauge, Grid3X3, Network, PlayCircle, Radar, ShieldCheck, ShieldEllipsis, UsersRound, Workflow, type LucideIcon } from "lucide-react"
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar } from "@/components/ui/sidebar"
import { useScannerRunQuery } from "@/lib/query/hooks"

interface NavigationItem { route: AppRoute; label: string; icon: LucideIcon }

const groups: readonly { label: string; items: readonly NavigationItem[] }[] = [
  { label: "개요", items: [{ route: "dashboard", label: "대시보드", icon: Gauge }] },
  { label: "점검 및 분석", items: [
    { route: "inspection", label: "점검 시작", icon: PlayCircle },
    { route: "graph", label: "공격면 그래프", icon: Network },
    { route: "matrix", label: "권한 매트릭스", icon: Grid3X3 },
    { route: "sequence", label: "흐름 순서", icon: Workflow },
    { route: "scenarios", label: "취약점 시나리오", icon: ShieldEllipsis },
  ] },
  { label: "Evidence 관리", items: [{ route: "evidence", label: "Evidence", icon: FileSearch }] },
  { label: "운영", items: [
    { route: "accounts", label: "계정·세션", icon: UsersRound },
    { route: "runs", label: "실행 상태", icon: Activity },
  ] },
]

export function AppSidebar({ currentRoute }: { currentRoute: AppRoute }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const scanner = useScannerRunQuery()
  const scope = scanner.data?.scope[0]
  const serviceState = scanner.isPending && !scanner.data
    ? { label: "로컬 서비스 연결 확인 중", dot: "bg-zinc-500", ping: false }
    : scanner.isError && !scanner.data
      ? { label: "로컬 서비스 연결 실패", dot: "bg-red-400", ping: false }
      : scanner.isError
        ? { label: "로컬 서비스 동기화 오류", dot: "bg-amber-400", ping: false }
        : { label: "로컬 서비스 연결됨", dot: "bg-emerald-400", ping: true }

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/80">
      <SidebarHeader className="gap-4 border-b border-sidebar-border/70 px-3 py-4">
        <div className="flex items-center gap-3 px-1">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 shadow-[0_0_24px_-12px_rgba(16,185,129,0.8)]"><Radar className="size-5" aria-hidden="true" /></div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden"><p className="font-heading text-base font-semibold tracking-tight">FlowScope</p><p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Access analysis</p></div>
        </div>
        <div className="space-y-2 px-1 group-data-[collapsible=icon]:hidden">
          <p className="text-[10px] font-medium tracking-[0.15em] text-muted-foreground">LOCAL SECURITY LAB</p>
          <div className="flex min-w-0 items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-xs"><ShieldCheck className="size-4 shrink-0 text-emerald-400" aria-hidden="true" /><span className="truncate" title={scope ?? "등록된 범위 없음"}>{scope ?? "등록된 범위 없음"}</span></div>
        </div>
      </SidebarHeader>
      <SidebarContent className="py-2">
        <nav aria-label="주요 탐색">
          {groups.map((group) => (
            <SidebarGroup key={group.label} className="py-2">
              <SidebarGroupLabel className="px-3 text-[10px] font-medium uppercase tracking-[0.14em] text-sidebar-foreground/45">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent><SidebarMenu>
                {group.items.map(({ route, label, icon: Icon }) => (
                  <SidebarMenuItem key={route}><SidebarMenuButton asChild isActive={route === currentRoute} className="h-9 rounded-lg px-3 data-[active=true]:bg-sidebar-accent data-[active=true]:text-white data-[active=true]:shadow-sm"><a href={routeHash(route)} aria-current={route === currentRoute ? "page" : undefined} onClick={() => { if (isMobile) setOpenMobile(false) }}><Icon aria-hidden="true" /><span>{label}</span></a></SidebarMenuButton></SidebarMenuItem>
                ))}
              </SidebarMenu></SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/70 p-3"><div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center"><span className="relative flex size-2">{serviceState.ping && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />}<span className={`relative inline-flex size-2 rounded-full ${serviceState.dot}`} /></span><span className="group-data-[collapsible=icon]:hidden">{serviceState.label}</span></div></SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
