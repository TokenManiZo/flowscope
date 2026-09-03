import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export interface RouteContextPanelProps {
  title: string
  count?: string
  children: ReactNode
  className?: string
}

export function RouteContextPanel({ title, count, children, className }: RouteContextPanelProps) {
  return <aside aria-label={title} className={cn("border-r border-[var(--flowscope-divider)] bg-[var(--flowscope-pane)]", className)}><header className="flex items-center justify-between border-b border-[var(--flowscope-divider)] px-3 py-2"><h2 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground">{title}</h2>{count ? <span className="font-mono text-xs text-muted-foreground">{count}</span> : null}</header>{children}</aside>
}
