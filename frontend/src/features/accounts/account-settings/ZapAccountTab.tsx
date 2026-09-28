import { ShieldCheck, TriangleAlert } from "lucide-react";
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
export function ZapAccountTab({ settings, draft, patch, password, setPassword, pending, run, adapter, credentialsMissing, runtimeAvailable = false, onGoToHumanTab }: {
  settings: AccountSettings; draft: AccountSettingsDraft; patch: (value: Partial<AccountSettingsDraft>) => void;
  password: string; setPassword: (value: string) => void; pending: boolean; run: Run;
  adapter: AccountSettingsAdapter; credentialsMissing: boolean;
  /** 기존 zap-status 신호(managedRuntime/connected)로 채운다. 새 상태를 만들지 않는다. */
  runtimeAvailable?: boolean; onGoToHumanTab?: () => void;
}) {
  return <TabsContent value="zap" className="space-y-4 pt-4">
    <Alert aria-label="ZAP 런타임 안내"><TriangleAlert className="size-4" aria-hidden="true" /><AlertDescription className="space-y-2 text-xs"><span className="block">ZAP 로그인 검증은 FlowScope Docker Chromium 런타임(zap-up helper)이 필요합니다. 런타임 없이 계정을 검증하려면 HUMAN 탭에서 직접 등록하세요.</span><Button type="button" variant="outline" size="sm" onClick={() => onGoToHumanTab?.()}>HUMAN 탭에서 자격증명 직접 등록 →</Button></AlertDescription></Alert>
    <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5"><Checkbox checked={draft.zapEnabled} onCheckedChange={(value) => patch({ zapEnabled: value === true })} aria-label="ZAP 로그인 설정 사용" /><span className="text-sm font-medium">ZAP 로그인 설정 사용</span></label>
    <div className="flex flex-wrap items-center gap-2"><StatusBadge meta={ZAP_STATUS_META[settings.zap.status]} /><span className="font-mono text-xs text-muted-foreground">{settings.zap.connectionLabel}</span></div>
    <div className="grid gap-1.5"><Label htmlFor="zap-login-url">로그인 URL</Label><Input id="zap-login-url" value={draft.zapLoginUrl} disabled={!draft.zapEnabled} onChange={(event) => patch({ zapLoginUrl: event.target.value })} className="font-mono" /></div>
    <div className="grid gap-1.5"><Label htmlFor="zap-login-id">로그인 ID</Label><Input id="zap-login-id" value={draft.zapLoginId} disabled={!draft.zapEnabled} onChange={(event) => patch({ zapLoginId: event.target.value })} autoComplete="off" placeholder={settings.zap.hasPassword ? "변경할 때 다시 입력" : ""} /></div>
    <div className="grid gap-1.5"><Label htmlFor="zap-password">비밀번호</Label><Input id="zap-password" type="password" value={password} disabled={!draft.zapEnabled} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder={settings.zap.hasPassword ? "비밀번호 등록됨" : ""} /><p className="text-xs text-muted-foreground">{settings.zap.hasPassword ? "등록됨 (다시 표시되지 않음)" : "현재 프로세스 메모리에만 유지됩니다."}</p>{credentialsMissing && <p role="alert" className="text-xs text-destructive">ZAP 설정을 변경하려면 로그인 URL·ID·비밀번호를 모두 입력하세요.</p>}</div>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending || !runtimeAvailable || !settings.zap.hasPassword} onClick={() => void run(() => adapter.verifyZapLogin(settings.id))}>로그인 검증</Button><Button variant="destructive" disabled={pending || !settings.zap.hasPassword} onClick={() => void run(async () => { const next = await adapter.revokeZapCredentials(settings.id); setPassword(""); return next; })}>자격증명 폐기</Button></div>
    {!runtimeAvailable && <p className="text-xs text-muted-foreground">런타임이 없어 ZAP 검증을 실행할 수 없습니다. zap-up helper 실행 후 활성화됩니다. (HUMAN 직접 등록은 지금 가능)</p>}
    {settings.zap.status === "FAILED" && <Alert variant="destructive"><AlertDescription className="text-xs">로그인 실패 — {settings.zap.failureReason || "실패 사유 없음"}. ANON으로 자동 대체하지 않습니다.</AlertDescription></Alert>}
    <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />자격증명은 ZAP 메모리 저장소에만 두며 프로젝트 파일과 snapshot에는 저장하지 않습니다.</p>
  </TabsContent>;
}
