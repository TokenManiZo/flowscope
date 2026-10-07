import { managedCredentialHeader } from "./requestLabCredentials"
import type { TextRange } from "./textSearch"

/** 마스킹을 없애기 전 버전이 값 대신 저장한 표시. 그 버전으로 저장한 프로젝트에는 원래 값이 남아 있지 않다. */
const LEGACY_MASK = /\*\*\*MASKED\*\*\*|\[BODY REDACTED:[^\]\r\n]*\]/g
/** 쿠키는 이름만 남기고 값을 "***"로 저장했다. */
const LEGACY_COOKIE_VALUE = /=(\*\*\*)(?=\s*(?:;|$))/g

/**
 * 보낼 요청에서 예전 마스킹 표시 위치를 찾는다. 계정·비로그인 전송은 인증 헤더를 서버가 바꾸므로
 * skipManagedHeaders면 그 헤더 줄은 세지 않는다. 직접 입력은 쓴 그대로 나가므로 모두 센다.
 */
export function findLegacyMasks(request: string, skipManagedHeaders: boolean): TextRange[] {
  const ranges: TextRange[] = []
  let offset = 0
  let inBody = false
  for (const line of request.split("\n")) {
    const text = line.endsWith("\r") ? line.slice(0, -1) : line
    if (!inBody && offset > 0 && text.trim() === "") inBody = true
    const name = inBody || offset === 0 ? "" : text.slice(0, Math.max(0, text.indexOf(":")))
    if (!(skipManagedHeaders && name && managedCredentialHeader.test(name))) {
      for (const match of text.matchAll(LEGACY_MASK)) ranges.push({ start: offset + match.index, end: offset + match.index + match[0].length })
      if (/^(?:set-)?cookie$/i.test(name)) {
        for (const match of text.matchAll(LEGACY_COOKIE_VALUE)) ranges.push({ start: offset + match.index + 1, end: offset + match.index + 4 })
      }
    }
    offset += line.length + 1
  }
  return ranges.sort((left, right) => left.start - right.start)
}
