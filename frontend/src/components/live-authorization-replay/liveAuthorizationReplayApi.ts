/**
 * Portable API client for the FlowScope live cross-identity verification card.
 *
 * Same-origin endpoints:
 *   GET  /api/authorization-replay  -> snapshot
 *   POST /api/authorization-replay  -> action=start-live | action=stop-live
 *
 * POST bodies are application/x-www-form-urlencoded (URLSearchParams).
 * Credentials (tokens, Cookie, Authorization) are never read, sent for display,
 * or stored by this module.
 */

export type LiveReplayState = "STOPPED" | "ACTIVE" | "LIMIT_REACHED";
export type LiveReplayBasisSource = "HUMAN" | "SCANNER" | "LLM";

export interface LiveReplaySnapshot {
  runId: string;
  state: LiveReplayState;
  armed: boolean;
  targetAccountIds: string[];
  includeAnonymous: boolean;
  basisSources: LiveReplayBasisSource[];
  observed: number;
  eligible: number;
  queued: number;
  sent: number;
  drafted: number;
  skipped: number;
  lastReason: string;
}

export interface StartLiveReplayRequest {
  accountIds: string[];
  includeAnonymous: boolean;
  armed: boolean;
  basisSources?: LiveReplayBasisSource[];
}

export interface LiveAuthorizationReplayApiClient {
  getSnapshot(signal?: AbortSignal): Promise<LiveReplaySnapshot>;
  startLive(
    request: StartLiveReplayRequest,
    signal?: AbortSignal,
  ): Promise<LiveReplaySnapshot>;
  stopLive(signal?: AbortSignal): Promise<LiveReplaySnapshot>;
}

const ENDPOINT = "/api/authorization-replay";

function normalizeSnapshot(raw: unknown): LiveReplaySnapshot {
  const value = (raw ?? {}) as Partial<Record<keyof LiveReplaySnapshot, unknown>>;
  const num = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input) ? input : 0;
  const state = value.state;

  return {
    runId: typeof value.runId === "string" ? value.runId : "",
    state:
      state === "ACTIVE" || state === "LIMIT_REACHED" || state === "STOPPED"
        ? state
        : "STOPPED",
    armed: value.armed === true,
    targetAccountIds: Array.isArray(value.targetAccountIds)
      ? value.targetAccountIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    includeAnonymous: value.includeAnonymous === true,
    basisSources: Array.isArray(value.basisSources)
      ? value.basisSources.filter(
          (source): source is LiveReplayBasisSource =>
            source === "HUMAN" || source === "SCANNER" || source === "LLM",
        )
      : ["HUMAN"],
    observed: num(value.observed),
    eligible: num(value.eligible),
    queued: num(value.queued),
    sent: num(value.sent),
    drafted: num(value.drafted),
    skipped: num(value.skipped),
    lastReason: typeof value.lastReason === "string" ? value.lastReason : "",
  };
}

async function readJson(response: Response): Promise<LiveReplaySnapshot> {
  if (!response.ok) {
    throw new Error(`authorization-replay request failed (${response.status})`);
  }
  return normalizeSnapshot(await response.json());
}

async function post(
  body: URLSearchParams,
  signal?: AbortSignal,
): Promise<LiveReplaySnapshot> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: signal ?? null,
  });
  return readJson(response);
}

export function createLiveAuthorizationReplayApiClient(): LiveAuthorizationReplayApiClient {
  return {
    async getSnapshot(signal) {
      const response = await fetch(ENDPOINT, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: signal ?? null,
      });
      return readJson(response);
    },

    async startLive(request, signal) {
      const body = new URLSearchParams();
      body.set("action", "start-live");
      body.set("accounts", request.accountIds.join(","));
      body.set("anonymous", String(request.includeAnonymous));
      body.set("armed", String(request.armed));
      body.set("sources", (request.basisSources ?? ["HUMAN"]).join(","));
      return post(body, signal);
    },

    async stopLive(signal) {
      const body = new URLSearchParams();
      body.set("action", "stop-live");
      return post(body, signal);
    },
  };
}

export const liveAuthorizationReplayApi = createLiveAuthorizationReplayApiClient();
