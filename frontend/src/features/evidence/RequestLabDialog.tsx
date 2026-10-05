import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Maximize2, Minimize2, Pencil, Plus, Send, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getHumanRun, getRequestLabDraft, previewRequestLabCredentials, sendRequestLab } from "@/lib/api/endpoints"
import type { Account, EventRecord, ManagedSession, ManualVerification, RequestLabDraft } from "@/lib/api/types"
import { queryKeys } from "@/lib/query/hooks"
import { createMemoryOnlyRawState, REQUEST_LAB_MAX_BYTES, REQUEST_LAB_MAX_REQUESTS, type MemoryOnlyRawState, type RequestLabEntry } from "@/lib/security/memoryOnlyRawState"
import { DATASET_REPLACING, DATASET_WILL_REPLACE } from "@/lib/security/datasetBoundary"
import { formatHttpJson } from "./jsonDisplay"
import { JsonTextPanel, RawTextPanel } from "./RawTextPanel"
import type { RequestLabCredentialMode } from "./RequestLabMetadata"
import { applyRequestLabCredentials } from "./requestLabCredentials"
import { RequestLabPersistence, type RequestLabSaveStatus } from "./requestLabPersistence"

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  event: EventRecord
  accounts: readonly Account[]
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
export function activeAccounts(sessions: readonly ManagedSession[], service: string) {
  const unique = new Map<string, ManagedSession>()
  // 서버가 인증값을 넣어 주는 기준(SessionBroker.headers)과 같다: ACTIVE이거나, 그 계정으로 점검 중이고 인증된 응답을 이미 받은 세션.
  for (const session of sessions) if (session.service === service && !session.credentialConflict && (session.replayReady ?? (session.status === "ACTIVE" && !session.capturing)) && !unique.has(session.accountId)) unique.set(session.accountId, session)
  return [...unique.values()]
}

export function RequestLabDialog({ open, onOpenChange, event, accounts, sessions, datasetRevision = 0, snapshotRevision, suspended = false, rawState }: Props) {
  const queryClient = useQueryClient()
  const raw = useRef<MemoryOnlyRawState>(rawState ?? createMemoryOnlyRawState())
  const context = useRef<{ generation: number; sendController: AbortController | null; submission: { request: string } | null; preview: { mode: RequestLabCredentialMode; accountId: string; sessionHandle?: string } | null }>({ generation: 0, sendController: null, submission: null, preview: null })
  const [, setVersion] = useState(0)
  const persistence = useRef<RequestLabPersistence | null>(null)
  const [saveStatus, setSaveStatus] = useState<RequestLabSaveStatus | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [closing, setClosing] = useState(false)
  const closePending = useRef(false)
  const [draft, setDraft] = useState<Omit<RequestLabDraft, "request" | "response" | "workspace"> | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [applyingCredentials, setApplyingCredentials] = useState(false)
  const [error, setError] = useState("")
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [maximized, setMaximized] = useState(false)
  const [dialogSize, setDialogSize] = useState<{ width: number; height: number } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const resizeDrag = useRef<{ x: number; y: number; width: number; height: number; side: number; corner: boolean } | null>(null)
  const pendingSize = useRef<typeof dialogSize>(null)
  const resizeFrame = useRef<number | null>(null)
  const [view, setView] = useState<"original" | number>("original")
  /** 원문 보기에서 편집으로 돌아갈 탭과, 열 때 편집본을 한 번 준비했는지. */
  const returnView = useRef<number | null>(null)
  const prepared = useRef(false)
  const requestRef = useRef<HTMLTextAreaElement>(null)
  const responseRef = useRef<HTMLTextAreaElement>(null)
  const originalPosition = useRef({ start: 0, end: 0, top: 0, left: 0, responseTop: 0, responseLeft: 0 })
  const [fontSize, setFontSize] = useState(14)
  const [panelFocus, setPanelFocus] = useState<"both" | "request" | "response">("both")
  const [jsonView, setJsonView] = useState({ request: false, response: false })
  const [split, setSplit] = useState(50)
  const editorsRef = useRef<HTMLDivElement>(null)
  const splitRef = useRef(50)
  const draftRef = useRef<Omit<RequestLabDraft, "request" | "response" | "workspace"> | null>(null)

  // 점검 중인 실행은 사이드바 상태 표시가 계속 받아 온다. 여기서는 새로 요청하지 않고 같은 값을 읽기만 한다.
  const inspection = useQuery({ queryKey: queryKeys.humanRun, queryFn: ({ signal }) => getHumanRun(signal), enabled: false }).data
  const accountOptions = useMemo(() => accounts.map(account => {
    const session = sessions.find(value => value.accountId === account.id && value.service === draft?.service)
    const ready = !!session && !session.credentialConflict
      && (session.replayReady ?? (session.status === "ACTIVE" && !session.capturing))
    return { account, session, ready }
  }), [accounts, sessions, draft?.service])
  const entry = raw.current.requests.find(item => item.id === view)
  const accountId = entry?.accountId ?? ""
  const selectedAccountValid = accountOptions.some(option => option.account.id === accountId && option.ready)
  const mode = entry?.credentialMode ?? "ORIGINAL"
  const editRejected = entry?.editRejected ?? false
  const displayedRequest = raw.current.request
  const displayedResponse = raw.current.response
  const editable = !!entry
  const credentialsRequired = !!entry && (mode === "ORIGINAL" || (entry.restored && mode !== "ANONYMOUS") || (mode === "ACCOUNT" && !selectedAccountValid) || /\*\*\*MASKED\*\*\*|\[BODY REDACTED:/.test(displayedRequest))
  const busy = sending || applyingCredentials || deleting || closing
  const selectedButtonClass = "aria-pressed:border-primary/50 aria-pressed:bg-primary/10 aria-pressed:text-primary"
  const controlClass = "h-7 rounded-md border border-input bg-background px-2 text-[0.8rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
  const settingClass = "h-[36px] rounded-md border border-input bg-background px-2.5 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"

  function boundSize(width: number, height: number) {
    return { width: Math.min(window.innerWidth - 32, Math.max(960, width)), height: Math.min(window.innerHeight - 32, Math.max(460, height)) }
  }
  function applySize() {
    resizeFrame.current = null
    if (!pendingSize.current || !dialogRef.current) return
    dialogRef.current.style.setProperty("--request-lab-width", `${pendingSize.current.width}px`)
    dialogRef.current.style.setProperty("--request-lab-height", `${pendingSize.current.height}px`)
  }
  function finishResize() {
    if (resizeFrame.current !== null) cancelAnimationFrame(resizeFrame.current)
    applySize()
    if (pendingSize.current) setDialogSize(pendingSize.current)
    resizeDrag.current = null
  }
  function startResize(event: ReactPointerEvent<HTMLElement>, side: number, corner: boolean) {
    if (event.button !== 0 || maximized || !dialogRef.current) return
    const box = dialogRef.current.getBoundingClientRect()
    resizeDrag.current = { x: event.clientX, y: event.clientY, width: box.width, height: box.height, side, corner }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  function moveResize(event: ReactPointerEvent<HTMLElement>) {
    const drag = resizeDrag.current
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    pendingSize.current = boundSize(drag.width + 2 * drag.side * (event.clientX - drag.x), drag.height + (drag.corner ? 2 * (event.clientY - drag.y) : 0))
    if (resizeFrame.current === null) resizeFrame.current = requestAnimationFrame(applySize)
  }
  function resetSize() {
    finishResize()
    pendingSize.current = null
    setDialogSize(null)
    dialogRef.current?.style.removeProperty("--request-lab-width")
    dialogRef.current?.style.removeProperty("--request-lab-height")
  }
  useEffect(() => {
    if (!open) return
    const onResize = () => {
      if (!pendingSize.current) return
      pendingSize.current = boundSize(pendingSize.current.width, pendingSize.current.height)
      finishResize()
    }
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      if (resizeFrame.current !== null) cancelAnimationFrame(resizeFrame.current)
      resizeFrame.current = null
      resizeDrag.current = null
    }
  }, [open])

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
    setView(next)
    persistence.current?.select(raw.current.selectedId)
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

  const authLabel = (item: RequestLabEntry) => item.credentialMode === "ANONYMOUS" ? "비로그인"
    : item.credentialMode === "ACCOUNT" ? accounts.find(account => account.id === item.accountId)?.label ?? "계정" : "인증 선택 전"
  const tabLabel = (item: RequestLabEntry) => item.result
    ? `${item.name} · ${authLabel(item)} · ${item.result.status || "실패"}`
    : `작성 중 · ${authLabel(item)}`
  function toggleOriginal() {
    if (view !== "original") { returnView.current = typeof view === "number" ? view : null; changeView("original"); return }
    const back = raw.current.requests.find(item => item.id === returnView.current) ?? raw.current.requests.at(-1)
    if (back) changeView(back.id)
    else { changeView("original"); prepared.current = false; startDraft() }
  }
  /** 보낸 탭 이름: 수정된 요청 1, 2, … 지운 번호는 다시 쓰지 않는다. */
  function nextSentName() {
    const used = raw.current.requests.map(item => /^수정된 요청 (\d+)$/.exec(item.name)?.[1]).filter(Boolean).map(Number)
    return `수정된 요청 ${Math.max(0, ...used) + 1}`
  }
  /** 새 편집본(작성 중)을 만들어 고른다. 만들 수 없으면 이유를 알리고 null. */
  function createDraft(request: string, credentialMode: RequestLabEntry["credentialMode"], accountId: string, restored?: boolean) {
    const next = raw.current.addRequest(request, credentialMode, accountId)
    if (!next) { setError(`요청은 최대 ${REQUEST_LAB_MAX_REQUESTS}개까지 쌓입니다. 오래된 요청을 삭제한 뒤 다시 시도해 주세요.`); return null }
    next.name = "작성 중"
    next.restored = restored
    persistence.current?.changed(next, ["name", "request", "credentialMode", "result", "dirty"])
    changeView(next.id)
    return next
  }
  /**
   * 새 편집본의 전송 인증: 점검이 하나만 돌고 있으면 그 신원(비로그인 점검이면 비로그인, 계정은 세션을 쓸 수 있을 때만).
   * 점검이 없거나 여러 개면 어느 신원인지 알 수 없으므로 비워 두고 사용자가 고르게 한다.
   */
  function inspectedCredentials(): { mode: RequestLabCredentialMode; accountId: string } | null {
    const runs = inspection?.runs?.length ? inspection.runs : inspection?.active ? [inspection] : []
    const identities = [...new Set(runs.map(run => run.accountId || ""))]
    if (identities.length !== 1) return null
    const [accountId] = identities
    if (!accountId) return { mode: "ANONYMOUS", accountId: "" }
    return accountOptions.some(option => option.account.id === accountId && option.ready) ? { mode: "ACCOUNT", accountId } : null
  }
  /** 원본에서 새 편집본을 만들고 점검 중인 신원의 인증을 적용한다. 열 때와 탭을 모두 지웠을 때 쓴다. */
  function startDraft() {
    if (!draft?.requestEditable || busy || suspended) return
    const next = createDraft(raw.current.originalRequest, "ORIGINAL", "")
    const credentials = inspectedCredentials()
    if (next && credentials) void changeCredentials(credentials.mode, credentials.accountId, next)
  }
  /** 보낸 탭은 기록으로 남긴다. 고치거나 다시 보내면 같은 인증으로 새 탭을 만들어 이어 간다. */
  function forkFrom(source: RequestLabEntry, request = source.request) {
    const next = createDraft(request, source.credentialMode, source.accountId, source.restored)
    if (next && request !== source.request) next.dirty = true
    return next
  }
  /** 탭마다 따로 지운다. 보고 있는 탭을 지우면 옆 탭으로 옮기고, 다른 탭을 지우면 보던 탭에 그대로 머문다. */
  async function removeRequest(target: RequestLabEntry) {
    if (busy || suspended) return
    const index = raw.current.requests.indexOf(target)
    const next = raw.current.requests[index + 1] ?? raw.current.requests[index - 1]
    const removingViewed = view === target.id
    if (persistence.current) {
      const generation = context.current.generation
      setDeleting(true)
      try {
        await persistence.current.retry()
        await persistence.current.remove(target, removingViewed ? next?.id ?? null : entry?.id ?? null)
        if (context.current.generation !== generation) return
      } catch { return }
      finally { setDeleting(false) }
    }
    if (removingViewed) changeView(next?.id ?? "original")
    raw.current.removeRequest(target)
    setVersion(value => value + 1)
    if (!next) prepared.current = false
  }
  const invalidateSend = () => {
    context.current.generation += 1
    context.current.sendController?.abort()
    context.current.sendController = null
    context.current.preview = null
    if (context.current.submission) context.current.submission.request = ""
    context.current.submission = null
  }
  const release = () => {
    persistence.current?.dispose()
    persistence.current = null
    setSaveStatus(null)
    invalidateSend()
    raw.current.clear()
    draftRef.current = null
    setDraft(null)
    setError("")
    returnView.current = null
    prepared.current = false
    setView("original")
    originalPosition.current = { start: 0, end: 0, top: 0, left: 0, responseTop: 0, responseLeft: 0 }
    setJsonView({ request: false, response: false })
    setSending(false)
    setApplyingCredentials(false)
    setDeleting(false)
    setClosing(false)
    closePending.current = false
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
      const { request: _request, response: _response, workspace, ...metadata } = next
      if (workspace) {
        const entries = Object.entries(workspace.tab.entries).sort(([a], [b]) => Number(a) - Number(b)).map(([id, value]) => ({ ...value, id: Number(id) }))
        if (!raw.current.restoreRequests(entries, workspace.tab.nextId, workspace.tab.selectedId)) throw new Error("저장 요청이 메모리 한도를 초과했습니다. 다른 요청을 닫고 다시 열어 주세요.")
        persistence.current = new RequestLabPersistence(raw.current, event.eventId, datasetRevision, workspace, setSaveStatus)
        setView(raw.current.selectedId ?? "original")
      }
      draftRef.current = metadata
      setDraft(metadata)
      setVersion((value) => value + 1)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted && context.current.generation === generation) {
        persistence.current?.dispose(); persistence.current = null
        raw.current.clear()
        setDraft(null)
        setError(reason instanceof Error ? reason.message : "Request Lab 초안을 불러오지 못했습니다.")
      }
    }).finally(() => { if (!controller.signal.aborted && context.current.generation === generation) setLoading(false) })
    return () => { controller.abort(); persistence.current?.dispose(); persistence.current = null; invalidateSend(); raw.current.clear() }
  }, [open, event.eventId, datasetRevision, loadAttempt])

  // Revalidate retained-raw/session metadata after traffic changes without
  // replacing independent requests or their latest responses. The response remains outside the query cache.
  useEffect(() => {
    const original = draftRef.current
    if (!open || suspended || !original || snapshotRevision === undefined) return
    const controller = new AbortController()
    void getRequestLabDraft(event.eventId, controller.signal, !persistence.current).then(next => {
      if (controller.signal.aborted) return
      if (next.service !== original.service || next.observedIdentity !== original.observedIdentity
        || (original.rawRequestRetained && !next.rawRequestRetained)
        || (original.rawResponseRetained && !next.rawResponseRetained)
        || (original.requestEditable && !next.requestEditable)
        || (original.reusableSession !== "없음" && next.reusableSession !== original.reusableSession)) close()
    }).catch(() => { if (!controller.signal.aborted) close() })
    return () => controller.abort()
  }, [open, event.eventId, snapshotRevision, suspended])

  // 열자마자 보낼 수 있게 한다: 아직 보내지 않은 탭이 있으면 그 탭을, 없으면 원본에서 점검 중인 신원으로 편집본을 만들어 고른다.
  useEffect(() => {
    if (!open || !draft || prepared.current || loading || busy || suspended) return
    prepared.current = true
    const unsent = [...raw.current.requests].reverse().find(item => !item.result)
    if (unsent) changeView(unsent.id)
    else startDraft()
  }, [open, draft, loading, busy, suspended, raw.current.requests.length])

  // 세션이 사라지면 진행 중 전송을 끊고 전송을 잠근다. 다른 방식으로 조용히 바꾸지 않는다.
  useEffect(() => {
    if (mode === "ACCOUNT" && draft && !selectedAccountValid && !context.current.preview) { invalidateSend(); setSending(false); setApplyingCredentials(false) }
  }, [draft, mode, selectedAccountValid])

  useEffect(() => {
    const preview = context.current.preview
    if (preview && (suspended || (preview.mode === "ACCOUNT" && !accountOptions.some(option => option.account.id === preview.accountId && option.ready && option.session?.handle === preview.sessionHandle)))) {
      invalidateSend()
      setApplyingCredentials(false)
      setError("선택한 계정의 세션이 바뀌었습니다. 인증을 다시 선택해 주세요.")
    }
  }, [accountOptions, suspended])

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (persistence.current?.status.pending) { event.preventDefault(); event.returnValue = "" }
    }
    const clearOnUnload = () => { release(); onOpenChange(false) }
    const clearOnReplacement = clearOnUnload
    const flushBeforeReplacement = (event: Event) => {
      ;(event as CustomEvent<{ waitUntil(promise: Promise<unknown>): void }>).detail.waitUntil(persistence.current?.flush() ?? Promise.resolve())
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    window.addEventListener("pagehide", clearOnUnload)
    window.addEventListener(DATASET_WILL_REPLACE, flushBeforeReplacement)
    window.addEventListener(DATASET_REPLACING, clearOnReplacement)
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload)
      window.removeEventListener("pagehide", clearOnUnload)
      window.removeEventListener(DATASET_WILL_REPLACE, flushBeforeReplacement)
      window.removeEventListener(DATASET_REPLACING, clearOnReplacement)
    }
  }, [])

  async function close() {
    if (closePending.current) return
    if (persistence.current) {
      closePending.current = true
      invalidateSend()
      setSending(false)
      setApplyingCredentials(false)
        setClosing(true)
      try { await persistence.current.flush() }
      catch { return }
      finally { closePending.current = false; setClosing(false) }
    }
    release()
    onOpenChange(false)
  }

  async function changeCredentials(nextMode: RequestLabCredentialMode, nextAccountId = "", targetEntry = entry) {
    // 같은 편집본에 같은 인증을 다시 고르면 아무 일도 하지 않는다. 원본 화면에서 새로 만든 편집본은 항상 적용한다.
    const unchanged = targetEntry === entry && nextMode === mode && nextAccountId === accountId && !credentialsRequired
    if (!draft || !targetEntry || targetEntry.editRejected || busy || suspended || context.current.preview || unchanged) return
    const selected = accountOptions.find(option => option.account.id === nextAccountId && option.ready)
    if (nextMode === "ACCOUNT" && !selected) { setError("선택한 계정의 세션이 아직 준비되지 않았습니다. 계정·세션에서 그 계정의 점검 시작을 누르고 로그인하면 쓸 수 있습니다."); return }
    if (!raw.current.canSend(targetEntry.request)) { setError("요청이 너무 큽니다. 내용을 줄인 뒤 인증을 선택해 주세요."); return }
    const controller = new AbortController()
    const generation = ++context.current.generation
    context.current.sendController = controller
    context.current.preview = { mode: nextMode, accountId: nextAccountId, sessionHandle: selected?.session?.handle }
    const submitted = { request: targetEntry.request }
    context.current.submission = submitted
    setApplyingCredentials(true)
    setError("")
    try {
      const preview = await previewRequestLabCredentials({ eventId: event.eventId, request: submitted.request, credentialMode: nextMode, accountId: nextMode === "ACCOUNT" ? nextAccountId : "", datasetRevision }, controller.signal)
      try {
        if (controller.signal.aborted || context.current.generation !== generation || !raw.current.requests.includes(targetEntry) || targetEntry.request !== submitted.request) return
        const next = applyRequestLabCredentials(submitted.request, preview.headers)
        if (!raw.current.canSend(next) || !raw.current.editRequest(targetEntry, next)) throw new Error("인증을 적용하면 요청이 너무 커집니다. 내용을 줄여 주세요.")
        targetEntry.credentialMode = nextMode
        targetEntry.accountId = nextMode === "ACCOUNT" ? nextAccountId : ""
        targetEntry.restored = false
        persistence.current?.changed(targetEntry, ["request", "credentialMode", "dirty"])
        setJsonView(current => ({ ...current, request: false }))
        setVersion(value => value + 1)
      } finally {
        // Scrub references held by this async operation, including ignored late responses.
        for (const header of preview.headers) header.value = ""
        preview.headers.length = 0
      }
    } catch (reason) {
      if (!controller.signal.aborted && context.current.generation === generation) setError(reason instanceof Error ? reason.message : "인증을 적용하지 못했습니다. 다시 선택해 주세요.")
    } finally {
      submitted.request = ""
      if (context.current.submission === submitted) context.current.submission = null
      if (context.current.generation === generation) {
        context.current.sendController = null
        context.current.preview = null
        setApplyingCredentials(false)
      }
    }
  }

  async function send() {
    if (suspended || !draft || !entry || !editable || editRejected || credentialsRequired || busy) return
    if (!raw.current.canSend(raw.current.request)) { setError(`요청은 UTF-8 기준 ${REQUEST_LAB_MAX_BYTES.toLocaleString("en-US")}바이트를 초과할 수 없습니다.`); return }
    if (mode === "ACCOUNT" && !selectedAccountValid) { setError("선택한 계정의 사용 가능한 인증값이 없어요."); return }
    // 이미 보낸 탭을 다시 보내면 그 기록은 그대로 두고 같은 요청으로 새 탭을 만들어 보낸다.
    const target = entry.result ? forkFrom(entry) : entry
    if (!target) return
    target.name = nextSentName()
    persistence.current?.changed(target, ["name"])
    const controller = new AbortController()
    const generation = context.current.generation + 1
    context.current.generation = generation
    context.current.sendController?.abort()
    context.current.sendController = controller
    const submitted = { request: target.request, credentialMode: mode, accountId: mode === "ACCOUNT" ? accountId : "" }
    context.current.submission = submitted
    const started = performance.now()
    raw.current.replaceResult(target, null)
    persistence.current?.changed(target, ["result", "dirty"])
    setJsonView(current => ({ ...current, response: false }))
    setSending(true)
    setError("")
    try {
      const result = await sendRequestLab({ eventId: event.eventId, credentialMode: submitted.credentialMode, accountId: submitted.accountId, request: submitted.request }, controller.signal)
      if (controller.signal.aborted || context.current.generation !== generation) return
      if (!raw.current.replaceResult(target, { response: result.response, status: result.status, durationMs: result.durationMs, requestBytes: result.requestBytes, responseBytes: result.responseBytes })) {
        const failure = "응답이 커서 보관하지 못했습니다. 사용하지 않는 요청을 삭제해 주세요."
        if (!raw.current.replaceResult(target, { response: "", status: result.status, durationMs: result.durationMs, failure })) setError(failure)
      }
      persistence.current?.changed(target, ["result", "dirty"])
      setVersion((value) => value + 1)
    } catch (reason) {
      if (controller.signal.aborted || context.current.generation !== generation) return
      raw.current.replaceResult(target, { response: "", status: 0, durationMs: Math.round(performance.now() - started), failure: reason instanceof Error ? reason.message : "요청 재전송에 실패했습니다." })
      persistence.current?.changed(target, ["result", "dirty"])
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

  function resizeSplit(value: number) {
    const width = editorsRef.current?.clientWidth ?? 0
    const minimum = width > 610 ? Math.max(25, 300 / (width - 10) * 100) : 50
    splitRef.current = Math.min(100 - minimum, Math.max(minimum, value))
    editorsRef.current?.style.setProperty("--request-lab-split", `${splitRef.current}%`)
  }
  function editRequest(next: string) {
    if (!editable || suspended || busy) return
    if (!entry) return
    if (entry.result) { forkFrom(entry, next); setVersion(value => value + 1); return }
    if (!raw.current.editRequest(entry, next)) {
      entry.editRejected = true
      setError(EDIT_REJECTED_MESSAGE)
      setVersion(value => value + 1)
      return
    }
    entry.editRejected = false
    persistence.current?.changed(entry, ["request", "dirty"])
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
      <header className="flex min-h-[46px] shrink-0 items-center gap-2 border-b bg-background px-3 py-2"><label htmlFor={`request-lab-${pane}`} className="text-[15px] font-medium">{title}</label><span className="text-xs text-muted-foreground">{request && editable && !showJson ? "편집 가능" : "읽기 전용"}</span>
        {!request && <span className="truncate text-xs text-muted-foreground">{view === "original" ? "관측 원문" : selected ? `${selected.status ? `HTTP ${selected.status}` : "응답 없음"} · ${selected.durationMs}ms${entry?.dirty ? " · 이전 응답" : ""}` : "미전송"}</span>}
        <div role="group" aria-label={`${title} 보기`} className="ml-auto flex shrink-0 gap-1"><Button type="button" variant="outline" size="sm" className={`h-[32px] text-[13px] ${selectedButtonClass}`} aria-pressed={!showJson} onClick={() => setJsonView(current => ({ ...current, [pane]: false }))}>Raw</Button><Button type="button" variant="outline" size="sm" className={`h-[32px] text-[13px] ${selectedButtonClass}`} aria-pressed={!!showJson} disabled={!canFormat} title={formatted?.message || undefined} onClick={() => chooseJson(pane)}>JSON 정돈</Button></div></header>
      {!request && selected?.failure && <p role="alert" className="shrink-0 border-b px-3 py-2 text-xs text-destructive">{selected.failure}{!selected.status && " · 대상 처리 여부 미확인"}</p>}
      <div className="min-h-0 flex-1 overflow-hidden" hidden={!!showJson}><RawTextPanel id={`request-lab-${pane}`} label={`Request Lab ${title} 원문`} inputRef={request ? requestRef : responseRef} value={request ? displayedRequest : displayedResponse} fontSize={fontSize} fill readOnly={!request || !editable} disabled={request && (suspended || !draft?.requestEditable || busy)} onChange={request ? editRequest : undefined} /></div>
      <JsonTextPanel text={showJson ? formatted?.text ?? "" : ""} label={`Request Lab ${title} JSON 정돈`} hidden={!showJson} fontSize={fontSize} />
    </section>
  }

  return <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
    <DialogContent ref={dialogRef} className="flex max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" style={{ width: maximized ? "calc(100vw - 24px)" : "min(var(--request-lab-width,min(1680px,90vw)),calc(100vw - 32px))", height: maximized ? "calc(100svh - 24px)" : "min(var(--request-lab-height,min(820px,90svh)),calc(100svh - 32px))", ...(dialogSize ? { "--request-lab-width": `${dialogSize.width}px`, "--request-lab-height": `${dialogSize.height}px` } : {}) } as CSSProperties} showCloseButton={false} aria-describedby="request-lab-description" onEscapeKeyDown={event => {
      if (maximized && !event.defaultPrevented) { event.preventDefault(); setMaximized(false) }
    }}>
      <DialogHeader className="shrink-0 border-b px-6 pb-3.5 pt-[18px]">
        <div className="flex items-center justify-between gap-6"><div className="shrink-0"><DialogTitle className="text-[22px] leading-tight">Request Lab</DialogTitle><DialogDescription id="request-lab-description" className="mt-1 text-[13px]">요청을 수정하고, 전송 결과를 다시 확인합니다.</DialogDescription></div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-3 text-[14px]">
            <div className="flex items-center gap-2"><label htmlFor="request-lab-authentication">전송 인증</label><Select value={credentialsRequired || mode === "ORIGINAL" ? "" : mode === "ACCOUNT" ? `ACCOUNT:${accountId}` : mode} disabled={!entry || editRejected || suspended || busy} onValueChange={value => {
              if (!entry) return
              // 보낸 탭의 인증을 바꾸면 그 기록은 두고 새 탭에서 바꾼다.
              const target = entry.result ? forkFrom(entry) : entry
              if (target) void (value.startsWith("ACCOUNT:") ? changeCredentials("ACCOUNT", value.slice(8), target) : changeCredentials("ANONYMOUS", "", target))
            }}>
              <SelectTrigger id="request-lab-authentication" aria-label="전송 인증" className="min-w-[180px] max-w-[224px] bg-background text-[14px] data-[size=default]:h-[36px]"><SelectValue placeholder={entry?.restored || (mode === "ACCOUNT" && !selectedAccountValid) ? "인증 다시 선택" : "인증 선택"} /></SelectTrigger>
              <SelectContent position="popper" align="start" className="max-h-72 min-w-[224px]">
                <SelectItem value="ANONYMOUS">비로그인</SelectItem>
                {accountOptions.map(({ account, ready }) => <SelectItem key={account.id} value={`ACCOUNT:${account.id}`} disabled={!ready}>{account.label}{!ready ? " · 점검 시작 후 사용 가능" : ""}</SelectItem>)}
                {accountOptions.length === 0 && <SelectItem value="NO_ACCOUNTS" disabled>등록된 계정 없음</SelectItem>}
              </SelectContent>
            </Select></div>
            <Button type="button" variant="outline" size="sm" className={`h-[36px] px-2.5 text-[14px] ${selectedButtonClass}`} aria-pressed={view === "original"} disabled={!draft || suspended || busy} onClick={toggleOriginal}>{view === "original" ? "편집으로 돌아가기" : "원문 보기"}</Button>
            <label className="flex items-center gap-2">글자 크기<select aria-label="글자 크기" className={settingClass} value={fontSize} onChange={event => setFontSize(Number(event.target.value))}>{[12, 14, 16, 18].map(size => <option key={size} value={size}>{size}px</option>)}</select></label>
            <Button type="button" variant="outline" size="sm" className="h-[36px] min-w-[128px] border-muted-foreground/60 px-2.5 text-[14px] [&_svg]:size-[18px]" aria-pressed={maximized} onClick={() => { finishResize(); setMaximized(current => !current) }}>{maximized ? <Minimize2 aria-hidden="true" className="size-[18px]" /> : <Maximize2 aria-hidden="true" className="size-[18px]" />}{maximized ? "원래 크기" : "전체화면"}</Button>
            <Button type="button" size="sm" className="h-[36px] min-w-[144px] items-center justify-center gap-1.5 px-2.5 text-[14px] [&_svg]:size-[18px]" disabled={suspended || !draft || !editable || editRejected || credentialsRequired || loading || busy || (mode === "ACCOUNT" && !selectedAccountValid)} onClick={() => void send()}><Send aria-hidden="true" className="size-[18px]" /><span>{sending ? "요청 재전송 중" : "요청 재전송"}</span></Button>
          </div>
        </div>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <div role="group" aria-label="보낸 요청" className="flex min-w-0 flex-wrap items-center gap-1.5">
            {raw.current.requests.map(item => <span key={item.id} className="flex items-center">
              <Button type="button" variant="outline" size="sm" className={`h-7 max-w-[260px] truncate rounded-r-none px-2.5 text-xs ${selectedButtonClass}`} aria-pressed={view === item.id} title={tabLabel(item)} disabled={!draft || suspended || busy} onClick={() => changeView(item.id)}>{tabLabel(item)}</Button>
              <Button type="button" variant="outline" size="icon" className="size-7 shrink-0 rounded-l-none border-l-0" aria-label={`${item.name} 삭제`} title="이 요청 삭제" disabled={suspended || busy} onClick={() => void removeRequest(item)}><X aria-hidden="true" className="size-3.5" /></Button>
            </span>)}
          </div>
          {saveStatus && <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <span>{saveStatus.error ? "저장 실패" : !saveStatus.persisted ? "프로젝트 저장 필요" : saveStatus.saving ? "저장 중" : saveStatus.pending ? "저장 대기" : "프로젝트 저장됨"}</span>
            {saveStatus.error && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void persistence.current?.retry().catch(() => {})}>다시 저장</Button>}
          </div>}
          <div className="flex items-center gap-2 [&_button]:h-[32px] [&_button]:text-[13px]"><Button type="button" variant="outline" size="sm" onClick={() => { resetSize(); setMaximized(false); setPanelFocus("both"); resizeSplit(50); setSplit(50) }}>기본 크기</Button><div role="group" aria-label="패널 확대" className="flex gap-1">{(["both", "request", "response"] as const).map(focus => <Button key={focus} type="button" variant="outline" size="sm" className={selectedButtonClass} aria-pressed={panelFocus === focus} onClick={() => setPanelFocus(focus)}>{focus === "both" ? "함께 보기" : focus === "request" ? "요청 확대" : "응답 확대"}</Button>)}</div></div>
        </div>
      </DialogHeader>
      <section aria-label="Request Lab 원문 작업면" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="max-h-[20svh] shrink-0 overflow-auto empty:hidden">
          {suspended && <Alert aria-label="Request Lab 일시 중지"><AlertTitle>서버 상태 확인 중</AlertTitle><AlertDescription>편집 초안을 보존했습니다. 갱신에 성공할 때까지 전송과 인증정보 변경을 잠급니다.</AlertDescription></Alert>}
          {applyingCredentials && <p role="status" className="px-3 py-2 text-xs">인증 적용 중…</p>}
          {loading && <p className="px-3 py-2 text-xs">Request Lab 초안 불러오는 중…</p>}
          {(error || editRejected) && <div className="grid gap-2 px-3 py-2 text-xs"><p role="alert">{error || EDIT_REJECTED_MESSAGE}</p>{!draft && <Button type="button" variant="outline" disabled={loading} onClick={() => { setError(""); setLoadAttempt(current => current + 1) }}>Request Lab 초안 다시 시도</Button>}</div>}
          {saveStatus?.error && <div className="flex items-center gap-3 px-3 py-2 text-xs"><p role="alert">{saveStatus.error}</p><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { release(); onOpenChange(false) }}>변경 버리고 닫기</Button></div>}
          {draft && view === "original" && <p role="note" className="px-3 py-1.5 text-xs text-muted-foreground">처음 수집한 원문입니다. 읽기 전용이며, 편집으로 돌아가면 고쳐서 보낼 수 있습니다.</p>}
          {draft && entry && mode !== "ACCOUNT" && (draft.reusableAccountId || draft.observedAccountId) && <p role="note" className="px-3 py-1.5 text-xs text-muted-foreground">{draft.reusableAccountId ? `이 기록의 신원(${draft.observedIdentity})으로 보내려면 전송 인증에서 ${draft.observedIdentity}을(를) 고르세요.` : `${draft.observedIdentity}로 보내려면 계정·세션에서 ${draft.observedIdentity}의 점검 시작을 누르고 로그인하세요.`}</p>}
          {credentialsRequired && <p className="px-3 py-1.5 text-xs text-muted-foreground">{mode === "ORIGINAL" && !entry?.restored ? "전송할 계정 또는 비로그인을 선택해 주세요." : mode === "ACCOUNT" && !selectedAccountValid ? "선택한 계정의 세션이 지금 준비되지 않았습니다. 계정·세션에서 그 계정의 점검 시작을 누르고 로그인하거나, 다른 계정 또는 비로그인을 고르세요." : "저장본의 인증은 가려져 있습니다. 인증을 다시 선택하고 가려진 내용을 채워 주세요."}</p>}
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
      <DialogFooter className="sticky bottom-0 mx-0 mb-0 min-h-[64px] shrink-0 rounded-b-xl px-7 py-3.5 [&_button]:text-[13px]"><Button type="button" variant="outline" size="sm" disabled={closing || deleting} onClick={() => void close()}>{closing ? "저장 중" : "닫기"}</Button></DialogFooter>
      {!maximized && ([-1, 1] as const).map(side => <div key={side}>
        <div aria-hidden="true" className={`absolute bottom-7 top-[140px] z-10 w-[10px] cursor-ew-resize touch-none hover:bg-primary/10 ${side < 0 ? "left-0" : "right-0"}`} onPointerDown={event => startResize(event, side, false)} onPointerMove={moveResize} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); finishResize() }} onPointerCancel={finishResize} />
        <button type="button" aria-label={`${side < 0 ? "왼쪽" : "오른쪽"} 모서리 크기 조절`} title="드래그 또는 방향키로 크기 조절" className={`absolute bottom-0 z-20 flex size-[24px] touch-none items-center justify-center text-muted-foreground hover:text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${side < 0 ? "left-0 cursor-nesw-resize" : "right-0 cursor-nwse-resize"}`} onPointerDown={event => startResize(event, side, true)} onPointerMove={moveResize} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); finishResize() }} onPointerCancel={finishResize} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || !dialogRef.current) return
          event.preventDefault()
          const box = dialogRef.current.getBoundingClientRect()
          pendingSize.current = boundSize(box.width + (event.key === "ArrowRight" ? 32 * side : event.key === "ArrowLeft" ? -32 * side : 0), box.height + (event.key === "ArrowDown" ? 16 : event.key === "ArrowUp" ? -16 : 0))
          finishResize()
        }}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={side < 0 ? "-scale-x-100" : ""}><path d="M6 15 15 6M10 15l5-5M14 15l1-1" /></svg></button>
      </div>)}
    </DialogContent>
  </Dialog>
}
