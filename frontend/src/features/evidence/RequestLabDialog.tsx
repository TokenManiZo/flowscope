import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { AccountSettings } from "@/features/accounts/account-settings/types"
import { getAccountSettings, getManualAttempts, getRequestLabDraft, openReplay, sendRequestLab } from "@/lib/api/endpoints"
import type { EventRecord, ManagedSession, ManualVerification, RequestLabDraft } from "@/lib/api/types"
import { queryKeys } from "@/lib/query/hooks"
import { createMemoryOnlyRawState, REQUEST_LAB_MAX_BYTES, type MemoryOnlyRawState } from "@/lib/security/memoryOnlyRawState"
import { DATASET_REPLACING } from "@/lib/security/datasetBoundary"
import { highlightRaw, rawTokenClass } from "./rawHighlight"
import { formatHttpJson } from "./jsonDisplay"
import { JsonTextPanel, RawTextPanel } from "./RawTextPanel"
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
  const [maximized, setMaximized] = useState(false)
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [fontSize, setFontSize] = useState(14)
  const [panelFocus, setPanelFocus] = useState<"both" | "request" | "response">("both")
  const [jsonView, setJsonView] = useState({ request: false, response: false })
  const [split, setSplit] = useState(50)
  const editorsRef = useRef<HTMLDivElement>(null)
  const splitRef = useRef(50)
  const draftRef = useRef<Omit<RequestLabDraft, "request" | "response"> | null>(null)

  const currentSession = useMemo(() => currentSessionFor(sessions, draft?.service ?? ""), [draft?.service, sessions])
  const accountId = currentSession?.accountId ?? ""
  const selectedAccountValid = currentSession !== null
  const currentSettings = useQuery({ queryKey: ["account-settings", accountId], queryFn: () => getAccountSettings<AccountSettings>(accountId), enabled: open && selectedAccountValid, retry: false })
  const observedCredential = useMemo(() => requestCredentialPreview(raw.current.request), [raw.current.request])
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
    setJsonView({ request: false, response: false })
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
      raw.current.jsonViews.response = null
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

  function resizeSplit(value: number) {
    const width = editorsRef.current?.clientWidth ?? 0
    const minimum = width > 610 ? Math.max(25, 300 / (width - 10) * 100) : 50
    splitRef.current = Math.min(100 - minimum, Math.max(minimum, value))
    editorsRef.current?.style.setProperty("--request-lab-split", `${splitRef.current}%`)
  }
  function chooseJson(pane: "request" | "response") {
    raw.current.jsonViews[pane] ??= formatHttpJson(raw.current[pane])
    setJsonView(current => ({ ...current, [pane]: !raw.current.jsonViews[pane]?.message }))
    setVersion(current => current + 1)
  }
  function panel(pane: "request" | "response") {
    if (jsonView[pane] && !raw.current.jsonViews[pane]) raw.current.jsonViews[pane] = formatHttpJson(raw.current[pane])
    const formatted = raw.current.jsonViews[pane]
    const showJson = jsonView[pane] && formatted && !formatted.message
    const request = pane === "request", title = request ? "요청" : "응답"
    return <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-background/30" aria-label={request ? "Request 원문 패널" : "Response 원문 패널"} hidden={panelFocus !== "both" && panelFocus !== pane}>
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2"><label htmlFor={`request-lab-${pane}`} className="font-medium">{title}</label><span className="text-xs text-muted-foreground">{request && draft?.requestEditable ? "편집 가능" : "읽기 전용"}</span><div role="group" aria-label={`${title} 보기`} className="ml-auto flex gap-1"><Button type="button" variant={showJson ? "ghost" : "outline"} size="sm" aria-pressed={!showJson} onClick={() => setJsonView(current => ({ ...current, [pane]: false }))}>Raw</Button><Button type="button" variant={showJson ? "outline" : "ghost"} size="sm" aria-pressed={!!showJson} onClick={() => chooseJson(pane)}>JSON 정돈</Button></div></header>
      <p className="shrink-0 border-b px-3 py-1.5 text-xs text-muted-foreground">{formatted?.message || (showJson ? "JSON body · 보기 전용 · 실제 전송은 Raw 요청 사용" : request ? "전송은 Raw 요청을 사용합니다." : "응답 · 읽기 전용")}</p>
      <div className="min-h-0 flex-1 overflow-hidden" hidden={!!showJson}><RawTextPanel id={`request-lab-${pane}`} label={`Request Lab ${title} 원문`} value={raw.current[pane]} fontSize={fontSize} fill readOnly={!request} disabled={request && (suspended || !draft?.requestEditable || sending)} onChange={request ? next => { raw.current.request = next; raw.current.jsonViews.request = null; setVersion(current => current + 1) } : undefined} /></div>
      <JsonTextPanel text={showJson ? formatted?.text ?? "" : ""} label={`Request Lab ${title} JSON 정돈`} hidden={!showJson} fontSize={fontSize} />
    </section>
  }

  return <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
    <DialogContent className={`flex h-[calc(100svh-5rem)] max-h-[calc(100svh-1.5rem)] flex-col gap-0 overflow-hidden p-0 ${maximized ? "h-[calc(100svh-1.5rem)] max-w-[calc(100%-1.5rem)] sm:max-w-[calc(100%-1.5rem)]" : "sm:max-w-[72rem]"}`} showCloseButton={false} aria-describedby="request-lab-description" onEscapeKeyDown={event => { if (maximized && !event.defaultPrevented) { event.preventDefault(); setMaximized(false) } }}>
      <DialogHeader className="shrink-0 border-b px-4 py-3">
        <div className="flex items-start justify-between gap-4"><div className="shrink-0"><DialogTitle>Request Lab</DialogTitle><DialogDescription id="request-lab-description" className="mt-1 text-xs">요청을 편집하고 응답을 비교합니다.</DialogDescription></div>
          <div className="flex flex-col items-end gap-2"><div className="flex flex-wrap items-center justify-end gap-2 text-xs">
            <label className="flex items-center gap-1">전송 인증<select aria-label="전송 인증" className="rounded border bg-background px-2 py-1" value={mode} disabled={!draft || suspended || sending || openingRepeater} onChange={event => { setMode(event.target.value as RequestLabCredentialMode); setError("") }}><option value="ORIGINAL">원문 · {draft?.observedIdentity ?? "—"}</option><option value="ANONYMOUS">비로그인</option><option value="ACCOUNT" disabled={!currentSession}>현재 세션 · {currentSession?.accountLabel ?? "없음"}</option></select></label>
            <label className="flex items-center gap-1">글자 크기<select aria-label="글자 크기" className="rounded border bg-background px-2 py-1" value={fontSize} onChange={event => setFontSize(Number(event.target.value))}>{[12, 14, 16, 18].map(size => <option key={size} value={size}>{size}px</option>)}</select></label>
            <Button type="button" variant="outline" size="sm" onClick={() => setMaximized(current => !current)}>{maximized ? "원래 크기" : "최대화"}</Button>
          </div><div className="flex flex-wrap items-center justify-end gap-2"><Button type="button" variant="outline" size="sm" aria-expanded={metadataOpen} onClick={() => setMetadataOpen(current => !current)}>인증 상세 {metadataOpen ? "접기" : "펼치기"}</Button><Button type="button" variant="outline" size="sm" onClick={() => { setMaximized(false); setPanelFocus("both"); resizeSplit(50); setSplit(50) }}>기본 크기</Button><div role="group" aria-label="패널 확대" className="flex gap-1">{(["both", "request", "response"] as const).map(focus => <Button key={focus} type="button" variant={panelFocus === focus ? "outline" : "ghost"} size="sm" aria-pressed={panelFocus === focus} onClick={() => setPanelFocus(focus)}>{focus === "both" ? "함께 보기" : focus === "request" ? "요청 확대" : "응답 확대"}</Button>)}</div></div></div>
        </div>
        {draft && <div hidden={!metadataOpen} className="max-h-[25svh] overflow-auto"><RequestLabMetadata service={draft.service} identity={draft.observedIdentity} observedCredential={observedCredential} requestRetained={draft.rawRequestRetained} responseRetained={draft.rawResponseRetained} currentSession={currentSession && { label: currentSession.accountLabel, credential: currentCredential ? `${currentCredential.name}: ${currentCredential.preview}` : null }} credentialMode={mode} disabled={suspended || sending || openingRepeater} hideCredentialControl onCredentialModeChange={nextMode => { setMode(nextMode); setError("") }} /></div>}
      </DialogHeader>
      <section aria-label="Request Lab 원문 작업면" className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-4">
        <div className="max-h-[20svh] shrink-0 overflow-auto">
          {suspended && <Alert aria-label="Request Lab 일시 중지"><AlertTitle>서버 상태 확인 중</AlertTitle><AlertDescription>편집 초안을 보존했습니다. 갱신에 성공할 때까지 전송과 인증정보 변경을 잠급니다.</AlertDescription></Alert>}
          {loading && <p>Request Lab 초안 불러오는 중…</p>}
          {error && <div className="grid gap-2"><p role="alert">{error}</p>{!draft && <Button type="button" variant="outline" disabled={loading} onClick={() => { setError(""); setLoadAttempt(current => current + 1) }}>Request Lab 초안 다시 시도</Button>}</div>}
          {replayMessage && <p role="status" className="rounded-md border p-2 text-sm">{replayMessage}</p>}
          {draft && <>{(!draft.rawRequestRetained || !draft.rawResponseRetained) && <p role="status" className="rounded-md border bg-muted/40 p-2 text-xs">원문 일부가 보존되지 않았거나 마스킹됐습니다.</p>}<p className="text-xs text-muted-foreground">{draft.message}</p></>}
        </div>
        {draft && <>
          <div ref={editorsRef} role="group" aria-label="Request Lab 요청 및 응답" className="grid min-h-0 min-w-0 flex-1 overflow-hidden" style={{ "--request-lab-split": `${split}%`, gridTemplateColumns: panelFocus === "both" ? "minmax(0,var(--request-lab-split)) 10px minmax(0,1fr)" : "minmax(0,1fr)" } as CSSProperties}>
            {panel("request")}
            <div hidden={panelFocus !== "both"} role="separator" aria-label="요청 응답 너비 조절" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(split)} tabIndex={0} className="flex cursor-col-resize touch-none items-center justify-center outline-ring before:h-12 before:w-0.5 before:rounded before:bg-border hover:before:bg-primary" onPointerDown={event => { if (event.button === 0) { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() } }} onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const box = editorsRef.current!.getBoundingClientRect(); resizeSplit((event.clientX - box.left) / (box.width - 10) * 100) }} onPointerUp={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.currentTarget.releasePointerCapture(event.pointerId); setSplit(splitRef.current) }} onPointerCancel={() => setSplit(splitRef.current)} onDoubleClick={() => { resizeSplit(50); setSplit(50) }} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) { event.preventDefault(); resizeSplit(event.key === "Home" ? 50 : splitRef.current + (event.key === "ArrowRight" ? 5 : -5)); setSplit(splitRef.current) } }} />
            {panel("response")}
          </div>
          <details className="shrink-0 rounded border"><summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">전송 이력</summary><div className="max-h-[20svh] overflow-auto p-3">
            {raw.current.history.length > 0 && <section className="grid gap-2"><h3 className="font-medium">최근 전송 결과</h3><p aria-live="polite">현재 탭 전송 결과 {raw.current.history.length}건 (최대 10건)</p><ol className="grid gap-2">{raw.current.history.map((result, index) => <li key={`${index}-${result.status}-${result.durationMs}`} data-testid="request-lab-history-result" className="rounded border p-2"><p>HTTP {result.status} · {result.durationMs}ms</p><pre className="whitespace-pre-wrap break-words font-mono text-xs">{highlightRaw(result.response).map((tokens, line) => <span key={line}>{tokens.map((token, index) => <span key={index} className={rawTokenClass[token.kind]}>{token.text}</span>)}{"\n"}</span>)}</pre></li>)}</ol></section>}
            <VerificationHistory eventId={event.eventId} verifications={verifications} snapshotRevision={snapshotRevision} enabled={open && !suspended} />
          </div></details>
        </>}
      </section>
      <DialogFooter className="sticky bottom-0 mx-0 mb-0 shrink-0 rounded-b-xl"><DialogClose asChild><Button type="button" variant="outline" onClick={close}>닫기</Button></DialogClose><Button type="button" variant="outline" disabled={suspended || !draft || loading || sending || openingRepeater || (mode === "ACCOUNT" && !selectedAccountValid)} onClick={() => void openInRepeater()}>{openingRepeater ? "Repeater 준비 중" : "Repeater로 보내기"}</Button><Button type="button" disabled={suspended || !draft || !draft.requestEditable || loading || sending || openingRepeater || (mode === "ACCOUNT" && !selectedAccountValid)} onClick={() => void send()}>{sending ? "Request Lab 전송 중" : "Request Lab 전송"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
