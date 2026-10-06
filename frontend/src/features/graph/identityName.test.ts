import { describe, expect, it } from "vitest"
import type { EventRecord } from "@/lib/api/types"
import { identityName, unconfirmedIdentities, UNCONFIRMED_IDENTITY } from "./identityName"

const event = (idn: string, authState: string) => ({ idn, authState }) as EventRecord

describe("unconfirmedIdentities", () => {
  it("picks identities linked to neither a registered account nor the anonymous state", () => {
    const unconfirmed = unconfirmedIdentities([
      event("user-1", "ACCOUNT_BOUND"),
      event("anonymous", "ANONYMOUS"),
      event("user-e", "UNRESOLVED"),
      event("unresolved-529c", "UNRESOLVED"),
      // 같은 이름이 계정 연결로도 관측되면 계정 이름을 지킨다.
      event("user-2", "UNRESOLVED"), event("user-2", "ACCOUNT_BOUND"),
    ])
    expect([...unconfirmed].sort()).toEqual(["unresolved-529c", "user-e"])
    expect(identityName("user-e", unconfirmed)).toBe(UNCONFIRMED_IDENTITY)
    expect(identityName("unresolved-529c", unconfirmed)).toBe(UNCONFIRMED_IDENTITY)
    expect(identityName("user-1", unconfirmed)).toBe("user-1")
  })
})
