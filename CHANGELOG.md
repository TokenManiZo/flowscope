# 변경 이력

영문 변경 이력은 [`docs/en/CHANGELOG.md`](docs/en/CHANGELOG.md)에 보존합니다.

## 미출시 · 관측·선언 공통 parameter coordinate 통합 (슬라이스 1, D-143, 2026-09-11)

- 5단계(5b) 구조화 요청 비교: 우선순위 Gap 그래프의 선택 상세에 **요청 비교** 탭이 추가되어 같은 API의 실제 요청 둘을 값 원문 없이 입력별 존재·구조·타입·길이·보존 상태와 응답·판정 차이로 비교합니다. 잘리거나 파싱하지 못한 요청은 "없음"이 아니라 UNKNOWN으로 남고, 값 자체의 변경 여부는 digest를 노출하지 않으므로 UNKNOWN으로 표시합니다. 서버 snapshot의 endpoint에 요청 문맥(완전성·보존·discovery 여부)이 추가됩니다.
- 5단계(5a) 우선순위 Gap 그래프 화면: 새 작업면 **우선순위 Gap 그래프**(`#parameter-map`)가 서버 우선순위 순으로 열린 Gap을 큐로 보여 주고, 각 Gap을 조건/사용자 → API 엔드포인트 → 입력 파라미터 → 권한 대상 4단계 카드 경로로 그립니다(좁은 화면·캔버스 불가 시 같은 경로를 목록으로). 선택 상세에서 우선순위 사유, 입력→권한 대상 연결 근거, 관측 프로파일, 자기 값/타인 값/미인증/다른 역할 × H/S/L 검증표, 연결된 실제 Evidence와 정의 근거를 확인하고 Evidence 상세와 Request Lab으로 이어집니다. Gap은 점검 후보이지 취약점 판정이 아니며 퍼센트를 만들지 않습니다.
- 4단계 권한 대상 연결: 각 입력이 어떤 접근 대상(예: `orders:101`)에 연결되는지가 근거 등급(정확한 참조·독립 근거 2건·단일 동시출현·미상)과 함께 붙고, 소유자 자신·다른 소유자·미인증·다른 역할 × HUMAN/ZAP/LLM의 검증 좌표(`validationCells`)가 실제 Evidence 또는 근거만 있는 미검증으로 구분됩니다. 판정은 기존 인가 분석을 재사용하며 상태코드나 소유자만으로 허용을 만들지 않고, 미검증 좌표는 우선순위 후보(`AUTH_VARIANT_UNTESTED`)가 됩니다. Request Lab 전송 결과는 탐색 관측을 늘리지 않고 검증 좌표에만 연결됩니다.
- 3단계 파라미터 프로파일과 관측 차이 분석: 각 입력에 source·계정·역할·run·단계별 관측 수, 명시적 null과 "관측된 문맥에서의 부재" 구분, 타입 충돌을 담은 discovery 프로파일이 붙습니다. 같은 비교 조건에서 무엇이 빠졌는지를 Evidence와 함께 말하는 우선순위 후보(`parameterGaps`: source 누락·계정 누락·선언 미관측·선언 타입 변형 미관측·조건 조합 미관측)가 snapshot에 추가됩니다. 잘린 요청·파서 실패·VALIDATION/probe 요청은 누락의 증인이 되지 않고, 같은 Evidence ID의 상충하는 기록은 제외하고 진단으로 남깁니다. 화면 연결은 다음 단계입니다.
- 2단계 선언 의미 확장: OpenAPI 문서의 oneOf/anyOf 변형과 enum 선택지가 조건부 입력(`CONDITIONAL`, 값은 저장하지 않음)으로, 선언 타입·형태가 입력 근거와 함께 표시됩니다. 같은 이름의 path/operation 파라미터는 operation 정의가 우선하고, 외부·순환 `$ref`, 파일(binary) 필드, 인증·비밀 이름 필드는 입력 선언으로 만들지 않습니다. JavaScript의 `...spread`·`__proto__`·method 미해석 호출은 선언하지 않습니다.
- 1단계 결함 수정: JSON 값의 실제 타입(`"1"`은 문자열, `1`은 정수)을 보존하고 UUID·숫자형 문자열은 형식 신호로만 표시합니다. PATH 선언 위치는 실제 placeholder 위치만 허용합니다. JavaScript의 리터럴 `*` 키와 배열 원소를 구분합니다. 화면에서 표시 경로가 같은 입력(리터럴 `a.b`와 중첩 `a.b`)을 기계 좌표 줄로 구분해 보여 주고, 좌표 미확정 입력은 source 필터를 바꿔도 미확정으로 유지됩니다.
- 후속 수정: 화면의 입력 경로가 기계 좌표(`/segments/2`) 대신 사람이 읽는 경로(`orderId`, `filters.active`, `items[].id`)로 표시됩니다. 좌표를 확정할 수 없는 선언은 "선언 좌표 미확정 · 관측 비교 제외"로 구분되어 관측 비교·미관측 판단에 섞이지 않습니다.
- JavaScript 선언은 중첩 객체·배열 원소 구조를 그대로 보존해 실제 요청과 정렬됩니다(리터럴 점 키와 중첩을 구분). Explorer가 보낸 파라미터 선언은 저장 전에 공통 좌표로 검증·정규화되며, 빈 문자열 키 같은 유효한 좌표는 거부하지 않습니다.
- 파라미터별 distinct 값 집계에 상한(256)을 두어 장시간 진단에서 메모리가 무한히 늘지 않습니다.
- 실제 HTTP 관측과 OpenAPI·HTML·JavaScript 선언이 이제 **같은 좌표 규칙**으로 파라미터를 정렬합니다. 같은 논리 파라미터(예: 선언된 `orderId` 경로와 실제 요청 경로)가 하나의 입력 사실로 병합되어, 어느 입력을 아직 관측하지 못했는지가 더 정확히 드러납니다. 값은 여전히 저장하지 않고 형식·길이·소스만 남깁니다.
- 저장된 프로젝트를 다시 열어도 파라미터 좌표와 근거(Evidence)가 보존되며, SQLite 저장 형식은 바뀌지 않습니다(구버전 프로젝트 그대로 읽힘). 요청 원문·digest·미리보기·인증 정보는 화면 데이터로 노출되지 않습니다.
- 자동 회귀(`mvn clean verify`)와 프런트엔드 타입 검사를 통과했습니다. 실제 Burp/ZAP/Explorer 실행과 패키지 빌드는 다음 gate로 남습니다. 파라미터 프로파일·미관측(gap)·인가 타깃 연결·그래프 UI는 다음 슬라이스입니다.

## 미출시 · 데스크톱 내비게이션 라벨·Explorer 신원 계약 회귀 (2026-09-11)

- 데스크톱 분석 rail이 각 화면을 아이콘과 함께 한국어 라벨로 표시합니다(이전 아이콘 전용). 짧은 화면에서 마지막 메뉴가 잘리지 않도록 rail에 세로 스크롤을 두었습니다. 1280×600 실제 렌더 확인은 브라우저 gate입니다.
- Explorer 신원 경로(gateway→지문→`bindSession`→`Pipeline`→`ProjectStore`)의 구성요소 계약을 회귀로 고정했습니다. 실제 연결부(`executeExplorerRequest`)와 Burp Montoya 귀속은 운영 gate로 남습니다.

## 미출시 · 패키지 Standalone 프로젝트·현행 UI 계약 (D-142, 2026-09-11)

- 패키지 Standalone이 보존형 프로젝트 생성·저장·선택·재열기 API를 실제 SQLite workspace로 제공하며, 실행할 수 없는 Explorer 상태를 HTTP 500 대신 명시적으로 반환합니다.
- Playwright는 임시 project root를 사용해 폐기된 삭제형 초기화/Judge가 아닌 새 진단·독립 Explorer·현재 저장 상태 계약을 검사합니다. clean fat JAR Chromium E2E 8/8이 통과했습니다.
- 그래프 문서를 실제 단일 `IDENTITY / ENDPOINT / OBJECT` canvas와 `18개 / 전체` 표시 제한에 맞췄습니다. 사이트/API drill-down, resource family와 증분 `+18`은 아직 구현되지 않은 다음 작업입니다.
- JDK 21 전체 빌드 2회가 React 250 tests와 Java 407 tests를 통과했습니다. 실제 Burp 프로젝트 재열기·Explorer 계정 귀속·ZAP 로그인 복수 계정·Windows gate는 남아 있습니다.

## 미출시 · 보존형 진단 전환·Evidence 작업면·가져오기 무결성 (D-140~141, 2026-09-10)

- Web의 **새 진단 시작**은 기존 Evidence를 사용자 프로젝트 디렉터리의 SQLite DB에 먼저 저장하고 새 exact scope로 전환합니다. 저장 상태·마지막 성공 시각·오류와 이전 프로젝트 선택을 상단에서 확인하며 삭제형 초기화 API는 거부합니다.
- snapshot의 일반 분석 revision과 데이터셋 교체 revision을 분리해 polling 중 Request Lab 초안이 닫히지 않게 했습니다. API·입력 차이의 실제 관측에서 Evidence 상세·Request Lab·Burp Repeater로 바로 이동할 수 있습니다.
- 반복 import 병합은 HTTP 내용뿐 아니라 session fingerprint, lane account와 run을 보존합니다. XML과 HAR 모두 기존 multiplicity만 중복 억제합니다.
- Burp XML base64 HTTP는 명시 Content-Type charset을 strict decode하고, XML/HAR IPv6 service는 대괄호 한 쌍으로 정규화합니다. JDK 21 전체 빌드 2회와 자동 회귀는 통과했으며 실제 Burp 운영 gate는 남았습니다.

## 미출시 · Explorer Evidence-bound 산출물 선언 (D-139, 2026-09-09)

- Codex가 HTML·JavaScript·API 정의에서 찾은 endpoint·parameter를 자유서술 요약에만 남기지 않고, 같은 run의 실제 응답 Evidence ID가 필요한 `flowscope_record_discoveries` 동적 도구로 저장합니다.
- 저장 항목은 `LLM_ARTIFACT_ANALYSIS` RouteCandidate와 값 없는 parameter Declaration입니다. exact scope·허용 schema·상한·인증 header 금지와 의미 중복 제거를 적용하며 Observation·coverage·인가 판정·finding으로 승격하지 않습니다.
- 64KiB를 넘는 마스킹 응답은 최대 4MiB의 유효한 UTF-8 artifact로 한 번 전달하고 같은 URL의 Range/cache-buster 재수집을 지침에서 금지합니다. Explorer가 보낸 OPTIONS는 capability probe로 분리하되 일반 HUMAN OPTIONS와 산출물에 선언된 OPTIONS API는 유지합니다.
- React 작업 피드는 HTTP 시도·응답 Evidence·선언 endpoint/parameter·OPTIONS probe를 서버 계산값으로 표시합니다. 집중 자동 회귀와 실제 로그인된 Codex app-server의 HTTP→선언 opt-in 하네스는 통과했으며 실제 Burp 리얼 대상 완주는 별도 gate입니다.

## 미출시 · ZAP 일시 응답 지연 상태 보정 (D-138, 2026-09-09)

- ZAP API의 일반 통신 실패 한 번을 즉시 `UNREACHABLE`로 확정하던 상태 판정을 수정했습니다. 첫 두 번은 `RETRYING`, 세 번째 연속 실패부터 `UNREACHABLE`이며 성공하면 즉시 초기화합니다. API key 401/403은 첫 응답에서 `AUTH_FAILED`로 유지합니다.
- D-137 JAR을 실제 macOS Burp에 로드한 환경에서 ZAP 상태 10회 연속 성공과 새 비로그인 Client 캠페인의 59초 완료를 확인했습니다. SCANNER/Client 14건, Alert 29건, capability 거부 0건, Passive 잔여 0건이었습니다.
- 실제 Burp 로그인 2계정·실패 계정, Windows Docker Desktop, 최종 D-138 JAR의 `RETRYING` 화면 전이는 남은 gate입니다.

## 미출시 · ZAP 인증 snapshot 경합 수정 (D-137, 2026-09-09)

- 로그인 응답이 원시 저장소에는 들어왔지만 지연된 분석 snapshot에는 아직 없을 때 정상 계정 lane이 실패하던 경합을 수정했습니다.
- 인증 gate는 현재 run·계정의 원시 `ZAP_AUTHENTICATION` 응답만 동기화해 읽으며, 전체 그래프 재계산이나 고정 대기를 추가하지 않습니다.
- 빈 분석 snapshot 회귀와 별도 실물 ZAP 2.17/Chromium의 익명·정상 2계정·오류 비밀번호 차단을 재검증했습니다. 실제 Burp 재로드와 Windows 검증은 남았습니다.

## 미출시 · ZAP 인증 응답 Evidence gate (D-136, 2026-09-09)

- ZAP action인 계정 등록에 필수 로그인 성공 정규식과 선택적 로그아웃 정규식을 추가했습니다. 값은 ID·비밀번호와 함께 현재 프로세스 메모리에만 두며 ZAP Context indicator와 FlowScope 인증 응답 검증에 사용합니다.
- ZAP API action의 `OK`, `authSuccessful` 필드 유무, 인증 시각을 로그인 성공 증거로 쓰지 않습니다. 현재 run·계정의 실제 `ZAP_AUTHENTICATION` 응답 Evidence에서 마지막 성공 일치가 마지막 로그아웃 일치보다 뒤일 때만 account Client Spider를 시작합니다.
- 별도 실물 ZAP 2.17/Chromium 하네스에서 익명·정상 계정 2개의 Client 탐색과 오류 비밀번호의 Client 전 차단을 확인했습니다. 이 gate가 동작하므로 잠시 검토한 미출시 Authentication Helper 0.43.0 직접 build는 distribution에 포함하지 않습니다.
- 실제 Burp 최종 JAR 재로드와 Windows Docker Desktop은 아직 별도 gate입니다.

## 미출시 · FlowScope Docker Chromium ZAP 단일 경로 (D-135, 2026-09-09)

- PR #10은 병합하지 않고 로그인 URL·ID·비밀번호 입력 → ZAP Browser Based Authentication → 계정 지정 Client Spider → SCANNER Evidence 귀속 흐름을 현행 `ZapAccountVault`·`ZapCampaign`·React UI에 맞게 유지했습니다.
- distribution bundle에 digest 고정 ZAP 2.17 base를 사용하는 Dockerfile을 포함하고, Chromium과 같은 Debian 저장소의 ChromeDriver를 함께 설치합니다. macOS/Linux·Windows helper는 Compose 이미지를 자동 빌드합니다.
- 비로그인·로그인 lane 모두 `chrome-headless`를 명시합니다. 캠페인 시작 전 Chromium/driver 실행 가능 여부·주 버전 일치·실제 headless 기동과 tmpfs `zapHomePath`를 확인하며, 임의 ZAP Desktop/API runtime은 거부합니다.
- 실제 macOS arm64 Docker 컨테이너에서 Chromium/ChromeDriver `152.0.7977.82`, doctor 실패·경고 0건, exact Context의 Client Spider HTTP 200 1건과 status 100을 확인했습니다. beta.46 JAR의 Burp 재로드·로그인 계정·복수 계정·Windows 실기기 검증은 아직 남았습니다.

## 미출시 · ZAP 2.17 로그인 API 호환 (D-134, 2026-09-08)

- 실물 ZAP 2.17 REST에 존재하지 않아 로그인 lane을 `400 no_implementor`로 중단시키던 verification auto-detect action 호출을 제거했습니다.
- Browser Based Authentication, Auto-Detect Session Management, `authenticateAsUser=true`, strict Client의 범위 안 응답 gate는 유지합니다. 이 변경을 장시간 세션 만료 후 자동 재인증 보장으로 확대하지 않습니다.
- FakeZap도 존재하지 않는 verification API를 성공으로 모사하지 않도록 정정했습니다.

## 미출시 · 실물 ZAP Docker API 호환 (D-133, 2026-09-08)

- Docker publish를 거친 호스트 API 요청의 실제 출발점인 Compose bridge gateway를 기본 ZAP API allowlist에 정확히 추가했습니다. loopback·신뢰 host gateway·default bridge gateway 외 주소로 넓히지는 않습니다.
- ZAP 2.17이 action POST에서 허용하는 exact `application/x-www-form-urlencoded` Content-Type으로 고정했습니다.
- 별도 임시 8090 컨테이너에서 API 준비, tmpfs home/session, Client initiator Replacer 규칙의 session reset 후 유지와 영구 session 파일 0개를 확인했습니다. 실제 Burp 8081 대상 로그인·Client capture는 계속 별도 gate입니다.

## 미출시 · Client Spider 단일 ZAP 캠페인 (D-132, 2026-09-08)

- 새 ZAP 캠페인은 선택적 exact-scope 정의 import와 로그인 뒤 strict Client Spider 하나만 실행하고, 이어 Passive 분석과 native Alert를 수집합니다. Traditional/AJAX 실행·fallback과 관련 상태 필드를 제거했습니다.
- Client API·terminal 대기·capability가 실패하거나 범위 안 Client 응답이 0건이면 해당 lane을 실패 처리합니다. `client_captures`와 세션·로그인·Client·Passive·Alert 진행만 표시합니다.
- `spider`, `spiderAjax`를 필수 add-on/doctor에서 제외하고 capability initiator를 인증·정의 import·Client에 한정했습니다. 과거 `ZAP_SPIDER`·`ZAP_AJAX_SPIDER` Evidence enum은 읽기 호환을 위해 유지합니다.
- PR #10은 병합하지 않고 로그인 URL·ID·비밀번호를 작업면에서 받는 UX만 참고했습니다. 이 항목의 당시 Firefox 고정은 D-135의 FlowScope Docker Chromium 단일 경로가 대체합니다.
- 관련 mock·React 계약은 확인했지만 실제 Burp 8081 + ZAP 2.17의 비로그인·로그인 Client 완주는 아직 별도 gate입니다.

## 미출시 · ZAP 직접 브라우저 인증 계정 lane (D-130, 2026-09-08)

- HUMAN/Request Lab의 Session Broker와 ZAP 로그인 계정을 분리했습니다. ZAP 계정 ID·비밀번호는 현재 Burp 프로세스 메모리에만 두며 project·snapshot·Evidence·로그·LLM으로 내보내지 않습니다.
- 계정마다 새 ZAP session/Context/user를 만들고 Browser Based Authentication의 명시적 성공 뒤 Client Spider 계정 실행을 시작합니다. D-132에 따라 Traditional/AJAX는 실행하지 않습니다. 성공·실패·취소 때 임시 ZAP user와 Context를 제거합니다.
- 직접 인증 lane의 Cookie/Authorization을 Burp가 broker 값으로 덮어쓰지 않으며, valid campaign capability와 명시적 인증 성공이 있는 `laneAccountId`만 SCANNER Evidence 신원으로 사용합니다.
- capability는 ZAP campaign의 인증·정의 import·Client initiator에만 붙입니다. 로그인 교환은 별도 `ZAP_AUTHENTICATION / SESSION_SETUP`으로 보존하고 scanner 발견 건수와 완료 gate에서는 제외합니다.
- React ZAP 화면에 target별 로그인 계정, 인증 상태·브라우저·실행 경과를 추가하고 React 전환에서 빠졌던 API 정의 입력과 캠페인 취소를 복구했습니다. `authhelper`는 필수 ZAP add-on입니다.
- 집중 자동 회귀와 공식 ZAP 2.17.0 컨테이너의 Firefox/add-on 존재는 확인했습니다. Burp scanner listener 8081이 닫혀 실제 대상 로그인·capture·복수 계정 격리는 아직 검증하지 않았습니다.

## 미출시 · 다운로드 배포와 기능별 점검 (D-129, 2026-09-08)

- 다운로드 사용자가 저장소를 clone하지 않아도 되도록 Burp JAR, ZAP Compose/helper, OS별 doctor와 현재 문서를 `flowscope-1.2.0-beta.45-bundle.zip`으로 함께 만듭니다.
- doctor를 `human`, `zap`, `explorer`, `full` 모드로 나눠 선택하지 않은 외부 도구가 실패 원인이 되지 않게 했습니다.
- Explorer가 READY가 아니면 영향 범위와 공식 Codex 설치·로그인 절차를 보여 주고, 설치 후 15초 cache를 기다리지 않는 **다시 확인** 동작을 추가했습니다.

## 미출시 · 독립 LLM Explorer (D-128, 2026-09-07)

- Judge와 MCP 서버를 복원하지 않고 로그인된 로컬 Codex app-server의 dynamic HTTP tool을 사용하는 독립 Explorer를 추가했습니다.
- Web에서 비로그인 또는 메모리 전용 HTML form/JSON API 계정을 선택하고, 실행 상태·경과시간·실제 요청/Evidence·미해결 사유를 확인하며 steer·취소할 수 있습니다.
- 모델의 직접 대상 네트워크와 raw 인증정보 접근을 막고 Java exact-scope gateway가 method/header/중복/요청 예산을 검사한 뒤 Burp Montoya로 전송합니다. 실제 응답만 LLM `CONTROLLED` Evidence로 기록하고 로그인 준비 교환은 저장하지 않습니다.
- 큰 HTML/JavaScript/JSON/XML 응답의 발견용 분석 상한을 4MiB로 맞추고 1.4MiB JavaScript 회귀를 추가했습니다.
- Explorer는 endpoint·method·parameter·계정별 응답 차이를 수집할 뿐 취약점 verdict·Judge·LLM assessment를 만들지 않습니다. 실제 Burp 및 독립 corpus 효능은 아직 별도 gate입니다.

## 미출시 · 문서 전수 정합성 (D-127, 2026-09-07)

- 현재 인계와 과거 인계 본문을 분리하고 한·영 운영법, 개발 지침, 설계·계획·UI 설명의 폐기된 MCP/Judge/Active Scan 실행 안내를 정정했습니다. [문서별 점검 목록](docs/ko/documentation-status.md)을 제공합니다.
- JS parser 상한은 4,194,304자지만 live host record에서 8,192자로 재절단되는 미해결 연결 문제를 명시했습니다. 아래 beta.44의 “큰 SPA 번들 분석” 설명은 helper/parser 변경 범위이며 live 전 구간 지원이 확인됐다는 뜻이 아닙니다.
- 이번에는 코드·기능·JAR을 변경하거나 빌드/실환경 검증을 재실행하지 않았습니다. 이전 검증 수치와 연구 기록은 당시 artifact에 묶어 보존합니다.

## 미출시 · Judge·하네스 MCP 제거 완료 (D-126)

- Judge·Explorer 구독 CLI 실행기, 통제 브라우저, MCP 서버·토큰·도구, agent-workspace 설정과 프롬프트를 삭제했습니다. 관련 Web API는 404이며 연결·실행 버튼과 doctor의 CLI/MCP 검사도 제거했습니다.
- HUMAN·독립 ZAP 캠페인·Session Broker·요청 실험실과 H/S/L 관측 비교를 유지했습니다. ZAP 회귀는 MCP 서버 대신 캠페인 자체를 검사합니다.
- 이전 프로젝트의 LLM Evidence·실행 원장·평가·판정을 JSON/SQLite에서 보존합니다. 과거 평가는 React의 읽기 전용 이력으로 분리하고 현재 규칙 후보·사람 검토에 자동 판정으로 합치지 않습니다.
- 새로운 Explorer 하네스와 FlowScope Evidence용 MCP는 아직 구현하지 않았습니다. Client-only 전환도 이번 변경에 포함하지 않았습니다.
- 검증 수치는 `docs/ko/beta-validation.md`의 D-126 산출물 기록을 따릅니다. 실물 Burp/ZAP 완료를 주장하지 않습니다.

## 이전 단계 · Judge·MCP 제거 1단계

- ZAP 캠페인을 `McpServer`에서 `ZapCampaign`으로 분리했습니다. 웹 스캐너의 시작·상태·취소는 호스트가 소유한 캠페인을 직접 호출하고, MCP 포트 bind 실패가 캠페인 생성을 막지 않습니다.
- 기존 MCP ZAP 도구는 같은 캠페인에 위임합니다. 기존 crawler 순서, 계정·scope·capability 경계, 상태 JSON과 프로젝트 저장 형식은 유지합니다. Judge·MCP 삭제와 Client Spider 필수 전환은 후속 단계입니다.

## 1.2.0-beta.44 — 2026-09-03

- 큰 SPA 번들에서 route를 찾습니다. 보존 상한(1MB)은 그대로 두고 JavaScript·JSON·HTML·XML 응답의 **분석문만** 4MB까지 읽습니다. 초과 응답은 여전히 전문 미보존으로 표시됩니다. 실측한 1.66MB 번들은 경로 문자열이 전부 1MB 뒤에 있어 이전에는 하나도 보이지 않았습니다.
- CSS·폰트·이미지는 LLM 실행 값에서 빠집니다. 완료를 막지도, 요청 예산을 쓰지도 않습니다. JavaScript와 source map은 endpoint 선언을 담으므로 그대로 남습니다.
- 익명 실행에서 계정 인자 모순을 없앴습니다. 프롬프트가 `account_id`를 보내지 말라고 안내하고, 서버는 익명 표식을 거부하지 않으며 거부 시 현재 계정을 알려 줍니다.
- 통제 요청 `target`은 절대 URL만 받습니다. 스키마에 계약을 설명하고, route 후보가 바로 쓸 수 있는 `pending_targets`(service + 경로)를 함께 주며, 상대 경로는 범위 차단이 아니라 안내가 담긴 형식 오류로 거부됩니다. 실제 Explorer가 경로만 넣어 `SCOPE_BLOCKED`로 실패하던 원인입니다.
- LLM 작업 피드가 도구 호출의 실제 결과를 보여 줍니다. 실패한 호출은 `FAILED`와 사유로 남고(이전에는 이벤트 종류만 보고 전부 완료로 표시), 도구 이름은 `대상 읽기 · GET https://…`처럼 한국어 행동명과 method·URL로, 각 항목에 실행 시작 기준 경과와 호출 소요 시간이 붙습니다. 헤더·본문·계정·결과 전문은 여전히 표시하지 않습니다. 런처가 모델에게 운영자용 메시지를 한국어로 쓰도록 지시하고, React 실행 화면이 이 피드를 목록으로 그립니다.
- 통제 실행기가 원본 레코드의 Evidence ID를 확정해 돌려주도록 고쳤습니다. 이전에는 격리 분석 복사본에만 ID가 붙어 응답을 받은 LLM 요청이 실행 원장에 `INVALID_REQUEST`로 적혔고, 그 때문에 응답 Evidence가 있는 Explorer도 `end_run`을 닫지 못했습니다. 완료 거부는 이제 응답 Evidence가 없을 때만 `ALL_FAILED`로 판단합니다.
- React 분석 작업면을 최신 beta.44 코어 위에 통합했습니다. `/`와 `/app/`는 React, `/legacy/`는 기존 UI이며 첫 화면은 `API·입력 차이`입니다.
- React가 endpoint·parameter Surface와 실행 실패 원장을 표시하고 H/S/L source 필터, 파싱 실패·provenance·시도/응답/실패를 유지합니다.
- 동일 identity/resource/source의 서로 다른 operation edge 병합, 집계 노드 첫 verdict 오표시, route 후보의 source/identity 필터 무시를 수정했습니다.
- bounded snapshot이 cluster 전체 Evidence ID 배열을 생략해도 그래프가 중단되지 않고 대표 Evidence ID로 선택을 유지합니다.
- 실행 단계 번호를 완료 퍼센트로 표시하지 않고 Dashboard의 누락된 LLM lane을 복구했습니다. Evidence 선택 시 사용하지 않는 operation 원문 묶음을 선조회하지 않습니다.
- 소스 빌드를 JDK 21·Maven 3.9.x로 강제하고 결정적 MR-JAR writer·source→target 전수 검사를 복구했습니다. 미래 Closure versioned class도 같은 shaded namespace로 이동합니다.
- LLM 통제 HTTP 요청의 응답 전 실패를 Evidence와 분리한 bounded 실행 원장으로 기록합니다. TLS·DNS·timeout·연결·무응답·범위 차단·승인 거부를 typed outcome으로 구분하며 query·header·body·raw 예외문은 저장하지 않습니다.
- 실행 전, 전부 실패, 일부 실패, HTTP 응답 수신을 서로 다르게 표시합니다. 전부 실패한 Explorer는 완료할 수 없고 일부 실패는 완료 limitation으로 남습니다.
- LLM 실행 상태와 기본 API·입력 차이 화면에서 시도·응답·실패 수를 보여 주며 실패 요청을 그래프 Evidence로 만들지 않습니다.
- 프로젝트 저장 계약을 JSON v4·SQLite v3으로 올려 실행 원장을 저장·재열기합니다. 실제 Burp의 TLS/DNS 예외 분류 수동 gate는 아직 남아 있습니다.
- React 통합을 포함한 고정 최종 입력에서 JDK 21.0.12·Maven 3.9.16 `mvn clean verify`를 두 번 실행해 매회 React 265 tests와 Java 374 tests가 통과했고 두 beta.44 JAR이 byte-for-byte 일치했습니다. 이 해시는 임의 JDK·운영체제의 결과를 뜻하지 않으며 실제 Burp runtime gate는 남아 있습니다.

## 1.2.0-beta.43 — 2026-09-03

- JavaScript lexical scope의 불변 object member와 axios instance `baseURL`/요청별 override를 해석해 이전의 누락과 잘못된 상대 endpoint를 수정했습니다.
- shadowed binding과 재할당된 URL/property, 동적 axios baseURL은 초기값으로 추측하지 않습니다. 동적 URL·member·baseURL·함수 반환·제한된 HTTP-like wrapper 미지원은 산출물 Evidence와 line에 연결된 typed resolution issue로 표시합니다.
- 기본 `API·입력 차이` 화면은 Surface와 source 제어에 집중하고, 인가용 제어는 인가 화면에서만 표시합니다. 내부 Resource 모델은 유지하면서 사용자 용어를 `접근 대상 ID`로 정리했습니다.
- 전체 `mvn clean verify`를 두 번 실행해 매회 349 tests가 통과했고 두 beta.43 JAR의 SHA-256이 일치했습니다. standalone no-cache 화면 전환도 warning/error 없이 확인했으며 실제 Burp와 외부 일반화 성능은 아직 검증하지 않았습니다.

## 1.2.0-beta.42 — 2026-09-03

- JavaScript route/parameter declaration을 정규식에서 실행 없는 Closure Compiler `ECMASCRIPT_NEXT` AST call-site 분석으로 교체했습니다. `fetch`, 실제 XHR binding, axios, jQuery, `sendBeacon`, 정적/dynamic import와 문자열·template·단순 결합을 bounded하게 처리합니다.
- HTML navigation·script asset을 API surface에서 제외하고, client asset은 별도 route inventory로 유지했습니다. HTML modulepreload/preload/prefetch와 Next.js pages-router build manifest의 chunk 참조를 후속 JavaScript 분석 대상으로 연결합니다.
- GraphQL 관측을 operation별 endpoint와 variable field로 분리하고 transport의 `query`·`operationName`은 parameter surface에서 제외했습니다.
- `surface.extractions`와 Web `API·입력 차이` 화면에 HTML/OpenAPI/JavaScript 산출물의 정상·부분·실패·입력/AST 상한을 Evidence와 함께 표시합니다.
- 개발 단위 입력과 분리된 held-out truth fixture에서 endpoint 7개, parameter 18개, client asset 5개의 exact set과 임의 application wrapper 비지원을 회귀로 고정했습니다. 이 결과는 외부 일반화 성능이나 취약점 탐지 우월성 증거가 아닙니다.
- Closure Compiler를 fat JAR 내부 namespace로 relocation하고 원 LICENSE·NOTICE·third-party notice를 배포물에 보존합니다.
- 최종 `mvn clean verify`를 두 번 실행해 각각 340 tests가 통과했고, 두 beta.42 JAR의 SHA-256 `c8f53c170058a4803730e2419660ff77e21603ad9506f0156c54951623651a58`이 일치했습니다. standalone source filter·인가 화면 전환도 browser warning/error 없이 확인했으며 실제 Burp·외부 pilot 결과는 아닙니다.
- 승인된 외부 pilot과 그 결과에 따른 지원 Tier 확정은 아직 수행하지 않았습니다.

## 1.2.0-beta.41 — 2026-09-03

- 값 없는 `EndpointKey`·`ParameterKey` fact로 실제 H/S/L 관측과 OpenAPI·HTML form·정적 JavaScript 선언을 분리하는 범용 Surface Analyzer를 추가했습니다.
- query, canonical path 위치, 중첩 JSON, form-urlencoded, multipart 입력을 값 대신 field path·shape·source/run/identity/status/Evidence ID로 보존합니다.
- Web 기본 작업면을 `놓친 API·입력`으로 바꿔 endpoint/parameter별 source delta와 provenance를 먼저 보여 줍니다. 미관측은 취약점이나 lane 실패가 아닙니다.
- 기존 Resource/owner/BOLA·BFLA 그래프와 매트릭스는 `인가 그래프` 상세층에 그대로 유지했습니다.
- Standalone도 입력 Evidence에서 route candidate와 surface를 재생성합니다.
- 같은 JavaScript 요청 호출식 안의 literal body key만 연결해 뒤의 무관한 객체 key 오귀속을 막고, 동일 snapshot revision의 surface projection을 재사용합니다.
- 타깃 host·업무명·프레임워크 이름 분기는 추가하지 않았으며, 동적 JavaScript·lazy chunk·서버 전용 표면과 실제 precision/recall은 미검증 한계로 남겼습니다.
- 최종 자동 회귀와 재현 JAR 수치는 `docs/ko/beta-validation.md`의 beta.41 gate를 따릅니다.

## 1.2.0-beta.40 — 2026-09-02

- Explorer route를 표시·분석용 template과 실제 실행용 concrete path로 분리했습니다. `/orders/42`, `/orders/77`을 `/orders/{id}` 한 항목으로 정렬하면서 실제 관측값과 query는 보존하고, 인증성 query는 저장하지 않습니다.
- 안전한 concrete GET/HEAD/OPTIONS/UNKNOWN 경로가 남아 있으면 INDEPENDENT→ASSISTED 전환과 run 종료를 거부합니다. 값이 없는 OpenAPI template에는 임의 ID를 만들지 않고 한계로 남깁니다.
- Explorer prompt를 범위 고정, 첫 Evidence, 독립 인벤토리, route 분류, 저영향 probe, BOLA/IDOR, BFLA, workflow, Evidence/control, blind assisted·한계 보고의 10단계로 정리했습니다. 서버가 pending concrete path, 검토 차원과 다음 행동을 구조화해 일부 단계 생략을 줄입니다.
- HTML script 신호가 있으면 설치 브라우저를 조건부 discovery 보조로 권고합니다. 브라우저 출력은 Evidence가 아니며 controlled HTTP executor로 재현해야 합니다. 권고된 rendered discovery를 사용하지 못한 완료와 실제 값 없는 동적 template은 `PARTIAL_WITH_LIMITATIONS`로 표시합니다.
- 대상 응답·DOM·tool output을 명령이 아닌 불신 데이터로 취급하도록 Explorer 작업공간 지침을 보강했습니다.
- Codex/Claude 취소·확장 종료 시 알려진 하위 프로세스와 부모에 정상 종료 후 강제 종료를 순차 적용하고 실제 종료 여부를 확인합니다. 종료를 확인하지 못하면 `CANCELLED`로 가장하지 않고 실패로 표시합니다.
- 매 실행 새 포트의 실제 로컬 HTTP fixture로 HTML→외부 JavaScript→API/object route 연쇄 발견, exact-scope 제외와 POST 묵시 실행 금지를 검증합니다. 실제 Burp+provider endpoint recall과 취약점 정확도는 별도 실환경·블라인드 gate입니다.
- 전체 `mvn clean verify` 324 tests를 연속 두 번 통과했고 두 beta.40 JAR의 SHA-256이 일치했습니다.

## 1.2.0-beta.39 — 2026-09-01

- SYSTEM ZAP 요청의 run capability 누락을 계수해 상태 API/Web에 표시하고, crawler polling 중 발견하면 다음 crawler·신원 전에 명시적인 격리 실패로 종료합니다.
- 세션/Context 설정과 API 정의 import의 동기 응답 대기 동안 worker heartbeat를 유지하고, 화면에서 `응답 대기/응답 수신`과 실제 트래픽 변화를 분리합니다.
- ZAP SYSTEM 캠페인마다 exact-target Replacer capability를 발급해 일치하는 8081 요청만 현재 run/account의 CONTROLLED Evidence로 수집합니다. native Burp Scanner와 capability 없는 수동 요청은 캠페인 context를 상속하지 않으며 내부 header는 대상 전송 전에 제거됩니다.
- Traditional·Client·AJAX stop 뒤 terminal 상태를 확인하고 마지막 lane까지 cleanup합니다. Web/MCP 취소, executor 거부와 예상 밖 예외도 crawler·capability·run context를 정리해 `CANCELLED` 또는 `FAILED` terminal 상태를 남깁니다.
- 각 scanner Evidence에 lane account ID를 보존하고, AJAX scope/context, standalone Active/Spider Context, Passive 정체 판정, Alert 완결성·캠페인 전체 상한을 보강했습니다.
- ZAP API key를 URL/프로세스 인자 대신 header로 전송하고 Docker API 허용 주소의 무제한 기본값을 제거했습니다. 반복 HAR import, Web poll 일시 오류, Web/ZAP IPv6 bracket 경로도 수정했습니다.
- ZAP 기준선은 신원마다 Traditional·Client·AJAX를 모두 실행하고, 제한시간·실패 시 FlowScope가 시작한 crawler를 stop API로 정리합니다.
- Passive 분석을 고정 5분 실패에서 queue·현재 task 진행 기반의 최대 30분/무진행 10분 경계로 교체했습니다. 정체 시 이미 수집한 Evidence와 현재 Alert를 보존하고 부분 완료·남은 건수·Alert 집계 미완료를 명시합니다.
- 미처리 Passive queue와 current task를 정리하지 못하면 다음 로그인 신원을 실행하지 않아 비로그인·계정별 결과 혼합을 막습니다.
- Web에 `세션 / Traditional / Client / AJAX 보완 / Passive / Alert` 진행선, 실시간 단계 수집량, Passive 남은 건수·현재 task와 Alert snapshot 완결성을 추가했습니다. 단계 전환·queue 감소·Alert 집계·격리 정리 결과는 1초 갱신 실행 기록으로 표시합니다.
- API 문맥 없이 401/403만 반환한 ZAP 디렉터리 probe를 메인 API로 올리던 회귀를 수정했습니다. 해당 Evidence는 삭제하지 않고 `UNKNOWN/REVIEW`로 보존하며, JSON/API 문맥·객체·비안전 메서드 등 독립 근거가 있으면 기존처럼 API에 포함합니다.
- `/manifest.json`을 Content-Type이 부정확해도 web app manifest 경로 근거로 탐색 메타데이터에서 분리합니다.
- Explorer가 실제로 통제 응답을 받은 탐색·정적 route를 메인 coverage에서 제외했다는 이유로 미방문 처리하던 완료 gate 회귀를 수정했습니다. 방문 사실과 분석 자격을 별도로 판정합니다.
- 그래프 기본 화면을 사이트 집계에서 `신원 → API`로 복구하고, 사이트 개요는 선택형으로 유지했습니다. 사이트 소스 수는 요청 반복 수가 아닌 고유 API 수로 세며, 계층별 viewport를 분리했습니다.
- 새 분류·Explorer·Web·ZAP 격리·출처·blocking heartbeat 회귀를 포함한 전체 `mvn clean verify` 315 tests를 연속 두 번 통과했고 JAR SHA-256이 일치했습니다. 독립 Web 실행의 API↔사이트 전환·브라우저 오류 로그도 확인했습니다. 실제 Burp의 beta.39 재로드는 별도 gate입니다.

## 1.2.0-beta.38 — 2026-09-01

- 신원별 ZAP 캠페인 상태에 전체·lane·현재 단계 경과시간, 단계 제한시간, 마지막 ZAP heartbeat, 마지막 트래픽 변화와 상태 원문을 추가했습니다.
- 직렬 실행으로 아직 시작하지 않은 계정은 `PENDING`만 표시하지 않고 대기 순번과 현재 실행 lane 완료 후 시작한다는 이유를 표시합니다.
- ZAP API가 응답하지만 새 트래픽이 없는 상태, 10초 넘게 heartbeat가 없는 상태, 단계 제한시간 초과를 구분합니다. 이 표시는 관측 상태이며 취약점 판정이나 스캔 성공을 대신하지 않습니다.
- 현재 수집 건수는 단계 전환 시점의 고정값이 아니라 ZAP heartbeat가 갱신한 raw capture count로 표시하며, Web polling이 전체 Evidence를 중복 순회하지 않습니다.
- inline JavaScript parse와 전체 `mvn clean verify` 299 tests를 연속 두 번 통과했고 두 beta.38 JAR의 SHA-256이 일치했습니다. 실제 Burp 재로드와 장시간 AJAX→후속 계정 전환은 별도 gate입니다.

## 1.2.0-beta.37 — 2026-09-01

- Explorer run에서 선택한 계정을 통제 target tool의 `account_id`로 바꾸지 못하도록 서버에서 고정했습니다.
- 설치 Chrome browser worker를 선택형 8082 listener와 분리하고 CDP exact-scope·동일 service Session Broker 주입을 유지했습니다.
- CLICK/FILL selector 사전 승인을 실제 POST/PUT/PATCH/DELETE request 단위 Burp 승인으로 교체하고, 거부된 요청이 대상 서버에 도달하지 않는 실제 Chrome 회귀를 추가했습니다.
- SPA runtime network route를 `BROWSER_RUNTIME/evidence_backed=false` Explorer frontier로 등록해 controlled HTTP replay 전에는 완료할 수 없게 했습니다.
- coverage 관측을 Evidence ID에 연결된 `GraphObservationFact`로 투영해 identity·service·API·object·source·run·phase·HTTP outcome을 명시적으로 보존합니다.
- 그래프를 `사이트 → API 그룹`, `Identity → API`, 선택 API의 `Identity → API → Object`로 단계화하고 객체 패밀리를 기본으로 접어 인스턴스 폭증을 줄였습니다. path 기반 API 그룹은 표시용 근거일 뿐 판정 key가 아닙니다.
- inline JavaScript parse와 전체 `mvn clean verify` 299 tests를 연속 두 번 통과했습니다. 두 clean build의 beta.37 JAR SHA-256은 동일했습니다. 실제 Burp 재로드와 블라인드 endpoint/finding 효능은 별도 gate입니다.

## 1.2.0-beta.36 — 2026-09-01

- 별도 Playwright·Chrome MCP·ChromeDriver 없이 설치된 Chrome/Chromium/Edge를 JDK 21 CDP client로 실행하는 Explorer browser worker를 추가했습니다.
- run별 임시 profile, exact-scope CDP request 차단, 선택 account session의 대상 service 한정 주입, bounded DOM·링크·폼·SPA network 요약과 종료 시 profile 삭제를 구현했습니다.
- 브라우저 관측은 `DISCOVERY_ONLY`로 유지하고, 통제 HTTP executor로 재현된 응답만 Evidence·LLM lane 완료·Judge lock에 사용할 수 있게 신뢰 경계를 분리했습니다.
- SPA CLICK/FILL은 매번 Burp 승인을 요구하며 password/file input과 arbitrary JavaScript tool을 제공하지 않습니다.
- Explorer CLI의 성공·실패·취소·초기화 경로를 browser run cleanup과 묶어 실패한 실행이 격리 Chrome과 임시 profile을 남기지 않게 했습니다.
- 현재 URL·DOM target·network URL의 secret-bearing query는 browser 내부 이동에는 유지하되 MCP discovery 출력에서는 마스킹합니다.
- 로컬 설치 Chrome을 실제 실행하는 smoke와 MCP tool-surface/비Evidence 회귀를 추가했습니다. 실제 Burp HTTPS·broker session 통합과 블라인드 endpoint/취약점 성능 비교는 아직 별도 gate입니다.

## 1.2.0-beta.35 — 2026-09-01

- LLM Explorer가 own-run `INDEPENDENT` safe concrete route를 모두 요청한 뒤에만 다른 수집 레인의 route 문자열을 `ASSISTED` blind hint로 받을 수 있게 했습니다.
- ASSISTED hint에서 source, run ID, Evidence ID, adapter, provenance, 응답과 기존 관측 성공 여부를 제거해 독립 단계 결과를 오염시키지 않습니다.
- controlled response Evidence, 두 frontier 조회, 종료 시점 concrete GET/HEAD/OPTIONS/UNKNOWN route 0건을 Explorer 완료 gate로 강제했습니다.
- 동적 객체 route는 실제 관측값 없이는 자동 치환하지 않고, POST/PUT/PATCH/DELETE는 기존 명시 확인과 Burp 승인을 유지합니다.
- 자동 회귀 통과는 endpoint recall이나 취약점 탐지 성능 향상을 뜻하지 않습니다. SPA browser worker와 실제 허가 target 블라인드 비교는 아직 대기 중입니다.

## 1.2.0-beta.34 — 2026-08-31

- 반복 cluster의 Evidence ID 전체 목록을 매 event에 복제하지 않고 `/api/cluster-evidence` 200건 페이지로 분리해 snapshot의 제곱 크기 증가를 제거했습니다.
- 응답 값→후속 요청 DataFlow를 신원별 exact token index와 가장 가까운 이전 producer로 계산해 전체 producer/consumer 중첩 순회와 `123`→`1234` 부분문자열 오연결을 제거했습니다. index는 전역 최신 100,000개 값으로 제한합니다.
- live HTTP 메시지는 byte 크기를 먼저 확인하고, 1MiB 초과 시 최대 64KiB만 디코딩·마스킹합니다. raw vault도 요청 1MiB·응답 4MiB를 넘는 메시지의 전체 배열을 만들지 않고 크기 메타데이터만 받습니다.
- 상한 초과 메시지의 식별자는 마스킹된 제한 미리보기뿐 아니라 실제 byte 수와 보존 사유를 함께 해시해 같은 접두부의 서로 다른 대형 메시지가 하나로 합쳐지지 않게 했습니다.
- 프로젝트 payload 복원을 메시지당 1MiB·서로 다른 복원 전문 합계 48MiB로 제한하고, GZIP을 streaming 해제하면서 선언 크기 초과를 즉시 거부하며 digest별 복원 결과를 재사용합니다.
- metadata-only 프로젝트 payload에 압축 blob을 동봉하는 입력은 거부해 미집계 압축 데이터가 메모리에 남지 않게 했습니다.
- LLM assessment에 필드·Evidence 배열·1,000건·총 4MiB 제한을 적용하고 MCP 입력뿐 아니라 프로젝트 저장·복원에도 같은 검증을 적용했습니다.
- 20,000건 snapshot/DataFlow stress와 대용량 HTTP·GZIP·assessment 회귀를 추가했습니다. 자동 테스트 통과는 탐지 성능 향상을 뜻하지 않으며, 블라인드 benchmark는 계속 별도 gate입니다.

## 1.2.0-beta.33 — 2026-08-31

- Request Lab 초안에 generation과 immutable Evidence ID를 적용해 늦은 이전 응답이 현재 편집기를 덮지 않게 했습니다.
- 검증 전송 동안 편집·인증·계정·닫기·Repeater·재전송을 잠그고, 응답을 받지 못한 동일 draft는 같은 operation ID를 재사용하며, 서버 idempotency로 동일 상태변경 요청의 중복 실행을 차단했습니다.
- 분석 publication epoch를 추가해 초기화·정책 변경·새 validation 뒤 끝난 오래된 pipeline 결과가 최신 snapshot을 덮지 않게 했습니다.
- 서버가 실제 `UNCROSSED`로 산출한 exact 셀만 IDOR 교차 후보로 표시하고 일반 빈 셀은 중립 미검증으로 남깁니다.
- AuthProbe·BOLAZ·AuthScope·APICarv·RESTler·BOLA taxonomy 인용을 원문이 지지하는 범위로 교정했습니다. 성능 우월성은 계속 블라인드 평가 전 가설입니다.

## 1.2.0-beta.32 — 2026-08-31

- HUMAN·SCANNER·LLM 탐색 완료를 `LaneCompletionPolicy` 하나로 통합했습니다. 정상 완료는 활성 source·exact run ID·EXPLORATION·응답 Evidence·목적별 trust를 모두 요구하며 실패·취소는 완료가 아닌 abort로 처리합니다.
- `SourceTrustPolicy`를 추가해 8082 직접 fallback의 `UNVERIFIED_RUNTIME`을 원 Evidence로만 보존하고 coverage·Explorer 가시성·레인 완료·dataset lock·최종 판정에서 제외했습니다.
- 완료 시점 Evidence ID·응답 수·coverage 수를 exact `CompletedRun`으로 동결하고 dataset lock도 이 ID들로만 재구성합니다. 같은 run ID의 후발 record와 lock 뒤 live record가 Judge snapshot을 바꾸지 않습니다.
- JSON project schema v3와 SQLite storage schema v2에 exact completed run을 저장합니다. JSON v1/v2와 SQLite v1은 읽되 source-only legacy 완료 표식은 신뢰하지 않아 레인 재실행이 필요합니다.
- 무작위 run ID trust 대조, HUMAN/SCANNER/LLM 완료, 실패 abort, Evidence 동결, lock 불변성, JSON/SQLite 왕복·legacy 비승격 회귀를 추가했습니다.

## 1.2.0-beta.31 — 2026-08-31

- macOS/Linux/Windows의 표준 사용자 설치 경로와 `PATH`, `NVM_BIN`, `PNPM_HOME`, `BUN_INSTALL`, WinGet/npm 경로에서 Codex·Claude CLI를 자동 탐지
- `codex login status`와 `claude auth status --json`을 API key 없이 실행해 설치와 구독 로그인 상태를 분리하고, provider 계정 식별자나 원출력은 저장하지 않도록 변경
- 로그인 확인을 30초 캐시의 백그라운드 preflight로 실행하고 실제 Explorer/Judge 시작 직전에 다시 검증해 1초 Web polling과 실패 원인을 분리
- 준비된 provider 자동 선택, provider별 상태 badge와 수동 재확인 fallback을 추가하고 기존 MCP·격리 workspace·prompt 자동 구성을 유지

## 1.2.0-beta.30 — 2026-08-31

- Codex CLI 설치 여부와 구독 로그인 파일을 분리해 사전 확인하고, Claude 로그인은 실행 시 공급자 CLI가 판정한다는 상태를 Web에 명시
- Explorer/Judge 실행 중 공급자 JSONL을 bounded runtime event로 변환해 모델 메시지·MCP 도구 상태·Evidence 완료 gate를 약 1초 간격의 읽기 전용 작업 피드에 표시
- reasoning/thinking event, raw tool argument/result와 자격증명을 작업 피드에서 제외하고, 실제 주입 prompt는 secret masking·크기 상한 뒤 운영자가 확인하도록 추가
- 기존 API-key-free 실행, 임시 Codex home, 역할별 MCP allowlist와 exact-run Evidence 이중 gate를 유지

## 1.2.0-beta.29 — 2026-08-31

- Codex 구독 로그인만 owner-only 임시 `CODEX_HOME`에 연결하고 전역 config·skill·plugin·memory·이전 session은 상속하지 않도록 Explorer 실행 환경을 격리
- 첫 대상 호출을 exact entry target의 `flowscope_target_read(method=GET)`로 고정하고 응답에서 파생된 own-run route frontier만 순회하도록 하네스 보강
- MCP server의 0-Evidence 종료 거부에 더해 launcher가 exact run Evidence를 다시 검사하고, 비어 있으면 잘못 기록된 LLM 완료 표식까지 취소하는 이중 gate 추가
- 로컬 Codex 0.147.0 구독 실행에서 임시 home·strict config·ephemeral 조합 확인. 실제 Burp MCP 대상 탐색은 beta.29 JAR 재로드 뒤 별도 gate로 유지

## 1.2.0-beta.28 — 2026-08-30

- LLM 대상 GET·HEAD·OPTIONS를 비파괴 MCP 도구로 분리하고 POST·PUT·PATCH·DELETE는 기존 확인·Burp 승인 경계를 유지
- 응답 Evidence 0건인 Explorer 종료를 서버에서 거부해 취소·도구 실패 후 CLI exit 0이 LLM 완료로 기록되던 경로 차단
- Codex 실행별 user skill·plugin·외부 browser surface 비활성화를 시도했으나 실제 전역 skill 잔존이 beta.29에서 확인돼 임시 home 격리로 대체
- ZAP outgoing proxy가 FlowScope scanner listener를 가리키는지 대상 전송 전에 확인하고 `network` add-on을 필수화
- 명시적 exact-scope OpenAPI·GraphQL·Postman·SOAP 정의를 신원별 fresh Context에서 bounded import하고 단계별 성공 수·경고 표시

## 1.2.0-beta.27 — 2026-08-30

- 신원별 ZAP 기준선 시작 전에 안전 탐색·passive·OpenAPI·WebSocket add-on을 검사하고, 선택 target subtree 전용 Context와 passive engine·전체 규칙·scope-only 설정을 명시 적용
- Traditional·Client·AJAX Spider를 모두 독립 실행하고 rendered 단계 실패·0건을 조용한 fallback 대신 경고 완료로 표시
- native Alert를 500개 페이지로 전부 읽어 신원별 최대 20,000개 snapshot으로 보존하고 초과를 명시적으로 경고
- GUI로 실행한 Burp의 축소된 `PATH`에서도 구독 Codex/Claude 실행기의 런타임을 찾도록 해석된 CLI 디렉터리를 자식 프로세스 `PATH` 앞에 추가
- 기존 Session Broker의 계정별 메모리 인증 주입과 별도 Judge의 반복 재현·정상 대조 Evidence gate를 회귀로 재검증

## 1.2.0-beta.26 — 2026-08-30

- Web 스캐너 업로드가 Burp XML과 ZAP HAR 1.2를 구분해 받고 HAR 요청·응답을 SCANNER Evidence로 변환
- HAR의 URL·query·header·body·status·timestamp·base64 textual 응답을 보존하고 인증값 마스킹, exact scope, 문서·payload 상한, 항목 단위 오류 격리를 적용
- binary HAR 응답은 손실 문자열로 바꾸지 않고 metadata-only로 보존하며, HAR만으로 ZAP Alert나 캠페인 완료를 생성하지 않도록 신뢰 경계 고정
- HAR parser와 scanner-only Web API/UI 계약 회귀를 추가하고 beta.26 단일 JAR을 생성

## 1.2.0-beta.25 — 2026-08-29

- fat JAR 재구성을 일반 ZIP이 아닌 manifest-aware JAR 작업으로 바꿔 `JarInputStream`에서도 manifest를 즉시 읽도록 수정
- Jackson·jsoup·SnakeYAML의 MR-JAR relocation을 Java 버전 디렉터리별 하드코딩에서 임의 버전 경로 매핑으로 변경
- 완성 JAR의 streaming manifest, Main-Class, Java-Version, Multi-Release와 격리 class loading을 `mvn clean verify`의 필수 gate로 승격

## 1.2.0-beta.24 — 2026-08-29

- 응답 객체 오라클이 자원 타입에 맞는 `orderId`·`order_uuid`·`pk` 계열을 인식하고 중첩 자원의 최종 대상 ID만 증거로 사용하도록 보강
- soft-deny 문자열 검사를 최상위 오류 봉투 또는 제한된 비 JSON 오류 앞부분으로 좁혀 정상 데이터의 `not allowed` 문구 오탐 방지
- 응답 JSON 크기·깊이·token·순회 상한과 반복 순회를 적용해 과도한 응답이 판정기를 중단시키지 않도록 강화
- 같은 응답을 읽는 소유자·DataFlow 경로에도 크기·깊이·순회·fallback 상한을 적용해 후단의 재귀·정규식 병목 차단
- 지문 추출 실패를 실제 비인증과 분리하고 계정 연결을 거부하며 service 정규화, 미확정 권한의 Judge 제어계정 사용 거부, 바인딩 해제 재분석을 회귀로 고정
- 정책 맵의 교체·계정 갱신을 단일 잠금으로 원자화하고 Burp/Web/MCP/Standalone 게시 분석을 수집 DTO 및 정책 스냅샷과 격리
- cell/Evidence digest를 길이 접두 인코딩으로 바꾸고 LF/CRLF 본문 경계의 가장 이른 구분자를 사용

## 1.2.0-beta.23 — 2026-08-29

- Jackson 원 Apache NOTICE를 fat JAR에 병합하고 FastDoubleParser·Schubfach 포함 라이선스와 SnakeYAML 귀속을 정확히 고지
- Jackson·jsoup·SnakeYAML의 base 및 Java 9/11/17/21 MR-JAR 구현을 FlowScope 전용 패키지로 격리하고 sqlite-jdbc MR-JAR 구현 보존
- sqlite-jdbc를 독립 classloader 두 개에서 동시에 로드해 in-memory 연결·query가 함께 성공하는 회귀 추가
- `clean verify` 기본 lifecycle plugin 버전과 GitHub Actions를 고정 commit SHA로 pin
- CI의 단일 JAR 검사를 zero-match에 안전하게 바꾸고 NOTICE·라이선스·MR-JAR·패키지 누출·manifest·반복 SHA-256 검사 추가
- Bash helper 5개에 `bash -n`·ShellCheck CI를 추가하고 main push와 PR 검증을 분리, Dependabot update를 용도별 그룹화

## 1.2.0-beta.22 — 2026-08-28

- 빠른 시작을 `범위 → HUMAN → ZAP → LLM·Judge` 네 단계 진행 내비게이션으로 압축
- 서버 상태에서 첫 미완료 단계를 자동 선택하고 해당 단계의 제어만 표시
- 완료·경고·진행 상태는 유지하면서 사용자가 다른 단계 설정을 직접 열고 현재 단계로 복귀할 수 있게 함
- README 첫 실행을 처음 한 번 준비와 점검할 때마다 수행할 네 단계로 분리
- 390px 반응형 화면에서 단계 탭과 단일 panel의 가로 overflow가 없음을 확인

## 1.2.0-beta.21 — 2026-08-28

- ZAP Desktop과 Docker를 동일한 loopback API 계약으로 지원하고 Web 빠른 시작에 연결 상태·버전·key 오류·재확인 UI 추가
- 연결되지 않은 ZAP 캠페인을 실행 전에 차단하고 Desktop 설정과 선택형 Docker Quick Start를 같은 화면에 제공
- Desktop용 owner-only key를 값 출력 없이 준비하는 `zap-key.sh`, `zap-key.ps1` 추가
- Windows 10/11 + Docker Desktop Linux container + PowerShell 7용 `zap-up.ps1`, `zap-down.ps1`, `doctor.ps1` 추가
- .NET 암호학적 난수 key 생성, Windows ACL 상속 차단·현재 사용자 전용 권한, 변경 포트 진단 구현
- Docker key 전달을 OS 독립적인 Compose file-backed secret으로 전환
- GitHub `windows-latest` PowerShell parser CI와 한국어·영어 Windows 설치·문제 해결 문서 추가
- Windows 실기기 Docker/ZAP/Burp target capture는 완료로 과장하지 않고 후속 gate로 명시

## 1.2.0-beta.20 — 2026-08-28

- 완전한 3-way 요구사항과 HUMAN-only 제한 모드를 구분하고 Release JAR 사용자에게 Maven을 요구하던 설치 문구 수정
- 공식 ZAP 2.17.0 manifest digest, loopback API publish, Docker-host Burp `8081` upstream 설정·재검증을 포함한 선택형 Compose 추가
- macOS/Linux 한 명령 ZAP 시작·중지와 listener/ZAP/add-on/provider/Web/MCP 환경 점검 스크립트 추가
- owner-only 기본 ZAP key 파일 자동 탐색과 명시 key·환경·파일 우선순위, 링크·권한 검증 추가
- 한국어·영어 상세 설치/첫 실행/Windows 수동/문제 해결 가이드와 아키텍처·결정·인계 문서 정합성 갱신

## 1.2.0-beta.19 — 2026-08-28

- Cytoscape가 직접 조작하는 `#cy`의 inline style을 `!important`로 덮지 않고, 라이브러리 외부 `graphcanvas` 래퍼가 데스크톱/좁은 화면 전환을 소유하도록 수정
- 600px에서 캔버스가 실제로 숨고 동일 필터 API 목록만 남는 반응형 계약을 자동·브라우저 회귀로 고정

## 1.2.0-beta.18 — 2026-08-28

- live HTTP 원문을 Java `String`이 아닌 요청·응답 바이트와 body offset으로 bounded vault에 보존
- Content-Type의 명시적 charset 또는 UTF-8 기본값으로 텍스트 본문을 엄격히 디코딩하고, 손실 디코딩·바이너리 본문의 Web 편집 전송 차단
- 수정하지 않은 요청과 Burp Repeater 초안을 원래 바이트 그대로 구성하고, 편집한 텍스트 요청만 선언 문자셋으로 엄격히 재인코딩
- 긴 operation을 slash 경계로 줄바꿈하고 단일 접근선 라벨을 숨기며, 900px 이하에서 동일 필터의 API 목록 제공
- 파싱 결과에 Evidence별 `상세 보기`를 추가하고 선택 ID와 열린 요청·응답을 일치시킴
- 그래프의 관측 신원과 Session Broker의 재사용 등록 계정을 다른 개념으로 명시
- 전체 자동 회귀 221개와 1280px/600px 브라우저 UI 계약 검증

## 1.2.0-beta.17 — 2026-08-28

- live HTTP 원문을 RequestRecord·프로젝트·snapshot과 분리된 bounded Burp 프로세스 메모리 vault에 보관하고 데이터셋 교체·확장 종료 때 폐기
- 특정 Evidence의 요청·응답을 큰 Web 편집기에서 열어 `원문 그대로/비로그인/등록 계정` 모드로 명시 전송하는 요청 실험실 추가
- 편집 요청의 원 서비스·exact scope, redirect 금지, TLS 검증, timeout을 서버에서 강제하고 등록 계정은 ACTIVE broker 세션만 주입
- 요청 실험실 결과를 HUMAN `MANUAL_HTTP/VALIDATION/CONTROLLED` Evidence로 분리해 탐색 coverage·3-way gap을 부풀리지 않음
- Burp Repeater 미전송 handoff는 live 원문 우선, imported/상한 초과 Evidence는 마스킹 폴백으로 유지
- 저장 경계·상한·eviction·Web API/UI 계약 자동 회귀와 공식 Burp/ZAP/mitmproxy/OWASP 근거 문서화

## 1.2.0-beta.16 — 2026-08-28

- Proxy 외 Repeater·Intruder·Target 응답도 Montoya `messageId`로 요청 시점 HUMAN run/account/dataset epoch와 연결
- 상관 문맥이 없거나 초기화·샘플·프로젝트 교체 이전 요청이면 현재 pass로 추측하지 않고 제외
- 비-Proxy HUMAN 응답의 Set-Cookie 회전을 memory-only broker에 반영
- 하나의 계정에 연결된 Cookie·Authorization·subject 단서 수를 로그인 세션 수처럼 표시하지 않도록 계정 중심 화면 정리
- 전체 자동 회귀 211개 통과, 실제 beta.16 Burp 수동 gate는 별도 기록

## 1.2.0-beta.15 — 2026-08-28

- ZAP Client Spider가 API상 완료됐더라도 실제 Client rendered capture가 0이면 성공으로 간주하지 않고 AJAX Spider를 자동 실행
- Client/AJAX가 모두 rendered traffic 0건이면 Traditional 결과와 Alert는 보존하되 캠페인·신원 lane을 `COMPLETED_WITH_WARNINGS`로 표시
- 경고 완료 캠페인도 dataset lock 뒤에는 live ZAP 상태가 아니라 실행 시점의 마스킹 Alert snapshot만 Judge에 제공
- 실제 crAPI beta.14 점검에서 Client Spider의 Firefox binary 부재와 거짓 정상 완료를 재현하고, 동일 조건 회귀와 Web 경고 상태 계약 추가
- 전체 자동 회귀 207개 통과, 공개 beta.15 fat JAR 단일성·ZIP 무결성 확인

## 1.2.0-beta.14 — 2026-08-28

- ZAP 완료 gate가 최대 400ms 늦을 수 있는 분석 snapshot 대신 응답 시점 raw Burp capture를 직접 세도록 수정해 정상 scanner lane의 거짓 `0건 실패` 제거
- 비로그인·계정별 ZAP 상태에 Traditional Spider와 Client/AJAX rendered-browser 수집량을 분리하고 각 단계 전환을 실시간 상태로 노출
- 기존 whs_flow 작업면의 카드·색·간격 문법을 유지한 scanner lane 카드로 계정별 단계·수집·Alert·주의·실패 원인을 한눈에 표시
- stale snapshot, stage별 capture, 3-lane failure/completion, Web 상태 렌더 계약 회귀를 포함해 자동 테스트 206개 통과

## 1.2.0-beta.13 — 2026-08-28

- HUMAN 상태를 1초 주기 실행 상태 동기화에 포함하고, 수집 건수가 아니라 exact run 종료 표식으로만 `pass 완료` 표시
- HUMAN pass 중 Repeater·Intruder·Target 요청이 run/phase/account를 공유하면서 실제 Burp source detail과 tool provenance를 유지하도록 수정
- `customerNo`, `documentSeq`, `accountRef` 같은 비-`*Id` 식별자를 동일 서비스·메서드·경로·필드 위치의 복수 값 관측으로만 보강하는 범용 semantic object profiler 추가
- `pageNo`, `sortKey`, API/auth/token/session류와 단일 관측은 객체로 자동 승격하지 않는 회귀 추가
- `guid`, `valid`, `fluid`처럼 소문자 `id` 문자열로 끝나는 일반 단어를 명시적 `*Id`로 오인하던 기존 경계 판정 수정
- Human run 상태·provenance·semantic object 추출 회귀 및 로컬 Web 실제 상태 전이 검증 추가

## 1.2.0-beta.12 — 2026-08-27

- 같은 서비스의 동일 인증 지문을 다른 등록 계정으로 조용히 이동하지 않고 충돌로 차단하며, 충돌 세션을 `SUSPECT`로 고정해 신원 귀속·세션 주입에서 제외
- 계정 화면에 `동일 인증정보 충돌`과 재로그인 조치를 표시하고 broker 상태 JSON 계약에 충돌 여부 추가
- 같은 `요청자 × 객체 × source`의 중복 접근선을 한 선으로 집계해 `H/S/L×횟수`로 표시하되 원 operation·CoverageCell·Evidence·판정은 상세에서 유지
- 집계 접근선을 클릭하면 포함된 API와 operation별 관측 수·판정·갭을 보여 주고 원 접근 조합으로 이동 가능
- 긴 API·객체 경로를 중간 생략하지 않고 노드 안에서 줄바꿈하며 동적 노드 높이와 source별 접근 lane을 적용
- 세션 충돌·집계선·긴 라벨·상세 이동의 회귀 테스트 추가

## 1.2.0-beta.11 — 2026-08-27

- HUMAN/SCANNER/LLM 필터에 메인 비교 Evidence 수를 표시하고 0건 source는 비활성화
- source 필터 변경 시 edge만 숨기지 않고 해당 source 전용 node와 `identity → resource → operation` 전체 접근 경로를 다시 계산
- source view의 접근 경로 두 구간에 HUMAN 파랑·실선·H, SCANNER 빨강·파선·S, LLM 검정·점선·L 문법을 일관 적용
- 응답→요청 ID/token 데이터 의존선을 메인 접근 그래프에서 제거하고 기존 `흐름 순서` 화면으로 단일화
- 그래프 레일의 임의 역할 순환을 제거하고 계정 역할·API 요구 권한의 읽기 전용 정책 상태로 교체
- 이전 배치 저장값이 새 그래프 구조를 왜곡하지 않도록 그래프 상태 키를 v3으로 갱신하고 Web 계약 회귀 추가

## 1.2.0-beta.10 — 2026-08-27

- 기본 프로젝트 저장을 관계형 `.flowscope.db`로 추가하고 record/payload/account/session binding/policy/review/assessment/validation/route를 분리
- SQLite와 기존 JSON이 동일한 schema v2 검증·마스킹 계약을 사용하며 JSON 읽기·내보내기 호환 유지
- DB를 한 번 저장하거나 열면 revision 변경을 30초 checkpoint로 합쳐 transaction+atomic replace로 자동 저장하고 unload 전에 마지막 저장; raw broker 자격증명은 계속 메모리 전용
- 한 로그인에서 얻은 Cookie·Authorization·subject 지문을 별도 계정처럼 나열하지 않고 계정 카드 하나의 접힌 기술 정보로 projection
- broker 내부 enum 대신 로그인 상태와 사용자가 해야 할 다음 행동을 한국어로 표시하고, 미연결 기록만 고급 세션 진단에 유지
- Xerial SQLite JDBC 3.53.1.0 번들 고지·라이선스와 DB round-trip/비밀 부재/계정 projection 회귀 추가

## 1.2.0-beta.9 — 2026-08-27

- beta.8의 `identity → resource → operation` 그래프 UI를 유지하면서 raw path와 canonical operation을 분리
- UUID/긴 16진 형식, 성공 JSON 응답의 동일 ID, 같은 위치의 복수 값·독립 관측을 범주형 근거로 사용하는 Evidence 단계형 path template 추가
- route declaration 없이 확정이라고 표현하지 않도록 `LITERAL/INFERRED/CORROBORATED` 상태와 이유를 Web 상세·MCP record에 노출
- 근거 없는 단일 `/status/200`은 literal로 두되, 단일 `/orders/101`의 객체 후보는 보존해 보수적 묶음이 인가 분석을 지우지 않도록 분리
- 관측 route inventory도 Evidence 단계형 canonical operation을 사용해 그래프는 literal인데 후보만 `{id}`로 오표시되는 불일치 차단
- 경로 묶음·서비스 경계·날짜/버전 제외·원문 보존 회귀 테스트 추가

## 1.2.0-beta.8 — 2026-08-27

- 마스킹된 textual 요청·응답 전문을 메시지당 기본 1MiB, digest 중복 제거 후 압축 총량 48MiB까지 GZIP으로 보존하고 8KiB UI preview와 분리
- project schema v2에서 SHA-256 digest별 전문 blob을 한 번만 저장하고 load 때 digest·원 byte 수를 검증; schema v1 읽기 호환 유지
- binary·메시지별 상한·압축 총량 상한 초과 전문은 내용 대신 크기·digest·사유만 보존하고 Evidence 및 수집 통계에 retention 상태 표시
- path/query/중첩 JSON·배열/XML/multipart/GraphQL에서 명시 ID 참조를 모두 추출해 근거와 함께 노출하되, 인가 cell은 보수적 primary 하나만 사용
- 인증 준비와 반복 polling을 각각 `AUTH_SESSION`, `POLLING`으로 분리하고 원 Evidence는 유지
- 인증·navigation·polling·background를 선택적 중립 보조 그래프로 표시하되 coverage·gap·verdict에는 포함하지 않음
- source 필터가 edge뿐 아니라 해당 source만 가진 node도 숨기도록 수정
- live 20,000건 상한 초과 누락 건수와 “현재 분석은 불완전” 경고를 Web UI에 노출
- 번들 H/S/L 샘플을 실제 실행 결과로 오인하지 않도록 “실제 점검 결과 아님·네트워크 요청 0건” 상단 배너 추가

## 1.2.0-beta.7 — 2026-08-27

- Web 빠른 시작에서 사용자의 로컬 로그인 Codex/Claude CLI를 새 프로세스로 실행하는 LLM Explorer·별도 Judge·취소·Judge 후속 재개 제어 추가
- Explorer를 전용 임시 작업공간의 Codex ephemeral 또는 Claude no-persistence 세션으로 격리하고 이전 대화 resume 금지
- Judge를 Explorer와 별도 provider session으로 시작하고 실제 dataset lock 성공 뒤 exact session ID로만 후속 질문 재개
- FlowScope MCP 토큰을 자식 환경으로만 전달하고 shell 없는 실행·regular executable 제한·임시파일 권한/정리·출력 마스킹/상한 적용
- 구독 CLI 실행에서 상속된 `OPENAI_API_KEY`·`ANTHROPIC_API_KEY`를 제거하고, Codex의 모델 shell에는 MCP 토큰을 넘기지 않으며 웹 검색을 명시적으로 비활성화
- Claude user/project/local 설정과 auto-memory를 제외해 Explorer가 기존 로컬 지침·기억을 읽지 않도록 하고, 취소·Burp unload와 child 등록 사이 경합에서도 프로세스를 즉시 종료
- exact run 미종료, 3-lane 미완료, 비활성 계정, 잠긴 dataset, 긴 Codex 출력의 session ID 손실을 회귀 테스트로 차단
- 같은 source 재탐색 시 이전 완료 표식을 무효화하고 세 레인 완료 전 Judge 버튼과 서버 lock을 닫음
- active run 또는 잠긴 Judge dataset 상태에서 Burp UI scope 변경을 차단
- Claude no-persistence metadata 잔존 가능성을 UI·문서에 명시하고, 사용자의 provider 홈을 임의 삭제하지 않음

## 1.2.0-beta.6 — 2026-08-26

- provenance에 applicability/reason을 귀속해 source/run 필터 후 다른 lane의 판정 상태가 남지 않도록 재계산
- `flowscope_list_route_candidates` 추가: 독립 Explorer 중에는 자기 run provenance만, dataset lock 뒤에는 잠긴 전체 inventory만 페이지 단위 제공
- pre-lock MCP status에서 다른 source 수량·coverage·gap·finding·active run을 숨기고 Explorer의 자기 run 수치만 허용
- 독립 Explorer 중 ZAP 상태/실행과 기존 assessment/validation 조회를 서버에서 거부
- dataset lock에 route candidate snapshot을 포함해 이후 validation traffic이나 background rebuild가 Judge 입력 후보를 바꾸지 않도록 고정

## 1.2.0-beta.5 — 2026-08-26

- route discovery를 문서 입력 → 포맷 어댑터 → 공통 exact-scope/method/정규화/dedup gate 구조로 분리
- 깨진 HTML과 `<base>`를 처리하는 로컬 HTML5 DOM, 보수적 JavaScript call site, OpenAPI/Swagger JSON·YAML, 표준 metadata, 제품 비종속 generic XML 어댑터 추가
- 관측 `GET`과 method 미확정 `UNKNOWN`을 분리해 같은 경로라는 이유만으로 미시도 조합을 관측으로 승격하던 오류 차단
- route provenance를 `(type, Evidence ID, source, run, adapter)` 대응 관계로 저장·Web 상세에 노출하고 구버전 프로젝트를 보수적으로 이관
- 일반 protocol fixture 7종·truth route 18개의 TP/FP/FN 회귀, XML 외부 entity 차단, fat JAR HTML/YAML/XML 런타임 smoke 추가. 이 수치는 blind target 성능 주장이 아님
- jsoup·Jackson YAML·SnakeYAML 번들 고지와 Shade service metadata 병합 추가

## 1.2.0-beta.4 — 2026-08-26

- classifier v3에서 web manifest·source map·service worker를 `DISCOVERY_METADATA`로 분리하고 같은 service·operation의 명시적 API Evidence만 immutable discovery gate 안에서 교차 보강
- exact-scope HTML/form, `Location`, robots/sitemap, manifest, 정적 JavaScript URL literal, 관측 OpenAPI와 응답 없는 Burp Site Map item에서 provenance-backed route candidate 생성
- 미요청 route를 관측 source·coverage·3-way gap·인가 verdict·finding과 분리해 중립 그래프 노드, 전용 수량·필터·상세로 표시
- RouteCandidate를 프로젝트에 저장·복구하고 각 후보의 provenance ID, 적용 가능성, review 이유와 점수 없는 범주형 우선순위 근거를 보존
- object의 근거 없는 고정 `신뢰도 100%`를 `PATH_ID/QUERY_ID/BODY_ID/GRAPHQL_VARIABLE/DERIVED/NONE` 추출 근거로 교체하고 nested/array JSON 및 multipart ID 회귀 추가
- standalone 1280×720·600×800에서 가로 overflow와 console warning/error 0을 확인. beta.4 JAR의 실제 Burp Community 재로드·Site Map candidate·Burp Browser pass는 별도 수동 gate로 유지

## 1.2.0-beta.3 — 2026-08-25

- Proxy 응답을 요청 시점 `messageId` 문맥에 귀속해 ZAP 계정 lane 전환·HUMAN pass 종료와 늦은 응답 간 provenance 경합을 차단
- HUMAN 계정 pass는 `ACTIVE` 세션만 선택할 수 있고 실제 요청 자격증명이 선택 계정과 exact match할 때만 그 계정으로 기록하도록 강화
- SYSTEM anonymous ZAP lane은 서버가 발급한 lane-local Cookie/CSRF를 유지하면서도 FlowScope 신원은 `ANONYMOUS`로 고정
- 당시 beta.3 JAR을 Burp Community 2026.7.3·ZAP 2.17·crAPI·로컬 MCP에 연결해 HUMAN listener/SCANNER/LLM 전송 경로와 범위 밖 LLM 차단을 실측. HUMAN은 8080 `curl` wiring이며 실제 Burp Browser 검증은 아님
- 비로그인과 복수 ACTIVE 계정을 fresh ZAP session으로 순차 격리하고 신원별 수집·Alert 상태를 표시하는 SYSTEM scanner campaign 추가. 계정 레인은 기존 인증값을 제거한 뒤 broker 세션만 주입하고 신원 하나라도 실패하면 SCANNER 완료 gate를 열지 않음
- 로그인 캡처가 성공 응답을 확인하기 전에는 `UNVERIFIED`로 유지하고 같은 서비스의 계정 두 개를 동시에 캡처하지 못하게 함. Web 계정 카드와 종료 메시지에 재캡처 이유 표시
- LLM run의 `account_id`를 통제 executor까지 전달하는 회귀를 고정하고, FlowScope Web loopback 제어면을 ZAP target 목록과 시작 API에서 제외
- 거부·HEAD 응답의 owner 필드가 소유자 oracle을 오염시키는 경로를 차단하고, 로그인 redirect를 정확한 경로 세그먼트로 제한하며, 대상 객체 ID 없는 owner 문자열만으로 BOLA Evidence를 확정하지 않도록 판정 gate 강화
- 관측 0건에서는 분석 패널 대신 exact scope → HUMAN pass → ZAP 기준선 → LLM Explorer/Judge 순서와 시작 조작만 보여 주고, Evidence가 생기면 기존 분석 작업면으로 전환
- 공개 `target/`에서 Shade 중간 `original-*` JAR을 제거하고, 연속 package에서도 동일한 Burp fat JAR 하나만 남도록 빌드 검증 추가
- `REVIEW` Evidence를 메인 graph·3-way gap 밖의 검토 대기로 분리하고, UI 수량과 처분 필터를 `INCLUDE/REVIEW/EXCLUDE` 상호 배타 상태로 정리
- HUMAN 로그인 캡처를 `SESSION_SETUP`으로 분리하고, 명시적 HUMAN exploration pass 밖의 scope 내 트래픽은 Evidence로는 보존하되 3-way coverage·gap에서 제외
- 프로젝트 기본 README·변경 이력·기여·보안 문서를 한국어로 전환하고, 상세 한국어 문서는 `docs/ko`, 영어 공개 가이드는 `docs/en`으로 분리
- source 표현을 HUMAN 파랑·실선·H, SCANNER 빨강·파선·S, LLM 검정·점선·L로 통일하고 일반 조작 accent를 source 의미색과 분리
- 일반적인 범위 밖 HUMAN 브라우징은 막지 않으면서, 저장되는 HUMAN·Burp tool Evidence를 설정된 exact scope로 제한
- 파괴적 트래픽 노이즈 필터를 Evidence 보존형 결정론적 분류기로 교체. 수집과 coverage 입력을 분리하고 이유·수량·되돌릴 수 있는 override를 제공
- `ANONYMOUS / ACCOUNT_BOUND / UNRESOLVED` 인증 상태와 서비스별 연결되지 않은 회전 cookie 신원 안정화 추가. 안전한 fingerprint는 버리지 않음
- 모든 Evidence ID와 first/last timestamp를 보존하는 표시 전용 반복 접기, 파싱 표의 분류·반복·Evidence 열, 상세 직접 이동 추가
- 요청·응답 media type, Fetch Metadata, CORS preflight 문맥 수집 추가. 일반 OPTIONS, 오해를 부르는 확장자, private image API, telemetry 명칭 endpoint는 보수적으로 검토 가능 상태 유지
- 독립 Explorer가 dataset lock 전에 HUMAN·SCANNER 활동량을 추론하지 못하도록 수집·coverage·분류 수량을 기존 시야 격리 경계 안에 유지
- 계정별 명시적 메모리 전용 세션 캡처 추가. scoped Cookie/Bearer/CSRF 주입, Set-Cookie 회전, 의심·만료 처리, 안전 metadata view, unload 시 폐기 지원
- FlowScope 통제 exact-scope LLM 요청 executor와 execution trust provenance 추가. 직접·미검증 트래픽은 결정적 validation에서 거부
- MCP 서버에서 독립 Explorer 시야를 강제하고 불변 Judge dataset lock 전에 HUMAN/SCANNER/LLM의 정확한 완료를 요구
- lock 이후 통제 probe/control Evidence는 현재 저장소에서 읽고 후보·인가 oracle은 고정 snapshot에서 읽도록 실제 validation 순서 수정
- Traditional Spider, strict Client Spider(AJAX fallback), passive queue 완료, native alert, zero-capture 실패 gate를 사용하는 결정론적 SYSTEM ZAP 기준선 추가
- Web 빠른 시작에 HUMAN session 제어와 ZAP target/복수 account/신원별 progress 제어를 추가하고 긴 문자열 대응 개선
- 중단된 exploration record로 완료를 추론하지 않고 명시적 완료 lane metadata를 저장. raw broker session은 저장하지 않음
- 직접 curl/proxy 안내를 제거하고 외부 검색·직접 대상 네트워킹을 금지하는 closed-world Explorer/Judge prompt로 교체
- 모든 동작 변경에 이유·영향 파일·검증·한계·release gate를 기록하는 상세 개발 로그와 저장소 문서 계약 추가
- 발표용 화면 근거를 추가하고 thin JAR 설치 혼동, 빈 화면 onboarding 부채, raw table Evidence 진입, trusted-project Codex MCP 안내를 현재 베타 상태에 맞게 수정

## 1.2.0-beta.2 — 2026-08-25

- active SCANNER/LLM lease를 보호하며 실행 전에 authenticated MCP exact scope를 원자적으로 교체하는 기능 추가
- Web 빠른 시작에 명시적 HUMAN pass 시작·종료 추적 추가
- ZAP 2.17과 호환되는 AJAX Spider orchestration과 scan ID 없는 상태 polling 추가
- 범위 안 scanner 트래픽 0건으로 끝난 AJAX run을 성공으로 표시하지 않고 `NO_SCANNER_TRAFFIC_CAPTURED`로 처리
- ZAP 시작 전 run provenance를 예약하고 시작 실패·종료 시 해제
- 임의 scalar field를 신뢰하지 않고 명시적 nested principal object에서만 보수적으로 owner 추출

## 1.2.0-beta.1 — 2026-08-25

- 원본·반복 재현·정상 대조 Evidence를 분리한 서버 검증 LLM 최종 verdict bundle 추가. 일반 LLM assessment는 비최종 상태 유지
- 베타의 결정적 validation을 safe GET 후보로 제한하고 저장 decision을 현재 finding·Evidence와 재검증
- 페이지형 MCP Evidence 탐색과 200건 단위 Web Request/Response 조회 추가
- exact-scope SCANNER/LLM 수집, encoded traversal 거부, loopback Host 검증, 겹치는 run lease 차단, exact run ID 종료 강제
- 구조화 JSON·form·multipart·XML 비밀 마스킹과 secret-bearing malformed JSON fail-closed 처리 추가
- 요청 body owner 신뢰 제거, UNKNOWN 트래픽 분석 격리, BOLA 판정에 정확한 구조화 객체 Evidence 요구
- backend coverage cell·gap·missed source·source별 verdict를 Web UI 정본으로 만들고 유효한 프로젝트 round trip에서 stable Evidence digest 유지
- on-demand 마스킹 Request/Response와 Repeater 초안을 유지하면서 간결한 최초 실행 wizard와 1280/900/600 반응형 UI 수정 추가
- Burp 제어 탭에서 MCP Bearer를 마스킹하고 명시적인 clipboard 복사 흐름 유지

## 1.1.0 — 2026-08-25

- 중복 Swing/JGraphX 분석 작업면을 선택된 `whs_flow` 기반 번들 Web UI와 작은 Burp 제어 탭으로 교체
- Burp 호환 custom HTTP server에 localhost Web capability 인증, Host/Origin 검증, CSP/no-store/frame 보호, 제한된 XML/form body 적용
- 하나의 정본 반응형 작업면에 graph, matrix, flow, scenario, raw record, account/session, required role, owner, Evidence-bound human review 추가
- 20,000건 상한에서도 polling snapshot이 가볍도록 on-demand Request/Response 조회 추가
- 가짜 replay response나 자동 correlation 없이 안전한 마스킹 미전송 Burp Repeater 초안 handoff 추가
- 객체 없는 endpoint의 identity→operation 직접 edge와 collision-safe cell key 추가
- JGraphX를 로컬 번들 Cytoscape.js로 교체하고 third-party notice 갱신

## 1.0.0 — 2026-08-24

- HUMAN/SCANNER/LLM 3-lane 실시간 수집과 provenance filter 추가
- 신원 인지 graph, coverage matrix, BOLA/IDOR·BFLA 후보 규칙, Evidence 상세 추가
- query/body/GraphQL normalization, redirect, response taxonomy, 제한된 data-flow link 추가
- Codex·Claude Code 구독형 클라이언트용 localhost 인증 MCP 통합 추가
- scope-guarded ZAP Spider와 승인형 Active Scan orchestration 추가
- LLM Explorer/Coach run context와 비확정 Evidence-linked assessment 추가
- 마스킹된 버전형 프로젝트 저장·불러오기와 엄격한 Burp XML 가져오기 추가
- 보안 강화, dependency notice, 회귀·통합·UI 테스트 추가
- Burp-native Request/Response Evidence viewer, 관련 record 이동, 좌우 확장, 마스킹 복사, 현재 Evidence Repeater handoff 추가
- 서비스별 비밀값 없는 테스트 계정과 명시적 discovered/rotating-session binding 추가
- 관측 반복 수를 보존하면서 이미 반영된 사본만 억제하는 Burp Proxy history 가져오기 추가
- 실제 Pipeline/AuthorizationAnalyzer로 BOLA/BFLA 후보를 만드는 무네트워크 HUMAN/SCANNER/LLM 온보딩 샘플 추가
- 규칙·LLM 후보에 대한 Evidence-bound 사람 `확정/미확정/폐기` 판정과 마스킹 note 추가
- Burp Request/Response 편집기와 명시적 secret-free binding을 유지하는 `whs_flow`식 전체 폭 계정·세션 작업면 추가
- 객체·API를 18개 단위로 펼치고 접는 대규모 그래프 표시 기능 추가
