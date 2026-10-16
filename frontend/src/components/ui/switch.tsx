import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

type Props = Omit<ComponentProps<"button">, "onChange"> & { checked: boolean; onCheckedChange(checked: boolean): void }

export function Switch({ checked, onCheckedChange, className, ...props }: Props) {
  return <button {...props} type="button" role="switch" aria-checked={checked}
    onClick={() => onCheckedChange(!checked)}
    className={cn("inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50", checked ? "bg-brand" : "bg-muted-foreground/40", className)}>
    <span aria-hidden="true" className={cn("pointer-events-none block size-4 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-5" : "translate-x-0")} />
  </button>
}
