import { useLayoutEffect, useMemo, useRef, type Ref } from "react"

import { Textarea } from "@/components/ui/textarea"
import { highlightJson, highlightRaw, rawTokenClass, type RawToken } from "./rawHighlight"
import { flattenLines, markTokens, searchMarkClass, type MarkedToken, type TextRange } from "./textSearch"

// 편집 칸과 색 층은 글자 크기·줄 높이·여백·스크롤바 자리가 한 글자도 다르면 커서가 어긋난다.
// Textarea 기본값(md:text-sm, px-2.5)을 같은 값으로 덮어써 두 층이 이 한 줄만 따르게 한다.
export const RAW_TEXT_CLASS = "min-h-64 resize-y whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-relaxed [scrollbar-gutter:stable] md:text-xs lg:min-h-[28rem]"

interface Props {
  id: string
  label: string
  value: string
  readOnly?: boolean
  disabled?: boolean
  fontSize?: number
  fill?: boolean
  wrap?: boolean
  inputRef?: Ref<HTMLTextAreaElement>
  onChange?: (value: string) => void
  /** 검색으로 찾은 위치. 비어 있으면 색만 입힌 원래 표시를 그대로 쓴다. */
  marks?: readonly TextRange[]
  /** marks 중 지금 고른 위치(-1이면 없음). */
  activeMark?: number
  /** 값이 바뀔 때마다 고른 위치가 이 패널에 있으면 그 줄이 보이게 스크롤한다. */
  revealKey?: number
}

function MarkedText({ tokens }: { tokens: readonly MarkedToken[] }) {
  return tokens.map((token, index) => token.mark
    ? <mark key={index} data-search-active={token.mark === "active" ? "" : undefined} className={`${rawTokenClass[token.kind]} ${searchMarkClass[token.mark]}`}>{token.text}</mark>
    : <span key={index} className={rawTokenClass[token.kind]}>{token.text}</span>)
}

/** 고른 검색 위치를 스크롤 상자의 가운데쯤으로 옮긴다. 위치는 표시 층(pre)에서 재고, 스크롤은 실제 상자에 준다. */
function revealActiveMark(layer: HTMLElement | null, scroller: HTMLElement | null) {
  const target = layer?.querySelector<HTMLElement>("[data-search-active]")
  if (!layer || !scroller || !target) return
  scroller.scrollTop = Math.max(0, target.offsetTop - (scroller.clientHeight - target.offsetHeight) / 2)
  if (layer !== scroller) layer.scrollTop = scroller.scrollTop
}

/**
 * 원문 편집/열람 패널. 편집 가능한 textarea 위에 같은 좌표의 하이라이트 층을 겹쳐
 * 값은 그대로 두고 색만 입힌다(Burp 유사 표시).
 */
export function RawTextPanel({ id, label, value, readOnly = false, disabled = false, onChange, fontSize = 12, fill = false, wrap = true, inputRef, marks, activeMark = -1, revealKey }: Props) {
  const highlightRef = useRef<HTMLPreElement>(null)
  const tokens = useMemo(() => value.length <= 262_144 ? highlightRaw(value) : null, [value])
  // 색을 입히지 못하는 큰 원문도 찾은 위치는 표시한다. 그때는 줄을 나누지 않고 통째로 자른다.
  const marked = useMemo(() => marks?.length ? markTokens(tokens ? flattenLines(tokens) : [{ text: value, kind: "plain" } satisfies RawToken], marks, activeMark) : null, [tokens, value, marks, activeMark])
  // 표시 층 바로 다음이 같은 좌표의 textarea다.
  useLayoutEffect(() => { if (revealKey) revealActiveMark(highlightRef.current, highlightRef.current?.nextElementSibling as HTMLElement | null) }, [revealKey])
  const textClass = fill ? "h-full min-h-0 resize-none field-sizing-fixed whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-relaxed [scrollbar-gutter:stable] md:text-xs" : RAW_TEXT_CLASS
  const layoutClass = wrap ? textClass : textClass.replace("whitespace-pre-wrap break-words", "whitespace-pre");
  const style = fontSize === 12 && !fill ? undefined : { fontSize, lineHeight: "1.65" }
  return <div className={`relative min-w-0 ${fill ? "h-full min-h-0" : ""}`}>
    <pre ref={highlightRef} aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden rounded-lg border border-transparent ${layoutClass}`} style={style}>{marked ? <><MarkedText tokens={marked} />{"\n"}</> : tokens ? tokens.map((tokens, line) => <span key={line}>{tokens.map((token, index) => <span key={index} className={rawTokenClass[token.kind]}>{token.text}</span>)}{"\n"}</span>) : value}</pre>
    <Textarea
      ref={inputRef}
      id={id}
      aria-label={label}
      spellCheck={false}
      className={`relative bg-transparent text-transparent caret-foreground ${layoutClass}`}
      style={style}
      value={value}
      readOnly={readOnly}
      disabled={disabled}
      onScroll={event => { if (highlightRef.current) { highlightRef.current.scrollTop = event.currentTarget.scrollTop; highlightRef.current.scrollLeft = event.currentTarget.scrollLeft } }}
      onChange={change => onChange?.(change.target.value)}
    />
  </div>
}

export function JsonTextPanel({ text, label, hidden, fontSize, marks, activeMark = -1, revealKey }: { text: string; label: string; hidden: boolean; fontSize: number; marks?: readonly TextRange[]; activeMark?: number; revealKey?: number }) {
  const ref = useRef<HTMLPreElement>(null)
  const lines = useMemo(() => text.length <= 65_536 && new TextEncoder().encode(text).byteLength <= 65_536 ? highlightJson(text) : null, [text])
  const marked = useMemo(() => marks?.length ? markTokens(lines ? flattenLines(lines) : [{ text, kind: "plain" } satisfies RawToken], marks, activeMark) : null, [lines, text, marks, activeMark])
  useLayoutEffect(() => { if (revealKey) revealActiveMark(ref.current, ref.current) }, [revealKey])
  return <pre ref={ref} aria-label={label} hidden={hidden} className="relative min-h-0 flex-1 overflow-auto overscroll-contain px-3 py-2 font-mono whitespace-pre [scrollbar-gutter:stable]" style={{ fontSize, lineHeight: "1.65" }}>{marked ? <MarkedText tokens={marked} /> : lines ? lines.map((tokens, line) => <span key={line}>{tokens.map((token, index) => <span key={index} className={rawTokenClass[token.kind]}>{token.text}</span>)}{line < lines.length - 1 ? "\n" : ""}</span>) : text}</pre>
}
