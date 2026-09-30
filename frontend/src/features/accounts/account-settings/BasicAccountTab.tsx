import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { AccountSettingsDraft } from "./AccountSettingsSheet";
import type { AccountRole, AccountSettings } from "./types";

const ROLES: AccountRole[] = ["User", "LV1", "LV2", "Admin"];

/** 역할 네 개를 한 번에 보이는 버튼 묶음으로 고른다. */
export function RoleSegment({ value, onChange, disabled = false, labelledBy }: {
  value: AccountRole; onChange: (role: AccountRole) => void; disabled?: boolean; labelledBy: string;
}) {
  return <div role="group" aria-labelledby={labelledBy} className="inline-flex w-fit overflow-hidden rounded-md border border-border">
    {ROLES.map((role) => <button key={role} type="button" aria-pressed={value === role} disabled={disabled} onClick={() => onChange(role)}
      className={cn("border-r border-border px-3.5 py-1.5 text-sm last:border-r-0 disabled:opacity-50", value === role ? "bg-primary font-medium text-primary-foreground" : "hover:bg-muted")}>{role}</button>)}
  </div>;
}

/** 이름·역할·대상 서비스. 수집 중 트래픽은 연결한 계정으로 바로 인식하므로 사후 신원 병합은 두지 않는다. */
export function BasicAccountTab({ settings, draft, patch, targetError, pending }: {
  settings: AccountSettings; draft: AccountSettingsDraft;
  patch: (value: Partial<AccountSettingsDraft>) => void; targetError: string | null;
  pending: boolean;
}) {
  return <TabsContent value="basic" className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5"><Label htmlFor="account-label">표시 이름</Label><Input id="account-label" value={draft.label} onChange={(event) => patch({ label: event.target.value })} /></div>
      <div className="grid gap-1.5"><Label id="account-role">역할</Label><RoleSegment labelledBy="account-role" value={draft.role} onChange={(role) => patch({ role })} disabled={pending} /></div>
    </div>
    <div className="grid gap-1.5"><Label htmlFor="account-target">대상 서비스</Label><Input id="account-target" value={draft.target} onChange={(event) => patch({ target: event.target.value })} className="font-mono" />{targetError ? <p role="alert" className="text-xs text-destructive">{targetError}</p> : <p className="text-xs text-muted-foreground">바꾸면 연결된 세션이 끊길 수 있습니다.</p>}</div>
    <p className="text-sm text-muted-foreground">계정 ID <span className="font-mono text-foreground">{settings.id}</span></p>
  </TabsContent>;
}
