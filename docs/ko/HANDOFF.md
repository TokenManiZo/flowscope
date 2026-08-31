# FlowScope 팀 인계 정본

이 문서는 새 팀원이 현재 코드의 상태를 과장 없이 파악하고 바로 개발을 이어가기 위한 시작점이다. 제품 설명, 구현 위치, 완료·미완료 구분, 알려진 결함, 다음 작업 순서와 검증 기준을 한곳에 모은다.

## 0. 인계 기준선

| 항목 | 기준 |
|---|---|
| 기준 날짜 | 2026-08-31 |
| 제품 버전 | `1.2.0-beta.33` |
| 인계 기준 | beta.33 코드·문서가 함께 포함된 동일 커밋 |
| Java | JDK 21 이상 |
| 빌드 | Maven 3.9 이상, `mvn clean verify` |
| 자동 회귀 | 최신 수치와 JAR digest는 `beta-validation.md` 정본 참조 |
| 현재 판정 | 기능이 연결된 베타. 오픈소스 정식 출시 및 블라인드 벤치마크 착수 전 P1 결함 수정과 실제 Burp 통합 검증이 필요함 |

`target/`의 JAR은 Git 산출물이 아니다. clone한 팀원은 직접 빌드해야 한다. `.flowscope.db`, `.flowscope.json`, 실제 대상 트래픽, 인증정보, `output/`, `tmp/`도 공유 소스에 포함하지 않는다.

## 1. 문서 정본과 읽는 순서

이 문서는 현재 작업의 출발점이지만 기존 정본을 대체하지 않는다. 다음 순서로 읽는다.

1. 이 문서: 현재 상태, 알려진 결함, 다음 작업
2. [루트 README](../../README.md): 설치, 사용자 흐름, 공개 제품 행동
3. [아키텍처](architecture.md): 데이터 흐름, 모듈, 신뢰 경계
4. [설계 결정](decisions.md): 선택 근거, 기각한 대안, 한계
5. [개발 기록](development-log.md): 버전별 변경·이유·검증
6. [베타 검증](beta-validation.md): 실제 수행한 검증과 아직 수행하지 않은 gate
7. [제품 개발 계획](product-development-plan.md): 장기 단계와 벤치마크 계획
8. [기능 명세](specification/functional-spec.md): 원 요구사항 F-01~F-24

충돌할 경우 현재 실행 코드를 먼저 확인하고 문서를 함께 바로잡는다. 원 기능명세는 요구사항 기록이며 현재 구현의 신뢰 경계 정본은 아니다.

## 2. 제품 목표와 비목표

FlowScope의 핵심 문제는 보안 진단자가 Burp의 요청 목록만 보고 신원·권한·객체·상태 흐름을 머릿속으로 재구성해야 한다는 점이다. 제품은 동일 exact scope에서 HUMAN, SCANNER, LLM이 실제로 만든 요청·응답을 공통 구조로 정렬하고 다음을 보여 준다.

- 누가 어떤 API와 객체에 접근했는가
- 세 source가 공통으로 관측한 구간과 서로 놓친 구간은 어디인가
- 확인된 객체 소유자와 역할 정책을 기준으로 BOLA/IDOR·BFLA 후보가 존재하는가
- 아직 실제 요청하지 않았지만 관측 응답이나 Burp Site Map에서 발견된 route 후보는 무엇인가
- LLM이 독립 탐색한 뒤 잠긴 데이터셋을 별도 Judge가 분석·재현·대조할 수 있는가

다음은 제품이 보장하지 않는다.

- 블랙박스 대상의 모든 endpoint·객체 발견
- 오탐·미탐 0
- HTTP 상태 코드 또는 LLM 문장만으로 취약점 확정
- 로그인·MFA·CAPTCHA의 범용 무인 자동화
- raw 인증정보의 영구 저장 또는 공유
- 알 수 없는 전체 공격면을 분모로 한 커버리지 퍼센트

## 3. 사용자 실행 흐름과 현재 구현 상태

### 3.1 설치와 범위

1. `mvn clean verify`로 fat JAR을 만든다.
2. Burp Suite Community/Professional에서 Release 또는 빌드한 `flowscope-1.2.0-beta.33.jar`를 Java 확장으로 로드한다. 처음 설치는 [설치·첫 실행 가이드](getting-started.md)를 따른다.
3. Burp Proxy listener를 준비한다.
   - `127.0.0.1:8080`: HUMAN
   - `127.0.0.1:8081`: SCANNER
   - `127.0.0.1:8082`: 선택적 LLM direct-proxy fallback
4. Burp FlowScope 탭에서 허가된 `http(s)://host[:port]/path-prefix`를 줄별로 입력하고 범위를 적용한다.

모든 저장과 active request는 exact scheme, host, effective port, path prefix 범위를 검사한다. HUMAN 브라우저의 범위 밖 이동은 막지 않지만 범위 밖 응답은 FlowScope에 저장하지 않는다.

### 3.2 계정과 세션

1. USER A, USER B 같은 테스트 계정을 표시 이름·서비스·역할로 등록한다.
2. 계정별 로그인 연결을 시작한다.
3. HUMAN 8080 경로로 직접 로그인하고 인증된 응답까지 관측한 뒤 캡처를 종료한다.
4. `ACTIVE` 세션만 ZAP/LLM과 Web 요청 실험실의 등록 계정 모드에서 사용할 수 있다.

raw Cookie, Authorization, CSRF는 `SessionBroker` 메모리에만 둔다. 프로젝트, Snapshot, MCP, 로그에는 저장하지 않는 것이 제품 불변조건이다. 다만 현재 ACTIVE 판정은 아래 P2 결함 때문에 실제 인증 성공을 과신할 수 있다.

### 3.3 HUMAN 탐색과 수동 검증

1. HUMAN pass를 시작한다.
2. Burp Browser, Proxy, Repeater, Intruder 등으로 허가된 기능을 탐색한다.
3. pass를 종료한다.
4. 그래프나 파싱 결과에서 Evidence를 선택해 Request/Response를 확인한다.
5. 필요한 경우 Web 요청 실험실에서 `ORIGINAL`, `ANONYMOUS`, `ACCOUNT` 모드로 편집·전송하거나 Burp Repeater로 넘긴다.

HUMAN pass 밖 트래픽과 로그인 준비 트래픽은 Evidence로 보존하지만 discovery coverage에는 포함하지 않는다. 요청 실험실 전송은 HUMAN `VALIDATION` Evidence이며 탐색 성과를 늘리지 않는다.

### 3.4 SCANNER 탐색

Web 빠른 시작에서 비로그인과 하나 이상의 ACTIVE 계정을 골라 ZAP 기준선을 실행한다. 시스템이 신원마다 fresh ZAP session을 만들고 다음 순서를 고정한다.

```text
Traditional Spider
  → Client Spider
  → AJAX Spider
  → passive queue 완료
  → native Alert 전 페이지 수집
```

`scope-only`는 ZAP Context 기준이므로 각 lane은 선택 target의 origin·path subtree만 포함하는 fresh Context를 만든다. sibling path·subdomain·다른 port/scheme은 regex 회귀로 제외한다.

시작 전 `spider/client/spiderAjax/pscan/pscanrules/selenium/openapi/websocket` add-on을 검사하고 신원별 fresh session에서 passive engine·전체 passive rule·scope-only를 명시 적용한다. Client/AJAX 실패나 0 capture는 숨기지 않고 경고 완료로 남기며 Alert 상세는 신원별 최대 20,000개까지 snapshot으로 보존한다. 기본 캠페인에는 Active Scan·Fuzzer·Forced Browse가 포함되지 않는다. Active Scan은 별도 사용자 승인이 필요하다. 각 신원 lane에서 실제 범위 내 SCANNER 응답이 수집되어야 완료 gate가 열린다.

### 3.5 독립 LLM Explorer와 Judge

1. Codex 또는 Claude Code CLI에 사용자가 직접 로그인한다.
2. Web에서 공급자 상태가 준비됨인지 확인하고 LLM Explorer를 시작한다. API key 입력이나 MCP 설정 복사는 없다.
3. FlowScope가 임시 workspace와 새 CLI 프로세스를 만들고 MCP 정보·격리 지침·run ID를 표준입력으로 준다.
4. Explorer는 자기 LLM run Evidence만 보고 read/write가 분리된 MCP로 exact-scope를 탐색한다. Web 작업 피드는 실제 모델 메시지·도구 상태·Evidence gate를 표시하지만 reasoning과 raw tool payload는 표시하지 않는다.
5. HUMAN, SCANNER, LLM 탐색이 모두 정상 종료되면 Judge를 시작한다.
6. Judge는 Explorer와 다른 새 세션에서 잠긴 후보·갭·Evidence·ZAP Alert를 읽는다.
7. 최종 판정은 동일 validation run의 반복 재현과 정상 대조 Evidence를 서버가 확인한 경우에만 허용된다.

Explorer는 외부 검색, Wayback, 대상 소스 저장소, 직접 curl/browser 요청을 사용하지 않는 closed-world 역할이다. 일반 assessment는 `LIKELY/INCONCLUSIVE/REJECTED`이며 `CONFIRMED`가 아니다.

### 3.6 저장

- 기본 내구 형식: 로컬 `.flowscope.db`
- 호환 import/export: `.flowscope.json`
- 자동 저장: DB를 한 번 지정한 뒤 revision을 30초 단위로 합친 checkpoint
- 비영속: raw broker credential, 요청 실험실 raw vault, 화면 전송 이력

프로젝트를 다시 열면 계정·정책·Evidence·검토·LLM 판정은 복원하지만 인증 세션은 다시 연결해야 한다.

## 4. 현재 아키텍처

```text
Burp Proxy/도구 callback
  → exact-scope 검사
  → 요청 시점 run/account/epoch 상관관계
  → HTTP byte decode + bounded raw vault
  → 마스킹 RequestRecord
  → Pipeline
       ├─ path/identity/resource 정규화
       ├─ traffic class/disposition
       ├─ route candidate 추출
       ├─ owner/role 기반 인가 분석
       └─ graph/data-flow 생성
  → Web snapshot/API ──→ 그래프·매트릭스·Evidence·요청 실험실
  → SQLite/JSON 저장
  → MCP ──→ LLM Explorer/Judge
  → ZAP API ──→ 신원별 scanner lane
```

데이터 의미는 다음처럼 분리한다.

| 축 | 의미 |
|---|---|
| `source` | 실제 트래픽 생성자: HUMAN, SCANNER, LLM |
| `orchestrator` | 실행을 지휘한 주체: HUMAN, SYSTEM, LLM |
| `tool`/`sourceDetail` | Browser, Burp, ZAP 단계, Codex/Claude 등 |
| `phase` | SESSION_SETUP, BASELINE, EXPLORATION, VALIDATION 등 |
| `executionTrust` | 관측, 통제 실행, 미검증 runtime 구분 |
| `authState` | ANONYMOUS, ACCOUNT_BOUND, UNRESOLVED |
| `trafficDisposition` | INCLUDE, REVIEW, EXCLUDE |

## 5. 코드 지도

### 5.1 Burp 경계

| 파일 | 책임 |
|---|---|
| [`FlowScopeExtension.java`](../../src/main/java/io/flowscope/burp/FlowScopeExtension.java) | 확장 진입점, listener/tool 수집, scope, run 문맥, pipeline rebuild, Web/MCP/ZAP/session/persistence 연결 |
| [`InFlightRequestTracker.java`](../../src/main/java/io/flowscope/burp/InFlightRequestTracker.java) | 요청 시점 context/account/dataset epoch를 응답과 연결 |
| [`TransientExchangeVault.java`](../../src/main/java/io/flowscope/burp/TransientExchangeVault.java) | live 원 HTTP byte의 상한 있는 메모리 보관 |
| [`HttpMessageTextCodec.java`](../../src/main/java/io/flowscope/burp/HttpMessageTextCodec.java) | HTTP 헤더와 textual body의 strict charset decode/encode |
| [`FlowScopeControlTab.java`](../../src/main/java/io/flowscope/ui/FlowScopeControlTab.java) | Burp 내부 제어 탭과 Web/MCP 접속 정보 |

### 5.2 분석 코어

| 파일 | 책임 |
|---|---|
| [`RequestRecord.java`](../../src/main/java/io/flowscope/core/RequestRecord.java) | 관측 Evidence의 중심 데이터 모델 |
| [`Pipeline.java`](../../src/main/java/io/flowscope/core/Pipeline.java) | 정규화·분류·인가·그래프 파이프라인 조합 |
| [`Normalizer.java`](../../src/main/java/io/flowscope/core/Normalizer.java) | operation path, identity, object reference 정규화 |
| [`TrafficClassifier.java`](../../src/main/java/io/flowscope/core/TrafficClassifier.java) | API/정적/인증/polling 등 class와 INCLUDE/REVIEW/EXCLUDE 결정 |
| [`AuthorizationAnalyzer.java`](../../src/main/java/io/flowscope/core/AuthorizationAnalyzer.java) | coverage cell, gap, BOLA/IDOR·BFLA 후보 생성 |
| [`ResponseEvidence.java`](../../src/main/java/io/flowscope/core/ResponseEvidence.java) | status, redirect, soft-deny, 응답 내용 판정 |
| [`DataFlowAnalyzer.java`](../../src/main/java/io/flowscope/core/DataFlowAnalyzer.java) | 이전 응답 값이 뒤 요청에 소비된 제한적 flow link 생성 |
| [`ObservationCollapser.java`](../../src/main/java/io/flowscope/core/ObservationCollapser.java) | Evidence를 삭제하지 않는 표시 전용 반복 묶음 |
| [`RecordMerge.java`](../../src/main/java/io/flowscope/core/RecordMerge.java) | Proxy history 재가져오기 중복 억제 |
| [`StoredPayload.java`](../../src/main/java/io/flowscope/core/StoredPayload.java) | 마스킹 textual 전문의 GZIP/digest/retention 모델 |
| [`BurpXmlParser.java`](../../src/main/java/io/flowscope/core/BurpXmlParser.java) | XXE 차단 Burp XML traffic import |
| [`HarParser.java`](../../src/main/java/io/flowscope/core/HarParser.java) | bounded ZAP HAR 1.2 SCANNER traffic import |
| [`FlowGraphBuilder.java`](../../src/main/java/io/flowscope/core/graph/FlowGraphBuilder.java) | identity-resource-operation graph 생성 |

### 5.3 Route discovery

| 파일 | 책임 |
|---|---|
| [`RouteCandidateExtractor.java`](../../src/main/java/io/flowscope/core/RouteCandidateExtractor.java) | 공통 exact-scope/method/정규화/dedup gate |
| [`discovery/`](../../src/main/java/io/flowscope/core/discovery) | HTML, JavaScript, OpenAPI, metadata, generic XML 어댑터 |
| [`RouteCandidateViews.java`](../../src/main/java/io/flowscope/core/RouteCandidateViews.java) | Explorer 자기 run 및 잠긴 Judge 시야 projection |

Route candidate는 실제 request/response가 없는 중립 후보다. coverage, gap, verdict, finding을 만들면 안 된다.

### 5.4 세션·자동화·저장

| 파일 | 책임 |
|---|---|
| [`SessionBroker.java`](../../src/main/java/io/flowscope/integration/SessionBroker.java) | 계정별 메모리 전용 Cookie/Authorization/CSRF 수명과 주입 |
| [`ZapClient.java`](../../src/main/java/io/flowscope/integration/ZapClient.java) | localhost ZAP API, spider/passive/alert orchestration |
| [`McpServer.java`](../../src/main/java/io/flowscope/integration/McpServer.java) | localhost 인증 MCP, Explorer 격리, dataset lock, target executor, assessment/validation gate |
| [`LocalLlmRunner.java`](../../src/main/java/io/flowscope/integration/LocalLlmRunner.java) | Codex/Claude CLI 새 프로세스, 임시 workspace, Judge 재개 |
| [`ProjectStore.java`](../../src/main/java/io/flowscope/integration/ProjectStore.java) | JSON schema v3 저장·로드, v1/v2 호환 읽기, exact completed run 보존 |
| [`SqliteProjectStore.java`](../../src/main/java/io/flowscope/integration/SqliteProjectStore.java) | 관계형 로컬 DB와 atomic checkpoint |

### 5.5 Web 작업면

| 파일 | 책임 |
|---|---|
| [`FlowScopeWebServer.java`](../../src/main/java/io/flowscope/web/FlowScopeWebServer.java) | localhost capability API, snapshot/evidence/request-lab/run control |
| [`SnapshotJsonWriter.java`](../../src/main/java/io/flowscope/web/SnapshotJsonWriter.java) | Pipeline 결과의 Web projection |
| [`index.html`](../../src/main/resources/web/index.html) | whs_flow 기반 단일 페이지 UI, Cytoscape graph, matrix, Evidence, 계정, 빠른 시작 |
| [`Standalone.java`](../../src/main/java/io/flowscope/Standalone.java) | 네트워크 없는 샘플 Web 렌더·개발 확인 |

## 6. 현재 구현된 범위

### 6.1 수집·신원·Evidence

- HUMAN/SCANNER/LLM source와 세부 provenance 보존
- exact scope 수집 및 active request 차단
- Proxy와 Burp 비-Proxy 도구의 요청 시점 run/account/epoch 상관관계
- query, body, redirect, timestamp, media type, GraphQL, Fetch Metadata 수집
- 마스킹 preview와 상한 있는 압축 전문 분리
- live 요청 실험실용 raw byte vault
- 계정 중심 UI와 메모리 전용 Session Broker
- Proxy history, 엄격한 Burp XML import, scanner-only ZAP HAR 1.2 import

### 6.2 정규화·노이즈·route

- UUID/긴 hex/응답 ID 일치/반복 관측 근거의 단계형 path template
- path/query/body/GraphQL/multipart/XML 객체 참조
- 보수적 semantic identifier 보강
- Evidence 보존형 traffic classification과 사용자 override
- 반복 관측 표시 접기
- HTML/JS/OpenAPI/metadata/XML/Burp Site Map route candidate
- route candidate와 실제 관측 coverage 분리

### 6.3 비교·판정·시각화

- `신원 × operation × 객체` coverage cell
- UNCROSSED, PARTIAL_DISCOVERY, CONFLICT 계산
- owner/role 정책 기반 BOLA/IDOR·BFLA 후보
- HUMAN 파랑·실선, SCANNER 빨강·파선, LLM 검정·점선
- graph, matrix, flow order, scenario, parsing result, account/session 화면
- Evidence별 Request/Response와 Web 요청 실험실/Burp Repeater handoff

### 6.4 자동화·LLM

- 신원별 fresh ZAP session 캠페인
- Traditional → Client → AJAX → passive → paginated Alert 단계
- localhost Bearer MCP와 exact-scope target executor
- 독립 Explorer 시야와 3-lane 완료 gate
- 잠긴 Judge 분석과 Evidence-bound validation
- Codex/Claude 구독 CLI 새 프로세스 실행, 취소, Judge 후속 재개

### 6.5 내구성·공개 저장소

- SQLite 기본 저장과 JSON 호환 import/export
- Maven fat JAR 단일 산출물 검사
- Montoya API 비번들, 의존성 relocation, third-party notice
- JUnit 회귀와 GitHub Actions CI
- 한국어 기본 문서와 영어 공개 문서 분리

## 7. 실제로 검증된 범위

### 자동 검증

2026-08-31 기준 JDK 21 `mvn clean verify` 278 tests가 실패·오류·skip 없이 통과했고 완성 JAR smoke도 통과했다. 파서, 정규화, 분류, 인가 분석, 저장 round-trip, MCP, ZAP client mock, 세션 broker, byte codec, raw vault, ZAP key file, Web API 문자열 계약을 포함한다. beta.24는 판정 오라클과 게시 격리, beta.25는 streaming manifest와 version-independent MR-JAR relocation, beta.26은 ZAP HAR import, beta.27은 ZAP Context/passive/scope preflight·Traditional/Client/AJAX 독립 실행·501개 Alert pagination과 구독 CLI 자식 `PATH`, beta.28은 LLM read/write 분리·server 0-Evidence 종료 거부와 ZAP outgoing-proxy/명시 API 정의 import, beta.29는 login-only 임시 Codex home과 launcher exact-Evidence gate, beta.30은 bounded 실시간 LLM 작업 피드, beta.31은 공식 auth status·표준 경로 탐지·READY provider 자동 선택, beta.32는 목적별 trust·exact-run 완료·동결 Evidence dataset lock과 JSON v3/SQLite v2 저장, beta.33은 Request Lab 단일 실행·분석 publication epoch·exact 미교차 표시를 추가했다. JAR digest는 `beta-validation.md` 정본을 따른다.

### 실제·standalone 검증

- beta.15에서 Burp Community, ZAP 2.17, crAPI anonymous scanner의 Client→AJAX fallback과 raw capture를 실제 확인했다.
- beta.19 standalone 1280px/600px에서 Cytoscape wrapper와 좁은 화면 API 목록의 표시 경계를 확인했다.
- beta.18 byte codec과 request-lab 자동 회귀는 통과했다.

### 아직 검증되지 않은 것

- beta.33 JAR의 실제 Burp Community end-to-end HUMAN/SCANNER/LLM/Judge 실행과 프로젝트 저장·재열기
- 실제 ZAP 2.17 UI에서 저장한 HAR의 beta.33 scanner import와 Evidence 상세 확인
- 실제 Burp Request Lab의 고지연 A→B 선택, 상태 변경 이중 전송, clear/rebuild callback 경합
- 실제 ZAP 2.17에서 OpenAPI·GraphQL·Postman·SOAP 정의별 요청 생성, exact-scope 차단, 신원별 인증 주입과 경고 표시 확인
- 실제 ZAP Desktop의 key·8089 API·8081 upstream·필수 add-on과 Web 연결 상태 수동 gate
- Windows 10/11 + Docker Desktop + PowerShell 7 실기기의 ZAP API/upstream/target capture
- 실제 Burp에서 request-lab ORIGINAL/ANONYMOUS/ACCOUNT 수신 byte와 credential 비교
- USER A/USER B 복수 세션과 ZAP/LLM 주입의 전체 흐름
- 20,000건 근처의 메모리·응답 시간·UI polling 부하
- 불특정 일반 대상 corpus의 endpoint/object/classifier precision·recall
- 정답을 격리한 crAPI 블라인드 benchmark
- 실제 취약점 탐지율과 사람 REVIEW 비용

자동테스트 통과를 위 항목의 성공으로 해석하면 안 된다.

## 8. 알려진 결함 — 다음 개발의 실제 시작점

아래는 2026-08-28 clean-room 코드 리뷰에서 코드 경로로 확인한 항목이다. beta.33에서 닫은 항목과 아직 남은 항목을 분리하며, 자동 회귀와 실제 Burp 수동 gate도 구분한다.

### beta.33에서 닫은 P1

1. **Request Lab Evidence 비동기 역전:** Evidence generation과 immutable event ID를 비교해 늦은 GET·POST·Repeater 응답을 폐기한다.
2. **Request Lab 중복 상태 변경 전송:** 전송 동안 편집·계정·인증·닫기를 잠그고, 서버 응답을 받지 못한 동일 draft는 같은 operation ID를 재사용하며, 서버의 ID+입력 digest 멱등성으로 같은 작업을 한 번만 실행한다. 완료 cache는 raw 요청·응답 대신 compact 결과만 최대 256건 보존한다.
3. **stale pipeline 결과 게시:** `AnalysisPublicationGate`의 publication epoch가 같은 결과만 `latest`·route candidate·revision에 원자 게시한다.
4. **일반 빈 셀의 IDOR 오표시:** exact server `UNCROSSED` key만 gap으로 표시하고 나머지는 중립 `미검증`으로 분리한다.

집중 회귀는 완료했지만 실제 Burp UI의 고지연 A→B 선택, 상태 변경 중복 클릭, clear/rebuild 동시 실행은 beta.33 JAR 수동 gate가 남아 있다. 자동 회귀를 실환경 완료로 표현하지 않는다.

### P1 — 아직 남은 출시·벤치마크 차단

5. **Snapshot 중복 cluster의 O(N²) 출력**
   - 위치: `SnapshotJsonWriter.events`
   - 영향: N개 이벤트마다 같은 cluster의 N개 Evidence ID를 반복하여 20,000건에서 메모리와 응답 크기가 폭증한다. Web은 이를 1초마다 요청한다.
   - 완료 조건: event에는 cluster ID/count만 두고 ID 목록은 페이지 API로 분리한다. 20,000건 stress에서 정한 heap·latency 예산을 측정해야 한다.

6. **DataFlow 분석 O(N²)와 substring 오연결**
   - 위치: `DataFlowAnalyzer.analyze`, `consumes`
   - 현재 완화: beta.24에서 구조화 응답을 bounded JSON으로 읽고 malformed/non-JSON 정규식 fallback을 64KiB·값 1,000개로 제한해 단일 대형 응답의 CPU 점유는 막았다.
   - 남은 영향: 전체 record/value 조합은 O(N²)이며 소비 판정이 substring이라 `123`과 `/1234`를 실제 전달 관계로 오인할 수 있다.
   - 완료 조건: producer value index와 구조적 소비 위치를 사용하고 token-boundary 음성 회귀와 대량 성능 테스트를 통과해야 한다.

7. **대용량 HTTP 응답을 상한 적용 전에 전체 decode/mask**
   - 위치: `FlowScopeExtension.recordFrom`, `HttpMessageTextCodec.decode`
   - 영향: 저장하지 않을 대형 JSON/text도 전체 문자열·Jackson tree·복사본을 먼저 만들어 Burp JVM을 멈출 수 있다.
   - 완료 조건: byte 크기 선검사, bounded preview/digest 경로, oversized live response 회귀가 필요하다.

8. **프로젝트 payload 무제한 GZIP 해제**
   - 위치: `StoredPayload.restore/text`, `ProjectStore.readPayload`
   - 영향: 작은 악성 프로젝트의 gzip bomb 또는 반복 blob 참조가 Burp JVM을 소진할 수 있다.
   - 완료 조건: bounded streaming decompression, 원 저장 상한 재검증, digest별 복원 cache, aggregate budget과 공격 fixture가 필요하다.

9. **LLM assessment 총량 무제한**
   - 위치: `McpServer.submitAssessment`, `SnapshotJsonWriter.scenarios`
   - 영향: 1,000개 count 제한만 있고 문자열·Evidence 배열·총 byte 제한이 없어 모델 루프가 heap을 소진할 수 있다.
   - 완료 조건: 필드·배열·총 retained byte 제한과 저장 복원 경계 테스트가 필요하다.

### P2 — 정확성·운영 안정성

1. **임의 쿠키와 403/404가 ACTIVE 세션이 될 수 있음**
   - 위치: `SessionBroker.observeRequest/observeResponse/endCapture`
   - 영향: analytics/consent 쿠키를 등록 계정의 인증 세션으로 주입하고 이후 Evidence를 오귀속할 수 있다.
   - 완료 조건: 검증 endpoint 또는 명시적 사용자 확인 등 ACTIVE 신뢰 계약을 결정하고 analytics-only, 200 실패 페이지, 403/404 회귀를 추가한다.

2. **모든 저장 쿠키 exact-match로 인한 정상 세션 미매칭**
   - 위치: `SessionBroker.accountForRequest`
   - 영향: 변동 analytics 쿠키 하나 때문에 실제 auth cookie가 일치해도 계정 귀속이 풀릴 수 있다.
   - 완료 조건: 인증 핵심과 보조 쿠키를 구분하는 근거 있는 정책 및 ambiguity fail-closed 테스트가 필요하다.

3. **Proxy history 병합이 다른 계정 관측을 중복 제거**
   - 위치: `RecordMerge.Key`, `FlowScopeExtension.importProxyHistory`
   - 영향: 마스킹 후 동일해진 USER A/B 요청 중 하나가 사라져 신원별 coverage가 손실될 수 있다.
   - 완료 조건: 안전한 fingerprint/account/run/timestamp 의미를 병합 키에 반영하고 다른 계정 동일 요청 회귀를 추가한다.

4. **서명 미검증 JWT subject가 계정 바인딩 키로 승격**
   - 위치: `Fingerprints.jwtSub`, `AnalysisConfig.applyIdentityBindings`
   - 영향: 다른 또는 위조 JWT의 같은 `sub`가 등록 계정 Evidence로 귀속될 수 있다.
   - 완료 조건: JWT subject는 unresolved hint로만 쓰고 broker exact credential 또는 검증된 namespace와 교차 확인한다.

5. **잘못된 프로젝트 열기가 기존 runtime 상태부터 제거**
   - 위치: `FlowScopeExtension.loadProjectFile`
   - 영향: corrupt/unsupported 파일을 골라도 세션, run context, route 상태가 먼저 사라진다.
   - 완료 조건: 완전한 임시 load/검증 뒤 원자 교체하고 실패 rollback 테스트를 통과해야 한다.

6. **LLM 취소가 child 종료를 보장하지 않음**
   - 위치: `LocalLlmRunner.cancel/close`
   - 영향: SIGTERM을 무시하는 CLI가 살아서 다음 실행을 막고 MCP 환경을 유지할 수 있다.
   - 완료 조건: graceful timeout, `destroyForcibly`, exit 확인, resistant fake process 테스트가 필요하다.

7. **ZAP run 중 native Burp Scanner가 같은 캠페인으로 귀속될 수 있음**
   - 위치: `FlowScopeExtension.ToolHandler`와 전역 SCANNER context
   - 영향: 무관한 Burp Scanner 요청이 ZAP run ID/account/CONTROLLED trust와 completion count를 오염시킬 수 있다.
   - 완료 조건: 실행 채널/listener 상관관계 또는 native Scanner 배제 정책과 동시 실행 회귀가 필요하다.

8. **Burp XML의 비 UTF-8 body 손실**
   - 위치: `BurpXmlParser`
   - 영향: ISO-8859-1, Shift_JIS, invalid UTF-8, binary body가 replacement character로 변해 Evidence와 digest가 달라질 수 있다.
   - 완료 조건: raw header/body 분리와 strict charset/binary 처리 fixture가 필요하다.

9. **IPv6 origin 문자열이 잘못 구성됨**
   - 위치: `AccountProfile`, `ScopePolicy`, `FlowScopeExtension`, `BurpXmlParser`
   - 영향: `::1`을 `[::1]`로 감싸지 않아 scope/account/session/XML 처리에서 URI가 깨질 수 있다.
   - 완료 조건: 중앙 authority formatter와 IPv6 scope round-trip, live service, persistence, XML 회귀가 필요하다.

### UI·접근성 부채

- 좁은 화면 API 목록은 최초 18개 뒤 항목을 펼칠 수 없다.
- desktop Cytoscape는 pointer 중심이며 keyboard/screen-reader 대체 목록이 숨겨진다.
- `aria-modal=true`지만 focus trap, background inert, focus 복원이 없다.
- `--faint` 색상으로 표시하는 작은 설명문 일부가 WCAG 일반 텍스트 대비에 미달한다.
- clear/project replacement 뒤 browser textarea에 raw request/response가 남을 수 있다.

이 항목은 P1 의미·안전 결함 뒤에 처리하되 정식 공개 전에는 닫아야 한다.

## 9. 다음 개발 순서

### 단계 A — 기준선과 재현 고정

1. 현재 인계 HEAD에서 새 작업 branch를 만든다.
2. 위 P1마다 먼저 실패하는 최소 회귀를 추가한다.
3. 브라우저 race는 실제 DOM/fetch 동작을 실행하는 테스트 계층을 추가한다. 현재 Web 테스트는 HTML/JavaScript 문자열 계약 중심이다.
4. 성능 항목은 임의 표현이 아니라 record 수, heap, serialized byte, latency를 측정한다.

종료 조건:

- 모든 P1에 재현 테스트 또는 측정 harness가 존재한다.
- 테스트가 수정 전 실패하는 이유가 결함 설명과 일치한다.
- crAPI 정답이나 실타깃 전용 예외를 사용하지 않는다.

### 단계 B — HUMAN 정확성·안전성

순서:

1. stale rebuild 게시 차단
2. Request Lab draft/Evidence 원자 결합
3. Request Lab in-flight 중복 전송 차단
4. 빈 셀과 실제 UNCROSSED 후보 표시 분리
5. dataset replacement 시 Web raw textarea·pending request 폐기
6. Proxy history 신원별 병합 정정

종료 조건:

- clear 이후 이전 Evidence가 다시 나타나지 않는다.
- A/B Evidence 응답 역전에서도 선택한 request/service/credential가 바뀌지 않는다.
- 상태 변경 요청은 한 번의 사용자 조작당 한 번만 송신된다.
- owner 없는 빈 셀은 IDOR 후보 문구·수량에 포함되지 않는다.
- USER A/B 동일 API 관측이 각각 보존된다.

### 단계 C — 메모리·성능 경계

순서:

1. Snapshot cluster projection 선형화
2. DataFlow index/token 소비 판정
3. 대용량 live HTTP byte 선검사
4. 프로젝트 bounded decompression과 payload cache
5. assessment/validation aggregate budget

종료 조건:

- 20,000건 fixture에서 Snapshot 크기와 처리 시간이 관측 수에 선형적으로 증가한다.
- 큰 동일 cluster가 Evidence ID의 제곱 출력으로 변하지 않는다.
- oversized response와 gzip bomb fixture가 정한 상한 안에서 거부 또는 metadata-only가 된다.
- Burp callback thread에서 무거운 전체 pipeline을 실행하지 않는다.

### 단계 D — 세션·신원 신뢰 모델

1. ACTIVE 판정 계약을 별도 설계 결정으로 확정한다.
2. auth cookie/header와 변동 보조 쿠키의 역할을 분리한다.
3. JWT payload hint가 account-bound 증거가 되지 않게 한다.
4. project load를 validate-then-swap으로 바꾼다.
5. IPv6 authority와 비 UTF-8 XML import를 수정한다.

종료 조건:

- analytics-only 세션은 ACTIVE가 아니다.
- 정상 auth cookie가 유지된 채 보조 쿠키가 회전해도 잘못된 계정 병합 없이 매칭 정책이 설명 가능하다.
- invalid JWT와 동일 `sub`가 등록 계정으로 승격되지 않는다.
- 잘못된 프로젝트 load 뒤 기존 records/session/run 상태가 그대로다.

### 단계 E — ZAP·LLM 운영 안정성

1. native Burp Scanner와 ZAP campaign provenance를 분리한다.
2. ZAP 비로그인·USER A·USER B 각 lane에서 session injection과 raw capture gate를 실제 확인한다.
3. LLM cancel/close에 강제 종료와 workspace cleanup을 추가한다.
4. Explorer와 Judge를 실제 Codex 구독 CLI로 실행해 시야 격리와 run 종료를 확인한다.
5. Claude는 사용 가능한 팀원 환경에서 별도 확인하고 Codex 결과를 Claude 성공으로 간주하지 않는다.

종료 조건:

- 각 lane의 source/run/account provenance가 섞이지 않는다.
- 실패한 rendered crawler와 실패한 CLI가 깨끗한 완료로 표시되지 않는다.
- 취소 후 child process와 active run이 남지 않는다.

### 단계 F — 실제 Burp 제품 QA

허가된 범용 local fixture에서 다음을 실행한다.

- 익명, USER A, USER B HUMAN pass
- Browser, Repeater, Intruder, Web Request Lab
- 긴 path, query/body object, GraphQL, multipart, XML, redirect, 401/403/404/429/5xx
- 큰 응답, 바이너리, 여러 문자셋
- scope 밖 이동과 redirect 차단
- DB save/unload/reload와 재로그인
- desktop/narrow UI, keyboard, 긴 문자열, 20,000건 근접 stress

결과는 [베타 검증](beta-validation.md)에 실제 버전·환경·명령·성공·실패·미수행을 구분해 기록한다.

### 단계 G — 블라인드 벤치마크

위 단계가 끝난 뒤에만 새 프로젝트로 crAPI 벤치마크를 시작한다.

1. 정답 목록과 공격 절차를 보지 않은 사람이 HUMAN pass를 수행한다.
2. ZAP lane을 독립 실행한다.
3. LLM Explorer를 독립 실행한다.
4. 세 lane을 잠그고 Judge를 실행한다.
5. 결과 고정 후에만 정답과 대조한다.

측정값:

- endpoint/operation TP, FP, FN
- object reference TP, FP, FN
- classifier confusion matrix와 REVIEW 작업량
- source별 coverage cell과 gap
- 규칙 후보, LLM assessment, 최종 validation의 TP, FP, FN, INCONCLUSIVE
- 각 단계 시간, 요청 수, 메모리, 사용자 개입

같은 데이터로 규칙을 만든 뒤 같은 데이터에서 성능을 주장하지 않는다.

### 단계 H — 공개 베타·정식 출시

- P1 0건
- 알려진 P2의 수용 또는 수정 근거 기록
- CI와 실제 Burp 제품 QA 통과
- 새 clone 기준 설치·첫 실행 문서 검증
- 공개 fixture와 benchmark 방법·원시 집계 공개
- SECURITY, CONTRIBUTING, README, CHANGELOG, architecture, decisions, beta-validation 동기화
- release JAR, source tag, checksum을 같은 커밋에서 생성

## 10. 테스트 지도와 추가 원칙

| 영역 | 현재 회귀 |
|---|---|
| 정규화·객체 | `NormalizerTest`, `AdvancedNormalizerTest`, `RouteTemplateEvidenceTest`, `AccuracyRegressionTest` |
| 분류·메타데이터 | `TrafficClassifierTest`, `PipelineClassificationTest`, `TrafficMetadataTest` |
| 인가·그래프 | `AuthorizationAnalyzerTest`, `FlowGraphBuilderTest`, `DataFlowAnalyzerTest` |
| route discovery | `RouteCandidateExtractorTest`, `RouteCandidateViewsTest`, `EndpointDiscoveryCorpusTest` |
| 세션·신원 | `SessionBrokerTest`, `AccountSessionTest`, `FingerprintsTest` |
| 저장 | `StoredPayloadTest`, `ProjectStoreTest`, `SqliteProjectStoreTest` |
| Burp byte/context | `HttpMessageTextCodecTest`, `TransientExchangeVaultTest`, `InFlightRequestTrackerTest` |
| MCP·LLM·ZAP | `McpServerTest`, `LocalLlmRunnerTest`, `ZapClientTest` |
| Web | `FlowScopeWebServerTest` |

새 테스트는 실제 결함의 최소 재현을 우선한다. crAPI 이름, 특정 회사 endpoint, 실제 credential, 보고서 내용을 fixture에 넣지 않는다. 공개 합성 fixture만 사용한다.

## 11. 팀원이 처음 실행할 명령

```bash
git status --short
git log -1 --oneline
mvn clean verify
```

성공 후 `target/flowscope-1.2.0-beta.33.jar`를 Burp에 로드한다. `target/`은 커밋하지 않는다. Release JAR 사용자는 Maven이 필요 없고, 소스 빌드자는 IDE의 임의 JDK로 우회하기 전에 JDK 21과 Maven 3.9 이상을 명시적으로 맞춘다.

## 12. Git 협업 규칙

작업자는 같은 공유 branch에서 동시에 직접 수정하지 않는다.

```bash
git switch main
git pull --ff-only
git switch -c fix/request-lab-race
```

각 작업은 다음 단위를 한 commit에 둔다.

- 실패 재현 테스트
- 최소 구현 수정
- 해당 계약 문서
- `development-log.md`
- 공개 동작이면 `CHANGELOG.md`와 README

PR 전 확인:

```bash
git diff --check
mvn clean verify
git status --short
```

다음을 commit하지 않는다.

- `target/`
- `.flowscope.db`, `.flowscope.json`
- `output/`, `tmp/`, `.local/`
- 실제 대상 Request/Response, screenshot, 고객명, endpoint 목록
- Cookie, Authorization, password, API key, provider token

충돌이 생기면 상대 변경을 삭제하거나 `ours/theirs`로 통째로 덮지 않는다. 양쪽 변경의 테스트와 문서 계약을 확인해 줄 단위로 합치고 `mvn clean verify`를 다시 실행한다.

## 13. 변경할 때 지켜야 할 불변조건

- source와 orchestrator를 합치지 않는다.
- status 2xx 하나로 인가 성공이나 취약점을 확정하지 않는다.
- route candidate를 실제 관측 coverage로 승격하지 않는다.
- REVIEW/EXCLUDE Evidence를 저장 단계에서 삭제하지 않는다.
- raw credential을 project, MCP, snapshot, log로 내보내지 않는다.
- active request는 exact scope와 필요한 사용자 승인을 거친다.
- LLM assessment와 서버 검증 final verdict를 구분한다.
- validation/coach traffic으로 discovery coverage를 늘리지 않는다.
- 전체 공격면을 모르는 블랙박스에서 커버리지 퍼센트를 만들지 않는다.
- 자동테스트, standalone 렌더, 실제 Burp 통합, 블라인드 benchmark를 서로 다른 증거로 기록한다.

## 14. 인계 직후 권장 작업 분배

동시에 같은 파일을 건드리지 않도록 경계를 나눈다.

| 작업 | 중심 파일 | 선행 조건 |
|---|---|---|
| A. rebuild epoch/CAS | `FlowScopeExtension`, 동시성 회귀 | 없음 |
| B. Request Lab race/in-flight | `index.html`, `FlowScopeWebServer`, browser 행동 테스트 | draft 계약 합의 |
| C. matrix candidate 정합성 | `index.html`, `SnapshotJsonWriter`, Web 행동 테스트 | 서버 candidate key 유지 |
| D. Snapshot/DataFlow 성능 | `SnapshotJsonWriter`, `DataFlowAnalyzer`, stress fixture | 출력 계약 합의 |
| E. payload memory 경계 | `StoredPayload`, `ProjectStore`, live capture path | byte budget 합의 |
| F. Session Broker 신뢰 | `SessionBroker`, `Fingerprints`, `AnalysisConfig` | ACTIVE 계약 결정 |

작업 A~F가 같은 `FlowScopeExtension` 또는 `index.html`을 동시에 바꾸게 되면 먼저 작은 PR부터 순차 병합한다. 리팩터링을 선행하지 말고 각 결함과 직접 연결된 최소 변경부터 적용한다.

## 15. 인계 완료 판단

팀원이 다음 질문에 코드와 테스트 링크로 답할 수 있으면 인계가 완료된 것이다.

1. HUMAN, SCANNER, LLM은 어떻게 구분되는가?
2. 계정과 raw 세션은 어디에 저장되고 언제 폐기되는가?
3. route candidate와 observed operation은 무엇이 다른가?
4. coverage gap과 취약점 finding은 무엇이 다른가?
5. LLM assessment와 final validation은 무엇이 다른가?
6. 현재 P1은 무엇이며 어떤 순서로 닫는가?
7. 자동테스트가 증명하지 못하는 실제 gate는 무엇인가?
8. 다음 benchmark가 정답 누수 없이 어떻게 수행되는가?

이 문서의 결함 목록이나 상태가 바뀌면 코드·테스트·해당 정본 문서와 같은 commit에서 갱신한다.
