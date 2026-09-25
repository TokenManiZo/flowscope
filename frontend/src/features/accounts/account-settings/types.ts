/**
 * Frontend-only 연동 경계 정의.
 * 비밀값(Cookie, Authorization, 비밀번호, 토큰) 원문은 이 타입에 저장하지 않는다.
 * 저장 상태는 존재 여부(hasPassword 등)만 사용한다.
 */

export type AccountRole = "User" | "LV1" | "LV2" | "Admin";

export type HumanSessionStatus =
  | "ACTIVE"
  | "CAPTURING"
  | "UNVERIFIED"
  | "SUSPECT"
  | "REAUTH_REQUIRED"
  | "REVOKED";

export type VerificationSource =
  | "OPERATOR_ASSERTED"
  | "RULE_MATCHED"
  | "LEGACY_RESPONSE"
  | "NONE";

export interface HumanSessionState {
  status: HumanSessionStatus;
  verificationSource: VerificationSource;
  lastCheckedLabel: string;
  credentialConflict: boolean;
}

export interface LoginProofRule {
  method: "GET" | "HEAD" | "POST";
  path: string;
  responseMark: string;
}

export interface BurpRequestCandidate {
  id: string;
  status: number;
  method: string;
  path: string;
  mime: string;
  hasCookie: boolean;
  hasAuthorization: boolean;
  markMatched: boolean;
  eligible: boolean;
  reason: string;
}

export type ZapLoginStatus =
  | "UNVERIFIED"
  | "AUTHENTICATING"
  | "VERIFIED_BY_ZAP"
  | "FAILED";

export interface ZapLoginSettings {
  enabled: boolean;
  status: ZapLoginStatus;
  loginUrl: string;
  loginId: string;
  hasPassword: boolean;
  connectionLabel: string;
  failureReason: string;
}

export type ExplorerLoginStatus =
  | "UNVERIFIED"
  | "READY"
  | "NEEDS_INPUT"
  | "EXPIRED"
  | "FAILED";

export interface ExplorerAdvancedSettings {
  idField: string;
  passwordField: string;
  tokenJsonPath: string;
  authHeaderName: string;
  authPrefix: string;
  validationUrl: string;
}

export interface ExplorerLoginSettings {
  enabled: boolean;
  status: ExplorerLoginStatus;
  loginMode: "HTML_FORM" | "JSON_API";
  loginUrl: string;
  loginId: string;
  hasPassword: boolean;
  failureReason: string;
  advanced: ExplorerAdvancedSettings;
}

export interface AccountSettings {
  id: string;
  label: string;
  role: AccountRole;
  target: string;
  human: HumanSessionState;
  proofRule: LoginProofRule;
  candidates: BurpRequestCandidate[];
  /** 후보가 없을 때 보여줄 구체적 원인. */
  candidateBlockReasons: string[];
  zap: ZapLoginSettings;
  llm: ExplorerLoginSettings;
}

export interface BasicInfoInput {
  label: string;
  role: AccountRole;
  target: string;
}

/** 비밀번호는 호출 시점에만 전달되고 어디에도 반환되지 않는다. */
export interface CredentialInput {
  loginUrl: string;
  loginId: string;
  password?: string | undefined;
}

export interface AccountSettingsAdapter {
  load(accountId: string): Promise<AccountSettings>;
  saveBasicInfo(accountId: string, input: BasicInfoInput): Promise<AccountSettings>;
  saveProofRule(accountId: string, rule: LoginProofRule | null): Promise<AccountSettings>;
  reconnectHumanSession(accountId: string): Promise<AccountSettings>;
  finishHumanSession(accountId: string): Promise<AccountSettings>;
  revokeHumanSession(accountId: string): Promise<AccountSettings>;
  linkBurpRequest(accountId: string, candidateId: string): Promise<AccountSettings>;
  registerCredential(accountId: string, input: { cookie: string; authorization: string }): Promise<AccountSettings>;
  saveZapLogin(
    accountId: string,
    input: CredentialInput & { enabled: boolean },
  ): Promise<AccountSettings>;
  verifyZapLogin(accountId: string): Promise<AccountSettings>;
  revokeZapCredentials(accountId: string): Promise<AccountSettings>;
  saveExplorerLogin(
    accountId: string,
    input: CredentialInput & {
      enabled: boolean;
      loginMode: ExplorerLoginSettings["loginMode"];
      advanced: ExplorerAdvancedSettings;
    },
  ): Promise<AccountSettings>;
  verifyExplorerLogin(accountId: string): Promise<AccountSettings>;
  revokeExplorerCredentials(accountId: string): Promise<AccountSettings>;
  deleteAccount(accountId: string): Promise<void>;
}

const FORBIDDEN_MARK_PATTERNS = [
  /cookie/i,
  /authorization/i,
  /bearer/i,
  /password/i,
  /passwd/i,
  /jsessionid/i,
  /api[-_ ]?key/i,
];

/** 응답 표식에 비밀값을 넣으면 거부한다. */
export function validateResponseMark(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "응답 표식을 입력하세요.";
  if (FORBIDDEN_MARK_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "Cookie·Authorization·토큰·비밀번호는 표식으로 사용할 수 없습니다.";
  }
  return null;
}

/** query와 fragment는 저장하지 않는다. */
export function validateProofPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return "path는 /로 시작해야 합니다.";
  if (trimmed.includes("?") || trimmed.includes("#")) {
    return "query와 fragment는 저장하지 않습니다.";
  }
  return null;
}

/** exact origin 형식만 허용한다. */
export function validateTarget(value: string): string | null {
  const trimmed = value.trim();
  if (!/^https?:\/\/[^/\s?#]+$/.test(trimmed)) {
    return "exact origin 형식으로 입력하세요. 예: http://127.0.0.1:8888";
  }
  return null;
}
