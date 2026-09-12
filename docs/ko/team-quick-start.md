# 팀원용 첫 실행 — FlowScope beta.47

현재 저장소는 비공개이므로 **협업 권한이 있는 본인 GitHub 계정으로 로그인**하세요. 로그인하지 않았거나 권한이 없으면 Release 링크가 404로 보입니다. 등록된 협업자는 저장소와 Release에 접근할 수 있습니다.

[테스트 Release](https://github.com/choewonwoo1817/testflowscope/releases/tag/v1.2.0-beta.47)에서 **`flowscope-1.2.0-beta.47-bundle.zip`**을 받으세요. GitHub가 자동 생성하는 `Source code.zip`은 실행 번들이 아닙니다. 압축을 푼 뒤 JAR·`scripts`·`infra`·`docs`를 같은 폴더 구조로 유지하세요.

## 1. 사용할 기능에 맞춰 준비

| 사용할 기능 | 팀원 PC에 필요한 것 |
|---|---|
| HUMAN 수집·Evidence·그래프·매트릭스 | Burp Suite + 번들 JAR |
| ZAP 비교까지 | 위 환경 + Docker Desktop/Engine와 Compose v2. Windows helper는 PowerShell 7 |
| LLM Explorer까지 | Burp + 공식 Codex CLI와 같은 OS 사용자의 유효한 로그인 |

Release 사용에는 Maven·npm·소스 빌드가 필요 없습니다. ZAP용 Chromium·ChromeDriver는 helper가 만드는 컨테이너에 포함됩니다. 모든 팀원의 PC에서 Burp와 필요한 Docker/CLI를 준비해야 하며, 다른 사람의 로그인·세션·API key를 복사해서 쓰지 않습니다.

## 2. Burp의 프록시 포트 준비

Burp를 열고 **Settings → Tools → Proxy → Proxy listeners**에서 확인하세요.

| 주소 | 용도 |
|---|---|
| `127.0.0.1:8080` | HUMAN 브라우저 요청 |
| `127.0.0.1:8081` | ZAP 요청. ZAP을 쓸 때 추가 |

macOS/Windows Docker Desktop 기준입니다. **native Linux Docker Engine**은 [상세 가이드의 Docker bridge listener 절차](getting-started.md)를 먼저 적용하세요. 새 Explorer를 위해 8082나 MCP 포트를 만들 필요는 없습니다.

## 3. ZAP을 쓸 경우 Docker부터 준비

Docker를 시작하고, 터미널을 압축 해제한 **bundle 루트 폴더**에서 여세요. Windows는 Docker Desktop의 Linux container 모드를 사용합니다.

macOS/Linux:

```bash
./scripts/zap-up.sh
```

Windows PowerShell 7:

```powershell
.\scripts\zap-up.ps1
```

helper가 이 PC의 ZAP key를 만들고 Chromium 이미지 빌드·기동과 Burp upstream 설정을 처리합니다. 처음에는 이미지와 패키지를 내려받으므로 인터넷이 필요하고 시간이 걸릴 수 있습니다. `FlowScope ZAP is ready`가 나온 다음 단계로 진행하세요. ZAP을 쓰지 않으면 이 단계는 건너뛰어도 됩니다.

## 4. JAR을 Burp에 로드

Burp **Extensions → Installed → Add → Java**에서 bundle 루트의 `flowscope-1.2.0-beta.47.jar`을 선택하세요. Output/Errors에 오류가 없는지 확인한 뒤 [FlowScope Web](http://127.0.0.1:17777/)을 엽니다.

기존 버전을 교체한다면 현재 진단의 `저장됨` 상태를 확인하고 기존 FlowScope를 먼저 언로드한 뒤 새 JAR을 로드하세요. 여러 FlowScope 버전을 동시에 켜면 포트가 충돌할 수 있습니다. JAR을 로드한 뒤 ZAP key를 처음 만들었다면 FlowScope를 한 번 재로드해야 합니다.

JAR을 더블클릭하거나 Standalone으로 실행하면 실제 Burp 수집·ZAP·Explorer 실행 환경이 되지 않습니다. 실제 점검은 Burp 안에서 실행하세요.

## 5. 환경 점검

사용할 기능에 맞춰 bundle 루트에서 한 명령을 실행하세요.

macOS/Linux:

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

`full`은 HUMAN·ZAP·Explorer 준비를 모두 검사하므로, 일부만 쓸 경우 해당 mode를 고르세요. doctor는 포트·ZAP API·upstream·add-on·CLI 로그인 등 선행 조건을 확인합니다. 대상 로그인 성공이나 실제 crawler 완료를 보장하는 검사는 아닙니다.

## 6. 첫 진단과 결과 확인

1. Web 상단 **새 진단 시작**에서 프로젝트 이름과 허가된 대상 scope를 입력합니다. 팀원이 자신의 로컬 대상에 연결할 때는 자신의 PC에서 접근할 수 있는 실제 URL을 넣으세요.
2. **점검** 화면에서 HUMAN pass를 시작하고 Burp Browser로 대상 기능을 사용한 뒤 pass를 종료합니다. 로그인별 비교는 **계정·세션 → 로그인 연결**로 준비합니다.
3. ZAP을 쓸 경우 비로그인 또는 ZAP 전용 로그인 계정을 선택합니다. 로그인 계정에는 대상 로그인 URL·ID·비밀번호와 성공 응답에서 확인한 로그인 상태 정규식이 필요합니다. HUMAN 로그인 계정과 별도로 입력합니다.
4. Explorer는 **LLM Explorer** 화면의 준비 상태와 [Explorer 사용자 준비](llm-explorer.md)를 확인합니다. 현재 구현이 지원하는 HTML form/JSON 로그인 형식과 필요한 설정은 이 문서를 따르세요.
5. **API·입력 차이 → 점검 Gap 그래프/전체 관계 → 권한 매트릭스 → Evidence 상세** 순으로 같은 요청 근거가 연결되는지 확인합니다. 샘플은 화면 사용법 확인용 데이터입니다.

현재 프로젝트는 기본적으로 사용자 홈의 `.flowscope/projects/` 아래에 저장됩니다. 재로드 후 원문 인증정보와 실행 계정은 다시 준비해야 합니다.

## 막힐 때 먼저 볼 것

beta.47에서는 ZAP 결과 수집이 끝난 뒤에도 `종료 처리 · 임시 상태 정리 중`이 잠시 표시될 수 있습니다. 최종 상태가 나온 뒤 재실행하세요. 정리 중에는 시작 버튼과 중복 취소가 잠기며, 이미 수집한 Evidence는 유지됩니다.

| 증상 | 확인할 곳 |
|---|---|
| Web `17777`이 열리지 않음 | Burp의 FlowScope 로드 상태, Output/Errors, 중복 확장/포트 |
| ZAP `UNREACHABLE` | Docker 실행, `zap-up` 출력, doctor의 zap mode |
| ZAP key 오류 | helper로 key 생성 후 FlowScope를 재로드했는지 |
| ZAP API는 연결되지만 수집이 0건 | `8081` listener, 정확한 대상 URL·scope, 해당 lane의 실행 기록 |
| Explorer 준비 실패 | 같은 OS 사용자에서 Codex CLI 설치·로그인, Explorer 화면의 실제 오류 |
| 예전 UI가 보임 | 기존 확장 언로드, 새 JAR 로드 후 Web 새로고침 |

팀 리뷰에는 사용 OS, Burp 버전, JAR 버전, doctor mode/결과, 실패 단계와 오류 문구를 적어 주세요. 비밀번호·쿠키·토큰은 공유하지 마세요. 실제 target 계정·로그인 성공·수집 결과는 팀원 환경에서 확인해야 합니다. 이 배포의 자동 테스트와 실환경 검증 범위는 [beta-validation](beta-validation.md)에 구분돼 있습니다.
