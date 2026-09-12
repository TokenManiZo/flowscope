# FlowScope 설계서 v1.2.0-beta.46

**화이트햇스쿨 2단계 팀 프로젝트, 토큰많이조**

**2026-09-09 현재:** 기존 Judge·MCP·브라우저 하네스는 제거한 채, 판정 없는 독립 Codex Explorer를 새 실행 경계로 구현했다(D-128). ZAP 로그인 lane은 별도 메모리 계정과 ZAP Browser Based Authentication으로 직접 구성한다(D-130). 모든 ZAP lane은 distribution bundle의 FlowScope Docker 이미지가 제공하는 Chromium·ChromeDriver와 명시적인 `chrome-headless` Client Spider를 사용하며 임의 ZAP runtime은 거부한다(D-135). ZAP 상태 확인의 일반 통신 실패는 3회 연속일 때만 `UNREACHABLE`로 확정하고, 그 전에는 `RETRYING`으로 구분한다(D-138). HUMAN, 분석 코어와 프로젝트 호환은 유지한다. 제품용 MCP는 미구현이다. 과거 명세와 D-125 이전 실행 설명은 역사 기록이며 현재 LLM 계약은 [Explorer 문서](llm-explorer.md)를 따른다.

사람·스캐너·LLM이 선언·관측한 API와 입력을 같은 범용 좌표에 정렬해 탐색 차이를 먼저 보여 주고, 선택한 API의 BOLA/IDOR·BFLA 후보를 기존 신원 인지 그래프와 Evidence로 검증하는 Burp Suite 확장이다. `docs/ko/specification/functional-spec.md`는 원 요구사항의 이력이다. 현재 범위는 `product-overview.md`·README, 현재 HOW는 이 문서, 선택 이유와 대체 관계는 `decisions.md`, 진행상황은 `HANDOFF.md`를 따른다. 화면별 사용자 질문과 발표 논리는 `ui-product-rationale.md`가 정본이다.

## 1. 제품 목표와 신뢰 경계

- 정본 목표는 “허가된 exact scope에서 선언되거나 실제 관측된 API·입력을 구조화하고, HUMAN·SCANNER·LLM의 탐색 차이와 인가 후보를 원 Evidence까지 역추적 가능하게 만들어 진단자가 다음에 볼 위치를 줄이는 것”이다.
- 기본 작업면은 `Endpoint·Parameter Surface Delta`다. 선언 근거와 실제 HTTP 관측을 분리하고 source별 미관측 위치를 중립 작업목록으로 제시한다. 인가 그래프는 선택한 API의 `identity → API(operation) → object` 관계를 여는 상세층이다. 접기·그룹화·화면 전환은 표현일 뿐 원 Evidence 관계를 합치거나 삭제하지 않는다.
- 비교 축 `source={HUMAN,SCANNER,LLM}`와 판정 축 `identity/role/owner`를 섞지 않는다(D-001).
- LLM source는 새 Explorer가 실제로 보낸 대상 요청 또는 과거 저장 관측의 생성자 표시다. 새 Explorer는 endpoint·parameter·인증별 응답·workflow Evidence만 수집하고 판정하지 않는다. 과거 assessment/validation은 읽기 전용으로 분리한다.
- 블랙박스 전체 분모는 알 수 없으므로 커버리지 퍼센트를 만들지 않는다(D-002).
- 모든 액티브 도구는 명시적 exact scope 안에서만 동작한다. 현재 FlowScope에는 ZAP Active Scan 시작 API가 없다. 기본 캠페인과 HUMAN 명시 전송의 scope·승인 경계는 유지한다.
- 모든 endpoint·parameter 발견, 오탐·미탐 0, LLM 서술만으로 최종 확정은 보장하지 않는다. 완료 여부는 개발 corpus와 분리된 블라인드 benchmark에서 endpoint·parameter·객체·분류·finding 측정값, `REVIEW` 작업량, false positive·false negative·unresolved를 함께 공개하고 모든 후보·판정을 원본/재현/정상 대조 Evidence로 역추적할 수 있는지로 판단한다.

## 2. 단일 확장 아키텍처

```text
Browser :8080 ─┐
               ├─▶ Burp capture ─▶ mask/normalize/classify ─▶ Pipeline
ZAP     :8081 ─┘         ▲                                    ├─▶ Surface/Graph/Matrix
                         │                                    └─▶ 규칙 후보 + 사람 검토
Web 스캐너 버튼 ─▶ ZAP 계정 메모리 vault ─▶ ZapCampaign ─▶ ZapClient ─▶ 로컬 ZAP API
                                                    └─▶ Browser Auth + 계정별 crawler
Web Explorer ─▶ ExplorerCoordinator ─▶ Codex app-server dynamic tools
                    ├─▶ memory-only auth vault
                    ├─▶ exact-scope HTTP gateway ─▶ Burp Montoya HTTP ─▶ LLM Observation Evidence
                    └─▶ Evidence-bound declaration gateway ─▶ RouteCandidate ─▶ Surface Declaration
Web Request Lab ─▶ 명시적 HUMAN 전송 ─▶ VALIDATION Evidence
ProjectStore/SqliteProjectStore ◀─▶ 마스킹 Evidence·정책·완료 run·과거 LLM 기록
FlowScopeWebServer :17777 ─▶ SnapshotJsonWriter ─▶ React / legacy UI
```

Burp는 호스트에서 실행하고 ZAP은 distribution bundle의 FlowScope Docker 이미지로 준비한다. ZAP API 기본은 loopback `8089`, upstream은 Burp `8081`이다. 캠페인 시작 전 API version뿐 아니라 `zapHomePath`가 tmpfs `/run/flowscope-zap/` 아래인지 확인한다. Explorer는 로그인된 로컬 Codex CLI의 `app-server`를 자식 프로세스로 실행하지만 MCP `8787` 리스너는 기동하지 않는다. `8082`는 기존 직접 관측 source 분류만 남으며 `UNVERIFIED_RUNTIME`으로 분석·완료에서 제외한다.

Web의 ZAP 상태 조회는 live ZAP API probe다. 성공하면 연속 통신 실패를 초기화하고, 일반 실패 1·2회는 `RETRYING`, 3회째는 `UNREACHABLE`로 전이한다. API key 401/403과 관리 runtime 불일치는 반복해도 회복되지 않는 구성 오류이므로 즉시 확정한다. 이 연결 상태는 캠페인 단계·완료 상태와 별개다.

Web 빠른 시작은 `범위 → HUMAN → ZAP → LLM Explorer → Evidence 검토`로 연결한다. `FlowScopeExtension.startZapIntegration()`이 캠페인 한 개를, `ExplorerCoordinator`가 LLM run 한 개를 소유하며 Web 시작·조회·취소가 직접 호출한다. 데이터 교체/reset과 unload는 캠페인과 Explorer memory vault를 직접 정리한다. MCP adapter와 Judge 잠금 callback은 없다. scope·active run·세션·capability·crawler cleanup 경계는 유지한다.

`zap-up.sh` 또는 Windows `zap-up.ps1`은 같은 key helper를 사용해 digest 고정 ZAP 2.17 base에서 FlowScope 이미지를 빌드하고 `host.docker.internal:8081` upstream을 설정한 뒤 다시 읽어 검증한다. Dockerfile은 같은 Debian 저장소의 Chromium과 ChromeDriver를 함께 설치한다. 시작 스크립트는 두 실행 파일, 주 버전 일치, 임시 profile을 사용한 실제 headless 기동을 먼저 확인하고 Java Selenium provider 경로와 `chrome-headless`의 `--no-sandbox` 인수를 고정한다. Chromium은 unprivileged `zap` 사용자로 실행하고 broad capability나 seccomp 완화는 추가하지 않으며 `/run/flowscope-zap`·`/tmp`는 tmpfs, `/dev/shm`은 1GiB로 둔다. Linux는 Compose `host-gateway`, Docker Desktop은 공식 `host.docker.internal`을 사용한다. key 값은 container environment가 아니라 Compose file-backed secret으로 read-only mount한다. POSIX는 mode, Windows는 상속 차단·현재 SID 전용 ACL을 helper/doctor가 관리한다. FlowScope는 시스템 속성 key, 환경 key, 지정 key 파일, 기본 key 파일 순으로 읽으며 ZAP API URL 자체는 기존처럼 loopback만 허용한다. 이 계층의 실제 Chromium 기동·Client HTTP 200 수집은 확인했지만 로그인 계정의 Browser Based Authentication과 Burp 8081 귀속까지 대체하지 않는다(D-086, D-087, D-088, D-135).

- 소스 빌드는 JDK 21·Maven 3.9.x를 강제하고 Maven shade fat JAR을 만든다. `montoya-api`는 Burp 제공 scope다. Jackson·jsoup·SnakeYAML·Closure의 base class와 현재 또는 미래 MR-JAR 구현은 `io.flowscope.shaded` 아래로 격리하며, sqlite-jdbc는 JNI 이름을 깨뜨리는 relocate를 하지 않고 원 패키지를 유지한다. package는 의존성 NOTICE·라이선스를 보존하고 version 숫자와 무관하게 MR-JAR 경로를 결정적으로 relocation하며 source→target map을 기록한다. manifest-aware JAR 재구성과 `JarInputStream` gate로 streaming consumer에서도 Main-Class·Java-Version·Multi-Release를 읽을 수 있게 한다. Maven Assembly는 이 최종 JAR, 문서, ZAP Compose/helper와 OS별 doctor를 한 base directory의 `*-bundle.zip`으로 묶는다. JAR과 bundle의 반복 SHA-256은 동일하게 고정한 build environment 안에서 검사하며 임의 JDK·운영체제 사이의 동일 해시를 주장하지 않는다(D-090/D-092/D-118/D-129).
- Burp `registerSuiteTab`에는 범위·포트·프로젝트 상태를 다루는 작은 Swing 제어판만 둔다. 그래프·매트릭스·상세의 정본은 시스템 브라우저에서 여는 번들 Web UI다.
- Web UI는 번들 Cytoscape.js를 사용하며 외부 CDN이나 원격 자원을 요청하지 않는다. JCEF·JavaFX는 배포물에 포함하지 않는다. Explorer readiness는 15초 캐시하지만 사용자가 설치·로그인을 끝낸 직후 Web의 **다시 확인**이 cache를 무효화하고 같은 provider 검사를 다시 실행한다. 준비 실패는 Explorer 시작만 막고 HUMAN·ZAP을 비활성화하지 않는다.
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
  applicability, reviewReason,
  declaredParameters[{location, fieldPath, displayName, requirement,
                      evidenceId, source, runId, adapter, reason, coordinateVersion}]
}

SurfaceAnalysis {
  endpoints[EndpointFact {
    key(service, method, pathTemplate), deltaState,
    observedSources[], observations[evidenceId, source, runId, identity, status],
    declarations[evidenceId, source, runId, type, adapter, reason],
    parameters[location, fieldPath(표시 경로), displayName, requirement,
               observedShapes[], observedSources[], observationEvidenceIds[],
               observations[evidenceId, source, runId, identity, status, shape,
                            role, phase, presence, valueType, byteLength, masked, contextSignature, confidence],
               declarations[evidenceId, source, runId, type, adapter, reason,
                            coordinateVersion, coordinateResolved,
                            declaredType, declaredShape, conditionText, confidence],
               deltaState(+UNRESOLVED_COORDINATE),
               canonicalPath, observedValueTypes[], distinctValueCount,
               coordinateResolved, distinctValueTruncated,
               profile{observationCount, sourceCounts, identityCounts, roleCounts,
                       runCounts, phaseCounts, observedPresence[], typeConflict,
                       absentObservedContextCount,
                       contextPresence{contextSignature → PRESENT|EXPLICIT_NULL|ABSENT_OBSERVED_CONTEXT},
                       serverUsageConfirmed=false},
               authorizationTargets[resource?, confidence(OBSERVED|CORROBORATED|INFERRED|UNKNOWN),
                                    basis, evidenceIds[≤32], evidenceCount]],
    requestContexts[evidenceId, complete, retained, discovery, contextSignature]   // 요청 행 문맥(값 없음)
  }],
  probes[endpointKey, evidenceId, source, runId, identity, status],
  parameterDiagnostics[evidenceId, operation, reasonCode, droppedCount],
  parameterGaps[id(pg:v1:|pg:auth: sha256 of coordinate), type(DEFINED_NOT_OBSERVED|SOURCE_MISSED|IDENTITY_MISSED|
                AUTH_VARIANT_UNTESTED|CONDITION_COMBINATION_UNOBSERVED|TYPE_VARIANT_UNOBSERVED),
                endpoint(key), location, canonicalPath, identity?, role?, source?, status(OPEN),
                priorityReasons[CONFIRMED_AUTH_BOUNDARY, AUTH_VARIANT_UNTESTED, WRITE_METHOD,
                                CORROBORATED_EVIDENCE, SOURCE_DISCREPANCY, HUMAN_REVIEW_REQUIRED],
                summary, evidenceIds[≤32], evidenceCount],   // priority 순 정렬
  validationCells[endpoint(key), location, canonicalPath, targetResource?, subjectClass(SELF|OTHER_OWNER|ANONYMOUS|OTHER_ROLE),
                  source, identity?, role, verdict(ALLOW|DENY|SUSPICIOUS|UNDECIDED|UNTESTED), reason, applicable,
                  evidenceIds[≤32](실제 실행), basisEvidenceIds[≤32](관계 근거), evidenceCount, basisEvidenceCount]
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
- `authState`: `ANONYMOUS/ACCOUNT_BOUND/UNRESOLVED`. 명시적 계정 연결, HUMAN memory-only broker의 exact credential match, 또는 ZAP Browser Based Authentication 성공 뒤 CONTROLLED scanner lane의 별도 `laneAccountId`만 `ACCOUNT_BOUND`가 된다. 계정에 연결되지 않은 cookie/session fingerprint는 서비스별 하나의 `UNRESOLVED` 그래프 신원으로 안정화하되 원 fingerprint는 Evidence에 남긴다.
- `requestPayload/responsePayload`: 저장 전 구조 마스킹된 전문의 SHA-256, byte 수, 보존 상태와 선택적 GZIP이다. 일반 textual 메시지는 기본 1MiB, route discovery가 읽는 HTML/JavaScript/JSON/XML 응답은 기본 4MiB 이하이며 digest 중복 제거 후 압축 전문 총량 48MiB 안에 있을 때 `FULL`이다. binary, 유형별 메시지 상한 초과, 압축 총량 상한 초과는 서로 다른 metadata-only 사유를 남긴다. 상한 초과 live 메시지 식별자는 일반 최대 64KiB, 발견용 MIME 기본 최대 4MiB의 제한된 마스킹 표현·실제 byte 수·보존 사유를 길이 구분해 digest하므로 같은 접두부의 다른 크기를 구분하지만 원문 전체 checksum은 아니다. 8,192자 `reqText/respText/body`는 UI preview이며, 분석기는 `FULL` payload 전문을 우선 사용한다.
- `resourceReferences`: path/query/body/GraphQL에서 실제 값으로 관측된 모든 객체 참조와 `PATH_ID/QUERY_ID/BODY_ID/GRAPHQL_VARIABLE/*_SEMANTIC_FIELD_CORROBORATED` 근거다. `resource`는 기존 인가 cell의 보수적 primary 하나다.
- `trafficClassification`: `API/AUTH_SESSION/NAVIGATION/STATIC_ASSET/DISCOVERY_METADATA/PREFLIGHT/TELEMETRY_CANDIDATE/POLLING/BACKGROUND/UNKNOWN`, `INCLUDE/EXCLUDE/REVIEW`, 근거와 사용자 override를 가진 비파괴 파생값이다. `INCLUDE`만 coverage/graph 입력이며 `REVIEW`와 `EXCLUDE`도 Evidence에서는 삭제되지 않는다.
- `RouteCandidate`: 응답 없는 Burp Site Map 항목 또는 저장된 exact-scope 응답에서 추출한 경로다. provenance는 type과 Evidence ID를 따로 모은 집합이 아니라 `type ↔ evidenceId ↔ source ↔ runId ↔ adapter ↔ applicability/reason`의 대응 관계로 보존한다. D-139 Explorer 선언은 현재 run 응답 Evidence에 결박된 값 없는 `declaredParameters`도 같은 후보에 보존한다. 실제 request/response 전에는 identity, coverage, verdict, finding을 갖지 않는다.
- `SurfaceAnalysis`: 저장된 Evidence와 `RouteCandidate`에서 결정론적으로 재생성하는 값 없는 projection이다. Observation은 실제 request의 endpoint, parameter 위치·field path·shape와 source/run/identity/status/Evidence ID를 보존한다. Declaration은 OpenAPI·HTML form·정적 JavaScript·Explorer 산출물 분석 provenance에서 직접 확인한 endpoint/parameter만 보존한다. LLM Explorer가 capability 확인용으로 보낸 OPTIONS와 명시적 preflight는 `probes`로 분리하지만 일반 OPTIONS API 관측과 산출물 선언은 유지한다. `DECLARED_NOT_OBSERVED`, `ONE_SOURCE_OBSERVED`, `MULTI_SOURCE_OBSERVED`, `ALL_SOURCES_OBSERVED`, `OBSERVED_NOT_DECLARED`는 작업목록 상태이며 취약점·도달성·lane 완료 판정이 아니다. 별도 DB 정본을 만들지 않으며, Web 직렬화는 동일 revision·동일 입력의 projection을 재사용하고 입력 revision이 바뀌면 다시 계산한다(D-113/D-139).
- `AccountProfile`: 서비스별 테스트 계정의 내부 ID·표시 이름·확정 역할만 저장한다. 로그인 ID·비밀번호·토큰은 받지 않는다.
- `sessionBindings`: `(service, fingerprint) → accountId`의 사용자 명시 연결이다. 키 하나는 계정 하나에만 귀속되며, 이미 연결된 지문을 다른 계정으로 옮기려면 먼저 기존 연결을 해제해야 한다. 실제 비인증 `anon`과 추출 실패 `unresolved`는 계정에 연결할 수 없다. 자동으로 합칠 수 없는 회전 세션을 검증된 계정 단위로 정렬한다.
- Cookie·Authorization·subject fingerprint는 한 principal 안의 기술 단서이지 로그인 세션 개수가 아니다. 기본 권한 카드는 principal을 한 줄로 표시하고 단서 종류·개수는 계정 화면의 접힌 진단에서만 보여 준다.
- `SessionBroker`: 사용자가 Web UI에서 명시적으로 시작한 HUMAN 로그인 구간의 Cookie/Authorization/CSRF만 프로세스 메모리에 보관한다. 자격증명 material만 관측하고 성공 응답을 확인하지 못하면 `UNVERIFIED`, 401·로그인 redirect·invalid token이면 `SUSPECT`, 비밀 삭제/만료면 `REAUTH_REQUIRED`다. account service와 exact scope가 모두 맞고 상태가 `ACTIVE`일 때 HUMAN Request Lab 요청에만 주입한다. HUMAN pass의 계정 선택은 표시 힌트가 아니라 검증 조건이며, 실제 요청 자격증명이 그 broker 계정과 exact match할 때만 계정 신원으로 귀속한다. 다른 계정이 같은 service에서 동시에 캡처되는 것을 거부한다. 캡처 중 동일 지문이 다른 계정에 이미 연결된 사실을 확인하면 현재 세션을 `SUSPECT` 충돌 상태로 고정하고 신원 귀속·주입에서 제외한다. raw 값은 UI snapshot/project에 나오지 않는다.
- `ZapAccountVault`: ZAP용 label/role/service/login URL과 login ID/password를 현재 Burp 프로세스 메모리에만 둔다. Web/상태 API는 secret-free view만 반환하고 프로젝트·snapshot·로그에는 자격증명을 저장하지 않는다. 로그인 시 로컬 ZAP API의 POST body로만 전달하며, 교체·삭제·데이터셋 교체·unload에서 소유 char buffer를 지운다. Java/HTTP 라이브러리가 만든 짧은 immutable String 사본까지 물리적으로 지우는 hardware vault는 아니다.
- `evidenceId`: 전체 의미 내용 digest 기반 ID. digest 입력은 외부 값의 개행과 필드 경계가 충돌하지 않도록 null 표식과 UTF-8 byte 길이 접두 framing을 사용한다. beta.23 이하 newline digest가 일치하면 기존 Evidence ID를 유지한 채 새 digest로 이행한다. 프로젝트 왕복에서는 `contentDigest`가 일치할 때만 기존 ID를 보존하고, 동일 관측은 순서 suffix로 유일화한다.
- `owner`: 노드가 아니라 resource 속성이다(D-006). 명시적 본문 필드나 사용자 확정만 판정 근거가 된다.

논리 프로젝트 schema v4는 마스킹된 RequestRecord, digest별 한 번 저장되는 GZIP 전문 blob, provenance가 있는 RouteCandidate, 계정·세션 지문 연결, role/requirement/owner 정책, operation별 traffic override, classifier version, 과거 `LegacyAssessment`와 `ValidationDecision`, Evidence-bound 사람 감사 기록, **완료된 정확한 run**과 bounded `RunExecutionLedger`를 저장한다. 실행 원장은 query·header·body·raw exception 없이 method·service·path와 typed outcome만 보존하며 실패를 RequestRecord/Evidence로 승격하지 않는다. 완료 run은 source만 저장하지 않고 `source/runId/detail/orchestrator/tool/phase/account/completedAt/evidenceIds/responseCount/coverageCount`를 묶는다. 기본 내구 저장은 SQLite storage schema v3의 기존 관계형 테이블, `completed_runs`, `run_attempts`이며 JSON schema v4 codec을 공통 검증 경계로 재사용한다. `.flowscope.db`를 처음 저장하거나 열면 이후 revision을 30초 checkpoint로 합쳐 임시 DB에 transaction으로 쓴 뒤 atomic replace하고 정상 unload 직전 마지막 저장을 시도한다. `.flowscope.json` schema v1/v2는 source-only `completed_lanes`를 완료 자격으로 복원하지 않으며 schema v3 exact completed run은 유지한 채 실행 원장은 빈 값으로 마이그레이션한다. v4 내보내기는 exact completed run과 중복 표시용 `completed_lanes`의 일치를 검증한다. raw HUMAN broker, ZAP login, Explorer credential은 어느 형식에도 저장하지 않는다. 복원기는 payload 하나당 최대 64MiB, 서로 다른 복원 전문 합계는 설정값 또는 최소 64MiB 안에서 streaming GZIP 해제하며 digest/size/retention을 검증하고 동일 digest는 한 번만 복원한다. 실제 capture의 `FULL` 상한은 일반 textual 1MiB와 발견용 응답 4MiB로 구분된다. metadata-only 항목은 압축 blob을 허용하지 않는다. 로드한 assessment/validation은 기존 ID와 생성 시각을 유지하는 읽기 전용 기록이며 현재 판정으로 재승인하지 않는다. 분류는 현재 결정론 classifier로 재계산한다. 파일은 100MiB 상한과 가능한 POSIX 0600을 적용한다. 이 SQLite 계층은 현재 20,000건 메모리 pipeline의 내구 snapshot이지 append-only server event store가 아니다(D-049/D-050/D-052/D-054/D-059/D-073/D-075/D-099/D-101/D-116).

D-145의 정상 unload는 새 capture·import·rebuild를 먼저 차단하고, 현재 records가 마지막 게시 분석보다 새로우면 worker에서 한 번 재구축한 뒤 SQLite checkpoint를 시도한다. 프로젝트 설치와 shutdown flag 전환은 같은 records monitor에서 선후를 원자적으로 확정하므로, unload가 먼저 시작한 후보 데이터셋은 적용하지 않고 설치가 먼저 시작했으면 적용 완료 뒤 unload가 저장한다. 10초 안에 끝나지 않거나 저장이 실패하면 기존 원자 저장본을 유지하고 오류를 기록한다. 이를 전원 장애 내구성으로 확대 해석하지 않는다.

D-140부터 기본 Web 수명주기는 사용자별 `~/.flowscope/projects/` 아래 진단 디렉터리와 `project.flowscope.db`다. 새 진단은 현재 snapshot 저장과 새 빈 DB 생성이 모두 성공한 뒤에만 exact scope와 메모리 상태를 교체한다. 분석 결과 갱신용 `revision`과 실제 데이터셋 교체용 `datasetRevision`을 분리하며, raw vault·HUMAN/Explorer/ZAP 비밀은 프로젝트에 저장하지 않고 교체 시 폐기한다. 상단의 저장 상태는 마지막 checkpoint 결과를 나타내며 디스크 flush나 운영체제 전원 장애에 대한 하드웨어 내구성 보장은 아니다(D-140).

- 실행 원장 보존 상한은 5,000개 시도이며, 반복 polling되는 Web snapshot에는 최근 100개 run의 집계만 노출한다.

## 4. 파이프라인

### 4.1 수집·마스킹 F-01~03/F-22

반복 Proxy history/XML/HAR 병합은 source/detail/service/method/path/status와 payload digest뿐 아니라 안전한 fingerprint, `laneAccountId`, `runId`를 함께 비교한다. 따라서 같은 파일·같은 provenance의 이미 반영된 multiplicity만 제외하고, HTTP 내용이 같아도 신원·세션·실행이 다르면 별도 Evidence로 보존한다. Burp XML base64 HTTP는 header를 ISO-8859-1, body를 Content-Type의 명시 charset 또는 기본 UTF-8로 strict decode한다. XML과 HAR의 IPv6 service는 `scheme://[literal]:port` 하나의 형식으로 맞춘다. 명시 charset 없는 legacy body·Content-Encoding 압축·binary 원문 편집까지 해결한 계약은 아니다(D-141).

live 경계는 Montoya byte 길이를 먼저 확인한다. 요청 1MiB·응답 4MiB를 넘으면 전체 Java 배열을 만들지 않고 크기만 raw vault에 전달한다. 일반 textual 메시지는 기본 1MiB, 발견용 응답 MIME(JavaScript/JSON/HTML/XML)은 기본 4MiB까지 decode·mask하고 `FULL` payload로 보존한다. `recordFrom()`의 `body/respText`는 8,192자 UI preview지만 `RequestRecord.responseBodyForAnalysis()`는 보존된 payload의 message body를 우선 반환하므로 4MiB 이하 발견용 응답은 route/Surface 분석까지 전달된다. 1.4MiB JavaScript의 후반 call-site를 capture→record 경로에서 확인하는 회귀가 이 연결을 고정한다. 발견용 4MiB 초과 응답은 metadata-only이며 전체 분석하지 않는다. 따라서 아래 `byte[]` 원문 보존은 각 raw 상한 이내 메시지에만 해당한다(D-101/D-128).

Proxy request handler가 listener port source를 보존하고 SCANNER/LLM의 범위 밖 요청을 송신 전에 차단한다. Proxy와 `Http.registerHttpHandler`가 받는 Repeater·Intruder·Target 등 비-Proxy Burp 도구는 각각 요청 `messageId`에 요청 시점 run/account/login-capture 문맥과 dataset epoch를 임시 보관하고 응답에서 한 번 소비한다. 따라서 HUMAN pass 종료 뒤 늦게 도착한 응답도 시작 당시 provenance로 귀속하고, 초기화·샘플 교체·프로젝트 열기 전 요청은 새 데이터셋에 들어오지 않는다. 상관 문맥이 없으면 응답 시점 context로 추측하지 않고 제외한다. in-flight 문맥은 채널별 20,000건·10분 상한을 두며 원 인증값이나 요청 전문은 이 상관 테이블에 저장하지 않는다. HUMAN 브라우저의 범위 밖 이동 자체는 막지 않지만 response capture 직전에 모든 source를 현재 exact scope로 검사하므로 범위 밖 응답은 저장·그래프화하지 않는다. 정상 수집된 비-Proxy HUMAN 응답도 broker에 전달해 같은 계정의 쿠키 회전을 반영한다. 사용자가 요청하면 기존 Proxy history도 원래 listener·시각·최종 요청·응답으로 가져오되 scope 밖 item을 제거한다. 재가져오기는 관측 횟수를 보존하는 multiset 병합으로 이미 반영된 사본만 제외한다. Authorization/Cookie/Set-Cookie와 password/token/secret/api-key류는 header와 JSON/form/multipart/XML 구조를 따라 저장 전에 마스킹한다. 마스킹된 일반 textual 전문은 기본 1MiB, 발견용 응답은 기본 4MiB, digest 중복 제거 후 압축 총량은 48MiB까지 GZIP으로 보존하고 8,192자 preview를 별도로 유지한다. binary·유형별 메시지/총량 상한 초과 전문은 크기·bounded 식별자·사유만 보존해 잘린 내용을 완전 Evidence처럼 쓰지 않는다. Burp XML도 같은 보존 정책을 적용하며 XXE를 차단하고 불완전 item을 이유와 함께 skip한다. ZAP HAR 1.2 폴백은 `log.entries`의 request/response를 `SCANNER/HAR_IMPORT/ZAP/IMPORT/IMPORTED`로 변환하고 동일 scope·마스킹·payload 상한을 적용한다. `status=0`은 응답 없는 후보로 보존하고 binary base64 응답은 문자열로 왜곡하지 않고 metadata-only로 둔다. HAR에는 ZAP Alert와 campaign completion 계약이 없으므로 둘을 생성하지 않는다(D-093).

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

classifier v6는 source와 무관하게 로그인 준비 교환을 `AUTH_SESSION/EXCLUDE`로 분리하고, web manifest·source map·service worker를 `DISCOVERY_METADATA/EXCLUDE`로 분리하며 exact `/manifest.json` 경로를 보조 근거로 추가한다. 같은 service·정규화 operation에 강한 비사용자-override `API/INCLUDE` Evidence가 있고 immutable discovery gate를 통과할 때만 애매한 형제 record를 API로 교차 보강한다. API 문맥 없는 401/403 상태는 `AUTHORIZATION_RESPONSE_ONLY` 근거의 `REVIEW`로 남겨 scanner probe를 메인 그래프와 결합시키지 않는다(D-106).

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

- endpoint key는 `service + method + canonical path template`, parameter key는 관측·선언 공통 `ParameterCoordinate = endpoint + PATH/QUERY/JSON_BODY/FORM_BODY/MULTIPART_BODY/GRAPHQL_VARIABLE/HEADER/XML_PATH + canonicalPath`다(D-143). canonicalPath는 machine join key이고 displayName은 사람 라벨로 분리한다. 관측(`ParameterExtractor`)과 모든 선언 어댑터가 `ParameterCoordinates`로 같은 canonicalPath를 만들어 같은 논리 파라미터가 하나의 `ParameterFact`로 병합된다. `fieldPath`는 사람이 읽는 표시 경로(PATH는 선언명, JSON은 `parent.child`·`parent[].child`)이며 canonicalPath와 다르다. 저장 좌표는 `coordinateVersion`(LEGACY_V1/FLOW_V2)으로 구분하며 점 있는 legacy JSON/GraphQL·세그먼트 없이 평탄화된 JS 이름·OpenAPI path slot 정렬 실패처럼 확정할 수 없는 선언은 `UNRESOLVED_COORDINATE` 상태(`coordinateResolved=false`)와 진단(`LEGACY_AMBIGUOUS_COORDINATE`/`UNRESOLVED_PARAMETER_COORDINATE`/`UNRESOLVED_PATH_ALIGNMENT`)으로 남아 join·Gap 승격 대상이 아니다. 정적 JavaScript 선언은 `JavascriptCallSiteAnalyzer`가 AST 세그먼트(`Segment(key, arrayElement)`: 중첩 키·배열 원소 wildcard)를 보존해 전달하므로 리터럴 점 키와 중첩, 리터럴 `*` 키(`~2`)와 배열 원소 `*`를 구분한다. PATH `/segments/N`은 template의 실제 placeholder 위치만 확정 좌표로 받는다(`pathSlotPosition`). 선언은 PR#11 정의 의미를 따른다: OpenAPI는 path/operation parameter를 `(in|name)`으로 병합(operation override), local `$ref`만, oneOf/anyOf 변형은 `CONDITIONAL`+`union[i];`, enum은 값 없이 `enum[i];`, `type/format`→declaredType, binary·file 제외, `required` 미표기 OPTIONAL, `in: path`는 slot 좌표에 타입 부착; JS는 spread 객체·`__proto__`·constructor/prototype 컨테이너·method 미해석 call-site를 선언하지 않고 리터럴 종류를 declaredType으로 전달; 민감 이름 좌표는 선언에서도 제외하고 파라미터당 선언 32 상한(`DECLARATION_LIMIT`)을 둔다. 상한을 넘으면 preview는 수집 순서가 아니라 Evidence ID·종류·adapter·사유·조건의 안정 순서로 고르고(순서 역전에도 같은 결과), `DEFINED_NOT_OBSERVED` gap의 `evidenceCount`는 상한과 무관한 전체 선언 증인 수를 보존한다. 선언 confidence는 INFERRED, 관측은 OBSERVED. `SnapshotJsonWriter.surface()`는 현재 게시본 하나만 캐시한다(revision·`Pipeline.Result`·route 후보 목록의 동일성; 레코드 내용 fingerprint 없음). 게시본은 `Pipeline.run`마다 새 Result·새 revision이므로 같은 게시본에 대한 동시 poll만 한 번 계산하고, 이전 revision으로 돌아가면 다시 계산한다.
- **discovery 프로파일과 Gap(PR#11 ParameterProfiler, 3단계):** `SurfaceAnalyzer`는 coverage 레코드를 endpoint별 요청 행(Evidence ID당 1행, 같은 ID의 다른 내용은 둘 다 제외 + `CONFLICTING_EVIDENCE`)으로 보존한다. 관측 사실(`ParameterFact.observations`)은 모든 coverage phase를 담지만, `profile`과 `parameterGaps`의 분모는 discovery 행(coverage-eligible이며 VALIDATION/COACH_PROBE가 아닌 행)만이다. 행은 추출 진단이 없고 request payload가 `FULL`로 보존됐을 때만 complete이며, 불완전한 행은 긍정 관측만 남기고 부재(`ABSENT_OBSERVED_CONTEXT`)·누락 축·`DEFINED_NOT_OBSERVED`의 증인이 되지 못한다(`REQUEST_PAYLOAD_NOT_RETAINED` 진단). Gap 5종은 `SOURCE_MISSED`(완전한 비교 가능 행이 있는 source에서 미관측), `IDENTITY_MISSED`(알려진 신원, `unresolved*`·UNKNOWN 제외), `DEFINED_NOT_OBSERVED`(선언만 있고 해당 operation의 모든 행이 complete), `TYPE_VARIANT_UNOBSERVED`(선언 구조 형태 × JSON/GraphQL native 타입만 비교, enum·wire 문자열·format 타입 비교 안 함), `CONDITION_COMBINATION_UNOBSERVED`(같은 contextSignature 독립 2건 이상이 다른 source의 같은 role/phase 문맥에 없음)이며 미확정 좌표(`coordinateResolved=false`)는 어떤 Gap도 만들지 않는다. priority reason은 `WRITE_METHOD`→`CORROBORATED_EVIDENCE`(완전 관측 2건 이상, 또는 관측+정의 종류, 또는 정의 종류 2개 — 같은 문서 반복 provenance는 종류 1개)→`SOURCE_DISCREPANCY`→`HUMAN_REVIEW_REQUIRED` 순으로 정렬한다. 프로파일 미리보기 상한(contextPresence·identity·run 64)은 계수를 바꾸지 않고 `PROFILE_*_LIMIT` 진단만 남긴다.
- **권한 대상 연결(PR#11 ParameterAuthorizationAnalyzer → `SurfaceAuthorizationLinker`, 4단계):** `SurfaceAnalyzer.analyze(records, coverage, routes, AuthorizationAnalysis)`가 같은 요청 행에서 (1) `ParameterFact.authorizationTargets`: 관측 스칼라가 정확히 리소스 참조를 만들면(PATH는 `Normalizer.normalize` resource 일치, 그 외는 정본 field→resource 규칙을 스칼라 query projection으로 재생해 `QUERY_ID`/의미 필드 corroboration이 나올 때) OBSERVED, 리소스 하나뿐인 동시출현 INFERRED, 공개된 완전 독립 증인 2건 이상이면 CORROBORATED, 없음·복수면 UNKNOWN; (2) 최상위 `validationCells`: 입력×대상×subject(SELF/OTHER_OWNER는 확인된 소유자 필요, ANONYMOUS, OTHER_ROLE은 역할 분모 필요)×source. verdict는 응답 근거로 DENY/UNDECIDED만 직접 읽고 성공 응답의 ALLOW/SUSPICIOUS는 `AuthorizationAnalysis` CoverageCell의 per-source Decision을 **그 Evidence에 결박된 경우에만** 재사용한다(같은 source 대표 요청의 판정 입력이 다르면 `NO_EVIDENCE_BOUND_POLICY_DECISION` UNDECIDED) — 필드를 생략한 요청의 집계 성공이나 다른 응답의 객체 노출을 파라미터 셀이 빌리지 못한다(D-004·D-050). UNTESTED cell은 basis(link 증인)만 갖고, applicable하며 operation의 모든 행이 complete일 때만 `pg:auth:` `AUTH_VARIANT_UNTESTED` gap이 된다. VALIDATION phase(Request Lab) 응답은 `allRecords`에서 골라 사실·프로파일에는 넣지 않고 cell·link에만 연결한다. Evidence ID 충돌은 전 operation에서 판단한다.
- 요청 값은 저장하지 않고 shape·valueType·byteLength·masked·distinctValueCount(256 상한, 초과 시 truncated+`DISTINCT_VALUE_LIMIT`)와 요청 단위 구조 서명 `contextSignature`(값 digest가 아님)만 남긴다(값 digest는 distinct 산출 내부용, 직렬화·노출 안 함). source/run/identity/status와 Evidence ID는 Observation에 유지한다. 엔진 `ValueType`은 실제 타입(JSON `"1"`=STRING, `1`=INTEGER)이며 UUID·숫자형 문자열 같은 형식 신호는 `ValueSummary.format`으로 분리된다(응답 미참조). 표시 `ValueShape`는 JSON/GraphQL이면 실제 타입 기준(UUID 형식만 승격), wire 위치(PATH/QUERY/FORM/MULTIPART/HEADER/XML)는 형식 신호 기준으로 INTEGER/UUID 등을 표시한다. distinct 계수는 `타입:digest` 키로 타입 차이를 보존하고 엔진 digest는 원문 스칼라 기준을 유지한다.
- D-145 요청 비교는 위 main Surface snapshot 비노출 계약을 바꾸지 않는다. 사용자가 특정 Gap의 비교 탭을 열 때만 기존 capability 보호 `/api/evidence` 페이지가 선택 operation의 저장 record를 같은 `ParameterExtractor`로 재계산해 민감 경로·민감 값이 아닌 항목의 좌표·presence·shape·type·byteLength·contextSignature·SHA-256을 반환한다. 프런트 query 함수는 전문 필드를 cache에 넣기 전에 parameter metadata만 새 객체로 투영하고 `gcTime=0`으로 폐기한다. digest는 값 변경 비교용이며 프로젝트·main polling snapshot·인가 판정 입력이 아니다.
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

### 4.7 세션·ZAP·독립 LLM Explorer와 과거 LLM 데이터

`SessionBroker`의 명시적 HUMAN 캡처와 Request Lab 계정 주입을 유지한다. ZAP은 별도 `ZapAccountVault`와 Browser Based Authentication을 사용한다. `LaneCompletionPolicy`는 HUMAN/ZAP 완료 시 동일 source·run·EXPLORATION·응답·trust를 검사하고 Evidence ID를 저장한다. 과거 프로젝트의 완료 run도 기존 검증 codec으로 읽는다.

기존 `McpServer`, `LocalMcpToken`, `LocalLlmRunner`, `ControlledBrowserExplorer`, `RouteCandidateViews`와 agent-workspace는 삭제된 채 유지한다. `/api/llm-run`, `/api/ai-preview`, `/api/ai-scenarios`는 404다. 새 `ExplorerCoordinator`, `CodexAppServerProvider`, `ExplorerHttpGateway`, `ExplorerAuthRuntime`, `ExplorerAccountVault`는 MCP나 브라우저가 아닌 별도 계약이며 `/api/explorer-run`, `/api/explorer-accounts`로만 제어한다.

Explorer 계정 입력과 live cookie/token은 vault 메모리에만 둔다. 로그인 준비 HTTP는 Burp Montoya로 실제 전송하지만 `RequestRecord`, payload, 실행 원장, snapshot, 프로젝트에 기록하지 않는다. 모델에는 opaque account handle만 주고 Authorization/Cookie 지정은 gateway에서 거부한 뒤 vault 값만 주입한다. 프로젝트 교체·초기화·계정 삭제·unload는 vault를 비운다.

Codex app-server는 ephemeral thread와 격리 workspace를 사용한다. 모델 일반 네트워크는 꺼 두고 experimental `flowscope_http_request`와 `flowscope_record_discoveries` dynamic tool만 제공한다. Java provider가 model tool call을 random bearer가 걸린 loopback gateway로 전달하므로 capability는 provider 프로세스 환경이나 모델 입력에 노출하지 않는다. HTTP 경계는 absolute HTTP(S), exact scope, `GET/HEAD/OPTIONS/POST`, forbidden auth header, 성공 중복, 기본 500회 budget을 검사한다. POST는 prompt에서 검색·조회로 제한하지만 업무 의미를 블랙박스에서 완전 판별할 수 없다는 한계를 공개한다. 64KiB를 넘는 큰 마스킹 응답은 최대 4MiB 임시 artifact로 한 번 격리 workspace에 쓰고 종료·취소 시 삭제한다.

선언 경계는 `GET/HEAD/OPTIONS/POST/PUT/PATCH/DELETE` endpoint와 값 없는 parameter schema를 받지만 실제 전송을 수행하지 않는다. 같은 gateway가 현재 run에서 만든 응답 Evidence ID, exact scope와 정해진 field만 허용하고 인증·세션 header와 값은 거부한다. service·method·canonical path와 endpoint·location·field path로 중복 제거한 뒤 `LLM_ARTIFACT_ANALYSIS` RouteCandidate로 전달한다. 모델 자유서술 개수는 집계로 사용하지 않고 Coordinator가 실제 HTTP Evidence·선언·probe 수를 계산한다. LLM Explorer의 OPTIONS 실행은 probe로 분리하고, 일반 HUMAN OPTIONS와 대상 산출물에 선언된 OPTIONS는 API 사실로 유지한다(D-139).

실제 응답은 `source=LLM`, `sourceDetail=LLM_EXPLORER`, `orchestrator=LLM`, `tool=CODEX`, `phase=EXPLORATION`, `executionTrust=CONTROLLED`, exact run/account로 저장한다. `LaneCompletionPolicy`가 같은 run의 신뢰 가능한 응답 Evidence ID를 하나 이상 요구하므로 TLS/DNS/timeout만 발생한 실행은 “미발견” 완료가 되지 않는다. provider summary와 unresolved는 실행 피드용이며 assessment/verdict/finding으로 저장하지 않는다.

`LegacyAssessment`는 기존 assessment 필드·마스킹·상한을 유지하는 독립 데이터 타입이다. Snapshot의 `legacyLlm={readOnly,assessments,validations}`에 날짜·Evidence ID와 함께 기록하고 현재 `scenarios`에 합치지 않는다. 과거 assessment ID로 새 `/api/review`를 제출할 수 없다. 현재 규칙 finding의 사람 검토는 계속 허용한다. `RunExecutionLedger`는 새 Explorer의 응답 전 실패와 HTTP Evidence를 구분하되 header/body/query/예외 원문을 저장하지 않는다.

- 기본 ZAP 캠페인은 `orchestrator=SYSTEM`이다. 시작 전에 ZAP version API, `client`·`selenium`·`network`·`replacer`·`authhelper`를 포함한 필수 add-on, 관리 tmpfs `zapHomePath`, Chromium/ChromeDriver 실행·주 버전과 outgoing proxy enabled=`host.docker.internal:8081`을 확인하고, 누락·불일치 시 대상 트래픽 전에 실패한다. Web에서 비로그인과 별도 메모리 ZAP 계정을 선택하면 비로그인 → 선택 계정 순으로 실행하며, 각 신원 앞에서 이름 없는 ZAP session과 새 exact-scope Context를 만든다. 로그인 lane은 `browserBasedAuthentication(loginPageUrl,browserId=chrome-headless)`, `autoDetectSessionManagement`, ZAP Context의 logged-in/out indicator와 임시 user credentials를 구성한다. API action의 `OK`, 응답 status, `authSuccessful` 필드 유무나 인증 시각은 성공 근거로 사용하지 않는다. 8081 response handler가 동기화된 원시 저장소에 기록한 현재 run·현재 `laneAccountId`·`ZAP_AUTHENTICATION`·응답 존재 Evidence를 분석 그래프 snapshot과 독립적으로 읽어 필수 로그인 성공 정규식과 비교하고, 그보다 나중에 선택적 로그아웃 정규식과 일치한 Evidence가 없을 때만 신원 context로 전환한다(D-136, D-137). 이후 비로그인·로그인 모두 `browser=chrome-headless`인 strict Client Spider의 `contextName/userName/subtreeOnly=true/scopeCheck=STRICT/maxCrawlDepth=5/numberOfBrowsers=1/logoutAvoidance=true` → Passive 분석 → native Alert 수집 순서를 고정한다. 새 캠페인은 Traditional Spider와 AJAX Spider를 호출하지 않는다. 로그인 실패, Client API 실패, 범위 안 Client 응답 0건은 lane 실패이며 자동 fallback하지 않는다. 운영자가 이미 알고 있는 OpenAPI·GraphQL·Postman·SOAP 정의를 최대 20개 명시하면 별도 승인 뒤 Context 안에서 먼저 가져오며 이름 기반 URL 추측은 하지 않는다. Passive는 절대 30분, `recordsToScan` 감소가 없는 정체 10분을 경계로 추적하고, Alert 상세는 캠페인 전체 최대 20,000개를 메모리에 둔다. 상태 계약은 campaign/lane/stage 시각·제한, heartbeat, raw capture 변화, queue 순번·대기 이유, 인증 상태, Passive 작업과 Alert snapshot 완결성을 추적한다. 실제 단계 전환·인증 결과·Client·Passive 감소·Alert 집계·격리 정리는 비밀 마스킹된 이벤트 최대 120건으로 남기고 Web이 1초마다 조회한다. 이 운영 상태는 scan 성공이나 취약점 verdict가 아니다.
- D-108은 위 기본 캠페인의 종료·귀속 계약을 강화한다. `network`와 함께 `replacer` add-on을 필수 확인하고, D-124에 따라 캠페인마다 전체 exact scope 항목과 선택 target의 union에 적용되는 ZAP Replacer rule로 무작위 `X-FlowScope-Scanner-Capability`를 붙인다. D-132 이후 규칙은 ZAP 2.17의 authentication(5), API import/manual(6), Authentication Helper(14), authentication poll(15), Client Spider(18) initiator에만 적용한다. Burp 8081 handler는 활성 SYSTEM run ID와 capability가 모두 일치할 때만 `CONTROLLED` ZAP Evidence로 수집하며 capability 헤더는 대상 전송 전에 제거한다. 로그인 lane에서는 Session Broker가 Cookie/Authorization을 제거·교체하지 않고 ZAP user가 만든 인증 상태를 그대로 전달한다. 로그인 교환은 `ZAP_AUTHENTICATION / SESSION_SETUP`으로 보존하되 crawler 수집 건수·완료 gate에는 넣지 않는다. native Burp Scanner와 capability 없는 8081 수동 요청은 활성 ZAP context를 상속하지 않는다. capability 없는 요청을 run별로 계수하고 Client polling 중 한 건이라도 확인되면 다음 단계·신원으로 진행하지 않는다. 인증 성공 뒤의 CONTROLLED scanner Evidence만 별도 `laneAccountId`로 계정 귀속한다.
- Client stop API는 호출 성공만으로 정리를 확정하지 않는다. 소유 scan이 terminal 상태가 될 때까지 bounded poll하고, 확인 실패 시 다음 stage/identity를 차단한다. Passive 정체는 `recordsToScan` 감소만 progress로 본다. `currentTasks`는 진단 표시와 cleanup 확인에 쓰되 URL 문자열 변화만으로 정체 시간을 초기화하지 않는다. Alert total 조회 실패나 비정상 page는 완전한 snapshot으로 승격하지 않으며 Alert 상세 상한 20,000개는 lane별이 아니라 캠페인 전체에 적용한다.
- 캠페인 Future를 보존하며 사용자는 Web에서 취소할 수 있다. 취소·executor 거부·예상 밖 예외·마지막 lane 실패에도 crawler, temporary ZAP user/context, Replacer capability와 run context를 정리하고 `FAILED` 또는 `CANCELLED` terminal 상태를 기록한다. Replacer rule 제거가 실패하면 원격 rule 식별자를 잊지 않고 다음 시작 전에 제거를 재시도하며, 계속 실패하면 새 capability를 만들기 전에 시작을 거부한다. 세션/Context 설정·인증과 명세 import의 blocking ZAP 호출은 별도 daemon heartbeat로 worker liveness를 갱신한다. 이 신호는 `응답 대기`와 실제 `응답 수신`을 구분하며 capture/status progress와 별개다. Web의 일시적인 status poll 실패는 마지막 서버 상태를 보존하고 별도 poll warning으로 표시한다.
- HUMAN Request Lab 계정 요청은 기존 Authorization/Cookie/Proxy-Authorization/CSRF를 제거하고 broker의 현재 `ACTIVE` 세션만 주입한다. ZAP 로그인 lane은 capability 검증·제거 뒤 ZAP Browser Based Authentication이 만든 Cookie/Authorization을 보존하며 Session Broker와 섞지 않는다. fresh ZAP anonymous lane은 Authorization과 Proxy-Authorization을 제거하되 그 lane 안에서 서버가 새로 발급한 익명 Cookie/CSRF는 상태형 탐색을 위해 유지한다. 이 lane-local 쿠키는 계정 증명이 아니므로 신원 fingerprint는 계속 `anon`으로 고정한다. 수동으로 직접 실행해 FlowScope run context가 없는 scanner 트래픽은 관측만 하고 헤더를 바꾸지 않는다.
- Web scanner target 목록과 시작 API는 자기 자신의 `127.0.0.1:<web-port>` 제어면을 제외한다. localhost의 실제 점검 대상까지 포괄 차단하지 않고 현재 Web port만 차단한다.
- API 정의 import도 생성된 명세 method가 상태를 바꿀 수 있으므로 정의가 하나 이상이면 별도 Burp dialog 승인을 요구한다. 거부되면 fresh session이나 대상 요청 전에 캠페인 시작을 중단한다.

- ZAP `scanOnlyInScope`는 FlowScope 허용목록이 아니라 ZAP Context를 읽는다. 따라서 각 fresh session에 선택 target의 origin·path subtree만 매치하는 Context를 만들고 in-scope로 표시한 뒤 passive rule을 활성화·재확인한다. regex 회귀는 sibling path, subdomain, 다른 scheme/port를 거부한다.

## 5. UI

| 작업면 | 역할 |
|---|---|
| API·입력 차이 | 기본 작업면. 선언/관측 endpoint와 parameter를 source별로 정렬하고 provenance·Evidence 및 산출물 파싱 상태를 연다. `미관측`을 취약점·lane 실패로 표현하지 않으며 전체 퍼센트를 만들지 않는다. |
| 점검 Gap 그래프 | `#graph`의 첫 탭. `parameterProjection.ts`가 `snapshot.surface`를 machine key로 색인해 서버 REASON_ORDER 순 큐와 조건/사용자·API·입력·권한 대상 4-lane 경로를 만든다. `ParameterGapInspector`는 정확 operation의 EventRecord를 Evidence/Request Lab에 연결하고, 요청 비교를 열 때만 페이지형 안전 parameter metadata를 가져온다. 판정·우선순위를 재계산하지 않는다. |
| 전체 관계 보기 | `#graph`의 둘째 탭. `graphHierarchy.ts`가 서버 `cells`·`gaps`·`events`·`routeCandidates`를 Site→API group→API→Object 세 단계로 투영하고 source·identity filter, 18개 증분, 원 cell·Evidence 선택을 보존한다. 서버 `FlowGraphBuilder`는 legacy 전용이다. |
| 판정 매트릭스 | 첫 탭은 D-144 P/E/O projection, 둘째는 `surface.validationCells`의 parameter×authorization-target×subject×source 좌표, 셋째는 기존 identity/role×operation×resource cell이다. 어느 탭도 status·digest로 판정을 새로 만들지 않으며 사람 검토는 서버 Evidence에 결박한다. |
| 흐름 순서 | 응답 값이 뒤 요청에 사용된 실제 데이터 의존성 |
| 시나리오 | 현재 BOLA/BFLA 규칙 후보·사람 검토와 별도 과거 LLM 읽기 전용 기록 |
| 파싱 결과 | 마스킹된 source/identity/method/operation/resource/status, traffic class/disposition/reason, 반복 수, stable Evidence ID. 행 선택은 operation 상세와 페이지형 Evidence로 연결 |
| 계정·세션 | 전체 폭 계정 등록, HUMAN 로그인 캡처, broker 상태/재인증/폐기, 발견 지문 비교와 명시 연결·해제 |
| LLM Explorer | 시작 URL·비로그인/메모리 계정 선택, Codex 준비상태, 경과시간·요청·Evidence ID·실패·미해결 작업 피드, steer·취소 |
| 빠른 시작 | HUMAN run, 결정론적 ZAP 대상·비로그인/메모리 브라우저 로그인 계정 선택·신원별 인증/단계/수집/Alert 상태, LLM Explorer와 Evidence 검토 안내 |
| 공통 우측 | 선택 API의 지연 로드된 마스킹 Request/Response, Web 요청 실험실, Repeater 미전송 초안 |
| 상단 탐색·상태 | `WorkspaceNavigation`이 `분석 / 점검 / 기록` 세 그룹으로 모든 route를 제공한다. 상태 popover는 Scope/HUMAN/ZAP/SCANNER의 마지막 서버 상태를 보존하며 `#parameter-map`은 `#graph`로 호환 이동한다. |
| Burp 제어판 | exact scope, 세 레인 포트, Web UI 열기, Proxy history, project I/O, sample/reset |

관측 Evidence가 0건이면 분석 패널을 숨기고 `scope → 계정 로그인/HUMAN → ZAP → LLM Explorer → Evidence 검토` 흐름과 빠른 시작·샘플 조작을 먼저 노출한다. Evidence가 생기면 위 분석 작업면으로 전환한다. 이 progressive disclosure는 분석 모델을 줄이지 않고 첫 행동만 분리하며, ADMIN은 BFLA 역할 비교가 필요할 때만 선택적으로 추가한다(D-057/D-128).

번들 `SampleProject`는 `demo.flowscope.test`의 합성 H/S/L record만 만들며 대상 네트워크를 호출하지 않는다. snapshot은 모든 record가 이 고정 demo service·run provenance일 때만 `sampleMode=true`를 보내고 샘플 배너는 H/S/L 표시가 실제 점검 결과가 아니고 대상 네트워크 요청을 만들지 않았음을 명시한다. 실제 traffic이 하나라도 섞이면 sample mode로 표시하지 않는다.

## 6. 모듈 매핑

| 모듈 | 구현 |
|---|---|
| Capture | `burp/FlowScopeExtension` |
| Normalize/mask/classify | `core/Normalizer`, `Fingerprints`, `Masking`, `BurpXmlParser`, `HarParser`, `TrafficClassifier`, `ObservationCollapser` |
| Endpoint/parameter surface | `core/SurfaceAnalysis`, `core/SurfaceAnalyzer`, `core/RouteCandidateExtractor`, `core/parameter/*`(ParameterExtractor·ParameterCoordinates 공통 좌표), `core/discovery/*` |
| Identity/review state | `AccountProfile`, `AnalysisConfig`, `ReviewDecision`, `ValidationDecision` |
| Rules | `AuthorizationAnalyzer`, `DataFlowAnalyzer`, `EvidenceIds` |
| Graph model | `core/graph/*`, `web/SnapshotJsonWriter` |
| Product UI | `frontend/src`, `web/ClasspathWebAssets`, `web/FlowScopeWebServer`, legacy `resources/web/index.html`, `ui/FlowScopeControlTab` |
| Session/run | `integration/SessionBroker`, `core/RunContextRegistry`, `LaneCompletionPolicy` |
| LLM Explorer 실행 | `explorer/ExplorerCoordinator`, `CodexAppServerProvider`, `ExplorerHttpGateway`, `ExplorerAuthRuntime`, `ExplorerAccountVault` |
| 과거 LLM 데이터 | `core/LegacyAssessment`, `ValidationDecision`; 새 Explorer와 무관한 읽기 전용 이력 |
| 실행 실패 원장 | `integration/RunExecutionLedger`; 새 Explorer의 응답 전 실패와 응답 Evidence를 분리 |
| ZAP 실행·상태·취소 | `integration/ZapCampaign`(호스트 소유), `ZapClient`(API), `ZapBrowserAuthenticator`, `ZapAccountVault`, `ZapCampaign.State`(캡처·scope·직접 인증 계약) |
| Local setup | `integration/LocalSecretFile`, `LocalZapApiKey`, `infra/zap`, `scripts` |
| Persistence | `integration/SqliteProjectStore`, JSON codec/import-export `integration/ProjectStore` |

## 7. 명시적 한계

- 후보는 exploitability/business impact의 증명이 아니다.
- `UNCROSSED`는 관측된 identity와 관측된 operation/resource 안의 미실행 cell만 계산한다. 별도 route inventory는 구현됐지만 보존된 textual 응답(일반 기본 1MiB, 발견용 MIME 기본 4MiB, metadata-only면 8,192자 preview)과 응답 없는 Burp Site Map 항목에서 최대 20,000개만 만든다. JavaScript AST의 정적으로 해석 가능한 call-site 밖인 임의 wrapper·런타임 생성 경로·받지 않은 lazy chunk와 전체 블랙박스 공격면은 알 수 없다.
- domain-specific 또는 일반 principal 문맥이 아닌 중첩 ownership은 사용자 확정이 필요하다.
- 안정 신호 없는 opaque rotating token은 자동으로 같은 identity로 합칠 수 없으며 사용자 확인 binding이 필요하다.
- 쿠키 존재만으로 익명/로그인 여부를 완전히 알 수 없고 Fetch Metadata/MIME도 모든 클라이언트가 제공하지 않는다. 따라서 `UNRESOLVED`와 `REVIEW`가 정상 상태이며 분류의 오탐·미탐 0을 주장하지 않는다.
- data flow는 exact-value 보조분석이며 semantic taint가 아니다.
- source별 active run context는 하나이며 이미 활성화된 run과의 충돌을 거부한다. 종료도 정확한 run ID가 일치해야 한다.
- 세션 브로커는 일반 Cookie/Bearer/CSRF와 서버가 돌려주는 회전을 처리하지만 CAPTCHA/MFA/WebAuthn/device binding/application-specific refresh를 일반화하지 않는다. 이 경우 수동 재로그인이 필요하다.
- `ACTIVE` 전이는 자격증명 material 뒤 401·로그인 redirect·invalid-token이 아닌 2xx~4xx 응답을 관측한 transport-level 확인이다. 403은 역할 거부일 수 있어 세션 만료로 단정하지 않는다. 이는 서비스 고유 `/me` 의미, 실제 계정 소유, role을 자동 증명하지 않는다.
- 과거 버전의 ZAP anonymous 기준선 성공 기록은 `beta-validation.md`의 해당 artifact 범위다. D-132 Client-only JAR의 실제 capability·비로그인/로그인 lane·취소는 아직 미실행이며 과거 Traditional/AJAX 포함 수집 기록으로 대체하지 않는다.
- 그래프 API 그룹은 경로 첫 안정 세그먼트로 묶는 표시 단위이지 의미 기반 클러스터링이나 전체 API 추정이 아니다. `+18` 증분은 정렬 뒤 표시 제한이며 숨긴 API/객체의 Evidence는 identity→operation 선택에 그대로 남는다(`hiddenOperationCount/hiddenObjectCount`로 남은 수 표시). 20,000 record 상한은 별도로 Burp를 보호한다.
- Repeater handoff는 live 원문이 메모리에 있으면 그 원문, 아니면 마스킹 전문을 미전송 초안으로 연다. Repeater에서 사용자가 별도로 보낸 결과를 원 Evidence에 자동 연결하는 안정적인 Montoya correlation 계약은 없으므로 자동 validation에는 사용하지 않는다. Web 요청 실험실 전송만 서버가 직접 새 HUMAN `VALIDATION` Evidence로 기록한다.
- 포트 매핑은 확장 로드 시 시스템 속성으로 읽으므로 변경 후 Burp를 다시 시작한다.
- SQLite JDBC는 desktop native library를 포함한다. 자동 테스트의 현재 JDK에서는 로드 경고만 발생했지만, beta.44 fat JAR을 실제 Burp bundled JVM에서 load/unload하고 JSON v4·SQLite v3 프로젝트를 저장·재열기하는 수동 gate 전에는 모든 Burp/JVM·확장 조합의 런타임 호환을 완료로 주장하지 않는다.

세부 결정과 기각 대안은 `decisions.md`를 참조한다.
