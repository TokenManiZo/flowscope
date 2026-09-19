/**
 * MOCK ONLY — 실제 백엔드 연동 전 연동 경계를 표현하는 어댑터.
 * 비밀번호는 저장하지 않고 hasPassword 존재 여부만 갱신한다.
 */
import type {
  AccountSettings,
  AccountSettingsAdapter,
  BasicInfoInput,
  CredentialInput,
  ExplorerAdvancedSettings,
  ExplorerLoginSettings,
  LoginProofRule,
} from "./types";

function baseAccount(
  id: string,
  label: string,
  overrides: Partial<AccountSettings> = {},
): AccountSettings {
  return {
    id,
    label,
    role: "User",
    target: "http://127.0.0.1:8888",
    human: {
      status: "ACTIVE",
      verificationSource: "OPERATOR_CONFIRMED",
      lastCheckedLabel: "방금 전",
      credentialConflict: false,
    },
    proofRule: {
      method: "GET",
      path: "/identity/api/v2/user/dashboard",
      responseMark: '"username":"test1"',
    },
    candidates: [
      {
        id: `${id}-c1`,
        status: 200,
        method: "GET",
        path: "/identity/api/v2/user/dashboard",
        mime: "application/json",
        hasCookie: true,
        hasAuthorization: false,
        markMatched: true,
        eligible: true,
        reason: "응답 표식 확인",
      },
      {
        id: `${id}-c2`,
        status: 200,
        method: "GET",
        path: "/public/health",
        mime: "application/json",
        hasCookie: false,
        hasAuthorization: false,
        markMatched: false,
        eligible: false,
        reason: "Cookie/Authorization 없음",
      },
    ],
    candidateBlockReasons: [],
    zap: {
      enabled: false,
      status: "UNVERIFIED",
      loginUrl: "",
      loginId: "",
      hasPassword: false,
      connectionLabel: "ZAP 데몬 연결 확인됨",
      failureReason: "",
    },
    llm: {
      enabled: false,
      status: "UNVERIFIED",
      loginMode: "HTML_FORM",
      loginUrl: "",
      loginId: "",
      hasPassword: false,
      failureReason: "",
      advanced: {
        idField: "username",
        passwordField: "password",
        tokenJsonPath: "",
        authHeaderName: "",
        authPrefix: "",
        validationUrl: "",
      },
    },
    ...overrides,
  };
}

function initialAccounts(): Record<string, AccountSettings> {
  const test1 = baseAccount("acc-test1", "TEST 1");
  const userB = baseAccount("acc-userb", "USER B", {
    human: {
      status: "REAUTH_REQUIRED",
      verificationSource: "WEAK",
      lastCheckedLabel: "12분 전",
      credentialConflict: true,
    },
    candidates: [],
    candidateBlockReasons: [
      "FlowScope exact scope 밖",
      "로그인 성공 표식 불일치",
    ],
    zap: {
      enabled: true,
      status: "FAILED",
      loginUrl: "http://127.0.0.1:8888/login",
      loginId: "userb",
      hasPassword: true,
      connectionLabel: "ZAP 데몬 연결 확인됨",
      failureReason: "로그인 응답에서 성공 표식을 찾지 못했습니다.",
    },
  });
  const admin = baseAccount("acc-admin", "ADMIN", {
    role: "Admin",
    human: {
      status: "UNVERIFIED",
      verificationSource: "NONE",
      lastCheckedLabel: "기록 없음",
      credentialConflict: false,
    },
    llm: {
      ...baseAccount("x", "x").llm,
      enabled: true,
      status: "EXPIRED",
      loginUrl: "http://127.0.0.1:8888/api/auth/login",
      loginId: "admin",
      hasPassword: true,
      loginMode: "JSON_API",
      failureReason: "발급된 세션이 만료되었습니다. 로그인 검증을 다시 실행하세요.",
    },
  });
  return { [test1.id]: test1, [userB.id]: userB, [admin.id]: admin };
}

export interface MockAccountSettingsStore extends AccountSettingsAdapter {
  listAccounts(): AccountSettings[];
}

export function createMockAccountSettingsAdapter(): MockAccountSettingsStore {
  const store = initialAccounts();
  const delay = (ms = 140) => new Promise((resolve) => setTimeout(resolve, ms));
  const read = (id: string) => {
    const found = store[id];
    if (!found) throw new Error("등록 계정을 찾을 수 없습니다.");
    return found;
  };
  const clone = (account: AccountSettings): AccountSettings =>
    JSON.parse(JSON.stringify(account)) as AccountSettings;

  return {
    listAccounts() {
      return Object.values(store).map(clone);
    },

    async load(accountId) {
      await delay(80);
      return clone(read(accountId));
    },

    async saveBasicInfo(accountId, input: BasicInfoInput) {
      await delay();
      const account = read(accountId);
      account.label = input.label;
      account.role = input.role;
      account.target = input.target;
      return clone(account);
    },

    async saveProofRule(accountId, rule: LoginProofRule) {
      await delay();
      const account = read(accountId);
      account.proofRule = { ...rule };
      return clone(account);
    },

    async reconnectHumanSession(accountId) {
      await delay();
      const account = read(accountId);
      account.human = {
        status: "CAPTURING",
        verificationSource: account.human.verificationSource,
        lastCheckedLabel: "방금 전",
        credentialConflict: false,
      };
      return clone(account);
    },

    async revokeHumanSession(accountId) {
      await delay();
      const account = read(accountId);
      account.human = {
        status: "REVOKED",
        verificationSource: "NONE",
        lastCheckedLabel: "방금 전",
        credentialConflict: false,
      };
      return clone(account);
    },

    async linkBurpRequest(accountId, candidateId) {
      await delay();
      const account = read(accountId);
      const candidate = account.candidates.find((item) => item.id === candidateId);
      if (!candidate?.eligible) throw new Error("이 요청은 연결 조건을 만족하지 않습니다.");
      account.human = {
        status: "ACTIVE",
        verificationSource: "OPERATOR_CONFIRMED",
        lastCheckedLabel: "방금 전",
        credentialConflict: false,
      };
      return clone(account);
    },

    async saveZapLogin(accountId, input: CredentialInput & { enabled: boolean }) {
      await delay();
      const account = read(accountId);
      account.zap = {
        ...account.zap,
        enabled: input.enabled,
        loginUrl: input.loginUrl,
        loginId: input.loginId,
        hasPassword: account.zap.hasPassword || Boolean(input.password),
        status: account.zap.status === "FAILED" ? "UNVERIFIED" : account.zap.status,
        failureReason: "",
      };
      return clone(account);
    },

    async verifyZapLogin(accountId) {
      await delay(220);
      const account = read(accountId);
      const ready = Boolean(account.zap.loginUrl && account.zap.loginId && account.zap.hasPassword);
      account.zap = {
        ...account.zap,
        status: ready ? "VERIFIED_BY_ZAP" : "FAILED",
        failureReason: ready ? "" : "로그인 URL·ID·비밀번호가 모두 등록되어야 합니다.",
      };
      return clone(account);
    },

    async revokeZapCredentials(accountId) {
      await delay();
      const account = read(accountId);
      account.zap = {
        ...account.zap,
        status: "UNVERIFIED",
        loginId: "",
        hasPassword: false,
        failureReason: "",
      };
      return clone(account);
    },

    async saveExplorerLogin(
      accountId,
      input: CredentialInput & {
        enabled: boolean;
        loginMode: ExplorerLoginSettings["loginMode"];
        advanced: ExplorerAdvancedSettings;
      },
    ) {
      await delay();
      const account = read(accountId);
      account.llm = {
        ...account.llm,
        enabled: input.enabled,
        loginMode: input.loginMode,
        loginUrl: input.loginUrl,
        loginId: input.loginId,
        hasPassword: account.llm.hasPassword || Boolean(input.password),
        advanced: { ...input.advanced },
        failureReason: "",
      };
      return clone(account);
    },

    async verifyExplorerLogin(accountId) {
      await delay(220);
      const account = read(accountId);
      const ready = Boolean(account.llm.loginUrl && account.llm.loginId && account.llm.hasPassword);
      account.llm = {
        ...account.llm,
        status: ready ? "READY" : "NEEDS_INPUT",
        failureReason: ready ? "" : "로그인 URL·ID·비밀번호가 모두 등록되어야 합니다.",
      };
      return clone(account);
    },

    async revokeExplorerCredentials(accountId) {
      await delay();
      const account = read(accountId);
      account.llm = {
        ...account.llm,
        status: "UNVERIFIED",
        loginId: "",
        hasPassword: false,
        failureReason: "",
      };
      return clone(account);
    },

    async deleteAccount(accountId) {
      await delay();
      read(accountId);
      delete store[accountId];
    },
  };
}
