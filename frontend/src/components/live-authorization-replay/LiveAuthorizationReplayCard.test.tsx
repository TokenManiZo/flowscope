import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  LiveAuthorizationReplayCard,
  type ReplayAccount,
} from "./LiveAuthorizationReplayCard";
import type {
  LiveAuthorizationReplayApiClient,
  LiveReplaySnapshot,
} from "./liveAuthorizationReplayApi";

const accounts: ReplayAccount[] = [
  { id: "user-b", name: "USER B", role: "일반", status: "ACTIVE" },
  { id: "admin", name: "ADMIN", role: "관리자", status: "ACTIVE" },
  {
    id: "user-c",
    name: "USER C",
    role: "일반",
    status: "ACTIVE",
    credentialConflict: true,
  },
  { id: "user-d", name: "USER D", role: "일반", status: "UNVERIFIED" },
];

function snapshot(overrides: Partial<LiveReplaySnapshot> = {}): LiveReplaySnapshot {
  return {
    runId: "run-1",
    state: "STOPPED",
    armed: false,
    targetAccountIds: [],
    includeAnonymous: false,
    observed: 0,
    eligible: 0,
    queued: 0,
    sent: 0,
    drafted: 0,
    skipped: 0,
    lastReason: "",
    ...overrides,
  };
}

function makeClient(
  initial: LiveReplaySnapshot,
): LiveAuthorizationReplayApiClient & {
  startLive: ReturnType<typeof vi.fn>;
  stopLive: ReturnType<typeof vi.fn>;
} {
  let current = initial;
  return {
    getSnapshot: vi.fn(async () => current),
    startLive: vi.fn(async (request) => {
      current = snapshot({
        state: "ACTIVE",
        armed: request.armed,
        targetAccountIds: request.accountIds,
        includeAnonymous: request.includeAnonymous,
        observed: 4,
        eligible: 3,
        queued: 6,
        sent: 2,
        drafted: 1,
        skipped: 1,
      });
      return current;
    }),
    stopLive: vi.fn(async () => {
      current = snapshot({ state: "STOPPED" });
      return current;
    }),
  };
}

describe("LiveAuthorizationReplayCard", () => {
  it("renders the pre-run form with the safety notice", async () => {
    render(
      <LiveAuthorizationReplayCard
        accounts={accounts}
        apiClient={makeClient(snapshot())}
      />,
    );

    expect(await screen.findByText("라이브 교차 신원 검증")).toBeTruthy();
    expect(
      screen.getByText(
        "사람이 발생시킨 요청을 선택한 다른 신원으로 안전하게 교차 검증합니다.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "GET/HEAD만 자동 전송됩니다. POST/PUT/PATCH/DELETE는 Burp Repeater 초안으로만 생성됩니다.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("replay-state-badge").textContent).toContain(
      "중지됨",
    );
  });

  it("only allows ACTIVE accounts without credential conflicts to be selected", async () => {
    render(
      <LiveAuthorizationReplayCard
        accounts={accounts}
        apiClient={makeClient(snapshot())}
      />,
    );

    expect(
      (await screen.findByLabelText("USER B")).getAttribute("disabled"),
    ).toBeNull();
    expect(screen.getByLabelText("USER C")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("USER D")).toHaveProperty("disabled", true);
  });

  it("keeps the start button disabled until a target and the approval are set", async () => {
    const user = userEvent.setup();
    render(
      <LiveAuthorizationReplayCard
        accounts={accounts}
        apiClient={makeClient(snapshot())}
      />,
    );

    const start = await screen.findByRole("button", { name: "라이브 검증 시작" });
    expect(start).toHaveProperty("disabled", true);

    await user.click(screen.getByLabelText("USER B"));
    expect(start).toHaveProperty("disabled", true);

    await user.click(screen.getByLabelText("안전 자동 재전송을 허용합니다."));
    expect(start).toHaveProperty("disabled", false);
  });

  it("starts a run with the selected identities and anonymous flag", async () => {
    const user = userEvent.setup();
    const client = makeClient(snapshot());
    render(
      <LiveAuthorizationReplayCard accounts={accounts} apiClient={client} />,
    );

    await user.click(await screen.findByLabelText("USER B"));
    await user.click(screen.getByLabelText("ADMIN"));
    await user.click(screen.getByLabelText("비로그인(ANON) 포함"));
    await user.click(screen.getByLabelText("안전 자동 재전송을 허용합니다."));
    await user.click(screen.getByRole("button", { name: "라이브 검증 시작" }));

    await waitFor(() =>
      expect(client.startLive).toHaveBeenCalledWith({
        accountIds: ["user-b", "admin"],
        includeAnonymous: true,
        armed: true,
      }),
    );

    expect(await screen.findByText("관측 요청")).toBeTruthy();
    expect(screen.getByText("Repeater 초안")).toBeTruthy();
    expect(screen.getByTestId("replay-state-badge").textContent).toContain(
      "검증 중",
    );
  });

  it("shows the limit notice and allows stopping", async () => {
    const user = userEvent.setup();
    const client = makeClient(snapshot({ state: "LIMIT_REACHED", queued: 200 }));
    render(
      <LiveAuthorizationReplayCard accounts={accounts} apiClient={client} />,
    );

    expect(
      await screen.findByText(
        "안전 상한인 200개 조합에 도달했습니다. 새 실행을 시작하려면 현재 실행을 중지하세요.",
      ),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "라이브 검증 중지" }));
    await waitFor(() => expect(client.stopLive).toHaveBeenCalled());
    expect(
      await screen.findByRole("button", { name: "라이브 검증 시작" }),
    ).toBeTruthy();
  });
});
