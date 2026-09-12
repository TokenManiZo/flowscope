import { expect, it, vi } from "vitest"

import { getParameterEvidence } from "./parameterEvidence"
import { demoEndpointKey, demoOperation } from "./parameterMapFixtures"
vi.mock("@/lib/api/endpoints", () => ({ getEvidence: vi.fn() }))
import { getEvidence } from "@/lib/api/endpoints"

const serverKey = { service: demoEndpointKey.service, method: demoEndpointKey.method, operation: demoOperation, location: "JSON_BODY", canonicalPath: "/status", stableKey: "pk:v1:status" }

it("drops all legacy HTTP fields and extra observation properties before returning cacheable data", async () => {
  const record = { eventId: "a", parameterContext: { service: serverKey.service, method: "PATCH", operation: demoOperation, identity: "A", role: "USER", source: "HUMAN", status: 200, complete: false, completenessReason: "REQUEST_NOT_RETAINED", retention: "METADATA_ONLY" }, parameterObservations: [{ key: serverKey, presence: "PRESENT", shape: "SCALAR", valueType: "STRING", digest: "a".repeat(64), byteLength: 3, occurrenceCount: null, contextSignature: "ctx:v1:sha256:" + "a".repeat(64), confidence: "OBSERVED" }] }
  for (const field of ["request", "response", "requestBody", "query"]) Object.defineProperty(record, field, { enumerable: true, get() { throw new Error("legacy HTTP must not be read") } })
  Object.defineProperty(record.parameterObservations[0], "maskedPreview", { enumerable: true, get() { throw new Error("preview must not be read") } })
  vi.mocked(getEvidence).mockResolvedValue({ records: [record], total: 1, offset: 0, limit: 20, hasMore: false } as unknown as Awaited<ReturnType<typeof getEvidence>>)
  const controller = new AbortController()
  const page = await getParameterEvidence(demoOperation, 0, controller.signal)
  expect(page.records[0].parameters[0].digest).toBe("a".repeat(64))
  expect(page.records[0].parameters[0].key).toEqual({ ...serverKey, pathTemplate: "/orders/{id}" })
  expect(page.records[0].completenessReason).toBe("REQUEST_NOT_RETAINED")
  expect(JSON.stringify(page)).not.toMatch(/requestBody|maskedPreview|response|query/)
  expect(getEvidence).toHaveBeenCalledWith(demoOperation, 0, 20, controller.signal)
})

it("rejects malformed digests and context signatures and marks servers without parameter context as unrecorded", async () => {
  const record = { eventId: "b", parameterObservations: [{ key: serverKey, presence: "PRESENT", shape: "SCALAR", valueType: "STRING", digest: "not-a-digest", byteLength: 3, occurrenceCount: null, contextSignature: "ctx:v0:bogus", confidence: "OBSERVED" }] }
  vi.mocked(getEvidence).mockResolvedValue({ records: [record], total: 1, offset: 0, limit: 20, hasMore: false } as unknown as Awaited<ReturnType<typeof getEvidence>>)
  const page = await getParameterEvidence(demoOperation, 0, new AbortController().signal)
  expect(page.records[0].parameters[0].digest).toBeNull()
  expect(page.records[0].parameters[0].contextSignature).toBeNull()
  expect(page.records[0].complete).toBe(false)
  expect(page.records[0].completenessReason).toBe("COMPLETENESS_NOT_RECORDED")
  expect(page.records[0].retention).toBe("UNKNOWN")
})
