import { describe, expect, it } from "vitest"

import { applyRequestLabCredentials } from "./requestLabCredentials"

describe("Request Lab credential projection", () => {
  it.each(["\r\n", "\n"])("replaces all managed headers with %j and preserves the exact body and ordinary headers", newline => {
    const body = '9007199254740993\nCookie: body-value\r\n{"amount":1.2300}'
    const request = ['POST /orders HTTP/2', 'Host: example.test', 'cOoKiE: old', 'Authorization: old', 'Cookie: duplicate', 'X-CSRFToken: old', 'X-Custom: keep', '', body].join(newline)
    const headers = [{ name: "Authorization", value: "Bearer DEMO" }, { name: "Cookie", value: "session=DEMO" }]
    expect(applyRequestLabCredentials(request, headers)).toBe(['POST /orders HTTP/2', 'Host: example.test', 'Authorization: Bearer DEMO', 'Cookie: session=DEMO', 'X-Custom: keep', '', body].join(newline))
    expect(request).toContain('Cookie: duplicate')
  })

  it("removes credentials for anonymous and restores original values without reverting edited content", () => {
    const request = 'GET /edited HTTP/1.1\r\nHost: example.test\r\nCookie: edited\r\nX-Custom: edited\r\n\r\nbody'
    const anonymous = applyRequestLabCredentials(request, [])
    expect(anonymous).toBe('GET /edited HTTP/1.1\r\nHost: example.test\r\nX-Custom: edited\r\n\r\nbody')
    expect(applyRequestLabCredentials(anonymous, [{ name: "Cookie", value: "original" }])).toBe('GET /edited HTTP/1.1\r\nHost: example.test\r\nX-Custom: edited\r\nCookie: original\r\n\r\nbody')
  })

  it.each(['GET / HTTP/1.1', 'GET / HTTP/1.1\r\nCookie: one\nCookie: two\r\n\r\n', 'GET / HTTP/1.1\nCookie: one\n folded\n\n'])('rejects an ambiguous header boundary: %j', request => {
    expect(() => applyRequestLabCredentials(request, [])).toThrow()
  })

  it.each([{ name: "X-Custom", value: "unexpected" }, { name: "Cookie", value: "a\r\nHost: evil" }, { name: "Authorization", value: "a\u0000b" }])("rejects invalid or unmanaged preview headers", header => {
    expect(() => applyRequestLabCredentials('GET / HTTP/1.1\nHost: example.test\n\n', [header])).toThrow()
  })
})
