# 점검 흐름 상세

## 요약

- FlowScope는 요청이 들어온 Burp 리스너를 보고 누가 보낸 요청인지 나눕니다. Burp 브라우저가 쓰는 리스너(보통 `8080`)로 들어오면 사람(HUMAN), `8081`로 들어오면 ZAP(SCANNER)입니다.
- 점검 범위에 넣은 주소로 오간 요청만 저장합니다. 다른 사이트를 돌아다녀도 저장하지 않습니다.
- Burp 브라우저가 아닌 다른 브라우저로 HTTPS 사이트를 볼 때는 그 브라우저에 Burp CA 인증서를 설치해야 합니다.
- 직접 둘러보기는 **시작**부터 **종료**까지 보낸 요청만 비교에 씁니다. 그 밖의 요청도 기록은 남지만 비교에서는 빠집니다.
- 계정을 바꿨는지는 자동으로 알아채지 못합니다. 다른 계정으로 바꿀 때는 종료하고 그 계정으로 다시 시작하세요. 같은 브라우저에서 로그아웃하고 다른 계정으로 로그인하면 이전 계정의 쿠키가 남아 있을 수 있습니다.
- ZAP은 로그인에 실패하면 비로그인으로 바꿔서 계속하지 않고 그 계정의 스캔을 멈춥니다. 화면의 링크와 버튼을 눌러 보며 돌아다니고, 페이지 소스에 적힌 주소를 GET으로 열어 봅니다. 공격형 스캔(Active Scan)은 하지 않습니다.
- LLM 탐색은 사용자가 직접 로그인한 브라우저 창을 Codex가 조작하면서 API를 찾습니다. 비밀번호는 받지 않고, 찾은 것을 취약점으로 판정하지도 않습니다.
- 계정의 역할이나 데이터의 주인처럼 화면만 봐서는 알 수 없는 정보는 사람이 정해 줘야 합니다. 권한을 비교하려면 서로 다른 일반 계정 2개를 쓰는 것이 좋습니다.
- 작업은 30초마다 자동 저장됩니다. 로그인 세션은 저장하지 않으므로 Burp를 다시 켜면 로그인도 다시 해야 합니다.

처음 설치한다면 [README](../../README.md)부터 보세요.

## 자세한 내용

### 상세 동작과 정확성 경계

처음 실행하는 사용자는 [README의 첫 점검](../../README.md#첫-점검)을 따라 하세요. 아래 내용은 세션·수집·판정이 어떤 조건에서 유효한지 확인할 때 사용하는 상세 참조입니다.

Burp Browser에 연결된 프록시 리스너와 ZAP용 SCANNER 리스너를 구분합니다. Montoya는 확장 프로그램에서 listener를 생성할 수 없습니다. 8082 source 분류는 과거 직접 클라이언트 관측 호환용이며, 새 Explorer는 이 listener가 아니라 Montoya 전송을 사용합니다.

| Listener | Source | 사용 클라이언트 |
|---|---|---|
| Burp Browser가 실제 사용 중인 리스너 (`8080` 또는 다른 포트) | HUMAN | 활성 pass의 첫 범위 내 요청에서 연결 |
| `127.0.0.1:8081` | SCANNER | 대상 요청을 보내는 ZAP |
| `127.0.0.1:8082` | LLM | 선택적 직접 클라이언트 관측 fallback (`UNVERIFIED_RUNTIME`, Evidence 보존만; coverage·완료 불가) |

HUMAN pass는 기존 명시 HUMAN 포트뿐 아니라 첫 범위 내 요청이 들어온 미매핑 리스너도 그 run에 연결합니다. 계정의 로그인 연결 캡처만 시작한 경우에도 해당 캡처의 첫 범위 내 요청 리스너를 HUMAN으로 연결해 인증 후속 응답을 확인합니다. 요청 시점 리스너 포트를 Evidence에 남기고 화면의 Proxy 상태를 실제 포트로 갱신합니다. 같은 run 또는 로그인 캡처의 다른 미매핑 포트는 자동으로 합치지 않으며, ZAP `8081`과 LLM 예약 포트는 HUMAN으로 바꾸지 않습니다. 이전 버전에서 이미 `UNKNOWN`으로 저장된 요청은 리스너 근거가 없어 소급 귀속하지 않습니다.

native Linux Docker Engine의 ZAP은 [Docker의 기본 `host-gateway` 매핑](https://docs.docker.com/reference/cli/dockerd/#configure-host-gateway-ip)에 따라 호스트의 default bridge IP로 연결합니다. `127.0.0.1:8081`만 연 상태로는 이 경로를 받을 수 없으므로, 해당 bridge IP에 SCANNER listener를 추가합니다.

각 대상 클라이언트에 Burp CA 인증서를 설치하십시오. TLS 검증을 영구적으로 끄지 마십시오. FlowScope가 직접 보내는 Request Lab·교차 신원 재전송·LLM Explorer 요청은 Burp Repeater와 같이 대상 서버 인증서를 검증하지 않으므로 자체 서명·사설 CA 실험실 대상에도 동작합니다. 전송은 exact scope로 제한되며, 테스트 계정만 사용한다는 전제입니다.

Web UI의 **프로젝트 관리**에서 허가된 exact scope를 지정합니다. 새 프로젝트의 점검 대상 주소는 한 줄에 하나씩 추가하고, 현재 프로젝트의 범위는 **프로젝트 수정**에서 변경합니다. scope는 scheme, host, effective port, 선택적 path prefix를 포함합니다. Burp 탭의 접힌 **프로젝트 도구**에는 현재 범위가 읽기 전용으로 표시됩니다.

```text
https://api.example.test/v1
http://127.0.0.1:3000/
```

scope가 비어 있으면 ZAP 캠페인 실행은 차단됩니다.

관측 Evidence가 0건인 Web UI는 분석 수치와 고급 조작을 먼저 펼치지 않습니다. exact scope 설정, 로그인/HUMAN pass, ZAP 기준선, Evidence 검토 순서와 빠른 시작·샘플 조작만 보여 주며, Evidence가 생기면 기존 분석 작업면으로 자동 전환합니다.

ZAP의 `scope-only`는 FlowScope scope가 아니라 ZAP Context를 기준으로 합니다. 따라서 캠페인은 각 신원마다 선택 target의 origin·path subtree만 포함하는 fresh Context를 만들며 sibling path·subdomain·다른 port/scheme은 포함하지 않습니다. Context 생성이나 passive rule 활성 확인에 실패하면 spider를 시작하지 않습니다.

### 일반적인 점검 흐름

1. Web UI에서 exact scope를 설정하고 익명 또는 최소 권한 테스트 계정을 사용합니다. ADMIN 계정은 필수가 아니며 명시적 역할 비교가 필요한 경우에만 사용합니다.
2. **계정·세션**에서 USER A/USER B처럼 비밀값이 없는 표시 이름을 한 번 등록합니다. 등록 창은 화면 중앙에 뜨며 표시 이름·역할·대상 서비스(scope가 있으면 자동 입력)만 받고, 관리 창은 왼쪽 메뉴(기본 정보·HUMAN·ZAP 로그인)로 나뉩니다. 계정은 비로그인 카드와 함께 카드로 보이며 Human 수집 상태(수집 대기·수집 중·수집 일시 정지·기록 분석 중·수집 종료)와 출처별 요청 건수, ZAP·LLM 사용 여부, 마지막 기록 시각을 한 카드에 모읍니다. 카드의 **시작**은 그 계정 전용 브라우저를 열어 HUMAN pass를 시작하고, **일시 정지**는 브라우저를 둔 채 기록만 멈추며 다시 **시작**하면 이어서 기록합니다. **종료**는 브라우저를 정리한 뒤 받은 기록을 분석하고, **수집 보기**는 점검 시작의 **수집 기록** 탭으로 이동합니다. 화면 위쪽 **비로그인 자동 검증**을 켜면 계정으로 방문한 GET API를 같은 URL·쿼리마다 한 번씩 비로그인으로 다시 보내며, 켠 뒤 새로 수집한 요청부터 적용합니다. HUMAN 세션은 별도 로그인 캡처 없이 HUMAN pass가 잡으며, 관리 창의 HUMAN 메뉴는 저장된 인증값을 헤더 이름과 앞 4자만 보여 주고(원문은 화면에 오지 않음), Burp 요청 헤더를 붙여넣어 교체하며(Cookie·Authorization·CSRF 헤더만 저장), 기록된 요청은 마스킹된 요청·응답 원문을 펼쳐 본 뒤 연결합니다. HUMAN 요청은 Burp에 실제로 연결된 HUMAN 프록시 리스너(예: 8888)로 들어와도 같은 계정으로 기록됩니다. 같은 브라우저 프로필에서 A를 로그아웃한 뒤 B로 로그인하는 방식은 Cookie·localStorage·IndexedDB 잔여 상태를 격리하지 못합니다. 다른 등록 계정의 자격증명이 B 캡처 요청에서 감지되면 그 교환은 어느 계정의 재사용 세션도 갱신하지 않으며 B는 성공 응답이 별도로 확인될 때까지 `로그인 확인 필요`로 남습니다. 같은 등록 계정에 ZAP 로그인 설정과 LLM 탐색의 브라우저 로그인을 연결할 수 있으며 이를 별도 신원으로 만들지 않습니다. ZAP 설정이 있는 계정은 전체 크롤링 없이 **세션 갱신**만 실행해 ZAP Browser Based Authentication의 검증된 응답을 독립 HUMAN 재전송 세션으로 연결할 수 있습니다. 기본 화면에는 계정 하나가 카드 하나로 보이며 Cookie·Authorization·subject 지문은 계정 수를 늘리지 않고 접힌 **기술 정보**에만 묶입니다. 자격증명만 있고 성공 응답이 관측되지 않은 세션은 `로그인 확인 필요`로 남아 Request Lab에 재사용되지 않습니다. HUMAN pass는 사전 로그인 캡처 없이 대상 서비스의 등록 계정 누구로든 시작합니다. 계정을 고른 pass 동안 Cookie 또는 Authorization이 있는 브라우저 요청은 그 계정으로 기록되고, 그 계정 세션은 매 요청의 최신 인증값으로 갱신되어(쿠키 회전 추종) 성공 응답 뒤 Request Lab `현재 세션` 재전송에 바로 쓰입니다. 인증값이 없는 요청은 비로그인으로 남습니다. 시작부터 종료까지는 사용자가 고른 계정이 기준입니다. 새로 로그인하거나 토큰·쿠키가 바뀌어도 수집을 멈추지 않고 그 계정의 최신 인증값으로 따라가며, 같은 인증값이 예전에 다른 계정에 잘못 연결돼 있었다면 이번 선택으로 덮어씁니다. Repeater·Intruder에서 다른 JWT 사용자로 바꾼 요청만 수집 계정에 넣지 않습니다. 계정 전환은 자동으로 감지하지 않으므로 다른 계정으로 바꾸기 전에 반드시 종료한 뒤 그 계정으로 다시 시작하십시오. 트래픽이 없는 새 프로젝트의 Home **빠른 시작**은 계정·세션으로 이동해 비교할 계정부터 등록하게 합니다. raw 세션 값은 확장 메모리에만 남으며 LLM에 반환하거나 프로젝트에 저장하지 않습니다. 로그인 준비 트래픽과 HUMAN pass 밖에서 발생한 같은 scope 트래픽도 Evidence로는 보존하지만 3-way 비교와 갭에서는 제외합니다. **HUMAN pass 시작** 후 허가된 기능을 탐색하고 같은 run을 종료하십시오. Web의 `pass 완료`는 수집 건수가 아니라 해당 run의 정확한 종료가 확인됐을 때만 표시됩니다. pass 중 Repeater·Intruder로 만든 요청은 같은 run에 속하되 실제 Burp 도구 detail을 유지합니다. Proxy·Repeater·Intruder 응답은 Montoya `messageId`로 요청 시점 pass/account에 연결되며, 데이터셋·프로젝트 교체 이전의 늦은 응답이나 상관관계를 잃은 응답은 현재 pass로 추측하지 않고 제외됩니다. 대상 동작만으로 알 수 없는 신원 역할, endpoint 요구 역할, 확인된 객체 소유자는 사용자가 지정합니다. BOLA 비교에는 서로 다른 최소 권한 계정 2개를 권장합니다. 계정별 운영 절차와 세션 검증 한계는 [세션 계정 격리](../SESSION_ACCOUNT_ISOLATION.md)를 참고하세요.

- 선택적 수동 검증: 그래프에서 API를 누르고 관측 기록의 **요청 실험실**을 엽니다. 화면은 인증 교체 전 관측 원문을 표시하고 선택 계정 인증값은 노출하지 않으며, Web 전송 또는 Burp Repeater 초안 생성 시 서버에서 교체합니다. Web 전송은 `현재 ACTIVE 계정`·`비로그인`·`원문 그대로`를 지원하며, Burp Repeater 초안은 원본 인증값 대신 `현재 세션` 또는 `비로그인`으로만 엽니다. path/query/header/body를 편집해도 네트워크 목적지는 원 Evidence 서비스로 고정되고 redirect는 따라가지 않습니다. 응답과 시간·크기를 확인할 수 있으며 전송 결과는 HUMAN `VALIDATION` Evidence가 되어 탐색 커버리지를 늘리지 않습니다. live 원문은 기본 요청 1MiB·응답 4MiB·총 32MiB의 Burp 프로세스 메모리에서만 유지되고 프로젝트·샘플 교체와 unload 때 폐기됩니다. 프로젝트/XML/HAR에서 가져온 항목이나 상한 초과 항목은 마스킹 전문만 사용할 수 있습니다.

3. bundle의 `zap-up` helper로 FlowScope Docker Chromium ZAP을 시작합니다. helper가 outgoing proxy를 `host.docker.internal:8081`로 설정하고, Web 빠른 시작은 API key·휘발성 runtime·필수 add-on을 확인합니다. 점검 시작의 **ZAP 스캔** 단계는 등록 계정 표에서 비로그인 또는 ZAP 로그인이 설정된 계정을 고른 뒤 **스캔 시작**을 누릅니다. 로그인이 없는 계정은 같은 줄의 **설정**이 계정 관리 창의 ZAP 로그인 메뉴(로그인 URL·ID·비밀번호)를 바로 엽니다. ZAP이 꺼져 있으면 **켜는 방법**이 OS별 `zap-up` 명령과, 폴더가 없을 때 받을 릴리즈 링크를 보여 줍니다. 로그인 lane은 같은 계정의 실제 인증 응답 Evidence가 성공 정규식과 일치한 뒤에만 `FLEXIBLE` Client Spider(페이지가 불러오는 외부 CDN 정적 자산만 추가 로드, 외부 호스트는 크롤링하지 않음) → 일반 Spider(같은 계정, GET만) → Passive 분석 → native Alert 수집 순서로 실행합니다. 계정의 **세션 갱신**은 이 인증 단계만 격리 실행하고 검증된 세션을 Session Broker로 옮기며 크롤링하지 않습니다. 선택적 로그아웃 정규식에는 실패 화면에만 보이는 문구를 넣습니다. Client 실패·범위 안 응답 0건·격리 정리 실패는 lane 실패로 표시하고, 로그인 실패를 익명 성공으로 바꾸지 않습니다. 화면은 경과시간·작업 신호·계정별 순번·인증 상태·Client 수집 건수·Passive queue·Alert 집계를 표시합니다. Active Scan·Fuzzer·Forced Browse는 기본 캠페인에 포함되지 않습니다.
4. 점검 시작의 **LLM 탐색** 단계에서 시작 URL, 비로그인 및 필요한 계정을 고릅니다. 계정마다 **브라우저 로그인**을 누르면 FlowScope가 별도 Chromium 창을 띄우고, 그 창에서 직접 로그인한 뒤 **로그인 완료**를 누릅니다. 이 창의 기록은 HUMAN 직접 둘러보기와 섞이지 않습니다. 비밀번호는 받지 않으며 live cookie/token은 현재 프로세스 메모리에만 있고 모델에는 opaque handle만 전달됩니다. 로그인 준비 교환은 프로젝트/Evidence/원장에 저장하지 않습니다. 실제 대상 응답과 산출물 선언은 Observation/Declaration으로 분리되며 선언에는 현재 run Evidence ID가 필수입니다. 작업 피드에서 경과시간·HTTP 시도/응답, 선언 endpoint/parameter, OPTIONS probe, 실패·미해결 항목을 확인하고 실행 중 steer·취소할 수 있습니다.
5. **API·입력 차이**, **관측 기록**, 그래프·매트릭스에서 선언/관측과 인가 후보를 확인합니다. 규칙 후보의 사람 검토를 저장할 수 있으며, 자동 LLM 판정은 하지 않습니다.
6. 과거 프로젝트의 assessment/validation은 React **시나리오 → 과거 LLM 기록 · 읽기 전용**에서 확인합니다. 원 Evidence ID·생성 시각을 보존하되 현재 후보나 새 판정으로 합치지 않습니다.
7. Burp 탭의 **프로젝트 도구**를 펼친 뒤 **로컬 DB 저장·연결**로 `.flowscope.db`를 한 번 지정합니다. 이후 그래프·계정·검토·판정 변경은 30초 checkpoint로 합쳐 같은 DB에 원자적으로 자동 저장됩니다. 정상 unload는 새 수집·가져오기·분석 게시를 먼저 닫고 대기 중 Evidence의 마지막 분석을 반영한 뒤 한 번 더 저장을 시도합니다. 공유·검토용 단일 문서가 필요하면 **JSON 내보내기**를 사용합니다. DB에도 raw broker 또는 Explorer 자격증명은 저장되지 않으므로 Burp를 다시 열면 로그인 연결은 다시 해야 합니다.

> ZAP 로그인 교환은 감사 가능한 `ZAP_AUTHENTICATION / SESSION_SETUP` Evidence로 보존되지만, SCANNER 탐색 성과·crawler 수집 건수·완료 조건에는 포함되지 않습니다. 따라서 로그인만 성공하고 crawler가 응답을 수집하지 못한 lane은 완료로 표시되지 않습니다.

### LLM Explorer 상태

기존 `/api/llm-run`, `/api/ai-preview`, `/api/ai-scenarios`와 MCP 서버는 삭제된 채 유지됩니다. `8787` 리스너, MCP 토큰, 격리 브라우저, Judge, agent-workspace는 없습니다. 새 `/api/explorer-run`과 `/api/explorer-accounts`는 React Explorer 화면 전용의 loopback Web 계약입니다.

공식 Codex CLI 설치·로그인이 필요하지만 API key, Node.js 직접 설치, Playwright 또는 MCP 설정은 필요하지 않습니다. 계정 로그인 창은 `-Dflowscope.browser.path`로 지정한 브라우저, Burp에 포함된 Chromium, 시스템 Chrome/Chromium 순서로 찾아 띄웁니다. FlowScope는 Codex 실행 파일과 로그인 상태를 확인하고, 모델에는 인증 비밀 대신 opaque account handle과 HTTP·브라우저 조작·선언 dynamic tool만 제공합니다. app-server dynamic tools는 현재 experimental API이므로 실제 설치된 CLI 호환성은 readiness와 opt-in 실물 provider gate로 확인합니다. LLM 응답 Evidence 0건은 완료가 아니라 실패로 남고, 모델의 자유서술 개수는 완료 집계로 사용하지 않습니다.

### 실행별 모델 선택

**탐색 모델** 목록은 현재 로그인 계정의 app-server `model/list`에서 받고, 선택한 모델을 해당 Explorer run의 `thread/start`에만 지정합니다. 목록에 없는 모델은 시작 전에 거부하며 사용자 전역 `config.toml`은 변경하지 않습니다. 완료된 실행 화면으로 돌아오면 마지막 요청 모델과 아직 READY인 계정만 다음 실행의 편집 가능한 초기값으로 복원하고, 시작 요청에는 화면의 선택값을 그대로 보냅니다. 마지막 모델이 현재 목록에서 사라졌다면 사용 불가로 표시하고 새 모델 선택 전에는 시작하지 않습니다. 모델 선택은 LLM 탐색 제목 옆에 **탐색 모델**(한 번 실행한 뒤에는 **다음 탐색 모델**)로 표시하고 실행 중에는 변경할 수 없습니다. 완료 후에도 접힌 실행 세부정보를 열어 지난 요청 모델과 고정된 실행 수치를 확인하면서 다음 실행 모델을 선택할 수 있습니다. 실행 세부정보는 요청 모델을 표시하며 Codex 서비스가 모델을 재라우팅하면 작업 피드에 실제 전환을 따로 기록합니다. 목록을 불러오지 못한 경우에는 기존처럼 Codex 기본 설정으로 시작할 수 있고, 그때 실제 모델은 미확인으로 표시합니다.

모델 목록의 `isDefault`는 Codex가 추천하는 기본값이지 이 PC의 `config.toml` 선택값이 아닙니다. 명시적으로 고른 모델은 실행 상태에 남지만, 모델을 지정하지 않고 Codex 기본값으로 실행한 경우에는 실제 모델 ID를 추측하지 않습니다. Explorer는 Codex 전용이며 Claude 공급자는 지원하지 않습니다.
