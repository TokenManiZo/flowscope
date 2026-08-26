# FlowScope 1.2.0-beta.3 사전 벤치마크 검증 기록

최초 검증일은 2026-08-25, 최신 자동 재검증일은 2026-08-26이다. 이 문서는 벤치마크에 들어가기 전까지 구현한 범위와 실제 확인한 범위를 분리해 기록한다. crAPI의 알려진 취약점 목록·정답·공격 절차는 열거나 코드와 프롬프트에 주입하지 않았다.

## 자동 검증 통과

| 구분 | 결과 |
|---|---|
| 자동 회귀 | JDK 21.0.12, Java `--release 21`로 `mvn clean verify`, 147 tests, 실패·오류·skip 0 |
| 배포물 | `target/flowscope-1.2.0-beta.3.jar`, 2,826,076 bytes, SHA-256 `e8d41fbdea56101063d59ec27b378de5ee9a06d001c516122eeac8c0446b4cae` |
| JAR 무결성 | ZIP 무결성 통과, 1,298 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, Java 21 |
| 배포 계약 | 공개 `target/*.jar` 정확히 1개, 반복 package 크기·SHA-256 동일, Montoya 미포함, FlowScope/Jackson/Cytoscape 고지와 Web 자산 포함, 개발 머신 절대경로·제품 코드의 리터럴 비밀값 없음 |
| Session Broker | successful response 전 `UNVERIFIED`, 같은-service 동시 캡처 거부, 계정별 Cookie·Authorization·CSRF 주입, 회전·삭제·scope·expiry, `SUSPECT` 차단, revoke/clear 메모리 제거 |
| 실행 신뢰도 | `CONTROLLED`, `OBSERVED`, `UNVERIFIED_RUNTIME`, `IMPORTED`, `UNKNOWN` 구분과 최종 판정 gate 검증 |
| LLM Explorer | 실행 중 다른 lane·후보·gap·finding 격리, exact-scope controlled request, run `account_id`의 executor 전달, 쓰기 확인, broker 소유 헤더와 CR/LF 거부 |
| Dataset lock | HUMAN·SCANNER·LLM의 성공한 response-bearing exploration을 요구하고 빈 lane·active run·scope 변경 거부 |
| LLM Judge | lock 이후 후보/오라클 고정, 실제 validation Evidence 추가, 저장 후 복원 시 pre-Judge snapshot 재구성, 서버 권위 verdict 검증 |
| ZAP campaign | 비로그인 → USER A → USER B 순서, 신원별 `core/newSession`, account context 전환, Traditional Spider → Client Spider → AJAX fallback → passive queue drain → native alerts, zero-capture/실패 gate와 alert 마스킹 검증 |
| Web scanner guard | 비로그인·복수 ACTIVE 계정 form contract, 신원별 상태 JSON, 현재 FlowScope Web loopback port의 target 목록 제외와 시작 거부 검증 |
| 프로젝트 | raw session 미저장, 명시적 완료 lane 저장, 중단된 기록으로 완료 상태를 추론하지 않음 |
| Traffic classification | `INCLUDE`만 main coverage, `REVIEW` 검토 대기, `EXCLUDE` 기본 숨김으로 상호 배타 집계, operation override, no Evidence deletion, classifier version persistence |
| Identity 안정화 | `ANONYMOUS/ACCOUNT_BOUND/UNRESOLVED`, 1,000 rotating cookies의 graph identity 폭증 방지, 명시 binding 보존 |
| Capture scope | HUMAN 브라우저의 범위 밖 이동은 허용하되 모든 source의 저장 Evidence는 현재 exact scope로 제한 |
| HUMAN run 경계 | 로그인 캡처 `SESSION_SETUP`·pass 밖 `BASELINE`은 Evidence로 보존하되 coverage에서 제외하고, 명시적 `EXPLORATION` pass만 HUMAN 3-way 비교에 포함 |
| 요청 시점 provenance | Proxy `messageId`로 request-time run/account 문맥을 응답까지 고정, HUMAN 선택 계정 exact credential match, SYSTEM anonymous Cookie의 `anon` 유지 |
| Authorization oracle | owner는 성공한 2xx 비메타데이터 응답에서만 확정, login redirect는 완전한 경로 세그먼트, BOLA read는 대상 객체 ID가 있는 응답만 객체 Evidence로 인정 |

## UI 검증 통과

새 beta.3 산출물의 standalone Web UI로 다음을 확인했다.

- 1500×900, 900×700, 600×800 viewport에서 quick-start, 계정 관리, matrix가 수평으로 잘리거나 주요 조작을 숨기지 않았다.
- 작은 화면에서는 modal이 세로 스크롤되고 계정 카드와 표가 화면 폭에 맞게 재배치된다.
- matrix cell에서 해당 API의 Evidence 목록과 마스킹된 Request/Response를 필요할 때 펼칠 수 있다.
- 브라우저 콘솔 오류는 0건이었다.
- 현재 분류 UI를 1024×768에서 추가 검증했다. page horizontal overflow와 ellipsis 잘림은 0건이었고, 여섯 mode 전환, quick-start, 파싱 행의 stable Evidence ID→operation 상세, classification/repeat 표시와 override 조작이 동작했다.
- 현재 source palette를 1280×720에서 추가 검증했다. HUMAN 파랑·실선, SCANNER 빨강·파선, LLM 검정·점선과 H/S/L 노드 표기가 범례·그래프에 일치했고, body 가로·세로 overflow와 클라이언트 오류는 0건이었다.
- `INCLUDE/REVIEW/EXCLUDE` 처분 필터를 1280×720 standalone에서 확인했다. 파싱 결과 10행에서 REVIEW 해제 시 9행, INCLUDE까지 해제 시 0행, REVIEW만 선택 시 1행이었고 해당 상세에 검토 상태와 `분석에 포함` override가 표시됐다. page overflow와 console error는 0이었다.
- 실제 0-Evidence 입력으로 1280×720 standalone 빈 상태를 확인했다. 분석 rail·stage·detail은 숨겨지고 네 단계와 빠른 시작·샘플 조작만 보였으며, quick-start 모달이 열리고 샘플 뒤 기존 분석 화면으로 전환됐다. body overflow와 console error는 0이었다.

Standalone UI는 레이아웃과 클라이언트 동작 검증이다. Burp Community의 실제 suite tab 동작을 대신하지 않는다.

신원별 scanner control은 1280×720과 600×800 standalone에서 비로그인 선택 상태를 실제 렌더했다. 두 폭에서 page horizontal overflow 0, modal horizontal overflow 0, 좁은 폭 modal vertical scroll 가능, 신원 미선택·대상 미선택 실행 버튼 비활성, 브라우저 warning/error 0을 확인했다. Standalone fixture에는 ACTIVE broker 계정이 없어 USER A/B 복수 chip 렌더는 HTML/API 계약 테스트 통과로만 기록하며 Burp 결과로 소급하지 않는다.

## 실제 사용자 확인

- Burp Community 2026.7.3에서 현재 beta.3 fat JAR을 로드했다. FlowScope suite tab과 Web `127.0.0.1:17777`, MCP `127.0.0.1:8787`, HUMAN `8080`, SCANNER `8081` listener가 동시에 기동했고 Web·crAPI root가 HTTP 200을 반환했다.
- exact scope `http://127.0.0.1:8888/`에서 anonymous HUMAN exploration으로 `/`와 `/favicon.ico` 2건을 먼저 수집했다. 두 건 모두 `HUMAN/BROWSER/qa-human-anon-1`로 기록됐지만 `REVIEW`라 메인 coverage에는 들어가지 않았고 dataset lock은 `completed lanes need captured exploration responses before lock: [HUMAN]`으로 거부됐다. 두 번째 HUMAN run에서 `API/INCLUDE`인 `/manifest.json` 1건을 추가한 뒤에만 잠금 조건을 충족했다.
- ZAP 2.17 SYSTEM anonymous baseline은 5초 내 `COMPLETED/ALERTS_READY`, FlowScope 수집 8건, native alert 22건으로 끝났다. 8건 모두 같은 run의 `SCANNER/CONTROLLED/ANONYMOUS`였고, 정적 자산 4건은 `EXCLUDE`, `/manifest.json` 1건은 `API/INCLUDE`, 나머지 3건은 `REVIEW`였다. 이는 취약점 22개를 확정했다는 뜻이 아니라 ZAP 원시 Alert 수집을 확인한 결과다.
- 로컬 MCP는 `2025-06-18` initialize, tools/list 24개, status를 실제 응답했다. `qa-llm-anon-1` Explorer는 다른 source를 숨긴 상태에서 `/manifest.json` 통제 요청 1건을 `LLM/CONTROLLED` Evidence로 만들었고, scope 밖 FlowScope Web 요청은 `target is outside configured scope`로 거부됐다. HUMAN 3·SCANNER 8·LLM 1의 총 12건을 잠근 결과 finding 0·gap 0이었고, 잠긴 ZAP alert snapshot 조회와 잠금 뒤 Explorer 재시작 거부를 확인했다. 이 확인은 구독형 Codex/Claude prompt 전체 완료를 의미하지 않는다.
- 위 검증 뒤 JDK 21로 최종 생성한 SHA-256 `e8d41fbd...6b4cae` JAR을 Burp에서 제거·재로드해 Web/MCP/8080/8081 재기동을 확인했다. 재로드로 비워진 scope를 같은 승인 대상에 다시 적용한 뒤 HUMAN 1·SCANNER 8·LLM 1, 총 10건을 다시 잠갔고 finding·gap은 0이었다. 두 번째 실행에서도 ZAP 8건·Alert 22건, Explorer 자기 Evidence 1건 시야, 범위 밖 요청 거부가 동일했다.
- 같은 `target/`에 생성된 thin intermediate `original-flowscope-1.2.0-beta.3.jar`를 먼저 선택했을 때 `Extension class is not a recognized type`으로 실패했다. 이는 확장 진입 코드 실패가 아니라 빠진 runtime dependency를 가진 중간 산출물 선택이었지만, 배포 폴더가 사용자를 오도한 실제 packaging UX 결함이다.
- 현재 빌드는 위 결함을 수정해 `original-*`를 package 끝에 제거하고 공개 JAR 수가 하나가 아니면 실패한다. `mvn clean verify` 직후와 이어진 non-clean `mvn -DskipTests package`의 유일한 JAR은 크기·SHA-256이 동일했다.
- 현재 확인은 익명 세 lane과 제어면에 한정한다. 로그인 계정·저장/복구·Repeater·unload는 아래 잔여 gate로 유지한다.

## 독립 clean-room 사전 감사와 후속 재검증

사전 감사 전체는 완료 전에 중단됐으므로 최종 clean-room 통과로 부르지 않는다. 다만 아래 개별 항목은 중단 전 결과와 이후 직접 재검증 결과를 구분해 기록한다.

- clean clone의 `mvn clean verify` 112 tests와 재생성 JAR SHA-256 동일성은 통과했다.
- 중단 시점의 예비 보고에는 Codex MCP 자동 발견 실패가 포함됐으나, 공식 문서와 로컬 Codex CLI 0.147.0으로 다시 확인한 결과 신뢰된 `agent-workspace`에서 번들 `.codex/config.toml`의 `flowscope` 항목이 정상 발견됐다. 사용법에 신뢰 프로젝트 전제와 `codex mcp get flowscope` 확인 단계를 추가했다. MCP protocol과 통제 Explorer 요청은 현재 실제 서버에서 확인했고, 구독형 클라이언트의 prompt 전체와 Judge는 아직 검증하지 않았다.
- 파싱 결과 표에서 stable Evidence ID와 상세 진입이 없던 결함은 이번 변경에서 class/disposition/repeat/Evidence 열과 행→operation 상세 동선으로 수정했고 자동·standalone 검증을 통과했다.
- 빈 상태의 정보 과다 결함은 행동 우선 progressive disclosure로 수정했고 Web 계약 테스트와 1280×720 standalone 검증을 통과했다. Burp 내 Web UI 결과로 소급하지 않는다.

## 아직 실환경에서 검증하지 않은 것

다음은 구현과 자동 회귀는 끝났지만 현재 beta.3 JAR의 실환경에서 끝까지 확인하지 않았다.

- Burp Community에서 extension unload 뒤 Web/MCP 포트 해제와 재로드, Repeater handoff, project save/load 왕복
- 실제 HUMAN 로그인 캡처·pass 전·pass 중 요청이 각각 `SESSION_SETUP`·기본 숨김·분석 포함으로 보이는지, 선택 ACTIVE 계정과 다른 브라우저 자격증명이 계정으로 오기록되지 않는지
- 실제 Burp 대상 트래픽의 `REVIEW`가 메인 그래프에서는 빠지고 파싱 결과의 검토 대기에서 다시 포함·숨김 처리되는지
- 실제 사이트 로그인으로 `UNVERIFIED → ACTIVE`가 전환되고 그 세션을 ZAP·LLM controlled request에 주입해 회전·만료·재인증하는 전체 과정
- ZAP 2.17 환경에서 USER A·USER B fresh-session lane과 신원별 native alert 수집. 비로그인 lane은 통과했다.
- 구독형 Codex 또는 Claude가 MCP로 독립 Explorer pass와 lock 이후 Judge pass를 끝까지 수행하는 과정

따라서 현재 산출물을 “실환경까지 완벽히 검증된 제품”이라고 부르지 않는다. 위 항목은 벤치마크 정답을 보지 않고 수행할 다음 수동 beta gate다.

## 알려진 한계

- CAPTCHA, MFA, WebAuthn, device binding과 서비스 고유 refresh 절차는 범용 자동화할 수 없다. 세션이 `SUSPECT` 또는 `REAUTH_REQUIRED`가 되면 사용자가 HUMAN lane에서 다시 로그인해야 한다.
- `ACTIVE`는 자격증명 material 뒤 명시적 실패가 아닌 HTTP 응답을 관측했다는 transport-level 확인이며 서비스 고유 인증 endpoint, 계정 소유, role을 자동 증명하지 않는다.
- 폐쇄형 탐색은 제공된 agent workspace의 계약이다. 변조된 agent나 운영체제 수준의 외부 네트워크 접근까지 방화벽처럼 막지는 않는다.
- ZAP native alert는 참고 정보다. FlowScope Evidence와 controlled 재현이 없는 alert만으로 취약점을 확정하지 않는다.
- beta.3의 자동 decisive validation은 안전한 읽기 요청 중심이다. 상태 변경 요청은 별도 확인이 있어도 일반화된 자동 확정을 하지 않는다.
- 오탐과 미탐을 0으로 보장하지 않는다. 최종 상태는 LLM의 설명만이 아니라 서버가 확인한 Evidence와 gate로 제한한다.

## 다음 gate

실제 USER A/B 로그인 계정을 준비해 broker·복수 ZAP lane·LLM 계정 주입을 먼저 검증한다. 이어 구독형 Explorer/Judge, 저장·복구·unload gate를 끝낸 뒤에만 blind crAPI 벤치마크를 시작하고, 종료 전까지 알려진 정답과 풀이를 보지 않는다.
