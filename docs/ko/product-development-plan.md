# FlowScope 1.2.0-beta.47 제품 개발·검증 계획

> **읽는 법:** PR #11·#12의 관측·선언 공통 좌표, 파라미터 프로파일·Gap, 권한 대상 연결, 통합 Graph/Matrix 작업면과 Evidence 요청 비교는 D-143~146으로 구현됐다. 현재 작업은 이 기능들의 연결부 정확성·선택 수명·최종 저장 보완과 검증이다. 각 행의 예전 수치는 해당 단계의 이력이고 최신 검증은 `beta-validation.md`를 따른다. 실제 Burp·Windows 운영 결과는 자동·패키지 검증과 별도로 기록한다.

## 현재 우선순위 · PR #11·#12 이식 기능 대조표 (2026-09-11)

**D-152 완료:** beta.46의 terminal/cleanup 경합을 지연 응답 회귀로 재현하고 제품 상태 게시·활성 run·취소 lane 마감을 보정했다. beta.47 로컬 전체 Java 574(2 skip)·React 472·패키지 Playwright 15/15, 실물 ZAP 하네스 1/1과 PR #13 원격 CI/재현성을 통과해 main에 반영했다. 원 PR #11·#12는 이식·대체 근거와 함께 종료했고, 팀원 배포 파일은 beta.47로 분리한다. 실물 fixture 검증과 실제 Burp/Windows/외부 대상 미실측은 계속 구분한다.

**D-151 완료 이력:** D-150의 일시 snapshot 실패 수명을 판정·파라미터·기존 권한 매트릭스, 점검 Gap, 시나리오, 흐름 상세까지 통일했다. 선택·검토 메모·Request Lab 초안을 보존하고 새 동작만 잠그며, 실패 전에 시작한 전송은 같은 dataset·Evidence 결과를 기다린다. PR #11 persistence 9건은 현행 대체 회귀와 폐기된 record-level/generation 계약을 사례별로 기록했다. 당시 검증 수치는 `beta-validation.md` D-151에 보존한다.

**D-150 완료 상태:** PR #11 재대조에서 누락된 operation별 마스킹 Evidence/retention 페이지, 일시 snapshot 실패 중 Request Lab 초안 보존, source NUL·Masking/model/10,000-input/lifecycle/FatJar 회귀를 보완했다. Java 570(2 skip)·React 468·typecheck·Playwright 15/15가 통과했다. attached parameter 제2정본은 D-143 Surface Fact 대체를 유지하고 D-146/D-147 의미 변경도 유지한다.

**D-149 완료 상태:** 종료 뒤 Request Lab·Explorer Evidence 삽입 차단, 서비스 불일치 계정 경고, 현재 SampleProject와 화면 간 snapshot fixture 전체 일치, Surface enum 직렬화 순서 고정을 구현했다. JDK 21 전체 Java 554(2 skip)·React 468·typecheck와 패키지 Playwright 15/15(`--retries=0`)가 통과했다. 실제 Burp·Windows·native Linux는 이번 변경 기준 미실행이다.

**D-148 최종 상태:** 공통 editor의 dataset 경계와 Evidence/Surface/관계 그래프의 조회 실패 동선을 보정해 전체 Java 550(2 skip)·React 467·패키지 Playwright 15/15를 통과했다. 배포 안내의 native Linux bridge 조건도 정정했다. 실제 Burp gate는 GUI timeout 및 확장 없는 기준선의 vendor 내부 오류로 차단됐으며, 미실행을 완료로 바꾸지 않는다. 이번 PR 흡수 범위에서 확인된 코드 결함은 회귀로 수정했고, 호스트 오류는 beta-validation D-148에 증거를 남겼다.

**2026-09-12 최종 연결부 검증(D-147):** 요청 비교의 불완전/UNKNOWN 처리·공개 위치, Matrix 선택/검토 수명, 종료 직전 Evidence 보존·sample 실패 전파를 수정했다. Java 550 tests(2 opt-in skip, 실패·오류 0), React 461 tests·typecheck, packaged Playwright 15/15(`--retries=0`)가 통과했다. 아래 단계별 수치는 각 단계의 이전 결과이며 해당 단계의 완료 근거는 `beta-validation.md` D-147이다.

목적: 진단자가 실제 Evidence와 함께 (1) 어떤 API·입력을 HUMAN·ZAP·LLM이 각각 관측했는가, (2) 같은 비교 조건에서 어느 source·계정의 관측이 부족한가, (3) 다음에 확인할 API·파라미터와 추천 근거, (4) 정책·응답·소유자 근거의 확보 정도, (5) 해당 요청·응답 확인과 기존 Request Lab 연결을 확인하게 한다. 전체 사이트를 다 안다고 주장하거나 미관측을 취약점으로 확정하지 않으며, 실행 실패·분석 실패·미실행을 "탐색했지만 발견하지 못함"과 구분한다.

통합 원칙: `SurfaceAnalysis`가 endpoint·parameter 공개 Fact의 정본, `AuthorizationAnalysis`가 인가 판정의 정본이다. PR 분석 코드는 재사용하되 같은 사실·판정을 이중 계산하지 않는다(D-050). 읽기 BOLA 후보는 owner와 2xx만으로 만들지 않고 현재 엔진이 요구하는 본문 근거가 필요하다(D-004). machine key(canonicalPath)와 표시 라벨(fieldPath/displayName)을 분리하고 모든 항목에 provenance를 둔다. 제거한 MCP·Judge·옛 실행기는 복구하지 않고, 현재 React·서버 API에 연결하며 레거시 HTML 전체를 교체하지 않는다.

진행 단계(완료 보고와 번호를 일치시킨다): **1** 현재 네 결함 수정 → **2** 선언 지원의 남은 공백 정리·이식 → **3** 파라미터 프로파일과 관측 차이 분석 → **4** 권한 대상 연결 → **5** 우선순위 큐·파라미터 그래프·Diff(5a 화면·5b Diff·5c 계층 그래프·5d snapshot 계약) → **6** PR #12 근거별 매트릭스 → **7** 화면 간 선택·Evidence·저장/재열기 통합 검증. **2026-09-11 기준 1~7단계의 자동 회귀·패키지 Standalone(Chromium 실측·Playwright)을 완료했고, 2026-09-12 D-146에서 서비스 경계·중첩 PATH·동시출현 관계 과대 표시를 후속 보정했다. 실제 Burp·Windows·ZAP 복수 계정 운영 gate는 남아 있다(최종 인계는 `HANDOFF.md` 1-1).**

상태 값: 미착수 / 구현 중 / 자동 검증 완료 / 실제 UI·운영 검증 완료.

| PR 기능 | 원본 코드 | 현재 코드 | 상태 | 검증 근거 | 남은 일 |
|---|---|---|---|---|---|
| #11 파라미터 관측 추출(PATH/QUERY/FORM/JSON/GraphQL/Multipart/XML, bounded parser, 진단) | `core/parameter/ParameterExtractor`·`PathSlotCanonicalizer`·`ParameterKey/Observation/Extraction/Diagnostic` | `core/parameter/*`(이식) + `SurfaceAnalyzer` 관측 배선(D-143) | 자동 검증 완료 | `ParameterExtractorTest` 41, `SurfaceAnalyzerTest`, `mvn clean verify` 470 tests | 실제 Burp 실행 미검증 |
| #11 공통 좌표(ParameterKey 5좌표, PATH 구조 정체성 D-097) | `ParameterKey`, D-097(`/id`·`/segments/N`) | `ParameterCoordinates`(D-143: 단일 슬롯도 `/segments/N`, 배열 `*`, literal `*`=`~2`), `pathSlotPosition` 위치 검사 | 자동 검증 완료 | 1단계 결함1 회귀(`/segments/0` 거부·legacy 동일 결과) | D-097 표기와의 차이는 결정 기록(아래 변경 목록) |
| #11 실제 타입·값 요약(ValueType, digest, byteLength, 64자 masked preview) | `ParameterObservation.ValueSummary` | 실제 타입 복원 + 별도 `Format` 신호; distinct는 타입 포함 키; preview는 snapshot 비노출(코덱스 지시) | 자동 검증 완료 | 1단계 결함2 회귀(`"1"`/`1` STRING·INTEGER, distinct 2) | masked preview 표시 복원 여부는 결정 대기 |
| #11 요청 단위 contextSignature | `ParameterExtractor.result()` | `SurfaceAnalysis.ParameterObservation.contextSignature` + `profile.contextPresence` 키·조건 조합 Gap 입력 | 자동 검증 완료 | 후속 수정 회귀, 3단계 `SurfaceParameterProfileTest`(명시 null/부재·조건 조합) | — |
| #11/#12 공통 Surface 입력 필드 표시(machine key와 표시 라벨 분리, 리터럴/중첩 구분, 미확정 유지) | `SurfacePage`(현행 React) | `SurfacePage.tsx`: key=`location:[?]canonicalPath`, canonical 보조 줄, source 필터 시 `UNRESOLVED_COORDINATE` 유지 | 실제 UI·운영 검증 완료(UI: 패키지 Chromium / Burp 미실행) | `SurfacePage.test.tsx` 4/4; standalone 17777에서 PATCH `/api/orders/{id}` 상세의 `/segments/2`·`/status` 표시, 콘솔 오류 0 | 미확정 라벨 실측은 해당 샘플 데이터 없음(unit test) |
| #11 OpenAPI 정의(local `$ref`, oneOf/anyOf·enum 인덱스 조건, `CONDITIONAL`, declaredType/Shape, servers 확장 상한, form/swagger body, binary 제외, path 타입) | `OpenApiParameterDefinitionAdapter` | `SurfaceAnalyzer.collectOpenApiParameters/declareOpenApiParameters/declareSchema/declaredType`(operation override, union `CONDITIONAL`+`oneOf[i];`, `enum[i];`, type/format, binary·file 제외, 외부·순환 ref 거부, path slot 타입), `OpenApiRouteDiscoveryAdapter`(servers 확장 8,192자 상한) | 자동 검증 완료 | 2단계 회귀 6건(`SurfaceAnalyzerTest`), `mvn clean verify` 476 tests | scalar 배열 원소·중간 객체 노드는 PR과 달리 선언하지 않음(제외 목록) |
| #11 JS 정의(작은 literal grammar, AST 구조 보존, `__proto__`·computed/spread 거부, 리터럴 타입) | `JavascriptParameterDefinitionAdapter` | `JavascriptCallSiteAnalyzer`(`Segment`, `LiteralKind`, `__proto__`·constructor/prototype 컨테이너·spread 객체 제외) + `declareJavascript`(method 미해석 skip, declaredType/Shape, INFERRED) | 자동 검증 완료 | 2단계 JS 회귀, `JavascriptCallSiteAnalyzerTest` | PR 텍스트 스캐너의 1,024자 call window는 AST 상한으로 대체(제외 목록) |
| #11 정의 join 규칙(기존 candidate의 동일 문서 Evidence·provenance만, 상한 32, 민감 이름 제외, INFERRED) | `ParameterDefinitionExtractor.Sink.joined/add` | `RouteCandidateExtractor` provenance + `declare*`; `MutableEndpoint.parameter`(민감 이름 제외), 파라미터당 선언 32 상한 + `DECLARATION_LIMIT` 진단 | 자동 검증 완료 | 2단계 회귀(민감 이름·32 상한), `mvn clean verify` 476 | — |
| #11 Confidence(OBSERVED/CORROBORATED/INFERRED/UNKNOWN) | `ParameterObservation.Confidence`, `ParameterDefinition.confidence` | `SurfaceAnalysis.Confidence`: 관측 OBSERVED(엔진 전달), 선언 INFERRED, link OBSERVED/CORROBORATED/INFERRED/UNKNOWN | 자동 검증 완료 | 2단계 회귀(선언 INFERRED), 4단계 `SurfaceAuthorizationLinkTest`(link 4단계 confidence) | — |
| #11 ParameterProfile(source/identity/role/run/phase 카운트, contextPresence·`ABSENT_OBSERVED_CONTEXT`, typeConflict, distinct) | `ParameterProfile`, `ParameterProfiler.profile()` | `SurfaceAnalysis.ParameterProfile`(`ParameterFact.profile`), `SurfaceAnalyzer.profile()`: discovery 행(coverage·VALIDATION/COACH_PROBE 제외) 위에서 카운트·presence·구조/타입 충돌·부재·contextPresence(64)·identity/run 64 상한 진단 | 자동 검증 완료 | `SurfaceParameterProfileTest` 17건(PR `ParameterProfilerTest` 동작 이식: 축 카운트·명시 null/부재·타입 충돌·상한·불변성·Pipeline 경로 직렬화) | 화면 소비는 5단계; 실제 Burp 실행 미검증 |
| #11 discovery Gap 5종 + priority reasons + retention gate + coverage-only 분모 + Evidence ID 충돌 제외 | `ParameterProfiler.gaps()` | `SurfaceAnalysis.ParameterGap`(최상위 `parameterGaps`, `PRIORITY_ORDER`), `SurfaceAnalyzer.gaps/typeVariantGaps/conditionGaps/gap()`: 요청 행(`Row`, complete=추출 진단 없음+payload FULL), `REQUEST_PAYLOAD_NOT_RETAINED`·`CONFLICTING_EVIDENCE` 진단, 미확정 좌표 제외 | 자동 검증 완료 | 같은 테스트(누락 축 증인·optional/미요청 route·타입 변형·enum·wire/format 비교 제외·조건 조합 2근거·retention gate·불완전 긍정·순서 무관·반복 provenance·충돌 제외·미확정 제외), `mvn clean verify` | 5단계 UI, 4단계 `AUTH_VARIANT_UNTESTED` |
| #11 AuthorizationTargetLink(exact scalar OBSERVED / 독립 2 witness CORROBORATED / 단일 동시출현 INFERRED) | `ParameterAuthorizationAnalyzer.relation/exact/corroborated` | `SurfaceAnalysis.AuthorizationTargetLink`(`ParameterFact.authorizationTargets`), `SurfaceAuthorizationLinker.relation/exact/corroborated`: 중첩 PATH는 슬롯별 resource chain prefix에 연결하고, 그 외는 정본 field→resource 규칙의 스칼라 projection을 재생한다(QUERY_ID / 의미 필드 corroboration). 공개된 완전 증인 2건 안에서만 CORROBORATED하며 이는 확정 인가 경계가 아닌 사람 검토 근거다(D-146). | 자동 검증 완료 | `SurfaceAuthorizationLinkTest` 23건(PR 이식 + 중첩 부모/자식·동일 ID·동시출현 경계 회귀), `mvn clean verify` | 5단계 화면; 실제 Burp 미검증 |
| #11 ParameterValidationCell(SELF/OTHER_OWNER/ANONYMOUS/OTHER_ROLE × source, actual vs basis Evidence) + AUTH_VARIANT_UNTESTED | `ParameterAuthorizationAnalyzer.enrich` | `SurfaceAnalysis.ParameterValidationCell`(최상위 `validationCells`)·`SubjectClass`, `SurfaceAuthorizationLinker.link/decision/matches/gap`: 확인된 소유자·역할 분모로 applicable 결정, 응답 근거로 DENY/UNDECIDED만 직접, 성공 응답은 Evidence에 결박된 정본 Decision만 재사용(source별 입력이 다르면 미결박), VALIDATION 행은 cell·link에만 연결, `pg:auth:` gap은 완전한 operation에서만 | 자동 검증 완료 | 같은 테스트(정본 재사용·SELF ALLOW 금지·metadata/모호 응답·VALIDATION 연결·부분집합 미차용·객체 노출 미차용·미검증 gap·우선순위·충돌 제외·cell 불변식·Pipeline 직렬화) | 5단계 화면, 6단계 매트릭스에서 셀 재사용 |
| #11 Pipeline attach·record 영속·snapshot 캐시(generation·fingerprint)·additive 5배열·bounded preview | `Pipeline`·`RequestRecord`·`ProjectStore`·`SnapshotJsonWriter` | snapshot `surface`(valueToTree) 하나만; 영속 없이 projection 재계산(제2정본 없음). `SnapshotJsonWriter.surface()` 현재 게시본 단일 캐시(revision·Result·route 목록 동일성, 동기화, `surfaceBuildCount()` seam). 선언 32 상한 preview는 Evidence ID 순 안정 선택, `DEFINED_NOT_OBSERVED` gap은 전체 선언 증인 수 보존 | 자동 검증 완료 | `web/SnapshotSurfaceContractTest` 9건(PR Contract 9·Cache 7 중 적용 항목: 빈 snapshot 가산 배열, 모델 dedupe·count·32 preview·불변, UNTESTED basis/실제 분리·40건 preview·순서 무관, 선언 전용 입력·route 후보·전체 count·안정 preview·순서 무관, 실제 ALLOW 40 vs VALIDATION 전용 UNDECIDED 1, 민감 생략 진단 2·비밀 비노출, 단일 캐시 build count, 동시 poll 1회·동일 바이트, 같은 게시본 원문 변경 무영향·새 revision 재계산) | 미이식: attached generation·record fingerprint·bounded node seam·legacy UNKNOWN shape(설계상 해당 없음, D-143 5d) |
| #11 우선순위 큐·파라미터 Gap 그래프(4-lane 카드)·커버리지 매트릭스·Gap 인스펙터·Focused workspace | `frontend/src/features/parameter-map/*`(20파일), `e2e/parameter-map.spec.ts` | `frontend/src/features/parameter-map/*`: `parameterProjection`(snapshot.surface 위 machine key `parameterMapKey`, 큐 정렬=서버 REASON_ORDER, 40개 경로+선택 off-page, 20개 증인 preview, 미확정 좌표 제외, cell id 파생), `parameterLanes`·`parameterNodeCard`(SVG 카드, 표시 라벨=fieldPath·리소스 service 접두 제거), `ParameterGapGraph`(Cytoscape 4-lane, 목록 fallback, 키보드 경로 선택), `ParameterPriorityQueue`, `ParameterFilterBar`, `ParameterCoverageMatrix`, `ParameterGapInspector`(핵심 근거·Evidence·정의 근거 탭, 프로파일 요약, EvidenceSheet·RequestLabDialog 연결), `FocusedGraphWorkspace`+CSS, `#graph`의 점검 우선순위 탭(D-145, 옛 `#parameter-map`은 호환 이동) | 실제 UI·운영 검증 완료(UI: 패키지 Chromium / Burp 미실행) | vitest `parameterProjection.test.ts` 13·`ParameterMapPage.test.tsx` 17(RED→GREEN), frontend 298 tests, `mvn clean verify` 514 tests; standalone(17777) 1024/1600px에서 큐 23건·경로 카드·선택 상세 sheet/pane·검증표 4좌표·Evidence 상세·Request Lab 초안·확대/목록 전환, 콘솔 JS 오류 0 | 5c 관계 그래프 계층, 5d snapshot 캐시·계약 테스트는 별도 행 |
| #11 Request Diff(구조화 요청 비교: presence/shape/type/occurrence/value/retention 변경, 미완전 문맥 UNKNOWN, 중복·충돌 키 결정적 처리) | `requestDiff.ts`, `ParameterRequestDiff`, `parameterEvidence.ts`(evidence API의 per-record observations·digest) | D-145: Gap 비교를 열 때 `/api/evidence`가 같은 `ParameterExtractor`로 record별 안전 metadata를 재계산한다. 민감 경로·값과 preview를 제외하고 좌표·shape/type·length·비민감 digest를 반환하며 프런트는 HTTP 전문을 cache 전 제거한다. `ParameterRequestDiff`는 linked Evidence를 20건씩 선택해 값 변경을 digest로만 표시한다. | 자동·패키지 UI 검증 완료 | `FlowScopeWebServerTest`, `parameterEvidence`·`requestDiff`·`ParameterRequestDiff`·`ParameterGapInspector` tests, Playwright 14/14 | occurrenceCount는 엔진에 독립 필드가 없어 UNKNOWN; 실제 Burp 대규모 비용 미측정 |
| #11 전체 관계 그래프 계층·카드(Identity→API→Object, IDA 4레벨, `graphHierarchy/graphFocus/relationshipNodeCard/RelationshipGraphView`, `FlowGraphBuilder` 방향) | `frontend/src/features/graph/*`, `core/graph/*`, legacy `index.html` | `frontend/src/features/graph/*`: `graphHierarchy`(Site→API 그룹→API→Object, `apiGroupDescriptor`, 18개 + `18개 더 보기 (N개 남음)`, 우선순위 정렬, canonical cell key·Evidence ID 보존, UNCROSSED 중립 후보 경로 40개, 보조 흐름), `graphFocus`(선택 신원/edge/후보 focus), `relationshipNodeCard`(TARGET/API GROUP/IDENTITY/method/RESOURCE/SUPPORT SVG 카드), `CytoscapeGraph`(카드 이미지·2/3 lane·onNavigate·툴팁·키보드), `ResponsiveGraphList`(그룹/API 탐색·Identity focus·Source Evidence 경로), `GraphInspectorPanel`(복수 셀·Gap ID·사유), `GraphPage`(계층 nav·GAP 후보 focus·선택 재조정·저장 zoom 정규화). D-145에서 `GraphPage` 두 탭과 `RelationshipGraphView`를 흡수했다. 서버 `FlowGraphBuilder` 방향 변경·legacy HTML 그래프 교체는 미이식(legacy 전용, 교체 금지) | 실제 UI·운영 검증 완료(UI: 패키지 Chromium 실측 + Playwright / Burp 미실행) | vitest `graphHierarchy.test.ts` 22·`relationshipNodeCard.test.ts` 4·`CytoscapeGraph/ResponsiveGraphList/GraphInspectorPanel/GraphPage(.lifecycle)` PR 테스트 이식(RED→GREEN), `e2e/parity.spec.ts` 계층 drill·카드·lane; standalone(17777) 실측 | 평면 전체 보기 미병존(기각 기록) |
| #11 좁은 화면 탐색·선택(계층 목록 동등성, WorkspaceNavigation) | `ParameterMapPage`, `WorkspaceNavigation` | D-145: `FocusedGraphWorkspace`의 900/1440px Sheet·목록 경로를 유지하고, 전역 route는 `분석 / 점검 / 기록` 상단 그룹 메뉴로 통합한다. icon rail을 제거하고 `#parameter-map`은 `#graph` bookmark 호환으로 남긴다. | 자동·패키지 UI 검증 완료 | WorkspaceNavigation/AppShell/ReferenceShell tests, Playwright 14/14(600/900/desktop) | 실제 Burp WebView 미실측 |
| #11 Evidence 상세·operation retention·Request Lab 연결 | `EvidencePage`, `ParameterGapInspector`, `evidenceContext` | `EvidencePage`: 선택 operation의 `/api/evidence` 200건 페이지(마스킹 request/response·payload retention, datasetRevision cache key). `ParameterGapInspector`: exact operation/method EventRecord→`EvidenceSheet`→대표 Evidence `RequestLabDialog`. background snapshot 실패는 같은 dataset 초안을 보존하고 전송만 잠금(D-150) | 자동·패키지 UI 검증 완료(Burp 미실행) | EvidencePage/SnapshotFailureLifecycle tests, Playwright sample operation retention | 실제 Burp 장애·대규모 페이지 성능 |
| #11 설계 문서(GRAPH_IDA_REDESIGN, GRAPH_NOISE_FP_FN_REDUCTION, specs 4, D-093~099) | `docs/` | `docs/ko/GRAPH_IDA_REDESIGN.md`·`GRAPH_NOISE_FP_FN_REDUCTION.md`(현행 React 계층·D-144 guard 기준으로 고쳐 씀), `graph-ux.md` 서문, `decisions.md` 부록(PR D-093~D-099 ↔ D-143/D-144 대응표). PR `docs/ko/plans`·`specification/*-design.md` 4건(react-shadcn-test1-ui, focused-graph-workspace, parameter-priority-map, relationship-graph-card-restyle)은 PR 작업 계획서라 이식하지 않고 대응표·개발 기록으로 갈음 | 문서 이식 완료 | `documentation-status.md` 등록 | — |
| #12 AuthorizationMatrix 모델(정책 P·Evidence E·소유자 O 근거 Confidence, Expected/Actual/Status, Gate, Oracle, Legend) | `core/AuthorizationMatrix` | `core/AuthorizationMatrix`(PR record 그대로: Summary·Identity·Confidence·Expected/Actual/Status 17종·GateState·Gate·OracleType·Oracle·TestRecommendation·FunctionCell·ObjectCell·EvidenceRow·LegendItem) | 자동 검증 완료 | `AuthorizationMatrixAnalyzerTest` 10건 | E3·`*_REPRODUCED`는 enum만 유지(자동 부여 없음, D-144) |
| #12 AuthorizationMatrixAnalyzer(FunctionCell/ObjectCell, BFLA/BOLA 수동 검토 추천, validationByCell, review 기록) | `core/AuthorizationMatrixAnalyzer` | `core/AuthorizationMatrixAnalyzer`: PR 구조(identities·function/object cell·추천·게이트·오라클·요약·범례·review) 유지 + guard — 객체 후보는 정본 SUSPICIOUS만, 본문 미확인 성공은 `BOLA_IDOR_REVIEW_REQUIRED`; 기능 후보는 정본 `roleViolation`만(BOLA 의심 비누설); `Actual`은 정본과 같은 `ResponseEvidence`; 과거 검증은 정확 cell 이력 표시만(E3·재현 승격 없음, prefix fallback 제거); identity×operation/resource는 설정 또는 실제 관측 서비스 안에서만 조합(D-146), 서비스 불일치 등록 계정은 별도 설정 경고(D-149) | 자동·패키지 UI 검증 완료(Burp 미실행) | `AuthorizationMatrixAnalyzerTest` 14건(PR 이식 + guard + 서비스 경계·경고), React matrix 회귀, 전체 verify·Playwright | D-144·D-146·D-149 |
| #12 snapshot `authorizationMatrix`·`inputCoverage` 배선 | `SnapshotJsonWriter` diff | `SnapshotJsonWriter`: `authorizationMatrix`(cells 뒤, validations는 이력 표시용). `inputCoverage`·`events[].inputs` 미이식(`snapshot.surface` 파라미터 프로파일이 대체) | 자동 검증 완료 | `FlowScopeWebServerTest`(snapshot에 summary·functions·objects) | — |
| #12 매트릭스 UI + 관계 그래프 카드(legacy index.html) | `src/main/resources/web/index.html` | React `MatrixPage` 세 탭(D-145): 판정 매트릭스 기본 / 파라미터 커버리지 / 기존 권한 매트릭스. P/E/O·추천·게이트·오라클·Evidence·사람 검토와 `surface.validationCells` 입력 좌표를 같은 route에서 보되 서버 정본은 합치지 않는다. legacy HTML 미교체; 관계 그래프 카드는 `#graph` 전체 관계 보기 탭에 유지. | 자동·패키지 UI 검증 완료 | `JudgmentMatrixView`·`ParameterCoverageMatrix`·`MatrixPage` tests, Playwright 14/14 | 실제 Burp 미실행 |
| #11·#12 7단계 통합 검증(화면 간 선택·Evidence, JSON+SQLite 저장·재열기, 좁은 viewport) | PR `e2e/parameter-map.spec.ts`, PR 캐시·계약 테스트 | `PortedFeaturesReopenTest`(샘플+매트릭스 검토 CONFIRMED/DISMISSED → JSON·SQLite 재열기 → Evidence ID 순서·surface 6배열·cells·gaps·authorizationMatrix JSON 동일), `crossScreenSelection.test.ts`(현재 21-record `SampleProject`의 전체 snapshot fixture로 큐 Gap→검증 cell→정본 cell, Object View·판정 매트릭스·기존 매트릭스 동일 Evidence, 경로 후보 중립), `SampleProjectTest`가 현재 route 후보 포함 서버 snapshot과 fixture의 전체 일치를 강제, Playwright parity(우선순위 Gap 그래프 1920/1280/600, 판정 매트릭스 900/600) | 자동·패키지 UI 검증 완료(Burp 미실행) | 이 행의 테스트·`beta-validation.md` D-149 gate | 실제 Burp 재열기·Windows·ZAP 복수 계정은 운영 gate |
| #12 정확한 셀의 Evidence와 사람 검토 기록 | analyzer `reviewStatus/reviewNote/reviewEvidence` | `/api/review`가 finding 또는 매트릭스 cell id를 받고 Evidence는 서버가 정한 대상+기준 목록만 결박(`evidenceForReview`), 기존 `ReviewDecision` 저장·재열기·`appliesTo` 유지; React 상세의 사람 최종 판정 폼이 `useReviewMutation`으로 저장 | 자동 검증 완료 | `FlowScopeWebServerTest`(cell 검토 왕복·미존재 id 400), `JudgmentMatrixView` 저장/기각, `ProjectStoreTest`(기존) | 7단계 재열기 통합 검증에서 검토 보존 확인 |

**제외·변경 목록(근거)** — 합의 없이 조용히 제외한 기능은 없다.

- 단일 PATH 슬롯 `/id` 축약(D-097) → 항상 `/segments/N`(D-143): 다중 슬롯과 일관성·구조 정보 보존. 우리 트리에 PR 키가 없어 호환 비용은 없다.
- 배열 원소 `/[]`(PR 표기) → `*` + literal `*`=`~2`(D-143): `[]` 리터럴 키와의 충돌 제거. PR 문서·프런트의 `[]` 표기는 이식 시 치환.
- record-level `parameterObservations` 영속(PR) → Evidence에서 projection 재계산: D-113/D-139 "제2정본 없음" 유지. snapshot 캐시는 5단계에서 이식.
- 64자 masked preview snapshot 노출(PR 정책) → 비노출(코덱스 지시): PR의 "관측값 요약" 표시가 필요하면 재검토(결정 대기).
- PR OpenAPI/JS walk는 scalar 배열 원소(`/tags/[]`)와 중간 객체 노드도 정의로 냈다 → 우리는 held-out 진실과 기존 필드 관례(배열 필드·객체 원소 필드만)를 유지한다. 관측 쪽은 엔진이 원소를 관측하므로 그 원소 좌표는 OBSERVED_NOT_DECLARED로 남을 수 있다.
- PR JS 텍스트 스캐너의 1,024자 call window(오버사이즈 call 거부) → AST 분석기의 node·parameter 상한으로 대체(문자 수 상한 미이식).
- OpenAPI `required` 미표기 → PR 의미대로 OPTIONAL(이전 UNKNOWN). multipart/form의 binary·file 필드는 선언하지 않는다(이전 테스트의 `blob` REQUIRED 단언은 엔진이 파일 파트를 관측하지 않아 영구 거짓 gap이 되던 결함이라 정정).
- `inputCoverage`(#12) → 삭제된 `RequestInputExtractor` 의존이라 파라미터 프로파일로 대체.
- PR `ParameterProfile`은 별도 배열(`parameterProfiles`)이었고 `evidenceIds`를 32개로 잘랐다 → 우리는 `ParameterFact.profile`로 병합(Fact 정본 하나)하고 Fact의 `observationEvidenceIds`·`observations`는 기존대로 전량 유지한다(`PROFILE_EVIDENCE_LIMIT` 미이식, `PROFILE_DEFINITION_LIMIT`은 기존 `DECLARATION_LIMIT`과 중복이라 미이식). 관측 사실은 모든 coverage phase를 담고 discovery 분모만 VALIDATION/COACH_PROBE를 제외한다(PR은 프로파일 자체를 만들지 않았음 — 동등한 결과, 사실은 더 보존).
- PR 프로파일러는 UNKNOWN source 행을 sourceCounts에 세고 gap 축에서만 제외했다 → Surface는 관측 입력 단계에서 UNKNOWN source를 받지 않으므로(기존 규칙, Pipeline coverage도 제외) 결과가 같다.
- PR gap ID는 PR `ParameterKey.stableKey()`(엔진 Location 이름) 기반 → 우리는 `EndpointKey`+`ParameterLocation` 이름으로 같은 framing을 쓴다(HEADER 선언 좌표까지 포함, PR ID와의 호환 필요 없음). 요약문은 한국어.
- PR 인가 enrichment는 별도 `parameterValidationCells`·프로파일 안 `authorizationTargets` 배열과 attached 20개 wire preview, `AUTH_CONFLICTING_EVIDENCE` 별도 진단, 재적용 idempotence를 가졌다 → 우리는 한 번의 `SurfaceAnalyzer.analyze(..., AuthorizationAnalysis)`에서 같은 요청 행(Row)으로 계산해 `ParameterFact.authorizationTargets`·최상위 `validationCells`로 두고, 증인 preview는 32로 통일하며, Evidence ID 충돌은 3단계 `CONFLICTING_EVIDENCE` 하나로 전 operation에서 판단한다(PR 프로파일 단계는 operation별, 인가 단계는 전역이었음 — 전역이 더 엄격하고 EvidenceIds 유일성과 같음). VALIDATION 행은 `allRecords`에서 골라 사실·프로파일에는 넣지 않고 link·cell에만 연결한다(PR과 동일한 결과, coverageRecords가 VALIDATION을 제외하기 때문).
- link/cell의 `resource`/`targetResource`는 인가 정본이 이미 snapshot에 공개하는 객체 키(`orders:101`)이며 파라미터 값 저장이 아니다. Surface 비노출 회귀는 그 두 필드만 제외하고 값·digest·preview를 계속 금지한다.
- PR 프런트의 `ParameterKey.stableKey`/`ParameterProfile.id`/cell `id`(서버 생성) → 우리 snapshot에는 없으므로 `parameterMapKey`(endpoint+location+canonicalPath)와 `validationCellId`(좌표·판정 전부)를 클라이언트 표시용으로 파생한다. Graph route는 D-145에서 점검 우선순위/전체 관계 보기 두 탭으로 통합했다.
- D-145가 PR `DATASET_REPLACING`을 현행 `datasetRevision` 보조 신호로 흡수했다. 신호는 서버 전환 성공 뒤에만 보내고 실패한 전환은 열린 편집을 보존한다. `parameterEvidence.ts`도 on-demand `/api/evidence` 안전 projection으로 흡수했지만 record 영속·main snapshot digest·preview는 계속 이식하지 않는다.
- 상단 `WorkspaceNavigation`과 `GraphPage` 두 탭은 D-145로 흡수했다. 기존 source·identity 필터, 서버 Fact/판정 정본, legacy HTML 미교체는 유지한다. `RouteIconRail`과 별도 `#parameter-map` route는 중복이라 제거하며 옛 hash만 `#graph`로 호환한다.
- PR#12 판정 매트릭스의 후보 승격(기대 차단 + 2xx → `BOLA_IDOR_CANDIDATE`, 기대 차단 + 2xx + P3 → `BFLA_CANDIDATE`) → 정본 cell의 SUSPICIOUS/`roleViolation`이 있을 때만 후보이고, 본문 미확인 성공은 `BOLA_IDOR_REVIEW_REQUIRED`(D-144, D-004/D-050). PR의 `ValidationDecision` 기반 E3·`*_REPRODUCED`·게이트 PASS·prefix fallback → 이력 표시만(정확 cell). PR `inputCoverage`·`events[].inputs` → 미이식(`snapshot.surface` 파라미터 프로파일). PR legacy `index.html` 매트릭스 UI → React `JudgmentMatrixView`로 이식, legacy 미교체.
- Request Diff의 `VALUE_CHANGED`는 D-145 on-demand 비민감 digest가 있을 때만 판단한다. digest가 없으면 UNKNOWN이다. `OCCURRENCE_CHANGED`는 엔진이 독립 occurrence 필드를 보존하지 않아 계속 UNKNOWN이며 만들어 내지 않는다. main Surface의 complete/retained와 Evidence API 재추출 문맥은 각각 자기 범위를 명시한다.
- legacy `index.html` UI(#12) → React `MatrixPage`에 이식.

## 현재 우선순위 · 보존형 프로젝트와 Evidence 무결성

1. 현재 진단을 새 프로젝트 DB에 저장하기 전에는 scope·메모리 Evidence를 교체하지 않는다.
2. 저장 실패는 숨기지 않고 `PENDING/SAVING/SAVED/FAILED`, 마지막 성공 시각과 마스킹 오류로 표시한다.
3. 분석 revision과 데이터셋 교체 revision을 분리해 일반 polling/rebuild가 Request Lab 초안을 지우지 않게 한다.
4. API·입력 차이의 실제 Observation에서 exact Evidence 상세·Request Lab·Repeater로 이동하되 Declaration-only 항목에는 전송 동작을 만들지 않는다.
5. 반복 import는 같은 provenance의 기존 multiplicity만 억제하고 fingerprint·lane account·run이 다른 Evidence를 보존한다.
6. Burp XML의 header/body 문자셋과 XML/HAR IPv6 service를 같은 canonical 계약으로 처리한다.
7. JDK 21 전체 회귀와 distribution gate 뒤 실제 Burp에서 수집→저장→새 진단→재열기, Surface→Request Lab/Repeater, XML/HAR 반복 import를 확인한다.
8. disk full·권한 거부·강제 종료와 Windows project directory를 운영 gate로 남긴다.

**현재 상태:** 1~6 구현과 집중 회귀, JDK 21 전체 `mvn clean verify` 2회, 격리된 clean JAR Standalone Chromium E2E 8/8을 통과했다. 7의 실제 Burp 동선과 8의 실패 주입·Windows는 대기한다. 자동 회귀를 Burp 운영 성공으로 확대하지 않는다.

## 현재 우선순위 · ZAP 직접 브라우저 인증

1. HUMAN/Request Lab의 Session Broker와 ZAP 로그인 계정 vault를 분리하고 raw 자격증명을 현재 프로세스 밖으로 내보내지 않는다.
2. 계정마다 이름 없는 ZAP session과 임시 Context/user를 만들고 FlowScope Docker Chromium의 Browser Based Authentication과 session auto-detect를 설정한다. ZAP action의 `OK`나 인증 시각이 아니라 같은 run·계정의 실제 인증 응답 Evidence가 필수 로그인 성공 정규식과 일치할 때만 account-scoped `chrome-headless` strict Client Spider를 실행한다. 비로그인도 같은 browser를 명시하고 Traditional/AJAX는 호출하지 않는다.
3. valid campaign capability를 통과한 직접 인증 SCANNER 요청의 ZAP Cookie/Authorization을 보존하고, 명시적 인증 성공이 있는 `laneAccountId`만 Evidence 신원으로 사용한다.
4. 성공·실패·취소에서 crawler quiescence와 임시 user/Context cleanup을 확인하며 실패한 격리 상태로 후속 계정을 실행하지 않는다.
5. React에서 계정 등록/폐기, 인증 상태·브라우저·단계·경과·heartbeat, API 정의 입력, 캠페인 취소를 제공하고 비밀값은 server 응답·query cache에 반환하지 않는다.
6. Chromium/ChromeDriver 동작·주 버전, 실제 headless 기동, 관리 tmpfs `zapHomePath`를 시작 전에 확인하고 임의 ZAP runtime을 거부한다. 집중 회귀 뒤 전체 `mvn clean verify`와 JAR/bundle 구조·hash를 확인한다.
7. Burp scanner listener 8081이 열린 실제 ZAP 2.17 환경에서 비로그인+로그인 2계정, 로그인 실패, capture 귀속, 쿠키 격리, strict Client와 0건 실패, Passive/Alert, 정의 import, 취소·cleanup을 검증한다.
8. Windows bundle/doctor/Docker 실기기와 CAPTCHA·MFA·WebAuthn·복합 SSO 한계를 별도 운영 gate로 남긴다.

D-133에서 별도 8090 Compose project로 daemon/API/session 실물 gate를 완료했다. D-134는 실제 Burp 로그인 lane에서 드러난 `verification` API `no_implementor`를 제거했다. D-135는 bundle에 Chromium/ChromeDriver 포함 이미지를 추가하고 모든 lane을 `chrome-headless`로 고정했다. D-136은 `OK`/인증 시각의 오류 비밀번호 오수락을 실물로 반증하고 같은 run·계정의 실제 인증 응답 Evidence를 성공 gate로 바꿨다. D-137은 인증 직후 비동기 분석 snapshot이 아직 게시되지 않아 정상 로그인을 실패 처리하는 경합을 재현하고, run·계정으로 제한한 원시 캡처 기록을 인증 gate로 분리했다. 별도 API 18889/기록 프록시 18881 하네스에서 익명·alice·bob Client 탐색과 오류 비밀번호의 Client 전 차단을 재확인했다. 이후 실제 macOS Burp 8081에서 익명 Client가 59초 만에 SCANNER 14건·Alert 29건·거부 0건으로 완료됐다. D-138은 이 실행 중 한 번의 ZAP 상태 probe 실패를 `UNREACHABLE`로 확정하던 표시 결함을 3회 연속 실패 기준으로 바꾼다.

**현재 상태:** 1~6과 D-136 별도 실물 로그인/복수 계정/오류 비밀번호 gate를 완료했다. 7은 실제 Burp의 비로그인 lane까지 완료했으며 로그인 2계정·실패 계정·정의 import·취소는 아직 실제 Burp에서 대기한다. 8의 Windows 운영 gate도 대기한다.

현재 구현 계약은 [D-138](decisions.md#d-138--zap-연결-불가는-일반-통신-실패-3회-연속-뒤에만-확정한다-2026-09-09), 검증 결과는 [beta-validation](beta-validation.md), 인계는 [HANDOFF](HANDOFF.md)가 정본이다.

## 현재 우선순위 · 독립 LLM Explorer

1. Judge와 기존 MCP/브라우저 실행기는 D-126 상태로 제거 유지. 새 MCP·Judge를 복구하지 않는다.
2. 대형 HTML/JavaScript/JSON/XML의 capture → record → 분석 전달을 4MiB 경계와 1.4MiB 회귀로 수정했다.
3. 메모리 전용 계정 vault, HTML form/JSON API 인증, exact-scope HTTP gateway, Codex app-server dynamic-tool provider, coordinator를 구현했다.
4. React Explorer에 계정 입력, anonymous/account 선택, 경과시간·HTTP 시도/응답 Evidence·선언 endpoint/parameter·OPTIONS probe·미해결·오류, steer·취소를 연결했다.
5. D-139에서 산출물 발견을 자유서술이 아닌 current-run Evidence-bound `RouteCandidate`/parameter declaration으로 저장하고 의미 중복 제거·프로젝트 round-trip·Surface source 필터에 연결했다. 큰 응답은 64KiB부터 최대 4MiB 임시 artifact로 전달하며 OPTIONS capability probe는 기능 관측과 분리한다.
6. 집중 회귀와 실제 로그인된 Codex provider opt-in 하네스에서 HTTP Evidence → 선언 tool 호출을 통과했다. 최종 코드의 전체 `mvn clean verify` 2회도 React 248·Java 388 tests와 byte-identical JAR·release 구조 검사를 통과했다.
7. 새 JAR 실제 Burp에서 anonymous·HTML form·JSON token, exact-scope, Evidence·선언 귀속, 큰 번들 단일 수집, OPTIONS 분리, 취소/정리, 프로젝트 비밀 비저장을 확인한다.
8. 승인된 독립 corpus에서 HUMAN·ZAP 대비 추가 endpoint·parameter, 선언 precision, 중복·노이즈·요청량·검토시간을 측정한다. 결과 전에는 발견률 우월성을 주장하지 않는다.
9. ZAP Client-only 전환은 D-132로 구현했다. FlowScope Evidence용 제품 MCP는 이번 Explorer와 섞지 않는 별도 결정으로 남긴다.
10. 다운로드 사용자가 clone 없이 실행하도록 JAR·ZAP helper·문서를 distribution bundle로 만들고, `human|zap|explorer|full` doctor와 Explorer readiness 재확인을 제공한다. JAR/bundle 재현 검사와 Windows parser를 통과한 뒤에만 배포 준비 완료로 표시한다.

현재 Explorer 실행 계약은 [LLM Explorer](llm-explorer.md), 삭제 목록·보존 계약은 [제거 상태](mcp-judge-removal-plan.md)가 정본이다. 아래 beta별 완료 수치·기존 LLM 실행 설명은 당시 이력이지 현재 기능이 아니다.

## 이전 버전별 계획·검증 이력

아래 “현재 상태/완료”는 각 beta 작성 당시의 상태다. 삭제된 MCP·Explorer·Judge의 남은 실행 gate는 현행 작업에서 폐기됐으며, 현재 후속 작업은 위 우선순위와 [HANDOFF](HANDOFF.md)만 따른다. 과거 테스트 결과는 변경하지 않는다.

## 0. beta.44 우선순위: 실행 실패와 탐색 0건의 분리

1. MCP 통제 HTTP 시도를 HTTP Evidence와 분리한 bounded typed 원장으로 기록한다.
2. `실행 전 / 전부 전송 실패 / 일부 실패 / HTTP 응답 수신`을 run 단위로 계산한다.
3. 전부 실패한 Explorer 완료를 거부하고 일부 실패를 완료 limitation으로 남긴다.
4. LLM 실행 패널과 Endpoint·Parameter Surface에 시도·응답·실패를 표시하되 실패를 관측 endpoint로 올리지 않는다.
5. JSON v4·SQLite v3에 비밀 없는 실행 원장을 round-trip하고 구버전 exact completed run을 보존한다.
6. 집중 회귀 뒤 전체 `mvn clean verify` 2회, 재현 JAR, inline JavaScript, manifest/notice gate를 수행한다.
7. 실제 Burp에서 정상 HTTPS, 신뢰되지 않은 인증서, 연결 timeout을 각각 실행해 typed outcome과 UI·재열기를 확인한다.

**현재 상태:** 1~6을 완료했다. React 통합과 MR-JAR 전수 회귀를 포함한 고정 최종 입력에서 React 265 tests와 Java 374 tests를 명시한 JDK 21.0.12·Maven 3.9.16 환경의 두 clean verify 모두 통과했고 byte-for-byte 동일 JAR을 확인했다. 이는 임의 JDK·운영체제 사이의 동일 해시 주장이 아니다. 7의 실제 Burp gate는 대기하며, 자동 테스트만으로 운영체제별 Montoya 예외 분류를 완료했다고 주장하지 않는다.

### beta.44 React 작업면 통합 gate

1. PR의 React source·접근성·테스트·정적 asset pipeline만 최신 beta.44 위에 통합하고, 이전 beta Java/Maven/LLM 구현은 받아들이지 않는다.
2. 기본 `API·입력 차이`에서 `surface`와 `runExecutions`를 직접 표시하고 H/S/L 필터·선언 provenance·파싱 실패를 보존한다.
3. graph operation 관계, 혼합 verdict, route candidate filter와 Dashboard 3-way 표시를 회귀로 고정한다.
4. `/`, `/app/`, `/legacy/`, HEAD·MIME·경로 차단과 fat JAR asset 포함을 Java 계약으로 확인한다.
5. React unit/type/build, Java 전체 회귀, 단일 JAR·manifest·notice·reproducibility를 확인한다.
6. standalone no-cache 브라우저에서 기본 route와 주요 화면·console error를 확인한다.
7. 실제 Burp에서 HUMAN/ZAP/LLM·세션·Request Lab을 재검증한 뒤에만 legacy 제거 여부를 결정한다.

**현재 상태:** 1~6을 완료했다. React 265 tests·Java 374 tests의 연속 두 clean verify, 명시 환경의 동일 JAR, no-cache standalone의 전체 React route·legacy 전환과 새 browser warning/error 0건을 확인했다. 7의 실제 Burp HUMAN/ZAP/LLM·세션·live Request Lab gate는 대기하므로 legacy는 유지한다.

## 0. beta.43 이력: 정적 해석 정확도와 검토 화면 집중

1. lexical scope가 다른 같은 이름의 binding을 구분하고 정적 object member URL을 해석한다.
2. axios import·instance를 구분하고 `baseURL`, 요청별 override, absolute URL 결합 규칙을 실제 axios 계약과 맞춘다.
3. 재할당·동적 baseURL·함수 반환·미지원 wrapper는 거짓 endpoint로 만들지 않고 typed resolution issue로 남긴다.
4. 산출물 요약에서 parser 실패와 call-site 일부 미해석을 Evidence·line 단위로 구분한다.
5. Surface 화면에는 Surface·source 제어만, 인가 화면에는 인가 제어만 보여 한 화면의 경쟁 작업을 줄인다.
6. 사용자 화면의 `객체`를 `접근 대상 ID`로 바꾸되 내부 Resource/owner/BOLA 판정 모델은 유지한다.
7. 집중 회귀와 전체 clean verify 2회, 재현 JAR, standalone no-cache 화면을 검증한다.
8. 실제 Burp 재로드와 독립 외부 corpus pilot은 별도 gate로 남기고 자동 회귀 결과로 일반화 성능을 주장하지 않는다.

**현재 상태:** 1~7은 코드·집중 회귀, 전체 349 tests의 clean verify 연속 2회, byte-for-byte 재현 JAR과 standalone no-cache 화면 확인을 통과했다. 8은 미실행이다. beta.42에서 “1~8 완료”라고 쓴 문장은 구현과 내부 구조 회귀의 범위를 과도하게 합친 표현이었다. 정확한 단계별 상태는 아래 beta.42 정정과 `endpoint-parameter-surface.md`를 따른다.

## 0. beta.42 우선순위: 범용 선언 추출과 검증 가능한 실패 경계

1. 범용 HTTP·parameter observation을 query/path/JSON/form/multipart/GraphQL variable 단위로 완성한다.
2. OpenAPI·HTML form parameter declaration을 실제 산출물 Evidence에 연결한다.
3. 정규식 JavaScript 추출을 실행 없는 `ECMASCRIPT_NEXT` AST call-site 분석으로 교체한다.
4. endpoint·parameter delta 화면에 H/S/L 관측뿐 아니라 산출물 파싱 정상·부분·실패·상한을 표시한다.
5. 분석기에 전달하지 않는 별도 truth를 가진 held-out fixture에서 endpoint·parameter·asset exact set을 확인한다.
6. syntax recovery, parser failure, input/AST limit, application wrapper, unobserved lazy asset, server-only unknown을 구분한다.
7. held-out에서 일반 asset 연결로 부족한 Next.js pages-router build manifest의 client chunk 참조만 전용 adapter로 보완한다.
8. Vue/Nuxt·Angular는 공통 HTML/ESM asset 경로로, GraphQL은 observed operation/variables로 검증하고 제품별 의미 추정은 추가하지 않는다.
9. 정확한 범위와 승인을 받은 외부 대상에서 pilot한다.
10. pilot 결과의 정확도·검토량·실패 구조를 근거로 지원 Tier를 조정한다.

**beta.43에서 정정한 상태:** 1~4는 구현·자동 회귀 완료다. 5는 저장소 내부 합성 truth의 구조 회귀만 완료했으며 독립 효능 검증은 아니다. 6은 parser/limit과 일부 resolution issue를 구조화했지만 모든 런타임·wrapper 실패를 분류하지 못한다. 7은 Next.js pages-router manifest의 chunk 연결만 구현했으며 실패 빈도에 기반한 우선순위 검증이 없다. 8은 공통 asset 경로와 GraphQL 관측 회귀만 있고 framework별 parser·실제 앱 검증은 없다. 9~10은 미실행이다. beta.42의 340 tests·재현 JAR·standalone 결과는 그 릴리스의 자동 회귀 사실로 유효하지만 “1~8 완료” 근거로 확대하지 않는다.

## 0. beta.41 우선순위: 범용 Endpoint·Parameter Surface Delta

1. 실제 HTTP 관측과 OpenAPI·HTML form·정적 JavaScript 선언을 같은 값 없는 endpoint/parameter fact schema로 분리한다.
2. query, canonical path 위치, 중첩 JSON, form-urlencoded, multipart 이름을 source/run/identity/status/Evidence ID와 함께 관측하되 원 값을 surface에 저장하지 않는다.
3. 타깃 host·업무명·프레임워크 이름을 조건으로 쓰지 않고 동적 계산은 미확정으로 둔다. 구조는 같고 route·field 이름만 바꾼 회귀를 다음 blind corpus gate에 포함한다.
4. Web 기본 작업면을 source별 endpoint/parameter delta로 두고, 기존 Resource/owner/BOLA·BFLA 그래프와 매트릭스는 선택 API의 상세층으로 보존한다.
5. snapshot/UI 계약, JavaScript parse, 전체 `mvn clean verify` 두 번, 단일 JAR·SHA-256 재현을 확인한다.
6. 실제 Burp beta.41 재로드 뒤 H/S/L filter, Evidence/provenance 상세, 기존 인가 그래프·매트릭스 회귀를 확인한다.
7. 개발 corpus와 분리된 server truth fixture에서 endpoint/parameter precision·recall, 검토 항목 수와 사용자 task-time을 측정한다. 성능 향상이 없는 adapter는 기본 경로에 추가하지 않는다.

**현재 상태:** 1~5는 코드·문서 정합성, 최종 330 tests 연속 두 clean verify, byte-for-byte 동일 JAR과 standalone Web 수동 확인을 통과했다. 6의 실제 Burp beta.41 재로드와 7의 개발 corpus 분리 blind 효능 gate는 대기한다. 정적 JavaScript literal 지원을 동적 bundle 전체 분석으로 표현하지 않는다.

## 0. beta.40 우선순위: Explorer 1~10 실행 계약과 실제 경로 보존

1. own-run inventory를 읽고 exact entry GET Evidence를 만든다.
2. HTML·JavaScript·metadata·OpenAPI·XML 응답에서 독립 frontier를 확장한다.
3. 표시용 path template과 실제 관측 concrete path를 분리해 객체 ID를 잃지 않는다.
4. endpoint/object/function/workflow 검토 차원을 서버가 구조화하되 취약점 verdict로 승격하지 않는다.
5. concrete GET/HEAD/OPTIONS/UNKNOWN을 controlled executor로 소진한다.
6. rendered-app 신호가 있으면 격리 브라우저를 discovery-only로 권고하고, 발견 route를 HTTP executor로 재현한다.
7. 객체·BOLA/IDOR와 method·BFLA·workflow 후보는 현재 run의 실제 Evidence에서만 만든다.
8. 상태 변경은 기존 요청 단위 Burp 승인 계약을 유지하고 미승인 route를 실행하지 않는다.
9. 독립 frontier 뒤에만 provenance-free assisted concrete hint를 공개한다.
10. 두 frontier와 exact-run Evidence를 검증하고, 브라우저 미사용·불가와 실제 값 없는 template을 완료 한계로 반환한다.

추가 운영 gate는 Codex/Claude 자식 프로세스가 정상 종료를 무시할 때 parent와 알려진 descendants를 강제 종료하고 실제 종료를 확인하는 것이다. 자동 회귀와 매번 새 포트의 local HTTP fixture를 먼저 통과한 뒤 실제 Burp+provider run을 수행한다. endpoint/finding 정확도 향상은 블라인드 benchmark 전에는 주장하지 않는다.

**현재 상태:** 1~10의 코드·집중 회귀, 매번 새 포트 local HTTP fixture, 전체 324 tests 연속 두 clean verify와 byte-for-byte 동일 beta.40 JAR은 통과했다. 실제 Burp+Session Broker+Codex/Claude 장기 Explorer, SPA browser 추가 recall과 블라인드 endpoint/finding precision·recall은 대기한다. 따라서 구현 gate 통과와 실환경·효능 검증을 구분한다.

## 0.1 beta.39 당시 우선순위: 통합 회귀 복구와 실제 Burp gate

1. API 문맥 없는 401/403 scanner probe와 `/manifest.json`을 메인 API 그래프에서 분리하되 Evidence는 보존한다.
2. Explorer의 실제 방문 사실과 BOLA/BFLA coverage 자격을 분리해 제외된 navigation/static route가 완료를 영구 차단하지 않게 한다.
3. 기본 `identity → API`, 선택형 사이트 개요, 계층별 viewport와 고유 API 집계를 회귀로 고정한다.
4. ZAP 비로그인·로그인 lane의 두 rendered crawler, Passive 진행·부분 완료, 모든 실패 경로의 crawler/queue cleanup과 다음 신원 격리, bounded 실시간 실행 기록을 회귀로 고정한다.
5. ZAP SYSTEM 캠페인의 포트 기반 귀속을 run별 capability로 교체하고, native Burp Scanner 분리, lane 계정 provenance, crawler terminal 확인, 취소·예외 terminal 상태, exact-scope AJAX/Active Context, bounded Alert와 API key/Docker 경계를 회귀로 고정한다.
6. capability 누락을 run별로 계수해 다음 crawler 전에 격리 실패로 끝내고, 세션 설정·정의 import의 blocking API 대기를 worker heartbeat로 관측 가능하게 만든다.
7. 전체 verify·독립 Web 검증 후 beta.39 JAR을 실제 Burp에 재로드하고 crAPI HUMAN/ZAP/LLM을 새 run으로 실행한다.

**현재 상태:** 1~6은 코드·집중 회귀·전체 315 tests 연속 2회·재현 JAR 검증을 통과했다. 7의 실제 Burp beta.39 재로드·crAPI 재실행, Replacer capability 실전 통과, 취소/stop quiescence와 장시간 ZAP 비로그인→로그인 전환은 대기한다. 자동 회귀는 실제 endpoint recall이나 취약점 탐지율을 증명하지 않는다.

## 0. beta.38 우선순위: ZAP 장시간 실행 관측 가능성

1. campaign/lane/stage 시간, 단계 제한, ZAP heartbeat와 raw capture/status 변화를 상태 API의 명시 계약으로 만든다.
2. 후속 신원이 직렬 대기 중인 이유와 queue 위치를 표시해 정지·오류와 구분한다.
3. heartbeat 부재, 응답 정상 무변화, deadline 초과를 서로 다른 운영 상태로 보여 주되 자동 취약점·성공 판정으로 쓰지 않는다.
4. 전체 verify와 재현 JAR을 통과한 뒤 실제 Burp에서 장시간 AJAX → test1 전환을 확인한다.

**현재 상태:** 1~3 코드, inline JavaScript parse, 전체 verify 299 tests 연속 2회와 byte-for-byte 동일한 beta.38 JAR을 완료했다. 4의 실제 Burp beta.38 재로드·장시간 AJAX→test1 전환·heartbeat 단절/timeout 표시는 대기한다.

## 0. beta.37 우선순위: Explorer 입력 무결성과 그래프 Fact Core

1. Explorer run에서 선택한 account를 고정하고 target tool의 account override를 서버에서 거부한다.
2. rendered discovery는 선택형 8082 listener에 의존하지 않게 CDP direct worker로 유지하되 exact scope와 service별 broker header 경계를 강제한다.
3. CLICK/FILL selector가 아니라 실제 비안전 HTTP request 단위로 Burp 승인을 받고, browser runtime route를 discovery-only frontier에 등록해 controlled replay를 완료 조건으로 만든다.
4. coverage 관측을 `GraphObservationFact`로 투영해 Evidence·identity·API·object·source·run·HTTP outcome을 보존하고, 화면은 Site→API Group→Identity→API→Object family/instance 순으로 단계적으로 연다.
5. 전체 `mvn clean verify`, JavaScript parse, 단일 JAR smoke를 통과한 뒤 beta.37을 실제 Burp에 재로드해 현재 beta.34 화면과 구분한다. crAPI 고카디널리티 객체에서 선 교차·라벨 가독성·클릭 drill-down을 확인하고, beta.36 대비 route replay·노이즈·시간·메모리와 blind endpoint/finding 성능을 별도 측정한다.

**현재 상태:** 1~4 코드, inline JavaScript parse, 전체 `mvn clean verify` 299 tests 연속 2회와 동일 SHA-256 JAR은 통과했다. 5의 실제 Burp beta.37 재로드·고카디널리티 화면·블라인드 효능은 아직 완료로 기록하지 않는다.

## 0. beta.36 우선순위: SPA browser discovery와 Evidence replay 분리

1. 설치된 Chrome/Chromium/Edge를 임시 profile·CDP로 실행하되 Playwright/Chrome MCP/ChromeDriver를 새 사용자 의존성으로 만들지 않는다.
2. CDP에서 exact scope 밖 request를 차단하고 run 시작 시 선택한 broker account를 고정 주입한다. 기본 Chrome profile과 provider 브라우저를 재사용하지 않는다.
3. DOM·링크·폼·버튼·SPA runtime network는 discovery hint로만 반환하고, controlled executor 재현만 Evidence·완료·Judge lock 자격을 갖는다.
4. direct navigation/snapshot은 자동 허용하되 CLICK/FILL은 Burp 승인, password/file block, arbitrary JavaScript 비노출을 강제한다.
5. 로컬 Chrome smoke와 자동 계약을 통과한 뒤 beta.36 JAR을 실제 Burp에 재로드해 HTTPS, 8082 proxy, ACTIVE account session, SPA API 발견→replay→Evidence→run 종료를 확인한다. 이어 동일 target에서 beta.35 HTTP-only 대비 새 route 수, 유효 API 수, 중복/노이즈, 소요시간·메모리를 측정한다.

**현재 상태:** 1~4 코드와 run 실패·취소 cleanup, 로컬 설치 Chrome의 임시-profile/CDP/exact-scope/DOM/network/click smoke, MCP discovery-only 계약 회귀를 완료했다. 전체 `mvn clean verify` 296 tests와 beta.36 JAR smoke도 통과했으며 정확한 산출물은 `beta-validation.md`에 기록했다. 실제 Burp HTTPS·broker account·8082 통합과 블라인드 성능 비교는 아직 완료로 주장하지 않는다.

## 0. beta.35 우선순위: Explorer 안전 개방과 실증 가능한 완료 gate

1. own-run INDEPENDENT safe concrete route를 모두 요청하기 전에는 다른 레인 힌트를 공개하지 않는다.
2. 독립 frontier가 소진되면 HUMAN·SCANNER의 source/run/Evidence/provenance/응답을 제거한 route 문자열만 ASSISTED hint로 제공한다.
3. controlled response Evidence, 두 frontier 조회, 종료 시점 safe concrete route 0건을 Explorer 완료 조건으로 통합한다.
4. `{id}` 동적 route는 실제 관측값이 없으면 만들지 않고, POST/PUT/PATCH/DELETE는 기존 명시 승인·Burp 확인을 유지한다.
5. 다음 수직 단위는 JavaScript 실행이 필요한 SPA를 위한 격리 browser worker와 Explorer 작업 피드/개입 계약이다. browser worker가 없을 때의 HTTP-only 한계를 UI와 결과에 명시하고, 블라인드 target에서 HTTP-only 대비 추가 route와 자원 비용을 측정한다.

**현재 상태:** 1~4 코드, 전체 `mvn clean verify` 294 tests와 beta.35 JAR smoke는 완료했다. 두 번째 재현 build, 실제 Burp+허가 target Explorer와 browser worker는 아직 완료하지 않았다. ASSISTED 발견은 독립 LLM coverage가 아니라 별도 보완 단계로 측정한다.

## 0. beta.34 우선순위: P1 복잡도·메모리 경계 완료와 효능 gate

1. Snapshot 반복 cluster를 선형 projection으로 바꾸고 Evidence ID를 페이지 조회한다.
2. DataFlow 중첩 순회·substring을 신원별 exact-token index로 바꾼다.
3. live HTTP decode 전 byte 상한, 프로젝트 streaming GZIP 복원 상한, assessment retained-byte 상한을 공통 gate로 고정한다.
4. 20,000건 stress와 공격 입력 회귀를 통과하되 자동 테스트를 탐지 효능으로 표현하지 않는다.
5. 다음 개발은 P2 세션·신원 무결성을 먼저 닫고, 이후 정답 격리 benchmark에서 H → H+ZAP → H+ZAP+LLM → Judge의 고유 유효 발견, FP/FN/INCONCLUSIVE, 검토시간과 자원을 증분 측정한다. 유의미한 증가가 없는 레이어는 기본 경로에서 낮추거나 제거한다.

**현재 상태:** 1~4 코드와 293개 전체 자동 회귀·연속 두 재현 빌드는 완료했다. 실제 Burp 20,000건 RSS·polling, end-to-end 3-way와 블라인드 효능은 아직 완료하지 않았다. 다음 코드 우선순위는 `HANDOFF.md`의 P2이며, UI 재설계나 새로운 탐색 휴리스틱을 먼저 추가하지 않는다.

## 0. beta.33 우선순위: 비동기 게시·요청 실험·후보 표시 무결성

1. Request Lab은 Evidence 선택 generation과 전송 중 불변 draft를 사용해 늦은 응답이 현재 선택을 덮지 못하게 한다.
2. UI 잠금뿐 아니라 서버 operation ID 멱등성으로 동일 요청의 중복 상태 변경을 한 번만 실행한다. ID 재사용 시 입력 digest가 다르면 거부한다.
3. 분석 결과는 dataset/config publication epoch가 같은 경우에만 게시해 clear·즉시 rebuild·background rebuild 경합에서 이전 결과가 부활하지 않게 한다.
4. 빈 authorization cell은 서버가 만든 exact `UNCROSSED` candidate key가 있을 때만 미교차 후보로 표시하고, 그 외에는 일반 미검증으로 남긴다.
5. P1의 남은 대용량·복잡도 결함은 Snapshot cluster 출력, DataFlow index, bounded decode/decompression, LLM retained-byte 순으로 실패 fixture와 수치 예산을 먼저 만든 뒤 수정한다.

**현재 상태:** 1~4의 코드와 집중 회귀는 완료했다. 전체 `clean verify`·재현 JAR 수치는 `beta-validation.md`에 실제 실행 결과만 기록하며, 실제 Burp Request Lab 지연 응답·상태 변경과 clear/rebuild 동시성 수동 gate는 아직 완료로 주장하지 않는다.

## 이전 우선순위: beta.32 Evidence 신뢰·exact run 완료·재열기 무결성

1. HUMAN/SCANNER/LLM 정상 완료를 `LaneCompletionPolicy` 한 경로로 통합하고 실패·취소를 abort로 분리한다.
2. 8082 직접 fallback의 `UNVERIFIED_RUNTIME`을 원 Evidence로만 보존하고 coverage·Explorer 완료·dataset lock에서 제외한다.
3. 완료 시점 Evidence ID를 exact run과 함께 동결하고 잠금 입력도 그 ID들로만 구성한다.
4. JSON schema v3와 SQLite storage schema v2에 exact completed run을 저장하고 source-only legacy 표식은 완료로 복원하지 않는다.
5. 무작위 run ID 대조, 전체 자동 회귀, 재현 JAR smoke를 통과한 뒤 실제 Burp 3-way 저장→재열기→재잠금을 수동 gate로 수행한다.

**현재 상태:** 1~4 코드와 자동 회귀는 완료했다. 실제 beta.32 JAR 수동 통합 gate와 blind benchmark는 남아 있으며 `beta-validation.md`에서 수행 결과만 기록한다.

## 이전 우선순위: beta.31 외부 사용자의 LLM 환경 자동 준비

1. 사용자는 공식 Codex/Claude CLI 설치와 최초 구독 로그인만 수행한다.
2. FlowScope가 운영체제 표준 경로·런타임 환경에서 실행 파일을 찾고 공식 auth status로 준비 상태를 자동 확인한다.
3. Web polling은 캐시만 읽고 READY provider를 자동 선택한다. 실행 직전에는 다시 확인해 stale 상태로 시작하지 않는다.
4. 전체 회귀, 두 로컬 로그인 CLI preflight, 재현 JAR을 통과한 뒤 beta.31 Burp MCP Explorer를 수동 통합 gate로 수행한다.

**해당 버전 종료 당시 상태:** 코드와 집중 회귀, 로컬 Codex·Claude auth status 확인은 완료했다. 전체 자동 회귀·재현 배포물 수치는 `beta-validation.md`를 따르며 실제 beta.31 Burp Explorer 완주는 남았다.

## 0. beta.30 우선순위: 로그인 후 원클릭 실행과 관측 가능한 Explorer

1. 공식 Codex/Claude CLI 설치와 로그인 이후에는 API key 입력·MCP 설정 복사 없이 Web 버튼으로 새 실행을 시작한다.
2. 설치와 로그인 준비 상태를 구분하고 실패 원인을 대상 요청 전에 사용자에게 보여 준다.
3. 실제 provider JSONL에서 모델 메시지·FlowScope tool 상태·Evidence 완료 gate만 bounded event로 노출한다. reasoning/thinking과 raw tool payload는 표시하지 않는다.
4. 자동 회귀, 실제 구독 CLI smoke, 재현 JAR을 확인한 뒤 beta.30 JAR의 Burp MCP target run을 수동 통합 gate로 수행한다.

**해당 버전 종료 당시 상태:** 코드, 265개 전체 회귀, 실제 로그인 Codex CLI smoke와 재현 JAR은 완료했다. beta.30 JAR 재로드 뒤 실제 Burp MCP target run과 Claude 로그인 환경 gate는 대기 중이었으며 수치는 `beta-validation.md`를 따른다.

## 마스터 계획 1단계 — 완성 목표 재정의

정본 목표는 다음과 같다.

> 허가된 exact scope에서 관측 가능한 접근통제 공격면을 최대한 구조화하고, 신원·작업·객체·상태 흐름의 차이를 재현 가능한 Evidence로 검증해 사람이 놓치기 쉬운 경로와 인가 후보를 드러낸다.

완성 기준은 기능 개수나 화면 존재 여부가 아니다. 공개 fixture와 정답 격리 블라인드 benchmark에서 endpoint·객체·분류·finding 측정값, 사용자 `REVIEW` 작업량, false positive·false negative·unresolved를 함께 공개하고, 후보와 verdict를 원 Request/Response·재현·정상 대조 Evidence까지 역추적할 수 있어야 한다.

## 0. beta.29 우선순위: 실제 Codex Explorer 실행 격리와 성공 오라클 완결

1. 사용자 home의 skill 목록을 끄는 설정 문자열에 의존하지 않고 로그인만 연결한 임시 `CODEX_HOME`으로 provider 실행 환경을 구조적으로 격리한다.
2. 첫 target call을 exact entry GET read로 고정하고, 이후에는 같은 run 응답에서 파생된 route frontier만 순회시킨다.
3. server-side `end_run` gate와 launcher-side exact Evidence gate를 함께 두고 0건 완료 표식은 취소한다.
4. unit/integration 회귀와 실제 구독 Codex strict/ephemeral smoke를 통과한 뒤 단일 JAR을 만든다.
5. 새 JAR 재로드 뒤 실제 Burp MCP에서 target read, route 재열거, Evidence 저장, 정상 종료를 확인한다. 이 gate 전에는 Explorer 실대상 완주를 주장하지 않는다.

**해당 버전 종료 당시 상태:** 1~4의 코드·자동 회귀와 로컬 Codex 0.147.0 구독 smoke를 완료했다. 5의 beta.29 Burp 재로드 통합 gate와 블라인드 benchmark는 대기 중이었다.

## 0. beta.28 우선순위: Explorer 무성과 성공 차단과 명시 API 정의 탐색

1. Codex/Claude Explorer의 안전 read와 승인형 write를 MCP 계약부터 분리하고, 실제 응답 Evidence가 없는 run은 완료시키지 않는다.
2. Codex 실행별로 사용자 skill·plugin·외부 browser surface를 격리하고 로컬 prompt-input smoke와 회귀로 확인한다.
3. ZAP outgoing proxy를 대상 전송 전에 fail-closed 검사하고, 운영자가 제공한 exact-scope OpenAPI·GraphQL·Postman·SOAP 정의를 신원별 Context에서 bounded import한다.
4. 정의 import 실패는 기존 crawler/passive Evidence를 버리지 않고 단계·형식·원인을 사용자에게 표시한다.
5. 자동 회귀와 JAR smoke 뒤 실제 Burp에서 Codex target read/0건 실패, ZAP 네 형식 import, 복수 계정 campaign, 3-lane lock과 Judge를 확인한다.

**해당 버전 종료 당시 상태:** 1~4의 코드, 258개 전체 자동 회귀, 완성 JAR smoke와 동일 소스 2회 SHA-256 일치를 완료했다. 5의 실제 Burp 재로드 통합 gate와 블라인드 benchmark는 대기 중이었으며, 완료 전에는 탐지 성능 향상이나 3-way 실환경 완주를 주장하지 않는다.

## 0. beta.27 우선순위: 안전 ZAP 기준선 완결과 구독 CLI 실행 복구

1. 신원별 ZAP 기준선이 외부 설정에 조용히 의존하지 않도록 필수 안전 add-on, 선택 target subtree 전용 Context, passive engine·전체 rule·scope-only 상태를 spider 전에 확인·적용한다.
2. Traditional, Client, AJAX의 서로 다른 탐색면을 모두 실행하되 단계 실패·0건을 숨기지 않고 남은 Evidence와 함께 경고 완료로 보존한다.
3. ZAP Alert를 첫 500개에서 자르지 않고 페이지 단위로 수집하되 신원별 메모리 상한과 truncation 상태를 공개한다.
4. GUI Burp의 축소된 환경에서도 로그인된 Codex/Claude CLI 런타임을 찾도록 실행 파일 경로 전달을 보강하고, 기존 Session Broker·Judge Evidence gate를 전체 회귀로 재검증한다.
5. 자동 회귀와 JAR smoke 뒤 실제 beta.27 Burp에서 ZAP key/upstream/add-on, 계정별 capture, Explorer 종료, dataset lock, Judge 재현·대조를 순서대로 확인한다.

**해당 버전 종료 당시 상태:** 1~4의 코드, 253개 전체 자동 회귀와 beta.27 JAR 산출물 검증을 완료했다. 5의 실제 Burp 통합 gate는 대기 중이었으며 완료 전에는 성능 향상이나 3-way 완주를 주장하지 않는다.

## 0. beta.26 우선순위: 기존 ZAP HAR를 SCANNER Evidence로 재사용

1. ZAP에서 내보낸 HAR 1.2 HTTP 요청·응답을 기존 SCANNER 데이터 모델로 손실 없이 가능한 범위까지 변환한다.
2. 인증 마스킹, exact scope, 입력/payload 상한과 항목 단위 오류 격리를 live/XML 경계와 일치시킨다.
3. HAR 파일에는 없는 native Alert, fresh session, campaign completion을 추론하지 않는다.
4. 합성 회귀 뒤 실제 ZAP 2.17 HAR를 beta.26 Burp에서 업로드해 Evidence 상세·source·candidate를 수동 확인한다.

**해당 버전 종료 당시 상태:** 1~3과 249개 자동 회귀, 완성 JAR smoke는 완료했다. 4와 원격 CI는 대기 중이었으며 HAR import를 live ZAP 기준선 완료로 계산하지 않는다.

## 0. beta.25 우선순위: 배포 JAR streaming·MR 경로 완결

1. 완성 JAR의 manifest를 `JarFile`뿐 아니라 순차 `JarInputStream`에서도 읽을 수 있게 한다.
2. MR-JAR relocation에서 Java version 숫자 하드코딩을 제거하되 원 package 누출과 실제 versioned class 선택을 자동 검증한다.
3. 완성 artifact 검증을 CI 전용 명령이 아니라 로컬 `mvn clean verify`에도 연결한다.
4. 실제 Burp load/unload와 외부 배포 도구 호환성은 자동 gate와 구분해 수행한다.

**해당 버전 종료 당시 상태:** 1~3과 243개 자동 회귀, 완성 JAR smoke, 반복 SHA-256은 완료했다. 4와 원격 CI는 대기 중이었다.

## 0. beta.24 우선순위: 판정 오라클·게시 경계 하드닝

1. 자원 타입에 맞는 실무형 ID 필드를 인식하되 중첩 자원의 최종 대상만 객체 노출 증거로 쓴다.
2. soft-deny를 오류 봉투로 제한하고 객체·소유자·DataFlow 응답 판독에 공통 크기·깊이·순회 상한을 둔다.
3. 실제 비인증과 지문 추출 실패를 분리하고 미확정 권한을 Judge 정상 대조로 사용하지 않는다.
4. 정책 전체 교체와 계정 갱신을 원자화하고 Burp/Web/MCP 게시 분석을 수집 DTO와 분리한다.
5. 리뷰 주장을 호출 경로와 회귀로 독립 판별해 미재현·의미가 다른 제안은 기각 사유를 기록한다.

**해당 버전 종료 당시 상태:** 1~5와 `mvn clean verify` 243개 회귀는 완료했다. 실제 beta.24 Burp load/unload·SQLite 저장/재열기·3-way/Judge 실행과 블라인드 정확도는 수행하지 않았다.

## 0. beta.23 우선순위: 배포물·CI 하드닝

1. Apache-2.0 의존성의 원 NOTICE와 포함된 제3자 라이선스 텍스트를 fat JAR에 보존하고 프로젝트 고지의 실제 저작물 귀속을 바로잡는다.
2. Jackson·jsoup·SnakeYAML의 base/MR-JAR 클래스를 함께 격리하되 sqlite-jdbc JNI 패키지는 변경하지 않고 다중 classloader 동시 연결을 회귀로 고정한다.
3. `clean verify`가 쓰는 Maven 플러그인과 GitHub Actions를 고정하고, 단일 JAR·MR-JAR·NOTICE·비누출 패키지·Bash/PowerShell·반복 SHA-256을 CI에서 검사한다.
4. 실제 Burp Community에서 beta.23 JAR load/unload와 SQLite 프로젝트 저장·재열기를 확인한다.

**해당 버전 종료 당시 상태:** 1~3은 로컬 코드·패키징·자동 회귀에서 완료했다. 원격 CI와 실제 Burp load/unload·프로젝트 저장/재열기는 실행하지 않았으므로 beta.23 실환경 완료로 계산하지 않는다.

다음은 완료 주장이 아니다.

- 블랙박스 대상의 모든 endpoint·객체·상태 발견
- 오탐·미탐 0
- LLM 서술만으로 취약점 최종 확정
- 자동화 단계 종료 또는 HTTP 상태만으로 점검 충분성 판정

**상태: 목표·비목표·측정 가능한 완료 기준을 README·설계·결정 문서에 동일하게 고정함. 후속 우선순위 작업은 별도 단계다.**

## 0. beta.22 우선순위: 첫 실행 경로 압축

1. 빠른 시작의 여섯 설명과 세 실행기 제어를 네 단계 진행 내비게이션으로 줄인다. → 검증: 기본 노출 panel 1개, 네 단계 직접 이동.
2. scope·HUMAN exact run·ZAP campaign·LLM completed lane/Judge 상태로 첫 미완료 단계를 선택한다. → 검증: 수집 건수만으로 완료하지 않는 Web 계약 회귀.
3. README를 처음 한 번 준비와 점검할 때마다 수행할 네 단계로 분리한다. → 검증: JAR/listener/ZAP/CLI 명령과 상세 가이드 링크 정합성.
4. 데스크톱과 390px 화면에서 단계 라벨·버튼·panel의 가로 잘림이 없는지 확인한다.

**해당 버전 종료 당시 상태:** beta.22 단계형 Web UI와 한영 사용자 문서를 구현했다. 자동 회귀·standalone 반응형 검증 범위까지만 완료로 기록하며, 실제 Burp의 scope/HUMAN/ZAP/LLM 상태 전환은 수동 gate로 남았다.

## 0. beta.21 우선순위: ZAP 배포 중립 온보딩·Windows 재현성과 기존 HUMAN 실환경 gate

1. Release JAR·소스 빌드·완전한 3-way 요구사항을 분리하고 ZAP/LLM을 완전한 흐름의 필수 구성으로 고친다. → 검증: 한영 README와 상세 시작 문서 링크·버전·포트 정합성.
2. ZAP Desktop과 선택형 Docker가 동일한 loopback API 계약을 사용하고 Web에서 실행 전 연결·버전·key 오류를 확인한다. → 검증: 연결 상태 API/UI 계약, 연결 전 캠페인 비활성화, 배포 방식 미추측.
3. macOS/Linux Bash와 Windows PowerShell 7에서 owner-only API key를 독립 생성하고, 선택한 Docker 경로에서는 공식 ZAP 2.17.0 digest 이미지와 Docker-host Burp `8081` upstream을 한 명령으로 준비한다. → 검증: key script, Compose config, ShellCheck, Windows CI parser, macOS 실제 container health/API/version/upstream/add-on 재조회.
4. FlowScope가 기본 `~/.flowscope/zap-api-key`를 링크·권한 검증 후 읽는다. → 검증: 명시 key/환경/key file 우선순위와 file validation 회귀.
5. doctor로 listener, ZAP, add-on, provider CLI, Web/MCP를 점검하되 포트 open만으로 Burp 신원을 증명한다고 주장하지 않는다.
6. 아래의 HUMAN 원문 byte·Evidence UI 실제 Burp gate를 이어서 수행한다.

**해당 버전 종료 당시 상태:** beta.21에 Desktop/Docker 공통 연결 확인 UI와 독립 key helper, 한영 설치 코드·문서, macOS의 공식 ZAP 2.17.0 실제 기동·loopback API/version·Docker→Burp SCANNER `8081` upstream·필수 add-on·doctor, Windows PowerShell helper와 CI parser gate를 구현했다. 실제 ZAP Desktop 수동 설정, Windows 실기기 Docker Desktop target capture, HTTPS, USER A/B, LLM/Judge end-to-end는 이번 setup 검증으로 대체하지 않는다.

## 0. beta.19 우선순위: HUMAN 원문 byte·Evidence UI 실환경 gate

1. live 요청·응답 원문을 프로젝트 모델과 분리된 bounded process-memory vault에만 둔다. → 검증: retain/상한/오래된 항목 제거/clear 회귀와 snapshot 비밀 부재.
2. 사용자가 특정 Evidence를 선택하면 큰 Web 편집기에서 요청과 응답을 나란히 보고 `원문/비로그인/등록 계정`으로 명시 전송한다. → 검증: localhost capability API 계약, Web 문구·모드·전송 결과 회귀.
3. 원 서비스와 exact scope를 고정하고 redirect 금지·TLS 검증·timeout·Content-Length 정합성을 적용한다. 결과는 HUMAN `VALIDATION/CONTROLLED`로 기록해 discovery coverage를 늘리지 않는다. → 검증: 자동 계약과 실제 Burp Community 수동 gate.
4. 초기화·샘플 교체·프로젝트 열기·unload에서 raw vault를 폐기하고, imported/binary/상한 초과 Evidence는 마스킹 폴백을 정직하게 표시한다.
5. 현재 JAR을 재로드한 뒤 실제 HUMAN Evidence에서 비ASCII 원문 byte, ORIGINAL, ANONYMOUS, USER A, USER B 전송의 서버 수신 헤더·응답·Evidence phase·coverage 불변과 binary Repeater fallback을 확인한다.

**해당 버전 종료 당시 상태:** raw byte 정본·strict charset·Evidence ID 상세·라이브러리 외부 반응형 그래프 래퍼와 beta.19의 221개 자동 회귀, standalone 1280px/600px UI 검증 완료. beta.19 JAR의 Burp ORIGINAL/ANONYMOUS/USER A/USER B byte 전송 gate는 남았으며, 통과 전에는 실환경 완료로 표시하지 않는다.

## 0. beta.16 우선순위: HUMAN 요청 시점 문맥과 principal 표현

1. Proxy뿐 아니라 Repeater·Intruder·Target도 요청 시점 HUMAN run/account를 응답까지 보존한다. → 검증: `messageId` correlation·pass 경계 tracker 회귀.
2. 초기화·샘플 교체·프로젝트 열기 전 요청의 늦은 응답이 새 데이터셋에 들어오지 않는다. → 검증: dataset epoch 회귀.
3. 하나의 등록 계정에 연결된 Cookie·Authorization·subject를 여러 세션처럼 표시하지 않는다. → 검증: 권한 카드 principal-kind Web 계약과 계정 화면 artifact projection 회귀.
4. beta.16 JAR을 Burp Community에 재로드해 실제 Browser pass, pass 중 Repeater, pass 종료 뒤 늦은 응답, 초기화 직후 응답, SQLite 저장·재열기를 확인한다.

**해당 버전 종료 당시 상태:** 코드·211개 자동 회귀·단일 배포 JAR 무결성 완료. 실제 beta.16 Burp 수동 gate와 독립 HUMAN fixture confusion matrix는 남아 있었다.

## 0. beta.15 우선순위: rendered scanner 거짓 정상 완료 차단

1. Client Spider status가 완료여도 해당 신원·run의 실제 Client capture가 0이면 AJAX fallback을 실행한다. → 검증: Client status 100/Client capture 0 fixture에서 AJAX 호출과 rendered capture 1.
2. AJAX까지 0이면 Traditional Evidence와 Alert는 보존하되 `COMPLETED_WITH_WARNINGS`로 깨끗한 browser-rendered 기준선과 구분한다. → 검증: raw Traditional 1/Client 0/AJAX 0 fixture와 Web warning 상태 계약.
3. 전체 capture 0 failure, exact scope, fresh session, account credential replacement, Active Scan 별도 승인은 바꾸지 않는다.
4. beta.15 JAR을 Burp Community에 재로드한 뒤 실제 crAPI에서 Client→AJAX 전환·stage count·경고를 확인한다. 이후에만 LLM Explorer 실제 세션 검증으로 넘어간다.

**해당 버전 종료 당시 상태:** 코드·207개 자동 회귀·배포 JAR 무결성 완료. 실제 beta.15 anonymous crAPI 실행에서 Client→AJAX fallback 뒤 전체 226건(Traditional 8, Rendered 218)과 native Alert 30건, warning-completed 상태를 관측했다. 이 수치는 endpoint 충분성이나 취약점 탐지 성능으로 해석하지 않는다.

## 0. beta.14 우선순위: ZAP 완료 판정과 단계 관측 정합성

1. ZAP 완료 gate는 비동기 분석 snapshot이 아니라 응답 callback 직후 raw capture를 센다. → 검증: snapshot 0건/raw counter 1건 fixture가 `COMPLETED`.
2. 신원별 Traditional과 Client/AJAX rendered-browser capture를 분리한다. → 검증: stage별 sourceDetail fixture와 JSON count.
3. 레인 진행 상태가 `PENDING → TRADITIONAL → CLIENT/AJAX → PASSIVE → ALERTS_READY/FAILED`로 보인다. → 검증: Web 카드 계약과 기존 캠페인 failure/completion 회귀.
4. zero-capture, exact scope, fresh session, account credential replacement, Active Scan 별도 승인은 그대로 유지한다.

**해당 버전 종료 당시 상태:** 구현, 206개 자동 회귀 완료. 실제 ZAP 2.17 + Burp Community beta.14에서 raw Traditional count는 확인했지만 Client 내부 browser 실패가 status 100으로 숨고 rendered capture가 0인 결함을 발견해 beta.15가 완료 gate를 보강했다. USER A/B 세션 주입과 late-response 경계는 남아 있었다.

## 0. beta.13 우선순위: HUMAN 실행 정합성과 범용 구조 프로파일링

1. HUMAN `pass 완료`는 record 수가 아니라 exact exploration run 종료로만 판정한다. → 검증: idle/begin/end/rebegin의 `completed=false/false/true/false`.
2. HUMAN 실행 상태를 scanner/LLM과 같은 주기로 갱신한다. → 검증: Web timer 계약과 실제 로컬 화면의 `진행 중 → pass 완료` 전이.
3. pass 안의 Repeater·Intruder·Target은 run/phase/account를 상속하되 실제 Burp provenance를 유지한다. → 검증: detail/tool 회귀.
4. target별 사전 없이 `*Id` 외 도메인 식별자를 찾되 동일 service·method·path·field 위치의 복수 값으로만 보강한다. → 검증: `customerNo/documentSeq/accountRef` 양성 fixture와 단일 관측·`pageNo/sortKey/apiKey/statusCode` 음성 fixture.
5. 이 구조 파악을 소유권·취약점 확정으로 확대하지 않는다. → 검증: 기존 primary 하나·Cartesian product 금지·전체 인가/분류 회귀 유지.

**해당 버전 종료 당시 상태:** 구현, 204개 자동 회귀, standalone HUMAN 시작·종료 상태 전이 확인 완료. 실제 Burp Browser/Repeater/Intruder provenance와 다양한 블라인드 대상의 semantic field precision/recall 측정은 남아 있었다.

## 0. beta.12 우선순위: 세션 귀속과 HUMAN 그래프 표시 정합성

1. 같은 서비스의 인증 지문 하나를 두 등록 계정에 동시에 귀속하지 않는다. → 검증: 두 번째 binding 거부, 충돌 세션 `SUSPECT`, 신원 조회·주입 제외.
2. 같은 요청자·객체·source의 접근선은 표시에서만 집계한다. → 검증: 한 집계선에 원 CoverageCell 키와 총 관측 수를 유지하고 분석 cell 수는 불변.
3. 집계선을 클릭해 원 operation별 관측·판정·갭·Evidence로 돌아갈 수 있어야 한다. → 검증: Web 계약과 standalone 상호작용.
4. 긴 operation/resource 라벨은 생략하지 않고 줄바꿈·동적 높이로 표시한다. → 검증: 전체 경로 표시와 브라우저 렌더에서 글자 잘림 없음.
5. graph-state 키를 v4로 올려 이전 수동 위치가 새 노드 크기와 접근 lane을 왜곡하지 않게 한다.

beta.11의 source 전체 접근 경로 필터와 아래 원칙은 그대로 유지한다.

1. source 필터가 단순 스타일 토글이 아니라 해당 source의 node와 전체 접근 경로를 함께 재계산한다. → 검증: HUMAN-only 선택에서 SCANNER/LLM 전용 node·edge 0.
2. 실제 메인 비교 Evidence가 0건인 source는 0건과 비활성 상태를 함께 표시한다. → 검증: 빈 SCANNER/LLM 데이터에서 조작 가능한 것처럼 보이지 않음.
3. `identity → resource`와 `resource → operation` 모두 같은 source 색·선형·문자를 사용한다. → 검증: 경로 중간에 출처 없는 중립 접근선이 남지 않음.
4. 응답→요청 값 전달은 메인 접근 그래프에서 제거하고 `흐름 순서`에만 둔다. → 검증: 메인 graph의 flow edge 0, 기존 sequence 데이터 유지.
5. 역할 정책은 그래프에서 임의 순환하지 않고 계정 역할·API 요구 권한의 현재 상태만 요약한다. → 검증: 역할 변경은 계정·세션/API 상세이라는 명시적 문맥에서만 가능.

beta.10의 계정 중심 세션 표현과 로컬 SQLite 저장은 그대로 유지한다.

## 0-A. beta.10 계정·저장 기준

1. 한 테스트 계정을 Cookie·Authorization·subject별 별도 사용자처럼 표시하지 않는다. → 검증: 세 fingerprint가 한 account ID로 projection되고 기본 화면은 계정 카드 하나.
2. broker 상태를 내부 enum이 아닌 `로그인 필요/확인 중/사용 가능/다시 로그인 필요`와 다음 행동으로 설명한다. → 검증: Web 정적 계약과 브라우저 상호작용.
3. 기본 프로젝트 저장을 로컬 SQLite로 전환하되 raw 인증값 금지와 schema v2 검증을 유지한다. → 검증: DB header·관계형 row·round-trip·비밀 문자열 부재.
4. DB를 한 번 저장/열면 변경 revision을 30초 checkpoint로 합쳐 자동 저장하고 JSON을 호환 형식으로 남긴다. → 검증: 저장/로드 회귀와 실제 Burp unload/reload gate.
5. SQLite를 서버 event store로 과장하지 않는다. 현재 메모리 20,000건 상한과 100MiB project 상한은 유지하고, append/event migration은 실제 부하 측정 뒤 결정한다.

beta.9의 HUMAN 경로 묶음 정확도와 아래 원칙은 그대로 유지한다.

1. beta.8의 `identity → resource → operation` UI와 조작을 유지한다. → 검증: 기존 Web 계약과 실제 화면 회귀.
2. raw path와 canonical operation을 분리한다. → 검증: `/orders/101` 원문이 상세에 남고 근거가 있을 때만 `/orders/{id}`로 정렬.
3. template 상태를 `LITERAL/INFERRED/CORROBORATED` 범주형 근거로 노출한다. → 검증: `/status/200` 단일 관측은 literal, UUID·복수 값은 inferred, 응답 ID 일치는 corroborated.
4. 객체 후보와 operation template을 분리한다. → 검증: template 근거가 부족한 단일 객체 요청도 resource와 인가 분석에서 사라지지 않음.
5. 기존 coverage/gap/BOLA/BFLA 산출의 회귀를 막는다. → 검증: 기존 전체 테스트와 신규 route corpus를 함께 통과.

후속 route oracle(OpenAPI 등)과 인증 우회·순서 우회·상태 전이·중복 실행·method 변형·민감 기능·Mass Assignment·과도한 데이터·rate-limit 분석은 이 기본 좌표의 독립 모듈이다. beta.9의 경로 묶음 회귀와 beta.10의 계정 projection·저장 gate를 깨면서 근거 없는 가중치나 취약점 자동 확정 규칙을 추가하지 않는다.

이 계획은 `whs_flow` 화면을 실제 제품 작업면으로 채택한다는 결정과 FlowScope의 기존 수집·분석·MCP 신뢰 경계를 함께 만족시키도록 다시 검토한 실행 기준이다. 성공 기준은 “화면이 보임”이 아니라 실제 Evidence가 끝까지 보존되고, 거짓 자동화 없이 재현 가능하며, 공개 JAR 하나로 설치되는 것이다.

## 1. 계획 검토에서 바로잡은 전제

1. `jdk.httpserver`를 새로 쓰지 않는다. Burp Community의 축소 런타임에서 해당 모듈을 보장할 수 없으므로 기존 `LoopbackHttpServer`를 Web UI에도 재사용한다.
2. Montoya가 보장하지 않는 Repeater 결과 자동 상관을 완료 기능으로 쓰지 않는다. 저장된 마스킹 요청은 미전송 초안으로만 열고, 자동 최종 판정에는 FlowScope 통제 실행기가 별도 VALIDATION run으로 캡처한 `CONTROLLED` Evidence만 사용한다. 직접 8082 관측은 폴백이며 결정적 판정에 쓰지 않는다.
3. 비교 UI의 자동 principal/HMAC 계정 식별 주장을 가져오지 않는다. 계정은 비밀 없는 표시 정보만 저장하고 `(service, fingerprint)` 연결은 사용자가 확정한다.
4. 객체 ID가 없는 엔드포인트에 가짜 resource를 만들지 않는다. 이 경우 그래프는 identity에서 operation으로 직접 연결하고 BFLA는 명시적 역할 정책으로 분석한다.
5. 일반 LLM assessment는 `LIKELY / INCONCLUSIVE / REJECTED`만 제출한다. 최종 `CONFIRMED / INCONCLUSIVE / REJECTED`는 서버가 현재 후보와 원본/반복 재현/정상 대조 Evidence 집합을 검증한 경우에만 저장한다. 사람 판정은 감사·오버라이드 기록이다.
6. 2만 건 전체의 Request/Response를 매초 전송하지 않는다. snapshot은 메타데이터만, 전문은 선택 시 지연 로드한다.
7. crAPI 정답을 코드나 프롬프트에 넣지 않는다. 제품 완료 뒤 독립 HUMAN/ZAP/LLM pass와 블라인드 채점으로 검증한다.
8. LLM에게 ZAP 기능 선택을 맡기지 않는다. 기본 scanner lane은 Traditional Spider, strict Client Spider, AJAX 보완, 진행 기반 Passive drain, native Alert 순서의 시스템 workflow다.
9. Explorer의 독립성은 프롬프트 약속이 아니라 서버 가시성 제한과 세 레인 dataset lock으로 강제한다.
10. 트래픽 노이즈는 수집 단계에서 삭제하지 않는다. 모든 Evidence를 보존하고 결정론 분류로 `INCLUDE/REVIEW/EXCLUDE`를 나누며, 메인 coverage에는 `INCLUDE`만 넣고 사용자가 operation 단위로 되돌릴 수 있게 한다.
11. 관측된 조합의 `UNCROSSED`와 아직 요청하지 않은 route candidate를 섞지 않는다. 전자는 현재 Evidence에서 계산하는 사실이고, 후자는 in-scope 응답이나 Burp Site Map에 정확한 provenance가 있는 탐색 후보다.
12. 후보 우선순위에 임의 숫자 가중치를 먼저 넣지 않는다. 검증된 규격 신호와 provenance를 범주형으로 보존하고, 고정된 라벨 corpus와 블라인드 결과가 생긴 뒤에만 수치 점수의 필요성과 calibration을 판단한다.
13. LLM 버튼 자동화는 공급자 API/OAuth를 내장하지 않는다. 사용자의 로컬 로그인 Codex/Claude CLI를 새 프로세스로 실행하되 Explorer는 비영속·no-resume, Judge는 별도 새 세션·명시적 resume로 분리한다. CLI 0 종료만 완료로 믿지 않고 MCP run 종료와 dataset lock을 서버 상태로 확인한다.

## 2. 구현 단계와 성공 기준

### P0 — 정본·경계 고정

- Web UI를 그래프/매트릭스/상세의 유일한 정본으로 고정한다.
- Burp 탭은 scope, 포트, 프로젝트, MCP, Web 열기만 담당한다.
- HUMAN/SCANNER/LLM source와 orchestrator를 분리한다.
- 성공 기준: 문서·코드·UI 어디에도 이중 그래프, 검증 없는 LLM 확정, Repeater 자동 상관이라는 상충 주장이 없다.

### P1 — localhost Web 제품면

- `whs_flow` 정보 구조와 시각 문법을 그대로 활용해 그래프, 매트릭스, 흐름 순서, 시나리오, 파싱 결과, 계정·세션 화면을 제공한다.
- Cytoscape.js는 JAR에 vendoring하고 네트워크 CDN 의존성을 없앤다.
- Host/Origin/capability/CSP/no-store/frame 보호와 25MiB XML·1MiB form 상한을 적용한다.
- 긴 endpoint/service/Evidence는 줄바꿈·스크롤·전체 텍스트 상세로 확인 가능하게 한다.
- 성공 기준: 샘플에서 여섯 모드와 우측 상세가 동작하고, 잘린 값도 상세에서 전부 읽을 수 있으며, 잘못된 capability/origin/method가 거부된다.

### P2 — Evidence·정책·세션 작업

- 선택 API의 마스킹 Request/Response를 200건 단위로 지연 로드해 전부 탐색할 수 있게 한다.
- 등록 계정, 서비스 경계 세션 연결/해제, identity role, endpoint requirement, resource owner를 UI에서 수정한다.
- rule finding, MCP assessment, 서버 검증 최종 판정을 같은 시나리오 화면에 두고 사람 감사·오버라이드를 저장한다.
- Repeater는 첫 Evidence의 마스킹된 미전송 초안만 연다.
- HTTP 문맥 기반 비파괴 traffic classification, captured/coverage 통계, operation별 override, 반복 Evidence 표시 접기를 제공한다. cookie 회전은 검증된 account binding 전까지 서비스별 `UNRESOLVED` graph identity로 안정화한다.
- 사용자가 명시적으로 시작한 HUMAN 로그인 캡처만 memory-only broker에 넣고, service+scope+ACTIVE 상태가 맞는 계정에 한해 ZAP/LLM에 주입한다. raw 값은 project/Web/MCP에 저장·노출하지 않는다.
- 성공 기준: 비밀번호·raw token을 저장/표시하지 않고, 다른 service의 세션 연결은 실패하며, Evidence 집합이 바뀐 과거 판정은 승계되지 않는다.

### P3 — 공개 배포 정리

- JGraphX 코드·의존·고지를 공개 정본에서 제거하고 이전 구현은 `.local/archive/`에만 보존한다.
- Cytoscape.js/Jackson/SnakeYAML/jsoup/sqlite-jdbc/FlowScope 라이선스와 Apache NOTICE를 JAR에 동봉한다.
- README, architecture, decisions, changelog, agent workspace의 실제 UI 경로와 버전을 맞춘다.
- 성공 기준: fresh `mvn clean verify`, fat JAR manifest/의존/라이선스 검사, 절대경로·비밀·불필요 산출물 검사를 통과한다.

### P4 — 실제 UI·Burp QA

- standalone Web UI를 데스크톱 브라우저에서 1500×900과 좁은 폭으로 확인한다.
- 그래프 필터, 노드 펼치기, Matrix, 시나리오, 계정/세션, Request/Response, sample/reset을 클릭 검증한다.
- Burp Community에서 JAR load/unload, 3개 listener 수집, Proxy history, Repeater handoff, project round trip, MCP 연결을 검증한다.
- 실제 로그인으로 USER A/B를 ACTIVE로 만든 뒤 비로그인→USER A→USER B ZAP fresh-session campaign, 신원별 수집/Alert, LLM account 주입을 검증한다.
- Web 버튼으로 Codex와 Claude 각각 새 Explorer → exact run 종료 → 별도 Judge lock → 같은 Judge 후속 resume를 실행하고, Explorer 대화가 Judge에 재사용되지 않으며 MCP 밖 네트워크 도구가 제공되지 않는지 확인한다.
- 성공 기준: 브라우저 콘솔 오류 0, 잘린 핵심 조작 0, unload 후 포트 해제, 세 source가 실제 포트대로 분리된다.

### P4-H — HUMAN/Burp 그래프 핵심 교정 (SCANNER·LLM 동결)

이 단계는 P5 전에 먼저 끝낸다. 목표는 “요청을 많이 저장함”이 아니라, 실제 사람이 밟은 business operation과 응답에서 발견한 미요청 후보를 섞지 않고 IDA식 그래프에서 추적 가능하게 만드는 것이다.

#### H0. beta.3 기준선과 검증 기록 교정

- beta.3의 `TrafficClassifier.VERSION=2`는 `application/manifest+json`을 일반 `+json` API로 포함했다. 당시 crAPI 익명 스모크의 HUMAN/SCANNER/LLM `INCLUDE`는 모두 `/manifest.json`이므로 business API 탐색 성공으로 인정하지 않는다.
- 8080 HUMAN 스모크는 Burp Browser가 아니라 `curl`을 HUMAN listener에 연결한 전송 확인이었다. `sourceDetail=BROWSER`는 listener profile에서 붙은 provenance이지 실제 브라우저 사용 증명이 아니다.
- beta.3의 `UNCROSSED`는 관측 identity × 관측 operation/resource 중 확정 owner가 있는 미실행 cell만 계산했고 미관측 endpoint inventory는 없었다.
- beta.3 Web snapshot은 추출된 모든 object candidate에 근거 계산 없이 `confidence=1.0`을 넣고 UI는 이를 `신뢰도 100%`로 표시했다. beta.4에서는 H4의 추출 근거 표시로 교체한다.
- 성공 기준: README, 결정 로그, 검증 기록과 개발 계획이 이 경계를 동일하게 말하고, 기존 JAR의 성능을 소급 과장하지 않는다.

#### H1. 분류기 v4 — 규격 신호 기반 결정론 cascade

먼저 일반 목적 라벨 fixture를 작성하고 실패를 재현한 뒤 최소 규칙으로 수정한다. target 이름이나 crAPI path는 규칙에 넣지 않는다.

1. scope, response 존재, source, HUMAN phase 같은 변경 불가능한 discovery gate를 먼저 적용한다.
2. CORS preflight, document/navigation, script/style/image/font, web app manifest, source map, service worker 같은 브라우저 보조 관측은 Evidence를 삭제하지 않고 `DISCOVERY_METADATA` 또는 기존 비분석 class로 분리한다. 이 데이터는 business graph에는 들어가지 않지만 route candidate 추출에는 사용할 수 있다.
3. 명시적 GraphQL/gRPC/protobuf, unsafe business request, Fetch destination `empty`와 API representation의 합치처럼 강한 API 신호만 `INCLUDE`한다.
4. 같은 정규화 operation의 다른 관측에 강한 API Evidence가 있으면 그 교차 관측을 보조 신호로 사용한다. 충돌하거나 보안 관련성이 있으나 용도가 불명확하면 삭제하지 않고 `REVIEW`에 둔다.
5. operation 단위 사용자 override는 유지하되, override 전후 reason과 영향 record 수를 표시한다.

필수 fixture는 실제 browser document, JSON fetch API, `text/plain` API, GraphQL variables, nested/array object ID, multipart, authenticated image API, 일반 image, CSS/JS/font, source map, web manifest, service worker, CORS preflight, 일반 OPTIONS, redirect, 401/403, 응답 없는 요청을 포함한다.

성공 기준:

- web manifest·명확한 정적 자원·진짜 preflight가 business `INCLUDE`가 되는 알려진 회귀가 0이다.
- JSON이 아닌 API와 객체를 다루는 정적 경로가 단순 확장자 때문에 사라지는 알려진 회귀가 0이다.
- 모든 분류 결과에 machine-readable reason이 있고 원 Evidence는 그대로 남는다.
- fixture confusion matrix와 `REVIEW` 작업량을 공개한다. 오탐·미탐 0이나 근거 없는 정밀도 목표값은 주장하지 않는다.

#### H2. Route Candidate Inventory — 관측과 후보를 분리

**현재 상태: beta.37은 기존 공통 코어·source/run 격리·Session Broker·ZAP 안전 기준선·독립 Explorer/Judge·Evidence 판정 경계를 유지하면서 Explorer account 고정, browser 실제 request 단위 write 승인, runtime route replay gate, `GraphObservationFact`, 사이트/API/객체 계층 투영과 객체 family 접기를 추가했다. 실제 beta.37 Burp 3-way 저장·재열기, HTTPS/broker browser 통합, 고카디널리티 그래프 가독성, 20,000건 polling/RSS와 블라인드 target 검증은 대기 중이다.**

새 모델은 최소한 다음을 보존한다.

```text
RouteCandidate {
  service, methodOrUnknown, pathTemplate,
  provenance[{type, evidenceId, source, runId, adapter, applicability, reason}],
  observed, applicability, reviewReason
}
```

후보 입력은 사용자가 허가한 exact scope 안에서 실제로 받은 데이터만 사용한다.

- Burp Montoya `siteMap().requestResponses(filter)`의 in-scope 항목. `hasResponse=false`인 항목은 관측 요청으로 승격하지 않고 `BURP_UNREQUESTED` 후보로만 저장한다.
- 관측 HTML의 `a[href]`, `form[action/method]`, script/embed/manifest link와 같은 명시적 URL 참조. 깨진 HTML과 `<base>`는 HTML5 DOM 규칙으로 처리한다.
- 관측 응답의 same-scope `Location`과 표준 sitemap/robots/web manifest 항목.
- 관측 JavaScript의 `fetch`/XHR/axios/jQuery/sendBeacon 명시적 URL literal. 문자열 조합·동적 계산은 추측하지 않는다.
- 대상 내부에서 실제로 관측된 OpenAPI/Swagger JSON·YAML 문서만 사용한다. 외부 검색, Wayback, 저장소, 사전 정답은 사용하지 않는다.
- 제품명에 종속되지 않은 XML의 명시 URL/method attribute·element만 읽는다. DOCTYPE·외부 entity·외부 DTD/schema는 차단한다.

포맷별 어댑터는 발견만 하고, 공통 코어가 exact scope·지원 scheme·method token·정규화·dedup을 단독 집행한다. URL만 있고 method 근거가 없으면 `GET`으로 꾸미지 않고 `UNKNOWN`으로 둔다. 후보 dedup key는 service + method/unknown + normalized path이고, 각 provenance는 Evidence ID뿐 아니라 source·run·adapter 대응을 유지한다.

성공 기준: 모든 후보를 클릭해 “어느 응답/어느 Site Map 항목에서 나왔는지” 확인할 수 있고, provenance 없는 후보는 0이며, 후보가 coverage·finding·dataset lane 완료를 증가시키지 않는다.

#### H3. 그래프·갭 표현

- 실제 HUMAN 요청은 기존 파랑·실선으로 유지한다.
- 아직 요청하지 않은 후보는 source edge로 위장하지 않고 중립색 빈 노드·점선 테두리로 표시한다. `미요청 후보` 필터에서만 켜고 끌 수 있게 한다.
- `REVIEW`는 분류 보류, `미요청 후보`는 아직 request/response가 없는 공격면 후보이므로 서로 다른 상태와 개수로 표시한다.
- 기존 `UNCROSSED`는 이름과 계산을 유지한다. 별도 `UNOBSERVED_ROUTE`는 candidate inventory 중 observed operation으로 매칭되지 않은 항목만 표시한다.
- candidate를 눌러 Burp Browser로 열거나 Repeater 초안을 만드는 동작은 자동 전송하지 않으며, 사용자가 요청해 실제 response가 들어온 뒤에만 observed로 전환한다.

성공 기준: 한 화면에서 observed/candidate/review를 혼동하지 않고, 빈 후보를 취약점·미탐 확정으로 표현하지 않으며, Request/Response 없는 노드가 인가 verdict를 갖지 않는다.

#### H4. 객체 적용 가능성·가중치 경계

- 전체 identity × 전체 resource의 단순 곱을 만들지 않는다. operation마다 실제 path/query/body/schema Evidence로 접근 가능한 `R(o)`만 연결한다.
- `C_total = Σ |I|·|R(o)|`는 `R(o)`가 Evidence로 확인된 경우에만 연구용 후보 공간으로 계산한다. route 후보만 있고 객체 적용 가능성이 불명확하면 객체 조합을 생성하지 않는다.
- 우선순위 1차판은 임의 숫자 합산이 아니라 설명 가능한 사전식 정렬이다: 명시적 method·object reference·authorization 관련 응답·복수 독립 provenance·state-changing 여부. 각 항목은 원 Evidence를 가리킨다.
- 숫자 가중치는 고정 corpus와 블라인드 benchmark에서 feature별 precision/recall 및 review 비용을 측정하고, 동일 데이터로 규칙을 만들고 성능을 주장하는 누수를 막은 뒤에만 별도 결정한다.

성공 기준: 후보 정렬 이유를 사람이 읽을 수 있고, 검증되지 않은 object cross-product와 임의 confidence 퍼센트가 없다. 현재 object candidate의 고정 `신뢰도 100%`도 제거하고 `PATH_ID/QUERY_ID/BODY_ID/GRAPHQL_VARIABLE/USER_CONFIRMED` 같은 추출 근거로 대체한다.

#### H5. 검증 순서

1. protocol fixture 회귀 → 분류 결과와 candidate truth set 대조.
2. 실제 Burp Browser HUMAN pass → Fetch Metadata가 있는 요청과 없는 요청을 모두 저장해 listener label과 실제 browser 동작을 구분.
3. 일반 local MPA, SPA, GraphQL fixture → route candidate precision/recall, API 분류 confusion matrix, REVIEW 건수·승격률, graph node 감소량을 기록.
4. fresh project save/load → candidate provenance와 override 왕복, raw credential 부재 확인.
5. 위 gate가 끝난 뒤에만 P5 crAPI 블라인드 benchmark를 시작하며 정답은 lock 이후 확인.

중단 조건은 provenance 없는 candidate 생성, protocol fixture 회귀, 후보의 coverage/finding 오염, 실제 Burp Browser에서 재현되지 않는 자동 테스트 통과다. 이 경우 임의 예외를 더하지 않고 원인을 고친다.

### P5 — crAPI 블라인드 벤치마크

- 정답 목록을 보지 않은 상태에서 새 프로젝트로 시작한다.
- HUMAN, 시스템 ZAP, LLM Explorer를 독립 수행하고 dataset을 잠근 뒤에만 Judge가 cross-source Evidence를 읽는다.
- 각 후보는 Evidence ID, 재현 절차, 관측 source, 서버 검증 verdict를 먼저 고정한 뒤 라벨 정답과 독립적으로 채점한다. 사람은 애매한 케이스를 사후 판정하되 제품 verdict를 소급 변경하지 않는다.
- 정답 대조는 모든 pass와 판정이 잠긴 뒤 별도 단계에서만 수행한다.
- 성공 기준: 소스별 고유/중복 발견, false positive, unresolved, 준비·실행 시간을 재현 가능한 보고서로 남긴다. 커버리지 퍼센트는 알려진 벤치마크 정답 집합에 대한 사후 평가에서만 사용하고 제품의 블랙박스 화면에는 표시하지 않는다.

## 3. 완료 정의

- 루트 공개 소스만으로 `mvn clean verify`와 단일 JAR 생성이 된다.
- Burp Community에서 설치·수집·Web 열기·MCP·Repeater handoff·저장/복구가 실제로 동작한다.
- HUMAN/SCANNER/LLM을 필터링하고 중복·부분 발견·불일치·미교차를 같은 데이터셋에서 읽을 수 있다.
- Request/Response와 판정 근거를 Evidence ID로 추적할 수 있다.
- 도구가 하지 않은 요청, 응답, 신원, 소유자, 취약점 확정을 UI나 문서가 했다고 주장하지 않는다.

## 4. 2026-08-26 beta.6 구현 상태

- P4-H H1: classifier v3가 web manifest·source map·service worker를 `DISCOVERY_METADATA/EXCLUDE`로 분리하고, 같은 service·정규화 operation의 강한 API Evidence로만 immutable discovery gate를 통과한 `REVIEW` 형제 관측을 보강한다. manifest·다른 service·응답 없음 회귀와 보조 metadata fixture를 자동 테스트로 고정했다. 공개 confusion matrix와 실제 Burp Browser corpus 평가는 남아 있다.
- P4-H H2: `RouteCandidate`와 공통 discovery pipeline을 추가했다. exact-scope HTML5 DOM, 표준 metadata, 정적 JS call site, OpenAPI/Swagger JSON·YAML, generic XML, 응답 없는 Burp Site Map item을 같은 core gate로 정규화·병합하며 provenance의 source/run/adapter 대응을 저장·복구한다. 문자열 조합과 범위 밖 참조는 후보로 만들지 않는다. 일반 protocol fixture 7종·truth route 18개 회귀는 TP 18/FP 0/FN 0이지만 이는 대상 성능 수치가 아니다. Community의 실제 Site Map 미응답 item과 blind target 결과는 수동 gate다.
- P4-H H2 visibility: provenance별 applicability/reason을 보존하고 Explorer MCP에는 현재 LLM run view만 재계산해 제공한다. pre-lock cross-lane status/ZAP/판정 조회를 차단하고 lock 시 route inventory도 고정한다. 실제 구독 클라이언트와 worker 경합은 수동 gate다.
- P4-H H3: Web graph에 source edge 없는 중립색·점선 테두리 후보와 전용 수량·필터·상세를 추가했다. `REVIEW`, `UNCROSSED`, 미요청 route를 서로 다른 상태로 설명하며 candidate는 coverage·gap·verdict·finding·lane 완료를 바꾸지 않는다. standalone 1280×720·600×800에서 overflow와 console 오류 0을 확인했지만 실제 candidate가 있는 Burp 화면은 수동 확인이 남았다.
- P4-H H4: object의 고정 `신뢰도 100%`를 `PATH_ID/QUERY_ID/BODY_ID/GRAPHQL_VARIABLE/DERIVED/NONE` 근거로 교체했다. route 후보는 적용 가능성 → 명시 method → 객체 template → 상태 변경 → 복수 provenance의 범주형 사전식 순서를 쓰고 이유를 화면에 노출한다. authorization 관련 응답 신호는 미요청 candidate에 아직 연결하지 않으며, 수치 가중치는 benchmark 전까지 도입하지 않는다.
- beta.6 자동 검증: 최종 `mvn clean verify` 수치와 JAR digest는 `beta-validation.md`와 `development-log.md`에 기록한다. 고정 corpus와 fat-JAR parser smoke, MCP run visibility 회귀는 공통 파이프라인·격리·패키징 검증이며 Burp Community 재로드나 blind target 성능을 대신하지 않는다.

- P0~P3: 코드 구현 완료. Web UI 정본화, exact-scope 수집 차단, 구조적 마스킹, memory-only session broker, 통제 LLM 실행, Explorer 서버 격리, dataset lock, 신원별 fresh-session 시스템 ZAP campaign, 서버 검증 LLM verdict를 구현했다.
- P4 브라우저 QA: 기존 beta.3 standalone UI의 1500×900, 900×700, 600×800, 1024×768, 1280×720 검증은 통과했다. 이번 scanner control도 1280×720·600×800에서 비로그인 선택, 가로 overflow 0, 좁은 폭 modal scroll, 신원/target 미선택 버튼 비활성, warning/error 0을 확인했다. Standalone fixture에는 ACTIVE broker 계정이 없어 USER A/B 복수 chip 렌더는 HTML/API 계약까지만 통과했으며, Standalone 검증은 Burp suite tab 검증을 대신하지 않는다.
- P4 Burp Community QA: 당시 beta.3 fat JAR을 Community 2026.7.3에 로드해 suite tab, Web UI 17777, MCP 8787, HUMAN 8080, SCANNER 8081을 실제 기동했다. exact scope `http://127.0.0.1:8888/`에서 HUMAN listener 8080 전송 3건, ZAP 2.17 SYSTEM baseline 8건, MCP LLM Explorer 통제 요청 1건이 각각 HUMAN/SCANNER/LLM으로 분리됐다. 이 HUMAN 전송은 실제 Burp Browser가 아니라 8080을 프록시로 사용한 `curl` 스모크였다. ZAP 8건은 모두 `CONTROLLED/ANONYMOUS`였고 LLM의 범위 밖 FlowScope Web 요청은 거부됐다. `REVIEW`뿐인 HUMAN lane에서는 lock이 거부됐고 classifier v2가 web manifest를 `API/INCLUDE`로 오분류한 `/manifest.json`을 추가한 뒤 12건을 잠갔다. 따라서 이 결과는 포트 분리·lock·scope guard의 wiring 검증이지 HUMAN business API 탐색이나 분류 품질 검증이 아니다. finding·gap 0과 잠금 뒤 Explorer 재시작 거부는 관측 사실 그대로 유지한다.
- beta.6 잔여 수동 gate: 새 JAR의 Burp Community 재로드와 Site Map candidate, 실제 Burp Browser HUMAN pass, 브라우저 `UNVERIFIED→ACTIVE` 실제 로그인, USER A/B broker 주입과 복수 ZAP lane, 구독형 Codex/Claude prompt 전체와 Judge, Repeater handoff, project save/load, extension unload 후 포트 해제를 확인해야 한다. beta.3에서 통과한 packaging·익명 3-source 연결·MCP protocol·가시성 격리·범위 차단을 새 JAR의 실검증으로 소급하지 않는다.
- HUMAN 탐색 경계: HUMAN pass의 시작·종료와 `EXPLORATION` run ID 상태 전이는 8080 `curl` 스모크로 확인했다. 실제 Burp Browser 탐색은 미검증이다. 로그인 캡처 `SESSION_SETUP`, pass 밖 `BASELINE`, 선택 ACTIVE 계정의 exact credential match는 자동 회귀를 통과했으며 실제 로그인 계정으로 재확인해야 한다.
- 분류 경계: `REVIEW`를 Evidence·검토 대기에 보존하면서 메인 graph·3-way gap 입력에서는 보류하고, UI 처분 필터와 수량을 `INCLUDE/REVIEW/EXCLUDE`로 분리했다. 1280×720 standalone의 필터·상세·overflow·console 검증은 통과했고, 실제 Burp 대상에서 REVIEW 승격·숨김 작업량은 beta gate와 blind benchmark에서 측정해야 한다.
- 판정 경계: 거부/HEAD owner 오염, auth 부분문자열 redirect 오탐, owner-only 객체 Evidence를 차단했다. 불충분한 BOLA read 응답은 안전으로 폐기하지 않고 `UNDECIDED/INCONCLUSIVE`에 남긴다. 자동 회귀는 통과했으며 실제 Judge workflow는 beta gate다.
- P5 crAPI 블라인드 벤치마크: 사용자 검토 전까지 보류한다. 정답·공격 절차·라벨을 코드, 프롬프트, 실행 컨텍스트에 넣지 않는다.

## 5. 2026-08-27 beta.7 구현 상태

- Web 빠른 시작에 Codex/Claude 공급자, exact target, ACTIVE 계정, `LLM Explorer 시작`, `Judge 시작`, 취소, `Judge 계속`을 추가했다. LLM 사용자는 버튼만으로 실행할 수 있고 기존 `agent-workspace` 절차는 환경 호환 수동 폴백이다.
- Explorer는 전용 owner-only 임시 작업공간과 새 비영속 프로세스를 사용한다. Codex는 ephemeral·read-only·no-approval·user-config 무시·웹 검색 비활성화·모델 shell MCP token 제외, Claude는 strict 임시 MCP 설정·빈 setting sources·auto-memory 비활성화·제한 도구·no-persistence를 적용한다. FlowScope가 exact LLM run을 먼저 발급하고 모델이 동일 run을 끝내지 않으면 완료 레인을 열지 않고 abort한다.
- Judge는 Explorer와 분리된 새 provider session이다. 잠긴 3-lane dataset을 실제 MCP 상태로 확인해야 성공하며, 완료 뒤 저장한 Codex thread ID 또는 Claude session ID로만 후속 요청을 resume한다. 장기 실행 terminal을 유지하는 구조는 아니다.
- MCP 토큰은 자식 환경에만 전달하고 command line·prompt·project에 포함하지 않는다. 상속된 OpenAI·Anthropic API key는 제거한다. CLI는 shell 없이 regular executable 경로로 실행하고, 임시 workspace와 출력은 각각 안전한 경로 삭제·마스킹/상한을 적용한다. 긴 Codex 출력에서도 시작부 session ID를 보존하고 취소·Burp unload 직후 늦게 생성된 child를 즉시 종료하는 회귀를 추가했다.
- active run 또는 Judge lock 상태에서 Burp UI scope 변경을 거부한다. 같은 source 재탐색 시작 시 과거 완료 표식을 무효화하고 세 레인이 다시 완료될 때까지 Judge UI·서버 lock을 닫아 부분 재실행 오염을 차단했다.
- Claude의 `--no-session-persistence`가 일부 버전에서 metadata를 남길 수 있는 한계는 삭제로 위장하지 않는다. Explorer는 그 ID를 저장·resume하지 않고 UI에서 잔존 가능성을 경고한다.
- 자동 검증은 실행 인자, fresh/no-resume, exact run 종료 실패, 3-lane/lock gate, inactive account 차단, Claude Judge resume, 긴 Codex 출력의 session ID, Web API와 scope 변경 차단을 다룬다. 실제 구독 로그인 상태의 Codex/Claude, Burp MCP 왕복, 대상 요청, Judge 후속 resume는 beta.7 JAR 재로드 후 수동 gate다.

## 6. 2026-08-27 beta.8 HUMAN 핵심 1~5단계 상태

1. **수집 계약:** 마스킹된 textual 요청·응답 전문을 메시지당 기본 1MiB, digest 중복 제거 후 압축 총량 48MiB까지 보존하고 8KiB preview와 분리했다. binary·메시지별/총량 상한 초과 전문은 size+digest+사유만 남긴다. live 20,000건 초과는 dropped count와 불완전 경고로 노출한다.
2. **저장 계약:** project schema v2가 digest별 압축 blob을 한 번 저장하고 record reference를 검증해 복구한다. legacy schema v1은 preview-only 상태 그대로 읽는다. raw session과 provider credential은 계속 저장하지 않는다.
3. **결정론 노이즈 분류:** 로그인 준비는 `AUTH_SESSION/EXCLUDE`, 반복 안정 unknown은 `POLLING/REVIEW`다. Evidence는 삭제하지 않으며 `INCLUDE`만 coverage·gap·인가 판정에 사용한다.
4. **endpoint/object 정규화:** path 외에 query와 중첩 JSON·배열·XML·multipart·GraphQL의 명시 ID를 모두 추출해 근거와 함께 보존한다. 기존 인가 모델은 primary 하나만 사용하고 Evidence 없는 객체 곱을 만들지 않는다.
5. **HUMAN 그래프:** 메인 business graph와 별도로 인증·navigation·polling·background 보조 흐름을 사용자가 켜서 볼 수 있다. 보조 edge는 cell·gap·verdict를 만들지 않고, source 필터는 해당 source 전용 node까지 숨긴다. Evidence 상세는 전문 보존/metadata-only 상태와 누락 경고를 표시한다. 번들 H/S/L 샘플은 실제 실행으로 오인하지 않게 지속 배너를 표시한다.

자동 회귀와 standalone UI까지 통과해야 이 다섯 단계를 완료로 기록한다. 실제 Burp Browser 장시간 수집, 20,000건 부하, project 저장/복구, 다양한 MPA/SPA/GraphQL의 confusion matrix는 다음 수동·블라인드 gate다. 이 gate 전에는 미탐·오탐 0이나 제품 성능 우위를 주장하지 않는다.

## 7. 근거와 계획 해석

- [W3C Fetch Metadata](https://www.w3.org/TR/fetch-metadata/)는 `Sec-Fetch-Dest`가 `empty`, `image`, `document`, `iframe` 등 요청 목적을 전달한다고 정의한다. 분류 신호로 쓰되 헤더 누락 가능성 때문에 단독 절대판정으로 쓰지 않는다.
- [W3C Web App Manifest](https://www.w3.org/TR/appmanifest/)는 `application/manifest+json`과 `.webmanifest`를 웹 앱 manifest로 정의하고 `.json` 확장도 허용한다. 따라서 모든 `+json`을 business API로 보는 현재 규칙은 잘못이다.
- [PortSwigger Site Map 문서](https://portswigger.net/burp/documentation/desktop/tools/target/site-map/getting-started)는 응답에서 URL이 참조됐지만 request-response가 완료되지 않은 항목을 별도 회색 후보로 표시한다. 이는 FlowScope도 observed와 candidate를 분리해야 한다는 직접적인 제품 근거다.
- [Montoya SiteMap API](https://portswigger.github.io/burp-extensions-montoya-api/javadoc/burp/api/montoya/sitemap/SiteMap.html)는 extension이 Site Map item을 조회할 수 있고, `HttpRequestResponse.hasResponse()`로 응답 유무를 구분할 수 있다. 실제 Community 동작 여부는 H2 수동 gate에서 확인한다.
- [Burp HTTP history filtering](https://portswigger.net/burp/documentation/desktop/tools/proxy/http-history/filter-settings)은 filter가 표시만 바꾸고 항목을 삭제하지 않는다고 명시한다. FlowScope의 Evidence 보존과 분석 처분 분리 원칙을 유지한다.
- [OWASP WSTG IDOR](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/04-Testing_for_Insecure_Direct_Object_References)는 object reference 위치를 먼저 매핑하고 서로 다른 사용자 소유 객체로 권한을 검증하도록 한다. 그래서 route 후보와 object applicability를 증거 없이 Cartesian product로 만들지 않는다.
- [OWASP API1:2023 BOLA](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)는 object ID가 path/query/header/body 어디에도 있을 수 있음을 명시한다. 정규화 corpus가 path 숫자만 다뤄서는 안 되는 근거다.

위 문서가 정하는 것은 프로토콜 의미와 Burp가 제공하는 관측면이다. 어떤 feature에 몇 점을 줄지는 표준이 정하지 않으므로, 가중치 보류와 범주형 정렬은 이 근거들에서 내린 설계 판단이다.
