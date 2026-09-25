import type { CSSProperties, ReactNode } from "react"

import { cn } from "@/lib/utils"

export interface RouteContextPanelProps {
  title: string
  count?: string
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** false면 제목 줄을 숨긴다. 접근 이름(aria-label)은 그대로 둔다. */
  showTitle?: boolean
}

export function RouteContextPanel({ title, count, children, className, style, showTitle = true }: RouteContextPanelProps) {
  return <aside aria-label={title} className={cn("border-r border-[var(--flowscope-divider)] bg-[var(--flowscope-pane)]", className)} style={style}>{showTitle && <header className="flex items-center justify-between border-b border-[var(--flowscope-divider)] px-3 py-2"><h2 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground">{title}</h2>{count ? <span className="font-mono text-xs text-muted-foreground">{count}</span> : null}</header>}{children}</aside>
}
