# FlowScope 초기 그래프 UX 조사 기록 — Swing/JGraphX

> **상태:** 아래 문서는 초기 Swing/JGraphX 조사 기록이며 현재 구현 계획이 아니다. 제품 UI 구현 선택은 D-048에 의해 번들 Cytoscape.js localhost Web 작업면으로 대체되었다. 계층 방향, source/verdict 채널 분리, focus+context, 필터, 단계적 펼치기 원칙만 계속 유효하다. 현재 화면별 근거와 발표 설명은 `ui-product-rationale.md`, 현재 백엔드 계약은 `architecture.md`를 따른다.

> **beta.42 주의:** 제품 기본 작업면은 그래프가 아니라 Endpoint·Parameter Surface Delta다. 이 문서의 그래프 원칙은 선택 API의 `인가 그래프` 상세층에만 적용한다(D-113·D-114).

> **beta.43 주의:** 기본 Surface에서는 인가용 rail을 숨기고 Surface·source 제어만 보여 준다. 내부 Resource는 삭제하지 않았으며 화면 용어만 `접근 대상 ID`로 바꿨다(D-115).

> OSS·정보시각화 문헌 5갈래 조사 종합. 우리 제약(단일 Java Burp 확장 + JGraphX)을 최우선 현실 기준으로.

## 0. 결론 한 줄
**당시 조사 결론은 계층+직각 레이아웃을 유지하고 필터·초점+문맥·접기로 클러터를 제어한다는 것이었다.** `render()` 전량 재생성 개선안은 폐기된 Swing/JGraphX 구현을 전제로 한 역사 기록이며 현재 Cytoscape.js 코드에 적용하지 않는다.

## 1. 레이아웃 — 현행 유지 (검증됨)
- **Sugiyama 계층(`mxHierarchicalLayout` WEST) + 직각 엣지 유지.** 신원→자원→엔드포인트는 자연스러운 3층 DAG라 force 레이아웃은 열 구조를 깨고 오히려 털뭉치화. IDA/Ghidra가 같은 선택.
- 경로 추적(path-following) 과제에선 **노드-링크가 매트릭스보다 우세**(Ghoniem/Fekete 2004) → "누가 어디를 쳤나"에 노드-링크+계층이 최적. (단 20노드 넘으면 인터랙션 없이는 무리라고 같은 논문이 경고 → 아래 §4·§5가 필수)
- 방향 좌→우 유지(IDA 관례 + 3열 은유).

## 2. 노드·엣지 부호화 — 채널 분리 원칙 (Munzner)
**한 시각 채널에 두 축을 겹치지 말 것.** 이게 핵심 규칙:
- **위치(최강 채널) = 구조축**: 열 = 타입(신원/자원/엔드포인트). 현행 유지.
- **형태 = 타입 보조**: hexagon=엔드포인트, rounded=신원, rect=자원. 현행 유지.
- **색 = verdict 전용**: suspicious=적색 테두리, deny=회색, allow=중립, undecided/untested=점선 테두리. (지금 모델에 verdict 없음 → L1에서 추가)
- **아이콘/배지 = 속성 오버레이**: suspicious=경고(!) 배지(`mxCellOverlay`), role 배지(자동추정 금지 D-018, 명시 role만).
- **크기 = degree**: 자주 접근된 자원·활발한 신원을 크게(Maltego ball-size).
- **엣지 = source 전용**(사람 실선/스캐너 파선/겹침). **verdict를 엣지 색에 절대 싣지 않음** — source와 충돌. 색약 대응 dash+굵기 이중화 유지.

→ 즉 **source는 엣지, verdict는 노드**. 이 직교가 3-way 비교와 취약 판정을 동시에 읽게 하는 열쇠.

## 3. 필수 인터랙션 (우선순위)
정적 그래프로는 실데이터를 못 버틴다(Heer/Shneiderman). 우선순위:
1. **필터 토글**(source/verdict/op 체크박스) — 셀 `setVisible`로 숨김. 클러터 방어의 본체.
2. **'suspicious만 보기'** 원클릭 + suspicious·갭 노드는 필터에도 항상 부각.
3. **노드 클릭 → 경로만 강조, 무관 노드 디밍**(삭제 아님) — BloodHound focus+context.
4. **미니맵**(`mxOutline`) 상시 — 대규모에서 길 잃음 방지(IDA/Ghidra).
5. **접이식 상세 패널**(우측) — 판정 근거·요청 이력. 그래프 본체엔 최소 정보만(Kiali/Voyager).
6. **op-prefix 그룹 접기/펼치기**(+/−).
7. **검색 → 이웃(1~2 hop)만 → 요구 시 확장**(van Ham/Perer DOI). 전체 오버뷰를 기본값으로 두지 않음.

## 4. 스케일 전략 (털뭉치 방지, 우선순위)
1. **JGraphX 네이티브 folding**(`groupCells`/`foldCells`) — 접으면 자식 숨고 그룹 밖 엣지가 부모로 자동 집계(promote). **최우선·저비용.**
2. **URL 경로 trie/radix 프리픽스 그룹핑**(`/api/orders/* (n)`) — 수백 op를 몇 그룹으로. Swagger tags·Kiali namespace와 동형.
3. **DOI 서브그래프** — 전체를 그리지 말고 검색 seed의 k-홉만 그림. suspicious/갭에 가중. 블랙박스라 전체 오버뷰가 무의미(D-002)한 것과 철학 일치.
4. **집계**(same-op 묶기 + 카운트 라벨), **top-N + '+N more'** 팬아웃 캡.
5. **시맨틱 줌**(줌 임계에서 자동 접기 + 소스별 요약 라벨), **차수1 리프 접기**.
6. **증분 레이아웃**(접기/확장 시 기존 위치 고정 → mental-map 보존). ※ JGraphX 기본은 전량 재배치 → 직접 구현 필요(열린 질문).

## 5. 시각화 기술 판정 — **JGraphX로 충분** (D-023 확정 재확인)
- 수십~수백 노드 + L0/L1 범위에선 JGraphX가 충분·최저마찰. 계층·직각·folding·미니맵·줌·채널 인코딩이 전부 내장이고 `registerSuiteTab`에 `mxGraphComponent` 그대로 얹힘.
- 임베디드 웹(cytoscape.js/JCEF)은 대규모 성능·부드러운 디밍에서 우위지만 **Chromium 네이티브(플랫폼별 수십~수백MB) 동봉**이라 배포 무게 급증 → 지금 규모엔 비용>이득.
- **단서:** DOI·증분·top-N·클릭 하이라이트는 내장이 아니라 **직접 구현**해야 함("JGraphX이되 커스텀 인터랙션 코드 필요"). JGraphX EOL(2020 archived) → vlsi 포크로 감수(결정로그 명시).
- **2단계 에스컬레이션(열린 질문):** L2에서 folding/필터로도 안 풀리는 수백~수천이 **실측**되면 재평가 — (a)순수 Java 유지: JUNGRAPHT-VISUALIZATION, (b)웹 필수: JCEF+cytoscape.js.

## 6. 당시 FlowGraphView에 제안한 변경 (현재 구현 계획 아님)
| # | 변경 | 왜 | effort |
|---|---|---|---|
| **1** | **`render()` 전량 재생성 → mxGraph/mxGraphComponent 필드 1회 생성·보존으로 리팩터** | 현행 `removeAll()+new`가 하이라이트·접기·필터·증분을 **전부 불가능하게 막는 구조적 병목.** 모든 후속의 전제 | medium |
| 2 | `mxOutline` 미니맵 우하단 추가 | 길 잃음 방지, 내장이라 몇 줄 | low |
| 3 | 노드 크기 = in/out degree | 허브 자원·활발한 신원 부각, 순수 데이터 로직 | low |
| 4 | 필터 툴바(source, 'suspicious만') → `setVisible` | 클러터 방어 본체 | medium |
| 5 | 노드 클릭 → 경로 강조 + 무관 디밍 | focus+context 판독 | medium |
| 6 | 우측 접이식 상세 패널(JSplitPane) | 판정 근거는 패널로, 본체는 최소 | medium |
| 7 | verdict를 모델에 실어 노드 색+배지 인코딩 | 당시 모델에 없던 취약축 시각 채널 제안 | high |
| 8 | op prefix trie 그룹핑 + folding | 최우선 스케일 무기 | high |
| 9 | 팬아웃 top-N + '+N more' | 신원별 자원 폭발 방지 | medium |

## 7. 핵심 레퍼런스
- **BloodHound CE — Search & Pathfinding** (focus+context 하이라이트/디밍, abuse 패널): https://bloodhound.specterops.io/analyze-data/explore/search
- **van Ham & Perer — Search, Show Context, Expand on Demand** (DOI 초점+문맥, 털뭉치 정면 해법, IEEE InfoVis 2009): https://aviz.fr/wiki/uploads/Teaching2014/SearchShowContext.pdf
- **Ghoniem/Fekete/Castagliola — Readability of Graphs (Node-Link vs Matrix)**: https://journals.sagepub.com/doi/10.1057/palgrave.ivs.9500092
- **mxGraph/JGraphX User Manual — Folding & Complexity**: https://jgraph.github.io/mxgraph/docs/manual.html
- **Kiali Topology/Graph** (집계 토글·Find/Hide·사이드패널): https://kiali.io/docs/features/topology/
- **Ghidra Function Graph — Navigation Overview**(미니맵+직각, 동일 Java/Swing 선례)
- **Montoya UserInterface**(registerSuiteTab에 mxGraphComponent): https://portswigger.github.io/burp-extensions-montoya-api/javadoc/burp/api/montoya/ui/UserInterface.html

---
*요약: 레이아웃은 맞다 → 인터랙션(필터·초점+문맥·접기)이 본체 → 그걸 얹으려면 render() 리팩터가 1순위. verdict 색·prefix folding은 L1/스케일 시점.*
