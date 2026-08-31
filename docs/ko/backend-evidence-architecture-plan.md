# FlowScope 백엔드 Evidence·분석 아키텍처 재정비 계획

> 문서 상태: **단계 실행 계획 — beta.32 교차 구현 반영**
>
> 적용 대상: FlowScope `1.2.0-beta.32` 이후
>
> 범위: HUMAN 관측 백엔드부터 SCANNER·LLM·Judge까지 이어지는 공통 Evidence 파이프라인
>
> 제외: 그래프 외형 전면 개편, crAPI 정답 기반 규칙, 허가되지 않은 실대상 점검
>
> 정본 관계: 제품 전체 계획은 `product-development-plan.md`, 현재 구조는 `architecture.md`, 확정 결정은 `decisions.md`가 담당한다. 이 문서는 아래 후속 변경을 실제로 구현하기 위한 세부 작업 계획이며 완료 기록이 아니다.

**현재 교차 구현:** beta.32에서 `SourceTrustPolicy`, `LaneCompletionPolicy`, exact completed-run manifest, 완료 시점 Evidence ID 동결, 고정 Judge dataset, JSON v3·SQLite v2 저장은 구현·자동 회귀를 마쳤다. 이는 아래 전체 ledger·incremental projection·typed state·safe experiment 계획의 완료를 뜻하지 않는다. 이미 끝난 항목은 재구현하지 않고 현재 계약을 후속 단계의 기준선으로 사용한다.

## 1. 한 문장 목표

허가된 exact scope에서 HUMAN·SCANNER·LLM이 실제로 만든 요청과 응답을 손실과 출처 혼동 없이 Evidence로 보존하고, 이를 route·identity·entity·property·state로 점진적으로 구조화한 뒤, 설명 가능한 후보 생성과 통제 재현·정상 대조를 통해 취약점 판정을 뒷받침한다.

## 2. 이번 재정비가 해결해야 하는 문제

현재 FlowScope에는 트래픽 수집, 분류, route 후보, 객체 추출, 세션 broker, ZAP 실행, LLM Explorer/Judge, 그래프와 Evidence UI가 이미 존재한다. 문제는 기능의 부재보다 **수집 정본과 파생 분석의 결합**, **전량 재분석 비용**, **여러 객체·속성·상태를 표현하기 어려운 모델**, **3-way 실행 진실의 내구성 부족**, **후보에서 재현 가능한 판정까지의 실험 계층 부족**이다.

이번 계획은 다음 다섯 가지를 순서대로 해결한다.

1. 요청과 응답의 생명주기를 명시적으로 기록한다.
2. 원 Evidence와 파생 projection을 분리한다.
3. route·entity·property·state 관계를 다중 근거와 provenance로 표현한다.
4. 세 lane의 실행·완료·잠금 상태를 durable truth로 만든다.
5. 후보를 실제 취약점으로 확정하는 안전 실험·차등 비교·readback 계층을 만든다.

## 3. 성공 기준

### 3.1 기능 성공 기준

- Proxy·Repeater·Intruder·Target에서 발생한 HUMAN 요청은 요청 시점의 run, phase, account, dataset epoch를 응답 도착까지 유지한다.
- 응답이 없는 요청도 사라지지 않고 `EXPIRED_WITHOUT_RESPONSE` 또는 unload 시 `INTERRUPTED_ON_UNLOAD`로 남는다.
- 같은 Evidence를 다시 분석해도 원 Request/Response, source, run은 변하지 않는다. identity binding·분류 결과처럼 정책에 따라 바뀌는 projection은 policy version과 변경 근거를 남긴다.
- `identity → entity → operation` 기본 그래프와 `response value → request field`, 상태 전이, 속성 노출 관계를 서로 다른 projection으로 생성할 수 있다.
- HUMAN·SCANNER·LLM의 완료 여부는 record 수나 UI 표식이 아니라 durable run/stage 상태와 Evidence 조건으로 판정한다.
- 취약점 후보는 반드시 후보를 만든 규칙, 입력 Evidence, 적용 가능한 신원·operation·entity를 역추적할 수 있다.
- 최종 `CONFIRMED`는 서버가 현재 후보에 묶인 통제 재현과 정상 대조 Evidence를 검증한 경우에만 가능하다.

### 3.2 성능·자원 성공 기준

- Burp HTTP callback에서 전체 Pipeline, JSON parsing, SQLite commit, 그래프 생성을 실행하지 않는다.
- 부하 시 무제한 메모리 증가 대신 bounded queue와 명시적 loss accounting을 사용한다.
- 20,000건에 도달했다는 이유만으로 이후 요청이 보이지 않는 현재 hard-stop 경로를 제거하되, 새 자원 한도와 손실 표시가 먼저 준비되어야 한다.
- Web snapshot 생성 과정에서 DataFlow나 전체 Pipeline을 다시 실행하지 않는다.
- 동일 dataset revision에서 Web polling이 같은 전체 분석을 반복하지 않는다.
- 성능 수치는 추측하지 않고 아래 Phase 0 측정값과 전후 benchmark로 결정한다.

### 3.3 품질 성공 기준

- 기존 자동 회귀를 통과하는 것만으로 완료하지 않는다.
- fixture truth set, 저장·복구, 동시성, 실제 Burp Community load/unload, 장시간 수집, 독립 3-way 실행, blind benchmark를 단계별 gate로 둔다.
- black-box 전체 분모를 모르는 상태에서 전역 커버리지 퍼센트를 표시하지 않는다.
- 오탐·미탐 0, 모든 endpoint 발견, LLM 서술만으로 확정을 주장하지 않는다.

## 4. 변경하지 않을 원칙

다음 항목은 이번 재정비에서도 유지한다.

1. `source`는 HUMAN·SCANNER·LLM이고, 실행 주체인 orchestrator와 분리한다.
2. exact scope 밖의 active 요청은 차단한다.
3. ZAP Active Scan과 상태 변경 요청은 명시적 승인 없이는 실행하지 않는다.
4. raw Cookie·Authorization·비밀번호·API key·provider token은 프로젝트, 로그, Web snapshot, MCP에 저장하거나 노출하지 않는다.
5. raw HTTP 편집은 bounded process memory의 현재 Evidence에만 허용하고 dataset 교체·초기화·unload 시 폐기한다.
6. route candidate는 관측 operation이 아니며 coverage, finding, lane 완료를 증가시키지 않는다.
7. 미교차, 일부 발견, 판정 불일치는 취약점 확정이 아니라 다음 검토 위치다.
8. 일반 LLM assessment와 서버 검증 final verdict를 분리한다.
9. crAPI는 blind benchmark 대상일 뿐 제품 규칙이나 prompt의 정답 사전이 아니다.
10. Web UI는 분석 작업면의 정본으로 유지하고 Burp 탭은 설정·상태·Web 진입에 집중한다.

## 5. 범위와 비범위

### 5.1 이번 계획에 포함

- 첨부 beta.25 리뷰를 beta.29 작성 당시 코드와 실행 결과로 재검증한 선행 안전·정확성 hotfix. beta.32에서 해결된 교차 항목은 상단의 현재 교차 구현과 §22 상태를 기준으로 재구현하지 않는다.
- Montoya HTTP 수집 생명주기
- Evidence ledger와 payload 저장 경계
- incremental projection
- traffic classification과 review/override
- route·entity·property·state 모델
- identity/session binding projection
- data dependency와 workflow projection
- authorization candidate universe
- safe experiment planner
- differential replay, readback, side-effect observation
- 3-way run/stage/dataset lock 내구화
- Evidence-bound Judge 입력과 final verdict gate
- 저장 migration, 성능, 회귀, blind benchmark

### 5.2 이번 계획에서 제외

- 그래프 색상·폰트·패널 배치의 전면 재설계
- 외부 검색, Wayback, 대상 저장소 검색을 이용한 endpoint 수집
- 무승인 destructive scan 또는 임의 대량 fuzzing
- CAPTCHA·MFA·WebAuthn의 범용 무인 우회
- 모든 GraphQL resolver 의미 추론
- 모든 WebSocket/SSE 업무 상태의 자동 해석
- 서버형 multi-tenant SaaS 전환
- 모델 학습 또는 임의 가중치 모델 도입

### 5.3 기능명세 추적표

| 기능명세 | 이 계획의 담당 단계 | 완료 증거 |
|---|---|---|
| F-01 입력 데이터 수집 | Phase 1~2 | lifecycle, source/run attribution, overload/loss 회귀 |
| F-02 통합 형식 변환 | Phase 1~3 | `ObservedExchange`와 compatibility round-trip |
| F-03 정규화 | Phase 5 | protocol corpus와 raw/canonical 동시 보존 |
| F-04 엔드포인트 분석 | Phase 5 | route universe·template evidence truth set |
| F-05 사용자 분석 | Phase 5~6 | ANONYMOUS/UNRESOLVED, binding/unbinding, account projection |
| F-06 객체 분석 | Phase 5 | applicable entity와 다중 위치·중첩 fixture |
| F-07 관계 분석 | Phase 3·5 | revision별 graph projection과 Evidence drill-down |
| F-08 출처 시각화 | Phase 3·6 | source/run projection과 Web 계약 회귀 |
| F-09 Flow 분석 | Phase 5 | typed dependency precision/recall과 heuristic 표시 |
| F-10 접근 권한 분석 | Phase 7 | structured response oracle와 policy revision |
| F-11 IDOR 분석 | Phase 7~8 | owner/non-owner 후보와 replay/control bundle |
| F-12 관측 범위 분석 | Phase 6~7 | `U_observed`와 적용 가능 cell, 전역 퍼센트 부재 |
| F-13 소스 비교 | Phase 6 | 동일 lock revision의 source별 집합 |
| F-14 미교차 조합 | Phase 7 | observed/applicable 집합 내부 후보만 생성 |
| F-15 불일치 갭 | Phase 6~7 | source별 verdict와 입력 Evidence 비교 |
| F-16 규칙 기반 분석 | Phase 7 | candidate reason·missing prerequisite |
| F-17 AI 분석 | Phase 9 | locked typed summary와 Evidence tool |
| F-18 요청 검증 | Phase 8 | scope·approval·budget가 있는 experiment plan |
| F-19 결과 검증 | Phase 8~9 | replay·control·readback Validation Bundle |
| F-20 Flow Graph | Phase 3·5 | cached projection, group/expand, 원 Evidence 보존 |
| F-21 그래프 필터 | Phase 3·6 | source filter가 node·edge·count를 함께 재계산 |
| F-22 상세 분석 | Phase 2~3 | payload 상태·Evidence ID 기반 지연 로드 |
| F-23 권한 분석 | Phase 7 | cell별 policy·candidate·unresolved projection |
| F-24 판정 근거 | Phase 8~9 | 후보에서 원본·재현·대조 Evidence까지 역추적 |

## 6. 현재 구조에서 유지할 자산

| 기존 자산 | 처리 | 이유 |
|---|---|---|
| `RequestRecord` | 호환 DTO로 유지 | 기존 import/export, 테스트, Web 계약을 한 번에 깨지 않기 위한 migration adapter |
| `Pipeline.runIsolated` | 호환성 비교기에 한정 | 새 projection 결과와 기존 결과의 차이를 측정하는 oracle로 사용. 새 구조의 정확성 증명으로 사용하지 않음 |
| `TrafficClassification`·`TrafficOverride` | 확장 | Evidence 보존과 분석 처분 분리 원칙이 맞음 |
| `RouteCandidate`·discovery adapter | 유지·보강 | observed와 candidate, provenance 분리 구조가 맞음 |
| `ResourceReference` | `EntityReference` 방향으로 확장 | 위치·근거·primary 개념을 살리되 다중 entity와 관계를 표현해야 함 |
| `SessionBroker` | 유지 | raw credential memory-only 경계와 계정 projection을 보존 |
| `RunContextRegistry` | durable run store의 runtime cache로 변경 | 요청 시점 문맥 보존 기능을 유지 |
| `TransientExchangeVault` | 유지·연계 | raw byte는 저장 모델과 분리된 bounded memory에 있어야 함 |
| Evidence ID·review·validation model | 유지·확장 | 추적성과 감사 경계의 기반 |
| `ZapClient` deterministic baseline | 유지·단계 truth 보강 | scanner 재현성과 안전 경계를 보존 |
| `LocalLlmRunner`·MCP Explorer/Judge 분리 | 유지·Evidence contract 보강 | 독립 Explorer와 종합 Judge의 목적이 다름 |
| `SnapshotJsonWriter`·Web UI | 출력 계약 유지 후 내부 교체 | UI를 다시 만드는 대신 공급 방식을 incremental projection으로 변경 |
| Burp XML·HAR import | 유지 | 과거 HUMAN/SCANNER Evidence를 공통 ledger에 넣는 adapter로 사용 |

## 7. 제거할 것과 제거 조건

제거는 즉시 삭제가 아니라 **대체 구현 → 이중 실행 비교 → migration 확인 → 삭제** 순서로 수행한다.

| 제거 대상 | 제거 이유 | 선행 조건 | 제거 시점 |
|---|---|---|---|
| live record 20,000건 이후 신규 수집을 막는 hard-stop 경로 | 장시간 진단에서 이후 traffic이 분석에서 사라짐 | bounded ingest queue, metadata-only fallback, dropped/degraded 수량 UI, 저장 부하 시험 | Phase 4 통과 후 |
| 응답 callback에서만 완성 `RequestRecord`를 만드는 주 경로 | 요청만 존재하거나 늦은 응답의 상태를 정확히 표현하기 어려움 | `ObservedExchange` lifecycle과 tracker 회귀 | Phase 2 통과 후 |
| Web snapshot 생성 시 DataFlow 전체 재계산 | polling마다 CPU 비용과 결과 시점 불일치 발생 | DataFlow projection cache와 revision 계약 | Phase 3 통과 후 |
| 전체 `Pipeline`을 live read path에서 반복 실행하는 경로 | 레코드 증가에 따라 분석 비용이 반복 누적 | incremental projection과 compatibility diff | Phase 6 통과 후 |
| 반복 횟수만으로 polling을 결정하는 단독 결정 규칙 | 업무상 반복 API와 배경 polling을 혼동 | cadence, initiator, fetch context, payload variance를 포함한 근거형 분류 | Phase 3 통과 후 |
| 단일 숫자·UUID·긴 hex를 즉시 canonical route로 확정하는 경로 | `/status/200`, 연도, 버전 등과 실제 식별자를 혼동 | LITERAL/INFERRED/CORROBORATED와 다중 관측·schema/response 근거 | Phase 5 통과 후 |
| exact substring DataFlow를 확정적 dependency로 사용하는 경로 | 우연한 문자열 일치, 형식 변환, 배열·nested 구조에서 오류 | typed value provenance, field path, transform-aware matching | Phase 5 통과 후 |
| status 또는 본문 임의 문자열 하나를 권한 verdict의 결정적 근거로 쓰는 남은 shortcut | 정상 데이터에 포함된 deny 문구와 실제 deny envelope 혼동 | structured response signal과 controlled baseline | Phase 7 통과 후 |
| primary resource 하나만 소비하는 인가 후보 생성 경로 | nested·복합 객체에서 실제 보호 대상 누락 | operation별 applicable entity set과 relation | Phase 6 통과 후 |
| `completedSources` 집합만을 3-way 완료 truth로 쓰는 경로 | 실행 단계·실패·경고·dataset revision을 표현하지 못함 | durable `run`, `run_stage`, `dataset_lock` | Phase 6 통과 후 |
| 30초마다 전체 SQLite snapshot을 다시 쓰는 기본 경로 | 대규모 dataset에서 write amplification과 freeze 가능성 | live store spike, crash recovery, migration, rollback | Phase 4에서 채택 판정 후 Phase 6 이내 |
| 1초 polling마다 같은 전체 JSON을 재생성·전송하는 경로 | 대규모 그래프에서 CPU·메모리·브라우저 비용 증가 | snapshot cache, ETag/revision, 측정 후 delta 필요성 판단 | Phase 6 통과 후 |

### 7.1 제거하지 않을 것

- Cytoscape 기반 Web 작업면
- source별 색·선·필터 계약
- observed와 route candidate의 분리
- exact scope와 active traffic guard
- memory-only raw session 경계
- HUMAN·ZAP·LLM의 별도 lane
- ZAP Traditional/Client/AJAX/passive/alert 기준선
- LLM Explorer와 Judge의 별도 provider session
- 기존 project import/export 호환성
- 마스킹 Evidence와 raw vault의 분리

## 8. 목표 아키텍처

```text
Burp / ZAP / LLM / Importer
          │
          ▼
   Capture Adapter
   - exact scope
   - source/run/phase/epoch
   - request/response correlation
          │
          ▼
     Evidence Ledger
   - ObservedExchange lifecycle
   - immutable metadata
   - payload digest/blob reference
   - explicit loss/degradation
          │
          ├──────────────► Raw Vault (process memory only)
          │                 current bounded edit/replay
          ▼
 Incremental Projection Engine
   ├─ Traffic Projection
   ├─ Route Projection
   ├─ Identity Projection
   ├─ Entity/Property Projection
   ├─ State/Dependency Projection
   └─ 3-way Run Projection
          │
          ▼
     Candidate Universe
   - observed/source gaps
   - authorization candidates
   - workflow/property/state candidates
          │
          ▼
   Safe Experiment Planner
   - exact scope
   - account/control selection
   - mutation budget
   - approval/risk gate
          │
          ▼
 Differential Replay / Readback
   - mutated request
   - baseline request
   - repeatability
   - side-effect observation
          │
          ▼
     Validation Bundle
   - original Evidence
   - controlled Evidence
   - normal control Evidence
   - policy version
          │
          ▼
 Evidence-bound Judge + Web Projection
```

핵심은 그래프가 저장 정본이 아니라 projection이라는 점이다. 원 Evidence를 다시 읽을 수 있어야 route나 객체 규칙을 고쳐도 과거 관측을 새로운 규칙으로 재계산할 수 있다.

## 9. 핵심 데이터 계약

### 9.1 `ObservedExchange`

```text
ObservedExchange {
  evidenceId
  datasetId, datasetEpoch
  source, sourceDetail, orchestrator
  runId, stageId, phase
  toolKind
  requestObservedAt
  responseObservedAt?
  lifecycleState
  service, method, rawPath, query
  requestHeaderMetadata, requestPayloadRef?
  responseStatus?, responseHeaderMetadata, responsePayloadRef?
  identityHintRefs[]
  captureWarnings[]
  createdAt, updatedAt
}
```

허용 lifecycle은 다음으로 제한한다.

- `REQUEST_OBSERVED`
- `RESPONSE_OBSERVED`
- `EXPIRED_WITHOUT_RESPONSE`
- `INTERRUPTED_ON_UNLOAD`
- `DROPPED_BY_FLOWSCOPE`

Montoya의 일반 callback만으로 실제 network timeout, 사용자 취소, 서버 reset 원인을 정확히 알 수 없는 경우 이를 추측하지 않는다. FlowScope controlled executor가 직접 실행한 요청만 별도 controlled timeout/failure 원인을 가질 수 있다.

### 9.2 payload 계약

- canonical digest는 원 byte를 기준으로 계산한다.
- project에는 인증값이 구조적으로 마스킹된 payload 또는 저장 불가 metadata만 들어간다.
- raw byte는 `TransientExchangeVault`에 bounded memory로만 둔다.
- payload blob은 digest dedup, compression, original size, stored size, media type, charset result, truncation reason을 가진다.
- binary, 크기 초과, decode 손실은 텍스트로 꾸미지 않고 metadata-only로 표시한다.

### 9.3 run truth 계약

최소 durable table은 다음과 같다.

```text
run
run_stage
scanner_alert
llm_execution
dataset_lock
dataset_lock_member
analysis_policy_version
```

각 run은 target scope, source, identity/account, 시작·종료 시각, 상태, warning, captured count, accepted Evidence count, policy version을 가진다. `COMPLETED`는 source별 완료 조건을 만족해야 하며 단순 process exit 0이나 record count 증가로 대체하지 않는다.

### 9.4 projection 계약

```text
RouteProjection
IdentityProjection
EntityReference
EntityRelation
PropertyReference
StateObservation
DataDependency
CoverageCell
FindingCandidate
SafeExperimentPlan
Mutation
ValidationBundle
```

모든 projection row는 최소한 다음을 가진다.

- projection version
- dataset revision
- source/run 범위
- 입력 Evidence ID 집합 또는 추적 가능한 input key
- machine-readable reason
- confidence 숫자 대신 우선 범주형 evidence level
- 사용자 override와 override audit

## 10. 분석 모델 설계

### 10.1 traffic 분류

분류는 삭제가 아니라 처분이다.

```text
INCLUDE  → business graph, coverage, candidate 분석에 사용
REVIEW   → Evidence 보존, 검토 큐에 표시, 기본 분석 제외
EXCLUDE  → Evidence 보존, 보조/노이즈 projection에서만 사용
```

판정 cascade:

1. exact scope와 response/lifecycle 같은 변경 불가능한 gate
2. navigation, static asset, source map, manifest, service worker, 진짜 CORS preflight 등 규격 신호
3. GraphQL/gRPC/protobuf, unsafe method, fetch context, representation 등 강한 API 신호
4. 같은 canonical operation의 독립 Evidence
5. 충돌 시 `REVIEW`
6. operation 단위 사용자 override

`count >= 3` 같은 빈도는 하나의 feature일 뿐 polling 확정 조건이 아니다. cadence, 동일 initiator, response/payload 안정성, tab visibility와 가능한 범위의 fetch metadata를 함께 기록한다.

### 10.2 route 모델

서로 다른 네 universe를 분리한다.

- `U_observed`: 실제 Request/Response가 있는 operation
- `U_declared`: 사용자가 제공하거나 same-scope에서 관측한 OpenAPI·GraphQL·Postman·SOAP 정의
- `U_candidate`: HTML/JS/XML/metadata/Site Map에 참조됐지만 요청하지 않은 route
- `U_truth`: benchmark 채점용 정답 집합. 제품 실행 중에는 숨김

경로 template 수준:

- `LITERAL`: 원 경로 그대로
- `INFERRED`: 복수 값, 위치, key 의미 등으로 추론
- `CORROBORATED`: schema 또는 request/response entity 근거로 교차 확인

단일 숫자나 UUID는 entity 후보가 될 수 있지만, 그 자체만으로 operation merge를 확정하지 않는다.

### 10.3 identity 모델

- 실제 비인증 `ANONYMOUS`와 파서가 신원을 결정하지 못한 `UNRESOLVED`를 분리한다.
- Cookie, Authorization, subject hint는 account와 동일한 개념이 아니다.
- 기본 UI는 `AccountProfile` 하나로 projection하고 기술 fingerprint는 접는다.
- 같은 service의 fingerprint를 두 계정에 동시에 binding하지 않는다.
- binding 해제 시 원 Evidence 기반 identity projection을 다시 계산한다.
- role `UNKNOWN`은 권한 충분으로 간주하지 않는다.

### 10.4 entity·object 모델

기존 primary resource 하나만으로 모든 분석을 끝내지 않는다.

```text
EntityReference {
  typeHint
  valueDigest, maskedDisplay
  location: PATH | QUERY | HEADER | BODY | RESPONSE
  fieldPath
  extractionReason
  evidenceLevel
  relationHint
}
```

operation별 `R(o)`는 실제 Evidence로 적용 가능한 entity 집합만 포함한다. 전체 identity × 전체 entity의 Cartesian product를 만들지 않는다. nested resource는 부모와 자식을 각각 보존하고 `PARENT_OF`, `BELONGS_TO`, `OWNED_BY`, `REFERENCES` 관계 후보를 별도로 둔다.

### 10.5 property 모델

Mass Assignment와 과도한 데이터 노출은 entity ID만으로 찾을 수 없으므로 다음을 추가한다.

```text
PropertyReference {
  entityType
  fieldPath
  direction: REQUEST | RESPONSE
  observedTypes[]
  writableEvidence[]
  readableEvidence[]
  sensitivityHint
  provenance[]
}
```

request와 response field set 차이, 계정별 response field 차이, 생성/수정 전후 readback을 비교할 수 있어야 한다. `admin`, `role`, `owner`, `price` 같은 이름만으로 취약점을 확정하지 않고 후보 이유로만 사용한다.

### 10.6 state와 dependency 모델

exact substring은 fallback `HEURISTIC`으로만 남기고 다음 typed match를 우선한다.

- JSON/XML field path와 value digest
- response entity ID → 후속 path/query/body field
- Location header → 후속 route
- token/nonce의 생성 위치와 소비 위치
- normalized numeric/string/UUID representation
- 동일 identity·run·시간 창

상태는 서버 내부 상태를 안다고 주장하지 않고 관측값으로 표현한다.

```text
StateObservation {
  entityRef?
  stateKey
  beforeValue?
  afterValue?
  observedByEvidence
  readbackEvidence?
}
```

### 10.7 response oracle

응답 판정 신호는 다음처럼 분리한다.

- transport/status signal
- redirect/auth challenge signal
- structured error envelope
- expected entity exposure
- field set and value delta
- content fingerprint
- side-effect/readback
- repeatability

본문 어디에든 `not allowed`가 있다는 이유만으로 전체 응답을 deny로 뒤집지 않는다. 객체 노출은 `id`라는 정확한 필드명 하나에 제한하지 않고 entity type, field path, nested relation, request target과의 일치를 본다. 파싱은 크기·깊이·node count 상한을 가진다.

## 11. 후보와 안전 실험 계층

### 11.1 후보는 finding이 아니다

후보는 다음을 가져야 한다.

```text
FindingCandidate {
  candidateId
  category
  subjectIdentity
  baselineIdentity?
  operation
  applicableEntities[]
  inputEvidenceIds[]
  reasonCodes[]
  unresolvedRequirements[]
  status
}
```

### 11.2 `SafeExperimentPlan`

각 계획은 다음을 명시한다.

- exact target와 method/path
- 원 Evidence
- 사용할 등록 계정 또는 비로그인
- mutation 위치와 값의 출처
- baseline/control 요청
- 최대 요청 수·시간·동시성
- 상태 변경 가능성
- 승인 필요 여부
- 성공·실패·불확실 조건
- readback 또는 side-effect 관찰 방법

### 11.3 취약점 유형별 필요한 실험

| 유형 | 필요한 최소 모델·실험 | 확정에 필요한 핵심 Evidence |
|---|---|---|
| BOLA/IDOR | 동일 operation의 owner/non-owner entity 교차 | 공격자 성공 응답 + entity 노출/효과 + 정상 owner/control |
| BFLA | 동일 기능의 role 차등 실행 | 낮은 role 성공 + 요구 role 근거 + 정상 차단/control |
| 인증 우회 | 비로그인·불완전 인증 상태 비교 | 인증 없는 성공 + 인증 baseline + 상태/데이터 동일성 |
| 순서 우회 | dependency/state graph에서 단계 생략 | 선행 단계 없는 성공 + 정상 순서 control + readback |
| 상태 전이 오류 | 허용 전이와 비정상 전이 비교 | 비정상 전이 수용 + 이후 상태 readback |
| 중복 실행 | 동일 mutation의 bounded repeat | 중복 side effect + idempotent/control 비교 |
| 비정상 method | declared/observed method와 대체 method 비교 | 동일 기능 효과 + method별 정상 control |
| 민감 기능 노출 | role/identity별 operation 비교 | 낮은 권한 성공 + 기능 효과 또는 민감 데이터 |
| Mass Assignment | request property mutation + readback | 숨은/권한 필드 변경 + readback + 정상 필드 control |
| 과도한 데이터 노출 | 계정·operation별 response property diff | 불필요 민감 field 실제 반환 + schema/업무 필요성 검토 |
| Rate-limit 부재 후보 | bounded temporal experiment | 사전 합의된 요청 예산 내 반복 허용과 서버 반응 시계열 |

Rate-limit과 중복 실행은 트래픽·상태 위험이 있으므로 기본 자동 실행이 아니라 승인형 bounded experiment다.

## 12. 3-way 공정성과 실행 진실

### 12.1 lane 공통 조건

- 같은 target build와 DB seed
- 같은 exact scope
- 같은 공개 seed 정보
- 같은 계정 집합과 역할
- 같은 시간 또는 요청 budget
- lane마다 fresh login/session
- lane 간 발견 route·gap·finding 비공개
- 가능하면 lane 전후 target state 복원

### 12.2 두 실험을 분리

1. **자연 탐색 실험:** HUMAN·ZAP·LLM이 각자 무엇을 발견하는지 비교한다.
2. **공통 후보 검증 실험:** 잠긴 동일 candidate set을 각 방식 또는 Judge가 검증한다.

두 실험을 섞으면 Explorer가 다른 lane의 답을 보거나, 발견 능력과 검증 능력이 같은 지표에 섞인다.

### 12.3 lane 완료 조건

- HUMAN: explicit exploration run 시작·종료, exact-scope accepted Evidence, 미처리 in-flight 상태 정리
- SCANNER: identity별 fresh session, 필수 stage 상태, passive queue drain, capture/alert 결과 또는 구체적 warning/failure
- LLM: 선발급 exact run, 허용 MCP 도구만 사용, 대상 응답 Evidence 1건 이상, 정상 run 종료
- Judge: 세 lane lock, 후보별 controlled replay/control Evidence, 서버 validation bundle 검증

## 13. 저장 구조 전환 계획

### 13.1 바로 full event sourcing으로 가지 않는다

먼저 최소 live schema를 시험한다.

```text
observations
payload_blobs
runs
run_stages
project_state
```

이후 측정으로 필요성이 확인되면 projection table을 추가한다. 처음부터 15개 이상의 projection과 복잡한 event replay framework를 만들지 않는다.

### 13.2 writer 구조

- callback은 immutable ingest command를 bounded queue에 넣고 즉시 반환한다.
- background writer가 batch transaction으로 observation과 payload reference를 기록한다.
- queue가 임계치를 넘으면 payload를 metadata-only로 낮추거나 명시적 drop record를 만든다.
- browsing callback은 disk commit을 기다리지 않는다.
- run 완료, dataset lock, controlled Evidence 응답에는 commit barrier를 둔다.

### 13.3 채택·기각 gate

live SQLite 전환은 다음을 모두 통과할 때만 채택한다.

- Burp callback p50/p95/p99 지연이 허용 기준 안에 있음
- 1만·5만·10만 observation에서 memory와 DB 증가가 설명 가능함
- 강제 종료 뒤 committed observation 복구
- payload dedup과 secret scan 통과
- concurrent Web read와 writer에서 일관된 revision
- 기존 SQLite snapshot project migration과 rollback

통과하지 못하면 현재 memory source of truth를 유지하고 snapshot write만 최적화한다. “미래 서버”라는 이유만으로 live DB를 강행하지 않는다.

## 14. 단계별 구현 계획

각 단계는 이전 단계의 exit gate를 통과하기 전에는 시작하지 않는다.

### Phase -1 — 검증된 안전·정확성 결함 선행 수정

**목적:** 새 Evidence 아키텍처를 만들기 전에 현재 제품에서 exact scope, credential 비노출, 계정·run 귀속, 세션 상태, Request Lab 단일 실행을 깨는 확정 결함을 실패 fixture로 고정하고 최소 수정한다. 첨부 리뷰의 수치나 평가를 그대로 믿지 않고, beta.29 작성 기준의 코드·실행 재현·공식 외부 계약에서 출발하되 beta.32 코드에 여전히 존재하는지 다시 확인한 항목만 blocker로 취급한다.

**Phase -1A — 안전 불변식**

1. Proxy History 가져오기에도 live capture와 동일한 canonical exact-scope 판정을 적용한다. 범위 밖 항목은 분석·저장하지 않고 제외 수만 표시한다. Site Map, XML/HAR import, MCP, ZAP, LLM adapter도 같은 scope contract를 사용한다.
2. `Authorization`, `Proxy-Authorization` 등 credential-bearing header는 header 전체 값을 fail-closed 방식으로 마스킹한다. 프로젝트·SQLite·로그·Web snapshot·MCP 직렬화 경로마다 secret-negative test를 둔다.
3. ZAP AJAX Spider 호출에 선택한 exact context와 scope 제한을 명시한다. 현재 ZAP 2.17 API가 제공하는 `inScope`, `contextName`, `subtreeOnly`를 capability 확인 후 사용하고, 지원하지 않는 버전에서는 AJAX stage를 경고와 함께 중단한다. 단순히 context를 만든 사실만으로 scope 준수를 주장하지 않는다.
4. Request Lab은 evidence 선택마다 generation token과 immutable draft를 만들고, 늦게 도착한 이전 응답을 폐기한다. 전송 중에는 evidence·계정·인증값·닫기·전송 UI를 잠그고, 서버에는 단일 실행 idempotency key를 전달한다.

**Phase -1B — 분석·귀속 정확성**

1. JSON/XML/form 등 구조화 파싱에 성공한 body에는 raw 자유문구 정규식 fallback을 다시 적용하지 않는다. fallback은 파싱 실패와 적합한 media type에서만 실행하고 `"text":"productId: 5"` 같은 음성 fixture를 둔다.
2. import dedup key에 service, source detail, account/identity evidence, run, request/response digest와 관측 occurrence 의미를 반영한다. 같은 HTTP 내용이라도 다른 계정·run의 관측은 보존하고, 같은 파일 재가져오기는 중복되지 않게 한다.
3. 새 세션은 403·404 또는 analytics cookie만으로 `ACTIVE`가 되지 않게 한다. 인증 material 후보, 명시적 사용자 확인 또는 bounded verification probe, 허용된 성공 응답을 분리해 기록한다. 이미 활성인 세션의 일시적 403과 최초 활성화 조건도 분리한다.
4. SCANNER run 귀속을 전역 `current(Source.SCANNER)`만으로 결정하지 않는다. ZAP adapter/capture channel과 campaign lease로 상관관계를 만들고, 동시에 발생한 Burp native Scanner 요청은 별도 `sourceDetail`·run·trust로 남긴다.
5. Burp XML service 파싱은 문자열 `split(":", 2)` 대신 URI/authority parser를 사용해 hostname, IPv4, bracketed IPv6, bare IPv6 fixture를 통과시킨다.
6. Windows에서 `codex.cmd`, `claude.cmd`, `.exe`와 `PATHEXT`를 안전하게 해석하는 executable resolver seam을 만들고, Windows CI에서도 전체 Maven test를 실행한다. 리뷰의 과거 “7개 실패” 수치는 재사용하지 않고 현재 CI 결과를 새로 기록한다.
7. 빈 authorization cell은 실제 `UNCROSSED` candidate가 있을 때만 IDOR 후보로 표시하고, candidate가 없으면 중립적인 미검증 상태로 표시한다.

**Phase -1C — 재현 후 후속 단계에 연결할 항목**

1. undeclared non-UTF-8, oversized/deep payload는 live raw vault의 현재 완화 효과와 분석·영속 Evidence 손실을 나눠 측정한다. byte-preserving payload 계약은 Phase 1·2에 반영한다.
2. soft-deny business message 오인, actor/creator를 owner로 오인하는 사례는 positive·negative fixture를 먼저 만들고 Phase 5·7의 typed relation·oracle로 해결한다.
3. rebuild/clear 경합은 deterministic latch test로 먼저 재현한다. 재현되면 dataset/config revision compare-and-publish로 수정하고, 재현 전에는 확정 장애로 문서화하지 않는다.
4. 검증되지 않은 JWT `sub`는 identity가 아니라 hint로 유지하며 issuer·audience·signature 근거 또는 session broker의 exact credential binding 없이는 계정 병합 근거로 사용하지 않는다.

**변경 예상 파일**

- `burp/FlowScopeExtension.java`, `burp/ZapClient.java`, `burp/ZapCampaignRunner.java`
- `burp/Masking.java`, `burp/BurpXmlParser.java`, `burp/SessionBroker.java`
- `core/Normalizer.java`, `core/RecordMerge.java`, `core/ResponseEvidence.java`
- `core/AuthorizationAnalyzer.java`, `integration/LocalLlmRunner.java`
- Web Request Lab state와 snapshot 생성 코드, 대응 단위·통합 테스트
- 문서: 실제 동작이 바뀐 뒤 `architecture.md`, `decisions.md`, `beta-validation.md`, `development-log.md`, 사용자 문서

**Exit gate**

- 범위 밖 Proxy History·ZAP AJAX·MCP/adapter 요청이 accepted Evidence 또는 능동 요청으로 들어가지 않음
- 배포 가능한 모든 저장·출력 경로의 secret scan에서 credential 원문과 부분 잔존이 0건
- 같은 요청/응답의 서로 다른 계정·run 관측은 각각 남고 동일 import 재실행은 중복되지 않음
- 403·404만 관측된 신규 세션은 `ACTIVE`가 아님
- ZAP campaign과 native Burp Scanner가 동시에 발생해도 run/account/trust가 교차하지 않음
- Request Lab의 A→B 빠른 선택과 전송 중 selector 변경 테스트에서 B 외 요청이나 중복 요청이 0건
- Linux/macOS/Windows의 지원 환경에서 전체 회귀 결과를 각각 기록함
- 아래 검증 장부의 Phase -1 항목이 코드·테스트·문서 Evidence를 가짐

### Phase 0 — 기준선 측정과 fixture 동결

**목적:** 개선 전 비용과 오류를 숫자로 남기고 동일 입력을 재사용한다.

**변경 파일**

- `src/main/java/io/flowscope/diag/StressDiagnostic.java`
- `src/test/java/io/flowscope/AccuracyRegressionTest.java`
- 신규 fixture/resource와 benchmark runner
- 문서: `beta-validation.md`, `development-log.md`

**작업**

1. 1천·1만·2만·5만 record 합성 corpus를 만든다.
2. callback 처리 시간, Pipeline 시간, snapshot 생성 시간·크기, heap, SQLite 저장 시간을 측정한다.
3. MPA·SPA·GraphQL·multipart·nested JSON/XML·redirect·401/403·응답 없음 fixture를 동결한다.
4. 현재 classifier, route, entity, identity, DataFlow, authorization 결과를 저장한다.

**Exit gate**

- 같은 명령으로 전후 측정 가능
- fixture 정답과 현재 오분류 목록 공개
- benchmark가 제품 코드에 crAPI 정답을 포함하지 않음

### Phase 1 — `ObservedExchange`와 lifecycle 도입

**목적:** 요청·응답·응답 없음·dataset epoch를 하나의 Evidence lifecycle로 표현한다.

**변경 파일**

- `burp/FlowScopeExtension.java`
- `burp/InFlightRequestTracker.java`
- 신규 `core/ObservedExchange.java`
- 신규 `core/ExchangeLifecycleState.java`
- `core/RequestRecord.java` compatibility adapter
- 대응 테스트

**작업**

1. 요청 callback에서 request-side immutable metadata를 만든다.
2. response callback은 동일 exchange를 완성한다.
3. tracker expiry와 unload interruption을 명시한다.
4. controlled executor failure와 일반 proxy 무응답을 구분한다.
5. 기존 Pipeline에는 adapter로 `RequestRecord`를 공급한다.

**Exit gate**

- response 없는 요청이 사라지지 않음
- 초기화 전 요청의 늦은 응답이 새 dataset에 유입되지 않음
- HUMAN run/account/sourceDetail이 응답까지 유지됨
- 기존 import/export 회귀 통과

### Phase 2 — Evidence ledger와 ingest backpressure

**목적:** callback과 분석을 분리하고 손실을 숨기지 않는다.

**변경 파일**

- 신규 `core/EvidenceLedger.java`
- 신규 `core/IngestCommand.java`
- 신규 `core/IngestHealth.java`
- `StoredPayload.java`
- `TransientExchangeVault.java`
- `FlowScopeExtension.java`
- 저장·부하 테스트

**작업**

1. bounded queue와 batch consumer를 도입한다.
2. queue depth, metadata-only, dropped count와 이유를 snapshot에 노출한다.
3. payload digest/dedup와 vault reference를 연결한다.
4. callback에 JSON parser·Pipeline·disk wait가 없음을 테스트한다.

**Exit gate**

- overload가 extension freeze나 무제한 heap 증가로 이어지지 않음
- 모든 degradation이 수량과 reason으로 노출됨
- secret scan과 raw vault clear lifecycle 통과

### Phase 3 — snapshot 재분석 제거와 projection cache

**목적:** Web read가 분석을 다시 실행하지 않게 한다.

**변경 파일**

- 신규 `core/projection/ProjectionEngine.java`
- 신규 `core/projection/ProjectionSnapshot.java`
- `web/SnapshotJsonWriter.java`
- `web/FlowScopeWebServer.java`
- `core/DataFlowAnalyzer.java`
- Web 계약·성능 테스트

**작업**

1. dataset revision별 immutable projection snapshot을 만든다.
2. changed Evidence만 projection worker에 전달한다.
3. Web은 최신 committed revision을 직렬화만 한다.
4. ETag/revision cache를 먼저 적용하고 delta API는 측정 후 결정한다.
5. SnapshotJsonWriter의 DataFlow 재실행을 제거한다.

**Exit gate**

- 동일 revision 반복 조회에서 Pipeline/DataFlow 실행 0회
- Web snapshot 결과가 projection revision과 일치
- 기존 JSON UI 계약 회귀 통과

### Phase 4 — live SQLite feasibility와 저장 migration

**목적:** 추측이 아니라 부하·복구 결과로 live store 채택 여부를 결정한다.

**변경 파일**

- `integration/SqliteProjectStore.java`
- `integration/ProjectStore.java`
- 신규 storage schema/migration 클래스
- `SqliteProjectStoreTest.java`
- crash/concurrency benchmark

**작업**

1. 최소 live schema prototype을 feature flag 아래 구현한다.
2. async batch writer와 commit barrier를 검증한다.
3. schema v1/v2 snapshot을 새 구조로 import한다.
4. 새 구조를 기존 형식으로 export 가능한지 확인한다.
5. 채택/기각 수치와 이유를 decision 문서에 기록한다.

**Exit gate**

- 13.3의 모든 기준 통과 시 채택
- 실패 시 prototype은 기본 경로로 승격하지 않고 현재 저장 최적화안으로 복귀

### Phase 5 — typed route·entity·property·state projection

**목적:** 그래프를 정리할 수 있는 범용 backend 좌표를 만든다.

**변경 파일**

- `Normalizer.java`
- `ResourceReference.java`
- 신규 `EntityReference.java`
- 신규 `PropertyReference.java`
- 신규 `StateObservation.java`
- `DataFlowAnalyzer.java`
- `ObservationCollapser.java`
- `RouteCandidate*`, discovery adapter
- parser·corpus 테스트

**작업**

1. raw path와 canonical route를 분리해 projection에 저장한다.
2. path/query/header/body/response의 typed field path를 추출한다.
3. parent/child entity 관계와 applicable entity set을 만든다.
4. request/response property set과 readback 후보를 만든다.
5. typed DataFlow를 우선하고 substring은 `HEURISTIC` fallback으로 낮춘다.
6. 고빈도 entity 값은 개별 노드가 아니라 entity type group으로 접고, 선택 시 실제 값과 Evidence를 펼친다.

**Exit gate**

- `/orders/101`, `/orders/202`는 근거가 있을 때만 `/orders/{id}`로 묶임
- 원 path·실제 entity 값·Evidence는 손실되지 않음
- nested/array/GraphQL/XML/multipart fixture에서 applicable entity가 추적됨
- graph node 감소량과 entity precision/recall을 fixture에서 공개

### Phase 6 — durable 3-way run과 incremental candidate universe

**목적:** 세 lane 비교와 dataset lock을 내구성 있게 만든다.

**변경 파일**

- `RunContextRegistry.java`
- `integration/ZapClient.java`
- `integration/LocalLlmRunner.java`
- `integration/McpServer.java`
- `integration/SessionBroker.java`
- `web/FlowScopeWebServer.java`
- run/dataset lock 테스트

**작업**

1. run/stage/alert/llm execution/dataset lock을 저장 정본으로 만든다.
2. source별 완료 조건을 코드와 UI에 같은 상태 machine으로 표현한다.
3. lane 재시작 시 과거 완료와 lock을 무효화한다.
4. Explorer pre-lock view는 자기 run Evidence만 projection한다.
5. lock member에는 exact Evidence revision과 analysis policy version을 기록한다.

**Exit gate**

- reload 뒤에도 완료·warning·failure·lock 의미가 유지됨
- 다른 lane 정보가 Explorer pre-lock MCP에 노출되지 않음
- 0 Evidence LLM, partial ZAP, 종료하지 않은 HUMAN이 완료로 계산되지 않음

### Phase 7 — authorization·workflow candidate engine

**목적:** 규칙으로 설명 가능한 후보를 만들되 확정으로 과장하지 않는다.

**변경 파일**

- `AuthorizationAnalyzer.java`
- `AuthorizationAnalysis.java`
- `ResponseEvidence.java`
- 신규 `FindingCandidate.java`
- 신규 candidate rule modules
- category별 fixture 테스트

**작업**

1. BOLA/BFLA 후보를 applicable entity와 role policy에 연결한다.
2. auth/state/order/duplicate/method/property/exposure/rate-limit 후보 모듈을 분리한다.
3. 후보마다 missing prerequisite를 표시한다.
4. 임의 단일 risk score 대신 reason code와 사전식 우선순위를 사용한다.
5. 사용자 정책·owner·role 변경 시 영향 candidate만 재계산한다.

**Exit gate**

- 후보마다 입력 Evidence와 누락 조건 추적 가능
- status-only finding 0
- owner/role 미확정이 안전으로 폐기되지 않고 unresolved로 남음
- category fixture confusion matrix 공개

### Phase 8 — safe experiment와 Validation Bundle

**목적:** 후보를 통제 재현·정상 대조로 검증한다.

**변경 파일**

- 신규 `SafeExperimentPlanner.java`
- 신규 `Mutation.java`
- 신규 `DifferentialReplay.java`
- 신규 `ReadbackObserver.java`
- 신규 `ValidationBundle.java`
- `ActiveTrafficGuard.java`
- `McpServer.java`
- Web request lab와 validation 테스트

**작업**

1. category별 최소 mutation과 control plan을 만든다.
2. state-changing·temporal 실험에 승인과 budget을 강제한다.
3. 원 요청, 변조 요청, 반복, 정상 대조, readback을 같은 bundle로 묶는다.
4. validation Evidence는 discovery coverage를 늘리지 않는다.
5. candidate와 무관하거나 과거 dataset의 Evidence 제출을 서버가 거부한다.

**Exit gate**

- exact scope, redirect, TLS, timeout, request budget 회귀
- BOLA/BFLA/property/state fixture에서 재현과 control 구분
- 부족한 bundle은 항상 `INCONCLUSIVE`

### Phase 9 — Evidence-bound Judge 완결

**목적:** LLM이 분석과 설명은 하되 서버 판정 경계를 넘지 못하게 한다.

**변경 파일**

- `LocalLlmRunner.java`
- `McpServer.java`
- validation decision model
- Judge Web API/UI contract
- LLM protocol tests

**작업**

1. Judge 입력을 graph image나 전체 XML 하나가 아니라 잠긴 typed summary + Evidence tool로 제공한다.
2. Judge가 요청할 수 있는 replay/readback을 candidate와 approval 범위로 제한한다.
3. 서버가 Validation Bundle을 검증한 뒤에만 final verdict를 저장한다.
4. Judge 설명에는 사용 Evidence, 미확정 조건, 재현 절차, control 결과를 강제한다.

**Exit gate**

- 모델이 `CONFIRMED`를 주장해도 bundle 부족 시 서버 저장 거부
- 새 Judge session과 Explorer session 분리
- provider failure 뒤 partial verdict가 확정으로 남지 않음

### Phase 10 — protocol 확장

**목적:** HTTP 기본선이 안정된 뒤 관측면을 확장한다.

**순서**

1. GraphQL operation/variables/schema evidence
2. WebSocket message 단위 관측과 source attribution
3. SSE feasibility spike
4. gRPC/protobuf metadata

WebSocket은 Montoya가 제공하는 message 단위에서 시작하며 임의 frame reassembly를 만들지 않는다. SSE의 실시간 event body 관측은 API 제공 여부와 실제 fixture를 확인하기 전 완료 기능으로 약속하지 않는다.

**Exit gate**

- 각 protocol이 HTTP coverage를 오염시키지 않음
- provenance와 payload 경계가 동일하게 적용됨
- fixture 없는 protocol 추론 규칙을 추가하지 않음

### Phase 11 — blind benchmark와 release gate

**목적:** 구현량이 아니라 실제 발견·검토 비용·안정성을 평가한다.

**실험**

1. blind local fixture
2. crAPI fresh seed
3. 공개된 다른 허가형 benchmark 1개 이상
4. HUMAN-only, ZAP-only, LLM-only, HUMAN+ZAP, 3-way+Judge 비교
5. 주요 projection/candidate feature ablation

**측정값**

- endpoint/operation precision·recall은 `U_truth`가 있는 benchmark에서만
- entity extraction precision·recall
- source별 unique/shared discovery
- candidate precision, confirmed precision, unresolved 수
- REVIEW 건수와 사용자 처리 시간
- false positive·false negative
- 요청 수, 실행 시간, peak heap, DB 크기, snapshot latency
- 재현 성공률과 control 누락률

**Release gate**

- fresh clone 문서만으로 macOS·Windows 최소 환경에서 설치 가능
- Burp Community load/unload·port release 통과
- 실제 HUMAN long run과 save/reopen 통과
- ZAP/LLM 미설치·로그아웃·중단 오류가 복구 행동과 함께 표시
- benchmark raw result와 한계를 문서화

## 15. 파일별 예상 변경 지도

| 영역 | 기존 파일 | 예상 변경 |
|---|---|---|
| Burp capture | `FlowScopeExtension`, `InFlightRequestTracker` | lifecycle adapter, callback 최소화, ingest queue |
| raw payload | `HttpMessageTextCodec`, `TransientExchangeVault`, `StoredPayload` | byte 정본·blob ref·metadata-only reason 통일 |
| compatibility | `RequestRecord`, `Pipeline`, `RecordMerge` | adapter와 old/new diff, live 정본 역할 제거 |
| classification | `TrafficClassifier`, `TrafficClassification`, `TrafficOverride` | 근거형 cascade와 incremental invalidation |
| route | `Normalizer`, `RouteCandidate*`, `discovery/*` | universe·template evidence·projection version |
| entity/property | `ResourceReference` 및 신규 모델 | 다중 entity·field path·property·relation |
| dependency/state | `DataFlowAnalyzer`, `ObservationCollapser` | typed provenance와 state observation |
| identity/policy | `AnalysisConfig`, `SessionBroker`, `AccountProfile` | immutable projection, binding 재계산, atomic policy revision |
| authorization | `AuthorizationAnalyzer`, `ResponseEvidence` | structured oracle, candidate와 verdict 분리 |
| graph | `FlowGraphBuilder`, `SnapshotJsonWriter` | projection 소비, group/expand metadata |
| storage | `ProjectStore`, `SqliteProjectStore` | live store spike, migration, run truth |
| ZAP | `ZapClient` | durable stage/alert/import truth |
| LLM/MCP | `LocalLlmRunner`, `McpServer` | locked projection, experiment/bundle tools |
| Web | `FlowScopeWebServer` | revision/cache/health/run/experiment API |

## 16. 테스트 전략

### 16.1 unit

- lifecycle state transition
- bounded queue/backpressure
- payload digest·dedup·masking
- route/entity/property/state extraction
- identity binding/unbinding
- structured response oracle
- candidate reason and prerequisites
- experiment budget/scope/approval

### 16.2 property·fuzz

- JSON/XML nesting and size limits
- delimiter가 포함된 stable key와 Evidence digest
- arbitrary path/query/body field
- duplicate/late/out-of-order callback
- malformed HAR/XML/OpenAPI/GraphQL

### 16.3 integration

- Burp callback → ledger → projection → Web
- import → ledger → projection
- ZAP campaign → stage truth → scanner Evidence
- LLM Explorer → own-run MCP → run completion
- dataset lock → Judge → controlled validation
- save → unload → reopen → same projection

### 16.4 performance

- record scale 1k/10k/50k/100k
- payload mix small/large/binary/compressed
- Web reader와 writer 동시 부하
- queue saturation과 recovery
- graph group/expand snapshot cost

### 16.5 manual

- Burp Community 실제 Browser·Repeater·Intruder·Target
- 두 일반 계정의 login/cookie rotation
- ZAP Desktop과 Docker 중 한 방식씩
- Codex Explorer와 Judge 실제 구독 로그인
- 확장 unload 후 child/port/raw vault 정리

## 17. migration과 rollback

1. 새 schema는 기존 project를 읽되 원본 파일을 덮어쓰기 전에 backup 또는 새 파일로 저장한다.
2. `RequestRecord` export를 최소 한 release 동안 유지한다.
3. old/new projection을 같은 corpus에서 비교하고 차이를 machine-readable report로 남긴다.
4. 새 live store가 gate를 통과하지 못하면 feature flag를 끄고 기존 memory+snapshot 경로로 복귀한다.
5. projection은 원 Evidence에서 재생성할 수 있어야 하며 projection row만으로 원 Request/Response를 복원하려 하지 않는다.
6. 데이터 손실, secret persistence, source/run attribution 오류가 발견되면 해당 phase를 중단하고 다음 기능을 진행하지 않는다.

## 18. 위험과 대응

| 위험 | 대응 |
|---|---|
| callback에서 masking을 하면 느리고, queue 뒤에서 하면 raw가 queue에 머묾 | Phase 0에서 두 경로를 측정하고 raw lifetime·queue encryption이 아니라 최소 byte 보유와 vault 분리를 검증한 뒤 결정 |
| SQLite writer가 Burp를 방해 | callback non-blocking, bounded queue, batch, commit barrier 제한, feature flag |
| projection 불일치 | revision, policy version, input Evidence trace, full rebuild verifier |
| route/entity 과병합 | evidence level, literal 보존, user split/merge override, benchmark confusion matrix |
| graph가 다시 복잡해짐 | backend group key와 drill-down을 먼저 설계하고 UI는 projection을 그대로 소비 |
| LLM이 다른 lane 정보를 봄 | server-side run view와 dataset lock, prompt 약속에 의존하지 않음 |
| 실험이 대상을 변경 | risk classification, approval, request budget, normal control, readback, exact scope |
| 사용자 검토량 증가 | REVIEW reason grouping, repeated Evidence collapse, 우선순위 reason 공개 |
| 기존 project 호환성 파손 | compatibility adapter, migration fixture, rollback export |

## 19. 진행 중단 조건

다음 중 하나라도 발생하면 임의 예외 규칙을 추가해 넘어가지 않고 원인을 보고한다.

- raw credential이 project, DB, log, snapshot, MCP에 남음
- source/run/account attribution이 요청 시점과 달라짐
- provenance 없는 route/entity/candidate 생성
- candidate가 Request/Response 없이 verdict를 가짐
- benchmark 정답이 제품 규칙이나 Explorer prompt에 유입
- callback 지연 또는 heap 증가가 기준선보다 악화되고 원인을 설명하지 못함
- 새 저장 구조에서 crash recovery 또는 migration 실패
- old/new diff를 단순히 새 결과가 맞다고 가정해야만 통과함
- 실제 Burp에서 재현되지 않는 자동 테스트만 통과

### 19.1 범위 이탈 방지 규칙

새 작업은 착수 전에 반드시 `Phase`, 변경할 파일, 실패 fixture, Exit gate 네 항목을 가져야 한다. 네 항목 중 하나라도 없으면 구현하지 않고 backlog로 보낸다.

다음 요청은 정해진 시점 전까지 보류한다.

- UI 색·레이아웃 전면 변경: Phase 5 backend grouping이 안정된 뒤 별도 UX 계획
- 새 protocol 지원: Phase 10 전 금지
- 숫자 risk score·학습 모델: Phase 11 benchmark와 calibration 자료 전 금지
- 서버/SaaS·다중 사용자: 현재 로컬 제품 release gate 전 금지
- 외부 OSINT·Wayback·정답 저장소: 본 연구의 독립 3-way 범위에서 제외
- 새로운 scanner 기능: ZAP 안전 기준선·stage truth 회귀와 충돌하지 않는 별도 승인 작업으로 분리

중간에 발견된 결함은 다음 두 종류로만 처리한다.

1. 현재 Phase의 정확성·보안·데이터 손실을 막는 blocker면 같은 Phase에서 fixture를 먼저 추가하고 수정한다.
2. 현재 Exit gate와 무관하면 파일·증거·영향을 backlog에 기록하고 다음 Phase에 끼워 넣지 않는다.

## 20. 문서·버전·커밋 규칙

각 phase에서 다음을 함께 갱신한다.

1. `architecture.md`: 실제 구현된 현재 구조만 기록
2. `decisions.md`: 채택·기각한 설계와 근거만 append
3. `development-log.md`: 변경 파일, 이유, 테스트, 미검증 항목
4. `beta-validation.md`: 자동·수동 결과와 한계
5. `README.md`·`getting-started.md`: 사용자 행동이 바뀐 경우에만 수정
6. `HANDOFF.md`: 현재 완료 phase와 다음 gate

한 phase는 가능한 한 다음 커밋 단위로 나눈다.

```text
test: 실패 fixture와 기준선
feat/refactor: 최소 구현
test: 회귀·부하·통합
docs: 실제 구현 상태와 한계
build: 버전·JAR·artifact 검증
```

계획만 세운 상태에서는 버전과 JAR을 올리지 않는다. 코드와 문서가 검증 gate를 통과한 뒤에만 beta 버전을 올리고 단일 release JAR을 생성한다.

## 21. 최종 완료 정의

다음 조건을 모두 만족해야 이 계획을 완료로 본다.

- 원 Evidence와 파생 분석이 분리되어 있고 과거 관측을 새 policy로 재계산할 수 있다.
- 장시간 수집에서 hard-stop 없이 bounded resource와 명시적 degradation으로 동작한다.
- route·identity·entity·property·state·dependency가 provenance와 함께 저장된다.
- 그래프는 많은 객체 값을 group으로 정리하면서 원 Evidence drill-down을 보존한다.
- HUMAN·SCANNER·LLM run과 dataset lock이 저장·복구 후에도 일관된다.
- 11개 후보 유형이 각각 필요한 조건과 안전 실험 계획을 가진다.
- final verdict가 반복 재현·정상 대조·readback을 포함한 current Validation Bundle에 묶인다.
- blind benchmark에서 정확도뿐 아니라 REVIEW 비용, unresolved, 자원 사용량을 공개한다.
- fresh clone 사용자가 문서만으로 설치·수집·3-way 실행·판정 근거 확인까지 수행할 수 있다.
- 아직 검증하지 않은 기능과 성능을 완료·우위로 표현하지 않는다.

## 22. 첨부 `flowscope-review.html` 검증 장부

### 22.1 검증 방법과 해석 제한

- 첨부 문서는 `1.2.0-beta.25`, 198 tracked files를 대상으로 작성된 리뷰다. 이 장부를 처음 작성한 대상은 `1.2.0-beta.29`, 201 tracked files이었다. 해당 파일 수·버전·테스트 수는 역사적 재검증 기준선이지 beta.32의 현재 수치가 아니다.
- beta.29 장부 작성 당시 macOS `mvn -q clean verify` 결과는 **258 tests, failure 0, error 0, skipped 0**이었다. beta.32의 현재 정본은 **275 tests, failure 0, error 0, skipped 0**이며 정확한 JAR 수치는 `beta-validation.md`를 따른다. 두 결과 모두 suite 통과 사실이지 아래 입력 결함의 부재를 뜻하지 않는다.
- 코드 정적 확인만으로 충분하지 않은 항목은 beta.29 코드와 beta.28 실실행 실패 로그로 재현했다. beta.32 교차 구현은 현재 회귀로 다시 확인했으며, 외부 API 계약은 공식 ZAP 문서와 로컬 ZAP 2.17 API form으로 대조했다.
- 리뷰의 “전 파일 100% 정독”, 심각도 개수, 과거 Windows “정확히 7개 실패”는 리뷰 작성자의 메타 주장이다. 제품 동작 사실이나 새 acceptance criterion으로 사용하지 않는다.
- 아래 18개 finding을 하나도 삭제하지 않았다. 이미 해결됐거나 조건부인 항목도 상태와 미채택 이유를 남겨 추적 가능하게 한다.

### 22.2 finding별 현재 판정

| ID | beta.29 재검증 판정 | 확인 근거 | beta.32 이후 계획 반영 |
|---|---|---|---|
| C1 | **확정** | live capture와 달리 Proxy History import loop가 canonical scope 검사 없이 `recordFrom`을 호출한다. | Phase -1A exact-scope hotfix와 adapter 공통 회귀 |
| C2 | **확정·실행 재현** | `Proxy-Authorization: Basic dXNlcjpwYXNz`가 `Proxy-Authorization: ***MASKED*** dXNlcjpwYXNz`로 남는다. | Phase -1A credential header 전체 값 마스킹·출력 경로 secret scan |
| F1 | **확정·실행 재현** | 구조화 JSON 파싱 뒤 raw body regex를 다시 실행해 `{"text":"... productId: 5"}`에서 `products:5`를 생성한다. | Phase -1B parser-success/fallback 분리와 음성 fixture |
| F2 | **확정·실행 재현** | `RecordMerge.Key`가 identity/account/run을 제외해 같은 HTTP 내용의 서로 다른 계정 관측 중 하나를 누락한다. | Phase -1B provenance-aware dedup |
| F3 | **확정·실행 재현** | 신규 capture가 material을 가진 상태에서 403만 받아도 `responseConfirmed`가 되고 종료 시 `ACTIVE`가 된다. | Phase -1B session activation contract |
| F4 | **부분 확정, 원문 표현은 과장** | charset 미선언 invalid UTF-8은 분석 text를 잃는다. 다만 live traffic 원 bytes는 현재 bounded raw vault에 일시 보존되므로 “원문이 항상 완전히 소실”은 사실이 아니다. XML import에는 replacement decode 경로도 있다. | Phase -1C characterization, Phase 1·2 byte/payload 계약 |
| F5 | **행동 확정, 오탐 여부는 응답 의미에 의존** | 200 root `message`의 `not allowed`가 soft deny로 판정된다. 실제 오류 envelope일 수도 있어 문자열 제거만으로 고치지 않는다. | Phase -1C fixture, Phase 7 구조·control 기반 oracle |
| F6 | **행동 확정, 영향은 schema 의존** | 재귀 owner collector가 `userId`, `accountId`, `authorId`를 관계 의미 없이 owner 후보로 취급한다. | Phase -1C fixture, Phase 5 typed OWNER/ACTOR/CREATOR relation |
| F7 | **확정 가능한 동시성 귀속 결함** | SCANNER traffic이 전역 current run을 조회하므로 ZAP campaign 중 Burp native Scanner traffic이 같은 run/account/trust를 상속할 수 있다. | Phase -1B capture-channel/campaign lease 상관관계 |
| F8 | **확정** | FlowScope AJAX call은 `url`만 보내며 ZAP 2.17이 제공하는 `inScope`, `contextName`, `subtreeOnly`를 전달하지 않는다. “항상 외부를 돈다”까지는 미실측이지만 exact subtree를 강제하지 않는 것은 확정이다. | Phase -1A capability-gated exact-context AJAX invocation |
| F9 | **리뷰 자체 정정, 현재 결함 아님** | server-side Explorer snapshot/MCP isolation gate가 존재한다. | 새 수정은 넣지 않고 Phase 6·9 regression invariant로 유지 |
| F10 | **확정** | Burp XML `serviceOf`의 colon split이 IPv6 authority를 잘못 파싱한다. | Phase -1B canonical authority parser와 IPv6 fixtures |
| F11 | **확정된 설계 부채** | JWT payload의 `sub`를 signature·issuer·audience 검증 없이 fingerprint hint로 사용한다. | Phase -1C/Phase 5에서 unresolved hint로 격하, 검증 근거 없는 병합 금지 |
| F12 | **경합 가능성 확인, 실제 발현은 미재현** | rebuild publish 전에 dataset/config revision 검사가 없어 clear 뒤 오래된 snapshot을 게시할 수 있는 순서가 존재한다. | Phase -1C deterministic latch test 후 재현될 때만 compare-and-publish 수정 |
| F13 | **확정** | executable 탐색이 Windows `.cmd`·`.exe`·`PATHEXT`를 처리하지 않고 Windows CI는 PowerShell parse만 수행한다. 과거 “7 failures” 수치는 현재 검증하지 못했다. | Phase -1B resolver seam과 Windows 전체 Maven CI |
| F14 | **확정** | Request Lab A fetch를 취소·세대 검증하지 않아 늦은 A 응답이 B 편집기를 덮을 수 있다. | Phase -1A immutable draft·generation token·abort |
| F15 | **확정** | 전송 중 account selector가 렌더링을 다시 호출해 send button을 재활성화할 수 있고 global draft 값도 바뀔 수 있다. | Phase -1A in-flight lock·idempotency·immutable send snapshot |
| F16 | **확정된 표시 결함** | candidate가 없어도 empty cell을 “IDOR 교차 후보”로 표시한다. | Phase -1B candidate 존재 기반 label과 중립 상태 |

### 22.3 문서·메타 주장 판정

| 첨부 리뷰 주장 | 현재 판정 | 처리 |
|---|---|---|
| MCP `serverInfo`가 beta.10 | **beta.28에서 해결됨** | beta.32에서도 회귀만 유지하며 hotfix 작업에는 넣지 않음 |
| 기능명세 이미지 24장이 모두 FlowGap UI | **사실 아님** | F01~F24용 PNG 25개는 구형 FlowGap과 FlowScope 화면이 혼재한다. 자산 노후화 문제는 맞으므로 backend/UI contract 안정화 후 전량 재촬영 |
| F06 숫자 confidence·threshold와 현재 categorical 원칙 충돌 | **확정** | 명세에 superseded 표시 후 categorical evidence/review 계약으로 정리 |
| F10 최저 성공 role 자동 추론과 현재 evidence-backed/manual 원칙 충돌 | **확정** | silent required-role 확정을 금지하고 candidate+근거+사용자 확정 계약으로 정리 |
| README의 exact scope·credential 비저장·성공 응답 세션 확정 서술 | **현재 코드와 불일치 확인** | 원칙을 약화하지 않고 Phase -1 코드 수정 후 실제 동작에 맞춰 README·architecture·validation을 동시 갱신 |
| beta.25에서 236/243, Windows 7 failures | **현재 사실로 검증 불가** | 숫자는 이 계획의 기준선에서 제외. 현 버전 OS별 전체 CI 결과를 새로 측정 |

### 22.4 외부 계약 근거

- OWASP ZAP AJAX Spider Scan dialog는 in-scope, context, subtree 제한 설정을 제공한다: <https://www.zaproxy.org/docs/desktop/addons/ajax-spider/scandialog/>
- OWASP ZAP Client Spider API는 `subtreeOnly`와 `scopeCheck=STRICT`를 제공하며 modern app에는 Client Spider 사용을 권장한다: <https://www.zaproxy.org/docs/desktop/addons/client-side-integration/spider-api/>
- 따라서 FlowScope는 ZAP context를 생성했다는 이유만으로 exact scope를 충족했다고 간주하지 않고, 각 spider 호출에 해당 제한을 명시하고 실제 관측 URL을 재검사해야 한다.

## 23. 착수 순서 요약

```text
Phase -1 검증된 안전·정확성 hotfix
  ↓
Phase 0  측정·fixture 동결
  ↓
Phase 1  ObservedExchange lifecycle
  ↓
Phase 2  Evidence ledger·backpressure
  ↓
Phase 3  projection cache·snapshot 재분석 제거
  ↓
Phase 4  live SQLite 채택/기각 spike
  ↓
Phase 5  route·entity·property·state·typed dependency
  ↓
Phase 6  durable 3-way run·dataset lock
  ↓
Phase 7  설명 가능한 candidate engine
  ↓
Phase 8  safe experiment·Validation Bundle
  ↓
Phase 9  Evidence-bound Judge
  ↓
Phase 10 protocol 확장
  ↓
Phase 11 blind benchmark·release
```

beta.32 이후의 다음 실제 개발은 `HANDOFF.md`에 남은 P1을 Phase -1 실패 fixture로 다시 확인하는 것부터 시작한다. beta.32에서 이미 구현한 목적별 trust, exact completed run, Evidence ID 동결, JSON v3·SQLite v2 저장은 되돌리거나 중복 구현하지 않고 Phase 6의 기준선으로 사용한다. 남은 P1을 닫은 뒤 Phase 0의 post-hotfix 기준선을 다시 측정한다. 저장 구조, 분석 모델, UI를 동시에 뜯지 않으며 lifecycle과 정본을 먼저 바꾼 뒤에만 route·entity·state와 취약점 실험 계층을 확장한다.
