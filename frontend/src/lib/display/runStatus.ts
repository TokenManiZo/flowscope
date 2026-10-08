/** 실행 상태(HUMAN·ZAP·LLM·lane)의 서버 값을 화면용 한국어로 바꾼다. 원래 값은 호출부가 title로 남긴다. */
const labels: Record<string, string> = {
  NOT_STARTED: "대기", IDLE: "대기", PENDING: "대기", QUEUED: "대기열",
  STARTING: "시작 중", AUTHENTICATING: "로그인 중", RUNNING: "진행 중",
  COMPLETED: "완료", DONE: "완료", COMPLETED_WITH_LIMITATIONS: "완료 (제한 있음)",
  FAILED: "실패", FAILED_CLEANUP: "정리 실패", ERROR: "오류", CANCELLED: "취소됨",
  UNAVAILABLE: "연결 안 됨", READY: "준비됨", CONNECTED: "연결됨",
}

export type RunStatusTone = "idle" | "active" | "done" | "fail"

const tones: Record<string, RunStatusTone> = {
  STARTING: "active", AUTHENTICATING: "active", RUNNING: "active",
  COMPLETED: "done", DONE: "done", COMPLETED_WITH_LIMITATIONS: "done", READY: "done", CONNECTED: "done",
  FAILED: "fail", FAILED_CLEANUP: "fail", ERROR: "fail",
}

/** 모르는 값은 그대로 보여 준다(서버가 새 상태를 추가해도 숨기지 않는다). */
export function runStatusLabel(status: string): string {
  return labels[status.trim().toUpperCase()] ?? status
}

export function runStatusTone(status: string): RunStatusTone {
  return tones[status.trim().toUpperCase()] ?? "idle"
}

const stages: Record<string, string> = {
  INITIALIZING: "준비 중",
  SESSION_SETUP: "격리 세션 설정",
  API_DEFINITION_IMPORT: "API 정의 가져오기",
  AUTHENTICATION: "ZAP 브라우저 로그인",
  CLIENT_SPIDER: "Client Spider",
  SPIDER: "일반 Spider",
  PASSIVE_SCAN_QUEUE: "Passive Scan 대기",
  ALERTS_READY: "Alert 집계 완료",
  SESSION_READY: "로그인 세션 준비 완료",
  CLEANUP: "종료 처리 · 임시 상태 정리 중",
  CANCELLED: "검사 취소",
  FAILED: "실패",
}

/** ZAP 단계 이름. 값이 없으면 "대기". */
export function scannerStageLabel(stage?: string): string {
  return stages[stage ?? ""] ?? stage ?? "대기"
}

export function durationLabel(seconds?: number): string {
  if (seconds === undefined || seconds < 0) return "확인 전"
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes > 0 ? `${minutes}분 ${remainder}초` : `${remainder}초`
}

/** 실행 ID 앞부분으로 도구를 고른다. 서버가 쓰는 접두어: zap-, llm-explorer-, human-, (live-)authorization-replay-, live-<source>, proxy-history-<source>, project-import. */
const runKinds: ReadonlyArray<readonly [RegExp, string]> = [
  [/^zap-/i, "ZAP 실행"],
  [/^(live-)?authorization-replay-/i, "자동 검증"],
  [/^(llm-|live-llm$|proxy-history-llm$)/i, "LLM 실행"],
  [/^(live-scanner$|proxy-history-scanner$)/i, "스캐너 실행"],
  [/^(human-|live-human$|proxy-history-human$)/i, "수집"],
  [/^project-import$/i, "가져오기"],
]
const sourceRunKinds: Record<string, string> = { HUMAN: "수집", SCANNER: "스캐너 실행", LLM: "LLM 실행" }

const pad = (value: number) => String(value).padStart(2, "0")

/** 긴 실행 ID 대신 "ZAP 실행 · 10/07 14:32"처럼 도구와 시작 시각으로 보여 준다. 시각을 모르면 도구만 쓴다. */
export function runLabel(runId: string, source?: string, startedAt?: number): string {
  const kind = runKinds.find(([pattern]) => pattern.test(runId))?.[1] ?? sourceRunKinds[source?.toUpperCase() ?? ""] ?? "실행"
  const at = startedAt && startedAt > 0 ? startedAt : Number(runId.match(/(?:^|-)(\d{13})(?=-|$)/)?.[1] ?? 0)
  if (!(at > 0)) return kind
  const time = new Date(at)
  return `${kind} · ${pad(time.getMonth() + 1)}/${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`
}
