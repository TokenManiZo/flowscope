export interface JsonDisplay { text: string; message: string }

const MAX_BODY_BYTES = 262_144, MAX_OUTPUT_BYTES = 1_048_576, MAX_DEPTH = 128

/** 표시용: JSON 토큰은 복사하고 토큰 사이 공백만 바꾼다. Raw 전송 값은 건드리지 않는다. */
export function formatHttpJson(raw: string): JsonDisplay {
  const boundary = /\r?\n\r?\n/.exec(raw)
  const body = boundary ? raw.slice(boundary.index + boundary[0].length) : raw
  const headers = boundary ? raw.slice(0, boundary.index) : ""
  if (!body.trim()) return { text: "", message: "JSON 본문이 없습니다. Raw에서 확인하세요." }
  if (!/^[\s]*[\[{]/.test(body) && !/^content-type:\s*[^\r\n]*(?:application\/json|\+json)\b/im.test(headers)) return { text: "", message: "JSON 본문이 아닙니다. Raw에서 확인하세요." }
  if (body.length > MAX_BODY_BYTES || new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return { text: "", message: "본문이 커서 Raw로 표시합니다." }
  let cursor = 0, outputLength = 0
  const output: string[] = []
  const string = /"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"/y
  const scalar = /(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/y
  const fail = () => { throw new Error("invalid") }
  function write(value: string) {
    outputLength += value.length
    if (outputLength > MAX_OUTPUT_BYTES) throw new Error("large")
    output.push(value)
  }
  function whitespace() { while (cursor < body.length && /[ \t\r\n]/.test(body[cursor])) cursor++ }
  function token(pattern: RegExp) {
    pattern.lastIndex = cursor
    const match = pattern.exec(body)
    if (!match) return fail()
    cursor = pattern.lastIndex
    write(match[0])
  }
  function value(depth: number) {
    whitespace()
    const char = body[cursor]
    if (char === '"') { token(string); return }
    if (char !== "{" && char !== "[") { token(scalar); return }
    if (depth >= MAX_DEPTH) throw new Error("deep")
    const close = char === "{" ? "}" : "]"
    cursor++; write(char); whitespace()
    if (body[cursor] === close) { cursor++; write(close); return }
    while (true) {
      write("\n" + "  ".repeat(depth + 1))
      if (char === "{") {
        whitespace(); token(string); whitespace()
        if (body[cursor++] !== ":") fail()
        write(": ")
      }
      value(depth + 1); whitespace()
      if (body[cursor] === close) { cursor++; write("\n" + "  ".repeat(depth) + close); return }
      if (body[cursor++] !== ",") fail()
      write(",")
    }
  }
  try {
    value(0); whitespace()
    if (cursor !== body.length) fail()
    const text = output.join("")
    if (new TextEncoder().encode(text).byteLength > MAX_OUTPUT_BYTES) throw new Error("large")
    return { text, message: "" }
  } catch (error) {
    return { text: "", message: error instanceof Error && error.message === "large" ? "본문이 커서 Raw로 표시합니다." : error instanceof Error && error.message === "deep" ? "JSON 중첩이 깊어 Raw로 표시합니다." : "JSON 형식이 올바르지 않습니다. Raw에서 확인하세요." }
  }
}
