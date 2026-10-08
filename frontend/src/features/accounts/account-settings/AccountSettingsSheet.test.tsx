import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AccountSettingsSheet } from "./AccountSettingsSheet";
import type { AccountSettings, AccountSettingsAdapter } from "./types";

const settings: AccountSettings = {
  id: "account-a", label: "USER A", role: "User", target: "https://app.example.test:443",
  human: { status: "ACTIVE", verificationSource: "OPERATOR_ASSERTED", lastCheckedLabel: "방금", credentialConflict: false, lastRecordedAt: "2026-09-29T06:56:41Z", lastRecordedApi: "GET /identity/api/v2/vehicle/vehicles" },
  proofRule: { method: "GET", path: "/api/me", responseMark: "USER A" },
  candidates: [], candidateBlockReasons: ["관측 요청 없음"],
  zap: { enabled: true, status: "VERIFIED_BY_ZAP", loginUrl: "https://app.example.test/login", loginId: "zap-user@example.test", password: "zap-secret", hasPassword: true, connected: true, connectionLabel: "", failureReason: "" },
  llm: { enabled: false, status: "UNVERIFIED", failureReason: "" },
};

function adapter(): AccountSettingsAdapter {
  return {
    load: vi.fn().mockResolvedValue(settings),
    saveBasicInfo: vi.fn().mockResolvedValue({ ...settings, label: "USER A2" }),
    saveProofRule: vi.fn().mockResolvedValue(settings), reconnectHumanSession: vi.fn().mockResolvedValue(settings),
    finishHumanSession: vi.fn().mockResolvedValue(settings),
    revokeHumanSession: vi.fn().mockResolvedValue(settings), linkBurpRequest: vi.fn().mockResolvedValue(settings),
    registerCredential: vi.fn().mockResolvedValue(settings),
    saveZapLogin: vi.fn().mockResolvedValue(settings), verifyZapLogin: vi.fn().mockResolvedValue(settings),
    revokeZapCredentials: vi.fn().mockResolvedValue(settings),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
  };
}

it("shows the real verification source and saves only the dirty section", async () => {
  const api = adapter();
  const user = userEvent.setup();
  render(<AccountSettingsSheet accountId="account-a" adapter={api} open onOpenChange={vi.fn()} />);

  expect(await screen.findByRole("tab", { name: /HUMAN\s*로그인 정보 있음/ })).toBeInTheDocument();
  expect(screen.queryByText(/mock adapter/i)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue(/password|cookie|authorization/i)).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("표시 이름"));
  await user.type(screen.getByLabelText("표시 이름"), "USER A2");
  await user.click(screen.getByRole("button", { name: "저장" }));

  await waitFor(() => expect(api.saveBasicInfo).toHaveBeenCalledOnce());
  expect(api.saveProofRule).not.toHaveBeenCalled();
  expect(api.saveZapLogin).not.toHaveBeenCalled();
});

it("shows masked stored credentials and replaces them from a pasted header block", async () => {
  const api = adapter();
  vi.mocked(api.load).mockResolvedValue({ ...settings, human: { ...settings.human, credentials: [{ name: "Authorization", preview: "Bearer eyJh••••" }] } });
  const user = userEvent.setup();
  render(<AccountSettingsSheet accountId="account-a" adapter={api} open onOpenChange={vi.fn()} />);

  await user.click(await screen.findByRole("tab", { name: /^HUMAN/ }));
  expect(screen.getByRole("group", { name: "HUMAN 인증값 요약" })).toHaveTextContent(/\d{2}:\d{2}:41.*GET \/identity\/api\/v2\/vehicle\/vehicles/);
  const stored = screen.getByRole("region", { name: "저장된 인증값" });
  expect(stored).toHaveTextContent("Bearer eyJh••••");
  expect(stored).toHaveTextContent("직접 입력");

  await user.click(within(stored).getByRole("button", { name: /헤더 붙여넣기로 교체/ }));
  await user.click(screen.getByLabelText(/헤더를 그대로 붙여넣으세요/));
  await user.paste("GET /me HTTP/1.1\nAuthorization: Bearer pasted-token\nAccept: */*");
  expect(screen.getByRole("list", { name: "붙여넣은 헤더" })).toHaveTextContent("저장 · Authorization");
  expect(screen.getByRole("list", { name: "붙여넣은 헤더" })).toHaveTextContent("무시 · Accept");
  await user.click(within(stored).getByRole("button", { name: "저장" }));

  await waitFor(() => expect(api.registerCredential).toHaveBeenCalledWith("account-a", "GET /me HTTP/1.1\nAuthorization: Bearer pasted-token\nAccept: */*"));
});

it("refreshes stored credentials while open without discarding unsaved edits", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const api = adapter();
    const capturing = { ...settings, human: { ...settings.human, status: "CAPTURING" as const, credentials: [] } };
    vi.mocked(api.load).mockResolvedValueOnce(capturing)
      .mockResolvedValue({ ...capturing, label: "SERVER NAME", human: { ...capturing.human, lastRecordedApi: "GET /api/me", credentials: [{ name: "Authorization", preview: "Bearer eyJb••••" }] } });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AccountSettingsSheet accountId="account-b" adapter={api} open onOpenChange={vi.fn()} />);

    await user.type(await screen.findByLabelText("표시 이름"), " edited");
    await user.click(screen.getByRole("tab", { name: /^HUMAN/ }));
    expect(screen.getByRole("region", { name: "저장된 인증값" })).toHaveTextContent("아직 없어요");
    await vi.advanceTimersByTimeAsync(3000);

    await waitFor(() => expect(screen.getByRole("region", { name: "저장된 인증값" })).toHaveTextContent("Bearer eyJb••••"));
    expect(screen.getByRole("group", { name: "HUMAN 인증값 요약" })).toHaveTextContent("GET /api/me");
    await user.click(screen.getByRole("tab", { name: /^기본 정보/ }));
    expect(screen.getByLabelText("표시 이름")).toHaveValue("USER A edited");
  } finally {
    vi.useRealTimers();
  }
});

it("rejects a pasted block without login headers", async () => {
  const api = adapter();
  const user = userEvent.setup();
  render(<AccountSettingsSheet accountId="account-a" adapter={api} open onOpenChange={vi.fn()} />);

  await user.click(await screen.findByRole("tab", { name: /^HUMAN/ }));
  await user.click(screen.getByRole("button", { name: /헤더 붙여넣기로/ }));
  await user.click(screen.getByLabelText(/헤더를 그대로 붙여넣으세요/));
  await user.paste("Accept: */*");
  await user.click(within(screen.getByRole("region", { name: "저장된 인증값" })).getByRole("button", { name: "저장" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Cookie나 Authorization");
  expect(api.registerCredential).not.toHaveBeenCalled();
});

it("expands a recorded request to its masked raw text with a truncated path row", async () => {
  const api = adapter();
  const path = "/workshop/api/shop/orders/4f1c2a9b-77de-4e0a-9d1e-2cbb31a0f7e2/items?include=product";
  vi.mocked(api.load).mockResolvedValue({ ...settings, candidates: [{ id: "ev-1", status: 200, method: "GET", path, mime: "application/json", hasCookie: false, hasAuthorization: true, markMatched: false, eligible: true, reason: "연결 가능", request: `GET ${path} HTTP/1.1\nAuthorization: ***MASKED***`, response: "HTTP/1.1 200 OK" }] });
  const user = userEvent.setup();
  render(<AccountSettingsSheet accountId="account-a" adapter={api} open onOpenChange={vi.fn()} />);

  await user.click(await screen.findByRole("tab", { name: /^HUMAN/ }));
  await user.click(screen.getByRole("button", { name: "기록된 요청에서 가져오기" }));
  expect(screen.getByRole("button", { name: "기록된 요청에서 가져오기 설명" })).toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: `GET ${path} 원문 보기` });
  expect(toggle).toHaveClass("truncate");
  expect(toggle).toHaveAttribute("title", path);
  await user.click(toggle);
  expect(screen.getByLabelText("요청 원문")).toHaveTextContent("Authorization: ***MASKED***");
  expect(screen.getByLabelText("응답 원문")).toHaveTextContent("HTTP/1.1 200 OK");
  await user.click(screen.getByRole("button", { name: "이 요청 연결" }));
  await waitFor(() => expect(api.linkBurpRequest).toHaveBeenCalledWith("account-a", "ev-1"));
});

it("lists what an account delete also clears", async () => {
  const api = adapter();
  const user = userEvent.setup();
  render(<AccountSettingsSheet accountId="account-a" adapter={api} open onOpenChange={vi.fn()}
    observedSessions={[{ accountId: "account-a" }, { accountId: "account-a" }, { accountId: "other" }] as never} />);

  await user.click(await screen.findByRole("button", { name: "계정 삭제" }));
  const effects = within(await screen.findByRole("alertdialog")).getByRole("list", { name: "함께 정리되는 항목" });
  expect(effects).toHaveTextContent("세션 연결 2건");
  expect(effects).toHaveTextContent("저장된 인증값");
  expect(effects).toHaveTextContent("ZAP 로그인 설정");
  expect(effects).not.toHaveTextContent("LLM");
});

it("shows the saved ZAP login ID and password as plain text so they never have to be re-entered", async () => {
  render(<AccountSettingsSheet accountId="account-a" adapter={adapter()} open onOpenChange={vi.fn()} zapRuntimeAvailable initialTab="zap" />);

  expect(await screen.findByLabelText("로그인 ID")).toHaveValue("zap-user@example.test");
  const password = screen.getByLabelText("비밀번호");
  expect(password).toHaveValue("zap-secret");
  expect(password).toHaveAttribute("type", "text");
  expect(screen.getByRole("button", { name: "로그인 검증" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
});

it("saves edited ZAP credentials and verifies them from one button without pressing 저장", async () => {
  const api = adapter();
  const user = userEvent.setup();
  render(<AccountSettingsSheet accountId="account-a" adapter={api} open onOpenChange={vi.fn()} zapRuntimeAvailable initialTab="zap" />);

  const password = await screen.findByLabelText("비밀번호");
  await user.clear(password);
  await user.type(password, "fixed-secret");
  await user.click(screen.getByRole("button", { name: "저장하고 로그인 검증" }));

  await waitFor(() => expect(api.verifyZapLogin).toHaveBeenCalledWith("account-a"));
  expect(api.saveZapLogin).toHaveBeenCalledWith("account-a", { enabled: true, authMode: "FORM", loginUrl: "https://app.example.test/login", loginId: "zap-user@example.test", password: "fixed-secret" });
  expect(vi.mocked(api.saveZapLogin).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.verifyZapLogin).mock.invocationCallOrder[0]);
});

it("saves an injected ZAP account with a cookie instead of a login form", async () => {
  const api = adapter();
  const user = userEvent.setup();
  render(<AccountSettingsSheet accountId="account-a" adapter={api} open onOpenChange={vi.fn()} zapRuntimeAvailable initialTab="zap" />);

  await user.click(await screen.findByRole("button", { name: "인증값 주입" }));
  // 주입 모드에서는 폼 로그인 검증 버튼이 없다.
  expect(screen.queryByRole("button", { name: /로그인 검증/ })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText(/쿠키/), "SESSION=inject-abc");
  await user.click(screen.getByRole("button", { name: "저장" }));

  await waitFor(() => expect(api.saveZapLogin).toHaveBeenCalledWith("account-a",
    expect.objectContaining({ enabled: true, authMode: "INJECT", cookie: "SESSION=inject-abc" })));
});

it("needs a login URL, ID, and password before verifying, and verifies unchanged values without saving", async () => {
  const api = adapter();
  const user = userEvent.setup();
  render(<AccountSettingsSheet accountId="account-a" adapter={api} open onOpenChange={vi.fn()} zapRuntimeAvailable initialTab="zap" />);

  await user.click(await screen.findByRole("button", { name: "로그인 검증" }));
  await waitFor(() => expect(api.verifyZapLogin).toHaveBeenCalledOnce());
  expect(api.saveZapLogin).not.toHaveBeenCalled();

  await user.clear(screen.getByLabelText("로그인 ID"));
  expect(screen.getByRole("button", { name: "저장하고 로그인 검증" })).toBeDisabled();
});

it("keeps the ZAP connection notice apart from the login result and hides it while ZAP is connected", async () => {
  const api = adapter();
  const { unmount } = render(<AccountSettingsSheet accountId="account-a" adapter={api} open onOpenChange={vi.fn()} zapRuntimeAvailable initialTab="zap" />);
  await screen.findByLabelText("비밀번호");
  expect(screen.queryByRole("status", { name: "ZAP 연결 상태" })).not.toBeInTheDocument();
  unmount();

  vi.mocked(api.load).mockResolvedValue({ ...settings, zap: { ...settings.zap, connected: false, connectionLabel: "127.0.0.1의 FlowScope Docker ZAP에 3회 연속 연결하지 못했습니다." } });
  render(<AccountSettingsSheet accountId="account-a" adapter={api} open onOpenChange={vi.fn()} zapRuntimeAvailable initialTab="zap" />);
  expect(await screen.findByRole("status", { name: "ZAP 연결 상태" })).toHaveTextContent("ZAP 연결 · 127.0.0.1의 FlowScope Docker ZAP에 3회 연속 연결하지 못했습니다.");
});

it("has no LLM login menu: LLM sessions come from browser login in the LLM step", async () => {
  render(<AccountSettingsSheet accountId="account-a" adapter={adapter()} open onOpenChange={vi.fn()} />);
  expect(await screen.findByRole("tab", { name: /^ZAP/ })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: /^LLM/ })).not.toBeInTheDocument();
});
