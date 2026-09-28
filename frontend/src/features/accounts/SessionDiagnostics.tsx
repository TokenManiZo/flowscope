import { useState } from "react"
import { AlertCircle, CheckCircle2, Clock3, Link2Off } from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Account, ManagedSession, ObservedSession } from "@/lib/api/types"
import { HUMAN_STATUS_META } from "./account-settings/statusMeta"
import { VERIFICATION_SOURCE_LABEL } from "@/components/live-authorization-replay/LiveAuthorizationReplayCard"

const humanStatusLabel = (status: string) => HUMAN_STATUS_META[status as keyof typeof HUMAN_STATUS_META]?.label ?? status

function sessionState(session: ManagedSession | undefined) {
  if (!session) return { status: "UNVERIFIED", description: "로그인 캡처를 시작해 재사용할 세션을 확인하세요.", action: "begin" as const }
  if (session.credentialConflict) return { status: "credential-conflict", description: "동일 인증정보 충돌입니다. 기존 연결을 확인하거나 세션을 폐기하세요.", action: "revoke" as const }
  if (session.capturing || session.status === "CAPTURING") return { status: "CAPTURING", description: "계정 전용 HUMAN 8080 브라우저에서 로그인한 뒤 인증된 화면을 한 번 새로고침하고 캡처를 종료하세요.", action: "end" as const }
  if (session.status === "ACTIVE") return { status: "ACTIVE", description: "재사용 가능한 관리 세션입니다.", action: "revoke" as const }
  if (session.status === "REVOKED") return { status: "REVOKED", description: "메모리 세션이 폐기되었습니다. 다시 로그인해야 합니다.", action: "begin" as const }
  return { status: "UNVERIFIED", description: "자격증명은 관측됐지만 인증된 후속 요청·응답을 확인하지 못했습니다. 다시 캡처하거나 확인된 Burp 요청을 가져오세요.", action: "begin" as const }
}

function SessionStatusIcon({ status }: { status: string }) {
  if (status === "ACTIVE") return <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
  if (status === "CAPTURING") return <Clock3 className="size-4 text-muted-foreground" aria-hidden="true" />
  if (status === "credential-conflict") return <AlertCircle className="size-4 text-destructive" aria-hidden="true" />
  return <Link2Off className="size-4 text-muted-foreground" aria-hidden="true" />
}

export function SessionDiagnostics({ accounts, sessions, managedSessions, pending, bindError, unbindError, captureError, onBind, onUnbind, onCapture }: {
  accounts: readonly Account[]
  sessions: readonly ObservedSession[]
  managedSessions: readonly ManagedSession[]
  pending: { bind: boolean; unbind: boolean; capture: boolean }
  bindError: string | null
  unbindError: string | null
  captureError: string | null
  onBind: (values: { service: string; fingerprint: string; account: string }) => void
  onUnbind: (values: { service: string; fingerprint: string }) => void
  onCapture: (values: { action: "begin" | "end" | "revoke"; account: string }) => void
}) {
  const [selection, setSelection] = useState<Record<string, string>>({})
  const managedByAccount = new Map(managedSessions.map((session) => [session.accountId, session]))
  return (
    <div className="space-y-4">
      <section aria-labelledby="managed-session-title" className="space-y-2">
        <h3 id="managed-session-title" className="font-medium">재사용 관리 세션</h3>
        <Alert><AlertDescription>계정마다 별도 브라우저 프로필을 쓰세요. 같은 프로필에서 로그아웃만 하면 쿠키가 섞일 수 있습니다. 가장 확실한 등록 방법은 Burp Proxy history 또는 Repeater에서 해당 계정으로 인증된 요청 하나를 우클릭한 뒤 <strong>FlowScope 계정 세션으로 사용</strong>에서 계정을 선택하는 것입니다.</AlertDescription></Alert>
        <div className="grid gap-3 md:grid-cols-2">
          {accounts.map((account) => {
            const view = sessionState(managedByAccount.get(account.id))
            const actionLabel = view.action === "begin" ? "로그인 연결 시작" : view.action === "end" ? "로그인 캡처 종료" : "세션 폐기"
            const active = view.status === "ACTIVE" || view.status === "CAPTURING"
            const verification = view.status === "ACTIVE" ? managedByAccount.get(account.id)?.verificationSource : undefined
            return <article key={account.id} className={`rounded-lg border p-3 ${active ? "" : "opacity-65"}`} aria-label={`${account.label} 관리 세션`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><SessionStatusIcon status={view.status} /><strong className="truncate">{account.label}</strong></div><div className="flex items-center gap-1"><Badge variant={view.status === "ACTIVE" ? "default" : "secondary"} title={view.status}>{humanStatusLabel(view.status)}</Badge>{verification && <Badge variant="outline" aria-label={`검증 출처 ${VERIFICATION_SOURCE_LABEL[verification] ?? verification}`}>{VERIFICATION_SOURCE_LABEL[verification] ?? verification}</Badge>}</div></div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm"><dt className="text-muted-foreground">역할</dt><dd className="truncate text-right">{account.role}</dd><dt className="text-muted-foreground">대상 서비스</dt><dd className="truncate text-right">{account.target}</dd></dl>
              <p className="mt-2 text-sm text-muted-foreground">{view.description}</p>
              <Button className="mt-3" variant={view.action === "revoke" ? "destructive" : "outline"} disabled={pending.capture} onClick={() => onCapture({ action: view.action, account: account.id })}>{account.label} {actionLabel}</Button>
            </article>
          })}
        </div>
        <div className="flex flex-wrap gap-2" aria-label="관리 세션 진단 상태">
          {managedSessions.map((session) => <Badge key={session.handle}>{session.credentialConflict ? "credential-conflict" : humanStatusLabel(session.capturing ? "CAPTURING" : session.status)}</Badge>)}
        </div>
        {captureError && <Alert variant="destructive" aria-label={captureError}><AlertDescription>{captureError}</AlertDescription></Alert>}
      </section>
      <Accordion type="single" collapsible>
        <AccordionItem value="diagnostics">
          <AccordionTrigger aria-label="고급 세션 진단 열기">고급 세션 진단</AccordionTrigger>
          <AccordionContent>
            <p className="mb-3 text-sm text-muted-foreground">관측 신원·서비스·비가역 지문을 등록 계정에 연결합니다.</p>
            <Table>
              <TableHeader><TableRow><TableHead>관측 신원</TableHead><TableHead>비가역 지문</TableHead><TableHead>대상 서비스</TableHead><TableHead>연결</TableHead></TableRow></TableHeader>
              <TableBody>{sessions.map((session, index) => {
                const matchedAccounts = accounts.filter((account) => account.target === session.service)
                const current = selection[`${session.service}\u0000${session.fingerprint}`] ?? ""
                const label = `관측 세션 ${index + 1}`
                return <TableRow key={`${session.service}\u0000${session.fingerprint}`}><TableCell>{session.idn}</TableCell><TableCell>{label} · 비가역</TableCell><TableCell>{session.service}</TableCell><TableCell>{session.registered ? <Button variant="outline" disabled={pending.unbind} aria-label={`${label} 연결 해제`} onClick={() => onUnbind({ service: session.service, fingerprint: session.fingerprint })}>연결 해제</Button> : <div className="flex flex-wrap gap-2"><Select value={current} onValueChange={(account) => setSelection((all) => ({ ...all, [`${session.service}\u0000${session.fingerprint}`]: account }))} disabled={pending.bind || matchedAccounts.length === 0}><SelectTrigger aria-label={`${label} 연결 계정`}><SelectValue placeholder="등록 계정 선택" /></SelectTrigger><SelectContent>{matchedAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.label}</SelectItem>)}</SelectContent></Select><Button disabled={pending.bind || !current} aria-label={`${label} 연결`} onClick={() => onBind({ service: session.service, fingerprint: session.fingerprint, account: current })}>연결</Button></div>}</TableCell></TableRow>
              })}</TableBody>
            </Table>
            {bindError && <Alert className="mt-3" variant="destructive" aria-label={bindError}><AlertDescription>{bindError}</AlertDescription></Alert>}
            {unbindError && <Alert className="mt-3" variant="destructive" aria-label={unbindError}><AlertDescription>{unbindError}</AlertDescription></Alert>}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
