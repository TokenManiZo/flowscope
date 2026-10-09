import { useEffect, useMemo, useState } from "react"
import { Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { sendCandidateRequestLab } from "@/lib/api/endpoints"
import type { Account, ManagedSession, RequestLabResult } from "@/lib/api/types"
import { activeAccounts } from "./RequestLabDialog"

type Mode = "RAW" | "ACCOUNT" | "ANONYMOUS"

/** 후보엔 캡처 원문이 없어 원본 모드는 뺀다. 직접 입력이 기본. */
const MODES: ReadonlyArray<{ mode: Mode; label: string; description: string }> = [
  { mode: "RAW", label: "직접 입력", description: "인증 헤더를 바꾸지 않고 쓴 그대로 보냅니다." },
  { mode: "ACCOUNT", label: "현재 세션", description: "현재 세션의 최신 인증값을 넣어서 보냅니다." },
  { mode: "ANONYMOUS", label: "비로그인", description: "인증 헤더를 모두 지우고 보냅니다." },
]

function hostOf(service: string) { try { return new URL(service).host } catch { return service } }
function candidateMethod(method: string) { return method && method !== "UNKNOWN" ? method : "GET" }
function initialRequest(method: string, pathTemplate: string, service: string) {
  return `${candidateMethod(method)} ${pathTemplate} HTTP/1.1\nHost: ${hostOf(service)}\nAccept: application/json\n\n`
}

export interface CandidateRequest { service: string; method: string; pathTemplate: string }

/**
 * 아직 한 번도 안 보낸 경로 후보를, 대상 서비스(host)만으로 처음 보내 보는 다이얼로그. 요청문은 후보의 메서드·경로·호스트로
 * 미리 채워 열고, 응답은 보낸 뒤 아래에 보여 준다. 재전송이 아니라 "처음 보내는 요청"이다.
 */
export function CandidateRequestLabDialog({ open, onOpenChange, candidate, accounts, sessions, disabled = false }: {
  open: boolean
  onOpenChange(open: boolean): void
  candidate: CandidateRequest
  accounts: readonly Account[]
  sessions: readonly ManagedSession[]
  disabled?: boolean
}) {
  const [request, setRequest] = useState(() => initialRequest(candidate.method, candidate.pathTemplate, candidate.service))
  const [mode, setMode] = useState<Mode>("RAW")
  const [accountId, setAccountId] = useState("")
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<RequestLabResult | null>(null)
  const [error, setError] = useState("")
  const usable = useMemo(() => activeAccounts(sessions, candidate.service), [sessions, candidate.service])

  // 열 때마다 후보 기준으로 처음 상태로 되돌린다.
  useEffect(() => {
    if (!open) return
    setRequest(initialRequest(candidate.method, candidate.pathTemplate, candidate.service))
    setMode("RAW"); setAccountId(""); setResult(null); setError(""); setSending(false)
  }, [open, candidate.service, candidate.method, candidate.pathTemplate])

  const busy = sending || disabled
  const accountReady = usable.some(session => session.accountId === accountId)
  const sendDisabled = busy || !request.trim() || (mode === "ACCOUNT" && !accountReady)
  const selected = MODES.find(item => item.mode === mode) ?? MODES[0]

  async function send() {
    setSending(true); setError(""); setResult(null)
    try {
      setResult(await sendCandidateRequestLab({ service: candidate.service, request, credentialMode: mode, accountId: mode === "ACCOUNT" ? accountId : "" }))
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "요청을 보내지 못했습니다. 경로·scope·현재 세션을 확인해 주세요.")
    } finally {
      setSending(false)
    }
  }

  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next) }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>이 경로로 요청 보내기</DialogTitle>
        <DialogDescription className="font-mono text-xs">{candidateMethod(candidate.method)} · {hostOf(candidate.service)} · 처음 보내는 요청</DialogDescription>
      </DialogHeader>
      <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">이 경로로 보낸 요청이 아직 없습니다. 재전송이 아니라 처음 보내는 실제 요청이며, 응답은 보낸 뒤 아래에 표시됩니다.</p>
      <div className="grid gap-1.5">
        <label htmlFor="candidate-request" className="text-xs font-medium text-muted-foreground">요청</label>
        <Textarea id="candidate-request" value={request} onChange={event => setRequest(event.target.value)} disabled={busy} rows={8} className="font-mono text-xs" aria-label="후보 요청 원문" />
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">인증</span>
        <div className="inline-flex w-fit flex-wrap overflow-hidden rounded-md border border-input" role="radiogroup" aria-label="인증 모드">
          {MODES.map(item => <button key={item.mode} type="button" role="radio" aria-checked={mode === item.mode}
            disabled={busy || (item.mode === "ACCOUNT" && usable.length === 0)} onClick={() => setMode(item.mode)}
            className={`border-r border-input px-3 py-1.5 text-sm last:border-r-0 disabled:cursor-not-allowed disabled:opacity-50 ${mode === item.mode ? "bg-primary font-medium text-primary-foreground" : "hover:bg-muted"}`}>{item.label}</button>)}
        </div>
        <p className="text-xs text-muted-foreground">{selected.description}</p>
        {mode === "ACCOUNT" && <Select value={accountId} onValueChange={setAccountId} disabled={busy}>
          <SelectTrigger className="w-full" aria-label="전송 계정"><SelectValue placeholder="계정 선택" /></SelectTrigger>
          <SelectContent>{usable.map(session => <SelectItem key={session.accountId} value={session.accountId}>{accounts.find(account => account.id === session.accountId)?.label ?? session.accountId}</SelectItem>)}</SelectContent>
        </Select>}
      </div>
      {result && <div className="grid gap-1 rounded-md border p-3 text-xs" aria-label="응답"><span className="font-medium">응답 · HTTP {result.status} · {result.durationMs}ms</span><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono">{result.response}</pre></div>}
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>닫기</Button>
        <Button onClick={send} disabled={sendDisabled}><Send className="size-4" />{sending ? "보내는 중…" : "보내기"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
