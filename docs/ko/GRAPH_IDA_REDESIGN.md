# FlowScope 그래프 IDA 계층 탐색 설계 (PR#11 원본 문서를 현행 React 구현 기준으로 이식, 2026-09-11)

> 이 문서는 PR#11 `GRAPH_IDA_REDESIGN.md`의 설계 근거를 보존하면서 현행 구현(`frontend/src/features/graph/graphHierarchy.ts`, D-143 5c, D-144)에 맞게 고쳐 쓴 것이다. 원본이 legacy `index.html`과 서버 `FlowGraphBuilder` 방향 변경으로 구현했던 부분은 우리 트리에서 React projection으로만 구현했고 서버 FlowGraph·legacy HTML은 바꾸지 않았다(제외 근거는 `product-development-plan.md` 제외·변경 목록).

## 1. 기존 구조와 문제

2026-09-11 이전 React 그래프는 한 canvas에 `IDENTITY / ENDPOINT / OBJECT` 3개 lane을 두고 필터 결과 전체를 `18개 / 전체`로 전환했다(D-142). 사이트의 모든 API·객체를 한 화면에 펼치면 Object 수에 비례해 노드·교차선이 늘고, 사용자는 지금 어느 API 영역을 보는지 잃기 쉬웠다. 객체가 없는 API는 Identity→API로만 끝나 별도 예외처럼 보였다.

## 2. 변경된 구조

D-145부터 이 계층은 `분석 → 점검 Gap 그래프 → 전체 관계 보기`에 있다. 같은 화면의 `점검 우선순위` 탭은 파라미터 Gap을 보여 주며, 두 탭은 같은 dataset과 Evidence를 사용한다.

관계 그래프의 읽는 순서는 실제 HTTP 의미 “주체가 API를 호출해 객체에 접근한다”를 따른다.

```text
LEFT                 CENTER                       RIGHT
USER A  ───────────▶ GET /api/orders/{id} ─────▶ orders:101
                                                       owner USER A
```

객체가 없는 `POST /logout` 같은 API는 API에서 자연스럽게 끝나며 dummy Object를 만들지 않는다. 서버 `FlowGraphBuilder`(legacy 화면용)는 그대로 두었고, React `projectHierarchy`가 서버 `cells`·`gaps`·`events`·`routeCandidates`에서 이 방향으로 투영한다.

## 3. IDA에서 참고한 개념

- Graph View: 현재 문맥의 관계를 방향성 있는 lane으로 읽는다.
- Proximity View: 선택한 그룹/API 주변의 관계만 만든다.
- Node Group: Site에서 canonical path 기반 API 묶음을 요약한다.
- Collapse / Expand: 개요 복귀와 18개 단위 추가 표시를 제공한다.
- Drill-down: Site → API Group → API → Object → Evidence 상세 순서로 이동한다.
- Focused Subgraph: API View는 선택 그룹, Object View는 선택 API의 관계만 렌더링한다.

IDA UI 자체나 미니맵은 복제하지 않았다. FlowScope의 3-way 비교, Cytoscape, 상세 패널에 맞는 progressive disclosure만 적용했다.

## 4. 실제 적용한 계층

### Site Overview

Target 노드와 API 그룹 카드만 표시한다. 그룹 카드에는 API 수와 H/S/L Evidence 수(event source 귀속, 없으면 관측 source당 1), Gap 수(충돌·일부 관측 셀 + 서버 `UNCROSSED` gap), 경로 후보 수를 절대 수로 표시한다. 블랙박스 전체 분모를 알 수 없으므로 퍼센트는 없다. Object 노드는 만들지 않는다.

### API View

선택 그룹의 Identity와 API만 표시한다. `(Identity, API, source)`별 접근선을 만들며 Object는 아직 만들지 않는다. API는 suspicious > 충돌 > 일부 관측 > Evidence 수 순으로 정렬해 18개부터 보여 주고 `API 18개 더 보기 (N개 남음)`으로 늘린다. Back은 그룹의 펼침 수를 유지한다.

### Object View

선택 API에 연결된 Identity→API→Object만 표시한다. 확인된 owner만 라벨에 쓰며 그렇지 않으면 `UNKNOWN`/`미확정`으로 둔다. Object는 18개부터 보여 주고 `Object 18개 더 보기`로 늘린다. GAP 목록에서 `UNCROSSED` 후보를 고르면 해당 API의 Object View로 이동해 중립 점선 candidate 경로(최대 40, focus 항목 우선)만 강조한다.

### Evidence 상세

기존 오른쪽 상세 패널(`GraphInspectorPanel`)을 재사용한다. 노드·edge 선택은 서버 셀의 canonical key(`graphCellKey`)·원본 셀·Evidence ID 합집합을 그대로 들고, 여러 셀이 겹치면 "복수 셀"과 원본 셀 목록·서버 Gap ID를 보여 주며 집계 판정을 만들지 않는다. Evidence 탭은 정확히 연결된 EventRecord의 `OperationDetail`과 Request Lab(D-140 `datasetRevision` key)로 이어진다.

## 5. API Group 생성 방식

`apiGroupDescriptor(service, path)`가 canonical operation의 path segment를 사용한다. 선행 `api`/`rest`와 `v1`, `v2.1` 같은 version segment는 뒤에 실제 segment가 남아 있을 때만 건너뛰고, 다음 첫 안정 segment를 그룹 key로 쓴다. `/api/orders/{id}`와 `/api/orders`는 `ORDERS APIs`, 비어 있거나 root인 경로는 `ROOT APIs`가 되며 service별로 분리한다.

그룹은 표시 projection일 뿐 저장 모델·CoverageCell·endpoint identity가 아니다. 서로 다른 canonical operation을 그룹 하나로 분석 병합하지 않는다.

## 6. 렌더링 방식

- `CytoscapeGraph`는 계층에 따라 2 lane(`TARGET / API GROUP`, `IDENTITY / API`) 또는 3 lane(`IDENTITY / API / OBJECT`)에 224×124 SVG 카드(`renderParameterNodeCardSvg`, D-098/D-099 카드 문법 재사용)를 배치한다. 그룹·API 카드 tap은 `onNavigate`, 나머지는 선택이다.
- 선택 신원·edge·focus 후보에 따라 관련 edge만 `focused=yes`로 강조하고 나머지는 흐리게 한다(`graphFocus`).
- 카드 전문은 pointer/키보드 툴팁으로 읽고 방향키·Enter·Escape로 탐색한다.
- 900px 이하와 `API 목록 보기`는 같은 projection을 키보드 목록(`ResponsiveGraphList`: 그룹/API 탐색 버튼, Identity focus, Source Evidence 경로)으로 낸다.
- 위치·viewport 저장은 노드 id 기준이며 저장 zoom은 0.4~2로 정규화한다.

## 7. Edge 처리

HUMAN은 파랑·실선·H, SCANNER는 빨강·파선·S, LLM은 밝은 점선·L이다. API View의 Identity→API와 Object View의 Identity→API/API→Object 모두 source별 별도 edge를 유지한다. 같은 Identity·API·source의 반복 관측은 한 표시 edge와 반복 수(`×N`)로 접지만 다른 source를 합치지 않는다. `×1`은 숨긴다.

경로 후보에는 source 접근 edge가 없고 중립색·점선 테두리를 쓴다. 후보는 현행 flat projection과 같은 source·identity 필터를 따른다. 응답→요청 data flow는 메인 접근 그래프와 섞지 않고 `흐름 순서`에 둔다.

## 8. Object 처리

Object는 Object View 진입 전에는 element로 만들지 않는다. 선택 API에 실제 CoverageCell로 연결된 resource만 만들고 객체 없는 API에는 dummy resource를 만들지 않는다. 같은 API template 아래 서로 다른 resource key는 각각 독립 Object다. owner는 서버 `owners`만 읽고 새 추론 판정을 추가하지 않는다.

## 9. Drill-down / Focus / Back / Breadcrumb

그룹 클릭은 `Site Overview → API View`, API 클릭은 `API View → Object View`로 이동한다. `Back`은 한 단계씩 복귀하고 `개요로 접기`는 즉시 Site로 돌아간다. 필터·snapshot 변화로 현재 단계가 사라지면 상위 단계로 되돌리고 선택을 비운다. 선택 API/Object는 상세 패널과 연결되고 상세를 닫으면 후보 focus로 복귀한다.

## 10. 성능

- Site와 API View에서 Object element를 0개로 유지한다.
- 현재 그룹/API 이외의 subgraph를 만들지 않는다.
- 노드는 stable id로 한 번만 만들고 edge는 `(Identity, API, source)`로 집계한다.
- API와 Object를 각각 18개부터 렌더링한다.
- 새 전역 O(N²) 탐색은 없고 현재 필터된 cell의 선형 순회와 작은 group map을 쓴다. 실제 대규모 Burp dataset의 element 수·interaction latency는 미측정이다.

## 11. 구현 파일

- `frontend/src/features/graph/graphHierarchy.ts`, `graphFocus.ts`, `relationshipNodeCard.ts`
- `frontend/src/features/graph/CytoscapeGraph.tsx`, `ResponsiveGraphList.tsx`, `GraphInspectorPanel.tsx`, `GraphPage.tsx`
- `frontend/src/features/graph/graphProjection.ts`(`graphCellKey`·`graphCellSelection`·`projectRouteCandidates`)
- `frontend/e2e/parity.spec.ts`(계층 drill·카드·lane 검사)
- 서버 `FlowGraphBuilder`·legacy `index.html`은 변경하지 않았다.

## 12. 기존 기능에 영향을 주지 않기 위해 취한 조치

Coverage·Gap·Finding·Snapshot·SessionBroker·Burp/ZAP/Explorer 로직은 변경하지 않았다. 시각적 API 그룹과 edge 집계는 React projection에만 존재하며 저장 모델·판정 key를 바꾸지 않는다. 다음 명제는 그대로 유효하다.

```text
Coverage Gap ≠ Vulnerability
HTTP 2xx ≠ IDOR confirmed
Candidate ≠ Observed
Past LLM verdict ≠ Final Finding
Visual aggregation ≠ Evidence deletion
Source ≠ Orchestrator
Validation ≠ Exploration
```
