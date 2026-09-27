import type { ReactNode } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { LiveAuthorizationReplayCard, type ReplayAccount } from "@/components/live-authorization-replay/LiveAuthorizationReplayCard"
import type { ManagedSession } from "@/lib/api/types"
import { useSnapshotQuery } from "@/lib/query/hooks"

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null
}

/** 관리 세션 상태를 그대로 옮긴 매핑. 새 상태를 만들지 않는다. */
function replayStatus(session: ManagedSession | undefined): ReplayAccount["status"] {
  if (!session) return "UNVERIFIED"
  if (session.credentialConflict) return "CONFLICT"
  if (session.capturing || session.status === "CAPTURING") return "SUSPECT"
  if (session.status === "ACTIVE") return "ACTIVE"
  return "UNVERIFIED"
}

function workspace(children: ReactNode) {
  return <ReferenceAnalysisWorkspace ariaLabel="교차 신원 검증 작업 영역" context={null} inspector={null}>{children}</ReferenceAnalysisWorkspace>
}

export function VerificationPage() {
  const snapshot = useSnapshotQuery()
  if (snapshot.isLoading) return workspace(<section className="p-3" aria-label="교차 신원 검증 콘텐츠">불러오는 중…</section>)
  if (snapshot.isError) return workspace(<Alert className="m-3" variant="destructive" aria-label={errorMessage(snapshot.error) ?? "교차 신원 검증 상태를 불러오지 못했습니다."}><AlertDescription>{errorMessage(snapshot.error) ?? "교차 신원 검증 상태를 불러오지 못했습니다."}</AlertDescription></Alert>)

  const accounts = snapshot.data?.accounts ?? []
  const managedByAccount = new Map((snapshot.data?.managedSessions ?? []).map((session) => [session.accountId, session]))
  const replayAccounts: ReplayAccount[] = accounts.map((account) => ({
    id: account.id,
    name: account.label,
    role: account.role,
    status: replayStatus(managedByAccount.get(account.id)),
    credentialConflict: managedByAccount.get(account.id)?.credentialConflict,
    verificationSource: managedByAccount.get(account.id)?.verificationSource,
  }))

  return workspace(<section className="space-y-4 p-3" aria-labelledby="verification-title">
    <div>
      <h1 id="verification-title" className="text-2xl font-semibold">교차 신원 검증</h1>
      <p className="text-sm text-muted-foreground">등록 계정의 관리 세션 상태를 기준으로 실행합니다. 계정 등록과 세션 캡처는 계정·세션 화면에서 합니다.</p>
    </div>
    <LiveAuthorizationReplayCard accounts={replayAccounts} />
  </section>)
}

export default VerificationPage
