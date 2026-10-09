import type { EventRecord } from "@/lib/api/types"

const resendDetails = new Set(["BURP_REPEATER", "BURP_INTRUDER"])

/** API 경로에서 열 때는 계정·판정 근거와 무관하게 해당 API의 가장 최근 요청을 보여 준다. */
export function latestOperationEvent(events: readonly EventRecord[], operation: string): EventRecord | undefined {
  return events.filter(event => event.op === operation)
    .reduce<EventRecord | undefined>((latest, event) => !latest || event.timestamp >= latest.timestamp ? event : latest, undefined)
}

/**
 * 판정 칸에서 Request Lab으로 열 기록을 고른다. Request Lab은 원문(메모리 또는 저장본)이 온전한 기록만 편집·재전송할 수 있다.
 * 판정 근거 기록이 저장 한도를 넘어 일부만 남았으면 같은 API의 다른 기록을 연다.
 * 그래서 원문이 남은 기록을 이 순서로 찾는다: 근거 기록 → 같은 API의 같은 신원·같은 객체 → 같은 신원 → 같은 객체 → 같은 API.
 * 값을 바꿔 다시 보낸 기록(Request Lab 결과·Repeater·Intruder)은 원본이 아니므로 고르지 않는다. 없으면 근거 기록을 연다.
 */
export function requestLabEvent(events: readonly EventRecord[], operation: string, basisId: string | undefined, resource: string | null): EventRecord | undefined {
  const basis = basisId ? events.find(event => event.eventId === basisId || event.clusterEvidenceIds?.includes(basisId)) : undefined
  if (basis?.rawAvailable) return basis
  const originals = events.filter(event => event.op === operation && event.phase !== "VALIDATION" && !resendDetails.has(event.sourceDetail))
    .sort((left, right) => right.timestamp - left.timestamp)
  const live = originals.filter(event => event.rawAvailable)
  const identity = basis?.idn
  return live.find(event => event.idn === identity && (!resource || event.resource === resource))
    ?? live.find(event => event.idn === identity)
    ?? (resource ? live.find(event => event.resource === resource) : undefined)
    ?? live[0]
    ?? basis
    ?? originals[0]
}
