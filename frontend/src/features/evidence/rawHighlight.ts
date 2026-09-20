/**
 * 원문(요청·응답) 신택스 하이라이트 토큰. 값 자체는 바꾸지 않고 색만 입힌다.
 * 마스킹(***MASKED*** / ***)은 그대로 남기고 강조한다. 색은 --syntax-* 토큰.
 */
export type RawTokenKind = "plain" | "key" | "value" | "string" | "number" | "method" | "status" | "mask"
export interface RawToken { text: string; kind: RawTokenKind }

const MASK = /\*{3}[A-Z_]*\*{3}|\*{3}/g
const REQUEST_LINE = /^([A-Z]+)(\s+)(\S+)(\s+)(HTTP\/[\d.]+)\s*$/
const STATUS_LINE = /^(HTTP\/[\d.]+)(\s+)(\d{3})(.*)$/
const HEADER_LINE = /^([A-Za-z0-9!#$%&'*+\-.^_`|~]+)(:\s*)(.*)$/

function push(tokens: RawToken[], text: string, kind: RawTokenKind) {
  if (text) tokens.push({ text, kind })
}

/** 마스킹만 분리해 강조한다(값은 그대로 유지). */
function maskAware(text: string, kind: RawTokenKind): RawToken[] {
  const tokens: RawToken[] = []
  let index = 0
  for (const match of text.matchAll(MASK)) {
    push(tokens, text.slice(index, match.index), kind)
    push(tokens, match[0], "mask")
    index = match.index + match[0].length
  }
  push(tokens, text.slice(index), kind)
  return tokens
}

/** JSON 본문: key / 문자열 / 숫자를 구분한다. */
function bodyTokens(line: string): RawToken[] {
  const pattern = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\b\d+(?:\.\d+)?\b)|(\*{3}[A-Z_]*\*{3}|\*{3})/g
  const tokens: RawToken[] = []
  let index = 0
  for (const match of line.matchAll(pattern)) {
    push(tokens, line.slice(index, match.index), "plain")
    if (match[4]) push(tokens, match[4], "mask")
    else if (match[1]) {
      push(tokens, match[1], match[2] ? "key" : "string")
      if (match[2]) push(tokens, match[2], "plain")
    } else if (match[3]) push(tokens, match[3], "number")
    index = match.index + match[0].length
  }
  push(tokens, line.slice(index), "plain")
  return tokens
}

/** 한 원문 메시지를 줄 단위 토큰으로 나눈다. 줄바꿈은 그대로 보존한다. */
export function highlightRaw(text: string): RawToken[][] {
  const lines = text.split("\n")
  let inBody = false
  return lines.map(line => {
    if (!inBody && line.trim() === "") { inBody = true; return [{ text: line, kind: "plain" as const }] }
    if (inBody) return bodyTokens(line)
    const request = REQUEST_LINE.exec(line)
    if (request) return [
      { text: request[1], kind: "method" as const }, { text: request[2], kind: "plain" as const },
      { text: request[3], kind: "value" as const }, { text: request[4], kind: "plain" as const },
      { text: request[5], kind: "plain" as const },
    ]
    const status = STATUS_LINE.exec(line)
    if (status) return [
      { text: status[1], kind: "plain" as const }, { text: status[2], kind: "plain" as const },
      { text: status[3], kind: "status" as const }, { text: status[4], kind: "status" as const },
    ]
    const header = HEADER_LINE.exec(line)
    if (header) return [{ text: header[1], kind: "key" as const }, { text: header[2], kind: "plain" as const }, ...maskAware(header[3], "value")]
    return maskAware(line, "plain")
  })
}

export const rawTokenClass: Record<RawTokenKind, string> = {
  plain: "text-foreground",
  key: "text-syntax-key",
  value: "text-syntax-value",
  string: "text-syntax-string",
  number: "text-syntax-number",
  method: "font-semibold text-syntax-method",
  status: "text-syntax-string",
  mask: "font-semibold text-syntax-mask",
}
