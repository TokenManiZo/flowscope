# FlowScope 개발 기록

이 문서는 작업 단위로 **무엇을 개발했는지, 무엇을 수정했는지, 왜 수정했는지, 어떤 파일이 영향을 받았는지, 어떻게 검증했는지, 무엇이 아직 남았는지**를 기록하는 정본이다.

릴리스 사용자 변경점은 루트 `CHANGELOG.md`, 현재 동작은 `architecture.md`, 설계 선택과 기각 이유는 `decisions.md`, 실제 수행한 검증과 미검증 범위는 `beta-validation.md`가 각각 정본이다. 같은 내용을 모든 문서에 복사하지 않고 이 문서에서 관련 정본을 연결한다.

현재 작업 디렉터리에는 Git metadata가 없다. 따라서 1.2.0-beta.3 이전의 정확한 파일별 변경 순서는 복원하지 않으며, 기존 `CHANGELOG.md`와 `decisions.md`를 역사 기록으로 유지한다. 아래 beta.3 기록은 현재 코드·테스트·문서와 2026-08-25 검증 결과를 대조해 작성했다.

## 2026-08-25 · 1.2.0-beta.3 · 벤치마크 전 제품화

### 목표와 성공 조건

- HUMAN, ZAP, LLM이 서로 독립된 lane으로 실제 Evidence를 남긴다.
- LLM Explorer는 HUMAN/ZAP 결과를 미리 볼 수 없고, 세 lane이 완료된 뒤에만 Judge가 고정된 데이터셋을 본다.
- LLM과 ZAP의 대상 요청은 exact scope와 계정 세션 경계를 서버가 강제한다.
- 최종 `CONFIRMED / INCONCLUSIVE / REJECTED`는 LLM의 주장만으로 결정하지 않고 서버가 재현·정상 대조 Evidence를 검증한다.
- 사용자는 Burp Community와 로컬 Web UI에서 설정, 진행 상태, 그래프, Matrix, Request/Response, 판정 근거를 확인할 수 있다.
- crAPI 정답과 풀이를 보지 않고, 사용자 승인 전 벤치마크를 시작하지 않는다.

### 1. 계정별 메모리 전용 Session Broker

**개발·수정**

- 사용자가 계정별 `로그인 캡처`를 명시적으로 시작하고 종료하는 `SessionBroker`를 추가했다.
- HUMAN 요청에서 Cookie, Authorization, CSRF 계열 헤더를 수집하고, 응답 `Set-Cookie`의 회전·삭제·만료를 반영한다.
- 세션 상태를 `CAPTURING / ACTIVE / SUSPECT / REAUTH_REQUIRED / REVOKED`로 구분했다.
- account service, cookie domain/path/secure/expiry, 현재 exact scope가 모두 맞을 때만 ZAP 또는 LLM 요청에 주입한다.
- 401, 로그인 redirect, invalid-token 응답은 `SUSPECT`로 만들고 이후 사용을 막는다. 403은 역할 거부일 수 있어 자동 만료로 처리하지 않는다.
- raw 세션 값은 Web/MCP view, Evidence, 로그, 프로젝트 파일에 넣지 않고 revoke/clear/unload 때 broker buffer를 폐기한다.

**왜**

기존의 secret-free 계정/세션 fingerprint 연결만으로는 ZAP과 LLM이 특정 테스트 계정으로 독립 탐색할 수 없었다. 반대로 토큰을 에이전트나 프로젝트 파일에 전달하면 비밀 노출과 재사용 위험이 생기므로, Burp 프로세스 메모리 내부의 짧은 실행 bridge로 제한했다.

**주요 파일**

- `src/main/java/io/flowscope/integration/SessionBroker.java`
- `src/main/java/io/flowscope/burp/FlowScopeExtension.java`
- `src/main/java/io/flowscope/web/FlowScopeWebServer.java`
- `src/main/resources/web/index.html`
- `src/test/java/io/flowscope/SessionBrokerTest.java`
- `src/test/java/io/flowscope/FlowScopeWebServerTest.java`

**검증**

헤더 캡처·주입, cookie scope/회전/삭제/만료, 잘못된 service, 캡처 중·의심 세션 차단, revoke와 view 비밀 미노출을 자동 회귀로 고정했다.

### 2. FlowScope 통제 LLM 요청과 실행 신뢰도

**개발·수정**

- MCP `flowscope_target_request`를 추가해 method, exact target, body 크기, 헤더를 서버가 검사하고 Burp HTTP 엔진으로 한 요청만 전송하게 했다.
- broker가 관리하는 인증 헤더를 LLM이 덮어쓰지 못하게 했고 헤더 CR/LF injection을 거부한다.
- 상태 변경 method는 `confirmed=true`와 별도의 Burp 사용자 확인을 모두 요구한다.
- `ExecutionTrust`를 `CONTROLLED / OBSERVED / UNVERIFIED_RUNTIME / IMPORTED / UNKNOWN`으로 구분해 RequestRecord와 Evidence에 보존한다.
- 직접 8082 프록시 관측은 비교 자료로 남길 수 있지만 최종 판정 근거로는 거부한다.

**왜**

프롬프트로 curl이나 browser networking만 금지하면 모델이 실제로 어떤 경로·헤더·redirect로 요청했는지 서버가 증명할 수 없다. 최종 판정의 재현 Evidence는 프롬프트 준수가 아니라 서버 통제 사실에 묶여야 한다.

**주요 파일**

- `src/main/java/io/flowscope/core/ExecutionTrust.java`
- `src/main/java/io/flowscope/core/RequestRecord.java`
- `src/main/java/io/flowscope/core/EvidenceIds.java`
- `src/main/java/io/flowscope/integration/McpServer.java`
- `src/main/java/io/flowscope/burp/FlowScopeExtension.java`
- `src/test/java/io/flowscope/McpServerTest.java`
- `src/test/java/io/flowscope/TrafficMetadataTest.java`

**검증**

범위 밖 target, 잘못된 계정/service, broker-owned header, CR/LF, 승인 없는 write를 거부하고 controlled request가 올바른 provenance로 기록되는지 검사했다.

### 3. 독립 Explorer, Dataset Lock, 최종 Judge

**개발·수정**

- LLM EXPLORATION run 동안 MCP status와 Evidence에서 다른 source의 count, cell, gap, finding, candidate를 숨긴다.
- 성공적으로 종료된 HUMAN/SCANNER/LLM EXPLORATION lane을 명시적으로 기록한다. 중단·실패한 run 또는 record 존재만으로 완료를 추론하지 않는다.
- `flowscope_lock_dataset`은 active run이 없고 세 lane 각각에 response-bearing nondefault exploration Evidence가 있어야만 후보와 owner/role oracle을 고정한다.
- lock 뒤에는 scope 변경, Explorer, scanner 시작을 막고 Judge/validation만 허용한다.
- Judge의 validation probe/control은 현재 Evidence 저장소에서 읽되 후보와 oracle은 잠긴 snapshot에서 읽도록 분리했다.
- 프로젝트 복원 시 COACH_PROBE/VALIDATION record를 제외한 pre-Judge 후보 snapshot을 재구성해 저장된 판정을 다시 검증한다.

**왜**

프롬프트에 “다른 결과를 보지 말라”고 적는 것만으로 독립 비교를 보장할 수 없다. 또한 Judge 실행 중 새 탐색 결과가 후보를 바꾸면 비교와 재현의 기준점이 사라지므로 서버 수준의 가시성 격리와 불변 snapshot이 필요했다.

**주요 파일**

- `src/main/java/io/flowscope/core/RunContextRegistry.java`
- `src/main/java/io/flowscope/integration/McpServer.java`
- `src/main/java/io/flowscope/integration/ProjectStore.java`
- `src/test/java/io/flowscope/McpServerTest.java`
- `src/test/java/io/flowscope/ProjectStoreTest.java`

**검증**

Explorer 격리, 빈 lane과 active run의 lock 거부, lock 후 상태 변경 거부, `lock → controlled probes → submit validation` 실제 순서, 저장·복원 후 판정 재검증을 자동 테스트했다.

### 4. 결정론적 ZAP baseline

**개발·수정**

- 기본 scanner lane을 LLM 선택이 아니라 `orchestrator=SYSTEM` workflow로 고정했다.
- 실행 순서는 Traditional Spider → strict-scope Client Spider → Client 실패 시 AJAX Spider fallback → passive queue 0 대기 → native alerts 수집이다.
- optional account의 active broker session을 ZAP 프록시 요청에 주입한다.
- in-scope SCANNER capture가 0이면 성공이 아니라 `NO_SCANNER_TRAFFIC_CAPTURED`로 실패 처리한다.
- 현재 stage, warning, captured count, alert count를 Web/MCP에 노출한다.
- Active Scan은 baseline에서 분리하고 exact scope, 명시적 요청, Burp 확인을 계속 요구한다.

**왜**

LLM에게 ZAP 기능 선택을 맡기면 passive queue를 기다리지 않거나 SPA 경로를 놓치고, start 응답을 완료로 오해할 수 있다. 같은 입력에서 재현 가능한 scanner 결과를 만들면서 Traditional/Client/AJAX/passive/native alert를 빠뜨리지 않기 위해 시스템 workflow로 고정했다.

**주요 파일**

- `src/main/java/io/flowscope/integration/ZapClient.java`
- `src/main/java/io/flowscope/integration/McpServer.java`
- `src/main/java/io/flowscope/web/FlowScopeWebServer.java`
- `src/main/resources/web/index.html`
- `src/test/java/io/flowscope/ZapClientTest.java`
- `src/test/java/io/flowscope/McpServerTest.java`

**검증**

각 단계 호출 순서, Client 상태의 중첩 응답 처리, AJAX fallback, passive 완료 대기, native alert snapshot과 비밀 마스킹, zero-capture 실패를 자동 회귀로 고정했다.

### 5. 저장 모델과 비밀 경계

**개발·수정**

- 프로젝트 schema v1의 선택 필드로 `execution_trust`와 명시적 `completed_lanes`를 추가해 기존 파일 호환성을 유지했다.
- raw broker session, active run lease와 live lock 객체는 프로젝트에 저장하지 않는다.
- 저장된 validation은 현재 후보·Evidence와 다시 대조하고 stale/cross-run/위조 판정을 버린다.

**왜**

프로젝트를 재개할 수 있어야 하지만 세션 비밀과 실행 중 상태까지 직렬화하면 보안 경계가 깨진다. 반대로 lane 완료를 record 존재로 복원하면 실패한 실행이 lock 조건을 만족하므로 명시적 완료 metadata만 저장한다.

**주요 파일**

- `src/main/java/io/flowscope/integration/ProjectStore.java`
- `src/main/java/io/flowscope/core/RequestRecord.java`
- `src/test/java/io/flowscope/ProjectStoreTest.java`

**검증**

구버전 선택 필드 부재, round trip, 비밀 미저장, 완료 lane 명시 복원, interrupted record 미추론을 검사했다.

### 6. Web UI와 사용자 흐름

**개발·수정**

- quick-start를 `scope → 계정/로그인/HUMAN → ZAP → Explorer → lock/Judge` 순서로 정리했다.
- 계정 카드에 로그인 캡처 시작/종료, revoke, 상태 표시를 추가했다.
- ZAP target/account/stage/warning/captured/alert UI를 추가했다.
- Matrix cell에서 `이 API의 요청·응답 보기`를 눌러 해당 Evidence와 마스킹된 Request/Response를 지연 로드하도록 했다.
- 긴 글자와 작은 화면에서 modal, 계정 카드, 표, scanner controls가 잘리지 않도록 반응형 CSS를 수정했다.

**왜**

사용자가 포트와 프롬프트 내부 구현을 이해하지 않아도 정상 순서를 따라갈 수 있어야 하고, 그래프 결과에서 실제 근거 Request/Response까지 이동할 수 있어야 제품으로 사용할 수 있다.

**주요 파일**

- `src/main/resources/web/index.html`
- `src/main/java/io/flowscope/web/FlowScopeWebServer.java`
- `src/main/java/io/flowscope/web/SnapshotJsonWriter.java`
- `src/test/java/io/flowscope/FlowScopeWebServerTest.java`

**검증**

1500×900, 900×700, 600×800 viewport에서 quick-start, 계정 화면, Matrix Evidence를 확인했고 브라우저 콘솔 오류는 0건이었다.

### 7. Agent workspace, 문서, 배포물

**개발·수정**

- Explorer와 Judge 프롬프트를 분리하고 web search, Wayback, 외부 API docs/source, curl, browser networking을 금지했다.
- Explorer는 통제 request만 사용하고, Judge는 lock 뒤 advisory ZAP alert와 Evidence를 읽어 재현·대조 후 서버 판정을 제출하게 했다.
- README, architecture, product overview/plan, decisions, changelog, beta validation을 beta.3 동작에 맞췄다.
- 버전을 `1.2.0-beta.3`으로 올리고 단일 배포 JAR을 생성했다.

**주요 파일**

- `agent-workspace/prompts/explorer.md`
- `agent-workspace/prompts/judge.md`
- `agent-workspace/AGENTS.md`
- `agent-workspace/CLAUDE.md`
- `README.md`
- `docs/architecture.md`
- `docs/decisions.md`
- `docs/product-overview.md`
- `docs/product-development-plan.md`
- `docs/beta-validation.md`
- `CHANGELOG.md`
- `pom.xml`

**검증**

`mvn clean verify`에서 112 tests가 모두 통과했다. JAR ZIP 무결성, manifest, Montoya 미포함, 고지/Web 자산 포함, 머신 절대경로와 제품 코드의 리터럴 비밀값 부재를 확인했다.

### 8. 변경 기록과 문서 동기화 규칙

**개발·수정**

- 이 개발 기록을 작업 단위 정본으로 추가하고 문서별 소유 계약을 `docs/README.md`에 명시했다.
- `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`에 코드 변경과 같은 단위로 이유·영향 파일·검증·한계를 기록하도록 강제했다.
- 사용자 변경은 Changelog, 현재 구조는 Architecture, 선택 이유는 Decisions, 실제 수행 검증은 Beta Validation, 단계 상태는 Product Plan에만 기록하도록 역할을 분리했다.
- 현재 구현과 충돌하던 “LLM은 제안만”, “raw 인증정보는 전혀 보유하지 않음”, “QA는 범위 밖” 지침을 서버 검증 Judge, 명시적 메모리 전용 broker, beta.3 수동 gate에 맞게 수정했다.
- 제품 계획에서 이전 산출물의 Burp smoke가 beta.3 실검증처럼 읽히던 문장을 분리하고 새 JAR의 미완료 수동 gate를 명시했다.

**왜**

문서만으로는 정확한 줄 변경과 복구를 제공하지 못하고 Git만으로는 설계 이유와 미검증 범위를 충분히 설명하지 못한다. 두 기록을 함께 사용하되 같은 내용을 모든 문서에 복사해 불일치를 만드는 방식은 피해야 한다.

**영향 파일**

- `docs/development-log.md`
- `docs/README.md`
- `docs/decisions.md`
- `docs/product-development-plan.md`
- `README.md`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `AGENTS.md`
- `CLAUDE.md`

**검증과 남은 gate**

문서 링크와 beta.3 버전·검증 수치·P4 상태를 상호 대조했다. 이 변경은 제품 Java/Web 동작을 바꾸지 않으므로 기존 112-test 산출물을 다시 빌드한 것으로 기록하지 않는다. 이후 사용자 승인에 따라 아래 로컬 Git 기준선을 준비했다.

### 9. 로컬 Git 기준선

**개발·수정**

- 현재 디렉터리에 로컬 Git 저장소를 `main` 브랜치로 초기화했다.
- `.gitignore`가 `target/`, `.local/`, 루트 `.codex/`, IDE 파일, 환경 파일, key/certificate, `.flowscope.json`을 제외하는지 확인했다.
- 추적 후보의 자격증명 패턴, 머신 절대경로, 대용량 파일을 검사했다.
- remote는 추가하지 않았고 GitHub 또는 외부 시스템으로 전송하지 않았다.

**왜**

문서 기록에 더해 정확한 파일 diff, 기능 단위 변경 이력과 안전한 복구 지점을 남기기 위해서다. 기존 Git metadata가 없으므로 과거 이력을 임의로 재구성하지 않고 현재 beta.3를 첫 기준점으로 삼는다.

**검증**

- `git status --ignored`에서 `.local/`과 `target/`이 ignored 상태임을 확인했다.
- secret pattern 검사에서 탐지된 유일한 Bearer 문자열은 `CaptureSchemaTest`의 의도된 합성 JWT fixture(`PAYLOAD.SIG`)였다.
- 5 MiB를 넘는 추적 후보 파일은 없었고 remote 목록은 비어 있었다.
- staged 목록은 공개 소스·테스트·문서·CI·라이선스 131개 파일이고 `target/`, `.local/`은 포함되지 않았다.
- `git diff --check`는 기존 Burp XML의 CRLF HTTP fixture, 원본 기능명세의 후행 공백, 일부 EOF 공백을 보고했다. 초기 기준선에서 원본 fixture와 역사 문서를 기계적으로 고치면 검증한 소스가 달라지므로 그대로 보존하고 이후 기능 변경이 새 whitespace 오류를 만들지 않게 한다.
- 로컬 root commit은 `chore: establish FlowScope 1.2.0-beta.3 baseline`으로 생성했다. remote는 계속 비어 있다.

### 수정 과정에서 발견해 고친 결함

| 결함 | 원인 | 수정 | 회귀 검증 |
|---|---|---|---|
| `SUSPECT` 세션 주입 가능성 | 세션 존재와 주입 가능 상태를 같은 조건으로 취급 | 오직 exact-service/scope의 `ACTIVE` 세션만 주입 | `SessionBrokerTest` |
| lock 뒤 validation Evidence를 읽지 못함 | 후보 snapshot과 Evidence 조회를 모두 lock 시점으로 고정 | 후보/oracle만 lock하고 validation Evidence는 현재 저장소에서 조회 | `McpServerTest`의 실제 Judge 순서 |
| 복원된 validation이 후보 계산을 오염 | load 시 최종 probe까지 exploration 후보 입력에 포함 | COACH_PROBE/VALIDATION 제외 pre-Judge snapshot 재구성 | `McpServerTest`, `ProjectStoreTest` |
| ZAP Client status 오판 가능성 | 실제 응답의 중첩 status를 최상위 필드로만 탐색 | 중첩 구조를 탐색하는 status 처리 | `ZapClientTest` |

### 검증 결과와 미완료 gate

- 자동 회귀: JDK 21 `mvn clean verify`, 112 tests, 실패·오류·skip 0.
- 산출물: `target/flowscope-1.2.0-beta.3.jar`, 2,792,782 bytes.
- SHA-256: `faef5fcf38fd1e3d37ac7aaa883738e5cbe58c42147655b4f0574bba33ceee82`.
- 아직 beta.3 JAR의 실제 Burp Community 재로드, 실제 로그인 세션 주입, ZAP 2.17 연쇄 실행, 구독형 Codex/Claude MCP 전체 과정, 실제 프로젝트 save/load는 수행하지 않았다.
- 위 수동 beta gate를 통과하기 전에는 blind crAPI 벤치마크를 시작하지 않는다.

자세한 실행 검증 경계는 `beta-validation.md`, 설계 결정은 `decisions.md`의 D-052~D-055를 따른다.

## 이후 작업 기록 형식

새 코드·동작 변경은 완료와 동시에 아래 형식으로 이 파일에 추가한다.

```text
## YYYY-MM-DD · 버전 또는 작업명

### 목표와 성공 조건
- 검증 가능한 완료 조건

### 개발·수정
- 무엇을 바꿨는가

### 이유
- 어떤 결함·요구·위험 때문에 바꿨는가
- 검토했으나 기각한 대안과 이유(아키텍처 결정이면 decisions.md에도 기록)

### 영향 파일
- 실제로 변경한 코드·테스트·문서

### 검증
- 먼저 실패한 회귀 또는 재현 방법
- 실행한 명령과 결과
- 수동 확인 환경과 결과

### 남은 한계·다음 gate
- 아직 검증하지 않은 것과 진행 조건
```
