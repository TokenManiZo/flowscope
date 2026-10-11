# LLM 자동 탐색·자유 대화 계약 (로컬 검증 중)

> 자동 검증 완료·Burp 실물 gate 대기 (2026-10-11): `v1.0.2` 기반 로컬 브랜치의 자유 대화에서 FlowScope 전용 도구·지침·대상 URL 주입을 제거하고, 실행별 Burp 프록시만 셸 환경에 연결했습니다. 실제 Burp 재로드·실대상 수집은 아직 검증하지 않았습니다.

이 문서는 `v1.0.2` 기반 로컬 작업의 두 실행 방식을 설명합니다. **탐색 시작**은 계정·비로그인 lane을 선택하는 기존 자동 Explorer입니다. 카드 제목 옆 **Codex 자유 대화**는 입력창만 열며 네트워크 실행은 시작하지 않습니다. 저장된 프로젝트에서 첫 메시지를 전송하면 별도의 turn을 시작하고, 완료 뒤의 메시지는 저장된 Codex thread를 재개합니다. 추천 문장을 자동 실행하지 않습니다.

## 의도와 경계

자유 대화에서는 사용자가 작성한 메시지를 그대로 Codex turn에 전달합니다. FlowScope의 고정 정찰 프롬프트, 대상 URL 접두 문구, 계정 handle, dynamic tool schema, JSON 출력 형식은 붙이지 않습니다. 기존 자동 Explorer의 프롬프트·계정 선택·범위 제한 HTTP 도구는 그대로입니다. 순정 대화에서도 Codex 자체의 에이전트 루프와 기본 도구는 사용합니다. 이는 “Codex 자체에 하네스가 없다”는 뜻이 아니라 “FlowScope가 별도 Explorer 하네스를 얹지 않는다”는 뜻입니다. [공식 Codex 설명](https://developers.openai.com/blog/codex-as-a-platform)은 앱 서버가 대화·도구·승인 처리를 제공한다고 명시합니다.

Codex thread는 프로젝트의 대화 문맥입니다. 각 메시지는 별도 turn·`runId`입니다. 자유 대화의 네이티브 셸에는 run 전용 loopback Burp 프록시 주소를 표준 HTTP(S) 프록시 환경 변수로 설정합니다. 그 프록시를 실제로 지난 요청은 Burp의 exact-scope 검사 뒤 `source=LLM`으로 기록되며, 실행 중인 run·포트가 맞는 경우에만 `CONTROLLED`입니다. 일반 8082 요청은 그대로 `UNVERIFIED_RUNTIME`입니다. 프록시 경로는 Cookie·Authorization을 브로커 값으로 바꾸지 않습니다. 실제로 기록된 Evidence만 기존 결정론적 분석·그래프 입력에 들어갑니다. 답변에 HTTP 응답이 0건이어도 대화는 남지만 완료된 수집 lane으로 승격하지 않습니다.

## 로컬 Web API

기존 Web capability·Host·Origin 검사 아래의 `/api/explorer-run`을 사용합니다.

- `GET`: 기존 `run`, `browser`, `accounts`, `scope`와 함께 `messages: [{role,text,runId,at}]`와 `rawActive`를 반환합니다. 모델 출력 delta도 실행 중 이 배열의 마지막 assistant 메시지에 이어 붙습니다.
- `POST action=start`: 기존 자동 Explorer는 `target`, `accounts`, `anonymous`, `model`, `effort`를 보내며 `message`·`raw`는 생략합니다. 자유 대화는 `raw=true`, `message`를 보내며 계정 handle을 전달하지 않습니다. 계정을 함께 보내면 서버가 거부합니다. 첫 메시지는 지속 Codex thread를 만들고, 후속 메시지는 저장된 thread를 재개합니다. 프록시 포트와 작업 폴더는 Web 입력에서 받지 않고 확장이 정합니다. `target`은 실행·수집 범위 검사용이지 Codex 메시지에 삽입하는 문장이 아닙니다.
- `POST action=steer`: 실행 중 turn에 지시를 추가하고 화면 대화에 기록합니다. 끝난 turn에는 새 `action=start&message=...`를 사용합니다.
- `POST action=cancel`: 현재 turn을 중단합니다. 저장된 대화와 기존 Evidence는 유지됩니다.
- `POST action=clear`: 지난 run 표시만 초기화합니다. 대화와 Evidence는 유지됩니다.
- `POST action=new-chat`: 현재 대화 참조·표시 메시지를 명시적으로 비웁니다. Evidence는 지우지 않습니다. Codex의 이전 로컬 thread는 자동 삭제하지 않습니다.
- `GET /api/explorer-prompts`: API·입력 찾기, 계정별 요청 살펴보기, 이어서 확인하기의 범용 문장을 반환합니다. 현재 UI는 추천 목록을 표시하지 않으므로 사용자가 자유롭게 입력합니다.

Web UI가 아닌 로컬 API 호출도 FlowScope Web capability가 필요합니다. capability 값이나 Codex gateway 토큰을 프로젝트 데이터에 저장하지 않습니다.

## 세션·프로젝트 저장

프로젝트 형식은 schema 10입니다. JSON과 SQLite의 project metadata에 Codex `threadId`, 대화 대상, 선택 모델·추론 강도, user/assistant 메시지, turn `runId`, 자유 대화 여부와 `rawProtocolVersion`을 저장합니다. 기존 schema 1~9는 빈 대화로 열리고 이전 schema 10에 버전 필드가 없으면 0으로 읽습니다. 이전 로컬 실험본의 raw thread에는 FlowScope 도구 문맥이 이미 들어 있을 수 있어 버전 0을 순정 대화로 자동 재개하지 않습니다. Web에서 **새 채팅**을 명시적으로 누르면 새 thread가 시작되며 기존 요청 기록은 유지됩니다. 새 프로젝트 파일은 옛 JAR에서 열 수 없으므로 업그레이드 전 백업을 보존해야 합니다. 로그인 Cookie·Authorization, FlowScope gateway capability는 대화 메타데이터에 넣지 않습니다. 요청·응답 Evidence는 인증값을 포함해 원문 그대로 저장되며, Codex 로컬 history와 DB 옆 `codex-raw-<해시>` 작업 폴더에도 대상 내용이 남을 수 있습니다.

계정 로그인 브라우저의 메모리 세션은 같은 Burp 실행 안에서 turn 사이에 유지됩니다. 프로젝트를 다시 열거나 Burp를 재시작하면 로그인 자격은 복원하지 않으므로 다시 로그인해야 합니다. 같은 컴퓨터의 Codex thread가 남아 있으면 `thread/resume`으로 대화를 이어갑니다. 다른 컴퓨터에서 프로젝트를 열어 로컬 Codex thread가 없으면 자동으로 같은 모델 문맥을 꾸며내지 않고 실패를 표시합니다. `action=new-chat`으로 새 thread를 시작할 수 있습니다.

기존 Explorer 도구가 만든 큰 응답의 임시 artifact는 같은 Burp 프로세스의 대화 turn 사이에 재사용합니다. 자유 대화에는 FlowScope artifact 도구를 제공하지 않습니다. Codex 네이티브 셸이 프로젝트별 작업 폴더에 만든 파일과 Codex 자체의 로컬 thread 기록은 별도로 남으며 사용자가 직접 관리해야 합니다.

## 이번 구현의 범위와 남은 한계

모델 선택지는 설치된 Codex CLI의 `model/list`에서 읽습니다. 화면은 포커스 복귀와 5분 간격으로 목록을 다시 조회하며 서버의 60초 캐시를 사용합니다. `supportedReasoningEfforts`와 `defaultReasoningEffort`를 읽어 모델별 추론 강도 목록을 만들고, 명시적으로 고른 값은 `turn/start.effort`로 보냅니다. 모델이 바뀐 기존 대화에서는 새 모델의 기본 강도를 명시해 앞 모델의 강도가 잘못 이어지지 않게 합니다. 미지원 조합은 실행 전에 거부합니다. 모델 목록은 표시용 catalog이지 계정 사용 권한의 증명이 아닙니다. FlowScope는 Codex CLI 자체를 자동 업데이트하지 않고, 진행 중인 turn의 모델·강도도 자동 변경하지 않습니다. [공식 앱 서버 문서](https://learn.chatgpt.com/docs/app-server)의 `model/list`와 `turn/start` 계약을 따릅니다.

자유 대화의 Codex thread는 FlowScope 개발자 지침·dynamic tools를 받지 않습니다. Codex의 `workspace-write` 셸 격리를 쓰되 네트워크를 허용해야 로컬 Burp 프록시까지 연결됩니다. 로컬 실험에서 `networkAccess=false`는 `127.0.0.1` 연결도 막았고, `networkAccess=true`에 프록시 환경을 설정하자 네이티브 `curl`이 로컬 프록시를 사용했습니다. 승인 요청은 Burp에서 명령·사유를 보여 주고 사용자의 결정을 한 번만 전달합니다. 기존 자동 Explorer의 네트워크·도구 정책은 바꾸지 않았습니다.

프록시 환경은 표준 HTTP(S) 클라이언트의 기본 경로일 뿐 OS 방화벽이 아닙니다. 프록시를 무시하는 프로그램, 명시적 `--noproxy`, 브라우저의 자체 네트워크 경로는 FlowScope가 막거나 기록할 수 없습니다. 따라서 자유 대화의 **모든** 요청이 exact scope에 묶이거나 그래프에 나타난다고 주장하지 않습니다. 범위 안 응답도 실제 Burp 프록시를 거쳐 저장된 경우에만 LLM Evidence입니다. 이 한계 때문에 자유 대화를 자동 Explorer의 범위 보장·계정 비교 성과와 혼동하지 않아야 합니다. 대화 turn에는 기존 500 HTTP 요청·300 브라우저 행동·3,000 브라우저 교환의 강제 종료 상한이 없지만 전역 기록 20,000건·프로젝트 파일 100MiB 등은 남아 있습니다.

HTTPS 요청은 클라이언트가 Burp CA를 신뢰해야 합니다. FlowScope는 `curl -k` 같은 TLS 검증 우회나 OS 전역 인증서 설치를 자동으로 수행하지 않습니다. 필요한 경우 [PortSwigger의 CA 설치 안내](https://portswigger.net/burp/documentation/desktop/external-browser-config/certificate)에 따라 셸 클라이언트의 신뢰 저장소를 준비해야 합니다.

기존 자동 Explorer의 `flowscope_record_discoveries`는 유효한 선언은 저장하고 잘못된 발견·파라미터의 인덱스와 이유를 `rejected_discoveries`·`rejected_parameters`로 돌려줍니다. 자유 대화에는 이 도구를 제공하지 않으므로 선언 저장은 실제로 프록시에서 캡처한 응답을 기존 파서가 분석하는 범위에 한정됩니다.

이번 자유 대화 변경만으로 API 발견률 상승은 입증되지 않습니다. 사용자 메시지, Codex가 고른 네이티브 도구, 프록시 준수 여부에 따라 수집 건수가 달라집니다. FlowScope 계정 handle과 메모리 로그인 세션은 자유 대화에 제공하지 않습니다. 인증 요청을 하려면 사용자가 허가된 계정의 인증값을 Codex의 네이티브 작업 경로에서 직접 다뤄야 하며, FlowScope는 자격증명이 있는 셸 요청을 확인된 계정으로 추정하지 않습니다. 실제 Burp에서 프록시 경유·우회·취소·프로젝트 전환을 확인해야 합니다. 기존 로컬 crAPI 비교는 성능 합격 자료로 쓰지 않습니다.

## 개발·검증 기록

- 필요성: 자동 Explorer를 보존하면서 사용자가 Codex에게 직접 지시하고 이어서 물을 별도 진입점이 필요했습니다. 원래 **탐색 시작**을 자유 대화로 치환하면 계정 lane 절차가 사라지므로 두 버튼을 분리했습니다.
- 수정 범위: `ExplorerProvider`·`CodexAppServerProvider`·`ExplorerCoordinator`·`ExplorerHttpGateway`, Web API, 프로젝트 JSON/SQLite 메타데이터, React `LlmPass`와 API 타입·훅, 단위·브라우저 회귀 테스트. 다른 화면의 구조는 바꾸지 않았습니다.
- RED→GREEN: 두 번째 turn의 `thread/resume`, HTTP 0건 대화 답변, 불완전 Evidence의 대화 보존, JSON/SQLite 재열기, 잘못된 선언 일부 거부, 500/300/3,000 이전 상한 초과를 각각 재현 후 수정했습니다.
- 이전 커밋 `097521e`의 자동 검증: 2026-10-11 `mvn clean verify` 통과(React 888/888, Java 986건 중 실패·오류 0, opt-in 8건 skip). 그때의 자유 대화에는 FlowScope 전용 도구·대상 URL 접두 문구·네트워크 차단이 남아 있었으므로 이 수치를 현재 수정본의 검증으로 전용하지 않습니다.
- 현재 수정본 검증: 2026-10-11 `mvn clean verify` 통과(React 889/889, Java 986건 중 실패·오류 0, opt-in 8건 skip). raw app-server 프로토콜 회귀에서 전용 도구·개발자 지침 부재, 사용자 메시지 원문 전달, 프록시 설정, 승인 중 진행 표시를 확인했습니다. 구버전 raw thread 자동 재개 차단과 JSON/SQLite 버전 재열기도 회귀로 확인했습니다. opt-in 실물 Codex app-server가 네이티브 `curl` 요청을 로컬 모의 프록시로 보내는 시험과 Playwright 자유 대화 화면 1건을 별도로 통과했습니다. 로컬 CLI 대조 실험에서는 네트워크 차단 시 loopback 접속 실패, 네트워크 허용+프록시 환경 시 모의 프록시 도달을 확인했습니다. 실제 Burp 프록시·HTTPS CA·실대상 수집은 미검증입니다.
- 다음 gate: 실제 Burp에서 비로그인/두 계정의 후속 turn까지 수집·그래프 확인, 전역 저장 상한 제거를 위한 디스크 기반 기록 설계.
