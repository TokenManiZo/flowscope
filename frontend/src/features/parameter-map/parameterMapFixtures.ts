import type { EventRecord, Snapshot, SurfaceDeclaration, SurfaceEndpoint, SurfaceParameter, SurfaceParameterDiagnostic, SurfaceParameterGap, SurfaceValidationCell } from "@/lib/api/types"
import { snapshotFixture } from "@/test/fixtures"

export const demoService = "https://demo.test:443"
export const demoEndpointKey = { service: demoService, method: "PATCH", pathTemplate: "/orders/{id}" } as const
export const demoOperation = `${demoService} PATCH /orders/{id}`
export const demoResource = `${demoService} orders:101`

export function parameterGap(id: string, extra: Partial<SurfaceParameterGap> = {}): SurfaceParameterGap {
  return { id, type: "SOURCE_MISSED", endpoint: demoEndpointKey, location: "JSON_BODY", canonicalPath: "/status", identity: "USER A", role: "USER", source: "SCANNER", status: "OPEN", priorityReasons: ["SOURCE_DISCREPANCY"], summary: "서버가 보고한 source 관측 차이", evidenceIds: ["witness-a"], evidenceCount: 31, ...extra }
}

export function declaration(extra: Partial<SurfaceDeclaration> = {}): SurfaceDeclaration {
  return { evidenceId: "spec-a", source: "HUMAN", runId: "run", type: "OPENAPI", adapter: "openapi-json-yaml", reason: "명세", declaredType: "STRING", declaredShape: "STRING", conditionText: "", confidence: "INFERRED", coordinateResolved: true, ...extra }
}

export function statusParameter(extra: Partial<SurfaceParameter> = {}): SurfaceParameter {
  return {
    location: "JSON_BODY", fieldPath: "status", displayName: "status", requirement: "UNKNOWN", observedShapes: ["STRING"], observedSources: ["HUMAN"],
    observationEvidenceIds: ["actual-a"], observations: [{ evidenceId: "actual-a", source: "HUMAN", runId: "run", identity: "USER A", status: 200, shape: "STRING" }],
    declarations: [], deltaState: "OBSERVED_NOT_DECLARED", canonicalPath: "/status", observedValueTypes: ["STRING"], distinctValueCount: 1, coordinateResolved: true, distinctValueTruncated: false,
    profile: { observationCount: 40, sourceCounts: { HUMAN: 40 }, identityCounts: { "USER A": 7 }, roleCounts: { USER: 40 }, runCounts: { run: 40 }, phaseCounts: { EXPLORATION: 40 }, observedPresence: ["PRESENT"], typeConflict: false, absentObservedContextCount: 0, contextPresence: {}, serverUsageConfirmed: false },
    authorizationTargets: [{ resource: demoResource, confidence: "OBSERVED", basis: "EXACT_SCALAR_RESOURCE_REFERENCE", evidenceIds: ["actual-a"], evidenceCount: 1 }],
    ...extra,
  }
}

export function validationCell(extra: Partial<SurfaceValidationCell> = {}): SurfaceValidationCell {
  return { endpoint: demoEndpointKey, location: "JSON_BODY", canonicalPath: "/status", targetResource: demoResource, subjectClass: "OTHER_OWNER", source: "SCANNER", identity: null, role: "UNKNOWN", verdict: "UNTESTED", reason: "AUTH_VARIANT_NOT_OBSERVED", applicable: true, evidenceIds: [], basisEvidenceIds: ["basis-a"], evidenceCount: 0, basisEvidenceCount: 50, ...extra }
}

export function actualEvent(extra: Partial<EventRecord> = {}): EventRecord {
  return { eventId: "actual-a", method: "PATCH", path: "/orders/101", status: 200, fp: "sess-a", idn: "USER A", role: "USER", source: "human", op: demoOperation, resource: demoResource, timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "EXPLORATION", executionTrust: "OBSERVED", runId: "run", authState: "ACCOUNT_BOUND", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "INFERRED", pathTemplateReasons: [], clusterId: "orders", repeatCount: 1, firstSeen: 1, lastSeen: 1, objects: [], verdict: "allow", ...extra }
}

export function demoEndpoint(parameters: readonly SurfaceParameter[] = [statusParameter()], extra: Partial<SurfaceEndpoint> = {}): SurfaceEndpoint {
  return { key: demoEndpointKey, observedSources: ["HUMAN"], observations: [{ evidenceId: "actual-a", source: "HUMAN", runId: "run", identity: "USER A", status: 200 }], declarations: [], parameters, deltaState: "OBSERVED_NOT_DECLARED", kinds: ["OBSERVED_API"], requestContexts: [{ evidenceId: "actual-a", complete: true, retained: true, discovery: true, contextSignature: "ctx:v1:sha256:aa" }], ...extra }
}

export interface SurfaceSnapshotOptions {
  endpoints?: readonly SurfaceEndpoint[]
  gaps?: readonly SurfaceParameterGap[]
  cells?: readonly SurfaceValidationCell[]
  events?: readonly EventRecord[]
  owners?: Readonly<Record<string, string>>
  diagnostics?: readonly SurfaceParameterDiagnostic[]
}

/** surface 블록이 있는 snapshot. 인가 정본(cells/owners)은 snapshot 최상위, 파라미터 사실은 surface 아래. */
export function surfaceSnapshot({ endpoints = [], gaps = [], cells = [], events = [], owners = {}, diagnostics = [] }: SurfaceSnapshotOptions = {}): Snapshot {
  return { ...snapshotFixture, events: [...events], owners: { ...owners }, surface: { endpoints: [...endpoints], extractions: [], probes: [], parameterDiagnostics: [...diagnostics], parameterGaps: [...gaps], validationCells: [...cells] } }
}

export function parameterSnapshot(): Snapshot {
  return surfaceSnapshot({
    endpoints: [demoEndpoint()],
    gaps: [
      parameterGap("auth", { type: "AUTH_VARIANT_UNTESTED", source: "HUMAN", priorityReasons: ["WRITE_METHOD", "CONFIRMED_AUTH_BOUNDARY"], summary: "타인 소유 값이 아직 검증되지 않았습니다" }),
      parameterGap("source"),
      parameterGap("closed", { status: "VERIFIED" }),
      parameterGap("no-risk", { priorityReasons: [] }),
    ],
    cells: [validationCell()],
    events: [actualEvent()],
    owners: { [demoResource]: "USER B" },
  })
}
