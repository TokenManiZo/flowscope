import {
  deleteAccount,
  deleteZapAccount,
  getAccountSettings,
  linkAccountRequestCandidate,
  manageSessionCapture,
  registerSessionCredential,
  saveAccount,
  saveAccountProofRule,
  saveZapAccount,
} from "@/lib/api/endpoints";
import { postForm } from "@/lib/api/client";

import type { AccountSettings, AccountSettingsAdapter } from "./types";

const load = (accountId: string) => getAccountSettings<AccountSettings>(accountId);

export function createAccountSettingsAdapter(): AccountSettingsAdapter {
  return {
    load,
    async saveBasicInfo(accountId, input) {
      await saveAccount({ id: accountId, ...input });
      return load(accountId);
    },
    async saveProofRule(accountId, rule) {
      return saveAccountProofRule<AccountSettings>({
        account: accountId,
        method: rule?.method ?? "",
        path: rule?.path ?? "",
        subject: rule?.responseMark ?? "",
      });
    },
    async reconnectHumanSession(accountId) {
      await manageSessionCapture("begin", accountId);
      return load(accountId);
    },
    async finishHumanSession(accountId) {
      await manageSessionCapture("end", accountId);
      return load(accountId);
    },
    async revokeHumanSession(accountId) {
      await manageSessionCapture("revoke", accountId);
      return load(accountId);
    },
    async linkBurpRequest(accountId, candidateId) {
      return linkAccountRequestCandidate<AccountSettings>(accountId, candidateId);
    },
    async registerCredential(accountId, headers) {
      await registerSessionCredential(accountId, headers);
      return load(accountId);
    },
    async saveZapLogin(accountId, input) {
      if (!input.enabled) {
        await deleteZapAccount(accountId);
        return load(accountId);
      }
      const account = await load(accountId);
      const authMode = input.authMode ?? "FORM";
      if (authMode === "INJECT") {
        if (!input.cookie?.trim() && !input.headers?.trim()) {
          throw new Error("주입할 쿠키나 인증 헤더를 하나 이상 입력하세요.");
        }
        await saveZapAccount({
          id: accountId, label: account.label, role: account.role, service: account.target,
          authMode: "INJECT", loginUrl: "", username: "", password: "",
          cookie: input.cookie ?? "", headers: input.headers ?? "", verifyUrl: input.verifyUrl ?? "",
        });
        return load(accountId);
      }
      if (!input.password) throw new Error("ZAP 자격증명을 저장하려면 비밀번호를 다시 입력하세요.");
      await saveZapAccount({
        id: accountId,
        label: account.label,
        role: account.role,
        service: account.target,
        authMode: "FORM",
        loginUrl: input.loginUrl,
        username: input.loginId,
        password: input.password,
      });
      return load(accountId);
    },
    async verifyZapLogin(accountId) {
      await postForm("/api/zap-accounts", { action: "refresh-session", id: accountId }, [202]);
      return load(accountId);
    },
    async revokeZapCredentials(accountId) {
      await deleteZapAccount(accountId);
      return load(accountId);
    },
    async deleteAccount(accountId) {
      await deleteAccount(accountId);
    },
  };
}
