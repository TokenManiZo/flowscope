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
  zap: { enabled: true, status: "VERIFIED_BY_ZAP", loginUrl: "https://app.example.test/login", loginId: "", hasPassword: true, connectionLabel: "ZAP 연결됨", failureReason: "" },
  llm: { enabled: false, status: "UNVERIFIED", loginMode: "HTML_FORM", loginUrl: "", loginId: "", hasPassword: false, failureReason: "", advanced: { idField: "", passwordField: "", tokenJsonPath: "", authHeaderName: "", authPrefix: "", validationUrl: "" } },
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
    revokeZapCredentials: vi.fn().mockResolvedValue(settings), saveExplorerLogin: vi.fn().mockResolvedValue(settings),
    verifyExplorerLogin: vi.fn().mockResolvedValue(settings), revokeExplorerCredentials: vi.fn().mockResolvedValue(settings),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
  };
}

it("shows the real verification source and saves only the dirty section", async () => {
  const api = adapter();
  const user = userEvent.setup();
  render(<AccountSettingsSheet accountId="account-a" adapter={api} open onOpenChange={vi.fn()} />);

  expect(await screen.findByRole("tab", { name: /HUMAN\s*인증값 있음/ })).toBeInTheDocument();
  expect(screen.queryByText(/mock adapter/i)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue(/password|cookie|authorization/i)).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("표시 이름"));
  await user.type(screen.getByLabelText("표시 이름"), "USER A2");
  await user.click(screen.getByRole("button", { name: "저장" }));

  await waitFor(() => expect(api.saveBasicInfo).toHaveBeenCalledOnce());
  expect(api.saveProofRule).not.toHaveBeenCalled();
  expect(api.saveZapLogin).not.toHaveBeenCalled();
  expect(api.saveExplorerLogin).not.toHaveBeenCalled();
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
