# FlowScope 설치·첫 실행 가이드

이 문서는 처음 설치하는 사용자가 HUMAN, SCANNER, LLM/Judge 3-way 흐름을 재현하기 위한 절차다. FlowScope는 Burp 확장이므로 Burp와 구독 LLM 클라이언트는 호스트에서 실행한다. Docker는 ZAP을 쉽게 준비하는 선택 경로이며 제품 전체의 필수 조건이 아니다.

## 1. 지원 경로와 검증 범위

| 경로 | 용도 | 필요한 것 |
|---|---|---|
| Release JAR + Docker ZAP | 가장 짧은 3-way 시작 경로 | Burp, Docker Compose v2, Codex 또는 Claude Code |
| Release JAR + ZAP Desktop | ZAP GUI를 직접 조정하려는 사용자 | Burp, ZAP 2.17.0, Codex 또는 Claude Code |
| 소스 빌드 | 코드 수정·기여 | 위 환경, JDK 21+, Maven 3.9+ |

실제 확인한 기준선은 다음과 같다.

- Burp Suite Community 2026.7.3에서 Montoya 확장 로드
- ZAP 2.17.0 API와 `spider`, `client`, `spiderAjax`, `pscan`, `selenium` add-on
- macOS arm64, Docker Engine/Desktop 29.5.3에서 공식 ZAP 2.17.0 multi-architecture 이미지 기동, loopback API, Docker-host Burp upstream 설정
- JDK 21 Maven 빌드

이 목록은 최소 지원 버전이나 다른 운영체제의 완료 증명이 아니다. 특히 Docker ZAP의 HTTPS 대상, USER A/B 세션 주입, Client/AJAX rendered capture는 대상별 실환경 gate를 통과해야 하며 이미지 기동 성공만으로 완료라고 판단하지 않는다.

공식 근거:

- [PortSwigger: Java 확장 빌드·로드](https://portswigger.net/burp/documentation/desktop/extend-burp/extensions/creating/loading-in-burp)
- [ZAP: 공식 Docker 이미지와 headless/xvfb 실행](https://www.zaproxy.org/docs/docker/about/)
- [ZAP: Network API의 upstream HTTP proxy 설정](https://www.zaproxy.org/docs/desktop/addons/network/api/)
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

완전한 3-way에서 Docker helper를 사용하려면 `git clone https://github.com/choewonwoo1817/testflowscope.git` 후 저장소 루트로 이동한다. HUMAN-only 사용자는 clone 없이 JAR만 받아도 된다.

1. [GitHub Releases](https://github.com/choewonwoo1817/testflowscope/releases)에서 `flowscope-1.2.0-beta.20.jar`를 받는다.
2. Burp **Settings → Tools → Proxy → Proxy listeners**에서 다음 두 listener를 만든다.
   - bind address `127.0.0.1`, port `8080`
   - bind address `127.0.0.1`, port `8081`
3. Burp **Extensions → Installed → Add**를 누른다.
4. Extension type을 **Java**로 고르고 JAR을 선택한다.
5. Output/Errors에 로드 오류가 없는지 확인한다.
6. FlowScope 탭에서 Web UI `127.0.0.1:17777`, MCP `127.0.0.1:8787`이 준비됐는지 확인한다.

Release JAR 사용자는 Maven이 필요하지 않다. Burp를 custom Java로 실행하면 class file 호환을 위해 Java 21 이상을 사용한다.

## 4. ZAP 준비 — Docker 권장 경로

macOS/Linux에서 저장소 루트에서 실행한다.

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

### Windows Docker 수동 시작

현재 자동 스크립트는 Bash가 있는 macOS/Linux에서 검증했다. Windows PowerShell을 자동 지원한다고 주장하지 않는다. Docker Desktop과 PowerShell 7에서는 다음과 같이 동일한 secret 파일과 Compose를 준비할 수 있다.

```powershell
$dir = Join-Path $HOME ".flowscope"
New-Item -ItemType Directory -Force $dir | Out-Null
$key = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
[IO.File]::WriteAllText((Join-Path $dir "zap-api-key"), $key)
$env:FLOWSCOPE_ZAP_KEY_FILE = Join-Path $dir "zap-api-key"
docker compose -p flowscope-zap -f infra/zap/compose.yaml up -d
```

Windows ACL은 사용자 환경마다 다르므로 `~/.flowscope/zap-api-key`를 현재 사용자만 읽도록 직접 확인한다. Compose는 이 파일을 컨테이너에 읽기 전용으로 마운트하며 key 값을 컨테이너 환경에 넣지 않는다. FlowScope가 key 파일을 처음 읽는 시점은 확장 로드 때다.

## 5. ZAP 준비 — Desktop 경로

1. ZAP 2.17.0을 설치한다.
2. ZAP의 main local server/proxy를 `127.0.0.1:8089`로 설정한다.
3. API options에서 local API key를 설정한다. key 비활성화는 하지 않는다.
4. ZAP **Options → Network → Connection → HTTP Proxy**에서 host `127.0.0.1`, port `8081`, enabled를 설정한다.
5. 설치 add-on에 `spider`, `client`, `spiderAjax`, `pscan`, `selenium`이 있는지 확인한다.
6. API key는 다음 중 하나로 FlowScope에 제공한다.
   - 기본 `~/.flowscope/zap-api-key`, owner-only 파일
   - `-Dflowscope.zap.keyFile=/absolute/path`
   - `FLOWSCOPE_ZAP_API_KEY`
   - `-Dflowscope.zap.key=...`

우선순위는 JVM 속성 key → 환경 변수 → 지정 key 파일 → 기본 key 파일이다. secret을 Git, README, 실행 로그에 넣지 않는다.

## 6. Codex 또는 Claude Code 준비

완전한 3-way에는 둘 중 하나가 필요하다.

### Codex

1. [공식 Codex CLI 가이드](https://developers.openai.com/codex/cli)에 따라 설치한다.
2. 터미널에서 `codex`를 실행하고 **Sign in with ChatGPT** 등 제공되는 로그인 방법으로 인증한다.
3. `codex --version`이 성공하는지 확인한다.

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

doctor의 포트 검사는 포트를 연 프로세스의 제품 신원을 증명하지 않는다. `8080/8081`이 열렸더라도 Burp listener 표와 FlowScope 포트 분류를 눈으로 대조한다.
기본 포트를 바꿨다면 `FLOWSCOPE_HUMAN_PORT`, `FLOWSCOPE_BURP_SCANNER_PORT`, `FLOWSCOPE_ZAP_PORT`, `FLOWSCOPE_WEB_PORT`, `FLOWSCOPE_MCP_PORT`를 같은 shell에 지정해 doctor 기준도 맞춘다.

## 8. 첫 3-way 실행

1. FlowScope 탭에 허가받은 `scheme://host[:port]/path-prefix` exact scope를 한 줄씩 입력하고 **범위 적용**을 누른다.
2. Web **계정·세션**에서 테스트 계정을 등록한다. 계정 로그인이 필요하면 **로그인 연결**을 시작하고 HUMAN `8080` 경로로 로그인한 뒤 성공한 인증 페이지까지 확인하고 캡처를 종료한다.
3. **HUMAN pass 시작**을 누르고 Burp 브라우저로 허가된 기능을 탐색한 다음 pass를 종료한다.
4. 빠른 시작의 ZAP 카드에서 대상과 비로그인/ACTIVE 계정을 고르고 **신원별 격리 검사 시작**을 누른다. Active Scan은 자동 baseline에 포함되지 않는다.
5. 로컬 provider와 계정을 고르고 **LLM Explorer 시작**을 누른다. Explorer가 정상 종료돼야 LLM lane이 완료된다.
6. `REVIEW` 항목을 확인한 뒤 세 lane이 완료되면 **Judge 시작**을 누른다.
7. finding은 원 Evidence, 같은 run의 반복 재현, 정상 대조가 서버 gate를 통과했는지 확인한다. ZAP Alert나 LLM 문장만으로 확정하지 않는다.
8. `.flowscope.db`를 연결해 자동 checkpoint를 활성화한다. raw broker credential은 DB에 저장되지 않으므로 Burp 재시작 뒤에는 다시 로그인 연결한다.

## 9. 문제 해결

| 증상 | 확인할 사실 | 조치 |
|---|---|---|
| `Extension class is not a recognized type` | thin JAR 또는 잘못된 타입 선택 | Release의 `flowscope-*.jar` 하나를 Java 확장으로 다시 로드 |
| ZAP API 연결 실패 | `127.0.0.1:8089`, key 불일치 | `scripts/doctor.sh`, Compose logs, key 파일 확인 후 FlowScope 재로드 |
| ZAP은 완료했는데 SCANNER 0건 | upstream이 Burp `8081`을 통과하지 않음 또는 scope 불일치 | ZAP HTTP proxy, Burp listener, exact scope를 함께 확인 |
| Rendered 0건 경고 | Client/AJAX가 실제 요청을 만들지 않음 | ZAP logs, Firefox/Selenium add-on, 대상 CSP/login 상태 확인. Traditional 결과와 혼동하지 않음 |
| CLI 실행 파일 없음 | Burp가 CLI PATH를 상속하지 않음 | 절대경로 시스템 속성 지정 후 Burp 재시작 |
| 로그인 계정이 ZAP/LLM 선택지에 없음 | broker가 `ACTIVE`가 아님 | 로그인 연결을 다시 시작해 인증 성공 응답까지 관측 |
| `17777` 또는 `8787` 충돌 | 다른 로컬 프로세스가 포트 사용 | 충돌 프로세스를 확인하거나 JVM 속성으로 포트를 일관되게 변경 |

문제가 해결되지 않으면 Burp Extension Output/Error, `docker compose ... logs`, doctor 결과에서 secret을 제거한 뒤 이슈에 첨부한다. 대상 Request/Response, Cookie, Authorization, API key, provider token은 공개 이슈에 올리지 않는다.
