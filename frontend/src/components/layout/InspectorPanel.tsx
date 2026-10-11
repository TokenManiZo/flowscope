import type { ReactNode } from "react"

interface InspectorPanelProps {
  title: string
  description: ReactNode
  tabs: ReactNode
  children: ReactNode
  actions?: ReactNode
  actionsPlacement?: "header" | "footer"
}

export function InspectorPanel({ title, description, tabs, children, actions, actionsPlacement = "header" }: InspectorPanelProps) {
  const footerActions = actionsPlacement === "footer"
  return <aside aria-label={title} className={`flex min-h-0 min-w-0 flex-col ${footerActions ? "flex-1" : ""}`}>
    <header className="shrink-0 border-b p-4">
      <div className="flex items-center justify-between gap-2 [[role=dialog]_&]:pr-8"><h2 className={`font-semibold ${footerActions ? "text-[18px]" : ""}`}>{title}</h2>{!footerActions && actions}</div>
      <div className="mt-1 text-sm text-muted-foreground">{description}</div>
    </header>
    {tabs}
    <div className={`min-h-0 overflow-y-auto p-4 ${footerActions ? "flex-1" : ""}`}>{children}</div>
    {footerActions && !!actions && <footer className="flex shrink-0 items-center justify-center border-t px-4 py-[16px]">{actions}</footer>}
  </aside>
}
