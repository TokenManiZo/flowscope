import { getEvidence } from "@/lib/api/endpoints"
import type { EvidenceParameterKey } from "@/lib/api/types"
import type { EvidenceParameterContext } from "./ParameterRequestDiff"
import type { ParameterMapKey } from "./parameterProjection"

export const PARAMETER_EVIDENCE_PAGE_SIZE = 20
export type SafeParameterEvidence = EvidenceParameterContext

/** 서버 좌표를 표시 machine key로 옮긴다. pathTemplate은 operation에서 service·method 접두를 뺀 부분이다. */
function mapKey(key: EvidenceParameterKey): ParameterMapKey {
  const prefix = `${key.service} ${key.method} `
  const pathTemplate = key.operation.startsWith(prefix) ? key.operation.slice(prefix.length) : key.operation.startsWith(`${key.method} `) ? key.operation.slice(key.method.length + 1) : key.operation
  return { service: key.service, method: key.method, pathTemplate, operation: key.operation, location: key.location, canonicalPath: key.canonicalPath, stableKey: key.stableKey }
}

/** Sanitize inside queryFn, not select: query cache must never receive HTTP fields (PR#11). */
export async function getParameterEvidence(operation: string, offset: number, signal: AbortSignal) {
  const page = await getEvidence(operation, offset, PARAMETER_EVIDENCE_PAGE_SIZE, signal)
  const records: SafeParameterEvidence[] = page.records.map(record => {
    const context = record.parameterContext
    return {
      eventId: record.eventId, service: context?.service ?? "UNKNOWN", method: context?.method ?? "UNKNOWN", operation: context?.operation ?? "UNKNOWN",
      identity: context?.identity ?? "UNKNOWN", role: context?.role ?? "UNKNOWN", source: context?.source ?? "UNKNOWN", status: context?.status ?? null, verdict: "UNKNOWN",
      complete: context?.complete === true, completenessReason: context ? context.completenessReason : "COMPLETENESS_NOT_RECORDED", retention: context?.retention ?? "UNKNOWN",
      parameters: (record.parameterObservations ?? []).slice(0, 10_000).map(item => ({
        key: mapKey(item.key),
        presence: item.presence, shape: item.shape, valueType: item.valueType, byteLength: item.byteLength,
        digest: item.digest && /^(?:sha256:)?[a-f0-9]{64}$/i.test(item.digest) ? item.digest : null,
        occurrenceCount: item.occurrenceCount, contextSignature: item.contextSignature && /^ctx:v1:sha256:[a-f0-9]{64}$/i.test(item.contextSignature) ? item.contextSignature : null, confidence: item.confidence,
      })),
    }
  })
  return { records, total: page.total, offset: page.offset, limit: page.limit, hasMore: page.hasMore }
}
