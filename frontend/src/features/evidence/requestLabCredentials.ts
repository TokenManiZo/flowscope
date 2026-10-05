import type { RequestLabCredentialHeader } from "@/lib/api/types"

const managed = /^(authorization|cookie|proxy-authorization|x-csrf-token|x-xsrf-token|x-csrftoken)$/i
const headerLine = /^[!#$%&'*+.^_`|~\w-]+:[^\r\n]*$/

/** Replace only managed header lines; preserve the request line, other headers and exact body. */
export function applyRequestLabCredentials(request: string, headers: readonly RequestLabCredentialHeader[]): string {
  const boundary = /\r\n\r\n|\n\n/.exec(request)
  if (!boundary) throw new Error("요청의 헤더와 본문 구분을 확인해 주세요.")
  const head = request.slice(0, boundary.index)
  const newline = boundary[0].startsWith("\r") ? "\r\n" : "\n"
  const lines = head.split(newline)
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(head) || !/^\S+ \S+ HTTP\/\d(?:\.\d)?$/.test(lines[0] ?? "") || lines.slice(1).some(line => !headerLine.test(line))) {
    throw new Error("요청줄과 헤더 형식을 확인해 주세요. 인증을 바꾸지 않았습니다.")
  }
  if (headers.some(header => !managed.test(header.name) || !headerLine.test(`${header.name}:${header.value}`)
    || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(header.value))) {
    throw new Error("인증 헤더를 적용하지 못했습니다. 다시 선택해 주세요.")
  }
  const first = lines.findIndex((line, index) => index > 0 && managed.test(line.slice(0, line.indexOf(":"))))
  const kept = lines.filter((line, index) => index === 0 || !managed.test(line.slice(0, line.indexOf(":"))))
  kept.splice(first < 0 ? kept.length : first, 0, ...headers.map(header => `${header.name}: ${header.value}`))
  return kept.join(newline) + request.slice(boundary.index)
}
