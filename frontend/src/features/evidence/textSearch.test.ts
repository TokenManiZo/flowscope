import { describe, expect, it } from "vitest"

import { highlightRaw } from "./rawHighlight"
import { findMatches, flattenLines, markTokens, MAX_SEARCH_MATCHES } from "./textSearch"

describe("findMatches", () => {
  it("finds literal text without case and treats regex characters as plain text", () => {
    expect(findMatches("Token token TOKEN", "token")).toEqual([{ start: 0, end: 5 }, { start: 6, end: 11 }, { start: 12, end: 17 }])
    expect(findMatches("a.b axb (a.b)", "a.b")).toEqual([{ start: 0, end: 3 }, { start: 9, end: 12 }])
    expect(findMatches("[x]", "[")).toEqual([{ start: 0, end: 1 }])
  })

  it("returns nothing for an empty query or text and stops counting at the limit", () => {
    expect(findMatches("abc", "")).toEqual([])
    expect(findMatches("", "a")).toEqual([])
    expect(findMatches("a".repeat(MAX_SEARCH_MATCHES + 10), "a")).toHaveLength(MAX_SEARCH_MATCHES)
  })
})

describe("markTokens", () => {
  it("keeps the original text and colors while splitting at match edges, including across tokens and lines", () => {
    const text = "GET /a HTTP/1.1\r\nAuthorization: Bearer abc\r\n\r\n{\"token\":\"abc\"}"
    const tokens = flattenLines(highlightRaw(text))
    expect(tokens.map(token => token.text).join("")).toBe(text)
    const ranges = [...findMatches(text, "abc"), ...findMatches(text, "n: B")].sort((left, right) => left.start - right.start)
    const marked = markTokens(tokens, ranges, 1)
    expect(marked.map(token => token.text).join("")).toBe(text)
    expect(marked.filter(token => token.mark).map(token => [token.text, token.mark])).toEqual([
      // "n: B"는 헤더 이름(key)·구분자·값 세 토큰에 걸친다.
      ["n", "match"], [": ", "match"], ["B", "match"],
      ["abc", "active"],
      ["abc", "match"],
    ])
    expect(marked.find(token => token.text === "n" && token.mark)?.kind).toBe("key")
  })

  it("marks a plain single token for text too large to color", () => {
    const marked = markTokens([{ text: "xx-yy-xx", kind: "plain" }], findMatches("xx-yy-xx", "xx"), 0)
    expect(marked).toEqual([{ text: "xx", kind: "plain", mark: "active" }, { text: "-yy-", kind: "plain" }, { text: "xx", kind: "plain", mark: "match" }])
  })
})
