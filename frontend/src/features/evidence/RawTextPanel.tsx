import { useRef } from "react"

import { Textarea } from "@/components/ui/textarea"
import { highlightRaw, rawTokenClass } from "./rawHighlight"

// 편집 칸과 색 층은 글자 크기·줄 높이·여백·스크롤바 자리가 한 글자도 다르면 커서가 어긋난다.
// Textarea 기본값(md:text-sm, px-2.5)을 같은 값으로 덮어써 두 층이 이 한 줄만 따르게 한다.
export const RAW_TEXT_CLASS = "min-h-64 resize-y whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-relaxed [scrollbar-gutter:stable] md:text-xs lg:min-h-[28rem]"

interface Props {
  id: string
  label: string
  value: string
  readOnly?: boolean
  disabled?: boolean
  onChange?: (value: string) => void
}

/**
 * 원문 편집/열람 패널. 편집 가능한 textarea 위에 같은 좌표의 하이라이트 층을 겹쳐
 * 값은 그대로 두고 색만 입힌다(Burp 유사 표시).
 */
export function RawTextPanel({ id, label, value, readOnly = false, disabled = false, onChange }: Props) {
  const highlightRef = useRef<HTMLPreElement>(null)
  return <div className="relative min-w-0">
    <pre ref={highlightRef} aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden rounded-lg border border-transparent ${RAW_TEXT_CLASS}`}>{highlightRaw(value).map((tokens, line) => <span key={line}>{tokens.map((token, index) => <span key={index} className={rawTokenClass[token.kind]}>{token.text}</span>)}{"\n"}</span>)}</pre>
    <Textarea
      id={id}
      aria-label={label}
      spellCheck={false}
      className={`relative bg-transparent text-transparent caret-foreground ${RAW_TEXT_CLASS}`}
      value={value}
      readOnly={readOnly}
      disabled={disabled}
      onScroll={event => { if (highlightRef.current) highlightRef.current.scrollTop = event.currentTarget.scrollTop }}
      onChange={change => onChange?.(change.target.value)}
    />
  </div>
}
