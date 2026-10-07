import { expect, it } from "vitest"
import type { EventRecord } from "@/lib/api/types"
import { requestLabEvent } from "./requestLabEvent"

const op = "https://api.test:443 GET /api/orders/{id}"
const event = (eventId: string, extra: Partial<EventRecord> = {}) => ({ eventId, op, idn: "a", resource: "https://api.test:443 orders:101", timestamp: 1, phase: "EXPLORATION", sourceDetail: "BROWSER", clusterEvidenceIds: [eventId], ...extra }) as EventRecord

it("keeps the basis record while its raw request is still in memory", () => {
  const events = [event("basis", { rawAvailable: true }), event("newer", { rawAvailable: true, timestamp: 9 })]
  expect(requestLabEvent(events, op, "basis", null)?.eventId).toBe("basis")
})

it("opens the newest same-API record that still has raw, preferring the basis identity and object", () => {
  const events = [
    event("basis"),
    event("other-identity", { idn: "b", rawAvailable: true, timestamp: 9 }),
    event("same-identity-other-object", { rawAvailable: true, timestamp: 8, resource: "https://api.test:443 orders:102" }),
    event("same-identity-same-object", { rawAvailable: true, timestamp: 5 }),
  ]
  expect(requestLabEvent(events, op, "basis", "https://api.test:443 orders:101")?.eventId).toBe("same-identity-same-object")
  expect(requestLabEvent(events, op, "basis", null)?.eventId).toBe("same-identity-other-object")
  expect(requestLabEvent(events.filter(item => item.idn !== "a" || item.eventId === "basis"), op, "basis", null)?.eventId).toBe("other-identity")
})

it("never substitutes a resent record and falls back to the basis record when nothing has raw", () => {
  const events = [
    event("basis"),
    event("lab-result", { rawAvailable: true, timestamp: 9, phase: "VALIDATION" }),
    event("repeater", { rawAvailable: true, timestamp: 8, sourceDetail: "BURP_REPEATER" }),
    event("other-api", { rawAvailable: true, timestamp: 7, op: "https://api.test:443 GET /api/users" }),
  ]
  expect(requestLabEvent(events, op, "basis", null)?.eventId).toBe("basis")
  // 근거 기록을 못 찾아도 같은 API의 원본 기록을 연다(다시 보낸 기록은 고르지 않는다).
  expect(requestLabEvent(events, op, undefined, null)?.eventId).toBe("basis")
})
