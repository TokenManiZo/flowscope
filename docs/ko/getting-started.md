# FlowScope 설치·첫 실행 가이드

이 문서는 처음 설치하는 사용자가 HUMAN, SCANNER, LLM/Judge 3-way 흐름을 재현하기 위한 절차다. FlowScope는 Burp 확장이므로 Burp와 구독 LLM 클라이언트는 호스트에서 실행한다. Docker는 ZAP을 쉽게 준비하는 선택 경로이며 제품 전체의 필수 조건이 아니다.

## 1. 지원 경로와 검증 범위

| 경로 | 용도 | 필요한 것 |
|---|---|---|
| Release JAR + ZAP Desktop | 기존 GUI 점검 환경을 그대로 사용 | Burp, ZAP 2.17.0, Codex 또는 Claude Code |
| Release JAR + Docker ZAP | 버전·add-on을 고정한 재현 환경 | Burp, Docker Compose v2, Codex 또는 Claude Code |
| 소스 빌드 | 코드 수정·기여 | 위 환경, JDK 21+, Maven 3.9+ |

실제 확인한 기준선은 다음과 같다.

- Burp Suite Community 2026.7.3에서 Montoya 확장 로드
- ZAP 2.17.0 API와 `spider`, `client`, `spiderAjax`, `pscan`, `pscanrules`, `selenium`, `openapi`, `websocket`, `network` add-on
- macOS arm64, Docker Engine/Desktop 29.5.3에서 공식 ZAP 2.17.0 multi-architecture 이미지 기동, loopback API, Docker-host Burp upstream 설정
- GitHub Actions `windows-latest` PowerShell 7에서 Windows helper 네 파일의 파서 검증
- JDK 21 Maven 빌드

Windows 실행 경로는 Windows 10/11, Docker Desktop의 Linux container backend, PowerShell 7을 지원 계약으로 삼는다. GitHub Windows runner의 파서 검증은 실제 Docker Desktop 기동을 증명하지 않는다. 특히 Windows 실기기의 ZAP API·Burp upstream, Docker ZAP의 HTTPS 대상, USER A/B 세션 주입, Client/AJAX rendered capture는 별도 실환경 gate를 통과해야 한다.

공식 근거:

- [PortSwigger: Java 확장 빌드·로드](https://portswigger.net/burp/documentation/desktop/extend-burp/extensions/creating/loading-in-burp)
- [ZAP: 공식 Docker 이미지와 headless/xvfb 실행](https://www.zaproxy.org/docs/docker/about/)
- [ZAP: Network API의 upstream HTTP proxy 설정](https://www.zaproxy.org/docs/desktop/addons/network/api/)
- [Docker Desktop: 컨테이너에서 호스트로 연결하는 `host.docker.internal`](https://docs.docker.com/desktop/features/networking/networking-how-tos/)
- [Docker Compose: file-backed secret과 읽기 전용 service mount](https://docs.docker.com/reference/compose-file/services/)
- [Microsoft: `Set-Acl`과 ACL 상속 차단](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-acl)
- [Microsoft: 암호학적 `RandomNumberGenerator.GetBytes`](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.randomnumbergenerator.getbytes)
- [GitHub Actions: Windows 기본 `pwsh` shell](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [OpenAI Docs: Codex CLI 설치·로그인](https://developers.openai.com/codex/cli)
- [Anthropic: Claude Code 시작](https://docs.anthropic.com/en/docs/claude-code/getting-started)

## 2. 포트 계약

| 주소 | 소유자 | 의미 |
|---|---|---|
| `127.0.0.1:8080` | Burp | HUMAN 브라우저·수동 도구 트래픽 |
| `127.0.0.1:8081` | Burp | ZAP이 upstream으로 보내는 SCANNER 트래픽 |
| `127.0.0.1:8082` | Burp | 선택적 직접 LLM fallback, 기본 MCP 흐름에는 불필요 |
| `127.0.0.1:8089` | ZAP | 로컬 ZAP proxy/API |
| `127.0.0.1:8787` | FlowScope | 인증된 로컬 MCP |
| `127.0.0.1:17777` | FlowScope | 로컬 Web 작업면 |

다른 프로세스가 같은 포트를 사용하면 먼저 충돌을 해소한다. FlowScope 포트를 JVM 속성으로 바꿀 수 있지만, ZAP upstream과 문서의 listener 값도 같은 값으로 맞춰야 한다.

## 3. Release JAR 설치

완전한 3-way에서 ZAP key 또는 Docker helper를 사용하려면 `git clone https://github.com/choewonwoo1817/testflowscope.git` 후 저장소 루트로 이동한다. HUMAN-only 사용자는 clone 없이 JAR만 받아도 된다.

1. [GitHub Releases](https://github.com/choewonwoo1817/testflowscope/releases)에 `flowscope-1.2.0-beta.34.jar` 자산이 게시돼 있으면 받는다. 아직 게시되지 않았다면 저장소를 clone하고 §7의 소스 빌드 절차로 같은 이름의 JAR을 만든다.
2. Burp **Settings → Tools → Proxy → Proxy listeners**에서 다음 두 listener를 만든다.
   - bind address `127.0.0.1`, port `8080`
   - bind address `127.0.0.1`, port `8081`
3. Burp **Extensions → Installed → Add**를 누른다.
4. Extension type을 **Java**로 고르고 JAR을 선택한다.
5. Output/Errors에 로드 오류가 없는지 확인한다.
6. FlowScope 탭에서 Web UI `127.0.0.1:17777`, MCP `127.0.0.1:8787`이 준비됐는지 확인한다.

Release JAR 사용자는 Maven이 필요하지 않다. Burp를 custom Java로 실행하면 class file 호환을 위해 Java 21 이상을 사용한다.

Web `127.0.0.1:17777`의 **빠른 시작**은 `범위 → HUMAN → ZAP → LLM·Judge` 상태를 표시하고 첫 미완료 단계 하나만 연다. 열린 단계의 입력과 버튼만 처리하면 다음 단계로 이동하며, 완료된 설정을 다시 확인하려면 상단 단계 버튼을 누른다. `현재 단계로`를 누르면 첫 미완료 단계로 돌아온다.

## 4. ZAP 준비 — Desktop 또는 Docker 중 택1

FlowScope는 `127.0.0.1:8089`의 호환 ZAP API를 확인한다. Web **빠른 시작 → 로컬 ZAP 연결**은 연결 여부·버전·key 오류를 실행 전에 표시하고, 연결 전에는 캠페인 버튼을 비활성화한다. API만으로 Desktop과 Docker를 신뢰성 있게 구분할 수 없으므로 배포 방식을 추측하지 않는다.

기존 ZAP GUI를 사용하려면 아래 **Desktop 경로**를, 팀·CI·벤치마크에서 버전과 add-on을 고정하려면 **Docker Quick Start**를 선택한다. 둘을 동시에 실행하면 `8089` 포트가 충돌하므로 하나만 실행한다.

### Docker Quick Start — macOS/Linux

저장소 루트에서 실행한다.

```bash
./scripts/zap-up.sh
```

이 명령이 수행하는 범위는 고정돼 있다.

1. 공식 `ghcr.io/zaproxy/zaproxy:2.17.0` multi-architecture manifest를 digest로 고정해 실행한다.
2. 32-byte random API key를 생성해 `~/.flowscope/zap-api-key`에 저장하고 POSIX 환경에서는 `0600`으로 제한한다.
3. ZAP은 xvfb 경로로 시작해 이미지에 포함된 Firefox/Selenium provider를 사용할 수 있게 한다.
4. 공식 Network API로 upstream HTTP proxy를 `host.docker.internal:8081`에 설정하고 활성 상태를 다시 읽어 검증한다.
5. 호스트 공개 포트는 `127.0.0.1:8089`로 제한한다. 컨테이너 내부 API 허용 범위가 넓어도 호스트 외부 인터페이스에는 publish하지 않는다.
6. FlowScope는 다음 JAR 로드 때 기본 key 파일을 자동으로 읽는다. 이미 JAR을 로드한 상태에서 key를 처음 만들었다면 확장을 한 번 재로드한다.

상태 확인과 중지는 다음과 같다.

```bash
docker compose -p flowscope-zap -f infra/zap/compose.yaml ps
docker compose -p flowscope-zap -f infra/zap/compose.yaml logs
./scripts/zap-down.sh
```

다른 포트를 써야 한다면 시작 전에 두 값을 함께 지정한다.

```bash
FLOWSCOPE_ZAP_PORT=18089 FLOWSCOPE_BURP_SCANNER_PORT=18081 ./scripts/zap-up.sh
```

이 경우 Burp SCANNER listener, `-Dflowscope.ports`, `-Dflowscope.zap.url`도 같은 값으로 바꿔야 한다. 일부 값만 바꾸면 SCANNER provenance가 생기지 않는다.

### Docker Quick Start — Windows 10/11

Docker Desktop을 Linux container 모드로 시작하고 일반 사용자 PowerShell 7에서 저장소 루트로 이동한 뒤 실행한다.

```powershell
.\scripts\zap-up.ps1
```

스크립트는 .NET `RandomNumberGenerator`로 32-byte key를 만들고 `Set-Acl`로 상속을 제거한 뒤 현재 Windows 사용자에게만 FullControl을 준다. Compose는 값을 환경변수로 넘기지 않고 file-backed secret으로 `/run/secrets/flowscope-zap-api-key`에 읽기 전용 마운트한다. Docker Desktop가 공식 제공하는 `host.docker.internal`을 통해 컨테이너 ZAP이 호스트 Burp `8081`에 연결된다.

상태 확인·중지는 다음과 같다.

```powershell
docker compose -p flowscope-zap -f infra/zap/compose.yaml ps
docker compose -p flowscope-zap -f infra/zap/compose.yaml logs
.\scripts\zap-down.ps1
```

포트를 바꾸려면 같은 PowerShell 세션에서 함께 지정한다.

```powershell
$env:FLOWSCOPE_ZAP_PORT = '18089'
$env:FLOWSCOPE_BURP_SCANNER_PORT = '18081'
.\scripts\zap-up.ps1
```

PowerShell 5.1, Windows container 모드, WSL 안에서 실행한 helper는 beta.21 지원 계약이 아니다. WSL 사용자는 Linux Bash 경로를 쓰되 Burp가 Windows 호스트에 있으면 listener 도달성을 직접 확인한다. key를 처음 만든 뒤 이미 로드된 FlowScope 확장은 한 번 재로드한다.

## 5. ZAP Desktop 경로

1. ZAP 2.17.0을 설치한다.
2. 저장소 루트에서 API key를 생성한다. 값은 화면에 출력되지 않는다.

   macOS/Linux:

   ```bash
   ./scripts/zap-key.sh
   ```

   Windows PowerShell 7:

   ```powershell
   .\scripts\zap-key.ps1
   ```

3. ZAP의 main local server/proxy를 `127.0.0.1:8089`로 설정한다.
4. ZAP API options에서 생성된 `~/.flowscope/zap-api-key` 값을 local API key로 설정한다. key 비활성화는 하지 않는다.
5. ZAP **Options → Network → Connection → HTTP Proxy**에서 Desktop은 host `127.0.0.1`, Docker는 `host.docker.internal`, port `8081`, enabled를 설정한다. FlowScope는 캠페인 전에 이 값을 읽어 확인하며 자동으로 사용자의 ZAP 전역 프록시 설정을 덮어쓰지 않는다.
6. 설치 add-on에 `spider`, `client`, `spiderAjax`, `pscan`, `pscanrules`, `selenium`, `openapi`, `websocket`, `network`가 있는지 확인한다. 명시적 정의 import를 쓰면 해당 형식의 `graphql`, `postman`, `soap`도 필요하다.
7. API key는 다음 중 하나로 FlowScope에 제공한다.
   - 기본 `~/.flowscope/zap-api-key`, owner-only 파일
   - `-Dflowscope.zap.keyFile=/absolute/path`
   - `FLOWSCOPE_ZAP_API_KEY`
   - `-Dflowscope.zap.key=...`

우선순위는 JVM 속성 key → 환경 변수 → 지정 key 파일 → 기본 key 파일이다. secret을 Git, README, 실행 로그에 넣지 않는다.
이미 FlowScope를 로드한 뒤 key를 만들었다면 확장을 한 번 재로드한다.

## 6. Codex 또는 Claude Code 준비

완전한 3-way에는 둘 중 하나가 필요하다.

FlowScope는 상속 `PATH` 외에 macOS/Linux의 `~/.local/bin`, Homebrew, `NVM_BIN`·`PNPM_HOME`·`BUN_INSTALL`와 Windows의 WinGet/npm 사용자 경로에서 CLI를 자동 탐지한다. 공식 로그인 상태 명령은 백그라운드에서 확인하고 READY provider를 자동 선택하며, 실행 직전에 다시 확인한다. 해석된 실행 파일 부모는 자식 `PATH` 앞에 추가해 축소된 Burp 환경의 `#!/usr/bin/env node` launcher도 같은 설치 디렉터리의 런타임을 찾게 한다. provider API key는 상태 확인과 실제 실행 양쪽에서 제거한다. 표준 밖 portable 설치만 아래 절대 경로 설정이 필요하다.

### Codex

1. [공식 Codex CLI 가이드](https://developers.openai.com/codex/cli)에 따라 설치한다.
2. 터미널에서 `codex`를 실행하고 **Sign in with ChatGPT** 등 제공되는 로그인 방법으로 인증한다.
3. `codex --version`이 성공하는지 확인한다.

버튼 실행에는 일반 Codex 로그인 파일인 `$CODEX_HOME/auth.json` 또는 `~/.codex/auth.json`이 필요하다. FlowScope는 매 실행마다 owner-only 임시 `CODEX_HOME`을 만들고 이 로그인 파일만 연결한다. 전역 `config.toml`, 사용자 skill/plugin, memory와 이전 session은 복사하거나 상속하지 않는다. 로그인 파일이 없으면 대상 요청 전에 `codex login` 안내와 함께 실패한다.

### Claude Code

1. [공식 Claude Code 시작 가이드](https://docs.anthropic.com/en/docs/claude-code/getting-started)에 따라 설치한다.
2. 터미널에서 `claude`를 실행해 로그인한다.
3. `claude --version`이 성공하는지 확인한다.

FlowScope 버튼은 Burp 프로세스가 보는 `PATH`에서 실행 파일을 찾는다. Finder/Start Menu로 실행한 Burp가 터미널 PATH를 상속하지 못하면 다음 시스템 속성으로 절대경로를 지정해 Burp를 시작한다.

```text
-Dflowscope.llm.codex.path=/absolute/path/to/codex
-Dflowscope.llm.claude.path=/absolute/path/to/claude
```

FlowScope는 model API key를 요구하지 않는다. provider 로그인/구독 상태와 한도는 각 CLI가 관리한다. 전역 `HTTP_PROXY`/`HTTPS_PROXY`로 provider 트래픽을 Burp에 보내지 않는다.

## 7. 환경 점검

JAR을 로드하고 Docker ZAP을 시작한 뒤 실행한다.

```bash
./scripts/doctor.sh
```

Windows PowerShell 7:

```powershell
.\scripts\doctor.ps1
```

검사 항목:

- HUMAN `8080`, SCANNER `8081` 포트 연결 가능 여부
- owner-local ZAP key 파일과 loopback ZAP API
- ZAP 2.17.0 기준선, Burp upstream proxy, crawler/passive/browser add-on
- Codex/Claude 실행 파일 중 하나
- FlowScope Web `17777`, MCP `8787`

소스 빌드는 다음을 사용한다.

```bash
./scripts/doctor.sh --build
mvn clean verify
```

Windows 소스 빌드는 `.\scripts\doctor.ps1 -Build` 후 `mvn clean verify`를 실행한다.

doctor의 포트 검사는 포트를 연 프로세스의 제품 신원을 증명하지 않는다. `8080/8081`이 열렸더라도 Burp listener 표와 FlowScope 포트 분류를 눈으로 대조한다.
기본 포트를 바꿨다면 `FLOWSCOPE_HUMAN_PORT`, `FLOWSCOPE_BURP_SCANNER_PORT`, `FLOWSCOPE_ZAP_PORT`, `FLOWSCOPE_WEB_PORT`, `FLOWSCOPE_MCP_PORT`를 같은 shell/PowerShell 세션에 지정해 doctor 기준도 맞춘다. Windows doctor는 key ACL 상속과 다른 SID의 허용 규칙도 검사한다.

## 8. 첫 3-way 실행

1. FlowScope 탭에 허가받은 `scheme://host[:port]/path-prefix` exact scope를 한 줄씩 입력하고 **범위 적용**을 누른다.
2. Web **계정·세션**에서 테스트 계정을 등록한다. 계정 로그인이 필요하면 **로그인 연결**을 시작하고 HUMAN `8080` 경로로 로그인한 뒤 성공한 인증 페이지까지 확인하고 캡처를 종료한다.
3. **HUMAN pass 시작**을 누르고 Burp 브라우저로 허가된 기능을 탐색한 다음 pass를 종료한다.
4. 빠른 시작의 ZAP 카드에서 대상과 비로그인/ACTIVE 계정을 고른다. 이미 보유한 API 정의가 있으면 한 줄에 하나씩 `OPENAPI URL`, `POSTMAN URL`, `SOAP URL`, `GRAPHQL ENDPOINT [SCHEMA_URL]`로 입력하고 **신원별 격리 검사 시작**을 누른다. 모든 URL은 현재 exact scope 안이어야 한다. 정의 import는 명세의 write method 요청도 만들 수 있으므로 이어지는 Burp 승인창에서 한 번 더 확인한다. 비워 두면 정의를 추측하지 않고 Spider 기준선만 실행한다. Active Scan은 자동 baseline에 포함되지 않는다.
5. 계정을 고르고 **LLM Explorer 시작**을 누른다. FlowScope가 공식 상태 명령으로 확인한 READY provider를 자동 선택하므로 API key 입력이나 MCP 설정 복사는 없다. provider 상태가 방금 바뀌었을 때만 **다시 확인**을 누른다. **LLM 작업 피드**에서 실제 모델 메시지·FlowScope 도구 상태·Evidence 완료 게이트와 주입 지침을 확인한다. 숨겨진 추론과 raw tool payload는 표시하지 않는다. Explorer가 실제 응답 Evidence를 한 건 이상 남기고 서버가 같은 run 종료를 승인해야 LLM lane이 완료된다. 취소·도구 거부·0건 실행은 실패로 남는다.
6. `REVIEW` 항목을 확인한 뒤 세 lane이 완료되면 **Judge 시작**을 누른다.
7. finding은 원 Evidence, 같은 run의 반복 재현, 정상 대조가 서버 gate를 통과했는지 확인한다. ZAP Alert나 LLM 문장만으로 확정하지 않는다.
8. `.flowscope.db`를 연결해 자동 checkpoint를 활성화한다. raw broker credential은 DB에 저장되지 않으므로 Burp 재시작 뒤에는 다시 로그인 연결한다.

### 이미 내보낸 ZAP 트래픽을 가져올 때

Web 상단의 **스캐너 XML/HAR**에서 ZAP **Save Selected Entries as HAR**로 만든 `.har` 파일을 고른다. FlowScope는 HAR의 HTTP 요청·응답만 `SCANNER / HAR_IMPORT / IMPORT` Evidence로 가져오고 현재 exact scope 밖 entry는 제외한다. 이 폴백은 live campaign의 신원별 fresh session, rendered crawl 완료, passive queue, native Alert를 복원하지 않으므로 파일 가져오기를 “ZAP 기준선 완료”로 표시하지 않는다. ZAP의 Alert까지 비교하려면 정상 캠페인 경로를 사용한다.

## 9. 문제 해결

| 증상 | 확인할 사실 | 조치 |
|---|---|---|
| `Extension class is not a recognized type` | thin JAR 또는 잘못된 타입 선택 | Release의 `flowscope-*.jar` 하나를 Java 확장으로 다시 로드 |
| ZAP API 연결 실패 | `127.0.0.1:8089`, key 불일치 | OS에 맞는 `doctor.sh`/`doctor.ps1`, Compose logs, key 파일 확인 후 FlowScope 재로드 |
| Windows key ACL 실패 | 상속 또는 다른 SID의 허용 규칙 | 일반 사용자 PowerShell에서 `zap-up.ps1` 재실행. 네트워크/FAT 파일시스템 대신 사용자 프로필의 NTFS 경로 사용 |
| Windows에서 컨테이너가 Burp에 연결되지 않음 | Docker Desktop Linux container 모드, Burp `127.0.0.1:8081` listener | Docker Desktop 상태와 `host.docker.internal` 도달성, Windows 방화벽을 확인 |
| ZAP은 완료했는데 SCANNER 0건 | upstream이 Burp `8081`을 통과하지 않음 또는 scope 불일치 | ZAP HTTP proxy, Burp listener, exact scope를 함께 확인 |
| 캠페인 전 ZAP outgoing proxy 오류 | Network API에서 HTTP proxy disabled 또는 host/port 불일치 | Desktop은 `127.0.0.1:8081`, Docker는 `host.docker.internal:8081`로 설정 후 다시 실행 |
| API 정의 import 경고 | URL/GraphQL endpoint가 exact scope 밖이거나 형식 add-on 누락·정의 파싱 실패 | 정의 URL과 `graphql/postman/soap/openapi` 설치를 확인. Spider Evidence는 별도로 유지됨 |
| Rendered 0건 경고 | Client/AJAX가 실제 요청을 만들지 않음 | ZAP logs, Firefox/Selenium add-on, 대상 CSP/login 상태 확인. Traditional 결과와 혼동하지 않음 |
| Explorer가 종료했는데 LLM lane 실패 | target read 취소·거부 또는 응답 Evidence 0건 | output tail의 MCP 오류를 확인하고 범위·세션·승인 상태를 수정한 뒤 새 Explorer 실행 |
| CLI 실행 파일 없음 | Burp가 CLI PATH를 상속하지 않음 | 절대경로 시스템 속성 지정 후 Burp 재시작 |
| 로그인 계정이 ZAP/LLM 선택지에 없음 | broker가 `ACTIVE`가 아님 | 로그인 연결을 다시 시작해 인증 성공 응답까지 관측 |
| `17777` 또는 `8787` 충돌 | 다른 로컬 프로세스가 포트 사용 | 충돌 프로세스를 확인하거나 JVM 속성으로 포트를 일관되게 변경 |

문제가 해결되지 않으면 Burp Extension Output/Error, `docker compose ... logs`, doctor 결과에서 secret을 제거한 뒤 이슈에 첨부한다. 대상 Request/Response, Cookie, Authorization, API key, provider token은 공개 이슈에 올리지 않는다.
