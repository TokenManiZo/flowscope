# Endpoint·Parameter Surface Delta 설계와 검증 계획

이 문서는 FlowScope가 특정 타깃에 맞춘 규칙 없이 HUMAN·SCANNER·LLM의 탐색 차이를 데이터화하고 보여 주는 현재 계약과 다음 검증 순서를 정의한다. 인가 판정의 정본은 `architecture.md`와 `decisions.md`이며, 이 기능은 취약점 판정기가 아니라 다음 검토 위치를 좁히는 작업목록이다.

## 1. 제품 질문

첫 화면은 다음 질문에 답해야 한다.

> 대상이 명시한 API·입력과 실제 HTTP Evidence를 비교했을 때, 어느 출처가 어떤 엔드포인트와 파라미터를 관측했고 무엇이 아직 미관측인가?

`미관측`은 취약점, 도달 가능, 실제 기능 또는 특정 source의 실패를 뜻하지 않는다. 해당 선언과 대응하는 실제 Request/Response Evidence를 현재 데이터셋에서 찾지 못했다는 뜻뿐이다.

## 2. 데이터 계층

```text
Raw Evidence
  ├─ 실제 HTTP 요청/응답
  └─ 실제 응답으로 받은 OpenAPI·HTML·JavaScript
        ↓
Observation Fact                    Declaration Fact
실제로 요청한 endpoint/parameter    산출물에 명시된 endpoint/parameter
        └──────────────┬──────────────┘
                       ↓
             Endpoint·Parameter Delta
                       ↓
      인가 그래프·매트릭스·재현 검토(별도 상세층)
```

- `EndpointKey = service + method + canonical path template`
- `ParameterKey = EndpointKey + location + fieldPath`
- 위치는 `PATH`, `QUERY`, `JSON_BODY`, `FORM_BODY`, `MULTIPART_BODY`다.
- 값은 저장하지 않는다. 관측 형태(`STRING`, `INTEGER`, `UUID`, `ARRAY` 등), source, run, identity, status와 Evidence ID만 보존한다.
- 비밀값 원문, 조합 가능한 값 목록, 인증 header는 surface snapshot에 포함하지 않는다.
- `SurfaceAnalysis`는 저장된 Evidence와 `RouteCandidate`에서 결정론적으로 다시 만들 수 있는 projection이다. 별도 SQLite 정본 테이블을 만들지 않는다.

## 3. 범용 추출 계약

### 실제 관측

- query string 이름과 값 형태
- JSON body의 중첩 field path와 배열 형태
- `application/x-www-form-urlencoded` 이름
- multipart의 `Content-Disposition name`
- canonical path template의 변수 위치

### 선언

- OpenAPI/Swagger의 path/query parameter, request body schema, 로컬 `$ref`
- HTML form의 action/method와 이름 있는 control
- 정적 JavaScript literal URL의 query 이름
- 같은 호출 표현식 안에서 직접 확인되는 `fetch`/axios 계열 request object의 literal body key
- 기존 route discovery provenance

### 하지 않는 것

- 타깃 이름, host, `/orders` 같은 업무 명사를 조건으로 삼지 않는다.
- React·Next.js 등 프레임워크를 보고 의미를 추정하지 않는다.
- 문자열 결합, 런타임 계산, 암호화·난독화된 route를 실제 값처럼 복원하지 않는다.
- 서버에만 존재하는 endpoint를 블랙박스 전체 분모에 넣지 않는다.
- header 전체를 기본 파라미터 표면으로 세지 않는다. 인증·브라우저 협상·추적 header가 입력 작업목록을 압도하고 비밀 경계를 넓히기 때문이다. 명시 schema가 생기면 비밀값 없는 별도 adapter로 검토한다.

## 4. 상태와 표시

| 상태 | 뜻 |
|---|---|
| `DECLARED_NOT_OBSERVED` | 선언 근거는 있으나 실제 HTTP 관측 없음 |
| `ONE_SOURCE_OBSERVED` | 선언된 항목을 H/S/L 중 한 source에서 관측 |
| `MULTI_SOURCE_OBSERVED` | 두 source에서 관측 |
| `ALL_SOURCES_OBSERVED` | 세 source에서 관측 |
| `OBSERVED_NOT_DECLARED` | 실제 관측은 있으나 현재 선언 산출물에서 근거를 찾지 못함 |

첫 화면은 이 상태를 endpoint 행과 parameter badge로 보여 준다. `H/S/L —`는 미관측 표시이며 해당 lane이 완료됐다는 뜻이 아니다. lane 완료를 확인하지 않은 상태에서 “놓쳤다”고 확정하지 않는다. Resource/object와 owner는 삭제하지 않고 API를 선택한 인가 상세층에 유지한다.

source checkbox는 표시 장식이 아니라 현재 projection 필터다. 체크를 끈 source는 endpoint·parameter badge, delta 문구, 통계와 상세 Evidence에서 함께 빠지며 원 Evidence는 삭제되지 않는다.

## 5. 현재 구현과 한계

beta.41은 다음을 구현한다.

- `SurfaceAnalysis`의 값 없는 사실 모델
- `SurfaceAnalyzer`의 관측·OpenAPI·HTML form·정적 JavaScript literal 추출
- Web snapshot의 `surface.endpoints`
- 기본 `놓친 API·입력` 작업목록과 endpoint별 provenance/Evidence 상세
- Standalone도 입력 Evidence의 service를 로컬 scope로 삼아 route candidate와 surface를 재생성
- 동일 snapshot revision의 projection 재사용과, 다른 JavaScript 문장의 객체 key를 앞 요청에 붙이지 않는 호출 경계

아직 구현 또는 실증되지 않은 범위:

- JavaScript AST와 source map을 이용한 alias/wrapper/data-flow 분석
- lazy chunk를 받지 않은 화면의 선언 분모
- GraphQL schema의 argument와 operation별 variable 계약
- framework-specific manifest/router adapter
- lane 완료 상태를 결합한 확정 “source 누락” 문구
- 실제 다양한 앱에서 endpoint·parameter precision/recall 우월성

## 6. 특정 타깃 튜닝 방지

1. fixture는 업무명 대신 구조 특성으로 나눈다: REST/JSON, form, multipart, SPA static bundle, OpenAPI, GraphQL.
2. 같은 구조에서 route·field 이름만 무작위로 바꾼 semantic-renaming 회귀를 둔다.
3. 개발 corpus와 최종 held-out corpus를 분리한다.
4. crAPI는 사용성·통합 확인 대상일 수 있으나 규칙 튜닝과 정답 작성에 사용하지 않는다.
5. 실패 사례는 새 타깃 이름 조건이 아니라 새로운 표준 문법 또는 명시적 adapter 계약으로만 일반화한다.

## 7. 평가 계획

### 단위 정확성

- endpoint declaration precision/recall
- parameter declaration precision/recall
- observed parameter extraction precision/recall
- canonical endpoint merge 오류율
- 비밀값 snapshot 노출 0건

### 3-way 효능

동일 scope, 계정, 시간·요청 예산에서 다음을 별도로 측정한다.

1. HUMAN
2. SCANNER
3. LLM Explorer
4. 각 source의 고유 endpoint와 parameter
5. 선언 후 미관측 항목을 검토해 실제 도달 가능/조건부/죽은 코드/범위 밖으로 분류

관측한 문서를 정답지로 쓰면서 같은 문서에서 recall을 계산하면 순환 평가가 된다. 최종 평가는 별도 fixture의 서버 route manifest 또는 빌드 단계에서 고정한 정답을 사용하고, 런타임에 전달하지 않는다. lazy chunk는 “받은 산출물 안의 추출률”과 “전체 fixture route 대비 발견률”을 분리한다.

### 다음 gate

1. JavaScript parser를 regex에서 AST 기반 adapter로 교체할 가치가 있는지 blind corpus로 비교
2. GraphQL/OpenAPI/HTML adapter별 오탐·미탐 보고
3. 실제 Burp 재로드 후 HUMAN·ZAP·LLM source delta가 UI와 Evidence 상세에 일치하는지 확인
4. 사용자가 상위 미관측 항목에서 실제 검토 위치를 더 빨리 찾는지 task-time 비교

성능 향상이 없거나 REVIEW 작업량이 과도한 adapter는 기본 경로에서 낮추거나 제거한다.
