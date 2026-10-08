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
  return hasEvidenceOrdinal(ordinals, eventId) ? `#${ordinals![eventId]}` : eventId
}

/** 순번이 있는 기록만 #N으로 바꾼다. 순번이 없는 기록(삭제됐거나 지금 분석에 없는 기록)은 열 수 없어 빼고 센다. */
export function evidenceOrdinalLabels(ordinals: Readonly<Record<string, number>> | undefined, eventIds: readonly string[]): string[] {
  const labels = eventIds.filter(id => hasEvidenceOrdinal(ordinals, id)).map(id => `#${ordinals![id]}`)
  return [...new Set(labels)]
}

export function hasEvidenceOrdinal(ordinals: Readonly<Record<string, number>> | undefined, eventId: string): boolean {
  const ordinal = ordinals?.[eventId]
  return typeof ordinal === "number" && Number.isFinite(ordinal)
}

/** 서버가 보낸 문장 안의 Evidence ID(ev-…)를 순번으로 바꿔 보여 준다. 순번이 없으면 원래 ID를 그대로 둔다. */
export function withEvidenceOrdinals(text: string, ordinals: Readonly<Record<string, number>> | undefined): string {
  return text.replace(/\bev-[0-9a-f]{8,}\b/g, id => evidenceOrdinalLabel(ordinals, id))
}

/** 아직 번호가 없는 기록 ID(" · ev-…")를 문장에서 뺀다. 번호가 붙기 전 진행 기록에 긴 ID가 보이지 않게 한다. */
export function withoutUnnumberedEvidence(text: string): string {
  return text.replace(/\s*·\s*ev-[0-9a-f]{8,}\b/g, "")
}

const observedTimeFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "medium" })

/** 관측 시각(epoch ms). 최초=최종이면 한 번, 반복이면 범위. 0·음수는 가져오기에서 시각을 읽지 못한 값이다. */
export function observedTimeLabel(firstSeen: number, lastSeen: number): string {
  if (!(firstSeen > 0)) return "시각 미상"
  const first = observedTimeFormat.format(firstSeen)
  return lastSeen > firstSeen ? `${first} ~ ${observedTimeFormat.format(lastSeen)}` : first
}
