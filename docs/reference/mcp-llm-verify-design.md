# MCP 기반 LLM 취약점 추천 연동 설계 (검토용)

작성일: 2026-10-10. 브랜치 `FEAT_mcp_llm_verify` (origin/v1.0.2 기준). **검토용이며, 승인 전에는 구현을 시작하지 않는다.**

## 1. 목표

점검이 끝난 뒤, 사용자가 구독한 LLM(Codex/Claude 등)이 FlowScope의 점검 결과를 근거로
IDOR·BOLA·BFLA를 **직접 다시 테스트**하고, 결과를 해석해 **취약점 추천**과 **보고서**를 만든다.

- LLM 결과는 **확정이 아니라 추천이다.** 판정 매트릭스는 관측한 기록만 보고 정적 규칙으로 판단하므로 한계가 있다. LLM은 실제 재전송 응답을 읽어 그 빈틈을 보완하는 소견을 낸다. 최종 확정은 사람이 기존 검토 기능(`/api/review`)으로 한다.
- 직접 테스트는 **GET만** 실행한다. 쓰기(POST/PUT/PATCH/DELETE)는 자동 실행하지 않는다.
- **자동 실행 아님.** 매트릭스를 열거나 탭을 전환하는 것만으로 요청이 나가면 안 된다. 사람이 명시적으로 실행 버튼을 눌러야 그때 재전송이 돈다.

## 2. 테스트 방향 정의 (중요)

추천 `USER 1 → USER 2`의 해석:
- **보내는 계정(`testIdentity`) = USER 1**: 이 계정의 **세션(인증값)**으로 요청을 보낸다.
- **근거 자원 주인(`basisIdentity`) = USER 2**: USER 2가 원래 가진 자원/데이터에 접근을 시도한다.
- 즉 "USER 1의 로그인 상태로 남인 USER 2의 데이터를 볼 수 있나"를 테스트한다(IDOR의 정의).
- **따라서 로그인이 필요한 계정은 보내는 계정(USER 1)이다.**

## 3. 설계 원칙

1. **예전 MCP 코드는 되살리지 않는다.** 예전 `McpServer.java`(1,957줄)는 이미 제거된 흐름(데이터셋 잠금, 탐색 시야 격리, LLM Judge 판정 제출, MCP에서 ZAP 실행)에 묶여 있고, 그 뒤 신원 판단(#89)·판정 객체 키(#118)·세션·Request Lab이 모두 바뀌었다. 보안 설계(localhost 전용, Host/Origin 검사, 토큰 인증)만 참고하고 코드는 v1.0.2 위에 새로 짠다.
2. **기존 기능 위에 얇게 얹는다.** 각 MCP 도구는 v1.0.2에 이미 있는 경로를 호출하는 연결 계층이다. 새 판정 로직·새 전송 경로를 만들지 않는다.
3. **기존 매트릭스는 그대로 둔다.** LLM 기능은 별도 보기(탭)로 얹고, 기존 화면/판정은 건드리지 않는다.
4. **판정 권위는 규칙 엔진·서버 Evidence gate에 둔다.** LLM이 판정을 확정하거나 Evidence를 승격하지 못한다(기존 원칙 유지).

## 4. 재사용하는 기존 자산 (v1.0.2에서 확인)

- **localhost HTTP + 인증**: `FlowScopeWebServer.handle()`가 loopback 검사·Host 검사·capability 토큰(`authorized()`)을 이미 수행한다. MCP도 같은 경계를 쓴다.
- **테스트 추천**: `/api/snapshot`의 `authorizationMatrix`에 `TestRecommendation`(type, basisIdentity, testIdentity, reason, instruction, stateChanging, basisEvidenceIds)이 이미 들어 있다. → "무엇을 테스트할지"의 입력.
- **계정 세션 재전송**: `prepareHumanRequest(...)` + `executeHumanRequestLab(...)`.
  - ACCOUNT 모드: 관리 인증 헤더(`SessionBroker.managedHeaderNames()`)를 모두 지우고 `headersForAccount(...)`로 그 계정 세션값만 주입. **LLM은 토큰을 보지 않는다.**
  - `prepareHumanRequest`가 `scope.allows(url)`로 exact scope 밖 요청을 거부.
  - 결과는 `source=HUMAN, phase=VALIDATION, executionTrust=CONTROLLED, originEvidenceId=근거기록`으로 저장. `TrafficClassifier`가 VALIDATION을 `NON_DISCOVERY_PHASE`로 분류해 재전송 결과가 커버리지·판정 입력을 오염시키지 않음.
- **로그인(세션 확보)**: 계정·세션의 점검 시작 흐름(`ChromiumLoginBrowser`) 그대로. "로그인 완료"를 누르면 `SessionBroker.settle()`이 세션을 `ACTIVE`로 확정.
- **세션 생명주기(확인됨)**: 세션값은 크로미움 창이 아니라 `SessionBroker.ManagedSession`에 저장된다. `ACTIVE` 확정 뒤에는 창을 닫아도 세션이 유지되고 재전송에 쓸 수 있다. 세션이 사라지는 건 `sessionBroker.close()`(확장 unload·프로젝트 교체) 때이지 창 닫힘이 아니다. 단, "완료"를 누르기 전에 창을 닫으면 `ACTIVE`가 안 돼 재전송이 `REAUTH_REQUIRED`로 실패한다.
- **세션 상태**: `SessionBroker.Status`가 `ACTIVE`가 아니면 재전송이 명확한 예외로 실패. Burp 재시작/프로젝트 재개 후에는 재로그인 필요.
- **사람 검토**: `/api/review`, `reviewValidation(...)`이 수동 검증 결과를 판정 칸에 첨부하는 경로를 이미 가짐.

## 5. 화면 설계

### 5.1 보기 전환 (A안)

판정 매트릭스 우상단에 `기존 | LLM` 전환을 둔다.
- **기존**: 지금 쓰는 매트릭스 그대로. 변경 없음.
- **LLM**: 기존 매트릭스와 **같은 표**를 재사용. 행=API, 열=계정. GET 추천만 LLM 재전송 결과로 채우고, GET이 아닌 칸은 "자동 실행 안 함"으로 표시.

### 5.2 계정 열 머리의 "LLM 테스트" 버튼

각 계정 열 머리에 "LLM 테스트" 버튼. 그 열은 "이 계정 세션으로 보낸 결과"다.
누르면:
1. **사람**: 그 계정 로그인 창이 열림(점검 시작과 같은 크로미움 창).
2. **사람**: 로그인 후 "로그인 완료"를 누름 → 세션 `ACTIVE`. **완료 뒤에는 창을 닫아도 됨**(안내 문구로 명시). 완료 전 닫으면 안 됨.
3. **LLM**: 실행 직전 세션이 `ACTIVE`인지 재확인(아니면 "로그인이 완료되지 않았습니다"로 중단). 그 계정이 보내는 GET 추천만 Request Lab으로 실행, 결과를 그 열에 채움.

세션이 없는 계정의 열 머리에는 "세션 없음 · 로그인 필요"로 표시.

### 5.3 LLM 결과 표시 — 칸에 바로

LLM 탭에서는 **매트릭스 칸(노드) 자체에 LLM 테스트 결과를 바로 표시**한다. 칸을 눌러 상세를 열지 않아도 보인다. 칸에 넣는 것:
- LLM 판단 (예: "IDOR 의심", "정상") — 로봇 표시로 LLM 결과임을 구분.
- 재전송 결과 요약 (예: "USER 2 주문 반환 · HTTP 200", "차단됨 · HTTP 403").

칸에 넣지 않는 것:
- 요청 기록 `#번호`("근거" 표현)는 칸에서 쓰지 않는다. `#번호`는 상세 패널의 "요청·응답 확인"에 이미 있다.
- 확신도·긴 해석 문장도 칸에 넣지 않는다(칸이 복잡해지지 않게).

**확정/기각은 기존 상세 패널 그대로.** 칸을 누르면 기존 `JudgmentDetail`이 열리고, "취약점 확인"(`/api/review`)으로 확정/기각한다. 상세 패널에는 별도 "LLM 소견" 섹션을 추가하지 않는다(5.3 이전 안 폐기).

재전송의 **객관적 사실**(상태코드·반환 본문)은 기존 "요청·응답 확인"과 매트릭스 칸에 그대로 반영된다(지금 코드가 함).

## 6. MCP 도구 (초안, 전부 읽기/GET 범위)

localhost 전용 Streamable HTTP(JSON-RPC), capability 토큰 필요. 모델 제공자 토큰은 취급하지 않는다.

| 도구 | 하는 일 | 뒷단 |
|---|---|---|
| `flowscope_get_status` | 점검 완료 여부, 범위, 계정·역할·세션 상태 요약(인증값 제외) | snapshot + SessionBroker view |
| `flowscope_list_recommendations` | 테스트 추천 목록(기준 계정·보내는 계정·근거 기록·사유·stateChanging) | snapshot `authorizationMatrix` |
| `flowscope_get_evidence` | 근거 기록 원문(요청/응답)과 메타(계정·op·resource·상태) | `/api/evidence`, request-lab draft |
| `flowscope_cross_send_get` | 기록을 **보내는 계정(testIdentity)으로 GET 재전송**. method가 GET이 아니면 거부. 새 기록 번호와 응답 요약 반환 | `executeHumanRequestLab`(ACCOUNT, GET only) |
| `flowscope_submit_finding` | LLM 소견(추천) 제출 — 대상 칸·근거 기록·확신도·설명. 판정은 안 바꾸고 소견으로만 저장 | 신규 소견 저장소(별도) |

### 도구 경계
- `flowscope_cross_send_get`: 서버에서 `method == GET`을 다시 확인(프런트 신뢰 안 함). 보내는 계정 세션이 `ACTIVE`가 아니면 거부. scope 검사는 `prepareHumanRequest`가 이미 함. **호출 횟수 상한은 두지 않는다**(결정). 안전장치는 GET 한정·exact scope·ACTIVE 세션·기존 `MAX_RECORDS`로 충분하다고 본다.
- `flowscope_submit_finding`: `verdict`가 아니라 `advisory`로 저장. 매트릭스 판정과 섞지 않음. **프로젝트 파일(SQLite)에 영속 저장**(결정)하여 프로젝트를 다시 열어도 유지된다.

## 7. 실행 흐름 요약

1. 점검 완료(사람·스캐너·LLM 탐색까지) → 매트릭스에 테스트 추천 생성됨.
2. 매트릭스 `LLM` 탭 선택(기존은 그대로).
3. 보내는 계정 열 머리의 "LLM 테스트" → 사람 로그인 → "로그인 완료".
4. LLM이 그 계정이 보내는 **GET 추천만** Request Lab으로 재전송(쓰기는 "자동 실행 안 함").
5. 재전송 결과는 기록 `#번호`로 남고 판정 엔진 재계산 → 매트릭스/요청·응답 확인에 반영.
6. LLM이 결과를 해석해 상세 패널 "LLM 소견"에 근거와 함께 제출.
7. 사람이 소견을 보고 확정/기각.
8. (후속) 보고서 출력.

## 8. 범위 밖 (후속)

- 쓰기 요청 자동 실행 — 사용자 승인 흐름을 붙인 뒤에만.
- Playwright 기반 재로그인·화면 흐름(CSRF 등).
- MCP에서 ZAP/스캐너 실행.
- 보고서 출력 형식(화면/Markdown) — 2차.

## 9. 확정된 결정 (2026-10-10)

1. **MCP 전송**: 별도 포트를 만들지 않고 **기존 17777 웹 서버에 `/mcp` 엔드포인트를 추가**한다. loopback·Host·토큰 보안 경계를 그대로 재사용한다.
2. **LLM 소견/결과 저장**: **프로젝트 파일(SQLite)에 영속 저장**한다. 프로젝트를 다시 열어도 유지.
3. **호출 횟수 상한**: 두지 않는다. GET 한정·exact scope·ACTIVE 세션·기존 레코드 상한으로 보호.
4. **보고서 출력**: 보류. 이번 구현 범위에서 제외하고 추후 결정.

## 10. 검증 방법 (구현 시)

- 보안 회귀(예전 `McpServerTest` 항목을 체크리스트로만 사용, 코드 복사 안 함): 잘못된 Host·Origin·토큰 누락·과대 요청 거부, GET 외 메서드 거부, scope 밖 거부, 비ACTIVE 세션 거부.
- 재전송 결과가 커버리지·판정 입력을 오염시키지 않는지(VALIDATION 분류 유지) 회귀.
- 프런트 타입체크·관련 단위 테스트.
- 실제 crAPI 수동 gate(새 JAR 로드 후). 전체 JAR·mvn 전체 검증은 사용자 요청 시에만.
