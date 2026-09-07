# FlowScope LLM Explorer

이 문서는 D-128 이후의 현재 Explorer 실행 계약이다. 폐기된 MCP/Judge/브라우저 하네스 설명은 적용하지 않는다.

## 목적

Explorer는 취약점을 판정하지 않는다. 허가된 exact scope 안에서 별도 LLM 실행이 HTML·JavaScript·manifest·source map·OpenAPI/Swagger·GraphQL 응답을 읽고 실제 HTTP 요청을 보내 다음 사실을 LLM Evidence로 남긴다.

- endpoint와 method
- query·path·header·body parameter
- 비로그인/등록 계정별 HTTP 응답 차이
- 응답과 링크에서 이어지는 workflow 순서
- 실행하지 못했거나 정적으로 확정하지 못한 항목과 이유

최종 화면은 이 LLM Evidence를 기존 HUMAN·SCANNER Evidence와 같은 Surface 좌표에 정렬한다. Explorer의 문장, 취약점명, 심각도 또는 확률은 판정 입력으로 저장하지 않는다.

## 실행 구조

```text
React #explorer
  ├─ 시작 URL + 비로그인/계정 선택
  ├─ 메모리 전용 로그인 입력
  └─ 상태·경과시간·HTTP Evidence·미해결·사용자 steer
            │
            ▼
ExplorerCoordinator
  ├─ ExplorerAuthRuntime ──▶ Burp Montoya HTTP ──▶ memory-only cookie/token
  ├─ CodexAppServerProvider ──▶ logged-in Codex app-server
  └─ ExplorerHttpGateway ◀── dynamic tool call
            │ exact-scope/method/header/dedup/budget gate
            ▼
Burp Montoya HTTP ──▶ actual response ──▶ source=LLM Evidence
```

MCP 서버나 포트 8787은 없다. 모델이 대상에 직접 `curl`하지도 않는다. Codex app-server의 동적 도구 호출을 Java가 받아 loopback gateway와 Burp Montoya 전송 경계로 연결한다. 모델 sandbox의 일반 네트워크는 꺼져 있으므로 exact-scope 검사를 우회하는 별도 네트워크 경로가 없다. 512KiB를 넘는 마스킹 응답은 실행별 격리 workspace의 임시 artifact로 넘기며 종료·취소 때 삭제한다.

## 사용자 준비와 실행

1. [공식 Codex CLI 안내](https://learn.chatgpt.com/docs/codex/cli)에 따라 설치하고 같은 OS 사용자로 터미널에서 `codex`를 실행해 **Sign in with ChatGPT**를 완료한다. API key는 FlowScope에 입력하지 않는다.
2. Burp에 현재 JAR을 로드하고 exact scope를 적용한다.
3. Web `http://127.0.0.1:17777/#explorer`를 연다. 준비 상태가 READY가 아니면 화면의 원인을 해결하고 **다시 확인**을 누른다. 이 동작은 15초 readiness cache를 즉시 무효화한다.
4. 비로그인 탐색만 쓸 경우 시작 URL을 고르고 바로 실행한다.
5. 인증 탐색은 계정 이름·역할·로그인 URL·ID·비밀번호를 입력한다.
   - `HTML form`: password input이 있는 표준 POST form과 hidden field를 사용한다. 비밀번호를 query에 넣는 GET form은 거부한다.
   - `JSON API`: username/password field 이름을 지정할 수 있다. bearer 등 응답 token은 JSON 경로, header 이름, prefix를 지정한다.
   - 검증 URL을 지정하면 최종 응답이 2xx/3xx이면서 로그인 form으로 돌아가지 않았는지 확인한다.
6. 계정과 비로그인을 필요한 조합으로 선택하고 **Explorer 시작**을 누른다.
7. 작업 피드에서 인증, 실제 HTTP 요청, Evidence ID, 실패와 미해결 사유를 본다. 실행 중 메시지로 다음 탐색 위치를 steer하거나 중단할 수 있다.

계정 ID·비밀번호, live Cookie와 token은 현재 Burp 프로세스 메모리에만 둔다. 로그인 준비 요청/응답은 Record, payload, 실행 원장, snapshot, 프로젝트 파일로 만들지 않는다. 프로젝트 교체·초기화·계정 삭제·extension unload에서 메모리 인증값을 폐기한다. Java와 HTTP 라이브러리의 일시적 immutable 사본까지 물리적으로 지우는 hardware vault를 뜻하지는 않는다.

## 실행 경계

- 허용 method: `GET`, `HEAD`, `OPTIONS`, `POST`. POST는 탐색 지침상 검색·조회 요청에만 사용한다.
- 금지: `PUT`, `PATCH`, `DELETE`, 파일 업로드, 대량 생성, brute force, race, exploit payload, 외부 callback.
- 대상 URL: 현재 FlowScope exact scope의 절대 HTTP(S) URL만.
- 모델 지정 금지 header: Authorization, Cookie, Proxy-Authorization, Host, Content-Length. 등록 계정의 인증값은 Java vault가 주입한다.
- run당 HTTP 시도 상한: 기본 500. 성공한 동일 account·method·URL·body는 다시 보내지 않는다. 전송 자체가 실패한 요청은 재시도할 수 있다.
- 응답 분석 상한: inline 512KiB, 임시 artifact 4MiB, artifact 24개. live 발견용 HTML/JS/JSON/XML 보존·분석 상한도 기본 4MiB다.
- 완료: 같은 run의 `CONTROLLED`, `EXPLORATION`, 실제 응답 Evidence ID가 하나 이상 있어야 한다. 응답 전 실패만 있으면 완료로 표시하지 않는다.

POST의 업무 의미를 범용 블랙박스에서 완전히 판별할 수 없으므로 “조회 전용”을 수학적으로 보장하지는 못한다. 그래서 method·범위·요청 수·금지 행위를 코드와 지침 양쪽에서 제한하고, 상태 변경 가능성이 있는 endpoint는 사용자가 허가한 테스트 환경에서만 실행해야 한다.

## 설치·호환 경계

- 런타임 필수: Burp + 현재 FlowScope JAR + 공식 Codex CLI 및 유효한 ChatGPT/Codex 로그인.
- 런타임 불필요: Node.js 직접 설치, Playwright, Chrome/Chrome MCP, 별도 MCP 서버, provider API key.
- FlowScope는 Finder 등 축소된 PATH에서도 macOS Homebrew `/opt/homebrew/bin`, `/usr/local/bin`, Windows WinGet/npm 표준 위치를 확인한다. 사용자 지정 실행 파일은 `-Dflowscope.llm.codex.path=/absolute/path`로 지정할 수 있다.
- 이 구현은 Codex app-server의 experimental dynamic-tools API를 사용한다. 현재 설치된 CLI와 실물 opt-in 하네스에서 확인했지만 향후 CLI 프로토콜 변경 시 readiness 또는 provider gate가 실패할 수 있다. 실패를 LLM 미발견으로 바꾸지 않고 실행 실패로 표시한다.
- Release 사용자는 Maven·Node.js·npm을 설치하지 않는다. Codex CLI 설치와 ChatGPT 로그인만 외부 선행 조건이고, FlowScope는 이를 자동 설치하거나 로그인 자격을 대신 만들지 않는다. `doctor.sh --mode explorer` 또는 `doctor.ps1 -Mode explorer`로 Web UI 밖에서도 선행 조건을 확인할 수 있다.

## 검증 수준과 남은 gate

자동 테스트는 account secret 비노출, form/JSON 로그인, redirect/검증, exact-scope, 인증 header 주입, mutation method 차단, 성공 중복 차단, 전송 실패 재시도, 완료 Evidence gate, 취소 경합과 Web/React 계약을 확인한다. `-Dflowscope.harness=true` opt-in gate는 실제 로그인된 Codex가 동적 HTTP 도구를 호출하고 구조화된 결과를 반환하는지 확인한다.

아직 완료라고 주장하지 않는 항목은 다음과 같다.

- 새 JAR을 실제 Burp에 재로드한 뒤 승인된 리얼 대상에서 anonymous·HTML form·JSON token 계정을 각각 완주
- CAPTCHA, MFA, WebAuthn, device binding, 애플리케이션 고유 refresh·SSO
- runtime 실행으로만 로드되는 lazy chunk와 server-only endpoint의 완전 발견
- 외부 blind corpus에서 HUMAN·ZAP 대비 endpoint/parameter recall, 오탐/미탐, 요청량, 진단자 검토시간 측정
- Windows 실기기에서 Codex CLI 탐지·로그인·취소 후 잔존 프로세스 확인

따라서 현재 결과는 “독립 LLM HTTP Explorer 실행 경로와 Evidence 계약이 구현·자동/실물 provider gate를 통과했다”까지다. 모든 웹 표면의 완전 발견이나 취약점 판정을 뜻하지 않는다.
