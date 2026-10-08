import { useRef, type KeyboardEvent, type PointerEvent } from "react"
import { GripVertical } from "lucide-react"

export const OPERATION_COLUMN_DEFAULT_WIDTH = 320
const MIN_WIDTH = 160
const MAX_WIDTH = 640

export function OperationColumnResizeHandle({ width, onWidthChange }: { width: number; onWidthChange(width: number): void }) {
  const drag = useRef<{ id: number; x: number; width: number } | null>(null)
  const resize = (next: number) => onWidthChange(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next)))
  const release = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") resize(width - 16)
    else if (event.key === "ArrowRight") resize(width + 16)
    else if (event.key === "Home") resize(MIN_WIDTH)
    else if (event.key === "End") resize(MAX_WIDTH)
    else return
    event.preventDefault()
  }
  return <div role="separator" aria-label="API 열 너비 조절" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width} tabIndex={0}
    title="드래그 또는 방향키로 API 열 너비 조절 · 더블클릭으로 기본 너비 복원"
    style={{ left: width - 16 }}
    className="group absolute inset-y-0 z-40 flex w-4 touch-none cursor-col-resize select-none items-center justify-center border-r border-border hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    onPointerDown={event => { event.preventDefault(); drag.current = { id: event.pointerId, x: event.clientX, width }; event.currentTarget.setPointerCapture?.(event.pointerId) }}
    onPointerMove={event => { if (drag.current?.id === event.pointerId) resize(drag.current.width + event.clientX - drag.current.x) }}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={() => { drag.current = null }} onKeyDown={onKeyDown}
    onDoubleClick={() => onWidthChange(OPERATION_COLUMN_DEFAULT_WIDTH)}>
    <GripVertical aria-hidden="true" className="pointer-events-none size-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
  </div>
}
