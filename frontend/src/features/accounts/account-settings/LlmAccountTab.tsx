import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import type { AccountSettingsDraft } from "./AccountSettingsSheet";
import { EXPLORER_STATUS_META, StatusBadge } from "./statusMeta";
import type { AccountSettings, AccountSettingsAdapter, ExplorerAdvancedSettings, ExplorerLoginSettings } from "./types";

type Run = (task: () => Promise<AccountSettings | void>) => Promise<void>;
const ADVANCED: Array<[keyof ExplorerAdvancedSettings, string]> = [["idField", "로그인 ID 필드명"], ["passwordField", "비밀번호 필드명"], ["tokenJsonPath", "토큰 JSON 경로"], ["authHeaderName", "인증 헤더 이름"], ["authPrefix", "인증 접두사"], ["validationUrl", "로그인 검증 URL"]];

export function LlmAccountTab({ settings, draft, patch, password, setPassword, pending, run, adapter, credentialsMissing }: {
  settings: AccountSettings; draft: AccountSettingsDraft; patch: (value: Partial<AccountSettingsDraft>) => void;
  password: string; setPassword: (value: string) => void; pending: boolean; run: Run;
  adapter: AccountSettingsAdapter; credentialsMissing: boolean;
}) {
  return <TabsContent value="llm" className="space-y-4 pt-4">
    <p className="text-xs text-muted-foreground">LLM Explorer가 대상 웹 서비스에 로그인할 때 사용할 동일 등록 계정의 실행 설정입니다.</p>
    <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5"><Checkbox checked={draft.llmEnabled} onCheckedChange={(value) => patch({ llmEnabled: value === true })} aria-label="LLM Explorer 로그인 설정 사용" /><span className="text-sm font-medium">LLM Explorer 설정 사용</span></label>
    <StatusBadge meta={EXPLORER_STATUS_META[settings.llm.status]} />
    <div className="grid gap-1.5"><Label htmlFor="llm-mode">로그인 방식</Label><Select value={draft.llmMode} onValueChange={(value) => patch({ llmMode: value as ExplorerLoginSettings["loginMode"] })} disabled={!draft.llmEnabled}><SelectTrigger id="llm-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HTML_FORM">HTML form</SelectItem><SelectItem value="JSON_API">JSON API</SelectItem></SelectContent></Select></div>
    <div className="grid gap-1.5"><Label htmlFor="llm-login-url">로그인 URL</Label><Input id="llm-login-url" value={draft.llmLoginUrl} disabled={!draft.llmEnabled} onChange={(event) => patch({ llmLoginUrl: event.target.value })} className="font-mono" /></div>
    <div className="grid gap-1.5"><Label htmlFor="llm-login-id">로그인 ID</Label><Input id="llm-login-id" value={draft.llmLoginId} disabled={!draft.llmEnabled} onChange={(event) => patch({ llmLoginId: event.target.value })} autoComplete="off" placeholder={settings.llm.hasPassword ? "변경할 때 다시 입력" : ""} /></div>
    <div className="grid gap-1.5"><Label htmlFor="llm-password">비밀번호</Label><Input id="llm-password" type="password" value={password} disabled={!draft.llmEnabled} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder={settings.llm.hasPassword ? "비밀번호 등록됨" : ""} /><p className="text-xs text-muted-foreground">{settings.llm.hasPassword ? "등록됨 — 원문은 반환하거나 다시 표시하지 않습니다." : "현재 프로세스 메모리에만 유지됩니다."}</p>{credentialsMissing && <p role="alert" className="text-xs text-destructive">LLM 설정을 변경하려면 로그인 URL·ID·비밀번호를 모두 입력하세요.</p>}</div>
    <Accordion type="single" collapsible><AccordionItem value="advanced"><AccordionTrigger className="text-sm">고급 설정</AccordionTrigger><AccordionContent className="grid gap-3 sm:grid-cols-2">{ADVANCED.map(([key, label]) => <div key={key} className="grid gap-1.5"><Label htmlFor={`llm-${key}`}>{label}</Label><Input id={`llm-${key}`} value={draft.llmAdvanced[key]} disabled={!draft.llmEnabled} onChange={(event) => patch({ llmAdvanced: { ...draft.llmAdvanced, [key]: event.target.value } })} className="font-mono" /></div>)}</AccordionContent></AccordionItem></Accordion>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending || !settings.llm.hasPassword} onClick={() => void run(() => adapter.verifyExplorerLogin(settings.id))}>로그인 검증</Button><Button variant="destructive" disabled={pending || !settings.llm.hasPassword} onClick={() => void run(async () => { const next = await adapter.revokeExplorerCredentials(settings.id); setPassword(""); return next; })}>자격증명 폐기</Button></div>
    {settings.llm.failureReason && <Alert variant="destructive"><AlertDescription className="text-xs">{settings.llm.failureReason} 다른 계정이나 ANON으로 대체하지 않습니다.</AlertDescription></Alert>}
  </TabsContent>;
}
