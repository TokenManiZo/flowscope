import { describe, expect, it } from "vitest"

import { findLegacyMasks } from "./legacyMasks"

const request = [
  "POST /login?api_key=***MASKED*** HTTP/1.1",
  "Host: api.example.test",
  "Authorization: ***MASKED***",
  "Cookie: theme=dark; session=***; csrftoken=***",
  "X-Api-Key: ***MASKED***",
  "",
  '{"email":"a@example.test","password":"***MASKED***","note":"a=***"}',
].join("\r\n")

const textAt = (ranges: ReturnType<typeof findLegacyMasks>) => ranges.map(range => request.slice(range.start, range.end))

describe("findLegacyMasks", () => {
  it("finds every old masking mark when the request is sent as written", () => {
    expect(textAt(findLegacyMasks(request, false))).toEqual(["***MASKED***", "***MASKED***", "***", "***", "***MASKED***", "***MASKED***"])
  })

  it("skips the credential headers that account and anonymous sends replace", () => {
    const ranges = findLegacyMasks(request, true)
    expect(textAt(ranges)).toEqual(["***MASKED***", "***MASKED***", "***MASKED***"])
    // 요청줄의 쿼리, 교체되지 않는 X-Api-Key, 본문 비밀번호만 남는다.
    expect(ranges.map(range => request.lastIndexOf("\n", range.start))).toEqual([-1, request.indexOf("\nX-Api-Key"), request.lastIndexOf("\n")])
  })

  it("finds unparsable body placeholders and ignores real values", () => {
    const redacted = "POST / HTTP/1.1\n\n[BODY REDACTED: secret-bearing content could not be parsed]"
    expect(findLegacyMasks(redacted, true).map(range => redacted.slice(range.start, range.end))).toEqual(["[BODY REDACTED: secret-bearing content could not be parsed]"])
    expect(findLegacyMasks("GET / HTTP/1.1\nCookie: session=abc\n\n{\"a\":\"***\"}", false)).toEqual([])
  })
})
