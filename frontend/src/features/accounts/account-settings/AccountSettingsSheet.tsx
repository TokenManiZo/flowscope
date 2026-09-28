import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ObservedSession } from "@/lib/api/types";
import { BasicAccountTab } from "./BasicAccountTab";
import { HumanAccountTab } from "./HumanAccountTab";
import { LlmAccountTab } from "./LlmAccountTab";
import { ZapAccountTab } from "./ZapAccountTab";
import { ConflictBadge, HUMAN_STATUS_META, StatusBadge, VERIFICATION_META } from "./statusMeta";
import { validateProofPath, validateResponseMark, validateTarget, type AccountRole, type AccountSettings, type AccountSettingsAdapter, type ExplorerAdvancedSettings, type ExplorerLoginSettings, type LoginProofRule } from "./types";

export interface AccountSettingsDraft {
  label: string; role: AccountRole; target: string; proof: LoginProofRule;
  zapEnabled: boolean; zapLoginUrl: string; zapLoginId: string;
  llmEnabled: boolean; llmMode: ExplorerLoginSettings["loginMode"];
  llmLoginUrl: string; llmLoginId: string; llmAdvanced: ExplorerAdvancedSettings;
}

export function toDraft(settings: AccountSettings): AccountSettingsDraft {
  return { label: settings.label, role: settings.role, target: settings.target,
    proof: { ...settings.proofRule }, zapEnabled: settings.zap.enabled,
    zapLoginUrl: settings.zap.loginUrl, zapLoginId: settings.zap.loginId,
    llmEnabled: settings.llm.enabled, llmMode: settings.llm.loginMode,
    llmLoginUrl: settings.llm.loginUrl, llmLoginId: settings.llm.loginId,
    llmAdvanced: { ...settings.llm.advanced } };
}

export interface AccountSettingsSheetProps {
  accountId: string | null; adapter: AccountSettingsAdapter; open: boolean; zapRuntimeAvailable?: boolean;
  onOpenChange: (open: boolean) => void; onDeleted?: (accountId: string) => void;
  onSaved?: (settings: AccountSettings) => void;
  observedSessions?: readonly ObservedSession[];
  onMergeIdentity?: (values: { from: string; into: string }) => Promise<unknown>;
}

export function AccountSettingsSheet({ accountId, adapter, open, onOpenChange, onDeleted, onSaved, observedSessions = [], onMergeIdentity, zapRuntimeAvailable = false }: AccountSettingsSheetProps) {
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [draft, setDraft] = useState<AccountSettingsDraft | null>(null);
  const [zapPassword, setZapPassword] = useState("");
  const [llmPassword, setLlmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [tab, setTab] = useState("basic");
  const [identity, setIdentity] = useState("__none__");
  const [mergePending, setMergePending] = useState(false);
  const resetLocal = useCallback(() => { setZapPassword(""); setLlmPassword(""); setIdentity("__none__"); setError(null); }, []);

  useEffect(() => {
    if (!open || !accountId) { setSettings(null); setDraft(null); resetLocal(); return; }
    setTab("basic");
    let active = true; setPending(true);
    adapter.load(accountId).then((next) => { if (active) { setSettings(next); setDraft(toDraft(next)); } })
      .catch(() => { if (active) setError("계정 설정을 불러올 수 없습니다."); })
      .finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [open, accountId, adapter, resetLocal]);

  const apply = (next: AccountSettings) => { setSettings(next); setDraft(toDraft(next)); };
  const run = async (task: () => Promise<AccountSettings | void>) => {
    setPending(true); setError(null);
    try { const next = await task(); if (next) apply(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "요청을 처리할 수 없습니다."); }
    finally { setPending(false); }
  };
  const patch = (partial: Partial<AccountSettingsDraft>) => setDraft((previous) => previous ? { ...previous, ...partial } : previous);
  const changes = useMemo(() => {
    if (!settings || !draft) return { basic: false, proof: false, zap: false, llm: false };
    const original = toDraft(settings);
    return {
      basic: draft.label !== original.label || draft.role !== original.role || draft.target !== original.target,
      proof: JSON.stringify(draft.proof) !== JSON.stringify(original.proof),
      zap: draft.zapEnabled !== original.zapEnabled || draft.zapLoginUrl !== original.zapLoginUrl || draft.zapLoginId !== original.zapLoginId || zapPassword !== "",
      llm: draft.llmEnabled !== original.llmEnabled || draft.llmMode !== original.llmMode || draft.llmLoginUrl !== original.llmLoginUrl || draft.llmLoginId !== original.llmLoginId || JSON.stringify(draft.llmAdvanced) !== JSON.stringify(original.llmAdvanced) || llmPassword !== "",
    };
  }, [settings, draft, zapPassword, llmPassword]);
  const dirty = Object.values(changes).some(Boolean);
  const proofConfigured = Boolean(draft && (draft.proof.path.trim() || draft.proof.responseMark.trim()));
  const targetError = draft ? validateTarget(draft.target) : null;
  const pathError = draft && proofConfigured ? validateProofPath(draft.proof.path) : null;
  const markError = draft && proofConfigured ? validateResponseMark(draft.proof.responseMark) : null;
  const zapCredentialsMissing = Boolean(draft && changes.zap && draft.zapEnabled && (!draft.zapLoginUrl.trim() || !draft.zapLoginId.trim() || !zapPassword));
  const llmCredentialsMissing = Boolean(draft && changes.llm && draft.llmEnabled && (!draft.llmLoginUrl.trim() || !draft.llmLoginId.trim() || !llmPassword));
  const blocked = Boolean(targetError || pathError || markError || zapCredentialsMissing || llmCredentialsMissing);

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
      if (changes.zap) next = await adapter.saveZapLogin(settings.id, { enabled: draft.zapEnabled, loginUrl: draft.zapLoginUrl, loginId: draft.zapLoginId, password: zapPassword || undefined });
      if (changes.llm) next = await adapter.saveExplorerLogin(settings.id, { enabled: draft.llmEnabled, loginMode: draft.llmMode, loginUrl: draft.llmLoginUrl, loginId: draft.llmLoginId, password: llmPassword || undefined, advanced: draft.llmAdvanced });
      setZapPassword(""); setLlmPassword(""); onSaved?.(next); return next;
    });
  };
  const handleMergeIdentity = async () => {
    if (!settings || !onMergeIdentity || identity === "__none__") return;
    setMergePending(true); setError(null);
    try { await onMergeIdentity({ from: identity, into: settings.id }); setIdentity("__none__"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "관측 신원을 연결할 수 없습니다."); }
    finally { setMergePending(false); }
  };

  return <>
    <Sheet open={open} onOpenChange={requestClose}><SheetContent side="right" className="flex w-full max-w-none flex-col gap-0 overflow-hidden p-0 lg:max-w-3xl" aria-label={`${settings?.label ?? "등록 계정"} 계정 설정`}>
      <header className="space-y-2 border-b border-border px-4 py-4"><h2 className="text-lg font-semibold">{settings?.label ?? "등록 계정"} 계정 설정</h2>{settings && <><p className="font-mono text-xs text-muted-foreground">{settings.role} · {settings.target}</p><div className="flex flex-wrap items-center gap-2"><StatusBadge meta={HUMAN_STATUS_META[settings.human.status]} /><StatusBadge meta={VERIFICATION_META[settings.human.verificationSource]} />{settings.human.credentialConflict && <ConflictBadge />}</div></>}</header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{!settings || !draft ? <p className="text-sm text-muted-foreground">{error ?? "계정 설정을 불러오는 중…"}</p> : <Tabs value={tab} onValueChange={setTab}><TabsList className="grid w-full grid-cols-4"><TabsTrigger value="basic">기본 정보</TabsTrigger><TabsTrigger value="human">HUMAN</TabsTrigger><TabsTrigger value="zap">ZAP</TabsTrigger><TabsTrigger value="llm">LLM</TabsTrigger></TabsList>
        <BasicAccountTab settings={settings} draft={draft} patch={patch} targetError={targetError} pending={pending} observedSessions={observedSessions} identity={identity} onIdentityChange={setIdentity} onMergeIdentity={onMergeIdentity ? handleMergeIdentity : undefined} mergePending={mergePending} onDelete={() => run(async () => { await adapter.deleteAccount(settings.id); onDeleted?.(settings.id); resetLocal(); onOpenChange(false); })} />
        <HumanAccountTab settings={settings} draft={draft} patch={patch} pathError={pathError} markError={markError} pending={pending} run={run} adapter={adapter} />
        <ZapAccountTab settings={settings} draft={draft} patch={patch} password={zapPassword} setPassword={setZapPassword} pending={pending} run={run} adapter={adapter} credentialsMissing={zapCredentialsMissing} runtimeAvailable={zapRuntimeAvailable} onGoToHumanTab={() => setTab("human")} />
        <LlmAccountTab settings={settings} draft={draft} patch={patch} password={llmPassword} setPassword={setLlmPassword} pending={pending} run={run} adapter={adapter} credentialsMissing={llmCredentialsMissing} />
      </Tabs>}{error && <p role="alert" className="mt-4 text-xs text-destructive">{error}</p>}</div>
      <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3"><Button variant="outline" onClick={() => requestClose(false)} disabled={pending}>취소</Button><Button onClick={() => void handleSave()} disabled={pending || blocked || !dirty}>{pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}변경사항 저장</Button></footer>
    </SheetContent></Sheet>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>저장하지 않고 닫을까요?</AlertDialogTitle><AlertDialogDescription>저장하지 않은 변경사항과 입력한 비밀번호는 즉시 삭제됩니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>계속 편집</AlertDialogCancel><Button variant="destructive" onClick={() => { setConfirmClose(false); resetLocal(); onOpenChange(false); }}>저장하지 않고 닫기</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

export default AccountSettingsSheet;
