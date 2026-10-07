import type { ReactNode } from "react"
import { CircleHelp } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function HelpHint({ label, children }: { label: string; children: ReactNode }) {
  return <Popover>
    <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={`${label} 도움말`} className="size-6 shrink-0 text-muted-foreground"><CircleHelp className="size-3.5" aria-hidden="true" /></Button></PopoverTrigger>
    <PopoverContent align="start" className="max-w-[calc(100vw-2rem)] p-3 text-sm leading-relaxed">{children}</PopoverContent>
  </Popover>
}
