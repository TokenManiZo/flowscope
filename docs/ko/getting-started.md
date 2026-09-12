# FlowScope 설치·첫 실행 가이드

이 가이드는 D-128/D-139 독립 Explorer, D-135 FlowScope Docker Chromium ZAP과 D-138 연결 상태 기준입니다. 이전 JAR과 구분하려면 [현재 인계](HANDOFF.md)와 [산출물 검증 기록](beta-validation.md)을 함께 확인하십시오.

현재 소스의 실행 경로는 HUMAN·ZAP·독립 Codex Explorer다. 기존 LLM Judge·MCP·브라우저 하네스는 제거된 상태를 유지하며 새 Explorer는 app-server HTTP·선언 dynamic tool과 Java exact-scope gateway를 쓴다(D-128/D-139). ZAP 로그인 lane은 HUMAN Session Broker를 재사용하지 않는다. Browser Based Authentication의 실제 응답 Evidence가 필수 로그인 성공 정규식과 일치한 계정만 계정 지정 crawler에 사용한다(D-136). 모든 ZAP lane은 distribution bundle의 FlowScope Docker 이미지가 제공하는 Chromium·ChromeDriver와 `chrome-headless` Client Spider를 사용한다(D-135). H/S/L 관측 비교와 과거 프로젝트는 보존한다. 이 변경은 아직 원격 Release에 게시하지 않았으므로 이 작업 소스에서 빌드한 JAR 또는 distribution bundle을 사용해야 한다.

## 1. 지원 경로와 검증 범위

| 경로 | 용도 | 필요한 것 |
|---|---|---|
| HUMAN만 | Burp에서 사람이 만든 요청을 수집 | Release JAR, Burp |
| HUMAN + ZAP | Chromium·driver·add-on을 고정한 FlowScope 관리 환경 | distribution bundle, Burp, Docker Compose v2 |
| LLM Explorer | 독립 endpoint·parameter·계정별 응답 관측 | Release JAR 또는 bundle, Burp, 공식 Codex CLI와 유효한 Codex 로그인 |
| 소스 빌드 | 코드 수정·기여 | 위 환경, JDK 21 정확히, Maven 3.9.x |

다운로드 사용자는 Maven·Node.js·npm·호스트 Chrome·ChromeDriver·ZAP Desktop을 설치하지 않는다. `flowscope-1.2.0-beta.46-bundle.zip`을 권장하며, 이 파일에 Burp용 JAR, ZAP Dockerfile·Compose/helper, macOS·Linux·Windows doctor와 현재 문서가 함께 들어간다. JAR 단독 파일은 HUMAN과 Explorer에 충분하지만 ZAP helper는 포함하지 않는다.

실제 확인한 기준선은 다음과 같다.

- Burp Suite Community 2026.7.3에서 Montoya 확장 로드
- ZAP 2.17.0 API와 `client`, `pscan`, `pscanrules`, `selenium`, `openapi`, `websocket`, `network`, `replacer`, `authhelper` add-on. FlowScope 기본 캠페인은 Traditional/AJAX Spider를 호출하지 않는다.
- macOS arm64, Docker Engine/Desktop 29.5.3에서 ZAP 2.17.0 기반 FlowScope 이미지 기동, Chromium/ChromeDriver `152.0.7977.82`, loopback API, Docker-host Burp upstream, 실제 `chrome-headless` Client Spider HTTP 200 수집 1건
- GitHub Actions `windows-latest` PowerShell 7에서 Windows helper 네 파일의 파서 검증
- JDK 21 Maven 빌드

Windows 실행 경로는 Windows 10/11, Docker Desktop의 Linux container backend, PowerShell 7을 지원 계약으로 삼는다. GitHub Windows runner의 파서 검증은 실제 Docker Desktop 기동을 증명하지 않는다. 특히 Windows 실기기의 ZAP API·Burp upstream, Docker ZAP의 HTTPS 대상, USER A/B Browser Based Authentication과 Client capture는 별도 실환경 gate를 통과해야 한다.

공식 근거:

- [PortSwigger: Java 확장 빌드·로드](https://portswigger.net/burp/documentation/desktop/extend-burp/extensions/creating/loading-in-burp)
- [ZAP: 공식 Docker 이미지와 headless/xvfb 실행](https://www.zaproxy.org/docs/docker/about/)
- [ZAP: Network API의 upstream HTTP proxy 설정](https://www.zaproxy.org/docs/desktop/addons/network/api/)
- [Docker Desktop: 컨테이너에서 호스트로 연결하는 `host.docker.internal`](https://docs.docker.com/desktop/features/networking/networking-how-tos/)
- [Docker Compose: file-backed secret과 읽기 전용 service mount](https://docs.docker.com/reference/compose-file/services/)
- [Microsoft: `Set-Acl`과 ACL 상속 차단](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-acl)
- [Microsoft: 암호학적 `RandomNumberGenerator.GetBytes`](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.randomnumbergenerator.getbytes)
- [GitHub Actions: Windows 기본 `pwsh` shell](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

## 2. 포트 계약

| 주소 | 소유자 | 의미 |
|---|---|---|
| `127.0.0.1:8080` | Burp | HUMAN 브라우저·수동 도구 트래픽 |
| `127.0.0.1:8081` | Burp | ZAP이 upstream으로 보내는 SCANNER 트래픽 |
| `127.0.0.1:8082` | Burp | 이전 직접 LLM 관측 호환용. 새 Explorer는 이 listener를 쓰지 않음 |
| `127.0.0.1:8089` | ZAP | 로컬 ZAP proxy/API |
| `127.0.0.1:17777` | FlowScope | 로컬 Web 작업면 |

다른 프로세스가 같은 포트를 사용하면 먼저 충돌을 해소한다. FlowScope 포트를 JVM 속성으로 바꿀 수 있지만, ZAP upstream과 문서의 listener 값도 같은 값으로 맞춰야 한다.

## 3. Release bundle 설치

1. [GitHub Releases](https://github.com/choewonwoo1817/testflowscope/releases)에서 `flowscope-1.2.0-beta.46-bundle.zip`을 받고 압축을 푼다. Release에 bundle이 아직 없다면 저장소를 clone하고 §6의 소스 빌드 절차로 만든다. ZAP을 쓰지 않는 사용자는 `flowscope-1.2.0-beta.46.jar`만 받아도 된다.
2. 압축을 푼 디렉터리 구조를 유지한다. `scripts/zap-up.*`가 상대 경로 `infra/zap/compose.yaml`을 사용하므로 파일 일부만 옮기면 Docker Quick Start가 동작하지 않는다.
3. bundle 루트의 `flowscope-1.2.0-beta.46.jar`를 사용한다.
4. Burp **Settings → Tools → Proxy → Proxy listeners**에서 사용할 기능에 맞는 listener를 만든다.
   - HUMAN을 사용할 때 bind address `127.0.0.1`, port `8080`
   - ZAP을 사용할 때 bind address `127.0.0.1`, port `8081`. native Linux Docker Engine에서는 아래 Docker Quick Start의 특정 bridge IP listener도 추가한다.
5. Burp **Extensions → Installed → Add**를 누른다.
6. Extension type을 **Java**로 고르고 JAR을 선택한다.
7. Output/Errors에 로드 오류가 없는지 확인한다.
8. FlowScope 탭에서 Web UI `127.0.0.1:17777`이 준비됐는지 확인한다.

Release JAR 사용자는 Maven이 필요하지 않다. Burp를 custom Java로 실행하면 class file 호환을 위해 Java 21 이상을 사용한다.

Web `127.0.0.1:17777` 상단의 **점검**을 누르면 `범위 → HUMAN → ZAP → Evidence 검토` 상태와 첫 미완료 단계가 열린다. 완료된 설정은 단계 버튼으로 다시 확인한다. 수집 뒤 **분석 → API·입력 차이**에서 선언/관측과 파싱 상태를 보고, **점검 Gap 그래프**에서 점검 우선순위/전체 관계 보기 탭을 선택한다. **권한 매트릭스**에는 판정·파라미터 커버리지·기존 권한 셀 세 탭이 있다. 미관측은 취약점이나 lane 실패 판정이 아니다.

새 대상을 시작할 때는 상단 **새 진단 시작**에서 프로젝트 이름과 허가된 exact scope를 입력한다. 현재 진단이 있으면 FlowScope가 먼저 `~/.flowscope/projects/<이름--scope--시각>/project.flowscope.db`에 저장하고 새 빈 DB를 만든 뒤에만 화면과 scope를 전환한다. 저장 실패 시 현재 Evidence와 scope를 유지하며 상단에 원인을 표시한다. 상단 프로젝트 선택기에서 이전 DB를 다시 열 수 있다. 프로젝트에는 마스킹 Evidence·설정·완료 run·실행 원장·사람 검토가 들어가지만 raw Authorization/Cookie, 비밀번호, API key, provider token, 현재 메모리 Request Lab 원문은 저장하지 않으므로 재개한 진단의 인증 세션은 다시 준비해야 한다.

**API·입력 차이**의 실제 Observation 또는 **Evidence** 행을 선택하면 exact Evidence 상세와 요청 실험실을 열 수 있다. Evidence 화면은 같은 operation의 마스킹 Request/Response와 payload 보존 상태를 200건씩 보여 준다. live raw 교환이 현재 Burp 프로세스 메모리에 남아 있을 때만 선택한 한 Evidence를 편집하거나 Burp Repeater로 보낼 수 있다. OpenAPI·HTML·JavaScript에서만 선언되고 실제 응답 Evidence가 없는 행에는 이 동작이 나타나지 않는다. 일시 snapshot 조회 실패는 모든 Evidence 작업면의 선택·검토 메모·열린 초안을 메모리에 유지하고 새 변경·전송을 잠근다. 실패 전에 시작한 전송은 같은 dataset·Evidence 결과를 기다리며, 복구 뒤 초안과 결과를 계속 표시한다. 프로젝트 교체·Evidence 변경·raw/session 전제 상실·닫기는 초안과 진행 중 전송을 폐기한다.

## 4. ZAP 준비 — FlowScope Docker Chromium

FlowScope는 `127.0.0.1:8089`의 ZAP API뿐 아니라 `zapHomePath`가 컨테이너 tmpfs `/run/flowscope-zap/` 아래인지 확인한다. Web **빠른 시작 → FlowScope Docker ZAP**은 연결 여부·버전·key·관리 runtime 오류를 실행 전에 표시하고, 조건을 만족하기 전에는 모든 캠페인 버튼을 비활성화한다. 임의 ZAP Desktop이나 다른 API 인스턴스는 “연결됨”만으로 실행 대상으로 인정하지 않는다.

일반 timeout·일시 통신 실패는 첫 두 번 `RETRYING`으로 자동 재확인하고 세 번 연속 실패할 때만 `UNREACHABLE`로 확정한다. API key 401/403은 즉시 `AUTH_FAILED`, 다른 runtime은 즉시 runtime 오류로 표시한다. `CONNECTED`는 ZAP 제어 API가 준비됐다는 뜻이며 Client Spider나 캠페인이 완료됐다는 뜻이 아니다.

### Docker Quick Start — macOS/Linux

Docker Desktop은 위의 Burp loopback listener를 사용한다. **native Linux Docker Engine**의 기본 설정에서는 bundle의 `host.docker.internal:host-gateway`가 호스트의 default bridge IP로 해석되므로 `127.0.0.1:8081`만으로는 컨테이너 연결을 받을 수 없다. Docker를 시작한 뒤 실제 bridge IP를 읽는다([Docker 공식 매핑 설명](https://docs.docker.com/reference/cli/dockerd/#configure-host-gateway-ip)).

```bash
docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'
```

Burp **Proxy listeners**에서 기존 loopback listener에 더해, 출력된 호스트 bridge IP를 **Specific address**로 선택하고 port `8081`인 listener를 추가한다. 예시 주소를 복사하거나 **All interfaces / `0.0.0.0`**로 열지 않는다. Docker daemon의 `host-gateway` 주소를 별도로 재정의한 환경은 그 설정에 맞는 호스트 interface IP를 확인해야 한다. HUMAN·FlowScope Web·ZAP API의 loopback 주소와 허가된 대상의 exact scope는 유지한다. 이 안내는 native Linux 네트워크 구성에 대한 것이며, native Linux 실환경 완주 검증을 뜻하지 않는다.

압축을 푼 bundle 루트 또는 저장소 루트에서 실행한다.

```bash
./scripts/zap-up.sh
```

이 명령이 수행하는 범위는 고정돼 있다.

1. 공식 `ghcr.io/zaproxy/zaproxy:2.17.0` multi-architecture manifest를 digest로 고정한 FlowScope 이미지를 빌드한다.
2. 32-byte random API key를 생성해 `~/.flowscope/zap-api-key`에 저장하고 POSIX 환경에서는 `0600`으로 제한한다.
3. 같은 Debian 저장소의 Chromium과 ChromeDriver를 함께 설치하고 시작 전에 실행 가능 여부·주 버전 일치·실제 headless 기동을 검사한다. 컨테이너의 unprivileged `zap` 사용자와 기본 격리를 유지하며 Chromium에만 `--no-sandbox`를 전달한다.
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

Docker Desktop을 Linux container 모드로 시작하고 일반 사용자 PowerShell 7에서 압축을 푼 bundle 루트 또는 저장소 루트로 이동한 뒤 실행한다.

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

ZAP 로그인 교환은 감사 가능한 `ZAP_AUTHENTICATION / SESSION_SETUP` Evidence로 보존하지만 SCANNER 탐색 성과·crawler 수집 건수·완료 조건에는 포함하지 않는다. 로그인만 성공하고 crawler 응답이 0건인 lane은 완료로 표시하지 않는다.

## 5. LLM Explorer 준비

1. [공식 Codex CLI 설치 안내](https://learn.chatgpt.com/docs/codex/cli)에 따라 설치한다. macOS/Linux 공식 standalone installer는 `curl -fsSL https://chatgpt.com/codex/install.sh | sh`이고, Windows는 공식 문서가 안내하는 설치 경로를 따른다.
2. Burp와 같은 OS 사용자로 터미널에서 `codex`를 실행하고 **Sign in with ChatGPT**를 완료한다. FlowScope에 API key를 입력하지 않는다.
3. exact scope를 적용한 뒤 Web **Explorer**를 연다. 준비 배지가 READY가 아니면 원인 문구를 확인하고 **다시 확인**을 누른다.
4. 비로그인만 선택하거나, HTML form/JSON API 로그인 계정을 메모리 전용으로 추가한다. 계정 ID·비밀번호·live cookie/token은 프로젝트에 저장되지 않으며 모델에는 opaque account handle만 전달된다.
5. 시작 URL과 신원을 선택해 실행한다. 진행 피드의 경과시간·HTTP 요청·응답 Evidence·선언 endpoint/parameter·OPTIONS probe·미해결·실패를 확인하고 필요하면 steer 또는 취소한다.

MCP 토큰·8787 포트, Chrome/Playwright, provider API key는 필요하지 않다. 새 Explorer는 모델 일반 네트워크 대신 app-server의 HTTP·선언 dynamic tool을 Java exact-scope gateway에 연결한다. HTTP 응답은 Observation Evidence, 응답 산출물에서 읽은 endpoint·parameter는 같은 run Evidence에 결박된 Declaration으로 분리되며 화면 수치는 서버가 계산한다. 자세한 설정·경계·남은 실환경 gate는 [LLM Explorer](llm-explorer.md)를 따른다. 과거 LLM Judge 기록은 React 시나리오의 읽기 전용 구역에만 남는다.

## 6. 환경 점검

필요한 기능에 맞는 검사만 실행한다. 기본값 `full`은 HUMAN·ZAP·Explorer를 모두 검사하므로, 일부 기능만 쓸 때는 알맞은 mode를 선택한다.

```bash
./scripts/doctor.sh --mode human
./scripts/doctor.sh --mode zap
./scripts/doctor.sh --mode explorer
./scripts/doctor.sh --mode full
```

Windows PowerShell 7:

```powershell
.\scripts\doctor.ps1 -Mode human
.\scripts\doctor.ps1 -Mode zap
.\scripts\doctor.ps1 -Mode explorer
.\scripts\doctor.ps1 -Mode full
```

검사 항목:

- `human`: HUMAN `8080`과 FlowScope Web
- `zap`: HUMAN `8080`, SCANNER `8081`, owner-local ZAP key, API, upstream, 필수 add-on과 Web
- `explorer`: Codex 실행 파일·현재 OS 사용자의 로그인과 Web
- `full`: 위 세 경로 전체

소스 빌드는 다음을 사용한다.

```bash
./scripts/doctor.sh --mode full --build
mvn clean verify
```

Windows 소스 빌드는 `.\scripts\doctor.ps1 -Mode full -Build` 후 `mvn clean verify`를 실행한다.

doctor의 포트 검사는 포트를 연 프로세스의 제품 신원을 증명하지 않는다. `8080/8081`이 열렸더라도 Burp listener 표와 FlowScope 포트 분류를 눈으로 대조한다. 현재 Bash doctor는 호스트 loopback과 ZAP에 저장된 upstream 설정만 확인하므로 컨테이너에서 native Linux bridge listener로 연결되는지도 증명하지 않는다.
기본 포트를 바꿨다면 `FLOWSCOPE_HUMAN_PORT`, `FLOWSCOPE_BURP_SCANNER_PORT`, `FLOWSCOPE_ZAP_PORT`, `FLOWSCOPE_WEB_PORT`를 같은 shell/PowerShell 세션에 지정해 doctor 기준도 맞춘다. Windows doctor는 key ACL 상속과 다른 SID의 허용 규칙도 검사한다.

## 7. 첫 HUMAN·ZAP·LLM 실행

1. FlowScope 탭에 허가받은 `scheme://host[:port]/path-prefix` exact scope를 한 줄씩 입력하고 **범위 적용**을 누른다.
2. Web **계정·세션**에서 테스트 계정을 등록한다. 계정 로그인이 필요하면 **로그인 연결**을 시작하고 HUMAN `8080` 경로로 로그인한 뒤 성공한 인증 페이지까지 확인하고 캡처를 종료한다.
3. **HUMAN pass 시작**을 누르고 Burp 브라우저로 허가된 기능을 탐색한 다음 pass를 종료한다.
4. 빠른 시작의 ZAP 카드에서 대상을 고른다. 비로그인은 즉시 선택할 수 있다. 로그인 lane은 계정 이름·역할·대상 로그인 URL·로그인 ID·비밀번호와 **로그인 상태 정규식(필수)**을 입력한 뒤 선택한다. 성공 정규식에는 로그인 전·실패 화면에는 없고 성공 응답에만 나타나는 짧은 문구(예: `내 계정|로그아웃`)를 넣는다. 선택적인 로그아웃 정규식에는 실패 또는 로그아웃 화면에만 나타나는 문구를 넣는다. ID·비밀번호와 두 정규식은 현재 Burp 프로세스 메모리에만 두며 프로젝트·snapshot·로그에 저장하지 않는다. 이미 보유한 API 정의가 있으면 한 줄에 하나씩 `OPENAPI URL`, `POSTMAN URL`, `SOAP URL`, `GRAPHQL ENDPOINT [SCHEMA_URL]`로 입력하고 **신원별 격리 검사 시작**을 누른다. 모든 URL은 현재 exact scope 안이어야 한다. 정의 import는 명세의 write method 요청도 만들 수 있으므로 이어지는 Burp 승인창에서 한 번 더 확인한다. 비워 두면 정의를 추측하지 않고 Client Spider 기준선만 실행한다. Active Scan은 자동 baseline에 포함되지 않는다. 계정 검사는 세션 오염을 막기 위해 비로그인부터 직렬 실행한다. 로그인 lane은 tmpfs 위의 이름 없는 ZAP session과 임시 Context에서 Chrome Headless Browser Based Authentication과 session auto-detect를 실행한다. ZAP action의 `OK`나 인증 시각은 성공 근거로 쓰지 않는다. 같은 run·계정의 실제 `ZAP_AUTHENTICATION` 응답 Evidence가 로그인 성공 정규식과 일치하고 그보다 나중에 로그아웃 정규식과 일치한 응답이 없을 때만 계정 지정 `chrome-headless` Client Spider 하나를 실행한다. 비로그인 lane도 같은 브라우저를 명시한다. 새 캠페인은 Traditional/AJAX Spider를 호출하거나 실패 시 fallback하지 않는다. 로그인 실패, Client 실패, 범위 안 Client 응답 0건은 해당 lane 실패다. 화면의 `세션 / 로그인 / Client / Passive / Alert` 진행선, 전체·단계 경과시간, 작업 신호, 트래픽 변화, Client 수집 건수, Passive 남은 건수·현재 task, Alert 집계 완결성과 대기 이유로 정상 실행·부분 완료·응답 단절을 구분한다. **실시간 실행 기록**은 실제 단계 시작·로그인 결과·Client·queue 감소·Alert 집계·격리 정리를 최신순으로 보여 준다. Passive가 10분간 진행되지 않거나 30분을 넘으면 현재 결과를 보존하고 queue를 정리하며, 정리가 확인되지 않으면 다음 계정을 실행하지 않는다.
5. **API·입력 차이**에서 선언/관측과 산출물 파싱 상태를 확인한다.
6. **Explorer**에서 비로그인 또는 등록한 메모리 계정을 골라 독립 탐색을 실행한다. 실제 응답 Evidence가 0건이면 완료가 아니라 실패다.
7. **API·입력 차이**에서 H/S/L endpoint·parameter 관측을 비교한다.
8. **시나리오**에서 현재 규칙 후보와 Evidence를 확인하고 사람 검토를 기록한다. 자동 LLM 판정은 하지 않는다.
9. 과거 assessment/validation은 별도 읽기 전용 기록이며 현재 검증 결과가 아니다.
10. `.flowscope.db`를 연결해 자동 checkpoint를 활성화한다. raw broker credential은 DB에 저장되지 않으므로 Burp 재시작 뒤에는 다시 로그인 연결한다.

### 이미 내보낸 ZAP 트래픽을 가져올 때

Web 상단의 **스캐너 XML/HAR**에서 ZAP **Save Selected Entries as HAR**로 만든 `.har` 파일을 고른다. FlowScope는 HAR의 HTTP 요청·응답만 `SCANNER / HAR_IMPORT / IMPORT` Evidence로 가져오고 현재 exact scope 밖 entry는 제외한다. 이 폴백은 live campaign의 신원별 fresh session, rendered crawl 완료, passive queue, native Alert를 복원하지 않으므로 파일 가져오기를 “ZAP 기준선 완료”로 표시하지 않는다. ZAP의 Alert까지 비교하려면 정상 캠페인 경로를 사용한다.

## 8. 자동으로 되는 것과 사용자가 해야 하는 것

| 항목 | FlowScope가 수행 | 사용자가 수행 |
|---|---|---|
| 확장 설치 | 없음 | Release JAR을 Burp Java extension으로 한 번 로드 |
| Scope | 입력값 검증·exact-scope 차단 | 허가받은 URL prefix 입력 |
| HUMAN | 범위 안 트래픽 자동 수집·분류 | `8080` listener 설정과 실제 업무 기능 탐색 |
| FlowScope Docker ZAP | helper가 key 생성, Chromium 포함 이미지 빌드·기동, upstream·브라우저 runtime 설정·검증 | Docker Desktop/Engine 설치·기동, `8081` listener 설정 |
| Explorer | Codex 위치·로그인 확인, 메모리 로그인, exact-scope HTTP Evidence 수집 | Codex CLI 설치와 ChatGPT 로그인, CAPTCHA·MFA·WebAuthn·SSO가 있으면 필요한 수동 절차 |

FlowScope는 Burp 설정 파일을 임의로 바꾸거나, 호스트에 Docker·Codex CLI를 설치하거나, CAPTCHA·MFA·WebAuthn·SSO를 우회하지 않는다. 그런 환경은 화면과 doctor에서 실패 이유를 표시하고 HUMAN/ZAP/Explorer 중 가능한 lane은 계속 쓸 수 있게 유지한다. app-server 호환 경로는 공식 문서상 실험적이므로 Codex CLI 업데이트 뒤에는 Explorer READY와 실제 Evidence 1건 이상을 다시 확인해야 한다.

## 9. 문제 해결

| 증상 | 확인할 사실 | 조치 |
|---|---|---|
| `Extension class is not a recognized type` | thin JAR 또는 잘못된 타입 선택 | Release의 `flowscope-*.jar` 하나를 Java 확장으로 다시 로드 |
| ZAP API 연결 실패 | `127.0.0.1:8089`, key 불일치 | OS에 맞는 `doctor.sh`/`doctor.ps1`, Compose logs, key 파일 확인 후 FlowScope 재로드 |
| Windows key ACL 실패 | 상속 또는 다른 SID의 허용 규칙 | 일반 사용자 PowerShell에서 `zap-up.ps1` 재실행. 네트워크/FAT 파일시스템 대신 사용자 프로필의 NTFS 경로 사용 |
| Windows에서 컨테이너가 Burp에 연결되지 않음 | Docker Desktop Linux container 모드, Burp `127.0.0.1:8081` listener | Docker Desktop 상태와 `host.docker.internal` 도달성, Windows 방화벽을 확인 |
| ZAP은 완료했는데 SCANNER 0건 | upstream이 Burp `8081`을 통과하지 않음 또는 scope 불일치 | ZAP HTTP proxy, Burp listener, exact scope를 함께 확인 |
| 캠페인 전 ZAP outgoing proxy 오류 | Network API에서 HTTP proxy disabled 또는 host/port 불일치 | `zap-down` 뒤 `zap-up`으로 `host.docker.internal:8081` 설정을 재구성하고 doctor 실행 |
| API 정의 import 경고 | URL/GraphQL endpoint가 exact scope 밖이거나 형식 add-on 누락·정의 파싱 실패 | 정의 URL과 `graphql/postman/soap/openapi` 설치를 확인. Client Evidence는 별도로 유지됨 |
| Client 실패 또는 0건 | Client가 실패했거나 범위 안 응답을 만들지 못함 | ZAP logs, Chromium/ChromeDriver/Selenium/Client add-on, outgoing proxy, exact scope, capability, 대상 CSP/login 상태를 확인. 자동 fallback이나 성공으로 바뀌지 않음 |
| 후속 계정이 0건 `PENDING` | 앞선 비로그인/계정 lane이 직렬 실행 중 | 대기 순번·선행 lane, 전체/단계 경과, 마지막 ZAP 응답과 트래픽 변화 확인. `ZAP 응답 없음`이면 ZAP log/API를 점검 |
| 로그인 계정이 ZAP 선택지에 없음 | 현재 target origin의 ZAP 메모리 계정을 등록하지 않음 | 빠른 시작의 **ZAP 브라우저 로그인 계정**에 로그인 URL·ID·비밀번호·로그인 성공 정규식을 다시 입력. Burp 재로드·프로젝트 교체 뒤에는 의도적으로 다시 등록해야 함 |
| ZAP 로그인 실패 | 같은 run·계정의 인증 응답이 로그인 성공 정규식과 일치하지 않거나 더 나중 응답이 로그아웃 정규식과 일치함 | 실제 성공·실패 화면의 응답 문구, 로그인 URL·ID·비밀번호와 Chromium/Selenium/Auth Helper 상태를 확인. CAPTCHA·MFA·WebAuthn·외부 SSO는 자동 우회하지 않으며 필요하면 비로그인/HUMAN lane만 사용 |
| `17777` 충돌 | 다른 로컬 프로세스가 포트 사용 | 충돌 프로세스를 확인하거나 JVM 속성으로 포트를 일관되게 변경 |
| Codex 준비 배지가 READY가 아님 | CLI 미설치, 다른 OS 사용자 로그인, 로그인 만료 | 같은 사용자 터미널에서 `codex` 로그인 후 Explorer의 **다시 확인** 또는 `doctor --mode explorer` 실행 |

문제가 해결되지 않으면 Burp Extension Output/Error, `docker compose ... logs`, doctor 결과에서 secret을 제거한 뒤 이슈에 첨부한다. 대상 Request/Response, Cookie, Authorization, API key, provider token은 공개 이슈에 올리지 않는다.
