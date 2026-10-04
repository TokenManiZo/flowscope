import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { KeyboardEvent, RefObject } from "react"
import { GripHorizontal, Maximize2, Minimize2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DATASET_REPLACING } from "@/lib/security/datasetBoundary"

export interface RecordView {
  focused: boolean
  height?: number
  toggleFocus(): void
}

/** Only changes the reading area; collection and its mounted controls keep running. */
export function useRecordView(root: RefObject<HTMLElement | null>, onFocusChange?: (focused: boolean) => void) {
  const [focused, setFocused] = useState(false)
  const [height, setHeight] = useState<number>()
  const savedScroll = useRef<{ element: HTMLElement; top: number; left: number }[]>([])
  const focusChanged = useRef(false)
  const toggleFocus = () => {
    if (!focused) {
      savedScroll.current = []
      for (let element = root.current?.parentElement; element; element = element.parentElement) {
        savedScroll.current.push({ element, top: element.scrollTop, left: element.scrollLeft })
      }
    }
    focusChanged.current = true
    setFocused(!focused)
    onFocusChange?.(!focused)
  }
  useLayoutEffect(() => {
    if (!focusChanged.current) return
    for (const { element, top, left } of savedScroll.current) {
      element.scrollTop = focused ? 0 : top
      element.scrollLeft = focused ? 0 : left
    }
    focusChanged.current = false
  }, [focused])
  useLayoutEffect(() => () => onFocusChange?.(false), [onFocusChange])
  useEffect(() => {
    const reset = () => { savedScroll.current = []; setFocused(false); setHeight(undefined); onFocusChange?.(false) }
    window.addEventListener(DATASET_REPLACING, reset)
    return () => window.removeEventListener(DATASET_REPLACING, reset)
  }, [onFocusChange])
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // A dialog or tooltip gets its own Escape before the underlying reading view.
    if (event.key === "Escape" && focused && !event.defaultPrevented
      && !(event.target as HTMLElement).closest('[role="dialog"], [data-slot="tooltip-content"]')) {
      event.preventDefault()
      toggleFocus()
      root.current?.querySelector<HTMLButtonElement>('[data-record-focus]')?.focus({ preventScroll: true })
    }
  }
  return { focused, height, toggleFocus, setHeight, onKeyDown }
}

export function RecordViewButton({ view, onExpand }: { view: RecordView; onExpand(): void }) {
  return <Button type="button" variant="outline" size="sm" data-record-focus aria-pressed={view.focused}
    onClick={() => { onExpand(); view.toggleFocus() }}>
    {view.focused ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
    {view.focused ? "원래 크기" : "크게 보기"}
  </Button>
}

export function RecordResizeHandle({ height, onHeightChange, label }: {
  height?: number; onHeightChange(height: number): void; label: string
}) {
  const drag = useRef<{ pointer: number; y: number; height: number } | null>(null)
  const change = (value: number) => onHeightChange(Math.max(160, Math.min(600, value)))
  return <div role="separator" tabIndex={0} aria-label={`${label} 높이 조절`} aria-orientation="horizontal"
    aria-valuemin={160} aria-valuemax={600} aria-valuenow={height ?? 240}
    title="드래그하거나 위아래 방향키로 기록 높이 조절"
    className="flex h-5 shrink-0 touch-none cursor-row-resize select-none items-center justify-center gap-2 rounded text-[10px] text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    onPointerDown={(event) => {
      if (event.button !== 0) return
      const list = event.currentTarget.parentElement?.querySelector<HTMLElement>('[data-record-list]')
      drag.current = { pointer: event.pointerId, y: event.clientY, height: height ?? list?.clientHeight ?? 240 }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      if (drag.current?.pointer === event.pointerId) change(drag.current.height + event.clientY - drag.current.y)
    }}
    onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
    onLostPointerCapture={() => { drag.current = null }}
    onKeyDown={(event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
      event.preventDefault()
      const list = event.currentTarget.parentElement?.querySelector<HTMLElement>('[data-record-list]')
      change((height ?? list?.clientHeight ?? 240) + (event.key === "ArrowUp" ? -40 : 40))
    }}>
    <span className="h-px w-8 bg-border" /><GripHorizontal className="size-3" aria-hidden="true" />기록 높이 조절<span className="h-px w-8 bg-border" />
  </div>
}
