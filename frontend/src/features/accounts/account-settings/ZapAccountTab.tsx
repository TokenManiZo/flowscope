import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import type { AccountSettingsDraft } from "./AccountSettingsSheet";
import { StatusBadge, ZAP_STATUS_META } from "./statusMeta";
import type { AccountSettings, AccountSettingsAdapter } from "./types";

type Run = (task: () => Promise<AccountSettings | void>) => Promise<void>;
export function ZapAccountTab({ settings, draft, patch, password, setPassword, pending, run, adapter, credentialsMissing, unsaved = false, runtimeAvailable = false, onGoToHumanTab }: {
  settings: AccountSettings; draft: AccountSettingsDraft; patch: (value: Partial<AccountSettingsDraft>) => void;
  password: string; setPassword: (value: string) => void; pending: boolean; run: Run;
  adapter: AccountSettingsAdapter; credentialsMissing: boolean;
  /** ZAP 입력값이 저장된 값과 다르면 [로그인 검증]이 먼저 저장한 뒤 검증한다. */
  unsaved?: boolean;
  /** 기존 zap-status 신호(managedRuntime/connected)로 채운다. 새 상태를 만들지 않는다. */
  runtimeAvailable?: boolean; onGoToHumanTab?: () => void;
}) {
  const filled = Boolean(draft.zapLoginUrl.trim() && draft.zapLoginId.trim() && password);
  // 저장을 따로 누르지 않아도 URL·ID·비밀번호가 다 있으면 검증할 수 있다. 바뀐 값이 있으면 먼저 저장한다.
  const verify = () => run(async () => {
    if (unsaved) await adapter.saveZapLogin(settings.id, { enabled: true, loginUrl: draft.zapLoginUrl, loginId: draft.zapLoginId, password });
    return adapter.verifyZapLogin(settings.id);
  });
  return <TabsContent value="zap" className="space-y-4">
    {!runtimeAvailable && <p className="text-sm text-muted-foreground">ZAP 로그인은 Docker 런타임(zap-up)이 필요합니다. 없으면 <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => onGoToHumanTab?.()}>HUMAN 세션에서 직접 등록</button>하세요.</p>}
    <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5"><Checkbox checked={draft.zapEnabled} onCheckedChange={(value) => patch({ zapEnabled: value === true })} aria-label="ZAP 로그인 설정 사용" /><span className="text-sm font-medium">ZAP 로그인 설정 사용</span></label>
    <div className="flex flex-wrap items-center gap-2"><StatusBadge meta={ZAP_STATUS_META[settings.zap.status]} /></div>
    {settings.zap.connectionLabel && <p role="status" aria-label="ZAP 연결 상태" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"><span className="font-semibold">ZAP 연결 · </span>{settings.zap.connectionLabel}</p>}
    <div className="grid gap-1.5"><Label htmlFor="zap-login-url">로그인 URL</Label><Input id="zap-login-url" value={draft.zapLoginUrl} disabled={!draft.zapEnabled} onChange={(event) => patch({ zapLoginUrl: event.target.value })} className="font-mono" /></div>
    <div className="grid items-start gap-4 sm:grid-cols-2">
    <div className="grid gap-1.5"><Label htmlFor="zap-login-id">로그인 ID</Label><Input id="zap-login-id" value={draft.zapLoginId} disabled={!draft.zapEnabled} onChange={(event) => patch({ zapLoginId: event.target.value })} autoComplete="off" spellCheck={false} /></div>
    <div className="grid gap-1.5"><Label htmlFor="zap-password">비밀번호</Label><Input id="zap-password" type="text" value={password} disabled={!draft.zapEnabled} onChange={(event) => setPassword(event.target.value)} autoComplete="off" spellCheck={false} className="font-mono" /><p className="text-xs text-muted-foreground">현재 Burp 프로세스 메모리에만 유지됩니다.</p></div>
    </div>
    {credentialsMissing && <p role="alert" className="text-xs text-destructive">ZAP 설정을 변경하려면 로그인 URL·ID·비밀번호를 모두 입력하세요.</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending || !runtimeAvailable || !draft.zapEnabled || !filled} onClick={() => void verify()}>{unsaved ? "저장하고 로그인 검증" : "로그인 검증"}</Button><Button variant="ghost" className="text-destructive hover:text-destructive" disabled={pending || !settings.zap.hasPassword} onClick={() => void run(async () => { const next = await adapter.revokeZapCredentials(settings.id); setPassword(""); return next; })}>자격증명 폐기</Button></div>
    {settings.zap.status === "FAILED" && <Alert variant="destructive"><AlertDescription className="text-xs">로그인 실패 — {settings.zap.failureReason || "실패 사유 없음"}. ANON으로 자동 대체하지 않습니다.</AlertDescription></Alert>}
  </TabsContent>;
}
