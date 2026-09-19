import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  ConflictBadge,
  EXPLORER_STATUS_META,
  HUMAN_STATUS_META,
  StatusBadge,
  VERIFICATION_META,
  ZAP_STATUS_META,
} from "./statusMeta";
import {
  validateProofPath,
  validateResponseMark,
  validateTarget,
  type AccountRole,
  type AccountSettings,
  type AccountSettingsAdapter,
  type ExplorerAdvancedSettings,
  type ExplorerLoginSettings,
  type LoginProofRule,
} from "./types";

const ROLES: AccountRole[] = ["User", "LV1", "LV2", "Admin"];

interface Draft {
  label: string;
  role: AccountRole;
  target: string;
  proof: LoginProofRule;
  zapEnabled: boolean;
  zapLoginUrl: string;
  zapLoginId: string;
  llmEnabled: boolean;
  llmMode: ExplorerLoginSettings["loginMode"];
  llmLoginUrl: string;
  llmLoginId: string;
  llmAdvanced: ExplorerAdvancedSettings;
}

function toDraft(settings: AccountSettings): Draft {
  return {
    label: settings.label,
    role: settings.role,
    target: settings.target,
    proof: { ...settings.proofRule },
    zapEnabled: settings.zap.enabled,
    zapLoginUrl: settings.zap.loginUrl,
    zapLoginId: settings.zap.loginId,
    llmEnabled: settings.llm.enabled,
    llmMode: settings.llm.loginMode,
    llmLoginUrl: settings.llm.loginUrl,
    llmLoginId: settings.llm.loginId,
    llmAdvanced: { ...settings.llm.advanced },
  };
}

export interface AccountSettingsSheetProps {
  accountId: string | null;
  adapter: AccountSettingsAdapter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (accountId: string) => void;
  onSaved?: (settings: AccountSettings) => void;
  /** HUMAN·ZAP·LLM 탭이 mock adapter로 동작할 때 안내 문구를 표시한다. */
  mockNotice?: boolean;
}

export function AccountSettingsSheet({
  accountId,
  adapter,
  open,
  onOpenChange,
  onDeleted,
  onSaved,
  mockNotice = false,
}: AccountSettingsSheetProps) {
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [zapPassword, setZapPassword] = useState("");
  const [llmPassword, setLlmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const resetLocal = useCallback(() => {
    setZapPassword("");
    setLlmPassword("");
    setError(null);
  }, []);

  useEffect(() => {
    if (!open || !accountId) {
      setSettings(null);
      setDraft(null);
      resetLocal();
      return;
    }
    let active = true;
    setPending(true);
    adapter
      .load(accountId)
      .then((next) => {
        if (!active) return;
        setSettings(next);
        setDraft(toDraft(next));
      })
      .catch(() => {
        if (active) setError("계정 설정을 불러올 수 없습니다.");
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [open, accountId, adapter, resetLocal]);

  const apply = (next: AccountSettings) => {
    setSettings(next);
    setDraft(toDraft(next));
  };

  const run = async (task: () => Promise<AccountSettings | void>) => {
    setPending(true);
    setError(null);
    try {
      const next = await task();
      if (next) apply(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청을 처리할 수 없습니다.");
    } finally {
      setPending(false);
    }
  };

  const dirty = useMemo(() => {
    if (!settings || !draft) return false;
    return (
      JSON.stringify(draft) !== JSON.stringify(toDraft(settings)) ||
      zapPassword !== "" ||
      llmPassword !== ""
    );
  }, [settings, draft, zapPassword, llmPassword]);

  const targetError = draft ? validateTarget(draft.target) : null;
  const pathError = draft ? validateProofPath(draft.proof.path) : null;
  const markError = draft ? validateResponseMark(draft.proof.responseMark) : null;
  const blocked = Boolean(targetError || pathError || markError);

  const requestClose = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    resetLocal();
    onOpenChange(false);
  };

  const handleSave = async () => {
    if (!settings || !draft || blocked) return;
    await run(async () => {
      let next = await adapter.saveBasicInfo(settings.id, {
        label: draft.label,
        role: draft.role,
        target: draft.target,
      });
      next = await adapter.saveProofRule(settings.id, draft.proof);
      next = await adapter.saveZapLogin(settings.id, {
        enabled: draft.zapEnabled,
        loginUrl: draft.zapLoginUrl,
        loginId: draft.zapLoginId,
        password: zapPassword || undefined,
      });
      next = await adapter.saveExplorerLogin(settings.id, {
        enabled: draft.llmEnabled,
        loginMode: draft.llmMode,
        loginUrl: draft.llmLoginUrl,
        loginId: draft.llmLoginId,
        password: llmPassword || undefined,
        advanced: draft.llmAdvanced,
      });
      setZapPassword("");
      setLlmPassword("");
      onSaved?.(next);
      return next;
    });
  };

  const patch = (partial: Partial<Draft>) =>
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));

  return (
    <>
      <Sheet open={open} onOpenChange={requestClose}>
        <SheetContent
          side="right"
          className="flex w-full max-w-none flex-col gap-0 overflow-hidden p-0 lg:max-w-3xl"
          aria-label={`${settings?.label ?? "등록 계정"} 계정 설정`}
        >
          <header className="space-y-2 border-b border-border px-4 py-4">
            <h2 className="text-lg font-semibold">
              {settings?.label ?? "등록 계정"} 계정 설정
            </h2>
            {settings && (
              <>
                <p className="font-mono text-xs text-muted-foreground">
                  {settings.role} · {settings.target}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge meta={HUMAN_STATUS_META[settings.human.status]} />
                  <StatusBadge
                    meta={VERIFICATION_META[settings.human.verificationSource]}
                  />
                  {settings.human.credentialConflict && <ConflictBadge />}
                </div>
              </>
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {mockNotice && (
              <Alert className="mb-4">
                <AlertDescription className="text-xs">
                  이 패널은 mock adapter로 동작하는 UI 프로토타입입니다. 실제
                  HUMAN·ZAP·LLM API 연동 전에는 저장값이 서버에 반영되지 않습니다.
                </AlertDescription>
              </Alert>
            )}

            {!settings || !draft ? (
              <p className="text-sm text-muted-foreground">
                {error ?? "계정 설정을 불러오는 중…"}
              </p>
            ) : (
              <Tabs defaultValue="basic">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="basic">기본 정보</TabsTrigger>
                  <TabsTrigger value="human">HUMAN</TabsTrigger>
                  <TabsTrigger value="zap">ZAP</TabsTrigger>
                  <TabsTrigger value="llm">LLM</TabsTrigger>
                </TabsList>

                {/* 기본 정보 */}
                <TabsContent value="basic" className="space-y-4 pt-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="account-label">등록 계정 표시 이름</Label>
                    <Input
                      id="account-label"
                      value={draft.label}
                      onChange={(event) => patch({ label: event.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="account-role">등록 계정 역할</Label>
                    <Select
                      value={draft.role}
                      onValueChange={(value) => patch({ role: value as AccountRole })}
                    >
                      <SelectTrigger id="account-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="account-target">대상 서비스 (exact origin)</Label>
                    <Input
                      id="account-target"
                      value={draft.target}
                      onChange={(event) => patch({ target: event.target.value })}
                      className="font-mono"
                    />
                    {targetError && (
                      <p role="alert" className="text-xs text-destructive">
                        {targetError}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      대상 서비스를 바꾸면 이 계정에 연결된 기존 세션이 무효화될 수
                      있습니다.
                    </p>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="account-id">계정 ID</Label>
                    <Input id="account-id" value={settings.id} readOnly className="font-mono" />
                  </div>

                  <section className="space-y-2 rounded-lg border border-destructive/40 p-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
                      <AlertTriangle className="size-4" aria-hidden="true" />
                      위험 작업
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      계정 삭제는 변경사항 저장과 분리되어 즉시 실행됩니다.
                    </p>
                    <Button
                      variant="destructive"
                      disabled={pending}
                      onClick={() =>
                        void run(async () => {
                          await adapter.deleteAccount(settings.id);
                          onDeleted?.(settings.id);
                          resetLocal();
                          onOpenChange(false);
                        })
                      }
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      등록 계정 삭제
                    </Button>
                  </section>
                </TabsContent>

                {/* HUMAN */}
                <TabsContent value="human" className="space-y-4 pt-4">
                  <section className="space-y-3 rounded-lg border border-border p-3">
                    <h3 className="text-sm font-semibold">HUMAN 세션 상태</h3>
                    <dl className="grid gap-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">상태</dt>
                        <dd>
                          <StatusBadge meta={HUMAN_STATUS_META[settings.human.status]} />
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">검증 출처</dt>
                        <dd>
                          <StatusBadge
                            meta={VERIFICATION_META[settings.human.verificationSource]}
                          />
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">마지막 확인</dt>
                        <dd className="font-mono text-xs">
                          {settings.human.lastCheckedLabel}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">자격 충돌</dt>
                        <dd className="text-xs">
                          {settings.human.credentialConflict ? (
                            <ConflictBadge />
                          ) : (
                            "없음"
                          )}
                        </dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => void run(() => adapter.reconnectHumanSession(settings.id))}
                      >
                        세션 다시 연결
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={pending}
                        onClick={() => void run(() => adapter.revokeHumanSession(settings.id))}
                      >
                        세션 폐기
                      </Button>
                    </div>
                  </section>

                  <section className="space-y-3 rounded-lg border border-border p-3">
                    <h3 className="text-sm font-semibold">로그인 성공 검증 규칙</h3>
                    <div className="grid gap-2 sm:grid-cols-[7rem_1fr]">
                      <div className="grid gap-1.5">
                        <Label htmlFor="proof-method">method</Label>
                        <Select
                          value={draft.proof.method}
                          onValueChange={(value) =>
                            patch({
                              proof: {
                                ...draft.proof,
                                method: value as LoginProofRule["method"],
                              },
                            })
                          }
                        >
                          <SelectTrigger id="proof-method">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["GET", "HEAD", "POST"].map((method) => (
                              <SelectItem key={method} value={method}>
                                {method}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="proof-path">검증 요청 path</Label>
                        <Input
                          id="proof-path"
                          value={draft.proof.path}
                          onChange={(event) =>
                            patch({ proof: { ...draft.proof, path: event.target.value } })
                          }
                          className="font-mono"
                        />
                      </div>
                    </div>
                    {pathError && (
                      <p role="alert" className="text-xs text-destructive">
                        {pathError}
                      </p>
                    )}
                    <div className="grid gap-1.5">
                      <Label htmlFor="proof-mark">응답 표식</Label>
                      <Input
                        id="proof-mark"
                        value={draft.proof.responseMark}
                        onChange={(event) =>
                          patch({
                            proof: { ...draft.proof, responseMark: event.target.value },
                          })
                        }
                        className="font-mono"
                      />
                      {markError && (
                        <p role="alert" className="text-xs text-destructive">
                          {markError}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      query와 fragment는 저장하지 않습니다. Cookie·토큰·비밀번호는
                      입력하거나 저장하지 않습니다.
                    </p>
                  </section>

                  <section className="space-y-3 rounded-lg border border-border p-3">
                    <h3 className="text-sm font-semibold">Burp 요청 가져오기</h3>
                    <ol className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground">
                      <li>1. 인증된 요청 선택</li>
                      <li aria-hidden="true">→</li>
                      <li>2. Extensions &gt; FlowScope</li>
                      <li aria-hidden="true">→</li>
                      <li>3. {settings.label}에 연결</li>
                    </ol>

                    {settings.candidates.length ? (
                      <fieldset className="space-y-2">
                        <legend className="text-xs text-muted-foreground">
                          가져올 요청 후보
                        </legend>
                        {settings.candidates.map((candidate) => (
                          <label
                            key={candidate.id}
                            className={`flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs ${
                              candidate.eligible
                                ? "cursor-pointer hover:bg-muted/50"
                                : "cursor-not-allowed opacity-60"
                            }`}
                          >
                            <input
                              type="radio"
                              name="burp-candidate"
                              value={candidate.id}
                              disabled={!candidate.eligible || pending}
                              onChange={() =>
                                void run(() =>
                                  adapter.linkBurpRequest(settings.id, candidate.id),
                                )
                              }
                              className="size-3.5 accent-primary"
                            />
                            <span className="font-mono">{candidate.status}</span>
                            <span className="font-mono">
                              {candidate.method} {candidate.path}
                            </span>
                            <span className="text-muted-foreground">{candidate.mime}</span>
                            <span className="text-muted-foreground">
                              {candidate.hasCookie ? "Cookie 있음" : "Cookie 없음"} ·{" "}
                              {candidate.hasAuthorization
                                ? "Authorization 있음"
                                : "Authorization 없음"}
                            </span>
                            <span
                              className={
                                candidate.markMatched
                                  ? "text-emerald-400"
                                  : "text-muted-foreground"
                              }
                            >
                              {candidate.markMatched ? "응답 표식 확인" : "표식 불일치"}
                            </span>
                            <span className="w-full text-muted-foreground">
                              {candidate.eligible ? "후보" : `부적합 · ${candidate.reason}`}
                            </span>
                          </label>
                        ))}
                        <p className="text-xs text-muted-foreground">
                          Cookie와 Authorization 원문은 표시하지 않습니다.
                        </p>
                      </fieldset>
                    ) : (
                      <div className="space-y-1 rounded-md border border-border/60 px-3 py-2 text-xs">
                        <p className="font-medium">조건에 맞는 요청 후보가 없습니다.</p>
                        <ul className="list-inside list-disc text-muted-foreground">
                          {settings.candidateBlockReasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <p className="font-mono text-[11px] text-muted-foreground">
                      보조 경로 · Extensions &gt; FlowScope &gt; 이 요청을 {settings.label}의
                      HUMAN 세션으로 연결
                    </p>
                  </section>
                </TabsContent>

                {/* ZAP */}
                <TabsContent value="zap" className="space-y-4 pt-4">
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2.5">
                    <Checkbox
                      checked={draft.zapEnabled}
                      onCheckedChange={(value) => patch({ zapEnabled: value === true })}
                      aria-label="ZAP 로그인 설정 사용"
                    />
                    <span className="text-sm font-medium">ZAP 로그인 설정 사용</span>
                  </label>

                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge meta={ZAP_STATUS_META[settings.zap.status]} />
                    <span className="font-mono text-xs text-muted-foreground">
                      {settings.zap.connectionLabel}
                    </span>
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="zap-login-url">로그인 URL</Label>
                    <Input
                      id="zap-login-url"
                      value={draft.zapLoginUrl}
                      disabled={!draft.zapEnabled}
                      onChange={(event) => patch({ zapLoginUrl: event.target.value })}
                      className="font-mono"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="zap-login-id">로그인 ID</Label>
                    <Input
                      id="zap-login-id"
                      value={draft.zapLoginId}
                      disabled={!draft.zapEnabled}
                      onChange={(event) => patch({ zapLoginId: event.target.value })}
                      autoComplete="off"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="zap-password">비밀번호</Label>
                    <Input
                      id="zap-password"
                      type="password"
                      value={zapPassword}
                      disabled={!draft.zapEnabled}
                      onChange={(event) => setZapPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={settings.zap.hasPassword ? "비밀번호 등록됨" : ""}
                    />
                    <p className="text-xs text-muted-foreground">
                      {settings.zap.hasPassword
                        ? "비밀번호 등록됨 — 원문은 다시 표시하지 않습니다."
                        : "비밀번호는 현재 프로세스 메모리에만 유지됩니다."}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={pending || !draft.zapEnabled}
                      onClick={() => void run(() => adapter.verifyZapLogin(settings.id))}
                    >
                      로그인 검증
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={pending || !settings.zap.hasPassword}
                      onClick={() =>
                        void run(async () => {
                          const next = await adapter.revokeZapCredentials(settings.id);
                          setZapPassword("");
                          return next;
                        })
                      }
                    >
                      자격증명 폐기
                    </Button>
                  </div>

                  {settings.zap.status === "FAILED" && (
                    <Alert variant="destructive">
                      <AlertDescription className="text-xs">
                        로그인 실패 — {settings.zap.failureReason || "실패 사유 없음"}. ANON으로
                        자동 대체하지 않고 FAILED로 유지합니다.
                      </AlertDescription>
                    </Alert>
                  )}

                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                    Active Scan은 실행하지 않습니다. 크롤링과 Passive 분석만 수행합니다.
                  </p>
                </TabsContent>

                {/* LLM */}
                <TabsContent value="llm" className="space-y-4 pt-4">
                  <p className="text-xs text-muted-foreground">
                    여기서 LLM은 모델 제공자나 API 키 설정이 아니라, LLM Explorer가 대상
                    웹 서비스에 로그인할 때 사용할 동일 등록 계정의 실행 설정입니다.
                  </p>

                  <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2.5">
                    <Checkbox
                      checked={draft.llmEnabled}
                      onCheckedChange={(value) => patch({ llmEnabled: value === true })}
                      aria-label="LLM Explorer 로그인 설정 사용"
                    />
                    <span className="text-sm font-medium">LLM Explorer 설정 사용</span>
                  </label>

                  <StatusBadge meta={EXPLORER_STATUS_META[settings.llm.status]} />

                  <div className="grid gap-1.5">
                    <Label htmlFor="llm-mode">로그인 방식</Label>
                    <Select
                      value={draft.llmMode}
                      onValueChange={(value) =>
                        patch({ llmMode: value as ExplorerLoginSettings["loginMode"] })
                      }
                      disabled={!draft.llmEnabled}
                    >
                      <SelectTrigger id="llm-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HTML_FORM">HTML form</SelectItem>
                        <SelectItem value="JSON_API">JSON API</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="llm-login-url">로그인 URL</Label>
                    <Input
                      id="llm-login-url"
                      value={draft.llmLoginUrl}
                      disabled={!draft.llmEnabled}
                      onChange={(event) => patch({ llmLoginUrl: event.target.value })}
                      className="font-mono"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="llm-login-id">로그인 ID</Label>
                    <Input
                      id="llm-login-id"
                      value={draft.llmLoginId}
                      disabled={!draft.llmEnabled}
                      onChange={(event) => patch({ llmLoginId: event.target.value })}
                      autoComplete="off"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="llm-password">비밀번호</Label>
                    <Input
                      id="llm-password"
                      type="password"
                      value={llmPassword}
                      disabled={!draft.llmEnabled}
                      onChange={(event) => setLlmPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={settings.llm.hasPassword ? "비밀번호 등록됨" : ""}
                    />
                    <p className="text-xs text-muted-foreground">
                      {settings.llm.hasPassword
                        ? "비밀번호 등록됨 — 원문은 다시 표시하지 않습니다."
                        : "비밀번호는 현재 프로세스 메모리에만 유지됩니다."}
                    </p>
                  </div>

                  <Accordion type="single" collapsible>
                    <AccordionItem value="advanced">
                      <AccordionTrigger className="text-sm">고급 설정</AccordionTrigger>
                      <AccordionContent className="grid gap-3 sm:grid-cols-2">
                        {(
                          [
                            ["idField", "로그인 ID 필드명"],
                            ["passwordField", "비밀번호 필드명"],
                            ["tokenJsonPath", "토큰 JSON 경로"],
                            ["authHeaderName", "인증 헤더 이름"],
                            ["authPrefix", "인증 접두사"],
                            ["validationUrl", "로그인 검증 URL"],
                          ] as Array<[keyof ExplorerAdvancedSettings, string]>
                        ).map(([key, label]) => (
                          <div key={key} className="grid gap-1.5">
                            <Label htmlFor={`llm-${key}`}>{label}</Label>
                            <Input
                              id={`llm-${key}`}
                              value={draft.llmAdvanced[key]}
                              disabled={!draft.llmEnabled}
                              onChange={(event) =>
                                patch({
                                  llmAdvanced: {
                                    ...draft.llmAdvanced,
                                    [key]: event.target.value,
                                  },
                                })
                              }
                              className="font-mono"
                            />
                          </div>
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={pending || !draft.llmEnabled}
                      onClick={() => void run(() => adapter.verifyExplorerLogin(settings.id))}
                    >
                      로그인 검증
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={pending || !settings.llm.hasPassword}
                      onClick={() =>
                        void run(async () => {
                          const next = await adapter.revokeExplorerCredentials(settings.id);
                          setLlmPassword("");
                          return next;
                        })
                      }
                    >
                      자격증명 폐기
                    </Button>
                  </div>

                  {settings.llm.failureReason && (
                    <Alert variant="destructive">
                      <AlertDescription className="text-xs">
                        {settings.llm.failureReason} 다른 계정이나 ANON으로 대체하지
                        않습니다.
                      </AlertDescription>
                    </Alert>
                  )}
                </TabsContent>
              </Tabs>
            )}

            {error && (
              <p role="alert" className="mt-4 text-xs text-destructive">
                {error}
              </p>
            )}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <Button variant="outline" onClick={() => requestClose(false)} disabled={pending}>
              취소
            </Button>
            <Button onClick={() => void handleSave()} disabled={pending || blocked || !dirty}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              변경사항 저장
            </Button>
          </footer>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>저장하지 않고 닫을까요?</AlertDialogTitle>
            <AlertDialogDescription>
              저장하지 않은 변경사항과 입력한 비밀번호는 즉시 삭제됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>계속 편집</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmClose(false);
                resetLocal();
                onOpenChange(false);
              }}
            >
              저장하지 않고 닫기
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default AccountSettingsSheet;
