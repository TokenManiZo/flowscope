# FlowScope 설계서 v1.2.0-beta.3

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
Codex/Claude ─▶ MCP ─▶ controlled target executor          ▼
                    ├─▶ independent LLM Explorer       final LLM Judge
                    └─▶ deterministic ZAP baseline     └─▶ validation gate

LLM :8082 = optional observed fallback; decisive validation에는 사용하지 않음
```

- Java 21, Maven shade fat JAR. `montoya-api`는 Burp 제공 scope다.
- Burp `registerSuiteTab`에는 범위·포트·프로젝트·MCP 상태를 다루는 작은 Swing 제어판만 둔다. 그래프·매트릭스·상세의 정본은 시스템 브라우저에서 여는 번들 Web UI다.
- Web UI는 번들 Cytoscape.js를 사용하며 외부 CDN이나 원격 자원을 요청하지 않는다. JCEF·JavaFX는 배포물에 포함하지 않는다.
- source view는 HUMAN=파랑·실선·H, SCANNER=빨강·파선·S, LLM=검정·점선·L의 평행 Evidence로 표시한다. 일반 UI 조작의 accent와 authorization verdict 색은 source palette와 별도 축으로 유지한다(D-061).
- 프록시 리스너는 Montoya가 생성하지 못하므로 사용자가 HUMAN 8080과 ZAP 8081을 만든다. 8082는 외부 LLM 클라이언트 호환 폴백이며 해당 관측은 `UNVERIFIED_RUNTIME`이라 결정적 판정에 쓸 수 없다.
- 캡처 콜백은 append만 하고 400ms worker coalescing으로 분석한다. 20,000건에서 정지한다.
- MCP는 `127.0.0.1`에만 bind하고 random Bearer, Origin 검사, 1MiB 요청 상한을 적용한다.
- Web 서버도 `127.0.0.1`에만 bind한다. Host/Origin과 UI에 주입된 세션 capability를 검증하고 `no-store`, CSP, frame 차단 헤더를 보낸다. Burp 축소 JRE 호환을 위해 MCP와 같은 자체 `LoopbackHttpServer`를 재사용한다.
- 1초 snapshot은 그래프 메타데이터와 서버 판정만 전송하고 마스킹 Request/Response 전문은 선택한 operation에서만 `/api/evidence`로 200건씩 지연 로드한다.

## 3. 데이터 모델

```text
RequestRecord {
  source, sourceDetail, orchestrator, tool, phase, runId,
  executionTrust, authState,
  service, method, path, query, reqBody, reqText,
  status, body, respText, location, hasResponse, timestamp,
  requestContentType, responseContentType, secFetchDest, secFetchMode,
  accessControlRequestMethod,
  fp, idn, role, op, resource, evidenceId, contentDigest,
  trafficClassification
}
```

- `source`: 실제 대상 요청 생성자. ZAP은 지시자가 LLM이어도 SCANNER다.
- `orchestrator`: HUMAN/LLM/SYSTEM. source와 직교한다(D-036).
- `executionTrust`: `CONTROLLED/OBSERVED/UNVERIFIED_RUNTIME/IMPORTED/UNKNOWN`. 최종 결정적 validation은 FlowScope가 exact scope와 전송 경로를 통제한 `CONTROLLED` 요청만 허용한다.
- `service`: scheme://host:port. op/resource/identity 경계를 서비스별로 분리한다.
- `fp`: JWT subject 이름공간 또는 opaque token/cookie 단방향 지문. raw 인증값을 저장하지 않는다. 쿠키 fingerprint는 계정 연결·감사를 위한 안전한 식별자이지 로그인 증명이 아니다.
- `authState`: `ANONYMOUS/ACCOUNT_BOUND/UNRESOLVED`. 명시적 계정 연결이나 memory-only broker의 exact credential match만 `ACCOUNT_BOUND`가 된다. 계정에 연결되지 않은 cookie/session fingerprint는 서비스별 하나의 `UNRESOLVED` 그래프 신원으로 안정화하되 원 fingerprint는 Evidence에 남긴다.
- `trafficClassification`: `API/NAVIGATION/STATIC_ASSET/PREFLIGHT/TELEMETRY_CANDIDATE/BACKGROUND/UNKNOWN`, `INCLUDE/EXCLUDE/REVIEW`, 근거와 사용자 override를 가진 비파괴 파생값이다. `INCLUDE`만 coverage/graph 입력이며 `REVIEW`와 `EXCLUDE`도 Evidence에서는 삭제되지 않는다.
- `AccountProfile`: 서비스별 테스트 계정의 내부 ID·표시 이름·확정 역할만 저장한다. 로그인 ID·비밀번호·토큰은 받지 않는다.
- `sessionBindings`: `(service, fingerprint) → accountId`의 사용자 명시 연결이다. 자동으로 합칠 수 없는 회전 세션을 검증된 계정 단위로 정렬한다.
- `SessionBroker`: 사용자가 Web UI에서 명시적으로 시작한 HUMAN 로그인 구간의 Cookie/Authorization/CSRF만 프로세스 메모리에 보관한다. account service와 exact scope가 모두 맞고 상태가 `ACTIVE`일 때만 ZAP/LLM 요청에 주입한다. 401·로그인 redirect·invalid token은 `SUSPECT`, 비밀 삭제/만료는 `REAUTH_REQUIRED`이며 자동 재사용하지 않는다. raw 값은 UI/MCP/project에 나오지 않는다.
- `evidenceId`: 전체 의미 내용 digest 기반 ID. 프로젝트 왕복에서는 `contentDigest`가 일치할 때만 기존 ID를 보존하고, 동일 관측은 순서 suffix로 유일화한다.
- `owner`: 노드가 아니라 resource 속성이다(D-006). 명시적 본문 필드나 사용자 확정만 판정 근거가 된다.

프로젝트 파일 schema v1은 마스킹된 RequestRecord, 계정·세션 지문 연결, role/requirement/owner 정책, operation별 traffic override, classifier version, 완료가 확인된 레인, LLM assessment, 서버 검증 `ValidationDecision`, Evidence-bound 사람 감사 기록을 저장한다. raw broker 세션은 저장하지 않는다. 탐색 레코드가 존재한다는 이유만으로 완료 레인을 추론하지 않으며, 로드한 validation은 현재 Evidence와 규칙 후보에 대해 다시 검증한다. 분류는 저장하되 로드 후 현재 결정론 classifier로 재계산하고 적용 버전을 프로젝트 root에 기록한다. 새 필드는 선택값으로 추가해 기존 schema v1 파일을 계속 읽는다. 임시파일과 atomic replace를 사용하고 POSIX에서는 0600으로 제한한다(D-049/D-050/D-052/D-054/D-059).

## 4. 파이프라인

### 4.1 수집·마스킹 F-01~03/F-22

Proxy request handler가 listener port source를 보존하고 SCANNER/LLM의 범위 밖 요청을 송신 전에 차단한다. HUMAN 브라우저의 범위 밖 이동 자체는 막지 않지만 response capture 직전에 모든 source를 현재 exact scope로 검사하므로 범위 밖 응답은 저장·그래프화하지 않는다. `Http.registerHttpHandler`는 Repeater/Intruder 등 비프록시 Burp 도구를 보완하며 같은 capture gate를 지난다. 사용자가 요청하면 기존 Proxy history도 원래 listener·시각·최종 요청·응답으로 가져오되 scope 밖 item을 제거한다. 재가져오기는 관측 횟수를 보존하는 multiset 병합으로 이미 반영된 사본만 제외한다. Authorization/Cookie/Set-Cookie와 password/token/secret/api-key류는 header와 JSON/form/multipart/XML 구조를 따라 저장 전에 마스킹한다. 요청·응답 상세는 필드별 8KiB로 제한한다. Burp XML은 XXE를 차단하고 불완전 item을 이유와 함께 skip한다.

HUMAN 로그인 캡처 구간은 `SESSION_SETUP`, 명시적 HUMAN pass는 `EXPLORATION`, pass 밖의 일반 HUMAN 관측은 `BASELINE`으로 보존한다. `SESSION_SETUP`/`BASELINE` HUMAN Evidence는 저장과 감사 대상이지만 discovery coverage·3-way gap·그래프 입력은 아니다. 로그인 준비와 우연한 scope 내 이동이 HUMAN 탐색 성과로 계산되지 않게 하려면 사용자가 HUMAN pass를 시작·종료해야 한다.

### 4.2 정규화 F-04~06

- 경로 숫자/UUID/장문 hex를 `{id}`로 만들고 전체 부모 체인을 resource에 보존한다.
- 명시적 query/body `id`, `*Id`, `*_id`만 보조 resource로 쓴다. page/limit 등 제어값은 제외한다.
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

### 4.4 소유자·판정 F-10~11

소유자 우선순위는 사용자 확정 → **응답 본문**의 명시적 owner/user/account 필드 또는 같은 이름의 중첩 principal 객체 → 저신뢰 first-success다. 공격자가 조작 가능한 요청 본문과 문맥 없는 임의 email/id 필드는 소유권 근거로 쓰지 않는다. 저신뢰나 충돌은 미확정이므로 취약 판정에서 제외한다.

판정은 status 단독이 아니라 status taxonomy + redirect + soft deny + owner + response content + role policy를 결합한다.

- 2xx + 자기 소유: allow.
- 401/403, 로그인 redirect, soft deny: deny.
- 404/429/5xx 또는 해석 불가: undecided.
- 비소유 write 2xx: body가 비어도 suspicious.
- 비소유 read 2xx: 응답이 외부 객체를 실제 포함할 때 suspicious, 아니면 undecided.
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

외부 Codex/Claude 클라이언트가 구독 계정으로 모델을 실행한다. FlowScope는 model OAuth/API key를 받지 않는다.

- 기본은 closed-world다. 공급된 agent-workspace는 web search, Wayback, 외부 API 문서·소스 저장소, curl·브라우저 네트워킹을 금지한다. 대상 내부 문서는 exact-scope 통제 응답으로 실제 관측된 경우만 사용할 수 있다.
- Explorer는 `flowscope_target_request`만 사용한다. 서버는 탐색 중 HUMAN/SCANNER count·cell·gap·finding·Evidence를 숨기고 Explorer 자신의 run Evidence만 보여 준다.
- captured/coverage/excluded/review와 source별 coverage count도 같은 가시성 경계를 적용해 Explorer에게는 현재 LLM run 값만 보인다.
- HUMAN, 시스템 ZAP, 독립 LLM이 정확한 run 종료를 완료해야 `flowscope_lock_dataset`이 성공한다. 레코드가 있다는 사실만으로 완료 처리하지 않는다.
- Judge는 잠긴 후보/소유자/역할 기준과 ZAP native alert를 종합한다. 잠금 뒤 새 검증 트래픽은 현재 Evidence 저장소에서 읽되 후보 오라클은 잠긴 snapshot을 유지한다.
- MCP exact-scope 교체는 로컬 capability를 가진 클라이언트가 사용자가 명시한 범위를 자동 설정할 때만 허용하며, SCANNER/LLM run 중에는 거부한다.
- HUMAN pass는 Web quick-start에서 exact run lease로 시작·종료해 임의 브라우저 트래픽과 기준선 수행 구간을 구분한다.
- 일반 assessment는 기존 Evidence ID와 `LIKELY/INCONCLUSIVE/REJECTED`만 허용하며 최종 판정이 아니다.
- 최종 validation은 현재 결정론 finding을 대상으로 원본 Evidence, 동일한 비기본 LLM VALIDATION run의 `CONTROLLED` 반복 재현 2건 이상, 정상 대조 1건 이상을 서로 겹치지 않게 요구한다. 신원·operation·resource·응답 의미가 맞지 않거나 write method이면 베타에서 `INCONCLUSIVE`다.
- 최종 verdict는 `CONFIRMED/INCONCLUSIVE/REJECTED`다. `CONFIRMED`는 반복 성공, `REJECTED`는 반복 명시 거부일 때만 허용하며 BOLA의 정상 대조는 확인된 소유자, BFLA의 정상 대조는 사용자 역할 정책과 일치해야 한다.
- 사람의 확정/미확정/폐기 기록은 Evidence-bound 감사·오버라이드다. 원본 Evidence 집합이 달라지면 과거 기록을 자동 승계하지 않는다.
- 기본 ZAP 레인은 `orchestrator=SYSTEM`이다. Traditional Spider → strict Client Spider → Client 실패 시 AJAX Spider → passive queue 0 → native alert 수집 순서를 고정하며, 캡처된 in-scope SCANNER 요청이 0이면 실패한다. LLM이 단계를 고르지 않는다.
- 계정을 선택한 ZAP/LLM 요청은 broker의 현재 `ACTIVE` 세션만 주입한다. 쿠키 회전은 응답의 Set-Cookie로 갱신하며, SUSPECT/만료 세션은 사용자가 HUMAN 로그인 캡처를 다시 해야 한다.
- Active Scan은 scope + MCP confirmed + Burp dialog의 세 조건을 모두 요구한다.

## 5. UI

| 작업면 | 역할 |
|---|---|
| 그래프 | IDA식 `identity → resource → operation` 그래프. 객체 미관측 요청은 `identity → operation`으로 직접 연결. H/S/L·인가 필터, Evidence 선택, 객체/API 18개 단위 접기·펼치기 |
| 판정 매트릭스 | identity/role × operation × resource의 소스별 판정과 3종 갭 |
| 흐름 순서 | 응답 값이 뒤 요청에 사용된 실제 데이터 의존성 |
| 시나리오 | BOLA/BFLA 규칙 후보·갭·LLM assessment·서버 검증 최종 verdict와 사람 감사 |
| 파싱 결과 | 마스킹된 source/identity/method/operation/resource/status, traffic class/disposition/reason, 반복 수, stable Evidence ID. 행 선택은 operation 상세와 페이지형 Evidence로 연결 |
| 계정·세션 | 전체 폭 계정 등록, HUMAN 로그인 캡처, broker 상태/재인증/폐기, 발견 지문 비교와 명시 연결·해제 |
| 빠른 시작 | HUMAN run, 결정론적 ZAP 대상·계정·단계·수집/Alert 상태, 독립 Explorer와 잠금 후 Judge 순서 |
| 공통 우측 | 선택 API의 지연 로드된 마스킹 Request/Response와 Repeater 미전송 초안 |
| Burp 제어판 | exact scope, 세 레인 포트, Web UI 열기, MCP 연결 복사, Proxy history, project I/O, sample/reset |

빈 데이터에서도 beta.3는 위 분석 패널 대부분을 그대로 노출한다. 실제 사용자 확인에서 첫 행동보다 전문 용어와 0 상태가 먼저 보여 혼란을 주는 것이 확인됐다. 이는 분석 모델의 이유가 아니라 미완료 UX 부채이며, 데이터가 없을 때는 `scope → 계정 로그인/HUMAN → ZAP → Explorer/Judge`를 우선하는 progressive disclosure로 수정해야 한다(D-057).

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
- domain-specific 또는 일반 principal 문맥이 아닌 중첩 ownership은 사용자 확정이 필요하다.
- 안정 신호 없는 opaque rotating token은 자동으로 같은 identity로 합칠 수 없으며 사용자 확인 binding이 필요하다.
- 쿠키 존재만으로 익명/로그인 여부를 완전히 알 수 없고 Fetch Metadata/MIME도 모든 클라이언트가 제공하지 않는다. 따라서 `UNRESOLVED`와 `REVIEW`가 정상 상태이며 분류의 오탐·미탐 0을 주장하지 않는다.
- data flow는 exact-value 보조분석이며 semantic taint가 아니다.
- source별 active run context는 하나이며 겹치는 LLM/ZAP run 시작은 거부한다. 종료도 정확한 run ID가 일치해야 한다.
- 세션 브로커는 일반 Cookie/Bearer/CSRF와 서버가 돌려주는 회전을 처리하지만 CAPTCHA/MFA/WebAuthn/device binding/application-specific refresh를 일반화하지 않는다. 이 경우 수동 재로그인이 필요하다.
- closed-world는 제공 agent 지침과 MCP 도구 경로에는 강제되지만 사용자가 개조한 에이전트나 별도 로컬 프로세스의 외부 통신까지 차단하는 OS sandbox는 아니다. exact scope, 가시성, Evidence trust, verdict gate는 서버에서 별도로 강제한다.
- 그래프 접기는 의미 기반 클러스터링이 아니라 현재 필터 결과를 객체/API별 18개 단위로 늘리는 표시 페이지다. 20,000 record 상한은 별도로 Burp를 보호한다.
- Repeater handoff는 마스킹된 미전송 초안만 연다. 사용자가 보낸 결과를 원 Evidence에 자동 연결하는 안정적인 Montoya correlation 계약은 없으므로 자동 validation에는 사용하지 않는다.
- 포트 매핑은 확장 로드 시 시스템 속성으로 읽으므로 변경 후 Burp를 다시 시작한다.

세부 결정과 기각 대안은 `decisions.md`를 참조한다.
