# LLM Judge·MCP 제거 상태와 후속 계획

기준: `c006679` → ZAP 분리 `5a47af9` → 2026-09-07 D-126 제거 작업. 미출시 소스 변경이며 이전 beta.44 배포물과 구분한다.

## 현재 목표

기존 LLM Judge와 하네스용 MCP를 실제로 삭제한다. Explorer는 **별도 하네스**로 이후 설계한다. 미래 MCP는 Explorer 실행 하네스가 아니라 FlowScope의 Evidence·분석을 이용하는 제품 연동으로 검토하되, **이번에는 구현하지 않는다**.

HUMAN·SCANNER·LLM이라는 source, 기존 Evidence, endpoint·parameter 분석, 인가 규칙, 사람 검토, Session Broker, Request Lab과 프로젝트 저장은 보존한다. LLM source 보존은 자동 LLM 실행기 보존을 뜻하지 않는다.

## 단계별 상태

| 단계 | 산출물·완료 조건 | 상태 |
|---|---|---|
| 1 | ZAP 캠페인 실행·상태·취소를 `ZapCampaign`으로 추출; Web 직접 호출 | `5a47af9` 완료 |
| 2 | Judge role·prompt·후속 세션·UI·dataset lock·최종 verdict 제출 제거 | D-126 구현, Java/React 자동 회귀 통과 |
| 3 | 기존 MCP transport·token·runner·격리 브라우저·설정·doctor 검사 제거; 저장 모델 독립 | D-126 구현, 클래스/리소스 및 HTTP endpoint 부재 회귀 통과 |
| 4 | ZAP 브라우저 탐색 Client 필수화와 AJAX 제거 | 미착수. 현재 Traditional → Client → AJAX → Passive 유지 |
| 5 | 별도 Explorer 하네스 설계 | 미착수. 공급자/도구/인증 방식을 이번에 정하지 않음 |
| 6 | FlowScope Evidence용 제품 MCP 설계 | 미착수. 현재 MCP 리스너나 대체 API stub 없음 |

## 제거한 것

- `McpServer`, `LocalMcpToken`, `LocalLlmRunner`, `ControlledBrowserExplorer`, Explorer 전용 `RouteCandidateViews`.
- Judge/Explorer start·cancel·resume·로그인 준비·브라우저·frontier·dataset lock·assessment/validation 제출 경로.
- `/api/llm-run`, `/api/ai-preview`, `/api/ai-scenarios`; 현재 404.
- 8787 리스너와 연결 복사·토큰 설정, agent-workspace의 Codex/Claude 설정·역할 지침·프롬프트와 JAR 리소스.
- MCP만 호출하던 개별 ZAP 제어/Active Scan 진입점. 기존 Web 캠페인 API는 유지.
- 제거한 실행 기능만 시험하던 회귀. ZAP 캠페인 회귀 13개는 MCP 없이 `ZapCampaignRegressionTest`로 이전.

사용자 전역 Codex/Claude 설정·인증 파일, 실행 중인 Burp·ZAP, 로컬 사용자 프로젝트는 삭제하지 않았다. 추적 소스 삭제는 Git 이력으로 복구할 수 있다.

## 보존·호환 계약

- `FlowScopeExtension`이 ZAP 캠페인 한 개를 소유한다. Web 시작·조회·취소와 reset/unload가 이를 직접 호출한다.
- `LoopbackHttpServer`는 Web에 필요하고 Jackson은 snapshot·저장·ZAP JSON에 필요하므로 유지한다.
- `LegacyAssessment`는 기존 저장 필드·마스킹·상한을 가진 데이터 타입이다. `ValidationDecision`은 과거 verdict를 읽는 기록일 뿐 판정 엔진이 아니다.
- JSON schema v4 / SQLite storage v3를 유지한다. assessments, validations, 원 Evidence ID·시각·완료 run·기존 사람 감사 기록·실행 원장을 읽고 다시 저장한다. 과거 판정을 현재 코드가 재검증했다고 표시하지 않는다.
- Snapshot `scenarios`는 현재 규칙 후보와 사람 검토만 제공한다. `legacyLlm.readOnly=true`는 과거 기록 구역이며 current finding에 합치지 않는다. 과거 assessment ID에 대한 새 review 저장은 거부한다.
- React 시나리오는 읽기 전용 과거 기록을 30개씩 펼친다. legacy UI는 현재 규칙 후보를 표시하고 과거 기록 열람은 React 작업면을 사용한다.
- Source/SourceDetail/Tool/RunPhase와 8082 직접 관측 호환을 보존한다. 직접 관측은 `UNVERIFIED_RUNTIME`으로 분석·완료에 승격하지 않는다.

## 검증 범위와 다음 gate

자동 검증 결과·산출물 식별값은 [beta-validation](beta-validation.md)의 D-126 항목에 기록한다. `RetiredHarnessTest`는 삭제 전 존재 검사 실패(RED), 삭제 후 clean classpath 부재를 검사하며 최종 JAR도 별도로 검사한다. Web 회귀는 폐기 API 404·과거 기록 read-only·마스킹·날짜·현재 후보 분리를 확인한다. JSON/SQLite 왕복, HUMAN 완료·계정·scope·Request Lab과 독립 ZAP 캠페인 회귀를 유지한다.

ZAP 테스트는 로컬 가짜 API와 합성 Evidence로 **FlowScope의 호출·상태 처리**를 확인한다. 실제 ZAP Firefox/확장, capability 전달, 로그인 상태, OS별 동작을 증명하지 않는다. 취소 회귀는 scan ID가 등록되어 status polling 중인 crawler를 대상으로 한다. start API 반환과 취소가 겹치는 모든 타이밍을 검증한 것이 아니며 Client-only 전환 전에 실제 시작/취소 경합도 확인해야 한다.

다음 gate는 새 JAR의 실제 Burp load/unload, HUMAN pass·로그인 캡처, ZAP 비로그인/로그인 lane·진행/취소, 기존 프로젝트 재열기다. 이 변경만으로 실물 gate, 성능·발견률·오탐률 개선을 완료했다고 주장하지 않는다.
