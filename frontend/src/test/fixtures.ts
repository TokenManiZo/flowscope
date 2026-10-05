import type { HumanRun, ScannerRunEnvelope, Snapshot, ZapStatus } from "@/lib/api/types"

export const snapshotFixture: Snapshot = {
  revision: 1,
  identityRevision: 1,
  sampleMode: false,
  events: [],
  trafficStats: { captured: 0, coverage: 0, excluded: 0, review: 0, dropped: 0, payloadMetadataOnly: 0 },
  replays: [],
  flowLinks: [],
  roles: {},
  owners: {},
  requiredRoles: {},
  activeSources: [],
  cells: [],
  verifications: [],
  gaps: [],
  scenarios: [],
  accounts: [],
  sessions: [],
  managedSessions: [],
  routeCandidates: [],
}

export const targetSnapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  ...snapshotFixture,
  ...overrides,
})

export const humanRunFixture: HumanRun = { active: false, completed: false, runId: "", accountId: "", proxy: "http://127.0.0.1:8080" }
/** 비로그인으로 점검 중인 상태. Request Lab은 점검 중인 신원으로 전송 인증을 미리 고른다. */
export const anonymousInspectionFixture: HumanRun = { ...humanRunFixture, active: true, runId: "run-anon", runs: [{ runId: "run-anon", accountId: "", proxy: humanRunFixture.proxy }] }
export const zapStatusFixture: ZapStatus = { connected: false, state: "UNAVAILABLE", message: "ZAP unavailable" }
export const scannerRunFixture: ScannerRunEnvelope = { run: { status: "NOT_STARTED" }, accounts: [], scope: [] }
