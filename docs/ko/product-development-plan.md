# FlowScope 1.2.0-beta.7 제품 개발·검증 계획

이 계획은 `whs_flow` 화면을 실제 제품 작업면으로 채택한다는 결정과 FlowScope의 기존 수집·분석·MCP 신뢰 경계를 함께 만족시키도록 다시 검토한 실행 기준이다. 성공 기준은 “화면이 보임”이 아니라 실제 Evidence가 끝까지 보존되고, 거짓 자동화 없이 재현 가능하며, 공개 JAR 하나로 설치되는 것이다.

## 1. 계획 검토에서 바로잡은 전제

1. `jdk.httpserver`를 새로 쓰지 않는다. Burp Community의 축소 런타임에서 해당 모듈을 보장할 수 없으므로 기존 `LoopbackHttpServer`를 Web UI에도 재사용한다.
2. Montoya가 보장하지 않는 Repeater 결과 자동 상관을 완료 기능으로 쓰지 않는다. 저장된 마스킹 요청은 미전송 초안으로만 열고, 자동 최종 판정에는 FlowScope 통제 실행기가 별도 VALIDATION run으로 캡처한 `CONTROLLED` Evidence만 사용한다. 직접 8082 관측은 폴백이며 결정적 판정에 쓰지 않는다.
3. 비교 UI의 자동 principal/HMAC 계정 식별 주장을 가져오지 않는다. 계정은 비밀 없는 표시 정보만 저장하고 `(service, fingerprint)` 연결은 사용자가 확정한다.
4. 객체 ID가 없는 엔드포인트에 가짜 resource를 만들지 않는다. 이 경우 그래프는 identity에서 operation으로 직접 연결하고 BFLA는 명시적 역할 정책으로 분석한다.
5. 일반 LLM assessment는 `LIKELY / INCONCLUSIVE / REJECTED`만 제출한다. 최종 `CONFIRMED / INCONCLUSIVE / REJECTED`는 서버가 현재 후보와 원본/반복 재현/정상 대조 Evidence 집합을 검증한 경우에만 저장한다. 사람 판정은 감사·오버라이드 기록이다.
6. 2만 건 전체의 Request/Response를 매초 전송하지 않는다. snapshot은 메타데이터만, 전문은 선택 시 지연 로드한다.
7. crAPI 정답을 코드나 프롬프트에 넣지 않는다. 제품 완료 뒤 독립 HUMAN/ZAP/LLM pass와 블라인드 채점으로 검증한다.
8. LLM에게 ZAP 기능 선택을 맡기지 않는다. 기본 scanner lane은 Traditional Spider, strict Client Spider, AJAX fallback, passive queue, native alert 순서의 시스템 workflow다.
9. Explorer의 독립성은 프롬프트 약속이 아니라 서버 가시성 제한과 세 레인 dataset lock으로 강제한다.
10. 트래픽 노이즈는 수집 단계에서 삭제하지 않는다. 모든 Evidence를 보존하고 결정론 분류로 `INCLUDE/REVIEW/EXCLUDE`를 나누며, 메인 coverage에는 `INCLUDE`만 넣고 사용자가 operation 단위로 되돌릴 수 있게 한다.
11. 관측된 조합의 `UNCROSSED`와 아직 요청하지 않은 route candidate를 섞지 않는다. 전자는 현재 Evidence에서 계산하는 사실이고, 후자는 in-scope 응답이나 Burp Site Map에 정확한 provenance가 있는 탐색 후보다.
12. 후보 우선순위에 임의 숫자 가중치를 먼저 넣지 않는다. 검증된 규격 신호와 provenance를 범주형으로 보존하고, 고정된 라벨 corpus와 블라인드 결과가 생긴 뒤에만 수치 점수의 필요성과 calibration을 판단한다.
13. LLM 버튼 자동화는 공급자 API/OAuth를 내장하지 않는다. 사용자의 로컬 로그인 Codex/Claude CLI를 새 프로세스로 실행하되 Explorer는 비영속·no-resume, Judge는 별도 새 세션·명시적 resume로 분리한다. CLI 0 종료만 완료로 믿지 않고 MCP run 종료와 dataset lock을 서버 상태로 확인한다.

## 2. 구현 단계와 성공 기준

### P0 — 정본·경계 고정

- Web UI를 그래프/매트릭스/상세의 유일한 정본으로 고정한다.
- Burp 탭은 scope, 포트, 프로젝트, MCP, Web 열기만 담당한다.
- HUMAN/SCANNER/LLM source와 orchestrator를 분리한다.
- 성공 기준: 문서·코드·UI 어디에도 이중 그래프, 검증 없는 LLM 확정, Repeater 자동 상관이라는 상충 주장이 없다.

### P1 — localhost Web 제품면

- `whs_flow` 정보 구조와 시각 문법을 그대로 활용해 그래프, 매트릭스, 흐름 순서, 시나리오, 파싱 결과, 계정·세션 화면을 제공한다.
- Cytoscape.js는 JAR에 vendoring하고 네트워크 CDN 의존성을 없앤다.
- Host/Origin/capability/CSP/no-store/frame 보호와 25MiB XML·1MiB form 상한을 적용한다.
- 긴 endpoint/service/Evidence는 줄바꿈·스크롤·전체 텍스트 상세로 확인 가능하게 한다.
- 성공 기준: 샘플에서 여섯 모드와 우측 상세가 동작하고, 잘린 값도 상세에서 전부 읽을 수 있으며, 잘못된 capability/origin/method가 거부된다.

### P2 — Evidence·정책·세션 작업

- 선택 API의 마스킹 Request/Response를 200건 단위로 지연 로드해 전부 탐색할 수 있게 한다.
- 등록 계정, 서비스 경계 세션 연결/해제, identity role, endpoint requirement, resource owner를 UI에서 수정한다.
- rule finding, MCP assessment, 서버 검증 최종 판정을 같은 시나리오 화면에 두고 사람 감사·오버라이드를 저장한다.
- Repeater는 첫 Evidence의 마스킹된 미전송 초안만 연다.
- HTTP 문맥 기반 비파괴 traffic classification, captured/coverage 통계, operation별 override, 반복 Evidence 표시 접기를 제공한다. cookie 회전은 검증된 account binding 전까지 서비스별 `UNRESOLVED` graph identity로 안정화한다.
- 사용자가 명시적으로 시작한 HUMAN 로그인 캡처만 memory-only broker에 넣고, service+scope+ACTIVE 상태가 맞는 계정에 한해 ZAP/LLM에 주입한다. raw 값은 project/Web/MCP에 저장·노출하지 않는다.
- 성공 기준: 비밀번호·raw token을 저장/표시하지 않고, 다른 service의 세션 연결은 실패하며, Evidence 집합이 바뀐 과거 판정은 승계되지 않는다.

### P3 — 공개 배포 정리

- JGraphX 코드·의존·고지를 공개 정본에서 제거하고 이전 구현은 `.local/archive/`에만 보존한다.
- Cytoscape.js/Jackson/FlowScope 라이선스를 JAR에 동봉한다.
- README, architecture, decisions, changelog, agent workspace의 실제 UI 경로와 버전을 맞춘다.
- 성공 기준: fresh `mvn clean verify`, fat JAR manifest/의존/라이선스 검사, 절대경로·비밀·불필요 산출물 검사를 통과한다.

### P4 — 실제 UI·Burp QA

- standalone Web UI를 데스크톱 브라우저에서 1500×900과 좁은 폭으로 확인한다.
- 그래프 필터, 노드 펼치기, Matrix, 시나리오, 계정/세션, Request/Response, sample/reset을 클릭 검증한다.
- Burp Community에서 JAR load/unload, 3개 listener 수집, Proxy history, Repeater handoff, project round trip, MCP 연결을 검증한다.
- 실제 로그인으로 USER A/B를 ACTIVE로 만든 뒤 비로그인→USER A→USER B ZAP fresh-session campaign, 신원별 수집/Alert, LLM account 주입을 검증한다.
- Web 버튼으로 Codex와 Claude 각각 새 Explorer → exact run 종료 → 별도 Judge lock → 같은 Judge 후속 resume를 실행하고, Explorer 대화가 Judge에 재사용되지 않으며 MCP 밖 네트워크 도구가 제공되지 않는지 확인한다.
- 성공 기준: 브라우저 콘솔 오류 0, 잘린 핵심 조작 0, unload 후 포트 해제, 세 source가 실제 포트대로 분리된다.

### P4-H — HUMAN/Burp 그래프 핵심 교정 (SCANNER·LLM 동결)

이 단계는 P5 전에 먼저 끝낸다. 목표는 “요청을 많이 저장함”이 아니라, 실제 사람이 밟은 business operation과 응답에서 발견한 미요청 후보를 섞지 않고 IDA식 그래프에서 추적 가능하게 만드는 것이다.

#### H0. beta.3 기준선과 검증 기록 교정

- beta.3의 `TrafficClassifier.VERSION=2`는 `application/manifest+json`을 일반 `+json` API로 포함했다. 당시 crAPI 익명 스모크의 HUMAN/SCANNER/LLM `INCLUDE`는 모두 `/manifest.json`이므로 business API 탐색 성공으로 인정하지 않는다.
- 8080 HUMAN 스모크는 Burp Browser가 아니라 `curl`을 HUMAN listener에 연결한 전송 확인이었다. `sourceDetail=BROWSER`는 listener profile에서 붙은 provenance이지 실제 브라우저 사용 증명이 아니다.
- beta.3의 `UNCROSSED`는 관측 identity × 관측 operation/resource 중 확정 owner가 있는 미실행 cell만 계산했고 미관측 endpoint inventory는 없었다.
- beta.3 Web snapshot은 추출된 모든 object candidate에 근거 계산 없이 `confidence=1.0`을 넣고 UI는 이를 `신뢰도 100%`로 표시했다. beta.4에서는 H4의 추출 근거 표시로 교체한다.
- 성공 기준: README, 결정 로그, 검증 기록과 개발 계획이 이 경계를 동일하게 말하고, 기존 JAR의 성능을 소급 과장하지 않는다.

#### H1. 분류기 v3 — 규격 신호 기반 결정론 cascade

먼저 일반 목적 라벨 fixture를 작성하고 실패를 재현한 뒤 최소 규칙으로 수정한다. target 이름이나 crAPI path는 규칙에 넣지 않는다.

1. scope, response 존재, source, HUMAN phase 같은 변경 불가능한 discovery gate를 먼저 적용한다.
2. CORS preflight, document/navigation, script/style/image/font, web app manifest, source map, service worker 같은 브라우저 보조 관측은 Evidence를 삭제하지 않고 `DISCOVERY_METADATA` 또는 기존 비분석 class로 분리한다. 이 데이터는 business graph에는 들어가지 않지만 route candidate 추출에는 사용할 수 있다.
3. 명시적 GraphQL/gRPC/protobuf, unsafe business request, Fetch destination `empty`와 API representation의 합치처럼 강한 API 신호만 `INCLUDE`한다.
4. 같은 정규화 operation의 다른 관측에 강한 API Evidence가 있으면 그 교차 관측을 보조 신호로 사용한다. 충돌하거나 보안 관련성이 있으나 용도가 불명확하면 삭제하지 않고 `REVIEW`에 둔다.
5. operation 단위 사용자 override는 유지하되, override 전후 reason과 영향 record 수를 표시한다.

필수 fixture는 실제 browser document, JSON fetch API, `text/plain` API, GraphQL variables, nested/array object ID, multipart, authenticated image API, 일반 image, CSS/JS/font, source map, web manifest, service worker, CORS preflight, 일반 OPTIONS, redirect, 401/403, 응답 없는 요청을 포함한다.

성공 기준:

- web manifest·명확한 정적 자원·진짜 preflight가 business `INCLUDE`가 되는 알려진 회귀가 0이다.
- JSON이 아닌 API와 객체를 다루는 정적 경로가 단순 확장자 때문에 사라지는 알려진 회귀가 0이다.
- 모든 분류 결과에 machine-readable reason이 있고 원 Evidence는 그대로 남는다.
- fixture confusion matrix와 `REVIEW` 작업량을 공개한다. 오탐·미탐 0이나 근거 없는 정밀도 목표값은 주장하지 않는다.

#### H2. Route Candidate Inventory — 관측과 후보를 분리

**현재 상태: beta.7 공통 코어·source/run 격리·candidate lock·구독 CLI 실행 경계 구현과 고정 corpus 회귀 완료, 실제 beta.7 Burp/블라인드 target 검증 대기.**

새 모델은 최소한 다음을 보존한다.

```text
RouteCandidate {
  service, methodOrUnknown, pathTemplate,
  provenance[{type, evidenceId, source, runId, adapter, applicability, reason}],
  observed, applicability, reviewReason
}
```

후보 입력은 사용자가 허가한 exact scope 안에서 실제로 받은 데이터만 사용한다.

- Burp Montoya `siteMap().requestResponses(filter)`의 in-scope 항목. `hasResponse=false`인 항목은 관측 요청으로 승격하지 않고 `BURP_UNREQUESTED` 후보로만 저장한다.
- 관측 HTML의 `a[href]`, `form[action/method]`, script/embed/manifest link와 같은 명시적 URL 참조. 깨진 HTML과 `<base>`는 HTML5 DOM 규칙으로 처리한다.
- 관측 응답의 same-scope `Location`과 표준 sitemap/robots/web manifest 항목.
- 관측 JavaScript의 `fetch`/XHR/axios/jQuery/sendBeacon 명시적 URL literal. 문자열 조합·동적 계산은 추측하지 않는다.
- 대상 내부에서 실제로 관측된 OpenAPI/Swagger JSON·YAML 문서만 사용한다. 외부 검색, Wayback, 저장소, 사전 정답은 사용하지 않는다.
- 제품명에 종속되지 않은 XML의 명시 URL/method attribute·element만 읽는다. DOCTYPE·외부 entity·외부 DTD/schema는 차단한다.

포맷별 어댑터는 발견만 하고, 공통 코어가 exact scope·지원 scheme·method token·정규화·dedup을 단독 집행한다. URL만 있고 method 근거가 없으면 `GET`으로 꾸미지 않고 `UNKNOWN`으로 둔다. 후보 dedup key는 service + method/unknown + normalized path이고, 각 provenance는 Evidence ID뿐 아니라 source·run·adapter 대응을 유지한다.

성공 기준: 모든 후보를 클릭해 “어느 응답/어느 Site Map 항목에서 나왔는지” 확인할 수 있고, provenance 없는 후보는 0이며, 후보가 coverage·finding·dataset lane 완료를 증가시키지 않는다.

#### H3. 그래프·갭 표현

- 실제 HUMAN 요청은 기존 파랑·실선으로 유지한다.
- 아직 요청하지 않은 후보는 source edge로 위장하지 않고 중립색 빈 노드·점선 테두리로 표시한다. `미요청 후보` 필터에서만 켜고 끌 수 있게 한다.
- `REVIEW`는 분류 보류, `미요청 후보`는 아직 request/response가 없는 공격면 후보이므로 서로 다른 상태와 개수로 표시한다.
- 기존 `UNCROSSED`는 이름과 계산을 유지한다. 별도 `UNOBSERVED_ROUTE`는 candidate inventory 중 observed operation으로 매칭되지 않은 항목만 표시한다.
- candidate를 눌러 Burp Browser로 열거나 Repeater 초안을 만드는 동작은 자동 전송하지 않으며, 사용자가 요청해 실제 response가 들어온 뒤에만 observed로 전환한다.

성공 기준: 한 화면에서 observed/candidate/review를 혼동하지 않고, 빈 후보를 취약점·미탐 확정으로 표현하지 않으며, Request/Response 없는 노드가 인가 verdict를 갖지 않는다.

#### H4. 객체 적용 가능성·가중치 경계

- 전체 identity × 전체 resource의 단순 곱을 만들지 않는다. operation마다 실제 path/query/body/schema Evidence로 접근 가능한 `R(o)`만 연결한다.
- `C_total = Σ |I|·|R(o)|`는 `R(o)`가 Evidence로 확인된 경우에만 연구용 후보 공간으로 계산한다. route 후보만 있고 객체 적용 가능성이 불명확하면 객체 조합을 생성하지 않는다.
- 우선순위 1차판은 임의 숫자 합산이 아니라 설명 가능한 사전식 정렬이다: 명시적 method·object reference·authorization 관련 응답·복수 독립 provenance·state-changing 여부. 각 항목은 원 Evidence를 가리킨다.
- 숫자 가중치는 고정 corpus와 블라인드 benchmark에서 feature별 precision/recall 및 review 비용을 측정하고, 동일 데이터로 규칙을 만들고 성능을 주장하는 누수를 막은 뒤에만 별도 결정한다.

성공 기준: 후보 정렬 이유를 사람이 읽을 수 있고, 검증되지 않은 object cross-product와 임의 confidence 퍼센트가 없다. 현재 object candidate의 고정 `신뢰도 100%`도 제거하고 `PATH_ID/QUERY_ID/BODY_ID/GRAPHQL_VARIABLE/USER_CONFIRMED` 같은 추출 근거로 대체한다.

#### H5. 검증 순서

1. protocol fixture 회귀 → 분류 결과와 candidate truth set 대조.
2. 실제 Burp Browser HUMAN pass → Fetch Metadata가 있는 요청과 없는 요청을 모두 저장해 listener label과 실제 browser 동작을 구분.
3. 일반 local MPA, SPA, GraphQL fixture → route candidate precision/recall, API 분류 confusion matrix, REVIEW 건수·승격률, graph node 감소량을 기록.
4. fresh project save/load → candidate provenance와 override 왕복, raw credential 부재 확인.
5. 위 gate가 끝난 뒤에만 P5 crAPI 블라인드 benchmark를 시작하며 정답은 lock 이후 확인.

중단 조건은 provenance 없는 candidate 생성, protocol fixture 회귀, 후보의 coverage/finding 오염, 실제 Burp Browser에서 재현되지 않는 자동 테스트 통과다. 이 경우 임의 예외를 더하지 않고 원인을 고친다.

### P5 — crAPI 블라인드 벤치마크

- 정답 목록을 보지 않은 상태에서 새 프로젝트로 시작한다.
- HUMAN, 시스템 ZAP, LLM Explorer를 독립 수행하고 dataset을 잠근 뒤에만 Judge가 cross-source Evidence를 읽는다.
- 각 후보는 Evidence ID, 재현 절차, 관측 source, 서버 검증 verdict를 먼저 고정한 뒤 라벨 정답과 독립적으로 채점한다. 사람은 애매한 케이스를 사후 판정하되 제품 verdict를 소급 변경하지 않는다.
- 정답 대조는 모든 pass와 판정이 잠긴 뒤 별도 단계에서만 수행한다.
- 성공 기준: 소스별 고유/중복 발견, false positive, unresolved, 준비·실행 시간을 재현 가능한 보고서로 남긴다. 커버리지 퍼센트는 알려진 벤치마크 정답 집합에 대한 사후 평가에서만 사용하고 제품의 블랙박스 화면에는 표시하지 않는다.

## 3. 완료 정의

- 루트 공개 소스만으로 `mvn clean verify`와 단일 JAR 생성이 된다.
- Burp Community에서 설치·수집·Web 열기·MCP·Repeater handoff·저장/복구가 실제로 동작한다.
- HUMAN/SCANNER/LLM을 필터링하고 중복·부분 발견·불일치·미교차를 같은 데이터셋에서 읽을 수 있다.
- Request/Response와 판정 근거를 Evidence ID로 추적할 수 있다.
- 도구가 하지 않은 요청, 응답, 신원, 소유자, 취약점 확정을 UI나 문서가 했다고 주장하지 않는다.

## 4. 2026-08-26 beta.6 구현 상태

- P4-H H1: classifier v3가 web manifest·source map·service worker를 `DISCOVERY_METADATA/EXCLUDE`로 분리하고, 같은 service·정규화 operation의 강한 API Evidence로만 immutable discovery gate를 통과한 `REVIEW` 형제 관측을 보강한다. manifest·다른 service·응답 없음 회귀와 보조 metadata fixture를 자동 테스트로 고정했다. 공개 confusion matrix와 실제 Burp Browser corpus 평가는 남아 있다.
- P4-H H2: `RouteCandidate`와 공통 discovery pipeline을 추가했다. exact-scope HTML5 DOM, 표준 metadata, 정적 JS call site, OpenAPI/Swagger JSON·YAML, generic XML, 응답 없는 Burp Site Map item을 같은 core gate로 정규화·병합하며 provenance의 source/run/adapter 대응을 저장·복구한다. 문자열 조합과 범위 밖 참조는 후보로 만들지 않는다. 일반 protocol fixture 7종·truth route 18개 회귀는 TP 18/FP 0/FN 0이지만 이는 대상 성능 수치가 아니다. Community의 실제 Site Map 미응답 item과 blind target 결과는 수동 gate다.
- P4-H H2 visibility: provenance별 applicability/reason을 보존하고 Explorer MCP에는 현재 LLM run view만 재계산해 제공한다. pre-lock cross-lane status/ZAP/판정 조회를 차단하고 lock 시 route inventory도 고정한다. 실제 구독 클라이언트와 worker 경합은 수동 gate다.
- P4-H H3: Web graph에 source edge 없는 중립색·점선 테두리 후보와 전용 수량·필터·상세를 추가했다. `REVIEW`, `UNCROSSED`, 미요청 route를 서로 다른 상태로 설명하며 candidate는 coverage·gap·verdict·finding·lane 완료를 바꾸지 않는다. standalone 1280×720·600×800에서 overflow와 console 오류 0을 확인했지만 실제 candidate가 있는 Burp 화면은 수동 확인이 남았다.
- P4-H H4: object의 고정 `신뢰도 100%`를 `PATH_ID/QUERY_ID/BODY_ID/GRAPHQL_VARIABLE/DERIVED/NONE` 근거로 교체했다. route 후보는 적용 가능성 → 명시 method → 객체 template → 상태 변경 → 복수 provenance의 범주형 사전식 순서를 쓰고 이유를 화면에 노출한다. authorization 관련 응답 신호는 미요청 candidate에 아직 연결하지 않으며, 수치 가중치는 benchmark 전까지 도입하지 않는다.
- beta.6 자동 검증: 최종 `mvn clean verify` 수치와 JAR digest는 `beta-validation.md`와 `development-log.md`에 기록한다. 고정 corpus와 fat-JAR parser smoke, MCP run visibility 회귀는 공통 파이프라인·격리·패키징 검증이며 Burp Community 재로드나 blind target 성능을 대신하지 않는다.

- P0~P3: 코드 구현 완료. Web UI 정본화, exact-scope 수집 차단, 구조적 마스킹, memory-only session broker, 통제 LLM 실행, Explorer 서버 격리, dataset lock, 신원별 fresh-session 시스템 ZAP campaign, 서버 검증 LLM verdict를 구현했다.
- P4 브라우저 QA: 기존 beta.3 standalone UI의 1500×900, 900×700, 600×800, 1024×768, 1280×720 검증은 통과했다. 이번 scanner control도 1280×720·600×800에서 비로그인 선택, 가로 overflow 0, 좁은 폭 modal scroll, 신원/target 미선택 버튼 비활성, warning/error 0을 확인했다. Standalone fixture에는 ACTIVE broker 계정이 없어 USER A/B 복수 chip 렌더는 HTML/API 계약까지만 통과했으며, Standalone 검증은 Burp suite tab 검증을 대신하지 않는다.
- P4 Burp Community QA: 현재 beta.3 fat JAR을 Community 2026.7.3에 로드해 suite tab, Web UI 17777, MCP 8787, HUMAN 8080, SCANNER 8081을 실제 기동했다. exact scope `http://127.0.0.1:8888/`에서 HUMAN listener 8080 전송 3건, ZAP 2.17 SYSTEM baseline 8건, MCP LLM Explorer 통제 요청 1건이 각각 HUMAN/SCANNER/LLM으로 분리됐다. 이 HUMAN 전송은 실제 Burp Browser가 아니라 8080을 프록시로 사용한 `curl` 스모크였다. ZAP 8건은 모두 `CONTROLLED/ANONYMOUS`였고 LLM의 범위 밖 FlowScope Web 요청은 거부됐다. `REVIEW`뿐인 HUMAN lane에서는 lock이 거부됐고 classifier v2가 web manifest를 `API/INCLUDE`로 오분류한 `/manifest.json`을 추가한 뒤 12건을 잠갔다. 따라서 이 결과는 포트 분리·lock·scope guard의 wiring 검증이지 HUMAN business API 탐색이나 분류 품질 검증이 아니다. finding·gap 0과 잠금 뒤 Explorer 재시작 거부는 관측 사실 그대로 유지한다.
- beta.6 잔여 수동 gate: 새 JAR의 Burp Community 재로드와 Site Map candidate, 실제 Burp Browser HUMAN pass, 브라우저 `UNVERIFIED→ACTIVE` 실제 로그인, USER A/B broker 주입과 복수 ZAP lane, 구독형 Codex/Claude prompt 전체와 Judge, Repeater handoff, project save/load, extension unload 후 포트 해제를 확인해야 한다. beta.3에서 통과한 packaging·익명 3-source 연결·MCP protocol·가시성 격리·범위 차단을 새 JAR의 실검증으로 소급하지 않는다.
- HUMAN 탐색 경계: HUMAN pass의 시작·종료와 `EXPLORATION` run ID 상태 전이는 8080 `curl` 스모크로 확인했다. 실제 Burp Browser 탐색은 미검증이다. 로그인 캡처 `SESSION_SETUP`, pass 밖 `BASELINE`, 선택 ACTIVE 계정의 exact credential match는 자동 회귀를 통과했으며 실제 로그인 계정으로 재확인해야 한다.
- 분류 경계: `REVIEW`를 Evidence·검토 대기에 보존하면서 메인 graph·3-way gap 입력에서는 보류하고, UI 처분 필터와 수량을 `INCLUDE/REVIEW/EXCLUDE`로 분리했다. 1280×720 standalone의 필터·상세·overflow·console 검증은 통과했고, 실제 Burp 대상에서 REVIEW 승격·숨김 작업량은 beta gate와 blind benchmark에서 측정해야 한다.
- 판정 경계: 거부/HEAD owner 오염, auth 부분문자열 redirect 오탐, owner-only 객체 Evidence를 차단했다. 불충분한 BOLA read 응답은 안전으로 폐기하지 않고 `UNDECIDED/INCONCLUSIVE`에 남긴다. 자동 회귀는 통과했으며 실제 Judge workflow는 beta gate다.
- P5 crAPI 블라인드 벤치마크: 사용자 검토 전까지 보류한다. 정답·공격 절차·라벨을 코드, 프롬프트, 실행 컨텍스트에 넣지 않는다.

## 5. 2026-08-27 beta.7 구현 상태

- Web 빠른 시작에 Codex/Claude 공급자, exact target, ACTIVE 계정, `LLM Explorer 시작`, `Judge 시작`, 취소, `Judge 계속`을 추가했다. LLM 사용자는 버튼만으로 실행할 수 있고 기존 `agent-workspace` 절차는 환경 호환 수동 폴백이다.
- Explorer는 전용 owner-only 임시 작업공간과 새 비영속 프로세스를 사용한다. Codex는 ephemeral·read-only·no-approval·user-config 무시·웹 검색 비활성화·모델 shell MCP token 제외, Claude는 strict 임시 MCP 설정·빈 setting sources·auto-memory 비활성화·제한 도구·no-persistence를 적용한다. FlowScope가 exact LLM run을 먼저 발급하고 모델이 동일 run을 끝내지 않으면 완료 레인을 열지 않고 abort한다.
- Judge는 Explorer와 분리된 새 provider session이다. 잠긴 3-lane dataset을 실제 MCP 상태로 확인해야 성공하며, 완료 뒤 저장한 Codex thread ID 또는 Claude session ID로만 후속 요청을 resume한다. 장기 실행 terminal을 유지하는 구조는 아니다.
- MCP 토큰은 자식 환경에만 전달하고 command line·prompt·project에 포함하지 않는다. 상속된 OpenAI·Anthropic API key는 제거한다. CLI는 shell 없이 regular executable 경로로 실행하고, 임시 workspace와 출력은 각각 안전한 경로 삭제·마스킹/상한을 적용한다. 긴 Codex 출력에서도 시작부 session ID를 보존하고 취소·Burp unload 직후 늦게 생성된 child를 즉시 종료하는 회귀를 추가했다.
- active run 또는 Judge lock 상태에서 Burp UI scope 변경을 거부한다. 같은 source 재탐색 시작 시 과거 완료 표식을 무효화하고 세 레인이 다시 완료될 때까지 Judge UI·서버 lock을 닫아 부분 재실행 오염을 차단했다.
- Claude의 `--no-session-persistence`가 일부 버전에서 metadata를 남길 수 있는 한계는 삭제로 위장하지 않는다. Explorer는 그 ID를 저장·resume하지 않고 UI에서 잔존 가능성을 경고한다.
- 자동 검증은 실행 인자, fresh/no-resume, exact run 종료 실패, 3-lane/lock gate, inactive account 차단, Claude Judge resume, 긴 Codex 출력의 session ID, Web API와 scope 변경 차단을 다룬다. 실제 구독 로그인 상태의 Codex/Claude, Burp MCP 왕복, 대상 요청, Judge 후속 resume는 beta.7 JAR 재로드 후 수동 gate다.

## 6. 근거와 계획 해석

- [W3C Fetch Metadata](https://www.w3.org/TR/fetch-metadata/)는 `Sec-Fetch-Dest`가 `empty`, `image`, `document`, `iframe` 등 요청 목적을 전달한다고 정의한다. 분류 신호로 쓰되 헤더 누락 가능성 때문에 단독 절대판정으로 쓰지 않는다.
- [W3C Web App Manifest](https://www.w3.org/TR/appmanifest/)는 `application/manifest+json`과 `.webmanifest`를 웹 앱 manifest로 정의하고 `.json` 확장도 허용한다. 따라서 모든 `+json`을 business API로 보는 현재 규칙은 잘못이다.
- [PortSwigger Site Map 문서](https://portswigger.net/burp/documentation/desktop/tools/target/site-map/getting-started)는 응답에서 URL이 참조됐지만 request-response가 완료되지 않은 항목을 별도 회색 후보로 표시한다. 이는 FlowScope도 observed와 candidate를 분리해야 한다는 직접적인 제품 근거다.
- [Montoya SiteMap API](https://portswigger.github.io/burp-extensions-montoya-api/javadoc/burp/api/montoya/sitemap/SiteMap.html)는 extension이 Site Map item을 조회할 수 있고, `HttpRequestResponse.hasResponse()`로 응답 유무를 구분할 수 있다. 실제 Community 동작 여부는 H2 수동 gate에서 확인한다.
- [Burp HTTP history filtering](https://portswigger.net/burp/documentation/desktop/tools/proxy/http-history/filter-settings)은 filter가 표시만 바꾸고 항목을 삭제하지 않는다고 명시한다. FlowScope의 Evidence 보존과 분석 처분 분리 원칙을 유지한다.
- [OWASP WSTG IDOR](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/04-Testing_for_Insecure_Direct_Object_References)는 object reference 위치를 먼저 매핑하고 서로 다른 사용자 소유 객체로 권한을 검증하도록 한다. 그래서 route 후보와 object applicability를 증거 없이 Cartesian product로 만들지 않는다.
- [OWASP API1:2023 BOLA](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)는 object ID가 path/query/header/body 어디에도 있을 수 있음을 명시한다. 정규화 corpus가 path 숫자만 다뤄서는 안 되는 근거다.

위 문서가 정하는 것은 프로토콜 의미와 Burp가 제공하는 관측면이다. 어떤 feature에 몇 점을 줄지는 표준이 정하지 않으므로, 가중치 보류와 범주형 정렬은 이 근거들에서 내린 설계 판단이다.
