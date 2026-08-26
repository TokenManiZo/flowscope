# FlowScope 1.2 Beta

FlowScope는 **사람(HUMAN), 스캐너(SCANNER), LLM**이 실제 대상에 남긴 트래픽을 하나의 신원 인지 인가 그래프와 커버리지 매트릭스에 정렬하는 Burp Suite Community 호환 확장입니다. LLM의 추측을 확정 취약점으로 취급하지 않으며, 누락된 엔드포인트·객체 조합과 Evidence 기반 BOLA/IDOR·BFLA 후보를 보여 줍니다.

```text
신원 ──접근──▶ 객체 ──호출──▶ 작업
USER B        orders:101      GET /api/orders/{id}
```

## 주요 기능

- source, source detail, orchestrator, tool, phase, run 정보를 독립적으로 보존하는 Burp 실시간 수집
- 모든 source에 대한 exact scope Evidence 수집. HUMAN은 Burp로 다른 사이트를 방문할 수 있지만 범위 밖 응답은 FlowScope에 저장하거나 그래프로 만들지 않음
- HUMAN/SCANNER/LLM 필터와 직교 edge·제한적 그룹 펼치기를 지원하는 IDA식 계층 그래프
- `신원 × 작업 × 객체` 커버리지 매트릭스, 미교차 조합, 일부만 발견, source 간 판정 불일치
- 응답 분류, 명시적 소유자 Evidence, 사용자가 입력한 역할 정책을 이용하는 결정론적 BOLA/IDOR·BFLA 후보 엔진
- 비밀값을 저장하지 않는 테스트 계정 레지스트리와 명시적 메모리 전용 Session Broker. HUMAN 로그인 캡처, 쿠키 회전, 만료·의심 상태, 계정별 ZAP/LLM 요청을 지원
- query, 요청 본문, 마스킹된 요청·응답, timestamp, redirect, GraphQL operation, 응답→요청 데이터 흐름 수집
- Evidence 보존형 트래픽 분류. `INCLUDE`만 메인 3-way 비교에 사용하고, 애매한 `REVIEW`는 별도 검토 대기로 보존하며, 고신뢰 보조 트래픽은 `EXCLUDE`로 기본 숨김
- `ANONYMOUS / ACCOUNT_BOUND / UNRESOLVED` 인증 상태. 연결되지 않은 회전 쿠키가 그래프 신원을 폭증시키지 않으며, 확인된 계정 연결은 서비스 경계를 유지
- Codex·Claude Code 구독형 클라이언트용 localhost 전용 인증 MCP 서버
- 시스템 소유 ZAP 기준선: Traditional Spider → strict Client Spider(AJAX fallback) → passive queue 완료 → native alert. Active Scan은 별도 승인 필요
- exact scope FlowScope 요청 도구를 통한 closed-world LLM 실행. 직접 외부 트래픽은 최종 판정의 결정적 Evidence로 신뢰하지 않음
- 서버가 강제하는 독립 Explorer 시야, 불변 3-lane dataset lock, 최종 LLM Judge 종합
- 기존 Burp Proxy history 원클릭 가져오기, 실제 반복 횟수를 보존하는 중복 억제, 네트워크를 사용하지 않는 온보딩 샘플
- 계정·세션 연결, 정책, LLM assessment, 서버 검증 최종 verdict, 사람 감사 판정을 보존하는 마스킹된 버전형 `.flowscope.json` 저장·불러오기
- 명시적 사람 검증을 위해 마스킹된 미전송 Repeater 초안을 여는 Evidence handoff
- 반복 재현·허가된 정상 대조 관측을 요구하는 Evidence-bound LLM 검증과 사람 감사·오버라이드
- XXE 차단과 item 단위 오류 건너뛰기를 적용한 엄격한 Burp XML 가져오기

FlowScope는 블랙박스 공격면 전체를 알 수 없으므로 오해를 만드는 커버리지 퍼센트를 표시하지 않습니다.

## 요구사항

- JDK 21 이상
- 소스 빌드용 Maven 3.9 이상
- Montoya API를 지원하는 Burp Suite Community 또는 Professional
- 선택: 스캐너 lane용 OWASP ZAP
- 선택: LLM lane과 최종 Judge용 로컬 인증 Codex 또는 Claude Code 클라이언트

## 빌드 및 설치

```bash
mvn clean verify
```

Burp의 **Extensions → Installed → Add → Java**에서 `target/flowscope-1.2.0-beta.3.jar`만 불러오십시오. Maven Shade가 함께 만드는 `target/original-flowscope-1.2.0-beta.3.jar`는 의존성이 빠진 중간 JAR이며 Burp 배포물이 아닙니다. 이 파일을 불러오면 `Extension class is not a recognized type` 오류가 발생합니다. 공개 배포면에서 중간 JAR을 제거하는 작업은 현재 기록된 베타 패키징 과제입니다.

## 저장소 구조

- [`src/main`](src/main) — Burp 확장, 분석 코어, 로컬 Web 작업면, MCP/ZAP 통합, 번들 고지
- [`src/test`](src/test) — 보안·파서·분석·저장·MCP·로컬 Web 결정론적 회귀 테스트
- [`agent-workspace`](agent-workspace) — Codex/Claude MCP 설정과 Explorer/Judge 실행 지침
- [`docs/ko`](docs/ko) — 한국어 설계·결정·개발 기록·검증·연구·기능명세 정본
- [`docs/en`](docs/en) — 영어 사용자·협업·보안·변경 이력 문서
- [`.github`](.github) — Maven CI와 의존성 업데이트 설정

생성 파일은 `target/`에만 만들어집니다. 로컬 검토 패키지와 머신별 설정은 Git에서 제외된 `.local/`에 있으며 공개 저장소의 일부가 아닙니다.

정확한 베타 검증 범위와 남은 실환경 gate는 [`docs/ko/beta-validation.md`](docs/ko/beta-validation.md), 작업별 변경·이유·검증은 [`docs/ko/development-log.md`](docs/ko/development-log.md), 화면별 설계와 발표 근거는 [`docs/ko/ui-product-rationale.md`](docs/ko/ui-product-rationale.md)에 기록합니다.

## 초기 설정

HUMAN과 SCANNER용 Burp proxy listener를 만드십시오. Montoya는 확장 프로그램에서 listener를 생성할 수 없습니다. LLM listener는 선택적 호환 fallback이며, 기본 제품 흐름은 통제된 MCP executor를 사용합니다.

| Listener | Source | 사용 클라이언트 |
|---|---|---|
| `127.0.0.1:8080` | HUMAN | 브라우저 또는 수동 점검자 |
| `127.0.0.1:8081` | SCANNER | 대상 요청을 보내는 ZAP |
| `127.0.0.1:8082` | LLM | 선택적 직접 클라이언트 fallback (`UNVERIFIED_RUNTIME`) |

각 대상 클라이언트에 Burp CA 인증서를 설치하십시오. TLS 검증을 영구적으로 끄지 마십시오.

Burp의 **FlowScope** 탭을 열고 한 줄에 하나의 허가된 exact scope를 입력한 다음 **범위 적용**을 누릅니다. scope는 scheme, host, effective port, 선택적 path prefix를 포함합니다.

```text
https://api.example.test/v1
http://127.0.0.1:3000/
```

scope가 비어 있으면 MCP가 시작하는 ZAP 실행은 차단됩니다.

## 일반적인 점검 흐름

1. exact scope를 설정하고 익명 또는 최소 권한 테스트 계정을 사용합니다. 기본 제어면은 Burp 탭입니다. MCP 클라이언트의 `flowscope_set_scope`는 운영자가 명시적으로 허가한 exact target만, SCANNER/LLM run 시작 전에 설정할 수 있습니다. ADMIN 계정은 필수가 아니며 명시적 역할 비교가 필요한 경우에만 사용합니다.
2. **계정·세션**에서 USER A/USER B처럼 비밀값이 없는 표시 이름을 등록합니다. 계정마다 로그인 캡처를 시작하고 HUMAN 8080을 통해 로그인한 뒤 캡처를 종료합니다. raw 세션 값은 확장 메모리에만 남으며 LLM에 반환하거나 프로젝트에 저장하지 않습니다. 로그인 준비 트래픽과 HUMAN pass 밖에서 발생한 같은 scope 트래픽도 Evidence로는 보존하지만 3-way 비교와 갭에서는 제외합니다. **HUMAN pass 시작** 후 허가된 기능을 탐색하고 같은 run을 종료하십시오. 대상 동작만으로 알 수 없는 신원 역할, endpoint 요구 역할, 확인된 객체 소유자는 사용자가 지정합니다. BOLA 비교에는 서로 다른 최소 권한 계정 2개를 권장합니다.
3. ZAP의 outgoing proxy를 `127.0.0.1:8081`로 설정합니다. Web 빠른 시작에서 exact-scope target과 선택적 active account를 고른 뒤 **안전 기준선 실행**을 누릅니다. FlowScope는 Traditional Spider → Client Spider(AJAX fallback) → passive 완료 → native alert 순서를 고정하며, 범위 안 scanner 트래픽이 0건이면 lane을 실패 처리합니다. Active Scan은 기준선에 포함되지 않으며 항상 별도 Burp 승인이 필요합니다.
4. `agent-workspace/prompts/explorer.md`를 실행합니다. 서버는 HUMAN/SCANNER 결과를 숨기며 Explorer는 `flowscope_target_request`만 사용합니다. exact-scope routing, 세션 주입, Evidence 수집은 FlowScope가 수행합니다. 제공된 workspace는 웹 검색, Wayback, 외부 API 문서·소스 저장소, curl, 브라우저 네트워킹을 금지합니다.
5. 파싱 결과의 **검토 대기**를 확인해 실제 API면 operation을 **분석에 포함**, 보조 트래픽이면 **기본 숨김**으로 확정할 수 있습니다. 그 뒤 `agent-workspace/prompts/judge.md`를 실행합니다. Judge는 완료된 HUMAN/SCANNER/LLM dataset을 잠그고 메인 후보·잠긴 REVIEW Evidence·ZAP native alert를 읽은 뒤, 비최종 assessment를 제출하고 같은 통제 executor로 좁은 safe-GET 재현·정상 대조 Evidence를 수집합니다.
6. FlowScope는 bundle이 현재 후보와 일치하고 서버 검사를 통과할 때만 `CONFIRMED` 또는 `REJECTED`를 허용합니다. 같은 run의 LLM 재현 2건 이상, 허가된 정상 대조 1건 이상, 일치하는 신원·작업·객체 의미와 응답 Evidence가 필요합니다. 나머지는 `INCONCLUSIVE`입니다. **시나리오**와 Request/Response를 검토하십시오. 사람 기록은 감사 가능한 오버라이드이며 검증되지 않은 자동 finding이 아닙니다.
7. Burp를 내리기 전에 작업을 재개해야 한다면 `.flowscope.json`으로 저장합니다.

## 모델 API 키 없이 Codex·Claude 구독 사용

FlowScope는 모델 API를 직접 호출하거나 provider OAuth token을 받지 않습니다. Codex 또는 Claude는 사용자의 구독으로 인증하고 FlowScope는 로컬 MCP 서버만 제공합니다. FlowScope 탭의 **연결 문자열 복사**로 얻는 무작위 Bearer 값은 localhost MCP 서버를 보호하는 FlowScope 토큰이며 OpenAI·Anthropic credential이 아닙니다. 화면에는 마스킹되어 표시됩니다.

무인 로컬 설정이 필요하면 FlowScope는 선택적 일반 파일 `~/.flowscope/mcp-token`을 읽습니다. POSIX에서 group·other 접근이 없어야 하며, 값은 URL-safe 문자 32~256자여야 합니다. 파일을 삭제하면 Burp session마다 새 무작위 토큰을 사용합니다.

```bash
cd agent-workspace
export FLOWSCOPE_MCP_TOKEN='Burp에서-복사한-값'
codex mcp get flowscope
codex     # 또는 claude
```

Codex가 묻는 경우 저장소를 신뢰해야 project-scoped `.codex/config.toml`을 사용합니다. Codex는 신뢰하지 않은 프로젝트의 해당 설정을 무시합니다. 실행 전에 `codex mcp get flowscope`가 로컬 URL과 `FLOWSCOPE_MCP_TOKEN`을 표시해야 합니다. 이 검사는 설정 발견만 확인하며 Burp의 MCP 서버 실행이나 Explorer/Judge 완료를 증명하지 않습니다.

`agent-workspace`에는 다음이 포함됩니다.

- Codex Streamable HTTP MCP용 `.codex/config.toml`
- Claude Code HTTP MCP용 `.mcp.json`
- 안전·provenance 규칙용 `AGENTS.md`, `CLAUDE.md`
- 반복 가능한 `prompts/explorer.md`, `prompts/judge.md`와 호환 포인터 `coach.md`

Codex MCP 설정은 [공식 Codex MCP 문서](https://developers.openai.com/codex/mcp), Claude Code HTTP MCP는 [공식 Claude Code MCP 문서](https://docs.anthropic.com/en/docs/claude-code/mcp)를 따릅니다.

전역 `HTTP_PROXY` 또는 `HTTPS_PROXY`를 설정하지 마십시오. 모델 provider의 인증·제어 트래픽이 캡처될 수 있습니다. 제공된 에이전트 지침은 직접 대상 네트워킹을 금지하고 로컬 통제 MCP 도구만 사용합니다.

## Provenance 모델

`source`는 대상 요청을 실제로 생성한 주체이고, `orchestrator`는 그 도구 실행을 시작한 주체입니다. 두 값은 독립적입니다.

| 동작 | Source | Detail | Orchestrator |
|---|---|---|---|
| 수동 브라우저 | HUMAN | BROWSER | HUMAN |
| Burp Repeater | HUMAN | BURP_REPEATER | HUMAN |
| 점검자가 시작한 ZAP | SCANNER | ZAP_* | HUMAN |
| 결정론적 ZAP 기준선 | SCANNER | ZAP_* | SYSTEM |
| 승인형 ZAP Active Scan | SCANNER | ZAP_ACTIVE_SCAN | LLM |
| FlowScope 통제 LLM probe | LLM | LLM_EXPLORER / COACH_PROBE / VALIDATION | LLM |
| 8082 직접 fallback | LLM | 설정된 listener detail | LLM (`UNVERIFIED_RUNTIME`) |

Burp 시작 전에 다음 시스템 속성으로 기본 포트를 바꿀 수 있습니다.

```text
-Dflowscope.ports=8080:human:browser,8081:scanner:other_scanner,8082:llm:llm_explorer
-Dflowscope.mcp.port=8787
-Dflowscope.web.port=17777
-Dflowscope.mcp.token=<필요한-경우-고정-로컬-토큰>
-Dflowscope.mcp.tokenFile=/소유자만-읽는/토큰/파일의/절대경로
-Dflowscope.scope=https://api.example.test/v1
-Dflowscope.zap.url=http://127.0.0.1:8089
-Dflowscope.zap.key=<zap-local-api-key>
```

ZAP API endpoint는 loopback 주소만 허용합니다. ZAP의 대상 트래픽은 Burp SCANNER listener를 통과하도록 설정해야 합니다. AJAX API의 `OK` 응답은 ZAP이 시작 요청을 받았다는 뜻일 뿐입니다. 캡처 0건으로 끝난 run은 성공한 점검이 아닙니다.

## 제품 작업면

- **Burp 탭** — exact scope, 포트 분류, 실시간 수량, MCP 연결 복사, Proxy history 가져오기, 프로젝트 저장·불러오기, 샘플, 초기화, 정본 로컬 Web 작업면 열기
- **Web 상단 모드** — 그래프, 판정 매트릭스, 흐름 순서, 시나리오, 파싱 결과, 계정·세션
- **왼쪽 레일** — 허위 퍼센트 없는 수집·메인 비교·기본 숨김·검토 대기 수량, HUMAN/SCANNER/LLM 필터, Evidence 처분·class 표시 필터, 가명 세션·역할, 3-way gap, 그래프 판정 제어
- **Flow Graph** — 고정된 `identity → resource → operation` 열, 객체 식별자가 없는 경우 `identity → operation` 직접 edge, HUMAN 파랑·실선·H / SCANNER 빨강·파선·S / LLM 검정·점선·L 평행 overlay, 별도 인가 판정 view, focus+context 선택, 화면 맞춤, 18개 단위 객체·API 그룹 펼치기
- **판정 매트릭스** — 관측된 `identity/role × operation × resource` cell, source별 verdict, 미교차 조합, 일부만 발견, 불일치
- **흐름 순서** — timestamp가 있는 관측에서 복원한 응답→요청 ID/token 의존성
- **시나리오** — 결정론적 BOLA/BFLA 후보·gap, 비최종 Judge assessment, 서버 검증 최종 verdict
- **시나리오 감사·오버라이드** — Evidence-bound 상태와 마스킹 note를 갖는 사람 감사면. validation 검사를 우회하지 않음
- **파싱 결과** — 마스킹된 source, identity, method, 정규화 operation, resource, status, traffic class/disposition, repeat count, stable Evidence ID. 행을 선택하면 operation 상세와 페이지형 Evidence를 표시
- **계정·세션** — 비밀값 없는 계정 등록, 명시적 HUMAN 로그인 캡처, 안전한 broker 상태, 발견 세션 비교, 연결·해제, 재인증, 메모리 폐기, 계정 삭제
- **오른쪽 상세** — 선택 API의 source별 verdict, 필요할 때만 가져오는 마스킹 Request/Response, 안전한 Burp Repeater 초안. polling snapshot은 저장된 모든 message body를 전송하지 않음

## 판정 규칙과 신뢰 경계

- 2xx status만으로 성공 접근을 확정하지 않습니다.
- 401/403, 로그인 redirect, soft-deny 응답 문구는 거부 Evidence로 취급합니다.
- OPTIONS/HEAD는 소유권 성공 Evidence에서 제외합니다.
- 확인된 타인 소유 객체에 대한 write 성공은 빈 body여도 고위험 BOLA 후보입니다.
- BFLA에는 명시적 신원 역할과 endpoint 요구 역할이 필요합니다. 경로나 token만 보고 ADMIN을 추정하지 않습니다.
- 자동 owner 추출은 의도적으로 보수적입니다. 충돌하거나 신뢰도가 낮은 첫 접근자는 finding을 만들지 않습니다. 운영자는 Web 그래프 상세에서 owner를 확인할 수 있습니다.
- JWT payload는 검증되지 않은 grouping hint이며 인증 증명이 아닙니다. 가능한 경우 identity를 service·issuer·audience·subject로 namespace합니다.
- 일반 LLM assessment는 finding을 확정할 수 없습니다. 최종 validation은 없거나 오래됐거나 다른 run·후보에 속하거나 의미가 맞지 않거나 `CONTROLLED`가 아닌 Evidence ID를 거부합니다.
- 이 베타의 결정적 자동 validation은 안전한 GET 후보에 제한합니다. write method validation은 `INCONCLUSIVE`이며 자동 전송하지 않습니다.

## 로컬 MCP 도구

읽기 전용: 상태, 안전한 세션 metadata, 잠긴 후보·Evidence 페이지 조회, 마스킹된 단일 Evidence, assessment, 검증된 decision, ZAP 환경·passive 상태, lock 이후 native alert.

상태 변경: active run 전 exact scope 교체, LLM run 시작·종료, 통제된 exact-scope 대상 요청, 완료된 3-lane dataset lock, 결정론적 ZAP 기준선 시작, 비확정 assessment 제출, 서버 검증 validation bundle 제출, 승인형 ZAP Active Scan 요청. Explorer는 lock 전에 다른 source 후보를 읽을 수 없습니다. 상태 변경 대상 method에는 `confirmed=true`와 별도 Burp 승인이 모두 필요합니다.

MCP와 Web 서버는 `127.0.0.1`에만 bind하고 Host·Origin을 검증하며, 각각 독립된 무작위 capability token을 요구하고 요청 크기를 제한합니다. 확장이 unload되면 함께 종료됩니다.

## 데이터 처리

- 명시적 로그인 캡처로 선택한 raw Authorization/Cookie/CSRF는 메모리 broker에만 존재합니다. Web/MCP에 노출하거나 프로젝트에 저장하지 않으며 교체·폐기·unload 때 broker buffer를 덮어씁니다. Java·HTTP library가 만드는 짧은 immutable String 사본까지 물리적으로 지운다는 뜻은 아니므로 하드웨어 secret vault가 아닌 process-memory containment입니다.
- Authorization, Cookie, Set-Cookie, password, token, secret, API key는 Evidence 저장 전에 마스킹합니다.
- 인증 grouping은 subject 또는 짧은 단방향 fingerprint를 사용하며 raw opaque token은 보존하지 않습니다. Cookie 존재만으로 로그인 사용자를 확정하지 않습니다. 연결되지 않은 fingerprint는 감사·binding 후보로 남지만 broker exact match 또는 명시적 account binding 전에는 서비스별 `UNRESOLVED` graph identity 하나로 표시합니다.
- 트래픽 분류는 저장 Evidence를 삭제하지 않습니다. operation별 `include/exclude/auto` override도 응답 없음, unknown source, 비탐색 validation 트래픽을 discovery coverage로 만들 수 없습니다. 반복 관측은 화면에서만 접고 모든 Evidence ID·count·first/last timestamp를 유지합니다.
- body와 message 상세는 필드별 8KiB로 제한하고 실시간 수집은 20,000건에서 멈춥니다.
- 프로젝트 파일은 마스킹되지만 application data가 남을 수 있습니다. POSIX에서는 owner read/write로 기록하며 engagement 데이터 정책에 따라 보호하십시오.
- 프로젝트는 임시 파일을 거쳐 저장하고 지원되는 경우 atomic replace를 사용합니다.

## 정직한 한계

- FlowScope의 최종 verdict는 수집된 인가 동작이 베타 Evidence oracle을 충족했다는 뜻입니다. business impact를 자동으로 증명하거나 engagement 보고서 검토를 없애지 않습니다.
- owner 추출은 일반적인 scalar owner/user/account 필드와 명시적 nested owner/user/author/account/customer principal object를 인식합니다. 도메인 고유 소유권은 운영자가 확인해야 합니다.
- 세션 자동화는 일반 cookie, bearer/CSRF header, 회전, 만료 hint, 의심 응답을 다룹니다. CAPTCHA, MFA, WebAuthn, device binding, 애플리케이션 고유 refresh/login protocol은 수동 재캡처가 필요할 수 있습니다.
- 안정 신호가 없는 opaque 회전 token은 자동 상관할 수 없습니다. 운영자가 확인된 fingerprint를 등록 계정에 명시적으로 연결할 수 있습니다.
- Fetch Metadata와 MIME은 없거나 잘못될 수 있고 business API가 document·asset·telemetry와 비슷할 수 있습니다. 분류기는 여러 고신뢰 신호가 합치할 때만 제외하고 애매한 요청을 메인 그래프 밖 `REVIEW`로 보존하며 이유와 reversible override를 제공합니다. `REVIEW`를 확인하지 않으면 실제 API가 메인 비교에서 빠질 수 있으므로 트래픽 노이즈를 완벽하게 분류한다고 주장하지 않습니다.
- 데이터 흐름은 제한된 exact-value matching이며 완전한 semantic taint analysis가 아닙니다.
- Repeater handoff는 저장된 마스킹 요청을 사용하며 자동 전송하지 않습니다. 결정적 자동 validation은 Repeater나 직접 8082 트래픽이 아니라 FlowScope 통제 MCP 요청만 사용합니다.
- closed-world 실행은 제공된 agent workspace의 instruction·tool 계약입니다. 별도로 개조한 에이전트 설치나 다른 로컬 process를 통제하지는 못합니다. 서버의 scope·Evidence 시야·verdict gate가 최종 권위입니다.
- source별 active metadata context는 하나만 허용하며 겹치는 LLM·ZAP run은 거부합니다.
- 그래프 접기는 의미 기반 clustering이 아니라 화면 pagination입니다. 클릭할 때마다 대상 객체·API 18개를 추가하며, 20,000건 수집 상한은 계속 Burp를 보호합니다.
- Montoya `2026.7`에 맞춰 컴파일했습니다. 실제 engagement에서 사용하는 Burp 버전으로 release JAR을 확인해야 합니다.

## Standalone 데모

```bash
mvn exec:java
mvn exec:java -Dexec.args="human.xml scanner.xml llm.xml"
```

## 라이선스와 보안

FlowScope는 MIT License를 사용합니다. fat JAR에 포함된 Cytoscape.js는 MIT, Jackson은 Apache-2.0이며 전체 고지는 `META-INF/`에 포함됩니다.

소유하거나 명시적으로 점검 허가를 받은 시스템에만 사용하십시오. 비공개 취약점 신고와 운영 안전 지침은 [`SECURITY.md`](SECURITY.md)를 참조하십시오.

영문 문서는 [`docs/en/README.md`](docs/en/README.md)에서 확인할 수 있습니다.
