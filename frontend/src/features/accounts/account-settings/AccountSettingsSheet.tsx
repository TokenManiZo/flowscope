import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ObservedSession } from "@/lib/api/types";
import { BasicAccountTab } from "./BasicAccountTab";
import { HumanAccountTab } from "./HumanAccountTab";
import { ZapAccountTab } from "./ZapAccountTab";
import { HUMAN_STATUS_META, ZAP_STATUS_META, type StatusMeta } from "./statusMeta";
import { validateProofPath, validateResponseMark, validateTarget, type AccountRole, type AccountSettings, type AccountSettingsAdapter, type LoginProofRule, type ZapAuthMode } from "./types";

const SETTINGS_REFRESH_MS = 3000;

export interface AccountSettingsDraft {
  label: string; role: AccountRole; target: string; proof: LoginProofRule;
  zapEnabled: boolean; zapLoginUrl: string; zapLoginId: string;
  zapAuthMode: ZapAuthMode; zapCookie: string; zapHeaders: string; zapVerifyUrl: string;
}

export function toDraft(settings: AccountSettings): AccountSettingsDraft {
  return { label: settings.label, role: settings.role, target: settings.target,
    proof: { ...settings.proofRule }, zapEnabled: settings.zap.enabled,
    zapLoginUrl: settings.zap.loginUrl, zapLoginId: settings.zap.loginId,
    // 쿠키·헤더 값은 서버가 되돌려 주지 않으므로 편집창은 빈 값으로 시작한다(모드·검증 URL만 복원).
    zapAuthMode: settings.zap.authMode ?? "FORM", zapCookie: "", zapHeaders: "", zapVerifyUrl: settings.zap.verifyUrl ?? "" };
}

export interface AccountSettingsSheetProps {
  accountId: string | null; adapter: AccountSettingsAdapter; open: boolean; zapRuntimeAvailable?: boolean;
  onOpenChange: (open: boolean) => void; onDeleted?: (accountId: string) => void;
  onSaved?: (settings: AccountSettings) => void;
  /** 삭제 확인창에서 함께 해제될 세션 연결 수를 셀 때만 쓴다. */
  observedSessions?: readonly ObservedSession[];
  /** 처음 열 메뉴. 점검의 ZAP [설정]은 ZAP 로그인 메뉴로 바로 연다. */
  initialTab?: "basic" | "human" | "zap";
}

export function AccountSettingsSheet({ accountId, adapter, open, onOpenChange, onDeleted, onSaved, observedSessions = [], zapRuntimeAvailable = false, initialTab = "basic" }: AccountSettingsSheetProps) {
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [draft, setDraft] = useState<AccountSettingsDraft | null>(null);
  const [zapPassword, setZapPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState("basic");
  const resetLocal = useCallback(() => { setZapPassword(""); setError(null); }, []);

  useEffect(() => {
    if (!open || !accountId) { setSettings(null); setDraft(null); resetLocal(); return; }
    setTab(initialTab);
    let active = true; setPending(true);
    adapter.load(accountId).then((next) => { if (active) { setSettings(next); setDraft(toDraft(next)); setZapPassword(next.zap.password ?? ""); } })
      .catch(() => { if (active) setError("계정 설정을 불러올 수 없습니다."); })
      .finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [open, accountId, adapter, resetLocal, initialTab]);

  // 수집 중에도 저장된 인증값·마지막 기록이 보이도록 서버 상태만 주기적으로 새로 받는다.
  // 편집 중인 draft(이름·규칙·로그인 설정)는 건드리지 않는다.
  const loaded = settings !== null;
  useEffect(() => {
    if (!open || !accountId || !loaded) return;
    const timer = window.setInterval(() => {
      adapter.load(accountId).then((next) => setSettings((previous) => previous && previous.id === next.id
        ? { ...previous, human: next.human, candidates: next.candidates, candidateBlockReasons: next.candidateBlockReasons,
          zap: { ...previous.zap, status: next.zap.status, failureReason: next.zap.failureReason, connected: next.zap.connected, connectionLabel: next.zap.connectionLabel } } : previous))
        .catch(() => undefined);
    }, SETTINGS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [open, accountId, adapter, loaded]);

  const apply = (next: AccountSettings) => { setSettings(next); setDraft(toDraft(next)); setZapPassword(next.zap.password ?? ""); };
  const run = async (task: () => Promise<AccountSettings | void>) => {
    setPending(true); setError(null);
    try { const next = await task(); if (next) apply(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "요청을 처리할 수 없습니다."); }
    finally { setPending(false); }
  };
  const patch = (partial: Partial<AccountSettingsDraft>) => setDraft((previous) => previous ? { ...previous, ...partial } : previous);
  const changes = useMemo(() => {
    if (!settings || !draft) return { basic: false, proof: false, zap: false };
    const original = toDraft(settings);
    return {
      basic: draft.label !== original.label || draft.role !== original.role || draft.target !== original.target,
      proof: JSON.stringify(draft.proof) !== JSON.stringify(original.proof),
      zap: draft.zapEnabled !== original.zapEnabled || draft.zapAuthMode !== original.zapAuthMode
        || draft.zapLoginUrl !== original.zapLoginUrl || draft.zapLoginId !== original.zapLoginId
        || zapPassword !== (settings.zap.password ?? "")
        || draft.zapCookie.trim() !== "" || draft.zapHeaders.trim() !== ""
        || draft.zapVerifyUrl !== (settings.zap.verifyUrl ?? ""),
    };
  }, [settings, draft, zapPassword]);
  const dirty = Object.values(changes).some(Boolean);
  const proofConfigured = Boolean(draft && (draft.proof.path.trim() || draft.proof.responseMark.trim()));
  const targetError = draft ? validateTarget(draft.target) : null;
  const pathError = draft && proofConfigured ? validateProofPath(draft.proof.path) : null;
  const markError = draft && proofConfigured ? validateResponseMark(draft.proof.responseMark) : null;
  const zapCredentialsMissing = Boolean(draft && changes.zap && draft.zapEnabled && (draft.zapAuthMode === "INJECT"
    ? !draft.zapCookie.trim() && !draft.zapHeaders.trim()
    : !draft.zapLoginUrl.trim() || !draft.zapLoginId.trim() || !zapPassword));
  const blocked = Boolean(targetError || pathError || markError || zapCredentialsMissing);

  const requestClose = (nextOpen: boolean) => {
    if (nextOpen) return onOpenChange(true);
    if (dirty) return setConfirmClose(true);
    resetLocal(); onOpenChange(false);
  };
  const handleSave = async () => {
    if (!settings || !draft || blocked) return;
    await run(async () => {
      let next = settings;
      if (changes.basic) next = await adapter.saveBasicInfo(settings.id, { label: draft.label, role: draft.role, target: draft.target });
      if (changes.proof) next = await adapter.saveProofRule(settings.id, proofConfigured ? draft.proof : null);
      if (changes.zap) next = await adapter.saveZapLogin(settings.id, { enabled: draft.zapEnabled, authMode: draft.zapAuthMode, loginUrl: draft.zapLoginUrl, loginId: draft.zapLoginId, password: zapPassword || undefined, cookie: draft.zapCookie, headers: draft.zapHeaders, verifyUrl: draft.zapVerifyUrl });
      onSaved?.(next); return next;
    });
  };
  const boundSessions = settings ? observedSessions.filter((session) => session.accountId === settings.id).length : 0;
  const deleteEffects = settings ? [
    boundSessions ? `세션 연결 ${boundSessions}건` : "",
    settings.human.status !== "UNVERIFIED" && settings.human.status !== "REVOKED" ? "저장된 인증값" : "",
    settings.zap.enabled ? "ZAP 로그인 설정" : "",
    settings.llm.enabled ? "LLM 브라우저 로그인 세션" : "",
  ].filter(Boolean) : [];

  return <>
    <Dialog open={open} onOpenChange={requestClose}><DialogContent aria-describedby={undefined} className="flex h-[min(680px,88vh)] w-full max-w-[880px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[880px]">
      <header className="grid gap-1 border-b border-border px-5 py-4 pr-12"><div className="flex items-center gap-2"><DialogTitle className="text-lg font-semibold">{settings?.label ?? "등록 계정"}<span className="sr-only"> 계정 설정</span></DialogTitle>{settings && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{settings.role}</span>}</div>{settings && <p className="font-mono text-xs text-muted-foreground">{settings.target}</p>}</header>
      {!settings || !draft ? <p className="p-5 text-sm text-muted-foreground">{error ?? "계정 설정을 불러오는 중…"}</p> : <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="min-h-0 flex-1 gap-0">
        <nav className="flex w-52 shrink-0 flex-col border-r border-border bg-muted/40 p-3">
          <TabsList variant="line" className="w-full gap-1 p-0">
            {navItems(settings).map(([value, label, meta]) => <TabsTrigger key={value} value={value} className="h-auto justify-between rounded-md px-3 py-2 text-sm data-active:bg-background data-active:shadow-sm after:hidden"><span>{label}</span>{meta && <span className={cn("text-[11px] font-normal", meta.tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : meta.tone === "idle" ? "text-muted-foreground" : meta.tone === "bad" ? "text-destructive" : "text-amber-600 dark:text-amber-400")}>{meta.label}</span>}</TabsTrigger>)}
          </TabsList>
          <div className="mt-auto border-t border-border pt-3"><button type="button" className="px-3 text-sm text-destructive hover:underline disabled:opacity-50" disabled={pending} onClick={() => setConfirmDelete(true)}>계정 삭제</button></div>
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <BasicAccountTab settings={settings} draft={draft} patch={patch} targetError={targetError} pending={pending} />
        <HumanAccountTab settings={settings} draft={draft} patch={patch} pathError={pathError} markError={markError} pending={pending} run={run} adapter={adapter} />
        <ZapAccountTab settings={settings} draft={draft} patch={patch} password={zapPassword} setPassword={setZapPassword} pending={pending} run={run} adapter={adapter} credentialsMissing={zapCredentialsMissing} unsaved={changes.zap} runtimeAvailable={zapRuntimeAvailable} onGoToHumanTab={() => setTab("human")} />
        {error && <p role="alert" className="mt-4 text-xs text-destructive">{error}</p>}
        </div>
      </Tabs>}
      <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-2"><Button variant="outline" onClick={() => requestClose(false)} disabled={pending}>취소</Button><Button onClick={() => void handleSave()} disabled={pending || blocked || !dirty}>{pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}저장</Button></footer>
    </DialogContent></Dialog>
    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{settings?.label} 계정을 삭제할까요?</AlertDialogTitle><AlertDialogDescription>이미 기록된 요청은 남아요.{deleteEffects.length ? " 아래 항목은 함께 정리돼요." : ""}</AlertDialogDescription></AlertDialogHeader>{deleteEffects.length > 0 && <ul aria-label="함께 정리되는 항목" className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{deleteEffects.map((effect) => <li key={effect}>{effect}</li>)}</ul>}<AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><Button variant="destructive" onClick={() => { setConfirmDelete(false); if (settings) void run(async () => { await adapter.deleteAccount(settings.id); onDeleted?.(settings.id); resetLocal(); onOpenChange(false); }); }}>삭제</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>저장하지 않고 닫을까요?</AlertDialogTitle><AlertDialogDescription>저장하지 않은 변경사항과 입력한 비밀번호는 즉시 삭제됩니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>계속 편집</AlertDialogCancel><Button variant="destructive" onClick={() => { setConfirmClose(false); resetLocal(); onOpenChange(false); }}>저장하지 않고 닫기</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

/** 왼쪽 메뉴: 각 항목 옆에 현재 상태를 한 단어로 보여 준다. */
function navItems(settings: AccountSettings): Array<[string, string, StatusMeta | null]> {
  const off: StatusMeta = { label: "사용 안 함", tone: "idle" };
  return [
    ["basic", "기본 정보", null],
    ["human", "HUMAN", HUMAN_STATUS_META[settings.human.status]],
    ["zap", "ZAP 로그인", settings.zap.enabled ? ZAP_STATUS_META[settings.zap.status] : off],
  ];
}

export default AccountSettingsSheet;
