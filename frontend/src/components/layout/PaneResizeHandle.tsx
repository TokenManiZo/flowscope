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

  // 경계는 색·선 없이 커서만 바뀐다. 버튼은 translate로 가운데 두지 않는다: Button의 active:translate-y-px가
  // 가운데 정렬 translate를 덮어 누르는 순간 버튼이 아래로 튀고, 손을 떼는 곳이 경계가 되어 클릭이 사라졌다.
  // 버튼은 패널 제목 줄 높이(위쪽)에 항상 보이게 둔다. 마우스를 올려야만 보이면 접기·펼치기를 찾기 어렵다.
  return <div className="group relative z-20 flex w-4 shrink-0 select-none items-start justify-center pt-3">
    {!collapsed ? <div role="separator" aria-label={`${label} 너비 조절`} aria-orientation="vertical" aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(width)} tabIndex={0}
      className="absolute inset-0 cursor-col-resize focus-visible:bg-ring/20 focus-visible:outline-none"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onKeyDown={onKeyDown} /> : null}
    <Button type="button" size="icon-sm" variant="outline" aria-label={toggleLabel} onClick={collapsed ? onExpand : onCollapse}
      className="relative z-10 size-7 shrink-0 rounded-sm p-0 opacity-70 shadow-sm transition-opacity hover:opacity-100 focus-visible:opacity-100">
      <ToggleIcon className="size-3" />
    </Button>
  </div>
}
