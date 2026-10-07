import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const inject = draft.zapAuthMode === "INJECT";
  const filled = Boolean(draft.zapLoginUrl.trim() && draft.zapLoginId.trim() && password);
  // 주입 모드는 쿠키나 헤더가 있으면(새로 입력했거나 이미 저장돼 있으면) 검증할 수 있다.
  const injectFilled = Boolean(draft.zapCookie.trim() || draft.zapHeaders.trim() || settings.zap.hasCookie || settings.zap.hasHeaders);
  // 저장을 따로 누르지 않아도 값이 다 있으면 검증한다. 바뀐 값이 있으면 먼저 저장한다.
  const verify = () => run(async () => {
    if (unsaved) await adapter.saveZapLogin(settings.id, inject
      ? { enabled: true, authMode: "INJECT", loginUrl: "", loginId: "", cookie: draft.zapCookie, headers: draft.zapHeaders, verifyUrl: draft.zapVerifyUrl }
      : { enabled: true, authMode: "FORM", loginUrl: draft.zapLoginUrl, loginId: draft.zapLoginId, password });
    return adapter.verifyZapLogin(settings.id);
  });
  return <TabsContent value="zap" className="space-y-4">
    {!runtimeAvailable && <p className="text-sm text-muted-foreground">ZAP 로그인은 Docker 런타임(zap-up)이 필요합니다. 없으면 <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => onGoToHumanTab?.()}>HUMAN 세션에서 직접 등록</button>하세요.</p>}
    <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5"><Checkbox checked={draft.zapEnabled} onCheckedChange={(value) => patch({ zapEnabled: value === true })} aria-label="ZAP 로그인 설정 사용" /><span className="text-sm font-medium">ZAP 로그인 설정 사용</span></label>
    <div className="flex flex-wrap items-center gap-2"><StatusBadge meta={ZAP_STATUS_META[settings.zap.status]} /></div>
    {settings.zap.connectionLabel && <p role="status" aria-label="ZAP 연결 상태" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"><span className="font-semibold">ZAP 연결 · </span>{settings.zap.connectionLabel}</p>}
    {/* 로그인 방식: 폼 로그인(ZAP 자동 ID/PW) vs 인증값 주입(MFA·SSO 등은 직접 로그인 후 쿠키/헤더 주입). */}
    <fieldset className="grid gap-1.5" disabled={!draft.zapEnabled}><Label>로그인 방식</Label><div role="group" aria-label="로그인 방식" className="grid grid-cols-2 gap-1.5">{([["FORM", "폼 로그인"], ["INJECT", "인증값 주입"]] as const).map(([mode, label]) => <Button key={mode} type="button" size="sm" variant={draft.zapAuthMode === mode ? "secondary" : "ghost"} aria-pressed={draft.zapAuthMode === mode} disabled={!draft.zapEnabled} onClick={() => patch({ zapAuthMode: mode })}>{label}</Button>)}</div><p className="text-xs text-muted-foreground">{inject ? "MFA·SSO 등 ZAP이 자동 로그인할 수 없을 때, 직접 로그인 후 쿠키나 인증 헤더를 넣습니다." : "ZAP이 로그인 URL에 ID·비밀번호를 넣어 로그인합니다."}</p></fieldset>
    {inject ? <>
      <div className="grid gap-1.5"><Label htmlFor="zap-cookie">쿠키{settings.zap.hasCookie ? " · 저장됨" : ""}</Label><Textarea id="zap-cookie" value={draft.zapCookie} disabled={!draft.zapEnabled} onChange={(event) => patch({ zapCookie: event.target.value })} placeholder="SESSION=abc123; csrf=z9" autoComplete="off" spellCheck={false} className="min-h-[64px] font-mono" /></div>
      <div className="grid gap-1.5"><Label htmlFor="zap-headers">인증 헤더{settings.zap.hasHeaders ? " · 저장됨" : ""}</Label><Textarea id="zap-headers" value={draft.zapHeaders} disabled={!draft.zapEnabled} onChange={(event) => patch({ zapHeaders: event.target.value })} placeholder="Authorization: Bearer eyJ..." autoComplete="off" spellCheck={false} className="min-h-[64px] font-mono" /><p className="text-xs text-muted-foreground">한 줄에 헤더 하나씩. 쿠키나 헤더 중 하나 이상을 넣으세요. 현재 Burp 프로세스 메모리에만 유지됩니다.</p></div>
      <div className="grid gap-1.5"><Label htmlFor="zap-verify-url">검증 URL (선택)</Label><Input id="zap-verify-url" value={draft.zapVerifyUrl} disabled={!draft.zapEnabled} onChange={(event) => patch({ zapVerifyUrl: event.target.value })} placeholder={`${settings.target}/api/me`} autoComplete="off" spellCheck={false} className="font-mono" /><p className="text-xs text-muted-foreground">로그인해야 열리는 <span className="font-medium text-foreground">API 주소</span>를 넣으세요. 화면 주소(<code>/dashboard</code> 등)가 아니라, 개발자도구 <span className="font-medium text-foreground">Network 탭</span>에서 로그인 후 데이터가 오는 요청의 URL을 복사합니다. 대상과 같은 호스트여야 합니다.</p></div>
    </> : <>
      <div className="grid gap-1.5"><Label htmlFor="zap-login-url">로그인 URL</Label><Input id="zap-login-url" value={draft.zapLoginUrl} disabled={!draft.zapEnabled} onChange={(event) => patch({ zapLoginUrl: event.target.value })} className="font-mono" /></div>
      <div className="grid items-start gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5"><Label htmlFor="zap-login-id">로그인 ID</Label><Input id="zap-login-id" value={draft.zapLoginId} disabled={!draft.zapEnabled} onChange={(event) => patch({ zapLoginId: event.target.value })} autoComplete="off" spellCheck={false} /></div>
      <div className="grid gap-1.5"><Label htmlFor="zap-password">비밀번호</Label><Input id="zap-password" type="text" value={password} disabled={!draft.zapEnabled} onChange={(event) => setPassword(event.target.value)} autoComplete="off" spellCheck={false} className="font-mono" /><p className="text-xs text-muted-foreground">현재 Burp 프로세스 메모리에만 유지됩니다.</p></div>
      </div>
    </>}
    {credentialsMissing && <p role="alert" className="text-xs text-destructive">{inject ? "주입할 쿠키나 인증 헤더를 하나 이상 입력하세요." : "ZAP 설정을 변경하려면 로그인 URL·ID·비밀번호를 모두 입력하세요."}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending || !runtimeAvailable || !draft.zapEnabled || (inject ? !injectFilled : !filled)} onClick={() => void verify()}>{inject ? (unsaved ? "저장하고 주입값 검증" : "주입값 검증") : (unsaved ? "저장하고 로그인 검증" : "로그인 검증")}</Button><Button variant="ghost" className="text-destructive hover:text-destructive" disabled={pending || !(settings.zap.hasPassword || settings.zap.hasCookie || settings.zap.hasHeaders)} onClick={() => void run(async () => { const next = await adapter.revokeZapCredentials(settings.id); setPassword(""); return next; })}>자격증명 폐기</Button></div>
    {inject && <p className="text-xs text-muted-foreground">주입값 검증은 넣은 쿠키·헤더로 대상에 한 번 요청해 로그인 상태를 확인합니다. 로그인 상태 정규식을 함께 넣으면 더 정확합니다.</p>}
    {settings.zap.status === "FAILED" && <Alert variant="destructive"><AlertDescription className="text-xs">로그인 실패 — {settings.zap.failureReason || "실패 사유 없음"}. ANON으로 자동 대체하지 않습니다.</AlertDescription></Alert>}
  </TabsContent>;
}
