import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { InfoHint } from "@/components/ui/info-hint"
import {
  getLiveAuthorizationReplay,
  startAutomaticAnonymousGet,
  stopLiveAuthorizationReplay,
} from "@/lib/api/endpoints"

const QUERY_KEY = ["live-authorization-replay"] as const


export function AnonymousAutoVerification() {
  const client = useQueryClient()
  const status = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => getLiveAuthorizationReplay(signal),
    retry: false,
    refetchInterval: (query) => query.state.data?.live.state === "ACTIVE" ? 1_500 : false,
  })
  const change = useMutation({
    mutationFn: (enabled: boolean) => enabled
      ? startAutomaticAnonymousGet()
      : stopLiveAuthorizationReplay(),
    onSuccess: (next) => client.setQueryData(QUERY_KEY, next),
  })
  const live = status.data?.live
  const enabled = Boolean(live?.automaticAnonymousGet && live.state !== "STOPPED")
  const anotherRun = Boolean(live && live.state !== "STOPPED" && !live.automaticAnonymousGet)
  const error = change.error ?? status.error
  // Skipped includes requests excluded before queueing as well as queued requests that could not run.
  const skippedAfterQueue = live ? Math.max(0, live.skipped - (live.observed - live.eligible)) : 0
  const pending = live ? Math.max(0, live.queued - live.sent - live.drafted - skippedAfterQueue) : 0

  return <section aria-label="비로그인 자동 검증" className="space-y-3 rounded-xl border border-border p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold">비로그인 자동 검증</h2>
        <p className="mt-1 text-xs text-muted-foreground">계정에서 방문한 GET API를 비로그인으로 확인하고, 응답을 그래프에 기록합니다.</p>
      </div>
      <Button
        type="button"
        role="switch"
        aria-label="비로그인 자동 검증"
        aria-checked={enabled}
        variant="ghost"
        className="h-auto gap-2 px-0 py-1 hover:bg-transparent"
        disabled={status.isLoading || change.isPending || anotherRun}
        onClick={() => change.mutate(!enabled)}
      >
        <span className="text-sm font-normal">{change.isPending ? "적용 중…" : enabled ? "켜짐" : "꺼짐"}</span>
        <span aria-hidden="true" className={`relative block h-5 w-9 shrink-0 rounded-full border transition-colors ${enabled ? "border-primary bg-primary" : "border-input bg-muted"}`}>
          <span className={`absolute top-0.5 left-0.5 block size-3.5 rounded-full bg-background shadow-sm transition-transform ${enabled ? "translate-x-4" : "translate-x-0"}`} />
        </span>
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">A·B가 같은 URL과 쿼리를 방문하면 실행 중 한 번만 검증합니다. 켠 뒤에 발생한 요청부터 적용됩니다.</p>
    {anotherRun && <Alert><AlertDescription>다른 라이브 권한 검증이 실행 중입니다. 해당 실행을 중지한 뒤 사용할 수 있습니다.</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error instanceof Error ? error.message : "자동 검증 상태를 변경하지 못했습니다."}</AlertDescription></Alert>}
    {enabled && live && <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs tabular-nums">
      <div className="flex items-center gap-2"><dt className="flex items-center gap-1 text-muted-foreground">비로그인 응답<InfoHint label="비로그인 응답">로그인 없이 보낸 요청에서 받은 응답 수예요.</InfoHint></dt><dd className="font-medium">{live.sent}건</dd></div>
      <div className="flex items-center gap-2"><dt className="flex items-center gap-1 text-muted-foreground">대기<InfoHint label="대기">아직 보내지 않고 기다리는 요청 수예요.</InfoHint></dt><dd className="font-medium">{pending}건</dd></div>
      <div className="flex items-center gap-2"><dt className="flex items-center gap-1 text-muted-foreground">실패<InfoHint label="실패">요청을 보내지 못했거나 응답을 받지 못한 수예요.</InfoHint></dt><dd className="font-medium">{live.failed}건</dd></div>
    </dl>}
  </section>
}
