import { useRef, useState, type CSSProperties } from "react"
import { Copy, Expand, WrapText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { RawTextPanel } from "./RawTextPanel"

type Part = "all" | "headers" | "body"
function section(text: string, part: Part) {
  if (part === "all") return text
  const separator = /\r?\n\r?\n/.exec(text)
  return part === "headers" ? text.slice(0, separator?.index ?? text.length) : separator ? text.slice(separator.index + separator[0].length) : ""
}

/** Server-retained Evidence belongs here. Request Lab live drafts remain separate. */
export function EvidenceHttpViewer({ request, response }: { request: string; response: string }) {
  const [font, setFont] = useState(13)
  const [wrap, setWrap] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [ratio, setRatio] = useState(50)
  const [parts, setParts] = useState<{ request: Part; response: Part }>({ request: "all", response: "all" })
  const [message, setMessage] = useState("")
  const expandButton = useRef<HTMLButtonElement>(null)
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setMessage("표시 내용을 복사했습니다.") }
    catch { setMessage("복사할 수 없습니다. 원문에서 텍스트를 선택해 복사하세요.") }
  }
  function content(fullscreen: boolean) {
    return <section aria-label="요청 응답 비교" className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-card ${fullscreen ? "h-full" : "h-[36rem] max-h-[70vh] min-h-80"}`}>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <h3 className="mr-auto text-sm font-semibold">요청·응답</h3>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">글자<select aria-label="관측 원문 글자 크기" className="h-8 rounded border bg-background px-2" value={font} onChange={event => setFont(Number(event.target.value))}>{[12,13,14,16].map(size => <option value={size} key={size}>{size}px</option>)}</select></label>
        <Button size="sm" variant="outline" aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapText className="size-3.5" />줄바꿈</Button>
        {!fullscreen && <Button ref={expandButton} size="sm" variant="outline" onClick={() => setExpanded(true)}><Expand className="size-3.5" />원문 확대</Button>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {(["request", "response"] as const).map((side, index) => {
          const value = section(side === "request" ? request : response, parts[side])
          return <div key={side} className="contents">
            {index === 1 && <div role="separator" aria-label="요청 응답 너비 조절" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={ratio} tabIndex={0} className="hidden w-2 shrink-0 cursor-col-resize touch-none bg-muted hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-primary sm:block" onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setRatio(value => Math.max(30, Math.min(70, value + (event.key === "ArrowLeft" ? -2 : 2)))) } }} onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { const bounds = event.currentTarget.parentElement!.getBoundingClientRect(); setRatio(Math.max(30, Math.min(70, Math.round((event.clientX - bounds.left) / bounds.width * 100)))) } }} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />}
            <section aria-label={side === "request" ? "요청 원문 패널" : "응답 원문 패널"} className="flex min-h-0 min-w-0 w-full flex-1 flex-col border-b last:border-b-0 sm:w-[var(--raw-width)] sm:flex-none sm:border-b-0" style={{ "--raw-width": `calc(${side === "request" ? ratio : 100-ratio}% - 4px)` } as CSSProperties}>
              <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2"><strong className="mr-auto text-xs">{side === "request" ? "Request" : "Response"}</strong><Button size="icon-sm" variant="ghost" aria-label={`${side === "request" ? "요청" : "응답"} 복사`} disabled={!value} onClick={() => void copy(value)}><Copy className="size-3.5" /></Button></header>
              <div className="flex shrink-0 gap-1 border-b px-2 py-1">{([["all","전체"],["headers","헤더"],["body","본문"]] as const).map(([part,label]) => <Button size="sm" variant={parts[side] === part ? "secondary" : "ghost"} className="h-7 text-xs" aria-label={`${side === "request" ? "요청" : "응답"} ${label}`} aria-pressed={parts[side] === part} key={part} onClick={() => setParts(current => ({ ...current, [side]: part }))}>{label}</Button>)}<span className="ml-auto self-center text-[10px] text-muted-foreground">읽기 전용</span></div>
              <div className="min-h-0 flex-1"><RawTextPanel id={`evidence-${side}-${fullscreen ? "expanded" : "inline"}`} label={side === "request" ? "요청 원문" : "응답 원문"} value={value || (parts[side] === "body" ? "본문이 없습니다." : "보존된 전문이 없습니다.")} readOnly fill fontSize={font} wrap={wrap} /></div>
            </section>
          </div>
        })}
      </div>
      <footer className="shrink-0 border-t px-3 py-1 text-[11px] text-muted-foreground">관측본 · 각 패널 독립 스크롤 · 읽기 전용</footer>
      {message && <p role="status" className="shrink-0 border-t px-3 py-1 text-xs">{message}</p>}
    </section>
  }
  return <>{!expanded && content(false)}<Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-2 sm:max-w-none" onCloseAutoFocus={event => { event.preventDefault(); expandButton.current?.focus() }}><DialogTitle>요청·응답 확대</DialogTitle><DialogDescription className="sr-only">읽기 전용 요청과 응답을 비교합니다. Escape로 닫습니다.</DialogDescription>{content(true)}</DialogContent></Dialog></>
}
