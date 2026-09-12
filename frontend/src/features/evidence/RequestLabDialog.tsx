import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { getRequestLabDraft, sendRequestLab } from "@/lib/api/endpoints"
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
  /** Test-only inspection seam; production always owns a new instance locally. */
  rawState?: MemoryOnlyRawState
}

function activeAccounts(sessions: readonly ManagedSession[], service: string) {
  const unique = new Map<string, ManagedSession>()
  for (const session of sessions) if (session.service === service && session.status === "ACTIVE" && !unique.has(session.accountId)) unique.set(session.accountId, session)
  return [...unique.values()]
}

export function RequestLabDialog({ open, onOpenChange, event, sessions, datasetRevision = 0, snapshotRevision, rawState }: Props) {
  const raw = useRef<MemoryOnlyRawState>(rawState ?? createMemoryOnlyRawState())
  const context = useRef<{ generation: number; sendController: AbortController | null }>({ generation: 0, sendController: null })
  const [version, setVersion] = useState(0)
  const [draft, setDraft] = useState<Omit<RequestLabDraft, "request" | "response"> | null>(null)
  const [mode, setMode] = useState<RequestLabCredentialMode>("ORIGINAL")
  const [accountId, setAccountId] = useState("")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
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
    setAccountId("")
    setMode("ORIGINAL")
    setSending(false)
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
    if (!open || !original || snapshotRevision === undefined) return
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
  }, [open, event.eventId, snapshotRevision])

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
    if (!draft || !draft.requestEditable || sending) return
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
      raw.current.addResult({ response: result.response, status: result.status, durationMs: result.durationMs })
      raw.current.response = result.response
      setVersion((value) => value + 1)
    } catch (reason) {
      if (controller.signal.aborted || context.current.generation !== generation) return
      setError(reason instanceof Error ? reason.message : "Request Lab 전송에 실패했습니다.")
    } finally {
      if (!controller.signal.aborted && context.current.generation === generation) {
        context.current.sendController = null
        setSending(false)
      }
    }
  }

  return <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
    <DialogContent className="max-h-[calc(100svh-2rem)] sm:max-w-[70rem] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0" showCloseButton={false} aria-describedby="request-lab-description">
      <DialogHeader className="border-b p-5"><DialogTitle>Request Lab</DialogTitle><DialogDescription id="request-lab-description">고정된 관측 서비스를 대상으로만 요청을 검토합니다. 브라우저는 리디렉션을 따르거나 대상을 변경하지 않으며 Java 전송기가 최종 권한을 가집니다.</DialogDescription></DialogHeader>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {loading && <p className="p-5">Request Lab 초안 불러오는 중…</p>}
        {error && <div className="grid gap-2 p-5"><p role="alert">{error}</p>{!draft && <Button type="button" variant="outline" disabled={loading} onClick={() => { setError(""); setLoadAttempt((value) => value + 1) }}>Request Lab 초안 다시 시도</Button>}</div>}
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
            onCredentialModeChange={(nextMode) => { setMode(nextMode); setError("") }}
            onAccountChange={setAccountId}
          />
          <section aria-label="Request Lab 원문 작업면" className="grid min-w-0 content-start gap-4 p-4">
            {(!draft.rawRequestRetained || !draft.rawResponseRetained) && <p role="status" className="rounded-md border border-l-2 bg-muted/40 p-2 text-xs">원문 일부가 미보존 또는 마스킹된 상태입니다. 표시된 내용만 검토할 수 있습니다.</p>}
            <p className="text-xs text-muted-foreground">{draft.message}</p>
            <div role="group" aria-label="Request Lab 요청 및 응답" className="grid min-w-0 gap-4 lg:grid-cols-2">
              <section className="grid min-w-0 content-start gap-2 rounded-lg border border-border/70 bg-background/30 p-3" aria-label="Request 원문 패널">
                <Label id="request-lab-request-label" htmlFor="request-lab-request">Request Lab 요청 원문</Label>
                <Textarea id="request-lab-request" className="min-h-64 resize-y font-mono text-xs leading-relaxed lg:min-h-[28rem]" value={raw.current.request} disabled={!draft.requestEditable || sending} onChange={(change) => { raw.current.request = change.target.value; setVersion((value) => value + 1) }} />
                <p className="text-xs text-muted-foreground">UTF-8 최대 {REQUEST_LAB_MAX_BYTES.toLocaleString("en-US")}바이트</p>
              </section>
              <section className="grid min-w-0 content-start gap-2 rounded-lg border border-border/70 bg-background/30 p-3" aria-label="Response 원문 패널">
                <Label id="request-lab-response-label" htmlFor="request-lab-response">Request Lab 응답 원문</Label>
                <Textarea id="request-lab-response" className="min-h-64 resize-y font-mono text-xs leading-relaxed lg:min-h-[28rem]" value={raw.current.response} readOnly />
              </section>
            </div>
            {raw.current.history.length > 0 && <section className="grid gap-2"><h3 className="font-medium">최근 전송 결과</h3><p aria-live="polite">현재 탭 전송 결과 {raw.current.history.length}건 (최대 10건)</p><ol className="grid gap-2">{raw.current.history.map((result, index) => <li key={`${index}-${result.status}-${result.durationMs}`} data-testid="request-lab-history-result" className="rounded border p-2"><p>HTTP {result.status} · {result.durationMs}ms</p><pre className="whitespace-pre-wrap break-words font-mono text-xs">{result.response}</pre></li>)}</ol></section>}
          </section>
        </div>}
      </div>
      <DialogFooter className="sticky bottom-0 mx-0 mb-0 rounded-b-xl"><DialogClose asChild><Button type="button" variant="outline" onClick={close}>닫기</Button></DialogClose><Button type="button" disabled={!draft || !draft.requestEditable || loading || sending || (mode === "ACCOUNT" && !selectedAccountValid)} onClick={() => void send()}>{sending ? "Request Lab 전송 중" : "Request Lab 전송"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
