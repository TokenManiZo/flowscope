# FlowScope 설계서 v1.2.0-beta.34

**화이트햇스쿨 2단계 팀 프로젝트, 토큰많이조**

사람·스캐너·LLM이 만든 실제 API 점검 트래픽을 하나의 신원 인지 그래프와 매트릭스에 정렬하고, BOLA/IDOR·BFLA 후보를 Evidence로 검증하는 Burp Suite 확장이다. `docs/ko/specification/functional-spec.md`가 WHAT, 이 문서가 HOW, `decisions.md`가 WHY의 정본이다. 화면별 사용자 질문과 발표 논리는 `ui-product-rationale.md`가 정본이다.

## 1. 제품 목표와 신뢰 경계

- 정본 목표는 “허가된 exact scope에서 관측 가능한 접근통제 공격면을 최대한 구조화하고, 신원·작업·객체·상태 흐름의 차이를 재현 가능한 Evidence로 검증해 사람이 놓치기 쉬운 경로와 인가 후보를 드러내는 것”이다.
- 플로우 그래프가 중심이다. 메인 관측을 `identity → API(operation) → object`로 재구성한다. 기본 화면은 `identity → API`, API 선택 후에만 object를 펼친다. `site → API group`은 선택형 전체 개요이며 메인 관계를 대체하지 않는다. 접기·그룹화·화면 전환은 표현일 뿐 원 Evidence 관계를 합치거나 삭제하지 않는다.
- 비교 축 `source={HUMAN,SCANNER,LLM}`와 판정 축 `identity/role/owner`를 섞지 않는다(D-001).
- LLM은 독립적인 세 번째 트래픽 소스이자 최종 Judge다. Explorer는 서버가 HUMAN/SCANNER 상태를 가린 상태에서 동작하고, Judge는 세 레인을 잠근 뒤에만 종합한다. 일반 assessment는 후보일 뿐이며, 최종 verdict는 별도 VALIDATION run의 통제 Evidence 묶음을 서버가 검증할 때만 허용한다(D-049/D-053/D-054).
- 블랙박스 전체 분모는 알 수 없으므로 커버리지 퍼센트를 만들지 않는다(D-002).
- 모든 액티브 도구는 명시적 exact scope 안에서만 동작한다. ZAP Active Scan은 Burp에서 다시 승인한다.
- 모든 endpoint 발견, 오탐·미탐 0, LLM 서술만으로 최종 확정은 보장하지 않는다. 완료 여부는 공개 fixture와 정답 격리 블라인드 benchmark에서 endpoint·객체·분류·finding 측정값, `REVIEW` 작업량, false positive·false negative·unresolved를 함께 공개하고 모든 후보·판정을 원본/재현/정상 대조 Evidence로 역추적할 수 있는지로 판단한다.

## 2. 단일 확장 아키텍처

```text
Browser :8080 ─┐
               ├─▶ Burp capture ─▶ mask/normalize ─▶ classify ─▶ graph + rules ─▶ Web UI
ZAP     :8081 ─┘        ▲                                  │
                        │ session broker                    │ locked snapshot
Web 실행 버튼 ─▶ 새 Codex/Claude CLI ─▶ MCP ─┬─▶ isolated Chrome/CDP discovery
                    ├─▶ independent LLM Explorer └─▶ controlled target executor Evidence
                    └─▶ separate final LLM Judge
                    └─▶ deterministic ZAP baseline     └─▶ validation gate

LLM :8082 = optional observed fallback; decisive validation에는 사용하지 않음
```

배포 토폴로지는 단일 컨테이너가 아니다. Burp와 구독 LLM CLI는 사용자 데스크톱의 인증·GUI·Montoya 경계를 유지하므로 호스트에서 실행한다. ZAP만 공식 2.17.0 이미지를 선택적으로 사용한다.

```text
host
├─ Burp + FlowScope JAR
│  ├─ HUMAN 127.0.0.1:8080
│  └─ SCANNER 127.0.0.1:8081 ◀──── ZAP upstream proxy
├─ ZAP Desktop 2.17.0 ───────────── API 127.0.0.1:8089  (택1)
├─ Codex CLI 또는 Claude Code ─────▶ FlowScope MCP 127.0.0.1:8787
└─ FlowScope Web 127.0.0.1:17777

optional Docker
└─ ZAP 2.17.0 ── API 127.0.0.1:8089 only  (택1)
```

ZAP 배포 방식은 캠페인 엔진과 분리한다. FlowScope는 loopback의 호환 ZAP API/version과 key 성공 여부만 확인하며 API 응답만으로 Desktop/컨테이너를 추측하지 않는다. Web 빠른 시작은 `범위 → HUMAN → ZAP → LLM·Judge` 네 단계 중 첫 미완료 단계 하나만 열고, 사용자가 상단 단계 버튼을 누른 경우에만 다른 제어면으로 이동한다. ZAP 단계는 연결 전 캠페인을 비활성화하고 Desktop 설정과 Docker Quick Start를 같은 수준의 접힌 선택지로 제공한다. `zap-key.sh`/`zap-key.ps1`은 Desktop 사용자도 owner-only key를 값 출력 없이 준비하게 한다.

선택형 `zap-up.sh` 또는 Windows `zap-up.ps1`은 같은 key helper를 사용하고, digest 고정 이미지의 ZAP Network API를 통해 `host.docker.internal:8081` upstream을 설정한 뒤 다시 읽어 검증한다. Linux는 Compose `host-gateway`, Docker Desktop은 공식 `host.docker.internal`을 사용한다. key 값은 container environment가 아니라 Compose file-backed secret으로 read-only mount한다. POSIX는 mode, Windows는 상속 차단·현재 SID 전용 ACL을 helper/doctor가 관리한다. FlowScope는 시스템 속성 key, 환경 key, 지정 key 파일, 기본 key 파일 순으로 읽으며 ZAP API URL 자체는 기존처럼 loopback만 허용한다. 이 편의 계층은 actual scanner capture·rendered crawl·대상 TLS를 완료로 대체하지 않는다(D-086, D-087, D-088).

- Java 21, Maven shade fat JAR. `montoya-api`는 Burp 제공 scope다. Jackson·jsoup·SnakeYAML은 base class와 MR-JAR 구현을 함께 `io.flowscope.shaded` 아래로 격리한다. sqlite-jdbc는 JNI 이름을 깨뜨리는 relocate를 하지 않고 원 패키지를 유지하며, 서로 다른 두 extension classloader의 동시 in-memory 연결을 회귀로 검사한다. package는 의존성 NOTICE·라이선스를 보존하고 version 숫자와 무관하게 MR-JAR 경로를 relocation한다. manifest-aware JAR 재구성과 `JarInputStream` gate로 streaming consumer에서도 Main-Class·Java-Version·Multi-Release를 읽을 수 있게 하며, 같은 입력의 반복 SHA-256 일치를 검사한다(D-090/D-092).
- Burp `registerSuiteTab`에는 범위·포트·프로젝트·MCP 상태를 다루는 작은 Swing 제어판만 둔다. 그래프·매트릭스·상세의 정본은 시스템 브라우저에서 여는 번들 Web UI다.
- Web UI는 번들 Cytoscape.js를 사용하며 외부 CDN이나 원격 자원을 요청하지 않는다. JCEF·JavaFX는 배포물에 포함하지 않는다.
- source view는 HUMAN=파랑·실선·H, SCANNER=빨강·파선·S, LLM=검정·점선·L의 평행 Evidence로 표시하며 `identity → API`와 `API → object` 두 구간 모두 같은 source 문법을 유지한다. 0건 source는 비활성화하고 필터 변경 시 전체 경로를 다시 계산한다. `GraphObservationFact`는 coverage 대상마다 `Evidence, identity, service, operation, object, source, run, phase, status, hasResponse, HTTP outcome`을 보존한다. 사이트의 API group은 `api/rest/vN` 구조 segment를 제외한 첫 안정 경로 segment로 만든 표시용 `PATH_SEGMENT` 분류이며 판정이나 정규화 key로 사용하지 않는다. 사이트 개요의 source 수는 반복 요청 횟수가 아닌 고유 operation 수이며 전체 request 수는 상세에 별도 보존한다. graph level별 viewport를 분리해 사이트·API·객체 전환이 다른 화면의 pan/zoom을 오염시키지 않는다. object는 family로 먼저 접고 사용자가 눌렀을 때 인스턴스를 펼친다. operation 라벨은 `/` 경계를 우선해 줄바꿈하고, 900px 이하에서는 같은 필터 결과의 API 목록을 표시한다. 응답→요청 데이터 의존성은 메인 접근 그래프가 아니라 `흐름 순서`에서만 표시한다(D-043/D-061/D-076/D-077/D-084/D-104/D-106).
- 프록시 리스너는 Montoya가 생성하지 못하므로 사용자가 HUMAN 8080과 ZAP 8081을 만든다. 8082는 외부 LLM 클라이언트 호환 폴백이며 해당 관측은 `UNVERIFIED_RUNTIME`이라 결정적 판정에 쓸 수 없다.
- 캡처 콜백은 append만 하고 400ms worker coalescing으로 분석한다. live record는 20,000건에서 정지하며 초과 건수를 snapshot과 Web 경고로 노출한다.
- MCP는 `127.0.0.1`에만 bind하고 random Bearer, Origin 검사, 1MiB 요청 상한을 적용한다.
- Web 서버도 `127.0.0.1`에만 bind한다. Host/Origin과 UI에 주입된 세션 capability를 검증하고 `no-store`, CSP, frame 차단 헤더를 보낸다. Burp 축소 JRE 호환을 위해 MCP와 같은 자체 `LoopbackHttpServer`를 재사용한다.
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
```

- `source`: 실제 대상 요청 생성자. ZAP은 지시자가 LLM이어도 SCANNER다.
- `orchestrator`: HUMAN/LLM/SYSTEM. source와 직교한다(D-036).
- `executionTrust`: `CONTROLLED/OBSERVED/UNVERIFIED_RUNTIME/IMPORTED/UNKNOWN`. `SourceTrustPolicy`가 소비 목적별 자격을 한 곳에서 판정한다. HUMAN 탐색 완료는 `OBSERVED/CONTROLLED`, SCANNER·LLM 탐색 완료와 dataset lock은 `CONTROLLED`, 최종 결정적 validation은 `CONTROLLED`만 허용한다. 8082 직접 fallback의 `UNVERIFIED_RUNTIME`은 원 Evidence에는 남지만 coverage·Explorer 가시성·레인 완료·잠금·최종 판정에서 제외한다.
- `service`: scheme://host:port. op/resource/identity 경계를 서비스별로 분리한다.
- `fp`: JWT subject 이름공간 또는 opaque token/cookie 단방향 지문. raw 인증값을 저장하지 않는다. 쿠키 fingerprint는 계정 연결·감사를 위한 안전한 식별자이지 로그인 증명이 아니다.
- `authState`: `ANONYMOUS/ACCOUNT_BOUND/UNRESOLVED`. 명시적 계정 연결이나 memory-only broker의 exact credential match만 `ACCOUNT_BOUND`가 된다. 계정에 연결되지 않은 cookie/session fingerprint는 서비스별 하나의 `UNRESOLVED` 그래프 신원으로 안정화하되 원 fingerprint는 Evidence에 남긴다.
- `requestPayload/responsePayload`: 저장 전 구조 마스킹된 전문의 SHA-256, byte 수, 보존 상태와 선택적 GZIP이다. 메시지당 기본 1MiB 이하 textual이며 digest 중복 제거 후 압축 전문 총량 48MiB 안에 있을 때만 `FULL`이다. binary, 메시지별 상한 초과, 압축 총량 상한 초과는 서로 다른 metadata-only 사유를 남긴다. 상한 초과 live 메시지 식별자는 최대 64KiB 마스킹 표현·실제 byte 수·보존 사유를 길이 구분해 digest하므로 같은 접두부의 다른 크기를 구분하지만 원문 전체 checksum은 아니다. 8KiB `reqText/respText/body`는 UI preview이며 전문과 같은 필드가 아니다.
- `resourceReferences`: path/query/body/GraphQL에서 실제 값으로 관측된 모든 객체 참조와 `PATH_ID/QUERY_ID/BODY_ID/GRAPHQL_VARIABLE/*_SEMANTIC_FIELD_CORROBORATED` 근거다. `resource`는 기존 인가 cell의 보수적 primary 하나다.
- `trafficClassification`: `API/AUTH_SESSION/NAVIGATION/STATIC_ASSET/DISCOVERY_METADATA/PREFLIGHT/TELEMETRY_CANDIDATE/POLLING/BACKGROUND/UNKNOWN`, `INCLUDE/EXCLUDE/REVIEW`, 근거와 사용자 override를 가진 비파괴 파생값이다. `INCLUDE`만 coverage/graph 입력이며 `REVIEW`와 `EXCLUDE`도 Evidence에서는 삭제되지 않는다.
- `RouteCandidate`: 응답 없는 Burp Site Map 항목 또는 저장된 exact-scope 응답에서 추출한 경로다. provenance는 type과 Evidence ID를 따로 모은 집합이 아니라 `type ↔ evidenceId ↔ source ↔ runId ↔ adapter ↔ applicability/reason`의 대응 관계로 보존한다. 실제 request/response 전에는 identity, coverage, verdict, finding을 갖지 않는다.
- `AccountProfile`: 서비스별 테스트 계정의 내부 ID·표시 이름·확정 역할만 저장한다. 로그인 ID·비밀번호·토큰은 받지 않는다.
- `sessionBindings`: `(service, fingerprint) → accountId`의 사용자 명시 연결이다. 키 하나는 계정 하나에만 귀속되며, 이미 연결된 지문을 다른 계정으로 옮기려면 먼저 기존 연결을 해제해야 한다. 실제 비인증 `anon`과 추출 실패 `unresolved`는 계정에 연결할 수 없다. 자동으로 합칠 수 없는 회전 세션을 검증된 계정 단위로 정렬한다.
- Cookie·Authorization·subject fingerprint는 한 principal 안의 기술 단서이지 로그인 세션 개수가 아니다. 기본 권한 카드는 principal을 한 줄로 표시하고 단서 종류·개수는 계정 화면의 접힌 진단에서만 보여 준다.
- `SessionBroker`: 사용자가 Web UI에서 명시적으로 시작한 HUMAN 로그인 구간의 Cookie/Authorization/CSRF만 프로세스 메모리에 보관한다. 자격증명 material만 관측하고 성공 응답을 확인하지 못하면 `UNVERIFIED`, 401·로그인 redirect·invalid token이면 `SUSPECT`, 비밀 삭제/만료면 `REAUTH_REQUIRED`다. account service와 exact scope가 모두 맞고 상태가 `ACTIVE`일 때만 ZAP/LLM 요청에 주입한다. HUMAN pass의 계정 선택은 표시 힌트가 아니라 검증 조건이며, 실제 요청 자격증명이 그 broker 계정과 exact match할 때만 계정 신원으로 귀속한다. 다른 계정이 같은 service에서 동시에 캡처되는 것을 거부한다. 캡처 중 동일 지문이 다른 계정에 이미 연결된 사실을 확인하면 현재 세션을 `SUSPECT` 충돌 상태로 고정하고 신원 귀속·주입에서 제외한다. raw 값은 UI/MCP/project에 나오지 않는다.
- `evidenceId`: 전체 의미 내용 digest 기반 ID. digest 입력은 외부 값의 개행과 필드 경계가 충돌하지 않도록 null 표식과 UTF-8 byte 길이 접두 framing을 사용한다. beta.23 이하 newline digest가 일치하면 기존 Evidence ID를 유지한 채 새 digest로 이행한다. 프로젝트 왕복에서는 `contentDigest`가 일치할 때만 기존 ID를 보존하고, 동일 관측은 순서 suffix로 유일화한다.
- `owner`: 노드가 아니라 resource 속성이다(D-006). 명시적 본문 필드나 사용자 확정만 판정 근거가 된다.

논리 프로젝트 schema v3는 마스킹된 RequestRecord, digest별 한 번 저장되는 GZIP 전문 blob, provenance가 있는 RouteCandidate, 계정·세션 지문 연결, role/requirement/owner 정책, operation별 traffic override, classifier version, LLM assessment, 서버 검증 `ValidationDecision`, Evidence-bound 사람 감사 기록과 **완료된 정확한 run**을 저장한다. 완료 run은 source만 저장하지 않고 `source/runId/detail/orchestrator/tool/phase/account/completedAt/evidenceIds/responseCount/coverageCount`를 묶는다. 기본 내구 저장은 SQLite storage schema v2의 기존 관계형 테이블과 `completed_runs`이며 JSON schema v3 codec을 공통 검증 경계로 재사용한다. `.flowscope.db`를 처음 저장하거나 열면 이후 revision을 30초 checkpoint로 합쳐 임시 DB에 transaction으로 쓴 뒤 atomic replace하고 정상 unload 직전 마지막 저장을 시도한다. `.flowscope.json` schema v1/v2는 읽을 수 있지만 source-only `completed_lanes`는 정확한 run과 Evidence를 증명하지 못하므로 완료 자격으로 복원하지 않고 세 레인을 다시 실행해야 한다. v3 내보내기는 exact completed run과 중복 표시용 `completed_lanes`의 일치를 검증한다. raw broker 세션은 어느 형식에도 저장하지 않는다. 전문은 메시지당 1MiB, 서로 다른 복원 전문 합계 48MiB 안에서 streaming GZIP 해제하며 digest/size/retention을 검증하고 동일 digest는 한 번만 복원한다. metadata-only 항목은 압축 blob을 허용하지 않는다. 로드한 validation은 현재 Evidence와 규칙 후보에 대해 다시 검증하며, 분류는 현재 결정론 classifier로 재계산한다. 파일은 100MiB 상한과 가능한 POSIX 0600을 적용한다. 이 SQLite 계층은 현재 20,000건 메모리 pipeline의 내구 snapshot이지 append-only server event store가 아니다(D-049/D-050/D-052/D-054/D-059/D-073/D-075/D-099/D-101).

## 4. 파이프라인

### 4.1 수집·마스킹 F-01~03/F-22

beta.34 live 경계는 Montoya byte 길이를 먼저 확인한다. 요청 1MiB·응답 4MiB를 넘으면 전체 Java 배열을 만들지 않고 크기만 raw vault에 전달하며, 저장 상한 1MiB를 넘는 메시지는 최대 64KiB만 복사해 decode·mask한다. 따라서 아래 `byte[]` 원문 보존은 각 raw 상한 이내 메시지에만 해당한다(D-101).

Proxy request handler가 listener port source를 보존하고 SCANNER/LLM의 범위 밖 요청을 송신 전에 차단한다. Proxy와 `Http.registerHttpHandler`가 받는 Repeater·Intruder·Target 등 비-Proxy Burp 도구는 각각 요청 `messageId`에 요청 시점 run/account/login-capture 문맥과 dataset epoch를 임시 보관하고 응답에서 한 번 소비한다. 따라서 HUMAN pass 종료 뒤 늦게 도착한 응답도 시작 당시 provenance로 귀속하고, 초기화·샘플 교체·프로젝트 열기 전 요청은 새 데이터셋에 들어오지 않는다. 상관 문맥이 없으면 응답 시점 context로 추측하지 않고 제외한다. in-flight 문맥은 채널별 20,000건·10분 상한을 두며 원 인증값이나 요청 전문은 이 상관 테이블에 저장하지 않는다. HUMAN 브라우저의 범위 밖 이동 자체는 막지 않지만 response capture 직전에 모든 source를 현재 exact scope로 검사하므로 범위 밖 응답은 저장·그래프화하지 않는다. 정상 수집된 비-Proxy HUMAN 응답도 broker에 전달해 같은 계정의 쿠키 회전을 반영한다. 사용자가 요청하면 기존 Proxy history도 원래 listener·시각·최종 요청·응답으로 가져오되 scope 밖 item을 제거한다. 재가져오기는 관측 횟수를 보존하는 multiset 병합으로 이미 반영된 사본만 제외한다. Authorization/Cookie/Set-Cookie와 password/token/secret/api-key류는 header와 JSON/form/multipart/XML 구조를 따라 저장 전에 마스킹한다. 마스킹된 textual 전문은 메시지당 기본 1MiB, digest 중복 제거 후 압축 총량 48MiB까지 GZIP으로 보존하고 8KiB preview를 별도로 유지한다. binary·메시지별/총량 상한 초과 전문은 크기·bounded 식별자·사유만 보존해 잘린 내용을 완전 Evidence처럼 쓰지 않는다. Burp XML도 같은 보존 정책을 적용하며 XXE를 차단하고 불완전 item을 이유와 함께 skip한다. ZAP HAR 1.2 폴백은 `log.entries`의 request/response를 `SCANNER/HAR_IMPORT/ZAP/IMPORT/IMPORTED`로 변환하고 동일 scope·마스킹·payload 상한을 적용한다. `status=0`은 응답 없는 후보로 보존하고 binary base64 응답은 문자열로 왜곡하지 않고 metadata-only로 둔다. HAR에는 ZAP Alert와 campaign completion 계약이 없으므로 둘을 생성하지 않는다(D-093).

live HTTP 원문은 별도의 `TransientExchangeVault`에 요청·응답 `byte[]`와 각각의 body offset으로만 둔다. 요청 1MiB, 응답 4MiB, 총 32MiB 기본 상한과 오래된 항목 우선 제거를 적용하고 초기화·샘플 교체·프로젝트 열기·확장 종료 시 지운다. 이 값은 `RequestRecord`, snapshot, SQLite/JSON, 로그, MCP로 전달하지 않으며 사용자가 특정 Evidence의 요청 실험실을 열었을 때만 localhost capability API가 표시용 텍스트를 만든다. 헤더는 ISO-8859-1, textual 본문은 명시된 Content-Type charset 또는 기본 UTF-8로 replacement 없이 엄격히 디코딩한다. 바이너리, 알 수 없는 비텍스트, 잘못된 byte sequence는 원문 바이트는 유지하되 Web 텍스트 편집·전송을 차단한다. 수정하지 않은 요청과 Repeater 초안은 원래 바이트를 그대로 사용하며, 실제 편집한 본문만 선언 charset으로 엄격히 재인코딩한다. Java `String`과 HTTP/browser 복사본은 완전한 메모리 소거를 보장하지 못하므로 이를 영구 비밀 저장소로 표현하지 않는다. 가져온 프로젝트/XML/HAR, 상한 초과 Evidence에는 raw가 없어 마스킹 전문만 표시하고 Web 전송은 허용하지 않는다(D-084/D-093).

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
  → format adapter(HTML / static JS / OpenAPI JSON·YAML / metadata / generic XML)
  → DiscoveredRoute(raw reference, method proof, provenance, reason)
  → common core(exact scope → method validation → URI/path normalization → dedup/provenance merge)
  → RouteCandidate
```

어댑터는 네트워크를 사용하거나 scope·관측 여부를 결정하지 않는다. 공통 코어만 unsupported scheme과 범위 밖 참조를 버리고, 명시적 method 근거가 없으면 `UNKNOWN`으로 유지하며, `service + method/UNKNOWN + normalized path`로 병합한다. 관측된 `GET`과 같은 path의 미관측 `UNKNOWN`은 서로 다른 후보이고, `UNKNOWN`을 관측으로 승격하지 않는다. HTML은 로컬 HTML5 DOM 파서로 깨진 markup과 `<base>`를 처리하고, OpenAPI는 대상 응답에서 관측한 JSON/YAML만 읽으며, XML은 제품명 없는 명시 URL/method 필드만 XXE 차단 DOM으로 읽는다. 추출된 후보는 관측 분석 파이프라인에 다시 넣지 않는다.

### 4.4 소유자·판정 F-10~11

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

### 4.5 비교·그래프 F-07~15/F-20~24

CoverageCell 키는 `(identity, operation, resource)` tuple이다. 일반 기존 셀은 finding/review ID 호환을 위해 기존 stable key를 유지하고, 외부 입력에 `|` 또는 실제 `<none>` 값이 있는 셀만 `v2` byte 길이+hex framing을 써 충돌을 막는다. 소스별 5-state verdict를 보존하고 다음 갭을 계산한다.

- UNCROSSED: 확정 소유자가 있는 관측 operation/resource를 다른 관측 identity가 시도하지 않음.
- PARTIAL_DISCOVERY: 활성 소스 중 일부만 같은 cell을 실행.
- CONFLICT: 같은 cell의 소스 verdict가 다름.

데이터 Flow 엣지는 같은 identity에서 이전 응답의 ID/token이 30분 안의 뒤 요청 path/query/body에 실제 소비될 때만 만든다. 단순 시간순 엣지는 만들지 않는다(D-019). 현재 소비 판정은 exact substring 보조분석이며 semantic taint가 아니므로 동일 부분문자열 오연결과 전체 조합 O(N²)은 별도 성능·정확성 부채다.

### 4.6 세션·LLM·ZAP F-16~19

로컬 Codex/Claude CLI가 사용자의 기존 구독 로그인으로 모델을 실행한다. FlowScope는 model OAuth/API key를 받지 않는다. Web quick-start는 공급자·exact target·선택적 ACTIVE 계정을 받아 새 자식 프로세스를 실행하며, 수동 `agent-workspace` 실행은 호환 폴백이다.

- `LocalLlmRunner`는 shell을 거치지 않는 인자 배열로 실행 파일을 호출한다. 실행 파일은 시스템 속성 또는 Burp 시작 `PATH`의 regular executable만 허용한다. MCP Bearer는 자식 환경 `FLOWSCOPE_MCP_TOKEN`으로만 전달하며 command line·prompt·project·status output에 넣지 않는다. 구독 로그인 경계를 위해 상속된 `OPENAI_API_KEY`·`ANTHROPIC_API_KEY`는 제거한다.
- Explorer는 owner-only 임시 작업공간에서 시작한다. Codex는 기존 사용자 홈 대신 owner-only 임시 `CODEX_HOME`을 사용하고 원 홈의 `auth.json`만 링크한다. 따라서 구독 로그인은 유지하지만 전역 `config.toml`, 사용자 skill/plugin, memory와 이전 session은 보이지 않는다. `exec --ephemeral --ignore-user-config --ignore-rules --strict-config`, read-only/no-approval, shell·브라우저·검색·외부 tool feature 비활성화와 모델 shell의 MCP token 제외를 함께 적용한다. Claude는 strict 임시 MCP 설정, 빈 setting sources, auto-memory 비활성화, 역할별 도구 allowlist와 `--no-session-persistence`를 사용한다. 기존 세션을 resume하지 않으며 서버가 exact LLM run을 먼저 발급하고 CLI가 그 run을 정상 종료하지 않으면 abort·실패 처리한다.
- Judge는 Explorer와 별개의 새 provider session으로 시작한다. Codex JSON의 `thread_id` 또는 FlowScope가 만든 Claude `session-id`를 보존하고, 사용자의 `Judge 계속` 요청만 exact ID로 resume한다. 이는 논리적 대화 지속이며 CLI 프로세스를 계속 실행해 두는 구조가 아니다.
- 일부 Claude Code 버전이 no-persistence 실행에서도 provider metadata를 남길 수 있다는 외부 상태는 삭제로 가장하지 않는다. 고유 임시 작업공간과 no-resume으로 논리적 오염을 막고 UI에 잔존 가능성을 표시한다.
- CLI 원출력은 마스킹·64 KiB 상한을 적용한 tail로만 보존한다. 이와 별도로 provider JSONL을 최대 32 KiB/line·200 events로 구조화해 약 1초 polling의 **LLM 작업 피드**에 모델 메시지, MCP 도구명·시작/완료, Evidence 완료 게이트만 표시한다. reasoning/thinking event, tool 원문 인자·결과와 자격증명은 피드에 넣지 않는다. 주입 prompt는 secret masking·24 KiB 상한 뒤 운영자가 확인할 수 있다. Codex session ID는 긴 출력에서 tail이 밀려나도 잃지 않도록 별도 bounded prefix에서 읽는다.
- 활성 run 또는 잠긴 dataset이 있으면 Burp UI의 scope 변경도 거부한다. MCP lock 뒤 대상 의미가 바뀐 채 같은 Judge 세션이 계속되는 경로를 허용하지 않는다.
- 같은 source의 새 exploration이 시작되면 과거 완료 run은 즉시 제거한다. 모든 정상 종료는 `LaneCompletionPolicy` 하나를 거쳐 동일 source·exact run ID·EXPLORATION·응답·목적별 trust를 검사하고 완료 당시 Evidence ID 목록을 동결한다. 실패·취소·0-Evidence는 `abort`만 수행한다. 재실행이 실패·취소되면 그 source는 미완료로 남고 Judge 버튼과 서버 lock 모두 닫힌다.

- 기본은 closed-world다. 공급된 agent-workspace는 web search, Wayback, 외부 API 문서·소스 저장소, curl·브라우저 네트워킹을 금지한다. 대상 내부 문서는 exact-scope 통제 응답으로 실제 관측된 경우만 사용할 수 있다.
- Explorer의 target surface는 API-first 네 층이다. 기본 전송은 `flowscope_target_read/request`이며 BOLA/BFLA/IDOR의 Evidence를 만드는 유일한 경로다. HTTP frontier가 SPA shell·JavaScript 상태·UI 전이 때문에 막힐 때만 `flowscope_browser_navigate/snapshot`이 설치된 Chrome/Chromium/Edge를 incognito 임시 user-data-dir로 실행해 렌더링 DOM·링크·폼·SPA network를 bounded discovery hint로 돌려준다. browser worker는 8082 listener를 거치지 않고 CDP `Fetch`에서 exact scope 밖을 송신 전에 차단한다. broker는 run 시작 시 고정한 계정의 세션만 같은 scheme·host·effective port 요청에 주입하며 Explorer tool argument로 다른 account를 선택할 수 없다. CLICK/FILL은 행위 자체가 아니라 결과로 발생한 실제 비안전 메서드 요청마다 메서드·URL·마스킹 body preview를 Burp dialog로 승인받고, 거부 시 해당 request만 `BlockedByClient`로 중단한다. password/file input은 계속 거부한다. runtime network route는 `BROWSER_RUNTIME/evidence_backed=false` frontier로 등록되며 controlled executor 재현 전에는 Evidence가 아니다. 8082 직접 프록시 사본도 `UNVERIFIED_RUNTIME`이고, controlled executor의 `CONTROLLED` 응답만 완료 gate에 들어간다.
- `flowscope_list_route_candidates(view=INDEPENDENT)`는 provenance를 현재 `LLM + runId`로 잘라 applicability/reason을 다시 계산한다. route 방문 여부는 classifier의 coverage 자격을 재사용하지 않고, 해당 run의 `CONTROLLED` 응답이 같은 service·concrete path·method에 있는지로 판정한다. 따라서 navigation/static route를 실제로 방문하면 메인 BOLA/BFLA coverage에서는 제외하더라도 frontier는 소진된다. concrete GET/HEAD/OPTIONS/UNKNOWN 경로가 남아 있으면 `ASSISTED` 전환을 거부한다. 독립 safe frontier가 소진된 뒤 `view=ASSISTED`는 HUMAN·SCANNER 등 다른 레인이 발견한 exact-scope route 문자열만 blind hint로 반환하고 source, run ID, Evidence ID, provenance, 응답과 성공 여부를 제거한다. 따라서 독립 탐색 측정은 선행 단계로 고정하면서 후속 미탐 보완은 허용한다(D-106).
- captured/coverage/excluded/review와 source별 coverage count도 같은 가시성 경계를 적용해 Explorer에게는 현재 LLM run 값만 보인다.
- lock 전 active Explorer가 없을 때도 MCP status는 다른 lane의 수량·active run·gap/finding을 공개하지 않는다. Explorer 중에는 ZAP 상태/실행과 기존 assessment/validation 조회를 거부한다.
- HUMAN, 시스템 ZAP, 독립 LLM이 정확한 run 종료를 완료하고 각 완료 묶음에 coverage 가능한 Evidence가 있어야 `flowscope_lock_dataset`이 성공한다. 레코드 존재, CLI exit 0, ZAP 실패/종료 상태, source-only 프로젝트 표식은 완료가 아니다.
- dataset lock은 각 완료 run이 동결한 Evidence ID만 다시 검증해 Pipeline 결과와 route candidate inventory를 함께 snapshot한다. 같은 run ID의 후발·imported·unverified record도 자동으로 섞이지 않는다. lock 이후 validation/coach traffic이나 background candidate rebuild는 Judge가 보는 record 수·route 목록·후보를 바꾸지 않는다.
- Judge는 잠긴 후보/소유자/역할 기준과 ZAP native alert를 종합한다. 잠금 뒤 새 검증 트래픽은 현재 Evidence 저장소에서 읽되 후보 오라클은 잠긴 snapshot을 유지한다.
- MCP exact-scope 교체는 로컬 capability를 가진 클라이언트가 사용자가 명시한 범위를 자동 설정할 때만 허용하며, SCANNER/LLM run 중에는 거부한다.
- HUMAN pass는 Web quick-start에서 exact run lease로 시작·종료해 임의 브라우저 트래픽과 기준선 수행 구간을 구분한다. 계정 pass 시작은 해당 broker 세션이 `ACTIVE`일 때만 허용하고, 관측 요청의 자격증명이 선택 계정과 다르면 그 계정으로 기록하지 않는다.
- 일반 assessment는 기존 Evidence ID와 `LIKELY/INCONCLUSIVE/REJECTED`만 허용하며 최종 판정이 아니다. type 64자, title 256자, reason 4,096자, Evidence ID 200개·각 256자, 전체 1,000건·4MiB 상한을 MCP와 프로젝트 저장·복원에 동일 적용한다.
- 최종 validation은 현재 결정론 finding을 대상으로 원본 Evidence, 동일한 비기본 LLM VALIDATION run의 `CONTROLLED` 반복 재현 2건 이상, 정상 대조 1건 이상을 서로 겹치지 않게 요구한다. 신원·operation·resource·응답 의미가 맞지 않거나 write method이면 베타에서 `INCONCLUSIVE`다.
- 최종 verdict는 `CONFIRMED/INCONCLUSIVE/REJECTED`다. `CONFIRMED`는 반복 성공, `REJECTED`는 반복 명시 거부일 때만 허용하며 BOLA의 정상 대조는 확인된 소유자, BFLA의 정상 대조는 사용자 역할 정책과 일치해야 한다.
- 사람의 확정/미확정/폐기 기록은 Evidence-bound 감사·오버라이드다. 원본 Evidence 집합이 달라지면 과거 기록을 자동 승계하지 않는다.
- 로컬 구독 CLI 실행은 JVM 절대경로 override, 상속 `PATH`, macOS/Linux의 `~/.local/bin`·Homebrew·`NVM_BIN`·`PNPM_HOME`·`BUN_INSTALL`, Windows의 WinGet/npm 사용자 경로 순으로 Codex/Claude 실행 파일을 해석한다. `codex login status`와 `claude auth status --json`을 provider API key가 제거된 자식 프로세스로 실행하고 계정 식별자나 원출력을 저장하지 않은 채 `CHECKING/READY/LOGIN_REQUIRED/NOT_INSTALLED/ERROR`만 30초 캐시한다. Web polling은 이 캐시만 읽고, 실행 버튼은 시작 직전에 같은 preflight를 다시 통과해야 한다. 해석된 실행 파일의 부모 디렉터리를 실제 실행 자식 `PATH` 앞에 보존해 `#!/usr/bin/env node` launcher의 런타임 탐색을 돕는다. beta.28의 skill 열거는 실제 격리가 아니므로 폐기했고, Codex는 로그인 `auth.json`만 임시 `CODEX_HOME`에 링크해 사용자 config·skill·plugin·memory와 분리한다. 심볼릭 링크가 불가능하면 hard link, 최종 fallback은 owner-only 임시 복사본이며 workspace 종료 때 삭제한다.
- Explorer의 발견·읽기·쓰기는 MCP 계약부터 분리한다. Explorer run 중 `tools/list`는 status/session, 브라우저 navigate/snapshot/승인형 interact/close, read/승인형 write, 단계형 route/Evidence, end-run의 12개만 반환해 ZAP·Judge·scope 도구를 선택 표면에서 제거한다. 호출 단계의 권한 검사는 별도로 유지한다. 첫 동작은 exact entry target의 `flowscope_target_read` GET이며, HTTP 응답과 safe route frontier를 우선 순회한다. `flowscope_target_read`는 GET/HEAD/OPTIONS만 받고 destructive hint가 false이며, `flowscope_target_request`는 POST/PUT/PATCH/DELETE와 `confirmed=true`·Burp 승인을 요구한다. 정적 응답만으로 진행할 수 없는 rendered-app 조건에서만 browser fallback을 사용하고, 발견 route는 controlled executor로 재현한다. 이후 INDEPENDENT safe concrete frontier를 소진한 다음 provenance-free ASSISTED hint를 순회한다. `flowscope_end_run`은 같은 source/run/phase의 응답 Evidence, 두 frontier 조회, 종료 시점 safe concrete route 0건을 모두 검사하고 활성 브라우저가 있으면 종료해 임시 profile을 삭제한다. 동적 `{id}`와 미승인 상태 변경 route는 최종 미검증 목록에 남긴다. launcher도 CLI 종료 뒤 exact run Evidence와 completed run을 재확인한다.
- 기본 ZAP 캠페인은 `orchestrator=SYSTEM`이다. 시작 전에 ZAP version API, `network`를 포함한 안전 add-on, outgoing proxy enabled와 Desktop `127.0.0.1:8081` 또는 Docker `host.docker.internal:8081`을 확인하고, 누락·불일치 시 대상 트래픽 전에 실패한다. Web/MCP에서 비로그인과 복수 ACTIVE 계정을 선택하면 비로그인 → 선택 계정 순으로 실행하며, 각 신원 앞에서 ZAP `core/newSession`을 호출해 crawler/cookie 상태를 분리한다. 운영자가 이미 알고 있는 OpenAPI·GraphQL·Postman·SOAP 정의를 최대 20개 명시하면 URL·GraphQL endpoint를 exact scope로 검증하고 fresh Context 안에서 정의별 최대 1,000 message의 동기 import를 먼저 실행한다. 이름 기반 URL 추측은 하지 않는다. 이어 passive scanner 활성화 → 전체 passive rule 활성화 → scope-only 설정 → Traditional Spider → strict Client Spider → AJAX Spider → Passive 분석 → native Alert 전 페이지 수집 순서를 고정한다. Client와 AJAX의 결과 집합이 완전히 같다고 가정하지 않으므로 둘 다 실행한다. 정의 import와 rendered crawler 실패는 다른 Evidence를 버리지 않고 lane warning으로 보존한다. Passive는 절대 30분, queue 감소·현재 task 변화가 없는 정체 10분을 경계로 추적한다. 정체나 절대 제한에 도달하면 현재까지의 Alert를 먼저 snapshot하고 `passive_complete=false`, 남은 queue와 현재 task를 공개한 `COMPLETED_WITH_WARNINGS`로 보존한다. 이어 `clearQueue` 뒤 queue 0과 current task 0을 모두 확인해야 다음 신원을 시작하며, 확인하지 못하면 후속 lane은 `NOT_RUN/BLOCKED_BY_ISOLATION`이다. Passive 단계 전 실패도 다음 신원이 있으면 같은 queue/task 정리 검증을 통과해야 하며 실패하면 후속 lane을 차단한다. 완료 gate와 stage count는 400ms debounce가 있는 분석 `Pipeline.Result`가 아니라 응답 callback이 추가한 raw record 저장소를 `source + runId + sourceDetail`로 센다. 신원별 전체 capture가 0이면 캠페인을 실패시키고, Alert API는 500개씩 반복 호출해 신원별 최대 20,000개 상세를 메모리 snapshot에 보존한다. LLM이 scanner 단계를 고르지 않는다. 상태 계약은 campaign/lane/stage 시작 시각과 세션 설정 1분·API 정의 한 건당 2분·Traditional 15분·Client 20분·AJAX 20분·Passive 30분 제한, 매 status poll heartbeat, 마지막 raw capture/status 변화, queue 순번·대기 이유, Passive 남은 수·현재 task와 Alert snapshot 완결성을 메모리에서 추적한다. 실제 단계 전환·Passive 감소·Alert 집계·격리 정리는 비밀 마스킹된 이벤트 최대 120건의 current-process 목록으로 남기고 Web이 1초마다 조회한다. heartbeat 10초 초과, 응답 정상이나 새 트래픽 30초 초과, 단계 deadline 초과를 서로 다른 운영 상태로 내보내며 이는 scan 성공이나 취약점 verdict가 아니다.
- 관리형 계정 ZAP/LLM 요청은 기존 Authorization/Cookie/Proxy-Authorization/CSRF를 제거하고 broker의 현재 `ACTIVE` 세션만 주입한다. fresh ZAP anonymous lane은 Authorization과 Proxy-Authorization을 제거하되 그 lane 안에서 서버가 새로 발급한 익명 Cookie/CSRF는 상태형 탐색을 위해 유지한다. 이 lane-local 쿠키는 계정 증명이 아니므로 신원 fingerprint는 계속 `anon`으로 고정한다. 수동으로 직접 실행해 FlowScope run context가 없는 scanner 트래픽은 관측만 하고 헤더를 바꾸지 않는다. 쿠키 회전은 응답의 Set-Cookie로 broker에 갱신하며, UNVERIFIED/SUSPECT/만료 세션은 사용자가 HUMAN 로그인 캡처를 다시 해야 한다.
- Web scanner target 목록과 시작 API는 자기 자신의 `127.0.0.1:<web-port>` 제어면을 제외한다. localhost의 실제 점검 대상까지 포괄 차단하지 않고 현재 Web port만 차단한다.
- Active Scan은 scope + MCP confirmed + Burp dialog의 세 조건을 모두 요구한다.
- API 정의 import도 생성된 명세 method가 상태를 바꿀 수 있으므로 정의가 하나 이상이면 별도 Burp dialog 승인을 요구한다. 거부되면 fresh session이나 대상 요청 전에 캠페인 시작을 중단한다.

- ZAP `scanOnlyInScope`는 FlowScope 허용목록이 아니라 ZAP Context를 읽는다. 따라서 각 fresh session에 선택 target의 origin·path subtree만 매치하는 Context를 만들고 in-scope로 표시한 뒤 passive rule을 활성화·재확인한다. regex 회귀는 sibling path, subdomain, 다른 scheme/port를 거부한다.

## 5. UI

| 작업면 | 역할 |
|---|---|
| 그래프 | `사이트 → API 그룹` 개요, `identity → API` 비교, 선택 API의 `identity → API → object` 상세를 분리한다. 객체는 family로 접고 선택 시 인스턴스를 펼친다. 화면 집계와 무관하게 Fact Core의 Evidence 관계를 보존한다. 긴 경로는 생략하지 않고 줄바꿈하며 미요청 route는 중립 후보로 분리한다. |
| 판정 매트릭스 | identity/role × operation × resource의 소스별 판정과 3종 갭 |
| 흐름 순서 | 응답 값이 뒤 요청에 사용된 실제 데이터 의존성 |
| 시나리오 | BOLA/BFLA 규칙 후보·갭·LLM assessment·서버 검증 최종 verdict와 사람 감사 |
| 파싱 결과 | 마스킹된 source/identity/method/operation/resource/status, traffic class/disposition/reason, 반복 수, stable Evidence ID. 행 선택은 operation 상세와 페이지형 Evidence로 연결 |
| 계정·세션 | 전체 폭 계정 등록, HUMAN 로그인 캡처, broker 상태/재인증/폐기, 발견 지문 비교와 명시 연결·해제 |
| 빠른 시작 | HUMAN run, 결정론적 ZAP 대상·비로그인/복수 계정 선택·신원별 단계/수집/Alert 상태, 독립 Explorer와 잠금 후 Judge 순서 |
| 공통 우측 | 선택 API의 지연 로드된 마스킹 Request/Response, Web 요청 실험실, Repeater 미전송 초안 |
| Burp 제어판 | exact scope, 세 레인 포트, Web UI 열기, MCP 연결 복사, Proxy history, project I/O, sample/reset |

관측 Evidence가 0건이면 분석 패널을 숨기고 `scope → 계정 로그인/HUMAN → ZAP → Explorer/Judge` 네 단계와 빠른 시작·샘플 조작만 먼저 노출한다. Evidence가 생기면 위 분석 작업면으로 전환한다. 이 progressive disclosure는 분석 모델을 줄이지 않고 첫 행동만 분리하며, ADMIN은 BFLA 역할 비교가 필요할 때만 선택적으로 추가한다(D-057).

번들 `SampleProject`는 `demo.flowscope.test`의 합성 H/S/L record만 만들며 대상 네트워크를 호출하지 않는다. snapshot은 모든 record가 이 고정 demo service·run provenance일 때만 `sampleMode=true`를 보내고 Web 상단에 “실제 HUMAN/ZAP/LLM 점검 결과 아님·네트워크 요청 0건”을 표시한다. 실제 traffic이 하나라도 섞이면 sample mode로 표시하지 않는다.

## 6. 모듈 매핑

| 모듈 | 구현 |
|---|---|
| Capture | `burp/FlowScopeExtension` |
| Normalize/mask/classify | `core/Normalizer`, `Fingerprints`, `Masking`, `BurpXmlParser`, `HarParser`, `TrafficClassifier`, `ObservationCollapser` |
| Identity/review state | `AccountProfile`, `AnalysisConfig`, `ReviewDecision`, `ValidationDecision` |
| Rules | `AuthorizationAnalyzer`, `DataFlowAnalyzer`, `EvidenceIds` |
| Graph model | `core/graph/*`, `web/SnapshotJsonWriter` |
| Product UI | `web/FlowScopeWebServer`, `resources/web/index.html`, `ui/FlowScopeControlTab` |
| Session/LLM/ZAP | `integration/SessionBroker`, `McpServer`, `ZapClient`, `RunContextRegistry` |
| Local setup | `integration/LocalSecretFile`, `LocalZapApiKey`, `infra/zap`, `scripts` |
| Persistence | `integration/SqliteProjectStore`, JSON codec/import-export `integration/ProjectStore` |

## 7. 명시적 한계

- 후보는 exploitability/business impact의 증명이 아니다.
- `UNCROSSED`는 관측된 identity와 관측된 operation/resource 안의 미실행 cell만 계산한다. 별도 route inventory는 구현됐지만 기본 1MiB 이하로 보존된 textual 응답(초과/metadata-only면 8KiB preview)과 응답 없는 Burp Site Map 항목에서 최대 20,000개만 만들며, 동적 JavaScript·런타임 생성 경로·전체 블랙박스 공격면을 안다고 주장하지 않는다.
- domain-specific 또는 일반 principal 문맥이 아닌 중첩 ownership은 사용자 확정이 필요하다.
- 안정 신호 없는 opaque rotating token은 자동으로 같은 identity로 합칠 수 없으며 사용자 확인 binding이 필요하다.
- 쿠키 존재만으로 익명/로그인 여부를 완전히 알 수 없고 Fetch Metadata/MIME도 모든 클라이언트가 제공하지 않는다. 따라서 `UNRESOLVED`와 `REVIEW`가 정상 상태이며 분류의 오탐·미탐 0을 주장하지 않는다.
- data flow는 exact-value 보조분석이며 semantic taint가 아니다.
- source별 active run context는 하나이며 겹치는 LLM/ZAP run 시작은 거부한다. 종료도 정확한 run ID가 일치해야 한다.
- 세션 브로커는 일반 Cookie/Bearer/CSRF와 서버가 돌려주는 회전을 처리하지만 CAPTCHA/MFA/WebAuthn/device binding/application-specific refresh를 일반화하지 않는다. 이 경우 수동 재로그인이 필요하다.
- `ACTIVE` 전이는 자격증명 material 뒤 401·로그인 redirect·invalid-token이 아닌 2xx~4xx 응답을 관측한 transport-level 확인이다. 403은 역할 거부일 수 있어 세션 만료로 단정하지 않는다. 이는 서비스 고유 `/me` 의미, 실제 계정 소유, role을 자동 증명하지 않는다.
- ZAP 2.17의 실제 anonymous fresh-session 기준선은 Burp 8081을 통해 crAPI에서 완료됐고, 수집 8건이 모두 `SCANNER/CONTROLLED/ANONYMOUS`로 귀속됐다. USER A/B broker 주입과 전역 ZAP replacer/script가 임의 Cookie를 강제하는 비표준 설정은 별도 실환경 gate다.
- closed-world는 제공 agent 지침과 MCP 도구 경로에는 강제되지만 사용자가 개조한 에이전트나 별도 로컬 프로세스의 외부 통신까지 차단하는 OS sandbox는 아니다. exact scope, 가시성, Evidence trust, verdict gate는 서버에서 별도로 강제한다.
- 그래프 접기는 의미 기반 클러스터링이 아니라 현재 필터 결과를 객체/API별 18개 단위로 늘리는 표시 페이지다. 20,000 record 상한은 별도로 Burp를 보호한다.
- Repeater handoff는 live 원문이 메모리에 있으면 그 원문, 아니면 마스킹 전문을 미전송 초안으로 연다. Repeater에서 사용자가 별도로 보낸 결과를 원 Evidence에 자동 연결하는 안정적인 Montoya correlation 계약은 없으므로 자동 validation에는 사용하지 않는다. Web 요청 실험실 전송만 서버가 직접 새 HUMAN `VALIDATION` Evidence로 기록한다.
- 포트 매핑은 확장 로드 시 시스템 속성으로 읽으므로 변경 후 Burp를 다시 시작한다.
- SQLite JDBC는 desktop native library를 포함한다. 자동 테스트의 현재 JDK에서는 로드 경고만 발생했지만, beta.34 fat JAR을 실제 Burp bundled JVM에서 load/unload하고 JSON v3·SQLite v2 프로젝트를 저장·재열기하는 수동 gate 전에는 모든 Burp/JVM·확장 조합의 런타임 호환을 완료로 주장하지 않는다.

세부 결정과 기각 대안은 `decisions.md`를 참조한다.
