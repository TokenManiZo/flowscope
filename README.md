# FlowScope 1.2.0-beta.20

FlowScope는 **사람(HUMAN), 스캐너(SCANNER), LLM**이 실제 대상에 남긴 트래픽을 하나의 신원 인지 인가 그래프와 커버리지 매트릭스에 정렬하는 Burp Suite Community 호환 확장입니다. LLM의 추측을 확정 취약점으로 취급하지 않으며, 관측 범위 안의 미교차 객체 조합과 Evidence 기반 BOLA/IDOR·BFLA 후보를 보여 줍니다. 응답 또는 Burp Site Map에서 발견됐지만 아직 요청하지 않은 exact-scope 경로는 관측 그래프와 분리된 중립 후보로 제시합니다.

## 제품 목표와 완료 판단

> 허가된 exact scope에서 관측 가능한 접근통제 공격면을 최대한 구조화하고, 신원·작업·객체·상태 흐름의 차이를 재현 가능한 Evidence로 검증해 사람이 놓치기 쉬운 경로와 인가 후보를 드러낸다.

FlowScope는 블랙박스 대상의 모든 endpoint·객체·상태를 발견하거나 오탐·미탐을 0으로 만든다고 보장하지 않습니다. LLM의 설명만으로 취약점을 확정하지도 않습니다. 제품의 완성도는 공개 fixture와 정답을 격리한 블라인드 benchmark에서 endpoint·객체·분류·finding의 측정값, 사람의 `REVIEW` 작업량, false positive·false negative·unresolved 결과를 숨기지 않고 공개하는 방식으로 판단합니다. 모든 후보와 최종 verdict는 원 Request/Response Evidence 및 재현·정상 대조 Evidence로 역추적할 수 있어야 합니다.

```text
신원 ──접근──▶ 객체 ──호출──▶ 작업
USER B        orders:101      GET /api/orders/{id}
```

## 주요 기능

- source, source detail, orchestrator, tool, phase, run 정보를 독립적으로 보존하는 Burp 실시간 수집
- 모든 source에 대한 exact scope Evidence 수집. HUMAN은 Burp로 다른 사이트를 방문할 수 있지만 범위 밖 응답은 FlowScope에 저장하거나 그래프로 만들지 않음
- HUMAN/SCANNER/LLM 필터와 직교 edge·제한적 그룹 펼치기를 지원하는 IDA식 계층 그래프. 같은 요청자·객체·source의 반복 접근선은 화면에서 한 선과 `H/S/L×횟수`로 접되 원 operation·Evidence·판정은 상세에 그대로 유지
- 원본 URL은 보존하고, UUID/긴 16진 형식·성공 응답 ID 일치·같은 위치의 복수 값/독립 관측을 근거로 operation 경로를 자동 묶음. `LITERAL/INFERRED/CORROBORATED`와 이유를 상세에 표시
- `신원 × 작업 × 객체` 커버리지 매트릭스, 미교차 조합, 일부만 발견, source 간 판정 불일치
- 응답 분류, 명시적 소유자 Evidence, 사용자가 입력한 역할 정책을 이용하는 결정론적 BOLA/IDOR·BFLA 후보 엔진
- 비밀값을 저장하지 않는 테스트 계정 레지스트리와 명시적 메모리 전용 Session Broker. HUMAN 로그인 캡처, 성공 응답 확인 전 `UNVERIFIED`, 쿠키 회전, 만료·의심 상태, 계정별 ZAP/LLM 요청을 지원. 같은 서비스의 동일 인증 지문을 다른 계정으로 다시 연결하려 하면 자동 이동하지 않고 충돌 상태로 차단
- query, 요청 본문, 마스킹된 요청·응답, timestamp, redirect, GraphQL operation, 응답→요청 데이터 흐름 수집. 텍스트 전문은 메시지당 기본 1MiB, 중복 제거 후 압축 총량 48MiB까지 GZIP·SHA-256으로 보존하고 UI preview는 8KiB로 분리
- Evidence 보존형 트래픽 분류. `INCLUDE`만 메인 3-way 비교에 사용하고, 애매한 `REVIEW`는 별도 검토 대기로 보존하며, 고신뢰 보조 트래픽은 `EXCLUDE`로 기본 숨김
- classifier v4가 인증 준비와 반복 polling을 각각 `AUTH_SESSION`, `POLLING`으로 분리하고, web manifest·source map·service worker를 탐색 메타데이터로 분리하며 같은 service·정규화 operation의 명시적 API Evidence로 애매한 형제 관측을 교차 보강
- 공통 route discovery 파이프라인이 exact-scope HTML, 정적 JavaScript 호출, OpenAPI JSON/YAML, 표준 metadata, generic XML과 응답 없는 Burp Site Map 항목을 동일한 검증·정규화·dedup gate로 처리. method 근거가 없으면 `UNKNOWN`이며 후보는 실제 요청·응답 전까지 coverage·gap·verdict·finding을 바꾸지 않음
- `ANONYMOUS / ACCOUNT_BOUND / UNRESOLVED` 인증 상태. 연결되지 않은 회전 쿠키가 그래프 신원을 폭증시키지 않으며, 확인된 계정 연결은 서비스 경계를 유지
- Codex·Claude Code 구독형 클라이언트용 localhost 전용 인증 MCP 서버
- 시스템 소유 신원 격리 ZAP 캠페인: 비로그인과 선택한 ACTIVE 계정마다 fresh ZAP session → Traditional Spider → strict Client Spider(AJAX fallback) → passive queue 완료 → native alert. 완료 gate는 지연 재빌드된 화면 snapshot이 아니라 raw Burp capture를 세며, Client API가 완료돼도 rendered capture가 0이면 AJAX로 전환하고 둘 다 0이면 `COMPLETED_WITH_WARNINGS`로 표시합니다. Active Scan은 별도 승인 필요
- exact scope FlowScope 요청 도구를 통한 closed-world LLM 실행. 직접 외부 트래픽은 최종 판정의 결정적 Evidence로 신뢰하지 않음
- 서버가 강제하는 독립 Explorer 시야, 불변 3-lane dataset lock, 최종 LLM Judge 종합
- Web 빠른 시작에서 로컬 구독 Codex/Claude CLI를 새 프로세스로 실행하는 `LLM Explorer 시작`·`Judge 시작` 버튼. Explorer는 비영속 새 세션, Judge는 별도 새 세션으로 시작하며 완료 뒤 같은 Judge 대화를 명시적으로 재개 가능
- Explorer가 자신의 source/run provenance로 발견한 route만 읽는 MCP 후보 목록. pre-lock status는 다른 lane의 수량·run·판정을 숨기고, Explorer 중에는 ZAP 상태/실행도 차단하며, lock 시 route inventory를 함께 고정
- 기존 Burp Proxy history 원클릭 가져오기. 같은 동작에서 응답 없는 exact-scope Site Map 항목은 미요청 route 후보로 가져오고, 실제 반복 횟수를 보존해 중복을 억제. 네트워크를 사용하지 않는 온보딩 샘플은 화면에 “실제 점검 결과 아님” 배너로 명시
- 계정·세션 연결, 정책, LLM assessment, 서버 검증 최종 verdict, 사람 감사 판정을 관계형으로 보존하는 로컬 `.flowscope.db`. 한 번 저장하거나 열면 변경을 30초 checkpoint로 합쳐 자동 저장하며, `.flowscope.json`은 호환 내보내기·가져오기로 유지
- path/query/JSON·XML·multipart·GraphQL에서 명시적으로 관측된 객체 참조를 모두 보존. 기존 인가 cell은 첫 번째 근거 있는 참조만 primary로 사용해 검증되지 않은 객체 Cartesian product를 만들지 않음
- `*Id`가 아닌 `customerNo`, `documentSeq`, `accountRef` 같은 도메인 식별자는 이름 하나로 확정하지 않고, 동일 서비스·메서드·경로·필드 위치에서 서로 다른 값이 반복 관측될 때만 `*_SEMANTIC_FIELD_CORROBORATED` 객체 근거로 보강. `pageNo`, `sortKey`, API key류는 제외
- 명시적 사람 검증을 위한 Web 요청 실험실. live Evidence의 HTTP 원문 바이트는 Burp 프로세스의 상한 있는 메모리에만 보관합니다. Content-Type 문자셋으로 엄격히 디코딩하고, 수정하지 않은 요청은 원래 바이트 그대로 재전송하며, 텍스트로 안전하게 해석할 수 없는 본문은 Web 편집 전송을 차단하고 Burp Repeater로 넘깁니다. `원문 그대로/비로그인/등록 계정` 전송 결과는 discovery가 아닌 HUMAN `VALIDATION` Evidence입니다.
- 긴 API 경로는 `/` 경계를 우선해 줄바꿈하고 단일 접근선의 의미 없는 `H×1` 라벨은 숨깁니다. 900px 이하 화면은 잘린 그래프 대신 같은 필터의 API 목록을 제공하며, 파싱 결과의 명시적 `상세 보기`는 선택한 Evidence ID를 그대로 엽니다. 관측 신원과 재사용 가능한 등록 계정 세션은 별도 개념으로 표시합니다.
- 반복 재현·허가된 정상 대조 관측을 요구하는 Evidence-bound LLM 검증과 사람 감사·오버라이드
- XXE 차단과 item 단위 오류 건너뛰기를 적용한 엄격한 Burp XML 가져오기

FlowScope는 블랙박스 공격면 전체를 알 수 없으므로 오해를 만드는 커버리지 퍼센트를 표시하지 않습니다.

텍스트 전문이 메시지당 기본 1MiB를 넘거나 Content-Type상 바이너리이거나, digest 중복 제거 후 압축 전문 총량이 기본 48MiB를 넘으면 전문을 저장하지 않고 원래 byte 수와 SHA-256 및 미보존 사유만 남깁니다. live 수집은 Burp 보호를 위해 20,000건에서 멈추며 초과 record 수와 전문 미보존 메시지 수를 Web UI에 표시합니다. 이는 무제한 수집을 보장하는 구조가 아닙니다.

## 요구사항

완전한 3-way 흐름에는 아래 세 lane이 모두 필요합니다. ZAP과 로컬 LLM 클라이언트는 제품 전체에서 선택 기능이 아니라, HUMAN-only 제한 모드에서만 생략할 수 있습니다.

| 목적 | 필수 환경 |
|---|---|
| Release JAR로 HUMAN-only 사용 | Montoya API를 지원하는 최신 Burp Suite Community 또는 Professional |
| HUMAN + SCANNER | 위 환경 + OWASP ZAP 2.17.0 |
| 완전한 HUMAN + SCANNER + LLM/Judge | 위 환경 + 로그인된 Codex CLI 또는 Claude Code 중 하나 |
| 소스 빌드 | 위 실행 환경 + JDK 21 이상 + Maven 3.9 이상 |
| 선택적 ZAP 컨테이너 | Docker Engine/Desktop + Docker Compose v2 |

현재 실환경 기준선은 Burp Community `2026.7.3`, ZAP `2.17.0`, JDK `21`입니다. 이는 확인한 조합이지 모든 운영체제와 이전 버전에 대한 호환 보장이 아닙니다. PortSwigger도 최신 Montoya 변경과의 호환을 위해 최신 Burp 사용을 권고합니다.

## 5분 설치

### 1. Release JAR 사용

[GitHub Releases](https://github.com/choewonwoo1817/testflowscope/releases)에서 `flowscope-1.2.0-beta.20.jar`를 받습니다. Release JAR 사용자는 Maven이 필요하지 않습니다. Burp를 별도 JRE로 실행하는 경우에는 Java 21 이상이어야 합니다.

소스에서 직접 빌드할 때만 다음을 실행합니다.

```bash
mvn clean verify
```

빌드가 끝나면 `target/flowscope-1.2.0-beta.20.jar` 하나만 남습니다.

### 2. Burp listener 준비

Burp **Settings → Tools → Proxy → Proxy listeners**에서 `127.0.0.1:8080`(HUMAN)과 `127.0.0.1:8081`(SCANNER)을 만듭니다. 그런 다음 **Extensions → Installed → Add → Java**에서 JAR을 불러옵니다.

### 3. ZAP 준비

macOS/Linux에서 가장 짧은 경로는 다음 한 줄입니다.

```bash
./scripts/zap-up.sh
```

이 스크립트는 digest로 고정된 공식 ZAP 2.17.0 이미지를 실행하고, 임의 API key를 `~/.flowscope/zap-api-key`에 소유자 전용으로 저장하며, ZAP의 upstream HTTP proxy를 Docker 호스트의 Burp SCANNER `8081`로 설정합니다. ZAP API는 호스트 `127.0.0.1:8089`에만 공개됩니다. Burp/구독 LLM은 컨테이너에 넣지 않습니다.

ZAP Desktop을 직접 설치해도 됩니다. 이 경우 ZAP API를 `127.0.0.1:8089`에 열고 API key를 설정한 뒤, ZAP **Network → Connection → HTTP Proxy**를 `127.0.0.1:8081`로 설정하십시오.

### 4. LLM 준비와 사전 점검

Codex 또는 Claude Code 중 하나를 설치하고 터미널에서 한 번 실행해 구독 로그인을 완료합니다. FlowScope는 provider API key를 받지 않으며 Burp를 시작한 환경에서 실행 가능한 로컬 CLI를 사용합니다.

JAR과 listener를 준비한 뒤 macOS/Linux에서는 다음으로 핵심 연결을 확인합니다.

```bash
./scripts/doctor.sh
```

소스 빌드 도구까지 확인하려면 `./scripts/doctor.sh --build`를 사용합니다. 포트가 열렸다는 결과는 해당 포트의 프로세스가 Burp임을 암호학적으로 증명하지 않으므로, 마지막으로 Burp listener 표와 FlowScope 탭의 포트 분류를 눈으로 확인하십시오.

운영체제별 설치, Windows 수동 절차, 포트·Docker·CLI 문제 해결은 [한국어 상세 시작 가이드](docs/ko/getting-started.md)에 있습니다. 영어 가이드는 [docs/en/getting-started.md](docs/en/getting-started.md)입니다.

## 저장소 구조

- [`src/main`](src/main) — Burp 확장, 분석 코어, 로컬 Web 작업면, MCP/ZAP 통합, 번들 고지
- [`src/test`](src/test) — 보안·파서·분석·저장·MCP·로컬 Web 결정론적 회귀 테스트
- [`agent-workspace`](agent-workspace) — Codex/Claude MCP 설정과 Explorer/Judge 실행 지침
- [`infra/zap`](infra/zap) — 선택형 공식 ZAP 2.17.0 Docker Compose와 안전한 시작 스크립트
- [`scripts`](scripts) — ZAP 시작·중지와 macOS/Linux 환경 점검 도구
- [`docs/ko`](docs/ko) — 한국어 설계·결정·개발 기록·검증·연구·기능명세 정본
- [`docs/en`](docs/en) — 영어 사용자·협업·보안·변경 이력 문서
- [`.github`](.github) — Maven CI와 의존성 업데이트 설정

빌드 산출물은 `target/`에만 만들어집니다. 사용자가 선택한 로컬 `.flowscope.db`/`.flowscope.json` 프로젝트, 로컬 검토 패키지와 머신별 설정은 Git에서 제외되며 공개 저장소의 일부가 아닙니다.

팀 인계용 현재 구현·코드 지도·알려진 결함·다음 작업 순서는 [`docs/ko/HANDOFF.md`](docs/ko/HANDOFF.md), 정확한 베타 검증 범위와 남은 실환경 gate는 [`docs/ko/beta-validation.md`](docs/ko/beta-validation.md), 작업별 변경·이유·검증은 [`docs/ko/development-log.md`](docs/ko/development-log.md), 화면별 설계와 발표 근거는 [`docs/ko/ui-product-rationale.md`](docs/ko/ui-product-rationale.md)에 기록합니다.

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

관측 Evidence가 0건인 Web UI는 분석 수치와 고급 조작을 먼저 펼치지 않습니다. exact scope 설정, 로그인/HUMAN pass, ZAP 기준선, 독립 LLM Explorer/Judge 순서와 빠른 시작·샘플 조작만 보여 주며, Evidence가 생기면 기존 분석 작업면으로 자동 전환합니다.

## 일반적인 점검 흐름

1. exact scope를 설정하고 익명 또는 최소 권한 테스트 계정을 사용합니다. 기본 제어면은 Burp 탭입니다. MCP 클라이언트의 `flowscope_set_scope`는 운영자가 명시적으로 허가한 exact target만, SCANNER/LLM run 시작 전에 설정할 수 있습니다. ADMIN 계정은 필수가 아니며 명시적 역할 비교가 필요한 경우에만 사용합니다.
2. **계정·세션**에서 USER A/USER B처럼 비밀값이 없는 표시 이름을 등록합니다. 계정마다 **로그인 연결**을 시작하고 HUMAN 8080을 통해 로그인한 뒤 인증된 페이지의 성공 응답까지 확인하고 캡처를 종료합니다. 기본 화면에는 계정 하나가 카드 하나로 보이며, 같은 로그인에서 얻은 Cookie·Authorization·subject 지문은 계정 수를 늘리지 않고 접힌 **기술 정보**에만 묶입니다. 미연결 지문을 직접 확인해야 할 때만 **고급 세션 진단**을 엽니다. 자격증명만 있고 성공 응답이 관측되지 않은 세션은 `로그인 확인 필요`로 남아 ZAP/LLM에 주입되지 않습니다. 빠른 시작의 HUMAN 계정 선택에는 실제 broker 상태가 `ACTIVE`인 계정만 나오며, 선택한 계정과 실제 요청 자격증명이 정확히 일치할 때만 그 계정으로 기록됩니다. 불일치 요청을 선택 계정으로 강제 표시하지 않습니다. raw 세션 값은 확장 메모리에만 남으며 LLM에 반환하거나 프로젝트에 저장하지 않습니다. 로그인 준비 트래픽과 HUMAN pass 밖에서 발생한 같은 scope 트래픽도 Evidence로는 보존하지만 3-way 비교와 갭에서는 제외합니다. **HUMAN pass 시작** 후 허가된 기능을 탐색하고 같은 run을 종료하십시오. Web의 `pass 완료`는 수집 건수가 아니라 해당 run의 정확한 종료가 확인됐을 때만 표시됩니다. pass 중 Repeater·Intruder로 만든 요청은 같은 run에 속하되 실제 Burp 도구 detail을 유지합니다. Proxy·Repeater·Intruder 응답은 Montoya `messageId`로 요청 시점 pass/account에 연결되며, 초기화·프로젝트 교체 이전의 늦은 응답이나 상관관계를 잃은 응답은 현재 pass로 추측하지 않고 제외됩니다. 대상 동작만으로 알 수 없는 신원 역할, endpoint 요구 역할, 확인된 객체 소유자는 사용자가 지정합니다. BOLA 비교에는 서로 다른 최소 권한 계정 2개를 권장합니다.

- 선택적 수동 검증: 그래프에서 API를 누르고 Evidence의 **요청 실험실**을 엽니다. `원문 그대로`, `비로그인으로 전송`, `등록 계정으로 전송` 중 의도한 모드를 고르고 path/query/header/body를 편집한 뒤 명시적으로 전송합니다. 네트워크 목적지는 원 Evidence 서비스로 고정되고 redirect는 따라가지 않습니다. 응답과 시간·크기를 확인할 수 있으며 전송 결과는 HUMAN `VALIDATION` Evidence가 되어 탐색 커버리지를 늘리지 않습니다. live 원문은 기본 요청 1MiB·응답 4MiB·총 32MiB의 Burp 프로세스 메모리에서만 유지되고 프로젝트 교체·초기화·unload 때 폐기됩니다. 프로젝트/XML에서 가져온 항목이나 상한 초과 항목은 마스킹 전문만 사용할 수 있습니다.

3. ZAP의 outgoing proxy를 `127.0.0.1:8081`로 설정합니다. Web 빠른 시작에서 exact-scope target, 비로그인, 하나 이상의 ACTIVE 계정을 복수 선택하고 **신원별 격리 검사 시작**을 누릅니다. FlowScope는 각 신원 전환 전에 ZAP session을 새로 만들고 Traditional Spider → Client Spider(AJAX fallback) → passive 완료 → native alert 순서를 실행합니다. Client status가 완료여도 실제 rendered capture가 0이면 AJAX를 실행하며 AJAX도 0이면 `COMPLETED_WITH_WARNINGS`와 원인을 표시합니다. 계정 레인은 기존 Authorization/Cookie/CSRF를 제거한 뒤 해당 broker 값만 주입합니다. 비로그인 레인은 fresh session 안에서 새로 발급된 익명 Cookie/CSRF를 유지하되 이 lane의 신원은 계속 `ANONYMOUS`로 고정합니다. 신원별 범위 안 scanner 트래픽이 0건이면 전체 SCANNER 완료 gate를 열지 않습니다. FlowScope Web 자체 loopback URL은 대상 목록과 실행에서 제외합니다. Active Scan은 이 캠페인에 포함되지 않으며 항상 별도 Burp 승인이 필요합니다.
4. Web 빠른 시작에서 로컬 로그인 상태인 Codex 또는 Claude, exact-scope target과 선택적 ACTIVE 계정을 고른 뒤 **LLM Explorer 시작**을 누릅니다. FlowScope는 이전 대화를 재개하지 않는 전용 임시 작업공간과 새 CLI 프로세스를 만들고, 번들 지침·대상·scope·서버가 선발급한 run ID를 표준입력으로 전달합니다. Explorer는 MCP의 자기 run만 보고 `flowscope_target_request`로 탐색한 뒤 같은 run을 정상 종료해야 완료됩니다. 서버는 HUMAN/SCANNER 결과를 숨기며, 웹 검색·Wayback·외부 API 문서·소스 저장소·직접 curl/브라우저 네트워킹은 허용하지 않습니다.
5. 파싱 결과의 **검토 대기**를 확인해 실제 API면 operation을 **분석에 포함**, 보조 트래픽이면 **기본 숨김**으로 확정할 수 있습니다. 세 레인을 모두 정상 종료한 뒤 **Judge 시작**을 누릅니다. FlowScope는 Explorer 대화와 분리된 새 Judge 세션을 시작합니다. Judge는 dataset을 잠그고 메인 후보·잠긴 REVIEW Evidence·ZAP native alert를 읽은 뒤, 비최종 assessment와 좁은 safe-GET 재현·정상 대조 Evidence를 제출합니다. 완료 뒤 **Judge 계속**은 새 Judge를 만들지 않고 저장된 provider session ID로 같은 Judge 대화를 재개합니다. CLI 프로세스 자체를 계속 켜 두는 구조는 아닙니다.
6. FlowScope는 bundle이 현재 후보와 일치하고 서버 검사를 통과할 때만 `CONFIRMED` 또는 `REJECTED`를 허용합니다. 같은 run의 LLM 재현 2건 이상, 허가된 정상 대조 1건 이상, 일치하는 신원·작업·객체 의미와 응답 Evidence가 필요합니다. BOLA 읽기 응답은 대상 객체 ID를 구조적으로 포함해야 하며 owner 문자열만으로는 충분하지 않습니다. 나머지는 `INCONCLUSIVE`입니다. **시나리오**와 Request/Response를 검토하십시오. 사람 기록은 감사 가능한 오버라이드이며 검증되지 않은 자동 finding이 아닙니다.
7. Burp 탭의 **로컬 DB 저장·연결**로 `.flowscope.db`를 한 번 지정합니다. 이후 그래프·계정·검토·판정 변경은 30초 checkpoint로 합쳐 같은 DB에 원자적으로 자동 저장되고 정상 unload 직전 한 번 더 저장됩니다. 공유·검토용 단일 문서가 필요하면 **JSON 내보내기**를 사용합니다. DB에도 raw broker 자격증명은 저장되지 않으므로 Burp를 다시 열면 로그인 연결은 다시 해야 합니다.

## 모델 API 키 없이 Codex·Claude 구독 사용

FlowScope는 모델 API를 직접 호출하거나 provider OAuth token을 받지 않습니다. Codex 또는 Claude는 사용자의 기존 CLI 로그인·구독으로 인증하고 FlowScope는 로컬 MCP 서버와 실행 인자만 제공합니다. Web 버튼은 Burp를 시작한 환경에서 실행 가능한 `codex` 또는 `claude`를 찾고, 상속된 `OPENAI_API_KEY`·`ANTHROPIC_API_KEY`는 자식 환경에서 제거합니다. FlowScope 탭의 **연결 문자열 복사**로 얻는 무작위 Bearer 값은 localhost MCP 서버를 보호하는 FlowScope 토큰이며 OpenAI·Anthropic credential이 아닙니다. 토큰은 자식 프로세스 환경에만 전달하고 명령행·프롬프트·프로젝트에는 넣지 않으며 화면에는 마스킹합니다.

버튼 자동화가 환경상 동작하지 않으면 아래 `agent-workspace` 방식이 수동 폴백입니다. Explorer는 Codex의 ephemeral 실행 또는 Claude의 no-persistence 실행을 사용하고 절대 resume하지 않습니다. Judge는 별도 provider session ID를 보존해 후속 질문만 같은 세션으로 재개합니다. 일부 Claude Code 버전은 `--no-session-persistence`에도 provider metadata 파일을 남길 수 있으므로 UI가 이를 경고합니다. FlowScope는 논리적으로 그 세션을 재사용하지 않으며, 사용자의 provider 홈을 임의 삭제하지 않습니다.

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
-Dflowscope.payload.maxBytes=1048576
-Dflowscope.payload.memoryBytes=50331648
-Dflowscope.mcp.token=<필요한-경우-고정-로컬-토큰>
-Dflowscope.mcp.tokenFile=/소유자만-읽는/토큰/파일의/절대경로
-Dflowscope.scope=https://api.example.test/v1
-Dflowscope.zap.url=http://127.0.0.1:8089
-Dflowscope.zap.key=<zap-local-api-key>
-Dflowscope.zap.keyFile=/소유자만-읽는/zap-api-key/절대경로
-Dflowscope.llm.codex.path=/실행가능한/codex/절대경로
-Dflowscope.llm.claude.path=/실행가능한/claude/절대경로
```

ZAP API endpoint는 loopback 주소만 허용합니다. API key 우선순위는 `flowscope.zap.key` → `FLOWSCOPE_ZAP_API_KEY` → `flowscope.zap.keyFile` → 기본 `~/.flowscope/zap-api-key`입니다. 기본 파일은 심볼릭 링크와 group/others 권한을 거부합니다. ZAP의 대상 트래픽은 Burp SCANNER listener를 통과하도록 설정해야 합니다. Client status `100`이나 AJAX API의 `OK`는 실제 rendered traffic을 증명하지 않습니다. FlowScope는 단계별 raw capture로 이를 확인하며, 전체 캡처 0건 run은 실패하고 rendered만 0건인 run은 경고 완료입니다.

## 제품 작업면

- **Burp 탭** — exact scope, 포트 분류, 실시간 수량, MCP 연결 복사, Proxy history 가져오기, 로컬 SQLite DB 저장·연결/불러오기, JSON 내보내기, 샘플, 초기화, 정본 로컬 Web 작업면 열기
- **Web 상단 모드** — 그래프, 판정 매트릭스, 흐름 순서, 시나리오, 파싱 결과, 계정·세션
- **왼쪽 레일** — 허위 퍼센트 없는 수집·메인 비교·기본 숨김·검토 대기 수량, 실제 메인 Evidence 수와 함께 동작하는 HUMAN/SCANNER/LLM 필터, Evidence 처분·class 표시 필터, 읽기 전용 역할 정책 상태, 3-way gap, 그래프 판정 제어
- **Flow Graph** — 고정된 `identity → resource → operation` 열, 객체 식별자가 없는 경우 `identity → operation` 직접 edge, 접근 경로의 두 구간 모두에 적용되는 HUMAN 파랑·실선·H / SCANNER 빨강·파선·S / LLM 검정·점선·L 평행 overlay, 관측과 분리된 중립색·점선 테두리의 미요청 route 후보, 별도 인가 판정 view, focus+context 선택, 화면 맞춤, 18개 단위 객체·API 그룹 펼치기. 응답→요청 데이터 의존성은 메인 접근선과 섞지 않고 `흐름 순서`에서 표시
- **판정 매트릭스** — 관측된 `identity/role × operation × resource` cell, source별 verdict, 미교차 조합, 일부만 발견, 불일치
- **흐름 순서** — timestamp가 있는 관측에서 복원한 응답→요청 ID/token 의존성
- **시나리오** — 결정론적 BOLA/BFLA 후보·gap, 비최종 Judge assessment, 서버 검증 최종 verdict
- **시나리오 감사·오버라이드** — Evidence-bound 상태와 마스킹 note를 갖는 사람 감사면. validation 검사를 우회하지 않음
- **파싱 결과** — 마스킹된 source, identity, method, 정규화 operation, resource, status, traffic class/disposition, repeat count, stable Evidence ID. 행을 선택하면 operation 상세와 페이지형 Evidence를 표시
- **계정·세션** — 비밀값 없는 계정별 카드, `로그인 필요/확인 중/사용 가능/다시 로그인 필요` 행동 안내, 명시적 HUMAN 로그인 캡처, 접힌 내부 인증 단서와 고급 미연결 진단, 연결·해제, 재인증, 메모리 폐기, 계정 삭제
- **오른쪽 상세** — 선택 API의 source별 verdict, 필요할 때만 가져오는 마스킹 Request/Response, 전체 화면 요청 실험실과 Burp Repeater 초안. polling snapshot은 저장된 모든 message body나 raw 인증값을 전송하지 않음

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
- body와 message preview는 필드별 8KiB입니다. 마스킹된 textual 전문은 메시지당 기본 1MiB·digest 중복 제거 후 압축 총량 48MiB까지 보존하며, 실시간 수집은 20,000건에서 멈춥니다.
- SQLite 프로젝트와 JSON 내보내기는 마스킹되지만 application data가 남을 수 있습니다. POSIX에서는 owner read/write로 기록하며 engagement 데이터 정책에 따라 보호하십시오.
- SQLite 자동 저장과 JSON 내보내기는 임시 파일을 거쳐 저장하고 지원되는 경우 atomic replace를 사용합니다. SQLite는 현재 메모리 분석 상태의 내구성 snapshot이며 20,000건 live 상한을 없애는 서버용 event store는 아닙니다.

## 정직한 한계

- FlowScope의 최종 verdict는 수집된 인가 동작이 베타 Evidence oracle을 충족했다는 뜻입니다. business impact를 자동으로 증명하거나 engagement 보고서 검토를 없애지 않습니다.
- owner 추출은 일반적인 scalar owner/user/account 필드와 명시적 nested owner/user/author/account/customer principal object를 인식합니다. 도메인 고유 소유권은 운영자가 확인해야 합니다.
- 세션 자동화는 일반 cookie, bearer/CSRF header, 회전, 만료 hint, 의심 응답을 다룹니다. CAPTCHA, MFA, WebAuthn, device binding, 애플리케이션 고유 refresh/login protocol은 수동 재캡처가 필요할 수 있습니다.
- `ACTIVE`는 자격증명이 포함된 캡처에서 401·로그인 redirect·invalid-token이 아닌 HTTP 응답을 관측했다는 범용 transport 증거입니다. 서비스 고유 `/me` 의미나 계정 소유를 자동 증명하지 않으므로 실제 역할·계정 연결은 운영자가 확인해야 합니다.
- 안정 신호가 없는 opaque 회전 token은 자동 상관할 수 없습니다. 운영자가 확인된 fingerprint를 등록 계정에 명시적으로 연결할 수 있습니다.
- Fetch Metadata와 MIME은 없거나 잘못될 수 있고 business API가 document·asset·telemetry와 비슷할 수 있습니다. 분류기는 여러 고신뢰 신호가 합치할 때만 제외하고 애매한 요청을 메인 그래프 밖 `REVIEW`로 보존하며 이유와 reversible override를 제공합니다. `REVIEW`를 확인하지 않으면 실제 API가 메인 비교에서 빠질 수 있으므로 트래픽 노이즈를 완벽하게 분류한다고 주장하지 않습니다.
- 미요청 route는 보존된 마스킹 textual 응답(전문 미보존 시 8KiB preview)과 응답 없는 Burp Site Map 항목에서 최대 20,000개까지 추출합니다. 동적으로 조합된 JavaScript URL, 클라이언트 실행으로만 생기는 경로, 대상 밖 문서는 추측하지 않으므로 후보 목록도 전체 공격면이 아닙니다. 후보 우선순위는 공개된 범주형 근거이며 확률이나 취약성 점수가 아닙니다.
- 데이터 흐름은 제한된 exact-value matching이며 완전한 semantic taint analysis가 아닙니다.
- Repeater handoff는 live 원문이 메모리에 있으면 그 원문, 아니면 저장된 마스킹 요청을 사용하며 자동 전송하지 않습니다. Web 요청 실험실의 명시적 전송은 HUMAN `VALIDATION` Evidence로 수집하지만 LLM 최종 verdict gate를 우회하지 않습니다. 결정적 자동 validation은 FlowScope 통제 MCP 요청과 서버 검증 bundle을 사용합니다.
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
