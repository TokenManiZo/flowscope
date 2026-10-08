# 객체 그래프 확장 영향 분석

작성일: 2026-10-08. 구현 전 영향 분석과 구현 완료 결과를 함께 기록한다. 아래 분석의 기존 코드 근거는 구현 전 기준이다.

## 구현 완료 결과

- 표시 전용 `ObservedObjectProjection`과 스냅샷 `displayObjects`를 추가했다. 기존 operation/resource, 판정 셀, 저장 키와 Request Lab의 원본 요청 좌표를 유지한다.
- 경로는 같은 서비스·메서드·경로 계열에서 서로 다른 Evidence가 두 건 이상 관측되어야 표시한다. 신원·출처·run ID가 달라야 한다는 조건은 없다. 같은 URL의 반복 관측도 알려진 후보 위치를 보강하며, 한 건의 경로 후보는 응답 객체로 우회하지 않는다.
- query와 요청 body는 두 건 관측 조건을 적용하지 않는다. 필드 스키마로 접힌 그룹을 만들고 실제 관측 조합을 펼친다. JSON 키 순서는 정규화하고 배열·반복 query 값의 순서는 유지한다. 민감 값은 객체 구분 자료에서 제외한다.
- 파라미터 없는 성공 GET의 JSON/XML 응답 전체를 하나의 표시 객체로 처리한다. HTML, 오류 응답, 잘못된 문서, DTD 및 보존되지 않은 본문은 제외한다. XML 외부 엔티티 접근은 차단한다.
- 각 그룹에서 OBJ 1부터 번호를 부여한다. 필터 변경으로 번호를 다시 매기지 않는다. 확정된 기존 소유자 연결이 있을 때만 계정 이름을 붙인다.
- 새 객체 선택은 실제 Evidence를 보존한다. 여러 원본 API가 표시 API 하나로 묶이면 임의의 대표 요청을 API 실행 대상으로 설정하지 않는다.
- 경로(`3350d5d`), query(`93ce044`), 요청 body(`d52029a`), 응답 body를 각각 별도 커밋으로 구현했다.

검증: 프로젝트 Node 24에서 프런트엔드 전체 93개 파일·778개 테스트 통과. 마지막 요약/성능 보완 뒤 관련 41개 테스트와 TypeScript 검사 통과. Java 객체 투영·스냅샷 불변성·인가 판정·트래픽 분류·저장·Request Lab·20,000건 스냅샷 회귀 검사 통과. Request Lab loopback 테스트는 샌드박스 바인딩 제한으로 별도 권한 실행 후 통과했다. 프로덕션 화면 번들과 `target/flowscope-1.0.1.jar` 패키징 완료. 실제 crAPI UI 재실행은 수행하지 않았으며 해당 경로 패턴은 회귀 테스트로 검증했다.

남은 한계: 관측만으로 고정 동작명과 임의 문자열 ID를 완전히 구분할 수 없고, 세그먼트 내부 문자열의 ID 경계를 임의로 절단하지 않는다. 표시 객체는 업무 객체나 소유권 확정 자체를 의미하지 않는다. 입력 크기·깊이 제한에 걸리면 원본 Evidence만 유지한다.

## 결론

path, query, 요청 body, 파라미터 없는 GET의 응답 body를 그래프에서 넓게 표현하는 방향은 합당하다. 다만 새 표시 객체를 기존 RequestRecord.resource로 대체하는 방식은 피해야 한다. 기존 resource는 표시 외에도 인가 판정, 소유자 정책, 트래픽 분류와 연결된다. 표시 객체와 기존 분석 리소스를 분리하고, 명시적 연결이 있을 때만 기존 판정 정보를 가져오는 방식이 적절하다.

1~3단계를 먼저 적용하고 4단계를 후속 커밋으로 진행한다. 단계마다 단독으로 동작하고 기존 동작을 검증할 수 있어야 한다. 소유자 추정 변경은 이 작업 범위에서 제외한다.

## 현재 코드 근거

- `Normalizer.normalizeAll` (Normalizer.java:164): operation 템플릿과 lexical 객체 후보를 별도로 계산하며 path, query, 요청 body 참조를 결합한다. 첫 참조가 대표 resource다.
- `Normalizer.resourceReferences` (Normalizer.java:369): path → query → body 순으로 참조를 수집한다.
- `SnapshotJsonWriter.events` (SnapshotJsonWriter.java:305): 모든 resourceReferences를 events.objects에 직렬화한다. 이미 복수 참조를 전달하는 경로가 있다.
- `projectHierarchy` (graphHierarchy.ts:420): 신원 → API → 객체로 표시한다. 객체 노드와 연결은 주로 cell.resource에서 만든다.
- `AuthorizationAnalysis.CellKey` (AuthorizationAnalysis.java:16): identity, operation, resource가 판정 셀 식별자다.
- `TrafficClassifier.securityRelevant` (TrafficClassifier.java:127): resource가 있으면 보안 관련 신호다. 새 표시 후보를 resource에 넣으면 포함/제외 판단이 바뀔 수 있다.
- `AuthorizationAnalyzer.resolveOwners` (AuthorizationAnalyzer.java:121): resource 문자열을 소유자 추정·정책 조회 키로 사용한다.
- `GraphInspectorPanel` (GraphInspectorPanel.tsx:40,58): resource 선택으로 공개 정책 확인과 소유자 제어를 제공한다. 새 표시 객체에 기존 기능을 무조건 붙이면 잘못된 정책 편집이 가능하다.
- `ParameterExtractor.extract` (ParameterExtractor.java:100): path/query/form/JSON/GraphQL/multipart/XML 위치와 값 요약을 이미 추출한다. 새 표시 필드 수집은 이 기반을 재사용할 수 있다. 다만 현재 값 요약은 별도의 민감 필드 처리 검토가 필요하다.
- `ParameterKey` (ParameterKey.java:6): 서비스, 메서드, operation, 입력 위치, canonicalPath를 구분한다. 같은 이름의 다른 위치를 구분하는 기반이다.
- `Pipeline.runInternal` (Pipeline.java:92): coverageEligible와 SourceTrustPolicy를 거쳐 분석 대상으로 선택한다. 표시 확장으로 이 조건을 우회하면 안 된다.

## 제안 동작의 해석

### 1. 경로

- `/api/101`, `/api/202`: 마지막 변화 위치를 객체 ID로 사용한다.
- `/api/101/detail`, `/api/202/detail`: 마지막 변화 위치는 101/202이며 뒤의 고정 detail은 API 동작 문맥에 남긴다.
- `/api/101/detail/5`, `/api/101/detail/6`, `/api/202/detail/1`: 앞의 101/202는 API 범위에 남기고 마지막 변화 위치의 5/6/1을 객체로 표시한다.
- 앞의 값이 같은 API 범위 아래에서 객체를 연결한다. 서비스와 HTTP 메서드는 분리한다.
- 경로 비교는 단순히 같은 길이의 모든 URL을 비교하면 안 된다. `/orders/search`와 `/orders/export`도 달라지기 때문이다. 관측된 공통 구조를 이용하고 모호한 경우는 표시 후보로 남긴다.
- 한 개만 관측하면 값 변화만으로 위치를 알아낼 수 없다. 기존 lexical ID, query/body 값과의 연결 등 보조 근거를 사용할 수 있다.
- `/detail5`처럼 세그먼트 내부의 ID는 `/detail/5`와 다르다. 단순 `/` 분리로는 경계를 알 수 없으므로 초기에 전체 세그먼트를 후보로 보존하며 임의로 문자열을 절단하지 않는다.
- 기존 operation은 변경하지 않고 표시용 API 범위를 별도로 갖는다. 액션·재전송은 원본 요청 Evidence를 기준으로 실행한다.

### 2. 쿼리

- 접힌 그룹은 해당 API의 query 필드명을 표시한다. 예: `page · userid`.
- 펼치면 관측된 파라미터 조합을 OBJ 번호로 표시한다. `page=1&userid=1`이 OBJ 1, `page=2&userid=1`이 OBJ 2다. 필드마다 독립 OBJ로 만들면 실제 요청 조합이 손실되므로 기본 단위는 요청의 query 조합이다.
- 파라미터 순서만 바뀐 조합은 같게 처리하되, 중복 키와 값의 반복 순서는 보존한다. `a=1&a=2`를 단일 값으로 덮어쓰지 않는다.
- 빈 값, 키만 존재, 명시적 null은 가능한 범위에서 구분한다. URL 디코딩은 한 번만 한다.
- field 이름 목록이 다른 조합을 하나의 고정 라벨로 오표시하지 않는다. 같은 API/위치 아래 스키마별 그룹 또는 필드 합집합과 각 OBJ의 실제 필드를 제공한다.
- page 같은 제어값도 표시한다. 이것을 업무 객체·소유자로 자동 확정하지 않는다.

### 3. 요청 body

- 접힌 그룹은 body 필드 구조를 표시한다. `userID · password`는 필드명이며 실제 값이 아니다.
- 펼친 OBJ는 요청 body의 한 관측 조합이다. JSON 키 순서·공백은 정규화하고 배열 순서, 자료형, null/빈 값은 보존한다.
- 중첩 필드 위치를 보존한다. `/billing/id`와 `/shipping/id`를 단순 id로 합치지 않는다.
- query와 body에 같은 이름이 있어도 입력 위치가 달라 별도 그룹이다. 한 요청에 path/query/body가 모두 있으면 각각 표시한다.
- 기존 요청 파서의 JSON, form, multipart, XML 지원을 활용한다. 파일 업로드 원문은 객체 라벨이나 키로 사용하지 않는다.
- password 등 민감 필드 이름은 표시할 수 있다. 값은 라벨/스냅샷/로그/신규 저장 키에 노출하지 않는다. 단순 평문 SHA-256도 저엔트로피 비밀번호의 추측을 가능하게 하므로 같은 값 비교용 키로 사용하지 않는다.
- 민감 필드 값이 다르다는 이유만으로 비밀번호별 OBJ를 만들지 않는다. 비민감 데이터의 정규화 결과와 민감 필드 존재/형태를 이용하고 Evidence로 개별 관측을 연결한다.
- 요청 body 등록 자체에는 응답 일치를 필수로 하지 않는다. 요청-응답의 같은 값은 별도 연결 근거이며 이름 변경, 타입 차이, 흔한 값의 우연한 일치 문제를 별도로 다룬다.

### 4. 입력 파라미터 없는 GET의 응답

- URL 경로 객체, query, 요청 body가 없는 GET에서 JSON/XML 응답 전체를 하나의 표시 객체로 취급한다. 배열의 원소 수만큼 자동 분할하지 않는다.
- 접힌 라벨은 OBJ, 펼치면 서로 다른 응답의 OBJ 번호다. 목록 응답 하나는 OBJ 하나다.
- 같은 구조만으로 같게 합치지 않는다. 정상화한 내용으로 비교한다. 객체 키 순서는 정상화하고 배열 순서는 보존한다.
- 내용 형식은 Content-Type과 파싱 결과를 함께 사용한다. JSON 오류, XML 파싱 실패, 빈 응답, 204, 304는 데이터 객체와 구분한다.
- 비성공 응답을 성공 데이터 객체처럼 표시하지 않는다. 상태/응답 역할을 표시하고 보조 관측으로 보존할 수 있다.
- XML 외부 엔티티/DTD 처리는 비활성화한다. 입력 크기, 깊이, 항목 수 제한을 둔다. 한도 초과는 누락 이유를 기록한다.
- 응답 해시 일치는 동일 응답 관측이라는 뜻이며 공개 객체나 동일 업무 엔티티를 확정하는 근거는 아니다.

## 데이터와 UI 경계

표시 객체에는 내부 안정 키, API 표시 범위, PATH/QUERY/REQUEST_BODY/RESPONSE_BODY 종류, 필드 구조, 표시 순번, Evidence 목록, 기존 분석 리소스 연결 여부가 필요하다. OBJ 순번을 내부 식별자로 사용하지 않는다.

새 표시 그룹과 OBJ는 기존 resource 노드의 별칭으로 무조건 취급하지 않는다. 명시적 legacy resource 연결이 없으면 소유자/인가 판정/자동 추천을 표시하거나 실행하지 않는다. 기존 API 판정은 실제 operation 기준으로 유지한다. 여러 실제 operation을 표시 API 하나로 묶을 경우 공통 판정을 임의로 선택하지 않는다.

가능하면 저장된 Evidence에서 표시 모델을 다시 계산하고 새 원문 저장을 추가하지 않는다. 영구 OBJ 번호가 필요하면 프로젝트별 append-only 매핑을 저장하며 schema migration, JSON 프로젝트/SQLite 호환, 재열기/삭제/병합 동작을 검증한다. 매번 정렬해 번호를 매기면 새 관측이 기존 OBJ 번호를 바꿀 수 있다.

## 주요 위험과 대응

| 위험 | 대응 |
|---|---|
| 새 표시 객체 때문에 API 분류와 인가 셀이 변경됨 | legacy op/resource를 유지하고 표시 모델을 분리 |
| path 범위 변경으로 정책·재전송 대상이 바뀜 | 표시 API와 실행 operation 분리, 원본 Evidence 선택 |
| 여러 위치의 동명 필드가 합쳐짐 | location + canonicalPath 보존 |
| 화면 OBJ가 기존 판정 객체로 취급됨 | explicit legacy resource 연결 여부로 기능 제한 |
| password/토큰 값이나 값 비교 정보 유출 | 필드명만 표시, 민감 값 원문·단순 해시 미사용 |
| 기존 프로젝트의 레이아웃/선택 키가 깨짐 | 기존 키 유지, 신규 그룹 키 namespace 추가 |
| 큰 목록/배열에서 노드 폭증 | 그룹 접기, 더 보기, 집계, 파서 한도 |
| 같은 응답을 받은 사용자를 소유자/공개 객체로 오판 | 단순 관측 연결로 표시 |
| 서로 다른 응답을 구조만으로 합침 | 내용과 자료형을 포함한 정규화 비교 |

## 단계별 커밋과 검증

1. `feat(graph): add path object groups with parent scope`
   - 최소 공통 표시 모델과 path 표시를 함께 추가한다.
   - 문자열 ID, 고정 suffix, 다중 변화 위치, 부모가 다른 동일 자식 ID, 서비스/메서드 경계 검증.
   - 기존 정규화/인가 셀/재전송 operation 결과 유지 검증.
2. `feat(graph): group query observations by field schema`
   - query 필드 그룹과 요청 조합 OBJ를 추가한다.
   - page/userid, 파라미터 순서, 중복 키, 빈 값, path와 동시 존재, API 간 분리 검증.
3. `feat(graph): add request body observation objects`
   - 요청 body 필드 그룹과 조합 OBJ를 추가한다.
   - 중첩 JSON, 배열, 타입, form/XML/multipart, 민감 필드, query와 동시 존재 검증.
4. `feat(graph): add response objects for parameterless GET`
   - JSON/XML 응답 전체를 OBJ로 표시한다.
   - 요청 입력이 없는 조건, 반복 응답, 변경 응답, 오류/빈 응답, 크기 제한, XML 외부 엔티티 비활성화 검증.

각 단계에서 Snapshot 직렬화, graph hierarchy/projection/search/highlight/selection, 프로젝트 재열기와 선택 유지, 기존 authorization/traffic classification 회귀를 확인한다. 새로운 OBJ에서 승인되지 않은 소유자 편집/재전송이 가능한지 확인한다. 1~3단계 완료 뒤 실제 저장 트래픽에서 표시 수와 처리 시간을 측정하고 4단계를 진행한다.

## 구현 전 확정할 동작

이 문서는 query/body의 OBJ를 각 필드의 값이 아니라 한 요청의 비민감 필드 조합으로 해석한다. 필드명이 접힌 라벨이고 OBJ를 펼치면 필드 위치/형태와 Evidence를 확인한다. response의 OBJ는 응답 전체를 단위로 한다. 이 단위를 바꾸면 중복 제거, 번호, 선택, API 연결 의미가 달라지므로 구현 시작 시 이 해석을 유지하거나 사용자 의도를 반영해 명확하게 바꿔야 한다.

## crAPI 화면 사례와 복수 관측 기준

첨부 화면에서는 posts/recent 목록 API와 서로 다른 문자열 ID의 게시물 상세 API 3개가 보인다. 상세 API는 `{id}` 형태의 operation-group으로 묶이지만 객체 레인에는 해당 게시물 객체가 보이지 않는다. 원본 Evidence를 직접 확인하지 않았으므로 요청별 resource 값은 확정하지 않는다.

코드에서 확인한 직접적인 불일치는 프론트엔드 `graphPathShape.ts:3`이 16자 이상의 영문+숫자 토큰을 ID 형식으로 묶는 반면, 백엔드 `Normalizer.java:33`은 숫자/UUID/16진수만 경로 후보로 허용한다는 점이다. g~z가 있는 긴 영숫자 ID는 화면에서는 `{id}`로 묶여도 lexical resource는 생성되지 않을 수 있다. 백엔드 TemplateCatalog는 이 후보 필터를 먼저 통과해야 하므로 동일 위치에 여러 문자열 값이 관측되어도 현재 객체 추출이 자동 보강되지 않는다. API 묶음과 객체 추출이 서로 다른 규칙을 사용하는 문제를 1단계에서 해결해야 한다.

path 표시 객체는 같은 서비스·메서드·API 범위의 URL 전체 또는 경로 패턴에서 실제 관측이 2개 이상일 때 표시한다. 2명의 사용자, 2개의 source, 2개의 runId는 필수 조건이 아니다. 숫자/UUID/긴 영숫자 형식도 관측 1개만 있으면 내부 후보로 유지하고 OBJ로 표시하지 않는다. 형식만으로 결정하기 어려운 일반 문자열도 해당 위치의 서로 다른 값, 요청/응답 값 연결, 관측/선언된 경로 템플릿으로 보강할 수 있다. 단독 `/posts/recent` 같은 고정 동작 이름까지 일괄 객체로 바꾸지는 않는다. 판별 근거가 없으면 원래 API를 유지하고 모호한 위치를 검토 대상으로 보존한다.

두 개의 서로 다른 경로 값은 구조 추론 근거이며 두 명의 관측자와 다른 개념이다. 같은 사용자·source·runId·method에서 서로 다른 게시물 3개를 조회해도 API 하나에 OBJ 3개를 연결할 수 있어야 한다. 같은 게시물을 여러 사용자가 조회하면 OBJ를 추가하는 대신 동일 OBJ에 접근 Evidence를 누적한다. 실제 operation의 실행 키는 유지하며 표시용 API 그룹만 합친다.

1단계의 추가 검증: crAPI 형태의 긴 영숫자 ID 3개 → 상세 API 표시 하나와 OBJ 3개; 같은 형식의 단독 ID → OBJ 미표시; 단독 숫자 ID → OBJ 미표시; 같은 URL의 실제 반복 관측 2회 → 위치 근거가 있으면 OBJ 하나; 같은 ID의 사용자/source 변경 → 동일 OBJ와 복수 Evidence; recent/search 같은 고정 경로 보존; 이전에 관측한 family에 새 값이 추가되어도 기존 OBJ 키 유지; 다른 source가 없어도 정상 표시.

## 최종 구현 경계와 수정 파일

### 구조 우선의 의미

후보 위치를 찾기 전에 numeric/UUID/hex로 제거하지 않는다. 원본 관측에서 service, method, 경로 세그먼트, 입력 위치, 필드 구조를 먼저 수집한다. 값 변화는 경로의 가변 위치를 발견하는 근거이며 Source/identity/runId의 수는 객체 등록 조건이 아니다. 형식 검사는 단독 관측에서 가변 위치를 제안하는 보조 근거로만 사용한다. 기존 YEARLIKE/CONTROL_FIELDS는 새 표시 모델의 객체 존재 여부를 결정하지 않는다.

구조 비교만으로 고정 endpoint와 문자열 ID를 항상 구분할 수는 없다. `/posts/recent`와 `/posts/featured`만 관측한 경우 둘이 동작 이름인지 객체 ID인지 구조가 동일하다. 이를 확정한 업무 객체라고 표시하지 않고 구조상 추정 근거를 기록한다. 단독 `/posts/foo`에서도 완전한 자동 판별은 불가능하며 원본 관측을 남긴다. 명확한 route 선언이나 URL/입력/응답의 연결이 있으면 이를 보강한다. 동작 이름 denylist를 전체 시스템에 하드코딩해 누락 문제를 다시 만들지 않는다.

### 1단계: 공통 표시 모델과 path

신규 `core/graph/ObservedObjectProjection.java` 한 곳에 표시용 타입과 구조 계산을 모은다. 최소 출력 정보는 apiKey/displayPath/actualOperations, objectKey/groupKey/kind, fieldPaths 또는 path 위치, 근거, Evidence 연결, optional legacyResource다. 원본 값 대신 안전하게 정규화한 내부 키를 만들며 내부 키와 OBJ 번호를 분리한다. 기존 graph.NodeType RESOURCE 의미를 바꾸지 않는다.

계산은 서버에서 관측 범위를 입력으로 한 번 수행한다. 이미 존재하는 traffic/source 적격 조건과 사용자의 관측 전체 보기 의미를 유지한다. 새 표시 객체를 이유로 EXCLUDE/REVIEW 요청을 판정 대상으로 승격시키지 않는다. 기존 스냅샷이 노출하는 데이터 이상의 원문·신원을 추가 노출하지 않는다.

경로는 세그먼트 trie 또는 부모 경로별 색인으로 비교한다. 전체 요청 쌍의 O(N²) 비교는 피한다. 고정 구간과 가변 구간을 정리한 뒤 마지막 가변 위치를 객체로 쓰며 이전 가변 값은 표시 API 범위에 남긴다. trailing 고정 구간은 API 동작 문맥에 남긴다. 경로의 대소문자, encoded slash, 중복 slash를 임의 정규화하지 않는다. 경로 분해 기준은 기존 캡처 path와 일치시키며 식별 값과 좌표를 구분한다.

단일 숫자/UUID/긴 토큰은 내부 후보로만 유지한다. path OBJ 표시는 같은 API 범위의 실제 관측 2개 이상을 요구한다. 단일 문자열 후보도 내부에 근거를 보존한다. 관측 수 조건과 ID 위치를 결정하는 구조 근거는 별개다. 새 관측이 추가되어 family가 보강되어도 개별 objectKey는 service, method, 실제 부모 범위, 원본 위치/값으로 안정적으로 유지하고 표시 그룹만 변경한다. 이전 가설이 변경된 그룹의 selection/layout은 Evidence와 실제 operation으로 복구한다.

`SnapshotJsonWriter`에 optional 표시 projection을 추가한다. 현재 events.objects의 resource/evidence 의미를 몰래 바꾸지 않는다. 원본 eventId는 역참조에 유지한다. 기존 스냅샷을 읽을 때는 신규 projection이 없으면 기존 표시로 fallback한다.

`frontend/src/lib/api/types.ts`에 선택적 표시 타입을 추가한다. `graphHierarchy.ts`에서 새 API 그룹과 객체를 소비하고 하나의 API 표시 노드 아래 여러 OBJ를 만든다. 기존 graphPathShape.ts의 추측 결과를 새로운 projection에 다시 적용하지 않는다. 신규 projection이 없는 legacy fallback에서만 유지한다.

`graphProjection.ts`의 selection에 displayObjectKey/displayApiKey와 실제 operation/Evidence를 함께 보존한다. 실제 operation 여러 개를 묶었을 때 첫 operation을 조용히 실행하지 않는다. API 액션은 개별 Evidence/요청 선택을 통해 수행한다.

`graphSearch.ts`, `graphHighlight.ts`, `graphFocus.ts`, `graphWorkspace.ts`, `relationshipNodeCard.ts`, `GraphInspectorPanel.tsx`를 함께 검토/수정한다. 그래프와 검색은 동일 projection을 사용한다. 필터 후 실제 관측 없는 OBJ 연결을 남기지 않는다. 신규 그룹의 판정을 기존 resource 판정으로 자동 채우지 않으며 legacyResource로 명시 연결된 경우에만 가져온다. 새 OBJ 선택에서는 owner 제어를 노출하지 않는다. legacyResource에 연결된 기존 OwnerInfo.confirmed가 true이고 identity가 있는 경우에만 OBJ 라벨 뒤에 graphAccountLabel로 계정 세션 이름을 붙인다. confidence나 decisionGrade만으로 확정 라벨을 붙이지 않는다. 라벨/ID 생성은 중앙화해 search와 graph가 서로 다른 객체 키를 만들지 않게 한다.

기존 `Normalizer`, `AuthorizationAnalyzer`, `AuthorizationMatrixAnalyzer`, `TrafficClassifier`, `FlowGraphBuilder`의 분석 키·판정 동작은 1단계에서 변경하지 않는다. 이 방식은 그래프 표현을 늘리는 작업이며 새 OBJ가 자동으로 인가 매트릭스의 대상으로 등록되는 작업은 아니다.

### 2단계: query

ObservedObjectProjection에 query 스키마 그룹과 조합별 OBJ를 추가한다. ParameterExtractor의 form 파싱/위치 타입은 재사용 후보이나 현재 요약만으로 민감 값 처리가 안전한 것은 아니므로 안전한 표시 요약을 적용한다. key 이름을 ID 패턴으로 먼저 거르지 않는다. page도 포함한다. source/identity는 objectKey에 넣지 않고 접근 Evidence에 넣는다. 동일 API 범위의 같은 조합은 여러 사용자 사이에서도 같은 OBJ로 연결할 수 있다.

표시 그룹이 여러 필드를 합치더라도 각 OBJ는 실제로 존재했던 입력 조합이다. 값 미리보기는 inspector의 비민감 필드에 한정한다. 중복 필드 순서와 null/빈 값/자료형의 차이를 보존한다. 같은 이름의 body 필드와 섞지 않는다.

### 3단계: request body

`ParameterExtractor`의 JSON/form/multipart/XML 파싱과 한도/진단을 활용하되 path 추출은 재사용하지 않는다. 해당 path()는 Normalizer 결과에서 ID 슬롯을 찾으므로 기존 문자열 ID 누락을 물려받는다. 현재 `Values.summary()`(ParameterExtractor.java:378)는 실제 scalar preview와 단순 digest를 생성한다. 신규 표시 모델을 연결하기 전에 민감 필드의 존재/형태만 반환하는 경로를 마련하고 스냅샷·저장·로그까지 유출 검증을 한다. 기존 분석용 summary를 광범위하게 바꾸기 전에 Surface 분석 회귀를 확인한다.

JSON 전체 구조의 관측 조합을 안전하게 정규화한다. schema 그룹은 서비스/메서드/API 범위/입력 위치/필드 구조로 나누며 키 순서만 다른 JSON은 같은 schema로 처리한다. 배열 순서와 string/integer/boolean/null은 구분한다. body가 크거나 원문이 보존되지 않았다면 metadata-only 후보 또는 처리 불가 진단을 제공한다. 원문이 없는데 완전한 동등 비교를 수행한 것처럼 표시하지 않는다.

### 4단계: response body

GET이라는 HTTP method와 경로 자원 후보/query/request body 부재를 기준으로 적용한다. POST라는 이름의 경로와 POST 메서드를 혼동하지 않는다. RequestRecord.responseBodyForAnalysis()로 현재 보존된 응답을 사용한다. JSON/XML 응답 전체를 단위로 하며 URL 객체가 이미 있으면 별도의 fallback response OBJ를 중복 생성하지 않는다. 응답 body의 동적 값 제거는 처음에는 하지 않는다. 배열 순서를 바꾸거나 자료형을 지워 동등성을 만들지 않는다. 공통 error/success 응답은 상태/역할이 구분되도록 처리한다.

## 그룹 로컬 표시 순번

OBJ 번호는 전역이 아니라 각 객체 그룹 안에서 1, 2, 3부터 시작한다. 다른 그룹도 OBJ 1부터 시작한다. 실제 ID가 5/6이어도 표시 번호는 OBJ 1/OBJ 2다. 내부 objectKey와 Evidence/operation 키는 기존 안정 식별자를 유지하며 로컬 순번으로 대체하지 않는다. 동일 그룹의 같은 객체가 재관측되면 기존 노드에 접근 관측을 누적한다. 필터/검색에서 일부 객체만 보여도 원 그룹에서 부여한 번호를 사용해 보이는 객체의 정체성을 유지한다. 기본 정렬은 최초 관측과 안정 키의 결정적 순서로 한다. 삭제·늦게 들어온 과거 관측 뒤 영구 번호 고정은 별도 요구가 없는 한 보장하지 않으며, 로컬 표시 번호를 위해 저장 schema를 변경하지 않는다.

## 최종 위험 판단

이 방향의 가장 큰 위험은 false positive 자체보다 (1) 새 OBJ와 기존 판정 대상의 의미 혼동, (2) 서로 다른 실제 요청을 묶은 API의 재전송 오선택, (3) 값 노출, (4) 관측 추가에 따른 key/selection 변경이다. 위 경계를 지키면 기존 분석 결과를 유지하면서 표시를 확장할 수 있다. 단, 신규 OBJ에 대응하는 기존 인가 판정이 없을 수 있으므로 API 판정과 표시 객체 관측 수를 UI에서 별도로 표시해야 한다. 수를 늘렸다는 이유만으로 커버리지가 개선됐다고 집계하지 않는다.

## 완료 기준

- crAPI 긴 문자열 ID 3개가 같은 API 범위의 관측 3개를 근거로 API 표시 하나/OBJ 1~3이 된다. 단일 숫자/긴 토큰의 path는 OBJ로 표시하지 않고 두 번째 실제 관측 뒤 표시한다.
- 다른 Source/사용자/runId가 없어도 등록되고 동일 객체의 반복 접근은 Evidence만 증가한다.
- 같은 트래픽의 기존 authorization cells/gaps/findings와 traffic disposition은 변경 전후 동일하다.
- path/query/body가 함께 있는 요청의 세 입력 위치를 모두 볼 수 있다.
- 검색 결과, 선택 inspector, 강조, 필터, 리스트 보기, 저장된 layout/reopen이 같은 내부 키를 사용한다.
- API 그룹에서 실행 액션이 원본 요청 선택을 요구하며 다른 ID의 요청으로 바뀌지 않는다.
- password 원문/preview/단순 값 해시가 신규 스냅샷/키/로그/프로젝트 파일에 추가되지 않는다.
- 대량 관측은 전수 쌍 비교를 하지 않고 파서 한도·노드 페이지 제한·증분 갱신으로 처리한다.
- 네 단계 각각 기능과 회귀 검증이 완료된 단독 커밋을 남긴다. 문서 분석 완료를 기능 완료로 간주하지 않는다.

## 최종 사용자 확정 사항 — 2026-10-08

이 절과 반영된 위 수정 사항이 이전 단일 관측 표시 제안을 대체한다.

1. OBJ는 객체 그룹 로컬에서 1부터 번호를 부여한다. 실제 ID/전역 번호를 표시 번호로 사용하지 않는다.
2. path는 같은 service+method+표시 API 범위의 URL 전체 또는 경로 패턴에서 실제 관측이 2회 이상인 경우에만 표시한다. 서로 다른 ID 값은 필수는 아니다. 동일 URL의 별도 요청 2회도 관측 수 조건에 포함한다. 동일 캡처를 snapshot 재생성/refresh/import 중복으로 두 번 센 것은 제외한다. ObservationCollapser의 동일 group.count를 멤버마다 더하지 않는다. 개별 관측의 보존 모델과 count를 확인해 한 번씩 집계한다.
3. 관측 수 조건과 객체 위치 추론은 별개다. `/posts/foo` 동일 요청 2회만으로 foo가 동작인지 객체인지 증명되지 않는다. 숫자/토큰 형식, 이미 알려진 패턴, 다른 값의 관측, 구조 연결 등으로 위치를 결정한다. 관측 개수가 많다는 이유만으로 모든 고정 경로를 ID로 바꾸지 않는다.
4. query와 요청 body에는 path의 2회 조건을 적용하지 않는다. field/구조가 있고 유효하게 파싱된 단일 조합도 OBJ 하나로 표현한다. 4단계의 입력 없는 GET 응답도 단일 JSON/XML 응답부터 표시하며 별도 count gate는 추가하지 않는다.
5. 확정 소유자만 `OBJ 1 - 계정 세션 이름`으로 표시한다. 연결 근거는 명시적 legacyResource→확정 OwnerInfo이며 새 소유자 추정은 하지 않는다. 미확정/충돌/단순 접근자는 OBJ 번호만 표시한다. 현재 SnapshotJsonWriter.owners는 confirmed이고 identity가 있는 항목만 전달하므로 그 계약을 유지하고 graphAccountLabel을 사용한다.
6. 판정매트릭스/Request Lab의 op/resource/Evidence와 실행 대상은 유지한다. 소유자 라벨로 인해 objectKey가 변경되면 안 된다. 새 객체 그룹의 API 액션은 실제 요청/Evidence를 선택한다.
7. 회귀 검증에는 기존 matrix 셀·정책·추천 결과 불변, Request Lab 선택/원문 요청/재전송 대상 불변, local OBJ 번호, confirmed 소유자 라벨, 단일 path 숨김→두 번째 관측 표시, 반복 동일 URL OBJ 하나, 서로 다른 Source 없이 같은 범위의 다른 ID OBJ 여러 개를 포함한다.
