import { expect, it } from "vitest"
import { formatHttpJson } from "./jsonDisplay"

it("preserves numeric lexemes, duplicate keys, escapes and key order", () => {
  const raw = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"id":9007199254740993,"n":1.2300,"n":-2.0e+10,"s":"a\\u0041\\n","a":[]}'
  expect(formatHttpJson(raw)).toEqual({ text: '{\n  "id": 9007199254740993,\n  "n": 1.2300,\n  "n": -2.0e+10,\n  "s": "a\\u0041\\n",\n  "a": []\n}', message: "" })
})

it.each(['{"a":}', '[1,]', '{"a":01}', '{"a":"bad\\x"}', '{"a":true} trailing', '{"a":"line\nbreak"}', '{"a" 1}', '{a:1}'])("rejects malformed JSON: %s", body => {
  expect(formatHttpJson(body).text).toBe("")
  expect(formatHttpJson(body).message).toContain("올바르지")
})

it("bounds UTF-8 body size, nesting and expanded output", () => {
  expect(formatHttpJson('{"a":"' + "가".repeat(90_000) + '"}').message).toContain("커서")
  expect(formatHttpJson("[".repeat(129) + "0" + "]".repeat(129)).message).toContain("중첩")
  expect(formatHttpJson("[".repeat(100) + Array(10_000).fill("0").join(",") + "]".repeat(100)).message).toContain("커서")
  expect(formatHttpJson("HTTP/1.1 204 No Content\r\n\r\n").message).toContain("없습니다")
  expect(formatHttpJson("HTTP/1.1 200 OK\nContent-Type: text/plain\n\nhello").message).toContain("아닙니다")
  expect(formatHttpJson("HTTP/1.1 200 OK\nContent-Type: application/problem+json\n\nnull").text).toBe("null")
})
