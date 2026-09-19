import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query/hooks"

import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { getRequestLabDraft, openReplay, sendRequestLab } from "@/lib/api/endpoints"
import type { EventRecord, ManagedSession, RequestLabDraft } from "@/lib/api/types"
import { createMemoryOnlyRawState, REQUEST_LAB_MAX_BYTES, type MemoryOnlyRawState } from "@/lib/security/memoryOnlyRawState"
import { DATASET_REPLACING } from "@/lib/security/datasetBoundary"
import { RequestLabMetadata, type RequestLabCredentialMode } from "./RequestLabMetadata"

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  event: EventRecord
  sessions: readonly ManagedSession[]
  datasetRevision?: number
  snapshotRevision?: number
  suspended?: boolean
  /** Test-only inspection seam; production always owns a new instance locally. */
  rawState?: MemoryOnlyRawState
}

function activeAccounts(sessions: readonly ManagedSession[], service: string) {
  const unique = new Map<string, ManagedSession>()
  for (const session of sessions) if (session.service === service && session.status === "ACTIVE" && !session.capturing && !session.credentialConflict && !unique.has(session.accountId)) unique.set(session.accountId, session)
  return [...unique.values()]
}

export function RequestLabDialog({ open, onOpenChange, event, sessions, datasetRevision = 0, snapshotRevision, suspended = false, rawState }: Props) {
  const queryClient = useQueryClient()
  const raw = useRef<MemoryOnlyRawState>(rawState ?? createMemoryOnlyRawState())
  const context = useRef<{ generation: number; sendController: AbortController | null }>({ generation: 0, sendController: null })
  const [version, setVersion] = useState(0)
  const [draft, setDraft] = useState<Omit<RequestLabDraft, "request" | "response"> | null>(null)
  const [mode, setMode] = useState<RequestLabCredentialMode>("ACCOUNT")
  const [accountId, setAccountId] = useState("")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [openingRepeater, setOpeningRepeater] = useState<"ACCOUNT" | "ANONYMOUS" | null>(null)
  const [error, setError] = useState("")
  const [replayMessage, setReplayMessage] = useState("")
  const [loadAttempt, setLoadAttempt] = useState(0)
  const draftRef = useRef<Omit<RequestLabDraft, "request" | "response"> | null>(null)

  const accounts = useMemo(() => activeAccounts(sessions, draft?.service ?? ""), [draft?.service, sessions])
  const selectedAccountValid = accountId.length > 0 && accounts.some((account) => account.accountId === accountId)
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
    setAccountId("")
    setMode("ACCOUNT")
    setSending(false)
    setOpeningRepeater(null)
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
      const eligible = activeAccounts(sessions, next.service)
      const preferred = eligible.find(session => session.accountId === next.reusableAccountId)
      setMode(eligible.length ? "ACCOUNT" : "ORIGINAL")
      setAccountId(preferred?.accountId ?? (eligible.length === 1 ? eligible[0].accountId : ""))
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

  useEffect(() => {
    if (mode === "ACCOUNT") {
      if (accountId && !selectedAccountValid) { invalidateSend(); raw.current.clear(); setSending(false); setVersion(value => value + 1) }
      if (accounts.length === 0) setMode("ORIGINAL")
      if (!selectedAccountValid) setAccountId("")
    }
  }, [accounts.length, mode, selectedAccountValid])

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
    if (mode === "ACCOUNT" && !selectedAccountValid) { setError("활성 재사용 세션이 있는 계정을 선택하세요."); return }
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
      raw.current.addResult({ eventId: result.eventId, requestBytes: result.requestBytes, responseBytes: result.responseBytes, response: result.response, status: result.status, durationMs: result.durationMs })
      raw.current.response = result.response
      setVersion((value) => value + 1)
      void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot })
      void queryClient.invalidateQueries({ queryKey: ["manual-attempts"] })
    } catch (reason) {
      if (controller.signal.aborted || context.current.generation !== generation) return
      setError(reason instanceof Error ? reason.message : "Request Lab 전송에 실패했습니다.")
      void queryClient.invalidateQueries({ queryKey: ["manual-attempts"] })
    } finally {
      if (!controller.signal.aborted && context.current.generation === generation) {
        context.current.sendController = null
        setSending(false)
      }
    }
  }

  async function openInRepeater(replayMode: "ACCOUNT" | "ANONYMOUS") {
    if (suspended || !draft || openingRepeater) return
    if (!raw.current.canSend(raw.current.request)) { setError(`요청은 UTF-8 기준 ${REQUEST_LAB_MAX_BYTES.toLocaleString("en-US")}바이트를 초과할 수 없습니다.`); return }
    if (replayMode === "ACCOUNT" && !selectedAccountValid) { setError("활성 재사용 세션이 있는 계정을 선택하세요."); return }
    setOpeningRepeater(replayMode)
    setError("")
    setReplayMessage("")
    try {
      const result = await openReplay({ eventId: event.eventId, request: raw.current.request, credentialMode: replayMode, accountId: replayMode === "ACCOUNT" ? accountId : "" })
      setReplayMessage(result.openedDraft ? "Burp Repeater에 현재 요청 초안을 열었습니다. 아직 전송되지 않았습니다." : result.message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Repeater 초안을 열지 못했습니다.")
    } finally {
      setOpeningRepeater(null)
    }
  }

  return <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
    <DialogContent className="max-h-[calc(100svh-2rem)] sm:max-w-[70rem] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0" showCloseButton={false} aria-describedby="request-lab-description">
      <DialogHeader className="border-b p-5"><DialogTitle>Request Lab</DialogTitle><DialogDescription id="request-lab-description">고정된 관측 서비스를 대상으로만 요청을 검토합니다. 브라우저는 리디렉션을 따르거나 대상을 변경하지 않으며 Java 전송기가 최종 권한을 가집니다.</DialogDescription></DialogHeader>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {suspended && <Alert className="m-5 mb-0" aria-label="Request Lab 일시 중지"><AlertTitle>서버 상태 확인 중</AlertTitle><AlertDescription>마지막 성공 snapshot의 편집 초안을 메모리에 보존했습니다. 갱신에 성공할 때까지 전송과 인증정보 변경을 잠급니다.</AlertDescription></Alert>}
        {loading && <p className="p-5">Request Lab 초안 불러오는 중…</p>}
        {error && <div className="grid gap-2 p-5"><p role="alert">{error}</p>{!draft && <Button type="button" variant="outline" disabled={loading} onClick={() => { setError(""); setLoadAttempt((value) => value + 1) }}>Request Lab 초안 다시 시도</Button>}</div>}
        {replayMessage && <p role="status" className="m-5 mb-0 rounded-md border p-2 text-sm">{replayMessage}</p>}
        {draft && <div className="grid max-h-[85svh] lg:grid-cols-[19rem_minmax(0,1fr)]">
          <RequestLabMetadata
            service={draft.service}
            identity={draft.observedIdentity}
            requestRetained={draft.rawRequestRetained}
            responseRetained={draft.rawResponseRetained}
            requestCharset={draft.requestCharset}
            responseCharset={draft.responseCharset}
            requestEditable={draft.requestEditable}
            sessionStatus={draft.reusableSession}
            credentialMode={mode}
            eligibleAccounts={accounts}
            selectedAccountId={accountId}
            disabled={suspended || sending || openingRepeater !== null}
            onCredentialModeChange={(nextMode) => { setMode(nextMode); setError("") }}
            onAccountChange={setAccountId}
          />
          <section aria-label="Request Lab 원문 작업면" className="grid min-w-0 content-start gap-4 p-4">
            {(!draft.rawRequestRetained || !draft.rawResponseRetained) && <p role="status" className="rounded-md border border-l-2 bg-muted/40 p-2 text-xs">원문 일부가 미보존 또는 마스킹된 상태입니다. 표시된 내용만 검토할 수 있습니다.</p>}
            <p className="text-xs text-muted-foreground">{draft.message}</p>
            <p className="text-xs text-muted-foreground">닫아도 이미 전송된 요청은 취소되지 않습니다. 응답이 불명확하면 검증 이력을 확인한 후 재전송하세요.</p>
            <div role="group" aria-label="Request Lab 요청 및 응답" className="grid min-w-0 gap-4 lg:grid-cols-2">
              <section className="grid min-w-0 content-start gap-2 rounded-lg border border-border/70 bg-background/30 p-3" aria-label="Request 원문 패널">
                <Label id="request-lab-request-label" htmlFor="request-lab-request">Request Lab 관측 요청 원문 (인증 교체 전)</Label>
                <Textarea id="request-lab-request" aria-label="Request Lab 요청 원문" className="min-h-64 resize-y font-mono text-xs leading-relaxed lg:min-h-[28rem]" value={raw.current.request} disabled={suspended || !draft.requestEditable || sending} onChange={(change) => { raw.current.request = change.target.value; setVersion((value) => value + 1) }} />
                <p className="text-xs text-muted-foreground">UTF-8 최대 {REQUEST_LAB_MAX_BYTES.toLocaleString("en-US")}바이트</p>
              </section>
              <section className="grid min-w-0 content-start gap-2 rounded-lg border border-border/70 bg-background/30 p-3" aria-label="Response 원문 패널">
                <Label id="request-lab-response-label" htmlFor="request-lab-response">Request Lab 응답 원문</Label>
                <Textarea id="request-lab-response" className="min-h-64 resize-y font-mono text-xs leading-relaxed lg:min-h-[28rem]" value={raw.current.response} readOnly />
              </section>
            </div>
            {raw.current.history.length > 0 && <section className="grid gap-2"><h3 className="font-medium">최근 전송 결과</h3><p aria-live="polite">현재 탭 전송 결과 {raw.current.history.length}건 (최대 10건)</p><p className="text-xs">응답 수신 · 수동 검증 이력에 저장됩니다. 탐색 그래프의 신규 관측이나 취약점 확정을 의미하지 않습니다.</p><ol className="grid gap-2">{raw.current.history.map((result, index) => <li key={`${index}-${result.status}-${result.durationMs}`} data-testid="request-lab-history-result" className="rounded border p-2"><p>HTTP {result.status} · {result.durationMs}ms</p><p className="break-all text-xs">결과 Evidence: {result.eventId} · 요청 {result.requestBytes} bytes / 응답 {result.responseBytes} bytes</p><pre className="whitespace-pre-wrap break-words font-mono text-xs">{result.response}</pre></li>)}</ol></section>}
          </section>
        </div>}
      </div>
      <DialogFooter className="sticky bottom-0 mx-0 mb-0 rounded-b-xl"><DialogClose asChild><Button type="button" variant="outline" onClick={close}>닫기</Button></DialogClose><Button type="button" variant="outline" disabled={suspended || !draft || loading || sending || openingRepeater !== null || !selectedAccountValid} onClick={() => void openInRepeater("ACCOUNT")}>{openingRepeater === "ACCOUNT" ? "Repeater 준비 중" : "현재 세션 Repeater"}</Button><Button type="button" variant="outline" disabled={suspended || !draft || loading || sending || openingRepeater !== null} onClick={() => void openInRepeater("ANONYMOUS")}>{openingRepeater === "ANONYMOUS" ? "Repeater 준비 중" : "비로그인 Repeater"}</Button><Button type="button" disabled={suspended || !draft || !draft.requestEditable || loading || sending || openingRepeater !== null || (mode === "ACCOUNT" && !selectedAccountValid)} onClick={() => void send()}>{sending ? "Request Lab 전송 중" : "Request Lab 전송"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
