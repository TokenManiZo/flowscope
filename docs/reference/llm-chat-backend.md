# LLM 대화 화면·백엔드 계약 (로컬 검증 중)

이 문서는 `v1.0.2` 기반 로컬 실험의 채팅 화면과 백엔드 API를 설명합니다. React의 **채팅 시작**은 입력창만 열고 네트워크 실행을 시작하지 않습니다. 첫 메시지 전송은 새 turn을 시작하고, 완료 뒤의 메시지는 저장된 Codex thread를 재개합니다. 현재 화면은 범용 추천 문장 목록을 표시하지 않으며, 문장을 자동 실행하지도 않습니다.

## 의도와 경계

진단자가 작성한 메시지가 이번 turn의 목표입니다. 서버는 특정 정찰 순서나 취약점 유형을 강제하지 않습니다. FlowScope가 유지하는 계약은 사용자가 지정한 exact scope, 모든 대상 요청의 source·계정·run·Evidence 귀속, turn 중단입니다. 코드에서 읽은 선언은 실제 HTTP 관측과 구분하고, 응답 코드 하나로 취약점을 확정하지 않습니다.

Codex thread는 프로젝트의 대화 문맥입니다. 각 메시지는 별도 turn·`runId`로 실행되고, 실제 LLM HTTP 요청은 기존 Burp Montoya 전송기, 브라우저 요청은 전용 Burp 프록시와 CDP 기록 경로를 사용합니다. Evidence·선언 후보·결정론적 분석·그래프 입력은 기존 파이프라인을 그대로 사용합니다. 대화 답변에 HTTP 응답이 0건이어도 정상적인 답변일 수 있지만, 이 turn을 완료된 수집 lane으로 승격하지 않습니다. 응답을 받았어도 신뢰 자격이 없으면 대화는 남기고 `EVIDENCE_INCOMPLETE`를 표시합니다.

## 로컬 Web API

기존 Web capability·Host·Origin 검사 아래의 `/api/explorer-run`을 사용합니다.

- `GET`: 기존 `run`, `browser`, `accounts`, `scope`와 함께 `messages: [{role,text,runId,at}]`를 반환합니다. 모델 출력 delta도 실행 중 이 배열의 마지막 assistant 메시지에 이어 붙습니다.
- `POST action=start`: 기존 `target`, `accounts`, `anonymous`, `model`에 **`message`**를 더하면 사용자 지시로 새 turn을 시작합니다. 첫 메시지는 지속 Codex thread를 만들고, 후속 메시지는 저장된 thread를 재개해 새 gateway dynamic tools를 연결합니다. `message`를 생략한 기존 UI 요청은 원래의 일회성 Explorer/JSON 결과 경로를 사용합니다.
- `POST action=steer`: 실행 중 turn에 지시를 추가하고 화면 대화에 기록합니다. 끝난 turn에는 새 `action=start&message=...`를 사용합니다.
- `POST action=cancel`: 현재 turn을 중단합니다. 저장된 대화와 기존 Evidence는 유지됩니다.
- `POST action=clear`: 지난 run 표시만 초기화합니다. 대화와 Evidence는 유지됩니다.
- `POST action=new-chat`: 현재 대화 참조·표시 메시지를 명시적으로 비웁니다. Evidence는 지우지 않습니다. Codex의 이전 로컬 thread는 자동 삭제하지 않습니다.
- `GET /api/explorer-prompts`: API·입력 찾기, 계정별 요청 살펴보기, 이어서 확인하기의 범용 문장을 반환합니다. 현재 UI는 추천 목록을 표시하지 않으므로 사용자가 자유롭게 입력합니다.

Web UI가 아닌 로컬 API 호출도 FlowScope Web capability가 필요합니다. capability 값이나 Codex gateway 토큰을 프로젝트 데이터에 저장하지 않습니다.

## 세션·프로젝트 저장

프로젝트 형식은 schema 10입니다. JSON과 SQLite의 project metadata에 Codex `threadId`, 대화 대상, 화면에 보이는 user/assistant 메시지와 turn `runId`를 저장합니다. 기존 schema 1~9는 빈 대화로 열립니다. 새 프로젝트 파일은 옛 JAR에서 열 수 없으므로 업그레이드 전 백업을 보존해야 합니다. 로그인 Cookie·Authorization, FlowScope gateway capability는 이 대화 메타데이터에 넣지 않습니다. 반면 기존 요청/응답 Evidence는 인증값을 포함해 원문 그대로 저장되며, 지속 Codex thread의 로컬 history에도 모델이 본 대상 내용이 남을 수 있습니다.

계정 로그인 브라우저의 메모리 세션은 같은 Burp 실행 안에서 turn 사이에 유지됩니다. 프로젝트를 다시 열거나 Burp를 재시작하면 로그인 자격은 복원하지 않으므로 다시 로그인해야 합니다. 같은 컴퓨터의 Codex thread가 남아 있으면 `thread/resume`으로 대화를 이어갑니다. 다른 컴퓨터에서 프로젝트를 열어 로컬 Codex thread가 없으면 자동으로 같은 모델 문맥을 꾸며내지 않고 실패를 표시합니다. `action=new-chat`으로 새 thread를 시작할 수 있습니다.

큰 응답의 임시 artifact는 같은 Burp 프로세스의 대화 turn 사이에 재사용합니다. 확장 종료 후에는 임시 artifact를 폐기하므로, 재시작 뒤 이전 artifact ID로 읽는 것은 지원하지 않습니다. 그 경우 저장된 Evidence를 확인하거나 원 URL을 다시 수집해야 합니다.

## 이번 구현의 범위와 남은 한계

대화 turn의 HTTP 도구는 사용자 지시의 HTTP method를 전송합니다. `PUT`·`PATCH`·`DELETE`를 URL 이름만 보고 자동 거부하지 않습니다. 이전 일회성 UI run은 기존 프롬프트·임시 thread·행동/시간 계약을 유지합니다. 새 대화 turn에는 기본 500 HTTP 요청, 300 브라우저 행동, 3,000 브라우저 교환의 **turn 강제 종료 상한이 없습니다**. 동일 요청을 다시 보내는 것도 허용합니다. 이 변경은 전역 FlowScope 기록 20,000건, 프로젝트 파일 100MiB, artifact 총량, JavaScript 파서의 물리적 처리 상한을 없애지 않았습니다. 그 경계에 도달하면 계속 수집된다고 주장해서는 안 됩니다.

`flowscope_record_discoveries`는 유효한 선언은 저장하고 잘못된 발견·파라미터의 인덱스와 이유를 `rejected_discoveries`·`rejected_parameters`로 돌려줍니다. PATH 파라미터는 선언 URL의 placeholder 이름으로 보낼 수 있습니다. `Authorization` 같은 헤더 **이름**은 선언할 수 있지만, 직접 HTTP 도구가 임의 인증값을 주입하는 기능은 아닙니다.

이번 대화 변경만으로 API 발견률 상승은 입증되지 않습니다. 모델이 이전 Evidence를 구조적으로 재조회하는 도구, 재시작 후 대용량 artifact 복원, 전역 20,000건 이후의 디스크 기반 분석은 별도 작업입니다. 기존 로컬 crAPI 비교는 모델 실행 변동과 벤치마크 집계 결함이 있어 성능 합격 자료로 쓰지 않습니다.

## 개발·검증 기록

- 필요성: 일회성 Explorer는 답변 뒤 Codex thread와 gateway를 삭제해 사용자가 미해결 항목을 같은 맥락에서 이어서 물을 수 없었습니다. 백엔드를 먼저 분리했으나 기존 UI의 **탐색 시작**은 `message` 없이 자동 탐색을 호출했습니다. 이를 유지하는 대안은 사용자 지시 전 자동 실행이어서 기각했습니다.
- 수정 범위: `ExplorerProvider`·`CodexAppServerProvider`·`ExplorerCoordinator`·`ExplorerHttpGateway`, Web API, 프로젝트 JSON/SQLite 메타데이터, React `LlmPass`와 API 타입·훅, 단위·브라우저 회귀 테스트. 다른 화면의 구조는 바꾸지 않았습니다.
- RED→GREEN: 두 번째 turn의 `thread/resume`, HTTP 0건 대화 답변, 불완전 Evidence의 대화 보존, JSON/SQLite 재열기, 잘못된 선언 일부 거부, 500/300/3,000 이전 상한 초과를 각각 재현 후 수정했습니다.
- 자동 검증: 2026-10-10 `mvn clean verify` 통과(React 885/885, Java 977건 중 실패·오류 0, opt-in 7건 skip). React 테스트는 버튼 클릭 시 미전송, 메시지 전송 시 시작, 저장된 대화에서 후속 turn을 확인합니다. 모의 API를 사용한 Chromium E2E 1건도 통과했습니다. 이전 작업의 opt-in 실물 Codex 두 turn 재개 시험은 통과했지만, 이번 UI가 들어간 JAR을 실제 Burp에서 재로드해 대상 수집을 실행한 적은 없습니다.
- 다음 gate: 실제 Burp에서 비로그인/두 계정의 후속 turn까지 수집·그래프 확인, 전역 저장 상한 제거를 위한 디스크 기반 기록 설계.
