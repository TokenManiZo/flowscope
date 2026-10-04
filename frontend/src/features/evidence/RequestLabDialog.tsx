import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Plus, Send, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getRequestLabDraft, openReplay, sendRequestLab } from "@/lib/api/endpoints"
import type { EventRecord, ManagedSession, ManualVerification, RequestLabDraft } from "@/lib/api/types"
import { queryKeys } from "@/lib/query/hooks"
import { createMemoryOnlyRawState, REQUEST_LAB_MAX_BYTES, REQUEST_LAB_MAX_REQUESTS, type MemoryOnlyRawState } from "@/lib/security/memoryOnlyRawState"
import { DATASET_REPLACING } from "@/lib/security/datasetBoundary"
import { formatHttpJson } from "./jsonDisplay"
import { JsonTextPanel, RawTextPanel } from "./RawTextPanel"
import type { RequestLabCredentialMode } from "./RequestLabMetadata"

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  event: EventRecord
  sessions: readonly ManagedSession[]
  datasetRevision?: number
  snapshotRevision?: number
  suspended?: boolean
  /** Persisted verification metadata remains available to the surrounding inspector. */
  verifications?: readonly ManualVerification[]
  /** Test-only inspection seam; production always owns a new instance locally. */
  rawState?: MemoryOnlyRawState
}

const MANUAL_ATTEMPTS = ["manual-attempts"] as const
const EDIT_REJECTED_MESSAGE = "요청이 너무 크거나 메모리가 부족해 편집에 반영하지 않았습니다. 내용을 줄이거나 사용하지 않는 요청을 삭제해 주세요."
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

export function RequestLabDialog({ open, onOpenChange, event, sessions, datasetRevision = 0, snapshotRevision, suspended = false, rawState }: Props) {
  const queryClient = useQueryClient()
  const raw = useRef<MemoryOnlyRawState>(rawState ?? createMemoryOnlyRawState())
  const context = useRef<{ generation: number; sendController: AbortController | null; submission: { request: string } | null }>({ generation: 0, sendController: null, submission: null })
  const [, setVersion] = useState(0)
  const [draft, setDraft] = useState<Omit<RequestLabDraft, "request" | "response"> | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [openingRepeater, setOpeningRepeater] = useState(false)
  const [error, setError] = useState("")
  const [replayMessage, setReplayMessage] = useState("")
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [maximized, setMaximized] = useState(false)
  const [view, setView] = useState<"original" | number>("original")
  const requestRef = useRef<HTMLTextAreaElement>(null)
  const responseRef = useRef<HTMLTextAreaElement>(null)
  const originalPosition = useRef({ start: 0, end: 0, top: 0, left: 0, responseTop: 0, responseLeft: 0 })
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
  const entry = raw.current.requests.find(item => item.id === view)
  const mode = entry?.credentialMode ?? "ORIGINAL"
  const editRejected = entry?.editRejected ?? false
  const displayedRequest = raw.current.request
  const displayedResponse = raw.current.response
  const editable = !!entry && !!draft?.requestEditable
  const busy = sending || openingRepeater
  const selectedButtonClass = "aria-pressed:border-primary/50 aria-pressed:bg-primary/10 aria-pressed:text-primary"
  const controlClass = "h-7 rounded-md border border-input bg-background px-2 text-[0.8rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"

  function savePosition() {
    const input = requestRef.current
    if (!input) return
    const position = { start: input.selectionStart, end: input.selectionEnd, top: input.scrollTop, left: input.scrollLeft, responseTop: responseRef.current?.scrollTop ?? 0, responseLeft: responseRef.current?.scrollLeft ?? 0 }
    if (entry) entry.position = position
    else originalPosition.current = position
  }
  function changeView(next: typeof view) {
    if (busy || suspended || next === view) return
    savePosition()
    raw.current.clearJson()
    raw.current.selectedId = next === "original" ? null : next
    setJsonView({ request: false, response: false })
    setError("")
    setReplayMessage("")
    setView(next)
  }
  useLayoutEffect(() => {
    const input = requestRef.current
    if (!input) return
    const position = entry?.position ?? originalPosition.current
    input.setSelectionRange(position.start, position.end)
    input.scrollTop = position.top
    input.scrollLeft = position.left
    input.dispatchEvent(new Event("scroll"))
    if (responseRef.current) {
      responseRef.current.scrollTop = position.responseTop
      responseRef.current.scrollLeft = position.responseLeft
      responseRef.current.dispatchEvent(new Event("scroll"))
    }
  }, [view, draft])

  function addRequest() {
    if (busy || suspended || !draft?.requestEditable || editRejected) return
    const next = raw.current.addRequest(displayedRequest, mode)
    if (!next) { setError(`요청을 더 만들 수 없습니다. 최대 ${REQUEST_LAB_MAX_REQUESTS}개이며, 메모리가 부족하면 사용하지 않는 요청을 삭제해 주세요.`); return }
    changeView(next.id)
    requestRef.current?.focus()
  }
  function removeRequest() {
    if (busy || suspended || !entry) return
    const index = raw.current.requests.indexOf(entry)
    const next = raw.current.requests[index + 1] ?? raw.current.requests[index - 1]
    changeView(next?.id ?? "original")
    raw.current.removeRequest(entry)
    setVersion(value => value + 1)
  }
  const invalidateSend = () => {
    context.current.generation += 1
    context.current.sendController?.abort()
    context.current.sendController = null
    if (context.current.submission) context.current.submission.request = ""
    context.current.submission = null
  }
  const release = () => {
    invalidateSend()
    raw.current.clear()
    draftRef.current = null
    setDraft(null)
    setError("")
    setReplayMessage("")
    setView("original")
    originalPosition.current = { start: 0, end: 0, top: 0, left: 0, responseTop: 0, responseLeft: 0 }
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
      raw.current.originalRequest = next.request ?? ""
      raw.current.originalResponse = next.response ?? ""
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
  // replacing independent requests or their latest responses. The response remains outside the query cache.
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
    if (mode === "ACCOUNT" && draft && !selectedAccountValid) { invalidateSend(); setSending(false); setOpeningRepeater(false) }
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
    if (suspended || !draft || !entry || !editable || editRejected || busy) return
    if (!raw.current.canSend(raw.current.request)) { setError(`요청은 UTF-8 기준 ${REQUEST_LAB_MAX_BYTES.toLocaleString("en-US")}바이트를 초과할 수 없습니다.`); return }
    if (mode === "ACCOUNT" && !selectedAccountValid) { setError("현재 세션의 최신 인증값이 없어요."); return }
    const controller = new AbortController()
    const generation = context.current.generation + 1
    context.current.generation = generation
    context.current.sendController?.abort()
    context.current.sendController = controller
    const submitted = { request: raw.current.request, credentialMode: mode, accountId: mode === "ACCOUNT" ? accountId : "" }
    context.current.submission = submitted
    const started = performance.now()
    raw.current.replaceResult(entry, null)
    setJsonView(current => ({ ...current, response: false }))
    setSending(true)
    setError("")
    try {
      const result = await sendRequestLab({ eventId: event.eventId, credentialMode: submitted.credentialMode, accountId: submitted.accountId, request: submitted.request }, controller.signal)
      if (controller.signal.aborted || context.current.generation !== generation) return
      if (!raw.current.replaceResult(entry, { response: result.response, status: result.status, durationMs: result.durationMs, requestBytes: result.requestBytes, responseBytes: result.responseBytes })) {
        const failure = "응답이 커서 보관하지 못했습니다. 사용하지 않는 요청을 삭제해 주세요."
        if (!raw.current.replaceResult(entry, { response: "", status: result.status, durationMs: result.durationMs, failure })) setError(failure)
      }
      setVersion((value) => value + 1)
    } catch (reason) {
      if (controller.signal.aborted || context.current.generation !== generation) return
      raw.current.replaceResult(entry, { response: "", status: 0, durationMs: Math.round(performance.now() - started), failure: reason instanceof Error ? reason.message : "요청 재전송에 실패했습니다." })
      setVersion(current => current + 1)
    } finally {
      submitted.request = ""
      if (context.current.submission === submitted) context.current.submission = null
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
    if (suspended || !draft || !editable || editRejected || busy) return
    if (!raw.current.canSend(raw.current.request)) { setError(`요청은 UTF-8 기준 ${REQUEST_LAB_MAX_BYTES.toLocaleString("en-US")}바이트를 초과할 수 없습니다.`); return }
    if (mode === "ACCOUNT" && !selectedAccountValid) { setError("현재 세션의 최신 인증값이 없어요."); return }
    const generation = context.current.generation
    setOpeningRepeater(true)
    setError("")
    setReplayMessage("")
    try {
      const result = await openReplay({ eventId: event.eventId, request: raw.current.request, credentialMode: mode, accountId: mode === "ACCOUNT" ? accountId : "" })
      if (context.current.generation !== generation) return
      setReplayMessage(result.openedDraft ? "Burp Repeater에 현재 요청 초안을 열었습니다. 아직 전송되지 않았습니다." : result.message)
    } catch (reason) {
      if (context.current.generation === generation) setError(reason instanceof Error ? reason.message : "Repeater 초안을 열지 못했습니다.")
    } finally {
      if (context.current.generation === generation) setOpeningRepeater(false)
    }
  }

  function resizeSplit(value: number) {
    const width = editorsRef.current?.clientWidth ?? 0
    const minimum = width > 610 ? Math.max(25, 300 / (width - 10) * 100) : 50
    splitRef.current = Math.min(100 - minimum, Math.max(minimum, value))
    editorsRef.current?.style.setProperty("--request-lab-split", `${splitRef.current}%`)
  }
  function editRequest(next: string) {
    if (!editable || suspended || busy) return
    if (!entry) return
    if (!raw.current.editRequest(entry, next)) {
      entry.editRejected = true
      setError(EDIT_REJECTED_MESSAGE)
      setVersion(value => value + 1)
      return
    }
    entry.editRejected = false
    setError("")
    setVersion(current => current + 1)
  }
  function jsonFor(pane: "request" | "response") {
    if (raw.current.jsonViews[pane]) return raw.current.jsonViews[pane]!
    const formatted = formatHttpJson(pane === "request" ? displayedRequest : displayedResponse)
    if (formatted.text.length > 65_536 || new TextEncoder().encode(formatted.text).byteLength > 65_536) {
      formatted.text = ""
      formatted.message = "정돈 보기가 커서 Raw로 표시합니다."
    }
    raw.current.jsonViews[pane] = formatted
    return formatted
  }
  function chooseJson(pane: "request" | "response") {
    const formatted = jsonFor(pane)
    setJsonView(current => ({ ...current, [pane]: !formatted.message }))
    setVersion(current => current + 1)
  }
  function panel(pane: "request" | "response") {
    if (jsonView[pane]) jsonFor(pane)
    const formatted = raw.current.jsonViews[pane]
    const showJson = jsonView[pane] && formatted && !formatted.message
    const request = pane === "request", title = request ? "요청" : "응답"
    const selected = entry?.result
    const text = request ? displayedRequest : displayedResponse
    const boundary = /\r?\n\r?\n/.exec(text)
    const body = boundary ? text.slice(boundary.index + boundary[0].length) : text
    const canFormat = body.length <= 262_144 && (/^\s*[\[{]/.test(body) || (boundary && /^content-type:\s*[^\r\n]*(?:application\/json|\+json)\b/im.test(text.slice(0, boundary.index)))) && !formatted?.message
    return <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border bg-muted/20" aria-label={request ? "Request 원문 패널" : "Response 원문 패널"} hidden={panelFocus !== "both" && panelFocus !== pane}>
      <header className="flex shrink-0 items-center gap-2 border-b bg-background px-3 py-2"><label htmlFor={`request-lab-${pane}`} className="text-sm font-medium">{title}</label><span className="text-xs text-muted-foreground">{request && editable && !showJson ? "편집 가능" : "읽기 전용"}</span>
        {!request && <span className="truncate text-xs text-muted-foreground">{view === "original" ? "관측 원문" : selected ? `${selected.status ? `HTTP ${selected.status}` : "응답 없음"} · ${selected.durationMs}ms${entry?.dirty ? " · 이전 응답" : ""}` : "미전송"}</span>}
        <div role="group" aria-label={`${title} 보기`} className="ml-auto flex shrink-0 gap-1"><Button type="button" variant="outline" size="sm" className={selectedButtonClass} aria-pressed={!showJson} onClick={() => setJsonView(current => ({ ...current, [pane]: false }))}>Raw</Button><Button type="button" variant="outline" size="sm" className={selectedButtonClass} aria-pressed={!!showJson} disabled={!canFormat} title={formatted?.message || undefined} onClick={() => chooseJson(pane)}>JSON 정돈</Button></div></header>
      {!request && selected?.failure && <p role="alert" className="shrink-0 border-b px-3 py-2 text-xs text-destructive">{selected.failure}{!selected.status && " · 대상 처리 여부 미확인"}</p>}
      <div className="min-h-0 flex-1 overflow-hidden" hidden={!!showJson}><RawTextPanel id={`request-lab-${pane}`} label={`Request Lab ${title} 원문`} inputRef={request ? requestRef : responseRef} value={request ? displayedRequest : displayedResponse} fontSize={fontSize} fill readOnly={!request || !editable} disabled={request && (suspended || !draft?.requestEditable || busy)} onChange={request ? editRequest : undefined} /></div>
      <JsonTextPanel text={showJson ? formatted?.text ?? "" : ""} label={`Request Lab ${title} JSON 정돈`} hidden={!showJson} fontSize={fontSize} />
    </section>
  }

  return <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
    <DialogContent className={`flex h-[calc(100svh-5rem)] max-h-[calc(100svh-1.5rem)] flex-col gap-0 overflow-hidden p-0 ${maximized ? "h-[calc(100svh-1.5rem)] max-w-[calc(100%-1.5rem)] sm:max-w-[calc(100%-1.5rem)]" : "sm:max-w-[72rem]"}`} showCloseButton={false} aria-describedby="request-lab-description" onEscapeKeyDown={event => { if (maximized && !event.defaultPrevented) { event.preventDefault(); setMaximized(false) } }}>
      <DialogHeader className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-4"><div className="shrink-0"><DialogTitle>Request Lab</DialogTitle><DialogDescription id="request-lab-description" className="mt-1 text-xs">요청을 수정하고, 전송 결과를 다시 확인합니다.</DialogDescription></div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-[0.8rem]">
            <label className="flex items-center gap-1.5">전송 인증<select aria-label="전송 인증" className={`${controlClass} max-w-[14rem]`} value={mode} disabled={!editable || suspended || busy} onChange={event => { if (entry) { entry.credentialMode = event.target.value as RequestLabCredentialMode; entry.dirty = true; setVersion(value => value + 1) }; setError("") }}><option value="ORIGINAL">원문 · {draft?.observedIdentity ?? "—"}</option><option value="ANONYMOUS">비로그인</option><option value="ACCOUNT" disabled={!currentSession}>현재 세션 · {currentSession?.accountLabel || "없음"}</option></select></label>
            <label className="flex items-center gap-1.5">글자 크기<select aria-label="글자 크기" className={controlClass} value={fontSize} onChange={event => setFontSize(Number(event.target.value))}>{[12, 14, 16, 18].map(size => <option key={size} value={size}>{size}px</option>)}</select></label>
            <Button type="button" variant="outline" size="sm" onClick={() => setMaximized(current => !current)}>{maximized ? "원래 크기" : "최대화"}</Button>
            <Button type="button" size="sm" className="h-7 min-w-32 items-center justify-center gap-1.5" disabled={suspended || !draft || !editable || editRejected || loading || busy || (mode === "ACCOUNT" && !selectedAccountValid)} onClick={() => void send()}><Send aria-hidden="true" className="size-3.5" /><span>{sending ? "요청 재전송 중" : "요청 재전송"}</span></Button>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div role="group" aria-label="요청 선택" className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" className={`h-7 w-[104px] text-xs ${selectedButtonClass}`} aria-pressed={view === "original"} disabled={!draft || suspended || busy} onClick={() => changeView("original")}>Original</Button>
            {!!raw.current.requests.length && <>
              <select aria-label="편집 요청 선택" className={`${controlClass} w-[104px] ${entry ? "border-primary/50 bg-primary/10 text-primary" : ""}`} value={entry?.id ?? ""} disabled={!draft || suspended || busy} onChange={event => changeView(Number(event.target.value))}>
                <option value="" disabled>요청 선택</option>
                {raw.current.requests.map(item => <option key={item.id} value={item.id}>요청 {item.id}</option>)}
              </select>
              <Button type="button" variant="outline" size="icon" className="size-7 shrink-0" aria-label={entry ? `요청 ${entry.id} 삭제` : "편집 요청 삭제"} disabled={!entry || suspended || busy} onClick={removeRequest}><X aria-hidden="true" className="size-3.5" /></Button>
            </>}
            <Button type="button" variant="outline" size="icon" className="size-7 shrink-0" aria-label="새 요청 추가" disabled={!draft?.requestEditable || editRejected || suspended || busy} onClick={addRequest}><Plus aria-hidden="true" className="size-3.5" /></Button>
          </div>
          <div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={() => { setMaximized(false); setPanelFocus("both"); resizeSplit(50); setSplit(50) }}>기본 크기</Button><div role="group" aria-label="패널 확대" className="flex gap-1">{(["both", "request", "response"] as const).map(focus => <Button key={focus} type="button" variant="outline" size="sm" className={selectedButtonClass} aria-pressed={panelFocus === focus} onClick={() => setPanelFocus(focus)}>{focus === "both" ? "함께 보기" : focus === "request" ? "요청 확대" : "응답 확대"}</Button>)}</div></div>
        </div>
      </DialogHeader>
      <section aria-label="Request Lab 원문 작업면" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="max-h-[20svh] shrink-0 overflow-auto empty:hidden">
          {suspended && <Alert aria-label="Request Lab 일시 중지"><AlertTitle>서버 상태 확인 중</AlertTitle><AlertDescription>편집 초안을 보존했습니다. 갱신에 성공할 때까지 전송과 인증정보 변경을 잠급니다.</AlertDescription></Alert>}
          {loading && <p className="px-3 py-2 text-xs">Request Lab 초안 불러오는 중…</p>}
          {(error || editRejected) && <div className="grid gap-2 px-3 py-2 text-xs"><p role="alert">{error || EDIT_REJECTED_MESSAGE}</p>{!draft && <Button type="button" variant="outline" disabled={loading} onClick={() => { setError(""); setLoadAttempt(current => current + 1) }}>Request Lab 초안 다시 시도</Button>}</div>}
          {replayMessage && <p role="status" className="rounded-md border p-2 text-sm">{replayMessage}</p>}
          {draft && <>{(!draft.rawRequestRetained || !draft.rawResponseRetained) && <p role="status" className="rounded-md border bg-muted/40 p-2 text-xs">원문 일부가 보존되지 않았거나 마스킹됐습니다.</p>}{!draft.requestEditable && <p className="px-3 py-1.5 text-xs text-muted-foreground">{draft.message}</p>}</>}
        </div>
        {draft && <>
          <div ref={editorsRef} role="group" aria-label="Request Lab 요청 및 응답" className="grid min-h-0 min-w-0 flex-1 overflow-hidden" style={{ "--request-lab-split": `${split}%`, gridTemplateColumns: panelFocus === "both" ? "minmax(0,var(--request-lab-split)) 10px minmax(0,1fr)" : "minmax(0,1fr)" } as CSSProperties}>
            {panel("request")}
            <div hidden={panelFocus !== "both"} role="separator" aria-label="요청 응답 너비 조절" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(split)} tabIndex={0} className="flex cursor-col-resize touch-none items-center justify-center outline-ring before:h-12 before:w-0.5 before:rounded before:bg-border hover:before:bg-primary" onPointerDown={event => { if (event.button === 0) { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() } }} onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const box = editorsRef.current!.getBoundingClientRect(); resizeSplit((event.clientX - box.left) / (box.width - 10) * 100) }} onPointerUp={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.currentTarget.releasePointerCapture(event.pointerId); setSplit(splitRef.current) }} onPointerCancel={() => setSplit(splitRef.current)} onDoubleClick={() => { resizeSplit(50); setSplit(50) }} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) { event.preventDefault(); resizeSplit(event.key === "Home" ? 50 : splitRef.current + (event.key === "ArrowRight" ? 5 : -5)); setSplit(splitRef.current) } }} />
            {panel("response")}
          </div>
        </>}
      </section>
      <DialogFooter className="sticky bottom-0 mx-0 mb-0 shrink-0 rounded-b-xl"><DialogClose asChild><Button type="button" variant="outline" size="sm" onClick={close}>닫기</Button></DialogClose><Button type="button" variant="outline" size="sm" disabled={suspended || !draft || !editable || editRejected || loading || busy || (mode === "ACCOUNT" && !selectedAccountValid)} onClick={() => void openInRepeater()}>{openingRepeater ? "Repeater 준비 중" : "Repeater로 보내기"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
