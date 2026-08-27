# FlowScope 설계서 v1.2.0-beta.9

**화이트햇스쿨 2단계 팀 프로젝트, 토큰많이조**

사람·스캐너·LLM이 만든 실제 API 점검 트래픽을 하나의 신원 인지 그래프와 매트릭스에 정렬하고, BOLA/IDOR·BFLA 후보를 Evidence로 검증하는 Burp Suite 확장이다. `docs/ko/specification/functional-spec.md`가 WHAT, 이 문서가 HOW, `decisions.md`가 WHY의 정본이다. 화면별 사용자 질문과 발표 논리는 `ui-product-rationale.md`가 정본이다.

## 1. 제품 목표와 신뢰 경계

- 플로우 그래프가 중심이다. 요청 목록을 `identity → resource → operation`으로 재구성한다.
- 비교 축 `source={HUMAN,SCANNER,LLM}`와 판정 축 `identity/role/owner`를 섞지 않는다(D-001).
- LLM은 독립적인 세 번째 트래픽 소스이자 최종 Judge다. Explorer는 서버가 HUMAN/SCANNER 상태를 가린 상태에서 동작하고, Judge는 세 레인을 잠근 뒤에만 종합한다. 일반 assessment는 후보일 뿐이며, 최종 verdict는 별도 VALIDATION run의 통제 Evidence 묶음을 서버가 검증할 때만 허용한다(D-049/D-053/D-054).
- 블랙박스 전체 분모는 알 수 없으므로 커버리지 퍼센트를 만들지 않는다(D-002).
- 모든 액티브 도구는 명시적 exact scope 안에서만 동작한다. ZAP Active Scan은 Burp에서 다시 승인한다.

## 2. 단일 확장 아키텍처

```text
Browser :8080 ─┐
               ├─▶ Burp capture ─▶ mask/normalize ─▶ classify ─▶ graph + rules ─▶ Web UI
ZAP     :8081 ─┘        ▲                                  │
                        │ session broker                    │ locked snapshot
Web 실행 버튼 ─▶ 새 Codex/Claude CLI ─▶ MCP ─▶ controlled target executor
                    ├─▶ independent LLM Explorer       final LLM Judge
                    └─▶ deterministic ZAP baseline     └─▶ validation gate

LLM :8082 = optional observed fallback; decisive validation에는 사용하지 않음
```

- Java 21, Maven shade fat JAR. `montoya-api`는 Burp 제공 scope다.
- Burp `registerSuiteTab`에는 범위·포트·프로젝트·MCP 상태를 다루는 작은 Swing 제어판만 둔다. 그래프·매트릭스·상세의 정본은 시스템 브라우저에서 여는 번들 Web UI다.
- Web UI는 번들 Cytoscape.js를 사용하며 외부 CDN이나 원격 자원을 요청하지 않는다. JCEF·JavaFX는 배포물에 포함하지 않는다.
- source view는 HUMAN=파랑·실선·H, SCANNER=빨강·파선·S, LLM=검정·점선·L의 평행 Evidence로 표시한다. 일반 UI 조작의 accent와 authorization verdict 색은 source palette와 별도 축으로 유지한다(D-061).
- 프록시 리스너는 Montoya가 생성하지 못하므로 사용자가 HUMAN 8080과 ZAP 8081을 만든다. 8082는 외부 LLM 클라이언트 호환 폴백이며 해당 관측은 `UNVERIFIED_RUNTIME`이라 결정적 판정에 쓸 수 없다.
- 캡처 콜백은 append만 하고 400ms worker coalescing으로 분석한다. live record는 20,000건에서 정지하며 초과 건수를 snapshot과 Web 경고로 노출한다.
- MCP는 `127.0.0.1`에만 bind하고 random Bearer, Origin 검사, 1MiB 요청 상한을 적용한다.
- Web 서버도 `127.0.0.1`에만 bind한다. Host/Origin과 UI에 주입된 세션 capability를 검증하고 `no-store`, CSP, frame 차단 헤더를 보낸다. Burp 축소 JRE 호환을 위해 MCP와 같은 자체 `LoopbackHttpServer`를 재사용한다.
- 1초 snapshot은 그래프 메타데이터와 서버 판정만 전송하고 마스킹 Request/Response 전문은 선택한 operation에서만 `/api/evidence`로 200건씩 지연 로드한다.

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
- `executionTrust`: `CONTROLLED/OBSERVED/UNVERIFIED_RUNTIME/IMPORTED/UNKNOWN`. 최종 결정적 validation은 FlowScope가 exact scope와 전송 경로를 통제한 `CONTROLLED` 요청만 허용한다.
- `service`: scheme://host:port. op/resource/identity 경계를 서비스별로 분리한다.
- `fp`: JWT subject 이름공간 또는 opaque token/cookie 단방향 지문. raw 인증값을 저장하지 않는다. 쿠키 fingerprint는 계정 연결·감사를 위한 안전한 식별자이지 로그인 증명이 아니다.
- `authState`: `ANONYMOUS/ACCOUNT_BOUND/UNRESOLVED`. 명시적 계정 연결이나 memory-only broker의 exact credential match만 `ACCOUNT_BOUND`가 된다. 계정에 연결되지 않은 cookie/session fingerprint는 서비스별 하나의 `UNRESOLVED` 그래프 신원으로 안정화하되 원 fingerprint는 Evidence에 남긴다.
- `requestPayload/responsePayload`: 저장 전 구조 마스킹된 전문의 SHA-256, 원래 UTF-8 byte 수, 보존 상태와 선택적 GZIP이다. 메시지당 기본 1MiB 이하 textual이며 digest 중복 제거 후 압축 전문 총량 48MiB 안에 있을 때만 `FULL`이다. binary, 메시지별 상한 초과, 압축 총량 상한 초과는 서로 다른 metadata-only 사유를 남긴다. 8KiB `reqText/respText/body`는 UI preview이며 전문과 같은 필드가 아니다.
- `resourceReferences`: path/query/body/GraphQL에서 실제 값으로 관측된 모든 객체 참조와 `PATH_ID/QUERY_ID/BODY_ID/GRAPHQL_VARIABLE` 근거다. `resource`는 기존 인가 cell의 보수적 primary 하나다.
- `trafficClassification`: `API/AUTH_SESSION/NAVIGATION/STATIC_ASSET/DISCOVERY_METADATA/PREFLIGHT/TELEMETRY_CANDIDATE/POLLING/BACKGROUND/UNKNOWN`, `INCLUDE/EXCLUDE/REVIEW`, 근거와 사용자 override를 가진 비파괴 파생값이다. `INCLUDE`만 coverage/graph 입력이며 `REVIEW`와 `EXCLUDE`도 Evidence에서는 삭제되지 않는다.
- `RouteCandidate`: 응답 없는 Burp Site Map 항목 또는 저장된 exact-scope 응답에서 추출한 경로다. provenance는 type과 Evidence ID를 따로 모은 집합이 아니라 `type ↔ evidenceId ↔ source ↔ runId ↔ adapter ↔ applicability/reason`의 대응 관계로 보존한다. 실제 request/response 전에는 identity, coverage, verdict, finding을 갖지 않는다.
- `AccountProfile`: 서비스별 테스트 계정의 내부 ID·표시 이름·확정 역할만 저장한다. 로그인 ID·비밀번호·토큰은 받지 않는다.
- `sessionBindings`: `(service, fingerprint) → accountId`의 사용자 명시 연결이다. 자동으로 합칠 수 없는 회전 세션을 검증된 계정 단위로 정렬한다.
- `SessionBroker`: 사용자가 Web UI에서 명시적으로 시작한 HUMAN 로그인 구간의 Cookie/Authorization/CSRF만 프로세스 메모리에 보관한다. 자격증명 material만 관측하고 성공 응답을 확인하지 못하면 `UNVERIFIED`, 401·로그인 redirect·invalid token이면 `SUSPECT`, 비밀 삭제/만료면 `REAUTH_REQUIRED`다. account service와 exact scope가 모두 맞고 상태가 `ACTIVE`일 때만 ZAP/LLM 요청에 주입한다. HUMAN pass의 계정 선택은 표시 힌트가 아니라 검증 조건이며, 실제 요청 자격증명이 그 broker 계정과 exact match할 때만 계정 신원으로 귀속한다. 다른 계정이 같은 service에서 동시에 캡처되는 것을 거부하며 raw 값은 UI/MCP/project에 나오지 않는다.
- `evidenceId`: 전체 의미 내용 digest 기반 ID. 프로젝트 왕복에서는 `contentDigest`가 일치할 때만 기존 ID를 보존하고, 동일 관측은 순서 suffix로 유일화한다.
- `owner`: 노드가 아니라 resource 속성이다(D-006). 명시적 본문 필드나 사용자 확정만 판정 근거가 된다.

프로젝트 파일 schema v2는 마스킹된 RequestRecord, digest별 한 번 저장되는 GZIP 전문 blob, provenance가 있는 RouteCandidate, 계정·세션 지문 연결, role/requirement/owner 정책, operation별 traffic override, classifier version, 완료가 확인된 레인, LLM assessment, 서버 검증 `ValidationDecision`, Evidence-bound 사람 감사 기록을 저장한다. raw broker 세션은 저장하지 않는다. 전문은 record가 digest/size/retention을 참조하고 load 때 digest와 byte 수를 검증한다. schema v1 preview-only 파일도 계속 읽되 존재하지 않은 전문을 복원한 것처럼 만들지 않는다. 탐색 레코드가 있다는 이유만으로 완료 레인을 추론하지 않으며, 로드한 validation은 현재 Evidence와 규칙 후보에 대해 다시 검증한다. 분류는 저장하되 로드 후 현재 결정론 classifier로 재계산하고 적용 버전을 root에 기록한다. 임시파일과 atomic replace를 사용하고 POSIX에서는 0600으로 제한한다(D-049/D-050/D-052/D-054/D-059/D-073).

## 4. 파이프라인

### 4.1 수집·마스킹 F-01~03/F-22

Proxy request handler가 listener port source를 보존하고 SCANNER/LLM의 범위 밖 요청을 송신 전에 차단한다. 각 Proxy 요청의 `messageId`에 요청 수신 시점의 run/account/login-capture 문맥을 임시 보관하고 응답에서 한 번 소비하므로, ZAP lane 전환이나 HUMAN pass 종료 뒤 늦게 도착한 응답도 시작 당시 provenance로 귀속한다. in-flight 문맥은 20,000건·10분 상한을 두며, 원 인증값은 이 상관 테이블에 저장하지 않는다. HUMAN 브라우저의 범위 밖 이동 자체는 막지 않지만 response capture 직전에 모든 source를 현재 exact scope로 검사하므로 범위 밖 응답은 저장·그래프화하지 않는다. `Http.registerHttpHandler`는 Repeater/Intruder 등 비프록시 Burp 도구를 보완하며 같은 capture gate를 지난다. 사용자가 요청하면 기존 Proxy history도 원래 listener·시각·최종 요청·응답으로 가져오되 scope 밖 item을 제거한다. 재가져오기는 관측 횟수를 보존하는 multiset 병합으로 이미 반영된 사본만 제외한다. Authorization/Cookie/Set-Cookie와 password/token/secret/api-key류는 header와 JSON/form/multipart/XML 구조를 따라 저장 전에 마스킹한다. 마스킹된 textual 전문은 메시지당 기본 1MiB, digest 중복 제거 후 압축 총량 48MiB까지 GZIP으로 보존하고 8KiB preview를 별도로 유지한다. binary·메시지별/총량 상한 초과 전문은 크기·SHA-256·사유만 보존해 잘린 내용을 완전 Evidence처럼 쓰지 않는다. Burp XML도 같은 보존 정책을 적용하며 XXE를 차단하고 불완전 item을 이유와 함께 skip한다.

HUMAN 로그인 캡처 구간은 `SESSION_SETUP`, 명시적 HUMAN pass는 `EXPLORATION`, pass 밖의 일반 HUMAN 관측은 `BASELINE`으로 보존한다. `SESSION_SETUP`/`BASELINE` HUMAN Evidence는 저장과 감사 대상이지만 discovery coverage·3-way gap·그래프 입력은 아니다. 로그인 준비와 우연한 scope 내 이동이 HUMAN 탐색 성과로 계산되지 않게 하려면 사용자가 HUMAN pass를 시작·종료해야 한다.

### 4.2 정규화 F-04~06

- 원본 `path/query/request/response`는 바꾸거나 삭제하지 않는다.
- operation 경로 변수화는 관측 묶음 전체에서 수행한다. UUID·16자 이상 hex는 형식 근거, 2xx JSON 응답의 `id` 또는 부모명 기반 `*Id`가 경로 값과 정확히 같으면 응답 근거, 같은 service·구조·위치에서 서로 다른 값 또는 source/run/method가 다른 관측이 반복되면 추론 근거다.
- 근거가 없는 단일 숫자 세그먼트는 operation에서 literal로 유지한다. 예: 단일 `/status/200`은 `/status/{id}`로 바꾸지 않는다. 근거가 모이면 `/orders/101`, `/orders/202`를 `/orders/{id}`로 자동 정렬한다.
- 객체 후보와 operation template은 분리한다. 단일 `/orders/101`도 `orders:101` 객체 후보는 보존하되, template 근거가 없으면 operation label은 literal이다. 이 분리로 보수적 묶음이 인가 객체 탐지를 지우지 않게 한다.
- 각 관측은 `LITERAL/INFERRED/CORROBORATED`와 범주형 이유를 가진다. UUID/긴 16진 형식은 추론일 뿐 확정이 아니며, 성공 응답의 정확한 ID 일치만 별도 Evidence로 보강한다. 확률·고정 confidence는 만들지 않는다. 같은 service/구조 안의 근거만 다른 method에 전파하며 서비스 경계를 넘지 않는다.
- 전체 부모 체인을 resource에 보존한다.
- 명시적 query/body `id`, `*Id`, `*_id`, `*Ids`, `*_ids`를 JSON 중첩 객체·배열, XML, multipart에서 모두 수집한다. page/limit 등 제어값은 제외한다. 여러 참조는 모두 Evidence로 노출하지만 기존 인가 분석은 첫 근거 참조 하나만 primary로 사용해 적용 가능성이 증명되지 않은 객체 조합을 만들지 않는다.
- GraphQL은 `POST /graphql#operationName`으로 분리한다.
- identity는 service + fingerprint로 시작한다. JWT iss/aud/sub는 서명 미검증 그룹핑 힌트일 뿐 인증 증거가 아니다(D-034). 계정 연결 없는 쿠키 fingerprint는 모두 같은 계정으로 합치는 대신 서비스별 `UNRESOLVED` 그래프 신원으로만 접어 세션 회전 노이즈를 막고, 원 fingerprint는 연결 후보로 보존한다.
- 정규화 뒤 사용자가 확인한 session binding을 적용한다. 다른 service의 계정과 세션은 연결할 수 없다.

### 4.3 비파괴 분류·관측 접기

분류기는 경로 이름 하나로 삭제하지 않는다. HTTP 메서드, 실제 응답 유무, Fetch Metadata, request/response Content-Type, CORS preflight 헤더, 객체 신호, 상태·redirect, source와 phase가 함께 맞는 경우에만 coverage에서 제외한다.

- 실제 preflight는 `OPTIONS`와 `Access-Control-Request-Method`가 함께 있을 때만 `PREFLIGHT/EXCLUDE`다. 일반 OPTIONS API는 유지한다.
- 안전 메서드의 Fetch destination/MIME 또는 확장자/MIME가 함께 맞을 때만 `STATIC_ASSET/EXCLUDE`다. 객체·401/403·login redirect 등 보안 신호가 있으면 API 분석이 우선한다.
- document/iframe + HTML navigation은 `NAVIGATION/EXCLUDE`지만 보안 신호가 있으면 유지한다.
- telemetry 명칭은 단독 제외 근거가 아니며 `TELEMETRY_CANDIDATE/REVIEW`로 남긴다.
- response 없는 관측, source `UNKNOWN`, `VALIDATION/COACH_PROBE`는 discovery coverage에서 제외하지만 Evidence는 보존한다.
- HUMAN `SESSION_SETUP` 및 `BASELINE`은 로그인 준비·pass 밖 관측이므로 discovery coverage에서 제외하지만 Evidence는 보존한다.
- 같은 신원/run/phase/method/operation/resource/query/body/status-class/response/location의 반복만 표시 cluster로 접는다. 분석 입력과 Evidence ID는 삭제하거나 합치지 않는다.
- 애매한 것은 `UNKNOWN/REVIEW`로 Evidence와 검토 대기에 남기되 메인 coverage·graph·3-way gap에는 넣지 않는다. 사용자는 operation 단위로 `INCLUDE/EXCLUDE/AUTO`를 되돌릴 수 있지만 no-response, unknown source, HUMAN 비탐색 구간, `VALIDATION/COACH_PROBE`라는 discovery 신뢰 경계는 override할 수 없다.

classifier v3는 web manifest·source map·service worker를 `DISCOVERY_METADATA/EXCLUDE`로 분리한다. 같은 service·정규화 operation에 강한 비사용자-override `API/INCLUDE` Evidence가 있고 immutable discovery gate를 통과할 때만 애매한 형제 record를 API로 교차 보강한다.

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

role/requirement는 자동추정하지 않고 사용자가 지정한다(D-018).

### 4.5 비교·그래프 F-07~15/F-20~24

CoverageCell 키는 `identity|operation|resource`다. 소스별 5-state verdict를 보존하고 다음 갭을 계산한다.

- UNCROSSED: 확정 소유자가 있는 관측 operation/resource를 다른 관측 identity가 시도하지 않음.
- PARTIAL_DISCOVERY: 활성 소스 중 일부만 같은 cell을 실행.
- CONFLICT: 같은 cell의 소스 verdict가 다름.

데이터 Flow 엣지는 같은 identity에서 이전 응답의 ID/token이 30분 안의 뒤 요청 path/query/body에 실제 소비될 때만 만든다. 단순 시간순 엣지는 만들지 않는다(D-019).

### 4.6 세션·LLM·ZAP F-16~19

로컬 Codex/Claude CLI가 사용자의 기존 구독 로그인으로 모델을 실행한다. FlowScope는 model OAuth/API key를 받지 않는다. Web quick-start는 공급자·exact target·선택적 ACTIVE 계정을 받아 새 자식 프로세스를 실행하며, 수동 `agent-workspace` 실행은 호환 폴백이다.

- `LocalLlmRunner`는 shell을 거치지 않는 인자 배열로 실행 파일을 호출한다. 실행 파일은 시스템 속성 또는 Burp 시작 `PATH`의 regular executable만 허용한다. MCP Bearer는 자식 환경 `FLOWSCOPE_MCP_TOKEN`으로만 전달하며 command line·prompt·project·status output에 넣지 않는다. 구독 로그인 경계를 위해 상속된 `OPENAI_API_KEY`·`ANTHROPIC_API_KEY`는 제거한다.
- Explorer는 owner-only 임시 작업공간에서 시작한다. Codex는 `exec --ephemeral --ignore-user-config --strict-config`, read-only/no-approval, 웹 검색 비활성화와 모델 shell의 MCP token 제외를 사용한다. Claude는 strict 임시 MCP 설정, 빈 setting sources, auto-memory 비활성화, 역할별 도구 allowlist와 `--no-session-persistence`를 사용한다. 기존 세션을 resume하지 않으며 서버가 exact LLM run을 먼저 발급하고 CLI가 그 run을 정상 종료하지 않으면 abort·실패 처리한다.
- Judge는 Explorer와 별개의 새 provider session으로 시작한다. Codex JSON의 `thread_id` 또는 FlowScope가 만든 Claude `session-id`를 보존하고, 사용자의 `Judge 계속` 요청만 exact ID로 resume한다. 이는 논리적 대화 지속이며 CLI 프로세스를 계속 실행해 두는 구조가 아니다.
- 일부 Claude Code 버전이 no-persistence 실행에서도 provider metadata를 남길 수 있다는 외부 상태는 삭제로 가장하지 않는다. 고유 임시 작업공간과 no-resume으로 논리적 오염을 막고 UI에 잔존 가능성을 표시한다.
- CLI 출력은 마스킹·상한을 적용한 tail만 UI에 노출한다. Codex session ID는 긴 출력에서 tail이 밀려나도 잃지 않도록 별도 bounded prefix에서 읽는다.
- 활성 run 또는 잠긴 dataset이 있으면 Burp UI의 scope 변경도 거부한다. MCP lock 뒤 대상 의미가 바뀐 채 같은 Judge 세션이 계속되는 경로를 허용하지 않는다.
- 같은 source의 새 exploration이 시작되면 과거 완료 표식은 즉시 제거한다. 재실행이 실패·취소되면 그 source는 미완료로 남고 Judge 버튼과 서버 lock 모두 닫힌다.

- 기본은 closed-world다. 공급된 agent-workspace는 web search, Wayback, 외부 API 문서·소스 저장소, curl·브라우저 네트워킹을 금지한다. 대상 내부 문서는 exact-scope 통제 응답으로 실제 관측된 경우만 사용할 수 있다.
- Explorer는 `flowscope_target_request`만 사용한다. 서버는 탐색 중 HUMAN/SCANNER count·cell·gap·finding·Evidence를 숨기고 Explorer 자신의 run Evidence만 보여 준다.
- `flowscope_list_route_candidates`는 탐색 중 provenance를 현재 `LLM + runId`로 잘라 observed/applicability/reason을 다시 계산한다. 같은 route에 HUMAN 근거가 병합돼 있어도 그 근거와 상태는 반환하지 않는다.
- captured/coverage/excluded/review와 source별 coverage count도 같은 가시성 경계를 적용해 Explorer에게는 현재 LLM run 값만 보인다.
- lock 전 active Explorer가 없을 때도 MCP status는 다른 lane의 수량·active run·gap/finding을 공개하지 않는다. Explorer 중에는 ZAP 상태/실행과 기존 assessment/validation 조회를 거부한다.
- HUMAN, 시스템 ZAP, 독립 LLM이 정확한 run 종료를 완료해야 `flowscope_lock_dataset`이 성공한다. 레코드가 있다는 사실만으로 완료 처리하지 않는다.
- dataset lock은 Pipeline 결과와 route candidate inventory를 함께 snapshot한다. lock 이후 validation/coach traffic이나 background candidate rebuild는 Judge가 보는 route 목록을 바꾸지 않는다.
- Judge는 잠긴 후보/소유자/역할 기준과 ZAP native alert를 종합한다. 잠금 뒤 새 검증 트래픽은 현재 Evidence 저장소에서 읽되 후보 오라클은 잠긴 snapshot을 유지한다.
- MCP exact-scope 교체는 로컬 capability를 가진 클라이언트가 사용자가 명시한 범위를 자동 설정할 때만 허용하며, SCANNER/LLM run 중에는 거부한다.
- HUMAN pass는 Web quick-start에서 exact run lease로 시작·종료해 임의 브라우저 트래픽과 기준선 수행 구간을 구분한다. 계정 pass 시작은 해당 broker 세션이 `ACTIVE`일 때만 허용하고, 관측 요청의 자격증명이 선택 계정과 다르면 그 계정으로 기록하지 않는다.
- 일반 assessment는 기존 Evidence ID와 `LIKELY/INCONCLUSIVE/REJECTED`만 허용하며 최종 판정이 아니다.
- 최종 validation은 현재 결정론 finding을 대상으로 원본 Evidence, 동일한 비기본 LLM VALIDATION run의 `CONTROLLED` 반복 재현 2건 이상, 정상 대조 1건 이상을 서로 겹치지 않게 요구한다. 신원·operation·resource·응답 의미가 맞지 않거나 write method이면 베타에서 `INCONCLUSIVE`다.
- 최종 verdict는 `CONFIRMED/INCONCLUSIVE/REJECTED`다. `CONFIRMED`는 반복 성공, `REJECTED`는 반복 명시 거부일 때만 허용하며 BOLA의 정상 대조는 확인된 소유자, BFLA의 정상 대조는 사용자 역할 정책과 일치해야 한다.
- 사람의 확정/미확정/폐기 기록은 Evidence-bound 감사·오버라이드다. 원본 Evidence 집합이 달라지면 과거 기록을 자동 승계하지 않는다.
- 기본 ZAP 캠페인은 `orchestrator=SYSTEM`이다. Web/MCP에서 비로그인과 복수 ACTIVE 계정을 선택하면 비로그인 → 선택 계정 순으로 실행하며, 각 신원 앞에서 ZAP `core/newSession`을 호출해 crawler/cookie 상태를 분리한다. 각 신원은 Traditional Spider → strict Client Spider → Client 실패 시 AJAX Spider → passive queue 0 → native alert 수집 순서를 고정하고, 신원별 캡처된 in-scope SCANNER 요청이 0이면 전체 캠페인을 실패시켜 완료 gate를 열지 않는다. Alert에는 `flowscope_account_id`와 `flowscope_run_id`를 붙인다. LLM이 단계를 고르지 않는다.
- 관리형 계정 ZAP/LLM 요청은 기존 Authorization/Cookie/Proxy-Authorization/CSRF를 제거하고 broker의 현재 `ACTIVE` 세션만 주입한다. fresh ZAP anonymous lane은 Authorization과 Proxy-Authorization을 제거하되 그 lane 안에서 서버가 새로 발급한 익명 Cookie/CSRF는 상태형 탐색을 위해 유지한다. 이 lane-local 쿠키는 계정 증명이 아니므로 신원 fingerprint는 계속 `anon`으로 고정한다. 수동으로 직접 실행해 FlowScope run context가 없는 scanner 트래픽은 관측만 하고 헤더를 바꾸지 않는다. 쿠키 회전은 응답의 Set-Cookie로 broker에 갱신하며, UNVERIFIED/SUSPECT/만료 세션은 사용자가 HUMAN 로그인 캡처를 다시 해야 한다.
- Web scanner target 목록과 시작 API는 자기 자신의 `127.0.0.1:<web-port>` 제어면을 제외한다. localhost의 실제 점검 대상까지 포괄 차단하지 않고 현재 Web port만 차단한다.
- Active Scan은 scope + MCP confirmed + Burp dialog의 세 조건을 모두 요구한다.

## 5. UI

| 작업면 | 역할 |
|---|---|
| 그래프 | IDA식 `identity → resource → operation` 그래프. 객체 미관측 요청은 `identity → operation`으로 직접 연결. 미요청 route는 중립색·점선 테두리 노드로 별도 표시. H/S/L·인가 필터, Evidence 선택, 객체/API 18개 단위 접기·펼치기 |
| 판정 매트릭스 | identity/role × operation × resource의 소스별 판정과 3종 갭 |
| 흐름 순서 | 응답 값이 뒤 요청에 사용된 실제 데이터 의존성 |
| 시나리오 | BOLA/BFLA 규칙 후보·갭·LLM assessment·서버 검증 최종 verdict와 사람 감사 |
| 파싱 결과 | 마스킹된 source/identity/method/operation/resource/status, traffic class/disposition/reason, 반복 수, stable Evidence ID. 행 선택은 operation 상세와 페이지형 Evidence로 연결 |
| 계정·세션 | 전체 폭 계정 등록, HUMAN 로그인 캡처, broker 상태/재인증/폐기, 발견 지문 비교와 명시 연결·해제 |
| 빠른 시작 | HUMAN run, 결정론적 ZAP 대상·비로그인/복수 계정 선택·신원별 단계/수집/Alert 상태, 독립 Explorer와 잠금 후 Judge 순서 |
| 공통 우측 | 선택 API의 지연 로드된 마스킹 Request/Response와 Repeater 미전송 초안 |
| Burp 제어판 | exact scope, 세 레인 포트, Web UI 열기, MCP 연결 복사, Proxy history, project I/O, sample/reset |

관측 Evidence가 0건이면 분석 패널을 숨기고 `scope → 계정 로그인/HUMAN → ZAP → Explorer/Judge` 네 단계와 빠른 시작·샘플 조작만 먼저 노출한다. Evidence가 생기면 위 분석 작업면으로 전환한다. 이 progressive disclosure는 분석 모델을 줄이지 않고 첫 행동만 분리하며, ADMIN은 BFLA 역할 비교가 필요할 때만 선택적으로 추가한다(D-057).

번들 `SampleProject`는 `demo.flowscope.test`의 합성 H/S/L record만 만들며 대상 네트워크를 호출하지 않는다. snapshot은 모든 record가 이 고정 demo service·run provenance일 때만 `sampleMode=true`를 보내고 Web 상단에 “실제 HUMAN/ZAP/LLM 점검 결과 아님·네트워크 요청 0건”을 표시한다. 실제 traffic이 하나라도 섞이면 sample mode로 표시하지 않는다.

## 6. 모듈 매핑

| 모듈 | 구현 |
|---|---|
| Capture | `burp/FlowScopeExtension` |
| Normalize/mask/classify | `core/Normalizer`, `Fingerprints`, `Masking`, `BurpXmlParser`, `TrafficClassifier`, `ObservationCollapser` |
| Identity/review state | `AccountProfile`, `AnalysisConfig`, `ReviewDecision`, `ValidationDecision` |
| Rules | `AuthorizationAnalyzer`, `DataFlowAnalyzer`, `EvidenceIds` |
| Graph model | `core/graph/*`, `web/SnapshotJsonWriter` |
| Product UI | `web/FlowScopeWebServer`, `resources/web/index.html`, `ui/FlowScopeControlTab` |
| Session/LLM/ZAP | `integration/SessionBroker`, `McpServer`, `ZapClient`, `RunContextRegistry` |
| Persistence | `integration/ProjectStore` |

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
- Repeater handoff는 마스킹된 미전송 초안만 연다. 사용자가 보낸 결과를 원 Evidence에 자동 연결하는 안정적인 Montoya correlation 계약은 없으므로 자동 validation에는 사용하지 않는다.
- 포트 매핑은 확장 로드 시 시스템 속성으로 읽으므로 변경 후 Burp를 다시 시작한다.

세부 결정과 기각 대안은 `decisions.md`를 참조한다.
