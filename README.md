# FlowScope 1.2.0-beta.49

beta.48은 Burp가 JDBC를 먼저 초기화한 환경에서 프로젝트 저장이 `FlowScope SQLite save failed`로 실패하던 결함을 수정합니다. SQLite를 따로 설치하거나 scope를 바꿀 필요는 없습니다. 기존 진단은 가능한 경우 먼저 저장/JSON 내보내기한 뒤, 이전 확장을 내리고 새 JAR 하나만 로드하십시오. DB 형식은 바뀌지 않습니다.

현재 배포는 기존 LLM Judge·MCP·브라우저 하네스를 제거한 상태에서, **판정 없는 독립 LLM Explorer**를 제공합니다(D-128/D-139). HUMAN·ZAP 실행과 H/S/L Evidence 비교는 유지합니다. Explorer는 로그인된 로컬 Codex app-server의 동적 도구 호출을 exact-scope Burp HTTP 전송에 연결합니다. 실제 응답은 `source=LLM` Observation Evidence로, 그 응답 산출물에서 읽은 endpoint·parameter는 같은 run Evidence에 결박된 검토용 Declaration으로 분리 저장합니다. MCP 서버와 Judge는 다시 넣지 않았습니다.

FlowScope는 **사람(HUMAN), 스캐너(SCANNER), LLM**이 허가된 대상에서 실제로 관측한 API·입력을 같은 좌표에 정렬해, 어느 endpoint와 parameter를 누가 보았고 아직 무엇이 미관측인지 Evidence로 보여 주는 Burp Suite Community 호환 확장입니다. 선언 근거(OpenAPI·HTML form·정적 JavaScript)와 실제 HTTP Evidence를 분리해 비교하고, 선택한 API의 BOLA/IDOR·BFLA 근거는 기존 인가 그래프·매트릭스에서 상세 확인합니다.

## 제품 목표와 완료 판단

> 허가된 exact scope에서 선언되거나 실제 관측된 API·입력을 구조화하고, HUMAN·SCANNER·LLM의 탐색 차이와 인가 후보를 원 Evidence까지 역추적 가능하게 만들어 진단자가 다음에 볼 위치를 줄인다.

FlowScope는 블랙박스 대상의 모든 endpoint·parameter·접근 대상 ID·상태를 발견하거나 오탐·미탐을 0으로 만든다고 보장하지 않습니다. `미관측`은 취약점이나 lane 실패 판정이 아니며, LLM의 설명만으로 취약점을 확정하지도 않습니다. 제품의 완성도는 개발 corpus와 분리된 블라인드 benchmark에서 endpoint·parameter·접근 대상 ID·분류·finding의 precision/recall, 사람의 `REVIEW` 작업량, false positive·false negative·unresolved를 함께 공개하는 방식으로 판단합니다.

```text
선언(OpenAPI·HTML·JS) ─┐
HUMAN·SCANNER·LLM 관측 ─┴─▶ Endpoint·Parameter Delta ─▶ 인가 상세
```

## 주요 기능

- 값 없는 범용 `EndpointKey(service, method, canonical path)`와 `ParameterKey(endpoint, location, fieldPath)`로 선언과 실제 관측을 분리하고 H/S/L source별 차이를 기본 작업목록에 표시. query, path, 중첩 JSON, form, multipart, GraphQL variables와 OpenAPI·HTML form·정적 JavaScript AST call-site를 처리하며 타깃명·업무명으로 분기하지 않음
- JavaScript는 실행하지 않고 Closure Compiler AST로 `fetch`, `XMLHttpRequest`, axios, jQuery, `sendBeacon`의 직접 확인 가능한 URL·method·query/body key와 정적/dynamic import 자산을 추출. lexical scope의 불변 literal·object member와 axios instance `baseURL`/요청별 override를 해석하되 재할당·동적 값은 거짓 endpoint로 만들지 않고 산출물별 해석 실패로 표시
- Next.js pages-router의 공개 build manifest는 API를 추측하지 않고 client chunk 참조만 추가해 후속 JavaScript 분석 대상으로 연결. HTML `script`, `modulepreload`, script `preload/prefetch`는 Vue/Nuxt·Angular를 포함한 공통 자산 경로로 처리하며, GraphQL HTTP 관측은 operation과 variable field를 transport 필드와 분리
- source, source detail, orchestrator, tool, phase, run 정보를 독립적으로 보존하는 Burp 실시간 수집
- 모든 source에 대한 exact scope Evidence 수집. HUMAN은 Burp로 다른 사이트를 방문할 수 있지만 범위 밖 응답은 FlowScope에 저장하거나 그래프로 만들지 않음
- HUMAN/SCANNER/LLM 필터와 직교 edge를 지원하는 인가 그래프. React 화면은 사이트 개요(Target→API 그룹) → API 보기(신원→API) → 객체 보기(신원→API→접근 대상 ID) 세 단계로 내려가며, API·접근 대상 ID는 18개씩 `18개 더 보기 (N개 남음)`으로 늘립니다. 표시 노드는 서버 권한 셀과 Evidence ID를 그대로 들고 있어 Fact Core의 `Evidence × Identity × API × Resource × Source × Run × HTTP outcome` 관계를 삭제하거나 합치지 않습니다. 미교차 후보는 중립 점선 경로로만 표시하고 Evidence로 만들지 않습니다.
- 원본 URL은 보존하고, UUID/긴 16진 형식·성공 응답 ID 일치·같은 위치의 복수 값/독립 관측을 근거로 operation 경로를 자동 묶음. `LITERAL/INFERRED/CORROBORATED`와 이유를 상세에 표시
- `신원 × 작업 × 접근 대상 ID` 커버리지 매트릭스, 미교차 조합, 일부만 발견, source 간 판정 불일치
- 응답 분류, 명시적 소유자 Evidence, 사용자가 입력한 역할 정책을 이용하는 결정론적 BOLA/IDOR·BFLA 후보 엔진
- 비밀값을 저장하지 않는 테스트 계정 레지스트리와 명시적 메모리 전용 Session Broker. HUMAN 로그인 캡처, 성공 응답 확인 전 `UNVERIFIED`, 쿠키 회전, 만료·의심 상태와 HUMAN Request Lab 요청을 지원. Burp Proxy history·Repeater에서 운영자가 확인한 응답 있는 요청을 우클릭해 등록 계정의 독립 세션 슬롯으로 가져올 수 있어, 브라우저가 다음 계정으로 전환된 뒤에도 이전 계정 자격을 메모리에서 재사용한다. 같은 서비스의 동일 인증정보를 다른 계정으로 다시 연결하려 하면 자동 이동하지 않고 거부하며 기존 슬롯을 보존한다. ZAP·LLM 로그인 설정은 같은 등록 계정 ID에 결박할 수 있으며 원문 ID·비밀번호는 각 실행기의 메모리 vault에만 둔다. ZAP 로그인만 다시 실행하는 세션 갱신은 성공 정규식과 일치한 실제 인증 Evidence의 Cookie·Authorization·Set-Cookie를 해당 계정 Session Broker 슬롯으로 승격하며, 원문을 찾지 못하면 성공으로 표시하지 않는다
- query, 요청 본문, 마스킹된 요청·응답, timestamp, redirect, GraphQL operation, 응답→요청 데이터 흐름 수집. 일반 textual 메시지는 기본 1MiB, route discovery가 읽는 HTML/JavaScript/JSON/XML 응답은 기본 4MiB까지 `FULL` payload로 보존하고, digest 중복 제거 후 압축 총량 48MiB를 적용합니다. 8,192자 `body/reqText/respText`는 UI 미리보기이며 분석기는 보존된 payload 전문을 우선 사용합니다. 발견용 4MiB 초과 응답은 metadata-only가 되어 전체 분석하지 않습니다.
- Evidence 보존형 트래픽 분류. `INCLUDE`만 메인 3-way 비교에 사용하고, 애매한 `REVIEW`는 별도 검토 대기로 보존하며, 고신뢰 보조 트래픽은 `EXCLUDE`로 기본 숨김
- classifier v6가 인증 준비를 source와 무관하게 `AUTH_SESSION/EXCLUDE`, 반복 polling을 `POLLING`으로 분리하고, web manifest·source map·service worker를 탐색 메타데이터로 분리한다. API 문맥 없는 401/403 디렉터리 probe는 `REVIEW`로 보존하고, JSON/API 문맥·접근 대상·비안전 메서드 등 독립 근거가 있을 때만 메인 API로 포함한다.
- 공통 route discovery 파이프라인이 exact-scope HTML, 정적 JavaScript 호출, OpenAPI JSON/YAML, 표준 metadata, generic XML과 응답 없는 Burp Site Map 항목을 동일한 검증·정규화·dedup gate로 처리. method 근거가 없으면 `UNKNOWN`이며 후보는 실제 요청·응답 전까지 coverage·gap·verdict·finding을 바꾸지 않음
- `ANONYMOUS / ACCOUNT_BOUND / UNRESOLVED` 인증 상태. 연결되지 않은 회전 쿠키가 그래프 신원을 폭증시키지 않으며, 확인된 계정 연결은 서비스 경계를 유지
- 시스템 소유 신원 격리 ZAP 기준선: 비로그인과 선택한 로그인 계정마다 이름 없는 임시 ZAP session과 exact-scope Context를 만듭니다. 모든 lane은 bundle의 FlowScope Docker 이미지가 제공하는 Chromium·동일 주 버전 ChromeDriver와 `chrome-headless` Client Spider로 실행하며, `zapHomePath`가 tmpfs `/run/flowscope-zap/` 아래가 아니면 시작 전에 차단합니다. 로그인 lane은 Chrome Headless Browser Based Authentication과 session auto-detect를 설정합니다. ZAP action의 `OK`나 인증 시각만으로 성공 처리하지 않고, 같은 run·계정의 실제 `ZAP_AUTHENTICATION` 응답이 사용자가 지정한 로그인 성공 정규식과 일치할 때만 계정 지정 Client Spider를 시작합니다. 선택적 로그아웃 정규식이 더 나중 Evidence에 일치하면 실패합니다. 선택적 exact-scope API 정의 import → 로그인 → strict Client Spider → Passive 분석 → native Alert 수집 순서이며 Traditional/AJAX/Active Scan/Fuzzer/Forced Browse는 실행하지 않습니다. Client 실패·범위 안 응답 0건·출처 capability 손상·격리 정리 실패를 성공으로 숨기지 않습니다.
- ZAP은 FlowScope Docker 경로 하나만 제공합니다. `zap-up` helper가 pinned ZAP 2.17 base 위에 Debian Chromium과 ChromeDriver를 함께 빌드하고 API key·Burp upstream·휘발성 작업공간을 구성합니다. 호스트에 Chrome·ChromeDriver·ZAP Desktop을 별도로 설치하거나 브라우저 버전을 맞출 필요가 없습니다.
- 목적별 Evidence 신뢰 정책과 exact-run 완료 gate. HUMAN은 관측/통제 응답, SCANNER는 통제 응답을 요구하며 완료 당시 Evidence ID를 보존합니다. 가져오기·직접 fallback을 새 run 완료로 승격하지 않습니다.
- 독립 LLM Explorer. Web에서 비로그인 또는 메모리 전용 HTML form/JSON API 계정을 선택하면 로그인된 Codex가 HTML·JavaScript·manifest·source map·API 정의와 응답 frontier를 순회합니다. 대상 요청은 모델의 직접 네트워크가 아니라 exact-scope HTTP 도구를 거쳐 Burp Montoya로 전송되고 실제 응답만 `CONTROLLED` LLM Observation Evidence가 됩니다. 산출물에서 직접 읽은 endpoint·parameter는 현재 run의 응답 Evidence ID가 있어야 별도 선언 도구로 저장되며, 서버가 의미 중복을 제거합니다. 64KiB를 넘는 응답은 최대 4MiB 임시 artifact로 한 번 전달해 로컬 분석하고 같은 파일의 Range 재수집을 지침에서 금지합니다. Explorer가 보낸 OPTIONS probe는 실제 기능 API 관측 수와 분리하되 일반 HUMAN/선언 OPTIONS API는 유지합니다. 작업 피드에는 경과시간·요청·Evidence ID·선언 수·probe·실패·미해결 사유가 표시되며 실행 중 steer·취소를 지원합니다. 취약점 verdict·심각도·확률은 만들지 않습니다.
- 기존 Burp Proxy history 원클릭 가져오기. 같은 동작에서 응답 없는 exact-scope Site Map 항목은 미요청 route 후보로 가져오고, 실제 반복 횟수를 보존해 중복을 억제. 네트워크를 사용하지 않는 온보딩 샘플은 화면에 “실제 점검 결과 아님” 배너로 명시
- 스캐너 파일 업로드에서 ZAP이 내보낸 HAR 1.2 요청·응답을 SCANNER Evidence로 가져오기. HAR의 메서드·URL·query·header·body·status·timestamp를 기존 정규화 파이프라인에 넣되, HAR만으로 ZAP native Alert나 캠페인 완료를 만들지 않음
- 계정·세션 연결, 정책, 과거 읽기 전용 평가, 사람 감사 판정과 값·비밀정보 없는 실행 시도 결과를 관계형으로 보존하는 로컬 `.flowscope.db`. Web의 **새 진단 시작**은 현재 진단을 `~/.flowscope/projects/<이름--scope--시각>/project.flowscope.db`에 먼저 저장한 뒤 새 exact scope의 빈 프로젝트로 전환하며, 저장 실패 시 현재 화면을 유지합니다. 상단에서 `저장 대기/저장 중/저장됨/저장 실패`와 이전 프로젝트를 확인할 수 있습니다. HTTP 응답 Evidence와 응답 전 TLS·DNS·timeout·연결 실패는 분리되어, “새 API를 못 찾음”과 “요청 자체를 못 보냄”을 구분합니다. 변경은 30초 checkpoint로 합쳐 자동 저장하며, `.flowscope.json`은 호환 내보내기·가져오기로 유지
- path/query/JSON·XML·multipart·GraphQL에서 명시적으로 관측된 객체 참조를 모두 보존. 기존 인가 cell은 첫 번째 근거 있는 참조만 primary로 사용해 검증되지 않은 객체 Cartesian product를 만들지 않음
- `*Id`가 아닌 `customerNo`, `documentSeq`, `accountRef` 같은 도메인 식별자는 이름 하나로 확정하지 않고, 동일 서비스·메서드·경로·필드 위치에서 서로 다른 값이 반복 관측될 때만 `*_SEMANTIC_FIELD_CORROBORATED` 객체 근거로 보강. `pageNo`, `sortKey`, API key류는 제외
- 명시적 사람 검증을 위한 Web 요청 실험실. live Evidence의 HTTP 원문 바이트는 Burp 프로세스의 상한 있는 메모리에만 보관합니다. Content-Type 문자셋으로 엄격히 디코딩하고, 수정하지 않은 요청은 원래 바이트 그대로 재전송하며, 텍스트로 안전하게 해석할 수 없는 본문은 Web 편집 전송을 차단하고 Burp Repeater로 넘깁니다. Evidence generation과 전송 중 draft 잠금, 서버 operation ID 멱등성으로 늦은 응답·중복 상태 변경을 막으며, `원문 그대로/비로그인/등록 계정` 전송 결과는 discovery가 아닌 HUMAN `VALIDATION` Evidence입니다. 일시적인 snapshot 조회 실패에서는 미전송 편집을 메모리에 유지하고 전송·인증 변경만 잠그며, 같은 dataset의 조회가 복구되면 다시 활성화합니다.
- 긴 API 경로는 `/` 경계를 우선해 줄바꿈하고 단일 접근선의 의미 없는 `H×1` 라벨은 숨깁니다. 900px 이하 화면은 잘린 그래프 대신 같은 필터의 API 목록을 제공하며, 파싱 결과의 명시적 `상세 보기`는 선택한 Evidence ID를 그대로 엽니다. 관측 신원과 재사용 가능한 등록 계정 세션은 별도 개념으로 표시합니다.
- XXE 차단과 item 단위 오류 건너뛰기를 적용한 엄격한 Burp XML 가져오기, 크기·깊이·항목 단위 오류 경계를 둔 ZAP HAR 가져오기. 두 입력은 계정·세션 지문·run provenance가 다른 동일 HTTP를 합치지 않으며 같은 파일 재가져오기만 multiset 기준으로 억제합니다. XML base64 HTTP 본문은 명시된 Content-Type 문자셋을 따르고 XML/HAR의 IPv6 service는 대괄호 표기로 정규화합니다.

FlowScope는 블랙박스 공격면 전체를 알 수 없으므로 오해를 만드는 커버리지 퍼센트를 표시하지 않습니다.

일반 textual 메시지가 기본 1MiB를 넘거나, 발견용 HTML/JavaScript/JSON/XML 응답이 기본 4MiB를 넘거나, Content-Type상 바이너리이거나, digest 중복 제거 후 압축 전문 총량이 기본 48MiB를 넘으면 전문을 저장하지 않고 byte 수, 제한된 마스킹 표현·실제 크기·미보존 사유를 길이 구분한 SHA-256 식별자만 남깁니다. 이 값은 상한 초과 원문의 완전한 checksum으로 주장하지 않습니다. live 수집은 Burp 보호를 위해 20,000건에서 멈추며 초과 record 수와 전문 미보존 메시지 수를 Web UI에 표시합니다. 이는 무제한 수집을 보장하는 구조가 아닙니다.

## 요구사항

현재 실행 경로는 HUMAN, ZAP, 독립 LLM Explorer입니다. Judge와 MCP 서버는 없습니다.

| 목적 | 필수 환경 |
|---|---|
| Release JAR로 HUMAN-only 사용 | Montoya API를 지원하는 최신 Burp Suite Community 또는 Professional |
| HUMAN + SCANNER | distribution bundle + 위 환경 + Docker Compose v2 |
| LLM Explorer | Release JAR 또는 bundle + 위 환경 + 공식 Codex CLI와 유효한 Codex 로그인 |
| 소스 빌드 | 위 실행 환경 + JDK 21 정확히 + Maven 3.9.x |
| ZAP 컨테이너 | macOS/Linux: Docker Engine/Desktop + Compose v2, Windows: Docker Desktop + PowerShell 7 |

현재 실환경 기준선은 Burp Community `2026.7.3`, ZAP `2.17.0`, JDK `21`입니다. 이는 확인한 조합이지 모든 운영체제와 이전 버전에 대한 호환 보장이 아닙니다. PortSwigger도 최신 Montoya 변경과의 호환을 위해 최신 Burp 사용을 권고합니다.

## 5분 시작 — 이 순서만 따라 하세요

현재 GitHub 저장소는 비공개입니다. 협업 권한이 있는 본인 GitHub 계정으로 로그인한 뒤 Release를 받으십시오. 로그아웃 상태나 권한 없는 계정에서는 링크가 404로 보일 수 있습니다.

### 처음 한 번만 준비

1. [GitHub Releases](https://github.com/choewonwoo1817/testflowscope/releases)에서 `flowscope-1.2.0-beta.49-bundle.zip`을 받아 압축을 풀고, bundle 루트의 JAR을 Burp **Extensions → Installed → Add → Java**에서 불러옵니다. ZAP을 쓰지 않으면 JAR만 받아도 됩니다. 해당 자산이 아직 없으면 저장소의 beta.48 소스를 clone한 뒤 아래 소스 빌드 절차로 만듭니다.
2. Burp **Settings → Tools → Proxy → Proxy listeners**에 HUMAN용 `127.0.0.1:8080`을 만들고, ZAP을 사용할 때만 SCANNER용 `127.0.0.1:8081`을 추가합니다. Docker Desktop은 이 loopback 경로를 사용합니다. native Linux Docker Engine에서는 Docker bridge IP에만 `8081` listener를 하나 더 추가해야 합니다. listener가 없으면 ZAP 캠페인은 시작 전에 "listener … is closed"로 즉시 실패합니다.
3. ZAP 기준선을 실행할 때는 압축을 푼 bundle 루트에서 macOS/Linux `./scripts/zap-up.sh`, Windows PowerShell 7 `.\scripts\zap-up.ps1`을 실행합니다. helper가 Chromium·ChromeDriver가 포함된 FlowScope ZAP 이미지를 자동 빌드·기동합니다. HUMAN/Explorer만 쓰면 이 단계가 필요 없습니다. 중지했다면 다음 점검 전에 `zap-up`만 다시 실행하면 됩니다. Burp는 호스트에서 실행합니다.

4. 사용할 기능에 맞는 환경만 확인합니다.

```bash
./scripts/doctor.sh --mode human
./scripts/doctor.sh --mode zap
./scripts/doctor.sh --mode explorer
./scripts/doctor.sh --mode full
```

```powershell
.\scripts\doctor.ps1 -Mode human
.\scripts\doctor.ps1 -Mode zap
.\scripts\doctor.ps1 -Mode explorer
.\scripts\doctor.ps1 -Mode full
```

현재 doctor는 호스트의 loopback 포트와 ZAP upstream 설정을 검사하므로, native Linux 컨테이너에서 Burp bridge listener까지 연결되는지는 증명하지 않습니다.

### 점검할 때마다

1. Web 상단의 **새 진단 시작**에서 프로젝트 이름과 허가된 exact scope를 입력합니다. 기존 진단이 있으면 먼저 로컬 프로젝트 DB에 보존되고, 저장 실패 시 새 scope로 전환되지 않습니다. Burp 탭의 **범위 적용**은 아직 데이터가 없는 첫 진단에서 같은 프로젝트 생성을 수행합니다.
2. `http://127.0.0.1:17777/`에서 상단 **점검**을 눌러 점검 시작 화면을 엽니다.
3. 화면이 자동으로 여는 첫 미완료 단계만 수행합니다: **범위 → HUMAN → ZAP**. 이어 **LLM Explorer 열기**에서 독립 탐색을 실행합니다.
4. 완료 뒤 **API·입력 차이**에서 HUMAN·ZAP·LLM 선언/관측 차이와 산출물 파싱 상태를 먼저 보고, 선택한 API를 인가 그래프·판정 매트릭스·Evidence에서 검토합니다.

빠른 시작은 한 번에 한 단계의 제어만 보여 주며, 상단 단계 버튼으로 이전·다음 설정을 직접 확인할 수 있습니다. ZAP의 일반 통신 실패 1·2회는 `RETRYING`, 3회 연속 실패는 `UNREACHABLE`로 표시하며 API key 오류는 즉시 확정합니다(D-138). `CONNECTED`는 제어 API와 관리 runtime이 준비됐다는 뜻이지 crawler 완료를 뜻하지 않습니다. 연결이 실제로 끊기면 해당 단계 안에서 운영체제별 Docker helper를 보여 줍니다.

소스에서 직접 빌드할 때는 JDK 21과 Maven 3.9.x로 `mvn clean verify`를 실행합니다. JDK 22 이상은 `--release 21`이어도 다른 bytecode를 만들 수 있으므로 빌드가 초기에 거부됩니다. Maven이 고정된 Node.js/npm을 `target/frontend-runtime`에 내려받아 React 테스트·typecheck·고지 생성·Vite 빌드를 수행하므로 시스템 Node.js를 따로 설치할 필요는 없습니다. 최초 빌드는 Maven/npm 의존성을 내려받을 네트워크가 필요합니다. 결과는 Burp용 `target/flowscope-1.2.0-beta.49.jar`와 다운로드용 `target/flowscope-1.2.0-beta.49-bundle.zip`입니다. bundle에는 JAR, ZAP Dockerfile/Compose/helper, macOS·Linux·Windows doctor가 들어 있습니다. 빌드는 사용 플러그인 버전을 고정하고 JAR과 bundle의 반복 SHA-256을 CI에서 비교합니다.

## 저장소 구조

- [`src/main`](src/main) — Burp 확장, 분석 코어, 로컬 Web 작업면, ZAP 통합, 번들 고지
- [`src/test`](src/test) — 보안·파서·분석·저장·ZAP·로컬 Web 결정론적 회귀 테스트
- [`frontend`](frontend) — 기본 React 작업면, component test, Vite build와 브라우저 E2E 하네스
- [`infra/zap`](infra/zap) — 공식 ZAP 2.17.0 base에 Chromium·ChromeDriver를 더한 FlowScope Dockerfile, Compose와 안전한 시작 스크립트
- [`scripts`](scripts) — macOS/Linux Bash와 Windows PowerShell ZAP key 준비·FlowScope Docker 시작/중지·환경 점검 도구
- [`.github`](.github) — Maven CI와 의존성 업데이트 설정

빌드 산출물은 `target/`에만 만들어집니다. 사용자가 선택한 로컬 `.flowscope.db`/`.flowscope.json` 프로젝트, 로컬 검토 패키지와 머신별 설정은 Git에서 제외되며 공개 저장소의 일부가 아닙니다.

## 상세 동작과 정확성 경계

처음 실행하는 사용자는 위 **5분 시작**만 따르면 됩니다. 아래 내용은 세션·수집·판정이 어떤 조건에서 유효한지 확인할 때 사용하는 상세 참조입니다.

HUMAN과 SCANNER용 Burp proxy listener를 만드십시오. Montoya는 확장 프로그램에서 listener를 생성할 수 없습니다. 8082 source 분류는 과거 직접 클라이언트 관측 호환용이며, 새 Explorer는 이 listener가 아니라 Montoya 전송을 사용합니다.

| Listener | Source | 사용 클라이언트 |
|---|---|---|
| `127.0.0.1:8080` | HUMAN | 브라우저 또는 수동 점검자 |
| `127.0.0.1:8081` | SCANNER | 대상 요청을 보내는 ZAP |
| `127.0.0.1:8082` | LLM | 선택적 직접 클라이언트 관측 fallback (`UNVERIFIED_RUNTIME`, Evidence 보존만; coverage·완료 불가) |

native Linux Docker Engine의 ZAP은 [Docker의 기본 `host-gateway` 매핑](https://docs.docker.com/reference/cli/dockerd/#configure-host-gateway-ip)에 따라 호스트의 default bridge IP로 연결합니다. `127.0.0.1:8081`만 연 상태로는 이 경로를 받을 수 없으므로, 해당 bridge IP에 SCANNER listener를 추가합니다.

각 대상 클라이언트에 Burp CA 인증서를 설치하십시오. TLS 검증을 영구적으로 끄지 마십시오.

Burp의 **FlowScope** 탭을 열고 한 줄에 하나의 허가된 exact scope를 입력한 다음 **범위 적용**을 누릅니다. scope는 scheme, host, effective port, 선택적 path prefix를 포함합니다.

```text
https://api.example.test/v1
http://127.0.0.1:3000/
```

scope가 비어 있으면 ZAP 캠페인 실행은 차단됩니다.

관측 Evidence가 0건인 Web UI는 분석 수치와 고급 조작을 먼저 펼치지 않습니다. exact scope 설정, 로그인/HUMAN pass, ZAP 기준선, Evidence 검토 순서와 빠른 시작·샘플 조작만 보여 주며, Evidence가 생기면 기존 분석 작업면으로 자동 전환합니다.

ZAP의 `scope-only`는 FlowScope scope가 아니라 ZAP Context를 기준으로 합니다. 따라서 캠페인은 각 신원마다 선택 target의 origin·path subtree만 포함하는 fresh Context를 만들며 sibling path·subdomain·다른 port/scheme은 포함하지 않습니다. Context 생성이나 passive rule 활성 확인에 실패하면 spider를 시작하지 않습니다.

## 일반적인 점검 흐름

1. exact scope를 설정하고 익명 또는 최소 권한 테스트 계정을 사용합니다. 기본 제어면은 Burp 탭입니다. ADMIN 계정은 필수가 아니며 명시적 역할 비교가 필요한 경우에만 사용합니다.
2. **계정·세션**에서 USER A/USER B처럼 비밀값이 없는 표시 이름을 한 번 등록합니다. HUMAN은 계정마다 **로그인 연결**을 시작하고 HUMAN 8080을 통해 로그인한 뒤 인증된 페이지의 성공 응답까지 확인하고 캡처를 종료하거나, Proxy history·Repeater의 확인된 요청을 해당 계정 슬롯으로 직접 가져옵니다. 같은 등록 계정에 ZAP 또는 LLM 로그인 설정을 추가할 수 있으며 이를 별도 신원으로 만들지 않습니다. ZAP 설정이 있는 계정은 전체 크롤링 없이 **세션 갱신**만 실행해 ZAP Browser Based Authentication의 검증된 응답을 독립 HUMAN 재전송 세션으로 연결할 수 있습니다. 기본 화면에는 계정 하나가 카드 하나로 보이며 Cookie·Authorization·subject 지문은 계정 수를 늘리지 않고 접힌 **기술 정보**에만 묶입니다. 자격증명만 있고 성공 응답이 관측되지 않은 세션은 `로그인 확인 필요`로 남아 HUMAN pass와 Request Lab에 재사용되지 않습니다. 빠른 시작의 HUMAN 계정 선택에는 실제 broker 상태가 `ACTIVE`인 계정만 나오며, 선택한 계정과 실제 요청 자격증명이 정확히 일치할 때만 그 계정으로 기록됩니다. 불일치 요청을 선택 계정으로 강제 표시하지 않습니다. raw 세션 값은 확장 메모리에만 남으며 LLM에 반환하거나 프로젝트에 저장하지 않습니다. 로그인 준비 트래픽과 HUMAN pass 밖에서 발생한 같은 scope 트래픽도 Evidence로는 보존하지만 3-way 비교와 갭에서는 제외합니다. **HUMAN pass 시작** 후 허가된 기능을 탐색하고 같은 run을 종료하십시오. Web의 `pass 완료`는 수집 건수가 아니라 해당 run의 정확한 종료가 확인됐을 때만 표시됩니다. pass 중 Repeater·Intruder로 만든 요청은 같은 run에 속하되 실제 Burp 도구 detail을 유지합니다. Proxy·Repeater·Intruder 응답은 Montoya `messageId`로 요청 시점 pass/account에 연결되며, 데이터셋·프로젝트 교체 이전의 늦은 응답이나 상관관계를 잃은 응답은 현재 pass로 추측하지 않고 제외됩니다. 대상 동작만으로 알 수 없는 신원 역할, endpoint 요구 역할, 확인된 객체 소유자는 사용자가 지정합니다. BOLA 비교에는 서로 다른 최소 권한 계정 2개를 권장합니다.

- 선택적 수동 검증: 그래프에서 API를 누르고 Evidence의 **요청 실험실**을 엽니다. 화면은 인증 교체 전 관측 원문을 표시하고 선택 계정 인증값은 노출하지 않으며, Web 전송 또는 Burp Repeater 초안 생성 시 서버에서 교체합니다. Web 전송은 `현재 ACTIVE 계정`·`비로그인`·`원문 그대로`를 지원하며, Burp Repeater 초안은 원본 인증값 대신 `현재 세션` 또는 `비로그인`으로만 엽니다. path/query/header/body를 편집해도 네트워크 목적지는 원 Evidence 서비스로 고정되고 redirect는 따라가지 않습니다. 응답과 시간·크기를 확인할 수 있으며 전송 결과는 HUMAN `VALIDATION` Evidence가 되어 탐색 커버리지를 늘리지 않습니다. live 원문은 기본 요청 1MiB·응답 4MiB·총 32MiB의 Burp 프로세스 메모리에서만 유지되고 프로젝트·샘플 교체와 unload 때 폐기됩니다. 프로젝트/XML/HAR에서 가져온 항목이나 상한 초과 항목은 마스킹 전문만 사용할 수 있습니다.

3. bundle의 `zap-up` helper로 FlowScope Docker Chromium ZAP을 시작합니다. helper가 outgoing proxy를 `host.docker.internal:8081`로 설정하고, Web 빠른 시작은 API key·휘발성 runtime·필수 add-on을 확인합니다. exact-scope target과 비로그인을 선택하거나 등록 계정에 **ZAP 브라우저 로그인 설정**(로그인 URL·ID·비밀번호·필수 로그인 성공 정규식)을 추가한 뒤 **신원별 격리 검사 시작**을 누릅니다. 로그인 lane은 같은 계정의 실제 인증 응답 Evidence가 성공 정규식과 일치한 뒤에만 strict Client Spider → Passive 분석 → native Alert 수집 순서로 실행합니다. 계정의 **세션 갱신**은 이 인증 단계만 격리 실행하고 검증된 세션을 Session Broker로 옮기며 크롤링하지 않습니다. 선택적 로그아웃 정규식에는 실패 화면에만 보이는 문구를 넣습니다. Client 실패·범위 안 응답 0건·격리 정리 실패는 lane 실패로 표시하고, 로그인 실패를 익명 성공으로 바꾸지 않습니다. 화면은 경과시간·작업 신호·계정별 순번·인증 상태·Client 수집 건수·Passive queue·Alert 집계를 표시합니다. Active Scan·Fuzzer·Forced Browse는 기본 캠페인에 포함되지 않습니다.
4. Web **LLM Explorer**에서 시작 URL, 비로그인 및 필요한 계정을 고른 뒤 실행합니다. Explorer 계정의 ID·비밀번호와 live cookie/token은 현재 프로세스 메모리에만 있고 모델에는 opaque handle만 전달됩니다. 로그인 준비 교환은 프로젝트/Evidence/원장에 저장하지 않습니다. 실제 대상 응답과 산출물 선언은 Observation/Declaration으로 분리되며 선언에는 현재 run Evidence ID가 필수입니다. 작업 피드에서 경과시간·HTTP 시도/응답, 선언 endpoint/parameter, OPTIONS probe, 실패·미해결 항목을 확인하고 실행 중 steer·취소할 수 있습니다.
5. **API·입력 차이**, **Evidence**, 그래프·매트릭스에서 선언/관측과 인가 후보를 확인합니다. 규칙 후보의 사람 검토를 저장할 수 있으며, 자동 LLM 판정은 하지 않습니다.
6. 과거 프로젝트의 assessment/validation은 React **시나리오 → 과거 LLM 기록 · 읽기 전용**에서 확인합니다. 원 Evidence ID·생성 시각을 보존하되 현재 후보나 새 판정으로 합치지 않습니다.
7. Burp 탭의 **로컬 DB 저장·연결**로 `.flowscope.db`를 한 번 지정합니다. 이후 그래프·계정·검토·판정 변경은 30초 checkpoint로 합쳐 같은 DB에 원자적으로 자동 저장됩니다. 정상 unload는 새 수집·가져오기·분석 게시를 먼저 닫고 대기 중 Evidence의 마지막 분석을 반영한 뒤 한 번 더 저장을 시도합니다. 공유·검토용 단일 문서가 필요하면 **JSON 내보내기**를 사용합니다. DB에도 raw broker 또는 Explorer 자격증명은 저장되지 않으므로 Burp를 다시 열면 로그인 연결은 다시 해야 합니다.

> ZAP 로그인 교환은 감사 가능한 `ZAP_AUTHENTICATION / SESSION_SETUP` Evidence로 보존되지만, SCANNER 탐색 성과·crawler 수집 건수·완료 조건에는 포함되지 않습니다. 따라서 로그인만 성공하고 crawler가 응답을 수집하지 못한 lane은 완료로 표시되지 않습니다.

## LLM Explorer 상태

기존 `/api/llm-run`, `/api/ai-preview`, `/api/ai-scenarios`와 MCP 서버는 삭제된 채 유지됩니다. `8787` 리스너, MCP 토큰, 격리 브라우저, Judge, agent-workspace는 없습니다. 새 `/api/explorer-run`과 `/api/explorer-accounts`는 React Explorer 화면 전용의 loopback Web 계약입니다.

공식 Codex CLI 설치·로그인이 필요하지만 API key, Node.js 직접 설치, Playwright/Chrome 또는 MCP 설정은 필요하지 않습니다. FlowScope는 Codex 실행 파일과 로그인 상태를 확인하고, 모델에는 인증 비밀 대신 opaque account handle과 HTTP/선언 dynamic tool만 제공합니다. app-server dynamic tools는 현재 experimental API이므로 실제 설치된 CLI 호환성은 readiness와 opt-in 실물 provider gate로 확인합니다. LLM 응답 Evidence 0건은 완료가 아니라 실패로 남고, 모델의 자유서술 개수는 완료 집계로 사용하지 않습니다.

## Provenance 모델

`source`는 대상 요청을 실제로 생성한 주체이고, `orchestrator`는 그 도구 실행을 시작한 주체입니다. 두 값은 독립적입니다.

| 동작 | Source | Detail | Orchestrator |
|---|---|---|---|
| 수동 브라우저 | HUMAN | BROWSER | HUMAN |
| Burp Repeater | HUMAN | BURP_REPEATER | HUMAN |
| 점검자가 시작한 ZAP | SCANNER | ZAP_* | HUMAN |
| 결정론적 ZAP 기준선 | SCANNER | ZAP_* | SYSTEM |
| 새 독립 Codex Explorer | LLM | LLM_EXPLORER | LLM (`CONTROLLED`) |
| 8082 직접 fallback | LLM | 설정된 listener detail | LLM (`UNVERIFIED_RUNTIME`) |

Burp 시작 전에 다음 시스템 속성으로 기본 포트를 바꿀 수 있습니다.

```text
-Dflowscope.ports=8080:human:browser,8081:scanner:other_scanner,8082:llm:llm_explorer
-Dflowscope.web.port=17777
-Dflowscope.payload.maxBytes=1048576
-Dflowscope.payload.memoryBytes=50331648
-Dflowscope.scope=https://api.example.test/v1
-Dflowscope.zap.url=http://127.0.0.1:8089
-Dflowscope.zap.key=<zap-local-api-key>
-Dflowscope.zap.keyFile=/소유자만-읽는/zap-api-key/절대경로
```

ZAP API endpoint는 loopback 주소만 허용합니다. API key 우선순위는 `flowscope.zap.key` → `FLOWSCOPE_ZAP_API_KEY` → `flowscope.zap.keyFile` → 기본 `~/.flowscope/zap-api-key`입니다. 기본 파일은 심볼릭 링크와 group/others 권한을 거부합니다. Java client와 제공 스크립트는 key를 URL query나 프로세스 인자에 넣지 않고 `X-ZAP-API-Key` 헤더로 보냅니다. Docker ZAP API는 기본적으로 loopback, 해석된 `host.docker.internal` 주소와 컨테이너의 default Compose bridge gateway만 exact allowlist로 허용하며 `api.addrs.addr.name=.*`를 사용하지 않습니다. ZAP의 대상 트래픽은 Burp SCANNER listener를 통과하도록 설정해야 합니다. 시스템 캠페인은 run별 capability가 확인된 프록시 요청만 CONTROLLED ZAP Evidence로 받으며 헤더는 대상 전송 전에 제거합니다. capability 누락은 자동으로 허용하지 않고 차단 수를 상태에 남기며 다음 단계 전에 실패시킵니다. Client status `100`만으로 실제 대상 트래픽을 증명하지 않으며, FlowScope는 같은 run의 raw `ZAP_CLIENT_SPIDER` 응답 수집 건수를 확인합니다. 0건이면 성공으로 표시하지 않습니다. `Alert 집계 미완료`는 Passive 정체 시점까지의 snapshot이므로 ZAP이 이후 분석했을 결과 전체를 뜻하지 않습니다.

## 제품 작업면

beta.47에서 수정한 ZAP 종료·재시작 경합 처리는 beta.48 이후(현재 beta.49)에도 유지됩니다. ZAP 실행 화면의 `종료 처리 · 임시 상태 정리 중` 동안에는 이전 실행을 정리하므로 시작·중복 취소 버튼이 잠깁니다. 최종 완료·실패·취소가 표시되면 다음 실행을 시작할 수 있습니다.

요청 비교는 분석하지 못한 본문과 UNKNOWN metadata를 불확실한 상태로 남깁니다. 모든 Evidence 작업면의 선택·검토 메모·Request Lab 초안은 해당 프로젝트와 서버 Evidence에 묶입니다. 일시 snapshot 실패는 마지막 성공 데이터와 열린 초안을 유지하면서 새 선택·편집·전송을 잠그고, 실패 전에 시작한 전송은 취소하지 않아 서버 Evidence와 화면 결과가 갈리지 않게 합니다. 새 진단·프로젝트·샘플 전환은 현재 진단 저장이 성공해야 적용됩니다(D-147, D-151).

`http://127.0.0.1:17777/`와 `/app/`는 동일한 React 작업면을 제공하고 `/legacy/`는 전환 기간의 기존 작업면을 제공합니다. 첫 진입은 `API·입력 차이`이며, React가 분석기나 판정 상태 기계를 대체하지 않고 같은 localhost API snapshot을 표시합니다.

- **Burp 탭** — exact scope, 포트 분류, 실시간 수량, 새 진단 시작, Proxy history 가져오기, 로컬 SQLite DB 저장·연결/불러오기, JSON 내보내기, 샘플, 정본 로컬 Web 작업면 열기
- **Web 상단 탐색** — `분석 / 점검 / 기록` 세 그룹이 모든 현행 route를 제공하고, 범위·HUMAN·ZAP·SCANNER 상태는 같은 상단의 상태 popover에서 확인합니다. 기본 진입은 `API·입력 차이`이며 `#parameter-map` 옛 북마크는 통합 `#graph`로 이동합니다.
- **점검 Gap 그래프** — `#graph`의 첫 탭입니다. 서버가 만든 Gap(source/계정/조건/타입 미관측, 선언 미관측, 권한 변형 미검증)을 우선순위 사유 순 큐와 조건/사용자→API→입력→권한 대상 카드 경로로 보여 주고, 선택 상세에서 연결 근거·관측 프로파일·검증표·실제 Evidence·정의 근거를 확인한 뒤 대표 Evidence로 Request Lab을 엽니다. 둘째 탭 **전체 관계 보기**는 Site→API 그룹→API→Object 계층을 제공합니다. Gap은 점검 후보이며 취약점 판정이나 퍼센트가 아닙니다.
- 입력과 접근 대상의 단일 동시출현은 관계 근거일 뿐 확인된 인가 경계가 아닙니다. `CONFIRMED_AUTH_BOUNDARY`는 확정 소유자가 있는 리소스를 정확한 입력 값이 참조하거나, 공개된 독립 요청 2건에서 같은 리소스와 함께 관측된 경우에 사용하며(D-154), 그 외 연결은 사람 검토 대상으로 남깁니다.
- **API·입력 차이** — 선언과 실제 관측을 endpoint/parameter 단위로 대조하고 source별 Evidence ID와 provenance를 연다. 실제 관측 행의 **Evidence 상세**에서 Request Lab과 Burp Repeater 초안으로 바로 이어지며, 선언만 있고 요청이 없는 항목에는 전송 가능한 Evidence가 있는 것처럼 버튼을 만들지 않습니다. 분석한 HTML/OpenAPI/JavaScript 산출물 수와 부분·실패·상한 상태도 보여 주며, 블랙박스 전체 퍼센트나 취약점 판정은 만들지 않음
- **화면별 분석 제어** — 수집·메인 비교·기본 숨김·검토 대기 수량과 HUMAN/SCANNER/LLM, Evidence 처분·class, 역할 정책·3-way gap 필터는 각 작업면의 context panel에서 제공하며 전역 route 탐색과 섞지 않습니다.
- **인가 그래프** — 세 단계 계층으로 읽습니다. **Site Overview**는 Target→API 그룹(첫 안정 경로 세그먼트, 예 `ORDERS APIs`) 카드에 API 수·H/S/L Evidence 수·Gap·경로 후보 수를 표시하고, 그룹을 열면 **API View**가 신원→API를 suspicious·충돌·일부 관측·Evidence 수 순으로 18개씩 보여 주며, API를 열면 **Object View**가 신원→API→접근 대상 ID를 18개씩 보여 줍니다(`API/Object 18개 더 보기 (N개 남음)`, Back·개요로 접기). HUMAN 파랑·실선 / SCANNER 빨강·파선 / LLM 밝은 점선 overlay, 관측과 분리된 미요청 route 후보, 별도 인가 판정 view, 선택 신원·경로 focus+context, 미교차 후보 focus(GAP 목록), 화면 맞춤을 제공합니다. 900px 이하와 `API 목록 보기`는 같은 계층을 키보드 목록으로 제공합니다. 노드 판정은 선택한 서버 셀이 모두 같을 때만 표시하고, 여러 셀이 겹치면 상세에서 원본 셀을 각각 보여 줍니다. HTTP 상태는 관측 outcome일 뿐 인가 판정으로 승격하지 않으며 응답→요청 데이터 의존성은 `흐름 순서`에서 따로 표시합니다.
- **판정 매트릭스** — 기본 탭은 정책 P·실행 E·소유권 O를 합산하지 않고 나란히 두는 판정 매트릭스입니다. BFLA(역할 × 기능)·BOLA/IDOR(계정 × 객체)·실행 Evidence 보기에서 셀마다 기대(허용/차단/미정)→실제(성공/차단/갈림/해석 불가/미실행), P/E/O 등급, 상태를 보여 주며 상세에 추천 조합·유효성 gate·오라클·Evidence·사람 최종 판정을 둡니다. 상세에서는 객체 정책(소유자 전용·같은 역할 공유·인증 사용자 공유·공개·관리자 전용·미정)을 지정할 수 있고 기능/객체 중 하나라도 차단이면 BFLA/BOLA 차단 층을 표시합니다. 테넌트 축은 사용하지 않습니다. 후보 여부는 서버 권한 셀만 따르고 2xx만으로 승격하지 않습니다. 추천 상세에서 런 1회 승인을 체크하면 exact scope 안의 `ACTIVE` 대상 신원으로 `GET/HEAD`만 CONTROLLED 재전송하고, `POST/PUT/PATCH/DELETE`는 Burp Repeater 미전송 초안만 엽니다. 결과는 기존 판정기에 후보 근거로만 들어가며 사람이 확인하기 전에는 취약점으로 확정하지 않습니다. 둘째 탭 **파라미터 커버리지**는 서버의 입력×권한 대상×subject×source 검증 좌표를, 셋째 탭 **기존 권한 매트릭스**는 `identity/role × operation × resource` cell을 그대로 표시합니다.
- **라이브 교차 신원 재전송** — 런 1회 승인을 받은 동안 사용자가 선택한 HUMAN·ZAP·LLM 탐색 요청을 선택한 다른 `ACTIVE` 등록 계정과 선택적 비로그인 문맥으로 재전송합니다. HUMAN은 관측 트래픽, ZAP·LLM은 각자의 통제된 탐색 Evidence만 기준으로 허용하며 로그인·검증·재전송 결과를 다시 입력으로 사용하지 않아 반복 루프를 막습니다. 기준 요청의 계정은 자동 제외하며, 현재 프로세스에 원문 요청이 남아 있고 분류 결과가 `API/INCLUDE`인 새 Evidence만 사용합니다. `GET/HEAD`만 자동 전송하고 `POST/PUT/PATCH/DELETE`는 Repeater 초안만 생성합니다. 런당 대상 조합은 200건으로 제한하며 중지·프로젝트 전환·확장 unload 시 이후 전송을 차단합니다. 응답은 `SCANNER + AUTHORIZATION_REPLAY + CONTROLLED` Evidence로 기존 판정기에 들어갈 뿐 자동 확정되지 않습니다. UI는 별도 작업이며 API는 `start-live`의 `sources=HUMAN,ZAP,LLM`, `stop-live`, 상태 조회를 제공합니다.
- 판정 매트릭스의 계정·기능·접근 대상 조합은 서비스 경계 안에서만 생성합니다. 등록 계정은 `AccountProfile.service`, 익명·미등록 관측 신원은 실제 Evidence의 서비스 범위만 사용합니다. 등록 계정의 설정 서비스가 현재 관측·정책 작업과 하나도 맞지 않으면 계정을 조합에 섞지 않고 설정 확인 경고에 계정과 서비스를 표시합니다.
- **흐름 순서** — timestamp가 있는 관측에서 복원한 응답→요청 ID/token 의존성
- **시나리오** — 현재 결정론적 BOLA/BFLA 규칙 후보와 사람 검토. 이전 LLM 평가·판정은 별도 읽기 전용 기록
- **시나리오 감사·오버라이드** — Evidence-bound 상태와 마스킹 note를 갖는 사람 감사면. 자동 LLM 판정이 아님
- **Evidence** — 마스킹된 source, identity, method, 정규화 operation, resource, status, traffic class/disposition, repeat count, stable Evidence ID. 행을 선택하면 같은 operation의 마스킹 Request/Response와 payload 보존 상태를 200건씩 페이지로 확인합니다. live 원문은 사용자가 Request Lab을 열 때 해당 Evidence 하나만 메모리로 가져옵니다.
- **계정·세션** — 비밀값 없는 계정별 카드, `로그인 필요/확인 중/사용 가능/다시 로그인 필요` 행동 안내, 명시적 HUMAN 로그인 캡처, 접힌 내부 인증 단서와 고급 미연결 진단, 연결·해제, 재인증, 메모리 폐기, 계정 삭제
- **오른쪽 상세·요청 비교** — 선택 API의 source별 verdict, 필요할 때만 가져오는 마스킹 Request/Response, 전체 화면 요청 실험실과 Burp Repeater 초안을 제공합니다. Gap의 요청 비교는 사용자가 연 시점에만 `/api/evidence`에서 민감 경로·값을 제외한 구조 metadata와 비민감 값 SHA-256을 가져와 presence/shape/type/value 변화를 비교합니다. digest는 값 동일성 신호일 뿐 서버 사용·인가·취약점 증거가 아니며 main polling snapshot·프로젝트에는 들어가지 않습니다.

## 판정 규칙과 신뢰 경계

- 2xx status만으로 성공 접근을 확정하지 않습니다.
- 401/403, 로그인 redirect, soft-deny 응답 문구는 거부 Evidence로 취급합니다.
- OPTIONS/HEAD는 소유권 성공 Evidence에서 제외합니다.
- 확인된 타인 소유 객체에 대한 write 성공은 빈 body여도 고위험 BOLA 후보입니다.
- BFLA의 신원 역할은 명시 입력만 사용합니다. endpoint 요구 역할은 사람의 명시 P3가 우선하며, 대상 신원을 제외한 여러 신원의 일관된 성공/차단 분포가 있을 때만 P2 정책 확인 후보를 제안합니다. P2만으로 취약점을 확정하지 않고 경로나 token 문자열로 ADMIN을 추정하지 않습니다.
- 자동 owner 추출은 의도적으로 보수적입니다. 충돌하거나 신뢰도가 낮은 첫 접근자는 finding을 만들지 않습니다. 운영자는 Web 그래프 상세에서 owner를 확인할 수 있습니다.
- E2는 같은 좌표에 다른 신원 Evidence가 있다는 이유만으로 부여하지 않습니다. O2/O3 소유자 또는 요구 역할을 충족한 권한자의 성공 응답과 대상 응답이 모두 현재 계정에 귀속되고 관측 시각을 확인할 수 있으며, 대상 ID·JSON 구조·동적 필드를 정규화한 응답 길이가 일치할 때만 **비통제 관측 차등**으로 표시합니다. O1 첫 접근자, soft-deny, 의미가 다른 응답, 시각 미상 기준선은 E1로 남고 E3는 자동 부여하지 않습니다.
- JWT payload는 검증되지 않은 grouping hint이며 인증 증명이 아닙니다. 가능한 경우 identity를 service·issuer·audience·subject로 namespace합니다.

## 로컬 Web 경계

Web 서버는 `127.0.0.1`에만 bind하며 Host·Origin, 무작위 capability, 요청 크기와 CSP를 검사합니다. 확장 unload 때 종료됩니다. MCP endpoint는 없습니다.

## 데이터 처리

- 명시적 HUMAN 로그인 캡처와 Explorer 계정의 raw Authorization/Cookie/CSRF·ID·비밀번호는 각각의 메모리 전용 vault에만 존재합니다. ZAP 계정의 ID·비밀번호도 FlowScope에서는 메모리 vault에만 두지만, 로그인 구성 시 로컬 ZAP API의 `POST` body로 전달되며 ZAP 2.17은 Context를 임시 session DB에 기록합니다. 따라서 인증 lane은 FlowScope Docker의 1GiB tmpfs ZAP home과 tmpfs `/tmp`에서만 허용하고 container 종료 시 폐기합니다. Web snapshot·프로젝트·Evidence·FlowScope 로그에는 저장하지 않습니다. Java·HTTP library와 ZAP이 만드는 일시적 메모리 사본까지 물리적으로 지우는 hardware vault는 아닙니다.
- Authorization, Cookie, Set-Cookie, password, token, secret, API key는 Evidence 저장 전에 마스킹합니다.
- 인증 grouping은 subject 또는 짧은 단방향 fingerprint를 사용하며 raw opaque token은 보존하지 않습니다. Cookie 존재만으로 로그인 사용자를 확정하지 않습니다. 연결되지 않은 fingerprint는 감사·binding 후보로 남지만 broker exact match 또는 명시적 account binding 전에는 서비스별 `UNRESOLVED` graph identity 하나로 표시합니다.
- 트래픽 분류는 저장 Evidence를 삭제하지 않습니다. operation별 `include/exclude/auto` override도 응답 없음, unknown source, 비탐색 validation 트래픽을 discovery coverage로 만들 수 없습니다. 반복 관측은 화면에서만 접고 모든 Evidence ID·count·first/last timestamp를 유지합니다.
- body와 message preview는 필드별 8,192자입니다. 마스킹된 일반 textual 전문은 기본 1MiB, 발견용 HTML/JavaScript/JSON/XML 응답은 기본 4MiB, digest 중복 제거 후 압축 총량은 48MiB까지 보존하며, 실시간 수집은 20,000건에서 멈춥니다.
- SQLite 프로젝트와 JSON 내보내기는 마스킹되지만 application data가 남을 수 있습니다. POSIX에서는 owner read/write로 기록하며 engagement 데이터 정책에 따라 보호하십시오.
- SQLite 자동 저장과 JSON 내보내기는 임시 파일을 거쳐 저장하고 지원되는 경우 atomic replace를 사용합니다. SQLite는 현재 메모리 분석 상태의 내구성 snapshot이며 20,000건 live 상한을 없애는 서버용 event store는 아닙니다.

## 정직한 한계

- 현재 결과는 결정론적 규칙 후보와 사람 검토입니다. 자동 LLM 최종 판정은 없으며, 과거 verdict는 당시 기록으로만 표시합니다. 어느 쪽도 business impact의 자동 증명이나 보고서 검토의 대체물이 아닙니다.
- owner 추출은 일반적인 scalar owner/user/account 필드와 명시적 nested owner/user/author/account/customer principal object를 인식합니다. 도메인 고유 소유권은 운영자가 확인해야 합니다.
- 세션 자동화는 일반 cookie, bearer/CSRF header, 회전, 만료 hint, 의심 응답을 다룹니다. CAPTCHA, MFA, WebAuthn, device binding, 애플리케이션 고유 refresh/login protocol은 수동 재캡처가 필요할 수 있습니다.
- `ACTIVE`는 자격증명이 포함된 캡처에서 401·로그인 redirect·invalid-token이 아닌 HTTP 응답을 관측했다는 범용 transport 증거입니다. 서비스 고유 `/me` 의미나 계정 소유를 자동 증명하지 않으므로 실제 역할·계정 연결은 운영자가 확인해야 합니다.
- 안정 신호가 없는 opaque 회전 token은 자동 상관할 수 없습니다. 운영자가 확인된 fingerprint를 등록 계정에 명시적으로 연결할 수 있습니다.
- Fetch Metadata와 MIME은 없거나 잘못될 수 있고 business API가 document·asset·telemetry와 비슷할 수 있습니다. 분류기는 여러 고신뢰 신호가 합치할 때만 제외하고 애매한 요청을 메인 그래프 밖 `REVIEW`로 보존하며 이유와 reversible override를 제공합니다. `REVIEW`를 확인하지 않으면 실제 API가 메인 비교에서 빠질 수 있으므로 트래픽 노이즈를 완벽하게 분류한다고 주장하지 않습니다.
- 미요청 route는 보존된 마스킹 textual 응답(일반 기본 1MiB, 발견용 MIME 기본 4MiB; 전문 미보존 시 8,192자 preview)과 응답 없는 Burp Site Map 항목에서 최대 20,000개까지 추출합니다. JavaScript AST가 정적으로 확인한 문자열·template·단순 결합은 처리하지만 임의 wrapper 의미, 런타임 계산, 클라이언트 실행으로만 생기는 경로, 받지 않은 lazy chunk와 대상 밖 문서는 추측하지 않으므로 후보 목록도 전체 공격면이 아닙니다. 후보 우선순위는 공개된 범주형 근거이며 확률이나 취약성 점수가 아닙니다.
- 데이터 흐름은 제한된 exact-value matching이며 완전한 semantic taint analysis가 아닙니다.
- Repeater handoff는 메모리 원문 또는 마스킹 전문을 미전송 초안으로 엽니다. Web 요청 실험실의 명시적 전송은 HUMAN `VALIDATION` Evidence로 보존하며 탐색 완료나 자동 LLM verdict를 만들지 않습니다.
- 기존 agent workspace·MCP·브라우저/Judge 실행기는 제거된 상태입니다. 새 Explorer는 Codex app-server dynamic tool과 Java exact-scope gateway를 사용하며 별도 MCP나 브라우저를 다시 만들지 않습니다.
- source별 active run context와 정확한 run ID의 완료·취소 경계를 유지합니다. LLM run은 같은 run의 신뢰 가능한 응답 Evidence ID가 없으면 완료되지 않습니다.
- Explorer는 정적·응답 기반 frontier를 넓게 따라가지만 runtime에서만 로드되는 lazy chunk, CAPTCHA/MFA/WebAuthn, 서버 전용 endpoint와 임의 JavaScript wrapper를 완전 발견하지 못할 수 있습니다. POST의 업무 의미도 범용 블랙박스에서 완전히 판별할 수 없으므로 조회·검색 요청으로 제한하고 승인된 테스트 환경에서만 사용합니다.
- 그래프의 API 그룹은 경로의 첫 안정 세그먼트(`/api`, `/rest`, `/v1` 접두 제외)로 묶는 표시 단위이지 의미 기반 clustering이나 전체 API 추정이 아닙니다. API·접근 대상 ID의 18개 증분은 정렬 뒤 표시 제한이며 숨긴 항목의 Evidence는 선택·상세에 그대로 남습니다. 20,000건 수집 상한은 별도로 Burp를 보호합니다.
- Montoya `2026.7`에 맞춰 컴파일했습니다. 실제 engagement에서 사용하는 Burp 버전으로 release JAR을 확인해야 합니다.

## 라이브 교차 신원 재전송 설계 근거

- [Autorize](https://github.com/Quitten/Autorize/blob/master/README.md)의 관측 요청→저권한/비로그인 재전송과 다중 저권한 사용자 지원을 HUMAN 트래픽 fan-out의 기준으로 삼았습니다.
- [AuthMatrix](https://github.com/SecurityInnovation/AuthMatrix)의 사용자·역할·요청 조합과 응답 기반 성공/실패 규칙을 참고하되, FlowScope에서는 별도 판정기를 만들지 않고 기존 P/E/O 정책·Evidence 오라클을 사용합니다.
- [ZAP Access Control Testing](https://www.zaproxy.org/docs/desktop/addons/access-control-testing/)의 사용자별 Allowed/Denied/Unknown 기대와 scope 제한을 반영해 등록 계정 상태와 exact scope를 독립 게이트로 둡니다.
- Burp 계정 세션은 Autorize의 명시적 인증 헤더 교체와 AuthMatrix의 Repeater 기반 사용자별 쿠키·헤더 등록을 따라, 사용자가 확인한 요청을 등록 계정에 직접 결박합니다. Burp Montoya의 [CookieJar](https://portswigger.github.io/burp-extensions-montoya-api/javadoc/burp/api/montoya/http/sessions/CookieJar.html)는 사용자별 격리 저장소가 아닌 공유 jar이므로 계정별 재전송 자격의 정본으로 쓰지 않습니다. 토큰 문자열이나 응답 내용으로 계정 이름·역할을 자동 추론하지 않으며, ZAP의 [Authentication/Session Management/Verification](https://www.zaproxy.org/docs/getting-further/authentication/authentication-methods/) 분리와 마찬가지로 계정 결박과 세션 유효성은 별도 상태로 취급합니다. ZAP Browser Based Authentication은 [공식 browser auth 방식](https://www.zaproxy.org/docs/desktop/addons/authentication-helper/browser-auth/)으로 로그인하고 실제 성공 Evidence를 얻은 경우에만 같은 등록 계정의 메모리 세션을 갱신합니다.
- [AuthScope (CCS 2017)](https://acmccs.github.io/papers/p799-zuoA.pdf)의 인증 후 요청 필드 치환·응답 차등 관찰을 근거로 삼되, 상태코드 하나만으로 취약점을 확정하지 않습니다.
- [OWASP API1:2023 BOLA](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/)와 [OWASP API5:2023 BFLA](https://api-security.owasp.org/editions/2023/en/0xa5-broken-function-level-authorization/)에 따라 객체 소유 관계와 기능별 역할 요구를 별도 정책 축으로 유지합니다.

## Standalone 데모

```bash
mvn exec:java
mvn exec:java -Dexec.args="human.xml scanner.xml llm.xml"
```

Standalone은 패키지 React·로컬 HTTP·프로젝트 저장/재열기·XML 입력을 확인하는 데모 경로입니다. `-Dflowscope.projects.dir=/격리/경로`로 프로젝트 root를 별도 지정할 수 있습니다. Burp Montoya가 없으므로 HUMAN live capture, Request Lab 전송, ZAP 캠페인과 LLM Explorer 실행은 사용할 수 없으며 화면은 이를 명시적 `UNAVAILABLE` 상태로 표시합니다. 실제 점검 실행 검증에는 Burp에 release JAR을 로드해야 합니다.

## 라이선스와 보안

FlowScope는 MIT License를 사용합니다. fat JAR에 포함된 Cytoscape.js는 MIT, Jackson은 Apache-2.0이며 전체 고지는 `META-INF/`에 포함됩니다.

소유하거나 명시적으로 점검 허가를 받은 시스템에만 사용하십시오. 비공개 취약점 신고와 운영 안전 지침은 [`SECURITY.md`](SECURITY.md)를 참조하십시오.
