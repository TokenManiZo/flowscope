# v1.0.2 객체 소유자 확정 기능 분석

- 기준: origin/v1.0.2, fffb301 (PR #114 병합), 2026-10-09
- 브랜치: codex/ownership-panel-analysis
- 범위: 코드·변경 이력 분석 및 적용 설계. 후속 요청으로 아래 1단계 복원을 구현함.

## 결론

그래프 오른쪽의 소유자 확정 컴포넌트와 저장 API는 제거되지 않았다. 관측 객체로 그래프 노드를 교체하면서 추가된 표시 조건 때문에 새로운 OBJ에서는 숨겨진다. 매트릭스에는 별도로 소유자를 설정하는 UI가 추가되어 있다. 기능을 매트릭스로 완전히 이전한 구조는 아니다.

## 변경 이력과 현재 위치

1. 3350d5d: 관측 경로 객체와 OBJ 표시 추가. GraphInspectorPanel.tsx의 기존 resource 조건에 `!node.selection.displayObjectKey`를 추가했다. 원래 resource가 있어도 displayObjectKey가 있으면 GraphOwnerControl을 렌더링하지 않는다.
2. observedObjects.ts: 적용 대상의 기존 resource/object-group 노드를 제거하고 관측 객체 노드를 만든다. 펼친 resource 노드에는 항상 displayObjectKey를 넣는다. legacyResource가 하나로 연결될 때는 selection.resource 및 기존 cells를 유지하지만, 위 조건 때문에 이 경우도 소유자 입력이 숨겨진다.
3. 9e3bfd8: MatrixOwnerControl 추가. 판정 매트릭스 → 객체 권한 → 셀 선택 → 오른쪽 '객체 소유자'에서 변경·저장 가능. 새 관측 OBJ가 판정용 resource로 연결되지 않으면 이 매트릭스 경로도 대응하지 못한다.
4. GraphOwnerControl.tsx는 소유자로 확정, 소유자 바꾸기, 되돌리기, API별 Public 조회 설정을 그대로 가진다. API/객체 묶음 자체에서는 원래도 소유자 입력이 표시되지 않는다.

## 왜 일괄 노출하면 안 되는가

- objectKey/displayObjectKey는 표시용 객체 키다. OBJ 번호 역시 소유권 저장 키가 아니다.
- 현재 소유자 API POST /api/owner는 판정용 resource와 identity를 받는다. non-empty identity 저장 시 관측된 record.resource 또는 resourceReferences에 해당 resource가 존재하는지 확인하고 같은 서비스의 확인된 계정인지 검증한다.
- PATH는 원본 record.resource를 연결한다. QUERY/BODY는 단일 필드이면서 같은 입력 채널의 단일 resourceReference가 원본 resource와 일치할 때만 연결한다. 복합 입력·다중 resource·연결 없는 관측 객체는 selection.resource가 null일 수 있다.
- 표시에 묶인 근거가 여러 판정용 resource를 가리키면 하나를 임의로 선택하거나 일괄 저장하면 안 된다. 같은 표시 객체라도 API별 의미가 다른 경우 원본 판정 좌표를 보존해야 한다.
- Static resource는 인가 판정에서 제외된 관측 자원이며 기존 요구대로 소유권 판정 입력을 새로 추가하지 않는다.
- 접근한 계정은 소유자 증거와 다르다. 최초 요청 계정이나 HTTP 200만으로 소유자를 확정하지 않는다.

## 기존 저장 경로

GraphOwnerControl / MatrixOwnerControl
→ useOwnerMutation
→ saveOwner(resource, identity)
→ POST /api/owner
→ AnalysisConfig.withResourceOwner
→ state.rebuild
→ snapshot owners / ownerOverrides 및 판정 매트릭스 갱신

identity가 비어 있으면 수동 소유자 지정을 지우고 자동 추정으로 복귀한다. useOwnerMutation은 snapshot 쿼리를 무효화한다. 조회 공개 정책은 별도 API·객체 정책이며 소유자 설정과 합치지 않는다.

## 권장 적용: 1단계, 기존 판정용 객체 연결 복원

공통 대상 판별 함수를 만들고 GraphInspectorPanel에서 사용한다.

- 실제 resource 노드인지 확인한다.
- 정적 자원이나 묶음 요약이면 소유자 확정 대상에서 제외한다.
- selection.resource가 비어 있지 않은지 확인한다.
- 선택한 근거와 판정용 cells/resourceReferences의 연결이 명확한지 확인한다. 하나의 canonical resource에 연결되는 경우만 기존 저장 대상을 반환한다.
- displayObjectKey 존재 자체는 제외 사유로 사용하지 않는다.
- 판정용 resource로 명확히 연결된 신규 OBJ에는 기존 GraphOwnerControl을 재사용한다. 원본 resource 및 operation을 그대로 전달하며 표시용 해시를 저장하지 않는다.
- 기존 legacy resource 노드는 현재 동작을 유지한다.
- 한 개의 operation으로 연결되지 않으면 소유자 설정만 허용하고 API별 Public 선택은 계속 비활성화한다. GET/HEAD 이외에도 Public 선택을 허용하지 않는다.

이 단계는 기존 backend owner 저장 API와 상태 구조를 유지할 수 있다. GraphOwnerControl과 MatrixOwnerControl의 공통 저장 훅을 계속 이용하고, 공통 대상 판별·계정 표시를 먼저 공유한다. 두 컴포넌트를 단순 교체하면 GraphOwnerControl의 되돌리기/Public 범위 동작이 달라질 수 있으므로 별도로 검토한다.

## 2단계: 판정용 객체에 연결되지 않은 관측 OBJ

소유권을 부여하려면 먼저 '어떤 필드/값이 인가 대상 객체를 식별하는가'를 확인하는 명시적 연결 기능이 필요하다. QUERY 전체, BODY 전체 또는 응답 전체를 객체 주인으로 지정하는 기능과 인가 판정용 resource 소유권 설정을 구분해야 한다.

- 단일 연결이 없으면 저장 버튼을 만들지 않고 '판정 대상 객체 연결 필요' 등 상태를 설명한다.
- 여러 resource로 연결되면 선택한 원본 근거를 보여 주고 대상 식별자를 확인하는 절차를 설계한다. 첫 번째 resource를 자동 선택하지 않는다.
- 표시 메타데이터만 남기는 기능을 추가한다면 별도 모델·저장 경로를 사용하고 판정에 반영됐다고 안내하지 않는다.
- 서버 resource 추출/정규화 규칙을 확장하는 작업은 별도 범위다. ownership·review·삭제·프로젝트 저장·재로드·필터·실험 재전송까지 동일한 원본 객체 좌표로 연결되어야 한다.

## 검증 계획

- legacy resource 노드의 기존 확정·변경·되돌리기가 유지된다.
- displayObjectKey가 있지만 판정용 resource에 하나로 연결된 OBJ에서 소유자 입력이 나타난다.
- 선택만으로 POST하지 않고 확정 시에만 원본 resource로 저장한다.
- 연결 없는 OBJ, 복합 입력, 여러 resource 연결, 정적 자원, 접힌 묶음에서 임의 저장하지 않는다.
- 계정 미등록·다른 서비스 계정·데이터 조회 실패·저장 중 상태를 처리한다.
- 저장 후 그래프/매트릭스가 동일 소유자를 표시하고 프로젝트 재로드 후 유지된다.
- 비로그인 요청이나 API 조회 공개를 객체 소유자로 저장하지 않는다. 공개 조회 정책을 소유권 확정과 별도로 유지한다.

## 코드 근거

- frontend/src/features/graph/GraphInspectorPanel.tsx:65 — displayObjectKey 일괄 숨김
- frontend/src/features/graph/observedObjects.ts:28-42,126-129 — 노드 교체, 단일 legacyResource 연결, 신규 resource 생성
- frontend/src/features/graph/GraphOwnerControl.tsx — 기존 확정/변경/되돌리기 및 API 조회 공개 UI
- frontend/src/features/matrix/JudgmentMatrixView.tsx:114 — MatrixOwnerControl 노출
- frontend/src/features/matrix/MatrixOwnerControl.tsx — 매트릭스 소유자 저장
- frontend/src/lib/query/hooks.ts:181, frontend/src/lib/api/endpoints.ts:131 — 공유 owner mutation
- src/main/java/io/flowscope/web/FlowScopeWebServer.java:1699 — 서버 저장 및 검증
- src/main/java/io/flowscope/core/graph/ObservedObjectProjection.java:325 — QUERY/BODY legacy 연결 조건


## 1단계 구현 결과

GraphInspectorPanel의 displayObjectKey 일괄 숨김 조건을 제거하고, 판정용 cells의 resource와 연결된 관측 객체에서 기존 GraphOwnerControl을 노출한다. 정적 자원 및 묶음 요약은 제외한다. 연결 없는 개별 OBJ에는 판정 대상 객체가 아직 연결되지 않았다는 안내를 표시한다. 소유자 저장·변경·되돌리기와 API 조회 공개 동작은 기존 컴포넌트 및 API를 재사용하며 자동 소유자 분석 규칙은 변경하지 않는다.

검증: GraphInspectorPanel, GraphOwnerControl, observedObjects, MatrixOwnerControl 관련 테스트 38개 통과. 새 OBJ에서 확정 전 POST가 없고, 확정 시 표시용 해시 대신 원본 resource를 저장하며 snapshot 갱신 후 직접 확정 상태가 표시됨을 검증했다. 연결 없는 객체·다른 resource·정적 자원·묶음·suspended 상태를 검증했다. TypeScript 타입 검사, 프런트엔드 빌드 및 JAR 패키징 통과.


## 현재 프로젝트 적용 여부 재분석 (2026-10-09)

FlowScope 로컬 UI의 정상 인증 경로로 GET /api/snapshot을 읽어 종류별 연결 건수만 집계했다. 요청 원문·계정 인증값·객체 값은 문서에 저장하지 않았다. 통계는 현재 전체 스냅샷 기준이며 그래프 화면의 개별 필터 적용 전이다.

| 종류 | 표시 객체 수 | 기존 판정용 resource 연결 | 현재 복원 UI 적용 가능 |
| --- | ---: | ---: | ---: |
| PATH | 3 | 0 | 0 |
| QUERY | 2 | 0 | 0 |
| REQUEST_BODY | 6 | 0 | 0 |
| 합계 | 11 | 0 | 0 |

community/posts PATH의 관측 행 7개에서도 legacyResource 및 원본 event.resource가 모두 없다. 따라서 최신 복원본의 연결 안내는 캐시나 배포 누락이 아니라 실제 연결 부족을 반영한다. 1단계 복원은 기존 resource가 있는 경우만 해결했으며 이 프로젝트의 신규 OBJ에는 적용되지 않는다.

### 실제 원인

ObservedObjectProjection의 PATH 토큰 규칙은 영문·숫자가 섞인 opaque 값을 포함한다. 반면 Normalizer의 경로 resource 후보 규칙은 숫자·UUID·긴 16진수 중심이며, normalizeAll은 별도의 원본 resourceReferences에서 판정용 resource를 정한다. 표시용 PATH가 성공 관측으로 입증되어 OBJ가 되더라도 resource가 생긴다는 보장이 없다.

QUERY/REQUEST_BODY의 표시 객체는 필드·값 조합 또는 본문 전체를 정규화한 객체다. 기존 resource 연결은 단일 필드와 동일 입력 채널의 단일 reference가 일치해야 한다. limit/offset 등의 복합 QUERY나 email/password BODY는 OBJ로 표시되어도 이 조건을 만족하지 않는다. 이는 기존 판정 로직을 신규 OBJ 기준으로 통합하지 않은 설계 공백이다.

### 후속 설계 방향

1. 기존 판정용 resource 유무를 수동 소유자 설정의 필수 조건으로 삼지 않는다. PATH/QUERY/REQUEST_BODY 개별 OBJ를 새로운 소유자 설정 대상으로 서버에서 검증할 수 있어야 한다. 정적 자원은 기존 요구대로 제외한다. POST라는 메서드 자체로 제외하지 않는다.
2. 새 OBJ의 소유권 대상 키·근거·원본 좌표를 공통 객체 모델로 정의한다. 기존 resource에 연결된 경우 그 키를 그대로 재사용하고, 연결되지 않은 경우에는 서버가 검증하는 별도 namespace의 객체 ID를 부여한다. 화면 번호 OBJ 1/2, 배열 인덱스, 첫 요청자 또는 임의 resource 문자열은 저장 키가 아니다. 생성 규칙 버전과 저장 후 재로드를 고려한다.
3. 기존 POST /api/owner에 displayObjectKey를 무작정 전달하지 않는다. 현재 엔드포인트는 record.resource/resourceReferences만 검증한다. 공통 객체 resolver 또는 신규 검증 경로를 거쳐 선택한 OBJ의 소유권 대상으로 해석되도록 저장 API와 AnalysisConfig/프로젝트 저장 모델을 확장한다.
4. 소유자 지정은 사용자의 명시적 설정으로 저장한다. 요청 계정으로 자동 확정하지 않는다. 가능한 한 그래프·매트릭스가 같은 소유권 resolver와 override 모델을 사용하며 화면별 별도 소유권 저장소로 영구 분리하지 않는다.
5. 표시 객체 소유자 할당과 그 입력이 실제 인가 대상 업무 데이터라는 판단은 구분한다. login 본문·limit/offset에도 수동 소유자를 지정할 수 있지만 그것만으로 IDOR를 확정하지 않는다. 정책 및 인가 대상 의미가 미확인인 경우 현재의 확인 필요 상태를 유지한다. 인가 객체로 활성화하는 조건과 소유권만 관리하는 상태를 모델에 명시한다.
6. 새로운 판정용 객체를 활성화할 때는 해당 객체의 Evidence별 접근, 원본 operation, source, identity를 보존하여 owner 분석·판정 매트릭스·추천·Graph inspector가 같은 대상을 사용하도록 한다. 원본 요청 하나가 PATH와 QUERY/BODY 객체를 동시에 포함할 때 하나의 resource로 덮어쓰지 않는다. 기존 primary resource 셀과 중복 계산하지 않는 규칙이 필요하다.
7. 소유권의 서비스 및 실제 부모 범위를 보존한다. 현 displayObjectKey는 채널별로 메서드/API 또는 전체 경로·내용을 포함하므로 서로 다른 메서드·채널의 같은 업무 객체를 자동으로 합치지 않는다. 공유 소유권 연결이 필요하면 명시적 canonical mapping을 사용한다. 같은 숫자 ID라는 이유로 서로 다른 서비스/부모 객체를 합치지 않는다.
8. 복합 QUERY/BODY의 경우 현 OBJ 단위를 그대로 할당하는 기본 동작과 특정 필드의 업무 객체를 연결하는 확장 동작을 구분한다. 값 또는 구조가 바뀌어 새 OBJ가 생성되면 기존 소유권을 잘못 승계하지 않는다. 민감 값 마스킹으로 동등하게 보이는 객체의 owner 충돌은 명시적으로 처리한다.

### 필수 검증 추가

현재 프로젝트와 같은 opaque PATH 3개, 복합 QUERY, 복합 요청 BODY에서 기존 resource가 없어도 수동 소유자를 설정하고 재로드할 수 있어야 한다. 다른 서비스 계정 차단, 같은 OBJ의 여러 계정 접근, 값·부모·메서드·필터 변화, 다중 객체 요청, 비로그인, 충돌, 삭제 및 프로젝트 전환을 검증한다. 소유자 할당만으로 취약점 확정/공개 조회가 바뀌지 않는 것도 검증한다.

### 개별 OBJ 소유자 지정 적용

사용자 요청에 따라 PATH·QUERY·REQUEST_BODY 개별 OBJ의 수동 소유자를 저장하도록 적용했다. 기존 판정용 resource에 연결돼 있는지와 관계없이 서비스 + observed-object: + 서버가 생성한 objectKey를 사용한다. 서버는 실제 관측 객체 존재와 같은 서비스 계정을 검증하며 기존 AnalysisConfig.resourceOwners 및 프로젝트 저장 경로를 재사용한다. 화면 번호는 저장 키로 사용하지 않는다.

소유자 설정·변경·되돌리기를 기존 GraphOwnerControl로 제공하며 ownerOverrides를 다시 읽어 선택을 복원한다. 연결되지 않은 새 객체에는 공개 조회 및 판정 반영 안내를 표시하지 않는다. 이 변경은 소유권 지정 기능이며 새 표시 객체를 기존 판정용 셀로 승격하는 변경은 포함하지 않는다.

오른쪽 하단 API 선택 드롭다운은 제거했다. 기존 기본 대상 API 작업 및 객체 Evidence 범위 삭제는 유지했다. 프런트엔드 33개 테스트, 서버/프로젝트 저장 22개 테스트, 타입 검사 및 JAR 빌드를 확인했다.

### 최종 UI 정리

- 그래프의 수동 소유권은 새 OBJ 키만 사용하며 기존 resource 우선 분기를 제거했다. GraphOwnerControl에서 판정용 Public 정책 및 인가 판정 안내를 제거했다. 매트릭스/자동 판정에서 필요한 내부 resource 계약은 계속 사용한다.
- 그래프 및 검색 OBJ 이름에서 소유자 계정 접미사를 제거했다. 객체 번호/정수 ID만 표시하고 소유자는 오른쪽 지정 패널에서 확인한다.
- Request Lab 재현 기록은 개별 기록 버튼으로 정리했다. 누르면 재전송 보기로 전환하고 해당 eventId가 포함된 Request Lab API 노드를 선택·중앙 이동한다. 도구 필터에서 Request Lab을 숨겨뒀어도 해당 도구를 다시 표시한다.
- 설명 문장은 재현 제목 옆 ? 도움말로 이동했다. 재현 링크를 위한 별도 원문 모달 진입 코드는 제거했고 기존 Request Lab의 편집 흐름은 v1.0.2 기준으로 유지한다.

### 최종 검증

- npm run verify: 102개 파일, 859개 테스트 통과 및 타입 검사 통과.
- 소유자 서버 검증·ProjectStore 테스트: 22개 통과.
- Playwright 다크/라이트 브라우저: 2개 통과. 세 객체 채널별 소유자 저장, 노드 이름, 도움말, 재현 링크의 재전송 그래프 이동 및 원문 창 미호출 확인.
- 다크/라이트 오른쪽 패널 스크린샷 확인 및 디자인 검사 통과.
- 최종 JAR를 본 프로젝트 target/flowscope-1.0.1.jar에 복사하고 SHA-256 일치 확인.

### 재현 링크 의도 정정

후속 사용자 요청에 따라 재현 링크의 목적지를 원문 창에서 재전송 보기 그래프로 수정했다. 기존 검색 이동의 revealRequest를 재사용하며 projection 전환 완료 후 노드를 선택한다. 데이터셋 교체 및 사용자의 다른 그래프 조작은 대기 중 이동을 취소한다. 해당 API 번들의 보낸 기록은 원래 재전송 그래프 패널에서 확인한다.

계정·API·데이터 레인 명칭과 우측 상단 미니맵 배치는 fffb301(v1.0.2)와 f29e2ee에서 동일하다. 이번 작업에서 변경한 부분이 아니며 미니맵이 데이터 노드 위에 겹치는 기존 배치도 유지한다.

정정 후 검증: 관련 Vitest 4개 파일·84개 테스트, 타입 검사, 프런트엔드 빌드 및 JAR 패키징 통과. Playwright 다크/라이트 2개 테스트에서 숨긴 Lab 도구 재활성화, 해당 API 노드 선택·화면 내 표시, snapshot.events에 없는 재현의 그래프 이동, 원문 API·다이얼로그 미호출을 확인했다. 수정 JAR를 본 프로젝트의 같은 target 경로로 복사했다.
