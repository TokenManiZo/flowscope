# LLM 자동 탐색·자유 대화 계약 (로컬 검증 중)

> 로컬 구현·자동 검증·실물 Codex 증거 조회와 실제 Burp 재로드 gate 확인 (2026-10-12): 자유 대화에 현재 프로젝트 Evidence 조회와 별도 로그인 브라우저를 연결했습니다. 기존 자동 Explorer와 대화·세션은 분리하고 LLM 증거 저장 경로만 공유합니다. 로그인 계정 블라인드 실행에서 셸·브라우저 요청이 선택 계정으로 저장되고 그래프에 표시되는 것을 확인했습니다. 아래 과거 검증 기록은 당시 계약에만 적용됩니다.

이 문서는 `v1.0.2` 기반 로컬 작업의 두 실행 방식을 설명합니다. **탐색 시작**은 계정·비로그인 lane을 선택하는 기존 자동 Explorer입니다. 카드 제목 옆 **Codex 자유 대화**는 자동 탐색 컨트롤을 숨기고 별도 대화 보기를 열며, 버튼만으로 네트워크 실행을 시작하지 않습니다. 저장된 프로젝트에서 첫 메시지를 전송하면 별도의 turn을 시작하고, 완료 뒤의 메시지는 저장된 Codex thread를 재개합니다. 추천 문장을 자동 실행하지 않습니다.

## 의도와 경계

자유 대화에서는 사용자가 작성한 메시지를 그대로 Codex turn에 전달합니다. FlowScope의 고정 정찰 순서, 대상 URL 접두 문구, JSON 출력 형식은 붙이지 않습니다. 대신 현재 프로젝트 대상과 증거가 되는 전송 경로를 짧은 실행 문맥으로 전달합니다. 자동 Explorer와는 다른 대화 thread·로그인 창을 쓰지만, 준비된 계정 handle과 범위 안 HTTP·브라우저·산출물 도구, 현재 프로젝트 Evidence 읽기 도구는 제공합니다. Codex 자체의 셸·에이전트 루프와 운영자 승인도 유지합니다. 이는 “도구 없는 LLM”이나 자동 탐색기 복제가 아니라, 진단자가 자유롭게 지시하면서 실제로 기록된 응답을 같은 LLM lane에 쌓는 대화입니다. [공식 앱 서버 문서](https://learn.chatgpt.com/docs/app-server)는 실행 이벤트와 승인 요청을 구분합니다.

Codex thread는 프로젝트의 대화 문맥입니다. 각 메시지는 별도 turn·`runId`입니다. 자유 대화는 한 turn에 비로그인 또는 로그인 완료 계정 하나를 선택합니다. 네이티브 셸에는 실행별 임시 loopback Burp 프록시 주소를 표준 HTTP(S) 환경 변수로 설정합니다. 계정 turn에서는 프록시가 활성 run 문맥을 확인하고 Explorer 로그인 vault의 Cookie·Authorization을 주입하며, Evidence의 계정 ID도 같은 선택값으로 고정합니다. 모델이 임의로 보낸 target Cookie·Authorization이나 계정 이름은 귀속 근거로 사용하지 않습니다. `flowscope_http_request`, 로그인 완료한 `flowscope_browser`, 그 프록시를 실제로 지난 셸 HTTP의 범위 안 응답은 `source=LLM` 프로젝트 Evidence로 저장합니다. 일반 8082 요청은 `UNVERIFIED_RUNTIME`이며, 신뢰 가능한 자유 대화 run으로 승격하지 않습니다. 프록시를 우회한 셸 요청·Docker 내부 요청·모델의 서술은 자동 Evidence가 아닙니다. 실제로 기록된 Evidence만 결정론적 분석·그래프 입력에 들어갑니다. 답변에 HTTP 응답이 0건이어도 대화는 남지만 완료된 수집 lane으로 승격하지 않습니다.

## 로컬 Web API

기존 Web capability·Host·Origin 검사 아래의 `/api/explorer-run`을 사용합니다.

- `GET /api/explorer-run`: 자동 Explorer의 `run`, `browser`, `accounts`, `scope`, 자동 탐색 대화만 반환합니다.
- `GET /api/codex-chat`: 자유 대화의 `run`, `messages: [{role,text,runId,at}]`, `chat`, `rawActive`, 자체 계정·브라우저 상태를 반환합니다. 자동 Explorer의 대화·로그인 상태는 섞지 않습니다.
- `POST /api/explorer-run action=start`: 기존 자동 Explorer만 시작합니다. `raw=true`는 거부합니다.
- `POST /api/codex-chat action=start`: `target`, `model`, `effort`, `message`, `anonymous`, 준비 계정 `accounts`로 첫 turn 또는 저장된 thread의 후속 turn을 시작합니다. `anonymous=true`와 계정은 동시에 보낼 수 없고 계정은 한 개만 허용합니다. `steer`, `cancel`, `new-chat`, `recheck`도 이 경로의 자유 대화에만 적용합니다. 작업 폴더는 Web 입력에서 받지 않고 확장이 정합니다. `target`은 정확한 범위 검사와 모델의 대상 문맥에 쓰되 사용자 메시지에 자동 탐색 지시로 덧붙이지 않습니다.
- `POST /api/codex-chat-accounts action=browser-open|browser-complete`: 자유 대화 전용 로그인 창을 열고 사용자가 완료한 세션을 메모리에 연결합니다. 자동 Explorer의 `/api/explorer-accounts`와는 별개입니다.
- `POST action=steer`: 실행 중 turn에 지시를 추가하고 화면 대화에 기록합니다. 끝난 turn에는 새 `action=start&message=...`를 사용합니다.
- `POST action=cancel`: 현재 turn을 중단합니다. 저장된 대화와 기존 Evidence는 유지됩니다.
- `POST action=clear`: 지난 run 표시만 초기화합니다. 대화와 Evidence는 유지됩니다.
- `POST action=new-chat`: 현재 대화 참조·표시 메시지를 명시적으로 비웁니다. Evidence는 지우지 않습니다. Codex의 이전 로컬 thread는 자동 삭제하지 않습니다.
- `GET /api/explorer-prompts`: API·입력 찾기, 계정별 요청 살펴보기, 이어서 확인하기의 범용 문장을 반환합니다. 현재 UI는 추천 목록을 표시하지 않으므로 사용자가 자유롭게 입력합니다.

Web UI가 아닌 로컬 API 호출도 FlowScope Web capability가 필요합니다. capability 값이나 Codex gateway 토큰을 프로젝트 데이터에 저장하지 않습니다.

## 세션·프로젝트 저장

프로젝트 형식은 schema 10입니다. JSON과 SQLite의 project metadata에 자동 탐색 대화 `llm_chat`과 자유 대화 `codex_chat`을 각각 저장합니다. 각 항목에는 Codex `threadId`, 대화 대상, 선택 모델·추론 강도, user/assistant 메시지, turn `runId`가 있습니다. 기존 schema 1~9는 빈 대화로 열리고, 옛 schema 10의 `llm_chat.rawCodex=true`는 자유 대화 쪽으로 옮겨 읽습니다. 버전 필드가 없는 옛 raw thread는 0으로 읽고 순정 대화로 자동 재개하지 않습니다. **새 채팅**은 자유 대화만 비우며 자동 탐색 대화와 요청 기록은 유지합니다. 같은 schema의 이전 JAR로 다시 저장하면 새 `codex_chat` 필드를 잃을 수 있으므로 업그레이드 전 백업을 보존해야 합니다. 로그인 Cookie·Authorization, FlowScope gateway capability는 대화 메타데이터에 넣지 않습니다. 요청·응답 Evidence는 인증값을 포함해 원문 그대로 저장되며, Codex 로컬 history와 DB 옆 `codex-raw-<해시>` 작업 폴더에도 대상 내용이 남을 수 있습니다.

계정 로그인 브라우저의 메모리 세션은 같은 Burp 실행 안에서 turn 사이에 유지됩니다. 프로젝트를 다시 열거나 Burp를 재시작하면 로그인 자격은 복원하지 않으므로 다시 로그인해야 합니다. 같은 컴퓨터의 Codex thread가 남아 있으면 `thread/resume`으로 대화를 이어갑니다. 다른 컴퓨터에서 프로젝트를 열어 로컬 Codex thread가 없으면 자동으로 같은 모델 문맥을 꾸며내지 않고 실패를 표시합니다. `action=new-chat`으로 새 thread를 시작할 수 있습니다.

프로젝트 전환은 진행 중인 run을 중단하고 현재 대화를 프로젝트 DB에 저장한 뒤, 선택한 프로젝트의 자동/자유 대화 metadata를 각각 복원합니다. A→B→A 순서로 열면 각 `threadId`를 혼동하지 않고 다음 메시지에서 해당 thread를 재개합니다. 브라우저 로그인은 대화 metadata와 별개이므로 전환 후 진단자가 다시 수행합니다. 이전 run의 HTTP·CDP 응답은 저장 직전 run·데이터셋을 확인해 현재 프로젝트 기록으로 승격하지 않습니다.

두 방식의 HTTP 도구가 만든 큰 응답의 임시 artifact는 각 대화의 turn 사이에 재사용합니다. 자유 대화는 `flowscope_evidence_list/search/read`로 현재 프로젝트의 기존 HUMAN·SCANNER·LLM 요청 기록을 읽고, `flowscope_http_request/browser/artifact_*/record_discoveries`로 새 관측과 선언을 저장할 수 있습니다. 목록·검색에는 메타데이터만, 원문 읽기에는 선택한 Evidence ID의 제한된 구간만 반환합니다. 저장된 원문은 가리지 않으며 미보존·일부 미리보기는 `complete=false`로 알립니다. Codex 네이티브 셸이 작업 폴더에 만든 파일과 Codex 자체 로컬 thread 기록은 별도로 남습니다.

자유 대화가 방금 받은 HTTP 응답은 그래프 재분석이 끝나기 전에도 프로젝트 Evidence 조회에 나타납니다. 이때 증거 ID는 전체 기록과 같은 규칙으로 부여해 재분석 뒤에도 유지하며, 아직 분석되지 않은 요청의 API 분류·operation/resource 메타데이터는 확정값으로 간주하지 않습니다. 이 조회는 자동 Explorer의 대화 thread나 지시문을 자유 대화로 이어받는 기능이 아닙니다.

## 이번 구현의 범위와 남은 한계

모델 선택지는 설치된 Codex CLI의 `model/list`에서 읽습니다. 화면은 포커스 복귀와 5분 간격으로 목록을 다시 조회하며 서버의 60초 캐시를 사용합니다. `supportedReasoningEfforts`와 `defaultReasoningEffort`를 읽어 모델별 추론 강도 목록을 만들고, 명시적으로 고른 값은 `turn/start.effort`로 보냅니다. 모델이 바뀐 기존 대화에서는 새 모델의 기본 강도를 명시해 앞 모델의 강도가 잘못 이어지지 않게 합니다. 미지원 조합은 실행 전에 거부합니다. 모델 목록은 표시용 catalog이지 계정 사용 권한의 증명이 아닙니다. FlowScope는 Codex CLI 자체를 자동 업데이트하지 않고, 진행 중인 turn의 모델·강도도 자동 변경하지 않습니다. [공식 앱 서버 문서](https://learn.chatgpt.com/docs/app-server)의 `model/list`와 `turn/start` 계약을 따릅니다.

자유 대화의 Codex thread에는 자동 탐색 순서 대신 현재 대상과 증거 경로를 알려 주는 최소 문맥만 줍니다. 준비된 계정 브라우저의 opaque handle만 모델에 주고 Cookie·Authorization 원문은 로그인 vault에 둡니다. 자유 대화 셸은 `workspace-write`·`networkAccess=true`이고 실행별 프록시를 기본으로 받습니다. 명령 권한 요청은 Burp에서 운영자가 건별로 승인하거나 거부합니다. Docker 접근은 API 수집의 선행조건이 아니므로 막히면 HTTP·브라우저 도구로 계속할 수 있게 안내합니다. 기존 자동 Explorer는 `networkAccess=false`와 명령 권한 상승 거부를 유지합니다. 로컬 Codex CLI 0.159.3 앱 서버에서 loopback URL의 네이티브 `curl`이 지정한 프록시에 도착하는 opt-in 시험을 통과했습니다.

프록시 환경 변수는 표준 HTTP(S) 클라이언트의 기본 경로이지 OS 전역 강제 프록시가 아닙니다. `--noproxy` 같은 명시적 우회, Docker 내부 요청, Codex 서비스 연결·호스팅 검색·별도 앱/커넥터·FlowScope 밖의 사용자 프로세스는 이 방식만으로 통제하거나 Evidence로 저장할 수 없습니다([OpenAI Docs 권한 경계](https://learn.chatgpt.com/docs/permissions)). FlowScope 브라우저·HTTP 도구와 실행별 Burp 리스너는 exact scope를 검사하고 실제로 받은 범위 안 응답만 LLM Evidence로 저장합니다. 모델의 답변이나 Evidence 읽기 자체는 새 관측이 아니며, 이전 프로젝트의 읽기 도구는 run·작업 폴더가 바뀌면 거부합니다. 대화 turn에는 기존 500 HTTP 요청·300 브라우저 행동·3,000 브라우저 교환의 강제 종료 상한이 없지만 전역 기록 20,000건·프로젝트 파일 100MiB 등은 남아 있습니다.

두 방식은 `Source.LLM`의 수집 lane만 공유하며 동시 실행은 막습니다. 실행 객체, 공급자 프로세스, 대화 thread, 채팅 메시지, 마지막 실행 snapshot, Web API 및 화면 조회 키는 분리합니다. 이전 구현은 한 `ExplorerCoordinator`에서 `rawRun` 플래그만 바꿔 자유 대화에 공통 `Explorer 완료` 피드가 섞였습니다. 두 화면은 가장 최근의 실제 셸·브라우저·HTTP 행동을 한 줄로 갱신합니다. 자유 대화는 답변 말풍선과 별도로 **실행 과정 보기**에서 최근 행동 기록을 펼치며, 준비·연결·완료 시스템 활동이나 모델 최종 보고를 중복 표시하지 않습니다. 명령 출력 전문은 이 활동 요약이 아니라 Codex 대화/산출물에 남을 수 있습니다. 서버에 기록된 HTTP Evidence는 별도 수집 기록·그래프에서도 확인합니다. 자유 대화 헤더에는 **자동 탐색으로 돌아가기**와 모델·추론 강도 설정을 둡니다. 진행 중에는 현재 모델/강도를 읽기 전용으로 보이고 turn 종료 후 다음 메시지용 값을 바꿀 수 있습니다. 답변 완료와 **이번 대화에서 새로 기록된** HTTP 응답 수를 표시하고, 0건이어도 기존 프로젝트 기록 조회가 가능함을 명시합니다. 자동 Explorer의 완료 게이트와 요약은 그대로 유지합니다.

FlowScope 밖의 별도 브라우저나 자유 대화 셸 클라이언트가 Burp 프록시를 통해 HTTPS 대상으로 요청하는 경우 Burp CA를 신뢰해야 합니다. FlowScope는 TLS 검증 우회나 OS 전역 인증서 설치를 자동으로 수행하지 않습니다.

두 방식의 `flowscope_record_discoveries`는 유효한 선언은 저장하고 잘못된 발견·파라미터의 인덱스와 이유를 `rejected_discoveries`·`rejected_parameters`로 돌려줍니다. 선언은 실제 HTTP 응답이 아니며, Evidence ID에 묶인 후보로만 저장합니다.

이번 자유 대화 변경만으로 일반적인 API 발견률 상승을 입증한 것은 아닙니다. 사용자 메시지, Codex가 고른 도구, 브라우저 조작 범위에 따라 수집 건수가 달라집니다. 브라우저 로그인을 완료한 등록 계정의 opaque handle은 자유 대화의 HTTP·브라우저 도구에 제공하지만 인증 비밀값은 전달하지 않습니다. 실제 Burp의 Keycloak 로컬 실습 환경에서는 로그인 브라우저·셸 프록시 요청 수집과 계정 귀속·그래프 표시를 확인했습니다. 취소·프로젝트 전환·HTTPS 대상과 복수 계정 후속 turn은 별도 gate이며, 기존 로컬 crAPI 비교는 성능 합격 자료로 쓰지 않습니다.

## 개발·검증 기록

- 2026-10-12 자유 대화 계정 귀속 공통화: 실제 Keycloak 블라인드 자유대화에서 인증된 셸 요청이 `source=LLM`이지만 계정은 비로그인으로 표시된 사례를 재현했습니다. 계정 이름 헤더나 JWT 내용으로 귀속하는 안은 위장이 가능해 기각했습니다. 자유 대화 시작을 비로그인 또는 READY 계정 하나로 제한하고, 선택 계정을 LLM run context·HTTP gateway·브라우저·셸 프록시가 함께 사용하도록 했습니다. 계정 turn의 셸 프록시는 모델이 넣은 Cookie·Authorization을 Explorer vault 세션으로 교체하고 요청 기록에 같은 계정 ID를 고정합니다. 비로그인+계정 혼합, 복수 계정 turn, 다른 계정 handle은 거부합니다. 매 요청 proxy auth를 강제하는 안은 HTTPS CONNECT 뒤의 복호화 요청에 인증 헤더가 없을 수 있어 호환성 근거가 부족하므로 기각하고, 기존 실행별 임시 loopback listener·활성 run gate를 유지했습니다. UI·Web API·Coordinator·gateway·Burp proxy·Codex app-server와 회귀를 수정했고 README·점검 흐름·신뢰 경계·미배포 기록을 동기화했습니다. 집중 회귀는 React 32건과 Java 129건이 통과했습니다. JDK 21 `mvn clean verify`는 React 103파일/898건, Java 1005건(실패·오류 0, opt-in 9 skip), JAR·bundle 검증까지 통과했습니다. 산출물은 JAR 32,234,967 bytes/SHA-256 `a11607d3e9cce889d0d19cb466ed50fe8cddab79b6745f97f507bfe8d4d8247a`, bundle 30,409,035 bytes/SHA-256 `fdcbf7d4711d4fc4e8e39e7e5fc2a70489f79c28cae31364a0ddc8e47821d66d`입니다. 같은 JAR을 실제 Burp에 재로드한 뒤 새 프로젝트 `Keycloak blind free-chat account-binding gate`에서 CVE 이름·문제 endpoint·client 이름·UUID·기대 status를 주지 않은 읽기 전용 자유대화를 실행했습니다. Daybreak Blue/xhigh가 화면·번들·API를 독립 탐색해 185개 신규 HTTP 응답을 기록했고, 직접 secret API 403(`ev-a8f8e7df28c4dc40`)과 설치 구성 API 200 및 비마스킹 secret(`ev-c0ae7ae7a8745f25`)을 찾았습니다. 요청 기록 #142와 #265는 모두 `source=LLM`, 계정 `client-viewer`이며 그래프의 설치 구성 API 노드도 `client-viewer · LLM · GET 200`으로 표시됐습니다. 인증 헤더가 없는 정적 자산은 비로그인으로 남아 계정 강제 귀속과 구분됐습니다. 자동 Explorer와 자유 대화가 로그인 창을 따로 요구하고 로그인 시작 URL이 대상 루트로 고정되어 Keycloak realm URL을 수동 입력해야 한 UX debt는 미수정 상태입니다.

- 2026-10-12 자유 대화의 분석 대기 Evidence 조회: 프록시·브라우저가 응답을 `records`에 저장한 직후 지연 재분석 전에는 `flowscope_evidence_list/read`가 게시된 `latest.records`만 읽어 새 응답을 놓치는 문제를 RED 회귀로 재현했습니다. 매 조회마다 전체 재분석을 강제하는 안은 큰 JS 자산의 분석 비용과 충돌해 기각했습니다. `FlowScopeExtension.rawEvidenceForRun`이 게시된 분석본은 그대로 쓰고 아직 게시되지 않은 기록만 복사해 안정 ID를 부여하도록 바꿨습니다. `FlowScopeExtensionLifecycleTest`는 새 응답의 목록·원문 읽기, 재분석 후 ID 일치, 다른 run 거부를 검사합니다. 최종 `mvn clean verify`는 React 897건·Java 1001건(실패/오류 0, opt-in 9 skip) 및 JAR 검증까지 통과했습니다. 실제 Burp 재로드·HTTP 수집은 후속 gate입니다. 자동 Explorer 대화·로그인 세션과 자유 대화의 분리는 그대로 유지합니다.

- 2026-10-12 raw 대화 정찰·증거 경로 복구: 실제 대화가 loopback HTTP와 Docker 읽기 권한을 자동 거절당하고 FlowScope HTTP 도구도 호출하지 않아 응답 0건으로 끝난 사례를 출발점으로 삼았습니다. 셸 네트워크를 전면 차단한 이전 선택은 raw 정찰을 막아 기각하고, 기존 실행별 Burp 프록시·운영자 승인 경로를 복구하며 HTTP·브라우저 도구는 그대로 둡니다. `CodexAppServerProvider`의 간단한 전송 문맥, `FlowScopeExtension`의 raw listener, `LlmPass` 안내, `CodexAppServerProtocolTest`·`CodexAppServerProviderHarnessTest`와 README·점검 흐름·화면·신뢰·릴리스 문서를 수정했습니다. 프로토콜·프록시 귀속 테스트와 loopback `curl`의 실물 프록시 도착은 통과했습니다. 첫 opt-in 시도는 Codex 로그인 상태 확인이 6초를 초과해 모델 turn 전 실패했고, 즉시 재시도에서는 통과했습니다. 최종 `mvn -o clean verify`는 React 897건·Java 1000건(실패/오류 0, opt-in 9 skip)으로 통과했습니다. 실제 Burp에서 새 JAR 재로드 후 LLM Evidence·그래프 확인은 아직 미검증이며 다음 gate입니다. 프록시 명시 우회 및 Docker 내부 트래픽까지 강제 기록하는 기능은 제공하지 않습니다.

- 2026-10-11 실시간 행동·셸 네트워크 경계 보강: 프록시 환경변수만으로 우회를 막는 안을 기각하고 사용자 선택에 따라 자유 대화의 셸 네트워크를 끈 뒤 대상 HTTP는 기존 FlowScope HTTP·브라우저 도구로 보냅니다. 셸 명령의 샌드박스 밖 재실행 승인은 거부하고 파일 변경 승인만 남깁니다. 자동 Explorer의 레거시 명령 승인도 같은 우회가 될 수 있어 거부합니다. `CodexAppServerProvider`의 명령·도구 시작 이벤트, `FlowScopeExtension`의 raw 시작, `LlmPass`의 최근 행동 한 줄·접힌 기록·돌아가기·모델/강도 헤더, `ExplorerActivityFeedTest`·`CodexAppServerProtocolTest`·`CodexAppServerProviderHarnessTest`·`LlmPass.test.tsx`·`llm-chat.spec.ts`와 README·점검 흐름·화면·신뢰·릴리스 문서를 수정했습니다. RED는 raw 행동 숨김과 셸 시작 이벤트 부재를 재현했고, 최종 `mvn -o clean verify`는 React 897건·Java 1000건(실패/오류 0, opt-in 9 skip)으로 통과했습니다. 마지막 UI 정리 뒤 집중 회귀 31건·TypeScript 검사도 통과했습니다. 별도 Standalone의 패키징 JAR Playwright 채팅 1건, 실물 Codex 0.159.3 opt-in 2건(셸 네트워크 미도달·FlowScope HTTP 도구 호출)도 통과했습니다. 로컬 HTTP 서버 대조에서 네트워크 차단 시 연결 실패·허용 시 200을 확인했습니다. 명령 출력 전문은 현재 한 줄 행동 기록에 넣지 않으며, 최근 행동은 300개 snapshot 상한을 가집니다. 실제 Burp 재로드·사용자 대상 수집은 아직 미검증이며 다음 gate입니다.

- 2026-10-11 프로젝트별 대화 재개·늦은 응답 격리 보강: 이미 구현된 `thread/resume`을 중복 구현하는 대신 A→B→A 프로젝트 저장·재열기와 각각의 thread ID 재개를 회귀로 확인했습니다. 로그인 자격을 프로젝트에 저장하는 안은 기각하고 기존 메모리 폐기·진단자 재로그인을 유지합니다. `FlowScopeExtension`의 LLM HTTP·CDP 저장에 run·dataset 검사를 추가하고 `RunExecutionLedger`의 generation으로 프로젝트 교체 전 시도가 새 원장에 들어오지 않게 했습니다. React `LlmPass`는 연결 중 무반응 전송과 자유 대화의 새 채팅이 자동 Explorer 계정 선택을 덮는 문제를 수정했습니다. 관련 테스트는 `FlowScopeExtensionLifecycleTest`, `ExplorerCoordinatorTest`, `RunExecutionLedgerTest`, `LlmPass.test.tsx`입니다. Java 21의 최종 `mvn clean verify` 통과(React 894, Java 999 중 실패·오류 0, opt-in 9 skip), 새 JAR을 띄운 별도 포트 Playwright 채팅 1건 통과. 실제 Burp 재로드와 프로젝트 전환 중 대상 응답 수신은 아직 미검증이며 다음 gate입니다.

- 2026-10-11 프로젝트 증거·자유 대화 브라우저 연결: 현재 프로젝트 DB에 Evidence가 있어도 빈 `codex-raw` 작업 폴더만 본다는 사용자 재현을 출발점으로 삼았습니다. 프록시만 추가하는 안은 새 요청의 수집만 해결하고 기존 증거 읽기를 해결하지 못하며, DB 파일 링크를 모델 작업 폴더에 두는 안은 스키마·프로젝트 전환·원문 범위 통제를 모델 셸에 떠넘겨 기각했습니다. `ProjectEvidenceReader`와 `CodexAppServerProvider`에 목록·메타 검색·페이지형 원문 읽기를, `ExplorerCoordinator`에 자유 대화 전용 HTTP·브라우저·산출물 gateway를 연결했습니다. `FlowScopeExtension`은 현재 프로젝트·run 작업 폴더를 검사하고 등록 계정의 별도 로그인 창을 열며 같은 `Source.LLM` 기록·그래프 경로로 저장합니다. Web `/api/codex-chat-accounts`, React `LlmPass`·API·훅, 위 README·점검 흐름·화면·신뢰 한계·문제 해결·미배포 변경 문서를 동기화했습니다. 회귀는 빈 작업 폴더와 무관한 Evidence 조회, 원문·부분 보존 표기, 프로젝트 경계 거부, 자동/자유 대화 계정 분리, 로그인 창 교환의 LLM 기록, 익명 요청의 비로그인 귀속, 후속 turn 재사용, 도구 스키마 재개를 확인합니다. 첫 프로토콜 회귀의 모의 서버 스레드 대기는 테스트 자체의 교착이라 수정했고, `202`를 `200`으로 읽던 Web 테스트 기대값도 바로잡았습니다. Java 21의 최종 `mvn clean verify` 통과(React 892, Java 996 중 실패·오류 0, opt-in 9 skip), 새 JAR을 띄운 별도 포트 Playwright 채팅 1건 통과, 실물 Codex app-server의 가짜 프로젝트 Evidence 도구 호출 1회 통과. 실제 Burp JAR 재로드·로그인 Chromium·대상 HTTP 캡처는 아직 미검증이며 다음 gate입니다.

- 2026-10-11 채팅 UI 복원: PTY/xterm.js로 Codex TUI를 웹에 넣는 시도는 사용자가 요구한 채팅방과 달랐고, 실물 Burp에서 `Cannot load implementation of interface ...PtyHelpers$OSFacade`로 시작도 실패했습니다. 해당 시도의 Java·React·의존성·API·배포 리소스를 모두 되돌려 앱 서버의 독립 자유 대화 경로를 복구했습니다. 공식 앱 서버는 Codex 대화·도구·승인을 지원하므로 터미널 에뮬레이션 대신 이 경로를 선택합니다. `LlmPass`는 자유 대화에 셸·HTTP 활동 목록을 복제하지 않되 실제 HTTP Evidence 저장은 유지합니다. 회귀는 도구/HTTP 활동이 있어도 대화 메시지만 보이는지 확인합니다. Java 21의 `mvn clean verify`는 React 891건·Java 990건(실패/오류 0, opt-in 8건 skip), 수정 JAR의 격리 포트 Standalone Playwright 채팅 1건, 실물 Codex 앱 서버의 한 turn·로컬 프록시 통과 시험 1건이 통과했습니다. 새 JAR을 실제 Burp에 재로드한 검증은 아직 하지 않았으며, 프록시를 우회한 네트워크 요청은 여전히 FlowScope가 포착하지 못합니다.

- 필요성: 자동 Explorer를 보존하면서 사용자가 Codex에게 직접 지시하고 이어서 물을 별도 진입점이 필요했습니다. 원래 **탐색 시작**을 자유 대화로 치환하면 계정 lane 절차가 사라지므로 두 버튼을 분리했습니다.
- 수정 범위: `ExplorerProvider`·`CodexAppServerProvider`·`ExplorerCoordinator`·`ExplorerHttpGateway`, Web API, 프로젝트 JSON/SQLite 메타데이터, React `LlmPass`와 API 타입·훅, 단위·브라우저 회귀 테스트. 다른 화면의 구조는 바꾸지 않았습니다.
- RED→GREEN: 두 번째 turn의 `thread/resume`, HTTP 0건 대화 답변, 불완전 Evidence의 대화 보존, JSON/SQLite 재열기, 잘못된 선언 일부 거부, 500/300/3,000 이전 상한 초과를 각각 재현 후 수정했습니다.
- 이전 커밋 `097521e`의 자동 검증: 2026-10-11 `mvn clean verify` 통과(React 888/888, Java 986건 중 실패·오류 0, opt-in 8건 skip). 그때의 자유 대화에는 FlowScope 전용 도구·대상 URL 접두 문구·네트워크 차단이 남아 있었으므로 이 수치를 현재 수정본의 검증으로 전용하지 않습니다.
- 이전 커밋 `8dfaed7` 검증: 2026-10-11 `mvn clean verify` 통과(React 889/889, Java 986건 중 실패·오류 0, opt-in 8건 skip). opt-in 실물 Codex app-server가 네이티브 `curl` 요청을 로컬 모의 프록시로 보내는 시험과 Playwright 자유 대화 화면 1건을 별도로 통과했습니다. 현재 UI·상태 문구 수정의 최종 검증으로 전용하지 않습니다.
- 이번 표시 수정 검증: 2026-10-11 `mvn clean verify` 통과(React 890/890, Java 988건 중 실패·오류 0, opt-in 8건 skip). raw 답변 0건·1건의 완료 문구, 자동 Explorer 문구 보존, raw 모델 메모 중복 제거, Web `rawRun`, 두 보기 전환과 짧은 말풍선 회귀를 추가했습니다. 수정 JAR의 별도 포트 Standalone에서 Playwright 자유 대화 화면 1건을 통과했고 `하이` 말풍선의 실제 너비가 최소 96px 이상임을 확인했습니다. 사용자 Burp의 실제 프록시·HTTPS CA·대상 수집은 여전히 미검증입니다.
- 백엔드 세션 분리(2026-10-11): 한 `ExplorerCoordinator`와 `/api/explorer-run`에서 raw 플래그만 바꾸던 방식은 진행 이벤트·채팅·모델 선택이 섞여 기각했습니다. 별도 coordinator/공급자, `/api/codex-chat`, 프로젝트의 `codex_chat`, React 조회·조작 키와 모델 선택을 분리했습니다. 단일 LLM 수집 lane은 유지해 동시 실행만 거부합니다. Java `FlowScopeExtension`, `ExplorerCoordinator`, `ProjectStore`, `ProjectWorkspace`, `FlowScopeWebServer`; React `LlmPass`, API·훅; JSON/SQLite·Web·프록시·대화 회귀와 이 문서·README·화면 설명·다음 릴리스 문구를 변경했습니다. 회귀는 자동/자유 대화 조회 분리, 옛 raw chat 이관, 프로젝트 재열기, raw 프록시 귀속, raw SYSTEM/MODEL 이벤트 배제와 화면에서 자동 탐색 완료 기록 미노출을 확인합니다. `mvn clean verify`는 React 890건·Java 990건(실패/오류 0, opt-in 8건 skip), 별도 17778 Standalone의 Playwright 대화 1건을 통과했습니다. 실물 Burp JAR 재로드·HTTPS 대상 요청/응답·프로젝트 전환 후 후속 turn은 미검증으로 남습니다.
- 다음 gate: 실제 Burp에서 비로그인/두 계정의 후속 turn, 취소·프로젝트 전환·HTTPS 대상까지 수집·그래프 확인. 자동 Explorer와 자유 대화의 계정 로그인 준비를 중복시키지 않는 공용 세션 수명주기와 계정별 로그인 URL UX를 설계하고, 전역 저장 상한 제거를 위한 디스크 기반 기록을 별도로 검토합니다.
