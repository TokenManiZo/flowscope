import { useEffect, useMemo, useState } from "react"
import { Bot, CircleStop, ExternalLink, KeyRound, Play, RefreshCw, Send, Trash2 } from "lucide-react"

import { ReferenceAnalysisWorkspace } from "@/components/layout/ReferenceAnalysisWorkspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  useExplorerAccountDeleteMutation,
  useExplorerAccountSaveMutation,
  useExplorerControlMutation,
  useExplorerRunQuery,
  useExplorerStartMutation,
  useExplorerSteerMutation,
} from "@/lib/query/hooks"

const activeStates = new Set(["AUTHENTICATING", "RUNNING"])

function formatElapsed(value: number): string {
  const seconds = Math.max(0, Math.floor(value / 1_000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다."
}

export function ExplorerPage() {
  const query = useExplorerRunQuery()
  const start = useExplorerStartMutation()
  const control = useExplorerControlMutation()
  const steer = useExplorerSteerMutation()
  const saveAccount = useExplorerAccountSaveMutation()
  const deleteAccount = useExplorerAccountDeleteMutation()
  const [target, setTarget] = useState("")
  const [anonymous, setAnonymous] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [operatorMessage, setOperatorMessage] = useState("")
  const [advanced, setAdvanced] = useState(false)
  const [account, setAccount] = useState({
    label: "", role: "USER", loginUrl: "", username: "", password: "", loginMode: "AUTO_FORM" as "AUTO_FORM" | "JSON",
    usernameField: "", passwordField: "", tokenJsonPath: "", authHeader: "Authorization", authPrefix: "Bearer ", validationUrl: "",
  })
  const data = query.data
  const run = data?.run
  const active = run ? activeStates.has(run.status) : false
  const providerReady = run?.providerReadiness === "READY"
  const failure = query.error ?? start.error ?? control.error ?? steer.error ?? saveAccount.error ?? deleteAccount.error

  useEffect(() => {
    if (!target && data?.scope.length) setTarget(data.scope[0])
  }, [data?.scope, target])

  const selectedLabels = useMemo(() => data?.accounts.filter((item) => selected.includes(item.id)).map((item) => item.label) ?? [], [data?.accounts, selected])
  const setField = (name: keyof typeof account, value: string) => setAccount((current) => ({ ...current, [name]: value }))

  const context = <section className="space-y-5 p-3">
    <div><h2 className="text-sm font-semibold">탐색 입력</h2><p className="text-xs text-muted-foreground">현재 exact scope와 메모리 계정만 사용합니다.</p></div>
    <div className="space-y-2"><Label htmlFor="explorer-target">시작 URL</Label><Input id="explorer-target" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="https://target.example/" disabled={active} /></div>
    <div className="space-y-2"><Label>신원</Label><label className="flex items-center gap-2 text-sm"><Checkbox checked={anonymous} onCheckedChange={(value) => setAnonymous(value === true)} disabled={active} />비로그인</label>{data?.accounts.map((item) => <label className="flex items-center justify-between gap-2 text-sm" key={item.id}><span className="flex items-center gap-2"><Checkbox checked={selected.includes(item.id)} onCheckedChange={(value) => setSelected((current) => value === true ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))} disabled={active} />{item.label}</span><Badge variant="outline">{item.status}</Badge></label>)}</div>
    <Button className="w-full" disabled={!providerReady || active || start.isPending || !target || (!anonymous && selected.length === 0)} onClick={() => start.mutate({ target, accounts: selected.join(","), anonymous })}><Play className="size-4" />Explorer 시작</Button>
    <p className="text-xs text-muted-foreground">선택: {anonymous ? "비로그인" : ""}{anonymous && selectedLabels.length ? " · " : ""}{selectedLabels.join(", ") || (!anonymous ? "없음" : "")}</p>
  </section>

  const inspector = <section className="space-y-4 p-3">
    <div><h2 className="text-sm font-semibold">Explorer 계정 추가</h2><p className="text-xs text-muted-foreground">ID·비밀번호·쿠키·토큰은 프로젝트 파일과 snapshot에 저장하지 않습니다.</p></div>
    <div className="space-y-2"><Label htmlFor="explorer-label">표시 이름</Label><Input id="explorer-label" value={account.label} onChange={(event) => setField("label", event.target.value)} /></div>
    <div className="grid grid-cols-2 gap-2"><div className="space-y-2"><Label htmlFor="explorer-role">권한</Label><select id="explorer-role" className="h-9 w-full border border-input bg-transparent px-2 text-sm" value={account.role} onChange={(event) => setField("role", event.target.value)}><option value="USER">USER</option><option value="LV1">LV1</option><option value="LV2">LV2</option><option value="ADMIN">ADMIN</option><option value="UNKNOWN">UNKNOWN</option></select></div><div className="space-y-2"><Label htmlFor="explorer-mode">로그인 방식</Label><select id="explorer-mode" className="h-9 w-full border border-input bg-transparent px-2 text-sm" value={account.loginMode} onChange={(event) => setField("loginMode", event.target.value)}><option value="AUTO_FORM">HTML form</option><option value="JSON">JSON API</option></select></div></div>
    <div className="space-y-2"><Label htmlFor="explorer-login-url">로그인 URL</Label><Input id="explorer-login-url" value={account.loginUrl} onChange={(event) => setField("loginUrl", event.target.value)} placeholder="https://target.example/login" /></div>
    <div className="space-y-2"><Label htmlFor="explorer-username">로그인 ID</Label><Input id="explorer-username" autoComplete="off" value={account.username} onChange={(event) => setField("username", event.target.value)} /></div>
    <div className="space-y-2"><Label htmlFor="explorer-password">비밀번호</Label><Input id="explorer-password" type="password" autoComplete="new-password" value={account.password} onChange={(event) => setField("password", event.target.value)} /></div>
    <Button type="button" variant="ghost" size="sm" onClick={() => setAdvanced((value) => !value)}>{advanced ? "고급 설정 닫기" : "필드·토큰 설정"}</Button>
    {advanced && <div className="space-y-3 border-l border-border pl-3"><Input aria-label="로그인 ID 필드명" placeholder="username 필드명 (선택)" value={account.usernameField} onChange={(event) => setField("usernameField", event.target.value)} /><Input aria-label="비밀번호 필드명" placeholder="password 필드명 (선택)" value={account.passwordField} onChange={(event) => setField("passwordField", event.target.value)} /><Input aria-label="토큰 JSON 경로" placeholder="token JSON 경로 예: token 또는 data.token" value={account.tokenJsonPath} onChange={(event) => setField("tokenJsonPath", event.target.value)} /><div className="grid grid-cols-2 gap-2"><Input aria-label="인증 헤더" placeholder="Authorization" value={account.authHeader} onChange={(event) => setField("authHeader", event.target.value)} /><Input aria-label="인증 접두사" placeholder="Bearer " value={account.authPrefix} onChange={(event) => setField("authPrefix", event.target.value)} /></div><Input aria-label="로그인 검증 URL" placeholder="검증 URL (선택)" value={account.validationUrl} onChange={(event) => setField("validationUrl", event.target.value)} /></div>}
    <Button variant="outline" className="w-full" disabled={saveAccount.isPending || active} onClick={() => saveAccount.mutate({ id: "", ...account }, { onSuccess: () => setAccount((current) => ({ ...current, label: "", username: "", password: "" })) })}><KeyRound className="size-4" />메모리에 계정 등록</Button>
    <div className="space-y-2">{data?.accounts.map((item) => <div key={item.id} className="flex items-center justify-between border p-2 text-sm"><div><p>{item.label}</p><p className="text-xs text-muted-foreground">{item.loginMode} · {item.status}</p></div><Button size="icon" variant="ghost" aria-label={`${item.label} 삭제`} disabled={active} onClick={() => deleteAccount.mutate(item.id)}><Trash2 className="size-4" /></Button></div>)}</div>
  </section>

  return <ReferenceAnalysisWorkspace ariaLabel="LLM Explorer 작업 영역" context={context} inspector={inspector}>
    <section className="flex min-h-full flex-col gap-4 p-4" aria-labelledby="explorer-title">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 id="explorer-title" className="flex items-center gap-2 text-2xl font-semibold"><Bot className="size-6 text-emerald-400" />LLM Explorer</h1><p className="text-sm text-muted-foreground">실제 HTTP 응답은 LLM Evidence로, 산출물에서 확인한 API·입력은 Evidence-bound 선언으로 분리 저장합니다.</p></div><div className="flex gap-2">{active ? <Button variant="destructive" onClick={() => control.mutate("cancel")}><CircleStop className="size-4" />중단</Button> : run && run.status !== "IDLE" ? <Button variant="outline" onClick={() => control.mutate("clear")}>실행 표시 지우기</Button> : null}</div></div>
      {failure && <Alert variant="destructive"><AlertTitle>Explorer 요청 실패</AlertTitle><AlertDescription>{message(failure)}</AlertDescription></Alert>}
      {run && !providerReady ? <Alert variant="destructive"><AlertTitle>Codex 준비가 필요합니다</AlertTitle><AlertDescription className="space-y-3"><p>{run.providerReadiness}</p><ol className="list-decimal space-y-1 pl-5"><li>공식 Codex CLI를 설치합니다.</li><li>Burp를 실행하는 같은 OS 사용자로 터미널에서 <code>codex</code>를 실행하고 ChatGPT 로그인을 완료합니다.</li><li>아래 버튼으로 준비 상태를 다시 확인합니다.</li></ol><p>Explorer만 시작할 수 없는 상태이며 HUMAN·ZAP 수집은 계속 사용할 수 있습니다.</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={control.isPending} onClick={() => control.mutate("recheck")}><RefreshCw className="size-4" />다시 확인</Button><Button asChild variant="outline" size="sm"><a href="https://learn.chatgpt.com/docs/codex/cli" target="_blank" rel="noreferrer">공식 설치 안내<ExternalLink className="size-4" /></a></Button></div></AlertDescription></Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card><CardHeader className="pb-2"><CardDescription>상태</CardDescription><CardTitle className="text-base">{run?.status ?? "불러오는 중"}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>소요 시간</CardDescription><CardTitle className="font-mono text-base">{formatElapsed(run?.elapsedMillis ?? 0)}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>HTTP 시도 / 응답</CardDescription><CardTitle className="text-base">{run?.attempts ?? 0} / {run?.responses ?? 0}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>선언 Endpoint / Parameter</CardDescription><CardTitle className="text-base">{run?.endpointDeclarations ?? 0} / {run?.parameterDeclarations ?? 0}</CardTitle></CardHeader></Card></div>
      <p className="text-xs text-muted-foreground">OPTIONS probe {run?.capabilityProbes ?? 0}건은 API 기능 관측 수와 분리됩니다. 완료 요약 수치는 FlowScope 서버가 계산합니다.</p>
      <Card className="flex min-h-[28rem] flex-1 flex-col overflow-hidden"><CardHeader className="border-b"><div className="flex items-center justify-between gap-3"><div><CardTitle>작업 피드</CardTitle><CardDescription>{run?.message ?? "Explorer 상태를 불러오는 중입니다."}</CardDescription></div><Badge variant={run?.providerReadiness === "READY" ? "outline" : "destructive"}>Codex {run?.providerReadiness ?? "확인 중"}</Badge></div></CardHeader><CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-0"><div className="flex-1 space-y-3 overflow-y-auto p-4">{run?.activities.length ? run.activities.map((item) => <article className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-border/60 pb-3" key={item.sequence}><Badge variant="outline" className="h-fit">{item.kind}</Badge><div className="min-w-0"><div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{item.title}</p><span className="font-mono text-xs text-muted-foreground">{item.durationMillis == null ? item.status : `${item.status} · ${item.durationMillis}ms`}</span></div><p className="break-all text-sm text-muted-foreground">{item.detail}</p></div></article>) : <div className="grid min-h-72 place-items-center text-center text-sm text-muted-foreground"><div><Bot className="mx-auto mb-3 size-8" /><p>실행하면 인증 준비·HTTP 요청·Evidence ID가 여기에 순서대로 표시됩니다.</p></div></div>}</div>{run?.unresolved.length ? <div className="border-t border-amber-400/30 bg-amber-400/5 p-3 text-sm"><p className="mb-2 font-medium text-amber-300">미해결 {run.unresolved.length}건</p>{run.unresolved.map((item, index) => <p className="break-all text-muted-foreground" key={`${item.kind}-${index}`}>{item.kind} · {item.target} · {item.reason}</p>)}</div> : null}<form className="flex gap-2 border-t p-3" onSubmit={(event) => { event.preventDefault(); if (!operatorMessage.trim()) return; steer.mutate(operatorMessage, { onSuccess: () => setOperatorMessage("") }) }}><Input aria-label="Explorer에게 추가 지시" value={operatorMessage} onChange={(event) => setOperatorMessage(event.target.value)} placeholder="실행 중 추가할 사실 기반 지시" disabled={run?.status !== "RUNNING"} /><Button type="submit" size="icon" aria-label="메시지 전송" disabled={run?.status !== "RUNNING" || !operatorMessage.trim()}><Send className="size-4" /></Button></form></CardContent></Card>
    </section>
  </ReferenceAnalysisWorkspace>
}
