import { ChevronDown } from "lucide-react"
import { DropdownMenu } from "radix-ui"

import { navigationGroups, routeHash, routeLabel, type AppRoute, type NavigationGroup } from "@/app/routes"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function WorkspaceNavigation({ route }: { route: AppRoute }) {
  return <nav aria-label="FlowScope 작업 탐색" className="flex shrink-0 items-center gap-1">
    {navigationGroups.map((group) => group.id === "inspection"
      ? <a key={group.id} href={routeHash(group.defaultRoute)} aria-current={route === group.defaultRoute ? "page" : undefined} title={routeLabel(group.defaultRoute)} className={cn("border border-transparent px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground", route === group.defaultRoute && "bg-emerald-400/10 text-emerald-300")}>{group.label}</a>
      : <NavigationMenu key={group.id} group={group} route={route} />)}
  </nav>
}

function NavigationMenu({ group, route }: { group: NavigationGroup; route: AppRoute }) {
  const groupIsActive = group.routes.includes(route)

  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <Button variant="ghost" size="sm" aria-current={groupIsActive ? "page" : undefined} className={cn("gap-1.5 px-2.5 font-medium text-muted-foreground", groupIsActive && "bg-emerald-400/10 text-emerald-300")}>{group.label}<ChevronDown className="size-3.5" aria-hidden="true" /></Button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content aria-label={`${group.label} 경로`} align="start" className="z-50 grid w-52 gap-1 rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden">
        {group.routes.map((itemRoute) => <DropdownMenu.Item asChild key={itemRoute}><a href={routeHash(itemRoute)} aria-current={route === itemRoute ? "page" : undefined} className={cn("flex items-center gap-2 px-2 py-2 outline-none hover:bg-muted focus:bg-muted", route === itemRoute && "bg-emerald-400/10 text-emerald-300")}>{routeLabel(itemRoute)}</a></DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
