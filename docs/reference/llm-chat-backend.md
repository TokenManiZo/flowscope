# LLM 자동 탐색·자유 대화 계약 (로컬 검증 중)

> 자동 검증 완료·실물 gate 대기 (2026-10-11): 원격 `v1.0.2` 기반 별도 로컬 브랜치에서 기존 자동 탐색을 유지하고 Codex 자유 대화·세션 귀속 수집을 추가했습니다. 실제 Burp 재로드·실대상 수집은 아직 검증하지 않았습니다.

이 문서는 `v1.0.2` 기반 로컬 작업의 두 실행 방식을 설명합니다. **탐색 시작**은 계정·비로그인 lane을 선택하는 기존 자동 Explorer입니다. 카드 제목 옆 **Codex 자유 대화**는 입력창만 열며 네트워크 실행은 시작하지 않습니다. 저장된 프로젝트에서 첫 메시지를 전송하면 별도의 turn을 시작하고, 완료 뒤의 메시지는 저장된 Codex thread를 재개합니다. 추천 문장을 자동 실행하지 않습니다.

## 의도와 경계

자유 대화에서는 진단자가 작성한 메시지가 이번 turn의 목표입니다. Codex에 전달할 때 화면에서 선택한 대상 URL만 앞에 붙이고, 고정 정찰 프롬프트는 주입하지 않습니다. 기존 자동 Explorer의 프롬프트와 계정 선택은 그대로입니다. FlowScope의 범위 제한 HTTP 도구는 exact scope를 검사하고 전송·응답을 LLM run의 Evidence로 남깁니다. 자유 대화에는 일반 Codex 도구도 있지만, 네이티브 셸·브라우저의 모든 네트워크 동작이 자동으로 FlowScope를 지난다고 주장하지 않습니다. 코드 선언은 실제 HTTP 관측과 구분하고, 응답 코드만으로 취약점을 확정하지 않습니다.

Codex thread는 프로젝트의 대화 문맥입니다. 각 메시지는 별도 turn·`runId`입니다. 범위 제한 HTTP 도구는 기존 Burp Montoya 전송기를 사용합니다. 자유 대화 turn 전용 loopback Burp 프록시로 실제 지나간 요청도 `source=LLM`으로 기록하며, 실행 중인 run·포트가 맞는 경우에만 `CONTROLLED`입니다. 일반 8082 요청은 그대로 `UNVERIFIED_RUNTIME`입니다. 프록시 경로는 Cookie·Authorization을 브로커 값으로 바꾸지 않습니다. Evidence·선언 후보·결정론적 분석·그래프 입력은 기존 파이프라인을 사용합니다. 답변에 HTTP 응답이 0건이어도 대화는 남지만 완료된 수집 lane으로 승격하지 않습니다.

## 로컬 Web API

기존 Web capability·Host·Origin 검사 아래의 `/api/explorer-run`을 사용합니다.

- `GET`: 기존 `run`, `browser`, `accounts`, `scope`와 함께 `messages: [{role,text,runId,at}]`와 `rawActive`를 반환합니다. 모델 출력 delta도 실행 중 이 배열의 마지막 assistant 메시지에 이어 붙습니다.
- `POST action=start`: 기존 자동 Explorer는 `target`, `accounts`, `anonymous`, `model`, `effort`를 보내며 `message`·`raw`는 생략합니다. 자유 대화는 `raw=true`, `message`를 보내고 READY 계정 handle을 선택적으로 전달합니다. 선택 계정이 없으면 비로그인으로도 시작합니다. 첫 메시지는 지속 Codex thread를 만들고, 후속 메시지는 저장된 thread를 재개합니다. 프록시 포트와 작업 폴더는 Web 입력에서 받지 않고 확장이 정합니다.
- `POST action=steer`: 실행 중 turn에 지시를 추가하고 화면 대화에 기록합니다. 끝난 turn에는 새 `action=start&message=...`를 사용합니다.
- `POST action=cancel`: 현재 turn을 중단합니다. 저장된 대화와 기존 Evidence는 유지됩니다.
- `POST action=clear`: 지난 run 표시만 초기화합니다. 대화와 Evidence는 유지됩니다.
- `POST action=new-chat`: 현재 대화 참조·표시 메시지를 명시적으로 비웁니다. Evidence는 지우지 않습니다. Codex의 이전 로컬 thread는 자동 삭제하지 않습니다.
- `GET /api/explorer-prompts`: API·입력 찾기, 계정별 요청 살펴보기, 이어서 확인하기의 범용 문장을 반환합니다. 현재 UI는 추천 목록을 표시하지 않으므로 사용자가 자유롭게 입력합니다.

Web UI가 아닌 로컬 API 호출도 FlowScope Web capability가 필요합니다. capability 값이나 Codex gateway 토큰을 프로젝트 데이터에 저장하지 않습니다.

## 세션·프로젝트 저장

프로젝트 형식은 schema 10입니다. JSON과 SQLite의 project metadata에 Codex `threadId`, 대화 대상, 선택 모델·추론 강도, user/assistant 메시지, turn `runId`, 자유 대화 여부를 저장합니다. 기존 schema 1~9는 빈 대화로 열리고 이전 schema 10에 새 필드가 없으면 false로 읽습니다. 새 프로젝트 파일은 옛 JAR에서 열 수 없으므로 업그레이드 전 백업을 보존해야 합니다. 로그인 Cookie·Authorization, FlowScope gateway capability는 대화 메타데이터에 넣지 않습니다. 요청·응답 Evidence는 인증값을 포함해 원문 그대로 저장되며, Codex 로컬 history와 DB 옆 `codex-raw-<해시>` 작업 폴더에도 대상 내용이 남을 수 있습니다.

계정 로그인 브라우저의 메모리 세션은 같은 Burp 실행 안에서 turn 사이에 유지됩니다. 프로젝트를 다시 열거나 Burp를 재시작하면 로그인 자격은 복원하지 않으므로 다시 로그인해야 합니다. 같은 컴퓨터의 Codex thread가 남아 있으면 `thread/resume`으로 대화를 이어갑니다. 다른 컴퓨터에서 프로젝트를 열어 로컬 Codex thread가 없으면 자동으로 같은 모델 문맥을 꾸며내지 않고 실패를 표시합니다. `action=new-chat`으로 새 thread를 시작할 수 있습니다.

큰 응답의 임시 artifact는 같은 Burp 프로세스의 대화 turn 사이에 재사용합니다. 확장 종료 후에는 임시 artifact를 폐기하므로 재시작 뒤 이전 artifact ID로 읽는 것은 지원하지 않습니다. 그 경우 저장된 Evidence를 확인하거나 원 URL을 다시 수집해야 합니다. 별도의 원시 셸 산출물이 프로젝트 작업 폴더에 남았다면 사용자가 직접 관리해야 합니다.

## 이번 구현의 범위와 남은 한계

모델 선택지는 설치된 Codex CLI의 `model/list`에서 읽습니다. 화면은 포커스 복귀와 5분 간격으로 목록을 다시 조회하며 서버의 60초 캐시를 사용합니다. `supportedReasoningEfforts`와 `defaultReasoningEffort`를 읽어 모델별 추론 강도 목록을 만들고, 명시적으로 고른 값은 `turn/start.effort`로 보냅니다. 모델이 바뀐 기존 대화에서는 새 모델의 기본 강도를 명시해 앞 모델의 강도가 잘못 이어지지 않게 합니다. 미지원 조합은 실행 전에 거부합니다. 모델 목록은 표시용 catalog이지 계정 사용 권한의 증명이 아닙니다. FlowScope는 Codex CLI 자체를 자동 업데이트하지 않고, 진행 중인 turn의 모델·강도도 자동 변경하지 않습니다. [공식 앱 서버 문서](https://learn.chatgpt.com/docs/app-server)의 `model/list`와 `turn/start` 계약을 따릅니다.

자유 대화의 Codex thread는 기존 Explorer의 고정 개발자 지침을 받지 않습니다. 다만 Codex 셸 격리(`workspace-write`, 직접 네트워크 제한)를 유지하며, FlowScope의 범위 제한 HTTP 도구로 대상 요청을 보낼 수 있습니다. 네이티브 셸에는 run 전용 Burp 프록시 환경을 전달하지만 도구가 프록시를 따르지 않거나 격리 때문에 접속하지 못하면 FlowScope Evidence에 들어오지 않습니다. 로컬 파일 변경의 추가 권한은 Burp에서 운영자가 승인할 수 있지만, 네이티브 명령·네트워크 권한 확대는 exact-scope 우회를 막기 위해 승인하지 않습니다. 기존 자동 Explorer는 원래 프롬프트·임시 thread·계정/브라우저 절차를 유지합니다. 대화 turn에는 기본 500 HTTP 요청, 300 브라우저 행동, 3,000 브라우저 교환의 turn 강제 종료 상한이 없지만, 전역 FlowScope 기록 20,000건, 프로젝트 파일 100MiB, artifact 총량과 파서 물리 상한은 남아 있습니다.

`flowscope_record_discoveries`는 유효한 선언은 저장하고 잘못된 발견·파라미터의 인덱스와 이유를 `rejected_discoveries`·`rejected_parameters`로 돌려줍니다. PATH 파라미터는 선언 URL의 placeholder 이름으로 보낼 수 있습니다. `Authorization` 같은 헤더 **이름**은 선언할 수 있지만, 직접 HTTP 도구가 임의 인증값을 주입하는 기능은 아닙니다.

이번 자유 대화 변경만으로 API 발견률 상승은 입증되지 않습니다. 사용자 메시지, Codex가 고른 도구, 프록시 준수 여부에 따라 수집 건수가 달라집니다. READY 계정을 사용자가 고르면 그 handle을 모델에 알려 주고 범위 제한 HTTP 도구가 메모리 세션을 적용합니다. 선택하지 않은 READY 계정은 이번 turn의 HTTP 도구에서 거부하며, 계정을 자동으로 골라 주지 않습니다. 자격증명이 있는 원시 셸 요청도 확인된 계정으로 추정하지 않습니다. 실제 Burp에서 프록시 경유 요청·계정별 전송·프로젝트 전환을 확인해야 합니다. 기존 로컬 crAPI 비교는 모델 실행 변동과 벤치마크 집계 결함이 있어 성능 합격 자료로 쓰지 않습니다.

## 개발·검증 기록

- 필요성: 자동 Explorer를 보존하면서 사용자가 Codex에게 직접 지시하고 이어서 물을 별도 진입점이 필요했습니다. 원래 **탐색 시작**을 자유 대화로 치환하면 계정 lane 절차가 사라지므로 두 버튼을 분리했습니다.
- 수정 범위: `ExplorerProvider`·`CodexAppServerProvider`·`ExplorerCoordinator`·`ExplorerHttpGateway`, Web API, 프로젝트 JSON/SQLite 메타데이터, React `LlmPass`와 API 타입·훅, 단위·브라우저 회귀 테스트. 다른 화면의 구조는 바꾸지 않았습니다.
- RED→GREEN: 두 번째 turn의 `thread/resume`, HTTP 0건 대화 답변, 불완전 Evidence의 대화 보존, JSON/SQLite 재열기, 잘못된 선언 일부 거부, 500/300/3,000 이전 상한 초과를 각각 재현 후 수정했습니다.
- 자동 검증: 2026-10-11 `mvn clean verify` 통과(React 888/888, Java 986건 중 실패·오류 0, opt-in 8건 skip). 새 회귀는 버튼 위치·원래 자동 탐색 보존, raw 시작 flag, 동일 프로젝트의 Codex thread 재개, JSON/SQLite 자유 대화 상태 재열기, 선택한 READY 계정 handle만 사용 가능, 전용 프록시의 exact-scope·인증 헤더 보존·CONTROLLED 귀속·실행 종료 후 차단, 승인 거부를 검증했습니다. Playwright의 자유 대화 화면 1건도 통과해 버튼 위치와 첫 메시지 전 무전송을 확인했습니다. 별도 opt-in 실물 Codex app-server 시험에서 자유 대화가 모의 응답을 돌려주는 로컬 범위 제한 HTTP 도구를 실제 호출했습니다. 이는 실제 대상이나 Burp 프록시 실험이 아니며, 이 JAR을 실제 Burp에서 재로드해 대상 수집을 실행한 적은 없습니다. 앞선 2026-10-10의 opt-in 모델 목록·두 turn 시험은 이전 빌드 결과로만 남깁니다.
- 다음 gate: 실제 Burp에서 비로그인/두 계정의 후속 turn까지 수집·그래프 확인, 전역 저장 상한 제거를 위한 디스크 기반 기록 설계.
