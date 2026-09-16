import type { KeyboardEvent, PointerEvent } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"

const KEYBOARD_STEP = 16

interface PaneResizeHandleProps {
  side: "left" | "right"
  label: string
  width: number
  min: number
  max: number
  collapsed?: boolean
  onWidthChange(width: number): void
  onCollapse(): void
  onExpand?(): void
}

function bounded(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** Desktop pane boundary: pointer and keyboard resize share the same bounded width. */
export function PaneResizeHandle({ side, label, width, min, max, collapsed = false, onWidthChange, onCollapse, onExpand }: PaneResizeHandleProps) {
  const resize = (value: number) => onWidthChange(bounded(value, min, max))
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.currentTarget.dataset.startX = String(event.clientX)
    event.currentTarget.dataset.startWidth = String(width)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return
    const startX = Number(event.currentTarget.dataset.startX)
    const startWidth = Number(event.currentTarget.dataset.startWidth)
    if (!Number.isFinite(startX) || !Number.isFinite(startWidth)) return
    const delta = event.clientX - startX
    resize(startWidth + (side === "left" ? delta : -delta))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") resize(min)
    else if (event.key === "End") resize(max)
    else if (event.key === "ArrowLeft") resize(width + (side === "left" ? -KEYBOARD_STEP : KEYBOARD_STEP))
    else if (event.key === "ArrowRight") resize(width + (side === "left" ? KEYBOARD_STEP : -KEYBOARD_STEP))
    else return
    event.preventDefault()
  }
  const ToggleIcon = side === "left"
    ? collapsed ? ChevronRight : ChevronLeft
    : collapsed ? ChevronLeft : ChevronRight
  const toggleLabel = `${label} 패널 ${collapsed ? "열기" : "접기"}`

  return <div className="group relative z-20 w-4 shrink-0 border-x border-transparent hover:border-emerald-400/50 hover:bg-emerald-400/5 focus-within:border-emerald-400/50">
    {!collapsed ? <div role="separator" aria-label={`${label} 너비 조절`} aria-orientation="vertical" aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(width)} tabIndex={0}
      className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 cursor-col-resize focus-visible:bg-emerald-400/10 focus-visible:outline-none"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onKeyDown={onKeyDown} /> : null}
    <Button type="button" size="icon-sm" variant="outline" aria-label={toggleLabel} onClick={collapsed ? onExpand : onCollapse}
      className="absolute top-1/2 left-1/2 z-10 size-7 -translate-x-1/2 -translate-y-1/2 rounded-sm p-0 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <ToggleIcon className="size-3" />
    </Button>
  </div>
}
