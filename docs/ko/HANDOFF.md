# FlowScope 팀 인계 정본

최종 갱신: 2026-09-07. 구현 기준 `57d1bb4`(Judge·하네스 MCP 제거), 빈 디렉터리 정리 기록 `962edfe`. 이 문서는 **현재 진행상황과 다음 gate**만 기록한다. 예전 실행법·상세 연혁·리뷰 원문은 [2026-09-04 인계 보존본](handoff-2026-09-04.md)으로 분리했다.

## 1. 현재 인수인계 상태·목표·범위

FlowScope는 허가된 범위에서 실제 HTTP 관측과 OpenAPI·HTML·JavaScript 선언을 endpoint·parameter로 정렬해, 진단자가 어느 입력을 아직 보지 못했는지 원 Evidence와 함께 확인하는 Burp 확장이다. 선택 API의 신원·접근 대상 ID·소유자·역할 비교는 인가 상세층이다. 미관측·gap·2xx만으로 취약점을 확정하지 않는다.

- **현재 실행:** HUMAN 수집/명시적 Request Lab, 독립 ZAP 캠페인.
- **보존 데이터:** HUMAN·SCANNER·LLM source, 기존 Evidence·계정 메타데이터·정책·완료 run·실행 원장·사람 검토.
- **제거 완료:** 기존 Judge, Explorer 실행기, MCP transport/토큰/리스너, CLI 탐지·로그인·후속 세션, 격리 브라우저, agent-workspace 설정·프롬프트·디렉터리. 옛 실행 API는 404이며 성공 stub이 아니다.
- **과거 LLM:** `LegacyAssessment`·`ValidationDecision`은 저장 호환용 읽기 전용 기록이다. 현재 규칙 후보의 결론으로 합치지 않는다.
- **미착수:** 별도 Explorer 하네스, FlowScope Evidence·분석용 제품 MCP. 새 MCP를 지금 만들거나 옛 실행기를 되살리지 않는다.
- **ZAP 미변경:** Traditional → Client → AJAX 보완 → Passive → Alert. Client-only/AJAX 제거는 아직 하지 않았다.

사용자 전역 모델 설정·인증 파일, 사용 중인 Burp/ZAP, 다른 Claude worktree와 서드파티 패키지 내부 MCP 파일은 제거 대상이 아니었다. 구버전 확장이 실제로 실행 중이라면 새 소스의 삭제 사실만으로 그 프로세스·포트까지 종료됐다고 판단하지 않는다.

## 2. 진행상황

| 작업 | 현재 상태 | 근거 / 남은 확인 |
|---|---|---|
| ZAP 캠페인 분리 | 구현 완료 | `5a47af9`, 호스트 소유 `ZapCampaign`, Web 직접 호출 |
| 기존 Judge·하네스 MCP 제거 | 구현·자동 회귀 완료 | `57d1bb4`, 클래스/JAR 부재·폐기 route 404 |
| 과거 프로젝트 호환 | 구현·자동 회귀 완료 | JSON v4 / SQLite v3, 원 Evidence ID·과거 평가 분리 |
| 빈 agent-workspace 정리 | 완료 | `962edfe`, 정확한 빈 디렉터리만 제거 |
| 문서 현행화 | 2026-09-07 정합성 갱신 | [전수 목록·확인 범위](documentation-status.md); 과거 기록과 현행 구분 |
| 새 JAR 실제 Burp/ZAP 검증 | 미실행 | 아래 gate, mock/standalone으로 대체하지 않음 |
| Client 필수화·AJAX 제거 | 미착수 | 실제 Client/capability/로그인·취소 확인이 선행 |
| 새 Explorer / 제품 MCP | 미착수 | 별도 설계, 현재 설치·실행법 없음 |
| 독립 corpus·외부 pilot | 미실행 | 내부 fixture는 구조 회귀일 뿐 발견률·오탐률 입증 아님 |

## 3. 검증과 배포 상태

[beta-validation의 D-126 기록](beta-validation.md)이 산출물 식별값과 실제 실행 검증의 정본이다.

- 같은 최종 코드에서 `mvn clean verify` 2회: 매회 Java 335 tests, React 37 files / 238 tests 통과. 삭제된 실행기의 테스트는 제거하고 ZAP 회귀는 독립 유지했다.
- 해당 JAR의 새 Chromium context standalone E2E: 8/8 통과. 외부 origin과 능동 요청을 차단한 UI 검증이며 실제 Burp나 실제 ZAP 크롤이 아니다.
- 이번 문서 정합성 작업은 코드·산출물을 바꾸지 않았다. JAR 해시만 다시 대조했으며 전체 빌드·E2E를 이번에 재실행한 것처럼 쓰지 않는다.
- 버전 문자열은 여전히 `1.2.0-beta.44`다. 같은 버전명의 이전 JAR과 동일하다는 뜻이 아니므로 commit·SHA-256으로 식별한다.
- 제거 변경은 로컬 커밋이며 이번 작업에서 push/Release 게시하지 않았다. 문서 점검 시 로컬 `origin/main` 참조는 `c006679`였고, 원격을 fetch해 최신 서버 상태를 확인한 것은 아니다.
- 실제 Burp load/unload, HUMAN 로그인/캡처, ZAP 비로그인·복수 로그인 lane, Request Lab 실제 전송, Windows 운영 검증은 새 JAR 기준 미실행이다.

## 4. 현재 구조와 코드 위치

| 기능 | 구현 위치 | 현재 책임 |
|---|---|---|
| Burp 수집·호스트 수명 | [FlowScopeExtension](../../src/main/java/io/flowscope/burp/FlowScopeExtension.java) | scope/run/계정 문맥, capture, Web·ZAP 소유 |
| ZAP 실행·상태·취소 | [ZapCampaign](../../src/main/java/io/flowscope/integration/ZapCampaign.java), [ZapClient](../../src/main/java/io/flowscope/integration/ZapClient.java) | MCP 없는 캠페인, 신원 격리·capability·정리 |
| 세션 | [SessionBroker](../../src/main/java/io/flowscope/integration/SessionBroker.java) | 명시적 HUMAN 캡처와 메모리 인증정보 재사용 |
| 분석·표면 | [Pipeline](../../src/main/java/io/flowscope/core/Pipeline.java), [SurfaceAnalyzer](../../src/main/java/io/flowscope/core/SurfaceAnalyzer.java), [RouteCandidateExtractor](../../src/main/java/io/flowscope/core/RouteCandidateExtractor.java) | 관측/선언 분리, 정규화·분류·인가 후보 |
| Web·UI | [FlowScopeWebServer](../../src/main/java/io/flowscope/web/FlowScopeWebServer.java), [SnapshotJsonWriter](../../src/main/java/io/flowscope/web/SnapshotJsonWriter.java), [React](../../frontend/src) | 기본 Surface, 선택 인가 상세, 현재 규칙·사람 검토, 과거 이력 |
| 저장 호환 | [ProjectStore](../../src/main/java/io/flowscope/integration/ProjectStore.java), [SqliteProjectStore](../../src/main/java/io/flowscope/integration/SqliteProjectStore.java) | 마스킹 데이터·schema 호환, raw 세션 비저장 |

빠른 시작은 `범위 → HUMAN → ZAP → Evidence 검토`다. LLM source 필터가 남았다고 자동 LLM 실행 기능이 남은 것은 아니다. 설치는 [시작 가이드](getting-started.md), 구체 계약은 [아키텍처](architecture.md)와 [Surface](endpoint-parameter-surface.md)를 따른다.

## 5. 미해결 결함·실환경 gate

### 문서 점검 중 코드에서 확인한 연결 결함

**대용량 발견용 응답이 분석기에 끝까지 전달되지 않는다.** `BoundedHttpCapture.previewLimitFor`는 발견용 MIME을 기본 4MiB까지 읽고 JS parser는 4,194,304자까지 받지만, `FlowScopeExtension.recordFrom`가 `body/respText`를 `MAX_BODY=8192`로 다시 자른다. 보존 상한 초과의 `responsePayload`는 전문이 없으므로 `RequestRecord.responseBodyForAnalysis()` → `RouteDiscoveryDocument.from` / `SurfaceAnalyzer`는 잘린 입력을 사용한다. D-122의 helper/parser 개별 통과를 live 파이프라인 전체 성공으로 확대할 수 없다.

- 확인 수준: 코드 호출 경로 대조. 이번에는 새 실패 테스트나 실제 대상 재현을 실행하지 않았다.
- 다음 확인: 외부 정답을 쓰지 않는 합성 대형 문서로 capture → record → 분석의 회귀를 먼저 작성하고, 전문 보존 상한·마스킹·메모리 경계를 유지하는 전달 방법을 정한다. 문서 작업에서 임의 코드 수정은 하지 않았다.
- 기존 한계: superagent·임의 wrapper와 일반 함수 간 URL 조립은 지원하지 않는다. parser 크기 상한을 높여도 이 의미 해석 문제가 해결되는 것은 아니다.

### 실환경 gate 및 이전 리뷰에서 이어받은 항목

- ZAP 시작 API 반환과 취소가 겹치는 race: 현재 취소 회귀는 scan ID 등록 후 상태 polling 중인 경우다. 모든 시작/취소 타이밍의 정리를 증명하지 않는다.
- ZAP Client/AJAX의 실제 capability 전달, 복수 계정 세션 격리, 다중 scope, 취소 후 crawler 정지: mock이 아닌 실제 환경으로 확인해야 한다.
- SessionBroker ACTIVE 의미·보조 쿠키 회전, 지문/계정 바인딩, owner 별칭, history 병합 키, 실패한 프로젝트 열기의 원자성, XML 문자셋·IPv6: 이전 인계의 정확성 항목을 그대로 **재검증 대기**로 승계한다. 이번 문서 작업에서 일괄 해결 또는 모두 현존한다고 단정하지 않았다. [이전 결함 목록](handoff-2026-09-04.md)을 코드와 항목별 재대조해야 한다.
- 제거한 LLM 프로세스 종료·Judge 동작은 현행 실행 gate에서 제외한다. 다만 과거 데이터 호환과 읽기 전용 표시 검사는 유지한다.
- 외부 pilot·전체 발견률·오탐/미탐률·성능 우월성은 미측정이다. 합성 테스트 통과로 수치나 완성률을 만들지 않는다.

## 6. 다음 작업·제품 결정 보류 사항과 완료 기준

1. **확인된 분석문 전달 문제와 기존 정확성 항목의 회귀 정리** → 재현 테스트·원인·수정 범위를 먼저 고정. 현재는 문서에 기록했으며 수정 미착수.
2. **새 JAR 보존 기능의 실제 Burp gate** → HUMAN pass/세션, ZAP 익명·로그인 lane, capability/정지/취소, Request Lab, 저장·재열기·unload를 기록. 실패는 계정·단계·Evidence와 함께 남기고 통과처럼 처리하지 않음.
3. **Client-only 변경 검토** → 지원 환경의 실제 Client 성공·실패·인증·정리 근거 후 별도 작업으로 진행. AJAX를 먼저 지우고 성공을 가정하지 않음.
4. **별도 Explorer 및 제품 MCP 설계** → 사용자와 책임·데이터 계약을 정한 뒤 구현. 지금은 포트·API·도구·새 실행기를 만들지 않음.
5. **독립 평가** → 승인된 범위와 독립 truth를 확보한 뒤 효능·부하·검토량 측정. 그 전에는 특정 대상 튜닝이나 지원 Tier 확대를 완료로 기록하지 않음.

## 7. 문서와 협업 운영

- 작업 시작 시 이 문서의 현재 상태·열린 항목, [제품 계획](product-development-plan.md), [개발 기록](development-log.md), [실제 검증](beta-validation.md)을 먼저 읽는다.
- 시작·중간 결과·검증·인계 시점마다 상태가 달라지면 같은 작업 단위에서 문서를 갱신한다. `구현 완료`, `자동 회귀 통과`, `실환경 통과`, `미착수`, `보류`를 분리한다.
- 파일별 정본·역사 여부·갱신 기준은 [문서 정합성·갱신 기준](documentation-status.md)에 있다. 구현 판단은 코드, 검증 주장은 명명된 artifact의 실행 기록을 근거로 쓴다.
- 사용자 요청: 진단자 편의, 일반적인 HTTP/선언 구조, 노이즈 최소화와 Evidence 보존을 우선한다. 모르는 것은 미확인으로 남기고, 모의 API 성공을 실물 성공으로 보고하지 않는다.
- 비공개 `mentor-progress-report.md`는 수정·커밋하지 않는다. 별도 Claude worktree·사용자 전역 설정은 이 작업의 정리 대상이 아니다. 루트 `CLAUDE.md`의 기존 사용자 인계 지침을 보존하면서 현재 실행 범위를 갱신한다.
