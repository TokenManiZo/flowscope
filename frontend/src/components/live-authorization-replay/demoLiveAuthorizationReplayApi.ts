/**
 * DEMO ONLY — Lovable preview harness.
 * Do NOT port this file to FlowScope, and do not import it from
 * LiveAuthorizationReplayCard.tsx or liveAuthorizationReplayApi.ts.
 */
import type {
  LiveAuthorizationReplayApiClient,
  LiveReplaySnapshot,
  StartLiveReplayRequest,
} from "./liveAuthorizationReplayApi";

const SAFE_COMBINATION_LIMIT = 200;

function stoppedSnapshot(): LiveReplaySnapshot {
  return {
    runId: "",
    state: "STOPPED",
    armed: false,
    targetAccountIds: [],
    includeAnonymous: false,
    basisSources: ["HUMAN"],
    observed: 0,
    eligible: 0,
    queued: 0,
    sent: 0,
    drafted: 0,
    skipped: 0,
    lastReason: "",
  };
}

export function createDemoLiveAuthorizationReplayApiClient(): LiveAuthorizationReplayApiClient {
  let snapshot = stoppedSnapshot();
  let tick = 0;

  const advance = () => {
    if (snapshot.state !== "ACTIVE") return;
    tick += 1;
    const identities =
      snapshot.targetAccountIds.length + (snapshot.includeAnonymous ? 1 : 0);
    snapshot.observed += 2;
    snapshot.eligible += 2;
    snapshot.queued = Math.min(
      SAFE_COMBINATION_LIMIT,
      snapshot.eligible * Math.max(1, identities),
    );
    snapshot.sent += identities;
    if (tick % 2 === 0) snapshot.drafted += 1;
    if (tick % 3 === 0) snapshot.skipped += 1;
    snapshot.lastReason =
      tick % 2 === 0
        ? "DELETE /api/orders/19 — 변경 메서드, Repeater 초안 생성"
        : "GET /api/orders/19 — 안전 메서드, 자동 재전송";
    if (snapshot.queued >= SAFE_COMBINATION_LIMIT) {
      snapshot.state = "LIMIT_REACHED";
      snapshot.lastReason = "안전 상한 도달로 신규 조합 생성 중단";
    }
  };

  const delay = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

  return {
    async getSnapshot() {
      await delay(60);
      advance();
      return { ...snapshot, targetAccountIds: [...snapshot.targetAccountIds] };
    },

    async startLive(request: StartLiveReplayRequest) {
      await delay();
      tick = 0;
      snapshot = {
        ...stoppedSnapshot(),
        runId: `demo-${Date.now()}`,
        state: "ACTIVE",
        armed: request.armed,
        targetAccountIds: [...request.accountIds],
        includeAnonymous: request.includeAnonymous,
        observed: 4,
        eligible: 3,
        queued: 6,
        lastReason: "라이브 검증 시작 — 안전 메서드 관측 대기",
      };
      return { ...snapshot, targetAccountIds: [...snapshot.targetAccountIds] };
    },

    async stopLive() {
      await delay();
      snapshot = stoppedSnapshot();
      tick = 0;
      return { ...snapshot };
    },
  };
}
