import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import type { AccountSettings } from "@/features/accounts/account-settings/types"
import { getAccountSettings, getManualAttempts, getRequestLabDraft, openReplay, sendRequestLab } from "@/lib/api/endpoints"
import type { EventRecord, ManagedSession, ManualVerification, RequestLabDraft } from "@/lib/api/types"
import { queryKeys } from "@/lib/query/hooks"
import { createMemoryOnlyRawState, REQUEST_LAB_MAX_BYTES, type MemoryOnlyRawState } from "@/lib/security/memoryOnlyRawState"
import { DATASET_REPLACING } from "@/lib/security/datasetBoundary"
import { RawTextPanel } from "./RawTextPanel"
import { highlightRaw, rawTokenClass } from "./rawHighlight"
import { RequestLabMetadata, requestCredentialPreview, type RequestLabCredentialMode } from "./RequestLabMetadata"

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  event: EventRecord
  sessions: readonly ManagedSession[]
  datasetRevision?: number
  snapshotRevision?: number
  suspended?: boolean
  /** snapshot의 Request Lab 검증 응답. 이 Evidence에서 보낸 것만 이력에 표시한다. */
  verifications?: readonly ManualVerification[]
  /** Test-only inspection seam; production always owns a new instance locally. */
  rawState?: MemoryOnlyRawState
}

const MANUAL_ATTEMPTS = ["manual-attempts"] as const
const failureLabels: Readonly<Record<string, string>> = {
  NO_RESPONSE: "응답 없음", TIMEOUT: "시간 초과", CONNECTION_FAILURE: "연결 실패", TLS_FAILURE: "TLS 실패",
  DNS_FAILURE: "DNS 실패", INVALID_REQUEST: "전송 전 차단", RECORDING_FAILURE: "응답 받음 · 기록 실패",
}

/** 저장된 검증 결과와 응답을 받지 못한 시도. 탐색 관측·커버리지와는 따로 센다. */
function VerificationHistory({ eventId, verifications, snapshotRevision, enabled }: { eventId: string; verifications: readonly ManualVerification[]; snapshotRevision?: number; enabled: boolean }) {
  const attempts = useQuery({ queryKey: [...MANUAL_ATTEMPTS, snapshotRevision ?? 0], queryFn: ({ signal }) => getManualAttempts(signal), enabled, retry: false })
  const results = verifications.filter(item => item.originEvidenceId === eventId).sort((left, right) => right.timestamp - left.timestamp)
  const failures = (Array.isArray(attempts.data) ? attempts.data : []).filter(item => item.originEvidenceId === eventId && item.outcome !== "HTTP_RESPONSE").sort((left, right) => right.sequence - left.sequence)
  if (!results.length && !failures.length) return null
  return <section aria-label="검증 이력" className="grid gap-2">
    <h3 className="font-medium">검증 이력</h3>
    <ol className="grid gap-1 text-xs">
      {results.map(item => <li key={item.eventId} className="flex flex-wrap gap-x-3 rounded border px-2 py-1"><span>HTTP {item.status}</span><span>{item.durationMs}ms</span><span>{item.identity}</span><span className="break-all font-mono text-muted-foreground">{item.eventId}</span></li>)}
      {failures.map(item => <li key={item.sequence} className="flex flex-wrap gap-x-3 rounded border border-destructive/40 px-2 py-1"><span>{failureLabels[item.outcome] ?? item.outcome}</span><span>{item.durationMillis}ms</span><span className="text-muted-foreground">대상 처리 여부 미확인</span></li>)}
    </ol>
  </section>
}

/**
 * 현재 세션 = 지금 수집 중이거나 가장 최근에 트래픽이 기록된 신원의 세션.
 * 원 요청을 보낸 계정과 다를 수 있다(그게 목적). 교차 신원 검증은 이 규칙과 별개다.
 */
export function currentSessionFor(sessions: readonly ManagedSession[], service: string): ManagedSession | null {
  const usable = sessions.filter(session => session.service === service
    && (session.replayReady ?? (session.status === "ACTIVE" && !session.capturing && !session.credentialConflict)))
  const recency = (session: ManagedSession) => Date.parse(session.lastRecordedAt ?? session.lastUsedAt ?? session.createdAt) || 0
  return usable.reduce<ManagedSession | null>((best, session) => !best || recency(session) > recency(best)
    || (recency(session) === recency(best) && session.capturing && !best.capturing) ? session : best, null)
}

export function activeAccounts(sessions: readonly ManagedSession[], service: string) {
  const unique = new Map<string, ManagedSession>()
  for (const session of sessions) if (session.service === service && session.status === "ACTIVE" && !session.capturing && !session.credentialConflict && !unique.has(session.accountId)) unique.set(session.accountId, session)
  return [...unique.values()]
}

export function RequestLabDialog({ open, onOpenChange, event, sessions, datasetRevision = 0, snapshotRevision, suspended = false, verifications = [], rawState }: Props) {
  const queryClient = useQueryClient()
  const raw = useRef<MemoryOnlyRawState>(rawState ?? createMemoryOnlyRawState())
  const context = useRef<{ generation: number; sendController: AbortController | null }>({ generation: 0, sendController: null })
  const [version, setVersion] = useState(0)
  const [draft, setDraft] = useState<Omit<RequestLabDraft, "request" | "response"> | null>(null)
  const [mode, setMode] = useState<RequestLabCredentialMode>("ACCOUNT")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [openingRepeater, setOpeningRepeater] = useState(false)
  const [error, setError] = useState("")
  const [replayMessage, setReplayMessage] = useState("")
  const [loadAttempt, setLoadAttempt] = useState(0)
  const draftRef = useRef<Omit<RequestLabDraft, "request" | "response"> | null>(null)

  const currentSession = useMemo(() => currentSessionFor(sessions, draft?.service ?? ""), [draft?.service, sessions])
  const accountId = currentSession?.accountId ?? ""
  const selectedAccountValid = currentSession !== null
  const currentSettings = useQuery({ queryKey: ["account-settings", accountId], queryFn: () => getAccountSettings<AccountSettings>(accountId), enabled: open && selectedAccountValid, retry: false })
  const currentCredentials = currentSettings.data?.human?.credentials ?? []
  const currentCredential = currentCredentials.find((item) => item.name === "Authorization") ?? currentCredentials[0]
  const invalidateSend = () => {
    context.current.generation += 1
    context.current.sendController?.abort()
    context.current.sendController = null
  }
  const release = () => {
    invalidateSend()
    raw.current.clear()
    draftRef.current = null
    setDraft(null)
    setError("")
    setReplayMessage("")
    setMode("ACCOUNT")
    setSending(false)
    setOpeningRepeater(false)
    setVersion((value) => value + 1)
  }

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setError("")
    release()
    const generation = context.current.generation
    void getRequestLabDraft(event.eventId, controller.signal).then((next) => {
      if (controller.signal.aborted || context.current.generation !== generation) return
      raw.current.request = next.request ?? ""
      raw.current.response = next.response ?? ""
      const { request: _request, response: _response, ...metadata } = next
      draftRef.current = metadata
      setDraft(metadata)
      setMode(currentSessionFor(sessions, next.service) ? "ACCOUNT" : "ORIGINAL")
      setVersion((value) => value + 1)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted && context.current.generation === generation) setError(reason instanceof Error ? reason.message : "Request Lab 초안을 불러오지 못했습니다.")
    }).finally(() => { if (!controller.signal.aborted && context.current.generation === generation) setLoading(false) })
    return () => { controller.abort(); invalidateSend(); raw.current.clear() }
  }, [open, event.eventId, datasetRevision, loadAttempt])

  // Revalidate retained-raw/session metadata after traffic changes without
  // replacing edited text/history. The response remains outside the query cache.
  useEffect(() => {
    const original = draftRef.current
    if (!open || suspended || !original || snapshotRevision === undefined) return
    const controller = new AbortController()
    void getRequestLabDraft(event.eventId, controller.signal).then(next => {
      if (controller.signal.aborted) return
      if (next.service !== original.service || next.observedIdentity !== original.observedIdentity
        || (original.rawRequestRetained && !next.rawRequestRetained)
        || (original.rawResponseRetained && !next.rawResponseRetained)
        || (original.requestEditable && !next.requestEditable)
        || next.reusableSession !== original.reusableSession) close()
    }).catch(() => { if (!controller.signal.aborted) close() })
    return () => controller.abort()
  }, [open, event.eventId, snapshotRevision, suspended])

  // 세션이 사라지면 진행 중 전송을 끊고 전송을 잠근다. 다른 방식으로 조용히 바꾸지 않는다.
  useEffect(() => {
    if (mode === "ACCOUNT" && draft && !selectedAccountValid) { invalidateSend(); setSending(false) }
  }, [draft, mode, selectedAccountValid])

  useEffect(() => {
    const clearOnUnload = () => { invalidateSend(); raw.current.clear() }
    const clearOnReplacement = () => close()
    window.addEventListener("beforeunload", clearOnUnload)
    window.addEventListener(DATASET_REPLACING, clearOnReplacement)
    return () => { window.removeEventListener("beforeunload", clearOnUnload); window.removeEventListener(DATASET_REPLACING, clearOnReplacement) }
  }, [])

  function close() {
    release()
    onOpenChange(false)
  }

  async function send() {
    if (suspended || !draft || !draft.requestEditable || sending) return
    if (!raw.current.canSend(raw.current.request)) { setError(`요청은 UTF-8 기준 ${REQUEST_LAB_MAX_BYTES.toLocaleString("en-US")}바이트를 초과할 수 없습니다.`); return }
    if (mode === "ACCOUNT" && !selectedAccountValid) { setError("현재 세션의 최신 인증값이 없어요."); return }
    const controller = new AbortController()
    const generation = context.current.generation + 1
    context.current.generation = generation
    context.current.sendController?.abort()
    context.current.sendController = controller
    setSending(true)
    setError("")
    try {
      const result = await sendRequestLab({ eventId: event.eventId, credentialMode: mode, accountId: mode === "ACCOUNT" ? accountId : "", request: raw.current.request }, controller.signal)
      if (controller.signal.aborted || context.current.generation !== generation) return
      raw.current.addResult({ response: result.response, status: result.status, durationMs: result.durationMs })
      raw.current.response = result.response
      setVersion((value) => value + 1)
    } catch (reason) {
      if (controller.signal.aborted || context.current.generation !== generation) return
      setError(reason instanceof Error ? reason.message : "Request Lab 전송에 실패했습니다.")
    } finally {
      // 성공은 snapshot 검증 응답으로, 실패는 전송 시도 기록으로 이력에 반영된다.
      void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot })
      void queryClient.invalidateQueries({ queryKey: MANUAL_ATTEMPTS })
      if (!controller.signal.aborted && context.current.generation === generation) {
        context.current.sendController = null
        setSending(false)
      }
    }
  }

  async function openInRepeater() {
    if (suspended || !draft || openingRepeater) return
    if (!raw.current.canSend(raw.current.request)) { setError(`요청은 UTF-8 기준 ${REQUEST_LAB_MAX_BYTES.toLocaleString("en-US")}바이트를 초과할 수 없습니다.`); return }
    if (mode === "ACCOUNT" && !selectedAccountValid) { setError("현재 세션의 최신 인증값이 없어요."); return }
    setOpeningRepeater(true)
    setError("")
    setReplayMessage("")
    try {
      const result = await openReplay({ eventId: event.eventId, request: raw.current.request, credentialMode: mode, accountId: mode === "ACCOUNT" ? accountId : "" })
      setReplayMessage(result.openedDraft ? "Burp Repeater에 현재 요청 초안을 열었습니다. 아직 전송되지 않았습니다." : result.message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Repeater 초안을 열지 못했습니다.")
    } finally {
      setOpeningRepeater(false)
    }
  }

  return <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
    <DialogContent className="max-h-[calc(100svh-2rem)] sm:max-w-[70rem] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0" showCloseButton={false} aria-describedby="request-lab-description">
      <DialogHeader className="border-b p-5"><DialogTitle>Request Lab</DialogTitle><DialogDescription id="request-lab-description">관측한 요청·응답 원문을 확인하고 Burp Repeater로 보냅니다.</DialogDescription></DialogHeader>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {suspended && <Alert className="m-5 mb-0" aria-label="Request Lab 일시 중지"><AlertTitle>서버 상태 확인 중</AlertTitle><AlertDescription>마지막 성공 snapshot의 편집 초안을 메모리에 보존했습니다. 갱신에 성공할 때까지 전송과 인증정보 변경을 잠급니다.</AlertDescription></Alert>}
        {loading && <p className="p-5">Request Lab 초안 불러오는 중…</p>}
        {error && <div className="grid gap-2 p-5"><p role="alert">{error}</p>{!draft && <Button type="button" variant="outline" disabled={loading} onClick={() => { setError(""); setLoadAttempt((value) => value + 1) }}>Request Lab 초안 다시 시도</Button>}</div>}
        {replayMessage && <p role="status" className="m-5 mb-0 rounded-md border p-2 text-sm">{replayMessage}</p>}
        {draft && <div className="grid max-h-[85svh] lg:grid-cols-[19rem_minmax(0,1fr)]">
          <RequestLabMetadata
            service={draft.service}
            identity={draft.observedIdentity}
            observedCredential={requestCredentialPreview(raw.current.request)}
            requestRetained={draft.rawRequestRetained}
            responseRetained={draft.rawResponseRetained}
            currentSession={currentSession && { label: currentSession.accountLabel, credential: currentCredential ? `${currentCredential.name}: ${currentCredential.preview}` : null }}
            credentialMode={mode}
            disabled={suspended || sending || openingRepeater}
            onCredentialModeChange={(nextMode) => { setMode(nextMode); setError("") }}
          />
          <section aria-label="Request Lab 원문 작업면" className="grid min-w-0 content-start gap-4 p-4">
            {(!draft.rawRequestRetained || !draft.rawResponseRetained) && <p role="status" className="rounded-md border bg-muted/40 p-2 text-xs">원문 일부가 보존되지 않았거나 마스킹됐습니다.</p>}
            <p className="text-xs text-muted-foreground">{draft.message}</p>
            <div role="group" aria-label="Request Lab 요청 및 응답" className="grid min-w-0 gap-4 lg:grid-cols-2">
              <section className="grid min-w-0 content-start gap-2 rounded-lg border border-border/70 bg-background/30 p-3" aria-label="Request 원문 패널">
                <Label id="request-lab-request-label" htmlFor="request-lab-request">요청</Label>
                <RawTextPanel id="request-lab-request" label="Request Lab 요청 원문" value={raw.current.request} disabled={suspended || !draft.requestEditable || sending} onChange={(next) => { raw.current.request = next; setVersion((value) => value + 1) }} />
              </section>
              <section className="grid min-w-0 content-start gap-2 rounded-lg border border-border/70 bg-background/30 p-3" aria-label="Response 원문 패널">
                <Label id="request-lab-response-label" htmlFor="request-lab-response">응답</Label>
                <RawTextPanel id="request-lab-response" label="Request Lab 응답 원문" value={raw.current.response} readOnly />
              </section>
            </div>
            {raw.current.history.length > 0 && <section className="grid gap-2"><h3 className="font-medium">최근 전송 결과</h3><p aria-live="polite">현재 탭 전송 결과 {raw.current.history.length}건 (최대 10건)</p><ol className="grid gap-2">{raw.current.history.map((result, index) => <li key={`${index}-${result.status}-${result.durationMs}`} data-testid="request-lab-history-result" className="rounded border p-2"><p>HTTP {result.status} · {result.durationMs}ms</p><pre className="whitespace-pre-wrap break-words font-mono text-xs">{highlightRaw(result.response).map((tokens, line) => <span key={line}>{tokens.map((token, index) => <span key={index} className={rawTokenClass[token.kind]}>{token.text}</span>)}{"\n"}</span>)}</pre></li>)}</ol></section>}
            <VerificationHistory eventId={event.eventId} verifications={verifications} snapshotRevision={snapshotRevision} enabled={open && !suspended} />
          </section>
        </div>}
      </div>
      <DialogFooter className="sticky bottom-0 mx-0 mb-0 rounded-b-xl"><DialogClose asChild><Button type="button" variant="outline" onClick={close}>닫기</Button></DialogClose><Button type="button" variant="outline" disabled={suspended || !draft || loading || sending || openingRepeater || (mode === "ACCOUNT" && !selectedAccountValid)} onClick={() => void openInRepeater()}>{openingRepeater ? "Repeater 준비 중" : "Repeater로 보내기"}</Button><Button type="button" disabled={suspended || !draft || !draft.requestEditable || loading || sending || openingRepeater || (mode === "ACCOUNT" && !selectedAccountValid)} onClick={() => void send()}>{sending ? "Request Lab 전송 중" : "Request Lab 전송"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
