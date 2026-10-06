import type { Snapshot } from "@/lib/api/types"

export const UNCONFIRMED_IDENTITY = "미확인 신원"

/**
 * 등록 계정에도 비로그인에도 연결되지 않은 신원. 서버가 붙인 자동 이름(user-e, unresolved-…)은
 * 계정처럼 보여 혼동되므로 화면에서는 모두 "미확인 신원"으로 보여 준다. 노드 키와 필터 값은 원래 idn을 그대로 쓴다.
 */
export function unconfirmedIdentities(events: Snapshot["events"]): ReadonlySet<string> {
  const unresolved = new Set<string>(), bound = new Set<string>()
  for (const event of events) {
    if (event.idn.startsWith("unresolved-") || event.authState === "UNRESOLVED") unresolved.add(event.idn)
    else bound.add(event.idn)
  }
  return new Set([...unresolved].filter(idn => idn.startsWith("unresolved-") || !bound.has(idn)))
}

export const identityName = (idn: string, unconfirmed: ReadonlySet<string>) => unconfirmed.has(idn) ? UNCONFIRMED_IDENTITY : idn
