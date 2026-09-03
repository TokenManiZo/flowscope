import { ChevronDown } from "lucide-react"
import { useState } from "react"

import { appRoutes, routeHash, routeLabel, type AppRoute } from "@/app/routes"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export function RouteIconRail({ route }: { route: AppRoute }) {
  const [open, setOpen] = useState(false)
  const activeLabel = routeLabel(route)

  return <>
    <aside className="hidden w-15 shrink-0 border-r border-[var(--flowscope-divider)] bg-[var(--flowscope-pane)] lg:block">
      <nav aria-label="주요 분석 탐색" className="flex h-full flex-col items-center gap-1 py-2">
        {appRoutes.map(({ route: itemRoute, label, icon: Icon, group }) => <a key={itemRoute} href={routeHash(itemRoute)} aria-current={route === itemRoute ? "page" : undefined} aria-label={label} title={label} className={cn("grid size-10 place-items-center border border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground", route === itemRoute && "border-emerald-400/60 bg-emerald-400/10 text-emerald-300", group === "evidence" && "mt-2", group === "operations" && itemRoute === "accounts" && "mt-2")}><Icon className="size-4" aria-hidden="true" /></a>)}
      </nav>
    </aside>
    <div className="border-b border-[var(--flowscope-divider)] bg-[var(--flowscope-pane)] px-3 py-2 lg:hidden">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><Button variant="outline" size="sm" aria-current="page" className="w-full justify-between">{activeLabel}<ChevronDown className="size-3.5" /></Button></PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1">
          <div role="menu" aria-label="분석 경로" className="grid gap-1">
            {appRoutes.map(({ route: itemRoute, label, icon: Icon }) => <a role="menuitem" key={itemRoute} href={routeHash(itemRoute)} onClick={() => setOpen(false)} aria-current={route === itemRoute ? "page" : undefined} className={cn("flex items-center gap-2 px-2 py-2 text-sm hover:bg-muted", route === itemRoute && "bg-emerald-400/10 text-emerald-300")}><Icon className="size-4" aria-hidden="true" />{label}</a>)}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  </>
}
