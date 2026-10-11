import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { getCodexTerminal, resizeCodexTerminal, sendCodexTerminalInput,
  startCodexTerminal, stopCodexTerminal } from "@/lib/api/endpoints"
import type { CodexTerminalPoll } from "@/lib/api/types"
import { queryKeys } from "@/lib/query/hooks"

const idle: CodexTerminalPoll = {
  runId: "", running: false, exitCode: null, cursor: 0, oldestCursor: 0,
  truncated: false, outputBase64: "",
}

function terminalBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function encodedInput(value: string): string[] {
  const bytes = new TextEncoder().encode(value)
  const chunks: string[] = []
  for (let start = 0; start < bytes.length; start += 16 * 1024) {
    let binary = ""
    for (const byte of bytes.subarray(start, start + 16 * 1024)) binary += String.fromCharCode(byte)
    chunks.push(btoa(binary))
  }
  return chunks
}

export function CodexTerminalPanel({ target, datasetRevision, onBack }: {
  target: string
  datasetRevision: number
  onBack(): void
}) {
  const queryClient = useQueryClient()
  const container = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const cursor = useRef(0)
  const runId = useRef("")
  const epoch = useRef(0)
  const running = useRef(false)
  const inputQueue = useRef(Promise.resolve())
  const [status, setStatus] = useState<CodexTerminalPoll>(idle)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    const host = container.current
    if (!host) return
    const instance = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 6000,
      theme: { background: "#080d19", foreground: "#e7edf8" }, screenReaderMode: true })
    const fit = new FitAddon()
    instance.loadAddon(fit)
    instance.open(host)
    terminal.current = instance
    const fitTerminal = () => {
      fit.fit()
      if (running.current) void resizeCodexTerminal(instance.cols, instance.rows).catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : "터미널 크기를 바꾸지 못했습니다.")
      })
    }
    fitTerminal()
    const observer = new ResizeObserver(fitTerminal)
    observer.observe(host)
    const send = (chunks: readonly string[]) => {
      if (!running.current) return
      inputQueue.current = inputQueue.current.then(async () => {
        for (const chunk of chunks) await sendCodexTerminalInput(chunk)
        setError("")
      }).catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : "Codex CLI 입력을 보내지 못했습니다.")
      })
    }
    const input = instance.onData((value) => send(encodedInput(value)))
    const binaryInput = instance.onBinary((value) => send([btoa(value)]))
    const controller = new AbortController()
    const apply = (next: CodexTerminalPoll) => {
      if (controller.signal.aborted) return
      if (next.runId !== runId.current) {
        runId.current = next.runId
        cursor.current = 0
        instance.reset()
        setTruncated(false)
      }
      if (next.truncated) {
        instance.reset()
        setTruncated(true)
      }
      if (next.outputBase64) instance.write(terminalBytes(next.outputBase64))
      cursor.current = next.cursor
      const wasRunning = running.current
      running.current = next.running
      setStatus(next)
      if (!wasRunning && next.running)
        void resizeCodexTerminal(instance.cols, instance.rows).catch(() => undefined)
      if (wasRunning && !next.running && next.runId)
        void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot })
    }
    const poll = async () => {
      while (!controller.signal.aborted) {
        const requestEpoch = epoch.current
        try {
          const next = await getCodexTerminal(cursor.current, controller.signal)
          if (requestEpoch === epoch.current) apply(next)
        }
        catch (failure) {
          if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "터미널 상태를 읽지 못했습니다.")
        }
        await new Promise<void>((resolve) => {
          const onAbort = () => { window.clearTimeout(timer); resolve() }
          const timer = window.setTimeout(() => {
            controller.signal.removeEventListener("abort", onAbort)
            resolve()
          }, running.current ? 30 : 900)
          controller.signal.addEventListener("abort", onAbort, { once: true })
        })
      }
    }
    void poll()
    return () => {
      controller.abort()
      observer.disconnect()
      input.dispose()
      binaryInput.dispose()
      instance.dispose()
      terminal.current = null
      running.current = false
      cursor.current = 0
      runId.current = ""
    }
  }, [datasetRevision, queryClient])

  const start = async (resume: boolean) => {
    const instance = terminal.current
    if (!instance || busy || running.current) return
    setBusy(true)
    setError("")
    epoch.current++
    try {
      const next = await startCodexTerminal(instance.cols, instance.rows, resume)
      instance.reset()
      cursor.current = 0
      runId.current = next.runId
      running.current = next.running
      setStatus(next)
      setTruncated(false)
      instance.focus()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Codex CLI를 시작하지 못했습니다.")
    } finally { setBusy(false) }
  }

  const stop = async () => {
    if (busy || !running.current) return
    setBusy(true)
    try { await stopCodexTerminal() }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Codex CLI를 종료하지 못했습니다.") }
    finally { setBusy(false) }
  }

  return <section className="flex h-full min-h-0 flex-col gap-3" aria-label="Codex CLI 터미널">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Codex CLI</h2>
        <p className="text-sm text-muted-foreground">설치된 Codex CLI를 그대로 실행합니다. 모델·명령·대화는 아래 터미널에서 직접 다룹니다.</p></div>
      <Button type="button" size="sm" variant="outline" onClick={onBack}>자동 탐색 보기</Button>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={busy || status.running} onClick={() => void start(false)}>새 Codex CLI</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || status.running} onClick={() => void start(true)}>이전 대화 이어서</Button>
      <Button type="button" size="sm" variant="destructive" disabled={busy || !status.running} onClick={() => void stop()}>CLI 종료</Button>
      <span className="text-xs text-muted-foreground" role="status">{status.running ? "실행 중" : status.exitCode === null ? "시작 전" : `종료됨 · 코드 ${status.exitCode}`}</span>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {truncated && <Alert><AlertDescription>오래된 터미널 화면 일부가 메모리 상한으로 사라졌습니다. Codex 대화 기록은 Codex 자체 기록에서 확인하세요.</AlertDescription></Alert>}
    <div ref={container} className="min-h-[28rem] flex-1 overflow-hidden rounded-lg border border-border bg-[#080d19] p-2" />
    <p className="text-xs text-muted-foreground">FlowScope는 범위 안에서 Burp 프록시를 실제로 지난 HTTP 요청·응답만 LLM 증거로 기록합니다. 현재 대상: <code>{target}</code></p>
  </section>
}
