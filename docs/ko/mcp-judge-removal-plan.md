# LLM Judge·MCP 제거 계획

기준: `c006679`, 2026-09-07. 현재 변경은 미출시이며 기존 beta.44 배포 결과를 대체하지 않는다.

## 목적과 보존 범위

사용자 결정은 LLM Judge와 MCP를 제거하고 Explorer 하네스는 이후 다시 설계하는 것이다. HUMAN·SCANNER·LLM이라는 관측 source, 기존 Evidence, endpoint·parameter 분석, 인가 규칙, 사람 검토, Session Broker, Request Lab과 프로젝트 저장 기능은 제거 대상이 아니다. ZAP 브라우저 탐색은 최종적으로 Client Spider만 사용하며 AJAX fallback도 두지 않는다.

현재 ZAP은 MCP 프로토콜이 필요한 것이 아니라 실행 코드가 `McpServer`에 들어가 있다. 먼저 이 소유권을 분리해야 MCP 삭제가 ZAP 상태·취소·정리에 영향을 주지 않는다. 아직 정하지 않은 새 Explorer 하네스를 함께 구현하거나, MCP 삭제를 구독 CLI 인증 방식 변경과 묶지 않는다.

## 단계와 완료 조건

| 단계 | 변경 | 완료 조건 | 현재 상태 |
|---|---|---|---|
| 1 | `ZapCampaign` 추출, 정의 입력 타입 이동, 웹 직접 호출, 호스트 lifecycle | 기존 MCP 회귀와 독립 캠페인 테스트 통과. MCP bind 실패·adapter 종료가 공유 캠페인을 닫지 않음 | 구현·Java 389/React 266 전체 회귀 통과. 실물 ZAP gate는 대기 |
| 2 | Judge role·실행·후속 세션·prompt·UI·dataset lock 제거 | Judge를 시작할 경로 없음. HUMAN·ZAP 완료와 사람 검토 유지. 과거 project fixture load/save/reload | 미구현 |
| 3 | 공용 실행 원장·저장 모델 분리 후 MCP transport·token·config 제거 | 기존 MCP 리스너가 생성되지 않음. MCP 설정이 배포물·doctor에서 제거됨. 새 하네스 전까지 Explorer 실행은 전환 대기로 명시 | 미구현 |
| 4 | Traditional + Client + Passive 기본 경로, AJAX 실행 제거 | AJAX 시작 호출 0. Client 준비 실패·실행 실패·응답 없음 구분. 실물 Client 전송과 종료 확인 | 미구현 |
| 5 | 별도 Explorer 하네스 설계·구현 | 선택한 공급자에서 인증·실행·Evidence·취소 검증 후 활성화 | 설계 대기 |

## 1단계의 코드 계약

- `ZapCampaign`이 ZAP 캠페인 상태, 직렬 executor, heartbeat, crawler 소유권, lane별 시간·결과, capability cleanup, Alert snapshot을 보유한다.
- `ZapCampaign.State`는 scope, Session Broker, run contexts, 실제 캡처 수, 완료용 snapshot, Burp 승인과 capability callback만 제공한다. 기존 Judge dataset lock은 제거 전까지 호스트의 boolean callback으로 유지한다.
- `ZapDefinitionType`과 `ZapDefinition`은 `ZapCampaign`의 타입이다. Web parser는 MCP 타입을 참조하지 않는다.
- `FlowScopeExtension`이 캠페인 한 개를 먼저 만들고 웹과 기존 MCP adapter에 공유한다. MCP adapter의 `close()`는 외부에서 받은 캠페인을 닫지 않는다. 호스트의 unload가 캠페인을 닫는다.
- 기존 3인자 `McpServer` 생성자는 기존 테스트·호출 호환용으로 캠페인을 자체 소유한다. 이 경우에만 MCP close가 캠페인도 닫는다. MCP 삭제 단계에서 이 경로도 함께 삭제한다.
- 데이터 reset은 사용자가 명시한 전체 workflow 초기화다. MCP가 만들어지지 않은 경우에도 캠페인 reset을 수행한다.
- crawler 순서·HTTP 동작·JSON 필드·계정 귀속·scope 범위·완료 정책은 이번 추출에서 변경하지 않는다. 따라서 아직 Client와 AJAX가 모두 실행된다.

## Judge 제거 전에 정할 저장 호환

`ProjectStore`, `SqliteProjectStore`, `SnapshotJsonWriter`, Web state가 `McpServer.Assessment`를 참조한다. 삭제 전에 과거 판정을 수용하는 독립 데이터 타입을 정하고, 기존 project에 포함된 assessment/validation을 사람 판정으로 바꾸거나 조용히 버리지 않는다. 신규 Judge 결과 생성은 중단하되 과거 결과는 생성 시점·출처를 가진 읽기 전용 기록으로 유지한다. Evidence·정규화·사람 검토·실행 원장과 schema migration은 별도 회귀로 확인한다.

Judge 전용 `Role.JUDGE`, prompt, follow-up API, 공급자 resume 세션, UI 버튼, 시나리오의 Judge 안내, 잠금·최종 검증 도구를 함께 제거한다. `AuthorizationAnalyzer`, `ReviewDecision`, HUMAN `VALIDATION`과 기존 Response Evidence는 유지한다.

## MCP 제거 잔여 목록

- `McpServer`, `LocalMcpToken`, 8787 리스너와 토큰 안내.
- `agent-workspace/.mcp.json`, `.codex/config.toml`의 MCP 항목과 폐기되는 agent prompt. 다른 프로젝트·사용자의 전역 설정은 수정하지 않는다.
- runner의 MCP URL/token/tool-name 결합. Explorer 실행은 새 하네스가 연결되기 전까지 명시적 대기 상태로 둔다.
- Web·Standalone·저장소의 MCP 소유 타입 참조, doctor·설치 문서의 MCP 검사.
- MCP 전용 회귀. 실행 원장·Evidence·scope·세션·프로젝트 호환 회귀는 해당 소유 모듈로 옮겨 유지한다.

`LoopbackHttpServer`는 Web 서버에서도 쓰므로 남긴다. Jackson도 snapshot·프로젝트·ZAP JSON에 쓰므로 MCP와 함께 삭제하지 않는다. 계정 세션·HUMAN 수집·HAR/XML import·Surface/그래프를 새 하네스 설계에 맞춘다는 이유로 동시에 재작성하지 않는다.

## 검증과 한계

독립 `ZapCampaignTest`와 기존 `McpServerTest`는 `FakeZap`의 로컬 HTTP 응답 및 합성 Evidence로 호출·상태·격리 경계를 확인한다. 실제 ZAP 브라우저·쿠키·로그인·Client 확장·upstream 전달 성공을 증명하지 않는다.

각 구현 단계는 코드·회귀·결정로그·개발일지를 같은 변경으로 묶고 JDK 21 `mvn clean verify`를 통과시킨다. 최종 실제 Burp 재로드, Docker/설치형 ZAP, Client Spider, 계정 lane, 취소 및 기존 project 재열기는 별도 gate로 기록한다. 이번 추출로 endpoint 발견률이나 취약점 판정 정확도가 개선됐다고 주장하지 않는다.
