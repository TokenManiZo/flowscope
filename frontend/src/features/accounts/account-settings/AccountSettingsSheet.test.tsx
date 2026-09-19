import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AccountSettingsSheet } from "./AccountSettingsSheet";
import type { AccountSettings, AccountSettingsAdapter } from "./types";

const settings: AccountSettings = {
  id: "account-a", label: "USER A", role: "User", target: "https://app.example.test:443",
  human: { status: "ACTIVE", verificationSource: "OPERATOR_ASSERTED", lastCheckedLabel: "방금", credentialConflict: false },
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
    saveZapLogin: vi.fn().mockResolvedValue(settings), verifyZapLogin: vi.fn().mockResolvedValue(settings),
    revokeZapCredentials: vi.fn().mockResolvedValue(settings), saveExplorerLogin: vi.fn().mockResolvedValue(settings),
    verifyExplorerLogin: vi.fn().mockResolvedValue(settings), revokeExplorerCredentials: vi.fn().mockResolvedValue(settings),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
  };
}

it("shows the real verification source and saves only the dirty tab", async () => {
  const api = adapter();
  const user = userEvent.setup();
  render(<AccountSettingsSheet accountId="account-a" adapter={api} open onOpenChange={vi.fn()} />);

  expect(await screen.findByText("운영자 확인")).toBeInTheDocument();
  expect(screen.queryByText(/mock adapter/i)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue(/password|cookie|authorization/i)).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("등록 계정 표시 이름"));
  await user.type(screen.getByLabelText("등록 계정 표시 이름"), "USER A2");
  await user.click(screen.getByRole("button", { name: "변경사항 저장" }));

  await waitFor(() => expect(api.saveBasicInfo).toHaveBeenCalledOnce());
  expect(api.saveProofRule).not.toHaveBeenCalled();
  expect(api.saveZapLogin).not.toHaveBeenCalled();
  expect(api.saveExplorerLogin).not.toHaveBeenCalled();
});
