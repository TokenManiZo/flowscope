# 문제 해결

화면이나 Burp **Extensions → Installed → FlowScope → Output**에 나온 문구를 아래에서 찾아보세요. 설치나 연결 문제라면 먼저 `doctor`를 실행해 확인합니다.

```bash
./scripts/doctor.sh --mode full        # macOS/Linux
```

```powershell
.\scripts\doctor.ps1 -Mode full        # Windows
```

## ZAP

### `zap-up`이 `Docker Desktop is required.` / `Docker is required.` / `Docker Compose v2 is required.`로 멈춘다

Docker가 없거나 Compose v2가 없습니다. [README의 Docker 설치](../README.md#4-docker-설치하기-zap을-쓸-때만)를 따라 설치한 뒤 **새 터미널**을 열어 다시 실행하세요.

### `Docker Compose could not start FlowScope ZAP.` / `ZAP did not become ready.`

- Docker Desktop이 실행 중인지 확인하세요. 설치만 하고 켜지 않으면 컨테이너를 띄울 수 없습니다.
- 처음 실행이면 공식 ZAP 이미지와 Chromium을 내려받아야 하므로 인터넷이 필요합니다. 디스크에 약 4.3GB 여유가 있는지도 확인하세요.
- 그래도 안 되면 bundle을 푼 폴더에서 아래 명령으로 컨테이너 로그를 확인하세요.

```bash
docker compose -p flowscope-zap -f infra/zap/compose.yaml logs
```

### ZAP 스캔이 바로 실패하고 `Burp SCANNER proxy listener 127.0.0.1:8081 … is closed`가 나온다

ZAP이 대상 서버로 보내는 요청은 Burp의 SCANNER 리스너를 거쳐야 하는데, 그 리스너가 열려 있지 않습니다. Burp **Settings → Tools → Proxy → Proxy listeners**에서 `127.0.0.1:8081`이 있는지, 켜져 있는지 확인하세요. 없다면 추가합니다. Linux에서 Docker Engine을 쓴다면 Docker bridge IP에도 `8081` 리스너가 하나 더 필요합니다([점검 흐름 상세](guide/inspection-flow.md#상세-동작과-정확성-경계)).

### `FlowScope Docker ZAP 응답을 다시 확인하고 있습니다`가 계속된다 / `3회 연속 연결하지 못했습니다`

ZAP 컨테이너가 꺼져 있거나 아직 시작 중입니다. 한두 번 연결에 실패하면 다시 시도하고, 3회 연속 실패하면 연결할 수 없다고 표시합니다. bundle을 푼 폴더에서 `zap-up`을 다시 실행하세요.

```bash
./scripts/zap-up.sh
```

```powershell
.\scripts\zap-up.ps1
```

연결됨 표시는 ZAP이 명령을 받을 준비가 됐다는 뜻이지 크롤링이 끝났다는 뜻이 아닙니다.

### `FlowScope용 ZAP API key가 없습니다` / `API key가 일치하지 않습니다`

ZAP API key가 없거나 FlowScope와 ZAP 컨테이너가 서로 다른 key를 쓰고 있습니다. `scripts/zap-key.sh` 또는 `scripts/zap-key.ps1`로 key를 준비하고 `zap-up`을 다시 실행한 뒤, Burp에서 FlowScope 확장을 껐다 켜세요. key를 읽는 순서는 [포트·설정·출처 모델](reference/settings.md)에 있습니다.

### `로그인 실패: 재사용 가능한 ZAP 인증 응답 Evidence를 확인하지 못했습니다`

로그인 후 다시 쓸 수 있는 인증값이 담긴 요청과 응답을 확인하지 못했습니다. **계정·세션**에서 해당 계정의 **관리 → ZAP 로그인**을 열고 로그인 URL, ID, 비밀번호를 확인한 뒤 **로그인 검증**으로 먼저 시험하세요. 로그인에 실패하면 그 계정의 스캔을 멈춥니다. 비로그인 스캔으로 바꿔 계속하지 않습니다.

## LLM 탐색

### `Codex 준비가 필요합니다` / `Codex CLI를 찾지 못했습니다`

FlowScope는 Burp가 시작될 때의 PATH와 `~/.local/bin`, npm, WinGet, Homebrew 설치 폴더에서 `codex`를 찾습니다.

1. [README의 Codex 설치](../README.md#6-codex-설치하기-llm-탐색을-쓸-때만)대로 설치합니다.
2. Burp를 **다시 시작**합니다. Burp가 켜진 채로 설치하면 새 PATH를 모릅니다. Windows 공식 설치 프로그램은 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`에 설치하고 PATH만 바꾸므로 특히 재시작이 필요합니다.
3. 그래도 못 찾으면 Burp JVM 옵션에 `-Dflowscope.llm.codex.path=<codex 실행 파일 경로>`를 넣습니다.
4. 화면의 **다시 확인**을 누릅니다.

Codex를 찾지 못해도 직접 둘러보기와 ZAP 스캔은 그대로 쓸 수 있습니다.

### `Codex CLI 로그인이 필요합니다`

FlowScope는 `codex login status`로 로그인을 확인합니다. Burp를 실행하는 것과 같은 OS 사용자로 터미널을 열고 `codex`를 실행해 **Sign in with ChatGPT**로 로그인하세요. ChatGPT Plus, Pro, Business, Edu, Enterprise 요금제 중 하나가 필요합니다. `OPENAI_API_KEY` 환경 변수는 FlowScope가 Codex에 넘기지 않으므로 그것만으로는 동작하지 않습니다.

### `Chromium/Chrome 실행 파일을 찾지 못했습니다`

계정의 **브라우저 로그인** 창을 띄울 브라우저가 없습니다. FlowScope는 Burp에 포함된 Chromium, 그다음 시스템 Chrome/Chromium을 찾습니다. 둘 다 못 찾으면 Burp를 실행하는 JVM 옵션에 `-Dflowscope.browser.path=<브라우저 실행 파일 경로>`를 넣고 Burp를 다시 시작하세요.

## HUMAN 수집

### 둘러봤는데 비교 화면에 안 나온다

다음을 차례로 확인하세요.

1. 웹 화면의 **프로젝트 관리**에서 점검 대상 주소가 맞는지 확인합니다. 새 프로젝트를 만드는 순서는 [README의 점검 범위 정하기](../README.md#2-점검-범위-정하기)에 있습니다. 범위 밖 응답은 저장하지 않습니다.
2. **점검 시작 → 1 · 직접 둘러보기**에서 **시작**을 누른 뒤 둘러봤는지 확인합니다. 시작 전이나 종료 후 요청은 기록으로는 남지만 비교에는 넣지 않습니다.
3. HTTPS 대상이면 브라우저에 Burp CA 인증서가 설치돼 있는지 확인합니다. Burp 내장 브라우저는 따로 설치할 필요가 없습니다.

### 계정을 바꿔 로그인했더니 기록이 이전 계정으로 남는다

FlowScope는 계정 전환을 자동으로 감지하지 않습니다. 다른 계정으로 바꾸기 전에 둘러보기를 **종료**하고, 그 계정을 골라 다시 시작하세요. 같은 브라우저 프로필에서 로그아웃 후 다른 계정으로 로그인하면 쿠키나 localStorage에 이전 계정의 값이 남을 수 있습니다.

### 계정이 `로그인 확인 필요`로 남는다

인증값은 있지만 그 값으로 성공한 응답을 아직 보지 못한 상태입니다. 그 계정으로 로그인한 뒤 화면을 한 번 더 둘러보세요. 성공 응답이 확인되면 요청 실험실과 교차 신원 검증에 쓸 수 있습니다.

### 수집이 멈췄다

실시간 수집은 Burp를 보호하기 위해 20,000건에서 멈추고, 넘친 건수를 화면에 표시합니다. 범위를 좁히거나 Burp 탭의 **새 트래픽 진단 시작**으로 새 진단을 여세요.

## 설치와 실행

### Windows에서 `.\scripts\zap-up.ps1`이 "디지털 서명되지 않았습니다"로 실행되지 않는다

Windows 기본 실행 정책(RemoteSigned)은 인터넷에서 받은 서명 없는 스크립트를 막습니다. bundle을 푼 폴더에서 아래 명령을 한 번 실행해 차단을 푼 뒤 다시 시도하세요([Microsoft 설명](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_execution_policies)).

```powershell
Get-ChildItem -Recurse | Unblock-File
```

### 확장이 로드되지 않는다

FlowScope는 Burp Montoya API `2026.7` 기준으로 빌드합니다. Burp를 최신 버전으로 올린 뒤 JAR 하나만 다시 추가하세요. 이전 FlowScope JAR이 함께 추가돼 있으면 먼저 지웁니다.

### 웹 화면 `http://127.0.0.1:17777/`이 열리지 않는다

다른 프로그램이 `17777` 포트를 쓰고 있을 수 있습니다. Burp를 실행하는 JVM 옵션에 `-Dflowscope.web.port=<다른 포트>`를 넣고 Burp를 다시 시작하세요. 웹 서버는 `127.0.0.1`에서만 열리므로 다른 PC에서는 접속할 수 없습니다.

여기에 없는 문제는 화면 문구와 Burp Output 로그를 함께 팀에 알려 주세요. 로그를 공유하기 전에 실제 대상 주소, 계정 정보, 인증값이 들어 있지 않은지 확인합니다. 보안 취약점은 공개 이슈 대신 [SECURITY.md](../SECURITY.md)의 절차를 따라 주세요.
