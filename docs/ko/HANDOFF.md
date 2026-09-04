# FlowScope 팀 인계 정본

이 문서는 새 팀원이 현재 코드의 상태를 과장 없이 파악하고 바로 개발을 이어가기 위한 시작점이다. 제품 설명, 구현 위치, 완료·미완료 구분, 알려진 결함, 다음 작업 순서와 검증 기준을 한곳에 모은다.

## 0. 인계 기준선

| 항목 | 기준 |
|---|---|
| 기준 날짜 | 2026-09-04 |
| 제품 버전 | `1.2.0-beta.44` |
| 로컬 기준 커밋 | beta.44 React 통합 집중 커밋은 `git log -1 --oneline`으로 확인 |
| 브랜치·원격 차이 | 로컬 `codex/react-ui-integration`; `origin/main`과의 정확한 ahead/behind는 `git rev-list --left-right --count origin/main...HEAD`로 확인 |
| Java | JDK 21 이상 |
| 빌드 | Maven 3.9 이상, `mvn clean verify` |
| 자동 회귀 | beta.44 최종 `mvn clean verify` 연속 2회, 매회 React 37 files/265 tests와 Java 372 tests, failure/error/skip 0 |
| 현재 JAR | `target/flowscope-1.2.0-beta.44.jar`, 31,525,631 bytes, 9,125 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `7aa41c27ea33c0129ed706a1f9b18f9bca9dcf6e9e3314c7442315382278dee0` |
| 현재 판정 | React 기본 작업면과 beta.44 Surface·실행 원장·그래프를 standalone에서 연결하고 전체 route를 확인. 실제 Burp HUMAN/ZAP/LLM·세션·Request Lab과 TLS/DNS 분류·독립 외부 pilot은 남음 |

`target/`의 JAR은 Git 산출물이 아니다. clone한 팀원은 직접 빌드해야 한다. `.flowscope.db`, `.flowscope.json`, 실제 대상 트래픽, 인증정보, `output/`, `tmp/`도 공유 소스에 포함하지 않는다.

현재 작업 전부터 사용자가 별도 작성한 `mentor-progress-report.md`가 untracked이고 루트 `CLAUDE.md`에도 사용자 변경이 있었다. 보고서는 사용자가 명시적으로 “커밋하지 말라”고 했으므로 수정·삭제·커밋하지 않으며, 루트 `CLAUDE.md`도 이번 Explorer 변경과 분리한다. `.local/`, `output/`, `target/`, `tmp/`는 ignored 로컬 산출물이다.

## 1. 문서 정본과 읽는 순서

이 문서는 현재 작업의 출발점이지만 기존 정본을 대체하지 않는다. 다음 순서로 읽는다.

1. 이 문서: 현재 상태, 알려진 결함, 다음 작업
2. [루트 README](../../README.md): 설치, 사용자 흐름, 공개 제품 행동
3. [아키텍처](architecture.md): 데이터 흐름, 모듈, 신뢰 경계
4. [설계 결정](decisions.md): 선택 근거, 기각한 대안, 한계
5. [개발 기록](development-log.md): 버전별 변경·이유·검증
6. [베타 검증](beta-validation.md): 실제 수행한 검증과 아직 수행하지 않은 gate
7. [제품 개발 계획](product-development-plan.md): 장기 단계와 벤치마크 계획
8. [기능 명세](specification/functional-spec.md): 요구사항 F-01~F-25
9. [Endpoint·Parameter Surface](endpoint-parameter-surface.md): 범용 fact, 표시 상태, 블라인드 평가 계약

충돌할 경우 현재 실행 코드를 먼저 확인하고 문서를 함께 바로잡는다. 원 기능명세는 요구사항 기록이며 현재 구현의 신뢰 경계 정본은 아니다.

## 2. 제품 목표와 비목표

FlowScope의 핵심 문제는 보안 진단자가 Burp의 요청 목록만 보고 아직 보지 못한 endpoint·조건부 parameter를 찾고, 이어 신원·권한·객체·상태 흐름까지 머릿속으로 재구성해야 한다는 점이다. 제품은 동일 exact scope에서 선언된 입력과 HUMAN, SCANNER, LLM이 실제로 만든 요청·응답을 공통 구조로 정렬하고 다음을 보여 준다.

- 어떤 API·입력이 선언됐고 누가 실제로 관측했는가
- 선택한 API에서 누가 어떤 객체에 접근했는가
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
2. Burp Suite Community/Professional에서 Release 또는 빌드한 `flowscope-1.2.0-beta.44.jar`를 Java 확장으로 로드한다. 처음 설치는 [설치·첫 실행 가이드](getting-started.md)를 따른다.
3. Burp Proxy listener를 준비한다.
   - `127.0.0.1:8080`: HUMAN
   - `127.0.0.1:8081`: SCANNER
   - `127.0.0.1:8082`: 선택적 LLM direct-proxy fallback
4. Burp FlowScope 탭에서 허가된 `http(s)://host[:port]/path-prefix`를 줄별로 입력하고 범위를 적용한다.

모든 저장과 active request는 exact scheme, host, effective port, path prefix 범위를 검사한다. HUMAN 브라우저의 범위 밖 이동은 막지 않지만 범위 밖 응답은 FlowScope에 저장하지 않는다.

| 기본 주소 | 소유 프로세스 | 용도 |
|---|---|---|
| `127.0.0.1:8080` | Burp | HUMAN listener |
| `127.0.0.1:8081` | Burp | ZAP outgoing proxy가 거치는 SCANNER listener |
| `127.0.0.1:8082` | Burp | 선택적 LLM direct fallback; 기본 MCP Explorer 경로가 아님 |
| `127.0.0.1:8089` | ZAP | 로컬 ZAP proxy/API |
| `127.0.0.1:8787` | FlowScope | bearer-token localhost MCP |
| `127.0.0.1:17777` | FlowScope | 사용자 Web 작업면 |

`17778`은 현재 제품 기본 포트가 아니다. `17779`처럼 다른 Web 포트는 standalone 검증에서 충돌을 피하려고 JVM 속성으로 일시 사용한 값이며 사용자 기본 계약에 포함되지 않는다.

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
  → 진행 기반 Passive 분석
  → native Alert 전 페이지 수집
```

`scope-only`는 ZAP Context 기준이므로 각 lane은 선택 target의 origin·path subtree만 포함하는 fresh Context를 만든다. sibling path·subdomain·다른 port/scheme은 regex 회귀로 제외한다.

시작 전 `spider/client/spiderAjax/pscan/pscanrules/selenium/openapi/websocket/network/replacer` add-on을 검사하고 신원별 fresh session에서 passive engine·전체 passive rule·scope-only를 명시 적용한다. 시스템 캠페인은 exact target용 run capability를 ZAP Replacer로 붙이고 Burp 8081에서 검증·제거하므로 capability 없는 수동 8081 요청과 native Burp Scanner는 활성 ZAP run/account를 상속하지 않는다. capability 없는 요청은 run별 차단 수로 남고 crawler polling에서 확인되는 즉시 다음 crawler·신원 전에 terminal failure가 된다. lane은 비로그인부터 직렬 실행하며 각 Evidence가 별도 `laneAccountId`를 보존한다. Web/API는 전체·단계 경과시간, 단계 제한, worker 작업 신호와 capture/status 변화, 후속 계정의 대기 순번·선행 lane, Passive 남은 건수·현재 task와 Alert snapshot 완결성을 표시한다. 세션 설정·정의 import의 blocking 호출은 `응답 대기/응답 수신`을 구분한다. 단계 전환·queue 감소·Alert 집계·격리 cleanup은 bounded 실행 기록으로 1초 갱신한다. Client/AJAX 실패나 0 capture는 숨기지 않고 경고 완료로 남긴다. crawler stop 뒤 terminal 상태를 확인하지 못하면 다음 stage/identity를 실행하지 않는다. Passive queue가 10분간 감소하지 않거나 30분을 넘으면 현재 Evidence와 Alert를 부분 완료로 보존하고 queue/task를 정리하며, 마지막 lane을 포함해 정리가 확인되지 않으면 terminal failure로 남긴다. Alert 상세는 캠페인 전체 최대 20,000개까지 snapshot으로 보존한다. 사용자는 실행 중 캠페인을 취소할 수 있으며 소유 crawler·capability·run context를 정리한 뒤 `CANCELLED`가 된다. 기본 캠페인에는 Active Scan·Fuzzer·Forced Browse가 포함되지 않는다. Active Scan은 별도 사용자 승인이 필요하다. 각 신원 lane에서 실제 범위 내 SCANNER 응답이 수집되어야 완료 gate가 열린다.

### 3.5 독립 LLM Explorer와 Judge

1. Codex 또는 Claude Code CLI에 사용자가 직접 로그인한다.
2. Web에서 공급자 상태가 준비됨인지 확인하고 LLM Explorer를 시작한다. API key 입력이나 MCP 설정 복사는 없다.
3. FlowScope가 임시 workspace와 새 CLI 프로세스를 만들고 MCP 정보·격리 지침·run ID를 표준입력으로 준다.
4. Explorer는 먼저 자기 LLM run Evidence와 route만 보고 read/write가 분리된 MCP로 exact-scope를 탐색한다. safe concrete frontier 소진 뒤에는 다른 lane의 source/run/Evidence/provenance/응답을 제거한 blind route hint로 미탐을 보완한다. Web 작업 피드는 실제 모델 메시지·도구 상태·Evidence gate를 표시하지만 reasoning과 raw tool payload는 표시하지 않는다.
5. HUMAN, SCANNER, LLM 탐색이 모두 정상 종료되면 Judge를 시작한다.
6. Judge는 Explorer와 다른 새 세션에서 잠긴 후보·갭·Evidence·ZAP Alert를 읽는다.
7. 최종 판정은 동일 validation run의 반복 재현과 정상 대조 Evidence를 서버가 확인한 경우에만 허용된다.

Explorer는 외부 검색, Wayback, 대상 소스 저장소, 직접 curl/provider-browser 요청을 사용하지 않는 exact-scope 역할이다. 기본은 Session Broker가 연결된 통제 HTTP executor이고, SPA/JavaScript/UI-only 흐름에서 frontier가 막힐 때만 설치된 Chrome/Chromium/Edge를 임시 profile과 CDP로 실행하는 FlowScope browser worker가 DOM·링크·폼·SPA runtime network를 discovery-only로 반환한다. browser worker는 8082 listener에 의존하지 않으며 관련 route는 `BROWSER_RUNTIME/evidence_backed=false`로 frontier에 들어가 통제 executor 재현 전 완료되지 않는다. run 계정은 시작 시 고정한다. CLICK/FILL selector가 아니라 그 결과 실제 발생한 POST/PUT/PATCH/DELETE 요청 하나를 Burp에서 승인하고 password/file 입력은 차단한다. 일반 assessment는 `LIKELY/INCONCLUSIVE/REJECTED`이며 `CONFIRMED`가 아니다.

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
  → SurfaceAnalyzer
       ├─ 실제 endpoint/parameter Observation
       ├─ OpenAPI/HTML/JavaScript AST Declaration
       └─ 산출물별 parse/failure report
  → Web snapshot/API ──→ API·입력 차이 → 인가 그래프·매트릭스·Evidence
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
| [`SurfaceAnalysis.java`](../../src/main/java/io/flowscope/core/SurfaceAnalysis.java) | 값 없는 endpoint/parameter fact와 중립 delta 상태 |
| [`SurfaceAnalyzer.java`](../../src/main/java/io/flowscope/core/SurfaceAnalyzer.java) | 실제 입력 관측과 OpenAPI·HTML form·정적 JavaScript 선언의 범용 projection |
| [`FlowGraphBuilder.java`](../../src/main/java/io/flowscope/core/graph/FlowGraphBuilder.java) | 관측 Evidence에서 graph 기초 관계 생성 |
| [`GraphObservationFact.java`](../../src/main/java/io/flowscope/core/GraphObservationFact.java) | 원 Evidence ID에 연결된 Identity×API×Object×Source와 HTTP outcome을 UI용 fact로 투영 |

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
| [`ProjectStore.java`](../../src/main/java/io/flowscope/integration/ProjectStore.java) | JSON schema v4 저장·로드, v1/v2/v3 호환 읽기, exact completed run·실행 시도 원장 보존 |
| [`RunExecutionLedger.java`](../../src/main/java/io/flowscope/integration/RunExecutionLedger.java) | MCP 통제 HTTP 시도의 비밀 없는 typed outcome과 run 품질 집계 |
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
- endpoint/parameter Observation과 Declaration 분리, source별 중립 delta와 Evidence/provenance 연결

### 6.3 비교·판정·시각화

- `신원 × operation × 객체` coverage cell
- UNCROSSED, PARTIAL_DISCOVERY, CONFLICT 계산
- owner/role 정책 기반 BOLA/IDOR·BFLA 후보
- HUMAN 파랑·실선, SCANNER 빨강·파선, LLM 검정·점선
- 기본 API·입력 차이, 인가 graph, matrix, flow order, scenario, parsing result, account/session 화면
- Evidence별 Request/Response와 Web 요청 실험실/Burp Repeater handoff

### 6.4 자동화·LLM

- 신원별 fresh ZAP session 캠페인
- Traditional → Client → AJAX → 진행 기반 Passive → paginated Alert 단계
- Passive 정체 시 Evidence·현재 Alert 부분 보존, queue/task cleanup 실패 시 후속 신원 차단
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

2026-09-03 기준 beta.43의 전체 `mvn clean verify`는 연속 두 번 각각 349 tests가 실패·오류·skip 없이 통과했고 두 JAR의 SHA-256이 일치했다. 정확한 digest는 `beta-validation.md` 정본을 따른다. 파서, 정규화, 분류, 인가 분석, 저장 round-trip, MCP, ZAP client mock, 세션 broker, byte codec, raw vault, ZAP key file, Web API 문자열 계약, Endpoint·Parameter Surface와 JavaScript AST/held-out 회귀를 포함한다. beta.24는 판정 오라클과 게시 격리, beta.25는 streaming manifest와 version-independent MR-JAR relocation, beta.26은 ZAP HAR import, beta.27은 ZAP Context/passive/scope preflight·Traditional/Client/AJAX 독립 실행·501개 Alert pagination과 구독 CLI 자식 `PATH`, beta.28은 LLM read/write 분리·server 0-Evidence 종료 거부와 ZAP outgoing-proxy/명시 API 정의 import, beta.29는 login-only 임시 Codex home과 launcher exact-Evidence gate, beta.30은 bounded 실시간 LLM 작업 피드, beta.31은 공식 auth status·표준 경로 탐지·READY provider 자동 선택, beta.32는 목적별 trust·exact-run 완료·동결 Evidence dataset lock과 JSON v3/SQLite v2 저장, beta.33은 Request Lab 단일 실행·분석 publication epoch·exact 미교차 표시, beta.34는 선형 snapshot/DataFlow와 live/persistence/assessment byte 경계, beta.37은 browser request 승인·Graph Fact, beta.38은 ZAP 장시간 실행 관측성, beta.39는 분류·Explorer 방문 gate·기본 그래프 회귀 복구와 ZAP 운영 hardening, beta.40은 concrete route 보존·Explorer 1~10 guidance/한계·provider process-tree 종료 확인, beta.41은 범용 endpoint/parameter 선언·관측 delta, beta.42는 AST call-site·parser 실패 가시성·truth 분리 fixture, beta.43은 lexical URL 해석·typed resolution issue·검토면 분리를 추가했다. 실제 Burp beta.43 재로드와 외부 pilot은 대기한다.

### 실제·standalone 검증

- beta.15에서 Burp Community, ZAP 2.17, crAPI anonymous scanner의 Client→AJAX fallback과 raw capture를 실제 확인했다.
- beta.19 standalone 1280px/600px에서 Cytoscape wrapper와 좁은 화면 API 목록의 표시 경계를 확인했다.
- beta.18 byte codec과 request-lab 자동 회귀는 통과했다.

### 아직 검증되지 않은 것

- beta.44 JAR의 실제 Burp Community end-to-end HUMAN/SCANNER/LLM/Judge 실행과 프로젝트 저장·재열기
- 실제 ZAP 2.17 UI에서 저장한 HAR의 beta.44 scanner import와 Evidence 상세 확인
- 실제 Burp Request Lab의 고지연 A→B 선택, 상태 변경 이중 전송, clear/rebuild callback 경합
- 실제 ZAP 2.17에서 OpenAPI·GraphQL·Postman·SOAP 정의별 요청 생성, exact-scope 차단, 신원별 인증 주입과 경고 표시 확인
- 실제 ZAP Desktop의 key·8089 API·8081 upstream·필수 add-on과 Web 연결 상태 수동 gate
- Windows 10/11 + Docker Desktop + PowerShell 7 실기기의 ZAP API/upstream/target capture
- 실제 Burp에서 request-lab ORIGINAL/ANONYMOUS/ACCOUNT 수신 byte와 credential 비교
- USER A/USER B 복수 세션과 ZAP/LLM 주입의 전체 흐름
- 실제 Burp 프로세스에서 20,000건 근처의 상주 메모리·1초 UI polling 부하. 합성 snapshot/DataFlow 자동 stress는 beta.34에서 통과했지만 이를 대체하지 않음
- 불특정 일반 대상 corpus의 endpoint/object/classifier precision·recall
- 정답을 격리한 crAPI 블라인드 benchmark
- 실제 취약점 탐지율과 사람 REVIEW 비용

자동테스트 통과를 위 항목의 성공으로 해석하면 안 된다.

## 8. 알려진 결함 — 다음 개발의 실제 시작점

아래는 2026-08-28 clean-room 코드 리뷰에서 코드 경로로 확인한 항목이다. beta.33·34에서 닫은 항목과 아직 남은 항목을 분리하며, 자동 회귀와 실제 Burp 수동 gate도 구분한다.

### beta.33에서 닫은 P1

1. **Request Lab Evidence 비동기 역전:** Evidence generation과 immutable event ID를 비교해 늦은 GET·POST·Repeater 응답을 폐기한다.
2. **Request Lab 중복 상태 변경 전송:** 전송 동안 편집·계정·인증·닫기를 잠그고, 서버 응답을 받지 못한 동일 draft는 같은 operation ID를 재사용하며, 서버의 ID+입력 digest 멱등성으로 같은 작업을 한 번만 실행한다. 완료 cache는 raw 요청·응답 대신 compact 결과만 최대 256건 보존한다.
3. **stale pipeline 결과 게시:** `AnalysisPublicationGate`의 publication epoch가 같은 결과만 `latest`·route candidate·revision에 원자 게시한다.
4. **일반 빈 셀의 IDOR 오표시:** exact server `UNCROSSED` key만 gap으로 표시하고 나머지는 중립 `미검증`으로 분리한다.

집중 회귀는 완료했지만 실제 Burp UI의 고지연 A→B 선택, 상태 변경 중복 클릭, clear/rebuild 동시 실행은 최신 beta.44 JAR 수동 gate가 남아 있다. 자동 회귀를 실환경 완료로 표현하지 않는다.

### beta.34에서 닫은 P1

5. **Snapshot 중복 cluster O(N²):** event에는 cluster ID/count/time만 남기고 ID 목록을 `/api/cluster-evidence` 200건 페이지로 분리했다. 20,000건 snapshot 자동 stress를 고정했다.
6. **DataFlow O(N²)·substring:** 신원별 exact-token index와 가장 가까운 이전 producer로 바꾸고 `123`/`1234` 음성 대조와 20,000건 stress를 추가했다.
7. **상한 전 live 전체 decode/mask:** Montoya byte 길이를 먼저 확인하고 1MiB 초과 메시지는 최대 64KiB만 decode·mask한다. raw vault도 요청 1MiB·응답 4MiB 초과 전체 배열을 받지 않는다.
8. **프로젝트 GZIP 무제한 해제:** payload당 1MiB·서로 다른 복원 평문 합계 48MiB, streaming 선언 크기 검증과 digest cache를 적용했다.
9. **LLM assessment 총량 무제한:** 필드·Evidence 배열·1,000건·4MiB 제한을 MCP runtime과 프로젝트 저장·복원에 공통 적용했다.

자동 stress는 출시 차단 코드 결함의 회귀를 닫지만 실제 Burp 20,000건 상주 RSS·1초 polling과 탐지 효능을 증명하지 않는다. 정확한 측정과 의미 경계는 D-101과 `beta-validation.md`를 따른다.

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

6. **해결됨 — LLM 취소의 알려진 process tree 종료 확인**
   - 현재 계약: descendants와 parent에 정상 종료를 요청하고 1초 뒤 남은 프로세스를 강제 종료한 다음 다시 1초 안에 alive 상태를 확인한다. 확인 실패는 `FAILED`다.
   - 회귀·한계: resistant fake parent/descendant 회귀와 실제 Codex/Claude 즉시 취소 잔존 PID 확인을 통과했다. 이후 분리된 daemon은 snapshot 밖일 수 있어 실제 장기 run 취소는 계속 운영 gate다.

7. **해결됨 — ZAP run 중 native Burp Scanner 오귀속**
   - 현재 계약: native Burp Scanner는 ZAP context를 상속하지 않고, SYSTEM 캠페인은 exact-target Replacer capability가 run ID와 일치하는 8081 요청만 세션 주입·CONTROLLED 귀속한다.
   - 회귀: native Scanner 배제와 capability 일치/불일치 판정을 자동 테스트로 고정했다. 실제 Burp+ZAP의 Replacer end-to-end 확인은 통합 gate에 남는다.

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

현재 출발점은 beta.44 React 통합의 **실제 Burp runtime parity와 승인된 독립 pilot**이다. React는 `/`의 기본 화면이고 `/legacy/`는 runtime gate가 끝날 때까지 복구 경로로 남는다. LLM 통제 요청의 응답 전 실패는 Evidence와 분리되어 실행 전·전부 실패·부분 실패·응답 수신으로 표시되며 JSON v4·SQLite v3에 저장된다. standalone의 Surface·Dashboard·Graph·Runs·Evidence·Accounts·Inspection·Matrix·Sequence·Scenarios 전환과 bounded snapshot 그래프 회귀는 통과했지만 실제 Burp HUMAN/ZAP/LLM·관리 세션·live Request Lab과 TLS/DNS/timeout 분류는 아직 확인하지 않았다. Surface 계획 1~4는 구현·자동 회귀 완료다. 5는 저장소 내부 합성 truth 구조 회귀이며, 6은 일부 typed 실패 분류, 7은 Next pages manifest chunk 연결, 8은 공통 asset/GraphQL 관측 회귀까지만 완료됐다. 다음에는 실제 bundle에서 precision/recall·검토량·성능과 실패 구조를 측정한다. source map, Next App Router, GraphQL schema, 추가 framework adapter는 반복 실패 근거가 있을 때만 같은 fact schema 뒤에 추가하며 이후 지원 Tier를 실측으로 조정한다. 승인 전 외부 대상에는 요청하지 않는다. 그 뒤 기존 **P2 세션·신원·프로세스 수명·가져오기 무결성**으로 돌아간다.

### 단계 A — 기준선과 재현 고정 (beta.34 완료)

1. 현재 인계 HEAD에서 새 작업 branch를 만든다.
2. 위 P1마다 먼저 실패하는 최소 회귀를 추가한다.
3. 브라우저 race는 실제 DOM/fetch 동작을 실행하는 테스트 계층을 추가한다. 현재 Web 테스트는 HTML/JavaScript 문자열 계약 중심이다.
4. 성능 항목은 임의 표현이 아니라 record 수, heap, serialized byte, latency를 측정한다.

종료 조건:

- 모든 P1에 재현 테스트 또는 측정 harness가 존재한다.
- 테스트가 수정 전 실패하는 이유가 결함 설명과 일치한다.
- crAPI 정답이나 실타깃 전용 예외를 사용하지 않는다.

### 단계 B — HUMAN 정확성·안전성 (1~4 완료, 5~6 P2 잔여)

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

### 단계 C — 메모리·성능 경계 (beta.34 자동 gate 완료)

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
3. beta.40의 LLM graceful→forced 종료와 workspace cleanup 계약을 실제 장기 Codex/Claude run 취소에서 다시 확인한다.
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

성공 후 `target/flowscope-1.2.0-beta.44.jar`를 Burp에 로드한다. `target/`은 커밋하지 않는다. Release JAR 사용자는 Maven이 필요 없고, 소스 빌드자는 IDE의 임의 JDK로 우회하기 전에 JDK 21과 Maven 3.9 이상을 명시적으로 맞춘다.

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
| A. ZAP 실제 provenance gate | `FlowScopeExtension`, `McpServer`, 실제 Burp/ZAP | beta.44 JAR 재로드 |
| B. project validate-then-swap | `FlowScopeExtension`, `ProjectStore`, `SqliteProjectStore` | 실패 rollback fixture |
| C. Session Broker 신뢰 | `SessionBroker`, account/session Web 상태 | ACTIVE·auth material 계약 결정 |
| D. merge/JWT 신원 무결성 | `RecordMerge`, `Fingerprints`, `AnalysisConfig` | account/run provenance와 hint 계약 |
| E. owner·정책 오라클 | `AuthorizationAnalyzer`, response fixture | OWNER/ACTOR/CREATOR 의미와 UNKNOWN 정책 합의 |
| F. LLM child 수명 | `LocalLlmRunner` | resistant fake process fixture |
| G. XML·IPv6 상호운용 | `BurpXmlParser`, authority formatter, persistence | byte/charset·URI fixture |

작업 B~G는 같은 `FlowScopeExtension` 또는 분석 정본을 동시에 바꿀 수 있으므로 작은 PR부터 순차 병합한다. 이미 닫은 Request Lab, publication epoch, Snapshot/DataFlow, payload 상한을 다시 구현하지 않는다. 리팩터링을 선행하지 말고 각 결함과 직접 연결된 최소 변경부터 적용한다.

## 15. 인계 완료 판단

팀원이 다음 질문에 코드와 테스트 링크로 답할 수 있으면 인계가 완료된 것이다.

1. HUMAN, SCANNER, LLM은 어떻게 구분되는가?
2. 계정과 raw 세션은 어디에 저장되고 언제 폐기되는가?
3. route candidate와 observed operation은 무엇이 다른가?
4. coverage gap과 취약점 finding은 무엇이 다른가?
5. LLM assessment와 final validation은 무엇이 다른가?
6. 현재 남은 P0/P2 정확성·운영 결함은 무엇이며 어떤 순서로 닫는가?
7. 자동테스트가 증명하지 못하는 실제 gate는 무엇인가?
8. 다음 benchmark가 정답 누수 없이 어떻게 수행되는가?

이 문서의 결함 목록이나 상태가 바뀌면 코드·테스트·해당 정본 문서와 같은 commit에서 갱신한다.

## 16. 제품 책임자의 의도와 작업 원칙

이 절은 코드만으로 알 수 없는 제품 책임자의 반복된 요구를 다음 작업자가 놓치지 않도록 정리한 것이다. 아래 문장은 구현 완료를 뜻하지 않으며, 구현과 다른 요구는 **미해결 제품 요구**로 취급한다.

### 최종 사용자

- FlowScope의 사용자는 프로젝트 개발자가 아니라 허가된 웹·API 보안 진단자와 레드팀 운영자다.
- crAPI는 검증용 대상 중 하나일 뿐이다. 어떤 분류·경로·세션 규칙도 crAPI 전용 상수나 정답 목록에 맞추면 안 된다.
- 새 사용자가 Release JAR과 필요한 로컬 도구를 준비하고, 로그인한 뒤 버튼 중심으로 실행할 수 있어야 한다.
- 고급 기능을 없애서 단순화하지 않는다. 기본 경로는 간결하게, 진단자용 원인·Evidence·설정은 단계적으로 펼쳐 제공한다.
- 실패를 `FAILED` 한 단어로 끝내지 않는다. 현재 단계, 경과시간, 마지막 실제 응답, 마지막 수집 변화, 대기 이유, 복구 방법을 보여 줘야 한다.
- 대화 후반에는 backend 기능·Evidence 품질을 먼저 안정화하고 대규모 UI 재설계는 보류하기로 했다. 현재 화면의 기능 회귀·진행 가시성은 고치되, 새 UI 방향이 확정되기 전에 전면 재작성하지 않는다. 재설계 시에는 기존 `whs_flow` 기반의 차분한 시각 언어와 진단자 중심 정보 밀도를 출발점으로 삼는다.

### 진단 철학

```text
탐색은 넓게
→ 원 Evidence는 잃지 않게 보존
→ 분석 입력은 결정론적으로 분류·정규화
→ 그래프는 필요한 관계만 계층적으로 투영
→ 실행은 exact scope 안에서 비무기화·저영향
→ 판정은 재현 Evidence와 정상 대조를 통과한 경우만 확정
```

- 위험한 기능을 무조건 제거하는 것이 목표가 아니다. 허가된 범위에서 실제 Evidence가 생길 정도의 저영향 검증은 가능해야 한다.
- 반대로 Active Scan, 대량 동시 요청, 경합, 파일 업로드, 결제·삭제 같은 상태 변경을 묵시적으로 실행해서는 안 된다. 별도 승인·예산·정지 수단이 필요하다.
- 노이즈를 저장 단계에서 삭제하면 나중에 규칙을 교정할 수 없다. `INCLUDE/REVIEW/EXCLUDE`는 보존과 표시·분석 자격을 분리한다.
- “스캐너가 찾았다”, “LLM이 말했다”, “HTTP 200이다”는 취약점 확정 근거가 아니다.
- 오탐·미탐 0, 완전 탐색, 전체 공격면 대비 완료율 같은 측정 불가능한 주장을 하지 않는다.

### 개발 방식

- 구현 전에 현재 코드를 읽고, 주장을 코드·테스트·공식 프로토콜 또는 실제 실행으로 확인한다.
- 모르면 모른다고 표시하되 조사 가능한 것을 추측으로 남기지 않는다.
- 난도가 높다는 이유로 핵심 기능을 축소하지 않는다. 다만 큰 변경은 실패 fixture, 단계별 gate, rollback 가능한 작은 commit으로 나눈다.
- 코드와 사용자 동작이 바뀌면 같은 작업 단위에서 README, architecture, decisions, development-log, CHANGELOG, validation, product plan 중 해당 정본을 함께 갱신한다.
- “구현됨”, “자동 회귀 통과”, “standalone 확인”, “실제 Burp/ZAP 확인”, “블라인드 효능 확인”을 서로 바꿔 말하지 않는다.
- 사용자가 아직 허가하지 않은 Git push, Release 게시, 실제 대상 요청, 상태 변경 검증은 실행하지 않는다.

## 17. 대화에서 확정된 데이터·그래프 방향

### 정본 관계

그래프의 분석 정본은 화면 노드가 아니라 Evidence에 연결된 다음 fact다.

```text
Identity × Method/API × Object × Source × Run × Phase × Response outcome
```

화면의 권장 계층은 다음과 같다.

```text
Level 0  Target → API Group
Level 1  Identity → API
Level 2  Identity → API → Object
Detail   Owner policy + source별 Request/Response Evidence + 판정 근거
```

- `/orders/101`, `/orders/202`는 근거가 있을 때 `/orders/{id}` API template으로 정렬하되 원래 URL과 Evidence는 보존한다.
- 같은 path라도 GET, POST, PUT, PATCH, DELETE, OPTIONS는 별도 API다.
- `api`, `rest`, `v1`, `v2` 같은 공통 segment를 건너뛴 API Group은 **표시용**일 뿐 분석 key가 아니다.
- `orders:101`, `orders:202`처럼 인스턴스가 많으면 `orders` object family를 기본으로 접고 선택 시 펼친다. 인스턴스를 삭제하거나 하나의 객체로 합치지 않는다.
- Owner는 별도 요청자가 아니라 Object의 확인된 속성이다. 사용자 명시 또는 신뢰 가능한 Evidence가 없으면 `미확정`이다.
- `H`는 파랑 실선, `S`는 빨강 파선, `L`은 검정 점선이다. 선은 요청 관측을 뜻하며 성공·인가·취약점을 뜻하지 않는다.
- source filter를 끄면 그 source 전용 edge와 고아 node가 실제로 사라져야 한다. 단순 checkbox 표시 변경이면 안 된다.
- Candidate, REVIEW, EXCLUDE, validation traffic, auth/session 준비, static asset, polling은 메인 비교와 다른 층이다. 필요할 때 볼 수 있지만 기본 business graph를 뒤덮으면 안 된다.

### 현재 구현과 남은 문제

- beta.37에서 `GraphObservationFact`와 Site/API/Object 계층 투영, object family 접기를 구현했다.
- beta.39에서 기본 화면을 `Identity → API`로 되돌리고 Site overview를 선택형으로 만들었다.
- 자동 테스트는 fact 필드·계층·중복 edge 억제·source별 API 집계를 확인한다.
- 실제 고카디널리티 대상에서 node/edge 수, 교차선, 라벨 가독성, 진단자 검토시간이 좋아졌다는 실증은 아직 없다.
- 과거 화면에서 node 겹침, 긴 글자 잘림, source가 꺼졌는데 흐린 다른 선이 남음, 객체 인스턴스 폭증, 샘플과 실제 Evidence 혼동이 반복됐다. 이 현상이 재발하면 CSS만 덧대지 말고 snapshot fact와 projection/filter 계약부터 확인한다.
- `docs/ko/backend-evidence-architecture-plan.md`는 다음 backend 재설계 계획이다. 현재 코드가 이미 그 계획을 모두 구현했다고 가정하면 안 된다.

### 샘플 데이터의 출처

`SampleProject.java`의 `https://demo.flowscope.test:443` H/S/L record는 온보딩을 위해 코드에 손으로 정의한 **완전 합성 데이터**다. crAPI, 실제 Burp history, ZAP 결과, LLM 실행에서 얻은 데이터가 아니며 샘플 로드 자체는 대상 네트워크 요청을 보내지 않는다. 화면의 샘플 배너와 `sampleMode` 계약을 제거하거나 샘플 수치를 탐지 성능으로 사용하지 않는다.

## 18. HUMAN lane의 현재 계약과 제품 요구

### 구현된 것

- Burp callback에서 HUMAN 8080과 Proxy/Repeater/Intruder/Target 도구 detail을 수집한다.
- 명시한 exact scope 안의 응답만 저장하며 scope 밖 브라우징 자체를 제품이 가로막지는 않는다.
- HUMAN pass 시작·종료와 run ID, phase, trust를 기록한다.
- 로그인 준비는 `SESSION_SETUP`, pass 밖 트래픽은 `BASELINE`, 수동 Request Lab 검증은 `VALIDATION`으로 분리해 discovery coverage를 오염시키지 않는다.
- Request Lab은 live raw byte vault를 현재 프로세스 메모리에 한정해 `ORIGINAL/ANONYMOUS/ACCOUNT` 전송과 Repeater handoff를 제공한다.
- 계정 화면은 Cookie·token·subject 단서를 별도 계정처럼 늘리지 않고 하나의 계정 카드 아래 기술 정보로 묶는다.
- local SQLite가 계정 메타데이터·Evidence·정책·검토를 저장하지만 raw credential은 저장하지 않는다.

### 왜 pass 종료가 있는가

제품 책임자는 사람이 움직이면 그래프가 즉시 반영되고 시작 버튼만 있는 경험을 선호했다. 현재 explicit pass 종료는 UI 편의보다 다음 무결성 때문에 존재한다.

- 어느 run의 Evidence인지 고정
- late response와 dataset replacement 구분
- 탐색 완료 시점 Evidence ID 동결
- SCANNER/LLM과 비교할 동일 기준선 생성
- Judge 입력이 실행 중 변하지 않게 lock

따라서 실시간 그래프 갱신은 유지할 수 있지만, 완료/lock 경계 자체를 없애려면 동일한 무결성을 보장하는 대체 상태 기계를 먼저 설계해야 한다.

### 남은 핵심 문제

- 신규 세션은 단순 cookie 보유와 2xx~4xx 응답만으로 ACTIVE가 될 수 있다.
- 저장 cookie 전부 exact match라 보조 cookie 회전이 정상 계정 귀속을 깨뜨릴 수 있다.
- Proxy history 병합 key가 account/run을 포함하지 않는다.
- 미검증 JWT payload `sub`가 identity hint를 넘어 계정 결합에 영향을 줄 수 있다.
- 잘못된 project load가 검증 전에 현재 session/run을 지운다.
- Burp XML base64 body는 UTF-8로 강제 해석한다.
- IPv6 authority 처리가 일부 경로에서만 고쳐져 전체 round-trip이 증명되지 않았다.
- response의 `userId/accountId/authorId`를 관계 의미 없이 owner로 보는 경로가 있어 actor/creator/owner 구분이 부족하다.

## 19. ZAP lane의 구현·실패 이력·현재 gate

### 제품이 현재 실행하는 기능

신원마다 fresh ZAP session과 fresh exact-scope Context를 만들고 직렬로 다음을 실행한다.

```text
선택형 API definition import
→ Traditional Spider
→ Client Spider
→ AJAX Spider
→ Passive queue drain
→ native Alert 전체 페이지 snapshot
```

- 비로그인과 선택한 ACTIVE 계정을 서로 다른 lane으로 실행한다.
- 필요한 add-on은 `spider`, `client`, `spiderAjax`, `pscan`, `pscanrules`, `selenium`, `openapi`, `websocket`, `network`, `replacer`다.
- OpenAPI, GraphQL, Postman, SOAP은 사용자가 실제 정의 URL/endpoint를 제공하고 승인한 경우만 import한다.
- 기본 캠페인은 Active Scan, Fuzzer, Forced Browse, Sequence Scan, Authentication Helper 자동 구성을 포함하지 않는다.
- Active Scan은 exact-scope와 별도 Burp 승인이 필요한 독립 기능이다.
- ZAP Alert는 진단 신호이며 BOLA/BFLA 최종 verdict가 아니다.

### 왜 FlowScope가 orchestration을 유지하는가

ZAP 캠페인 전체를 외부에 무조건 위임하면 다음 제품 계약을 잃는다.

- Session Broker 계정별 인증 주입
- 비로그인→계정 A→계정 B 직렬 격리
- source/run/account provenance
- exact-scope와 write 승인
- 단계별 capture·진행·경고·취소
- 기존 Evidence와 ZAP Alert의 공통 데이터셋 결합

그래서 ZAP 기능은 최대한 활용하되 FlowScope가 실행 순서, 세션, 범위, Evidence 귀속과 완료 gate를 소유한다.

### 실제로 겪은 장애

- ZAP API timeout을 모두 “연결 실패”로 표현해 원인이 숨었다.
- AJAX Spider가 API상 끝났지만 rendered capture 0건이었다.
- 비로그인 lane이 오래 실행되는 동안 다음 계정이 이유 없는 `PENDING`으로 보였다.
- Passive queue가 5분을 넘으면 이미 모은 Evidence·Alert까지 실패처럼 보였다.
- stop 호출만 하고 terminal 상태를 기다리지 않아 다음 계정과 겹칠 위험이 있었다.
- 8081 포트만으로 SYSTEM ZAP이라고 간주하면 native Burp Scanner나 수동 요청이 현재 계정으로 오귀속될 수 있었다.
- capability를 엄격히 검사한 뒤 Replacer 전달이 안 되면 요청을 drop하지만 UI에서 원인을 알 수 없었다.

beta.38~39는 경과시간·heartbeat·capture 변화·queue 상태·Alert 완결성, 취소, terminal wait, lane account, capability rejection 원인화를 추가했다. 그러나 mock/자동 회귀와 실제 설치 ZAP의 initiator 동작은 같은 증거가 아니다.

### 다음 사람이 가장 먼저 할 실제 gate

1. Burp에서 이전 FlowScope 확장을 제거하고 현재 beta.44 JAR을 다시 로드한다.
2. ZAP 2.17 API가 `127.0.0.1:8089`, outgoing proxy가 Burp `127.0.0.1:8081`인지 확인한다.
3. exact scope와 비로그인 lane 하나만 선택해 시작한다.
4. Traditional 단계부터 `출처 검증 차단 0건`인지 확인한다.
5. `수집 N건`과 실제 scanner Evidence가 증가하는지 확인한다.
6. Client와 AJAX에도 capability가 전달되고 target에서 내부 header가 제거됐는지 확인한다.
7. 취소 후 crawler terminal, Replacer 제거, run abort, 포트 quiescence를 확인한다.
8. 위 gate가 통과한 뒤 ACTIVE 계정 하나를 추가해 비로그인→계정 전환 중 cookie와 `laneAccountId`가 섞이지 않는지 확인한다.

첫 lane에서 capability rejection이 1 이상이면 자동 fallback으로 익명 수집을 허용하지 않는다. ZAP Replacer initiator 적용 또는 outgoing proxy 전달을 고쳐야 한다.

## 20. LLM Explorer·Judge의 현재 구조와 목표

### 역할 분리

- **Explorer:** 사람이 놓친 endpoint, API, object reference, 인가·워크플로 가설을 넓게 찾고 실제 통제 요청 Evidence를 만든다.
- **Assessment:** Explorer/Judge가 Evidence에 묶어 내는 `LIKELY/INCONCLUSIVE/REJECTED` 후보 설명이다. 최종 판정이 아니다.
- **Judge:** Explorer와 분리된 새 세션에서 동결된 HUMAN/SCANNER/LLM Evidence를 읽고, 재현·정상 대조 bundle을 제출한다.
- **서버 final validation:** current candidate와 Evidence bundle이 계약을 만족할 때만 `CONFIRMED/INCONCLUSIVE/REJECTED`를 수락한다.

Explorer와 Judge를 같은 대화로 이어 붙이지 않는 이유는 Explorer가 자기 탐색을 스스로 확증하거나 다른 lane 결과를 미리 보고 독립 비교를 오염시키는 것을 막기 위해서다.

### 실행 구조

- Codex 또는 Claude Code의 로컬 구독 로그인을 사용하며 API key 입력을 기본 요구하지 않는다.
- FlowScope가 executable과 로그인 상태를 확인하고 owner-only 임시 workspace, strict MCP 설정, 새 CLI process를 만든다.
- GUI로 실행한 Burp의 축소 PATH를 보완하도록 executable 디렉터리를 자식 PATH 앞에 넣는다. 과거 `env: node: No such file or directory`는 이 경로 누락으로 발생했고 beta.27 이후 회귀를 추가했다.
- shell curl을 허용하지 않고 Session Broker와 결합된 FlowScope MCP HTTP executor로 요청한다. raw credential은 모델에 반환하지 않고 서버가 선택 계정 handle로 주입한다.
- 브라우저 없이도 GET/HEAD/OPTIONS와 승인된 write API 탐색은 가능하다.
- SPA, UI 전용 상태, 런타임 생성 endpoint가 응답·정적 후보만으로 보이지 않을 때만 설치 Chrome/Chromium/Edge 기반 CDP worker를 보조로 쓴다. Playwright, Chrome MCP, ChromeDriver는 필수 설치가 아니다.
- browser DOM/network 결과는 discovery hint이며 controlled executor 재현 전에는 Evidence나 완료 근거가 아니다.
- 작업 피드는 실제 provider message, MCP tool 상태, Evidence gate를 표시하되 reasoning과 raw tool payload·credential은 표시하지 않는다.

### 원하는 Explorer harness

현재 구현을 느슨한 자유 프롬프트로 되돌리지 않는다. 동시에 첫 GET과 몇 개 route만 보고 끝나는 과도하게 좁은 harness도 제품 목적을 달성하지 못한다. 목표 상태는 다음 상태 기계다.

```text
1. exact scope/account/run을 고정하고 상태·세션 handle을 확인한다.
2. exact entry GET으로 첫 controlled Evidence를 만든다.
3. own-run HTML/JS/metadata/OpenAPI/XML과 매 응답에서 확장되는 `pending_concrete_paths`를 소진한다.
4. route를 endpoint/object/function/workflow 검토 차원으로 분류한다.
5. HTML script 등 근거가 있을 때만 격리 browser를 discovery-only로 사용하고 HTTP executor로 재현한다.
6. 실제 관측값만 사용해 object/identity와 BOLA/IDOR 가설을 검토한다.
7. method/function/workflow, BFLA·상태전이·중복·mass assignment·과다노출·rate-limit 가설을 Evidence 범위에서 검토한다.
8. 상태 변경은 exact 요청 승인 뒤에만 실행하고 Evidence ID·반증/control·불확실성을 기록한다.
9. 독립 frontier 소진 뒤 source/Evidence/provenance를 제거한 blind assisted concrete hint를 소진한다.
10. 두 frontier와 exact-run 응답을 서버가 재검증한 뒤 limitation을 숨기지 않고 종료한다.
```

각 candidate는 최소한 `가설`, `대상 API/object`, `선행 조건`, `사용 계정`, `실행한 요청`, `Evidence ID`, `관측 결과`, `반증 또는 control`, `남은 불확실성`을 가져야 한다.

### 현재 한계와 과거 실패

- 초기에 Explorer가 `/manifest.json` GET/HEAD 두 건만 만들고 끝난 적이 있다. 이는 LLM 능력의 증명이 아니라 frontier와 prompt가 제품 목표에 부족했다는 실행 결과다.
- 이후 excluded static/navigation route를 실제 방문했는데도 `unobserved`로 남아 `flowscope_end_run`을 거부하는 회귀가 생겼고 beta.39에서 방문 사실과 분석 자격을 분리했다.
- 설치 Chrome worker의 로컬 smoke는 통과했지만 실제 Burp HTTPS, ACTIVE account, SPA 탐색→replay→Evidence→종료는 아직 수동 검증하지 않았다.
- Codex 로그인 성공을 Claude 성공으로 간주하면 안 된다. 공급자별 실제 gate가 필요하다.
- beta.40은 `LocalLlmRunner.cancel()`·`close()`·시작 경합을 같은 bounded graceful→forced process-tree 종료 함수로 묶고 종료 실패를 `FAILED`로 표시한다. descendants는 종료 시작 시점 snapshot이므로 이후 분리된 daemon까지 운영체제 수준으로 종료한다고 주장하지 않는다.
- 완전한 양방향 채팅형 사용자 개입 UI는 아직 없다. 현재 작업 피드는 읽기 전용이고 Judge 후속 입력만 별도 resume 경로가 있다.

## 21. 세션 자동화에 대한 결정 경계

제품 책임자는 “대상마다 cookie/token 조합이 다르므로 LLM이 자동으로 세션을 따와 Explorer/Judge에 설정할 수 없나”를 반복 검토했다. 현재 결론은 다음과 같다.

- Burp에서 실제 로그인 흐름을 관측해 cookie, Authorization, CSRF를 캡처하고 회전을 갱신하는 것은 Session Broker 책임이다.
- LLM은 계정 label/handle과 상태만 보고 어떤 계정을 사용할지 선택할 수 있다.
- raw credential을 LLM prompt, MCP response, project, log에 내보내지 않는다.
- 범용 LLM이 로그인 폼, MFA, CAPTCHA, SSO를 추론해 무인 로그인하는 기능은 현재 구현·보장 범위가 아니다.
- 추후 로그인 자동화가 필요하면 per-target auth recipe 또는 사용자가 확인하는 브라우저 로그인 capture를 별도 설계한다. Session Broker를 제거하면 credential 수명, service 경계, account 전환, 비밀 비영속 계약을 잃으므로 제거하지 않는다.

## 22. 검토했지만 현재 제품에 바로 채택하지 않은 방향

### Noir + Joern + Neo4j 정적 Entry→Guard→Sink 분석

외부 검토에서 Noir route extraction, Joern CPG/taint, Neo4j graph를 조립해 “guard를 우회해 sink에 도달하고 object ID가 principal과 비교되지 않는 경로”를 찾는 방향이 제안됐다. 개념상 source code가 있는 SAST/CPG 제품에는 가치가 있지만 현재 FlowScope의 동적 블랙박스 제품을 대체하지 않는다.

이유:

- FlowScope의 현재 입력은 Burp/ZAP/LLM이 실제로 관측한 HTTP Evidence다.
- CPG는 대상 소스와 언어별 frontend가 필요하며 배포된 외부 서비스만 진단하는 사용자에게 항상 제공되지 않는다.
- “guard node 없음”만으로 framework interceptor, DB row policy, gateway 정책, 외부 PDP를 모두 알 수 없다.
- 동적 BOLA/BFLA의 핵심인 계정별 실제 응답과 상태 효과는 정적 reachability만으로 확정되지 않는다.
- Joern/Neo4j 운영은 JAR 하나 중심의 현재 설치 계약을 크게 바꾼다.

따라서 이 방향은 별도 optional source-code overlay 또는 후속 제품 연구로 보류한다. 명시적 제품 pivot 승인 없이 현재 Evidence core를 제거하거나 Joern을 필수 의존성으로 넣지 않는다.

### Playwright 필수화

Playwright는 강력하지만 Node/npm과 browser bundle 설치를 외부 사용자에게 추가로 요구한다. 현재 JDK 21 CDP worker는 설치된 Chrome 계열을 사용해 핵심 SPA discovery를 제공하므로 필수화하지 않았다. CDP 구현의 브라우저 호환·유지 비용이 실제 gate에서 감당 불가능하다는 자료가 생기면 Playwright adapter를 선택형으로 다시 비교한다.

### 의미 기반 고정 가중치

특정 method, `admin`, `payment`, `coupon` 같은 이름에 임의 숫자를 부여하면 데이터셋마다 편향되고 성능 근거가 없다. 현재는 Evidence 유무, object reference, state-changing 여부, provenance 같은 설명 가능한 범주형 정렬만 사용한다. 블라인드 corpus에서 precision/recall과 검토 비용을 측정하기 전에는 “최적 가중치”를 문서화하지 않는다.

## 23. 외부 리뷰 항목의 현재 처분

리뷰 문장을 그대로 사실로 취급하지 않고 현재 코드에서 다시 확인한다. 2026-09-02 기준 처분은 다음과 같다.

### 해결 또는 회귀로 고정된 축

- fat JAR NOTICE/라이선스, dependency relocation, MR-JAR 보존, plugin pin, shell CI, streaming manifest와 version-independent MR relocation은 beta.23~25에서 수정했다.
- `ResponseEvidence`의 다양한 ID field, soft-deny 오류 봉투, JSON 크기·깊이·순회 상한은 beta.24에서 수정했다.
- 익명과 지문 추출 실패 분리, binding service 정규화, binding 재적용, AnalysisConfig 단일 잠금, framed stable key/digest는 beta.24에서 수정했다.
- Request Lab 멱등성, stale publication, 빈 셀과 실제 UNCROSSED 분리는 beta.33에서 수정했다.
- snapshot/DataFlow 제곱 증가와 payload/decompression/assessment 상한은 beta.34에서 수정했다.
- native Burp Scanner의 SYSTEM ZAP 오귀속, lane account 보존, crawler terminal wait, 취소, AJAX scope, API key header, HAR 반복 import, transient poll snapshot 보존은 beta.39 자동 회귀로 고정했다.

### 현재 코드에서 여전히 확인되는 결함

1. `SessionBroker.observeResponse()`의 200~499 `responseConfirmed=true`.
2. `SessionBroker.accountForRequest()`의 적용 cookie 전부 exact match.
3. `RecordMerge.Key`에 identity/account/run 없음.
4. 서명 검증 없는 JWT `sub` hint와 계정 binding 경계가 충분히 분리되지 않음.
5. `FlowScopeExtension.loadProjectFile()`이 load/검증 전 run/session/route를 지움.
6. **beta.40 자동 회귀로 해결:** `LocalLlmRunner.cancel()/close()`의 알려진 process tree graceful→forced 종료와 alive 확인. 실제 장기 provider run과 분리 daemon은 운영 gate다.
7. `BurpXmlParser` base64 body UTF-8 강제 변환.
8. IPv6 service/scope/XML/live/persistence 전체 round-trip 미검증.
9. 객체 없는 endpoint 2xx에서 required role이 UNKNOWN이어도 `ALLOW`로 표시되는 경로. 이 값은 취약점 확정은 아니지만 “정책 미확정”을 “허용”처럼 보이게 해 의미 오류가 있다.
10. owner field의 관계 타입이 없어 actor/creator/author와 실제 owner를 오인할 수 있음.
11. `McpServer`, `FlowScopeExtension`, `index.html`에 책임이 집중돼 변경 충돌과 회귀 영향 반경이 큼.

### 실제 환경에서만 닫을 수 있는 항목

- ZAP Replacer capability가 Traditional/Client/AJAX/definition 모든 initiator에 붙는지.
- capability header가 대상 서버로 전달되기 전에 제거되는지.
- crawler stop/cancel 후 실제 quiescence와 다음 신원 격리.
- actual Burp에서 HUMAN/ZAP/LLM/Judge와 SQLite save/reload.
- Windows 10/11 + Docker Desktop + PowerShell 7의 전체 연결.
- 고카디널리티 그래프 가독성, 메모리, polling 비용.
- endpoint/object/finding precision·recall과 진단자 검토시간.

## 24. 제품 결정 보류 — 3-way와 2-way 발언

현재 코드·README·기능명세·Judge lock은 다음 세 source를 독립 비교하는 3-way 제품이다.

```text
HUMAN vs SCANNER(ZAP) vs LLM Explorer
```

대화 중 제품 책임자가 한 차례 “3way 에서 2way 로 변경”이라고 지시했지만, 바로 다음 대화에서 탐색 방식과 Playwright 필요성을 다시 검토했고 어느 두 축을 남길지, Judge 입력과 ZAP 역할을 어떻게 바꿀지 확정하지 않았다. 이후에도 HUMAN, ZAP, LLM을 모두 개발·검증 대상으로 계속 요구했다.

따라서 현재 사실은 다음과 같다.

- 구현과 문서는 3-way다.
- 2-way 전환은 코드에 반영되지 않았다.
- 2-way를 확정하려면 `HUMAN+LLM`, `HUMAN+ZAP`, `HUMAN 대 자동화(ZAP+LLM orchestrator)` 중 의미, source model, Judge lock, UI 용어, benchmark를 먼저 결정해야 한다.
- 명시적 확정 전에는 source enum이나 기존 Evidence 호환을 삭제하지 않는다.

이 항목은 다음 Claude가 임의로 해석해 변경하면 안 되는 최우선 제품 확인 사항이다.

## 25. 작업 연혁 요약

전체 release 단위 변경은 [CHANGELOG](../../CHANGELOG.md), 이유·실패 재현·검증은 [개발 기록](development-log.md)이 정본이다. 다음은 왜 현재 구조가 되었는지 빠르게 파악하기 위한 축약 연혁이다.

| 구간 | 핵심 작업 | 남긴 교훈 |
|---|---|---|
| beta.1~6 | Burp 수집, 3-source 정규화, graph/matrix, route candidate, 분류·판정 기본 | 관측·후보·판정과 source·identity를 섞으면 안 됨 |
| beta.7~12 | 로컬 MCP, Explorer/Judge 격리, 계정·세션, SQLite, UI 흐름 | 모델 서술이 아니라 서버 Evidence gate가 권위여야 함 |
| beta.13~16 | ZAP stage raw capture, Client/AJAX 경고, 비Proxy HUMAN 상관관계, 계정 카드 정리 | API 완료 상태와 실제 트래픽은 다름 |
| beta.17~19 | Request Lab, byte 보존·charset, graph label/반응형 복구 | raw 진단 편의와 비밀 비영속을 분리해야 함 |
| beta.20~22 | 공개 설치, Docker/Desktop ZAP, Windows helper, 빠른 시작 | 사용자 환경 준비와 제품 실행을 한눈에 연결해야 함 |
| beta.23~25 | 라이선스·shade·MR-JAR·CI·manifest hardening | 배포물은 소스 테스트와 별도 검증 대상 |
| beta.26~28 | ZAP HAR import, ZAP Context/add-on/definition, LLM safe read/write·0 Evidence gate | 가져온 파일은 캠페인 완료가 아니며 write는 승인 필요 |
| beta.29~32 | CLI 격리, 작업 피드, 로그인 자동 확인, exact completed run과 dataset lock | 실행 성공·로그인 성공·탐색 완료를 분리해야 함 |
| beta.33~34 | Request Lab 멱등성, stale publication, 선형 snapshot/DataFlow, bounded payload | UI race와 메모리 경계는 실제 결함 fixture로 고정 |
| beta.35~37 | 독립/보조 frontier, 설치 Chrome CDP worker, Graph Fact·계층 투영 | browser는 보조 discovery, controlled replay가 Evidence |
| beta.38~39 | ZAP 진행·정체·partial 결과, capability provenance, 취소·cleanup, graph/explorer 회귀 복구 | 장시간 자동화에는 liveness, provenance, terminal cleanup이 제품 기능 |

## 26. Claude가 인수 직후 수행할 순서

### 0단계 — 변경 금지 상태 확인

```bash
git status --short
git log -1 --oneline
git rev-list --left-right --count origin/main...HEAD
shasum -a 256 target/flowscope-1.2.0-beta.44.jar
```

기대값은 사용자 소유 변경인 루트 `CLAUDE.md`와 untracked `mentor-progress-report.md`가 남고, `HEAD`가 beta.44 React 통합 집중 커밋인 상태다. JAR digest와 원격 차이는 `beta-validation.md`와 위 명령의 실측값을 따른다. 다르면 새 상태를 먼저 기록하고 이 문서를 기계적으로 믿지 않는다.

### 1단계 — 실제 ZAP provenance gate

코드 수정 전에 19절의 비로그인 첫 lane gate를 수행한다. 실패하면 status/API/Burp log/ZAP status와 첫 capability rejection 시점만 수집한다. Evidence가 섞일 수 있는 fallback을 추가하지 않는다.

### 2단계 — P0 정확성 수정

서로 독립된 작은 commit으로 다음 순서를 권장한다.

1. project load validate-then-swap과 실패 rollback.
2. Session Broker ACTIVE 계약과 auth material/보조 cookie 구분.
3. provenance-aware `RecordMerge` key.
4. JWT subject를 unresolved hint로 격하하고 account binding 근거 분리.
5. owner/actor/creator typed relation과 owner alias fixture.
6. 객체 없는 endpoint의 UNKNOWN policy 표시를 `UNTESTED/UNDECIDED`로 정정.
7. **beta.40 자동 회귀로 해결:** LLM child graceful→forced termination과 exit 확인. 실제 장기 provider run은 운영 gate로 유지.
8. 비UTF-8 XML과 canonical IPv6 authority.

각 항목은 수정 전에 실제 실패 테스트를 먼저 추가한다. 여러 항목을 한 대형 refactor에 섞지 않는다.

### 3단계 — 실제 HUMAN·LLM gate

- USER A/USER B 계정을 실제 로그인해 ACTIVE 신뢰 계약을 확인한다.
- HUMAN pass의 real Burp Browser/Repeater/Intruder와 graph projection을 확인한다.
- Codex와 Claude를 각각 Explorer로 실행해 endpoint inventory, exact-scope, account injection, Evidence, 정상 end-run을 확인한다.
- SPA가 있는 fixture에서 browser 없이 가능한 route와 CDP 보조로만 발견되는 route를 구분한다.
- Judge는 세 lane lock과 current reproduction/control bundle을 실제로 통과시킨다.

### 4단계 — 블라인드 효능 평가 전 제품 결정

- 3-way 유지 또는 2-way 전환 의미를 제품 책임자에게 확정받는다.
- 그 결정 전에는 benchmark schema와 source enum을 바꾸지 않는다.
- 허가된 일반 fixture에서 endpoint/API/object/classifier truth set과 review cost를 먼저 측정한다.
- 그 뒤 새 프로젝트로 crAPI 정답 격리 benchmark를 수행한다.

## 27. 절대 하지 말아야 할 인수 후 행동

- 샘플 데이터를 실제 수집 결과처럼 표시하거나 성능 근거로 사용하지 않는다.
- crAPI 정답, 특정 취약 endpoint, 공격 절차를 prompt·fixture·규칙에 넣고 탐지 성능이라고 주장하지 않는다.
- source와 orchestrator, source와 identity, requester와 owner를 합치지 않는다.
- `/orders/{id}` normalization 뒤 raw `/orders/101` Evidence를 버리지 않는다.
- status 2xx, ZAP Alert, LLM 문장 하나로 BOLA/BFLA를 확정하지 않는다.
- 미요청 route를 observed coverage나 finding으로 승격하지 않는다.
- REVIEW/EXCLUDE를 데이터셋에서 삭제하지 않는다.
- raw Cookie/Authorization/password/API/provider token을 project, snapshot, MCP, log, Git에 넣지 않는다.
- 실제 대상에 write, Active Scan, 경합, 대량 요청을 묵시적으로 실행하지 않는다.
- ZAP/LLM 장시간 작업을 취소·terminal cleanup 없이 남기지 않는다.
- UI만 숨겨 backend 의미 오류를 덮지 않는다.
- 자동테스트 통과를 실제 Burp, ZAP, Windows, target 성능 완료로 표현하지 않는다.
- `mentor-progress-report.md`를 커밋하지 않는다.
- 사용자 승인 없이 push, tag, GitHub Release를 만들지 않는다.

## 28. 인수 완료 체크리스트

Claude는 개발을 시작하기 전에 다음 질문에 파일·코드·테스트 근거로 답할 수 있어야 한다.

1. 현재 HEAD와 origin/main의 차이는 무엇인가?
2. 최신 JAR과 자동 회귀가 증명한 것과 증명하지 못한 것은 무엇인가?
3. HUMAN, SCANNER, LLM, orchestrator, identity, role, owner는 어떻게 다른가?
4. Session Broker가 raw credential을 어디에 보관하고 누구에게 무엇만 노출하는가?
5. ZAP capability rejection이 왜 안전한 실패이며 다음 실환경 gate는 무엇인가?
6. Explorer가 browser 없이 할 수 있는 것과 CDP worker가 필요한 경우는 무엇인가?
7. Assessment와 final validation은 어떻게 다른가?
8. Graph Fact, API template, object family, object instance는 어떻게 연결되는가?
9. 현재 코드에서 남은 P0/P2 결함은 무엇인가?
10. 2-way 발언을 왜 아직 코드 변경으로 해석하면 안 되는가?
11. 코드 변경 시 함께 갱신할 문서는 무엇인가?
12. 어떤 검증을 수행해야 “실제 동작 확인”이라고 말할 수 있는가?

이 12개를 설명하지 못하면 새 기능을 추가하기 전에 이 문서와 정본 코드를 다시 읽는다.
