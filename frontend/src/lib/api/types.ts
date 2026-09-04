export type Source = "human" | "scanner" | "llm" | "unknown"
export type Verdict = "allow" | "deny" | "suspicious" | "undecided" | "untested"

export interface TrafficStats {
  captured: number
  coverage: number
  excluded: number
  review: number
  dropped: number
  payloadMetadataOnly: number
}

export interface EventObject {
  resource: string
  evidence: string
}

export interface EventRecord {
  eventId: string
  method: string
  path: string
  status: number
  fp: string
  idn: string
  role: string
  source: Source
  op: string
  resource: string | null
  timestamp: number
  sourceDetail: string
  orchestrator: string
  tool: string
  phase: string
  executionTrust: string
  runId: string
  authState: string
  trafficClass: string
  trafficDisposition: string
  coverageEligible: boolean
  classificationOverride: boolean
  classificationReasons: readonly string[]
  pathTemplateStatus: string
  pathTemplateReasons: readonly string[]
  clusterId: string
  repeatCount: number
  firstSeen: number
  lastSeen: number
  clusterEvidenceIds?: readonly string[]
  objects: readonly EventObject[]
  verdict: Verdict
}

export interface FlowLink {
  fromEventId: string
  toEventId: string
  fromOp: string
  toOp: string
  idn: string
  source: Source
  values: string
}

export interface SourceVerdicts {
  human?: Verdict
  scanner?: Verdict
  llm?: Verdict
  unknown?: Verdict
}

export interface SourceReasons {
  human?: string
  scanner?: string
  llm?: string
  unknown?: string
}

export interface Cell {
  idn: string
  op: string
  resource: string | null
  perSource: SourceVerdicts
  reasons: SourceReasons
  overall: Verdict
  conflict: boolean
  missedSources: readonly Source[]
  evidenceIds: readonly string[]
}

export interface Gap {
  id: string
  type: string
  risk: number
  idn: string
  op: string
  resource: string | null
  missedSources: readonly Source[]
  summary: string
}

export interface Scenario {
  id: string
  tag: string
  title: string
  proposal: string
  evidence: string
  risk: string
  evidenceIds: readonly string[]
  finalVerdict?: string
  validationReason?: string
  validationRunId?: string
  validationEvidenceIds?: readonly string[]
  controlEvidenceIds?: readonly string[]
  reviewStatus: ReviewStatus
  reviewNote: string
}

export type ReviewStatus = "UNRESOLVED" | "CONFIRMED" | "DISMISSED"

export interface Account {
  id: string
  label: string
  role: string
  target: string
  color: string
  authArtifactCount: number
}

export interface ObservedSession {
  fingerprint: string
  idn: string
  accountId: string | null
  artifactKind: string
  evidence: string
  confidence: string
  firstSeen: number
  lastSeen: number
  registered: boolean
  service: string
}

export interface ManagedSession {
  handle: string
  accountId: string
  accountLabel: string
  service: string
  status: string
  createdAt: string
  lastUsedAt: string | null
  expiresAtHint: string | null
  hasAuthorization: boolean
  cookieCount: number
  capturing: boolean
  credentialConflict: boolean
}

export interface RouteProvenance {
  type: string
  evidenceId: string
  source: string
  runId: string
  adapter: string
  applicability: string
  reason: string
}

export interface RouteCandidate {
  service: string
  method: string
  pathTemplate: string
  observed: boolean
  provenanceTypes: readonly string[]
  provenanceEvidenceIds: readonly string[]
  provenance: readonly RouteProvenance[]
  applicability: string
  reviewReason: string
  priorityReasons: readonly string[]
}

export type SurfaceSource = "HUMAN" | "SCANNER" | "LLM" | "UNKNOWN"
export type SurfaceDeltaState = "DECLARED_NOT_OBSERVED" | "ONE_SOURCE_OBSERVED" | "MULTI_SOURCE_OBSERVED" | "ALL_SOURCES_OBSERVED" | "OBSERVED_NOT_DECLARED"

export interface SurfaceObservation {
  evidenceId: string
  source: SurfaceSource
  runId: string
  identity: string
  status: number
  shape?: string
}

export interface SurfaceDeclaration {
  evidenceId: string
  source: SurfaceSource
  runId: string
  type: string
  adapter: string
  reason: string
}

export interface SurfaceParameter {
  location: string
  fieldPath: string
  displayName: string
  requirement: string
  observedShapes: readonly string[]
  observedSources: readonly SurfaceSource[]
  observationEvidenceIds: readonly string[]
  observations: readonly SurfaceObservation[]
  declarations: readonly SurfaceDeclaration[]
  deltaState: SurfaceDeltaState
}

export interface SurfaceEndpoint {
  key: { service: string; method: string; pathTemplate: string }
  observedSources: readonly SurfaceSource[]
  observations: readonly SurfaceObservation[]
  declarations: readonly SurfaceDeclaration[]
  parameters: readonly SurfaceParameter[]
  deltaState: SurfaceDeltaState
}

export interface SurfaceExtractionIssue {
  kind: string
  adapter: string
  detail: string
  line: number
  column: number
}

export interface SurfaceExtraction {
  evidenceId: string
  source: SurfaceSource
  runId: string
  artifactKind: string
  adapter: string
  status: string
  failure: string
  detail: string
  endpointCallSites: number
  assetReferences: number
  issues: readonly SurfaceExtractionIssue[]
}

export interface RunExecutionSummary {
  source: SurfaceSource
  runId: string
  attempted: number
  responses: number
  failures: number
  quality: "NOT_ATTEMPTED" | "ALL_FAILED" | "PARTIAL_FAILURE" | "RESPONSES_OBSERVED"
  outcomes: Readonly<Record<string, number>>
}

export interface Snapshot {
  revision: number
  identityRevision: number
  sampleMode: boolean
  events: readonly EventRecord[]
  trafficStats: TrafficStats
  replays: readonly never[]
  flowLinks: readonly FlowLink[]
  roles: Readonly<Record<string, string>>
  owners: Readonly<Record<string, string>>
  requiredRoles: Readonly<Record<string, string>>
  activeSources: readonly Source[]
  cells: readonly Cell[]
  verifications: readonly never[]
  gaps: readonly Gap[]
  scenarios: readonly Scenario[]
  accounts: readonly Account[]
  sessions: readonly ObservedSession[]
  managedSessions: readonly ManagedSession[]
  routeCandidates: readonly RouteCandidate[]
  runExecutions?: readonly RunExecutionSummary[]
  surface?: {
    endpoints: readonly SurfaceEndpoint[]
    extractions: readonly SurfaceExtraction[]
  }
}

export interface PayloadRetentionMetadata {
  digest: string
  bytes: number
  retention: string
  retained: boolean
}

export interface EvidenceRecord {
  eventId: string
  query: string
  requestBody: string
  request: string
  responseBody: string
  response: string
  location: string
  requestPayload: PayloadRetentionMetadata | null
  responsePayload: PayloadRetentionMetadata | null
  trafficClass: string
  trafficDisposition: string
  classificationReasons: readonly string[]
}

export interface EvidencePage {
  records: readonly EvidenceRecord[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

export interface AiPreview {
  notice: string
  records: number
  coverageCells: number
  findings: readonly AiFinding[]
  gaps: readonly AiGap[]
}

export interface AiFinding {
  id: string
  type: string
  severity: string
  title: string
  cell: {
    identity: string
    operation: string
    resource: string | null
  }
  reason: string
  evidenceIds: readonly string[]
  confirmed: boolean
}

export interface AiGap {
  id: string
  type: string
  identity: string
  operation: string
  resource: string | null
  missedBy: readonly string[]
  risk: number
  reason: string
}

export interface AiScenariosResult {
  scenarios: readonly Scenario[]
}

export interface AiScenariosEnvelope {
  usedLlm: boolean
  message: string
  result: AiScenariosResult
}

export interface ReplayResult extends ApiSuccess {
  status: number
  replayId: string
  openedDraft: boolean
}

export interface RequestLabDraft {
  eventId: string
  service: string
  request: string | null
  response: string | null
  rawRequestRetained: boolean
  rawResponseRetained: boolean
  requestEditable: boolean
  requestCharset: string | null
  responseCharset: string | null
  observedIdentity: string
  reusableSession: string
  message: string
}

export interface RequestLabResult extends ApiSuccess {
  eventId: string
  status: number
  response: string
  durationMs: number
  requestBytes: number
  responseBytes: number
}

export interface HumanRun {
  active: boolean
  completed: boolean
  runId: string
  accountId: string
  proxy: string
}

export interface ZapStatus {
  connected: boolean
  state: string
  message: string
  endpoint?: string
  apiKeyConfigured?: boolean
  version?: string
}

export interface ScannerLane {
  account_id: string | null
  account_label: string
  status: string
  stage: string
  captured_records: number
  traditional_captures: number
  rendered_captures: number
  alert_count: number
  warning: string
  error: string
}

export interface ScannerRun {
  status: string
  run_id?: string
  target?: string
  stage?: string
  scan_id?: string
  warning?: string
  captured_records?: number
  alert_count?: number
  error?: string
  lanes?: readonly ScannerLane[]
}

export interface ScannerRunEnvelope {
  run: ScannerRun
  scope: readonly string[]
}

export interface ScannerRunMutationResult {
  run: ScannerRun
}

export interface LlmRun {
  status: string
  provider?: string
  role?: string
  run_id?: string
  provider_session_id?: string
  started_at?: string
  ended_at?: string
  message?: string
  output_tail?: string
  session_metadata_may_remain?: boolean
  providers?: { CODEX: boolean; CLAUDE: boolean }
}

export interface LlmRunEnvelope {
  run: LlmRun
  scope: readonly string[]
  completed_lanes: readonly string[]
}

export interface LlmRunMutationResult {
  run: LlmRun
}

export interface ApiSuccess {
  success: true
  message: string
}

export interface ApiErrorBody {
  success: false
  message: string
}

export interface AccountSaveResult extends ApiSuccess {
  id: string
  rebound: number
}

export interface ImportXmlResult {
  success: true
  imported: number
  candidates: number
  failed: number
}
