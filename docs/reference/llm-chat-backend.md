# LLM 자동 탐색·Codex CLI 터미널 계약 (로컬 검증 중)

> 2026-10-11: 자동 Explorer는 유지하고, 사용자 자유 대화 화면은 실제 `codex` CLI를 실행하는 웹 터미널로 교체 중입니다. 자동 회귀와 PTY 단일 JAR 검증을 구분하며, 수정 JAR의 실제 Burp 대상 트래픽 gate는 아직 수행하지 않았습니다.

## 두 실행 방식

**탐색 시작**은 기존 계정·비로그인 자동 Explorer입니다. FlowScope의 전용 HTTP·브라우저·산출물 도구와 시작 지침을 쓰며, 계정별 완료 판정은 저장된 HTTP Evidence로 수행합니다.

**Codex CLI 열기**는 설치된 `codex` 실행 파일을 PTY에서 직접 시작하고 xterm.js로 그 화면을 웹에 표시합니다. FlowScope는 대화 문장·도구 호출·모델 출력을 번역하거나 재구성하지 않습니다. 모델 변경, 승인, 파일 작업, `/exit` 등은 Codex CLI 자체 UI에서 다룹니다. [Codex CLI 공식 문서](https://learn.chatgpt.com/docs/codex/cli)는 터미널 실행과 `codex resume`을 설명합니다. 웹 버튼의 **새 Codex CLI**는 새 대화를, **이전 대화 이어서**는 같은 작업 폴더에서 `codex resume --last`를 실행합니다. 자동 Explorer와 CLI는 같은 LLM 수집 lane을 쓰므로 동시에 실행하지 않습니다.

## 터미널과 Web API

Java는 Pty4J PTY에서 실제 CLI 프로세스를 실행합니다. 브라우저는 xterm.js로 PTY 바이트를 표시하고 키 입력·화면 크기를 그대로 전달합니다. Web API는 기존 loopback·Host·Origin·256비트 capability 검사를 사용합니다.

- `GET /api/codex-terminal?cursor=N`: 실행 상태와 최대 64KiB PTY 출력(base64), 다음 커서를 반환합니다. 화면에서 읽지 못한 출력이 4MiB 메모리 보존 상한을 넘으면 `truncated=true`를 표시합니다.
- `POST action=start`: 터미널 열·행 수와 `resume` 여부를 받아 CLI를 시작합니다. CLI 명령·작업 폴더·프록시 포트는 브라우저 입력에서 받지 않습니다.
- `POST action=input`, `resize`, `stop`: PTY에 입력을 전달하거나 화면 크기를 바꾸고 프로세스를 종료합니다. 입력은 호출당 64KiB 이하입니다.
- 이전 앱 서버 채팅 API `/api/codex-chat`은 더는 공개하지 않습니다. 자동 Explorer의 `/api/explorer-run`은 그대로입니다.

터미널은 페이지를 떠나도 Burp 프로세스에서 계속 실행되고, 돌아오면 보존된 출력으로 화면을 복원합니다. 확장을 내리면 PTY를 종료합니다. Codex 자체의 세션 기록은 FlowScope가 삭제하지 않습니다. 웹 터미널 출력은 메모리 보존용이며 프로젝트 DB에 셸 전문을 중복 저장하지 않습니다.

## 트래픽·Evidence 경계

CLI 실행마다 전용 Burp 프록시 리스너와 `runId`를 만듭니다. Codex 본체의 모델 통신은 프록시로 보내지 않고, `shell_environment_policy.set`으로 Codex가 실행하는 셸 명령에만 `HTTP_PROXY`·`HTTPS_PROXY` 등을 넣습니다. Codex 기본 `workspace-write`에서 로컬 Burp 프록시에 연결할 수 있도록 해당 실행에만 `sandbox_workspace_write.network_access=true`를 지정합니다. 그 외 Codex 대화·도구·승인 하네스는 주입하지 않습니다. [Codex 설정 문서](https://learn.chatgpt.com/docs/config-file/config-reference)는 두 설정을 정의합니다.

프록시를 실제로 통과하고 프로젝트 exact scope에 들어온 응답만 `source=LLM`, CLI `runId`, `CONTROLLED` HTTP Evidence로 저장합니다. 저장된 요청·응답은 기존 분석기와 그래프에 들어갑니다. 셸 명령 성공, 모델 설명, 빈 작업 폴더는 HTTP Evidence가 아닙니다. 자격정보가 실린 CLI 요청을 FlowScope 등록 계정으로 자동 추정하지 않습니다. CLI 또는 도구가 프록시를 무시하거나 직접 연결하면 FlowScope가 그 요청을 차단·기록할 수 없다는 한계는 그대로입니다.

CLI 종료 시 같은 run의 신뢰 가능한 범위 안 응답이 있어야만 LLM lane을 완료 처리합니다. 없으면 실행은 종료되지만 수집 완료로 승격하지 않습니다. 전역 요청 기록 20,000건·프로젝트 파일 100MiB 상한은 유지됩니다.

## 프로젝트·이전 기록

CLI 작업 폴더는 현재 프로젝트 DB 옆의 `codex-raw-<해시>`입니다. 빈 폴더는 오류가 아닙니다. Codex는 셸 출력과 대화를 자체 로컬 세션 기록에 저장하고, 파일을 생성하라는 명령이 있을 때만 작업 폴더에 파일이 생깁니다. 이전 앱 서버 자유 대화의 `codex_chat` 메타데이터와 기존 HTTP Evidence는 프로젝트를 다시 저장해도 보존하지만, 그 대화를 새 CLI TUI에 자동 주입하거나 같은 세션이라고 주장하지 않습니다.

HTTPS 대상에서 셸 클라이언트가 Burp CA를 신뢰하지 않으면 TLS 오류가 납니다. FlowScope는 `curl -k`나 OS 전역 CA 설치를 자동 적용하지 않습니다. 실제 Burp에서 CLI 입력, 프록시 경유·우회, 종료·재개, 프로젝트 전환 및 HTTPS 응답 저장을 별도로 확인해야 합니다.

## 현재 CLI 이식·검증 기록

- 필요성: 이전 웹 채팅은 Codex app-server turn과 FlowScope 도구 이벤트를 재구성한 화면이었으므로 사용자가 요청한 “CLI 자체”와 달랐습니다. 외부 터미널 창만 열면 웹 안에서 그대로 쓰려는 요구를 충족하지 못해 기각했습니다. 실제 PTY·웹 터미널로 교체하고 FlowScope는 실행별 Burp 프록시와 HTTP Evidence 귀속만 담당합니다.
- 변경 범위: `CodexCliTerminal`, `FlowScopeExtension`의 CLI run·프록시 lifecycle, `FlowScopeWebServer`의 로컬 터미널 API, React `CodexTerminalPanel`·`LlmPass`·API 타입, Pty4J/xterm.js 의존성·배포 격리·라이선스 문서. 이전 `/api/codex-chat`은 제거하고 프로젝트 `codex_chat` 기록은 보존했습니다. 자동 Explorer 코드는 변경하지 않았습니다.
- 관련 파일: Java `CodexCliTerminal`, `FlowScopeExtension`, `FlowScopeWebServer`, `FatJarIsolationSmoke`와 PTY·Web API·프록시·프로젝트 재열기 테스트; React `CodexTerminalPanel`, `LlmPass`, API 타입·endpoint·query hook과 화면·Playwright 테스트; `pom.xml`, `frontend/package*.json`, NOTICE/라이선스 자원, `README.md`, 점검 흐름·화면·신뢰 경계·문제 해결·다음 릴리스 문서.
- 재현·검증: PTY 입력·출력·리사이즈·종료, Web capability·오류 입력, CLI 프록시의 LLM 귀속·종료 후 차단, 프로젝트 재열기 이력 보존을 각각 회귀로 확인했습니다. 배포 JAR에서 JNA를 relocate하면 JNI 오류가 나는 것을 재현해 JNA만 고정 네임스페이스로 남겼습니다. 두 독립 클래스 로더의 배포 JAR에서 PTY 자식 프로세스 왕복을 확인했습니다. `mvn clean verify`는 React 880건·Java 992건(실패·오류 0, opt-in 8건 skip)으로 통과했습니다. 별도 17778 Standalone의 Playwright 모의 화면 시험 1건은 출력 렌더링·키 입력·종료·화면 전환·재개 버튼·자동 Explorer 분리를 확인했습니다. 배포 JAR과 실제 설치된 Codex CLI 0.159.3을 연결한 opt-in 웹 시험 1건에서는 모델 요청 없이 CLI TUI 화면과 키 입력 전송을 확인했습니다. 두 화면 시험 모두 실제 Burp 대상 HTTP 수집 성공으로 전용하지 않습니다.
- 남은 gate: 실제 Burp에 수정 JAR 재로드 후 CLI 셸의 범위 안 HTTP 요청·응답 저장, HTTPS Burp CA, 프로젝트 전환·확장 unload, Windows/Linux 배포 PTY를 확인해야 합니다. 프록시 우회 요청까지 수집한다고 주장하지 않습니다.

## 이전 앱 서버 대화의 개발·검증 기록 (현재 실행 경로 아님)

- 필요성: 자동 Explorer를 보존하면서 사용자가 Codex에게 직접 지시하고 이어서 물을 별도 진입점이 필요했습니다. 원래 **탐색 시작**을 자유 대화로 치환하면 계정 lane 절차가 사라지므로 두 버튼을 분리했습니다.
- 수정 범위: `ExplorerProvider`·`CodexAppServerProvider`·`ExplorerCoordinator`·`ExplorerHttpGateway`, Web API, 프로젝트 JSON/SQLite 메타데이터, React `LlmPass`와 API 타입·훅, 단위·브라우저 회귀 테스트. 다른 화면의 구조는 바꾸지 않았습니다.
- RED→GREEN: 두 번째 turn의 `thread/resume`, HTTP 0건 대화 답변, 불완전 Evidence의 대화 보존, JSON/SQLite 재열기, 잘못된 선언 일부 거부, 500/300/3,000 이전 상한 초과를 각각 재현 후 수정했습니다.
- 이전 커밋 `097521e`의 자동 검증: 2026-10-11 `mvn clean verify` 통과(React 888/888, Java 986건 중 실패·오류 0, opt-in 8건 skip). 그때의 자유 대화에는 FlowScope 전용 도구·대상 URL 접두 문구·네트워크 차단이 남아 있었으므로 이 수치를 현재 수정본의 검증으로 전용하지 않습니다.
- 이전 커밋 `8dfaed7` 검증: 2026-10-11 `mvn clean verify` 통과(React 889/889, Java 986건 중 실패·오류 0, opt-in 8건 skip). opt-in 실물 Codex app-server가 네이티브 `curl` 요청을 로컬 모의 프록시로 보내는 시험과 Playwright 자유 대화 화면 1건을 별도로 통과했습니다. 현재 UI·상태 문구 수정의 최종 검증으로 전용하지 않습니다.
- 이번 표시 수정 검증: 2026-10-11 `mvn clean verify` 통과(React 890/890, Java 988건 중 실패·오류 0, opt-in 8건 skip). raw 답변 0건·1건의 완료 문구, 자동 Explorer 문구 보존, raw 모델 메모 중복 제거, Web `rawRun`, 두 보기 전환과 짧은 말풍선 회귀를 추가했습니다. 수정 JAR의 별도 포트 Standalone에서 Playwright 자유 대화 화면 1건을 통과했고 `하이` 말풍선의 실제 너비가 최소 96px 이상임을 확인했습니다. 사용자 Burp의 실제 프록시·HTTPS CA·대상 수집은 여전히 미검증입니다.
- 백엔드 세션 분리(2026-10-11): 한 `ExplorerCoordinator`와 `/api/explorer-run`에서 raw 플래그만 바꾸던 방식은 진행 이벤트·채팅·모델 선택이 섞여 기각했습니다. 별도 coordinator/공급자, `/api/codex-chat`, 프로젝트의 `codex_chat`, React 조회·조작 키와 모델 선택을 분리했습니다. 단일 LLM 수집 lane은 유지해 동시 실행만 거부합니다. Java `FlowScopeExtension`, `ExplorerCoordinator`, `ProjectStore`, `ProjectWorkspace`, `FlowScopeWebServer`; React `LlmPass`, API·훅; JSON/SQLite·Web·프록시·대화 회귀와 이 문서·README·화면 설명·다음 릴리스 문구를 변경했습니다. 회귀는 자동/자유 대화 조회 분리, 옛 raw chat 이관, 프로젝트 재열기, raw 프록시 귀속, raw SYSTEM/MODEL 이벤트 배제와 화면에서 자동 탐색 완료 기록 미노출을 확인합니다. `mvn clean verify`는 React 890건·Java 990건(실패/오류 0, opt-in 8건 skip), 별도 17778 Standalone의 Playwright 대화 1건을 통과했습니다. 실물 Burp JAR 재로드·HTTPS 대상 요청/응답·프로젝트 전환 후 후속 turn은 미검증으로 남습니다.
- 다음 gate: 실제 Burp에서 비로그인/두 계정의 후속 turn까지 수집·그래프 확인, 전역 저장 상한 제거를 위한 디스크 기반 기록 설계.
