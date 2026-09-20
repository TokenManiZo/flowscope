import { useRef } from "react"

import { Textarea } from "@/components/ui/textarea"
import { highlightRaw, rawTokenClass } from "./rawHighlight"

const RAW_TEXT_CLASS = "min-h-64 resize-y whitespace-pre-wrap break-words font-mono text-xs leading-relaxed lg:min-h-[28rem]"

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
    <pre ref={highlightRef} aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-3 py-2 ${RAW_TEXT_CLASS}`}>{highlightRaw(value).map((tokens, line) => <span key={line}>{tokens.map((token, index) => <span key={index} className={rawTokenClass[token.kind]}>{token.text}</span>)}{"\n"}</span>)}</pre>
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
