import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import type { AccountSettingsDraft } from "./AccountSettingsSheet";
import type { AccountRole, AccountSettings } from "./types";
import type { ObservedSession } from "@/lib/api/types";

const ROLES: AccountRole[] = ["User", "LV1", "LV2", "Admin"];

const NO_IDENTITY = "__none__";
function sameOrigin(left: string, right: string) {
  try { return new URL(left.trim()).origin === new URL(right.trim()).origin; } catch { return false; }
}

export function BasicAccountTab({ settings, draft, patch, targetError, pending, onDelete, observedSessions = [], identity, onIdentityChange, onMergeIdentity, mergePending = false }: {
  settings: AccountSettings; draft: AccountSettingsDraft;
  patch: (value: Partial<AccountSettingsDraft>) => void; targetError: string | null;
  pending: boolean; onDelete: () => Promise<void>;
  observedSessions?: readonly ObservedSession[]; identity?: string;
  onIdentityChange?: (identity: string) => void; onMergeIdentity?: () => Promise<void>;
  mergePending?: boolean;
}) {
  const identities = [...new Set(observedSessions.filter((session) => sameOrigin(session.service, draft.target) && !session.accountId && session.idn !== settings.id).map((session) => session.idn))];
  return <TabsContent value="basic" className="space-y-4 pt-4">
    <div className="grid gap-1.5"><Label htmlFor="account-label">등록 계정 표시 이름</Label><Input id="account-label" value={draft.label} onChange={(event) => patch({ label: event.target.value })} /></div>
    <div className="grid gap-1.5"><Label htmlFor="account-role">등록 계정 역할</Label><Select value={draft.role} onValueChange={(value) => patch({ role: value as AccountRole })}><SelectTrigger id="account-role"><SelectValue /></SelectTrigger><SelectContent>{ROLES.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent></Select></div>
    <div className="grid gap-1.5"><Label htmlFor="account-target">대상 서비스 (exact origin)</Label><Input id="account-target" value={draft.target} onChange={(event) => patch({ target: event.target.value })} className="font-mono" />{targetError && <p role="alert" className="text-xs text-destructive">{targetError}</p>}<p className="text-xs text-muted-foreground">대상 서비스를 바꾸면 연결된 기존 세션이 무효화될 수 있습니다.</p></div>
    <div className="grid gap-1.5"><Label htmlFor="account-id">계정 ID</Label><Input id="account-id" value={settings.id} readOnly className="font-mono" /></div>
    {onIdentityChange && onMergeIdentity && <section className="space-y-2 rounded-lg border border-border/70 p-3" aria-labelledby="account-observed-identity"><div><h3 id="account-observed-identity" className="text-sm font-semibold">관측 신원 연결</h3><p className="text-xs text-muted-foreground">현재 exact-origin과 같은 서비스의 미연결 신원만 표시합니다.</p></div><div className="flex flex-col gap-2 sm:flex-row"><Select value={identity ?? NO_IDENTITY} onValueChange={onIdentityChange} disabled={pending || mergePending}><SelectTrigger aria-label="같은 서비스 관측 신원"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NO_IDENTITY}>신원 선택</SelectItem>{identities.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" disabled={!identity || identity === NO_IDENTITY || pending || mergePending} onClick={() => void onMergeIdentity()}>{mergePending ? "연결 중" : "관측 신원 연결"}</Button></div></section>}
    <section className="space-y-2 rounded-lg border border-destructive/40 p-3"><h3 className="flex items-center gap-2 text-sm font-semibold text-destructive"><AlertTriangle className="size-4" aria-hidden="true" />위험 작업</h3><p className="text-xs text-muted-foreground">삭제하면 HUMAN 세션과 이 ID에 연결된 ZAP·LLM 메모리 자격도 함께 폐기됩니다.</p><Button variant="destructive" disabled={pending} onClick={() => void onDelete()}><Trash2 className="size-4" aria-hidden="true" />등록 계정 삭제</Button></section>
  </TabsContent>;
}
