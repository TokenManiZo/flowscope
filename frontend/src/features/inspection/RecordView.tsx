import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { KeyboardEvent, RefObject } from "react"
import { Maximize2, Minimize2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DATASET_REPLACING } from "@/lib/security/datasetBoundary"

export interface RecordView {
  focused: boolean
  toggleFocus(): void
}

/** Only changes the reading area; collection and its mounted controls keep running. */
export function useRecordView(root: RefObject<HTMLElement | null>, onFocusChange?: (focused: boolean) => void) {
  const [focused, setFocused] = useState(false)
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
    const reset = () => { savedScroll.current = []; setFocused(false); onFocusChange?.(false) }
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
  return { focused, toggleFocus, onKeyDown }
}

export function RecordViewButton({ view, onExpand }: { view: RecordView; onExpand(): void }) {
  return <Button type="button" variant="outline" size="sm" data-record-focus aria-pressed={view.focused}
    onClick={() => { onExpand(); view.toggleFocus() }}>
    {view.focused ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
    {view.focused ? "원래 크기" : "크게 보기"}
  </Button>
}
