# FlowScope 개발 기록

이 문서는 작업 단위로 **무엇을 개발했는지, 무엇을 수정했는지, 왜 수정했는지, 어떤 파일이 영향을 받았는지, 어떻게 검증했는지, 무엇이 아직 남았는지**를 기록하는 정본이다.

릴리스 사용자 변경점은 루트 `CHANGELOG.md`, 현재 동작은 `architecture.md`, 설계 선택과 기각 이유는 `decisions.md`, 실제 수행한 검증과 미검증 범위는 `beta-validation.md`가 각각 정본이다. 같은 내용을 모든 문서에 복사하지 않고 이 문서에서 관련 정본을 연결한다.

현재 작업 디렉터리는 사용자 승인으로 Git `main` 저장소가 됐고 `origin`은 `https://github.com/choewonwoo1817/testflowscope.git`에 연결되어 있다. 초기화 전 1.2.0-beta.3의 정확한 파일별 변경 순서는 복원하지 않으며, 기존 `CHANGELOG.md`와 `decisions.md`를 역사 기록으로 유지한다. 아래 beta.3 기록은 현재 코드·테스트·문서와 2026-08-25 검증 결과를 대조해 작성했다.

## 2026-08-31 · 1.2.0-beta.32 · exact-run 완료·신뢰 정책·고정 Judge 데이터셋

**개발·수정**

- 원 HTTP 관측의 `executionTrust`를 소비 목적별로 해석하는 `SourceTrustPolicy`를 추가했다. 8082 직접 proxy 관측은 `UNVERIFIED_RUNTIME` 원 Evidence로 보존하지만 coverage, Explorer 시야, lane 완료, dataset lock, 결정적 verdict에는 쓰지 않는다.
- HUMAN·SCANNER·LLM의 정상 종료 조건을 `LaneCompletionPolicy` 하나로 통합했다. 활성 source와 exact run ID, `EXPLORATION`, 응답 Evidence, source별 신뢰 조건을 모두 통과해야 완료된다. ZAP/LLM 실패·취소와 구형 `clear` 경로는 완료가 아니라 abort다.
- 완료 시점의 Evidence ID, 응답 수, coverage 수를 `CompletedRun`으로 동결했다. Judge dataset lock은 세 lane의 동결 ID만 다시 분석하고, lock 후의 live record나 같은 run ID로 늦게 들어온 record가 잠긴 snapshot을 바꾸지 못한다.
- JSON project schema를 v3, SQLite storage schema를 v2로 올려 exact completed run을 저장한다. JSON v1/v2와 SQLite v1은 계속 읽지만 source 이름뿐인 과거 완료 표식은 현재 완료로 승격하지 않아 재실행이 필요하다.
- 저장 시 `completed_lanes`와 `completed_runs`를 동일한 검증된 run 집합에서 생성한다. key/source가 다르거나 Evidence가 없는 완료 객체는 저장 전에 거부하고, 현재 스키마에서 두 목록이 다르면 load를 거부한다.
- beta.29~32 구현 이력에 맞춰 개발 지침의 현재 단계, 인계 기준선, 백엔드 재정비 계획의 교차 구현 상태, 멘토 보고서의 현재 버전·검증 수치·문서 링크를 동기화했다. BolaRay는 본문과 공개 아티팩트를 확인한 근거 수준으로 연구 문서 태그를 교정했다.
- 활성 Markdown 전부의 역할과 최신 상태를 재감사했다. Release 자산은 실제 게시 여부를 확인하지 않은 채 존재한다고 쓰지 않도록 조건부 안내로 바꾸고, 원 기능명세의 포트/XML 요구와 beta.32 MCP 통제 경계를 분리했다. 제품 계획·검증·초기 JGraphX 문서의 과거 상태는 역사 시점으로 표시하고, 제안서·연구 문서의 미검증 성능·신규성 문장은 평가 가설로 낮췄다. `.local/archive`와 버전별 changelog 본문은 현재 동작 정본이 아니므로 역사 사실을 바꾸지 않았다.

**근거와 기각한 대안**

- 기존 source-only `Set<Source>`는 어느 run의 어떤 Evidence가 완료를 만들었는지 증명하지 못했다. 포트 8082에 들어온 외부 요청도 활성 LLM run ID를 물려받았고, 실패한 ZAP 경로가 `clear`만 호출해 완료로 보이는 경로도 있었다. 프롬프트 문구나 UI badge만 고치는 방식은 이 백엔드 무결성 문제를 해결하지 못해 기각했다.
- 원 관측을 삭제하면 포렌식과 분류 개선 재현성을 잃는다. 반대로 모든 관측을 동등하게 분석하면 통제되지 않은 8082 traffic이 독립 Explorer 성과나 Judge 근거를 오염시킨다. 따라서 저장과 소비 자격을 분리했다.
- 전체 event store 재작성은 현재 문제에 비해 변경 폭이 크고 기존 분석 계약까지 흔든다. 이번 단계는 exact completion manifest와 immutable lock snapshot이라는 최소 경계를 도입하고 UI는 동결했다.

**영향 파일·검증·남은 gate**

- 핵심 코드: `SourceTrustPolicy`, `LaneCompletionPolicy`, `RunContextRegistry`, `Pipeline`, `McpServer`, `FlowScopeWebServer`, `FlowScopeExtension`, `ProjectStore`, `SqliteProjectStore`, `LocalLlmRunner`.
- 무작위 run ID의 CONTROLLED/UNVERIFIED 대조, HUMAN·SCANNER·LLM 완료와 abort, 동결 Evidence membership, lock 불변성, JSON/SQLite 왕복과 legacy 비승격·현재 스키마 불일치 거부 회귀를 추가했다. 최종 전체 수치와 JAR digest는 `beta-validation.md`를 정본으로 한다.
- JDK 21 `mvn clean verify` 275 tests가 실패·오류·skip 없이 통과했다. 연속 clean verify의 완성 JAR은 byte-for-byte 동일했고, 단일 배포물은 15,940,500 bytes, 2,046 entries, SHA-256 `a105c9539eddedecc212a66782958165ea890bd0ed5c528dac249f7a22fc2b27`이다.
- 포트 번호만으로 실제 OS 프로세스 신원을 암호학적으로 증명할 수는 없다. 8081은 활성 ZAP run과 outgoing-proxy preflight에 묶지만 장기적으로는 run별 capability가 더 강한 경계다. dataset lock 자체, ZAP native Alert와 주입 prompt digest의 프로젝트 재개는 아직 별도 설계 항목이다.
- beta.32 JAR의 실제 Burp 재로드, 로그인 Codex Explorer의 controlled MCP Evidence 완주, ZAP 실캠페인, 3-lane lock과 Judge 재현은 자동 테스트로 대체하지 않는다.

## 2026-08-31 · 1.2.0-beta.31 · 구독 CLI 자동 탐지·로그인 preflight

**개발·수정**

- Codex/Claude 실행 파일을 축소된 Burp `PATH`뿐 아니라 macOS/Linux/Windows의 표준 사용자 설치 및 런타임 경로에서 자동 탐지하도록 확장했다.
- 로그인 파일이나 실행 후 오류에 의존하지 않고 공급자 CLI가 제공하는 `codex login status`, `claude auth status --json`을 사용해 설치·로그인 상태를 구분한다. 검사 자식에서도 API key를 제거하고 계정 이메일·원출력은 저장하지 않는다.
- 1초 Web polling마다 프로세스를 만들지 않도록 준비 상태를 30초 캐시의 daemon worker에서 갱신한다. Explorer/Judge 시작과 Judge 후속 실행은 직전에 동기 preflight를 다시 통과해야 한다.
- 준비된 provider 자동 선택, provider별 상태 badge, 수동 **다시 확인** fallback을 Web에 추가했다. MCP URL/token, 역할별 allowlist, prompt, 임시 workspace와 Codex home 격리는 기존 launcher가 계속 자동 구성한다.

**영향 파일·검증·남은 gate**

- 코드: `LocalLlmRunner`, `FlowScopeExtension`, `FlowScopeWebServer`, Web UI. 회귀: `LocalLlmRunnerTest`, `FlowScopeWebServerTest`.
- 공식 상태 명령의 로컬 실제 출력은 account 식별자를 제거한 뒤 READY만 확인했다. 전체 회귀·재현 JAR·배포물 수치는 `beta-validation.md`에 기록한다.
- beta.31 JAR을 Burp에 재로드한 실제 Web 자동 선택→MCP target Evidence→Explorer 종료는 수동 통합 gate로 남는다. 비표준 portable 설치는 JVM 절대 경로 override가 fallback이다.

## 2026-08-31 · 1.2.0-beta.30 · 로그인 준비 상태·LLM 작업 피드

**개발·수정**

- 외부 사용자가 공식 Codex/Claude CLI를 설치하고 로그인한 뒤 API key·MCP 수동 설정 없이 Web 버튼으로 실행한다는 계약을 UI와 문서에 명시했다.
- Codex는 실행 파일과 `$CODEX_HOME/auth.json` 또는 `~/.codex/auth.json`을 분리해 사전 확인한다. Claude는 CLI 발견 상태를 표시하고 실제 로그인 유효성은 공급자 CLI가 실행 시 확인하게 해 provider 내부 인증 저장소를 추측하지 않는다.
- 실행 중 provider JSONL을 32 KiB/line, 200 event로 제한해 `SYSTEM/MODEL/TOOL/EVIDENCE/ERROR` 활동으로 변환했다. 64 KiB 마스킹 output tail과 별도로 Web이 1초마다 동기화하므로 종료 전에도 진행 상황을 확인할 수 있다.
- reasoning/thinking event와 raw tool argument/result는 저장·표시하지 않는다. MCP token과 API key는 기존처럼 prompt·status·project에 넣지 않으며 주입 prompt preview도 secret masking과 24 KiB 상한을 거친다.

**검증 및 남은 gate**

- 구조화 event·실시간 tail·reasoning/credential 비노출과 Web 정적 계약 회귀를 추가했다.
- 자동 회귀·재현 JAR·실제 로그인 Codex CLI smoke 결과는 `beta-validation.md`를 정본으로 유지한다. beta.30 JAR을 Burp에 재로드한 실제 MCP 대상 완주는 별도 통합 gate다.

## 2026-08-31 · 1.2.0-beta.29 · Codex Explorer 실행 격리·Evidence 이중 gate

**개발·수정**

- beta.28을 실제 실행한 output tail에서 전역 `ctf-goal` skill 로드, 첫 GET의 write tool 오선택·client 취소, 응답 Evidence 0건인데도 성공 게시된 경로를 확인했다.
- Codex마다 owner-only 임시 `CODEX_HOME`을 만들고 원 home의 `auth.json`만 link해 구독 로그인은 유지하면서 config·skill·plugin·memory·이전 session 상속을 차단했다. 링크가 불가능하면 hard link, 최종 fallback은 owner-only 임시 copy다.
- Explorer의 첫 target operation을 exact entry target의 `flowscope_target_read(method=GET)`로 고정하고, 이후 own-run 응답에서 나온 route candidate를 frontier로 순회하도록 번들 prompt를 수정했다.
- 활성 Explorer의 MCP `tools/list`를 역할에 필요한 8개로 제한해 ZAP·Judge·scope 도구가 선택 후보로 노출되지 않게 하고, 호출 단계 권한 검사도 유지했다.
- MCP의 0-Evidence `end_run` 거부에 launcher-side exact run Evidence 검사를 추가했다. 두 번째 gate 실패 시 잘못 기록된 LLM 완료 lane을 취소하고 실행을 `FAILED`로 게시한다.
- beta.28의 skill-disable 문자열이 실제 격리를 증명했다는 문서 주장을 철회하고 설계·결정·기능 명세·설치·검증·인계 문서를 beta.29 계약으로 동기화했다.

**검증 및 남은 gate**

- `LocalLlmRunnerTest`, `RunContextRegistryTest`, `McpServerTest` 집중 회귀와 `mvn clean verify` 263 tests, 실패·오류·skip 0, 완성 JAR smoke 통과.
- 로컬 로그인 Codex 0.147.0에 임시 home, 동일 feature disable, `--strict-config --ignore-user-config --ignore-rules --ephemeral`을 실제 적용해 `FLOWSCOPE_CODEX_OK` 응답과 exit 0을 확인했다. API key는 사용하지 않았다.
- 같은 소스의 clean verify 2회에서 beta.29 JAR SHA-256 `348c6504…55d89`가 일치했다. 배포물은 15,910,427 bytes, 2,037 entries다.
- 이 smoke는 CLI 로그인·격리 option 호환만 확인한다. beta.29 JAR 재로드 뒤 실제 Burp MCP target read, route frontier, Evidence 저장, 정상 run 종료는 아직 수행하지 않았다.

## 2026-08-30 · 1.2.0-beta.28 · Explorer 성과 gate·ZAP 명시 정의 탐색

**개발·수정**

- Codex Explorer에서 안전한 GET도 destructive tool로 표시돼 취소되고, 응답 Evidence 없이 CLI exit 0만으로 LLM lane이 완료되는 실제 실패를 확인했다. MCP를 GET·HEAD·OPTIONS 전용 read와 승인형 write로 분리하고, EXPLORATION 종료에 같은 run의 응답 Evidence를 필수화했다.
- `--ignore-user-config`만으로 전역 `ctf-goal` skill이 제거되지 않는 로컬 Codex 0.147.0 동작을 확인했다. beta.28은 발견한 user/plugin skill과 관련 feature를 비활성화하는 인자를 추가했지만, beta.29 실실행에서 이 방식도 전역 skill을 제거하지 못한 사실이 확인돼 임시 home 격리로 대체됐다.
- ZAP이 FlowScope SCANNER listener를 우회하면 스캔은 성공처럼 보여도 Evidence가 0건이 되는 경로를 막기 위해, 대상 전송 전에 Network API로 outgoing proxy enabled와 허용 host·8081을 검사한다.
- 운영자가 이미 가진 OpenAPI·GraphQL·Postman·SOAP 정의를 Web/MCP에서 최대 20개 입력할 수 있게 했다. URL과 GraphQL endpoint는 exact scope로 제한하고, 신원별 fresh Context에서 정의별 최대 1,000 message로 import한다. 정의가 상태 변경 요청을 만들 수 있어 별도 Burp 승인을 요구한다.
- 정의 import는 `ZAP_API_IMPORT` 단계로 분리하고 성공 수와 형식별 실패 원인을 lane에 표시한다. 일부 정의 실패가 Traditional·Client·AJAX·passive Evidence를 폐기하지 않도록 경고 완료로 보존한다.
- README, 한국어·영어 설치/변경 이력, 아키텍처, 결정 기록, 기능 명세, UI 근거, 개발 계획, 검증 기록과 인계 정본을 beta.28 동작에 맞췄다.

**근거와 기각한 대안**

- ZAP 공식 탐색 가이드는 modern app에서 Traditional Spider와 Client Spider, API 정의 import를 함께 사용하도록 안내한다. 정의 import는 실제 operation 요청을 만들 수 있으므로 passive scan과 같은 무승인 단계로 분류하지 않았다.
- FlowScope가 사용자의 ZAP 전역 proxy를 자동 변경하면 다른 점검 세션에 영향을 주므로 기각했다. 현재는 요구 상태를 읽고 불일치 시 대상 트래픽 전에 실패한다.
- LLM 프롬프트에 “기존 결과를 보지 말라”고만 쓰는 방식은 실제 user skill/plugin surface를 제거하지 못해 기각했다. 프로세스별 feature/skill disable과 서버 가시성 격리를 함께 사용한다.

**검증 및 남은 gate**

- `mvn clean verify`: 258 tests, 실패·오류·skip 0, 완성 JAR manifest/classloader smoke 통과.
- 같은 소스의 clean verify 2회에서 beta.28 JAR SHA-256 `87aace2e…d1f4` 일치.
- `bash -n scripts/*.sh infra/zap/start-zap.sh`, `git diff --check`, `scripts/doctor.sh` 통과. doctor는 로컬 port, ZAP 2.17.0 API/upstream/add-on, Codex 0.147.0, Claude 2.1.236을 실패·경고 0으로 확인했다.
- 배포물: `target/flowscope-1.2.0-beta.28.jar`, 15,909,724 bytes, 2,037 entries, SHA-256 `87aace2eb47d97b721196714a21fbc5faff2e37f178c8b037c8be447d1fdd1f4`.
- 실제 beta.28 Burp 재로드 뒤 Explorer target read와 0-Evidence 실패 UI, 실제 ZAP 네 형식 정의·복수 계정 campaign, 3-lane lock, Judge 재현·대조는 아직 수행하지 않았다. 로컬 PowerShell과 원격 GitHub Actions도 미검증이다.

## 2026-08-30 · 1.2.0-beta.27 · 안전 ZAP 기준선·구독 CLI PATH 복구

**개발·수정**

- beta.26 live 캠페인이 ZAP의 passive 설정을 사용자 상태에 맡기고 Client 실패/0건일 때만 AJAX를 실행하며 Alert 상세를 첫 500개만 저장하는 코드를 확인했다. `ZapClient`에 passive engine, 전체 passive rule, scope-only, Alert count API를 추가했다.
- `McpServer`가 target traffic 전에 ZAP version과 `spider/client/spiderAjax/pscan/pscanrules/selenium/openapi/websocket` add-on을 검사한다. 신원별 fresh session에서 선택 target origin·path subtree만 포함하는 Context를 만들고 passive 설정을 명시 적용한 뒤 Traditional → Client → AJAX → passive queue → paginated native Alert 순서를 고정했다.
- Client/AJAX 단계의 실패·0 capture를 다른 Evidence와 함께 `COMPLETED_WITH_WARNINGS`로 보존한다. Alert는 500개씩 읽어 신원별 최대 20,000개를 account/run 태그와 함께 메모리 snapshot에 저장하고 초과를 경고한다.
- `LocalLlmRunner`가 해석한 Codex/Claude 실행 파일 부모를 자식 `PATH` 앞에 한 번만 추가한다. provider API key 제거와 loopback MCP 경계는 유지했다. 운영체제별 `PATH` 키 대소문자도 보존한다.
- `scanOnlyInScope`가 ZAP Context를 읽는 계약을 확인해 Context 없이 scope-only만 켜 생길 수 있는 passive 미탐을 수정했다. context regex는 sibling path·subdomain·다른 scheme/port를 거부하는 회귀로 고정했다.
- Session Broker의 ACTIVE 계정별 메모리 인증 주입, Explorer exact-scope executor, 별도 Judge dataset lock, 반복 재현·정상 대조 Evidence gate는 이미 구현돼 있어 중복 코드를 만들지 않고 기존 회귀와 전체 회귀로 재검증했다.
- 영향을 받은 사용자·구조·결정·명세·설치·검증·인계 문서와 버전/JAR 이름을 beta.27로 동기화했다.

**근거와 기각한 대안**

- ZAP 공식 문서상 passive scanner는 메시지를 변조하지 않고 HTTP/WebSocket traffic을 분석하며 전체 rule 활성화와 scope-only API를 제공한다. OpenAPI add-on은 spider가 발견한 in-scope 정의를 자동 import한다.
- Forced Browse는 wordlist 항목을 실제 요청하고 thread 수에 따라 대상 부하를 높이며 ZAP 2.17 local API에 자동화 component가 없어 기본 버튼에서 제외했다. Active Scan·Fuzzer·mutation은 별도 승인 경계를 유지한다.
- Alpha/Beta add-on을 강제 설치하지 않고 현재 설치된 passive scanner는 `enableAllScanners`로 모두 활성화한다. 공개 기본 계약은 ZAP 2.17 release add-on 기준으로 유지한다.

**검증 및 남은 gate**

- 축소 `PATH=/usr/bin:/bin`에서 `/usr/bin/env node --version`이 `env: node: No such file or directory`, status 127로 실패하고 `/opt/homebrew/bin` 추가 후 status 0으로 성공하는 조건을 로컬 재현했다.
- 로컬 ZAP read-only API에서 version `2.17.0`, 필수 add-on 8개 설치, passive scanner 61개를 확인했다. 실제 캠페인과 ZAP 전역 설정 변경은 beta.27 JAR 재로드 전 실행하지 않았다.
- `mvn clean verify`: 253 tests, 실패·오류·skip 0, 완성 JAR manifest/classloader smoke 통과.
- 같은 소스에서 `mvn clean verify`를 다시 실행해 beta.27 JAR SHA-256이 `8c0235…fd62`로 동일함을 확인했다.
- `bash -n scripts/*.sh infra/zap/*.sh`와 `git diff --check` 통과. 현재 macOS에 `pwsh`가 없어 수정된 `doctor.ps1`의 로컬 parser gate와 원격 CI는 아직 실행하지 않았다.
- 배포물: `target/flowscope-1.2.0-beta.27.jar`, 15,900,678 bytes, 2,035 entries, SHA-256 `8c0235d47aa61055984cdd4902f721f482072393d4644a8321512fb18a5ffd62`.
- 실제 Burp에서 beta.27 JAR을 재로드한 뒤 ZAP 계정별 capture·Alert pagination, Codex Explorer 정상 종료, 3-lane lock, Judge 재현·대조까지 확인하는 통합 gate는 아직 수행하지 않았다.

## 2026-08-30 · 1.2.0-beta.26 · ZAP HAR SCANNER Evidence 가져오기

**개발·수정**

- beta.20과 beta.22 이력을 포함해 현재 Web 업로드 경로를 코드로 확인한 결과, 스캐너 버튼도 `.xml`과 `/api/import-xml`만 사용하고 ZAP HAR 어댑터는 없었다. 기존 기능으로 잘못 보고하지 않고 신규 기능으로 구현했다.
- `HarParser`가 HAR 1.2 `log.entries`의 method, URL/path/query, headers, postData, status, response content, startedDateTime을 `SCANNER/HAR_IMPORT/ZAP/IMPORT/IMPORTED` record로 변환한다. 인증 원문은 fingerprint 뒤 Masking을 거치고 현재 exact scope 밖 entry는 저장하지 않는다.
- 파일 25MiB, JSON 깊이 128, token 1,000,000과 기존 payload 1MiB/압축 총량 48MiB 경계를 적용했다. 오류 entry는 나머지 파일과 분리해 skip하고, status 0은 response-less candidate로 유지한다. base64 textual body는 엄격 UTF-8, binary/손상 textual body는 metadata-only로 처리한다.
- Web 스캐너 입력을 `스캐너 XML/HAR`와 `.xml,.har`로 바꾸고 확장자에 따라 전용 localhost API를 호출한다. 서버는 HAR source를 SCANNER로 고정한다. HAR가 담지 않는 native Alert·scanner completion을 생성하지 않는다.
- 영향을 받은 코드는 `HarParser`, `StoredPayload`, `SourceDetail`, `FlowScopeWebServer`, `FlowScopeExtension`, `Standalone`, `index.html`이고 회귀는 `HarParserTest`, `FlowScopeWebServerTest`다. 사용자·구조·결정·UI·검증·인계 문서를 같은 작업 단위로 갱신했다.

**검토한 대안**

- HAR creator metadata를 믿어 source를 자동 결정하는 방식은 입력 파일이 조작 가능해 기각했다. 이번 계약은 ZAP export를 명시적으로 고른 스캐너 입력에 한정한다.
- HAR에서 native Alert나 캠페인 완료를 추론하는 방식은 HAR HTTP message 형식에 없는 정보를 창작하므로 기각했다. Alert가 필요한 비교는 live ZAP 캠페인의 별도 API 수집을 유지한다.
- binary base64를 replacement character가 든 String으로 저장하는 방식은 원 Evidence를 왜곡하므로 metadata-only로 남긴다.

**검증 및 남은 gate**

- `HarParserTest`: 5 tests. textual/base64/binary, response-less, malformed entry, exact-scope, 잘못된 문서 경계 통과.
- `FlowScopeWebServerTest`: scanner-only HAR API, `.xml,.har` UI, snapshot source 계약 통과.
- 전체 `mvn clean verify`: 249 tests, 실패·오류·skip 0 + 완성 JAR smoke 통과.
- 배포물: `target/flowscope-1.2.0-beta.26.jar`, 15,896,042 bytes, 2,034 entries, SHA-256 `ca5d969fb4d056e35b9dd6c420d211131f3a806c4105a5ec69ce7a45d762f232`.
- 실제 ZAP 2.17 UI가 내보낸 HAR를 beta.26 Burp에서 업로드하는 수동 gate와 원격 CI는 아직 수행하지 않았다. HAR import는 live campaign 완료나 취약점 탐지 성능 검증을 대체하지 않는다.

## 2026-08-29 · 1.2.0-beta.25 · streaming manifest·버전 독립 MR-JAR 패키징

**개발·수정**

- beta.24 JAR을 실제 `JarInputStream`으로 읽어 manifest가 `null`인 결함을 재현했다. 원인은 MR-JAR 경로 후처리 뒤 일반 Ant `<zip>`이 manifest를 선두에 배치하지 않은 것이었다.
- 재압축을 manifest-aware Ant `<jar>`로 바꾸고 staging manifest의 중복 입력을 제외했다. 완성 JAR 첫 엔트리는 `META-INF/MANIFEST.MF`가 되며 `JarInputStream`에서 Main-Class·Java-Version·Multi-Release를 읽는다.
- Jackson·jsoup·SnakeYAML의 Java 9/11/17/21별 `<move>`를 `META-INF/versions/*` fileset과 정규식 mapper 세 개로 교체했다. 새 Java version 디렉터리가 같은 package prefix로 추가돼도 POM의 숫자 목록을 수정하지 않는다.
- `FatJarIsolationSmoke`를 Maven `verify` phase에 연결했다. 로컬과 CI의 `mvn clean verify`가 완성 JAR의 streaming manifest, relocated MR class 실제 선택, Jackson 파싱, SQLite 격리 classloader 동시 연결까지 검사한다.

**검증 및 남은 gate**

- 전체 `mvn clean verify`: 243 tests, 실패·오류·skip 0 + 완성 JAR smoke 통과.
- 배포물: `target/flowscope-1.2.0-beta.25.jar`, 15,884,423 bytes, 2,031 entries, SHA-256 `6d422a88e78961ca50b92e2d78aa4ccf93af0026020a6a40badb2d447f74a34c`.
- JAR 첫 엔트리 `META-INF/MANIFEST.MF`, `JarInputStream` manifest 값 4개, 고정 `Created-By`, 원 versioned package 누출 0, 동일 소스 clean package 2회 SHA-256 일치를 확인했다.
- 실제 Burp load/unload와 외부 SBOM·서명 도구 호환성, 원격 GitHub Actions는 아직 수행하지 않았다.

## 2026-08-29 · 1.2.0-beta.24 · 판정 오라클·신원·게시 스냅샷 하드닝

**개발·수정**

- `ResponseEvidence`가 generic `id`뿐 아니라 최종 자원 타입과 결합된 `orderId/order_uuid/orderNo/orderSeq` 및 generic `uuid/guid/pk`를 구조화 값으로 비교하도록 수정했다. 부모 자원 ID만 보인 응답은 최종 자원 노출 근거로 승격하지 않는다.
- soft-deny는 JSON 전체 문자열이 아니라 최상위 `error/errors/message/detail/title/reason` 오류 봉투만 검사한다. 비 JSON 오류는 앞 2,048자만 검사하고, 1,000,000자·깊이 128·token 100,000·순회 node 100,000 상한을 넘는 구조화 응답은 근거 없음으로 종료한다.
- 빈 지문은 `unresolved`로 보존해 실제 `anon`과 분리했다. 세션 service를 계정과 같은 canonical `scheme://host:port`로 정규화하고, 바인딩 해제 뒤 같은 레코드를 다시 분석해도 옛 계정 ID가 남지 않는 회귀를 추가했다.
- `UNKNOWN` 역할은 요구 권한을 충족한 정상 대조 계정으로 인정하지 않도록 Judge gate를 수정했다.
- `AnalysisConfig`의 일곱 정책 맵을 하나의 monitor로 보호하고 `replaceWith`, account check/put, snapshot copy를 원자화했다. Burp/Web/MCP/Standalone 게시 분석은 수집 레코드의 `analysisCopy`와 정책 복사본에서 실행하고, raw byte vault는 process-local runtime ID로 원 레코드와 분석 복사본을 연결한다.
- `CellKey`의 구분자 위험 입력과 Evidence digest 입력은 delimiter join 대신 길이 접두 framing으로 바꿨다. 일반 cell stable key는 유지하고 beta.23 이하 newline digest는 감지·이행해 기존 finding/review/Evidence ID를 보존한다. LF 헤더 본문에 CRLF 빈 줄이 있어도 가장 이른 헤더 구분자를 사용한다.
- `ExecutionTrust`, `ResourceReference`, `ReviewDecision`의 공개 주석 언어를 한국어로 통일했다.
- 소유자 판독도 같은 bounded JSON·반복 순회를 사용하게 했다. 대형 응답 회귀가 후단 `DataFlowAnalyzer`의 무제한 정규식 CPU 점유를 실제로 드러내 구조화 JSON 반복 순회, 1,000,000자 입력 상한, 비구조화 fallback 64KiB, 값 1,000개 상한을 추가했다.

**리뷰 판별**

- 중첩 자원의 부모 ID까지 성공 증거로 인정하라는 제안은 최종 객체가 없는 응답을 BOLA 증거로 오인하므로 채택하지 않았다.
- 세션 unbind 뒤 옛 `idn`이 남는다는 제안은 기존 `Normalizer.normalizeAll` 재실행 경로에서는 재현되지 않았다. 불필요한 상태 필드를 추가하지 않고 재분석 회귀만 고정했다.
- 비어 있지 않은 미지원 Authorization은 기존에도 `Fingerprints.of`에서 opaque hash가 되므로 “파서 실패가 모두 blank”라는 원인 설명은 기각했다. 다만 blank 생성자/import 경계는 실제 `anon`과 충돌해 `unresolved`로 분리했다.
- `AccessRole.isBelow`가 `UNKNOWN`에서 false인 것은 미확정 권한을 자동 위반으로 만들지 않는 의도다. 대신 Judge의 BFLA 정상 대조 호출부가 이를 권한 충분으로 역해석한 결함을 `isKnownAndAtLeast`로 수정했다.
- `Gap.risk(int)`와 finding `Severity`는 각각 후보 우선순위와 취약점 심각도라는 다른 의미이므로 하나의 enum으로 합치지 않았다.

**검증 및 남은 gate**

- 전체 `mvn clean verify`: 243 tests, 실패·오류·skip 0.
- 배포물: `target/flowscope-1.2.0-beta.24.jar`, 15,924,691 bytes, 2,031 entries, SHA-256 `e7ccd253d08399b675feced3908ba76873ef2680124cc2e1281102cbb441f5f5`. ZIP·Main-Class·Java 21·Multi-Release manifest 검증 통과.
- beta.24 JAR의 실제 Burp load/unload·프로젝트 저장/재열기는 아직 수행하지 않았다.

## 2026-08-29 · 1.2.0-beta.23 · 배포물 라이선스·격리·CI 하드닝

### 목표와 성공 조건

- fat JAR이 실제 포함한 모든 Apache NOTICE와 제3자 라이선스 텍스트를 보존하고 고지의 저작물 귀속을 정확히 맞춘다.
- relocate 가능한 Java dependency는 base/MR-JAR 전체를 격리하고 sqlite-jdbc JNI는 깨뜨리지 않으면서 실제 classloader 동시 사용을 검증한다.
- 플러그인·Action·셸·JAR 단일성·반복 digest를 CI의 실행 가능한 gate로 만든다.

### 개발·수정

- Shade가 제거하던 Jackson 원 NOTICE를 Apache NOTICE transformer로 병합하고 FastDoubleParser·ThirdParty·Schubfach 라이선스 파일의 보존을 CI에서 검사한다. 프로젝트 NOTICE에서 SnakeYAML을 Jackson/FasterXML 항목과 분리했다.
- Jackson·jsoup·SnakeYAML을 `io.flowscope.shaded`로 relocate했다. 전체 `META-INF/versions/**` 제외를 제거하고 Java 9/11/17/21 class를 보존했다.
- Shade 3.6.0의 MSHADE-406 때문에 versioned class bytecode와 ZIP entry path가 어긋나는 것을 빌드에서 재현했다. package 마지막에 알려진 versioned package path를 결정론적으로 이동하고 고정 timestamp로 JAR을 다시 구성한다.
- sqlite-jdbc는 JNI package 계약 때문에 relocate하지 않았다. 같은 sqlite-jdbc JAR을 parent가 분리된 두 classloader에서 동시에 로드해 두 in-memory connection과 query를 수행하는 회귀를 추가했다.
- clean/resources/compiler/surefire plugin 버전을 POM에 고정하고 JAR manifest의 build-JDK 가변값을 제거했다. GitHub Actions는 commit SHA로 pin했다.
- CI의 glob 기반 단일 JAR 검사를 `find+mapfile`로 교체했다. NOTICE·라이선스·MR-JAR·relocation 누출·manifest, clean package 2회 SHA-256, Bash 5개 `bash -n`·ShellCheck를 검사한다. push는 main, PR은 별도로 유지하고 Dependabot update를 그룹화했다.

### 이유와 기각한 대안

- 원 NOTICE 제거는 Apache-2.0 §4(d) 재배포 조건과 맞지 않고, MR-JAR 전체 제거는 정상 최적화·native-image 구현을 버린다.
- SQLite를 Java package처럼 relocate하면 JNI symbol을 깨뜨릴 수 있어 기각했다. 실제 충돌 재현 없이 저장소를 sidecar로 분리하는 것도 설치·장애 표면을 크게 늘려 기각했다. 현재 의존성의 두 classloader 검증을 먼저 고정하고 실제 충돌이 재현될 때 아키텍처를 재검토한다(D-090).
- mutable action tag와 상속 plugin version은 같은 source의 빌드 입력을 외부 상태에 맡기므로 유지하지 않았다.

### 영향 파일

- 빌드·CI: `pom.xml`, `.github/workflows/ci.yml`, `.github/dependabot.yml`
- 라이선스·회귀: `src/main/resources/META-INF/NOTICE.txt`, `SqliteClassLoaderIsolationTest`
- 버전·사용자 계약: Web version label/test, README와 한영 시작/변경 문서
- 정본 문서: architecture, decisions D-090, product plan, beta validation, handoff, development log

### 검증

- 최초 배포물에서 Jackson NOTICE 부재, 원 패키지 jsoup/SnakeYAML 노출, MR-JAR 0개, glob zero-match 검사 결함을 파일/JAR 기준으로 재현했다.
- `mvn clean verify`: 224 tests, 실패·오류·skip 0. SQLite 독립 classloader 두 개의 동시 연결 회귀 포함.
- 완성 fat JAR을 두 독립 classloader로 직접 로드해 JDK 21의 Jackson 21/jsoup 11/SnakeYAML 9 versioned resource 선택, relocated Jackson JSON 파싱과 SQLite 동시 query smoke를 통과했다.
- Bash 5개가 `bash -n`과 로컬 ShellCheck를 통과했다. 같은 입력의 clean package 2회 SHA-256이 일치했다.
- 최종 artifact 크기·entry·SHA-256은 `beta-validation.md`에 기록한다.

### 남은 한계·다음 gate

- 원격 GitHub Actions는 push 전이라 아직 실행하지 않았다. macOS 로컬에서는 PowerShell parser를 실행하지 않았고 기존 Windows CI gate만 유지했다.
- 두 classloader 검증은 현재 sqlite-jdbc/JVM 조합의 실제 동시 로드를 확인하지만 임의의 미래 Burp 확장 조합에서 충돌 확률 0을 증명하지 않는다.
- beta.23 JAR을 실제 Burp Community에서 load/unload하고 SQLite 프로젝트 저장·재열기를 확인해야 한다.

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

## 2026-08-26 · HUMAN exploration 경계 분리

### 목표와 성공 조건

- 로그인 세션 준비와 HUMAN pass 밖의 scope 내 요청을 삭제하지 않으면서 3-way coverage·gap에서 제외한다.
- Web quick-start에서 명시적으로 시작한 HUMAN `EXPLORATION` pass만 HUMAN 발견 성과로 계산한다.
- 로그인 캡처는 독립 phase로 남겨 향후 세션 감사와 discovery를 구분할 수 있게 한다.

### 재현·개발

- 변경 전 `TrafficClassifierTest`에 HUMAN `BASELINE` JSON API가 Evidence로는 남지만 coverage에서는 빠져야 한다는 회귀를 먼저 추가했다. 기존 코드에서 `coverageRecords` 1건이 남아 예상대로 실패했다.
- `RunPhase.SESSION_SETUP`을 추가하고, 명시적 Session Broker 로그인 캡처 중인 HUMAN 요청에만 해당 phase를 부여했다. 활성 HUMAN run context가 있으면 기존처럼 그 context의 `EXPLORATION`이 우선한다.
- `TrafficClassifier`가 HUMAN `SESSION_SETUP`/`BASELINE`을 `EXCLUDE` 하되 `RequestRecord`는 보존하도록 했다. operation override로도 이 run 경계를 우회할 수 없다.
- 저장된 프로젝트가 새 phase 규칙으로 재분류되도록 classifier version을 2로 올렸다.
- 무네트워크 온보딩 샘플의 HUMAN 레코드는 실제 탐색 산출물이므로 `EXPLORATION`으로 정정했다.

### 이유와 기각한 대안

scope는 대상 혼입을 막지만 같은 대상 안의 로그인·배경 이동·진단 구간을 구분하지는 못한다. path 정규식은 사이트별 로그인 구현을 일반화할 수 없고 business endpoint를 오분류할 수 있어 기각했다. 그래서 사용자가 이미 조작하는 로그인 캡처와 HUMAN run lease를 재사용했다.

### 영향 파일

- 코드: `RunPhase`, `TrafficClassifier`, `SampleProject`, `FlowScopeExtension`
- 테스트: `TrafficClassifierTest`, `FlowScopeExtensionPhaseTest`, `ProjectStoreTest`
- 문서: README, architecture, decisions(D-063), product plan, beta validation, changelog, 이 개발 기록

### 검증과 남은 gate

- 타겟 회귀: `mvn -Dtest=TrafficClassifierTest,FlowScopeExtensionPhaseTest,SampleProjectTest,ProjectStoreTest test`, 18 tests, 실패·오류·skip 0.
- 전체 `mvn clean verify`: 130 tests, 실패·오류·skip 0, BUILD SUCCESS.
- fat JAR: 2,814,915 bytes, 1,295 entries, ZIP 무결성 통과, `Main-Class=io.flowscope.burp.FlowScopeExtension`, SHA-256 `18460fa70e575ed04d8dfe3500c7c450a5ae413f9480a0af844a45019d4ec3fa`.
- 실제 Burp에서 로그인 캡처 중 요청이 `SESSION_SETUP`, pass 밖 요청이 기본 숨김, HUMAN pass 요청이 분석으로 표시되는지는 수동 beta gate에 남는다.

## 2026-08-26 · REVIEW를 메인 비교와 분리

### 목표와 성공 조건

- 애매한 요청과 반복 polling을 삭제하지 않으면서 확정 `INCLUDE`와 같은 graph·3-way gap 입력으로 취급하지 않는다.
- `INCLUDE/REVIEW/EXCLUDE` 수량이 서로 겹치지 않아 사용자가 분류 영향을 바로 확인할 수 있게 한다.
- UI와 Judge 모두 REVIEW Evidence에 다시 접근할 수 있어야 한다.

### 재현·개발

- 변경 전 동일 `/status` 응답 3건이 `BACKGROUND/REVIEW`로 표시되면서도 `coverageRecords` 3건에 모두 들어가는 실패 회귀를 먼저 재현했다.
- `TrafficClassification.coverageEligible()`을 `INCLUDE` 전용으로 좁히고 Pipeline의 excluded/review 집계를 처분별로 분리했다. MCP status의 excluded 수도 `captured - coverage` 계산 대신 실제 `EXCLUDE`만 센다.
- Web Evidence 표에 처분 필터를 추가했다. 기본은 `INCLUDE+REVIEW`이고 `EXCLUDE`는 사용자가 펼칠 수 있다. 메인 graph·matrix·gap은 기존 server coverage 입력을 사용하므로 `REVIEW`가 섞이지 않는다.
- MCP Judge 지침은 잠긴 후보뿐 아니라 paginated Evidence의 `REVIEW`를 별도 triage하도록 수정했다. REVIEW나 gap 자체는 취약점 증거로 승격하지 않는다.
- MCP 회귀 fixture가 API 응답임을 JSON body만으로 암묵 가정하던 부분은 실제 분류 입력인 `responseContentType=application/json`을 명시했다.

### 이유와 기각한 대안

REVIEW를 삭제하면 미탐을 복구할 수 없고, 계속 메인 graph에 넣으면 노이즈와 확정 coverage가 섞인다. 검증되지 않은 가중치 임계값은 ground truth와 calibration이 없으므로 추가하지 않았다. 따라서 Evidence 보존과 메인 비교 정확도를 분리하는 세 상태를 유지했다(D-064).

### 영향 파일

- 코드: `TrafficClassification`, `Pipeline`, `McpServer`, Web `index.html`
- 테스트: `PipelineClassificationTest`, `McpServerTest`, `FlowScopeWebServerTest`
- 실행 지침: `agent-workspace/prompts/judge.md`
- 문서: 한국어/영어 README·changelog, architecture, decisions(D-064), research, product plan, UI rationale, beta validation, 이 개발 기록

### 검증과 남은 gate

- 최초 실패: `mvn -Dtest=PipelineClassificationTest test`, REVIEW 3건이 coverage 3건이라 assertion 실패.
- 타겟 회귀: `mvn -Dtest=PipelineClassificationTest,TrafficClassifierTest,McpServerTest,FlowScopeWebServerTest test`, 38 tests, 실패·오류·skip 0.
- 전체 `mvn clean verify`: 131 tests, 실패·오류·skip 0, BUILD SUCCESS.
- fat JAR: 2,815,071 bytes, 1,295 entries, ZIP 무결성 통과, SHA-256 `5f0d60e74ae9778619c668bbc0e53797712e52ca5da7d1dbd1e6ee3cd87f95c8`.
- 1280×720 standalone: 파싱 결과 10행 → REVIEW 해제 9행 → INCLUDE도 해제 0행 → REVIEW만 선택 1행. REVIEW 상세의 `분석에 포함` 조작 노출, page overflow 0, console error 0.
- 실제 Burp Web UI에서 실제 대상 REVIEW operation 승격을 확인하는 수동 gate와 blind benchmark의 REVIEW 수·승격률 측정은 남아 있다.

## 2026-08-26 · 공개 Burp JAR 단일화

### 목표와 성공 조건

- `mvn clean verify` 뒤 사용자가 선택할 `target/*.jar`는 Burp용 fat JAR 한 개뿐이어야 한다.
- `clean` 없이 package를 반복해도 기존 fat JAR을 다시 shade하지 않고 동일 산출물을 만들어야 한다.
- 자동 테스트, manifest, ZIP 무결성과 Maven 주 artifact 계약을 유지한다.

### 재현·개발

- 변경 전 clean build의 `target/`에 fat JAR과 `original-flowscope-1.2.0-beta.3.jar` 두 개가 남는 것을 재확인했다.
- Shade 공식 parameter에는 교체 전 `original-*` 보관 파일을 삭제하는 옵션이 없음을 확인했다. 공식 AntRun 3.2.0을 Shade 뒤 같은 package phase에 배치해 정확한 intermediate 이름만 삭제하고 `target/*.jar`가 1개가 아니면 빌드를 실패시켰다.
- 첫 수정 뒤 non-clean package에서 Jar 플러그인이 기존 fat JAR을 입력으로 재사용해 중복 resource warning과 다른 크기를 만드는 결함을 추가 발견했다. Maven Jar 공식 문서가 Shade 같은 후처리 플러그인에는 `forceCreation=true`를 요구하므로 이를 명시했다.

### 이유와 기각한 대안

README에서 파일명을 구분하라는 안내만으로는 실제 오선택을 막지 못했다. Shade의 attached classifier는 thin·fat 두 JAR을 계속 노출하고, `outputFile`은 프로젝트 주 artifact를 교체·attach하지 않아 install/deploy 계약을 바꾼다. 기존 주 artifact 교체 방식을 유지하면서 공개 intermediate만 제거하는 최소 변경을 선택했다(D-058).

### 영향 파일

- 빌드: `pom.xml`
- 문서: 한국어/영어 README·changelog, decisions(D-058), product plan, UI rationale, beta validation, 이 개발 기록

### 검증과 남은 gate

- `mvn clean verify`: 131 tests, 실패·오류·skip 0, BUILD SUCCESS.
- 이어서 `clean` 없이 `mvn -DskipTests package` 재실행: 두 실행 모두 `target/*.jar` 1개, 크기 2,815,427 bytes, SHA-256 `32d7f4d4cd9651e1df4f9ca714e7deab6895f10a2080dc09b12ea3a8dd2362d3`로 동일.
- 1,295 entries, ZIP 무결성 통과, `Main-Class=io.flowscope.burp.FlowScopeExtension`, Java 21.
- 현재 재생성 JAR을 Burp Community에서 신규 load/unload하는 확인은 수동 release gate에 남는다.

## 2026-08-26 · 0-Evidence 행동 우선 onboarding

### 목표와 성공 조건

- 관측 0건에서는 분석 용어와 0 수치 대신 첫 실행 순서와 시작 조작만 보여 준다.
- Evidence가 생기면 기존 분석 작업면을 그대로 사용해 기능이나 분석 모델을 중복 구현하지 않는다.
- ADMIN이 기본 요구라는 오해를 없애고, 실제 브라우저에서 전환·overflow·console 상태를 확인한다.

### 재현·개발

- 실제 빈 standalone 프로젝트에서 좌측 필터, 권한·세션, 3-way gap, 그래프 조작과 0 상태가 처음부터 노출되는 D-057을 재현했다.
- 0건이면 `exact scope → 로그인/HUMAN pass → ZAP 기준선 → 독립 LLM Explorer/Judge` 네 단계, `빠른 시작 열기`, `샘플로 화면 익히기`만 노출하는 empty workspace를 추가했다.
- BOLA에는 서로 다른 최소 권한 계정 두 개를 권장하고 ADMIN은 BFLA 역할 비교가 필요할 때만 추가한다는 경계를 같은 화면에 명시했다.
- 샘플 또는 실제 Evidence가 생기면 기존 graph/matrix/detail 작업면으로 전환한다. 계정 설정은 빈 상태에서도 기존 화면을 재사용한다.

### 영향 파일

- Web UI: `src/main/resources/web/index.html`
- Web 계약 테스트: `src/test/java/io/flowscope/FlowScopeWebServerTest.java`
- 문서: 한국어/영어 README·changelog, architecture, decisions(D-057), UI rationale, product plan, beta validation, 이 개발 기록

### 검증과 남은 gate

- `FlowScopeWebServerTest`: 10 tests 통과.
- `mvn clean verify`: 131 tests, 실패·오류·skip 0, BUILD SUCCESS.
- 1280×720 standalone 실제 0-Evidence 화면에서 분석 rail/stage/detail 비노출, quick-start 모달, 샘플 뒤 분석 화면 전환, body overflow 0, console error 0을 확인했다.
- fat JAR: 2,816,191 bytes, 1,295 entries, ZIP 무결성 통과, `Main-Class=io.flowscope.burp.FlowScopeExtension`, SHA-256 `37bd1de531f0a837311b6830192b214fd6709e695280cab0fcc3594ef42b6232`.
- 현재 재생성 JAR의 Burp Community load/unload와 Burp에서 연 Web UI의 실제 0건→수집 전환은 수동 release gate에 남는다.

## 2026-08-26 · 인가 oracle 오탐 경계 강화

### 목표와 성공 조건

- 거부·메타데이터 응답이 소유자 확정값을 만들지 못하게 한다.
- 로그인과 비슷한 정상 redirect 경로를 deny로 오인하지 않는다.
- owner 문자열만으로 BOLA 객체 포함 및 최종 `CONFIRMED` gate가 통과하지 못하게 한다.
- 근거가 부족한 응답은 삭제하거나 정상 판정하지 않고 미확정으로 보존한다.

### 실패 재현과 수정

- 403 응답과 HEAD 200 응답의 owner 필드가 기존 코드에서 확정 owner로 등록되는 실패를 재현했다. owner 수집을 성공한 2xx OPTIONS/HEAD 이외 응답으로 제한했다.
- `/authority/profile`이 `/auth` 부분문자열 때문에 login redirect `DENY`가 되는 실패를 재현했다. 로그인·인가·오류 목적지는 완전한 경로 세그먼트만 일치시킨다.
- 응답에 대상 객체 ID가 없고 owner 문자열만 있어도 `showsObject`가 참이 되는 실패를 재현했다. 구조화 JSON의 `id` 또는 비JSON의 명시적 `id` 필드가 대상 resource ID와 일치해야 객체 Evidence로 인정한다.
- owner 값은 이메일·subject·내부 계정 ID 등 표현이 다르므로 객체 판독기에서 내부 identity 문자열과 직접 비교하지 않는다. 소유자 oracle은 별도로 확정하고, 객체 판독기는 대상 ID만 담당한다(D-065).

### 영향 파일

- 판정: `AuthorizationAnalyzer.java`, `ResponseEvidence.java`
- 회귀: `AuthorizationAnalyzerTest.java`, 신규 `ResponseEvidenceTest.java`
- 문서: 한국어/영어 README·changelog, architecture, decisions(D-065), product plan, beta validation, 이 개발 기록

### 검증과 남은 gate

- 수정 전 집중 테스트는 owner/HEAD와 redirect 2건, 객체 Evidence 2건에서 의도대로 실패했다.
- 수정 후 인가·객체 Evidence·MCP 최종 gate 집중 30 tests 통과.
- `mvn clean verify`: 137 tests, 실패·오류·skip 0, BUILD SUCCESS.
- fat JAR: 2,815,952 bytes, 1,295 entries, ZIP 무결성 통과, SHA-256 `72afef648e657ae36a2dcac75f298e69c43a475f0af666870a4fdcd2fb8eb51b`.
- 대상 응답이 객체 ID를 반환하지 않으면 자동 BOLA read 확정은 `UNDECIDED/INCONCLUSIVE`에 남는다. 실제 Burp 로그인·ZAP·Explorer/Judge 전체 workflow와 blind benchmark는 아직 통과 처리하지 않는다.

## 2026-08-26 · 신원 격리 Session Broker·ZAP·LLM 실행

### 목표와 성공 조건

- USER A/B 세션이 같은 서비스에서 섞이지 않고 성공 응답 확인 전 자동 배포되지 않는다.
- 비로그인과 선택 계정을 한 번의 사용자 조작으로 실행하되 ZAP 상태는 신원별로 초기화한다.
- 계정 레인의 기존 인증값을 제거하고 broker가 선택한 계정만 주입하며, LLM run 계정도 통제 executor까지 전달한다.
- 신원 하나라도 수집 0건 또는 단계 실패면 SCANNER 완료 gate를 열지 않는다.
- Web 자기 제어면은 scanner target이 되지 않는다.

### 실패 재현과 개발·수정

- 먼저 `UNVERIFIED`, 관리 헤더 목록, run 중 account 전환, `ZapClient.newSession`, Web 복수 계정 API를 요구하는 테스트를 추가했다. 기존 production API가 없어 test compile이 실패하는 것을 확인했다.
- 세션 material만 있고 성공 응답이 없으면 `UNVERIFIED`, 다른 계정이 같은 service에서 캡처 중이면 시작 거부, 명시 실패가 아닌 성공 응답 뒤에만 `ACTIVE`가 되도록 Session Broker를 강화했다.
- 관리형 계정 SCANNER 요청은 Authorization/Cookie/Proxy-Authorization/CSRF를 제거하고 broker 값만 주입한다. 관리형 anonymous ZAP은 fresh session을 전제로 고정 Authorization 계열만 제거하고 해당 레인에서 새로 발급된 Cookie/CSRF는 유지한다. run context가 없는 수동 scanner 요청은 변경하지 않는다.
- ZAP campaign은 비로그인 뒤 선택된 ACTIVE 계정을 순차 실행하고 각 신원 앞에서 `core/action/newSession`을 호출한다. 신원별 stage·수집·Alert·warning/error를 기록하고 Alert에 account/run provenance를 붙인다. 모든 lane 성공 뒤에만 SCANNER exploration을 완료한다.
- Web quick-start를 단일 계정 select에서 비로그인·복수 ACTIVE 계정 checkbox로 바꾸고 신원별 상태를 표시한다. 현재 Web loopback port는 target 목록과 시작 API에서 제외한다.
- LLM `account_id`가 run context 기본값으로 통제 요청에 전달되는 회귀를 추가했다.

### 이유와 기각한 대안

- 한 ZAP session에서 계정만 바꾸면 cookie jar와 crawler 상태가 교차 오염된다. 사용자가 ZAP context를 계정마다 수동 구성하는 방식은 자동화·재현성을 잃어 기각했다.
- anonymous에서 Cookie를 매 요청 삭제하면 서버가 해당 레인에 발급한 익명 session/CSRF까지 끊기므로 fresh-session 경계와 함께 lane-local 상태를 유지한다.
- 모든 localhost를 막으면 crAPI 같은 허가된 로컬 대상을 점검하지 못하므로 FlowScope Web의 실제 port만 차단한다. 결정과 한계는 D-066에 기록했다.

### 영향 파일

- 실행: `SessionBroker.java`, `RunContextRegistry.java`, `ZapClient.java`, `McpServer.java`, `FlowScopeExtension.java`, `FlowScopeWebServer.java`
- UI: `src/main/resources/web/index.html`
- 회귀: `SessionBrokerTest.java`, 신규 `RunContextRegistryTest.java`, `ZapClientTest.java`, `McpServerTest.java`, `FlowScopeWebServerTest.java`
- 문서: 한국어/영어 README·changelog, architecture, decisions(D-066), UI rationale, beta validation, 이 개발 기록

### 검증과 남은 gate

- 첫 집중 실행은 기존 Web 테스트가 material만으로 `ACTIVE`를 기대해 35 tests 중 1건 실패했다. 구현을 약화하지 않고 성공 응답을 포함한 실제 캡처 왕복으로 테스트를 수정했다.
- 수정 후 집중 Session/MCP/ZAP/Web 회귀가 통과했다.
- 1280×720·600×800 standalone에서 비로그인 scanner control, page/modal 가로 overflow 0, 좁은 폭 modal scroll, 신원/target 미선택 버튼 비활성, browser warning/error 0을 확인했다. ACTIVE USER A/B chip은 standalone fixture에 없어 자동 HTML/API 계약까지만 검증했다.
- `JAVA_HOME=/opt/homebrew/opt/openjdk@21 mvn clean verify`: 144 tests, 실패·오류·skip 0, BUILD SUCCESS.
- fat JAR: 2,823,288 bytes, 1,297 entries, ZIP 무결성 통과, 공개 JAR 1개, `Main-Class=io.flowscope.burp.FlowScopeExtension`, SHA-256 `58d5f982270ca5c868e147f5de420ef82a8a1eaf2d32509730353d4c367a41c7`.
- `ACTIVE`는 범용 transport 확인이지 application-specific `/me`, 계정 소유, role 증명이 아니다. ZAP 2.17·현재 Burp JAR·실제 로그인으로 비로그인→USER A→USER B 캠페인과 새 Web control을 확인하는 수동 gate가 남는다.

## 2026-08-26 · 요청 시점 신원 고정과 익명 3-source 실환경 검증

### 목표와 성공 조건

- USER A를 선택했지만 실제 브라우저가 USER B 또는 비로그인인 경우 USER A Evidence로 오기록하지 않는다.
- ZAP 계정 lane 전환 뒤 늦게 도착한 응답도 요청을 시작한 run/account에 남긴다.
- fresh anonymous ZAP lane은 서버 Cookie/CSRF를 유지해도 `ANONYMOUS` 신원을 유지한다.
- 현재 JAR을 Burp Community·ZAP·crAPI·MCP에 실제 연결해 HUMAN/SCANNER/LLM 분리와 exact-scope 차단을 확인한다.

### 실패 가능성 검토와 개발·수정

- 기존 Proxy 응답 경로가 응답 시점의 전역 `RunContextRegistry`를 읽어 ZAP lane 전환과 늦은 응답 사이에 경합이 있음을 확인했다. Proxy 요청의 Montoya `messageId`에 요청 시점 context와 HUMAN login-capture account를 임시 저장하고 응답에서 소비하도록 바꿨다. 테이블은 20,000건·10분 TTL이며 unload에서 비운다.
- 기존 HUMAN pass는 dropdown의 account ID를 그대로 신원으로 사용할 수 있었다. Web 시작 API에서 선택 계정의 broker 상태가 `ACTIVE`인지 검사하고, 캡처에서는 실제 요청 자격증명이 선택 계정과 exact match할 때만 해당 account ID를 사용하도록 바꿨다. 명시적 로그인 캡처 account는 우선한다.
- SYSTEM anonymous ZAP context는 lane 안에서 서버 Cookie가 발급돼도 fingerprint를 `anon`으로 고정했다. 일반 HUMAN·수동 scanner의 미연결 Cookie는 기존 `UNRESOLVED` 경계를 유지한다.
- Web UI 버전 표기를 `v1.2.0-beta.3`으로 맞추고 HUMAN 계정 선택에는 `ACTIVE` 계정만 활성화하며 나머지는 `로그인 필요`로 표시했다.

### 이유와 기각한 대안

- 화면 선택값을 실제 신원 authority로 쓰면 사용자의 단순 선택 실수가 BOLA/BFLA 비교 데이터 전체를 오염시킨다. actual broker credential match를 요구했다.
- 응답 시점 전역 context만 읽는 단순 구현은 비동기 HTTP와 순차 lane 실행에서 안전하지 않다. scanner를 매 요청마다 직렬 대기시키는 방식은 성능을 떨어뜨리고 브라우저형 crawler 동작과 맞지 않아 request-time correlation을 선택했다.
- anonymous Cookie를 모두 제거하면 상태형 공개 흐름을 끊고, Cookie fingerprint를 계정처럼 쓰면 비로그인 lane이 미확정 신원으로 바뀌므로 lane-local 상태와 FlowScope 신원을 분리했다(D-067).

### 영향 파일

- Burp 수집·신원: `src/main/java/io/flowscope/burp/FlowScopeExtension.java`
- Web 실행 gate: `src/main/java/io/flowscope/web/FlowScopeWebServer.java`
- Web UI: `src/main/resources/web/index.html`
- 회귀: `FlowScopeExtensionPhaseTest.java`, `FlowScopeWebServerTest.java`
- 문서: 한국어/영어 README·changelog, architecture, decisions(D-067), UI rationale, product plan, beta validation, 이 개발 기록

### 자동 검증

- 선택 HUMAN account exact match/mismatch, login-capture 우선, source별 account 해석, SYSTEM anonymous Cookie의 `anon` 유지 회귀를 추가했다.
- Web account HUMAN pass는 broker session이 없거나 `ACTIVE`가 아니면 거부하고 활성화 뒤에만 시작되는 회귀를 추가했다.
- `mvn clean verify`: 147 tests, 실패·오류·skip 0, BUILD SUCCESS.
- JDK 21을 명시한 fat JAR: 2,826,076 bytes, 1,298 entries, ZIP 무결성 통과, 공개 JAR 1개, `Build-Jdk-Spec=21`, SHA-256 `e8d41fbdea56101063d59ec27b378de5ee9a06d001c516122eeac8c0446b4cae`.

### 실제 crAPI 연동 검증

- 환경: Burp Community 2026.7.3, ZAP 2.17.0, crAPI `http://127.0.0.1:8888/`, exact scope 동일, HUMAN 8080·SCANNER 8081·ZAP API 8089·MCP 8787·Web 17777.
- HUMAN listener 8080에 `curl`을 프록시로 연결한 `qa-human-anon-1`: `/` 200과 `/favicon.ico` 404 두 건이 listener profile에 따라 `HUMAN/BROWSER/EXPLORATION`으로 수집됐다. 이는 실제 Burp Browser 검증이 아니다. 둘은 `REVIEW`라 메인 coverage에는 자동 포함되지 않았고 첫 dataset lock은 HUMAN 탐색 응답 부족으로 거부됐다. `qa-human-api-2`에서 당시 `API/INCLUDE`로 분류된 `/manifest.json` 200 한 건을 추가했다.
- SYSTEM ZAP `zap-baseline-1787717447157`: `COMPLETED/ALERTS_READY`, 수집 8건, native alert 22건. 8건 모두 `SCANNER/CONTROLLED/ANONYMOUS`; 정적 4건 `EXCLUDE`, `/manifest.json` 1건 `API/INCLUDE`, 나머지 3건 `REVIEW`였다. Alert 22건은 ZAP 출력 수이며 취약점 확정 수가 아니다.
- MCP initialize `2025-06-18`, 도구 24개, status를 확인했다. Codex Explorer context `qa-llm-anon-1`에서 `/manifest.json` 통제 GET 1건을 `LLM/CONTROLLED` Evidence로 만들었고 Explorer status는 자기 LLM 1건만 보였다. 범위 밖 `http://127.0.0.1:17777/` 요청은 거부됐다. run 종료 뒤 HUMAN 3·SCANNER 8·LLM 1, 총 12건을 잠갔고 finding·gap은 각각 0건이었다. 잠긴 ZAP snapshot을 읽을 수 있었고 잠금 뒤 새 Explorer는 거부됐다.
- 최종 JDK 21 JAR SHA-256 `e8d41fbd...6b4cae`를 Burp에서 제거·재로드한 뒤 Web/MCP/8080/8081 재기동과 UI `v1.2.0-beta.3` 표기를 확인했다. 재로드된 정확한 산출물에서도 HUMAN 1·SCANNER 8·LLM 1의 10건 lock, finding·gap 0, ZAP Alert 22건, Explorer 자기 Evidence 1건 시야, 범위 밖 요청 거부가 동일했다.

### 남은 한계·다음 gate

- 실제 USER A/B의 `UNVERIFIED→ACTIVE`, 선택 계정 exact match/mismatch, 복수 계정 ZAP lane과 LLM account injection은 로그인 계정이 필요해 아직 실측하지 않았다.
- 구독형 Codex/Claude가 제공 prompt 전체와 lock 이후 Judge/validation을 끝까지 수행한 것은 아니다. 이번 검증은 동일 MCP protocol을 사용한 실제 통제 요청과 가시성·scope gate까지다.
- Repeater handoff, project save/load, extension unload/재로드는 다음 P4 gate다. crAPI 알려진 정답과 공격 절차는 보지 않았다.

## 2026-08-26 · HUMAN 분류·미요청 경로 계획 재감사

### 목표와 성공 조건

- scanner와 LLM 구현은 동결하고 HUMAN/Burp 트래픽의 business operation 분류, 노이즈, 미요청 경로 표현만 공식 근거와 현재 코드로 재검토한다.
- 현재 JAR이 검증하지 않은 성능을 문서가 완료로 주장하지 않게 한다.
- 임의 가중치나 crAPI 전용 path 없이 테스트 우선 구현 계획을 고정한다.

### 조사·교정

- `TrafficClassifier.isApiMediaType()`가 모든 `+json`을 API로 인정해 표준 `application/manifest+json`도 `INCLUDE`하는 것을 코드에서 확인했다. 현재 테스트에는 manifest 회귀가 없다.
- 실제 스모크 기록과 최종 10건을 대조해 세 source의 유일한 `INCLUDE`가 `/manifest.json`이었음을 확인했다. 따라서 dataset lock은 wiring 검증이지 business API 탐색 품질 검증이 아니다.
- HUMAN 8080 스모크는 실제 Burp Browser가 아니라 `curl` 프록시 전송이었다. listener mapping의 `BROWSER` detail을 실행 도구 증명으로 사용한 문구를 정정했다.
- `AuthorizationAnalyzer.addUncrossed()`가 관측 identity와 관측 operation/resource만 교차하며 미관측 endpoint inventory를 만들지 않는 것을 확인했다.
- `SnapshotJsonWriter`가 추출된 모든 object candidate에 근거 계산 없이 `confidence=1.0`을 넣고 Web UI가 `신뢰도 100%`로 표시하는 것을 확인했다. 측정값으로 오해될 수 있어 P4-H에서 추출 근거 enum으로 교체하도록 계획했다.
- 로컬 Montoya 2026.7 API JAR을 직접 검사해 `MontoyaApi.siteMap()`, `SiteMap.requestResponses(filter)`, `HttpRequestResponse.hasResponse()`가 있음을 확인했다. Community 실제 반환 동작은 구현 전 수동 gate로 남겼다.
- W3C Fetch Metadata·Web App Manifest, PortSwigger Site Map/HTTP history/Montoya 문서, OWASP IDOR/BOLA 지침을 근거로 observed graph와 provenance-backed route candidate를 분리하는 P4-H 계획을 추가했다.

### 영향 파일

- `README.md`
- `CHANGELOG.md`, `docs/en/README.md`, `docs/en/CHANGELOG.md`
- `docs/ko/architecture.md`
- `docs/ko/product-development-plan.md`
- `docs/ko/beta-validation.md`
- `docs/ko/decisions.md` D-067 정정 및 D-068 계획 결정
- 이 개발 기록

### 검증과 남은 gate

- 이번 작업은 조사·계획·기록 정정이며 Java 코드나 JAR을 변경하지 않았다. 기존 147-test/JAR 해시는 새 기능 검증으로 재사용하지 않는다.
- 문서 정정 뒤 `JAVA_HOME=/opt/homebrew/opt/openjdk@21 mvn clean verify`를 다시 실행해 147 tests, 실패·오류·skip 0, BUILD SUCCESS를 확인했다. 결정론적 JAR은 2,826,076 bytes, SHA-256 `e8d41fbdea56101063d59ec27b378de5ee9a06d001c516122eeac8c0446b4cae`로 코드 변경 전과 동일했다.
- 다음 구현은 P4-H H1의 manifest 실패 fixture부터 시작해야 한다. classifier v3, RouteCandidate 저장 모델, graph 표현, 실제 Burp Browser pass가 끝나기 전에는 JAR을 업데이트된 HUMAN 분석 제품으로 부르지 않는다.
- 수치 가중치는 고정 corpus와 블라인드 결과 전에는 정하지 않는다. 현재 D-068은 `열림 · 구현 전 사용자 검토` 상태다.

## 2026-08-26 · 1.2.0-beta.4 · HUMAN 공격면과 미요청 route 분리

### 목표와 성공 조건

- target별 예외나 crAPI 정답을 넣지 않고 사람이 남긴 exact-scope traffic의 business graph 노이즈를 줄인다.
- 실제 request/response와 응답·Site Map에서만 발견된 미요청 route를 별도 모델·수량·시각 문법으로 분리한다.
- 후보가 coverage, 3-way gap, owner, verdict, finding, lane 완료를 오염시키지 않으며 모든 후보에 provenance가 있어야 한다.
- 고정 100% confidence와 임의 수치 가중치를 제거하고 추출·정렬 이유를 노출한다.
- 버전·한국어/영어 사용자 문서·설계·결정·계획·검증 기록을 실제 코드와 맞춘 뒤 전체 회귀, 단일 JAR, 브라우저 QA를 통과한다.

### 개발·수정

- `TrafficClassifier.VERSION`을 3으로 올리고 web manifest, source map, service worker를 `DISCOVERY_METADATA/EXCLUDE`로 분류했다. 한 record의 약한 신호만으로 API를 확정하지 않고 같은 service·정규화 operation에 강한 비사용자-override `API/INCLUDE` Evidence가 있을 때만 immutable discovery gate를 통과한 `REVIEW` 형제를 보강한다.
- `RouteCandidate`와 `RouteCandidateExtractor`를 추가했다. 저장된 exact-scope HTML link/form, `Location`, robots/sitemap, manifest, 정적 fetch/axios/XHR literal, 관측 OpenAPI와 응답 없는 Burp Site Map item을 service·method/unknown·normalized path로 합치고 모든 provenance ID를 보존한다.
- HTML manifest link는 `rel`·`href` 속성 순서와 복수 rel token을 허용한다. `fetch(url)`은 default GET, 정적인 options method는 해당 verb, 동적 options는 `UNKNOWN`으로 보존해 POST를 GET으로 꾸미지 않는다.
- Proxy history 가져오기 때 Site Map을 함께 조회하되 response가 있는 item은 기존 관측 경로에 맡기고, response가 없는 exact-scope item만 `BURP_UNREQUESTED` seed로 보존한다. scope 변경·초기화·sample에서는 stale candidate를 제거하고 project save/load에서 candidate를 왕복한다.
- candidate는 Web snapshot의 별도 root에만 기록하고 관측 `Pipeline.Result`에 주입하지 않았다. Web에는 별도 수량·목록·필터와 중립색·점선 테두리 operation 노드, provenance·적용 가능성·범주형 정렬 근거 상세를 추가했다. source edge와 authorization verdict는 만들지 않는다.
- candidate 정렬은 수치 score가 아니라 적용 가능성, 명시 method, 객체 template, state-changing, 복수 provenance의 사전식 category 순서다. 현재 모델에 없는 authorization 신호는 꾸며 넣지 않았다.
- object detail의 고정 `confidence=1.0`을 `PATH_ID/QUERY_ID/BODY_ID/GRAPHQL_VARIABLE/DERIVED/NONE` 근거로 교체하고 nested/array JSON과 multipart ID 추출을 회귀로 고정했다.
- Maven/MCP/Web/README 버전을 `1.2.0-beta.4`로 맞추고 새 산출물 이름을 `flowscope-1.2.0-beta.4.jar`로 올렸다.

### 이유와 기각한 대안

- Burp Site Map은 requested/unrequested를 구분하고 HTTP history filter는 항목을 삭제하지 않는다. 이 제품도 Evidence 보존과 분석 처분, observed와 candidate를 나눠야 사용자가 “밟은 경로”와 “참조만 본 경로”를 혼동하지 않는다.
- candidate를 HUMAN source edge나 `UNCROSSED`에 넣는 안은 사람이 하지 않은 요청을 coverage로 꾸미므로 기각했다. 모든 link를 GET으로 만드는 안도 method 근거가 없어 `UNKNOWN`으로 남겼다.
- JavaScript AST 전체 해석이나 headless browser 실행을 이번 변경에 넣는 안은 동적 실행 의미와 네트워크 부작용을 일반화할 수 없어 기각했다. 정적 literal만 보수적으로 추출한다.
- 수치 confidence/가중치는 고정 corpus와 blind benchmark 결과 없이 성능처럼 보이므로 기각했다. 화면의 이유 enum과 deterministic category order만 사용한다.

### 영향 파일

- core: `TrafficClassification`, `TrafficClassifier`, `Pipeline`, `Normalizer`, `RouteCandidate`, `RouteCandidateExtractor`
- Burp·저장·Web: `FlowScopeExtension`, `ProjectStore`, `FlowScopeWebServer`, `SnapshotJsonWriter`, `web/index.html`, `McpServer`
- 회귀: `TrafficClassifierTest`, `RouteCandidateExtractorTest`, `AdvancedNormalizerTest`, `ProjectStoreTest`, `FlowScopeWebServerTest`
- 공개 정본: root/영문 README·CHANGELOG, 한국어 architecture·decisions·product plan·UI rationale·beta validation·development log

### 검증

- 변경 전 clean 기준선은 147 tests였다. 새 enum/model/API를 테스트부터 연결한 최초 compile에서는 존재하지 않는 `RouteCandidate`, `DISCOVERY_METADATA`, `resourceEvidence` 참조가 실패했고, manifest fixture는 기존 `API/INCLUDE` 결과 때문에 실패했다. 해당 실패를 구현 후 회귀로 유지했다.
- 최종 `mvn clean verify`: 157 tests, 실패 0, 오류 0, skip 0, BUILD SUCCESS.
- 배포물은 `target/flowscope-1.2.0-beta.4.jar` 하나이며 ZIP 무결성, `Main-Class=io.flowscope.burp.FlowScopeExtension`, Java 21 bytecode 계약을 확인했다. 크기와 digest는 `beta-validation.md`에 기록했다.
- 실제 standalone Web UI를 1280×720과 600×800에서 열어 가로 overflow 0, 잘린 핵심 조작 0, console warning/error 0을 확인했다. 이 검증은 Burp suite tab이나 실제 Site Map item을 대신하지 않는다.

### 남은 한계·다음 gate

- 새 beta.4 JAR을 Burp Community에서 제거·재로드하고 suite tab/Web/MCP/listener 기동을 다시 확인해야 한다.
- 응답 없는 실제 Burp Site Map item이 `BURP_UNREQUESTED`로 나타나고 project 왕복 뒤 provenance가 유지되는지, candidate가 있는 실제 그래프를 확인해야 한다.
- 실제 Burp Browser HUMAN pass로 document/static/API 분류와 REVIEW 작업량을 측정하고 일반 MPA·SPA·GraphQL fixture confusion matrix를 공개해야 한다.
- 저장 응답은 필드별 8KiB이며 route candidate는 관측 operation을 먼저 보존한 뒤 최대 20,000개로 제한한다. 동적 JavaScript·클라이언트 런타임 생성 route는 추측하지 않는다. 모든 endpoint 또는 오탐·미탐 0을 주장하지 않는다.
- 위 gate 전에 crAPI 정답을 보거나 target 전용 규칙을 넣지 않는다. blind benchmark는 사용자 검토 뒤 시작한다.

## 2026-08-26 · 1.2.0-beta.5 · 공통 route discovery 기반

### 목표와 성공 조건

- framework·제품·benchmark target에 종속되지 않은 공통 endpoint 발견 계약을 먼저 고정한다.
- 포맷별 발견과 공통 scope/method/정규화/dedup 판단을 분리한다.
- method·관측 여부·provenance를 추측으로 승격하지 않고 프로젝트 왕복과 Web 상세에서도 대응 관계를 잃지 않는다.
- 일반 protocol fixture, 전체 회귀, 완성 fat JAR runtime, 재현 가능한 단일 배포물 검증을 통과한다.

### 개발·수정

- `RouteDiscoveryDocument`, `DiscoveredRoute`, `RouteDiscoveryAdapter` 계약을 추가하고 `RouteCandidateExtractor`를 공통 gate로 재구성했다. adapter는 네트워크·scope·저장·관측 판정을 수행하지 않는다.
- HTML은 jsoup의 로컬 HTML5 DOM으로 깨진 markup, `<base>`, link/form/formaction/script/embed/meta refresh와 inline static call site를 처리한다. jsoup의 네트워크 API는 사용하지 않는다.
- JavaScript는 fetch, axios verb, XHR.open, jQuery get/post/ajax, sendBeacon의 정적 string literal만 읽고 문자열 결합은 후보로 만들지 않는다.
- OpenAPI/Swagger는 대상 응답에서 관측한 JSON·YAML의 명시 operation과 server/base를 읽는다. 해소할 default가 없는 server variable은 임의 base로 대체하지 않는다.
- metadata는 Location, robots Allow/Disallow/Sitemap, Web App Manifest start_url/scope/id/shortcut을 처리한다. generic XML은 제품명 없이 명시 URL/method field만 읽고 DOCTYPE·외부 entity·외부 DTD/schema를 차단한다.
- 공통 코어가 http(s), exact scope, method token, schema parameter/path 정규화, candidate 상한과 `service + method + normalized path` dedup을 단독 집행한다. 같은 path의 관측 `GET`은 미관측 `UNKNOWN`을 관측으로 승격하지 않는다.
- `RouteCandidate` provenance를 `(type, evidenceId, source, runId, adapter)`로 바꿨다. 저장·복구·snapshot·Web 상세가 이 대응을 유지하며 legacy 분리 배열은 type×Evidence 조합을 꾸며내지 않고 `LEGACY_UNMAPPED/UNKNOWN/legacy-project`로 이관한다. restored/new candidate도 같은 병합 함수로 합친다.
- Jackson YAML 2.22.2, SnakeYAML 2.5, jsoup 1.23.1을 fat JAR에 포함하고 고지 파일을 추가했다. Shade service transformer로 relocated Jackson service metadata를 병합했다.
- Maven/MCP/Web/README 버전을 `1.2.0-beta.5`로 맞췄다.

### 이유와 기각한 대안

- 포맷마다 scope·method·dedup 로직을 복제하면 새 parser를 추가할 때 관측 의미가 달라진다. 그래서 세부 adapter보다 공통 불변조건을 먼저 코드로 고정했다.
- HTML 정규식은 깨진 markup과 `<base>` 해석이 브라우저 DOM과 달라 기각했다. HTML parser는 로컬 입력만 처리한다.
- target 전용 XML element명, crAPI 경로, 기존 취약점 정답은 넣지 않았다. 그런 규칙은 일반 제품 성능을 증명하지 못하고 blind 평가를 오염시킨다.
- 동적 JS 실행·전체 AST·headless browser는 네트워크 부작용과 실행 문맥을 이번 공통 계약에서 일반화할 수 없어 후속 adapter gate로 남겼다.
- 고정 fixture의 0 FP/FN을 제품 성능으로 쓰지 않는다. 같은 fixture는 구현 회귀만 검출하며 blind target 평가는 별도다.

### 영향 파일

- common core/model: `RouteCandidate`, `RouteCandidateExtractor`, `core/discovery/*`
- integration/persistence/Web: `FlowScopeExtension`, `ProjectStore`, `SnapshotJsonWriter`, `web/index.html`, `McpServer`
- build/notices: `pom.xml`, `META-INF/LICENSE-jsoup.txt`, `META-INF/NOTICE.txt`
- regression corpus/tests: `RouteCandidateExtractorTest`, `EndpointDiscoveryCorpusTest`, `endpoint-corpus.json`, `ProjectStoreTest`, `FlowScopeWebServerTest`
- 공개 정본: root/영문 README·CHANGELOG, 한국어 architecture·decisions·product plan·UI rationale·beta validation·development log

### 검증

- `mvn clean verify`: 164 tests, 실패 0, 오류 0, skip 0, BUILD SUCCESS.
- 일반 protocol fixture 7종·truth route 18개: TP 18, FP 0, FN 0. negative CSS, 범위 밖 URL, 동적 JS 결합, XXE, `GET`/`UNKNOWN` 관측 분리를 회귀로 고정했다.
- JDK 21에서 완성 fat JAR만 classpath에 두고 HTML/OpenAPI YAML/XML adapter를 직접 실행해 `FAT_JAR_DISCOVERY_SMOKE_OK`를 확인했다.
- 배포물은 `target/flowscope-1.2.0-beta.5.jar` 하나, 3,787,475 bytes, 1,940 entries, SHA-256 `e5cf26d00aa3446ec9983114d7d8c35eb850d16f815387c14becbb787b087c50`다. ZIP 무결성, `Main-Class=io.flowscope.burp.FlowScopeExtension`, Java 21, dependency class/notice/service entry를 확인했고 연속 non-clean package digest가 동일했다.

### 남은 한계·다음 gate

- beta.5 JAR의 Burp Community 제거·재로드, 실제 응답 없는 Site Map item, 실제 Burp Browser route candidate UI는 아직 수동 검증하지 않았다.
- 고정 corpus는 실제 사이트 분포, minified/bundled JavaScript, runtime route, GraphQL schema, framework 전용 descriptor를 대표하지 않는다. blind target 전에 발견률을 주장하지 않는다.
- 다음 챕터는 공통 provenance를 이용한 source/run별 독립 Explorer 후보 가시성과 dataset lock 정합성이다. 그 뒤에만 framework-specific adapter 또는 세부 탐색을 추가한다.

## 2026-08-26 · 1.2.0-beta.6 · source/run 후보 격리와 candidate lock

### 목표와 성공 조건

- 독립 Explorer가 자기 run에서 발견한 route만 보고 HUMAN/SCANNER의 후보·상태·통계를 추론할 수 없게 한다.
- 병합된 top-level 후보 상태를 단순 재사용하지 않고 provenance 단위로 observed/applicability/reason을 다시 계산한다.
- Judge가 보는 route inventory를 Pipeline dataset과 같은 lock 시점에 고정한다.
- 변경된 MCP·저장·Web 계약과 배포 버전을 문서·테스트·JAR에 일치시킨다.

### 개발·수정

- provenance에 `applicability`와 `reason`을 추가하고 project/snapshot/Web 상세까지 대응 관계를 보존했다. 기존 새-format project에 이 필드가 없으면 보수적으로 `REVIEW`로 읽는다.
- `RouteCandidateViews.forRun`을 추가했다. 지정 source/run의 provenance만 남기고 `OBSERVED_REQUEST` 존재 여부와 provenance applicability/reason으로 후보 상태를 다시 만든다.
- MCP `State`에 route candidate read view를 추가하고 Burp extension의 현재 inventory를 연결했다.
- `flowscope_list_route_candidates`를 추가했다. Explorer 중에는 현재 LLM run view, lock 뒤에는 잠긴 전체 route inventory를 최대 200개씩 반환한다. 각 항목은 정렬 근거와 provenance 대응을 포함한다.
- pre-lock `flowscope_get_status`는 active Explorer가 없어도 cross-source count·coverage·gap·finding·active run을 숨긴다. Explorer 중에는 자기 captured/coverage/classification/route candidate 수와 LLM run만 표시한다.
- 독립 Explorer가 ZAP environment/status/baseline/passive/execution과 기존 assessment/validation 목록을 읽지 못하도록 서버 gate를 추가했다.
- dataset lock에 `lockedRouteCandidates`를 추가하고 reset 시 함께 지운다. lock 결과에 잠긴 route 수를 반환한다.
- Maven/MCP/Web/README 버전을 `1.2.0-beta.6`으로 맞췄다.

### 이유와 기각한 대안

- 전역 candidate에서 provenance만 지우고 top-level `observed/applicability`를 유지하면 다른 lane의 결론이 남으므로 기각했다. 상태도 현재 provenance로 재계산해야 독립 view다.
- Explorer 시작 전에는 전체 status를 보여 주는 기존 동작도 MCP caller가 답을 먼저 볼 수 있어 서버 격리가 아니므로 제거했다.
- route list를 live state에서 계속 읽게 하면 validation traffic이나 background rebuild가 lock 뒤 Judge 입력을 바꾸므로 immutable snapshot을 선택했다.
- session 목록은 비밀 없는 계정 선택 정보이며 raw Cookie/token을 반환하지 않아 유지했다. 이 경계는 실제 구독 클라이언트 사용성 검증 뒤 재검토할 수 있다.

### 영향 파일

- core: `RouteCandidate`, `RouteCandidateViews`, `RouteCandidateExtractor`
- MCP/Burp: `McpServer`, `FlowScopeExtension`
- persistence/Web: `ProjectStore`, `SnapshotJsonWriter`, `web/index.html`
- tests: `RouteCandidateViewsTest`, `McpServerTest`, `FlowScopeWebServerTest`
- agent workflow/public docs/version: Explorer/Judge prompt와 agent-workspace README, root/영문 README·CHANGELOG, 한국어 architecture·decisions·product plan·UI rationale·beta validation·development log, `pom.xml`

### 검증

- 집중 회귀 `RouteCandidateViewsTest,McpServerTest,ProjectStoreTest,FlowScopeWebServerTest`: 33 tests, 실패·오류·skip 0.
- `mvn clean verify`: 165 tests, 실패 0, 오류 0, skip 0, BUILD SUCCESS.
- 배포물은 `target/flowscope-1.2.0-beta.6.jar` 하나, 3,791,977 bytes, 1,941 entries, SHA-256 `db8aa738accdb70991d9015b17029775774a5aa01f026403014715fbe5290ab9`다. ZIP 무결성, Main-Class, Java 21, 반복 package digest 동일성을 확인했다.
- 완성 fat JAR만 classpath에 둔 HTML/OpenAPI YAML/XML runtime smoke는 `FAT_JAR_DISCOVERY_SMOKE_OK`였다.

### 남은 한계·다음 gate

- 실제 Codex/Claude가 beta.6 MCP로 Explorer를 시작하기 전/중/lock 뒤 호출했을 때 같은 격리가 유지되는지 end-to-end 검증하지 않았다.
- extension worker가 Pipeline과 route inventory를 연속 publish한다. lock 호출과 지연 응답/rebuild가 경합하는 Burp runtime stress는 아직 자동화하지 않았다.
- beta.6 JAR의 Burp Community 재로드와 실제 candidate UI/Site Map gate는 beta.5에서 이어진다.

## 2026-08-27 · 1.2.0-beta.7 · 구독 CLI Explorer/Judge 버튼 파이프라인

### 목표와 성공 조건

- 사용자가 Web 빠른 시작에서 공급자·대상·선택 계정을 고르고 독립 LLM Explorer와 별도 Judge를 시작할 수 있게 한다.
- Explorer는 과거 대화를 재사용하지 않고 자기 run만 남기며, Judge는 세 레인 lock 뒤 별도 세션으로 시작하고 후속 질문만 같은 Judge 세션을 재개한다.
- CLI 종료 코드나 모델 문장을 완료로 믿지 않고 exact run 종료·3-lane 완료·dataset lock·Evidence validation이라는 기존 서버 gate를 유지한다.
- 토큰·provider 로그인 정보·임시파일·출력과 scope 변경이 새 subprocess 경계에서 기존 신뢰 모델을 깨지 않게 한다.

### 개발·수정

- `LocalLlmRunner`를 추가했다. Burp 시작 PATH 또는 명시적 시스템 속성의 regular executable을 찾아 shell 없이 Codex/Claude를 실행한다.
- Explorer는 owner-only 임시 workspace에서 Codex `exec --ephemeral --ignore-user-config --strict-config`·read-only/no-approval·웹 검색 비활성화 또는 Claude strict MCP/no-persistence/빈 setting sources/auto-memory 비활성화/역할별 tool allowlist로 시작한다. FlowScope가 exact run을 먼저 만들고 prompt에 target·scope·account·run ID와 번들 AGENTS/Explorer 지침을 표준입력으로 전달한다.
- Judge는 Explorer와 다른 새 provider session을 사용한다. Codex JSON의 `thread_id` 또는 Claude UUID를 보존하고 Web의 `Judge 계속`만 exact session ID로 resume한다. CLI 프로세스는 각 turn 종료 후 닫힌다.
- Web `/api/llm-run`에 상태·scope·완료 레인, Explorer/Judge 시작, 취소, Judge 후속 요청을 추가했다. 빠른 시작에 provider, target, ACTIVE account, 시작/취소/후속 controls와 상태·metadata 경고를 배치했다.
- MCP Bearer는 child environment에만 전달한다. prompt·command line·project에는 넣지 않고 Codex 모델 shell에는 전달하지 않는다. 상속된 `OPENAI_API_KEY`·`ANTHROPIC_API_KEY`를 제거하고, status에는 마스킹·64KiB 상한의 output tail만 반환한다. Codex session event는 긴 출력 tail에서 밀려나도 bounded prefix에서 복구한다.
- locked dataset에는 Explorer를 추가하지 못하게 하고 active run 또는 lock 중 Burp UI scope 변경을 거부한다. 새 exploration이 시작되면 같은 source의 과거 완료 표식을 즉시 제거해 실패한 재실행의 부분 Evidence로 Judge가 열리지 않게 했다.
- sample/reset/project load는 완료된 Judge resume handle을 무효화하며 실행 중이면 취소한다. 취소 또는 Burp unload 직후 child 생성이 완료되는 경합에서도 닫힘 상태를 재검사해 그 child를 종료하고, 종료된 runner의 새 실행을 거부한다. Claude no-persistence metadata 잔존 가능성은 삭제로 가장하지 않고 UI와 문서에 표시한다.
- `agent-workspace`의 Explorer prompt는 launcher가 pre-start한 run과 수동 fallback의 run 시작을 구분한다. 세 지침 리소스를 fat JAR에 포함했다.
- Maven/MCP/Web/README 버전을 `1.2.0-beta.7`로 맞췄다.

### 이유와 기각한 대안

- Explorer와 Judge를 한 CLI 대화에서 연속 수행하면 LLM lane이 HUMAN/ZAP 결과에 노출돼 3-way 비교가 독립 실험이 아니게 되므로 기각했다.
- 사용자 provider OAuth/token을 FlowScope가 직접 받거나 API key를 저장하는 방식은 구독 CLI 요구와 비밀 경계를 깨므로 기각했다.
- 장기 terminal 프로세스를 계속 켜 두는 대신 provider session ID로 Judge turn을 재개한다. 이는 Burp unload·오류 복구가 단순하고 사용자에게 실제 지속 의미를 정직하게 설명한다.
- `--no-session-persistence` 뒤 provider 홈을 광역 삭제하면 다른 세션을 손상할 수 있어 기각했다. Explorer ID를 저장·resume하지 않는 논리 격리와 명시적 경고를 선택했다.
- CLI 0 exit만 성공으로 쓰는 방식은 MCP run 미종료·dataset 미잠금을 놓치므로 서버 상태를 완료 조건으로 유지했다.
- 후보 가중치나 최종 판정 규칙은 이 자동화와 무관하므로 변경하지 않았다. 기존 범주형 정렬과 Evidence gate가 계속 권위다.

### 영향 파일

- 실행기·상태: `LocalLlmRunner`, `RunContextRegistry`, `McpServer`, `FlowScopeExtension`
- Web API/UI: `FlowScopeWebServer`, `web/index.html`
- prompt/build: `agent-workspace/prompts/explorer.md`, `pom.xml`
- tests: `LocalLlmRunnerTest`, `RunContextRegistryTest`, `FlowScopeExtensionPhaseTest`, `FlowScopeWebServerTest`
- 공개 정본: root/영문 README·CHANGELOG, 한국어 architecture·decisions·product plan·UI rationale·beta validation·development log

### 검증

- 구현 도중 두 테스트 픽스처 결함을 즉시 노출·수정했다: 존재하지 않는 `Orchestrator.USER` 사용, Codex Judge test의 LLM 완료 레인 누락. 제품의 active/3-lane gate를 약화하지 않았다.
- 코드 리뷰에서 긴 Codex 출력의 첫 thread ID 손실, lock 뒤 Burp UI scope 변경, 재탐색 실패 뒤 과거 완료 표식 잔존을 발견하고 각각 bounded prefix, scope mutation guard, completion invalidation 회귀로 고정했다.
- 현재 로컬 Codex CLI 0.147.0과 Claude Code 2.1.231의 `--help`에서 사용하는 ephemeral/resume/session/MCP/tool/setting 옵션을 확인했다. 사용자 승인 뒤 exact target·MCP 없이 격리 옵션의 모델 호출만 실행했다. Codex는 exit 0과 정확한 `OK`를 반환했다. Claude는 옵션 파싱과 provider 요청까지 진행했지만 HTTP 429 주간 한도(2026-08-29 09:00 KST reset 안내)로 실패했으므로 Claude 모델 실행 성공으로 기록하지 않는다.
- 최종 `mvn clean verify`: 176 tests, 실패 0, 오류 0, skip 0, BUILD SUCCESS.
- 배포물은 `target/flowscope-1.2.0-beta.7.jar` 하나, 3,824,841 bytes, 1,954 entries, SHA-256 `c8fd3f8ae1b85c9708020fb4f933c253b04fcd4090eb19837c9eab74220a21c1`다. Main-Class/Java 21/번들 지침 3종/ZIP 무결성과 연속 non-clean package digest 동일성을 확인했다.
- standalone Web UI에서 beta.7 tag와 모든 LLM controls를 DOM으로 확인했고, 423×799 viewport의 page horizontal overflow는 0이었다. modal은 세로 scroll을 유지했다.

### 남은 한계·다음 gate

- beta.7 검증 당시 실행 중인 Burp Web UI는 beta.3로 확인됐으므로 beta.7 JAR을 제거·재로드한 뒤 Codex와 Claude 각각 Explorer MCP 요청, exact run 종료, Judge lock/validation, Judge 후속 resume를 확인해야 했다. Codex 무대상 smoke를 이 gate에 소급하지 않았다. 최신 미검증 gate는 맨 위 beta.32 기록과 `beta-validation.md`를 따른다.
- Explorer 한 번은 운영자가 선택한 익명 또는 ACTIVE 계정 하나로 독립 탐색한다. USER A/B 교차 재현은 lock 뒤 Judge가 `flowscope_list_sessions`의 안전한 account ID를 골라 수행한다. 이것은 현재 의도된 경계이며 다중 계정 Explorer campaign은 구현돼 있지 않다.
- Claude no-persistence가 물리적 metadata 파일을 남기지 않는다고 보장하지 않는다. FlowScope가 보장하는 것은 Explorer session ID를 저장·resume하지 않는 논리 격리다.
- Codex는 CLI의 read-only sandbox와 no-approval, Claude는 exact tool allowlist를 사용하지만 변조된 로컬 client 설치까지 통제하지 못한다. 서버 exact scope·visibility·Evidence gate가 최종 권위다.
- 이 검증은 실행 파이프라인과 제품 상태를 검증한 것이며 endpoint 발견률·취약점 precision/recall·crAPI 성능을 검증하지 않았다. 블라인드 벤치마크는 사용자 검토 뒤 별도 수행한다.

## 이후 작업 기록 형식

새 코드·동작 변경은 완료와 동시에 아래 형식으로 이 파일에 추가한다.

```text
## 2026-08-27 · 1.2.0-beta.8 · HUMAN Evidence 보존·노이즈·그래프 1~5단계

### 목표와 성공 조건

- 8KiB preview 뒤의 query/body/route/object Evidence를 조용히 잃지 않는다.
- 로그인·화면·polling 노이즈를 메인 coverage에서 분리하되 원 Evidence와 사용자 확인 경로는 보존한다.
- path뿐 아니라 관측된 구조화 ID를 모두 추적하고, 근거 없는 객체 조합은 만들지 않는다.
- source 필터·보조 그래프·Request/Response 상세이 실제 Web UI에서 일관되게 동작한다.
- 샘플 H/S/L을 실제 HUMAN/ZAP/Codex 실행 결과로 오인하지 않게 한다.

### 개발·수정

- `StoredPayload`를 추가해 저장 전 마스킹된 textual 전문을 메시지당 기본 1MiB, digest 중복 제거 후 압축 총량 48MiB까지 GZIP·SHA-256으로 보존했다. binary와 메시지별/총량 초과 전문은 size+digest+reason metadata-only로 남겼다.
- `RequestRecord`에 request/response payload와 복수 `ResourceReference`를 추가하고 정규화·data flow·route discovery·인가 Evidence·MCP·Repeater draft가 보존 전문을 우선 사용하게 했다.
- project schema를 v2로 올려 digest별 압축 blob을 한 번 저장하고 load 때 digest·byte 수를 검증했다. schema v1은 계속 읽는다.
- classifier v4에서 HUMAN 로그인 준비를 `AUTH_SESSION/EXCLUDE`, 반복 안정 unknown을 `POLLING/REVIEW`로 분리했다. live 20,000건 초과는 dropped count로 공개한다.
- query와 중첩 JSON·배열·XML·multipart·GraphQL의 모든 명시 ID를 추출했다. 기존 인가 cell은 첫 근거 참조 하나만 primary로 사용한다.
- Web에 보조 흐름 toggle, retention/bytes/digest/reason 상세, record 누락·metadata-only 메시지 경고를 추가하고 source가 꺼지면 그 source만 가진 node도 숨기게 했다.
- 온보딩 샘플에 인증·polling Evidence를 추가해 보조 흐름을 실제로 확인할 수 있게 했다. snapshot의 엄격한 demo provenance로 sample mode를 식별하고 상단에 “실제 점검 결과 아님·대상 네트워크 요청 0건”을 표시했다.
- Maven/MCP/Web/README를 `1.2.0-beta.8`로 맞췄다.

### 이유

- 단일 8KiB 문자열은 긴 본문 뒤쪽 ID와 route 근거를 소급 복구할 수 없었고, 무제한 평문 보존은 Burp 메모리와 비밀 경계를 훼손한다.
- 보조 트래픽을 삭제하면 미탐 감사 경로가 사라지고, 메인 graph에 넣으면 coverage와 gap이 부풀기 때문에 저장·메인 분석·선택 표시를 분리했다.
- 모든 객체 참조의 단순 Cartesian product는 operation 적용 가능성을 증명하지 못하므로 primary 인가 모델은 보수적으로 유지했다.
- standalone 샘플의 H/S/L 표기가 실제 세 레인 수행으로 오해된다는 사용자 재현을 받아, 설명 문구가 아니라 지속 배너로 구분했다.

### 영향 파일

- 코어·수집: `StoredPayload`, `ResourceReference`, `RequestRecord`, `FlowScopeExtension`, `BurpXmlParser`, `Normalizer`, `TrafficClassifier`, `Pipeline`, Evidence/분석 consumer와 `SampleProject`
- 저장·통합·Web: `ProjectStore`, `McpServer`, `FlowScopeWebServer`, `SnapshotJsonWriter`, `web/index.html`
- 회귀: `StoredPayloadTest`, `ProjectStoreTest`, `TrafficClassifierTest`, `PipelineClassificationTest`, `AdvancedNormalizerTest`, `FlowScopeWebServerTest`, `SampleProjectTest`
- 문서: 루트·영문 README/CHANGELOG, `architecture.md`, `decisions.md`, `product-development-plan.md`, `ui-product-rationale.md`, `beta-validation.md`, 이 로그

### 검증

- `mvn clean verify`: JDK 26, Java `--release 21`, 183 tests, 실패·오류·skip 0.
- JS 추출본 `node --check`: 성공.
- standalone beta.8: 보조 흐름 4건을 켜도 7조합·미교차 1·일부 7·불일치 2 유지, 첫 Evidence의 88/106 bytes·SHA-256·마스킹 전문 확인, 샘플 경고 배너 표시, console warning/error 0.
- 배포물: `target/flowscope-1.2.0-beta.8.jar` 하나, 3,840,945 bytes, 1,957 entries, SHA-256 `63adff71dabdfadd686ff0c408043be14fb5a63f86c784fdb3d2a65e9394ff7e`. ZIP 무결성·Main-Class·Java 21·Montoya class 0을 확인했다.
- QA 중 첫 standalone이 stale `target/classes`의 beta.7 tag를 보여 실패로 처리했고, compile 후 reload한 beta.8만 검증 기록에 사용했다.

### 남은 한계·다음 gate

- 실제 Burp Browser HUMAN pass, 장시간 메모리, 20,000건 초과, 대용량 project save/load는 아직 수동 검증하지 않았다.
- binary·메시지당 기본 1MiB 초과·압축 전문 총량 48MiB 초과 메시지는 내용 없이 metadata-only다. 이 경우 분석은 8KiB preview 범위로 제한된다.
- 복수 object 참조를 모두 보존하지만 operation별 적용 가능성 모델이 없어 인가 cell은 primary 하나만 사용한다.
- MPA/SPA/GraphQL blind corpus의 분류 confusion matrix와 실제 미탐·오탐은 다음 gate다. 오탐·미탐 0이나 성능 우위를 주장하지 않는다.
- 이번 H/S/L은 합성 샘플 UI QA다. 실제 ZAP과 Codex Explorer를 실행한 것으로 기록하지 않는다.

## 2026-08-27 · 1.2.0-beta.9 · 기존 UI 복원과 Evidence 단계형 경로 묶음

### 목표와 성공 조건
- beta.8의 사용자 검증된 `identity → resource → operation` UI를 유지한다.
- raw URL을 보존하면서 근거가 있는 경우에만 concrete path를 같은 operation으로 자동 정렬한다.
- 근거 없는 숫자 경로의 오병합을 줄이되 객체 후보와 기존 인가 분석을 잃지 않는다.
- 코드·Web/MCP 계약·한영 문서·버전·JAR을 같은 상태로 만들고 커밋한다.

### 개발·수정
- 폐기한 operation-grid/관측 인접 Flow 실험 코드를 제거하고 기존 그래프 렌더러와 조작을 복원했다.
- `Normalizer.normalizeAll`에 service·구조·세그먼트 위치별 catalog를 추가했다. 성공 JSON 응답의 정확한 `id/*Id`, UUID/긴 hex 형식, 복수 값, source/run/method가 다른 독립 관측을 구분한다.
- path template 상태를 `LITERAL/INFERRED/CORROBORATED`로 만들고 확률이나 고정 confidence 없이 machine-readable 이유를 보존한다.
- 객체 추출과 operation template을 분리했다. 단일 `/orders/101`이 template 근거 부족으로 literal이어도 `orders:101` 객체 후보와 PATH_ID Evidence는 유지한다.
- Web operation 상세와 MCP record에 상태·이유를 추가했다. raw path와 마스킹 Request/Response는 기존대로 유지한다.
- 관측 route inventory는 record의 canonical operation을 재사용해 graph가 literal인데 observed candidate만 `{id}`가 되는 불일치를 차단했다.
- Maven/MCP/Web/README를 `1.2.0-beta.9`로 맞췄다.

### 이유
- 모든 숫자를 즉시 `{id}`로 바꾸면 `/status/200` 같은 literal route가 합쳐지고, 숫자를 전부 literal로 두면 실제 객체 operation 비교가 분열된다.
- 블랙박스 관측만으로 서버 route declaration을 확정할 수 없으므로 UUID 형식조차 `INFERRED`이며, 응답 ID 일치는 `CONFIRMED`가 아니라 `CORROBORATED`로 표현했다.
- 사용자 승인 큐를 기본 플로우에 넣으면 제품 개입이 커지므로 자동 정렬하되 원문·상태·이유를 상세에서 감사하는 구조로 정했다.
- OpenAPI의 path templating/concrete path 우선 규칙, Burp Site Map 비교의 false-match 경고, concrete/template 후보를 함께 남기는 mitmproxy2swagger의 접근을 검토했다. 이것들은 설계 근거이지 FlowScope의 성능 우위 증거가 아니다(D-074).

### 영향 파일
- 코어: `Normalizer`, `RequestRecord`, `RouteCandidateExtractor`, 신규 `PathTemplateStatus`
- 통합·Web: `SnapshotJsonWriter`, `McpServer`, `web/index.html`
- 회귀: 신규 `RouteTemplateEvidenceTest`, `RouteCandidateExtractorTest`, `AdvancedNormalizerTest`, `FlowScopeWebServerTest`
- 문서·배포: 루트/영문 README·CHANGELOG, `architecture.md`, `decisions.md`, `product-development-plan.md`, `ui-product-rationale.md`, `beta-validation.md`, 이 로그, `pom.xml`

### 검증
- 신규 테스트를 먼저 추가해 미구현 compile 실패를 확인한 뒤 구현했다.
- `mvn clean verify`: JDK 26, Java `--release 21`, 192 tests, 실패·오류·skip 0.
- standalone beta.9 합성 샘플: 이전 그래프/파싱 작업면 유지, `/api/orders/{id}` 상세에서 raw `/api/orders/101`, `CORROBORATED · RESPONSE_ID_MATCH`, 마스킹 전문 동시 확인.
- 1280×720과 600×800에서 수평 overflow 0, console warning/error 0. 1280에서 우측 상세 패널 전체 폭이 viewport 안에 위치.
- 배포물: `target/flowscope-1.2.0-beta.9.jar` 하나, 3,850,581 bytes, 1,962 entries, SHA-256 `b13313a3bcea198b9bdd19932aa65839a06f7a99728d8b6e98b2d2e0dc7471e6`. ZIP 무결성·Main-Class·Java 21을 확인했다.

### 남은 한계·다음 gate
- 복수 값/독립 관측은 route declaration의 증명이 아니므로 `INFERRED`이며 false merge 가능성이 0이라고 주장하지 않는다.
- 현재 응답 보강은 2xx JSON의 `id` 또는 부모명 기반 `*Id` 정확 일치다. 서버 명세/OpenAPI route template을 강한 oracle로 결합하는 것은 후속 gate다.
- beta.9 JAR의 Burp Community 재로드와 실제 HUMAN blind-target corpus confusion matrix는 아직 확인하지 않았다.
- 이번 H/S/L은 합성 샘플 UI QA다. 실제 ZAP/Codex Explorer를 실행한 것으로 기록하지 않는다.

## 2026-08-27 · 1.2.0-beta.10 · SQLite 내구 저장과 계정 중심 세션 화면

### 목표와 성공 조건
- 기본 프로젝트를 로컬 SQLite로 저장하되 기존 마스킹·schema 검증·JSON 호환을 깨지 않는다.
- `test1` 한 번의 로그인에서 Cookie·Authorization·subject가 관측돼도 기본 화면에는 계정 하나로 보인다.
- 연결 여부·재로그인 필요 여부와 다음 행동을 내부 enum 없이 사용자가 이해할 수 있게 표시한다.
- 전체 회귀, 반응형 Web QA, fat JAR SQLite smoke, 문서·버전·라이선스·JAR을 같은 상태로 만든다.

### 개발·수정
- `ProjectStore`의 JSON schema v2 codec을 파일 I/O와 분리해 SQLite와 JSON이 같은 유효성·마스킹 계약을 사용하게 했다.
- `SqliteProjectStore` storage schema v1을 추가해 metadata/migration, records, payload BLOB, accounts, service-scoped bindings, policy, reviews, assessments, validations, completed lanes, route candidates를 관계형 table로 저장한다.
- Burp 프로젝트 저장 기본 확장자를 `.flowscope.db`로 바꾸고 JSON은 별도 내보내기와 기존 가져오기 호환으로 유지했다. DB를 한 번 저장하거나 열면 변경 revision을 30초 checkpoint로 합쳐 transaction/임시 DB/atomic replace로 저장하고 unload 직전 마지막 저장을 시도한다.
- Web snapshot session에 `accountId`와 `artifactKind`를 추가했다. 계정 화면은 account card를 기본 단위로 사용하고 연결된 Cookie/token/subject는 접힌 기술 정보, 미연결 기록은 닫힌 고급 진단에 둔다.
- `ACTIVE/UNVERIFIED/SUSPECT/REAUTH_REQUIRED`를 일반 화면에서 `사용 가능/로그인 확인 필요/세션 이상 감지/다시 로그인 필요`와 행동 문구로 변환했다.
- HUMAN pass 계정 활성 여부가 raw fingerprint 배열이 아니라 실제 `managedSessions` broker 상태를 읽도록 수정했다.
- Xerial SQLite JDBC 3.53.1.0을 번들하고 Apache 2.0/Zentus BSD 고지를 추가했으며 DB 파일을 Git ignore에 포함했다.

### 이유
- raw 인증 지문은 principal이 아니라 한 계정을 뒷받침하는 내부 artifact다. 이를 평면 나열하면 계정 수와 로그인 상태를 사용자가 잘못 이해한다.
- 장래 self-host를 고려해 관계형 경계를 먼저 만들되, 검증되지 않은 live event-store 전환까지 한 번에 수행하지 않았다. 현재 분석 pipeline·상한을 유지한 채 내구 snapshot만 추가하는 것이 변경 범위와 실패 모드를 통제한다.
- 전체 100MiB snapshot을 매초 재작성하는 안은 Burp와 사용자 디스크 부하가 커질 수 있어 30초 checkpoint와 unload 저장으로 제한했다. 이 간격의 실제 최적값은 대용량 benchmark 전까지 성능 우위로 주장하지 않는다.
- 계정 artifact를 삭제하거나 자동 병합하면 회전/충돌 감사 근거를 잃거나 다른 사용자를 합칠 수 있어, 수집은 유지하고 UI projection만 계정 중심으로 바꿨다.

### 영향 파일
- 저장·Burp UI: `ProjectStore`, 신규 `SqliteProjectStore`, `FlowScopeExtension`, `FlowScopeControlTab`, `.gitignore`, `pom.xml`
- Web: `SnapshotJsonWriter`, `FlowScopeWebServer`, `web/index.html`
- 회귀: 신규 `SqliteProjectStoreTest`, `FlowScopeWebServerTest`
- 공개 경계: `META-INF/NOTICE.txt`, 신규 `LICENSE-sqlite-jdbc-zentus.txt`, 루트/영문 README·CHANGELOG, 한국어 설계·결정·계획·화면 근거·검증·제품 개요, 이 로그

### 검증
- `mvn clean verify`: JDK 26, Java `--release 21`, 195 tests, 실패·오류·skip 0.
- SQLite 회귀: DB header, 관계형 row, payload BLOB/digest round-trip, account/binding/policy/lane/route/assessment/validation 복원, raw Cookie 문자열 부재, 미지원 storage schema 거부.
- 계정 projection 회귀: Cookie·Authorization·subject 지문 3개가 `test1` account 하나에 연결되고 artifact kind 세 종류를 보존.
- standalone beta.10 계정 화면: 1280×720·600×800 모두 수평 overflow 0, console warning/error 0, 계정별 행동 상태와 기본으로 닫힌 고급 진단 확인.
- fat JAR 단독 JDBC smoke: macOS arm64/JDK 26에서 service discovery로 SQLite 3.53.1 in-memory 연결·query 성공.
- 배포물: `target/flowscope-1.2.0-beta.10.jar` 하나, 15,826,751 bytes, 2,157 entries, SHA-256 `60709dfc90ec2fd4af539f2fd0453fe2b22b4da0e2382f8abc4a5a9793f62988`. ZIP·Main-Class·Java 21·JDBC service/native/license 포함을 확인했다.

### 남은 한계·다음 gate
- SQLite는 현재 full snapshot checkpoint이며 append-only event store나 다중 사용자 server DB가 아니다. 20,000 live record, 48MiB 압축 전문, 100MiB project 상한은 유지한다.
- xerial native load가 자동 JDK 26에서 경고를 냈지만 fat JAR query는 성공했다. 실제 Burp Community bundled JVM에서 beta.10 로드, DB 저장→자동 checkpoint→unload→재열기 검증은 아직 하지 않았다.
- 프로젝트에는 raw broker 자격증명이 없으므로 재열기 뒤 로그인 연결은 의도적으로 다시 해야 한다.
- 실제 `test1` 로그인 화면에서 기존 beta.9 데이터가 account card 하나로 표시되는 것은 beta.10 JAR 재로드 뒤 사용자가 확인해야 한다. 자동 회귀와 합성 UI를 실환경 완료로 기록하지 않는다.

## 2026-08-27 · 1.2.0-beta.11 · source 필터와 그래프 edge 의미 정합성

### 목표와 성공 조건
- HUMAN/SCANNER/LLM 필터가 실제 메인 Evidence 수와 일치하고, 선택한 source의 전체 접근 경로만 보인다.
- 응답→요청 데이터 의존선이 접근 그래프를 흐리게 하지 않고 `흐름 순서`에서만 보인다.
- 역할 정책 입력 위치가 명확하며 분석 계산·기존 계정 projection·저장 계약은 바뀌지 않는다.
- 전체 회귀, standalone 화면, 공개 JAR 하나, 문서·버전 일치를 확인한다.

### 개발·수정
- source별 `coverageEligible` Evidence 수를 필터에 표시하고 0건 source를 비활성화했다.
- 필터 변경 시 Cytoscape graph를 다시 만들어 source 전용 node와 `identity → resource → operation` 두 edge 구간을 함께 필터링했다.
- source view가 두 접근 구간 모두에 HUMAN 파랑·실선·H, SCANNER 빨강·파선·S, LLM 검정·점선·L을 적용하도록 통일했다.
- `SERVER_FLOW_LINKS`의 응답→요청 데이터 의존 edge를 메인 graph에서 제거했다. 데이터와 설명은 `흐름 순서`에 유지했다.
- 그래프 레일의 역할 클릭 순환과 임시 override를 제거했다. 계정 역할과 API 요구 권한 수·BFLA 비교 활성 여부를 읽기 전용으로 표시한다.
- 이전 node 위치가 새 edge 구조를 왜곡하지 않도록 graph-state 저장 키를 v3으로 올리고 Web 계약 테스트를 추가했다.

### 이유
- 0건 필터와 부분적으로만 source 문법이 적용된 선은 사용자가 “체크가 작동하지 않는다”, “끊긴 선이 무엇인지 모르겠다”고 판단하게 만든다.
- 접근 관계와 응답 값 전달 관계는 의미가 다르므로 한 canvas에서 같은 계층처럼 겹치면 경로 판독성이 낮아진다.
- 역할은 신원 속성이고 요구 권한은 API 정책이다. 그래프 레일 한 번 클릭으로 계정 역할만 바꾸는 방식은 BFLA 입력의 절반을 숨긴다.

### 영향 파일
- Web·회귀: `src/main/resources/web/index.html`, `src/test/java/io/flowscope/FlowScopeWebServerTest.java`
- 버전·공개 문서: `pom.xml`, 루트/영문 README·CHANGELOG, 한국어 설계·결정·계획·화면 근거·검증, 이 로그

### 검증
- 집중 회귀 `mvn -Dtest=FlowScopeWebServerTest test`: 13 tests, 실패·오류 0.
- 전체 회귀 `mvn clean verify`: JDK 26, Java `--release 21`, 195 tests, 실패·오류·skip 0.
- standalone 합성 H4/S2/L3에서 SCANNER·LLM을 해제하자 source checked 상태가 HUMAN만 남고 관측 API가 4→3으로 재구축됐다. HUMAN 접근 경로 두 구간은 파랑·실선·H였고 메인 graph에 응답→요청 데이터 의존선이 남지 않았다.
- 600×800에서 page horizontal overflow 0, console warning/error 0, 권한 정책 내부 조작 button 0을 확인했다.
- 배포물: `target/flowscope-1.2.0-beta.11.jar` 하나, 15,826,900 bytes, 2,157 entries, SHA-256 `f81bd55ab92da93e05601e116556abe58507b4d3222d0be18ec517c532be2788`. ZIP·Main-Class·Java 21·SQLite JDBC service/native/license 포함을 확인했다.

### 남은 한계·다음 gate
- 이 변경은 관측 데이터의 시각적 출처와 조작 정합성을 고친 것이며 endpoint 발견률·인가 판정 정확도를 높였다고 주장하지 않는다.
- 실제 Burp에서 실행 중인 beta.10은 beta.11 JAR을 재로드해야 변경이 보인다.

## 2026-08-27 · 1.2.0-beta.12 · 세션 귀속 충돌 차단과 그래프 비파괴 집계

### 목표와 성공 조건
- 같은 service의 인증 지문 하나가 두 등록 계정으로 조용히 이동하지 않아야 한다.
- 충돌 캡처는 이후 응답이나 캡처 종료로 `ACTIVE`가 되지 않고 신원 귀속·세션 주입에서 제외돼야 한다.
- 같은 요청자·객체·source의 중복 접근선을 한 선으로 보여 주되 원 operation·CoverageCell·Evidence·판정은 잃지 않아야 한다.
- 긴 API·객체 경로를 노드에서 생략하지 않고, 집계선을 클릭해 원 접근 조합으로 이동할 수 있어야 한다.
- 전체 회귀, standalone 상호작용, 공개 JAR 하나, 문서·버전 일치를 확인한다.

### 개발·수정
- `AnalysisConfig.bindSession`을 `putIfAbsent` 유일성 계약으로 바꾸고 기존/요청 account ID를 가진 전용 충돌 예외를 추가했다.
- Burp 캡처 연결에서 충돌을 별도로 처리해 현재 broker 세션을 `SUSPECT`로 고정했다. 충돌 상태는 캡처 종료·요청·응답 뒤에도 유지하고 자격증명 신원 매칭에서 제외한다.
- broker Web view와 snapshot JSON에 `credentialConflict`를 추가하고 계정 카드에 `동일 인증정보 충돌`과 폐기·재로그인 안내를 표시했다.
- graph의 동일 `(identity, resource, source)` 접근선을 표시 단계에서 집계했다. 총 관측 수, 원 cell 키, gap 키, 보수적으로 병합한 표시 verdict를 edge에 보존하며 Java 분석 모델은 바꾸지 않았다.
- 집계선 상세에 원 operation별 source 관측 수·판정·갭을 나열하고 각 원 CoverageCell 상세로 이동하게 했다.
- operation/resource 라벨의 중간 생략을 제거하고 전체 문자열 줄바꿈·동적 높이·최소 논리 폭을 적용했다. identity/source 기반 taxi turn과 graph-state v4로 이전 수동 배치 오염을 피했다.

### 이유
- binding 덮어쓰기는 계정 카드 중복보다 심각한 데이터 무결성 결함이다. 과거 USER A Evidence가 USER B로 재해석될 수 있어 UI에서 숨기는 대신 엔진에서 fail-closed해야 한다.
- 동일 접근선을 그대로 겹치면 몇 개의 관계인지 알 수 없지만, coverage cell 자체를 합치면 operation별 인가 판정과 Evidence가 손실된다. 따라서 화면 edge만 집계하고 원키를 역참조하는 방식으로 제한했다.
- 긴 경로를 tooltip에만 남기는 방식은 한눈에 경로를 비교한다는 그래프 목적을 충족하지 못한다. 전체 Dagre/ELK 교체는 이번 결함 수정에 비해 범위와 회귀 위험이 커 기각하고 현재 고정 열 배치 안에서 라벨과 lane만 수정했다.

### 영향 파일
- 세션 귀속·Burp 연결: `AnalysisConfig`, `SessionBroker`, `FlowScopeExtension`, `SnapshotJsonWriter`
- Web: `src/main/resources/web/index.html`
- 회귀: `AccountSessionTest`, `SessionBrokerTest`, `FlowScopeWebServerTest`
- 버전·공개 문서: `pom.xml`, 루트/영문 README·CHANGELOG, 한국어 설계·결정·계획·화면 근거·검증, 이 로그

### 검증
- 집중 회귀 `mvn -Dtest=AccountSessionTest,SessionBrokerTest,FlowScopeWebServerTest test` 통과.
- 최종 `mvn clean verify`: JDK 26, Java `--release 21`, 198 tests, 실패·오류·skip 0.
- standalone beta.12 합성 샘플에서 `H×2` 집계선을 클릭해 USER A→orders:101 원 operation 2개(GET/PATCH), 총 2건, operation별 판정·갭과 원 cell 이동 항목을 확인했다. 화면 수평 overflow는 0이었다.
- 배포물: `target/flowscope-1.2.0-beta.12.jar` 하나, 15,829,896 bytes, 2,158 entries, SHA-256 `b684549f0468964a6d2193fa64979448eab3950b768e7c39a61864bd3b49980c`. ZIP 무결성·Main-Class·Java 21·확장 진입점·SQLite JDBC service·NOTICE 포함을 확인했다.

### 남은 한계·다음 gate
- 접근선 집계는 표시 중복을 줄일 뿐 endpoint 발견률·인가 판정 정확도를 바꾸지 않으며 전체 edge crossing 최소화를 보장하지 않는다.
- 실제 Burp Community에서 beta.12 JAR 재로드, 같은 로그인 정보를 다른 계정으로 캡처하는 충돌 UI, 실제 HUMAN 장경로·대규모 graph는 아직 확인하지 않았다.
- `output/`, `tmp/`는 기존 사용자 비추적 파일이라 수정하거나 커밋하지 않았다.

## 2026-08-28 · 마스터 계획 1단계 · 완성 목표 재정의

### 목표와 성공 조건
- 목표·비목표·측정 가능한 완료 기준이 README, 설계, 제품 계획, 결정 로그에서 같은 의미여야 한다.
- 전 공격면 발견, 오탐·미탐 0, LLM 서술만으로 최종 확정 같은 검증 불가능한 주장을 완료 조건에서 제외해야 한다.

### 개발·수정
- 허가된 exact scope의 관측 가능한 접근통제 공격면 구조화와 Evidence 기반 검증을 제품 정본 목표로 고정했다.
- 완료 판단을 공개 fixture, 정답 격리 블라인드 benchmark, `REVIEW` 작업량, false positive·false negative·unresolved 공개, Evidence 역추적으로 고정했다.
- 한국어 README, 영어 사용자 가이드, 설계, 제품 계획에 같은 계약을 반영하고 D-078에 결정과 기각 대안을 기록했다.

### 이유
- 기능 개수나 화면 존재 여부는 탐지 성능과 재현성을 증명하지 않는다.
- 블랙박스 전체 분모를 알 수 없는데 모든 endpoint 발견이나 오탐·미탐 0을 완료 조건으로 두는 안은 측정할 수 없어 기각했다.
- 한계만 선언하고 측정 기준을 두지 않는 안도 제품 개선 방향을 검증할 수 없어 기각했다.

### 영향 파일
- `README.md`, `docs/en/README.md`
- `docs/ko/architecture.md`, `docs/ko/product-development-plan.md`, `docs/ko/decisions.md`, 이 로그

### 검증
- 목표 문장, 비목표 네 항목, benchmark·FP/FN/unresolved·Evidence 역추적 계약의 문서 간 일치성을 검사했다.
- `mvn clean verify`: 198 tests, 실패·오류·skip 0.
- 제품 코드, POM, 버전, JAR은 변경하지 않았다.

### 남은 한계·다음 gate
- 이 단계는 목표 계약만 고정했으며 endpoint 발견률이나 판정 정확도를 개선한 것이 아니다.
- 마스터 계획 2단계인 우선순위 원칙은 사용자가 `다음`이라고 지시하기 전까지 시작하지 않는다.

## 2026-08-28 · 1.2.0-beta.13 · HUMAN 실행 정합성과 범용 구조 프로파일러

### 목표와 성공 조건
- HUMAN pass의 진행·완료가 실제 exact run 상태와 일치하고 Web에서 자동 갱신돼야 한다.
- pass 안에서 사용한 Repeater·Intruder가 브라우저로 오기록되지 않아야 한다.
- 특정 대상 이름이나 path를 하드코딩하지 않고 `*Id` 밖의 반복 관측 식별자를 보강하되 제어·보안 필드와 단일 관측을 객체로 만들지 않아야 한다.
- 기존 coverage·인가·분류·저장 계약, 문서, 버전, 공개 JAR 하나를 유지해야 한다.

### 개발·수정
- `/api/human-run`에 exact exploration 완료 상태를 추가하고 Web의 1초 실행 상태 동기화에 HUMAN을 포함했다. 빠른 시작은 수집 건수 대신 서버 완료 표식으로만 `pass 완료`를 표시한다.
- run context 병합에서 HUMAN Repeater·Intruder·Target의 실제 source detail과 `BURP` tool을 유지하면서 orchestrator·phase·run ID·account는 현재 pass 문맥을 상속하게 했다.
- `SemanticFieldCatalog`를 추가했다. query·JSON/form body의 `*No/*Number/*Seq/*Key/*Ref/*Uuid/*Guid/*Vin`을 동일 service·method·raw path·field 위치별로 학습하고 서로 다른 값이 둘 이상일 때만 객체 참조로 보강한다.
- 기존의 단순 소문자 `endsWith("id")`를 제거하고 `id`, camel-case `*Id/*Ids`, snake/kebab `*_id/*_ids` 경계만 강한 ID로 인정해 `guid/valid/fluid` 오탐을 막았다. `guid`는 복수 값 semantic 근거가 있을 때만 경로 collection 객체로 보강한다.
- semantic object는 `QUERY_SEMANTIC_FIELD_CORROBORATED` 또는 `BODY_SEMANTIC_FIELD_CORROBORATED` 근거를 보존한다. 제어·상태·trace/request·API/auth/token/session/secret류, 마스킹·과대 값, 단일 관측, 다른 path의 같은 필드는 승격하지 않는다.
- beta.13으로 버전과 한국어/영어 공개 문서, 설계·결정·계획·화면 근거·검증 기록을 동기화했다.

### 이유
- record가 있다는 사실은 HUMAN pass가 정상 종료됐다는 증거가 아니다. 이 둘을 섞으면 과거 Evidence나 진행 중 수집이 완료 gate처럼 보인다.
- run context는 실행 구간을 붙이기 위한 것이지 실제 HTTP 생성 도구를 지우기 위한 것이 아니다. Repeater provenance 손실은 재현·감사 설명을 틀리게 만든다.
- 어떤 URL이든 자동 구조화하려면 target별 사전보다 관측에서 반복되는 구조를 학습해야 한다. 다만 필드명 하나만으로 객체화하면 page/sort/API key까지 resource가 되므로 같은 위치의 복수 값이라는 최소 보강 근거를 요구했다.
- LLM 즉시 판정, target별 필드 목록, 일반 `*Code`, 서로 다른 endpoint의 같은 이름 합치기는 각각 비결정성·benchmark 오염·상태 enum 오탐·전파 오탐 때문에 채택하지 않았다.

### 영향 파일
- Human 수집·상태: `FlowScopeExtension`, `FlowScopeWebServer`, `web/index.html`
- 범용 객체 정규화: `Normalizer`
- 회귀: `FlowScopeExtensionPhaseTest`, `FlowScopeWebServerTest`, `AdvancedNormalizerTest`
- 버전·문서: `pom.xml`, 루트/영문 README·CHANGELOG, 한국어 설계·결정·계획·화면 근거·검증, 이 로그

### 검증
- 신규 테스트를 먼저 추가해 누락된 provenance helper와 Human 완료/동기화 계약이 컴파일·정적 계약에서 실패하는 것을 확인한 뒤 구현했다.
- 집중 회귀 `mvn -Dtest=AdvancedNormalizerTest,NormalizerTest,FlowScopeExtensionPhaseTest,FlowScopeWebServerTest test`: 통과.
- 중간 전체 회귀 `mvn clean verify`: 203 tests, 실패·오류·skip 0. 이후 ID 문자열 경계 회귀를 추가했다.
- standalone 로컬 Web 빠른 시작에서 HUMAN begin 뒤 `진행 중`, exact end 뒤 `pass 완료`로 바뀌는 것을 각각 1.3초 대기 뒤 확인했다.
- 최종 `mvn clean verify`: 204 tests, 실패·오류·skip 0.
- 배포물: `target/flowscope-1.2.0-beta.13.jar` 하나, 15,836,587 bytes, 2,161 entries, SHA-256 `d306eb9dd7be5d9fe761074b1697d1ddf04718a5fcaf342a704a2ad1eeaa62d7`. ZIP 무결성·Main-Class·Java 21과 공개 JAR 단일성을 확인했다.

### 남은 한계·다음 gate
- semantic field 보강은 route schema·소유권·취약점 확정이 아니다. 단일 관측, 아직 전송되지 않은 동적 경로, 응답 의미만으로 알 수 있는 도메인 관계는 자동 확정하지 않는다.
- 실제 Burp Community beta.13에서 Browser, Repeater, Intruder를 같은 HUMAN pass 안에 실행해 Web Evidence의 detail/run/account를 확인해야 한다.
- 일반 MPA/SPA/GraphQL 및 블라인드 대상에서 semantic field precision/recall, 객체 미탐, `REVIEW` 작업량을 측정하기 전 성능 우위를 주장하지 않는다.
- `output/`, `tmp/`는 기존 사용자 비추적 파일이라 수정하거나 커밋하지 않는다.

## 2026-08-28 · 1.2.0-beta.14 · ZAP raw completion gate와 단계별 상태

### 목표와 성공 조건
- Burp raw record에는 응답이 있으나 400ms debounce 분석 snapshot에는 아직 없는 순간에도 정상 ZAP lane을 `0건 실패`로 오판하지 않는다.
- 신원별 Traditional Spider와 Client/AJAX rendered-browser 수집량 및 현재 단계가 Web/MCP에서 구분된다.
- 기존 exact scope, fresh ZAP session, broker 세션 교체, zero-capture failure, Active Scan 승인 경계를 바꾸지 않는다.

### 개발·수정
- `McpServer.State`에 `source + runId + sourceDetail` capture count 계약을 추가하고, Burp 구현은 synchronized raw `records`를 직접 센다. 일반 구현은 현재 snapshot 기반 default를 유지한다.
- ZAP 캠페인의 global/lane 완료 count와 단계 count를 raw 계약으로 교체했다. 신원별 lane은 `PENDING → TRADITIONAL_SPIDER → CLIENT_SPIDER/AJAX_SPIDER_FALLBACK → PASSIVE_SCAN_QUEUE → ALERTS_READY/FAILED`를 갱신한다.
- lane JSON에 `traditional_captures`, `rendered_captures`를 추가하고 기존 한 줄 문자열 대신 whs_flow 작업면 문법의 상태 card로 표시한다.
- beta.14 버전, 한국어/영어 README·CHANGELOG, 설계·결정·계획·화면 근거·검증 기록을 코드와 동기화했다.

### 이유
- 임의 sleep으로 분석 snapshot을 기다리면 시스템 부하에 따라 다시 실패한다. raw append는 응답 callback에서 이미 완료됐으므로 완료 gate의 가장 가까운 사실 원천이다.
- Pipeline debounce 제거는 매 응답마다 전체 분석을 실행해 Burp callback 부하를 키우므로 기각했다.
- Traditional과 browser-rendered discovery를 합산만 하면 어떤 crawler가 실제 경로를 발견했는지와 Client/AJAX 실패 영향을 설명할 수 없다.

### 영향 파일
- scanner gate·상태: `McpServer`, `FlowScopeExtension`
- Web projection: `src/main/resources/web/index.html`
- 회귀: `McpServerTest`, `FlowScopeExtensionPhaseTest`, `FlowScopeWebServerTest`
- 버전·문서: `pom.xml`, 루트/영문 README·CHANGELOG, 한국어 설계·결정·계획·화면 근거·검증, 이 로그

### 검증
- 구현 전 raw count API와 stage JSON을 요구하는 테스트가 컴파일 실패하는 것을 확인했다.
- 집중 회귀 `mvn -Dtest=FlowScopeExtensionPhaseTest,McpServerTest,FlowScopeWebServerTest test`: 통과.
- 최종 `mvn clean verify`: 206 tests, 실패·오류·skip 0.
- standalone 1280×720 빠른 시작에서 page/modal/scanner 수평 overflow가 모두 0이고 beta.14 tag, ZAP target·identity controls, 비실행 상태가 렌더되는 것을 확인했다.
- 로컬 loopback ZAP API에서 ZAP `2.17.0`, spider `0.18.0`, client `0.20.0`, pscan `0.6.0` 설치를 읽기 전용 확인했다. beta.14 JAR을 Burp에 다시 로드하지 않은 상태라 대상 scan은 실행하지 않았다.
- 배포물: `target/flowscope-1.2.0-beta.14.jar` 하나, 15,838,496 bytes, 2,161 entries, SHA-256 `aad50e262a5ed70976da3dae21f070fd57e3354e52cc1681c00f482f814bb0aa`. ZIP 무결성·Main-Class·Java 21을 확인했다.

### 남은 한계·다음 gate
- 실제 ZAP 2.17 + Burp Community beta.14에서 Client Spider/AJAX fallback이 8081을 지나며 stage count에 귀속되는지 확인해야 한다.
- USER A/B ACTIVE broker 세션의 교체 주입, 계정 간 late response, ZAP 전역 replacer/script 간섭은 실제 캠페인으로 검증해야 한다.
- 이번 변경은 완료 판정 정확도 수정이며 endpoint 발견률·Alert recall·취약점 성능 향상을 증명하지 않는다.
- `output/`, `tmp/`는 기존 사용자 비추적 파일이라 수정하거나 커밋하지 않는다.

## 2026-08-28 · 1.2.0-beta.15 · rendered crawler 거짓 정상 완료 차단

### 목표와 성공 조건
- Client Spider가 API status `100/COMPLETED`를 반환해도 실제 Client 단계 capture가 0이면 browser-rendered 기준선을 정상 완료로 표시하지 않는다.
- AJAX fallback을 자동 실행하고, AJAX도 0이면 기존 Traditional Evidence·Alert를 보존하면서 경고 완료를 명시한다.

### 개발·수정
- 실제 beta.14 crAPI 실행에서 ZAP 전체 8건·Traditional 8건·Rendered 0건·Alert 22건의 깨끗한 `COMPLETED` 오표시를 확인했다.
- ZAP task 로그에서 Client Spider가 Firefox binary 부재로 시작 실패했지만 status API는 100을 반환한 원인을 확인했다.
- Client 종료 후 같은 run의 raw `ZAP_CLIENT_SPIDER` count 증가가 0이면 AJAX Spider로 전환한다.
- AJAX도 raw count 증가가 0이면 lane·campaign status를 `COMPLETED_WITH_WARNINGS`로 내리고 원인을 Web/MCP에 표시한다. 전체 capture 0 failure는 그대로다.
- 경고 완료도 dataset lock 뒤 `flowscope_zap_alerts`가 baseline의 마스킹 Alert snapshot을 반환하도록 정상 완료와 같은 lock 계약을 적용했다.
- Web에 warning status·lane 시각 상태를 추가하고 beta.15 버전·문서를 동기화했다.

### 이유
- ZAP API status만으로 browser process와 실제 네트워크 관측 성공을 증명할 수 없다는 결함이 실환경에서 재현됐다.
- OS별 ZAP 로그·Firefox 경로를 제품이 추측하거나 강제하는 대신 FlowScope가 직접 관측한 stage capture를 실행 결과 gate로 사용한다.
- Traditional Evidence까지 폐기하면 사실로 수집된 결과를 잃으므로 저하 완료와 완전 실패를 분리한다.

### 영향 파일
- scanner workflow·status: `McpServer`
- Web warning projection: `src/main/resources/web/index.html`
- 회귀: `McpServerTest`, `FlowScopeWebServerTest`
- 버전·문서: `pom.xml`, README·CHANGELOG, 설계·결정·계획·화면 근거·검증 기록, 이 로그

### 검증
- 구현 전 Client status 100/Client capture 0 fixture가 AJAX 미호출·`COMPLETED`로 실패하는 것을 확인했다.
- 구현 후 `mvn -Dtest=McpServerTest,FlowScopeWebServerTest test`: 통과.
- 최종 `mvn clean verify`: 207 tests, 실패·오류·skip 0.
- 배포물: `target/flowscope-1.2.0-beta.15.jar` 하나, 15,839,086 bytes, 2,161 entries, SHA-256 `40c9d12fc1a550abc77bac9de57feb588fba5587eeb37aef5d6e6ed4d36467ff`. ZIP 무결성과 공개 JAR 단일성을 확인했다.
- 실제 beta.15 Burp/ZAP 재검증은 진행 전이다.

### 남은 한계·다음 gate
- beta.15 JAR 재로드 뒤 실제 crAPI에서 Client→AJAX 전환과 `COMPLETED_WITH_WARNINGS` 또는 실제 rendered capture를 확인해야 한다.

## 2026-08-28 · 1.2.0-beta.16 · HUMAN 요청 시점 문맥과 계정 표현 정합성

### 왜 수정했는가

- Proxy는 요청 시점 run/account를 보존했지만 Repeater·Intruder·Target 응답은 응답 시점 context를 읽어 HUMAN pass 경계의 늦은 응답을 오귀속할 수 있었다.
- 초기화·샘플 교체·프로젝트 열기 전에 전송된 요청의 응답이 이후 도착하면 교체된 데이터셋에 다시 추가될 수 있었다.
- 권한 카드가 하나의 등록 계정에 연결된 Cookie·Authorization·subject fingerprint 수를 `세션 N개`로 표시해, 내부 인증 단서를 서로 다른 로그인 세션처럼 보이게 했다.

### 무엇을 변경했는가

- `InFlightRequestTracker`를 추가해 Proxy와 비-Proxy Burp 도구의 `messageId`별 요청 시점 context·로그인 캡처 account·dataset epoch를 bounded metadata로 보존했다.
- Repeater·Intruder·Target 요청도 요청 콜백에서 context를 기록하고 응답 콜백에서 동일 ID로 소비한다. 문맥이 없거나 epoch가 바뀐 응답은 현재 pass로 추측하지 않고 제외한다.
- 초기화, 샘플 교체, 프로젝트 열기에서 records lock 안의 dataset epoch를 증가시키고 저장 직전에 다시 확인해 reset 뒤 늦은 응답 재등장을 차단했다.
- 정상 수집된 비-Proxy HUMAN 응답을 `SessionBroker`에 전달해 Repeater 등에서 발생한 Set-Cookie 회전을 동일 계정의 메모리 세션에 반영했다.
- 권한 정책 카드의 보조 문구를 `등록 계정/비로그인/미확정 신원/관측 신원`으로 바꾸고, 인증 단서 개수는 계정 화면의 기술 정보에만 유지했다.

### 변경 파일

- `src/main/java/io/flowscope/burp/InFlightRequestTracker.java`
- `src/main/java/io/flowscope/burp/FlowScopeExtension.java`
- `src/main/resources/web/index.html`
- `src/test/java/io/flowscope/burp/InFlightRequestTrackerTest.java`
- `src/test/java/io/flowscope/FlowScopeWebServerTest.java`
- 버전·사용법·결정·검증 문서와 배포 JAR

### 검증

- 실패 테스트를 먼저 추가해 구현 전 compile failure와 Web 계약 failure를 확인했다.
- Montoya API 2026.7 로컬 공식 인터페이스에서 request/response 양쪽의 `messageId()` 제공을 확인했다.
- 최종 `mvn clean verify`: 211 tests, 실패·오류·skip 0. 동시 callback 80개에서도 tracker가 metadata 상한 8개만 수락하는 회귀를 포함한다.
- 배포물: `target/flowscope-1.2.0-beta.16.jar` 하나, 15,842,551 bytes, 2,162 entries, SHA-256 `979bee7198a09d56e44dc5bd0c07125e6c9117762529097e1a2cf381e5adb35f`. ZIP 무결성, 확장 진입점, 새 tracker class와 공개 JAR 단일성을 확인했다.
- 새 JAR standalone 합성 샘플에서 beta.16 tag, 1280×720 수평 overflow 0, role의 `등록 계정` 표시, 계정별 접힌 인증 단서, source 필터 해제에 따른 관측 API 4→3 재구축을 확인했다. 대상 네트워크 요청은 만들지 않았다.
- 실제 열린 Web 탭은 beta.9였으므로 beta.16 UI/late-response를 검증한 것으로 기록하지 않는다. 새 JAR 재로드 뒤 실제 Burp Browser·Repeater·초기화·SQLite 재열기 gate가 남아 있다.
- USER A/B 복수 세션 주입·late response, ZAP browser provider 설정의 교차 플랫폼 동작은 아직 수동 gate다.
- `output/`, `tmp/`는 기존 사용자 비추적 파일이라 수정하거나 커밋하지 않는다.

## 2026-08-28 · 1.2.0-beta.17 · HUMAN 원문 요청 실험실

### 왜 수정했는가

- 기존 Web은 마스킹된 Request/Response와 Burp Repeater 미전송 초안만 제공해, 보안 진단자가 Web에서 세션·객체·본문을 편집하고 응답을 비교할 수 없었다.
- raw 인증값을 기존 `RequestRecord`/SQLite/JSON에 넣으면 비밀 비영속 계약을 깨고, 반복 검증 요청을 HUMAN 탐색으로 세면 coverage와 3-way gap이 왜곡된다.

### 무엇을 변경했는가

- `TransientExchangeVault`를 추가해 live 요청 1MiB·응답 4MiB·총 32MiB 기본 상한의 UTF-8 byte 원문만 Burp 프로세스 메모리에 보존했다. oldest eviction과 byte overwrite를 적용하고 초기화·샘플 교체·프로젝트 열기·unload에서 clear한다.
- `/api/request-lab`은 특정 Evidence의 원문 또는 정직한 마스킹 폴백을 반환하고, 명시적 send에서 `ORIGINAL/ANONYMOUS/ACCOUNT`를 구분한다. snapshot·프로젝트·MCP·로그에는 raw를 추가하지 않았다.
- HUMAN 전송은 원 Evidence `HttpService`, 현재 exact scope, redirect `NEVER`, upstream TLS 검증, 30초 timeout을 강제한다. `ANONYMOUS`는 broker 관리 인증 헤더를 제거하고 `ACCOUNT`는 제거 뒤 선택 ACTIVE 계정을 주입하며 기존 Content-Length를 body byte 길이로 갱신한다.
- 전송 결과는 `HUMAN/MANUAL_HTTP/VALIDATION/CONTROLLED` Evidence로 저장해 immutable discovery gate에서 coverage·gap 제외를 유지한다.
- whs_flow 기반 화면 문법을 유지한 전체 화면 요청 실험실에 request/response 2열 편집기, 인증 모드, account 선택, 응답 시간·byte 수, 탭 메모리 10건 이력과 native Repeater fallback을 추가했다.
- 계정 JSON의 내부 인증 단서 수 필드를 `authArtifactCount`로 바로잡아 계정 1개를 여러 세션처럼 표현하지 않는 beta.16 계약과 일치시켰다.

### 근거와 기각 대안

- 공식 PortSwigger Repeater/message editor/history, ZAP Requester, mitmproxy client replay에서 편집·재전송·응답/시간 비교가 수동 검증의 공통 흐름임을 확인했다. OWASP WSTG session fixation은 별도 계정·쿠키 대조를 요구한다.
- 브라우저가 대상에 직접 fetch하는 방식은 CORS·Burp proxy·TLS·Evidence correlation을 잃어 기각했다. raw를 프로젝트/localStorage에 두는 방식과 모든 수동 요청을 discovery로 계산하는 방식도 각각 비밀 수명과 coverage 왜곡 때문에 기각했다.

### 영향 파일

- runtime: `FlowScopeExtension`, `TransientExchangeVault`, `FlowScopeWebServer`
- Web: `src/main/resources/web/index.html`
- 회귀: `TransientExchangeVaultTest`, `FlowScopeWebServerTest`
- 계정 표현: `SnapshotJsonWriter`
- 버전·사용법·설계·결정·검증·화면 근거·계획·CHANGELOG와 `AGENTS.md` 비영속 경계

### 검증

- 구현 전 `/api/request-lab`, 세 인증 모드와 UI 계약을 추가해 Web 회귀 실패를 확인한 뒤 구현했다.
- `mvn clean verify`: 215 tests, 실패·오류·skip 0.
- JavaScript `node --check` 통과.
- standalone 합성 샘플에서 1280×720 request/response 2열·page overflow 0·console 오류 0, 600×800 단일 열·page/dialog overflow 0을 확인했다. DemoState는 네트워크 전송을 구현하지 않으므로 기능 성공으로 계산하지 않았다.
- 배포물: `target/flowscope-1.2.0-beta.17.jar` 하나, 15,856,555 bytes, 2,168 entries, SHA-256 `5da5a0801c3a4f4d8cef31b7cceed6a958ead0233b159a2b5d91400d5cc5aaf1`. ZIP 무결성, `Main-Class`, Java 21, 새 vault class와 Web asset 포함을 확인했다.

### 남은 한계·다음 gate

- 새 JAR을 Burp Community에 재로드하고 허가된 로컬 대상에서 ORIGINAL, ANONYMOUS, USER A, USER B 요청의 실제 수신 헤더·응답·세션 회전·VALIDATION provenance·coverage 불변을 확인해야 한다.
- Java `String`, Montoya 내부 복사, browser textarea, crash dump/swap의 완전 소거는 보장하지 않는다. raw vault는 영구 secret store가 아니다.
- `output/`, `tmp/`는 기존 사용자 비추적 파일이라 수정하거나 커밋하지 않는다.

## 2026-08-28 · 1.2.0-beta.18 · HTTP byte 정본과 Evidence UI 안정화

### 왜 수정했는가

- beta.17은 Montoya 메시지를 `toString()`으로 바꾼 값을 raw vault에 UTF-8로 저장해, 원래 body charset과 무관한 재인코딩으로 한글·비ASCII가 깨질 수 있었다. 깨진 문자열을 다시 Repeater나 target으로 보내면 원 Evidence 재현이 아니다.
- 긴 endpoint와 접근선 횟수 라벨이 겹쳤고, 900px 이하 화면은 최소 폭 캔버스 때문에 오른쪽 API가 보이지 않았다.
- 파싱 표에서 operation은 같지만 Evidence가 여러 개인 경우 사용자가 고른 행 대신 첫 Evidence를 볼 여지가 있었고, 관측된 그래프 신원과 재사용 가능한 ACTIVE 계정 세션의 관계가 화면상 불명확했다.

### 무엇을 변경했는가

- `TransientExchangeVault`를 요청·응답 raw `byte[]`와 body offset 저장소로 바꾸고 방어 복사·상한·폐기 계약을 유지했다.
- `HttpMessageTextCodec`을 추가해 헤더 ISO-8859-1, textual body의 Content-Type charset/기본 UTF-8을 strict decode/encode한다. binary·invalid byte는 replacement character로 숨기지 않고 Web 편집 전송을 차단한다.
- 수정하지 않은 요청과 Repeater handoff는 원래 byte를 사용한다. 사용자가 편집한 요청만 선언 charset으로 재인코딩하며 Content-Length는 실제 Montoya body byte 길이로 갱신한다.
- operation 라벨을 slash-aware 줄바꿈으로 바꾸고 단일 접근선의 `×1` 라벨을 숨겼다. 좁은 화면은 같은 filter 결과의 API 목록으로 전환한다. Cytoscape가 직접 조작하는 `#cy`의 inline style을 덮지 않고, 라이브러리 밖 `graphcanvas` 래퍼의 표시 상태만 반응형 CSS가 소유한다.
- 파싱 표에 Evidence ID별 `상세 보기` 버튼과 선택 상태를 추가해 정확한 요청·응답을 연다.
- `관측 신원`과 `재사용할 등록 계정`을 문구·Request Lab 메타데이터에서 분리했다.

### 영향 파일

- runtime: `FlowScopeExtension`, `TransientExchangeVault`, `HttpMessageTextCodec`, `FlowScopeWebServer`
- Web: `src/main/resources/web/index.html`
- 회귀: `HttpMessageTextCodecTest`, `TransientExchangeVaultTest`, `FlowScopeWebServerTest`
- 문서·배포: README, architecture, decisions D-084, UI rationale, beta validation, product plan, changelog, Maven version

### 검증

- UTF-8 한글·emoji, EUC-KR, invalid UTF-8, binary, edited JSON, raw byte defensive copy/round-trip 회귀를 추가했다.
- `mvn clean verify`: 221 tests, 실패·오류·skip 0.
- standalone 합성 샘플에서 1280px page overflow 0, 600px filtered API list·page overflow 0, 목록→상세 연결, 파싱 표 선택 Evidence ID와 열린 상세 ID 일치를 확인했다. 합성 샘플은 대상 네트워크 전송 성공을 증명하지 않는다.
- 배포물: `target/flowscope-1.2.0-beta.18.jar` 하나, 15,866,589 bytes, 2,170 entries, SHA-256 `c3915f7fbb2451f00e8b858639fc5a1fa2d00ab72d397ac61c61e33b8612ac1c`. ZIP 무결성, `Main-Class`, Java 21, 새 codec·byte vault·Web asset 포함을 확인했다.

### 남은 한계·다음 gate

- beta.17에 이미 깨져 저장된 텍스트는 원래 byte를 복원할 수 없으므로 beta.18 재로드 뒤 다시 수집해야 한다.
- 실제 Burp Community에서 비ASCII ORIGINAL byte 동일성, 편집 charset, ANONYMOUS/ACCOUNT credential 처리, binary Repeater fallback, clear/unload 폐기를 수동 검증해야 한다.
- `output/`, `tmp/`는 기존 사용자 비추적 파일이라 수정하거나 커밋하지 않는다.

## 2026-08-28 · 1.2.0-beta.19 · Cytoscape 반응형 DOM 소유권 분리

### 목표와 성공 조건

- `!important` 없이 데스크톱에서는 Cytoscape 그래프, 900px 이하에서는 동일 필터 API 목록만 표시한다.
- Cytoscape가 내부 inline style을 변경해도 제품 반응형 정책이 흔들리지 않는다.

### 개발·수정과 이유

- `#cy`를 `graphcanvas` 래퍼 안으로 옮겼다. Cytoscape는 내부 노드만, FlowScope CSS는 외부 래퍼만 소유한다.
- 라이브러리 inline style을 `!important`로 덮는 beta.18 후속 수정을 폐기했다. 동작 우선 임시 해결보다 소유 경계를 분리하는 것이 라이브러리 업그레이드와 재초기화에 안정적이다(D-085).
- Web 회귀에 DOM 래퍼와 media-query 계약을 추가하고 버전을 beta.19로 올렸다.

### 검증·남은 gate

- `mvn clean verify`: 221 tests, 실패·오류·skip 0.
- beta.19 standalone에서 1280px wrapper/Cytoscape 표시·목록 숨김, 600px wrapper 숨김·API 목록 4개·page overflow 0을 확인했다. Cytoscape 내부 inline style과 제품 반응형 CSS가 더 이상 같은 요소를 경쟁하지 않는다.
- 배포물: `target/flowscope-1.2.0-beta.19.jar` 하나, 15,866,605 bytes, 2,170 entries, SHA-256 `066f237a26c59359a36c5ec59c5186ca8cbc6012c0a36904129074fdf4a3c420`. ZIP 무결성, `Main-Class`, Java 21을 확인했다.
- 실제 Burp target 전송 gate는 beta.19 JAR 재로드 뒤 수행해야 한다.
- `output/`, `tmp/`는 수정하지 않는다.

## 2026-08-28 · 1.2.0-beta.20 · 공개 설치 재현성과 ZAP 원클릭 환경

### 목표와 성공 조건

- clone 또는 Release JAR 사용자에게 완전한 3-way 구성요소와 최소 설치 순서를 정확히 안내한다.
- macOS/Linux 사용자는 한 명령으로 ZAP 2.17.0을 SCANNER `8081` Burp listener 뒤에 띄우고, API key를 화면에 복사하지 않아도 FlowScope가 읽는다.
- 설치 상태는 추측이 아니라 doctor와 실제 컨테이너 API 재조회로 확인한다.

### 개발·수정

- 공식 ZAP 2.17.0 multi-arch 이미지 digest를 고정한 Compose와 컨테이너 시작 스크립트를 추가했다. API는 loopback host publish·random key로 제한하고 Network add-on API로 Docker host의 Burp `8081` upstream을 설정·재검증한다.
- `scripts/zap-up.sh`, `zap-down.sh`, `doctor.sh`를 추가했다. key는 `~/.flowscope/zap-api-key`에 owner-only로 생성하며 출력하지 않고, Compose에는 값 대신 파일을 read-only mount한다.
- 확장이 `flowscope.zap.key` → `FLOWSCOPE_ZAP_API_KEY` → `flowscope.zap.keyFile` → 기본 key file 순서로 ZAP key를 찾도록 했다. 파일은 symlink·비정규 파일·과도한 POSIX 권한·크기·문자 집합을 검증한다.
- 한국어·영어 시작 문서를 추가하고 루트 README를 Release JAR 사용자와 소스 빌드 사용자, HUMAN-only와 완전한 3-way로 분리했다. `output/`, `tmp/`는 사용자 로컬 데이터가 실수로 공개 저장소에 들어가지 않게 ignore했다.
- 완전한 3-way의 Docker helper는 저장소 clone이 필요하고 HUMAN-only는 Release JAR만으로 시작할 수 있음을 첫 단계에 명시했다.

### 이유

- README가 ZAP과 LLM을 선택 구성처럼 보이게 했고 Docker/ZAP upstream/key 배포 방법이 없어 새 사용자가 동일한 3-way 환경을 재현하기 어려웠다.
- key를 compose 파일이나 README에 고정하는 대안은 공개 저장소와 프로세스 출력에 비밀을 남기므로 기각했다. 모든 호스트 경로를 자동 추측하는 대안도 OS·Docker 구현별 오동작을 숨기므로 지원 프로필과 수동 대안을 명시했다(D-086).

### 영향 파일

- runtime/test: `FlowScopeExtension`, `LocalMcpToken`, `LocalSecretFile`, `LocalZapApiKey`, `LocalZapApiKeyTest`, Web version contract
- setup: `infra/zap/*`, `scripts/zap-up.sh`, `scripts/zap-down.sh`, `scripts/doctor.sh`, `.gitignore`
- 문서·배포: README, 한영 getting-started, architecture, decisions D-086, product plan, UI rationale, handoff, beta validation, changelog, Maven version

### 검증

- 첫 격리 실행에서 host 포트와 고정 container 포트가 달라 API가 Burp로 전달되는 결함을 발견해 동일 포트 매핑으로 수정했다.
- macOS 기본 Bash 3.2가 정규식 반복 수량자를 처리하지 못해 wrapper가 유효 key를 거부하는 결함을 발견하고 문자 집합과 길이 검사를 분리했다.
- macOS의 `/usr/bin/java`가 활성 JDK를 찾지 못해도 Homebrew Maven은 자체 JDK로 정상 빌드하는 경우 doctor가 거짓 실패하는 결함을 재현했다. source-build gate는 실제 빌드 주체인 `mvn -version`의 Java runtime을 검사하도록 수정했다.
- `docker compose config`, `shellcheck`, 실제 ZAP 2.17.0 health/API/version/Network upstream/add-on 재조회와 wrapper up→`doctor.sh --build`(0 failure, 0 warning)→down을 통과했다. `docker inspect`의 container environment에 실제 key 값이 없음을 확인했다.
- `mvn clean verify`: 222 tests, 실패·오류·skip 0.
- 배포물: `target/flowscope-1.2.0-beta.20.jar` 하나, 15,868,036 bytes, 2,172 entries, SHA-256 `24da2c47d49833bd06feb453599cc93ca448a028368a55be14a31b040c509aee`. ZIP 무결성, `Main-Class`, Java 21 manifest를 확인했다.

### 남은 한계·다음 gate

- doctor의 listener port open은 그 프로세스가 Burp임을 증명하지 않는다. 사용자가 Burp listener 화면과 Proxy history에서 SCANNER 유입을 확인해야 한다.
- 실제 target capture, HTTPS 인증서 경로, USER A/B session injection, Codex/Claude Explorer·Judge는 beta.20 setup 검증으로 대체하지 않는다.
- Windows는 Docker wrapper 대신 상세 문서의 PowerShell/수동 ZAP Desktop 절차를 사용해야 하며 자동 wrapper는 아직 제공하지 않는다.
- 다음 gate는 beta.20 JAR을 Burp Community에 재로드한 뒤 HUMAN raw byte와 SCANNER 실제 capture를 확인하는 것이다.

## 2026-08-28 · 1.2.0-beta.22 · 첫 실행 경로 압축

### 목표와 성공 조건

- 처음 쓰는 사용자가 한 화면의 모든 설명을 해석하지 않고 현재 단계와 다음 행동 하나를 확인한다.
- 기존 범위·HUMAN·ZAP·LLM/Judge 기능과 안전 경계를 삭제하거나 약화하지 않는다.
- 넓은 화면과 모바일 폭에서 단계 전환과 레이아웃을 실제 DOM으로 확인한다.

### 개발·수정

- Web 빠른 시작을 `범위 → HUMAN → ZAP → LLM/Judge` 네 단계 내비게이션과 단계별 단일 패널로 바꿨다.
- 현재 프로젝트 상태로 첫 미완료 단계를 계산하고 자동 선택한다. 사용자가 다른 단계를 점검할 수 있으며 `현재 단계로`로 자동 추천 위치에 돌아간다.
- README 설치 절차를 `처음 한 번만 준비`와 `점검할 때마다`로 분리하고, ZAP Desktop/Docker 중 하나만 선택한다는 내용을 앞에 배치했다.
- 버전, 한영 시작 문서, 변경 기록, 설계·결정·UI 근거·제품 계획·인계·검증 문서를 beta.22로 맞췄다.

### 이유

- beta.21은 필요한 제어를 제공했지만 여섯 설명 카드와 세 실행기 제어를 동시에 노출해, 기능 발견성보다 초기 판단 부담이 컸다.
- 기능을 없애는 단순화는 3-way 제품 목표를 훼손한다. 단계별 progressive disclosure는 같은 기능을 유지하면서 현재 행동만 전면에 놓는다(D-089).

### 영향 파일

- Web UI와 회귀: `src/main/resources/web/index.html`, `FlowScopeWebServerTest`
- 버전·사용자 문서: `pom.xml`, README, 한영 getting-started/README/changelog
- 설계 기록: architecture, decisions D-089, product plan, UI rationale, handoff, beta validation, development log

### 검증

- `mvn clean verify`: 223 tests, 실패·오류·skip 0.
- standalone Web asset에서 1280px 단계 전환과 390×844 반응형 표시를 확인했다. 선택 패널 하나만 표시되고 390px에서 대화상자·단계 탭 수평 overflow가 없었다.
- 배포물: `target/flowscope-1.2.0-beta.22.jar` 하나, 15,871,087 bytes, 2,172 entries, SHA-256 `721055eb49d196342145615dde93c24162391b07dcfdbb98df46dbd42c691c38`. ZIP 무결성, `Main-Class`, Java 21 manifest를 확인했다.

### 남은 한계·다음 gate

- standalone 화면 검증은 실제 Burp API 상태 전이를 대신하지 않는다.
- beta.22 JAR을 Burp Community에서 로드한 뒤 scope→HUMAN→ZAP→Explorer→Judge 완료 상태가 첫 미완료 단계 계산에 순서대로 반영되는지 수동 확인해야 한다.
- 실제 Windows Docker Desktop, ZAP Desktop, HTTPS, USER A/B와 3-way target 실행 gate는 여전히 별도다.

## 2026-08-28 · 1.2.0-beta.21 · ZAP 배포 중립 온보딩과 Windows 설치 경로

### 목표와 성공 조건

- Windows 사용자가 수동 key·ACL·Compose 명령을 조립하지 않고 macOS/Linux와 같은 up→doctor→down 흐름을 사용한다.
- 기존 ZAP Desktop 사용자는 Docker를 설치하지 않고 같은 캠페인 엔진을 사용하며, 실행 전에 연결 문제를 확인한다.
- Windows drive path를 안전하게 전달하고 key 값이 container environment·출력·저장소에 남지 않는다.
- 실제로 검증하지 않은 Windows Docker runtime은 완료라고 쓰지 않는다.

### 개발·수정

- Windows 10/11 + Docker Desktop Linux container + PowerShell 7용 `zap-up.ps1`, `zap-down.ps1`, `doctor.ps1`을 추가했다.
- Desktop과 Docker가 함께 쓰는 owner-only `zap-key.sh`/`zap-key.ps1`을 분리하고 key 값을 출력하지 않는다.
- Web 빠른 시작에 배포 중립 ZAP 연결 상태·version·key 오류·재확인을 추가하고 연결 전 캠페인을 비활성화했다. 연결 실패 때 Desktop 설정과 Docker Quick Start를 동등하게 표시한다.
- .NET cryptographic RNG로 32-byte key를 만들고 ACL 상속을 제거한 뒤 현재 Windows SID에만 FullControl을 부여한다. doctor는 reparse point, key format, ACL, 포트, ZAP API/version/upstream/add-on, provider, Web/MCP와 선택적 Maven/JDK를 점검한다.
- OS별 bind path short syntax 대신 Compose file-backed secret을 사용해 key 파일을 `/run/secrets/flowscope-zap-api-key`에 read-only mount한다.
- GitHub `windows-latest`가 네 PowerShell 파일을 실제 parser로 검사하는 CI job과 한영 설치·문제 해결 문서를 추가하고 버전을 beta.21로 올렸다.

### 이유

- beta.20의 Windows 수동 절차는 key ACL을 사용자 판단에 맡겼고 명령 복사 단계가 길어 macOS/Linux와 제품 경험이 달랐다.
- Docker를 기본처럼 먼저 제시하면 ZAP Desktop 사용자가 불필요한 daemon을 설치하고, API 연결 실패도 캠페인 실행 뒤에야 알게 된다. 캠페인은 배포 방식이 아니라 동일 ZAP API 계약만 필요하므로 D-088처럼 분리했다.
- PowerShell 5.1 동시 지원, Windows container image, WSL이 host Burp 경계를 자동 해결한다는 주장은 런타임·인코딩·네트워크 차이를 숨기므로 beta.21 계약에서 제외했다(D-087).

### 영향 파일

- setup/CI: `scripts/zap-key.*`, `scripts/*.ps1`, `infra/zap/compose.yaml`, `.github/workflows/ci.yml`
- 코드/회귀: `ZapClient`, `FlowScopeExtension`, `FlowScopeWebServer`, Web 빠른 시작, `FlowScopeWebServerTest`
- 문서: README, 한영 getting-started/README/changelog, architecture, decisions D-087·D-088, product plan, UI rationale, handoff, beta validation

### 검증

- Docker Compose config에서 file-backed secret source와 target을 확인했다.
- 저장소 secret scan의 유일한 탐지는 MCP 마스킹 회귀의 고엔트로피 고정 fixture였으며, 실제 secret이 아닌 의미가 드러나는 저엔트로피 test token 조합으로 바꿔 scan을 깨끗하게 유지했다.
- macOS 실제 ZAP 2.17.0에 새 secret topology를 적용해 key read, API/version, Docker→Burp `8081` upstream, 필수 add-on과 `doctor.sh --build` 0 failure·0 warning을 재검증했다. container environment에 key 값이 없었다.
- 공통 `zap-key.sh`로 생성한 별도 owner-only key와 host `18093`을 사용해 refactor된 `zap-up.sh` → ZAP API `2.17.0` → `zap-down.sh` 실제 lifecycle을 다시 통과했다. 기본 `8089`와 사용자 대상 트래픽은 사용하지 않았다.
- `mvn clean verify`: 223 tests, 실패·오류·skip 0.
- [GitHub Actions run 33166311107](https://github.com/choewonwoo1817/testflowscope/actions/runs/33166311107): Ubuntu `verify`와 `windows-latest` PowerShell 7 parser job 모두 통과.
- 배포물: `target/flowscope-1.2.0-beta.21.jar` 하나, 15,870,395 bytes, 2,172 entries, SHA-256 `3b9d892115d549e3b46e7eae63d59924b3c661a65e274912c64bb922655a7d2d`. ZIP 무결성, `Main-Class`, Java 21 manifest를 확인했다.

### 남은 한계·다음 gate

- 실제 ZAP Desktop에서 key/API/upstream/add-on과 Web 연결 표시를 확인해야 한다.
- Windows 10/11 실기기에서 Docker Desktop Linux container, ACL, ZAP API/upstream, Burp SCANNER capture와 stop을 실제 확인해야 한다.
- PowerShell 5.1, Windows container mode, WSL helper는 beta.21 지원 범위가 아니다.
- 실제 HUMAN/SCANNER/LLM/Judge와 HTTPS/USER A/B target gate는 별도다.

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
