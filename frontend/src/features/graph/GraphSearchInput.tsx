import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { searchKindNames, type GraphSearchEntry, type GraphSearchResults } from "./graphSearch"

interface Props {
  query: string
  results: GraphSearchResults
  disabled: boolean
  searching: boolean
  canvas: RefObject<HTMLDivElement | null>
  onQuery(query: string): void
  onMore(): void
  onChoose(entry: GraphSearchEntry): void
}

/** 검색 입력에만 키보드 동작을 연결한다. 그래프·Request Lab 단축키는 가로채지 않는다. */
export function GraphSearchInput({ query, results, disabled, searching, canvas, onQuery, onMore, onChoose }: Props) {
  const id = useId(), input = useRef<HTMLInputElement>(null), root = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [activeKey, setActiveKey] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState<Element | null>(null)
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === canvas.current ? document.fullscreenElement : null)
    document.addEventListener("fullscreenchange", changed)
    return () => document.removeEventListener("fullscreenchange", changed)
  }, [canvas])
  const entries = results.entries
  const active = entries.findIndex(entry => entry.key === activeKey)
  const expanded = open && !!query.trim()
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 320, height: 320 })
  useLayoutEffect(() => {
    if (!expanded) return
    const place = () => {
      const rect = input.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(rect.width, Math.max(0, window.innerWidth - 32))
      const top = rect.bottom + 4
      const next = { left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), top, width, height: Math.max(80, Math.min(320, window.innerHeight - top - 88)) }
      setBounds(current => current.left === next.left && current.top === next.top && current.width === next.width && current.height === next.height ? current : next)
    }
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place)
    if (root.current) observer?.observe(root.current)
    if (root.current?.parentElement) observer?.observe(root.current.parentElement)
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener("pointerdown", outside)
    return () => { observer?.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("pointerdown", outside) }
  }, [expanded, fullscreen])
  useEffect(() => {
    if (!expanded) return
    popup.current?.querySelector<HTMLElement>('[data-search-active="true"]')?.scrollIntoView?.({ block: "nearest" })
  }, [activeKey, expanded])
  const choose = (entry: GraphSearchEntry) => { if (!disabled && !searching) { onChoose(entry); setOpen(false); input.current?.focus() } }
  const blur = (target: EventTarget | null) => { if (!root.current?.contains(target as Node | null) && !popup.current?.contains(target as Node | null)) setOpen(false) }
  const content = <div ref={root} className={fullscreen ? "absolute right-3 top-11 z-30 w-80" : "relative min-w-48 flex-1"}
    onBlur={event => blur(event.relatedTarget)}>
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
      <Input ref={input} role="combobox" aria-label="프로젝트 전체 노드 검색" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-results` : undefined}
        aria-activedescendant={expanded && active >= 0 ? `${id}-result-${active}` : undefined} value={query} placeholder="서비스, API, 객체 ID, 계정 검색" className="h-9 bg-[var(--flowscope-pane)] pl-8 pr-8 text-sm"
        onFocus={() => setOpen(true)} onChange={event => { onQuery(event.target.value); setActiveKey(null); setOpen(true) }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false) }
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true)
            const next = active < 0 ? event.key === "ArrowDown" ? 0 : entries.length - 1 : Math.max(0, Math.min(entries.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)))
            setActiveKey(entries[next]?.key ?? null)
          } else if (event.key === "Enter" && expanded && entries[active >= 0 ? active : 0]) { event.preventDefault(); choose(entries[active >= 0 ? active : 0]) }
        }} />
      {query && <button type="button" aria-label="노드 검색 지우기" className="absolute right-1 top-1 flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" onClick={() => { onQuery(""); setActiveKey(null); input.current?.focus() }}><X className="size-3.5" aria-hidden="true" /></button>}
    </div>
    {expanded && createPortal(<div ref={popup} className="fixed z-50 overflow-hidden rounded-md border border-border bg-[var(--flowscope-pane)] shadow-md" style={{ left: bounds.left, top: bounds.top, width: bounds.width }} onBlur={event => blur(event.relatedTarget)} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); input.current?.focus() } }}>
      <p role="status" className="border-b border-border px-3 py-2 text-xs text-muted-foreground">{disabled ? "마지막 조회 결과 · 데이터 조회 후 이동할 수 있습니다." : searching ? "검색 중…" : `검색 결과 ${results.total}개`}</p>
      <div role="listbox" id={`${id}-results`} aria-label="노드 검색 결과" className="overflow-y-auto" style={{ maxHeight: bounds.height }}>
        {!searching && !entries.length && <p className="px-3 py-5 text-sm text-muted-foreground">검색 결과가 없습니다. 검색어를 바꿔 보세요.</p>}
        {entries.map((entry, index) => <div key={entry.key} role="option" id={`${id}-result-${index}`} aria-selected={activeKey === entry.key} aria-disabled={disabled || searching} data-search-active={activeKey === entry.key} aria-label={`${searchKindNames[entry.kind]} ${entry.title}${results.hosts?.get(entry.key) ? ` ${results.hosts.get(entry.key)}` : ""}`} aria-description={`${entry.service}; ${entry.contexts.map(context => `${context.groupLabel}: ${context.operation}`).join("; ")}`} title={`${entry.service} · ${entry.contexts[0]?.operation ?? ""}`}
          className={`flex min-h-12 cursor-pointer items-center gap-2 border-b border-border px-3 py-2.5 last:border-0 hover:bg-muted/50 ${activeKey === entry.key ? "bg-muted" : ""} ${disabled || searching ? "cursor-default opacity-60" : ""}`}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(entry)}>
          <span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-300">{searchKindNames[entry.kind]}</span><span className="min-w-0 flex-1 truncate font-mono text-sm">{entry.title}</span>
          {results.hosts?.get(entry.key) && <span className="shrink-0 rounded border px-1.5 py-0.5 text-xs text-muted-foreground">{results.hosts.get(entry.key)}</span>}
        </div>)}
      </div>
      {entries.length < results.total && <Button type="button" variant="ghost" size="sm" className="w-full rounded-none" disabled={searching} onClick={onMore}>결과 30개 더 보기</Button>}
    </div>, fullscreen ?? document.body)}
  </div>
  return fullscreen ? createPortal(content, fullscreen) : content
}
