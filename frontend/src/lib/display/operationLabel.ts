/**
 * 표시 전용 라벨 헬퍼. 서버 값(machine key·operation·eventId)은 절대 바꾸지 않고
 * 화면에 보이는 문자열만 정리한다.
 */

const ORIGIN_PATTERN = /https?:\/\/[^\s/?#]+/gi

/** 오리진(scheme://host[:port]) 접두어를 표시에서 제거한다. 쿼리스트링은 유지한다. */
export function stripOrigin(value: string): string {
  return value.replace(ORIGIN_PATTERN, "").replace(/\s{2,}/g, " ").trim()
}

/** 값에 포함된 첫 오리진. 없으면 null. */
export function originOf(value: string): string | null {
  const match = value.match(/https?:\/\/[^\s/?#]+/i)
  return match ? match[0] : null
}

/**
 * 한 프로젝트에 오리진이 2개 이상 섞였는지. 섞였을 때만 오리진을 옅은 보조 텍스트로
 * 병기하면 되고, 하나면 완전히 숨긴다.
 */
export function uniqueOrigins(values: Iterable<string>): readonly string[] {
  const origins = new Set<string>()
  for (const value of values) {
    const origin = originOf(value)
    if (origin) origins.add(origin)
  }
  return [...origins].sort()
}

/** Evidence 순번 표시. 서버 snapshot.evidenceOrdinals에 없으면 원본 id로 폴백한다. */
export function evidenceOrdinalLabel(ordinals: Readonly<Record<string, number>> | undefined, eventId: string): string {
  const ordinal = ordinals?.[eventId]
  return typeof ordinal === "number" && Number.isFinite(ordinal) ? `#${ordinal}` : eventId
}
