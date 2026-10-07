import type { RawToken } from "./rawHighlight"

/** 원문 안의 [start, end) 글자 범위. */
export interface TextRange { start: number; end: number }

export type SearchMark = "match" | "active"
export type MarkedToken = RawToken & { mark?: SearchMark }

/** 긴 원문에서 한 글자만 쳐도 화면이 멈추지 않게, 찾은 위치는 이만큼까지만 센다. */
export const MAX_SEARCH_MATCHES = 5000

/** 대소문자를 가리지 않고 query를 글자 그대로 찾는다. 겹치지 않는 위치를 앞에서부터 돌려준다. */
export function findMatches(text: string, query: string): TextRange[] {
  if (!query || !text) return []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
  const ranges: TextRange[] = []
  for (const match of text.matchAll(pattern)) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
    if (ranges.length >= MAX_SEARCH_MATCHES) break
  }
  return ranges
}

/** 줄 단위 토큰을 한 줄로 편다. 이어 붙이면 원문과 같도록 줄 사이에만 "\n"을 넣는다. */
export function flattenLines(lines: readonly RawToken[][]): RawToken[] {
  const tokens: RawToken[] = []
  lines.forEach((line, index) => {
    if (index > 0) tokens.push({ text: "\n", kind: "plain" })
    tokens.push(...line)
  })
  return tokens
}

/** 토큰을 찾은 범위 경계에서 잘라 표시를 붙인다. 색(kind)은 그대로 두고 글자도 바꾸지 않는다. */
export function markTokens(tokens: readonly RawToken[], ranges: readonly TextRange[], active: number): MarkedToken[] {
  const marked: MarkedToken[] = []
  let offset = 0
  let next = 0
  for (const token of tokens) {
    const end = offset + token.text.length
    let cursor = offset
    while (next < ranges.length && ranges[next].start < end) {
      const range = ranges[next]
      const from = Math.max(range.start, cursor)
      const to = Math.min(range.end, end)
      if (from > cursor) marked.push({ text: token.text.slice(cursor - offset, from - offset), kind: token.kind })
      if (to > from) marked.push({ text: token.text.slice(from - offset, to - offset), kind: token.kind, mark: next === active ? "active" : "match" })
      cursor = Math.max(cursor, to)
      // 범위가 다음 토큰까지 이어지면 같은 범위로 다음 토큰을 계속 자른다.
      if (range.end > end) break
      next++
    }
    if (cursor < end) marked.push({ text: token.text.slice(cursor - offset), kind: token.kind })
    offset = end
  }
  return marked
}

export const searchMarkClass: Record<SearchMark, string> = {
  match: "rounded-[2px] bg-amber-300/45 dark:bg-amber-400/35",
  active: "rounded-[2px] bg-orange-400/85 dark:bg-orange-500/75",
}
