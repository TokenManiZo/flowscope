import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  getLiveAuthorizationReplay,
  startAutomaticAnonymousGet,
  stopLiveAuthorizationReplay,
} from "@/lib/api/endpoints"

const QUERY_KEY = ["live-authorization-replay"] as const
const REASON_LABELS: Readonly<Record<string, string>> = {
  NOT_INCLUDED_API_EVIDENCE: "API로 분류되지 않은 요청",
  AUTOMATIC_ANONYMOUS_GET_ONLY: "GET이 아닌 요청",
  ANONYMOUS_REQUEST_KEY_UNAVAILABLE: "중복 판별 키를 만들 수 없는 요청",
  INVALID_EVIDENCE_TARGET: "재요청 대상을 만들 수 없는 요청",
  RAW_REQUEST_NOT_AVAILABLE: "원문 요청이 메모리에 없는 요청",
  INCOMPLETE_BASIS_EVIDENCE: "분석이 완료되지 않은 요청",
  NO_OTHER_SELECTED_IDENTITY: "이미 비로그인인 요청",
  ALREADY_ANONYMOUS_BASIS: "원래부터 비로그인인 요청",
  METHOD_NOT_SUPPORTED: "지원하지 않는 HTTP 메서드",
  SESSION_OR_SCOPE_INELIGIBLE: "현재 정확한 점검 범위 밖의 요청",
  CONTROLLED_SEND_FAILED: "비로그인 요청 전송 실패",
  REPLAY_BASIS_UNAVAILABLE: "수집 직후 기준 요청을 찾지 못함",
  REPLAY_REQUEST_EXPIRED: "전송 전에 원문 요청이 메모리에서 만료됨",
  REPLAY_REQUEST_PREPARATION_FAILED: "비로그인 요청 생성 실패",
  REPLAY_METHOD_NOT_SAFE: "안전 전송 대상이 아닌 메서드",
  REPLAY_TARGET_MISMATCH: "수집 요청과 재전송 대상이 일치하지 않음",
  HTTP_SEND_FAILED: "대상 연결 또는 HTTP 전송 실패",
  HTTP_NO_RESPONSE: "대상에서 HTTP 응답을 받지 못함",
  EVIDENCE_RECORDING_FAILED: "응답 수신 후 Evidence 기록 실패",
  BATCH_FAILED: "자동 검증 처리 실패",
}

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

  return <section aria-label="비로그인 자동 검증" className="space-y-3 rounded-xl border border-border p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold">비로그인 자동 검증</h2>
        <p className="mt-1 text-xs text-muted-foreground">계정에서 방문한 GET API를 비로그인으로도 확인하고 그래프에 기록합니다.</p>
      </div>
      <Button
        type="button"
        role="switch"
        aria-label="비로그인 자동 검증"
        aria-checked={enabled}
        variant="outline"
        className="gap-2"
        disabled={status.isLoading || change.isPending || anotherRun}
        onClick={() => change.mutate(!enabled)}
      >
        <span className="text-sm font-normal">{change.isPending ? "적용 중…" : enabled ? "켜짐" : "꺼짐"}</span>
        <span aria-hidden="true" className={`relative block h-5 w-9 shrink-0 rounded-full border transition-colors ${enabled ? "border-brand bg-brand" : "border-input bg-muted"}`}>
          <span className={`absolute top-0.5 left-0.5 block size-3.5 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-4" : "translate-x-0"}`} />
        </span>
      </Button>
    </div>

    {anotherRun && <Alert><AlertDescription>다른 라이브 권한 검증이 실행 중입니다. 해당 실행을 중지한 뒤 사용할 수 있습니다.</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertDescription>{error instanceof Error ? error.message : "자동 검증 상태를 변경하지 못했습니다."}</AlertDescription></Alert>}
    {enabled && live && <div className="space-y-3">
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm" aria-label="자동 검증 요약">{[["응답", live.sent], ["대기", Math.max(0, live.queued - live.sent - live.failed)], ["실패", live.failed]].map(([label, count]) => <div key={label} className="flex items-center gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{count}건</dd></div>)}</dl>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-1 hover:text-foreground">검증 상세</summary><div className="space-y-2 pt-2"><p>관측 {live.observed}건 · 대상 {live.eligible}건 · 전송 예약 {live.queued}건 · 비로그인 응답 {live.sent}건 · 제외 {Math.max(0, live.skipped - live.failed)}건 · 실패 {live.failed}건</p>{live.skipped > 0 && REASON_LABELS[live.lastReason] && <p>최근 제외/실패 사유: {REASON_LABELS[live.lastReason]}</p>}<p>켜진 뒤의 요청부터 적용됩니다. 같은 URL과 쿼리는 한 번만 확인합니다.</p></div></details>
    </div>}

  </section>
}
