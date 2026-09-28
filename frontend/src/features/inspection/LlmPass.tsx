import { useState } from "react"
import { CircleStop, ExternalLink, Play, RefreshCw, Send } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { runStatusLabel } from "@/lib/display/runStatus"
import {
  useExplorerControlMutation,
  useExplorerRunQuery,
  useExplorerStartMutation,
  useExplorerSteerMutation,
} from "@/lib/query/hooks"
import { SourcePassLayout, type SourceFeedItem } from "./SourcePassLayout"

const activeStates = new Set(["AUTHENTICATING", "RUNNING"])

function formatElapsed(value: number): string {
  const seconds = Math.max(0, Math.floor(value / 1_000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다."
}

/** 점검 시작의 LLM 스텝. 기존 Explorer 실행·제어 훅과 작업 피드를 그대로 사용한다. */
export function LlmPass({ target }: { target: string }) {
  const query = useExplorerRunQuery()
  const start = useExplorerStartMutation()
  const control = useExplorerControlMutation()
  const steer = useExplorerSteerMutation()
  const [anonymous, setAnonymous] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [operatorMessage, setOperatorMessage] = useState("")

  const data = query.data
  const run = data?.run
  const active = run ? activeStates.has(run.status) : false
  const providerReady = run?.providerReadiness === "READY"
  const failure = query.error ?? start.error ?? control.error ?? steer.error

  const feedItems: readonly SourceFeedItem[] = (run?.activities ?? []).map((item) => ({
    id: String(item.sequence),
    badge: item.kind,
    title: item.title,
    status: item.durationMillis == null ? item.status : `${item.status} · ${item.durationMillis}ms`,
    detail: item.detail,
  }))

  const notices = <>
    {failure && <Alert variant="destructive" aria-label={message(failure)}><AlertTitle>Explorer 요청 실패</AlertTitle><AlertDescription>{message(failure)}</AlertDescription></Alert>}
    {run && !providerReady ? <Alert variant="destructive"><AlertTitle>Codex 준비가 필요합니다</AlertTitle><AlertDescription className="space-y-3">
      <p>{run.providerReadiness}</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>공식 Codex CLI를 설치합니다.</li>
        <li>Burp를 실행하는 같은 OS 사용자로 터미널에서 <code>codex</code>를 실행하고 ChatGPT 로그인을 완료합니다.</li>
        <li>아래 버튼으로 준비 상태를 다시 확인합니다.</li>
      </ol>
      <p>LLM 스텝만 시작할 수 없는 상태이며 HUMAN·ZAP 수집은 계속 사용할 수 있습니다.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={control.isPending} onClick={() => control.mutate("recheck")}><RefreshCw className="size-4" />다시 확인</Button>
        <Button asChild variant="outline" size="sm"><a href="https://learn.chatgpt.com/docs/codex/cli" target="_blank" rel="noreferrer">공식 설치 안내<ExternalLink className="size-4" /></a></Button>
      </div>
    </AlertDescription></Alert> : null}
  </>

  const control_ = <div className="space-y-3">
    <p className="text-sm text-muted-foreground">대상은 상단 범위 값을 사용합니다 · <span className="font-mono break-all">{target || "적용된 scope 없음"}</span></p>
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">실행 신원</legend>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={anonymous} onCheckedChange={(value) => setAnonymous(value === true)} disabled={active} />비로그인</label>
      {data?.accounts.map((item) => (
        <label className="flex items-center justify-between gap-2 text-sm" key={item.id}>
          <span className="flex items-center gap-2">
            <Checkbox checked={selected.includes(item.id)} onCheckedChange={(value) => setSelected((current) => value === true ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))} disabled={active} />
            {item.label}
          </span>
          <Badge variant="outline">{item.status}</Badge>
        </label>
      ))}
      {!data?.accounts.length && <p className="text-sm text-muted-foreground">등록된 LLM 로그인 계정이 없습니다. 계정·세션 화면에서 등록하세요.</p>}
    </fieldset>
    <div className="flex flex-wrap gap-2">
      <Button disabled={!providerReady || active || start.isPending || !target || (!anonymous && selected.length === 0)} onClick={() => start.mutate({ target, accounts: selected.join(","), anonymous })}><Play className="size-4" />Explorer 시작</Button>
      {active ? <Button variant="destructive" onClick={() => control.mutate("cancel")}><CircleStop className="size-4" />중단</Button>
        : run && run.status !== "IDLE" ? <Button variant="outline" onClick={() => control.mutate("clear")}>실행 표시 지우기</Button> : null}
    </div>
    <p className="text-xs text-muted-foreground">OPTIONS probe {run?.capabilityProbes ?? 0}건은 API 기능 관측 수와 분리됩니다. 완료 요약 수치는 FlowScope 서버가 계산합니다.</p>
  </div>

  const feedFooter = <>
    {run?.unresolved.length ? <div className="border-t border-amber-400/30 bg-amber-400/5 p-3 text-sm">
      <p className="mb-2 font-medium text-amber-600 dark:text-amber-300">미해결 {run.unresolved.length}건</p>
      {run.unresolved.map((item, index) => <p className="break-all text-muted-foreground" key={`${item.kind}-${index}`}>{item.kind} · {item.target} · {item.reason}</p>)}
    </div> : null}
    <form className="flex gap-2 border-t p-3" onSubmit={(event) => {
      event.preventDefault()
      if (!operatorMessage.trim()) return
      steer.mutate(operatorMessage, { onSuccess: () => setOperatorMessage("") })
    }}>
      <Input aria-label="Explorer에게 추가 지시" value={operatorMessage} onChange={(event) => setOperatorMessage(event.target.value)} placeholder="실행 중 추가할 사실 기반 지시" disabled={run?.status !== "RUNNING"} />
      <Button type="submit" size="icon" aria-label="메시지 전송" disabled={run?.status !== "RUNNING" || !operatorMessage.trim()}><Send className="size-4" /></Button>
    </form>
  </>

  return <SourcePassLayout
    label="LLM"
    title="LLM 탐색"
    statusTiles={[
      { label: "상태", value: run ? runStatusLabel(run.status) : "불러오는 중" },
      { label: "소요 시간", value: formatElapsed(run?.elapsedMillis ?? 0), mono: true },
      { label: "HTTP 시도 / 응답", value: `${run?.attempts ?? 0} / ${run?.responses ?? 0}` },
      { label: "선언 Endpoint / Parameter", value: `${run?.endpointDeclarations ?? 0} / ${run?.parameterDeclarations ?? 0}` },
    ]}
    control={control_}
    notices={notices}
    feedItems={feedItems}
    feedTitle="작업 피드"
    feedDescription={run?.message ?? "Explorer 상태를 불러오는 중입니다."}
    feedBadge={<Badge variant={providerReady ? "outline" : "destructive"}>Codex {run?.providerReadiness ?? "확인 중"}</Badge>}
    emptyHint="실행하면 인증 준비·HTTP 요청·Evidence ID가 여기에 순서대로 표시됩니다."
    feedFooter={feedFooter}
  />
}

