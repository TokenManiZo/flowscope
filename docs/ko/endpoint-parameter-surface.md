# Endpoint·Parameter Surface Delta 설계·검증

이 문서는 특정 타깃에 맞춘 규칙 없이 HUMAN·SCANNER·LLM의 탐색 차이를 데이터화하는 beta.46 계약과 검증 경계를 정의한다. 이 기능은 취약점 판정기가 아니라 다음 검토 위치를 좁히는 작업목록이다. D-128 독립 Explorer는 실제 응답이 있는 통제 HTTP 요청만 LLM 관측으로 추가한다. D-139는 그 응답 산출물에서 읽은 endpoint·parameter를 current-run Evidence에 결박된 별도 선언으로 보존하며, 실행 전·전송 실패·응답 0건이나 모델의 자유서술을 관측 또는 선언으로 승격하지 않는다.

## 1. 제품 질문

> 대상이 명시한 API·입력과 실제 HTTP Evidence를 비교했을 때, 어느 출처가 어떤 엔드포인트와 파라미터를 관측했고 무엇이 현재 미관측인가?

`미관측`은 취약점, 도달 가능, 실제 기능 또는 lane 실패를 뜻하지 않는다. 현재 데이터셋에서 선언과 대응하는 Request/Response Evidence를 찾지 못했다는 뜻뿐이다. 블랙박스의 서버 전용 표면은 알 수 없으므로 전체 완료 퍼센트를 만들지 않는다.

## 2. 사실 모델

```text
실제 HTTP Request/Response ─────────────▶ Observation Fact ─┐
응답으로 받은 OpenAPI·HTML·JavaScript ─▶ Declaration Fact ─┼─▶ Endpoint·Parameter Delta
Explorer의 Evidence-bound 산출물 분석 ─▶ Declaration Fact ─┤
산출물 파싱 결과 ──────────────────────▶ Extraction Report ─┘
                                                            ↓
                                         인가 그래프·재현 검토(상세층)
```

- `EndpointKey = service + method + canonical path template`
- `ParameterCoordinate = EndpointKey + location + canonicalPath`(D-143). 관측(`ParameterExtractor`)과 모든 선언 어댑터가 `ParameterCoordinates`로 같은 canonicalPath를 만들어 같은 논리 파라미터를 하나의 `ParameterFact`로 병합한다. canonicalPath는 machine join key, displayName은 사람 라벨로 분리한다. `fieldPath`는 사람이 읽는 표시 경로(PATH→선언명, JSON→`parent.child`·`parent[].child`, 그 외→이스케이프 해제 이름)로 canonicalPath와 다르다.
- canonicalPath 문법: PATH `/segments/N`(빈 세그먼트 제거 zero-based, 선언 이름·실제 값 아님), JSON_BODY/GRAPHQL_VARIABLE RFC6901 기반 FlowScope pointer(`~0/~1`, 배열 원소 `*`, literal `*`=`~2`, 중첩 `/`), QUERY/FORM_BODY/MULTIPART_BODY escaped name token, HEADER lowercase token, XML_PATH `{uri}local`.
- 위치: `PATH`, `QUERY`, `JSON_BODY`, `FORM_BODY`, `MULTIPART_BODY`, `HEADER`, `GRAPHQL_VARIABLE`, `XML_PATH`
- 저장 좌표는 `coordinateVersion`(LEGACY_V1/FLOW_V2). PATH/QUERY/FORM/MULTIPART/HEADER와 점 없는 단일 JSON key는 LEGACY_V1을 무손실 변환해 join하고, 점 있는 legacy JSON/GraphQL, 세그먼트 없이 평탄화된 JS 이름, OpenAPI path slot 정렬 실패는 `UNRESOLVED_COORDINATE` 상태(`coordinateResolved=false`)와 진단으로만 남아 join·Gap 승격 대상이 아니다. 정적 JS 선언은 AST 세그먼트(중첩 키·배열 원소 wildcard)를 보존해 리터럴 점 키와 중첩, 리터럴 `*` 키(`~2`)와 배열 원소 `*`를 구분한다. PATH 선언의 `/segments/N`은 template의 실제 placeholder 위치만 확정 좌표로 받는다.
- 관측에는 값 대신 shape·valueType·byteLength·masked, source, run, identity, status와 Evidence ID만 둔다. valueType은 실제 타입(`"1"`=STRING, `1`=INTEGER)이고 UUID·숫자형 문자열 형식 신호는 표시 shape에만 반영된다. distinct 값 수는 타입을 포함한 count만 남기고 digest는 노출하지 않는다.
- 선언에는 type, adapter, reason, Evidence ID와 정의가 밝힌 declaredType/declaredShape/conditionText(`oneOf[i];`/`anyOf[i];`/`enum[i];` 인덱스, 값 미복사)·confidence(정의는 INFERRED, 관측은 OBSERVED)를 둔다. requirement는 REQUIRED/OPTIONAL/CONDITIONAL/UNKNOWN이며 선언이 서로 다르면 UNKNOWN.
- 파싱 보고에는 산출물 종류, adapter, `PARSED/PARTIAL/FAILED/LIMIT_EXCEEDED`, 파서 실패 범주, call-site 해석 실패 범주와 추출 수를 둔다.
- 비밀값 원문, 조합 가능한 값 목록, 인증 header는 surface snapshot에 넣지 않는다.
- `SurfaceAnalysis`는 Evidence에서 재생성되는 projection이다. SQLite에 두 번째 정본을 만들지 않는다.

## 3. 범용 추출 계약

### 실제 HTTP 관측

- query 이름과 값 shape
- canonical path template의 변수 위치
- 중첩 JSON field path와 배열 shape
- form-urlencoded 이름
- multipart `Content-Disposition name`
- GraphQL은 `path#operationName`과 `variables` field. `query`·`operationName` transport 필드는 제외

### 대상 선언

- OpenAPI/Swagger path/query/formData/body parameter(path·operation 병합, operation override), request body schema, local `$ref`만(외부·순환 거부), oneOf/anyOf 변형(CONDITIONAL)·enum 인덱스, `type/format` 타입, binary·file 제외, `required` 미표기 OPTIONAL
- HTML form action/method, 성공 가능한 이름 있는 control, submitter의 `formaction/formmethod`
- JavaScript AST에서 직접 확인한 `fetch`, `XMLHttpRequest`, axios, jQuery, `sendBeacon` call-site
- 해당 call-site의 static URL, method, query 이름과 literal object body key(리터럴 값 종류 포함). spread 객체·`__proto__`·constructor/prototype 컨테이너·method 미해석 call-site는 선언하지 않음
- lexical scope에서 확인되는 불변 문자열·object member, template literal, 단순 `+` 결합
- axios import/direct call과 `axios.create` instance의 정적 `baseURL`, 요청별 `baseURL`·`allowAbsoluteUrls` override
- 독립 Explorer가 현재 run의 실제 응답 Evidence에서 직접 읽어 구조화 도구로 등록한 endpoint·parameter. 이 경로는 `LLM_ARTIFACT_ANALYSIS` provenance와 locator/reason을 보존하며 값이나 인증·세션 header는 받지 않는다.

### client asset inventory

- HTML `script[src]`, `modulepreload`, script `preload/prefetch`
- ECMAScript static/dynamic import
- Next.js pages-router `__BUILD_MANIFEST`의 client chunk 참조

asset은 후속 JavaScript 분석 대상으로만 남긴다. HTML navigation과 script file을 API endpoint로 세지 않는다. Next manifest의 화면 route key도 API로 추정하지 않는다.

### 명시적 비지원

- superagent를 포함해 지원 목록 밖 client와 application 고유 wrapper의 HTTP 의미
- 일반 interprocedural data flow, 재할당된 binding/property, 런타임 계산, axios defaults mutation·interceptor, 난독화 복원, source map
- 아직 받지 않은 lazy chunk
- GraphQL introspection/schema declaration과 batch request 완전 분리
- 서버에만 존재하는 endpoint·조건부 입력

타깃 host, 업무 명사, crAPI 정답은 규칙 조건으로 쓰지 않는다. 프레임워크 adapter는 공개 산출물의 명시 구조를 읽어 공통 route/fact schema로 변환할 때만 추가한다.

## 4. 차이 상태와 화면

| 상태 | 뜻 |
|---|---|
| `DECLARED_NOT_OBSERVED` | 선언 근거는 있으나 실제 HTTP 관측 없음 |
| `ONE_SOURCE_OBSERVED` | 선언된 항목을 H/S/L 중 한 source에서 관측 |
| `MULTI_SOURCE_OBSERVED` | 두 source에서 관측 |
| `ALL_SOURCES_OBSERVED` | 세 source에서 관측 |
| `OBSERVED_NOT_DECLARED` | 실제 관측은 있으나 현재 선언 산출물에서 근거 없음 |

기본 화면 `API·입력 차이`는 endpoint 행, parameter badge, source별 관측과 provenance를 보여 준다. source checkbox를 끄면 행·badge·상태·통계·상세 Evidence가 같은 projection으로 다시 계산되며 원 Evidence는 삭제되지 않는다.

LLM Explorer의 OPTIONS 요청과 명시적 CORS preflight는 capability probe로 별도 표시하고 endpoint 관측 수에서 제외한다. 일반 HUMAN OPTIONS API 관측과 OpenAPI·산출물에 명시된 OPTIONS 선언은 유지한다. 모든 OPTIONS를 일괄 삭제하면 실제 API 표면을 잃으므로 채택하지 않는다.

산출물 요약은 분석 대상 수, 완전 해석 수, 일부 미해석/실패 산출물 수와 해석 실패 지점 수를 함께 표시한다. 실패가 있으면 종류·범주·Evidence ID·line·제한된 이유를 표시한다. `PARSED`는 문법 파싱 성공일 뿐 모든 call-site 해석 성공을 뜻하지 않는다. 따라서 결과 0건이 “현재 지원 계약에서 call-site가 없음”인지 “동적 값·임의 wrapper 등을 읽지 못함”인지 구분할 수 있다.

Resource/object와 owner는 첫 화면에서 펼치지 않고 선택 API의 인가 상세층에 유지한다. 이 projection은 기존 BOLA/IDOR·BFLA 판정 입력을 바꾸지 않는다.

## 5. 구현 상한

- JavaScript parser 입력 4,194,304자, AST 순회 250,000노드, call-site 20,000개, asset 20,000개
- call-site당 parameter 1,024개, 참조 해석 깊이 12
- endpoint당 parameter 1,024개, 관측 JSON 깊이 16, OpenAPI schema 깊이 20
- JavaScript 분석 cache 128개. key는 원문 대신 SHA-256 digest, value는 추출 결과만 두며 dataset 교체·초기화 시 비운다.

**전달 경계:** D-128은 발견용 HTML/JavaScript/JSON/XML 응답의 `FULL` payload 상한을 기본 4MiB로 맞췄다. `body/respText`는 8,192자 UI preview로 남지만 RouteCandidate/Surface는 보존된 payload 전문을 우선 읽는다. 1.4MiB JavaScript의 뒤쪽 call-site를 capture→record 경로에서 확인하는 회귀가 있다. 4MiB 초과 응답은 metadata-only이므로 전체 분석하지 않으며, parser 입력 상한과 임의 wrapper·런타임 조립의 의미 분석은 별개다.

Closure Compiler는 `ECMASCRIPT_NEXT` parser로만 사용하고 target JavaScript를 실행하지 않는다. Node, Chrome, Playwright 또는 네트워크가 이 정적 추출에 필요하지 않다. dependency는 버전을 고정하고 fat JAR에서 relocation하며 원 LICENSE·NOTICE·third-party notice를 보존한다.

## 6. held-out fixture와 실패 분류

`src/test/resources/surface-heldout/`는 개발용 단위 입력과 분리된 server-truth fixture다. `truth.json`은 분석기 입력에 전달하지 않고 테스트가 끝난 뒤 exact set을 비교한다.

현재 fixture 계약:

- endpoint 7개
- parameter 18개
- client asset 5개
- application wrapper 1개는 `UNRECOGNIZED_APPLICATION_WRAPPER`로 명시적 비지원
- OpenAPI, HTML form/submitter, modern ESM, axios/fetch, Next pages manifest, Nuxt형 module asset, Angular형 module script, GraphQL operation/variables 포함

이 fixture는 자기 저장소 안에서 작성한 구조 회귀다. 실제 다양한 앱의 효과나 외부 일반화 성능을 증명하는 독립 benchmark는 아니다.

실패는 다음처럼 분리한다.

| 범주 | 현재 처리 |
|---|---|
| syntax recovery | `PARTIAL/SYNTAX_RECOVERY`로 사실과 추출 결과를 함께 표시 |
| parser failure | `FAILED/PARSE_FAILED` |
| input/AST limit | `LIMIT_EXCEEDED/INPUT_SIZE_LIMIT` 또는 `AST_NODE_LIMIT` |
| application wrapper | 의미를 추측하지 않고 held-out 실패 목록에 유지 |
| unresolved member/dynamic URL | 후보를 발명하지 않고 Evidence·line에 연결된 해석 실패로 표시 |
| dynamic axios baseURL | `/items` 같은 거짓 상대 endpoint를 만들지 않고 별도 실패 범주로 표시 |
| mutable binding/property | 초기값을 현재값으로 오인하지 않고 정적 해석에서 제외 |
| unobserved lazy asset | 받은 산출물 안 추출률과 전체 fixture 발견률을 분리 |
| server-only surface | 알 수 없음. 분모에 넣지 않음 |

## 7. 확정한 10단계와 현재 gate

1. 범용 HTTP·parameter observation — 구현·회귀 완료
2. OpenAPI·HTML parameter declaration — 구현·회귀 완료
3. Generic JavaScript AST/call-site 분석 — 구현·회귀 완료
4. endpoint·parameter delta 화면 — 구현·회귀 완료, 파서 상태 포함
5. held-out fixture 검증 — 저장소 내부 합성 truth exact-set 회귀만 완료. 독립 효능 검증은 미완료
6. 실패 사례 분류 — parser/limit, 동적 URL, member, axios baseURL, interprocedural flow와 일부 HTTP-like wrapper를 구조화. 모든 wrapper·런타임 흐름 분류는 미완료
7. 실패 구조 기반 Next.js adapter — pages-router manifest의 chunk discovery만 구현. 실제 실패 빈도에 근거한 우선순위 검증은 미완료
8. Vue/Nuxt·Angular·GraphQL 확장 — 공통 HTML/ESM asset 경로와 GraphQL observed operation/variables 회귀만 완료. framework별 router/schema parser와 실제 앱 검증은 미구현
9. 승인된 외부 대상 pilot — exact scope와 실행 승인이 없어 미실행
10. 결과 기반 지원 Tier 조정 — 9 결과 전에는 확정하지 않음

## 8. 다음 평가

아래는 후속 평가 설계이며 아직 수행하지 않았다. 현재 독립 Explorer는 실제 HTTP Observation과 Evidence-bound Declaration을 만들 수 있지만, 이것만으로 외부 대상 발견 효능이 검증된 것은 아니다. 외부 pilot에서는 같은 scope·계정·시간·요청 예산을 정의하고 source별 고유 endpoint/parameter와 검토 작업량을 분리할 계획이다. 정답은 가능한 경우 서버 fixture route manifest 또는 빌드 전에 고정한 truth를 사용하고 런타임 분석기에 주지 않는다.

최소 보고 항목:

- endpoint declaration precision/recall
- parameter declaration precision/recall
- observed parameter extraction precision/recall
- canonical merge 오류
- parsing failure와 unsupported 구조 수
- source별 고유 유효 발견과 사람이 검토한 false positive/false negative/unresolved
- 비밀값 snapshot 노출 0건

같은 세션에서 받은 bundle만 분모로 쓰면 방문하지 않은 화면의 lazy chunk가 분모와 분자에서 함께 빠져 과대평가된다. 따라서 “받은 산출물 안의 추출률”과 “서버 truth 전체 대비 발견률”을 반드시 분리한다. pilot 전에는 지원 Tier나 성능 우월성을 확정하지 않는다.
