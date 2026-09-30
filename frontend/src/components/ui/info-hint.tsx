import type { ReactNode } from "react"
import { Info } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/** 어려운 항목 옆의 (i) 버튼. 누르면 한두 문장짜리 쉬운 설명을 보여 준다. */
export function InfoHint({ label, children }: { label: string; children: ReactNode }) {
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" aria-label={`${label} 설명`} className="inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Info className="size-4" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-72 p-3 text-sm leading-relaxed">{children}</PopoverContent>
  </Popover>
}
