# FlowScope 설계서 v1.2.0-beta.44

**화이트햇스쿨 2단계 팀 프로젝트, 토큰많이조**

**2026-09-07 현재:** 기존 Judge·MCP와 여기에 결합된 Explorer 실행기를 제거했다(D-126). HUMAN·ZAP 실행, 분석 코어와 프로젝트 호환을 유지하며 새 Explorer 하네스·제품용 MCP는 미구현이다. 과거 명세와 D-125 이전 실행 설명은 역사 기록이며 현재 계약은 이 문서와 [제거 상태](mcp-judge-removal-plan.md)를 따른다.

사람·스캐너·LLM이 선언·관측한 API와 입력을 같은 범용 좌표에 정렬해 탐색 차이를 먼저 보여 주고, 선택한 API의 BOLA/IDOR·BFLA 후보를 기존 신원 인지 그래프와 Evidence로 검증하는 Burp Suite 확장이다. `docs/ko/specification/functional-spec.md`는 원 요구사항의 이력이다. 현재 범위는 `product-overview.md`·README, 현재 HOW는 이 문서, 선택 이유와 대체 관계는 `decisions.md`, 진행상황은 `HANDOFF.md`를 따른다. 화면별 사용자 질문과 발표 논리는 `ui-product-rationale.md`가 정본이다.

## 1. 제품 목표와 신뢰 경계

- 정본 목표는 “허가된 exact scope에서 선언되거나 실제 관측된 API·입력을 구조화하고, HUMAN·SCANNER·LLM의 탐색 차이와 인가 후보를 원 Evidence까지 역추적 가능하게 만들어 진단자가 다음에 볼 위치를 줄이는 것”이다.
- 기본 작업면은 `Endpoint·Parameter Surface Delta`다. 선언 근거와 실제 HTTP 관측을 분리하고 source별 미관측 위치를 중립 작업목록으로 제시한다. 인가 그래프는 선택한 API의 `identity → API(operation) → object` 관계를 여는 상세층이다. 접기·그룹화·화면 전환은 표현일 뿐 원 Evidence 관계를 합치거나 삭제하지 않는다.
- 비교 축 `source={HUMAN,SCANNER,LLM}`와 판정 축 `identity/role/owner`를 섞지 않는다(D-001).
- LLM source는 저장된 관측의 생성자 표시다. 현재 자동 LLM 실행·판정은 없으며, 과거 assessment/validation은 읽기 전용으로 분리한다.
- 블랙박스 전체 분모는 알 수 없으므로 커버리지 퍼센트를 만들지 않는다(D-002).
- 모든 액티브 도구는 명시적 exact scope 안에서만 동작한다. 현재 FlowScope에는 ZAP Active Scan 시작 API가 없다. 기본 캠페인과 HUMAN 명시 전송의 scope·승인 경계는 유지한다.
- 모든 endpoint·parameter 발견, 오탐·미탐 0, LLM 서술만으로 최종 확정은 보장하지 않는다. 완료 여부는 개발 corpus와 분리된 블라인드 benchmark에서 endpoint·parameter·객체·분류·finding 측정값, `REVIEW` 작업량, false positive·false negative·unresolved를 함께 공개하고 모든 후보·판정을 원본/재현/정상 대조 Evidence로 역추적할 수 있는지로 판단한다.

## 2. 단일 확장 아키텍처

```text
Browser :8080 ─┐
               ├─▶ Burp capture ─▶ mask/normalize/classify ─▶ Pipeline
ZAP     :8081 ─┘         ▲                                    ├─▶ Surface/Graph/Matrix
                         │ Session Broker                     └─▶ 규칙 후보 + 사람 검토
Web 스캐너 버튼 ─▶ ZapCampaign ─▶ ZapClient ─▶ 로컬 ZAP API
Web Request Lab ─▶ 명시적 HUMAN 전송 ─▶ VALIDATION Evidence
ProjectStore/SqliteProjectStore ◀─▶ 마스킹 Evidence·정책·완료 run·과거 LLM 기록
FlowScopeWebServer :17777 ─▶ SnapshotJsonWriter ─▶ React / legacy UI
```

Burp는 호스트에서 실행하고 ZAP은 Desktop 또는 선택형 Docker로 준비한다. ZAP API 기본은 loopback `8089`, upstream은 Burp `8081`이다. LLM CLI와 MCP `8787` 리스너는 더 이상 기동하지 않는다. `8082`는 기존 직접 관측 source 분류만 남으며 `UNVERIFIED_RUNTIME`으로 분석·완료에서 제외한다.

Web 빠른 시작은 `범위 → HUMAN → ZAP → Evidence 검토`다. `FlowScopeExtension.startZapIntegration()`이 캠페인 한 개를 소유하며 Web 시작·조회·취소가 직접 호출한다. 데이터 교체/reset과 unload는 캠페인을 직접 정리한다. MCP adapter, Judge 잠금 callback, 독립 Explorer 상태 제약은 없다. scope·활성 run·세션·capability·crawler cleanup 경계는 유지한다.

선택형 `zap-up.sh` 또는 Windows `zap-up.ps1`은 같은 key helper를 사용하고, digest 고정 이미지의 ZAP Network API를 통해 `host.docker.internal:8081` upstream을 설정한 뒤 다시 읽어 검증한다. Linux는 Compose `host-gateway`, Docker Desktop은 공식 `host.docker.internal`을 사용한다. key 값은 container environment가 아니라 Compose file-backed secret으로 read-only mount한다. POSIX는 mode, Windows는 상속 차단·현재 SID 전용 ACL을 helper/doctor가 관리한다. FlowScope는 시스템 속성 key, 환경 key, 지정 key 파일, 기본 key 파일 순으로 읽으며 ZAP API URL 자체는 기존처럼 loopback만 허용한다. 이 편의 계층은 actual scanner capture·rendered crawl·대상 TLS를 완료로 대체하지 않는다(D-086, D-087, D-088).

- 소스 빌드는 JDK 21·Maven 3.9.x를 강제하고 Maven shade fat JAR을 만든다. `montoya-api`는 Burp 제공 scope다. Jackson·jsoup·SnakeYAML·Closure의 base class와 현재 또는 미래 MR-JAR 구현은 `io.flowscope.shaded` 아래로 격리하며, sqlite-jdbc는 JNI 이름을 깨뜨리는 relocate를 하지 않고 원 패키지를 유지한다. package는 의존성 NOTICE·라이선스를 보존하고 version 숫자와 무관하게 MR-JAR 경로를 결정적으로 relocation하며 source→target map을 기록한다. manifest-aware JAR 재구성과 `JarInputStream` gate로 streaming consumer에서도 Main-Class·Java-Version·Multi-Release를 읽을 수 있게 한다. 반복 SHA-256은 동일하게 고정한 build environment 안에서 검사하며 임의 JDK·운영체제 사이의 동일 해시를 주장하지 않는다(D-090/D-092/D-118).
- Burp `registerSuiteTab`에는 범위·포트·프로젝트 상태를 다루는 작은 Swing 제어판만 둔다. 그래프·매트릭스·상세의 정본은 시스템 브라우저에서 여는 번들 Web UI다.
- Web UI는 번들 Cytoscape.js를 사용하며 외부 CDN이나 원격 자원을 요청하지 않는다. JCEF·JavaFX는 배포물에 포함하지 않는다.
- source view는 HUMAN=파랑·실선·H, SCANNER=빨강·파선·S, LLM=검정·점선·L의 평행 Evidence로 표시하며 `identity → API`와 `API → object` 두 구간 모두 같은 source 문법을 유지한다. 0건 source는 비활성화하고 필터 변경 시 전체 경로를 다시 계산한다. `GraphObservationFact`는 coverage 대상마다 `Evidence, identity, service, operation, object, source, run, phase, status, hasResponse, HTTP outcome`을 보존한다. 사이트의 API group은 `api/rest/vN` 구조 segment를 제외한 첫 안정 경로 segment로 만든 표시용 `PATH_SEGMENT` 분류이며 판정이나 정규화 key로 사용하지 않는다. 사이트 개요의 source 수는 반복 요청 횟수가 아닌 고유 operation 수이며 전체 request 수는 상세에 별도 보존한다. graph level별 viewport를 분리해 사이트·API·객체 전환이 다른 화면의 pan/zoom을 오염시키지 않는다. object는 family로 먼저 접고 사용자가 눌렀을 때 인스턴스를 펼친다. operation 라벨은 `/` 경계를 우선해 줄바꿈하고, 900px 이하에서는 같은 필터 결과의 API 목록을 표시한다. 응답→요청 데이터 의존성은 메인 접근 그래프가 아니라 `흐름 순서`에서만 표시한다(D-043/D-061/D-076/D-077/D-084/D-104/D-106).
- 프록시 리스너는 Montoya가 생성하지 못하므로 사용자가 HUMAN 8080과 ZAP 8081을 만든다. 8082는 외부 LLM 클라이언트 호환 폴백이며 해당 관측은 `UNVERIFIED_RUNTIME`이라 결정적 판정에 쓸 수 없다.
- 캡처 콜백은 append만 하고 400ms worker coalescing으로 분석한다. live record는 20,000건에서 정지하며 초과 건수를 snapshot과 Web 경고로 노출한다.
- Web 서버도 `127.0.0.1`에만 bind한다. Host/Origin과 UI에 주입된 세션 capability를 검증하고 `no-store`, CSP, frame 차단 헤더를 보낸다. Burp 축소 JRE 호환을 위해 자체 `LoopbackHttpServer`를 재사용한다.
- 1초 snapshot은 그래프 메타데이터와 서버 판정만 전송하고 마스킹 Request/Response 전문은 선택한 operation에서만 `/api/evidence`로 200건씩 지연 로드한다. 반복 cluster의 ID 목록도 event마다 복제하지 않고 `/api/cluster-evidence`에서 200건씩 읽는다.

## 3. 데이터 모델

```text
RequestRecord {
  source, sourceDetail, orchestrator, tool, phase, runId,
  executionTrust, authState,
  service, method, path, query, reqBody, reqText, requestPayload,
  status, body, respText, responsePayload, location, hasResponse, timestamp,
  requestContentType, responseContentType, secFetchDest, secFetchMode,
  accessControlRequestMethod,
  fp, idn, role, op, resource, resourceReferences[], evidenceId, contentDigest,
  trafficClassification
}

RouteCandidate {
  service, method, pathTemplate, observed,
  provenance[{type, evidenceId, source, runId, adapter, applicability, reason}],
  applicability, reviewReason
}

SurfaceAnalysis {
  endpoints[EndpointFact {
    key(service, method, pathTemplate), deltaState,
    observedSources[], observations[evidenceId, source, runId, identity, status],
    declarations[evidenceId, source, runId, type, adapter, reason],
    parameters[location, fieldPath, displayName, requirement, observedShape,
               observedSources[], evidenceIds[], provenance[]]
  }]
}

RunExecutionLedger {
  attempts[sequence, source, runId, accountId, method, service, path,
           outcome, status, evidenceId, attemptedAt, durationMillis]
  outcome = HTTP_RESPONSE | TLS_FAILURE | DNS_FAILURE | TIMEOUT |
            CONNECTION_FAILURE | NO_RESPONSE | SCOPE_BLOCKED |
            APPROVAL_DENIED | INVALID_REQUEST | OTHER_FAILURE
  quality = NOT_ATTEMPTED | ALL_FAILED | PARTIAL_FAILURE | RESPONSES_OBSERVED
}
```

- `source`: 실제 대상 요청 생성자. ZAP은 지시자가 LLM이어도 SCANNER다.
- `orchestrator`: HUMAN/LLM/SYSTEM. source와 직교한다(D-036).
- `executionTrust`: `CONTROLLED/OBSERVED/UNVERIFIED_RUNTIME/IMPORTED/UNKNOWN`. `SourceTrustPolicy`가 분석과 run 완료 자격을 분리한다. HUMAN 완료는 OBSERVED/CONTROLLED, SCANNER 완료는 CONTROLLED가 필요하다. 과거 LLM 관측도 같은 데이터 의미를 보존한다. Judge용 가시성·dataset lock·최종 verdict 목적은 제거했다.
- `service`: scheme://host:port. op/resource/identity 경계를 서비스별로 분리한다.
- `fp`: JWT subject 이름공간 또는 opaque token/cookie 단방향 지문. raw 인증값을 저장하지 않는다. 쿠키 fingerprint는 계정 연결·감사를 위한 안전한 식별자이지 로그인 증명이 아니다.
- `authState`: `ANONYMOUS/ACCOUNT_BOUND/UNRESOLVED`. 명시적 계정 연결이나 memory-only broker의 exact credential match만 `ACCOUNT_BOUND`가 된다. 계정에 연결되지 않은 cookie/session fingerprint는 서비스별 하나의 `UNRESOLVED` 그래프 신원으로 안정화하되 원 fingerprint는 Evidence에 남긴다.
- `requestPayload/responsePayload`: 저장 전 구조 마스킹된 전문의 SHA-256, byte 수, 보존 상태와 선택적 GZIP이다. 메시지당 기본 1MiB 이하 textual이며 digest 중복 제거 후 압축 전문 총량 48MiB 안에 있을 때만 `FULL`이다. binary, 메시지별 상한 초과, 압축 총량 상한 초과는 서로 다른 metadata-only 사유를 남긴다. 상한 초과 live 메시지 식별자는 일반 최대 64KiB, 발견용 MIME 기본 최대 4MiB의 제한된 마스킹 표현·실제 byte 수·보존 사유를 길이 구분해 digest하므로 같은 접두부의 다른 크기를 구분하지만 원문 전체 checksum은 아니다. 8,192자 `reqText/respText/body`는 UI preview이며 전문과 같은 필드가 아니다.
- `resourceReferences`: path/query/body/GraphQL에서 실제 값으로 관측된 모든 객체 참조와 `PATH_ID/QUERY_ID/BODY_ID/GRAPHQL_VARIABLE/*_SEMANTIC_FIELD_CORROBORATED` 근거다. `resource`는 기존 인가 cell의 보수적 primary 하나다.
- `trafficClassification`: `API/AUTH_SESSION/NAVIGATION/STATIC_ASSET/DISCOVERY_METADATA/PREFLIGHT/TELEMETRY_CANDIDATE/POLLING/BACKGROUND/UNKNOWN`, `INCLUDE/EXCLUDE/REVIEW`, 근거와 사용자 override를 가진 비파괴 파생값이다. `INCLUDE`만 coverage/graph 입력이며 `REVIEW`와 `EXCLUDE`도 Evidence에서는 삭제되지 않는다.
- `RouteCandidate`: 응답 없는 Burp Site Map 항목 또는 저장된 exact-scope 응답에서 추출한 경로다. provenance는 type과 Evidence ID를 따로 모은 집합이 아니라 `type ↔ evidenceId ↔ source ↔ runId ↔ adapter ↔ applicability/reason`의 대응 관계로 보존한다. 실제 request/response 전에는 identity, coverage, verdict, finding을 갖지 않는다.
- `SurfaceAnalysis`: 저장된 Evidence와 `RouteCandidate`에서 결정론적으로 재생성하는 값 없는 projection이다. Observation은 실제 request의 endpoint, parameter 위치·field path·shape와 source/run/identity/status/Evidence ID를 보존한다. Declaration은 OpenAPI·HTML form·정적 JavaScript·route provenance에서 직접 확인한 endpoint/parameter만 보존한다. `DECLARED_NOT_OBSERVED`, `ONE_SOURCE_OBSERVED`, `MULTI_SOURCE_OBSERVED`, `ALL_SOURCES_OBSERVED`, `OBSERVED_NOT_DECLARED`는 작업목록 상태이며 취약점·도달성·lane 완료 판정이 아니다. 별도 DB 정본을 만들지 않으며, Web 직렬화는 동일 revision·동일 입력의 projection을 재사용하고 입력 revision이 바뀌면 다시 계산한다(D-113).
- `AccountProfile`: 서비스별 테스트 계정의 내부 ID·표시 이름·확정 역할만 저장한다. 로그인 ID·비밀번호·토큰은 받지 않는다.
- `sessionBindings`: `(service, fingerprint) → accountId`의 사용자 명시 연결이다. 키 하나는 계정 하나에만 귀속되며, 이미 연결된 지문을 다른 계정으로 옮기려면 먼저 기존 연결을 해제해야 한다. 실제 비인증 `anon`과 추출 실패 `unresolved`는 계정에 연결할 수 없다. 자동으로 합칠 수 없는 회전 세션을 검증된 계정 단위로 정렬한다.
- Cookie·Authorization·subject fingerprint는 한 principal 안의 기술 단서이지 로그인 세션 개수가 아니다. 기본 권한 카드는 principal을 한 줄로 표시하고 단서 종류·개수는 계정 화면의 접힌 진단에서만 보여 준다.
- `SessionBroker`: 사용자가 Web UI에서 명시적으로 시작한 HUMAN 로그인 구간의 Cookie/Authorization/CSRF만 프로세스 메모리에 보관한다. 자격증명 material만 관측하고 성공 응답을 확인하지 못하면 `UNVERIFIED`, 401·로그인 redirect·invalid token이면 `SUSPECT`, 비밀 삭제/만료면 `REAUTH_REQUIRED`다. account service와 exact scope가 모두 맞고 상태가 `ACTIVE`일 때만 ZAP·HUMAN Request Lab 요청에 주입한다. HUMAN pass의 계정 선택은 표시 힌트가 아니라 검증 조건이며, 실제 요청 자격증명이 그 broker 계정과 exact match할 때만 계정 신원으로 귀속한다. 다른 계정이 같은 service에서 동시에 캡처되는 것을 거부한다. 캡처 중 동일 지문이 다른 계정에 이미 연결된 사실을 확인하면 현재 세션을 `SUSPECT` 충돌 상태로 고정하고 신원 귀속·주입에서 제외한다. raw 값은 UI snapshot/project에 나오지 않는다.
- `evidenceId`: 전체 의미 내용 digest 기반 ID. digest 입력은 외부 값의 개행과 필드 경계가 충돌하지 않도록 null 표식과 UTF-8 byte 길이 접두 framing을 사용한다. beta.23 이하 newline digest가 일치하면 기존 Evidence ID를 유지한 채 새 digest로 이행한다. 프로젝트 왕복에서는 `contentDigest`가 일치할 때만 기존 ID를 보존하고, 동일 관측은 순서 suffix로 유일화한다.
- `owner`: 노드가 아니라 resource 속성이다(D-006). 명시적 본문 필드나 사용자 확정만 판정 근거가 된다.

논리 프로젝트 schema v4는 마스킹된 RequestRecord, digest별 한 번 저장되는 GZIP 전문 blob, provenance가 있는 RouteCandidate, 계정·세션 지문 연결, role/requirement/owner 정책, operation별 traffic override, classifier version, 과거 `LegacyAssessment`와 `ValidationDecision`, Evidence-bound 사람 감사 기록, **완료된 정확한 run**과 bounded `RunExecutionLedger`를 저장한다. 실행 원장은 query·header·body·raw exception 없이 method·service·path와 typed outcome만 보존하며 실패를 RequestRecord/Evidence로 승격하지 않는다. 완료 run은 source만 저장하지 않고 `source/runId/detail/orchestrator/tool/phase/account/completedAt/evidenceIds/responseCount/coverageCount`를 묶는다. 기본 내구 저장은 SQLite storage schema v3의 기존 관계형 테이블, `completed_runs`, `run_attempts`이며 JSON schema v4 codec을 공통 검증 경계로 재사용한다. `.flowscope.db`를 처음 저장하거나 열면 이후 revision을 30초 checkpoint로 합쳐 임시 DB에 transaction으로 쓴 뒤 atomic replace하고 정상 unload 직전 마지막 저장을 시도한다. `.flowscope.json` schema v1/v2는 source-only `completed_lanes`를 완료 자격으로 복원하지 않으며 schema v3 exact completed run은 유지한 채 실행 원장은 빈 값으로 마이그레이션한다. v4 내보내기는 exact completed run과 중복 표시용 `completed_lanes`의 일치를 검증한다. raw broker 세션은 어느 형식에도 저장하지 않는다. 전문은 메시지당 1MiB, 서로 다른 복원 전문 합계 48MiB 안에서 streaming GZIP 해제하며 digest/size/retention을 검증하고 동일 digest는 한 번만 복원한다. metadata-only 항목은 압축 blob을 허용하지 않는다. 로드한 assessment/validation은 기존 ID와 생성 시각을 유지하는 읽기 전용 기록이며 현재 판정으로 재승인하지 않는다. 분류는 현재 결정론 classifier로 재계산한다. 파일은 100MiB 상한과 가능한 POSIX 0600을 적용한다. 이 SQLite 계층은 현재 20,000건 메모리 pipeline의 내구 snapshot이지 append-only server event store가 아니다(D-049/D-050/D-052/D-054/D-059/D-073/D-075/D-099/D-101/D-116).

- 실행 원장 보존 상한은 5,000개 시도이며, 반복 polling되는 Web snapshot에는 최근 100개 run의 집계만 노출한다.

## 4. 파이프라인

### 4.1 수집·마스킹 F-01~03/F-22

beta.34 live 경계는 Montoya byte 길이를 먼저 확인한다. 요청 1MiB·응답 4MiB를 넘으면 전체 Java 배열을 만들지 않고 크기만 raw vault에 전달하며, 저장 상한 1MiB를 넘는 메시지는 일반 64KiB, 발견용 응답 MIME(JavaScript/JSON/HTML/XML)은 D-122의 기본 4MiB까지 제한 복사해 decode·mask한다. 다만 현재 `recordFrom()`가 `body/respText`를 8,192자로 다시 자르므로, metadata-only 응답을 route/Surface까지 4MiB로 전달하는 연결은 완료되지 않았다. 캡처 helper와 parser의 개별 회귀를 전체 live 경로 검증으로 확대하지 않는다. 따라서 아래 `byte[]` 원문 보존은 각 raw 상한 이내 메시지에만 해당한다(D-101).

Proxy request handler가 listener port source를 보존하고 SCANNER/LLM의 범위 밖 요청을 송신 전에 차단한다. Proxy와 `Http.registerHttpHandler`가 받는 Repeater·Intruder·Target 등 비-Proxy Burp 도구는 각각 요청 `messageId`에 요청 시점 run/account/login-capture 문맥과 dataset epoch를 임시 보관하고 응답에서 한 번 소비한다. 따라서 HUMAN pass 종료 뒤 늦게 도착한 응답도 시작 당시 provenance로 귀속하고, 초기화·샘플 교체·프로젝트 열기 전 요청은 새 데이터셋에 들어오지 않는다. 상관 문맥이 없으면 응답 시점 context로 추측하지 않고 제외한다. in-flight 문맥은 채널별 20,000건·10분 상한을 두며 원 인증값이나 요청 전문은 이 상관 테이블에 저장하지 않는다. HUMAN 브라우저의 범위 밖 이동 자체는 막지 않지만 response capture 직전에 모든 source를 현재 exact scope로 검사하므로 범위 밖 응답은 저장·그래프화하지 않는다. 정상 수집된 비-Proxy HUMAN 응답도 broker에 전달해 같은 계정의 쿠키 회전을 반영한다. 사용자가 요청하면 기존 Proxy history도 원래 listener·시각·최종 요청·응답으로 가져오되 scope 밖 item을 제거한다. 재가져오기는 관측 횟수를 보존하는 multiset 병합으로 이미 반영된 사본만 제외한다. Authorization/Cookie/Set-Cookie와 password/token/secret/api-key류는 header와 JSON/form/multipart/XML 구조를 따라 저장 전에 마스킹한다. 마스킹된 textual 전문은 메시지당 기본 1MiB, digest 중복 제거 후 압축 총량 48MiB까지 GZIP으로 보존하고 8,192자 preview를 별도로 유지한다. binary·메시지별/총량 상한 초과 전문은 크기·bounded 식별자·사유만 보존해 잘린 내용을 완전 Evidence처럼 쓰지 않는다. Burp XML도 같은 보존 정책을 적용하며 XXE를 차단하고 불완전 item을 이유와 함께 skip한다. ZAP HAR 1.2 폴백은 `log.entries`의 request/response를 `SCANNER/HAR_IMPORT/ZAP/IMPORT/IMPORTED`로 변환하고 동일 scope·마스킹·payload 상한을 적용한다. `status=0`은 응답 없는 후보로 보존하고 binary base64 응답은 문자열로 왜곡하지 않고 metadata-only로 둔다. HAR에는 ZAP Alert와 campaign completion 계약이 없으므로 둘을 생성하지 않는다(D-093).

live HTTP 원문은 별도의 `TransientExchangeVault`에 요청·응답 `byte[]`와 각각의 body offset으로만 둔다. 요청 1MiB, 응답 4MiB, 총 32MiB 기본 상한과 오래된 항목 우선 제거를 적용하고 초기화·샘플 교체·프로젝트 열기·확장 종료 시 지운다. 이 값은 `RequestRecord`, snapshot, SQLite/JSON, 로그로 전달하지 않으며 사용자가 특정 Evidence의 요청 실험실을 열었을 때만 localhost capability API가 표시용 텍스트를 만든다. 헤더는 ISO-8859-1, textual 본문은 명시된 Content-Type charset 또는 기본 UTF-8로 replacement 없이 엄격히 디코딩한다. 바이너리, 알 수 없는 비텍스트, 잘못된 byte sequence는 원문 바이트는 유지하되 Web 텍스트 편집·전송을 차단한다. 수정하지 않은 요청과 Repeater 초안은 원래 바이트를 그대로 사용하며, 실제 편집한 본문만 선언 charset으로 엄격히 재인코딩한다. Java `String`과 HTTP/browser 복사본은 완전한 메모리 소거를 보장하지 못하므로 이를 영구 비밀 저장소로 표현하지 않는다. 가져온 프로젝트/XML/HAR, 상한 초과 Evidence에는 raw가 없어 마스킹 전문만 표시하고 Web 전송은 허용하지 않는다(D-084/D-093).

HUMAN 로그인 캡처 구간은 `SESSION_SETUP`, 명시적 HUMAN pass는 `EXPLORATION`, pass 밖의 일반 HUMAN 관측은 `BASELINE`으로 보존한다. `SESSION_SETUP`/`BASELINE` HUMAN Evidence는 저장과 감사 대상이지만 discovery coverage·3-way gap·그래프 입력은 아니다. 로그인 준비와 우연한 scope 내 이동이 HUMAN 탐색 성과로 계산되지 않게 하려면 사용자가 HUMAN pass를 시작·종료해야 한다. Web은 `/api/human-run`을 다른 실행 상태와 함께 주기적으로 동기화하며, `pass 완료`는 record 수가 아니라 exact exploration run의 조건부 종료 표식으로만 표시한다. pass 중 Repeater·Intruder·Target에서 발생한 HUMAN 요청은 run/phase/account 문맥을 공유하지만 `BURP_REPEATER/BURP_INTRUDER/MANUAL_HTTP` detail과 `BURP` tool을 브라우저로 덮어쓰지 않는다.

Web 요청 실험실은 관측 Evidence의 HTTP 전문을 큰 편집기에서 열고 원래 `HttpService`에만 보낸다. 화면에는 관측 신원과 현재 재사용 가능한 등록 계정 세션을 별도 필드로 표시한다. 요청 path가 현재 exact scope 밖이면 전송 전에 거부하고 redirect는 `NEVER`, upstream TLS 검증과 30초 응답 상한을 유지한다. `ORIGINAL`은 사용자가 편집하지 않았다면 원문 바이트를 그대로 사용하고, 편집했다면 선언 문자셋으로 재구성한다. `ANONYMOUS`는 broker 관리 인증 헤더를 제거하며, `ACCOUNT`는 먼저 동일 헤더를 제거한 뒤 선택한 ACTIVE 계정의 현재 값을 주입한다. 기존 `Content-Length`는 Montoya가 계산한 실제 body byte 길이에 맞춘다. 결과는 `source=HUMAN`, `detail=MANUAL_HTTP`, `tool=BURP`, `phase=VALIDATION`, `executionTrust=CONTROLLED`로 새 Evidence가 되며 immutable discovery gate가 coverage·gap 성과로 계산하지 않는다. 화면 전송 이력은 탭 메모리 10건뿐이고 저장하지 않는다.

beta.33부터 요청 실험실은 Evidence를 열 때마다 generation을 올려 늦게 도착한 이전 초안을 폐기하고, 전송 중에는 Evidence 변경·요청 편집·인증 모드·계정·닫기·재전송을 잠근다. 각 전송은 난수 operation ID를 가지며 localhost 서버는 `Evidence ID + 요청 전문 + 인증 모드 + 계정`의 길이 프레이밍 SHA-256이 같은 중복만 최초 결과로 합치고, 같은 ID의 다른 요청은 거부한다. 서버 응답을 받지 못한 경우 같은 탭의 동일 draft에 한해 operation ID를 재사용하고, 입력 또는 Evidence가 바뀌면 새 작업으로 취급한다. 캐시에는 요청 원문이나 전체 응답을 남기지 않고 compact 결과만 최대 256건 유지한다. 분석 publish는 별도 epoch를 사용해 입력 변경 뒤 끝난 오래된 pipeline 결과가 초기화·검증 Evidence·최신 정책 snapshot을 덮지 못하게 한다(D-100).

### 4.2 정규화 F-04~06

- 원본 `path/query/request/response`는 바꾸거나 삭제하지 않는다.
- operation 경로 변수화는 관측 묶음 전체에서 수행한다. UUID·16자 이상 hex는 형식 근거, 2xx JSON 응답의 `id` 또는 부모명 기반 `*Id`가 경로 값과 정확히 같으면 응답 근거, 같은 service·구조·위치에서 서로 다른 값 또는 source/run/method가 다른 관측이 반복되면 추론 근거다.
- 근거가 없는 단일 숫자 세그먼트는 operation에서 literal로 유지한다. 예: 단일 `/status/200`은 `/status/{id}`로 바꾸지 않는다. 근거가 모이면 `/orders/101`, `/orders/202`를 `/orders/{id}`로 자동 정렬한다.
- 객체 후보와 operation template은 분리한다. 단일 `/orders/101`도 `orders:101` 객체 후보는 보존하되, template 근거가 없으면 operation label은 literal이다. 이 분리로 보수적 묶음이 인가 객체 탐지를 지우지 않게 한다.
- 각 관측은 `LITERAL/INFERRED/CORROBORATED`와 범주형 이유를 가진다. UUID/긴 16진 형식은 추론일 뿐 확정이 아니며, 성공 응답의 정확한 ID 일치만 별도 Evidence로 보강한다. 확률·고정 confidence는 만들지 않는다. 같은 service/구조 안의 근거만 다른 method에 전파하며 서비스 경계를 넘지 않는다.
- 전체 부모 체인을 resource에 보존한다.
- 명시적 query/body `id`, camel-case `*Id/*Ids`, snake/kebab `*_id/*_ids`를 JSON 중첩 객체·배열, XML, multipart에서 모두 수집한다. 소문자 일반 단어의 단순 `endsWith("id")`는 사용하지 않아 `guid/valid/fluid`를 강한 ID로 오인하지 않는다. 추가로 query·JSON/form body의 `*No/*Number/*Seq/*Key/*Ref/*Uuid/*Guid/*Vin`은 이름만으로 객체화하지 않고 같은 service·method·raw path·field 위치에서 서로 다른 값이 둘 이상 관측될 때만 semantic object reference로 보강한다. `pageNo`, `sortKey`, API/auth/token/session류와 마스킹·과대 값은 제외한다. 여러 참조는 모두 Evidence로 노출하지만 기존 인가 분석은 첫 근거 참조 하나만 primary로 사용해 적용 가능성이 증명되지 않은 객체 조합을 만들지 않는다. 이 규칙은 도메인 schema나 소유권을 증명하지 않으며 블라인드 corpus에서 별도 평가한다.
- GraphQL은 `POST /graphql#operationName`으로 분리한다.
- identity는 service + fingerprint로 시작한다. JWT iss/aud/sub는 서명 미검증 그룹핑 힌트일 뿐 인증 증거가 아니다(D-034). 계정 연결 없는 쿠키 fingerprint는 모두 같은 계정으로 합치는 대신 서비스별 `UNRESOLVED` 그래프 신원으로만 접어 세션 회전 노이즈를 막고, 원 fingerprint는 연결 후보로 보존한다.
- 정규화 뒤 사용자가 확인한 session binding을 적용한다. 다른 service의 계정과 세션은 연결할 수 없다.

### 4.3 비파괴 분류·관측 접기

분류기는 경로 이름 하나로 삭제하지 않는다. HTTP 메서드, 실제 응답 유무, Fetch Metadata, request/response Content-Type, CORS preflight 헤더, 객체 신호, 상태·redirect, source와 phase가 함께 맞는 경우에만 coverage에서 제외한다.

- 실제 preflight는 `OPTIONS`와 `Access-Control-Request-Method`가 함께 있을 때만 `PREFLIGHT/EXCLUDE`다. 일반 OPTIONS API는 유지한다.
- 안전 메서드의 Fetch destination/MIME 또는 확장자/MIME가 함께 맞을 때만 `STATIC_ASSET/EXCLUDE`다. 객체·login redirect·JSON/API 문맥 등 독립 보안 신호가 있으면 API 분석이 우선한다. 다른 API 근거 없이 401/403만 있는 경우는 `UNKNOWN/REVIEW`로 보존한다.
- document/iframe + HTML navigation은 `NAVIGATION/EXCLUDE`지만 보안 신호가 있으면 유지한다.
- telemetry 명칭은 단독 제외 근거가 아니며 `TELEMETRY_CANDIDATE/REVIEW`로 남긴다.
- response 없는 관측, source `UNKNOWN`, `VALIDATION/COACH_PROBE`는 discovery coverage에서 제외하지만 Evidence는 보존한다.
- HUMAN `SESSION_SETUP` 및 `BASELINE`은 로그인 준비·pass 밖 관측이므로 discovery coverage에서 제외하지만 Evidence는 보존한다.
- 같은 신원/run/phase/method/operation/resource/query/body/status-class/response/location의 반복만 표시 cluster로 접는다. 분석 입력과 Evidence ID는 삭제하거나 합치지 않는다.
- 애매한 것은 `UNKNOWN/REVIEW`로 Evidence와 검토 대기에 남기되 메인 coverage·graph·3-way gap에는 넣지 않는다. 사용자는 operation 단위로 `INCLUDE/EXCLUDE/AUTO`를 되돌릴 수 있지만 no-response, unknown source, HUMAN 비탐색 구간, `VALIDATION/COACH_PROBE`라는 discovery 신뢰 경계는 override할 수 없다.

classifier v5는 web manifest·source map·service worker를 `DISCOVERY_METADATA/EXCLUDE`로 분리하고 exact `/manifest.json` 경로를 보조 근거로 추가한다. 같은 service·정규화 operation에 강한 비사용자-override `API/INCLUDE` Evidence가 있고 immutable discovery gate를 통과할 때만 애매한 형제 record를 API로 교차 보강한다. API 문맥 없는 401/403 상태는 `AUTHORIZATION_RESPONSE_ONLY` 근거의 `REVIEW`로 남겨 scanner probe를 메인 그래프와 결함시키지 않는다(D-106).

route inventory는 다음 공통 파이프라인을 사용한다(D-069).

```text
저장 Evidence / Burp seed
  → RouteDiscoveryDocument(service, path, media, body, location, evidence, source, run)
  → format adapter(HTML / JavaScript AST / Next pages manifest / OpenAPI JSON·YAML / metadata / generic XML)
  → DiscoveredRoute(raw reference, method proof, provenance, reason)
  → common core(exact scope → method validation → URI/path normalization → dedup/provenance merge)
  → RouteCandidate
```

어댑터는 네트워크를 사용하거나 scope·관측 여부를 결정하지 않는다. 공통 코어만 unsupported scheme과 범위 밖 참조를 버리고, 명시적 method 근거가 없으면 `UNKNOWN`으로 유지하며, `service + method/UNKNOWN + normalized path`로 병합한다. 관측된 `GET`과 같은 path의 미관측 `UNKNOWN`은 서로 다른 후보이고, `UNKNOWN`을 관측으로 승격하지 않는다. HTML은 로컬 HTML5 DOM 파서로 깨진 markup과 `<base>`를 처리하고, OpenAPI는 대상 응답에서 관측한 JSON/YAML만 읽으며, XML은 제품명 없는 명시 URL/method 필드만 XXE 차단 DOM으로 읽는다. 추출된 후보는 관측 분석 파이프라인에 다시 넣지 않는다.

### 4.4 Endpoint·Parameter Surface Delta

`SurfaceAnalyzer`는 Pipeline의 판정 입력을 바꾸지 않는 별도 projection이다.

```text
allRecords ──▶ OpenAPI·HTML·JavaScript AST 선언 추출 ─┐
coverageRecords ──▶ 실제 endpoint·입력 관측 ──┼─▶ SurfaceAnalysis ─▶ Web 기본 작업목록
routeCandidates ──▶ provenance·미요청 route ──┘
```

- endpoint key는 `service + method + canonical path template`, parameter key는 `endpoint + PATH/QUERY/JSON_BODY/FORM_BODY/MULTIPART_BODY/GRAPHQL_VARIABLE + fieldPath`다.
- 요청 값은 저장하지 않고 shape만 남긴다. source/run/identity/status와 Evidence ID는 Observation에 유지한다.
- OpenAPI/Swagger local `$ref`, HTML form control, JavaScript AST가 직접 확인한 `fetch`·XHR·axios·jQuery·`sendBeacon`의 URL/method/query/body key만 Declaration으로 만든다. lexical scope의 불변 literal·object member, template literal·단순 결합과 axios instance의 정적 `baseURL`/요청별 override를 처리하지만 재할당, 임의 wrapper 의미, 일반 data flow, 난독화 값은 추정하지 않는다.
- 정적·dynamic import와 HTML script/modulepreload/preload/prefetch는 후속 분석할 client asset 후보로 유지하되 API surface로 세지 않는다. Next.js pages-router build manifest adapter도 route key를 API로 오인하지 않고 chunk 참조만 만든다.
- GraphQL HTTP 요청은 `path#operationName` endpoint와 `variables` field를 관측하며 `query`·`operationName` transport 필드는 입력 surface에서 제외한다. introspection/schema declaration은 아직 없다.
- 타깃 host와 업무명은 분기 조건이 아니다. 프레임워크 adapter는 공개 산출물의 명시 구조를 읽을 때만 route discovery 뒤에 붙고 공통 fact schema나 판정 코어를 바꾸지 않는다.
- `surface.extractions`는 HTML/OpenAPI/JavaScript 산출물별 `PARSED/PARTIAL/FAILED/LIMIT_EXCEEDED`, 파서 실패 범주, typed call-site resolution issue, Evidence ID·line과 추출 수를 보존한다. 문법 파싱 성공과 모든 call-site 해석 성공을 같은 상태로 취급하지 않는다.
- 선언 미관측은 다음 검토 위치이며 coverage gap이나 취약점이 아니다. 서버에만 있는 표면은 알 수 없다고 표시하고 전체 퍼센트를 만들지 않는다.
- 내부 `Resource`와 owner는 이 projection에서 삭제하지 않고 인가 상세층에 유지한다. 사용자 화면에서는 의미가 불명확한 `객체` 대신 `접근 대상 ID`로 표시한다. 따라서 Surface UI 변경이 기존 BOLA/BFLA 후보·Evidence 계약을 바꾸지 않는다.

세부 계약과 held-out 평가 기준은 `endpoint-parameter-surface.md`, 기본 projection 결정은 D-113, AST·adapter 경계는 D-114를 따른다.

### 4.5 소유자·판정 F-10~11

소유자 우선순위는 사용자 확정 → **성공한 2xx 비메타데이터 응답 본문**의 명시적 owner/user/account 필드 또는 같은 이름의 중첩 principal 객체 → 저신뢰 first-success다. 401/403·redirect·soft deny와 OPTIONS/HEAD의 owner 필드는 소유권 근거로 쓰지 않는다. 공격자가 조작 가능한 요청 본문과 문맥 없는 임의 email/id 필드도 제외한다. 저신뢰나 충돌은 미확정이므로 취약 판정에서 제외한다.

판정은 status 단독이 아니라 status taxonomy + redirect + soft deny + owner + response content + role policy를 결합한다.

- 2xx + 자기 소유: allow.
- 401/403, 로그인 redirect, soft deny: deny.
- 404/429/5xx 또는 해석 불가: undecided.
- 비소유 write 2xx: body가 비어도 suspicious.
- 비소유 read 2xx: 응답이 대상 객체 ID를 구조적으로 포함할 때 suspicious, owner 문자열만 있거나 객체 ID가 없으면 undecided.
- role이 endpoint requirement보다 낮은데 성공: BFLA suspicious.
- OPTIONS/HEAD: owner 성공 증거에서 제외.

응답 객체 오라클은 generic `id/uuid/guid/pk` 또는 **최종 자원 타입에 한정된** `orderId/order_uuid/orderNo/orderSeq` 같은 필드의 scalar 값이 대상 ID와 정확히 같을 때만 노출 근거로 쓴다. `orders:101/items:5`에서는 item 5만 대상이며 부모 order 101만 보인 응답은 근거가 아니다. JSON soft deny는 최상위 `error/errors/message/detail/title/reason` 오류 봉투만 읽으므로 정상 도메인 데이터 안의 `not allowed` 문자열을 거부로 뒤집지 않는다. 비 JSON 오류는 앞 2,048자만 검사한다.

객체·소유자·DataFlow 응답 판독은 1,000,000자, JSON 깊이 128, token/node 100,000의 공통 상한에서 반복 순회한다. DataFlow의 malformed/non-JSON fallback은 앞 64KiB와 응답당 1,000개 값으로 제한한다. 생성 값은 신원+값 exact-token index에 넣고 path/query/request body의 동일 token이 뒤 요청에서 관측될 때 가장 가까운 이전 producer 하나와만 연결한다. index는 전체 최신 100,000 value까지만 유지해 오래된 항목부터 축출한다. 부분문자열·request 전문 전체 검색과 모든 producer/consumer 중첩 순회는 사용하지 않는다. 이 링크는 명시 토큰 재사용의 관측 근사치이며 축출된 오래된 값, 숨은 상태 전달이나 인과관계를 증명하지 않는다. 상한 초과는 취약 또는 정상으로 확정하지 않고 근거 없음/보류로 남긴다.

role/requirement는 자동추정하지 않고 사용자가 지정한다(D-018).

### 4.6 비교·그래프 F-07~15/F-20~24

CoverageCell 키는 `(identity, operation, resource)` tuple이다. 일반 기존 셀은 finding/review ID 호환을 위해 기존 stable key를 유지하고, 외부 입력에 `|` 또는 실제 `<none>` 값이 있는 셀만 `v2` byte 길이+hex framing을 써 충돌을 막는다. 소스별 5-state verdict를 보존하고 다음 갭을 계산한다.

- UNCROSSED: 확정 소유자가 있는 관측 operation/resource를 다른 관측 identity가 시도하지 않음.
- PARTIAL_DISCOVERY: 활성 소스 중 일부만 같은 cell을 실행.
- CONFLICT: 같은 cell의 소스 verdict가 다름.

데이터 Flow 엣지는 같은 identity에서 이전 응답의 ID/token이 30분 안의 뒤 요청 path/query/body에 실제 소비될 때만 만든다. 단순 시간순 엣지는 만들지 않는다(D-019). 현재 소비 판정은 identity+exact-token index의 최근 producer 조회이며 모든 producer/consumer 쌍을 비교하지 않는다. semantic taint나 인과관계 증명은 아니며 우연한 동일 값·미관측 값·index 축출의 한계는 남는다.

### 4.7 세션·ZAP 실행과 과거 LLM 데이터

`SessionBroker`의 명시적 HUMAN 캡처와 ACTIVE 계정 주입을 유지한다. `LaneCompletionPolicy`는 HUMAN/ZAP 완료 시 동일 source·run·EXPLORATION·응답·trust를 검사하고 Evidence ID를 저장한다. 과거 프로젝트의 완료 run도 기존 검증 codec으로 읽는다.

기존 `McpServer`, `LocalMcpToken`, `LocalLlmRunner`, `ControlledBrowserExplorer`, `RouteCandidateViews`와 agent-workspace를 삭제했다. `/api/llm-run`, `/api/ai-preview`, `/api/ai-scenarios`는 404이며 코드·JAR에 대체 stub 실행기는 없다. Web이 사용하는 `LoopbackHttpServer`, JSON·SQLite 저장, `RunExecutionLedger`와 Source/Tool/Phase enum은 데이터 호환 때문에 유지한다.

`LegacyAssessment`는 기존 assessment 필드·마스킹·상한을 유지하는 독립 데이터 타입이다. Snapshot의 `legacyLlm={readOnly,assessments,validations}`에 날짜·Evidence ID와 함께 기록하고 현재 `scenarios`에 합치지 않는다. 과거 assessment ID로 새 `/api/review`를 제출할 수 없다. 현재 규칙 finding의 사람 검토는 계속 허용한다. 실행 원장은 과거 기록이며 새 Explorer 요청을 발생시키지 않는다.

- 기본 ZAP 캠페인은 `orchestrator=SYSTEM`이다. 시작 전에 ZAP version API, `network`를 포함한 안전 add-on, outgoing proxy enabled와 Desktop `127.0.0.1:8081` 또는 Docker `host.docker.internal:8081`을 확인하고, 누락·불일치 시 대상 트래픽 전에 실패한다. Web에서 비로그인과 복수 ACTIVE 계정을 선택하면 비로그인 → 선택 계정 순으로 실행하며, 각 신원 앞에서 ZAP `core/newSession`을 호출해 crawler/cookie 상태를 분리한다. 운영자가 이미 알고 있는 OpenAPI·GraphQL·Postman·SOAP 정의를 최대 20개 명시하면 URL·GraphQL endpoint를 exact scope로 검증하고 fresh Context 안에서 정의별 최대 1,000 message의 동기 import를 먼저 실행한다. 이름 기반 URL 추측은 하지 않는다. 이어 passive scanner 활성화 → 전체 passive rule 활성화 → scope-only 설정 → Traditional Spider → strict Client Spider → AJAX Spider → Passive 분석 → native Alert 전 페이지 수집 순서를 고정한다. Client와 AJAX의 결과 집합이 완전히 같다고 가정하지 않으므로 둘 다 실행한다. 정의 import와 rendered crawler 실패는 다른 Evidence를 버리지 않고 lane warning으로 보존한다. Passive는 절대 30분, `recordsToScan` 감소가 없는 정체 10분을 경계로 추적한다. task/URL 변화는 표시용이며 정체 시간을 초기화하지 않는다. 정체나 절대 제한에 도달하면 현재까지의 Alert를 먼저 snapshot하고 `passive_complete=false`, 남은 queue와 현재 task를 공개한 `COMPLETED_WITH_WARNINGS`로 보존한다. 이어 `clearQueue` 뒤 queue 0과 current task 0을 모두 확인해야 다음 신원을 시작하며, 확인하지 못하면 후속 lane은 `NOT_RUN/BLOCKED_BY_ISOLATION`이다. Passive 단계 전 실패도 다음 신원이 있으면 같은 queue/task 정리 검증을 통과해야 하며 실패하면 후속 lane을 차단한다. 완료 gate와 stage count는 400ms debounce가 있는 분석 `Pipeline.Result`가 아니라 응답 callback이 추가한 raw record 저장소를 `source + runId + sourceDetail`로 센다. 신원별 전체 capture가 0이면 캠페인을 실패시키고, Alert API는 500개씩 반복 호출해 캠페인 전체 최대 20,000개 상세를 메모리 snapshot에 보존한다. LLM이 scanner 단계를 고르지 않는다. 상태 계약은 campaign/lane/stage 시작 시각과 세션 설정 1분·API 정의 한 건당 2분·Traditional 15분·Client 20분·AJAX 20분·Passive 30분 제한, 매 status poll heartbeat, 마지막 raw capture/status 변화, queue 순번·대기 이유, Passive 남은 수·현재 task와 Alert snapshot 완결성을 메모리에서 추적한다. 실제 단계 전환·Passive 감소·Alert 집계·격리 정리는 비밀 마스킹된 이벤트 최대 120건의 current-process 목록으로 남기고 Web이 1초마다 조회한다. heartbeat 10초 초과, 응답 정상이나 새 트래픽 30초 초과, 단계 deadline 초과를 서로 다른 운영 상태로 내보내며 이는 scan 성공이나 취약점 verdict가 아니다.
- D-108은 위 기본 캠페인의 종료·귀속 계약을 강화한다. `network`와 함께 `replacer` add-on을 필수 확인하고, D-124에 따라 캠페인마다 전체 exact scope 항목과 선택 target의 union에 적용되는 ZAP Replacer rule로 무작위 `X-FlowScope-Scanner-Capability`를 붙인다. Burp 8081 handler는 활성 SYSTEM run ID와 capability가 모두 일치할 때만 broker 세션을 주입하고 `CONTROLLED` ZAP Evidence로 수집하며 capability 헤더는 대상 전송 전에 제거한다. native Burp Scanner와 capability 없는 8081 수동 요청은 활성 ZAP context를 상속하지 않는다. D-109는 capability 없는 요청을 run별로 계수해 상태 API에 노출하고 crawler polling 중 한 건이라도 확인되면 다음 crawler·신원으로 진행하지 않도록 한다. 허용 fallback은 두지 않는다. 각 Evidence는 `runId`와 별개로 `laneAccountId`를 보존해 캠페인의 마지막 계정으로 전체 결과를 대표하지 않는다.
- Traditional·Client·AJAX stop API는 호출 성공만으로 정리를 확정하지 않는다. 소유 scan이 terminal 상태가 될 때까지 bounded poll하고, 확인 실패 시 다음 stage/identity를 차단한다. Passive 정체는 `recordsToScan` 감소만 progress로 본다. `currentTasks`는 진단 표시와 cleanup 확인에 쓰되 URL 문자열 변화만으로 정체 시간을 초기화하지 않는다. Alert total 조회 실패나 비정상 page는 완전한 snapshot으로 승격하지 않으며 Alert 상세 상한 20,000개는 lane별이 아니라 캠페인 전체에 적용한다.
- 캠페인 Future를 보존하며 사용자는 Web에서 취소할 수 있다. 취소·executor 거부·예상 밖 예외·마지막 lane 실패에도 crawler, Replacer capability와 run context를 정리하고 `FAILED` 또는 `CANCELLED` terminal 상태를 기록한다. Replacer rule 제거가 실패하면 원격 rule 식별자를 잊지 않고 다음 시작 전에 제거를 재시도하며, 계속 실패하면 새 capability를 만들기 전에 시작을 거부한다. 세션/Context 설정과 명세 import의 blocking ZAP 호출은 별도 daemon heartbeat로 worker liveness를 갱신한다. 이 신호는 `응답 대기`와 실제 `응답 수신`을 구분하며 capture/status progress와 별개다. Web의 일시적인 status poll 실패는 마지막 서버 상태를 보존하고 별도 poll warning으로 표시한다.
- 관리형 계정 ZAP·HUMAN Request Lab 요청은 기존 Authorization/Cookie/Proxy-Authorization/CSRF를 제거하고 broker의 현재 `ACTIVE` 세션만 주입한다. fresh ZAP anonymous lane은 Authorization과 Proxy-Authorization을 제거하되 그 lane 안에서 서버가 새로 발급한 익명 Cookie/CSRF는 상태형 탐색을 위해 유지한다. 이 lane-local 쿠키는 계정 증명이 아니므로 신원 fingerprint는 계속 `anon`으로 고정한다. 수동으로 직접 실행해 FlowScope run context가 없는 scanner 트래픽은 관측만 하고 헤더를 바꾸지 않는다. 쿠키 회전은 응답의 Set-Cookie로 broker에 갱신하며, UNVERIFIED/SUSPECT/만료 세션은 사용자가 HUMAN 로그인 캡처를 다시 해야 한다.
- Web scanner target 목록과 시작 API는 자기 자신의 `127.0.0.1:<web-port>` 제어면을 제외한다. localhost의 실제 점검 대상까지 포괄 차단하지 않고 현재 Web port만 차단한다.
- API 정의 import도 생성된 명세 method가 상태를 바꿀 수 있으므로 정의가 하나 이상이면 별도 Burp dialog 승인을 요구한다. 거부되면 fresh session이나 대상 요청 전에 캠페인 시작을 중단한다.

- ZAP `scanOnlyInScope`는 FlowScope 허용목록이 아니라 ZAP Context를 읽는다. 따라서 각 fresh session에 선택 target의 origin·path subtree만 매치하는 Context를 만들고 in-scope로 표시한 뒤 passive rule을 활성화·재확인한다. regex 회귀는 sibling path, subdomain, 다른 scheme/port를 거부한다.

## 5. UI

| 작업면 | 역할 |
|---|---|
| API·입력 차이 | 기본 작업면. 선언/관측 endpoint와 parameter를 source별로 정렬하고 provenance·Evidence 및 산출물 파싱 상태를 연다. `미관측`을 취약점·lane 실패로 표현하지 않으며 전체 퍼센트를 만들지 않는다. |
| 인가 그래프 | `사이트 → API 그룹` 개요, `identity → API` 비교, 선택 API의 `identity → API → object` 상세를 분리한다. 객체는 family로 접고 선택 시 인스턴스를 펼친다. 화면 집계와 무관하게 Fact Core의 Evidence 관계를 보존한다. 긴 경로는 생략하지 않고 줄바꿈하며 미요청 route는 중립 후보로 분리한다. |
| 판정 매트릭스 | identity/role × operation × resource의 소스별 판정과 3종 갭 |
| 흐름 순서 | 응답 값이 뒤 요청에 사용된 실제 데이터 의존성 |
| 시나리오 | 현재 BOLA/BFLA 규칙 후보·사람 검토와 별도 과거 LLM 읽기 전용 기록 |
| 파싱 결과 | 마스킹된 source/identity/method/operation/resource/status, traffic class/disposition/reason, 반복 수, stable Evidence ID. 행 선택은 operation 상세와 페이지형 Evidence로 연결 |
| 계정·세션 | 전체 폭 계정 등록, HUMAN 로그인 캡처, broker 상태/재인증/폐기, 발견 지문 비교와 명시 연결·해제 |
| 빠른 시작 | HUMAN run, 결정론적 ZAP 대상·비로그인/복수 계정 선택·신원별 단계/수집/Alert 상태, Evidence 검토 안내 |
| 공통 우측 | 선택 API의 지연 로드된 마스킹 Request/Response, Web 요청 실험실, Repeater 미전송 초안 |
| Burp 제어판 | exact scope, 세 레인 포트, Web UI 열기, Proxy history, project I/O, sample/reset |

관측 Evidence가 0건이면 분석 패널을 숨기고 `scope → 계정 로그인/HUMAN → ZAP → Evidence 검토` 네 단계와 빠른 시작·샘플 조작만 먼저 노출한다. Evidence가 생기면 위 분석 작업면으로 전환한다. 이 progressive disclosure는 분석 모델을 줄이지 않고 첫 행동만 분리하며, ADMIN은 BFLA 역할 비교가 필요할 때만 선택적으로 추가한다(D-057).

번들 `SampleProject`는 `demo.flowscope.test`의 합성 H/S/L record만 만들며 대상 네트워크를 호출하지 않는다. snapshot은 모든 record가 이 고정 demo service·run provenance일 때만 `sampleMode=true`를 보내고 샘플 배너는 H/S/L 표시가 실제 점검 결과가 아니고 대상 네트워크 요청을 만들지 않았음을 명시한다. 실제 traffic이 하나라도 섞이면 sample mode로 표시하지 않는다.

## 6. 모듈 매핑

| 모듈 | 구현 |
|---|---|
| Capture | `burp/FlowScopeExtension` |
| Normalize/mask/classify | `core/Normalizer`, `Fingerprints`, `Masking`, `BurpXmlParser`, `HarParser`, `TrafficClassifier`, `ObservationCollapser` |
| Endpoint/parameter surface | `core/SurfaceAnalysis`, `core/SurfaceAnalyzer`, `core/RouteCandidateExtractor`, `core/discovery/*` |
| Identity/review state | `AccountProfile`, `AnalysisConfig`, `ReviewDecision`, `ValidationDecision` |
| Rules | `AuthorizationAnalyzer`, `DataFlowAnalyzer`, `EvidenceIds` |
| Graph model | `core/graph/*`, `web/SnapshotJsonWriter` |
| Product UI | `frontend/src`, `web/ClasspathWebAssets`, `web/FlowScopeWebServer`, legacy `resources/web/index.html`, `ui/FlowScopeControlTab` |
| Session/run | `integration/SessionBroker`, `core/RunContextRegistry`, `LaneCompletionPolicy` |
| 과거 LLM 데이터 | `core/LegacyAssessment`, `ValidationDecision`, `integration/RunExecutionLedger` (새 실행·판정 없음) |
| ZAP 실행·상태·취소 | `integration/ZapCampaign`(호스트 소유), `ZapClient`(API), `ZapCampaign.State`(캡처·scope·session 계약) |
| Local setup | `integration/LocalSecretFile`, `LocalZapApiKey`, `infra/zap`, `scripts` |
| Persistence | `integration/SqliteProjectStore`, JSON codec/import-export `integration/ProjectStore` |

## 7. 명시적 한계

- 후보는 exploitability/business impact의 증명이 아니다.
- `UNCROSSED`는 관측된 identity와 관측된 operation/resource 안의 미실행 cell만 계산한다. 별도 route inventory는 구현됐지만 기본 1MiB 이하로 보존된 textual 응답(초과/metadata-only면 8,192자 preview)과 응답 없는 Burp Site Map 항목에서 최대 20,000개만 만든다. JavaScript AST의 정적으로 해석 가능한 call-site 밖인 임의 wrapper·런타임 생성 경로·받지 않은 lazy chunk와 전체 블랙박스 공격면은 알 수 없다.
- domain-specific 또는 일반 principal 문맥이 아닌 중첩 ownership은 사용자 확정이 필요하다.
- 안정 신호 없는 opaque rotating token은 자동으로 같은 identity로 합칠 수 없으며 사용자 확인 binding이 필요하다.
- 쿠키 존재만으로 익명/로그인 여부를 완전히 알 수 없고 Fetch Metadata/MIME도 모든 클라이언트가 제공하지 않는다. 따라서 `UNRESOLVED`와 `REVIEW`가 정상 상태이며 분류의 오탐·미탐 0을 주장하지 않는다.
- data flow는 exact-value 보조분석이며 semantic taint가 아니다.
- source별 active run context는 하나이며 이미 활성화된 run과의 충돌을 거부한다. 종료도 정확한 run ID가 일치해야 한다.
- 세션 브로커는 일반 Cookie/Bearer/CSRF와 서버가 돌려주는 회전을 처리하지만 CAPTCHA/MFA/WebAuthn/device binding/application-specific refresh를 일반화하지 않는다. 이 경우 수동 재로그인이 필요하다.
- `ACTIVE` 전이는 자격증명 material 뒤 401·로그인 redirect·invalid-token이 아닌 2xx~4xx 응답을 관측한 transport-level 확인이다. 403은 역할 거부일 수 있어 세션 만료로 단정하지 않는다. 이는 서비스 고유 `/me` 의미, 실제 계정 소유, role을 자동 증명하지 않는다.
- 과거 버전의 ZAP anonymous 기준선 성공 기록은 `beta-validation.md`의 해당 artifact 범위다. D-126 새 JAR의 실제 Client/AJAX capability·비로그인/로그인 lane·취소는 아직 미실행이며 과거 8건 수집 기록으로 대체하지 않는다.
- 그래프 접기는 의미 기반 클러스터링이 아니라 현재 필터 결과를 객체/API별 18개 단위로 늘리는 표시 페이지다. 20,000 record 상한은 별도로 Burp를 보호한다.
- Repeater handoff는 live 원문이 메모리에 있으면 그 원문, 아니면 마스킹 전문을 미전송 초안으로 연다. Repeater에서 사용자가 별도로 보낸 결과를 원 Evidence에 자동 연결하는 안정적인 Montoya correlation 계약은 없으므로 자동 validation에는 사용하지 않는다. Web 요청 실험실 전송만 서버가 직접 새 HUMAN `VALIDATION` Evidence로 기록한다.
- 포트 매핑은 확장 로드 시 시스템 속성으로 읽으므로 변경 후 Burp를 다시 시작한다.
- SQLite JDBC는 desktop native library를 포함한다. 자동 테스트의 현재 JDK에서는 로드 경고만 발생했지만, beta.44 fat JAR을 실제 Burp bundled JVM에서 load/unload하고 JSON v4·SQLite v3 프로젝트를 저장·재열기하는 수동 gate 전에는 모든 Burp/JVM·확장 조합의 런타임 호환을 완료로 주장하지 않는다.

세부 결정과 기각 대안은 `decisions.md`를 참조한다.
