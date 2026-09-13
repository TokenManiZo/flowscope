import type { ReactNode } from "react"

interface InspectorPanelProps {
  title: string
  description: ReactNode
  tabs: ReactNode
  children: ReactNode
}

export function InspectorPanel({ title, description, tabs, children }: InspectorPanelProps) {
  return <aside aria-label={title} className="flex min-h-0 min-w-0 flex-col">
    <header className="border-b p-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </header>
    {tabs}
    <div className="min-h-0 overflow-y-auto p-4">{children}</div>
  </aside>
}
