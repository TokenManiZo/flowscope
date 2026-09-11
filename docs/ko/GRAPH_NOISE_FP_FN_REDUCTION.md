# FlowScope 그래프 노이즈·FP/FN 감소 기록 (PR#11 원본을 현행 구현 기준으로 이식, 2026-09-11)

> PR#11 `GRAPH_NOISE_FP_FN_REDUCTION.md`의 분석을 보존하면서 현행 React 계층 그래프(D-143 5c)와 판정 매트릭스 guard(D-144)에 맞게 고쳐 썼다.

## 1. 기존 그래프에서 발생할 수 있었던 노이즈

- 모든 Object와 API를 함께 만들 때 Object 수만큼 노드·edge crossing이 증가했다.
- 같은 Identity·API 관계가 Object와 Evidence 반복 수만큼 겹쳐 보일 수 있었다.
- HUMAN/SCANNER/LLM 평행선이 많은 전체 그래프에서는 source 차이보다 선 밀도가 먼저 보였다.
- path parameter literal이 canonical operation으로 안정화되지 않으면 같은 endpoint가 여러 API처럼 보일 수 있었다.
- 노드 라벨에 owner·source·판정·횟수를 모두 넣으면 핵심 path를 읽기 어려웠다.
- route candidate, validation, 미확정 owner가 observed exploration 관계처럼 보이면 분석 의미가 왜곡될 수 있었다.

## 2. 실제 적용한 노이즈 감소 방법

- Display edge aggregation: 같은 `(Identity, API, source)` 접근선을 한 줄로 표시한다(`×N`).
- Endpoint normalization 재사용: 기존 canonical operation을 그래프 API identity로 쓴다.
- Object lazy expansion: 선택 API의 Object만 Object View에서 만든다.
- API grouping: canonical path의 보수적 안정 segment로 Site 요약을 만든다.
- Duplicate node removal: stable node id로 같은 계층의 node를 한 번만 만든다.
- Label simplification: Site는 절대 수 요약, API View는 Identity/API 카드, Object 카드는 key와 확인 owner만 표시한다. 카드 전문은 툴팁으로 읽는다.
- Focused subgraph rendering: 현재 그룹 또는 API에 관련된 neighbor만 만든다.
- 18개 단위 확장과 Site로 collapse를 적용했다.

## 3. Raw Evidence 보존 방식

표시 집계는 React가 snapshot의 CoverageCell을 읽어 Cytoscape element를 만드는 순간에만 수행한다. 집계 edge는 underlying cell key 목록(`cellKeys`)·원본 셀·Evidence ID 합집합을 가진다. 선택 시 상세가 원 cell을 다시 열어 source별 verdict와 모든 Evidence ID를 조회한다. 저장소·Coverage·Finding·Snapshot은 바뀌지 않는다.

따라서 Evidence 10개는 UI에서 `HUMAN ×10` 한 선이 될 수 있지만 Evidence 10개와 stable id는 그대로 남는다. 선택이 여러 셀을 덮으면 상세는 "복수 셀"과 원본 셀 목록을 보여 주고 집계 판정을 만들지 않는다.

## 4. 오탐 발생 가능 원인

- path segment를 공격적으로 합치면 서로 다른 API가 같은 template/group처럼 보일 수 있다.
- 첫 접근자를 owner로 간주하면 타인 객체 접근을 정상/위반으로 잘못 분류할 수 있다.
- candidate를 observed로 세거나 validation을 exploration으로 세면 거짓 coverage가 생긴다.
- source를 합치면 HUMAN이 방문하지 않은 경로도 HUMAN 경로처럼 보일 수 있다.
- HTTP status나 과거 LLM 의견만으로 관계의 보안 의미를 확정할 수 있다.

## 5. 오탐 감소를 위해 실제 적용한 방법

- API node는 새 휴리스틱이 아니라 기존 canonical operation만 쓴다.
- API group은 표시용이며 Coverage/Finding 계산에 들어가지 않는다.
- owner는 서버 `owners`(확인된 소유자)만 표시하고 없으면 `UNKNOWN`/`미확정`으로 둔다.
- H/S/L edge를 합치지 않고 색·선형·문자로 각각 유지한다.
- candidate는 중립 점선 node, observed는 source edge가 있는 node로 분리한다. 후보는 현행 source·identity 필터를 따른다.
- `UNCROSSED` gap의 candidate 경로는 GAP 목록에서 focus할 때만 표시하고 Evidence·판정을 만들지 않는다.
- 판정 매트릭스(D-144)에서도 후보 승격은 정본 cell의 SUSPICIOUS/roleViolation만 따르고, 확정 소유자 객체의 타인 2xx라도 본문 오라클이 없으면 "수동 결과 검토"로 남긴다. 과거 LLM 검증 이력은 표시만 하고 E3·재현으로 올리지 않는다.

## 6. 미탐 발생 가능 원인

- 보수적 canonicalization이 literal numeric path를 template로 묶지 못하면 같은 API가 분리될 수 있다.
- 응답/요청에 충분한 resource Evidence가 없으면 Object가 API 뒤에 나타나지 않는다.
- `REVIEW`/`EXCLUDE` 또는 disabled source filter는 메인 그래프에서 실제 API를 숨길 수 있다.
- 첫 stable path segment 그룹은 도메인 의미가 복잡한 사이트에서 너무 넓거나 잘게 나뉠 수 있다.
- Object View에 들어가지 않으면 개별 Object는 의도적으로 보이지 않는다.

## 7. 미탐 감소를 위해 실제 적용한 방법

- 동일 canonical API 아래의 서로 다른 Object를 모두 독립 cell로 보존하고 선택 시 함께 보여 준다.
- 객체가 없는 API도 Identity→API로 남겨 Object Evidence 부족 때문에 API 자체가 사라지지 않게 했다.
- Site 그룹 카드에 현재 필터의 API·H/S/L·Gap·경로 후보 절대 수를 보여 조사할 그룹을 찾게 한다.
- Back·개요로 접기·GAP 후보 focus로 focused view에서 원 문맥으로 복귀할 수 있다.
- 집계 edge 상세에서 underlying Object cell을 다시 열 수 있어 접힌 관계가 감사 불가능해지지 않는다.
- 우선순위 Gap 그래프(`#parameter-map`)와 판정 매트릭스의 `교차 실행 공백`·`수동 테스트 추천`이 아직 시도하지 않은 조합을 별도로 드러낸다.

분석 엔진을 공격적으로 바꿔 recall을 높이는 시도는 그래프 범위에서 하지 않았다.

## 8. Candidate / Observed 분리 방식

Observed API/Object는 CoverageCell과 실제 Evidence에 근거한다. Route candidate는 `경로 후보 표시`를 켠 경우에만 별도 그룹/API 후보로 나타나며 중립색·점선 테두리를 쓴다. candidate에는 H/S/L 접근 edge, coverage, gap, verdict, finding을 만들지 않는다. candidate-only Object를 임의 생성하지 않는다.

## 9. Exploration / Validation 분리 방식

그래프 입력은 기존 discovery gate를 통과한 CoverageCell이다. HUMAN `VALIDATION` 결과(Request Lab 전송)는 Evidence·상세·판정 매트릭스 cell basis에는 남지만 Surface 사실·프로파일과 Site/그룹 통계를 늘리지 않는다(D-143 3단계).

## 10. Human / Scanner / LLM Source 분리 방식

`source`는 traffic generator이고 `orchestrator`와 독립이다. ZAP을 LLM이 시작해도 SCANNER edge다. 표시 집계 key에 source가 포함되므로 HUMAN·SCANNER·LLM은 서로 다른 edge다. source filter는 해당 source 전용 node와 Identity→API→Object 전체 경로를 다시 계산한다.

## 11. Endpoint/Object normalization 방식

Endpoint는 기존 단계형 canonical operation(`LITERAL/INFERRED/CORROBORATED`) 결과를 그대로 쓴다. `/orders/11`, `/orders/22`가 기존 근거로 `/orders/{id}`가 됐을 때만 같은 API node에 연결한다. Graph UI가 새 정규화로 강제 병합하지 않는다.

Object는 기존 resource key와 association Evidence를 쓴다. 같은 API 아래 `orders:11`, `orders:22`는 다른 node다. 객체 정보가 없으면 API에서 끝나며 dummy나 추정 Object를 만들지 않는다.

## 12. 아직 남아 있는 한계

- API 그룹은 첫 안정 path segment 기반이어서 business bounded context와 항상 일치하지 않는다.
- 현재 확장은 18개 단위 표시 pagination이며 semantic clustering이 아니다.
- snapshot을 필터 변경 때 다시 투영하므로 아주 큰 실제 dataset의 상호작용 지연은 미측정이다.
- 900px 이하 계층 목록은 Playwright parity(900/600px)로 drill·선택 상세까지 고정했지만 실제 Burp dataset 규모 검증은 남아 있다.
- 보수적 endpoint/object 추출 때문에 Evidence가 부족한 관계는 계속 unresolved일 수 있다.

## 13. 향후 개선 가능한 부분

- 실제 dataset에서 group별 element 수, render 시간, click-to-detail latency를 계측한다.
- 저장 의미를 바꾸지 않는 범위에서 OpenAPI tag나 검증된 route metadata를 표시 그룹 힌트로 검토한다.
- API가 18개를 크게 넘는 그룹에는 검색 seed와 위험/gap 가중 proximity 정렬을 검토한다.
- FP/FN 개선이 CoverageEngine 변경을 요구하면 공개 fixture와 blind benchmark를 먼저 만들고 별도 결정으로 수행한다.
