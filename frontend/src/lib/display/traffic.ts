/** 트래픽 분류·판정 이유의 화면 문구. 서버 코드는 바꾸지 않고, 모르는 코드는 그대로 보여 준다. */
export const trafficClassLabels: Record<string, string> = {
  API: "API",
  AUTH_SESSION: "인증·세션 준비",
  UNKNOWN: "판단 보류",
  TELEMETRY_CANDIDATE: "텔레메트리 후보",
  POLLING: "반복 조회",
  BACKGROUND: "반복 백그라운드",
  NAVIGATION: "화면 이동",
  STATIC_ASSET: "정적 자원",
  DISCOVERY_METADATA: "탐색 메타데이터",
  PREFLIGHT: "CORS 사전 요청",
}

const reasonLabels: Record<string, string> = {
  REPEATED_STABLE_OBSERVATION: "같은 응답이 반복됨 · 주기 조회로 보임",
  TELEMETRY_PATH_IS_NOT_PROOF: "로그·텔레메트리 전송 경로로 보임",
  AUTHORIZATION_RESPONSE_ONLY: "401/403 응답만 있고 API 근거가 없음",
  AMBIGUOUS_KEEP: "API인지 판단할 근거가 부족함",
  OBJECT_SIGNAL: "객체 ID가 보임",
  STATE_CHANGING_METHOD: "상태를 바꾸는 요청",
  AUTHORIZATION_RESPONSE: "401/403 권한 응답",
  LOGIN_REDIRECT: "로그인으로 이동하는 응답",
  API_MEDIA_TYPE: "JSON 등 API 응답 형식",
  FETCH_API_CONTEXT: "브라우저 fetch 요청",
  API_EVIDENCE: "API 근거",
  SESSION_SETUP: "로그인·세션 준비 요청",
  DOCUMENT_NAVIGATION: "페이지 이동",
  USER_REVIEW: "사용자가 검토 필요로 표시",
  USER_INCLUDE: "사용자가 메인 비교에 포함",
  USER_EXCLUDE: "사용자가 제외",
}

export function trafficClassLabel(value: string): string { return trafficClassLabels[value] ?? value }
export function trafficReasonLabel(value: string): string { return reasonLabels[value] ?? value }
