const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isIdSegment(segment: string) {
  return /^\d+$/.test(segment) || UUID.test(segment) || (segment.length >= 16 && /^[a-z0-9]+$/i.test(segment) && /[a-z]/i.test(segment) && /\d/.test(segment))
}

/** 숫자·UUID·16자 이상 영문+숫자 토큰 구간을 `{id}`로 바꾼 경로 형식. API 목록 표와 그래프의 API 묶음이 같은 기준을 쓴다. */
export function pathShape(path: string) {
  return path.split("/").map(segment => isIdSegment(segment) ? "{id}" : segment).join("/")
}

/** op("서비스 METHOD /path" 또는 "METHOD /path")의 경로만 형식으로 바꾼 묶음 키. 서비스·메서드가 다르면 다른 묶음이다. */
export function operationShapeKey(op: string) {
  const match = op.match(/^(.*?\b(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|TRACE|CONNECT|UNKNOWN))\s+(.+)$/i)
  return match ? `${match[1]} ${pathShape(match[2])}` : op
}
