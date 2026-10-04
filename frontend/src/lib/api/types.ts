export type Source = "human" | "scanner" | "llm" | "unknown"
export type Verdict = "allow" | "deny" | "suspicious" | "undecided" | "untested"

export interface TrafficStats {
  captured: number
  coverage: number
  excluded: number
  review: number
  dropped: number
  payloadMetadataOnly: number
  /** Attributable API requests observed while no HUMAN pass was active (D-155). Not counted as coverage. */
  humanApiOutsideRun?: number
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
  /** Registered collection lane; independent of observed identity and role. */
  laneAccountId?: string | null
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
  reviewStatus: ReviewStatus
  reviewNote: string
}

export type ReviewStatus = "UNRESOLVED" | "CONFIRMED" | "DISMISSED"

/** 판정 매트릭스(PR#12, D-144): 정책 P·실행 E·소유권 O를 독립 축으로 둔 서버 projection. 후보 여부는 정본 cell을 따른다. */
export type MatrixExpected = "ALLOW" | "DENY" | "UNKNOWN"
export type MatrixActual = "SUCCESS" | "DENIED" | "CONFLICT" | "AMBIGUOUS" | "UNTESTED"
export type MatrixStatus =
  | "BFLA_REPRODUCED" | "BFLA_CANDIDATE" | "BFLA_TEST_RECOMMENDED" | "BFLA_REVIEW_REQUIRED"
  | "BOLA_REPRODUCED" | "BOLA_IDOR_CANDIDATE" | "BOLA_IDOR_TEST_RECOMMENDED" | "BOLA_IDOR_REVIEW_REQUIRED"
  | "POLICY_CONFIRMATION_REQUIRED" | "POLICY_ENFORCED" | "EXPECTED_ACCESS" | "EXPECTED_ACCESS_DENIED"
  | "UNKNOWN_POLICY" | "OWNERSHIP_UNKNOWN" | "INVALID_EXPERIMENT" | "COVERAGE_GAP" | "UNTESTED"
export type MatrixGateState = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE"
export interface MatrixConfidence { code: string; level: number; label: string; basis: string }
export interface MatrixGate { key: string; label: string; state: MatrixGateState; reason: string }
export interface MatrixOracle { type: string; label: string; satisfied: boolean; requirement: string }
export interface MatrixRecommendation {
  type: string
  basisIdentity: string
  basisIdentityLabel: string
  testIdentity: string
  testIdentityLabel: string
  reason: string
  instruction: string
  stateChanging: boolean
  basisEvidenceIds: readonly string[]
}
export interface MatrixIdentity { id: string; label: string; role: string; kind: string }
/** 등록 계정의 설정 서비스가 현재 관측·정책 작업 서비스와 맞지 않아 matrix 조합에서 제외된 사실. */
export interface MatrixConfigurationWarning {
  code: "ACCOUNT_SERVICE_NOT_IN_MATRIX"
  accountId: string
  accountLabel: string
  configuredService: string
  message: string
}
export interface MatrixLegendItem { code: string; title: string; description: string }
export interface MatrixCellBase {
  id: string
  identity: string
  identityLabel: string
  operation: string
  expected: MatrixExpected
  blockingLayers?: readonly ("BFLA" | "BOLA")[]
  actual: MatrixActual
  status: MatrixStatus
  statusLabel: string
  policy: MatrixConfidence
  evidence: MatrixConfidence
  oracle: MatrixOracle
  gates: readonly MatrixGate[]
  sourceVerdicts: Readonly<Record<string, string>>
  statusCodes: readonly number[]
  evidenceIds: readonly string[]
  validationVerdict: string
  recommendation: MatrixRecommendation | null
  reviewStatus: ReviewStatus
  reviewNote: string
  reviewEvidenceIds: readonly string[]
}
export interface MatrixFunctionCell extends MatrixCellBase { role: string }
export interface MatrixObjectCell extends MatrixCellBase {
  role: string
  resource: string
  owner: string | null
  ownerLabel: string
  relation: string
  techniques: readonly string[]
  resourcePolicy?: "UNKNOWN" | "OWNER_ONLY" | "ROLE_SHARED" | "AUTHENTICATED_SHARED" | "PUBLIC" | "ADMIN_ONLY"
  ownership: MatrixConfidence
}
export interface MatrixEvidenceRow extends MatrixCellBase { type: string; resource: string | null; resourcePolicy?: MatrixObjectCell["resourcePolicy"]; ownership: MatrixConfidence }
export interface AuthorizationMatrix {
  summary: {
    policyConfirmed: number
    policyReview: number
    bflaCandidates: number
    bolaIdorCandidates: number
    coverageGaps: number
    invalidExperiments: number
    bflaTestRecommendations: number
    bolaIdorTestRecommendations: number
    manualReviewPending: number
    humanConfirmed: number
    humanDismissed: number
  }
  identities: readonly MatrixIdentity[]
  configurationWarnings?: readonly MatrixConfigurationWarning[]
  functions: readonly MatrixFunctionCell[]
  objects: readonly MatrixObjectCell[]
  evidence: readonly MatrixEvidenceRow[]
  policyLegend: readonly MatrixLegendItem[]
  evidenceLegend: readonly MatrixLegendItem[]
  ownershipLegend: readonly MatrixLegendItem[]
}

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
  // NONE | LEGACY_RESPONSE | RULE_MATCHED | OPERATOR_ASSERTED (optional for pre-schema-6 snapshots)
  verificationSource?: string
  createdAt: string
  lastUsedAt: string | null
  expiresAtHint: string | null
  hasAuthorization: boolean
  cookieCount: number
  capturing: boolean
  credentialConflict: boolean
  /** 서버가 이 세션의 인증값으로 재전송할 수 있는지(ACTIVE 또는 응답 확인된 수집 중). 옛 snapshot에는 없다. */
  replayReady?: boolean
  /** 이 세션으로 마지막 요청이 기록된 시각(ISO). */
  lastRecordedAt?: string | null
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
  declaredParameters?: readonly {
    location: string
    fieldPath: string
    displayName: string
    requirement: string
    evidenceId: string
    source: SurfaceSource
    runId: string
    adapter: string
    reason: string
    coordinateVersion?: string
  }[]
}

export type SurfaceSource = "HUMAN" | "SCANNER" | "LLM" | "UNKNOWN"
export type SurfaceDeltaState = "DECLARED_NOT_OBSERVED" | "ONE_SOURCE_OBSERVED" | "MULTI_SOURCE_OBSERVED" | "ALL_SOURCES_OBSERVED" | "OBSERVED_NOT_DECLARED" | "UNRESOLVED_COORDINATE"

export interface SurfaceObservation {
  evidenceId: string
  source: SurfaceSource
  runId: string
  identity: string
  status: number
  trafficClass?: string
  shape?: string
  role?: string
  phase?: string
  presence?: string
  valueType?: string
  byteLength?: number
  masked?: boolean
  contextSignature?: string
  confidence?: string
}

export interface SurfaceDeclaration {
  evidenceId: string
  source: SurfaceSource
  runId: string
  type: string
  adapter: string
  reason: string
  coordinateVersion?: string
  coordinateResolved?: boolean
  declaredType?: string | null
  declaredShape?: string | null
  conditionText?: string
  confidence?: string
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
  canonicalPath: string
  observedValueTypes: readonly string[]
  distinctValueCount: number
  coordinateResolved: boolean
  distinctValueTruncated: boolean
  /** discovery 프로파일(PR#11 ParameterProfile). 분모는 coverage·discovery phase의 완전한 요청 행. */
  profile?: SurfaceParameterProfile
  /** 입력→권한 대상(resource) 관계 근거(PR#11 AuthorizationTargetLink). 소유권·서버 사용 증명이 아니다. */
  authorizationTargets?: readonly SurfaceAuthorizationTargetLink[]
}

export type SurfaceConfidence = "OBSERVED" | "CORROBORATED" | "INFERRED" | "UNKNOWN"

export interface SurfaceAuthorizationTargetLink {
  resource: string | null
  confidence: SurfaceConfidence
  basis: string
  evidenceIds: readonly string[]
  evidenceCount: number
}

export type SurfaceSubjectClass = "SELF" | "OTHER_OWNER" | "ANONYMOUS" | "OTHER_ROLE"

/** 입력 지점 × 권한 대상 × subject × source 검증 좌표(PR#11 ParameterValidationCell). 판정은 인가 정본 재사용. */
export interface SurfaceValidationCell {
  endpoint: { service: string; method: string; pathTemplate: string }
  location: string
  canonicalPath: string
  targetResource: string | null
  subjectClass: SurfaceSubjectClass
  source: SurfaceSource
  identity: string | null
  role: string
  verdict: "ALLOW" | "DENY" | "SUSPICIOUS" | "UNDECIDED" | "UNTESTED"
  reason: string
  applicable: boolean
  evidenceIds: readonly string[]
  basisEvidenceIds: readonly string[]
  evidenceCount: number
  basisEvidenceCount: number
}

export type SurfaceContextPresence = "PRESENT" | "EXPLICIT_NULL" | "ABSENT_OBSERVED_CONTEXT"

export interface SurfaceParameterProfile {
  observationCount: number
  sourceCounts: Readonly<Record<string, number>>
  identityCounts: Readonly<Record<string, number>>
  roleCounts: Readonly<Record<string, number>>
  runCounts: Readonly<Record<string, number>>
  phaseCounts: Readonly<Record<string, number>>
  observedPresence: readonly string[]
  typeConflict: boolean
  absentObservedContextCount: number
  /** contextSignature → 존재 상태(상한 64). 값이 아닌 요청 구조 서명이다. */
  contextPresence: Readonly<Record<string, readonly SurfaceContextPresence[]>>
  serverUsageConfirmed: boolean
}

export type SurfaceGapType =
  | "DEFINED_NOT_OBSERVED"
  | "SOURCE_MISSED"
  | "IDENTITY_MISSED"
  | "AUTH_VARIANT_UNTESTED"
  | "CONDITION_COMBINATION_UNOBSERVED"
  | "TYPE_VARIANT_UNOBSERVED"
export type SurfaceGapStatus = "OPEN" | "VERIFIED" | "DISMISSED"

/** Evidence 근거가 있는 우선순위 후보(PR#11 ParameterGap). 취약점·완전성 주장이 아니다. */
export interface SurfaceParameterGap {
  id: string
  type: SurfaceGapType
  endpoint: { service: string; method: string; pathTemplate: string }
  location: string
  canonicalPath: string
  identity: string | null
  role: string | null
  source: SurfaceSource | null
  status: SurfaceGapStatus
  priorityReasons: readonly string[]
  summary: string
  evidenceIds: readonly string[]
  evidenceCount: number
}

/** 요청 행의 추출 문맥. complete=추출 진단 없음+payload FULL, discovery=프로파일·Gap 분모(VALIDATION은 false). 값은 없다. */
export interface SurfaceRequestContext {
  evidenceId: string
  complete: boolean
  retained: boolean
  discovery: boolean
  contextSignature: string
}

export interface SurfaceEndpoint {
  key: { service: string; method: string; pathTemplate: string }
  observedSources: readonly SurfaceSource[]
  observations: readonly SurfaceObservation[]
  declarations: readonly SurfaceDeclaration[]
  parameters: readonly SurfaceParameter[]
  deltaState: SurfaceDeltaState
  requestContexts?: readonly SurfaceRequestContext[]
  kinds?: readonly ("OBSERVED_API" | "ARTIFACT_API" | "NAVIGATION" | "STATIC_ASSET" | "DISCOVERY_DOCUMENT" | "FORM_ACTION" | "UNVERIFIED")[]
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

export interface LegacyLlm {
  readOnly: true
  assessments: readonly { id: string; type: string; verdict: string; title: string; reason: string; evidenceIds: readonly string[]; createdAt: string }[]
  validations: readonly { candidateId: string; verdict: string; reason: string; originalEvidenceIds: readonly string[]; validationEvidenceIds: readonly string[]; controlEvidenceIds: readonly string[]; runId: string; decidedAt: string }[]
}

export interface Snapshot {
  legacyLlm?: LegacyLlm
  revision: number
  identityRevision: number
  datasetRevision?: number
  sampleMode: boolean
  events: readonly EventRecord[]
  /** 표시용 순번(#N) 매핑: Evidence ID(원본 `ev-…`) → 프로젝트별 관측순 순번. 원본 ID는 역참조 키로 유지된다. */
  evidenceOrdinals?: Readonly<Record<string, number>>
  trafficStats: TrafficStats
  replays: readonly never[]
  flowLinks: readonly FlowLink[]
  roles: Readonly<Record<string, string>>
  owners: Readonly<Record<string, string>>
  /** 사용자가 직접 지정한 소유자. 자동 추정보다 우선한다. */
  ownerOverrides?: Readonly<Record<string, string>>
  /** Request Lab로 보낸 HUMAN 검증 응답. 탐색 관측과 분리돼 원본 Evidence에 연결된다. */
  manualVerifications?: readonly ManualVerification[]
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
  authorizationMatrix?: AuthorizationMatrix
  surface?: {
    endpoints: readonly SurfaceEndpoint[]
    extractions: readonly SurfaceExtraction[]
    probes: readonly SurfaceProbe[]
    parameterDiagnostics?: readonly SurfaceParameterDiagnostic[]
    /** priority 순으로 정렬된 discovery·권한 Gap(PR#11). 표시 라벨은 endpoints[].parameters에서 machine key로 찾는다. */
    parameterGaps?: readonly SurfaceParameterGap[]
    /** 입력×권한 대상×subject×source 검증 cell(PR#11). UNTESTED는 basis Evidence만 갖는다. */
    validationCells?: readonly SurfaceValidationCell[]
  }
}

export interface SurfaceParameterDiagnostic {
  evidenceId: string
  operation: string
  reasonCode: string
  droppedCount: number
}

export interface SurfaceProbe {
  key: { service: string; method: string; pathTemplate: string }
  evidenceId: string
  source: SurfaceSource
  runId: string
  identity: string
  status: number
}

export interface PayloadRetentionMetadata {
  digest: string
  bytes: number
  retention: string
  retained: boolean
}

/** PR#11 Evidence 계약(D-145): record 단위 구조화 파라미터 metadata. 값·preview·HTTP 원문은 없고, 민감 경로는 서버가 제외한다. */
export interface EvidenceParameterKey {
  service: string
  method: string
  operation: string
  location: string
  canonicalPath: string
  stableKey: string
}

export interface EvidenceParameterObservation {
  key: EvidenceParameterKey
  presence: "PRESENT" | "EXPLICIT_NULL" | "UNKNOWN"
  shape: "SCALAR" | "ARRAY" | "OBJECT" | "NULL" | "UNKNOWN"
  valueType: "STRING" | "INTEGER" | "NUMBER" | "BOOLEAN" | "UUID" | "DATE_TIME" | "BINARY" | "UNKNOWN"
  byteLength: number | null
  /** SHA-256 hex of a non-sensitive value only; null when the server withholds it. */
  digest: string | null
  occurrenceCount: number | null
  contextSignature: string | null
  confidence: "OBSERVED" | "CORROBORATED" | "INFERRED" | "UNKNOWN"
}

export interface EvidenceRecordParameterContext {
  service: string
  method: string
  operation: string
  identity: string | null
  role: string
  source: SurfaceSource
  status: number
  /** SurfaceAnalysis.RequestContext와 같은 틀: 추출 진단이 없고 request payload가 온전히 보존된 경우만 true. */
  complete: boolean
  completenessReason?: string
  retention: "RETAINED" | "METADATA_ONLY" | "UNKNOWN"
}

export interface EvidenceRecord {
  /** Additive, safe per-record metadata. Missing on older servers, never reconstructed from HTTP text. */
  parameterObservations?: readonly EvidenceParameterObservation[]
  parameterContext?: EvidenceRecordParameterContext
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

export interface ReplayResult extends ApiSuccess {
  status: number
  replayId: string
  openedDraft: boolean
}

export interface AuthorizationReplayResult extends ApiSuccess {
  run: {
    runId: string
    armed: boolean
    sent: number
    drafted: number
    skipped: number
    items: readonly {
      operation: string
      targetIdentity: string
      basisIdentity: string
      basisEvidenceId: string
      outcome: string
      reason: string
    }[]
  }
}

export interface SavedRequestLabEntry {
  name: string
  request: string
  credentialMode: "ORIGINAL" | "ANONYMOUS" | "ACCOUNT"
  result: { response: string; status: number; durationMs: number; requestBytes: number; responseBytes: number } | null
  dirty: boolean
}
export interface RequestLabWorkspaceState {
  datasetRevision: number
  revision: number
  persisted: boolean
  tab: { nextId: number; selectedId: number; entries: Record<string, SavedRequestLabEntry> }
}
export interface RequestLabWorkspaceChange extends Partial<SavedRequestLabEntry> {
  action: "create" | "update" | "delete" | "select"
  id: number
  clearResult?: boolean
  selectedId?: number
}

export interface RequestLabDraft {
  workspace?: RequestLabWorkspaceState
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
  reusableAccountId?: string
  message: string
}

export interface ManualVerification {
  eventId: string
  originEvidenceId: string
  operation: string
  resource: string | null
  identity: string
  identityId: string
  timestamp: number
  status: number
  durationMs: number
}

/** Request Lab 전송 시도 기록. 응답을 받지 못한 시도도 남는다. */
export interface ManualAttempt {
  sequence: number
  originEvidenceId: string
  outcome: string
  status: number
  evidenceId: string | null
  durationMillis: number
}

export interface RequestLabResult extends ApiSuccess {
  eventId: string
  status: number
  response: string
  durationMs: number
  requestBytes: number
  responseBytes: number
}

/** Live credentials: mounted Request Lab memory only, never query cache or project state. */
export interface RequestLabCredentialHeader {
  name: string
  value: string
}

export interface HumanRun {
  active: boolean
  completed: boolean
  runId: string
  accountId: string
  proxy: string
  listenerPort?: number
  otherListenerPort?: number
  otherListenerRequests?: number
}

export interface ZapStatus {
  connected: boolean
  state: string
  message: string
  endpoint?: string
  apiKeyConfigured?: boolean
  managedRuntime?: boolean
  version?: string
}

export interface ScannerLane {
  account_id: string | null
  account_label: string
  status: string
  stage: string
  authentication_state?: string
  authentication_browser?: string
  authentication_message?: string
  captured_records: number
  client_captures: number
  definition_imports?: number
  alert_count: number
  elapsed_seconds?: number
  stage_elapsed_seconds?: number
  stage_timeout_seconds?: number
  last_heartbeat_age_seconds?: number
  last_progress_age_seconds?: number
  heartbeat_status?: string
  queue_position?: number
  queue_total?: number
  wait_reason?: string
  warning: string
  error: string
}

export interface ZapAccount {
  id: string
  label: string
  role: string
  service: string
  loginUrl: string
  status: "UNVERIFIED" | "AUTHENTICATING" | "VERIFIED_BY_ZAP" | "FAILED"
  message: string
  updatedAt: string
  hasPassword: boolean
  hasLoggedInIndicator?: boolean
  hasLoggedOutIndicator?: boolean
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
  elapsed_seconds?: number
  stage_elapsed_seconds?: number
  stage_timeout_seconds?: number
  last_heartbeat_age_seconds?: number
  last_progress_age_seconds?: number
  heartbeat_status?: string
  activity_state?: string
  error?: string
  lanes?: readonly ScannerLane[]
}

export interface ScannerRunEnvelope {
  run: ScannerRun
  accounts: readonly ZapAccount[]
  scope: readonly string[]
}

export interface ScannerRunMutationResult {
  run: ScannerRun
}

export interface ExplorerAccount {
  id: string
  label: string
  role: string
  loginUrl: string
  status: "UNVERIFIED" | "READY" | "NEEDS_INPUT" | "EXPIRED" | "FAILED"
  message: string
  updatedAt: string
  cookieCount: number
  /** Names only; header values never leave the server. */
  headerNames: readonly string[]
  browserOpen: boolean
}

export interface ExplorerActivity {
  sequence: number
  at: string
  kind: string
  title: string
  detail: string
  status: string
  durationMillis: number | null
}

export interface ExplorerUnresolved { kind: string; target: string; reason: string }

export interface ExplorerRun {
  status: "IDLE" | "AUTHENTICATING" | "RUNNING" | "COMPLETED" | "COMPLETED_WITH_LIMITATIONS" | "FAILED" | "CANCELLED" | "FAILED_CLEANUP"
  runId: string
  target: string
  startedAt: string | null
  endedAt: string | null
  elapsedMillis: number
  message: string
  providerReadiness: string
  model: string
  accountIds: readonly string[]
  anonymous: boolean
  attempts: number
  responses: number
  endpointDeclarations: number
  parameterDeclarations: number
  capabilityProbes: number
  unresolved: readonly ExplorerUnresolved[]
  activities: readonly ExplorerActivity[]
}

export interface ExplorerModelCatalog {
  configuredModel: string
  models: readonly { id: string; label: string; recommended: boolean }[]
}

/** `minutes` is a ceiling, not a duration: an exploration that finishes stops well before it. */
export interface ExplorerBrowserBudget {
  actions: number
  maxActions: number
  snapshots: number
  endpoints: number
  elapsedMillis: number
  minutes: number
}

export interface ExplorerRunEnvelope {
  run: ExplorerRun
  /** Present only while a login window is being driven. */
  browser: ExplorerBrowserBudget | null
  accounts: readonly ExplorerAccount[]
  scope: readonly string[]
}

export interface ExplorerAccountSaveResult extends ApiSuccess { account: ExplorerAccount }

export interface ApiSuccess {
  success: true
  message: string
}

export interface ProjectEntry {
  id: string
  name: string
  scope: readonly string[]
  createdAt: string
  modifiedAtMillis: number
  sizeBytes: number
  active: boolean
  readable: boolean
  managed: boolean
}

export interface ProjectStatus {
  directory: string
  active: ProjectEntry | null
  projects: readonly ProjectEntry[]
  saveState?: "UNMANAGED" | "SAVED" | "PENDING" | "SAVING" | "FAILED"
  lastSavedAt?: string
  saveError?: string
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
