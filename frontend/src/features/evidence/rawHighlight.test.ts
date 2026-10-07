import { describe, expect, it } from "vitest"

import { highlightRaw } from "./rawHighlight"

const kinds = (line: ReturnType<typeof highlightRaw>[number]) => line.map(token => [token.kind, token.text])

describe("highlightRaw", () => {
  it("colours header keys and the status line in CRLF messages without changing the text", () => {
    const raw = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCookie: sid=abc123\r\n\r\n{\"id\":24}"
    const lines = highlightRaw(raw)
    expect(kinds(lines[0])).toEqual([["plain", "HTTP/1.1"], ["plain", " "], ["status", "200"], ["status", " OK"], ["plain", "\r"]])
    expect(kinds(lines[1])).toEqual([["key", "Content-Type"], ["plain", ": "], ["value", "application/json"], ["plain", "\r"]])
    expect(kinds(lines[2])).toEqual([["key", "Cookie"], ["plain", ": "], ["value", "sid=abc123"], ["plain", "\r"]])
    expect(lines.map(line => line.map(token => token.text).join("")).join("\n")).toBe(raw)
  })

  it("keeps LF messages unchanged", () => {
    const lines = highlightRaw("GET /a HTTP/1.1\nHost: x")
    expect(kinds(lines[0])[0]).toEqual(["method", "GET"])
    expect(kinds(lines[1])).toEqual([["key", "Host"], ["plain", ": "], ["value", "x"]])
  })
})
