# LLM Judge·MCP 제거 상태와 후속 계획

구현 이력: `c006679` → ZAP 분리 `5a47af9` → D-126 제거 `57d1bb4` → 빈 디렉터리 정리 `962edfe` → D-128 독립 Explorer → D-132·133 Client-only ZAP `7353144` → D-135 Docker Chromium runtime. 이 경로는 beta.47 이후 배포에 포함돼 있다. 배포 코드·검증 수준은 [현재 인계](HANDOFF.md)와 D-153을 따른다.

## 현재 목표

기존 LLM Judge와 하네스용 MCP는 D-126에서 실제로 삭제했다. D-128은 Judge/MCP를 복원하지 않고 Codex app-server dynamic tool과 Java exact-scope gateway를 사용하는 **별도 Explorer**를 구현했다. 미래 MCP는 Explorer 실행 하네스가 아니라 FlowScope Evidence·분석용 제품 연동으로만 검토하며 현재 구현하지 않는다.

HUMAN·SCANNER·LLM source, 기존 Evidence, endpoint·parameter 분석, 인가 규칙, 사람 검토, Session Broker, Request Lab과 프로젝트 저장은 보존한다. 새 Explorer의 자격증명/session은 별도 메모리 vault에 있고 프로젝트에 저장하지 않는다.

## 단계별 상태

| 단계 | 산출물·완료 조건 | 상태 |
|---|---|---|
| 1 | ZAP 캠페인 실행·상태·취소를 `ZapCampaign`으로 추출; Web 직접 호출 | `5a47af9` 완료 |
| 2 | Judge role·prompt·후속 세션·UI·dataset lock·최종 verdict 제출 제거 | D-126 구현, Java/React 자동 회귀 통과 |
| 3 | 기존 MCP transport·token·runner·격리 브라우저·설정·doctor 검사 제거; 저장 모델 독립 | D-126 구현, 클래스/리소스 및 HTTP endpoint 부재 회귀 통과 |
| 4 | ZAP 브라우저 탐색 Client 필수화와 Traditional/AJAX 제거 | D-132 구현. 선택적 정의 import → 선택적 로그인 → strict Client → Passive → Alert; 자동 fallback 없음. 실제 Burp 8081 익명 Client 완주 확인, 로그인 계정·Windows gate 대기 |
| 5 | 별도 Explorer 하네스 설계 | D-128/D-139 구현·자동 회귀 완료. 당시 provider 실물 검증은 beta-validation에 보존하며 현재 실제 Burp 운영 gate는 별도 |
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

자동 검증 결과·산출물 식별값은 [beta-validation](beta-validation.md)의 D-126~133 항목에 나눠 기록한다. `RetiredHarnessTest`는 삭제 전 존재 검사 실패(RED), 삭제 후 clean classpath 부재를 검사하며 최종 JAR도 별도로 검사한다. Web 회귀는 폐기 API 404·과거 기록 read-only·마스킹·날짜·현재 후보 분리를 확인한다. JSON/SQLite 왕복, HUMAN 완료·계정·scope·Request Lab과 독립 ZAP 캠페인 회귀를 유지한다.

ZAP 자동 테스트는 로컬 가짜 API와 합성 Evidence로 **FlowScope의 호출·상태 처리**를 확인한다. D-135에서 별도로 실물 Docker Chromium/ChromeDriver 기동과 비로그인 Client HTTP 200 수집까지 확인했지만 capability 전달, 로그인 상태, 복수 계정 귀속, Windows 동작을 증명하지 않는다. D-132 회귀는 Client 단일 호출, 0건 실패, timeout·취소 시 stop/terminal 확인을 검사한다. 다만 start API 반환과 취소가 겹치는 모든 타이밍이나 실제 브라우저 프로세스의 시작/취소 경합을 검증한 것은 아니다.

D-127 문서 전수 대조에서 발견용 MIME과 JS parser 사이의 분석 입력 연결 문제가 확인됐다. 이 제거 작업 자체가 해결한 것은 아니며, 후속 D-128에서 발견용 HTML/JavaScript/JSON/XML을 기본 4MiB까지 `FULL` payload로 보존하고 1.4MiB capture→record 회귀를 추가해 닫았다. 4MiB 초과와 동적 의미 해석은 [HANDOFF](HANDOFF.md)의 현재 한계로 남는다.

다음 gate는 새 JAR의 실제 Burp load/unload, HUMAN pass·로그인 캡처, ZAP 비로그인/로그인 lane·진행/취소, 기존 프로젝트 재열기다. 이 변경만으로 실물 gate, 성능·발견률·오탐률 개선을 완료했다고 주장하지 않는다.
