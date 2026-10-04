# 기능 상세

## 요약

- 사람(Burp), ZAP, LLM 탐색이 보낸 요청과 응답을 누가 보냈는지 구분해서 모읍니다. 점검 범위 밖의 요청은 저장하지 않습니다.
- `/orders/101`, `/orders/102`처럼 값만 다른 주소는 `/orders/{id}`라는 API 하나로 묶습니다.
- 실제로 오간 요청뿐 아니라 HTML, JavaScript, OpenAPI 문서에 적힌 API 주소도 찾습니다. JavaScript는 실행하지 않고 코드만 읽습니다. 이렇게 찾은 주소는 실제 요청이 오가기 전까지 후보로만 둡니다.
- 정적 파일이나 주기적인 상태 확인 요청처럼 점검과 상관없는 요청은 기본으로 숨깁니다. 애매한 요청은 지우지 않고 검토 대기로 따로 둡니다.
- 응답 내용, 데이터의 주인, 사람이 정한 역할을 보고 IDOR, BOLA, BFLA 후보를 고릅니다. 같은 기록이면 언제 돌려도 같은 결과가 나오는 규칙 방식입니다.
- 계정의 로그인 세션은 메모리에만 두고, 요청을 다른 계정으로 다시 보낼 때 씁니다.
- 프로젝트는 내 PC의 SQLite 파일로 저장합니다. 쿠키와 토큰 같은 값은 저장 전에 가립니다.
- 한계도 있습니다. 서비스 전체 API 수를 알 수 없어서 퍼센트는 보여 주지 않습니다. 실시간 수집은 20,000건에서 멈추고, 4MiB가 넘는 응답은 전체를 분석하지 않습니다.

처음 설치한다면 [README](../../README.md)부터 보세요.

## 자세한 내용

### 제품 목표와 완료 판단

> 허가된 exact scope에서 선언되거나 실제 관측된 API·입력을 구조화하고, HUMAN·SCANNER·LLM의 탐색 차이와 인가 후보를 원 Evidence까지 역추적 가능하게 만들어 진단자가 다음에 볼 위치를 줄인다.

FlowScope는 블랙박스 대상의 모든 endpoint·parameter·접근 대상 ID·상태를 발견하거나 오탐·미탐을 0으로 만든다고 보장하지 않습니다. `미관측`은 취약점이나 lane 실패 판정이 아니며, LLM의 설명만으로 취약점을 확정하지도 않습니다. 제품의 완성도는 개발 corpus와 분리된 블라인드 benchmark에서 endpoint·parameter·접근 대상 ID·분류·finding의 precision/recall, 사람의 `REVIEW` 작업량, false positive·false negative·unresolved를 함께 공개하는 방식으로 판단합니다.

```text
선언(OpenAPI·HTML·JS) ─┐
HUMAN·SCANNER·LLM 관측 ─┴─▶ Endpoint·Parameter Delta ─▶ 인가 상세
```

### 주요 기능

- 값 없는 범용 `EndpointKey(service, method, canonical path)`와 `ParameterKey(endpoint, location, fieldPath)`로 선언과 실제 관측을 분리하고 H/S/L source별 차이를 기본 작업목록에 표시. query, path, 중첩 JSON, form, multipart, GraphQL variables와 OpenAPI·HTML form·정적 JavaScript AST call-site를 처리하며 타깃명·업무명으로 분기하지 않음
- JavaScript는 실행하지 않고 Closure Compiler AST로 `fetch`, `XMLHttpRequest`, axios, jQuery, `sendBeacon`의 직접 확인 가능한 URL·method·query/body key와 정적/dynamic import 자산을 추출. 저장 전 비밀 리터럴을 JS 문법을 보존하며 가리고, lexical scope의 불변 literal·object member와 axios instance `baseURL`/요청별 override를 해석한다. 재할당·동적 값은 거짓 endpoint로 만들지 않고, Closure가 지원하지 않는 private class element 같은 구문은 `PARTIAL`로 표시한다
- JavaScript 분석은 별도 격리 JVM 하나를 최대 128개 입력에 순차 재사용하지만 Compiler·AST·Analyzer는 입력마다 새로 만든다. timeout·프로세스 종료·불완전 출력은 해당 입력의 실패로 기록하고 워커를 폐기하며, 다음 입력은 새 워커에서 계속한다. 프로젝트 교체·확장 종료 시 워커를 닫고 Evidence와 분석 결과의 의미는 바꾸지 않는다.
- Next.js pages-router의 공개 build manifest는 API를 추측하지 않고 client chunk 참조만 추가해 후속 JavaScript 분석 대상으로 연결. HTML `script`, `modulepreload`, script `preload/prefetch`는 Vue/Nuxt·Angular를 포함한 공통 자산 경로로 처리하며, GraphQL HTTP 관측은 operation과 variable field를 transport 필드와 분리
- source, source detail, orchestrator, tool, phase, run 정보를 독립적으로 보존하는 Burp 실시간 수집
- 모든 source에 대한 exact scope Evidence 수집. HUMAN은 Burp로 다른 사이트를 방문할 수 있지만 범위 밖 응답은 FlowScope에 저장하거나 그래프로 만들지 않음
- HUMAN/SCANNER/LLM 필터와 직교 edge를 지원하는 인가 그래프. React 화면은 사이트 개요(Target→API 그룹) → API 보기(신원→API) → 객체 보기(신원→API→접근 대상 ID) 세 단계로 내려가며, API·접근 대상 ID는 18개씩 `18개 더 보기 (N개 남음)`으로 늘립니다. 표시 노드는 서버 권한 셀과 Evidence ID를 그대로 들고 있어 Fact Core의 `Evidence × Identity × API × Resource × Source × Run × HTTP outcome` 관계를 삭제하거나 합치지 않습니다. 미교차 후보는 중립 점선 경로로만 표시하고 Evidence로 만들지 않습니다.
- 원본 URL은 보존하고, UUID/긴 16진 형식·성공 응답 ID 일치·같은 위치의 복수 값/독립 관측을 근거로 operation 경로를 자동 묶음. `LITERAL/INFERRED/CORROBORATED`와 이유를 상세에 표시
- `신원 × 작업 × 접근 대상 ID` 커버리지 매트릭스, 미교차 조합, 일부만 발견, source 간 판정 불일치
- 응답 분류, 명시적 소유자 Evidence, 사용자가 입력한 역할 정책을 이용하는 결정론적 BOLA/IDOR·BFLA 후보 엔진
- 비밀값을 저장하지 않는 테스트 계정 레지스트리와 명시적 메모리 전용 Session Broker. HUMAN 로그인 캡처, 성공 응답 확인 전 `UNVERIFIED`, 쿠키 회전, 만료·의심 상태와 HUMAN Request Lab 요청을 지원. Burp Proxy history·Repeater에서 운영자가 확인한 응답 있는 요청을 우클릭해 등록 계정의 독립 세션 슬롯으로 가져올 수 있어, 브라우저가 다음 계정으로 전환된 뒤에도 이전 계정 자격을 메모리에서 재사용한다. 같은 서비스의 동일 인증정보를 다른 계정으로 다시 연결하려 하면 자동 이동하지 않고 거부하며 기존 슬롯을 보존한다. ZAP 로그인 설정과 LLM 탐색의 브라우저 로그인 세션은 같은 등록 계정 ID에 결박할 수 있으며, ZAP의 원문 ID·비밀번호와 각 세션 값은 실행기의 메모리 vault에만 둔다. ZAP 로그인은 ZAP의 명시적 인증 성공 결과와 실제 인증 Evidence의 재사용 가능한 Cookie·Authorization·Set-Cookie가 모두 확인된 경우에만 해당 계정 Session Broker 슬롯으로 승격한다. 실패하면 ANON으로 대체하지 않고 해당 lane을 중단한다
- query, 요청 본문, 마스킹된 요청·응답, timestamp, redirect, GraphQL operation, 응답→요청 데이터 흐름 수집. 일반 textual 메시지는 기본 1MiB, route discovery가 읽는 HTML/JavaScript/JSON/XML 응답은 기본 4MiB까지 `FULL` payload로 보존하고, digest 중복 제거 후 압축 총량 48MiB를 적용합니다. 8,192자 `body/reqText/respText`는 UI 미리보기이며 분석기는 보존된 payload 전문을 우선 사용합니다. 발견용 4MiB 초과 응답은 metadata-only가 되어 전체 분석하지 않습니다.
- Evidence 보존형 트래픽 분류. `INCLUDE`만 메인 3-way 비교에 사용하고, 애매한 `REVIEW`는 별도 검토 대기로 보존하며, 고신뢰 보조 트래픽은 `EXCLUDE`로 기본 숨김
- classifier v8이 인증 준비를 source와 무관하게 `AUTH_SESSION/EXCLUDE`, 반복 polling을 `POLLING`으로 분리하고, web manifest·source map·service worker를 탐색 메타데이터로 분리한다. 중첩 경로의 `manifest.json`도 응답 본문이 PWA manifest 구조일 때만 메타데이터로 분리하며 이름만 같은 JSON API는 유지한다. 페이지 연결 외부 정적 파일은 API 관측에서 제외한다. API 문맥 없는 401/403 디렉터리 probe는 `REVIEW`로 보존하고, JSON/API 문맥·접근 대상·비안전 메서드 등 독립 근거가 있을 때만 메인 API로 포함한다.
- 공통 route discovery 파이프라인이 exact-scope HTML, 정적 JavaScript 호출, OpenAPI JSON/YAML, 표준 metadata, generic XML과 응답 없는 Burp Site Map 항목을 동일한 검증·정규화·dedup gate로 처리. 범위 안 페이지가 실제 참조한 외부 CDN JS는 출처가 확인된 HUMAN·Explorer 실행에서 보조 산출물로 수집해 페이지 기준 API 선언을 추출하고, Explorer는 그 JS의 정적 import·sourceMappingURL을 후속 청크·source map 목록으로 받습니다. 출처 미확정(`UNKNOWN`) 외부 파일은 보존량·후보를 늘리지 않으며, CDN 파일 자체도 API 관측·인가 판정으로 세지 않습니다. method 근거가 없으면 `UNKNOWN`이며 후보는 실제 요청·응답 전까지 coverage·gap·verdict·finding을 바꾸지 않음
- `ANONYMOUS / ACCOUNT_BOUND / UNRESOLVED` 인증 상태. 연결되지 않은 회전 쿠키가 그래프 신원을 폭증시키지 않으며, 확인된 계정 연결은 서비스 경계를 유지
- 시스템 소유 신원 격리 ZAP 기준선: 비로그인과 선택한 로그인 계정마다 이름 없는 임시 ZAP session과 exact-scope Context를 만듭니다. 모든 lane은 bundle의 FlowScope Docker 이미지가 제공하는 Chromium·동일 주 버전 ChromeDriver와 `chrome-headless` Client Spider로 실행하며, `zapHomePath`가 tmpfs `/run/flowscope-zap/` 아래가 아니면 시작 전에 차단합니다. 로그인 lane은 Chrome Headless Browser Based Authentication과 session auto-detect를 설정합니다. ZAP action의 `OK`나 HTTP 200만으로 성공 처리하지 않고, ZAP의 `authSuccessful=true`, 같은 run·계정의 차단되지 않은 실제 `ZAP_AUTHENTICATION` 응답, 독립 계정 Session Broker 연결이 모두 성공한 경우에만 계정 지정 Client Spider를 시작합니다. 하나라도 실패하면 `FAILED`로 종료하며 ANON으로 대체하지 않습니다. 선택적 exact-scope API 정의 import → 로그인 → `FLEXIBLE` Client Spider → 일반(Traditional) Spider → Passive 분석 → native Alert 수집 순서이며 AJAX/Active Scan/Fuzzer/Forced Browse는 실행하지 않습니다. 일반 Spider는 Client Spider와 같은 Context·계정(`scanAsUser`)으로, 응답 원문(HTML·헤더·robots.txt·sitemap.xml·JS 문자열)에서 찾은 범위 안 주소만 GET으로 따라갑니다. POST 폼 제출은 끄고 로그아웃·삭제 경로는 제외하며 깊이 5·최대 10분입니다. 일반 Spider 실패는 Client 결과를 지우지 않고 경고로 표시합니다. Client Spider는 ZAP Client Map에 새로 추가된 메뉴·버튼만 누르는데, headless ZAP은 세션을 바꿔도 Map을 비우지 않고 로그인 단계도 첫 화면을 먼저 열어 Map에 등록합니다. 그래서 로그인 검증 뒤 Client Spider 직전에 `start-zap.sh`가 등록한 스크립트로 Map을 비우고(로그인 세션은 유지), 이미 수집한 번들의 라우터 설정에서 찾은 화면 경로와, 상세 화면 템플릿(`/post?post_id=…`)에 목록 응답의 실제 ID를 채운 주소를 Client Spider 시작 주소로 등록합니다. 로그인·가입·계정 변경 화면은 폼 제출로 세션이 깨질 수 있어 제외합니다. ID는 그 엔티티의 응답에서만, 목록 항목 식별자만 뽑고 요청을 새로 보내지 않습니다. 비우기를 확인하지 못하면 경고를 남기고 Client Spider는 그대로 실행합니다. 상세 화면 ID는 목록 응답에 있고 그 응답은 Client Spider가 돌면서 처음 수집되므로, 1차 Client Spider 뒤 시작 주소를 다시 계산해 새 상세 주소가 생겼을 때만 그 주소로 후속 Client Spider를 더 돌립니다. 상세 화면이 또 다른 객체 ID를 보여 주면 다음 패스가 그 객체를 열며, 최대 3회(패스마다 10분)까지 반복한 뒤 일반 Spider로 넘어갑니다. 목록에 보인 객체는 상세 화면을 모두 엽니다(종류마다 최대 200개). ZAP Client Map은 쿼리 값을 구분하지 않아 같은 화면의 다른 ID를 한 노드로 합치므로, 쿼리 주소마다 서로 다른 fragment를 붙여 넘깁니다. fragment는 서버로 전송되지 않아 서버가 받는 요청은 바뀌지 않습니다. 후속 패스 실패·시간 초과는 앞선 결과를 지우지 않습니다. 외부 정적 파일은 브라우저 렌더링에 통과시키지만 외부 호스트를 크롤링하거나 토큰 없는 외부 응답을 신뢰된 ZAP Evidence로 저장하지 않습니다. Client 실패·범위 안 응답 0건·출처 capability 손상·격리 정리 실패를 성공으로 숨기지 않습니다.
- ZAP은 FlowScope Docker 경로 하나만 제공합니다. `zap-up` helper가 pinned ZAP 2.17 base 위에 Debian Chromium과 ChromeDriver를 함께 빌드하고 API key·Burp upstream·휘발성 작업공간을 구성합니다. 호스트에 Chrome·ChromeDriver·ZAP Desktop을 별도로 설치하거나 브라우저 버전을 맞출 필요가 없습니다.
- 목적별 Evidence 신뢰 정책과 exact-run 완료 gate. HUMAN은 관측/통제 응답, SCANNER는 통제 응답을 요구하며 완료 당시 Evidence ID를 보존합니다. 가져오기·직접 fallback을 새 run 완료로 승격하지 않습니다.
- 독립 LLM Explorer. Web에서 비로그인 또는 등록 계정을 고릅니다. 비로그인은 별도 격리 Chromium 창을 사용하고, 등록 계정은 사용자가 FlowScope Chromium 창에서 직접 로그인해 세션을 넘깁니다(비밀번호는 받지 않음). 로그인된 Codex는 그 창을 조작해 SPA가 실제로 보내는 요청을 관측하고, HTML·JavaScript·manifest·source map·API 정의와 응답 frontier를 순회합니다. 대상 요청은 모델의 직접 네트워크가 아니라 exact-scope HTTP 도구를 거쳐 Burp Montoya로 전송되고 실제 응답만 `CONTROLLED` LLM Observation Evidence가 됩니다. 산출물에서 직접 읽은 endpoint·parameter는 현재 run의 응답 Evidence ID가 있어야 별도 선언 도구로 저장되며, 서버가 의미 중복을 제거합니다. 큰 텍스트 응답은 run-scoped 마스킹 artifact의 검색·부분 읽기·JS index로 분석하며, 같은 파일의 Range 재수집을 지침에서 금지합니다. Explorer가 보낸 OPTIONS probe는 실제 기능 API 관측 수와 분리하되 일반 HUMAN/선언 OPTIONS API는 유지합니다. 작업 피드에는 경과시간·요청·Evidence ID·선언 수·probe·실패·미해결 사유가 표시되며 실행 중 추가 지시·취소를 지원하고, 모델 응답 뒤에도 같은 대화를 유지해 미해결 항목을 재탐색하며 사용자가 명시적으로 완료합니다. 취약점 verdict·심각도·확률은 만들지 않습니다.
- 기존 Burp Proxy history 원클릭 가져오기. 같은 동작에서 응답 없는 exact-scope Site Map 항목은 미요청 route 후보로 가져오고, 실제 반복 횟수를 보존해 중복을 억제. 네트워크를 사용하지 않는 온보딩 샘플은 사이드바 프로젝트 블록에 “샘플 데이터 · 실제 점검 결과 아님” 표시로 명시
- 스캐너 파일 업로드에서 ZAP이 내보낸 HAR 1.2 요청·응답을 SCANNER Evidence로 가져오기. HAR의 메서드·URL·query·header·body·status·timestamp를 기존 정규화 파이프라인에 넣되, HAR만으로 ZAP native Alert나 캠페인 완료를 만들지 않음
- 계정·세션 연결, 정책, 과거 읽기 전용 평가, 사람 감사 판정과 값·비밀정보 없는 실행 시도 결과를 관계형으로 보존하는 로컬 `.flowscope.db`. Burp에서 적용한 exact scope는 host 이름의 프로젝트로 `~/.flowscope/projects/<scope--시각>/project.flowscope.db`에 저장됩니다. 사이드바 맨 아래의 **프로젝트 관리**에서는 이름과 점검 대상 주소(exact scope)를 직접 입력해 새 프로젝트 만들기, 현재 프로젝트의 이름·점검 범위 수정(이미 모은 기록은 유지하고 이후 수집만 새 범위를 따름), 이전 프로젝트 열기, 현재 프로젝트의 트래픽 초기화, 프로젝트 삭제를 제공합니다. 열려 있는 프로젝트를 삭제하면 고른 다른 프로젝트로 먼저 전환한 뒤 지웁니다. HTTP 응답 Evidence와 응답 전 TLS·DNS·timeout·연결 실패는 분리되어, “새 API를 못 찾음”과 “요청 자체를 못 보냄”을 구분합니다. 변경은 30초 checkpoint로 합쳐 자동 저장하며, `.flowscope.json`은 호환 내보내기·가져오기로 유지
- path/query/JSON·XML·multipart·GraphQL에서 명시적으로 관측된 객체 참조를 모두 보존. 기존 인가 cell은 첫 번째 근거 있는 참조만 primary로 사용해 검증되지 않은 객체 Cartesian product를 만들지 않음
- `*Id`가 아닌 `customerNo`, `documentSeq`, `accountRef` 같은 도메인 식별자는 이름 하나로 확정하지 않고, 동일 서비스·메서드·경로·필드 위치에서 서로 다른 값이 반복 관측될 때만 `*_SEMANTIC_FIELD_CORROBORATED` 객체 근거로 보강. `pageNo`, `sortKey`, API key류는 제외
- 명시적 사람 검증을 위한 Web 요청 실험실. live Evidence의 HTTP 원문 바이트는 Burp 프로세스의 상한 있는 메모리에만 보관합니다. Content-Type 문자셋으로 엄격히 디코딩하고, 수정하지 않은 요청은 원래 바이트 그대로 재전송하며, 텍스트로 안전하게 해석할 수 없는 본문은 Web 편집 전송을 차단하고 Burp Repeater로 넘깁니다. Evidence generation과 전송 중 draft 잠금, 서버 operation ID 멱등성으로 늦은 응답·중복 상태 변경을 막으며, `원문 그대로/비로그인/등록 계정` 전송 결과는 discovery가 아닌 HUMAN `VALIDATION` Evidence입니다. 일시적인 snapshot 조회 실패에서는 미전송 편집을 메모리에 유지하고 전송·인증 변경만 잠그며, 같은 dataset의 조회가 복구되면 다시 활성화합니다.
- 긴 API 경로는 `/` 경계를 우선해 줄바꿈하고 단일 접근선의 의미 없는 `H×1` 라벨은 숨깁니다. 900px 이하 화면은 잘린 그래프 대신 같은 필터의 API 목록을 제공하며, 파싱 결과의 명시적 `상세 보기`는 선택한 Evidence ID를 그대로 엽니다. 관측 신원과 재사용 가능한 등록 계정 세션은 별도 개념으로 표시합니다.
- XXE 차단과 item 단위 오류 건너뛰기를 적용한 엄격한 Burp XML 가져오기, 크기·깊이·항목 단위 오류 경계를 둔 ZAP HAR 가져오기. 두 입력은 계정·세션 지문·run provenance가 다른 동일 HTTP를 합치지 않으며 같은 파일 재가져오기만 multiset 기준으로 억제합니다. XML base64 HTTP 본문은 명시된 Content-Type 문자셋을 따르고 XML/HAR의 IPv6 service는 대괄호 표기로 정규화합니다.

FlowScope는 블랙박스 공격면 전체를 알 수 없으므로 오해를 만드는 커버리지 퍼센트를 표시하지 않습니다.

일반 textual 메시지가 기본 1MiB를 넘거나, 발견용 HTML/JavaScript/JSON/XML 응답이 기본 4MiB를 넘거나, Content-Type상 바이너리이거나, digest 중복 제거 후 압축 전문 총량이 기본 48MiB를 넘으면 전문을 저장하지 않고 byte 수, 제한된 마스킹 표현·실제 크기·미보존 사유를 길이 구분한 SHA-256 식별자만 남깁니다. 이 값은 상한 초과 원문의 완전한 checksum으로 주장하지 않습니다. live 수집은 Burp 보호를 위해 20,000건에서 멈추며 초과 record 수와 전문 미보존 메시지 수를 Web UI에 표시합니다. 이는 무제한 수집을 보장하는 구조가 아닙니다.
