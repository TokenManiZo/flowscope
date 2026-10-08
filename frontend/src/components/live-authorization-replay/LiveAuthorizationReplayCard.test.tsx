import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  LiveAuthorizationReplayCard,
  VERIFICATION_SOURCE_LABEL,
  isAccountSelectable,
  isStrongVerification,
  type ReplayAccount,
} from "./LiveAuthorizationReplayCard";
import type {
  LiveAuthorizationReplayApiClient,
  LiveReplaySnapshot,
} from "./liveAuthorizationReplayApi";

const accounts: ReplayAccount[] = [
  { id: "user-b", name: "USER B", role: "일반", status: "ACTIVE", verificationSource: "OPERATOR_ASSERTED" },
  { id: "admin", name: "ADMIN", role: "관리자", status: "ACTIVE", verificationSource: "RULE_MATCHED" },
  {
    id: "user-c",
    name: "USER C",
    role: "일반",
    status: "ACTIVE",
    verificationSource: "OPERATOR_ASSERTED",
    credentialConflict: true,
  },
  { id: "user-d", name: "USER D", role: "일반", status: "UNVERIFIED" },
  // ACTIVE but only weakly verified (legacy 2xx): must not be selectable for active replay.
  { id: "user-e", name: "USER E", role: "일반", status: "ACTIVE", verificationSource: "LEGACY_RESPONSE" },
];

function snapshot(overrides: Partial<LiveReplaySnapshot> = {}): LiveReplaySnapshot {
  return {
    runId: "run-1",
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
        basisSources: request.basisSources,
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

    expect(await screen.findByText("라이브 교차 계정 검증")).toBeTruthy();
    expect(
      screen.getByText(
        "HUMAN·ZAP·LLM에서 관측한 요청을 선택한 계정으로 안전하게 교차 검증합니다.",
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
    expect(screen.getByLabelText("사람 기준 요청")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("스캐너 기준 요청")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("LLM 기준 요청")).toHaveAttribute("aria-checked", "false");
  });

  it("only allows strongly verified ACTIVE accounts without credential conflicts to be selected", async () => {
    render(
      <LiveAuthorizationReplayCard
        accounts={accounts}
        apiClient={makeClient(snapshot())}
      />,
    );

    // Operator-asserted and rule-matched are selectable.
    expect(
      (await screen.findByLabelText("USER B")).getAttribute("disabled"),
    ).toBeNull();
    expect(screen.getByLabelText("ADMIN").getAttribute("disabled")).toBeNull();
    // Credential conflict, unverified, and weak LEGACY_RESPONSE ACTIVE are all rejected.
    expect(screen.getByLabelText("USER C")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("USER D")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("USER E")).toHaveProperty("disabled", true);
  });

  it("gates selection on strong verification and labels each verification source", () => {
    expect(isStrongVerification("OPERATOR_ASSERTED")).toBe(true);
    expect(isStrongVerification("RULE_MATCHED")).toBe(true);
    expect(isStrongVerification("LEGACY_RESPONSE")).toBe(false);
    expect(isStrongVerification("NONE")).toBe(false);
    expect(isStrongVerification(undefined)).toBe(false);

    const legacy: ReplayAccount = { id: "x", name: "X", role: "일반", status: "ACTIVE", verificationSource: "LEGACY_RESPONSE" };
    expect(isAccountSelectable(legacy)).toBe(false);
    expect(isAccountSelectable({ ...legacy, verificationSource: "OPERATOR_ASSERTED" })).toBe(true);

    expect(VERIFICATION_SOURCE_LABEL.OPERATOR_ASSERTED).toBe("운영자 확인");
    expect(VERIFICATION_SOURCE_LABEL.RULE_MATCHED).toBe("규칙 확인");
    expect(VERIFICATION_SOURCE_LABEL.LEGACY_RESPONSE).toBe("약검증");
    expect(VERIFICATION_SOURCE_LABEL.NONE).toBe("미검증");
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
    await user.click(screen.getByLabelText("스캐너 기준 요청"));
    await user.click(screen.getByLabelText("LLM 기준 요청"));
    await user.click(screen.getByLabelText("비로그인(ANON) 포함"));
    await user.click(screen.getByLabelText("안전 자동 재전송을 허용합니다."));
    await user.click(screen.getByRole("button", { name: "라이브 검증 시작" }));

    await waitFor(() =>
      expect(client.startLive).toHaveBeenCalledWith({
        accountIds: ["user-b", "admin"],
        includeAnonymous: true,
        armed: true,
        basisSources: ["HUMAN", "SCANNER", "LLM"],
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

describe("unavailable identities and start guidance", () => {
  it("says why an identity cannot be chosen, links to session capture, and names what the start needs", async () => {
    const client = makeClient(snapshot())
    render(<LiveAuthorizationReplayCard accounts={accounts} apiClient={client} />)
    expect(await screen.findByText("세션 없음")).toBeVisible()
    expect(screen.getByText("자격 충돌")).toBeVisible()
    expect(screen.getByText("세션 확인 필요")).toBeVisible()
    expect(screen.queryByText("UNVERIFIED")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "계정·세션에서 세션 캡처 →" })).toHaveAttribute("href", "#accounts")
    expect(screen.getByText(/사용 가능 2 \/ 5/)).toBeVisible()
    expect(screen.getByText("대상 계정을 1개 이상 선택하세요.")).toBeVisible()
    await userEvent.click(screen.getByRole("checkbox", { name: "USER B" }))
    expect(screen.getByText("3번 안전 재전송을 허용하세요.")).toBeVisible()
    await userEvent.click(screen.getByRole("checkbox", { name: "안전 자동 재전송을 허용합니다." }))
    expect(screen.getByText("켜짐")).toBeVisible()
    expect(screen.queryByText("3번 안전 재전송을 허용하세요.")).not.toBeInTheDocument()
  })

  it("offers a retry when the run state cannot be loaded", async () => {
    const client = makeClient(snapshot())
    vi.mocked(client.getSnapshot).mockRejectedValueOnce(new Error("offline"))
    render(<LiveAuthorizationReplayCard accounts={accounts} apiClient={client} />)
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("실행 상태를 불러오지 못했습니다.")
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }))
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
  })
})
