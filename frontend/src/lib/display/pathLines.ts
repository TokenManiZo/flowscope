/**
 * 표시 전용 API 경로 줄바꿈. 서버 값은 바꾸지 않는다.
 * `/` 구간 경계에서 최대 maxLines 줄로 나누고, 넘치면 앞쪽을 `…`로 줄여 식별에 중요한 끝부분(자원·ID)을 남긴다.
 */
export function wrapPath(path: string, fits: (line: string) => boolean, maxLines = 2): string[] {
  const segments = path.match(/\/[^/]*|^[^/]+/g) ?? [path]
  const greedy = (parts: readonly string[]) => {
    const lines: string[] = []
    let current = ""
    for (const part of parts) {
      if (current && !fits(current + part)) { lines.push(current); current = part } else current += part
    }
    if (current) lines.push(current)
    return lines
  }
  const whole = greedy(segments)
  if (whole.length <= maxLines) return whole
  for (let start = 1; start < segments.length; start++) {
    const trimmed = greedy([`…${segments[start]}`, ...segments.slice(start + 1)])
    if (trimmed.length <= maxLines) return trimmed
  }
  return [`…${segments[segments.length - 1]}`]
}

/**
 * API 그룹(첫 안정 구간, api·rest·vN 제외)까지의 접두를 뺀 경로. 그룹 이름이 화면에 이미 보일 때만 쓴다.
 * 그룹 뒤에 두 구간 이상 남을 때만 줄인다(`/api/orders/{id}`를 `/{id}`로 만들지 않는다).
 */
export function pathAfterGroup(path: string): string {
  const parts = path.split("/").filter(Boolean)
  let index = 0
  while (index < parts.length - 1 && (/^(api|rest)$/i.test(parts[index]) || /^v\d+(?:\.\d+)?$/i.test(parts[index]))) index += 1
  const rest = parts.slice(index + 1)
  return rest.length >= 2 ? `/${rest.join("/")}${path.endsWith("/") ? "/" : ""}` : path
}
