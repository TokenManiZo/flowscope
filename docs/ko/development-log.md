# FlowScope 개발 기록

이 문서는 작업 단위로 **무엇을 개발했는지, 무엇을 수정했는지, 왜 수정했는지, 어떤 파일이 영향을 받았는지, 어떻게 검증했는지, 무엇이 아직 남았는지**를 기록하는 정본이다.

릴리스 사용자 변경점은 루트 `CHANGELOG.md`, 현재 동작은 `architecture.md`, 설계 선택과 기각 이유는 `decisions.md`, 실제 수행한 검증과 미검증 범위는 `beta-validation.md`가 각각 정본이다. 같은 내용을 모든 문서에 복사하지 않고 이 문서에서 관련 정본을 연결한다.

현재 작업 디렉터리는 사용자 승인으로 Git `main` 저장소가 됐고 `origin`은 `https://github.com/choewonwoo1817/testflowscope.git`에 연결되어 있다. 초기화 전 1.2.0-beta.3의 정확한 파일별 변경 순서는 복원하지 않으며, 기존 `CHANGELOG.md`와 `decisions.md`를 역사 기록으로 유지한다. 아래 beta.3 기록은 현재 코드·테스트·문서와 2026-08-25 검증 결과를 대조해 작성했다.

## 2026-08-25 · 한국어·영어 문서 경계 정리

**개발·수정**

- 저장소 루트의 README, 변경 이력, 기여 가이드, 보안 정책을 한국어 정본으로 바꿨다.
- 상세 설계·결정·검증·연구·기능명세는 `docs/ko`로 이동하고 한국어 문서 색인을 추가했다.
- 기존 영어 README, 변경 이력, 기여 가이드, 보안 정책을 `docs/en`에 보존하고 영어 문서 색인을 추가했다.
- 이동된 문서를 참조하는 저장소 지침과 내부 링크를 새 경로에 맞췄다.

**왜**

한국어 사용자가 저장소 첫 화면에서 바로 설치·운영 경계를 읽을 수 있어야 하고, 한 디렉터리에서 두 언어를 섞어 문서의 정본을 모호하게 만들면 안 된다. 검토하지 않은 기계 번역을 상세 영어 문서처럼 제공하지 않고, 실제로 존재하는 영어 공개 가이드만 별도 보존했다.

**주요 파일**

- `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`
- `docs/ko/**`, `docs/en/**`
- `AGENTS.md`, `CLAUDE.md`

**검증 및 남은 한계**

- 저장소의 Markdown 파일을 대상으로 로컬 상대 링크가 실제 파일·디렉터리를 가리키는지 검사해 누락 0건을 확인했다.
- 이전 `docs/*.md`·`docs/specification` 경로를 참조하는 현재 링크와 지침이 남지 않았음을 확인했다.
- `mvn clean verify`: 124 tests, 실패·오류·skip 0.
- 상세 아키텍처·결정 문서는 현재 한국어만 제공한다. 검토된 영어 번역이 생기기 전에는 영어 문서라고 표시하지 않는다.

## 2026-08-25 · source 색상과 일반 UI accent 분리

**개발·수정**

- source palette를 HUMAN 파랑, SCANNER 빨강, LLM 검정으로 변경하고 실선/파선/점선과 H/S/L 약어를 함께 유지했다.
- source 색을 재사용하던 일반 버튼, 포커스, 선택, 계정 카드, 그룹 노드를 별도 중립 accent로 분리했다.
- 정의되지 않은 `--blue`를 사용하던 Evidence class filter의 accent를 동일한 일반 accent로 바로잡았다.

**왜**

색만 바꾸면 SCANNER와 무관한 일반 UI까지 빨강으로 변하고, 완전히 겹친 색 선은 아래 source를 가린다. source 의미는 색·선형·문자로 중복 표현하고 일반 조작과 authorization verdict는 별도 시각 축으로 유지해야 한다.

**주요 파일**

- `src/main/resources/web/index.html`
- `src/test/java/io/flowscope/FlowScopeWebServerTest.java`
- `README.md`, `CHANGELOG.md`
- `docs/ko/architecture.md`, `docs/ko/decisions.md`, `docs/ko/ui-product-rationale.md`

**검증 및 남은 gate**

- Web 응답에 정확한 palette와 H/S/L 계약이 포함되는지 자동 회귀를 추가했다.
- `mvn clean verify`: 124 tests, 실패·오류·skip 0.
- 정적 검사에서 source 변수는 업로드·필터·범례·단일-source 노드·source edge에만 남고 일반 조작은 `--accent`를 사용함을 확인했다. 계정별 서버 palette는 source가 아닌 identity 표시 데이터이므로 변경하지 않았다.
- 1280×720 standalone 렌더에서 범례와 그래프의 파랑/빨강/검정 및 실선/파선/점선, H/S/L 노드 표기가 일치했다. body scroll 크기는 viewport와 같았고 클라이언트 오류는 0건이었다.
- fat JAR: 2,814,714 bytes, 1,295 entries, ZIP 무결성 통과, `Main-Class=io.flowscope.burp.FlowScopeExtension`, SHA-256 `e760799758e73188888f1944ae08ab17c6d535e82fd6eec9cc41dd7e365b13ba`.
- 실제 Burp에서 현재 JAR을 다시 로드해 Web UI를 여는 수동 gate는 남아 있다.

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
- `docs/ko/architecture.md`
- `docs/ko/decisions.md`
- `docs/ko/product-overview.md`
- `docs/ko/product-development-plan.md`
- `docs/ko/beta-validation.md`
- `CHANGELOG.md`
- `pom.xml`

**검증**

`mvn clean verify`에서 112 tests가 모두 통과했다. JAR ZIP 무결성, manifest, Montoya 미포함, 고지/Web 자산 포함, 머신 절대경로와 제품 코드의 리터럴 비밀값 부재를 확인했다.

### 8. 변경 기록과 문서 동기화 규칙

**개발·수정**

- 이 개발 기록을 작업 단위 정본으로 추가하고 문서별 소유 계약을 `docs/ko/README.md`에 명시했다.
- `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`에 코드 변경과 같은 단위로 이유·영향 파일·검증·한계를 기록하도록 강제했다.
- 사용자 변경은 Changelog, 현재 구조는 Architecture, 선택 이유는 Decisions, 실제 수행 검증은 Beta Validation, 단계 상태는 Product Plan에만 기록하도록 역할을 분리했다.
- 현재 구현과 충돌하던 “LLM은 제안만”, “raw 인증정보는 전혀 보유하지 않음”, “QA는 범위 밖” 지침을 서버 검증 Judge, 명시적 메모리 전용 broker, beta.3 수동 gate에 맞게 수정했다.
- 제품 계획에서 이전 산출물의 Burp smoke가 beta.3 실검증처럼 읽히던 문장을 분리하고 새 JAR의 미완료 수동 gate를 명시했다.

**왜**

문서만으로는 정확한 줄 변경과 복구를 제공하지 못하고 Git만으로는 설계 이유와 미검증 범위를 충분히 설명하지 못한다. 두 기록을 함께 사용하되 같은 내용을 모든 문서에 복사해 불일치를 만드는 방식은 피해야 한다.

**영향 파일**

- `docs/ko/development-log.md`
- `docs/ko/README.md`
- `docs/ko/decisions.md`
- `docs/ko/product-development-plan.md`
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

## 2026-08-25 · 실제 사용자 인수검사와 발표 근거 문서화

### 목표와 성공 조건

- 구현자가 아는 정상 경로가 아니라 처음 설치하는 사용자의 실제 행동으로 beta.3의 설치·온보딩 실패를 찾는다.
- 각 UI 요소를 `사용자 질문 → 설계 이유 → 기각 방식 → 오탐·미탐 영향 → 발표 문장`으로 설명할 정본을 만든다.
- 실제 확인한 항목과 아직 실행하지 않은 항목을 문서에서 분리한다.

### 관측·수정

- 사용자가 Burp Community 2026.7.3에 `original-flowscope-1.2.0-beta.3.jar`를 추가했을 때 `Extension class is not a recognized type` 오류를 실제 관측했다.
- JAR 내부 진입점, Java 21 class version, 설치된 Burp와 Maven Montoya API 2026.7 class digest, 실제 Burp loader의 `BurpExtension` 판별 조건을 대조했다. 진입 클래스는 올바른 구현체였고, 사용자가 `target/flowscope-1.2.0-beta.3.jar`를 선택하자 신규 load가 통과했다.
- 원인은 runtime dependency가 없는 Maven Shade의 `original-*` intermediate를 사용자가 배포물로 오인한 것이었다. 사용자의 잘못으로 닫지 않고, 같은 폴더에 선택 불가능해야 할 유사 JAR을 노출한 packaging UX 결함으로 D-058에 기록했다.
- 실제 빈 Web 화면의 관측 범위·source filter·권한·사용자 그래프·3-way gap·그래프 조작이 각각 답하는 질문과 안전 이유를 `ui-product-rationale.md`에 통합했다.
- README/architecture가 파싱 결과에서 stable Evidence ID를 볼 수 있다고 했지만 실제 beta.3 raw table에는 해당 열과 상세 동작이 없음을 확인해 문서를 현재 동작으로 수정하고 UI 부채로 올렸다.
- 독립 clean-room 사전 감사에서 Codex MCP 설정 자동 발견 실패가 예비 보고됐으나 감사 자체는 사용자 요청으로 중단됐다. 후속으로 공식 Codex 문서와 로컬 CLI 0.147.0을 대조했고, 신뢰된 `agent-workspace`에서 프로젝트 설정의 `flowscope` 항목이 실제 발견되는 것을 확인했다. 따라서 제품 결함으로 확정하지 않고 신뢰 전제와 확인 명령이 빠진 onboarding 문서 문제로 교정했다. 빈 상태 onboarding 혼란은 열린 UX 결함으로 유지한다.

### 왜

112개 자동 테스트와 구현자 중심 standalone 확인은 실제 설치 파일 선택, 처음 보는 용어, 문서와 화면 불일치를 잡지 못했다. 제품 성공 기준을 “코드가 존재한다”가 아니라 “처음 받은 사용자가 올바른 다음 행동을 알고 전체 흐름을 완료한다”로 교정해야 했다. 발표에서도 기능 나열보다 각 선택이 막는 오탐·미탐·신뢰 문제를 설명해야 한다.

### 영향 파일

- `docs/ko/ui-product-rationale.md`
- `docs/ko/README.md`
- `docs/ko/architecture.md`
- `docs/ko/graph-ux.md`
- `docs/ko/product-overview.md`
- `docs/ko/decisions.md`
- `docs/ko/beta-validation.md`
- `docs/ko/product-development-plan.md`
- `docs/ko/development-log.md`
- `README.md`
- `agent-workspace/README.md`
- `CHANGELOG.md`
- `AGENTS.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`

### 검증

- 실제 사용자 Burp load: 올바른 fat JAR만 통과.
- entry class: Java 21, 설치된 Burp 2026.7.3의 `BurpExtension`과 assignable 및 public constructor 생성 확인.
- Maven/Burp `BurpExtension`과 `RequestOptions` class digest 일치 확인.
- 실제 Web raw table 코드의 7개 열을 대조해 Evidence ID 미노출 확인.
- 공식 Codex 문서의 trusted-project 조건을 대조하고 `agent-workspace`에서 `codex mcp get flowscope`로 project-scoped MCP discovery 확인.
- 저장소 Markdown 24개 전수 로컬 링크 검사: 누락 0.
- `git diff --check`: 통과.
- Java·Web 제품 코드는 변경하지 않았으므로 기존 beta.3 자동 테스트 결과를 새로 수행한 것처럼 기록하지 않는다. 배포 JAR과 SHA-256도 변경되지 않았다.

### 남은 한계·다음 gate

- Maven 공개 install surface에서 `original-*` JAR을 제거하거나 내부 경로로 격리해야 한다.
- 빈 상태 progressive disclosure와 ADMIN 선택성 문구를 UI에 구현해야 한다.
- 파싱 결과에 Evidence ID/상세 진입을 구현하거나 해당 화면의 역할을 다시 결정해야 한다.
- Codex project-scoped MCP discovery는 확인했지만 실행 중인 FlowScope MCP 연결과 Explorer/Judge 전체 과정은 검증해야 한다.
- 올바른 beta.3 JAR의 Web UI, HUMAN, broker, ZAP, Explorer/Judge, save/load, unload는 계속 미검증이다.

## 2026-08-25 · Evidence 보존형 트래픽 분류와 신원 안정화

### 목표와 성공 조건

- 브라우저·LLM의 보조 traffic이 graph를 압도하지 않되 캡처된 Evidence를 삭제하지 않는다.
- 경로명이나 cookie 존재 하나로 API/로그인 여부를 단정하지 않는다.
- 수집 전체와 coverage 입력의 차이, 분류 근거, 반복 횟수, stable Evidence ID를 사용자가 확인하고 되돌릴 수 있다.
- cookie가 1,000번 회전해도 검증되지 않은 1,000명의 graph identity를 만들지 않고, 명시 account binding은 계속 정확히 적용된다.

### 개발·수정

- 기존 boolean `TrafficFilter`를 `TrafficClassifier`의 class/disposition/reasons/override 계약으로 교체했다. real CORS preflight, Fetch Metadata와 MIME가 합치하는 navigation/static, no-response, non-discovery phase만 high-confidence 제외하고 telemetry·애매한 관측은 `REVIEW`로 보존했다.
- Pipeline을 `전체 정규화·Evidence ID → auth state 안정화 → traffic classification → coverage subset → analyzer/graph`로 분리했다. `records`는 전체 Evidence, `coverageRecords`는 분석 입력이다.
- request/response Content-Type, `Sec-Fetch-Dest`, `Sec-Fetch-Mode`, `Access-Control-Request-Method`, auth state와 분류 결과를 live/Burp XML/project/Web/MCP에 연결했다.
- operation별 `AUTO/INCLUDE/EXCLUDE`를 설정·프로젝트·Web API에 추가했다. classifier version을 project에 기록하고 로드 후 현재 규칙으로 다시 계산한다.
- unbound cookie/session fingerprint를 서비스별 `UNRESOLVED` graph identity로 안정화했다. 원 fingerprint는 Evidence와 수동 binding 후보에 남기고, broker가 raw credential을 exact match하거나 사용자가 binding한 경우만 `ACCOUNT_BOUND`로 바꾼다. 명시 HUMAN anonymous pass도 Authorization과 Cookie가 모두 없을 때만 `ANONYMOUS`다.
- 동일 의미 관측은 `ObservationCollapser`로 화면에서만 접고 모든 Evidence ID, repeat count, first/last timestamp를 유지했다.
- Web 좌측에 수집/분석/기본 숨김/검토 통계와 Evidence 표시 filter를, 파싱 결과에 분류/처리/반복/Evidence 열과 행→operation 상세 동선을, 상세에 reversible coverage override를 추가했다.
- MCP status/list/detail과 dataset lock gate가 전체 수집량이 아니라 discovery-eligible coverage를 명시적으로 사용하도록 수정했다.
- 신규 coverage 통계가 independent Explorer에서 HUMAN/SCANNER 수량을 노출할 수 있던 격리 우회를 코드 검토에서 발견했다. 독립 모드의 captured/coverage/excluded/review/source count를 현재 LLM run으로 제한하고 회귀 assertion을 추가했다.

### 이유와 기각한 대안

확장자 blacklist, `/analytics` 정규식, 모든 OPTIONS 제거는 사설 이미지 API·business telemetry·일반 OPTIONS를 버릴 수 있다. cookie마다 identity를 만드는 방식은 익명 추적 cookie 회전만으로 graph를 폭증시킨다. 반대로 검증되지 않은 cookie를 한 계정으로 확정 병합하면 서로 다른 사용자를 섞는다. LLM per-request 분류는 비결정적이고 비용이 크며 독립 비교를 오염시킨다. 따라서 deterministic high-confidence exclusion + ambiguous review + user override + raw Evidence retention을 선택했다(D-059).

### 영향 파일

- 핵심: `core/TrafficClassifier`, `TrafficClassification`, `TrafficOverride`, `AuthState`, `ObservationCollapser`, `Pipeline`, `RequestRecord`, `AnalysisConfig`.
- 수집·통합: `burp/FlowScopeExtension`, `core/BurpXmlParser`, `integration/SessionBroker`, `ProjectStore`, `McpServer`, `web/FlowScopeWebServer`, `SnapshotJsonWriter`.
- UI: `ui/FlowScopeControlTab`, `resources/web/index.html`.
- 테스트: `TrafficClassifierTest`, `PipelineClassificationTest`, `ObservationCollapserTest`와 session/project/MCP/Web/accuracy 회귀.
- 문서: README, architecture, decisions, research, UI rationale, product plan, beta validation, changelog, 이 개발 기록.

### 검증

- 첫 `mvn clean verify`는 UI 제목을 `트래픽 분류`에서 `Evidence 표시`로 바꾼 뒤 Web 회귀가 이전 문자열을 기대해 실패했다. 제품 계약에 맞춰 assertion을 수정했다. 이어 사용자 INCLUDE가 non-discovery phase를 우회하지 못하는 회귀를 추가했고 최종 전체 결과는 아래에 기록했다.
- 이 변경 직후 `mvn clean verify`: 123 tests, 실패·오류·skip 0. 이후 D-060 회귀가 추가됐으며 현재 전체 결과는 아래 후속 기록과 `beta-validation.md`를 따른다.
- classifier 회귀: misleading extension, private image API, true preflight/normal OPTIONS, telemetry 명칭, 보안 신호 우선, user override, no-response/non-discovery 보존을 확인했다.
- identity 회귀: 1,000 rotating cookies가 한 서비스의 `UNRESOLVED` graph identity로 안정화되고 명시 binding은 계정으로 분리됨을 확인했다.
- persistence/MCP/Web 회귀: classification/auth/override/version round trip과 captured/coverage/excluded/review 통계를 확인했다.
- Explorer 격리 회귀: independent mode에서 HUMAN의 raw·coverage source count가 모두 없고 전체 통계도 현재 LLM run 1건만 반환하는 것을 확인했다.
- standalone local browser: 1024×768에서 가로 overflow와 ellipsis 잘림 0, 여섯 mode 전환, quick-start, 파싱 행→Evidence 상세, 분류 override 조작 노출, console error 0을 확인했다.
- 이 변경 직후 fat JAR: 2,814,516 bytes, 1,295 entries, ZIP 무결성 통과, `Main-Class=io.flowscope.burp.FlowScopeExtension`, SHA-256 `64d9079759af25bc4df09ec0856fc3b5d61cee620b69d4053f37f0d965d8d354`. 현재 산출물은 후속 D-060 기록을 따른다.

### 남은 한계·다음 gate

- Fetch Metadata/MIME가 없거나 잘못된 대상과 business-specific API는 완벽히 분류할 수 없다. 애매한 `REVIEW`와 사용자 override는 정상 동작이며 오탐·미탐 0을 주장하지 않는다.
- broker의 raw credential exact match는 false merge보다 miss를 택한다. MFA/WebAuthn/device binding과 application-specific refresh는 수동 재로그인이 필요하다.
- 현재 standalone QA는 Burp Community 실제 capture/session/ZAP/MCP workflow를 대신하지 않는다. blind crAPI 전에 기존 수동 beta gate를 완료해야 한다.
- D-058의 `original-*` JAR 노출과 D-057의 empty-state progressive disclosure는 이번 변경 범위 밖의 열린 제품 부채다.

## 2026-08-25 · HUMAN 범위 밖 Evidence 혼입 수정

### 목표와 성공 조건

- HUMAN은 Burp 브라우저로 범위 밖 사이트를 방문할 수 있지만 FlowScope에는 현재 exact scope 왕복만 저장한다.
- scope가 비어 있거나 잘못된 경우 HUMAN/SCANNER/LLM 어느 source도 Evidence를 만들지 않는다.

### 개발·수정과 이유

사용자 crAPI 점검 중 scope 입력이 실패한 상태에서 네이버를 한 번 방문하자 네이버 요청이 FlowScope 그래프에 들어오는 실제 결함을 확인했다. `ActiveTrafficGuard`의 송신 gate는 의도적으로 SCANNER/LLM에만 적용됐지만, 공통 `capture()`에는 별도 scope 검사가 없었다. HUMAN 브라우저 이동 자체를 막지 않으면서 `capture()`가 RequestRecord를 만들기 전에 모든 source의 URL을 exact scope로 검사하도록 수정했다.

### 영향 파일

- `core/ActiveTrafficGuard`, `burp/FlowScopeExtension`, `ActiveTrafficGuardTest`
- README, architecture, decisions(D-060), changelog, beta validation, 이 개발 기록

### 검증과 남은 gate

- 회귀는 HUMAN active navigation이 범위 밖에서도 허용되는 기존 계약과, 같은 URL의 Evidence capture가 거부되는 새 계약을 동시에 검사한다. 빈 scope capture도 거부한다.
- 이 작업 직후 `mvn clean verify`: 124 tests, 실패·오류·skip 0. 당시 fat JAR은 2,814,634 bytes, 1,295 entries, ZIP 무결성 통과, SHA-256 `1a910883f07c38b2605f343c7fc2209740ebc41479961df8291f3ae6c4c074d8`였다. 현재 산출물은 위 source palette 작업 기록과 `beta-validation.md`를 따른다.
- 수정 전 이미 저장된 범위 밖 Evidence를 자동 삭제하지 않는다. 사용자는 새 JAR 로드 뒤 `수집 초기화`를 한 번 수행해야 한다.
- 전체 자동 회귀와 산출물 정보는 `beta-validation.md`에 기록한다. 실제 Burp 내장 브라우저에서 crAPI와 외부 사이트를 오가며 재확인하는 수동 gate는 남아 있다.

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
