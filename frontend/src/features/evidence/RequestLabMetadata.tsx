import { Label } from "@/components/ui/label"
import type { ManagedSession } from "@/lib/api/types"

export type RequestLabCredentialMode = "ORIGINAL" | "ANONYMOUS" | "ACCOUNT"

interface Props {
  service: string
  identity: string
  requestRetained: boolean
  responseRetained: boolean
  requestCharset: string | null
  responseCharset: string | null
  requestEditable: boolean
  sessionStatus: string
  credentialMode: RequestLabCredentialMode
  eligibleAccounts: readonly ManagedSession[]
  selectedAccountId: string
  disabled?: boolean
  onCredentialModeChange(mode: RequestLabCredentialMode): void
  onAccountChange(accountId: string): void
}

const selectClassName = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"

export function RequestLabMetadata({
  service,
  identity,
  requestRetained,
  responseRetained,
  requestCharset,
  responseCharset,
  requestEditable,
  sessionStatus,
  credentialMode,
  eligibleAccounts,
  selectedAccountId,
  disabled = false,
  onCredentialModeChange,
  onAccountChange,
}: Props) {
  return <section aria-label="Request Lab 메타데이터" className="grid content-start gap-5 border-b bg-muted/20 p-4 lg:border-r lg:border-b-0">
    <dl className="grid gap-3 text-sm">
      <div className="grid gap-1"><dt className="text-xs font-medium text-muted-foreground">서비스</dt><dd className="break-all">서비스: {service}</dd></div>
      <div className="grid gap-1"><dt className="text-xs font-medium text-muted-foreground">관측 신원</dt><dd className="break-all">{identity}</dd></div>
      <div className="grid gap-1"><dt className="text-xs font-medium text-muted-foreground">보존</dt><dd>요청 {requestRetained ? "보존" : "미보존"} · 응답 {responseRetained ? "보존" : "미보존"}</dd></div>
      <div className="grid gap-1"><dt className="text-xs font-medium text-muted-foreground">문자셋</dt><dd>{requestCharset ?? "알 수 없음"} / {responseCharset ?? "알 수 없음"}</dd></div>
      <div className="grid gap-1"><dt className="text-xs font-medium text-muted-foreground">편집</dt><dd>{requestEditable ? "요청 편집 가능" : "요청 편집 불가"}</dd></div>
      <div className="grid gap-1"><dt className="text-xs font-medium text-muted-foreground">관측 신원의 재사용 세션</dt><dd>{sessionStatus}</dd></div>
    </dl>

    <div className="grid gap-2">
      <Label htmlFor="request-lab-mode">자격 증명 모드</Label>
      <select id="request-lab-mode" aria-label="자격 증명 모드" className={selectClassName} value={credentialMode} disabled={disabled} onChange={(change) => onCredentialModeChange(change.target.value as RequestLabCredentialMode)}>
        <option value="ACCOUNT" disabled={eligibleAccounts.length === 0}>ACCOUNT</option>
        <option value="ANONYMOUS">ANONYMOUS</option>
        <option value="ORIGINAL">ORIGINAL</option>
      </select>
      {eligibleAccounts.length === 0 && <p className="text-xs text-muted-foreground">이 서비스에 ACTIVE 재사용 세션이 있는 계정이 없어 ACCOUNT 모드를 사용할 수 없습니다.</p>}
    </div>

    {credentialMode === "ACCOUNT" && <div className="grid gap-2">
      <Label htmlFor="request-lab-account">계정</Label>
      <select id="request-lab-account" aria-label="계정" className={selectClassName} value={selectedAccountId} disabled={disabled} onChange={(change) => onAccountChange(change.target.value)}>
        <option value="">계정 선택</option>
        {eligibleAccounts.map((account) => <option key={account.handle} value={account.accountId}>{account.accountLabel}</option>)}
      </select>
      <p className="text-xs text-muted-foreground">관측 당시 원문입니다. 보낼 때 선택 계정의 인증값으로 바뀝니다.</p>
    </div>}
  </section>
}
