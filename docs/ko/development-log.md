# FlowScope 개발 기록

## 2026-09-09 · 미출시 · ZAP 로그인 성공을 실제 응답 Evidence로 검증

### 원인과 수정

- 별도 실물 Docker/기록 프록시 하네스에서 ZAP 2.17의 `authenticateAsUser`가 실제 브라우저 로그인 뒤에도 `{"Result":"OK"}`만 반환하는 경우를 확인했다. 이를 보완하려고 `getAuthenticationState.lastSuccessfulAuthTimeInMs`를 성공 조건으로 시도했으나, 같은 하네스의 오류 비밀번호 계정도 성공으로 통과해 Client Spider가 시작됐다. API 호출 수락·인증 시각은 현재 계정의 로그인 성공 증거가 아니었다.
- `ZapAccountVault`에 필수 로그인 성공 정규식과 선택적 로그아웃 정규식을 추가했다. 두 값은 username/password처럼 현재 프로세스 메모리에만 두고 응답·snapshot·프로젝트에 원문을 내보내지 않는다. React 등록 화면은 필수/선택과 용도를 명시한다.
- `ZapBrowserAuthenticator`는 Browser Based Authentication과 session auto-detect 뒤 ZAP Context의 logged-in/out indicator를 설정한다. 이후 같은 run·`laneAccountId`·`ZAP_AUTHENTICATION`·응답 존재 조건을 모두 만족하는 실제 레코드만 검사한다. 마지막 성공 일치가 있고 더 나중 실패 일치가 없을 때만 계정 지정 Client Spider를 시작한다. 인증 단계의 run context에도 계정 ID를 넣었다.
- 계정 폐기 때 `AnalysisConfig`의 비밀 없는 계정 메타데이터도 함께 제거해 폐기된 ZAP 신원이 새 분석에 남지 않게 했다.

### 대안 검증과 실물 결과

- ZAP Authentication Helper의 브라우저 인증 결과 알림 수정이 포함된 미출시 0.43.0 upstream build를 잠시 고정해 시험했지만, action 결과 자체를 신뢰하지 않는 Evidence gate가 더 직접적인 계약이다. 미출시 binary와 Common Library를 distribution에 넣는 유지·공급망 비용을 피하기 위해 제거했다.
- 사용자 8089 컨테이너와 분리한 `flowscope-zap-runtime-test` project(API 18889, 기록 프록시 18881)에서 공식 ZAP 2.17 base의 Authentication Helper 0.41.0·Client 0.30.0으로 다시 실행했다. 익명 → alice → bob lane이 완료됐고 두 계정은 `/api/me`에서 자기 사용자 응답을 받았다. 교차 계정 session 혼입과 capability 거부는 0건이었다. 이어 alice 사용자명·오류 비밀번호는 인증 단계에서 `FAILED`가 됐고 그 계정의 Client Spider 요청은 0건이었다.
- 집중 Java 회귀는 응답 body뿐 아니라 status/header indicator와 성공 뒤 늦은 로그아웃 응답을 포함해 통과했고 React Inspection 22 tests도 통과했다. JDK 21 전체 `mvn clean verify`는 Java 381 tests(실패·오류 0, opt-in 실물 하네스 2 skip), React 38 files/247 tests와 release gate를 통과했다. JAR은 31,651,530 bytes, 9,140 entries, SHA-256 `8708565ff18c04bbe94af26cce7c6da37cb732ea47fcedd9e78888ffbbd53b44`이며 상세 환경과 실물 결과는 beta-validation에 기록했다.

### 남은 gate

- 실제 Burp에 최종 JAR을 재로드한 8081 capture와 UI 정상·오류 계정, Windows Docker Desktop은 아직 별도 검증 대상이다.
- 사용자가 성공/실패 응답을 구분하는 정규식을 제공해야 한다. SPA/CAPTCHA/MFA/WebAuthn/외부 SSO를 자동으로 해석하거나 우회한다고 주장하지 않는다.

## 2026-09-09 · 미출시 · PR #10 흐름을 현행 Docker Chromium ZAP에 이식

### 개발·수정

- PR #10은 옛 MCP/Session Broker 의존과 Firefox fallback을 포함하고 현재 브랜치와 충돌하므로 병합하지 않았다. 사용자가 Web에서 대상별 계정 이름·역할·로그인 URL·ID·비밀번호를 등록하고 ZAP Browser Based Authentication 뒤 계정 지정 Client Spider를 실행하는 흐름은 현행 `ZapAccountVault`·`ZapBrowserAuthenticator`·`ZapCampaign`·React 작업면에 유지했다.
- `infra/zap/Dockerfile`을 추가해 digest 고정 ZAP 2.17 base에 Debian Chromium과 ChromeDriver를 같은 저장소에서 설치한다. Compose는 이 이미지를 빌드하고 `/run/flowscope-zap`·`/tmp` tmpfs, 1GiB shared memory, unprivileged `zap` 사용자를 유지한다.
- 시작 스크립트는 browser/driver 파일·실행·version·주 버전 일치와 임시 profile의 실제 headless 기동을 먼저 검사한다. Docker 기본 격리에서 Chromium sandbox가 namespace 오류로 실패한 실측에 따라 Chromium에만 `--no-sandbox`를 전달하고 broad capability/seccomp 완화는 추가하지 않았다.
- 비로그인·로그인 Client Spider 모두 `chrome-headless`를 명시한다. `ZapCampaign`과 연결 상태 API는 tmpfs `zapHomePath`를 요구해 임의 ZAP Desktop/API runtime이 “연결됨”만으로 실행되는 것을 막는다. React와 legacy 안내는 FlowScope Docker Chromium 한 경로와 로그인 계정 입력을 표시한다.
- macOS/Linux와 Windows `zap-up`은 custom image를 `--build --wait`로 기동한다. distribution과 CI에 Dockerfile을 포함하고 version을 beta.46으로 올렸다.

### 필요성·기각 대안

- 호스트 Chrome/ChromeDriver를 탐색하면 설치 경로와 browser/driver 버전이 사용자마다 달라지고 오픈소스 다운로드 동선이 깨진다. Selenium Manager의 실행 중 다운로드는 네트워크·버전 재현 경계를 늘린다.
- Chrome 실패 시 Firefox/AJAX/Traditional로 fallback하면 사용자가 선택한 실행 경로와 실패 의미가 바뀌고 0건을 다른 crawler 결과로 숨길 수 있어 기각했다.
- ZAP Desktop을 함께 지원하면 D-131의 tmpfs 비밀 수명과 browser preflight를 강제할 수 없다. PR #10 전체 병합은 삭제된 MCP/Judge와 현행 타입을 되살리므로 기각했다.

### 영향 파일·회귀

- runtime/배포: `infra/zap/Dockerfile`, `compose.yaml`, `start-zap.sh`, `scripts/zap-up.sh`, `scripts/zap-up.ps1`, `src/assembly/distribution.xml`, `.github/workflows/ci.yml`.
- Java/UI: `ZapClient`, `ZapBrowserAuthenticator`, `ZapCampaign`, `FlowScopeExtension`, React Inspection/type, legacy Web와 관련 테스트.
- 문서: README, 한·영 README/시작 가이드/CHANGELOG, architecture, decisions D-135, product overview/plan, UI 근거, HANDOFF, beta-validation, documentation-status, 이 기록.
- RED/GREEN: startup 회귀가 browser/driver 부재·headless 실행 실패·주 버전 불일치를 먼저 요구했고, campaign 회귀가 익명 lane의 관리 runtime 강제를 요구했다. 구현 뒤 집중 Java 68 tests가 failures/errors 0으로 통과했다.

### 실제 검증

- `./scripts/zap-up.sh`로 최종 custom image를 build/recreate하고 health를 확인했다. `doctor.sh --mode zap`은 failures 0 / warnings 0이었다.
- 컨테이너에서 Chromium/ChromeDriver가 모두 `152.0.7977.82`였고, 실제 ZAP Client Spider가 exact Context의 `http://127.0.0.1:8888/`를 HTTP 200으로 1건 수집한 뒤 status 100으로 끝났다. FakeZap 결과가 아니다.
- 최종 코드·문서 입력에서 JDK 21 `mvn clean verify`를 1회 실행해 Java 375 tests(failures/errors 0, opt-in provider 1 skip), React 38 files/247 tests, typecheck·notices·Vite build와 release gate를 통과했다. JAR은 31,649,129 bytes, 9,140 entries, SHA-256 `d03c5a602f8c06f3e345468f1b69adb5557b6b3cfc04fd500a04e8dec87ca8c3`이며 bundle에 Dockerfile이 포함됐다.

### 남은 한계·다음 gate

- 실제 Burp에 beta.46 JAR을 재로드한 Browser Based Authentication 성공/실패, 복수 계정의 SCANNER `laneAccountId` 귀속·쿠키 격리, 취소·정리는 아직 미검증이다.
- Windows helper는 자동 parser/계약 회귀 대상이며 실제 Windows Docker Desktop의 image build와 target capture는 별도 gate다.
- Chromium/ChromeDriver는 같은 Debian 저장소에서 함께 설치하고 runtime에서 주 버전을 검사하지만 package 숫자는 Dockerfile에 고정하지 않았다. 이후 release image digest를 게시하기 전까지 교차 시점 byte-identical image를 주장하지 않는다.

## 2026-09-06 · 1.2.0-beta.44 · 다중 항목 scope의 ZAP capability 커버리지 이식

### 개발·수정

- 예전 `claude/hai-8351a0` 브랜치(main 미병합)를 검토해, 문서 2커밋은 새 문서로 대체돼 폐기하고 코드 커밋 `849f843`의 두 수정 중 하나만 남아 있음을 확인했다. route 매칭은 코덱스의 concrete frontier(D-113 계열)로 재구현돼 대체됐고, **scope-wide ZAP capability 커버리지는 main에 없었다.**
- 현재 main은 capability 헤더 Replacer 규칙을 단일 target 하위(`exactSubtreeRegex(target)`)에만 붙였다. 그러나 Burp 8081은 스캐너 캠페인 레인의 **모든** in-scope 요청에 capability를 요구한다(`scannerCampaignRequestAllowed`). exact scope에 항목이 둘 이상이고 브라우저 크롤러(Client/AJAX)가 형제 항목이나 그 항목이 참조하는 리소스를 부르면, ZAP이 헤더를 안 붙여 8081이 "capability missing or invalid"로 거부하고 캠페인이 격리 오류로 끝난다.
- `ZapClient.exactSubtreeRegex(Collection)` 오버로드를 추가해 여러 항목을 union regex로 덮는다. 항목이 하나면 단일 target 버전과 완전히 동일한 문자열을 돌려주므로 crAPI 등 단일 항목 scope의 동작은 불변이다. capability 설치 지점에서 `state.scope().entries()` 전체(+target)를 커버리지로 쓴다. `includeInContext`(ZAP 크롤 경계)는 바꾸지 않았다 — 크롤 범위 변경은 별도 결정이다.

### 필요성·기각 대안

- 예전 브랜치를 통째로 병합하는 방식은 낡은 문서와 대체된 코드를 함께 끌어와 기각하고, 살아 있는 수정만 현재 코드에 새로 이식했다.
- capability를 단일 target으로 두는 현행은 다중 항목 scope에서 잠복 실패를 남기므로 기각했다.

### 영향 파일·회귀

- 코드: `ZapClient.java`(union 오버로드), `McpServer.java`(capability 커버리지=scope 전체).
- 테스트: `ZapClientTest` — union이 모든 scope 항목을 덮고 외부는 거부, 단일 항목 union == 단일 target 회귀.

## 2026-09-08 · D-134 ZAP 2.17 로그인 REST 호환 수정

### 개발·수정

- 실제 Burp에서 로그인 ZAP lane을 시작해 session·Context 생성 뒤 `/JSON/verification/action/setVerificationMethod/`가 HTTP 400 `no_implementor`로 실패하는 문제를 재현했다. 실행 중인 ZAP 2.17 API에는 `authentication`과 `sessionManagement`는 있지만 `verification` component가 없었다.
- `ZapBrowserAuthenticator`와 `ZapClient`에서 지원되지 않는 verification action을 제거했다. 로그인 흐름은 ZAP 2.17 REST에서 지원되는 Browser Based Authentication, Auto-Detect Session Management, 임시 user/credentials, `authenticateAsUser`의 명시적 `authSuccessful=true` 확인을 유지한다.
- FakeZap이 존재하지 않는 verification endpoint에 무조건 `OK`를 반환하던 모사를 제거했다. 인증 회귀는 해당 endpoint를 호출하지 않으면서 인증 성공값이 없으면 계속 실패하도록 고정했다.

### 이유와 기각안

- [ZAP 공식 Auto-Detection 문서](https://www.zaproxy.org/docs/getting-further/authentication/auto-detection/)는 Core 제약으로 auto-detection을 API에서 지원하지 않는다고 명시하고, verification `autodetect`는 Automation Framework 예시로 제공한다. 현재 FlowScope 캠페인은 REST action API를 사용하므로 Automation Framework 설정을 REST endpoint처럼 호출할 수 없다.
- 400 `no_implementor`만 경고로 무시하면 실제 API 계약 오류를 숨기므로 기각했다. 이번 수정에서 캠페인 전체를 Automation Framework로 바꾸면 capability·진행·취소·비밀 수명 계약까지 달라지므로 최소 호환 수정 범위를 넘어서 기각했다.

### 영향 파일·회귀

- 코드: `ZapClient.java`, `ZapBrowserAuthenticator.java`.
- 테스트: `FakeZap.java`, `ZapClientTest.java`, `ZapBrowserAuthenticatorTest.java`.
- 문서: README, 한·영 시작 가이드·아키텍처·변경 이력, 결정·제품·UI·계획·인계·문서 상태·검증 기록.
- JDK 21 집중 회귀 `ZapClientTest,ZapBrowserAuthenticatorTest`는 통과했다. 전체 빌드 결과는 같은 작업 입력에서 `mvn clean verify`로 확인해 `beta-validation.md`에 기록한다.

### 남은 한계·다음 gate

- 이 수정은 존재하지 않는 REST 호출을 제거한 것이다. 장시간 세션 만료 후 자동 재인증을 보장하지 않는다.
- 수정 JAR을 Burp에 재로드한 뒤 실제 대상에서 Browser Based Authentication 성공, strict Client 응답 capture, capability 전달과 계정 격리를 다시 확인해야 한다. FakeZap 결과로 이를 완료했다고 주장하지 않는다.

## 2026-09-08 · D-133 후속 문서 정합성 수정

### 수정·이유

- `mcp-judge-removal-plan.md`의 현행 단계 표가 D-132 이전 상태인 `Traditional → Client → AJAX → Passive`를 계속 표시해, 현재 Client-only 코드·결정·사용 안내와 충돌하는 것을 전수 대조에서 확인했다.
- 단계 4를 D-132 구현 완료와 실제 Burp 8081 gate 대기로 고치고, 검증 범위를 D-126~133으로 연결했다. 가짜 ZAP이 확인하는 Client 호출·0건 실패·정리와 확인하지 못하는 실제 브라우저 경합도 분리했다.
- `product-overview.md`와 `ui-product-rationale.md`의 현재 계약 기준을 D-130에서 D-133으로 맞추고, 인증 뒤 strict Client Spider 하나만 실행한다는 현행 흐름을 상단에서 명시했다.
- 역사 문서의 당시 Traditional/AJAX·MCP/Judge 기록은 과거 검증을 바꾸지 않기 위해 수정하지 않았다. 코드·UI·빌드·배포 동작 변경은 없다.

### 검증

- 추적 Markdown 37개 중 제품 관리 문서 36개의 현행/역사 구분을 다시 대조했다. 로컬 파일·디렉터리 링크 236개는 모두 존재했다.
- 현행 문서에서 D-132 이전 crawler 흐름을 현재 상태로 안내하는 표현과 D-130으로 뒤처진 제품/UI 현재 계약 표기를 다시 검색해 0건임을 확인했다.
- `git diff --check`를 통과했다. 문서 전용 정합성 수정이므로 제품 자동 테스트나 실제 Burp/ZAP gate를 새로 수행했다고 기록하지 않는다.

## 2026-09-08 · D-133 실물 ZAP Docker API 호환 수정

### 개발·수정

- 제공 Compose를 별도 8090 project로 실제 실행해, 호스트 publish 요청이 `host.docker.internal` 주소가 아니라 Compose bridge gateway 주소로 ZAP에 도착하는 것을 확인했다.
- `start-zap.sh`가 `/proc/net/route`의 default route에서 bridge gateway를 검증·변환해 loopback·신뢰 host gateway와 함께 exact API allowlist에 넣도록 수정했다. 해석 실패 시 wildcard로 열지 않고 시작을 실패시킨다.
- ZAP 2.17 action API가 charset이 붙은 form media type을 400으로 거부하는 실제 동작에 맞춰 `ZapClient` POST를 exact `application/x-www-form-urlencoded`로 고정했다.
- bridge gateway 계산과 모든 인증 action POST의 method·query 비노출·API key·exact Content-Type을 회귀 테스트로 고정했다.

### 실물 검증과 영향

- 기존 사용자 8089 컨테이너는 유지하고 임시 8090 project만 생성·제거했다. ZAP API 준비, tmpfs `zapHomePath`, initiator 18 Replacer 규칙이 이름 없는 `newSession` 뒤에도 유지됨, session 파일은 tmpfs에만 생성되고 `/home/zap/.ZAP/session`에는 0개임을 확인했다.
- 실제 ZAP 2.17에서 exact form POST는 200 `Result: OK`, charset 포함 form과 JSON POST는 400 `content_type_not_supported`였다.
- 영향 파일: `infra/zap/start-zap.sh`, `ZapClient.java`, `ZapStartupScriptTest.java`, `ZapClientTest.java`, 현재 계약·검증 문서.

### 남은 한계·다음 gate

- 이번 실물 gate는 daemon/API/session 경계까지다. Burp SCANNER listener 8081이 닫혀 대상 로그인, Client capture, capability 전달과 복수 계정 격리는 확인하지 못했다.

### 최종 자동 검증

- JDK 21.0.12.1에서 `mvn clean verify`를 두 번 실행해 매회 Java 370 tests(실패·오류 0, opt-in 1 skip), React 38 files/247 tests와 typecheck·Vite·release packaging을 통과했다.
- 두 실행의 JAR과 bundle SHA-256이 각각 일치했다. 최종 JAR은 31,649,268 bytes, 9,140 entries, SHA-256 `78868e06a2af099df26e5cbc9254daf42bacc791bdee8aaa1c321e940612cb24`다.
- 검증 수치를 문서에 반영한 최종 입력에서도 clean package를 두 번 실행해 JAR·bundle SHA-256이 각각 일치하는지 다시 확인했다. bundle 자체 해시는 이 문서에 넣지 않아 자기 참조를 피했다.
- Bash 5개 `bash -n`·`shellcheck`, Compose config, manifest 첫 entry, 폐기 MCP/Judge 클래스 부재와 MR namespace 검사가 통과했다. 이 머신에는 `pwsh`가 없어 Windows script parse는 실행하지 못했다.

## 2026-09-08 · D-132 ZAP Client Spider 단일 실행

### 개발·수정

- `ZapCampaign`의 신원별 실행을 optional API 정의 import → optional Browser Based Authentication → strict Client Spider → Passive queue → native Alert로 줄였다. Traditional/AJAX 시작·상태·중지·fallback과 전용 capture 필드를 제거했다.
- Client가 scan ID를 반환하지 않거나 terminal 대기·capability 검증에 실패하거나 같은 run의 `ZAP_CLIENT_SPIDER` 범위 안 응답을 한 건도 남기지 못하면 lane을 실패시킨다. 실패를 다른 crawler 성공으로 덮지 않는다.
- `ZapClient`, doctor와 required add-on에서 Traditional/AJAX API 및 `spider`·`spiderAjax` 요구를 제거했다. capability initiator는 인증 5, 정의 import/manual 6, Authentication Helper 14, 인증 확인 15, Client 18만 남겼다.
- React와 legacy 상태를 `세션 / 로그인 / Client / Passive / Alert`, `client_captures` 계약으로 맞췄다. 샘플 SCANNER source detail도 새 캠페인과 같은 `ZAP_CLIENT_SPIDER`로 바꿨다.
- 계정 입력 UX는 PR #10의 ZAP 로그인 URL·ID·비밀번호 inline 흐름을 대조했다. PR은 삭제된 MCP·이전 신원 계약을 포함하므로 병합하지 않고, 현행 `ZapAccountVault`·target별 계정 선택·인증 상태·폐기·실행 중 수정 차단을 유지했다.

### 이유와 기각안

- 사용자는 기본 crawler를 Client Spider 하나로 고정하도록 결정했다. ZAP 공식 문서는 Client Spider를 modern app의 권장 crawler로 설명하고 AJAX보다 권장하며, API에서 strict scope·Context·user·browser·status·stop을 제공한다.
- 세 crawler 유지와 자동 fallback은 단계·timeout·정리·화면 의미를 다시 늘리고 Client 실패를 가리므로 기각했다. 다만 공식 설명을 임의 대상에서 Traditional의 모든 정적 링크까지 우월하다는 내부 실측으로 확대하지 않는다.

### 영향 파일

- 코드: `ZapCampaign.java`, `ZapClient.java`, `SampleProject.java`, legacy Web, React ZAP 상태·API 타입, doctor.
- 테스트: `ZapClientTest`, `ZapCampaignTest`, `ZapCampaignRegressionTest`, `FlowScopeWebServerTest`, React inspection/client fixture.
- 문서: README, 시작 가이드, architecture, decisions, product/UI/기능 계약, HANDOFF, CHANGELOG, beta-validation, documentation-status.

### 재현·검증 상태

- 변경 전 회귀는 Traditional/Client/AJAX 호출과 rendered 합계를 기대했다. 변경 후 main campaign에서 Traditional/AJAX trap이 호출되지 않고 Client 1건만 수집되는 회귀, Client 0건 실패, Client 취소·정리, 복수 신원 분리로 바꿨다.
- 집중 Java 62 tests와 React 2 files/28 tests, TypeScript typecheck가 통과했다. 전체 clean verify 2회와 최종 산출물 결과는 같은 작업 입력에서 실행한 뒤 `beta-validation.md`에 추가한다.

### 남은 한계·다음 gate

- FakeZap은 API 순서와 상태만 모사한다. 실제 Firefox extension, 로그인, capability 전달, Burp 8081 capture, 복수 계정 격리를 증명하지 않는다.
- 실제 Burp listener가 열린 환경에서 비로그인·로그인 Client 완주, 0건/실패 표시, Passive/Alert, 취소 cleanup을 확인해야 한다. Windows Docker Desktop 실기기 gate도 별도다.

## 2026-09-08 · D-130 ZAP 직접 브라우저 인증 계정 lane

### 개발·필요성·기각안

- HUMAN 로그인 캡처의 Session Broker를 ZAP에 주입하던 계정 lane을 별도 메모리 `ZapAccountVault`와 `ZapBrowserAuthenticator`로 분리했다. ZAP 브라우저 세션·SPA 저장소는 Burp 브라우저 세션과 같지 않으므로 header 교체만으로 로그인 성공을 주장하는 기존 경로를 기각했다.
- 계정마다 이름 없는 ZAP session과 임시 Context/user를 만들고 Browser Based Authentication, 자동 session management·verification, `authenticateAsUser`의 명시적 성공을 확인한다. 그 뒤 Traditional/AJAX `scanAsUser`와 Client `userName`·`firefox-headless`로만 계정 crawler를 시작한다.
- 해당 run의 capability를 통과한 직접 인증 SCANNER 요청은 ZAP이 만든 Cookie/Authorization을 보존하며, 성공한 lane의 안전한 account ID로 Evidence를 귀속한다. cookie/JWT 문자열 추측이나 UI 선택만으로 계정을 붙이지 않는다. 종료·실패·취소 때 임시 ZAP user/Context를 제거하고 cleanup 실패는 격리 실패로 남긴다.
- capability Replacer는 공식 ZAP 2.17 `HttpSender` 상수와 각 add-on 호출부를 대조해 Traditional(3), authentication(5), API import/manual(6), AJAX(10), Authentication Helper(14), authentication poll(15), Client Spider(18)에만 적용했다. 로그인 URL을 exact-scope Context에 추가하고 로그인 교환은 `ZAP_AUTHENTICATION / SESSION_SETUP`으로 분리해 crawler 수집 건수와 완료 gate를 채우지 못하게 했다.
- React ZAP 설정에 target별 메모리 로그인 계정, 인증 상태·브라우저·메시지, 단계·경과·heartbeat를 연결했다. React 전환에서 빠져 있던 exact-scope OpenAPI·GraphQL·Postman·SOAP 정의 입력과 캠페인 취소도 기존 서버 계약에 다시 연결했다.

### 영향 파일

- 코드: `ZapAccountVault`, `ZapBrowserAuthenticator`, `ZapClient`, `ZapCampaign`, `FlowScopeExtension`, `Pipeline`, `FlowScopeWebServer`.
- UI: React Inspection/API/query/types/fixture와 legacy ZAP 계정 source·인증 상태.
- 운영: Bash·PowerShell doctor의 필수 `authhelper` add-on 검사.
- 테스트: vault 비밀 수명·역할, ZAP 인증 API, account crawler·cleanup, direct-auth header 보존, SCANNER identity 귀속, Web 비밀 비노출, React 등록·시작·상태·정의·취소.

### 현재 검증 상태

- 집중 React 2 files/28 tests와 typecheck가 통과했다.
- 집중 Java `ZapAccountVaultTest,ZapBrowserAuthenticatorTest,ZapClientTest,ZapCampaignRegressionTest,TrafficClassifierTest,PipelineClassificationTest,FlowScopeWebServerTest,FlowScopeExtensionPhaseTest`가 실패 없이 통과했다.
- 실제 공식 ZAP 2.17.0 Docker 컨테이너에서 Firefox와 `authhelper`·`client`·`selenium` add-on 존재를 확인했다. `doctor.sh --mode zap`에서 ZAP API/version/upstream/add-on/Web은 통과했지만 Burp scanner listener `127.0.0.1:8081`이 닫혀 실제 로그인·capture end-to-end는 수행하지 못했다.

### 남은 gate

- 최종 입력의 전체 `mvn clean verify` 2회, JAR/bundle 구조·해시, 문서·버전 정합성은 아직 남았다.
- 실제 Burp 8081을 연 상태에서 비로그인과 로그인 계정 최소 2개로 명시적 인증 성공/실패, Traditional/Client/AJAX capture, lane 귀속·쿠키 격리, Passive/Alert, 정의 import, 취소와 임시 user/Context 제거를 확인해야 한다. CAPTCHA·MFA·WebAuthn·복합 SSO는 자동 지원으로 주장하지 않는다.

## 2026-09-08 · D-129 다운로드 배포 동선·기능별 환경 점검

### 개발·필요성·기각안

- 저장소를 clone하지 않는 사용자가 Release ZIP 하나로 Burp JAR, ZAP Compose/helper, macOS·Linux·Windows 점검기와 현재 문서를 받을 수 있도록 Maven distribution bundle을 추가했다. JAR만 배포하면 HUMAN·Explorer는 실행할 수 있어도 ZAP helper와 올바른 문서 버전이 분리되는 문제가 있어 기각했다.
- `doctor`를 `human`, `zap`, `explorer`, `full` 모드로 나눴다. 사용하지 않는 ZAP이나 Explorer가 없다는 이유로 HUMAN만 쓰는 사용자의 전체 점검을 실패시키지 않으며, `--build`/`-Build`에서 POM과 동일하게 Maven 3.9.x와 JDK 21 정확히를 확인한다.
- Explorer의 준비 상태 캐시를 사용자가 명시적으로 무효화하고 다시 검사하는 Web/API/UI 동선을 추가했다. CLI를 설치하거나 로그인한 뒤 Burp 전체를 재시작하게 하는 대안은 불필요한 마찰이라 기각했다. 시작 버튼은 Codex가 `READY`일 때만 활성화하고, 실패 화면은 공식 설치·동일 OS 사용자 로그인·재확인 순서를 표시한다.
- 외부 프로그램과 보안 경계를 자동 설치로 숨기지 않았다. Burp listener 설정, Codex 설치·ChatGPT 로그인, ZAP/Docker 설치, CAPTCHA·MFA·WebAuthn·서비스 고유 로그인은 사용자 또는 대상별 확인이 필요함을 시작 가이드에 분리했다.

### 영향 파일

- 배포·CI: `pom.xml`, `src/assembly/distribution.xml`, `.github/workflows/ci.yml`.
- 점검기: `scripts/doctor.sh`, `scripts/doctor.ps1`.
- 코드·UI: Explorer provider/coordinator, `FlowScopeExtension`, `FlowScopeWebServer`, React Explorer와 API/query 계약.
- 테스트: `ExplorerCoordinatorTest`, `FlowScopeWebServerTest`, `ExplorerPage.test.tsx`.
- 문서: 한·영 README/시작 가이드/변경 이력, Explorer·아키텍처·결정·제품/UI·동등성·인계·검증 문서.

### 재현·검증 상태

- 수정 전에는 release 사용자가 ZAP helper를 얻으려면 저장소를 clone해야 했고, Codex 설치·로그인 뒤 기존 readiness 캐시를 즉시 다시 검사하는 조작이 없었다. JDK 26으로 소스 빌드했을 때 POM은 거부했지만 기존 doctor는 `21 이상`을 허용하는 계약 불일치도 재현했다.
- JDK 21.0.12.1·Maven 3.9.16에서 전체 `mvn clean verify` 2회가 성공했다. 매회 Java 352 tests 중 opt-in provider 1 skip, failures/errors 0, React 38 files/242 tests와 typecheck·notices·Vite build가 통과했다.
- Bash 5개는 `bash -n`·`shellcheck`를 통과했다. 실제 로컬 `doctor.sh --mode explorer --build`는 Codex 경로·로그인·Web·Maven·JDK를 모두 통과했고, 기본 JDK 26에서는 정확히 실패했다. Windows PowerShell parse는 CI 계약이며 현재 macOS에 `pwsh`가 없어 실기기 실행은 미확인이다.

### 남은 gate

- 검증 기록 직전 입력의 반복 `clean package`에서 JAR과 bundle SHA-256이 각각 동일했다. 깨끗한 임시 디렉터리에 bundle을 풀어 JAR·한/영 가이드·실행 권한·ZAP key helper·Compose 구성·Explorer doctor를 clone 없이 확인했다. 이 결과를 기록한 최종 문서 입력도 같은 방식으로 다시 package한다.
- 실제 Burp에 최종 JAR을 load/unload하고 Windows에서 bundle·doctor·Docker helper를 실행하는 운영 gate는 자동 테스트와 구분해 남긴다. app-server dynamic tool은 experimental이므로 설치된 Codex 버전 호환 실패는 Explorer 화면에서 차단·원인 표시하며 모든 향후 CLI 호환을 보장하지 않는다.

## 2026-09-07 · D-128 판정 없는 독립 LLM Explorer

### 개발·필요성·기각안

- D-126에서 제거한 Judge/MCP/브라우저 하네스를 복원하지 않고, endpoint·method·parameter·계정별 응답과 workflow 단서를 실제 LLM HTTP Evidence로 남기는 Explorer를 새로 구현했다. `ExplorerCoordinator`, 메모리 계정 vault, form/JSON 인증 runtime, exact-scope HTTP gateway, Codex app-server provider를 서로 분리했다.
- 모델에는 opaque 계정 handle과 dynamic HTTP tool만 제공한다. 자격증명과 live Cookie/token은 Java 메모리에서만 주입하고 로그인 준비 교환은 Record·payload·ledger·snapshot·프로젝트에 저장하지 않는다. 대상이 반환한 콘텐츠는 지시가 아닌 비신뢰 입력으로 다룬다.
- 직접 shell curl은 안전 sandbox에서 loopback gateway에 도달하지 못하는 것을 실측했다. 모델 네트워크를 넓히면 exact-scope gateway 우회가 가능해 기각하고, 공식 app-server의 experimental `dynamicTools`/`item/tool/call` 계약을 Java가 처리하는 구조로 바꿨다. MCP·Chrome/Playwright·API key·Node 직접 설치를 사용자 요건으로 다시 넣지 않았다.
- React에 Explorer 화면과 실행 피드를 추가하고 기존 Runs·점검·대시보드에서 Judge가 아닌 Explorer로 연결했다. 실행 중 elapsed/시도/응답/Evidence/미해결/실패를 구분하고 steer·취소를 제공한다.
- `BoundedHttpCapture`와 `ProjectStore`의 발견용 HTML/JavaScript/JSON/XML 상한을 4MiB로 맞춰 1.4MiB 번들 회귀를 닫았다. 임의 wrapper나 runtime-only lazy chunk의 의미 추출까지 해결했다고 주장하지 않는다.

### 영향 파일

- 코드: `src/main/java/io/flowscope/explorer/*`, `src/main/resources/explorer/explorer-system.md`, `FlowScopeExtension`, `FlowScopeWebServer`, `BoundedHttpCapture`, `ProjectStore`.
- UI: `frontend/src/features/explorer/*`, 실행·점검·대시보드·route/API/query 계약.
- 테스트: Explorer vault/auth/gateway/coordinator/provider 하네스, Web API, 대형 응답, React 실행 화면.
- 문서: README, architecture, decisions, Explorer 사용법, HANDOFF, 시작/제품/UI/Surface/검증/변경 이력.

### 검증 상태

- 같은 최종 입력에서 `mvn clean verify` 2회를 실행해 매회 React 38 files/241 tests와 Java 350 tests 중 opt-in 1 skip, failures/errors 0을 확인했다. 두 JAR은 31,626,205 bytes, 9,130 entries와 SHA-256 `762728bff34d9d4d9d9f3a695d43fc5ed6ede25a9900c6db552affdcc268d87b`로 동일했다.
- 일반 suite에서 skip되는 provider 하네스를 `-Dflowscope.harness=true`로 별도 실행해 설치·로그인된 실제 Codex app-server의 dynamic HTTP tool 호출과 구조화 결과를 확인했다. 전체 명령·한계는 [beta-validation](beta-validation.md)에 기록했다.
- 실제 Burp에 새 JAR을 재로드한 anonymous·HTML form·JSON token 전체 실행, Windows 실기기, 외부 독립 corpus 효능은 아직 수행하지 않았다. 자동 테스트나 provider 프로토콜 확인을 실환경 발견률로 표현하지 않는다.

### 다음 gate

새 JAR을 실제 Burp에서 로드해 계정별 로그인, exact-scope, Evidence 귀속, 취소/정리와 UI 피드를 확인한다. 그다음 개발 corpus와 분리된 승인 대상에서 HUMAN·ZAP 대비 추가 endpoint/parameter, 중복/노이즈, 요청량과 검토시간을 측정한다.

## 2026-09-07 · D-127 문서 전수 정합성 및 현재 진행상황 분리

### 변경·필요성·기각안

- 기존 추적 Markdown 33개와 새 인계 보존본·문서 전수 목록 2개를 대상으로 현재 계약·진행·검증·역사 지위를 대조했다. 현재 HANDOFF를 다시 쓰고 이전 기준선 이하 본문은 `handoff-2026-09-04.md`로 보존했다. 문서별 처리와 범위는 [documentation-status](documentation-status.md)에 기록한다.
- 한·영 README·설치·기여·보안·변경 이력, 한국어 설계·Surface·제품 계획·개요·UI 근거/동등성·제거 계획·검증/결정 기록을 맞췄다. 삭제된 Judge/MCP/closed-world 실행·최종 verdict·Active Scan 승인 실행 안내를 정정했다. H/S/L source와 HUMAN Request Lab의 VALIDATION phase를 구분했다.
- AGENTS/CLAUDE/기여 지침에 작업 시작·중간 결과/차단·검증·인계 시 상태를 기록하는 규칙을 넣었다. CLAUDE의 기존 사용자 인계 문단은 유지했고 beta.39 실행 안내는 현행 D-126으로 정정했다. 비공개 멘토 보고서는 수정·커밋 대상이 아니다.
- 연구·제안·원 명세·superpowers UI 계획/설계는 관련된 폐기 계약을 상단에서 명시하고 본문을 보존했다. 옛 모든 버전·테스트 수를 최신 값으로 일괄 치환하는 대안은 검증 기록을 왜곡하므로 기각했다. 현재 상태 전체를 각 문서에 복제하지 않고 HANDOFF로 모았다.

### 코드 대조에서 드러난 것

- JS parser 상한은 4,194,304자이며 문서의 1,048,576자는 낡은 값이었다. 그러나 `BoundedHttpCapture.previewLimitFor` → `FlowScopeExtension.recordFrom` → `RequestRecord.responseBodyForAnalysis` → route/Surface 경로에서 보존 상한 초과 응답은 `body/respText` 8,192자 재절단 때문에 전체 분석문을 잃는다. helper/parser 단위 성공을 live 전 구간 완료로 설명하지 않도록 정정했다. **코드 경로 확인이며 새 실패 테스트·수정·실환경 재현은 이번에 하지 않았다.**
- DataFlow는 최근 producer의 exact-token index를 사용하며 옛 substring/모든 쌍 비교 설명은 맞지 않았다. ZAP capability는 전체 scope+target union이고 Alert 20,000개 상한은 캠페인 전체, Passive 정체는 queue 감소 기준임을 현행 소스와 대조했다. 한국어 기여 안내의 JDK 21 이상은 빌드 Enforcer와 충돌해 JDK 21 정확히로 수정했다.
- 이전 인계의 기타 세션·신원·병합·프로젝트 교체·XML/IPv6 결함은 이번에 일괄 재현하지 않았으므로 재검증 대기로 승계했다. 해결/현존을 자동 판정하지 않았다.

### 이번에 실제 수행한 검사

- 최종 점검: 관리 Markdown 35개가 전수 목록과 일치하고 로컬 파일/디렉터리 링크 217개가 모두 존재한다. 역사 인계의 이전 기준선 이하 본문은 이동 전과 문자열 동일하며, 기존 사용자 CLAUDE 인계 문단도 보존했다. `git diff --check` 통과, src/frontend/pom/scripts/infra 변경 0. 링크 검사는 로컬 경로 존재 검사이며 외부 URL 응답이나 모든 heading anchor·코드 주장의 실증 검사는 아니다.
- 기존 `target/flowscope-1.2.0-beta.44.jar` SHA-256 재확인: `acfeb7c745f69040239eca77f0933e76d3588338e18683979b050d44498bd981`, D-126 기록과 일치.
- 이번에는 `mvn clean verify`, React/브라우저 테스트, Burp/ZAP 실제 실행, 대상 요청, 외부 문헌 재조사, 원격 조회·push를 하지 않았다. 이전 Java 335 / React 238 / packaged E2E 8 결과를 이번 문서 검증으로 복제하지 않았다.

### 남은 gate

큰 발견용 응답의 전달 회귀 작성·수정, 새 JAR의 실제 Burp/HUMAN/로그인·ZAP capability/복수 계정/취소·Request Lab·저장/재열기·unload, Windows 운영 검증이 남아 있다. Client-only와 새 Explorer/제품 MCP는 미착수다. 코드·실환경 검증 없이 문서 정리를 제품 완료로 보고하지 않는다.


## 2026-09-07 · MCP 제거 후 빈 디렉터리 정리

- D-126에서 설정·프롬프트 파일을 삭제한 뒤 로컬에 비어 있던 `agent-workspace/.codex`, `agent-workspace/prompts`, `agent-workspace` 디렉터리까지 제거했다. Git은 빈 디렉터리를 추적하지 않으므로 파일 삭제 커밋과 별개로 로컬 정리가 필요했다.
- 비어 있음을 확인한 정확한 경로에만 `rmdir`를 사용했다. 현재 제품 소스와 `target`에 MCP 이름의 파일/디렉터리 또는 agent-workspace 잔여물이 없는지 확인했다. 의존성·별도 작업트리를 포함한 재귀 삭제는 작업 손상 위험 때문에 하지 않았다.
- 코드·빌드 산출물은 변경하지 않았으며 전체 빌드를 다시 실행하지 않았다. 직전 D-126 산출물의 검증 기록은 그대로다. 별도 `.claude/worktrees/*` 체크아웃, 서드파티 의존성 내부 MCP 구현, 사용자 전역 설정은 정리 대상이 아니다. 빈 디렉터리는 필요하면 다시 만들 수 있고 이전 추적 파일은 Git 이력에 남아 있다.

## 2026-09-07 · 미출시 D-126 · Judge·Explorer 하네스와 MCP 실제 제거

### 개발·수정

- 사용자 결정은 기존 Judge와 하네스 MCP를 완전히 없애고, Explorer는 별도 하네스로 재설계하며 FlowScope Evidence용 MCP는 나중에 설계하는 것이다. 이번에는 새 MCP, 대체 HTTP 하네스나 이름만 바꾼 실행기를 만들지 않았다.
- `5a47af9`의 독립 `ZapCampaign`을 유지하고 `McpServer`, `LocalMcpToken`, `LocalLlmRunner`, `ControlledBrowserExplorer`, `RouteCandidateViews`, `agent-workspace` 설정/프롬프트를 삭제했다. MCP 전용 ZAP 개별 도구 wrapper와 호출부 없는 Active Scan adapter도 제거했다.
- Burp 호스트의 MCP/CLI 기동·로그인 검사·닫기/잠금 callback, Web 세 실행 API, React/legacy 실행·후속 질문·미리보기 제어, doctor의 CLI/MCP 검사를 제거했다. 계정 연결 안내가 제거된 LLM 실행을 약속하지 않도록 바꿨다.
- HUMAN 수집, ZAP 캠페인 시작/상태/취소, Session Broker, Request Lab, exact-scope/capability, Surface·분류·그래프·인가 분석은 유지했다. Client와 AJAX는 기존 순서 그대로이며 Client-only 전환은 하지 않았다.
- 기존 프로젝트의 assessment는 독립 `LegacyAssessment` 기록으로 옮겼다. JSON schema v4/SQLite schema v3와 필드 형식을 유지하고 과거 validation·Evidence·run manifest·실행 원장·human review를 보존한다. 삭제된 Judge 결론은 현재 규칙 후보에 합치지 않고 `snapshot.legacyLlm`의 read-only 이력으로 제공한다. React는 이력/현재 후보를 분리하고 없는 Evidence 참조를 명시한다.

### 필요성·기각 대안

버튼만 숨기면 MCP 리스너·CLI 프로세스와 내부 실행 경로가 살아남고 ZAP/저장소의 의존성도 남는다. 따라서 transport와 실행기 자체를 제거했다. 반대로 Source.LLM·구버전 enum·평가 데이터를 함께 지우면 프로젝트를 열거나 다시 저장할 때 사용자의 이력이 소실되므로 기각했다. 신규 하네스/MCP 설계를 섞거나 AJAX까지 한꺼번에 교체하는 것은 이번 승인 범위를 넘어가므로 하지 않았다.

### 영향 파일

- 실행/저장: `FlowScopeExtension`, `ZapCampaign`, `ZapClient`, `ProjectStore`, `SqliteProjectStore`, `Standalone`, `LegacyAssessment`, `ValidationDecision`, `SourceTrustPolicy`, `LaneCompletionPolicy`.
- Web/UI/배포: `FlowScopeWebServer`, `SnapshotJsonWriter`, `FlowScopeControlTab`, legacy `web/index.html`, React inspection/runs/scenarios/dashboard/topbar와 API/query 계약, `pom.xml`, `scripts/doctor.sh`/`.ps1`.
- 회귀: `RetiredHarnessTest`, `LegacyLlmArchiveTest`, `ZapCampaignRegressionTest`, 기존 Campaign/Web/Store/ControlTab/Phase/Trust/Completion/final-JAR 테스트와 React component·E2E 테스트.
- 문서: 한·영 README/설치·보안·기여·변경 이력, AGENTS, 한국어 architecture/decisions/인계/제품 개요·계획/제거 계획/UI rationale·parity/문서 목차/검증 기록. 이전 백엔드 장기 계획의 폐기된 Judge/MCP 지시는 상단에서 superseded로 표시했다. 역사 연구·원 명세를 일괄 다시 쓰지 않았다.
- 사용자 변경 `CLAUDE.md`와 미추적 멘토 보고서는 보존하고 이 변경의 커밋에서 제외한다.

### 재현 회귀와 검증 범위

- 삭제 전 negative regression은 `McpServer` 클래스가 남아 실패했다. 삭제 후 classpath 및 최종 shaded JAR에 실행기/transport/agent-workspace가 없음을 검사한다. 인증된 옛 Web 실행 API의 GET/POST는 404다.
- 기존 MCP 테스트 중 ZAP 캠페인 13개를 실제 `ZapCampaign.State` 경계로 옮겼다. scope·승인·계정 격리·capability 누락·진행·passive 정체·cleanup·취소는 FakeZap 계약 회귀이며 실물 ZAP 성공을 뜻하지 않는다.
- 취소 fixture는 최초 start 응답 직전에 취소해도 이미 시작된 crawler의 stop을 기대하던 race를 발견했다. 첫 status poll(서버가 scan ID를 인계받은 시점)을 확인한 뒤 취소하도록 바꿔 소유권이 확정된 crawler 정리를 검사한다. 시작 API 전송 중 취소 레이스 자체는 이번에 해결하거나 실증하지 않았다.
- archive 회귀는 현재 finding과 같은 ID의 옛 CONFIRMED를 복원해도 현재 scenarios가 그대로임을 확인하고 JSON → SQLite 왕복 후 평가·판정·Evidence ID가 유지되는지 검사한다. 샘플 payload는 저장 경계가 요구하는 정규 마스킹을 적용했다.
- 브라우저 E2E 최초 실행은 테스트용 Chromium 부재로 실패했고 격리된 임시 cache에 테스트 브라우저만 준비했다. 기존 테스트의 기본 route 가정은 현재 기본 `#surface`와 달라 dashboard 검사는 `#dashboard`를 명시했다. 삭제된 평가 문구/생성 버튼 기대를 현재 규칙 후보·Evidence 링크로 바꿨다. 실제 fixture 네트워크·console·active-route·secret-storage 경계는 유지했다.
- 최종 `mvn clean verify` 동일 소스 2회는 각각 Java 335 / React 238 tests 통과, 두 JAR SHA-256 일치. 해당 최종 JAR의 standalone Chromium E2E 8 / 8도 통과했다. 명령·환경·해시는 [beta-validation](beta-validation.md)의 D-126 절에 실제 수행 결과만 기록한다. 이전 389 Java/266 React 수치보다 줄어든 주된 이유는 삭제된 실행기의 테스트를 함께 제거했기 때문이며, ZAP 회귀는 위와 같이 독립 유지했다.

### 남은 한계·다음 gate

실제 Burp 재로드와 실물 ZAP Client/AJAX 헤더·로그인 계정 격리·취소, Request Lab 실제 전송은 수행하지 않았다. 사용 중인 Burp/ZAP에 명령을 보내지 않았고 외부 타깃도 요청하지 않았다. 다음은 새 JAR의 실환경 보존 기능 점검이며, 새 Explorer 하네스·FlowScope용 MCP·Client-only는 각각 별도 설계/승인 범위다. 사용자 전역 모델 설정/인증 파일은 변경하지 않았다. 이전 버전의 실행 프로세스와 포트가 실제로 닫히는 것은 운영자가 옛 확장을 unload/reload한 뒤 확인해야 한다.


## 2026-09-04 · 1.2.0-beta.44 · SPA 번들 분석 상한, 정적 자산 frontier 제외, 익명 run 계정 인자 모순

### 개발·수정

실제 Explorer 실행이 정상 종료했지만 수집 4건이 모두 정적 자산·문서였고 메인 비교 대상은 0건이었다. 원인 셋을 실측으로 분리했다.

- **번들 분석 상한(두 겹).** crAPI `main.js`는 1,655,900 bytes이고 경로 문자열 58개가 모두 1MB 지점 이후에 있었다. 캡처는 보존 상한 1MB를 넘으면 앞 64KB만 디코딩해 분석문으로 남기고, JS 분석기는 자체적으로 1,048,576자를 넘으면 `LIMIT_EXCEEDED`를 낸다. 둘 중 하나만 올리면 효과가 없다. `BoundedHttpCapture.previewLimitFor`가 javascript·json·html·xml 응답에만 분석문 상한을 4MB로 올리고(`flowscope.payload.discoveryPreviewBytes`), `MAX_SCRIPT_CHARS`를 4,194,304로 올렸다. **보존 상한 1MB는 그대로**라 초과 응답은 여전히 metadata-only이며 "전문 보존"을 주장하지 않는다. 파싱 비용은 기존 `MAX_NODES`(250,000)가 계속 제한한다.
- **정적 자산 frontier.** `pendingConcretePaths`가 CSS·폰트·이미지·미디어 경로를 실행 값에서 제외한다. `TrafficClassifier.looksLikeNonDiscoveryAssetPath`가 기존 `ASSET_EXTENSIONS`에서 `js`·`mjs`·`map`을 뺀 집합으로 판단한다. JavaScript와 source map은 endpoint 선언을 담으므로 남긴다. 이 한 지점이 `pending_concrete_paths`·`pending_targets`·`actionableRoutes`·완료 게이트를 모두 덮으므로 제시·예산·완료가 함께 해결된다.
- **익명 run 계정 인자.** 런처 프롬프트가 익명 run에 `Selected Explorer account_id: ANONYMOUS`라고 알려 주고, 서버는 그 값을 계정 전환 시도로 거부했다. 우리가 만든 모순이다. 프롬프트를 "이 run은 익명이며 account_id를 보내지 마라"로 바꾸고, 계정이 지정된 경우에도 "run이 이미 고정하므로 보내지 마라"로 통일했다. 서버는 익명 run에서 `ANONYMOUS` 문자열을 빈 값으로 정규화하고, 거부 메시지에 현재 run의 계정을 적어 원인을 드러낸다.

### 필요성·기각 대안

- `MAX_PAYLOAD_BYTES`를 전역으로 올리는 방식은 모든 대용량 응답을 레코드마다 보존해 20,000건 상한과 함께 메모리를 크게 늘리므로 기각했다. 보존은 그대로 두고 분석문만 넓혔다.
- 정적 자산을 후보 목록에서 통째로 지우는 방식은 사용자가 대상 구성을 보지 못하게 하므로 기각했다. `concrete_paths`에는 남고 실행 값에서만 빠진다.
- `js`까지 자산으로 묶어 제외하는 방식은 endpoint 발견 자체를 없애므로 기각했다.
- 익명 표식을 서버에서만 정규화하고 프롬프트를 두는 방식은 잘못된 안내가 남으므로 기각했다. 근본은 프롬프트이고 정규화는 보조다.

### 영향 파일·회귀

- 코드: `BoundedHttpCapture.java`(`previewLimitFor`), `FlowScopeExtension.java`(응답 캡처 호출), `JavascriptCallSiteAnalyzer.java`(`MAX_SCRIPT_CHARS`, 상한 문구를 상수 기반으로), `TrafficClassifier.java`(`looksLikeNonDiscoveryAssetPath`, `DISCOVERY_ASSET_EXTENSIONS`), `McpServer.java`(`pendingConcretePaths` 필터, 익명 정규화와 메시지), `LocalLlmRunner.java`(프롬프트 계정 문장).
- 테스트: `JavascriptCallSiteAnalyzerTest` — 1MB 이후 call site 해석, 상한 초과는 여전히 `LIMIT_EXCEEDED`. `BoundedHttpCaptureTest` — 스크립트는 보존 상한을 넘겨도 분석문에 1MB 이후 call site를 담고 payload는 metadata-only 유지, 비발견 미디어는 프리뷰 상한 불변. `McpServerTest` — CSS·폰트가 `pending_targets`에서 빠지고 `.js`는 남으며 익명 run이 `ANONYMOUS` 인자를 거부하지 않음. `LocalLlmRunnerTest` — 프롬프트에 `Never pass account_id`가 있고 옛 문구가 없음.
- 문서: decisions D-122, beta validation, changelog 한·영, 이 기록.

### 최종 검증

- 집중 회귀 통과. 전체 수치는 `beta-validation.md`에 기록한다.

### 남은 한계·다음 gate

- crAPI `main.js`에는 API 경로가 애초에 없다. 화면 경로 58개만 있고 실제 API 호출은 화면 렌더링 시 로드되는 chunk에 있다. 상한을 올리면 화면 경로는 보이지만 **API는 여전히 안 보인다**. 번들에서 얻은 화면 경로를 브라우저로 순회해 chunk를 끌어내는 일은 별도 작업이며 프롬프트·서버 안내를 함께 바꿔야 한다.
- 4MB 분석문은 JavaScript 응답이 많은 대상에서 상주 메모리를 늘린다. 실제 Burp에서의 측정은 아직 없다.

## 2026-09-04 · 1.2.0-beta.44 · 통제 요청 `target`의 절대 URL 계약과 route 후보의 실행 가능 URL

### 개발·수정

- 실제 Explorer 실행에서 모델이 `flowscope_target_read`의 `target`에 `/chatbot/genai/state` 같은 상대 경로를 넣어 `SCOPE_BLOCKED`로 실패했다. `target` 스키마에는 `type: string` 외 설명이 없었고, `flowscope_list_route_candidates`는 `service`와 `pending_concrete_paths`를 따로 주어 모델이 둘을 이어 붙여야 했다. 상대 경로는 `ScopePolicy.allows`에서 조용히 거짓이 되어 형식 오류가 범위 차단으로 보였다.
- `target` 스키마(`flowscope_target_read`, `flowscope_target_request`, `flowscope_browser_navigate`)에 절대 URL 계약과 상대 경로 거부를 설명으로 넣었다. route 후보 출력에 `pending_targets`(= `service` + 각 `pending_concrete_paths`)를 추가해 모델이 그대로 `target`에 쓰게 했다.
- `requireAbsoluteTarget`이 scope 검사보다 먼저 `http://`·`https://`가 아닌 `target`을 형식 오류로 거부하고, 사유에 `pending_targets` 사용을 안내한다. 원장에는 `INVALID_REQUEST`로 남아 실제 범위 밖 요청(`SCOPE_BLOCKED`)과 구분된다.
- `AGENTS.md`와 `prompts/explorer.md`의 실행 값 안내를 `pending_targets`로 바꾸고 상대 경로 금지를 명시했다. 탐색 순서와 도구 목록은 바꾸지 않았다.

### 필요성·기각 대안

- 서버가 상대 경로를 scope의 첫 entry에 자동으로 붙여 주는 방식은 모델이 어느 host를 뜻했는지 추정하는 것이라 기각했다. exact scope에 host가 둘 이상이면 오귀속이 된다.
- 스키마 설명만 추가하고 출력은 그대로 두는 방식은 모델이 여전히 문자열을 조립해야 해 같은 실수가 남으므로 절대 URL을 서버가 만들어 준다.

### 영향 파일·회귀

- 코드: `McpServer.java`(스키마 설명, `pending_targets`, `requireAbsoluteTarget`), `agent-workspace/AGENTS.md`, `agent-workspace/prompts/explorer.md`.
- 테스트: `McpServerTest` — 후보 출력의 `pending_targets`가 `service + 경로`이고, 상대 경로 `target`이 `absolute URL`·`pending_targets`를 담은 오류로 거부되며 원장에 `SCOPE_BLOCKED`가 아니라 `INVALID_REQUEST`로 남고, `tools/list` 스키마에 설명이 있는 회귀. 이 회귀는 수정과 함께 작성했으며 수정 전 상태에서는 세 단언 모두 성립하지 않는다.
- 문서: decisions D-121, beta validation, changelog, 이 기록.

### 최종 검증

- 집중 회귀 `McpServerTest` 40건 통과. 전체 수치는 `beta-validation.md`에 기록한다.

### 남은 한계·다음 gate

- 실제 Burp에서 Explorer가 `pending_targets`를 그대로 쓰는지, 상대 경로 실패가 0건이 되는지는 재실행으로 확인해야 한다.
- 브라우저 워커 요청은 여전히 실행 원장에 들어가지 않는다.

## 2026-09-04 · 1.2.0-beta.44 · LLM 작업 피드의 실패 표시·한국어 행동명·경과 시간

### 개발·수정

- 실제 Explorer 실행에서 `flowscope_target_read`가 11번 실패했는데 작업 피드에는 전부 `COMPLETED`로 찍혔다. `publishCodexEvent`가 이벤트 종류(`item.completed`)만 보고 상태를 정하고 item 안의 `"status":"failed"`를 읽지 않았기 때문이다. 이제 item의 `status`와 `error`를 읽어 실패는 `FAILED`로 남기고, 결과의 `{"error":...}` 값이나 텍스트 앞부분을 마스킹·절단해 사유로 보여 준다. Claude stream-json의 `tool_result.is_error`도 같은 방식으로 사유를 남긴다.
- 도구 이름을 한국어 행동명으로 바꾼다(`toolLabel`). `flowscope_target_read`는 `대상 읽기`, `flowscope_browser_navigate`는 `브라우저 열기` 등이며 모르는 이름은 원문을 둔다. 인자 중 `method`와 `target`(또는 `evidence_id`)만 제목에 붙이고 헤더·본문·계정은 표시하지 않는다.
- `Activity`에 실행 시작 기준 경과(`elapsedMillis`)와 도구 호출 하나의 소요(`durationMillis`, item id·tool_use id로 시작 시각을 기억)를 추가했다. `llmStatus` JSON은 `elapsed_ms`·`duration_ms`를 내보낸다.
- 런처 프롬프트 머리말에 운영자용 메시지(진행 메모·요약·최종 보고)를 한국어로 쓰라는 지시를 넣었다. 도구 이름·URL·메서드·Evidence ID는 원문을 유지한다. `AGENTS.md`와 역할 프롬프트는 건드리지 않았다.
- React 실행 화면은 그동안 작업 피드를 전혀 그리지 않고 상태와 출력 tail만 보여 줬다. LLM 탭에 피드 목록을 추가해 경과 시간, 상태 배지(실패는 빨강), 행동명, 소요 시간, 사유를 표시한다. legacy 화면은 서버 필드를 그대로 받지만 새 필드를 그리지는 않는다.

### 필요성·기각 대안

- 도구 인자·결과 원문을 통째로 보여 주는 방식은 인증 헤더·본문·토큰이 피드에 남으므로 기각했다. method·URL·오류 사유만 마스킹해 노출한다.
- 실패 여부를 출력 tail에서 사용자가 직접 읽게 두는 현재 방식은 1,500자 안에 실패 항목이 없으면 원인을 볼 수 없어 기각했다.
- 한국어 지시를 `AGENTS.md`에 넣는 방식은 진단 규칙 문서와 표시 언어를 섞으므로 런처 머리말에만 둔다.

### 영향 파일·회귀

- 코드: `LocalLlmRunner.java`(`Activity`, `addActivity`, `publishCodexEvent`, `publishClaudeEvent`, `toolLabel`·`toolDetail`·`toolFailureReason`, `prompt`), `FlowScopeExtension.java`(`llmStatus` 직렬화), `frontend/src/lib/api/types.ts`, `frontend/src/features/runs/RunsPage.tsx`.
- 테스트: `LocalLlmRunnerTest` — 실패한 Codex 도구 item이 `FAILED`·한국어 행동명·사유·소요 시간으로 남고 비밀이 남지 않으며 프롬프트에 한국어 지시가 있는 회귀. 기존 피드 테스트는 원문 이름 대신 행동명을 단언한다. `RunsPage.test.tsx` — 피드가 행동명·실패 사유·경과·소요를 렌더링하는 회귀.
- 문서: decisions D-120, beta validation, changelog, ui-product-rationale, 이 기록.

### 최종 검증

- 집중 회귀와 전체 `mvn clean verify` 수치는 `beta-validation.md`의 해당 gate에 기록한다.

### 남은 한계·다음 gate

- Codex `--json` 이벤트의 `item.status`·`error` 필드 형태는 로컬 CLI 버전에서 관측한 것이다. 필드가 없는 버전에서는 이전처럼 완료로 보이므로, 실제 Burp 재실행에서 실패 항목이 빨갛게 보이는지 확인해야 한다.
- 브라우저 워커 페이지 로드는 여전히 실행 원장에 들어가지 않는다. `target` 절대 URL 계약 명시는 별도 작업 단위다.

## 2026-09-04 · 1.2.0-beta.44 · 통제 요청 Evidence ID 누락과 Explorer 완료 교착 수정

### 개발·수정

- 실제 Burp에서 Codex Explorer를 두 번 실행했더니 둘 다 `LLM이 활성 run을 정상 종료하지 않았습니다`로 실패했다. 스냅샷에는 그 run의 `CONTROLLED` HTTP 200 Evidence가 각각 9건·12건 있었는데 실행 원장은 `시도 11·응답 0·실패 11`(`SCOPE_BLOCKED` 1, `INVALID_REQUEST` 10)과 `시도 12·응답 0·실패 12`(`INVALID_REQUEST` 12)였다. 두 번째 run에는 `HEAD /`와 `OPTIONS /chatbot/genai/state`가 있어 브라우저 워커가 아니라 `flowscope_target_read`가 실제로 실행된 것이었다.
- 원인은 확장의 통제 실행기가 `rebuildImmediately()`(`Pipeline.runIsolated`) 뒤에 원본 `record.evidenceId`를 돌려주는데, 격리 분석은 복사본에만 `EvidenceIds.assign`을 적용해 원본 ID가 항상 `null`이었던 것이다. `RunExecutionLedger.Attempt`는 `HTTP_RESPONSE`에 Evidence ID를 요구하므로 `recordExecution`이 예외를 던졌고, 그 지점이 `attemptRecorded = true` 앞이라 catch가 같은 요청을 `INVALID_REQUEST`로 다시 적은 뒤 모델에 오류를 돌려줬다. 그 결과 `end_run`의 `ALL_FAILED` 거부가 응답 Evidence보다 먼저 걸려 run을 닫을 수 없었다.
- 세 곳을 고쳤다. 통제 실행기는 레코드를 추가한 잠금 안에서 원본 목록에 `EvidenceIds.assign`을 적용해 돌려주는 ID를 확정한다(격리 분석 복사본은 같은 `contentDigest`로 그 ID를 유지한다). `McpServer.targetRequest`는 대상이 응답한 직후 `attemptRecorded`를 세워 이후 원장 기록 실패를 요청 실패로 다시 적지 않는다. `assertExplorerHarnessComplete`는 `LaneCompletionPolicy`를 먼저 평가하고, 응답 Evidence가 없을 때만 `ALL_FAILED`로 완료를 거부한다.

### 필요성·기각 대안

- `Attempt`의 Evidence ID 검증을 풀어 `HTTP_RESPONSE`에 `null`을 허용하는 방식은 원장과 Evidence의 역참조를 끊으므로 기각했다. 원장의 목적이 응답 Evidence와 실패를 분리하는 것이라 ID 없는 응답 기록은 그 목적과 모순된다.
- `rebuildImmediately`를 `Pipeline.run`(제자리 정규화)으로 바꾸면 UI·MCP가 읽는 게시본과 수집 DTO가 다시 섞여 격리 분석을 둔 이유가 사라지므로 기각했다. 원본에는 ID만 붙이고 분석은 복사본에서 계속한다.
- `ALL_FAILED` 거부를 없애는 방식은 D-116이 막으려던 "전부 실패했는데 완료"를 다시 허용하므로 기각했다. 응답 Evidence가 없을 때는 여전히 거부한다.

### 영향 파일·회귀

- 코드: `FlowScopeExtension.java`(통제 요청 경로), `McpServer.java`(`targetRequest`, `assertExplorerHarnessComplete`).
- 테스트: `McpServerTest` — 실행기가 응답은 돌려주고 Evidence ID가 비어 있을 때 원장에 `INVALID_REQUEST`가 남지 않고 `flowscope_end_run`이 성공하는 재현 회귀. `EvidenceIdsTest` — 원본에 먼저 부여한 ID가 `Pipeline.runIsolated` 스냅샷 복사본과 같은 값으로 유지되는 회귀.
- 문서: decisions D-119, beta validation, changelog, 이 기록.

### 최종 검증

- 수정 전 재현 테스트는 `outcome=INVALID_REQUEST, status=0, evidenceId=null`로 실패했고 수정 후 두 테스트가 통과했다.
- 전체 회귀 수치는 `beta-validation.md`의 해당 gate에 기록한다.

### 남은 한계·다음 gate

- 실제 Burp에서 같은 대상으로 Explorer를 다시 실행해 원장이 `RESPONSES_OBSERVED`로 집계되고 `end_run`이 정상 종료되는지 확인해야 한다. 이번 수정은 자동 회귀와 실패 재현으로만 검증했다.
- 같은 실행에서 확인된 별개 결함은 아직 남아 있다. `flowscope_target_read`의 `target` 스키마에 절대 URL 계약 설명이 없고 route 후보 출력이 `service`와 경로를 따로 주어 모델이 상대 경로를 넣었다(`SCOPE_BLOCKED` 1건). 작업 피드는 도구 호출의 실패 상태와 사유를 표시하지 않는다. 별도 작업 단위로 다룬다.

## 2026-09-04 · 1.2.0-beta.44 · 빌드 JVM 경계와 MR-JAR 전수 검증 복구

### 개발·수정

- 동일 소스의 JDK 21/26 JAR 차이를 엔트리 단위로 재현했다. 차이는 React/Node 산출물이 아니라 javac가 만든 FlowScope class 30개였으므로 Maven Enforcer 3.6.3으로 소스 빌드를 JDK 21·Maven 3.9.x에 한정했다. JDK 26은 lifecycle 초기에 원인을 포함한 메시지로 실패한다.
- React PR에 있던 결정적 MR-JAR writer와 `MultiReleaseJarRelocatorTest`를 복구했다. 모든 version root의 Jackson·jsoup·SnakeYAML뿐 아니라 미래 Closure versioned class도 shaded 경로로 옮기며 source→target map, 원 namespace 부재, target 존재, 단일 timestamp와 동등 입력 byte equality를 검사한다.
- 반복 release 검증 중 `npm ci`가 registry audit 연결 뒤 로그·CPU 진척 없이 정체되는 현상을 두 번 관측했다. lockfile 기반 설치는 유지하고 `--prefer-offline --no-audit --fund=false`로 package lifecycle에 불필요한 audit/funding 네트워크를 분리했다. 변경 뒤 동일 설치가 5초에 완료됐다.
- 검증 문서의 SHA-256을 임의 환경의 기대값이 아니라 명시한 JDK 21.0.12·Maven 3.9.16 산출물의 식별값으로 한정했다. Burp runtime의 Java 21+와 source build의 JDK 21 계약을 분리했다.

### 필요성·기각 대안

- `--release 21`만으로 충분하다는 가정은 JDK 26에서 정확히 194-byte 차이가 재현돼 기각했다. Node/Vite 원인 가설도 React asset이 byte-identical이어서 기각했다.
- CI의 원 namespace grep만 유지하면 로컬 verify와 source→target 완전성이 약하다. 반대로 dependency version 디렉터리를 숫자로 나열하면 새 MR root에 취약하므로 모든 root를 순회하는 writer와 합성 미래 version 회귀를 사용한다.
- 현재 자료는 임의 운영체제·vendor·JDK patch 간 동일 해시를 증명하지 않는다. 이를 완료로 꾸미지 않고 canonical release builder와 독립 rebuild는 후속 release gate로 남긴다.

### 영향 파일·회귀

- 코드·빌드: `pom.xml`, `FatJarIsolationSmoke.java`, `MultiReleaseJarRelocatorTest.java`, `ci.yml`.
- 문서: README와 한·영 시작 가이드, architecture, decisions D-118, HANDOFF, changelog, 제품 계획, beta validation, 이 기록.
- 실패 재현: 같은 Mac에서 JDK 21.0.12 JAR `31,525,631 bytes/7aa41c…`와 JDK 26.0.2 JAR `31,525,437 bytes/028897…`; entry 집합·metadata 동일, Java class 내용 30개 차이, 압축 크기 합계 -194 bytes, frontend 내용 차이 0.

### 최종 검증

- 기본 JDK 26.0.2 `mvn validate`는 Enforcer의 JDK 21 요구 메시지로 예상 실패했다.
- JDK 21.0.12·Maven 3.9.16에서 합성 MR-JAR 회귀 2/2와 전체 React 265 tests·Java 374 tests를 통과했다. 같은 고정 환경의 `mvn clean verify`를 연속 두 번 수행해 JAR byte equality를 확인했으며 정확한 size·entry·SHA-256은 `beta-validation.md`에 기록한다.

### 남은 한계·다음 gate

- JDK major 오사용은 차단했지만 vendor·patch·운영체제가 다른 독립 환경의 bit-for-bit 재현은 아직 수행하지 않았다. Release 게시 전 canonical builder를 고정하고 독립 rebuild compare를 별도 gate로 수행한다.
- 이 수정은 실제 Burp HUMAN/ZAP/LLM·세션·Request Lab runtime gate를 수행하지 않았다. React 통합의 다음 기능 gate는 그대로 유지한다.

## 2026-09-04 · 1.2.0-beta.44 · React 분석 작업면과 최신 코어 통합

### 개발·수정

- PR #8의 React·TypeScript·Vite 화면과 정적 자산 파이프라인을 beta.44 코어 위에 통합했다. `/`와 `/app/`는 React, `/legacy/`는 기존 UI이며 기본 route는 `API·입력 차이`다.
- React가 서버 snapshot의 `surface`와 `runExecutions`를 직접 읽어 endpoint·parameter 선언/관측 차이, H/S/L 필터, provenance·parser issue, 통제 요청의 시도·응답·실패를 표시한다. 실패 시도는 관측 endpoint나 그래프 edge로 합성하지 않는다.
- Dashboard에서 누락됐던 LLM source를 복구하고, 점검·실행 화면의 단계 번호를 완료율로 표현하지 않는다. Evidence 표는 행 선택만으로 사용하지 않는 operation 원문 묶음을 선조회하지 않고 Request Lab을 열 때 선택한 하나의 bounded draft만 요청한다.
- 그래프의 identity/resource/source가 같아도 GET과 PATCH 같은 operation edge를 분리했다. 여러 판정이 합쳐진 노드는 첫 event 판정 대신 `UNKNOWN`을 표시하고, route candidate source 비교는 대소문자를 정규화하며 identity filter 중에는 신원 없는 후보를 숨긴다.
- beta.44의 bounded snapshot은 cluster 전체 Evidence ID 배열을 보내지 않는데 React 그래프가 해당 배열을 필수로 가정해 `#graph` 전체가 비는 실화면 회귀를 발견했다. 배열이 없으면 representative `eventId`를 선택 근거로 쓰도록 수정하고 회귀를 추가했다.

### 필요성·기각 대안

- PR은 beta.25 기반이어서 Java·Maven·LLM/ZAP 코드를 통째로 병합하면 beta.26~44의 세션 격리, Surface, 실행 실패 원장과 JAR 빌드 계약이 후퇴한다. 따라서 React source·정적 자산 전송만 선택적으로 통합하고 현재 코어를 정본으로 유지했다.
- 그래프 회귀를 고치기 위해 cluster 전체 Evidence ID를 snapshot에 다시 싣는 대안은 반복 polling payload를 고카디널리티로 되돌리므로 기각했다. 대표 ID는 즉시 선택에 사용하고 전체 cluster 열람은 기존 bounded `/api/cluster-evidence` 계약을 유지한다.
- 단계 번호를 퍼센트로 꾸미거나 혼합 판정을 첫 event로 대표하는 대안은 서버가 증명하지 않은 의미를 화면이 만들기 때문에 사용하지 않았다.

### 영향 파일·회귀

- 코드: `frontend/`, `pom.xml`, `ClasspathWebAssets`, `LoopbackHttpServer`, `FlowScopeWebServer`, `Standalone`, `FlowScopeExtension`, `FatJarIsolationSmoke`.
- 회귀: React 37개 test file의 265 tests, `graphProjection.test.ts`의 bounded snapshot cluster-member 부재 회귀, Java 372 tests와 fat-JAR release smoke.
- 문서: README, architecture, decisions D-117, UI 제품 근거, React 기능 동등성, 제품 계획, changelog, 이 검증 기록.

### 최종 검증

- 고정된 최종 입력에서 JDK 21로 `mvn clean verify`를 연속 두 번 실행했다. 매회 React 37 files/265 tests와 Java 372 tests가 failure/error/skip 없이 통과했다.
- 두 `target/flowscope-1.2.0-beta.44.jar`는 31,525,631 bytes·9,125 entries·첫 entry `META-INF/MANIFEST.MF`·SHA-256 `7aa41c27ea33c0129ed706a1f9b18f9bca9dcf6e9e3314c7442315382278dee0`로 byte-for-byte 동일했다.
- 최종 standalone을 no-cache URL로 열어 Surface source 필터, Dashboard, Graph canvas, Runs, Evidence, Accounts, Inspection, Matrix, Sequence, Scenarios와 `/legacy/`를 전환했고 새 browser warning/error는 0건이었다. `/`·`/app/` 200, `/app` 308→`/app/`, `/legacy/` 200과 React JS/CSS의 fat JAR 포함도 확인했다.

### 남은 한계·다음 gate

- standalone 샘플은 실제 Burp Montoya, HUMAN 수집, ZAP 캠페인, Codex/Claude, 관리 세션과 live Request Lab 전송을 검증하지 않는다. beta.44 JAR을 Burp에 재로드해 이 경로를 확인하기 전에는 실제 runtime 동등성이나 legacy 제거를 주장하지 않는다.
- Vite는 minified main JS 1,046.59 kB(gzip 316.16 kB)에 대해 500 kB 초과 경고를 낸다. 현재 기능 오류는 아니지만 초기 로드 성능 측정 뒤 route 단위 code splitting 여부를 결정한다.
- Vitest의 jsdom은 Cytoscape canvas `getContext` 미구현 진단을 출력하지만 회귀는 통과한다. 실제 canvas는 standalone 브라우저에서 별도로 렌더와 오류 0건을 확인했다.

## 2026-09-03 · 1.2.0-beta.44 · LLM 통제 요청 실패와 0건 발견 분리

### 개발·수정

- MCP 통제 HTTP executor의 실행 시도를 `RunExecutionLedger`에 최대 5,000건 보존하고, 반복 polling되는 Web snapshot에는 최근 100개 run의 집계만 노출한다. HTTP 응답이 생긴 시도만 기존 `RequestRecord`·Evidence로 유지하고 TLS·DNS·timeout·연결·무응답·scope 차단·승인 거부·입력 거부는 typed outcome으로만 기록한다.
- run 품질을 `NOT_ATTEMPTED`, `ALL_FAILED`, `PARTIAL_FAILURE`, `RESPONSES_OBSERVED`로 계산한다. 전부 실패한 Explorer는 Evidence 완료 gate 전에 명시적으로 거부하고, 부분 실패 run은 완료 limitation을 남긴다.
- Web LLM 실행 상태와 기본 `API·입력 차이` 요약에 시도·응답·실패 수를 표시한다. 실패는 source 관측선이나 endpoint Evidence를 만들지 않는다.
- JSON project schema를 v4, SQLite storage schema를 v3으로 올려 실행 원장을 저장·재열기한다. JSON v1/v2, SQLite v1/v2는 계속 읽고 JSON v3 exact completed run도 신뢰를 잃지 않고 복원한다.

### 필요성·기각 대안

- 기존에는 응답 전 오류가 `RequestRecord`를 만들지 않아 즉시 CLI 실패 문구가 사라진 뒤 “LLM이 신규 endpoint를 발견하지 않음”과 “요청 전부 전송 실패”를 구분할 수 없었다. 일부 성공 뒤 나머지가 실패하면 성공 Evidence만 남는 문제도 있었다.
- 실패를 `hasResponse=false` Evidence로 넣는 대안은 그래프와 source delta를 오염시키므로 기각했다. raw 예외/CLI 로그 저장도 인증정보 노출과 비결정 문자열 의존 때문에 기각했다.

### 영향 파일·회귀

- 코드: `RunExecutionLedger`, `McpServer`, `FlowScopeExtension`, `ProjectStore`, `SqliteProjectStore`, `FlowScopeWebServer`, `SnapshotJsonWriter`, Web UI.
- 테스트: `RunExecutionLedgerTest`, `McpServerTest`, `ProjectStoreTest`, `SqliteProjectStoreTest`, `SnapshotJsonWriterScaleTest`, `FlowScopeWebServerTest`.
- 재현: LLM executor가 TLS failure만 반환하는 run, 응답 1건 뒤 timeout인 run, query에 비밀값이 있는 target, 저장·재열기를 회귀로 추가했다. 고정된 최종 입력에서 `mvn clean verify`를 연속 2회 실행해 매회 356 tests가 failure/error/skip 없이 통과했고 두 beta.44 JAR의 SHA-256이 일치했다. 정확한 산출물 수치는 `beta-validation.md`를 따른다.

### 남은 한계·다음 gate

- 실제 Burp Montoya가 운영체제별 TLS·DNS·timeout에서 반환하는 예외 유형은 beta.44 JAR로 수동 재현해야 한다. 미분류 예외는 `OTHER_FAILURE`로 안전하게 남는다.
- 이 원장은 MCP 통제 HTTP executor 범위다. 브라우저 discovery와 ZAP은 각각 기존 run/campaign 상태 기계를 사용하며, 향후 공통 실행 모델로 합치려면 실제 운영 요구와 마이그레이션 계획이 먼저 필요하다.

## 2026-09-03 · 1.2.0-beta.43 · JavaScript URL 해석 정확도와 검토면 정리

### 목표와 성공 조건

- object map과 axios instance를 범용 JavaScript 문법 근거로 해석하되 shadowing·재할당·동적 설정에서 거짓 endpoint를 만들지 않는다.
- parser 성공과 call-site 완전 해석을 구분하고, 미해석 원인을 사용자가 Evidence와 source line으로 확인할 수 있게 한다.
- 기본 Surface 작업면에서 인가용 제어를 치우고 사용자 용어를 `접근 대상 ID`로 정리하되 기존 Resource/owner/BOLA·BFLA 분석을 바꾸지 않는다.

### 개발·수정

- Closure `Scope/Var` 기반 lexical resolver로 불변 literal·object member, bracket member, template·단순 결합을 처리한다. 같은 이름의 지역·외부 binding을 분리하고 재할당된 binding/property는 초기값으로 해석하지 않는다.
- 실제 axios import/direct client와 `axios.create` instance를 구분한다. 정적 instance `baseURL`, 요청별 `baseURL`·`allowAbsoluteUrls` override와 absolute URL 결합을 적용하며 동적 baseURL에서는 틀린 상대 endpoint를 만들지 않는다.
- `DYNAMIC_URL`, `UNRESOLVED_MEMBER_REFERENCE`, `UNRESOLVED_AXIOS_BASE_URL`, `UNRECOGNIZED_APPLICATION_WRAPPER`, `UNSUPPORTED_INTERPROCEDURAL_FLOW`를 산출물별 typed issue로 추가했다. Surface snapshot과 Web 요약은 issue 수·Evidence·line·detail을 표시한다.
- 왼쪽 제어 rail을 Surface/shared, 인가/shared, raw/shared 문맥으로 나눴다. 기본 Surface에는 Surface·source만, 인가 화면에는 인가 제어만 보인다. 화면의 `객체` 용어는 `접근 대상 ID`로 바꿨지만 내부 모델은 유지했다.

### 이유와 기각한 대안

- 전역 변수명 map은 lexical shadowing을 구분하지 못하고, 재할당된 `let`·object property의 초기값을 현재 URL로 오인할 수 있어 사용하지 않았다.
- 동적 axios baseURL을 무시하고 `/inst`를 실제 endpoint처럼 올리면 검토 노이즈가 증가하므로 후보 대신 해석 실패로 남긴다. 임의 wrapper 실행·이름 사전도 대상 코드 실행과 target tuning 문제 때문에 넣지 않았다.
- Resource를 삭제하면 BOLA/IDOR의 접근 대상과 owner 관계가 사라지므로 데이터 모델은 보존하고 사용자 표현만 바꿨다.

### 영향 파일

- 코드: `JavascriptAnalysis.java`, `JavascriptCallSiteAnalyzer.java`, `SurfaceAnalysis.java`, `SurfaceAnalyzer.java`, `McpServer.java`, `index.html`
- 회귀: `JavascriptCallSiteAnalyzerTest.java`, `SurfaceAnalyzerTest.java`, `FlowScopeWebServerTest.java`, `McpServerTest.java`
- 문서: README, architecture, decisions D-115, Endpoint·Parameter Surface, 제품 계획, UI 근거, 한·영 시작·변경 이력, 인계·검증 기록

### 재현과 검증

- 실패 우선 회귀에서 object member call-site가 0건이고 axios instance가 baseURL 없이 `/items`로 나오는 것을 재현했다. 동적 baseURL·재할당 URL은 거짓 endpoint 대신 typed issue가 되어야 한다는 회귀도 추가했다.
- 집중 분석기·Surface·Web 테스트를 통과했다. OpenJDK 26.0.2에서 Java `release 21` 대상으로 전체 `mvn clean verify`를 연속 두 번 실행해 매회 349 tests, failure/error/skip 0을 확인했다. 두 JAR은 31,081,416 bytes·9,105 entries·첫 entry `META-INF/MANIFEST.MF`·SHA-256 `f783066814e577efce4fb2e42dceb4ce3a11482c6bd574fbaf6e00a2e8cef4f6`로 동일했다.
- standalone을 no-cache URL로 열어 기본 Surface rail `surface/shared`, 인가 화면 `auth/shared`, `접근 대상` 용어, sample endpoint 4개·입력 field 5개를 확인했다. 화면 전환 뒤 browser warning/error는 0건이었다.

### 남은 한계·다음 gate

- 함수 간 data flow, axios defaults mutation·interceptor, 임의 application wrapper, source map, 미수신 lazy chunk와 서버 전용 route는 미지원이다. HTTP-like wrapper issue도 전체 wrapper 탐지율을 보장하지 않는다.
- 저장소 내부 구조 회귀는 실제 앱의 precision/recall 또는 진단 시간 개선 증거가 아니다. 실제 Burp 재로드와 독립 corpus/pilot은 별도 gate다.

## 2026-09-03 · 1.2.0-beta.42 · AST 기반 선언 추출과 실패 가시성

### 목표와 성공 조건

- beta.41의 값 없는 endpoint·parameter fact를 유지하면서 JavaScript 정규식 추출을 실행 없는 구조 분석으로 교체한다.
- HTTP 관측, OpenAPI·HTML form·JavaScript call-site, GraphQL operation/variable을 같은 좌표에 정렬하되 target·업무명 사전으로 튜닝하지 않는다.
- 분석하지 못한 산출물을 0건 성공처럼 보이지 않게 하고, 개발 입력과 분리된 truth fixture로 지원·비지원 경계를 고정한다.

### 개발·수정

- 고정 버전 Closure Compiler의 `ECMASCRIPT_NEXT` parser로 `fetch`, 실제 XHR binding, axios, jQuery, `sendBeacon`, 정적·동적 import를 실행 없이 분석한다. 정적 문자열·template·단순 결합과 bounded `const/let` 참조만 해석하고 임의 application wrapper는 추정하지 않는다.
- HTML navigation과 client asset을 API surface에서 제외하고 route inventory에만 남겼다. 공통 `script/modulepreload/preload/prefetch`를 처리하며, Next.js pages-router `__BUILD_MANIFEST`는 API를 발명하지 않고 client chunk만 연결한다.
- GraphQL 요청은 `POST /graphql#operationName`과 `variables` field로 정렬하고 transport의 `query`·`operationName`은 입력 파라미터에서 제외한다.
- `surface.extractions`에 산출물별 정상·부분·실패·입력/AST 상한, 실패 범주, Evidence ID와 추출 수를 추가하고 Web `API·입력 차이` 화면에 표시한다.
- JavaScript 분석 cache는 128개 LRU로 제한하고 원문 대신 SHA-256 digest를 key로 사용한다. dataset 교체·초기화·sample load 때 cache를 비운다.
- analyzer에 전달하지 않는 `surface-heldout/truth.json`에서 endpoint 7개, parameter 18개, client asset 5개 exact set과 application wrapper 1개 비지원을 회귀로 고정했다.

### 이유와 기각한 대안

- 정규식을 계속 늘리면 중첩 괄호·호출 경계·alias·modern syntax를 안정적으로 구분하지 못한다. 반대로 대상 JavaScript 실행이나 Node/Chrome 의존은 공격 대상 코드를 실행하고 설치면을 넓혀 기각했다.
- Next/Nuxt/Angular route 이름을 API로 바꾸는 규칙은 공개 asset 관계 이상의 의미를 추측하므로 넣지 않았다. 공통 HTML/ESM으로 부족한 것이 fixture에서 확인된 Next pages manifest의 chunk 연결만 전용 adapter로 추가했다.
- held-out fixture는 회귀에는 유효하지만 같은 저장소에 있는 합성 truth이므로 실제 일반화 성능이나 프레임워크 지원 Tier의 근거로 사용하지 않는다.

### 영향 파일

- 코드: `JavascriptAnalysis.java`, `JavascriptCallSiteAnalyzer.java`, `JavascriptRouteDiscoveryAdapter.java`, `NextBuildManifestDiscoveryAdapter.java`, `HtmlRouteDiscoveryAdapter.java`, `RouteCandidate.java`, `RouteCandidateExtractor.java`, `SurfaceAnalysis.java`, `SurfaceAnalyzer.java`, `Standalone.java`, `FlowScopeExtension.java`, `index.html`
- 빌드·회귀: `pom.xml`, `ci.yml`, `NOTICE.txt`, `FatJarIsolationSmoke.java`, `JavascriptCallSiteAnalyzerTest.java`, `SurfaceAnalyzerTest.java`, `SurfaceHeldOutEvaluationTest.java`, discovery corpus와 held-out fixture
- 문서: README, architecture, decisions D-114, Endpoint·Parameter Surface, 제품 계획·개요·연구·제안·기능명세·UI 근거, 한·영 시작 가이드와 변경 이력, 인계·검증 기록

### 재현과 검증

- 집중 회귀와 최종 `mvn clean verify`를 연속 두 번 실행했다. 매회 340 tests, failure/error/skip 0이었다.
- 두 clean build 모두 `target/flowscope-1.2.0-beta.42.jar`, 31,069,397 bytes, 9,099 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `c8f53c170058a4803730e2419660ff77e21603ad9506f0156c54951623651a58`로 동일했다.
- fat JAR에서 relocated Closure 6,846 entries, 원래 `com/google/javascript/` 0 entries, Closure 고지와 `META-INF/LICENSE.txt`, `THIRD_PARTY_NOTICES`를 확인했다. inline Web JavaScript도 `node --check`를 통과했다.
- standalone `127.0.0.1:17779` 합성 sample에서 beta.42·`API·입력 차이`, endpoint/parameter 목록과 extraction summary, LLM source 해제 시 해당 관측 제거, 기존 인가 그래프 전환을 확인했다. 브라우저 warning/error는 0건이었다.

### 남은 한계·다음 gate

- 1~4는 구현·자동 회귀와 standalone 화면 gate를 통과했다. 5는 저장소 내부 합성 truth의 구조 회귀이고, 6은 parser/limit과 일부 해석 실패 분류, 7은 Next.js pages-router manifest의 chunk 연결, 8은 공통 asset/GraphQL 관측 회귀까지만 확인했다. beta.42에서 이를 “1~8 완료”라고 묶은 표현은 외부 효능과 framework 지원 범위를 과장하므로 beta.43에서 정정했다.
- 실제 Burp 확장 재로드, 실제 bundle의 precision/recall·검토량·성능, source map·Next App Router 내부 manifest·GraphQL schema는 검증하지 않았다. 9는 사용자가 승인한 외부 exact scope가 없어 미실행이고, 10의 지원 Tier는 외부 pilot 결과 전에는 정하지 않는다.
- Vue/Nuxt·Angular는 표준 HTML/ESM asset 발견까지만 확인했다. 제품 전용 adapter가 필요한지는 pilot 실패 사례를 먼저 분류한 뒤 결정한다.

## 2026-09-03 · 1.2.0-beta.41 · 범용 Endpoint·Parameter Surface Delta

### 목표와 성공 조건

- 제품 첫 화면이 판정 기계보다 먼저 “HUMAN·SCANNER·LLM 중 누가 어떤 endpoint와 parameter를 관측했고 무엇이 현재 미관측인가”에 답해야 한다.
- 특정 target, host, 업무명 또는 프레임워크 이름에 맞춘 규칙 없이 HTTP 위치와 명시 schema/markup/script 문법만 사용해야 한다.
- 기존 Resource/owner/BOLA·BFLA Fact와 판정은 삭제하거나 바꾸지 않고 API 상세층에 유지해야 한다.

### 개발·수정

- `SurfaceAnalysis`에 값 없는 Endpoint/Parameter fact와 `DECLARED_NOT_OBSERVED` 등 중립 delta 상태를 정의했다.
- `SurfaceAnalyzer`가 실제 query/path/중첩 JSON/form-urlencoded/multipart 입력과 OpenAPI/Swagger local `$ref`, HTML form, 정적 JavaScript literal URL/query/direct request-object key를 추출한다.
- `SnapshotJsonWriter`가 `surface` projection을 제공하고 동일 revision·동일 입력에서는 분석 결과를 재사용해 1초 polling마다 대형 선언 산출물을 다시 파싱하지 않는다. Standalone도 record service에서 route candidate를 재생성한다.
- Web 기본 작업면을 `놓친 API·입력`으로 바꾸고 endpoint별 H/S/L 관측, parameter 위치·형태, Declaration/Evidence provenance를 표시한다. 기존 화면은 `인가 그래프`로 명확히 이름 붙여 유지했다.
- 최종 UI 점검에서 source checkbox를 꺼도 Surface 행·상태·상세 Evidence가 전체 source 기준으로 남는 결함을 재현했다. parameter observation을 Evidence/source/run/identity/status/shape 단위로 보강하고, 체크된 source만 행 badge·delta·통계·상세 Evidence에 반영하도록 수정했다.

### 이유와 기각한 대안

- 정상 요청만 나열하면 아직 실행되지 않은 조건부 입력을 알 수 없으므로, 실제 관측과 대상이 명시한 선언을 서로 다른 fact로 보존했다.
- Resource 노드를 삭제하는 대안은 BOLA 교차 접근과 owner Evidence를 잃어 기각했다. 반대로 모든 객체를 첫 화면에 유지하면 고카디널리티 노이즈가 endpoint·parameter 차이를 가려 상세층으로 내렸다.
- target별 사전, URL 업무명 가중치, React/Next 식별 분기는 보지 못한 대상에 일반화되지 않아 사용하지 않았다. 동적 JavaScript를 regex로 추측하는 대신 직접 확인되는 literal만 선언하고 나머지는 미확정으로 둔다.
- 별도 SQLite surface 테이블은 같은 Evidence에서 파생되는 데이터를 이중 정본화하므로 만들지 않고 snapshot 시 결정론적으로 재생성한다.

### 영향 파일

- 코드: `SurfaceAnalysis.java`, `SurfaceAnalyzer.java`, `SnapshotJsonWriter.java`, `Standalone.java`, `index.html`
- 회귀: `SurfaceAnalyzerTest.java`, `FlowScopeWebServerTest.java`, 버전 계약의 `McpServerTest.java`
- 문서: README, architecture, decisions D-113, 기능명세 F-25, UI 근거, 제품 개요·계획, 시작 가이드, 변경 이력, 인계·검증 기록

### 재현과 검증

- 회귀는 query/중첩 JSON shape와 H/S/L source, OpenAPI path/query/JSON·form-urlencoded·multipart requestBody, HTML form, 정적 JavaScript literal query/body key, 다른 문장의 객체 key 오귀속 방지, snapshot/UI 계약을 고정한다.
- 최종 `mvn clean verify`를 연속 두 번 실행해 매회 330 tests, failure/error/skip 0을 확인했다. 두 JAR은 16,062,971 bytes·2,082 entries·첫 entry `META-INF/MANIFEST.MF`·SHA-256 `2f3902f0178a3b53db3f1ec8c8e86ce8533cf7fd0384197e8926482ad2bf4c1b`로 동일했다.
- standalone `127.0.0.1:17779` 샘플에서 기본 Surface 작업목록, LLM 소스 체크 해제 전후 `H 관측·L 관측·두 출처`가 `H 관측·L —·관측됨`으로 바뀌고 상세 Evidence도 H만 남는 것, API 상세의 선언 provenance·파라미터 표면, 기존 인가 그래프 전환을 직접 확인했다. 브라우저 warning/error는 0건이었다.
- 이 자동 회귀는 실제 diverse target의 precision/recall, lazy chunk 전체, 동적 JavaScript data-flow 또는 실제 Burp 사용성 향상을 증명하지 않는다.

### 남은 한계·다음 gate

- 개발 corpus와 분리된 server-truth fixture, route·field semantic-renaming, lazy chunk 포함/미포함 조건으로 endpoint/parameter precision·recall을 측정한다.
- 실제 Burp에서 기존 HUMAN/ZAP/LLM 필터, Evidence 상세, 인가 그래프·매트릭스가 함께 회귀하지 않았는지 확인한다. standalone 확인은 Burp 확장 런타임 검증을 대체하지 않는다.
- JavaScript AST/source-map, GraphQL schema, framework manifest adapter는 blind 효능이 현재 literal adapter보다 나은 경우에만 별도 수직 단위로 추가한다.

이 문서는 작업 단위로 **무엇을 개발했는지, 무엇을 수정했는지, 왜 수정했는지, 어떤 파일이 영향을 받았는지, 어떻게 검증했는지, 무엇이 아직 남았는지**를 기록하는 정본이다.

릴리스 사용자 변경점은 루트 `CHANGELOG.md`, 현재 동작은 `architecture.md`, 설계 선택과 기각 이유는 `decisions.md`, 실제 수행한 검증과 미검증 범위는 `beta-validation.md`가 각각 정본이다. 같은 내용을 모든 문서에 복사하지 않고 이 문서에서 관련 정본을 연결한다.

현재 작업 디렉터리는 사용자 승인으로 Git `main` 저장소가 됐고 `origin`은 `https://github.com/choewonwoo1817/testflowscope.git`에 연결되어 있다. 초기화 전 1.2.0-beta.3의 정확한 파일별 변경 순서는 복원하지 않으며, 기존 `CHANGELOG.md`와 `decisions.md`를 역사 기록으로 유지한다. 아래 beta.3 기록은 현재 코드·테스트·문서와 2026-08-25 검증 결과를 대조해 작성했다.

## 2026-09-02 · 1.2.0-beta.40 · Explorer 1~10 실행 계약과 concrete frontier

**개발·수정**

- **재현된 결함:** 응답에서 발견한 `/orders/42`를 `/orders/{id}`로 정규화하면서 실제 `42`가 route 후보에서 사라졌다. 완료 gate는 중괄호 template을 실행 불가능으로 제외했기 때문에 Explorer가 객체 경로를 발견하고도 요청하지 않은 채 종료할 수 있었다. 또한 긴 실행을 취소할 때 provider parent에 `destroy()`만 호출해 하위 프로세스 종료 완료를 확인하지 않았다.
- **template/concrete 분리:** `RouteCandidate`에 bounded `concretePaths`와 초과 표시를 추가했다. template은 endpoint 정렬·표시에, 실제 응답에서 추출한 path+query와 이미 관측된 request의 path+query는 HTTP 실행·방문 확인에 쓴다. 최초 수정 점검에서 관측 요청 query가 `addObserved`에서 누락돼 이미 방문한 URL이 pending으로 남는 회귀를 발견해 함께 수정했다. 후보당 200개를 보존하며 인증성 query가 탐지되면 raw query를 버리고 path만 남긴다. 값이 없는 OpenAPI template에는 임의 ID를 만들지 않는다. JSON project와 Web snapshot도 같은 필드를 보존한다.
- **서버 강제 1~10:** route API가 `pending_concrete_paths`, endpoint/object/function/workflow `review_dimensions`, `explorer_guidance.next_action`을 반환한다. 한 응답의 후보·남은 개수·guidance는 동일 snapshot에서 계산한다. INDEPENDENT concrete frontier가 남으면 ASSISTED 전환을, 어느 safe concrete가 남으면 종료를 거부한다. HTML script 신호는 격리 브라우저를 조건부 discovery 보조로 권고하지만 HTTP executor 재현만 Evidence다. 권고된 rendered discovery 미사용·불가와 실제 값 없는 dynamic template은 `PARTIAL_WITH_LIMITATIONS`로 반환한다.
- **prompt·불신 입력:** Explorer prompt를 범위/계정 고정과 첫 Evidence부터 독립 인벤토리, route 분류, 저영향 요청, BOLA/IDOR, BFLA, workflow, 승인 write, Evidence/control, blind assisted·한계 보고까지 10단계로 고정했다. 대상 응답·DOM·tool output은 지시가 아닌 불신 데이터로 취급한다.
- **프로세스 종료:** 취소·확장 unload·시작 경합이 알려진 descendants를 leaf-first로 정상 종료하고 parent를 종료한 뒤 1초 기다린다. 남은 프로세스는 강제 종료하고 다시 1초 안에 실제 종료를 확인한다. 확인 실패는 성공이나 취소가 아닌 복구 안내가 있는 실패다.

**왜 필요했고 무엇을 기각했는가**

- template만 남기는 방식은 고카디널리티 표시는 정리하지만 실제 객체 탐색을 막는다. 반대로 ID별 endpoint를 모두 분리하면 그래프와 인벤토리를 다시 오염시키므로 표시 template과 실행 concrete 값을 분리했다. schema placeholder를 LLM이 추측하는 방식은 존재하지 않는 객체를 꾸미므로 기각했다.
- 브라우저-first는 API-only 대상의 비용·노이즈를 늘리고 UI가 호출하지 않는 API를 놓친다. HTTP-only는 SPA runtime 경로를 놓칠 수 있어 API-first와 조건부 browser discovery를 결합했다. 브라우저 결과를 바로 Evidence로 올리지 않고 controlled HTTP 재현을 요구한다.
- prompt만으로 단계 준수를 주장하지 않는다. 서버가 강제할 수 있는 frontier·Evidence·완료 조건은 구조화 응답과 gate로 고정하고, BOLA/BFLA/logic 의미 검토는 후보 차원으로 남겨 status만으로 verdict를 만들지 않는다.

**영향 파일·회귀·남은 gate**

- 코드: `RouteCandidate.java`, `RouteCandidateExtractor.java`, `RouteCandidateViews.java`, `McpServer.java`, `ProjectStore.java`, `SnapshotJsonWriter.java`, `LocalLlmRunner.java`; 역할 지침: `agent-workspace/AGENTS.md`, `agent-workspace/CLAUDE.md`, `agent-workspace/prompts/explorer.md`.
- 회귀: `RouteCandidateExtractorTest.java`, `ProjectStoreTest.java`, `McpServerTest.java`, `LocalLlmRunnerTest.java`, 새 `ExplorerEndpointHarnessTest.java`. 문서: `README.md`, `architecture.md`, `decisions.md`, `product-development-plan.md`, `product-overview.md`, 시작 가이드, 한·영 CHANGELOG, agent workspace, `HANDOFF.md`, 이 기록.
- 집중 회귀는 두 object ID+query 보존, 이미 관측한 request query 보존, secret query 제거, 200개 상한/초과 표시, project round-trip, concrete frontier 요청 전 종료 거부, rendered limitation 반환과 provider process-tree 종료를 통과했다. 매 실행 새 포트의 실제 local HTTP fixture는 HTML→외부 script→API/object 연쇄 발견, exact-scope 밖 링크 제외와 POST 묵시 실행 금지를 통과했다.
- 전체 `mvn clean verify`를 연속 두 번 실행해 매회 324 tests, failure/error/skip 0을 확인했다. 두 JAR은 16,025,306 bytes·2,066 entries·첫 entry `META-INF/MANIFEST.MF`·SHA-256 `b472c9eae70afd4dd6d818af576e458570ac9b3116e2dc288ee6a62f0bf4ff55`로 동일했다.
- 이 검증은 실제 Burp Session Broker, 실제 Codex/Claude 장기 Explorer 완주, SPA 브라우저 recall 또는 endpoint/finding precision·recall을 증명하지 않는다. 실제 Codex/Claude 즉시 취소 smoke는 해당 실행의 잔존 process/workspace가 없음을 확인했지만 장기 run을 대체하지 않는다. descendants는 종료 시작 시점 snapshot이라 이후 분리된 daemon까지 운영체제 수준으로 소유·종료함을 증명하지 않는다.

## 2026-09-02 · 1.2.0-beta.39 · ZAP capability 실패 원인화와 blocking 단계 heartbeat

**개발·수정**

- **재현된 결함:** SYSTEM ZAP 요청의 capability 누락은 Burp 8081에서 안전하게 drop됐지만 캠페인 상태에는 원인이 없었다. Replacer/outgoing proxy 전달이 깨지면 crawler가 0건으로 끝날 때까지 기다린 뒤 일반적인 수집 실패만 보였다. `newSession`·Context/passive 설정과 API 정의 import의 동기 호출 중에는 status poll이 없어 10초 뒤 `NO_HEARTBEAT`처럼 보였다.
- **출처 실패 조기 종료:** Burp listener가 활성 run의 capability 거부 요청 수를 메모리에서 계수한다. McpServer는 Traditional·Client·AJAX status poll, Passive poll, 정의 import 경계에서 이를 확인해 한 건이라도 있으면 다음 crawler·신원으로 진행하지 않고 `FAILED`로 끝낸다. 상태 API와 Web은 차단 건수와 `Replacer/outgoing proxy` 확인 원인을 그대로 표시한다. 누락 요청을 받아들이는 fallback은 계정·run 오귀속을 만들므로 추가하지 않았다.
- **blocking 단계 liveness:** 세션 설정과 정의 import 동안 별도 daemon scheduler가 5초 간격 worker heartbeat를 갱신한다. 실제 원격 응답과 혼동하지 않도록 상태는 `응답 대기/응답 수신`, Web age는 `작업 신호`로 표현한다. stage elapsed/deadline과 capture progress는 기존대로 별도 유지한다.
- **문서 정합성:** D-051의 “AJAX inScope/subtreeOnly 미지원” 문장을 scan ID 없는 상태 조회라는 실제 호환 지점으로 정정하고, D-108 이후 exact-scope 인자 계약을 연결했다. ZAP Replacer 공식 소스의 전역 `HttpSender` listener와 빈 initiator 목록의 전체 적용을 근거로 기록하되, 실제 설치본 end-to-end 전달은 수동 gate로 남겼다.

**영향 파일·회귀·남은 gate**

- 코드: `FlowScopeExtension.java`, `McpServer.java`, `web/index.html`; 회귀: `McpServerTest.java`; 문서: `README.md`, `architecture.md`, `decisions.md`, `ui-product-rationale.md`, `product-development-plan.md`, `beta-validation.md`, `HANDOFF.md`, `CHANGELOG.md`, 이 기록.
- 집중 회귀는 capability 거부 1건이 다음 crawler 전에 terminal failure가 되고 run context가 정리되는 경로와, 1.4초 지연된 `newSession` 동안 worker heartbeat가 갱신되는 경로를 통과했다.
- inline JavaScript `node --check`와 `mvn clean verify`를 연속 두 번 실행해 매회 315 tests, failure/error/skip 0을 확인했다. 두 JAR은 16,018,159 bytes·2,066 entries·첫 entry `META-INF/MANIFEST.MF`·SHA-256 `c1095a2ffdff7f2334cff6fd9aab0fc2ecb8379aca908e44b2e53da9b1662748`로 동일했다.
- 실제 Burp+ZAP 2.17에서 Replacer가 Traditional·Client·AJAX·definition 요청에 capability를 붙이는지는 자동 테스트로 증명하지 않았다. beta.39 JAR 재로드 후 비로그인 첫 lane에서 `출처 검증 차단 0건`과 실제 수집 증가를 확인해야 한다. 소유자 별칭 P0은 이 ZAP 실행 수정과 독립된 다음 작업이다.

## 2026-09-02 · 1.2.0-beta.39 · ZAP 출처·신원 격리·종료 상태 hardening

**개발·수정**

- **재현된 위험:** crawler stop 실패·비동기 stop 직후 다음 계정 전환·마지막 lane cleanup 생략은 이전 신원의 작업이 다음 broker 세션으로 실행될 수 있었다. 캠페인 Future를 버려 바깥 예외나 executor 거부가 `RUNNING`을 고착시킬 수 있었고 사용자 취소가 없었다. 8081 포트만으로 SYSTEM ZAP context를 상속해 native Burp Scanner나 수동 요청도 현재 ZAP run/account/CONTROLLED로 오귀속될 수 있었다.
- **격리·종료:** Traditional·Client·AJAX의 소유 scan ID를 추적하고 stop 뒤 terminal 상태까지 bounded poll한다. 마지막 lane을 포함해 cleanup 실패 시 terminal failure로 남기며, 캠페인 Future·cancel flag를 보존해 Web/MCP 취소가 crawler·Passive·run context를 정리한 뒤 `CANCELLED`를 반환한다. executor 거부와 예상 밖 예외도 terminal 상태를 기록한다.
- **출처 증명:** 캠페인마다 무작위 capability를 만들고 exact target subtree의 ZAP Replacer rule로 request header에 붙인다. Burp 8081 handler는 활성 SYSTEM run과 capability가 일치하는 요청만 broker 주입·CONTROLLED ZAP Evidence로 받아들이고 내부 header를 대상 전송 전에 제거한다. native Burp Scanner는 ZAP context를 상속하지 않는다. Replacer 제거 실패는 원격 rule 식별자를 보존하고 다음 시작 전에 재시도해 stale/new rule 중첩을 막는다. 각 record에 `laneAccountId`를 추가해 JSON/SQLite/snapshot/digest에서 캠페인 run과 실제 계정 lane을 함께 보존한다.
- **범위·상태·입력:** AJAX는 `contextName`, `inScope=true`, `subtreeOnly=true`를 항상 전달하고 standalone Active/Spider도 fresh exact Context를 먼저 만든다. Passive 정체 progress는 queue 감소로만 판정하며 status/API 일시 오류는 bounded retry하고 경계 직후 최종 poll한다. Alert total/page 오류를 완전 snapshot으로 표시하지 않고 캠페인 전체 20,000건 상한을 적용한다. Web status poll 한 번의 실패는 기존 run snapshot을 지우지 않고 별도 경고로 표시한다. HAR 재가져오기는 기존 Evidence와 병합해 동일 파일 반복 import가 record 수를 늘리지 않는다. Web 제어면과 ZAP subtree의 대괄호 IPv6 비교를 수정했지만 XML·계정 전체 IPv6 지원은 완료로 주장하지 않는다.
- **API 운영 경계:** Java와 Bash/PowerShell helper는 API key를 query·프로세스 인자가 아닌 `X-ZAP-API-Key` header로 전송한다. Docker start는 owner-only 임시 config를 사용하고 API address 허용값을 `.*` 대신 loopback과 해석된 host gateway로 제한한다. doctor가 `replacer` add-on도 검사한다.

**왜 필요했고 무엇을 기각했는가**

- 포트·User-Agent·고정 header만으로 source를 판정하면 행위자와 run 수명을 증명하지 못해 기각했다. 고정 sleep 뒤 계정 전환은 실제 crawler quiescence를 확인하지 못한다. ZAP에 캠페인 전체를 위임하면 FlowScope Session Broker·Burp capture·lane 완료 gate와 현재 사용자 진행 계약을 잃는다. 따라서 orchestration은 유지하고 ZAP 공식 Context, crawler status/stop, Replacer, Passive/Alert API를 조합했다.
- Passive `currentTasks` 문자열에는 URL이 포함될 수 있어 URL만 바뀌는 정체가 매초 진행으로 리셋될 수 있다. queue 감소를 progress로, current task를 진단·cleanup 확인으로 분리했다. 일시 통신 오류 한 번에 lane을 폐기하는 방식과 Alert count 실패를 0건 완전 snapshot으로 표시하는 방식도 기각했다.

**영향 파일·회귀·남은 gate**

- 코드·인프라: `FlowScopeExtension.java`, `McpServer.java`, `ZapClient.java`, `RequestRecord.java`, `EvidenceIds.java`, `ProjectStore.java`, `SnapshotJsonWriter.java`, `FlowScopeWebServer.java`, `web/index.html`, `infra/zap/*`, `scripts/doctor*`, `scripts/zap-up*`.
- 회귀: `McpServerTest.java`, `ZapClientTest.java`, `FlowScopeExtensionPhaseTest.java`, `FlowScopeWebServerTest.java`, `ProjectStoreTest.java`, `SqliteProjectStoreTest.java`. 문서: `README.md`, `architecture.md`, `decisions.md`, `ui-product-rationale.md`, `product-development-plan.md`, `beta-validation.md`, `HANDOFF.md`, `CHANGELOG.md`, 이 기록.
- `mvn clean verify`를 연속 두 번 실행해 매회 313 tests, failure/error/skip 0을 확인했다. 두 JAR은 16,016,248 bytes·2,066 entries·첫 entry `META-INF/MANIFEST.MF`·SHA-256 `048c29293dc3d61612bde2a86008d0f2ae11370e26eb604858a54ce17868d852`로 동일했다. `bash -n`은 변경한 shell scripts를 통과했고 API key query 문자열은 남지 않았다.
- 실제 Burp+ZAP 2.17에서 capability가 Traditional/Client/AJAX/definition traffic에 붙는지, 취소·timeout 뒤 crawler quiescence, crAPI 비로그인→로그인 장시간 완료는 아직 수행하지 않았다. 나머지 P2 Session Broker/JWT/merge/project load/LLM child/비UTF-8 XML/IPv6 전체 계약도 이번 작업 범위가 아니며 `HANDOFF.md`에 남긴다.

## 2026-09-02 · 1.2.0-beta.39 · ZAP Passive 정체 복구와 신원별 진행 정본화

**개발·수정**

- **재현:** 실제 화면에서 비로그인 lane은 289건·Alert 45건으로 끝났지만 로그인 `test1` lane은 180건을 수집한 뒤 고정 5분 `ZAP passive scan queue timed out`으로 실패했다. 기존 catch는 이미 수집한 Alert 수를 0으로 표시했고, Passive queue의 남은 수·현재 task와 rendered crawler 정리 여부를 사용자에게 보여 주지 않았다.
- **결정:** 비로그인과 ACTIVE 계정을 fresh ZAP session으로 직렬 격리하는 계약은 유지한다. 각 신원에서 Traditional, Client, AJAX를 모두 실행하고 끝나지 않은 소유 crawler는 stop API로 정리한다. Passive는 queue 감소와 current task 변화를 추적해 절대 30분·무진행 10분까지 기다린다. 정체 시 현재 Alert를 먼저 snapshot하고 Evidence와 함께 `COMPLETED_WITH_WARNINGS`로 보존한 뒤 미처리 queue와 current task가 0인지 확인한다. 확인에 실패하면 후속 신원은 `NOT_RUN`으로 남긴다.
- **사용자 표시:** 캠페인·lane·stage 시간/heartbeat 표시에 `세션 / Traditional / Client / AJAX 보완 / Passive / Alert` 진행선, live Traditional/rendered 수집량, Passive 남은 건수·현재 task, Alert snapshot 완결성을 추가했다. 실제 단계 시작·queue 감소·Alert 집계·격리 정리 결과는 비밀 마스킹된 최대 120건 실행 이벤트로 메모리에만 보존하고 Web에서 1초마다 최신순 표시한다. `Alert 현재 N건 · 집계 미완료`는 부분 snapshot임을 명시하며 취약점 수나 완전한 기준선으로 표현하지 않는다.

**왜 필요했고 무엇을 기각했는가**

- Client가 일부 트래픽을 만들었다는 이유로 AJAX를 생략하면 실행 시간은 줄지만 기존 넓은 기본 기준선을 축소하므로 기각했다. 반대로 rule 비활성화나 기본 response body cap은 장애를 줄여 보이게 하면서 분석 폭을 줄이므로 적용하지 않았다.
- timeout만 늘리는 방식은 정상 진행과 정체를 구분하지 못한다. 수집 결과 전체를 실패로 폐기하는 방식은 이미 관측한 사실을 잃고, dirty Passive 작업을 둔 채 다음 계정을 시작하면 신원 귀속이 섞이므로 기각했다.

**영향 파일·회귀·남은 gate**

- 코드: `McpServer.java`, `ZapClient.java`, `web/index.html`; 회귀: `McpServerTest.java`, `ZapClientTest.java`, `FlowScopeWebServerTest.java`; 문서: `README.md`, `architecture.md`, `decisions.md`, `ui-product-rationale.md`, `product-development-plan.md`, `beta-validation.md`, `CHANGELOG.md`, 이 기록.
- 집중 회귀는 Client 성공 뒤 AJAX 실행, Client 실패 시 stop 뒤 AJAX 전환, Passive 정체에서 Evidence·현재 Alert 보존과 queue cleanup, Passive 전 조기 실패의 cleanup 실패 시 후속 신원 미실행, 상태 API/Web 실행 이벤트 표시를 통과했다. 전체 `mvn clean verify`를 연속 두 번 실행해 매회 306 tests, failure/error/skip 0을 확인했다. 두 빌드의 `target/flowscope-1.2.0-beta.39.jar`는 16,008,341 bytes·2,066 entries·첫 entry `META-INF/MANIFEST.MF`·SHA-256 `816397bb74c962fc25a690023cd574f73374ad28d9ac40e882a9a65f3fe27a24`로 동일했다.
- 실제 beta.39 JAR의 Burp 재로드, crAPI 비로그인→로그인 장시간 전환, 실제 Passive 부분 Alert 차이는 아직 수행하지 않았다. 10분/30분 경계의 대상별 최적성이나 endpoint·취약점 발견률 개선을 자동 회귀로 주장하지 않는다.

## 2026-09-01 · 1.2.0-beta.39 · 그래프·분류·Explorer 완료 gate 회귀 복구

**개발·수정**

- **문제:** API 문맥 없는 401/403 ZAP 디렉터리 probe와 일반 JSON `/manifest.json`이 메인 API 그래프를 오염시켰다. Explorer는 실제로 통제 응답을 받은 login/static route를 coverage 제외라는 이유로 미방문으로 남겼다. 또한 선택형 전체 요약이어야 할 사이트 개요가 기본 그래프를 대체해 `identity → API`를 숨겼다.
- **결정:** 응답·객체·fetch 문맥과 비안전 메서드가 모두 없는 401/403은 `AUTHORIZATION_RESPONSE_ONLY` 근거의 `UNKNOWN/REVIEW`로 보존한다. 실제 JSON API의 403은 API `INCLUDE`를 유지한다. `/manifest.json`은 `WEB_APP_MANIFEST_PATH`로 분리한다. Explorer 방문 사실은 `source=LLM + exact run + controlled response`로 판정하고 메인 분석 자격과 분리한다. Web은 `identity → API`를 기본으로 복구하고 사이트 집계를 선택형으로 유지한다.
- **기각:** 401/403 전부 제외는 protected API 미탐, 전부 포함은 scanner probe 오염을 만든다. `coverageEligible`을 방문 여부로 계속 재사용하는 방식도 서로 다른 질문을 하나의 boolean으로 합치므로 기각했다. 사이트 개요 자체를 삭제하는 대안은 전체 구조 탐색 가치를 잃어 기각했다.
- **코드·회귀·문서:** `TrafficClassifier.java`, `McpServer.java`, `web/index.html`; `TrafficClassifierTest.java`, `McpServerTest.java`, `FlowScopeWebServerTest.java`; `README.md`, `architecture.md`, `decisions.md`, `ui-product-rationale.md`, `product-development-plan.md`, `beta-validation.md`, `HANDOFF.md`, 한·영 사용/변경 문서와 `CHANGELOG.md`.
- **재현·검증:** 최초 회귀에서 `/manifest.json` API 오분류, 403 static directory API 오분류, 제외된 navigation/static route의 Explorer 미방문 종료 거부가 실패하는 것을 확인한 뒤 수정했다. 전체 `mvn clean verify` 303 tests의 failure/error/skip 0을 확인했고, 독립 Web 실행에서 API 기본 선택, 사이트→API 복귀, browser error/warning 0건을 확인했다.
- **남은 한계·다음 gate:** `beta.39` JAR을 실제 Burp에 재로드한 crAPI HUMAN/ZAP/LLM 재실행과 장시간 ZAP 계정 전환은 아직 수행하지 않았다. 실제 탐지 재현성·정확도는 블라인드 benchmark 전까지 주장하지 않는다.

## 2026-09-01 · 1.2.0-beta.38 · ZAP 경과시간·heartbeat·대기 원인

**개발·수정**

- 실제 beta.37 Burp 실행에서 비로그인 AJAX Spider가 약 5분 37초 동안 실행되고 후속 `test1`이 0건 `PENDING`으로 보인 상태를 조사했다. ZAP API 실측은 AJAX `running`, Traditional `100/FINISHED`, passive queue 7이었으므로 프로세스 중단이 아니라 신원별 직렬 실행의 정상 대기였다. 문제는 서버와 UI가 경과시간·deadline·heartbeat·대기 이유를 내보내지 않은 관측 가능성 결함이었다.
- ZAP lane별 queued/started/ended/stage 시작 시각, stage timeout, 마지막 status heartbeat, 마지막 raw capture/status 변화와 현재 status 원문을 메모리에 저장한다. 실행 중 capture count는 heartbeat가 raw store에서 갱신하고 Web 상태 조회는 그 스냅샷을 재사용해 1초 polling마다 전체 Evidence를 중복 순회하지 않는다.
- 상태 API는 campaign/lane/stage elapsed seconds, timeout seconds, heartbeat/progress age, `STARTING`, `RESPONDING`, `RESPONDING_NO_NEW_TRAFFIC`, `NO_HEARTBEAT`, `DEADLINE_EXCEEDED`, queue position/total과 wait reason을 반환한다. API 정의 단계의 제한은 실제 호출 timeout과 맞게 정의 한 건당 2분으로 계산한다.
- Web은 1초 polling마다 전체·단계 경과/최대시간, ZAP 상태·응답 age·트래픽 변화 age를 표시한다. 각 pending 계정에는 대기 순번, 현재 lane 완료 후 시작한다는 이유와 대기시간을 표시한다.

**왜 필요했고 무엇을 기각했는가**

- fresh ZAP session과 scanner run context를 신원별로 교체하는 현재 무결성 계약 때문에 병렬 계정 실행은 기각했다. 계정 병렬화는 cookie/crawler state와 source attribution을 섞을 수 있다.
- heartbeat는 정상이지만 새 traffic이 없는 상태를 자동 실패로 바꾸지 않았다. status API 생존과 탐색 성과는 다른 사실이며, AJAX/Client/Passive가 정상적으로 기다리는 구간도 있기 때문이다.

**영향 파일·회귀·남은 gate**

- 코드: `McpServer.java`, `web/index.html`; 회귀: `McpServerTest.java`, `FlowScopeWebServerTest.java`; 버전과 사용자·아키텍처·결정·검증·계획·인계 문서를 beta.38로 갱신했다.
- inline JavaScript parse와 전체 `mvn clean verify` 299 tests를 연속 두 번 통과했고 failure/error/skip은 모두 0이었다. 두 빌드의 `target/flowscope-1.2.0-beta.38.jar`는 15,997,237 bytes·2,063 entries·첫 entry `META-INF/MANIFEST.MF`·SHA-256 `ce799b0f34dc749fee202a1532f501d9421c9c08794a171af57d0c5e20cba987`로 동일했다. 실제 Burp에서 beta.38을 재로드한 장시간 AJAX → 후속 계정 전환과 timeout 표시는 아직 완료하지 않았다.

## 2026-09-01 · 1.2.0-beta.37 · Explorer 실제 요청 승인과 Graph Observation Fact

**개발·수정**

- `ControlledBrowserExplorer`의 CDP `Fetch.requestPaused`를 권위 있는 상태 변경 경계로 삼았다. GET/HEAD/OPTIONS는 exact scope 안에서 계속 허용하지만 POST/PUT/PATCH/DELETE는 실제 전송 직전에 메서드·마스킹 URL·마스킹 body preview로 Burp 승인 callback을 거친다. 거부된 request는 `Fetch.failRequest`로 중단한다. 동시에 CDP WebSocket command/event 경쟁으로 발생한 `Send pending`을 단일 send lock으로 직렬화했다.
- Explorer run의 account를 시작 시 고정했다. MCP `account_id`가 다른 계정을 지정하면 거부하고, browser session header도 같은 target service에만 주입한다. browser worker는 8082 listener에 의존하지 않는다.
- browser network에서 발견한 same-scope route를 `BROWSER_RUNTIME/evidence_backed=false` Explorer frontier로 등록한다. 이는 discovery hint이며 통제 HTTP executor가 실제 응답을 캡처하기 전에는 Evidence·coverage·완료 근거가 아니다.
- `GraphObservationFact`를 추가해 coverage record에서 Evidence ID, Identity, service, method/operation, 표시용 API group과 그 근거, Object/family, source/run/phase, response 유무와 HTTP outcome을 투영한다. HTTP outcome은 관측 사실이며 인가 verdict가 아니다.
- Web graph를 `Site → API Group → Identity → API → Object` 단계로 분리했다. 분석 key는 `Identity × API × Object × Source`로 유지하고 URL path group은 표시 전용이다. Object는 family로 먼저 접고 선택할 때 인스턴스를 펼치며, 같은 family로 접힌 API→Object 선은 관계 단위로 중복 제거한다. 미교차 후보는 정확한 Object family를 펼친 뒤 표시한다.

**왜 필요했고 무엇을 기각했는가**

- selector 승인만으로는 실제 network side effect와 승인 대상이 일치하지 않는다. 반대로 browser가 본 runtime route를 즉시 Evidence로 올리면 응답 캡처와 재현 경계를 우회한다. 따라서 실제 outgoing request 승인과 discovery→controlled replay를 분리했다.
- 모든 Object 인스턴스를 첫 화면에 그리면 주문·게시물처럼 고카디널리티 데이터에서 선과 라벨이 폭증한다. Object를 삭제하면 BOLA 비교 근거를 잃으므로 family 접기와 원 Fact 보존을 선택했다.
- URL 이름을 LLM이 업무 의미로 확정하면 비결정적 오분류가 생긴다. 첫 안정 path segment 기반 group만 사용하고 이를 분석 key나 취약점 판정에 쓰지 않는다.
- status code, route 존재, source gap만으로 취약점을 확정하는 방식을 기각했다. 최종 판정은 현재 Evidence에 결합된 재현과 정상·타계정 대조가 서버 검증을 통과해야 한다.

**영향 파일·회귀·남은 gate**

- 코드: `ControlledBrowserExplorer.java`, `McpServer.java`, `FlowScopeExtension.java`, `RouteCandidate.java`, `GraphObservationFact.java`, `SnapshotJsonWriter.java`, `web/index.html`; 회귀: `ControlledBrowserExplorerTest.java`, `McpServerTest.java`, `GraphObservationFactTest.java`, 기존 Web/LLM runner 테스트; 실행 계약: `agent-workspace`; 현재 계약 문서와 changelog를 같은 작업에서 갱신했다.
- 집중 회귀는 실제 설치 Chrome의 거부된 POST 수신 0건, account override 거부, runtime route의 non-Evidence frontier, graph fact 정규화/outcome, Web snapshot 계약과 inline JavaScript parse를 확인했다.
- inline JavaScript parse와 전체 `mvn clean verify`를 연속 두 번 실행해 매회 299 tests, failure/error/skip 0을 확인했다. `target/flowscope-1.2.0-beta.37.jar`는 15,991,612 bytes, 2,062 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `58458a6a9eea2ea3b452a79fc307e054d5984fd3b1d8ccaa175b23b6a88c52ef`이며 두 clean build가 byte-for-byte 동일했다.
- 실제 beta.37 Burp 재로드, HTTPS·broker account browser 통합, HUMAN·ZAP·LLM→잠금→Judge 완주, crAPI 고카디널리티 가독성 및 블라인드 endpoint/finding 효능은 아직 완료하지 않았다. 이 gate 전에는 출시 성능이나 미탐·오탐 개선을 주장하지 않는다.

## 2026-09-01 · 1.2.0-beta.36 · 격리 Chrome Explorer와 Evidence replay

**개발·수정**

- `ControlledBrowserExplorer`를 추가해 JDK 21 `HttpClient/WebSocket`으로 설치된 Chrome/Chromium/Edge의 CDP page target을 제어한다. run마다 임시 user-data-dir·임의 debug port를 만들고 종료 시 browser와 profile을 폐기한다.
- CDP `Fetch`가 exact scope 밖 request를 전송 전에 중단한다. `Page/Runtime/Network`로 현재 URL, title, bounded visible text, same-scope link/form/button, request method/URL/type/status를 반환한다. browser는 incognito로 실행하고 broker session은 persistent cookie DB가 아닌 CDP request header와 8082 proxy에 선택 Explorer account로 고정 주입한다. header는 선택 target과 scheme·host·effective port가 같은 request에만 붙고, 다른 in-scope service에는 전달하지 않는다. UI/MCP 출력에는 raw credential을 포함하지 않는다.
- MCP Explorer 표면에 browser navigate/snapshot/interact/close를 추가했다. navigate/snapshot은 discovery-only이고 CLICK/FILL은 `confirmed=true`와 Burp 승인을 모두 요구하며 password/file input과 arbitrary JavaScript를 차단한다.
- 브라우저와 8082 관측은 Evidence·coverage·run 완료·Judge lock을 만들지 않는다. 모델이 관련 요청을 기존 controlled target executor로 재현한 응답만 `CONTROLLED` Evidence가 된다. 최종 Explorer prompt는 BOLA/BFLA/IDOR의 HTTP 대조 목적에 맞춰 `entry GET → independent API frontier → 필요한 경우 browser fallback과 replay → assisted frontier → end` 순서로 고정했다.
- CLI 성공 여부와 무관하게 Explorer run 종료·실패·취소·초기화가 같은 run의 browser worker를 닫도록 launcher cleanup 계약을 연결했다. 정상 MCP 종료에만 의존해 실패한 CLI가 격리 Chrome을 남기는 경로를 제거했다.
- 브라우저 내부에는 실제 URL을 유지하되 MCP로 반환하는 current URL·DOM target·network URL에는 기존 secret-field 마스킹을 적용해 query token/API key가 모델 출력으로 넘어가지 않게 했다.

**왜 필요했고 무엇을 기각했는가**

- beta.35는 HTML/JS literal/XML/OpenAPI 문자열 route에는 강하지만 JavaScript가 실행된 뒤 생성되는 SPA DOM과 runtime fetch/XHR을 직접 볼 수 없었다.
- Playwright/Chrome MCP/ChromeDriver 추가는 Node/npm 또는 별도 driver를 외부 사용자에게 요구하므로 기각했다. 기본 Chrome profile 연결은 개인 세션 혼합과 Chrome 136 remote-debugging 계약 때문에 기각했다.
- 일반 8082 traffic 또는 CDP event를 즉시 `CONTROLLED` Evidence로 승격하면 송신 프로세스 귀속과 Burp executor 재현 경계를 증명할 수 없어 기각했다. 비밀 marker header도 CORS/preflight와 대상 동작을 바꾸므로 사용하지 않았다.

**영향 파일·회귀·남은 gate**

- 코드: `ControlledBrowserExplorer.java`, `McpServer.java`, `LocalLlmRunner.java`, `FlowScopeExtension.java`; 테스트: `ControlledBrowserExplorerTest.java`, `McpServerTest.java`, `FlowScopeWebServerTest.java`; 실행 계약: `agent-workspace`; 사용자·설계·결정·계획·인계·변경 문서를 같은 작업에서 갱신했다.
- 실제 설치 Chrome을 headless 임시 profile로 띄운 두 local HTTP service smoke에서 CDP 연결, DOM/network 요약, same-scope click, 범위 밖 link 제거와 navigate 거부, 선택 service의 session header 수신과 다른 in-scope service 비누출, close를 확인했다. MCP 회귀는 Explorer-only 12-tool 표면, discovery-only·Evidence ID 부재, exact-scope와 account 고정을 확인한다.
- 전체 `mvn clean verify` 296 tests가 failure/error/skip 0으로 통과했다. 이 안에는 실제 로컬 Chrome smoke와 CLI 실패 시 browser cleanup 회귀가 포함되고 완성 JAR manifest/classloader smoke도 통과했다.
- 생성 배포물은 `target/flowscope-1.2.0-beta.36.jar`, 15,981,411 bytes, 2,058 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `46846d19f49dd93b20704f7762c425b15d83d7a37951367736f6d20bde07a548`다. 두 번째 clean build는 실행하지 않아 이번 gate에서 byte-for-byte 재현성을 새로 주장하지 않는다.
- 남은 gate는 beta.36 JAR의 실제 Burp HTTPS/8082 proxy/broker account/SPA run, 독립·보조 frontier 종료, H+ZAP+LLM dataset lock/Judge, beta.35 HTTP-only 대비 endpoint recall·노이즈·시간·메모리 블라인드 비교다. local Chrome smoke만으로 취약점 탐지 성능 향상을 주장하지 않는다.

## 2026-09-01 · 1.2.0-beta.35 · Explorer 독립-first/보조 frontier

**개발·수정**

- `flowscope_list_route_candidates`에 `INDEPENDENT/ASSISTED` view를 추가했다. INDEPENDENT는 기존처럼 현재 LLM run provenance만 반환한다. concrete GET/HEAD/OPTIONS/UNKNOWN 후보가 남아 있으면 ASSISTED 전환을 서버가 거부한다.
- 독립 safe frontier가 소진되고 controlled response Evidence가 존재할 때만 다른 레인의 exact-scope route를 blind hint로 제공한다. source, run ID, Evidence ID, adapter, provenance, 응답과 관측 성공 여부는 반환하지 않는다.
- `flowscope_end_run`은 응답 한 건만 보던 기존 조건에 더해 두 frontier 조회와 종료 시점 safe concrete route 0건을 재검사한다. frontier가 새 응답으로 늘었으면 다시 순회하기 전 종료할 수 없다.
- 번들 Explorer prompt, MCP server 지침과 버전을 같은 계약으로 갱신했다. 첫 exact target GET, safe read 자동 순회, 동적 route의 실제 관측값 요구, write 승인 경계는 유지했다.

**왜 필요했고 무엇을 기각했는가**

- beta.34에서는 entry 응답이 route를 거의 노출하지 않으면 Explorer가 한 건의 Evidence만 남기고 정상 종료할 수 있었다. 이는 세션·scope 안전성은 지키지만 사람이 놓친 경로를 찾는 제품 목적에 부족했다.
- 처음부터 HUMAN·SCANNER Evidence 전체를 공개하면 독립 3-way 비교가 오염되므로 기각했다. 대신 독립 단계를 먼저 서버로 강제하고, 후속 보완 단계에는 route 문자열만 공개한다.
- 동적 `{id}`를 임의 숫자로 치환하거나 POST/PUT/PATCH/DELETE를 frontier 소진 대상으로 자동 실행하는 방식은 근거 없는 요청·업무 상태 변경을 만들므로 기각했다.

**영향 파일·회귀·남은 gate**

- 코드: `McpServer.java`; 테스트: `McpServerTest.java`; 실행 계약: `agent-workspace/AGENTS.md`, `CLAUDE.md`, `README.md`, `prompts/explorer.md`; 정본 문서: `README.md`, `architecture.md`, `decisions.md`, `functional-spec.md`, `product-development-plan.md`, `CHANGELOG.md` 및 설치·영문 문서.
- 집중 회귀는 independent route 잔존 시 assisted/종료 거부, blind hint의 provenance·Evidence 비노출, assisted route 잔존 시 종료 거부, 모두 소진 후 완료를 확인했다. 이어 `mvn clean verify` 294 tests가 failure/error/skip 0으로 통과했고 완성 JAR smoke도 통과했다.
- 생성 배포물은 `target/flowscope-1.2.0-beta.35.jar`, 15,957,571 bytes, 2,052 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `6377fdfbbf7160871e33cdb72f5558e0cd5e9f20361dd84cb91ed12f19e0b978`다. 두 번째 clean build는 실행하지 않아 byte-for-byte 재현성은 이번 gate에서 주장하지 않는다.
- HTTP 응답 기반 route 추출만 구현됐으며 JavaScript 실행·DOM 상호작용·SPA runtime network를 수집하는 browser worker는 아직 없다. 실제 Burp 허가 target 효과 검증도 미완료이며 결과 정본은 `beta-validation.md`다.

## 2026-08-31 · 1.2.0-beta.34 · P1 복잡도·메모리 경계

**왜 먼저 고쳤는가**

- 20,000건 live 상한이 있어도 snapshot이 cluster Evidence 목록을 event마다 복제하면 단일 반복 묶음에서 출력이 제곱으로 증가했다. DataFlow도 producer 값마다 뒤 record 전체를 훑어 같은 규모에서 분석 시간이 제곱으로 증가했다.
- 저장하지 않을 대형 live 메시지를 먼저 전체 decode·mask하거나, 프로젝트 GZIP과 LLM assessment를 입력 크기만 믿고 복원하면 Burp JVM의 메모리 상한이 실질적으로 작동하지 않았다. 탐색 기능을 늘리기 전에 이 경계를 닫아야 성능·정확도 benchmark 자체가 유효하다.

**코드와 선택 이유**

- snapshot event에는 `clusterId/count/firstSeen/lastSeen`만 두고 Evidence ID는 `/api/cluster-evidence`에서 200건씩 읽는다. 원 Evidence는 삭제하지 않으면서 기본 1초 snapshot만 선형 크기로 유지하는 최소 변경이다.
- DataFlow는 `identity+value → 가장 가까운 이전 producer` index를 만들고 path/query/request body의 exact token만 대조한다. 모든 과거 producer를 연결하면 그림과 결과가 다시 폭증하고, substring은 `123`과 `1234`를 오연결하므로 둘 다 기각했다. index는 전체 최신 100,000 value에서 오래된 항목부터 축출한다. 이 흐름은 관측된 명시 토큰 전달의 근사치이며 축출된 오래된 값·숨은 서버 상태·의미적 동등성을 증명하지 않는다.
- live 메시지는 Montoya `ByteArray.length()`를 먼저 확인한다. 1MiB 이하는 기존 전문 정책을 유지하고, 초과 메시지는 최대 64KiB만 복사·디코딩·마스킹한 뒤 실제 byte 수와 metadata-only 사유를 남긴다. raw vault도 요청 1MiB·응답 4MiB 초과 배열을 받지 않는다. 초과 payload digest는 제한된 마스킹 표현·실제 byte 수·보존 사유를 길이 구분해 만든 식별자이며 원문 전체 checksum이라고 주장하지 않는다.
- 프로젝트 복원은 메시지당 1MiB와 서로 다른 `FULL` payload 총 48MiB를 적용하고, GZIP을 8KiB chunk로 풀면서 선언 크기나 예산을 넘는 즉시 거부한다. 동일 digest는 한 번만 복원해 반복 참조가 복원 비용을 증폭하지 않게 했고 metadata-only 항목에 압축 blob이 있으면 거부한다.
- assessment는 type 64자, title 256자, reason 4,096자, Evidence ID 200개·각 256자, 총 1,000건·4MiB로 제한한다. MCP schema, runtime append, 프로젝트 저장·복원이 같은 검증을 공유한다.

**검증과 아직 주장하지 않는 것**

- `mvn clean verify`를 연속 두 번 실행해 매회 293 tests, failure/error/skip 0을 확인했다. 20,000건 snapshot 직렬화 테스트는 0.912초·0.804초였고 최종 코드의 별도 Snapshot+DataFlow 측정 실행은 3.91초, Maven/JUnit JVM 최대 RSS 378,273,792 bytes·peak memory footprint 176,901,248 bytes였다. 측정 머신·JVM을 포함한 개발 gate이며 Burp 프로세스 상주 메모리 수치가 아니다.
- 2MiB live text/binary, 같은 미리보기·다른 실제 크기, metadata-only 압축 blob, 선언보다 크게 풀리는 GZIP, 48MiB aggregate 복원, 4MiB assessment, token 부분문자열과 가장 가까운 producer 회귀를 고정했다.
- 연속 두 clean verify의 배포물은 byte-for-byte 동일했다. `target/flowscope-1.2.0-beta.34.jar`, 15,953,677 bytes, 2,051 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `16835b7d5707279615b8d757ad3086e4bdcdc37d95c3d8c26fd5854c79d34a8a`다.
- 현재 로컬 `scripts/doctor.sh`는 HUMAN/SCANNER 포트, ZAP 2.17 API·upstream·필수 add-on, Codex 0.147.0, Claude Code 2.1.236, Web 17777, MCP 8787을 확인해 실패 0·경고 0으로 끝났다. 준비 상태 확인이며 실제 Explorer/Judge/ZAP 캠페인 완주나 발견 성능을 대신하지 않는다.
- 이 작업은 처리 안정성과 특정 오연결을 개선했지만 endpoint 발견률·취약점 TP/FP/FN 향상을 증명하지 않는다. H, H+ZAP, H+ZAP+LLM, Judge 증분을 정답 격리 블라인드 benchmark로 측정해 고유 유효 발견이나 검토시간 개선이 없는 레이어는 기본 경로에서 낮추거나 제거한다.

## 2026-08-31 · 1.2.0-beta.33 · 실행·게시 무결성 P1

**왜 먼저 고쳤는가**

- 기능을 더 추가해도 Request Lab이 다른 Evidence의 초안을 보내거나 동일 POST를 두 번 실행하고, 오래된 분석이 최신 snapshot을 덮으면 benchmark 입력과 사용자 판단 자체가 오염된다. 따라서 `HANDOFF.md`의 P1 1~4를 새 탐색 기능보다 우선했다.
- 프론트 버튼 비활성화만으로는 브라우저 중복 POST를 막지 못하고, pipeline 전체 전역 lock은 Burp callback을 막는다. generation+in-flight+server idempotency와 계산 후 publication epoch를 각각의 권위 경계로 선택했다(D-100).

**코드**

- Request Lab GET/POST는 generation과 immutable Evidence ID를 확인한다. 전송 중 관련 control을 잠그고 Web Crypto 난수 operation ID를 서버에 보낸다. 서버 응답을 전혀 받지 못한 동일 draft의 명시 재시도는 같은 ID를 재사용한다.
- localhost 서버는 길이 프레이밍 SHA-256으로 operation 입력을 비교해 같은 ID·같은 입력을 한 번만 실행하고, 다른 입력 충돌은 거부한다. 완료 cache는 원문 대신 compact 결과만 256건 보존한다.
- `AnalysisPublicationGate`가 입력 epoch와 게시 epoch를 원자 비교한다. delayed·immediate pipeline 모두 current result만 `latest/routeCandidates/revision`에 게시한다.
- 매트릭스 빈 셀은 서버 `UNCROSSED` exact key와 일치할 때만 crossgap/IDOR 후보이며 나머지는 중립 미검증이다.

**근거 재검증**

- AuthProbe의 owner-response 대조, BOLAZ의 source taint, AuthScope의 Alice/Bob 차등, RESTler producer-consumer, APICarv 7-app 98% precision/56% recall, BOLA taxonomy의 action-level 41.7%를 원문으로 다시 대조했다.
- action-level BOLA를 BFLA로 부른 문장, 이 도구들이 보편적 absolute ground truth를 만든다는 문장, BOLAZ가 response owner-field 우선순위를 제안한다는 문장을 폐기했다. 제품 고유 선택은 benchmark 전 가설로 낮췄다.

**아직 주장하지 않는 것**

- 자동 회귀는 실제 Burp 브라우저의 지연 A→B 선택, 상태변경 endpoint 수신 횟수, clear/rebuild 실경합을 대신하지 않는다. beta.33 JAR 재로드 뒤 수동 gate가 필요하다.
- Snapshot cluster/DataFlow/대용량 decode/GZIP/assessment 상한 P1은 이번 correctness 커밋과 섞지 않고 다음 작업으로 남긴다.

**검증 산출물**

- 집중 회귀에서 동일 operation ID의 순차·동시 HTTP 요청이 서버 실행 1회로 합쳐지고, 다른 입력 재사용은 400으로 거부됨을 확인했다.
- beta.33 standalone Web에서 매트릭스 빈 셀 두 개가 gap이 아닌 `일반 미검증 조합`으로 표시되고 브라우저 console error/warning이 없음을 확인했다. 샘플 렌더 검증이며 실제 Burp 트래픽 gate는 아니다.
- JDK 21 `mvn clean verify` 278 tests가 실패·오류·skip 없이 통과했다. 연속 두 번의 clean verify에서 단일 JAR은 byte-for-byte 동일했다.
- 배포물은 `target/flowscope-1.2.0-beta.33.jar`, 15,944,891 bytes, 2,048 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `2d8588fa78abf713005f738a3a7c990e1d2b9838bdb937dfd012b87a223b082b`이다.

## 2026-08-31 · 1.2.0-beta.32 · exact-run 완료·신뢰 정책·고정 Judge 데이터셋

**개발·수정**

- 원 HTTP 관측의 `executionTrust`를 소비 목적별로 해석하는 `SourceTrustPolicy`를 추가했다. 8082 직접 proxy 관측은 `UNVERIFIED_RUNTIME` 원 Evidence로 보존하지만 coverage, Explorer 시야, lane 완료, dataset lock, 결정적 verdict에는 쓰지 않는다.
- HUMAN·SCANNER·LLM의 정상 종료 조건을 `LaneCompletionPolicy` 하나로 통합했다. 활성 source와 exact run ID, `EXPLORATION`, 응답 Evidence, source별 신뢰 조건을 모두 통과해야 완료된다. ZAP/LLM 실패·취소와 구형 `clear` 경로는 완료가 아니라 abort다.
- 완료 시점의 Evidence ID, 응답 수, coverage 수를 `CompletedRun`으로 동결했다. Judge dataset lock은 세 lane의 동결 ID만 다시 분석하고, lock 후의 live record나 같은 run ID로 늦게 들어온 record가 잠긴 snapshot을 바꾸지 못한다.
- JSON project schema를 v3, SQLite storage schema를 v2로 올려 exact completed run을 저장한다. JSON v1/v2와 SQLite v1은 계속 읽지만 source 이름뿐인 과거 완료 표식은 현재 완료로 승격하지 않아 재실행이 필요하다.
- 저장 시 `completed_lanes`와 `completed_runs`를 동일한 검증된 run 집합에서 생성한다. key/source가 다르거나 Evidence가 없는 완료 객체는 저장 전에 거부하고, 현재 스키마에서 두 목록이 다르면 load를 거부한다.
- beta.29~32 구현 이력에 맞춰 개발 지침의 현재 단계, 인계 기준선, 백엔드 재정비 계획의 교차 구현 상태, 멘토 보고서의 현재 버전·검증 수치·문서 링크를 동기화했다. BolaRay는 본문과 공개 아티팩트를 확인한 근거 수준으로 연구 문서 태그를 교정했다.
- 활성 Markdown 전부의 역할과 최신 상태를 재감사했다. Release 자산은 실제 게시 여부를 확인하지 않은 채 존재한다고 쓰지 않도록 조건부 안내로 바꾸고, 원 기능명세의 포트/XML 요구와 beta.32 MCP 통제 경계를 분리했다. 제품 계획·검증·초기 JGraphX 문서의 과거 상태는 역사 시점으로 표시하고, 제안서·연구 문서의 미검증 성능·신규성 문장은 평가 가설로 낮췄다. `.local/archive`와 버전별 changelog 본문은 현재 동작 정본이 아니므로 역사 사실을 바꾸지 않았다.

**근거와 기각한 대안**

- 기존 source-only `Set<Source>`는 어느 run의 어떤 Evidence가 완료를 만들었는지 증명하지 못했다. 포트 8082에 들어온 외부 요청도 활성 LLM run ID를 물려받았고, 실패한 ZAP 경로가 `clear`만 호출해 완료로 보이는 경로도 있었다. 프롬프트 문구나 UI badge만 고치는 방식은 이 백엔드 무결성 문제를 해결하지 못해 기각했다.
- 원 관측을 삭제하면 포렌식과 분류 개선 재현성을 잃는다. 반대로 모든 관측을 동등하게 분석하면 통제되지 않은 8082 traffic이 독립 Explorer 성과나 Judge 근거를 오염시킨다. 따라서 저장과 소비 자격을 분리했다.
- 전체 event store 재작성은 현재 문제에 비해 변경 폭이 크고 기존 분석 계약까지 흔든다. 이번 단계는 exact completion manifest와 immutable lock snapshot이라는 최소 경계를 도입하고 UI는 동결했다.

**영향 파일·검증·남은 gate**

- 핵심 코드: `SourceTrustPolicy`, `LaneCompletionPolicy`, `RunContextRegistry`, `Pipeline`, `McpServer`, `FlowScopeWebServer`, `FlowScopeExtension`, `ProjectStore`, `SqliteProjectStore`, `LocalLlmRunner`.
- 무작위 run ID의 CONTROLLED/UNVERIFIED 대조, HUMAN·SCANNER·LLM 완료와 abort, 동결 Evidence membership, lock 불변성, JSON/SQLite 왕복과 legacy 비승격·현재 스키마 불일치 거부 회귀를 추가했다. 최종 전체 수치와 JAR digest는 `beta-validation.md`를 정본으로 한다.
- JDK 21 `mvn clean verify` 275 tests가 실패·오류·skip 없이 통과했다. 연속 clean verify의 완성 JAR은 byte-for-byte 동일했고, 단일 배포물은 15,940,500 bytes, 2,046 entries, SHA-256 `a105c9539eddedecc212a66782958165ea890bd0ed5c528dac249f7a22fc2b27`이다.
- 포트 번호만으로 실제 OS 프로세스 신원을 암호학적으로 증명할 수는 없다. 8081은 활성 ZAP run과 outgoing-proxy preflight에 묶지만 장기적으로는 run별 capability가 더 강한 경계다. dataset lock 자체, ZAP native Alert와 주입 prompt digest의 프로젝트 재개는 아직 별도 설계 항목이다.
- beta.32 JAR의 실제 Burp 재로드, 로그인 Codex Explorer의 controlled MCP Evidence 완주, ZAP 실캠페인, 3-lane lock과 Judge 재현은 자동 테스트로 대체하지 않는다.

## 2026-08-31 · 1.2.0-beta.31 · 구독 CLI 자동 탐지·로그인 preflight

**개발·수정**

- Codex/Claude 실행 파일을 축소된 Burp `PATH`뿐 아니라 macOS/Linux/Windows의 표준 사용자 설치 및 런타임 경로에서 자동 탐지하도록 확장했다.
- 로그인 파일이나 실행 후 오류에 의존하지 않고 공급자 CLI가 제공하는 `codex login status`, `claude auth status --json`을 사용해 설치·로그인 상태를 구분한다. 검사 자식에서도 API key를 제거하고 계정 이메일·원출력은 저장하지 않는다.
- 1초 Web polling마다 프로세스를 만들지 않도록 준비 상태를 30초 캐시의 daemon worker에서 갱신한다. Explorer/Judge 시작과 Judge 후속 실행은 직전에 동기 preflight를 다시 통과해야 한다.
- 준비된 provider 자동 선택, provider별 상태 badge, 수동 **다시 확인** fallback을 Web에 추가했다. MCP URL/token, 역할별 allowlist, prompt, 임시 workspace와 Codex home 격리는 기존 launcher가 계속 자동 구성한다.

**영향 파일·검증·남은 gate**

- 코드: `LocalLlmRunner`, `FlowScopeExtension`, `FlowScopeWebServer`, Web UI. 회귀: `LocalLlmRunnerTest`, `FlowScopeWebServerTest`.
- 공식 상태 명령의 로컬 실제 출력은 account 식별자를 제거한 뒤 READY만 확인했다. 전체 회귀·재현 JAR·배포물 수치는 `beta-validation.md`에 기록한다.
- beta.31 JAR을 Burp에 재로드한 실제 Web 자동 선택→MCP target Evidence→Explorer 종료는 수동 통합 gate로 남는다. 비표준 portable 설치는 JVM 절대 경로 override가 fallback이다.

## 2026-08-31 · 1.2.0-beta.30 · 로그인 준비 상태·LLM 작업 피드

**개발·수정**

- 외부 사용자가 공식 Codex/Claude CLI를 설치하고 로그인한 뒤 API key·MCP 수동 설정 없이 Web 버튼으로 실행한다는 계약을 UI와 문서에 명시했다.
- Codex는 실행 파일과 `$CODEX_HOME/auth.json` 또는 `~/.codex/auth.json`을 분리해 사전 확인한다. Claude는 CLI 발견 상태를 표시하고 실제 로그인 유효성은 공급자 CLI가 실행 시 확인하게 해 provider 내부 인증 저장소를 추측하지 않는다.
- 실행 중 provider JSONL을 32 KiB/line, 200 event로 제한해 `SYSTEM/MODEL/TOOL/EVIDENCE/ERROR` 활동으로 변환했다. 64 KiB 마스킹 output tail과 별도로 Web이 1초마다 동기화하므로 종료 전에도 진행 상황을 확인할 수 있다.
- reasoning/thinking event와 raw tool argument/result는 저장·표시하지 않는다. MCP token과 API key는 기존처럼 prompt·status·project에 넣지 않으며 주입 prompt preview도 secret masking과 24 KiB 상한을 거친다.

**검증 및 남은 gate**

- 구조화 event·실시간 tail·reasoning/credential 비노출과 Web 정적 계약 회귀를 추가했다.
- 자동 회귀·재현 JAR·실제 로그인 Codex CLI smoke 결과는 `beta-validation.md`를 정본으로 유지한다. beta.30 JAR을 Burp에 재로드한 실제 MCP 대상 완주는 별도 통합 gate다.

## 2026-08-31 · 1.2.0-beta.29 · Codex Explorer 실행 격리·Evidence 이중 gate

**개발·수정**

- beta.28을 실제 실행한 output tail에서 전역 `ctf-goal` skill 로드, 첫 GET의 write tool 오선택·client 취소, 응답 Evidence 0건인데도 성공 게시된 경로를 확인했다.
- Codex마다 owner-only 임시 `CODEX_HOME`을 만들고 원 home의 `auth.json`만 link해 구독 로그인은 유지하면서 config·skill·plugin·memory·이전 session 상속을 차단했다. 링크가 불가능하면 hard link, 최종 fallback은 owner-only 임시 copy다.
- Explorer의 첫 target operation을 exact entry target의 `flowscope_target_read(method=GET)`로 고정하고, 이후 own-run 응답에서 나온 route candidate를 frontier로 순회하도록 번들 prompt를 수정했다.
- 활성 Explorer의 MCP `tools/list`를 역할에 필요한 8개로 제한해 ZAP·Judge·scope 도구가 선택 후보로 노출되지 않게 하고, 호출 단계 권한 검사도 유지했다.
- MCP의 0-Evidence `end_run` 거부에 launcher-side exact run Evidence 검사를 추가했다. 두 번째 gate 실패 시 잘못 기록된 LLM 완료 lane을 취소하고 실행을 `FAILED`로 게시한다.
- beta.28의 skill-disable 문자열이 실제 격리를 증명했다는 문서 주장을 철회하고 설계·결정·기능 명세·설치·검증·인계 문서를 beta.29 계약으로 동기화했다.

**검증 및 남은 gate**

- `LocalLlmRunnerTest`, `RunContextRegistryTest`, `McpServerTest` 집중 회귀와 `mvn clean verify` 263 tests, 실패·오류·skip 0, 완성 JAR smoke 통과.
- 로컬 로그인 Codex 0.147.0에 임시 home, 동일 feature disable, `--strict-config --ignore-user-config --ignore-rules --ephemeral`을 실제 적용해 `FLOWSCOPE_CODEX_OK` 응답과 exit 0을 확인했다. API key는 사용하지 않았다.
- 같은 소스의 clean verify 2회에서 beta.29 JAR SHA-256 `348c6504…55d89`가 일치했다. 배포물은 15,910,427 bytes, 2,037 entries다.
- 이 smoke는 CLI 로그인·격리 option 호환만 확인한다. beta.29 JAR 재로드 뒤 실제 Burp MCP target read, route frontier, Evidence 저장, 정상 run 종료는 아직 수행하지 않았다.

## 2026-08-30 · 1.2.0-beta.28 · Explorer 성과 gate·ZAP 명시 정의 탐색

**개발·수정**

- Codex Explorer에서 안전한 GET도 destructive tool로 표시돼 취소되고, 응답 Evidence 없이 CLI exit 0만으로 LLM lane이 완료되는 실제 실패를 확인했다. MCP를 GET·HEAD·OPTIONS 전용 read와 승인형 write로 분리하고, EXPLORATION 종료에 같은 run의 응답 Evidence를 필수화했다.
- `--ignore-user-config`만으로 전역 `ctf-goal` skill이 제거되지 않는 로컬 Codex 0.147.0 동작을 확인했다. beta.28은 발견한 user/plugin skill과 관련 feature를 비활성화하는 인자를 추가했지만, beta.29 실실행에서 이 방식도 전역 skill을 제거하지 못한 사실이 확인돼 임시 home 격리로 대체됐다.
- ZAP이 FlowScope SCANNER listener를 우회하면 스캔은 성공처럼 보여도 Evidence가 0건이 되는 경로를 막기 위해, 대상 전송 전에 Network API로 outgoing proxy enabled와 허용 host·8081을 검사한다.
- 운영자가 이미 가진 OpenAPI·GraphQL·Postman·SOAP 정의를 Web/MCP에서 최대 20개 입력할 수 있게 했다. URL과 GraphQL endpoint는 exact scope로 제한하고, 신원별 fresh Context에서 정의별 최대 1,000 message로 import한다. 정의가 상태 변경 요청을 만들 수 있어 별도 Burp 승인을 요구한다.
- 정의 import는 `ZAP_API_IMPORT` 단계로 분리하고 성공 수와 형식별 실패 원인을 lane에 표시한다. 일부 정의 실패가 Traditional·Client·AJAX·passive Evidence를 폐기하지 않도록 경고 완료로 보존한다.
- README, 한국어·영어 설치/변경 이력, 아키텍처, 결정 기록, 기능 명세, UI 근거, 개발 계획, 검증 기록과 인계 정본을 beta.28 동작에 맞췄다.

**근거와 기각한 대안**

- ZAP 공식 탐색 가이드는 modern app에서 Traditional Spider와 Client Spider, API 정의 import를 함께 사용하도록 안내한다. 정의 import는 실제 operation 요청을 만들 수 있으므로 passive scan과 같은 무승인 단계로 분류하지 않았다.
- FlowScope가 사용자의 ZAP 전역 proxy를 자동 변경하면 다른 점검 세션에 영향을 주므로 기각했다. 현재는 요구 상태를 읽고 불일치 시 대상 트래픽 전에 실패한다.
- LLM 프롬프트에 “기존 결과를 보지 말라”고만 쓰는 방식은 실제 user skill/plugin surface를 제거하지 못해 기각했다. 프로세스별 feature/skill disable과 서버 가시성 격리를 함께 사용한다.

**검증 및 남은 gate**

- `mvn clean verify`: 258 tests, 실패·오류·skip 0, 완성 JAR manifest/classloader smoke 통과.
- 같은 소스의 clean verify 2회에서 beta.28 JAR SHA-256 `87aace2e…d1f4` 일치.
- `bash -n scripts/*.sh infra/zap/start-zap.sh`, `git diff --check`, `scripts/doctor.sh` 통과. doctor는 로컬 port, ZAP 2.17.0 API/upstream/add-on, Codex 0.147.0, Claude 2.1.236을 실패·경고 0으로 확인했다.
- 배포물: `target/flowscope-1.2.0-beta.28.jar`, 15,909,724 bytes, 2,037 entries, SHA-256 `87aace2eb47d97b721196714a21fbc5faff2e37f178c8b037c8be447d1fdd1f4`.
- 실제 beta.28 Burp 재로드 뒤 Explorer target read와 0-Evidence 실패 UI, 실제 ZAP 네 형식 정의·복수 계정 campaign, 3-lane lock, Judge 재현·대조는 아직 수행하지 않았다. 로컬 PowerShell과 원격 GitHub Actions도 미검증이다.

## 2026-08-30 · 1.2.0-beta.27 · 안전 ZAP 기준선·구독 CLI PATH 복구

**개발·수정**

- beta.26 live 캠페인이 ZAP의 passive 설정을 사용자 상태에 맡기고 Client 실패/0건일 때만 AJAX를 실행하며 Alert 상세를 첫 500개만 저장하는 코드를 확인했다. `ZapClient`에 passive engine, 전체 passive rule, scope-only, Alert count API를 추가했다.
- `McpServer`가 target traffic 전에 ZAP version과 `spider/client/spiderAjax/pscan/pscanrules/selenium/openapi/websocket` add-on을 검사한다. 신원별 fresh session에서 선택 target origin·path subtree만 포함하는 Context를 만들고 passive 설정을 명시 적용한 뒤 Traditional → Client → AJAX → passive queue → paginated native Alert 순서를 고정했다.
- Client/AJAX 단계의 실패·0 capture를 다른 Evidence와 함께 `COMPLETED_WITH_WARNINGS`로 보존한다. Alert는 500개씩 읽어 신원별 최대 20,000개를 account/run 태그와 함께 메모리 snapshot에 저장하고 초과를 경고한다.
- `LocalLlmRunner`가 해석한 Codex/Claude 실행 파일 부모를 자식 `PATH` 앞에 한 번만 추가한다. provider API key 제거와 loopback MCP 경계는 유지했다. 운영체제별 `PATH` 키 대소문자도 보존한다.
- `scanOnlyInScope`가 ZAP Context를 읽는 계약을 확인해 Context 없이 scope-only만 켜 생길 수 있는 passive 미탐을 수정했다. context regex는 sibling path·subdomain·다른 scheme/port를 거부하는 회귀로 고정했다.
- Session Broker의 ACTIVE 계정별 메모리 인증 주입, Explorer exact-scope executor, 별도 Judge dataset lock, 반복 재현·정상 대조 Evidence gate는 이미 구현돼 있어 중복 코드를 만들지 않고 기존 회귀와 전체 회귀로 재검증했다.
- 영향을 받은 사용자·구조·결정·명세·설치·검증·인계 문서와 버전/JAR 이름을 beta.27로 동기화했다.

**근거와 기각한 대안**

- ZAP 공식 문서상 passive scanner는 메시지를 변조하지 않고 HTTP/WebSocket traffic을 분석하며 전체 rule 활성화와 scope-only API를 제공한다. OpenAPI add-on은 spider가 발견한 in-scope 정의를 자동 import한다.
- Forced Browse는 wordlist 항목을 실제 요청하고 thread 수에 따라 대상 부하를 높이며 ZAP 2.17 local API에 자동화 component가 없어 기본 버튼에서 제외했다. Active Scan·Fuzzer·mutation은 별도 승인 경계를 유지한다.
- Alpha/Beta add-on을 강제 설치하지 않고 현재 설치된 passive scanner는 `enableAllScanners`로 모두 활성화한다. 공개 기본 계약은 ZAP 2.17 release add-on 기준으로 유지한다.

**검증 및 남은 gate**

- 축소 `PATH=/usr/bin:/bin`에서 `/usr/bin/env node --version`이 `env: node: No such file or directory`, status 127로 실패하고 `/opt/homebrew/bin` 추가 후 status 0으로 성공하는 조건을 로컬 재현했다.
- 로컬 ZAP read-only API에서 version `2.17.0`, 필수 add-on 8개 설치, passive scanner 61개를 확인했다. 실제 캠페인과 ZAP 전역 설정 변경은 beta.27 JAR 재로드 전 실행하지 않았다.
- `mvn clean verify`: 253 tests, 실패·오류·skip 0, 완성 JAR manifest/classloader smoke 통과.
- 같은 소스에서 `mvn clean verify`를 다시 실행해 beta.27 JAR SHA-256이 `8c0235…fd62`로 동일함을 확인했다.
- `bash -n scripts/*.sh infra/zap/*.sh`와 `git diff --check` 통과. 현재 macOS에 `pwsh`가 없어 수정된 `doctor.ps1`의 로컬 parser gate와 원격 CI는 아직 실행하지 않았다.
- 배포물: `target/flowscope-1.2.0-beta.27.jar`, 15,900,678 bytes, 2,035 entries, SHA-256 `8c0235d47aa61055984cdd4902f721f482072393d4644a8321512fb18a5ffd62`.
- 실제 Burp에서 beta.27 JAR을 재로드한 뒤 ZAP 계정별 capture·Alert pagination, Codex Explorer 정상 종료, 3-lane lock, Judge 재현·대조까지 확인하는 통합 gate는 아직 수행하지 않았다.

## 2026-08-30 · 1.2.0-beta.26 · ZAP HAR SCANNER Evidence 가져오기

**개발·수정**

- beta.20과 beta.22 이력을 포함해 현재 Web 업로드 경로를 코드로 확인한 결과, 스캐너 버튼도 `.xml`과 `/api/import-xml`만 사용하고 ZAP HAR 어댑터는 없었다. 기존 기능으로 잘못 보고하지 않고 신규 기능으로 구현했다.
- `HarParser`가 HAR 1.2 `log.entries`의 method, URL/path/query, headers, postData, status, response content, startedDateTime을 `SCANNER/HAR_IMPORT/ZAP/IMPORT/IMPORTED` record로 변환한다. 인증 원문은 fingerprint 뒤 Masking을 거치고 현재 exact scope 밖 entry는 저장하지 않는다.
- 파일 25MiB, JSON 깊이 128, token 1,000,000과 기존 payload 1MiB/압축 총량 48MiB 경계를 적용했다. 오류 entry는 나머지 파일과 분리해 skip하고, status 0은 response-less candidate로 유지한다. base64 textual body는 엄격 UTF-8, binary/손상 textual body는 metadata-only로 처리한다.
- Web 스캐너 입력을 `스캐너 XML/HAR`와 `.xml,.har`로 바꾸고 확장자에 따라 전용 localhost API를 호출한다. 서버는 HAR source를 SCANNER로 고정한다. HAR가 담지 않는 native Alert·scanner completion을 생성하지 않는다.
- 영향을 받은 코드는 `HarParser`, `StoredPayload`, `SourceDetail`, `FlowScopeWebServer`, `FlowScopeExtension`, `Standalone`, `index.html`이고 회귀는 `HarParserTest`, `FlowScopeWebServerTest`다. 사용자·구조·결정·UI·검증·인계 문서를 같은 작업 단위로 갱신했다.

**검토한 대안**

- HAR creator metadata를 믿어 source를 자동 결정하는 방식은 입력 파일이 조작 가능해 기각했다. 이번 계약은 ZAP export를 명시적으로 고른 스캐너 입력에 한정한다.
- HAR에서 native Alert나 캠페인 완료를 추론하는 방식은 HAR HTTP message 형식에 없는 정보를 창작하므로 기각했다. Alert가 필요한 비교는 live ZAP 캠페인의 별도 API 수집을 유지한다.
- binary base64를 replacement character가 든 String으로 저장하는 방식은 원 Evidence를 왜곡하므로 metadata-only로 남긴다.

**검증 및 남은 gate**

- `HarParserTest`: 5 tests. textual/base64/binary, response-less, malformed entry, exact-scope, 잘못된 문서 경계 통과.
- `FlowScopeWebServerTest`: scanner-only HAR API, `.xml,.har` UI, snapshot source 계약 통과.
- 전체 `mvn clean verify`: 249 tests, 실패·오류·skip 0 + 완성 JAR smoke 통과.
- 배포물: `target/flowscope-1.2.0-beta.26.jar`, 15,896,042 bytes, 2,034 entries, SHA-256 `ca5d969fb4d056e35b9dd6c420d211131f3a806c4105a5ec69ce7a45d762f232`.
- 실제 ZAP 2.17 UI가 내보낸 HAR를 beta.26 Burp에서 업로드하는 수동 gate와 원격 CI는 아직 수행하지 않았다. HAR import는 live campaign 완료나 취약점 탐지 성능 검증을 대체하지 않는다.

## 2026-08-29 · 1.2.0-beta.25 · streaming manifest·버전 독립 MR-JAR 패키징

**개발·수정**

- beta.24 JAR을 실제 `JarInputStream`으로 읽어 manifest가 `null`인 결함을 재현했다. 원인은 MR-JAR 경로 후처리 뒤 일반 Ant `<zip>`이 manifest를 선두에 배치하지 않은 것이었다.
- 재압축을 manifest-aware Ant `<jar>`로 바꾸고 staging manifest의 중복 입력을 제외했다. 완성 JAR 첫 엔트리는 `META-INF/MANIFEST.MF`가 되며 `JarInputStream`에서 Main-Class·Java-Version·Multi-Release를 읽는다.
- Jackson·jsoup·SnakeYAML의 Java 9/11/17/21별 `<move>`를 `META-INF/versions/*` fileset과 정규식 mapper 세 개로 교체했다. 새 Java version 디렉터리가 같은 package prefix로 추가돼도 POM의 숫자 목록을 수정하지 않는다.
- `FatJarIsolationSmoke`를 Maven `verify` phase에 연결했다. 로컬과 CI의 `mvn clean verify`가 완성 JAR의 streaming manifest, relocated MR class 실제 선택, Jackson 파싱, SQLite 격리 classloader 동시 연결까지 검사한다.

**검증 및 남은 gate**

- 전체 `mvn clean verify`: 243 tests, 실패·오류·skip 0 + 완성 JAR smoke 통과.
- 배포물: `target/flowscope-1.2.0-beta.25.jar`, 15,884,423 bytes, 2,031 entries, SHA-256 `6d422a88e78961ca50b92e2d78aa4ccf93af0026020a6a40badb2d447f74a34c`.
- JAR 첫 엔트리 `META-INF/MANIFEST.MF`, `JarInputStream` manifest 값 4개, 고정 `Created-By`, 원 versioned package 누출 0, 동일 소스 clean package 2회 SHA-256 일치를 확인했다.
- 실제 Burp load/unload와 외부 SBOM·서명 도구 호환성, 원격 GitHub Actions는 아직 수행하지 않았다.

## 2026-08-29 · 1.2.0-beta.24 · 판정 오라클·신원·게시 스냅샷 하드닝

**개발·수정**

- `ResponseEvidence`가 generic `id`뿐 아니라 최종 자원 타입과 결합된 `orderId/order_uuid/orderNo/orderSeq` 및 generic `uuid/guid/pk`를 구조화 값으로 비교하도록 수정했다. 부모 자원 ID만 보인 응답은 최종 자원 노출 근거로 승격하지 않는다.
- soft-deny는 JSON 전체 문자열이 아니라 최상위 `error/errors/message/detail/title/reason` 오류 봉투만 검사한다. 비 JSON 오류는 앞 2,048자만 검사하고, 1,000,000자·깊이 128·token 100,000·순회 node 100,000 상한을 넘는 구조화 응답은 근거 없음으로 종료한다.
- 빈 지문은 `unresolved`로 보존해 실제 `anon`과 분리했다. 세션 service를 계정과 같은 canonical `scheme://host:port`로 정규화하고, 바인딩 해제 뒤 같은 레코드를 다시 분석해도 옛 계정 ID가 남지 않는 회귀를 추가했다.
- `UNKNOWN` 역할은 요구 권한을 충족한 정상 대조 계정으로 인정하지 않도록 Judge gate를 수정했다.
- `AnalysisConfig`의 일곱 정책 맵을 하나의 monitor로 보호하고 `replaceWith`, account check/put, snapshot copy를 원자화했다. Burp/Web/MCP/Standalone 게시 분석은 수집 레코드의 `analysisCopy`와 정책 복사본에서 실행하고, raw byte vault는 process-local runtime ID로 원 레코드와 분석 복사본을 연결한다.
- `CellKey`의 구분자 위험 입력과 Evidence digest 입력은 delimiter join 대신 길이 접두 framing으로 바꿨다. 일반 cell stable key는 유지하고 beta.23 이하 newline digest는 감지·이행해 기존 finding/review/Evidence ID를 보존한다. LF 헤더 본문에 CRLF 빈 줄이 있어도 가장 이른 헤더 구분자를 사용한다.
- `ExecutionTrust`, `ResourceReference`, `ReviewDecision`의 공개 주석 언어를 한국어로 통일했다.
- 소유자 판독도 같은 bounded JSON·반복 순회를 사용하게 했다. 대형 응답 회귀가 후단 `DataFlowAnalyzer`의 무제한 정규식 CPU 점유를 실제로 드러내 구조화 JSON 반복 순회, 1,000,000자 입력 상한, 비구조화 fallback 64KiB, 값 1,000개 상한을 추가했다.

**리뷰 판별**

- 중첩 자원의 부모 ID까지 성공 증거로 인정하라는 제안은 최종 객체가 없는 응답을 BOLA 증거로 오인하므로 채택하지 않았다.
- 세션 unbind 뒤 옛 `idn`이 남는다는 제안은 기존 `Normalizer.normalizeAll` 재실행 경로에서는 재현되지 않았다. 불필요한 상태 필드를 추가하지 않고 재분석 회귀만 고정했다.
- 비어 있지 않은 미지원 Authorization은 기존에도 `Fingerprints.of`에서 opaque hash가 되므로 “파서 실패가 모두 blank”라는 원인 설명은 기각했다. 다만 blank 생성자/import 경계는 실제 `anon`과 충돌해 `unresolved`로 분리했다.
- `AccessRole.isBelow`가 `UNKNOWN`에서 false인 것은 미확정 권한을 자동 위반으로 만들지 않는 의도다. 대신 Judge의 BFLA 정상 대조 호출부가 이를 권한 충분으로 역해석한 결함을 `isKnownAndAtLeast`로 수정했다.
- `Gap.risk(int)`와 finding `Severity`는 각각 후보 우선순위와 취약점 심각도라는 다른 의미이므로 하나의 enum으로 합치지 않았다.

**검증 및 남은 gate**

- 전체 `mvn clean verify`: 243 tests, 실패·오류·skip 0.
- 배포물: `target/flowscope-1.2.0-beta.24.jar`, 15,924,691 bytes, 2,031 entries, SHA-256 `e7ccd253d08399b675feced3908ba76873ef2680124cc2e1281102cbb441f5f5`. ZIP·Main-Class·Java 21·Multi-Release manifest 검증 통과.
- beta.24 JAR의 실제 Burp load/unload·프로젝트 저장/재열기는 아직 수행하지 않았다.

## 2026-08-29 · 1.2.0-beta.23 · 배포물 라이선스·격리·CI 하드닝

### 목표와 성공 조건

- fat JAR이 실제 포함한 모든 Apache NOTICE와 제3자 라이선스 텍스트를 보존하고 고지의 저작물 귀속을 정확히 맞춘다.
- relocate 가능한 Java dependency는 base/MR-JAR 전체를 격리하고 sqlite-jdbc JNI는 깨뜨리지 않으면서 실제 classloader 동시 사용을 검증한다.
- 플러그인·Action·셸·JAR 단일성·반복 digest를 CI의 실행 가능한 gate로 만든다.

### 개발·수정

- Shade가 제거하던 Jackson 원 NOTICE를 Apache NOTICE transformer로 병합하고 FastDoubleParser·ThirdParty·Schubfach 라이선스 파일의 보존을 CI에서 검사한다. 프로젝트 NOTICE에서 SnakeYAML을 Jackson/FasterXML 항목과 분리했다.
- Jackson·jsoup·SnakeYAML을 `io.flowscope.shaded`로 relocate했다. 전체 `META-INF/versions/**` 제외를 제거하고 Java 9/11/17/21 class를 보존했다.
- Shade 3.6.0의 MSHADE-406 때문에 versioned class bytecode와 ZIP entry path가 어긋나는 것을 빌드에서 재현했다. package 마지막에 알려진 versioned package path를 결정론적으로 이동하고 고정 timestamp로 JAR을 다시 구성한다.
- sqlite-jdbc는 JNI package 계약 때문에 relocate하지 않았다. 같은 sqlite-jdbc JAR을 parent가 분리된 두 classloader에서 동시에 로드해 두 in-memory connection과 query를 수행하는 회귀를 추가했다.
- clean/resources/compiler/surefire plugin 버전을 POM에 고정하고 JAR manifest의 build-JDK 가변값을 제거했다. GitHub Actions는 commit SHA로 pin했다.
- CI의 glob 기반 단일 JAR 검사를 `find+mapfile`로 교체했다. NOTICE·라이선스·MR-JAR·relocation 누출·manifest, clean package 2회 SHA-256, Bash 5개 `bash -n`·ShellCheck를 검사한다. push는 main, PR은 별도로 유지하고 Dependabot update를 그룹화했다.

### 이유와 기각한 대안

- 원 NOTICE 제거는 Apache-2.0 §4(d) 재배포 조건과 맞지 않고, MR-JAR 전체 제거는 정상 최적화·native-image 구현을 버린다.
- SQLite를 Java package처럼 relocate하면 JNI symbol을 깨뜨릴 수 있어 기각했다. 실제 충돌 재현 없이 저장소를 sidecar로 분리하는 것도 설치·장애 표면을 크게 늘려 기각했다. 현재 의존성의 두 classloader 검증을 먼저 고정하고 실제 충돌이 재현될 때 아키텍처를 재검토한다(D-090).
- mutable action tag와 상속 plugin version은 같은 source의 빌드 입력을 외부 상태에 맡기므로 유지하지 않았다.

### 영향 파일

- 빌드·CI: `pom.xml`, `.github/workflows/ci.yml`, `.github/dependabot.yml`
- 라이선스·회귀: `src/main/resources/META-INF/NOTICE.txt`, `SqliteClassLoaderIsolationTest`
- 버전·사용자 계약: Web version label/test, README와 한영 시작/변경 문서
- 정본 문서: architecture, decisions D-090, product plan, beta validation, handoff, development log

### 검증

- 최초 배포물에서 Jackson NOTICE 부재, 원 패키지 jsoup/SnakeYAML 노출, MR-JAR 0개, glob zero-match 검사 결함을 파일/JAR 기준으로 재현했다.
- `mvn clean verify`: 224 tests, 실패·오류·skip 0. SQLite 독립 classloader 두 개의 동시 연결 회귀 포함.
- 완성 fat JAR을 두 독립 classloader로 직접 로드해 JDK 21의 Jackson 21/jsoup 11/SnakeYAML 9 versioned resource 선택, relocated Jackson JSON 파싱과 SQLite 동시 query smoke를 통과했다.
- Bash 5개가 `bash -n`과 로컬 ShellCheck를 통과했다. 같은 입력의 clean package 2회 SHA-256이 일치했다.
- 최종 artifact 크기·entry·SHA-256은 `beta-validation.md`에 기록한다.

### 남은 한계·다음 gate

- 원격 GitHub Actions는 push 전이라 아직 실행하지 않았다. macOS 로컬에서는 PowerShell parser를 실행하지 않았고 기존 Windows CI gate만 유지했다.
- 두 classloader 검증은 현재 sqlite-jdbc/JVM 조합의 실제 동시 로드를 확인하지만 임의의 미래 Burp 확장 조합에서 충돌 확률 0을 증명하지 않는다.
- beta.23 JAR을 실제 Burp Community에서 load/unload하고 SQLite 프로젝트 저장·재열기를 확인해야 한다.

## 2026-08-25 · 한국어·영어 문서 경계 정리

**개발·수정**

- 저장소 루트의 README, 변경 이력, 기여 가이드, 보안 정책을 한국어 정본으로 바꿨다.
- 상세 설계·결정·검증·연구·기능명세는 `docs/ko`로 이동하고 한국어 문서 색인을 추가했다.
- 기존 영어 README, 변경 이력, 기여 가이드, 보안 정책을 `docs/en`에 보존하고 영어 문서 색인을 추가했다.
- 이동된 문서를 참조하는 저장소 지침과 내부 링크를 새 경로에 맞췄다.

**왜**

한국어 사용자가 저장소 첫 화면에서 바로 설치·운영 경계를 읽을 수 있어야 하고, 한 디렉터리에서 두 언어를 섞어 문서의 정본을 모호하게 만들면 안 된다. 검토하지 않은 기계 번역을 상세 영어 문서처럼 제공하지 않고, 실제로 존재하는 영어 공개 가이드만 별도 보존했다.

**주요 파일**

- `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`
- `docs/ko/**`, `docs/en/**`
- `AGENTS.md`, `CLAUDE.md`

**검증 및 남은 한계**

- 저장소의 Markdown 파일을 대상으로 로컬 상대 링크가 실제 파일·디렉터리를 가리키는지 검사해 누락 0건을 확인했다.
- 이전 `docs/*.md`·`docs/specification` 경로를 참조하는 현재 링크와 지침이 남지 않았음을 확인했다.
- `mvn clean verify`: 124 tests, 실패·오류·skip 0.
- 상세 아키텍처·결정 문서는 현재 한국어만 제공한다. 검토된 영어 번역이 생기기 전에는 영어 문서라고 표시하지 않는다.

## 2026-08-25 · source 색상과 일반 UI accent 분리

**개발·수정**

- source palette를 HUMAN 파랑, SCANNER 빨강, LLM 검정으로 변경하고 실선/파선/점선과 H/S/L 약어를 함께 유지했다.
- source 색을 재사용하던 일반 버튼, 포커스, 선택, 계정 카드, 그룹 노드를 별도 중립 accent로 분리했다.
- 정의되지 않은 `--blue`를 사용하던 Evidence class filter의 accent를 동일한 일반 accent로 바로잡았다.

**왜**

색만 바꾸면 SCANNER와 무관한 일반 UI까지 빨강으로 변하고, 완전히 겹친 색 선은 아래 source를 가린다. source 의미는 색·선형·문자로 중복 표현하고 일반 조작과 authorization verdict는 별도 시각 축으로 유지해야 한다.

**주요 파일**

- `src/main/resources/web/index.html`
- `src/test/java/io/flowscope/FlowScopeWebServerTest.java`
- `README.md`, `CHANGELOG.md`
- `docs/ko/architecture.md`, `docs/ko/decisions.md`, `docs/ko/ui-product-rationale.md`

**검증 및 남은 gate**

- Web 응답에 정확한 palette와 H/S/L 계약이 포함되는지 자동 회귀를 추가했다.
- `mvn clean verify`: 124 tests, 실패·오류·skip 0.
- 정적 검사에서 source 변수는 업로드·필터·범례·단일-source 노드·source edge에만 남고 일반 조작은 `--accent`를 사용함을 확인했다. 계정별 서버 palette는 source가 아닌 identity 표시 데이터이므로 변경하지 않았다.
- 1280×720 standalone 렌더에서 범례와 그래프의 파랑/빨강/검정 및 실선/파선/점선, H/S/L 노드 표기가 일치했다. body scroll 크기는 viewport와 같았고 클라이언트 오류는 0건이었다.
- fat JAR: 2,814,714 bytes, 1,295 entries, ZIP 무결성 통과, `Main-Class=io.flowscope.burp.FlowScopeExtension`, SHA-256 `e760799758e73188888f1944ae08ab17c6d535e82fd6eec9cc41dd7e365b13ba`.
- 실제 Burp에서 현재 JAR을 다시 로드해 Web UI를 여는 수동 gate는 남아 있다.

## 2026-08-25 · 1.2.0-beta.3 · 벤치마크 전 제품화

### 목표와 성공 조건

- HUMAN, ZAP, LLM이 서로 독립된 lane으로 실제 Evidence를 남긴다.
- LLM Explorer는 HUMAN/ZAP 결과를 미리 볼 수 없고, 세 lane이 완료된 뒤에만 Judge가 고정된 데이터셋을 본다.
- LLM과 ZAP의 대상 요청은 exact scope와 계정 세션 경계를 서버가 강제한다.
- 최종 `CONFIRMED / INCONCLUSIVE / REJECTED`는 LLM의 주장만으로 결정하지 않고 서버가 재현·정상 대조 Evidence를 검증한다.
- 사용자는 Burp Community와 로컬 Web UI에서 설정, 진행 상태, 그래프, Matrix, Request/Response, 판정 근거를 확인할 수 있다.
- crAPI 정답과 풀이를 보지 않고, 사용자 승인 전 벤치마크를 시작하지 않는다.

### 1. 계정별 메모리 전용 Session Broker

**개발·수정**

- 사용자가 계정별 `로그인 캡처`를 명시적으로 시작하고 종료하는 `SessionBroker`를 추가했다.
- HUMAN 요청에서 Cookie, Authorization, CSRF 계열 헤더를 수집하고, 응답 `Set-Cookie`의 회전·삭제·만료를 반영한다.
- 세션 상태를 `CAPTURING / ACTIVE / SUSPECT / REAUTH_REQUIRED / REVOKED`로 구분했다.
- account service, cookie domain/path/secure/expiry, 현재 exact scope가 모두 맞을 때만 ZAP 또는 LLM 요청에 주입한다.
- 401, 로그인 redirect, invalid-token 응답은 `SUSPECT`로 만들고 이후 사용을 막는다. 403은 역할 거부일 수 있어 자동 만료로 처리하지 않는다.
- raw 세션 값은 Web/MCP view, Evidence, 로그, 프로젝트 파일에 넣지 않고 revoke/clear/unload 때 broker buffer를 폐기한다.

**왜**

기존의 secret-free 계정/세션 fingerprint 연결만으로는 ZAP과 LLM이 특정 테스트 계정으로 독립 탐색할 수 없었다. 반대로 토큰을 에이전트나 프로젝트 파일에 전달하면 비밀 노출과 재사용 위험이 생기므로, Burp 프로세스 메모리 내부의 짧은 실행 bridge로 제한했다.

**주요 파일**

- `src/main/java/io/flowscope/integration/SessionBroker.java`
- `src/main/java/io/flowscope/burp/FlowScopeExtension.java`
- `src/main/java/io/flowscope/web/FlowScopeWebServer.java`
- `src/main/resources/web/index.html`
- `src/test/java/io/flowscope/SessionBrokerTest.java`
- `src/test/java/io/flowscope/FlowScopeWebServerTest.java`

**검증**

헤더 캡처·주입, cookie scope/회전/삭제/만료, 잘못된 service, 캡처 중·의심 세션 차단, revoke와 view 비밀 미노출을 자동 회귀로 고정했다.

### 2. FlowScope 통제 LLM 요청과 실행 신뢰도

**개발·수정**

- MCP `flowscope_target_request`를 추가해 method, exact target, body 크기, 헤더를 서버가 검사하고 Burp HTTP 엔진으로 한 요청만 전송하게 했다.
- broker가 관리하는 인증 헤더를 LLM이 덮어쓰지 못하게 했고 헤더 CR/LF injection을 거부한다.
- 상태 변경 method는 `confirmed=true`와 별도의 Burp 사용자 확인을 모두 요구한다.
- `ExecutionTrust`를 `CONTROLLED / OBSERVED / UNVERIFIED_RUNTIME / IMPORTED / UNKNOWN`으로 구분해 RequestRecord와 Evidence에 보존한다.
- 직접 8082 프록시 관측은 비교 자료로 남길 수 있지만 최종 판정 근거로는 거부한다.

**왜**

프롬프트로 curl이나 browser networking만 금지하면 모델이 실제로 어떤 경로·헤더·redirect로 요청했는지 서버가 증명할 수 없다. 최종 판정의 재현 Evidence는 프롬프트 준수가 아니라 서버 통제 사실에 묶여야 한다.

**주요 파일**

- `src/main/java/io/flowscope/core/ExecutionTrust.java`
- `src/main/java/io/flowscope/core/RequestRecord.java`
- `src/main/java/io/flowscope/core/EvidenceIds.java`
- `src/main/java/io/flowscope/integration/McpServer.java`
- `src/main/java/io/flowscope/burp/FlowScopeExtension.java`
- `src/test/java/io/flowscope/McpServerTest.java`
- `src/test/java/io/flowscope/TrafficMetadataTest.java`

**검증**

범위 밖 target, 잘못된 계정/service, broker-owned header, CR/LF, 승인 없는 write를 거부하고 controlled request가 올바른 provenance로 기록되는지 검사했다.

### 3. 독립 Explorer, Dataset Lock, 최종 Judge

**개발·수정**

- LLM EXPLORATION run 동안 MCP status와 Evidence에서 다른 source의 count, cell, gap, finding, candidate를 숨긴다.
- 성공적으로 종료된 HUMAN/SCANNER/LLM EXPLORATION lane을 명시적으로 기록한다. 중단·실패한 run 또는 record 존재만으로 완료를 추론하지 않는다.
- `flowscope_lock_dataset`은 active run이 없고 세 lane 각각에 response-bearing nondefault exploration Evidence가 있어야만 후보와 owner/role oracle을 고정한다.
- lock 뒤에는 scope 변경, Explorer, scanner 시작을 막고 Judge/validation만 허용한다.
- Judge의 validation probe/control은 현재 Evidence 저장소에서 읽되 후보와 oracle은 잠긴 snapshot에서 읽도록 분리했다.
- 프로젝트 복원 시 COACH_PROBE/VALIDATION record를 제외한 pre-Judge 후보 snapshot을 재구성해 저장된 판정을 다시 검증한다.

**왜**

프롬프트에 “다른 결과를 보지 말라”고 적는 것만으로 독립 비교를 보장할 수 없다. 또한 Judge 실행 중 새 탐색 결과가 후보를 바꾸면 비교와 재현의 기준점이 사라지므로 서버 수준의 가시성 격리와 불변 snapshot이 필요했다.

**주요 파일**

- `src/main/java/io/flowscope/core/RunContextRegistry.java`
- `src/main/java/io/flowscope/integration/McpServer.java`
- `src/main/java/io/flowscope/integration/ProjectStore.java`
- `src/test/java/io/flowscope/McpServerTest.java`
- `src/test/java/io/flowscope/ProjectStoreTest.java`

**검증**

Explorer 격리, 빈 lane과 active run의 lock 거부, lock 후 상태 변경 거부, `lock → controlled probes → submit validation` 실제 순서, 저장·복원 후 판정 재검증을 자동 테스트했다.

### 4. 결정론적 ZAP baseline

**개발·수정**

- 기본 scanner lane을 LLM 선택이 아니라 `orchestrator=SYSTEM` workflow로 고정했다.
- 실행 순서는 Traditional Spider → strict-scope Client Spider → Client 실패 시 AJAX Spider fallback → passive queue 0 대기 → native alerts 수집이다.
- optional account의 active broker session을 ZAP 프록시 요청에 주입한다.
- in-scope SCANNER capture가 0이면 성공이 아니라 `NO_SCANNER_TRAFFIC_CAPTURED`로 실패 처리한다.
- 현재 stage, warning, captured count, alert count를 Web/MCP에 노출한다.
- Active Scan은 baseline에서 분리하고 exact scope, 명시적 요청, Burp 확인을 계속 요구한다.

**왜**

LLM에게 ZAP 기능 선택을 맡기면 passive queue를 기다리지 않거나 SPA 경로를 놓치고, start 응답을 완료로 오해할 수 있다. 같은 입력에서 재현 가능한 scanner 결과를 만들면서 Traditional/Client/AJAX/passive/native alert를 빠뜨리지 않기 위해 시스템 workflow로 고정했다.

**주요 파일**

- `src/main/java/io/flowscope/integration/ZapClient.java`
- `src/main/java/io/flowscope/integration/McpServer.java`
- `src/main/java/io/flowscope/web/FlowScopeWebServer.java`
- `src/main/resources/web/index.html`
- `src/test/java/io/flowscope/ZapClientTest.java`
- `src/test/java/io/flowscope/McpServerTest.java`

**검증**

각 단계 호출 순서, Client 상태의 중첩 응답 처리, AJAX fallback, passive 완료 대기, native alert snapshot과 비밀 마스킹, zero-capture 실패를 자동 회귀로 고정했다.

### 5. 저장 모델과 비밀 경계

**개발·수정**

- 프로젝트 schema v1의 선택 필드로 `execution_trust`와 명시적 `completed_lanes`를 추가해 기존 파일 호환성을 유지했다.
- raw broker session, active run lease와 live lock 객체는 프로젝트에 저장하지 않는다.
- 저장된 validation은 현재 후보·Evidence와 다시 대조하고 stale/cross-run/위조 판정을 버린다.

**왜**

프로젝트를 재개할 수 있어야 하지만 세션 비밀과 실행 중 상태까지 직렬화하면 보안 경계가 깨진다. 반대로 lane 완료를 record 존재로 복원하면 실패한 실행이 lock 조건을 만족하므로 명시적 완료 metadata만 저장한다.

**주요 파일**

- `src/main/java/io/flowscope/integration/ProjectStore.java`
- `src/main/java/io/flowscope/core/RequestRecord.java`
- `src/test/java/io/flowscope/ProjectStoreTest.java`

**검증**

구버전 선택 필드 부재, round trip, 비밀 미저장, 완료 lane 명시 복원, interrupted record 미추론을 검사했다.

### 6. Web UI와 사용자 흐름

**개발·수정**

- quick-start를 `scope → 계정/로그인/HUMAN → ZAP → Explorer → lock/Judge` 순서로 정리했다.
- 계정 카드에 로그인 캡처 시작/종료, revoke, 상태 표시를 추가했다.
- ZAP target/account/stage/warning/captured/alert UI를 추가했다.
- Matrix cell에서 `이 API의 요청·응답 보기`를 눌러 해당 Evidence와 마스킹된 Request/Response를 지연 로드하도록 했다.
- 긴 글자와 작은 화면에서 modal, 계정 카드, 표, scanner controls가 잘리지 않도록 반응형 CSS를 수정했다.

**왜**

사용자가 포트와 프롬프트 내부 구현을 이해하지 않아도 정상 순서를 따라갈 수 있어야 하고, 그래프 결과에서 실제 근거 Request/Response까지 이동할 수 있어야 제품으로 사용할 수 있다.

**주요 파일**

- `src/main/resources/web/index.html`
- `src/main/java/io/flowscope/web/FlowScopeWebServer.java`
- `src/main/java/io/flowscope/web/SnapshotJsonWriter.java`
- `src/test/java/io/flowscope/FlowScopeWebServerTest.java`

**검증**

1500×900, 900×700, 600×800 viewport에서 quick-start, 계정 화면, Matrix Evidence를 확인했고 브라우저 콘솔 오류는 0건이었다.

### 7. Agent workspace, 문서, 배포물

**개발·수정**

- Explorer와 Judge 프롬프트를 분리하고 web search, Wayback, 외부 API docs/source, curl, browser networking을 금지했다.
- Explorer는 통제 request만 사용하고, Judge는 lock 뒤 advisory ZAP alert와 Evidence를 읽어 재현·대조 후 서버 판정을 제출하게 했다.
- README, architecture, product overview/plan, decisions, changelog, beta validation을 beta.3 동작에 맞췄다.
- 버전을 `1.2.0-beta.3`으로 올리고 단일 배포 JAR을 생성했다.

**주요 파일**

- `agent-workspace/prompts/explorer.md`
- `agent-workspace/prompts/judge.md`
- `agent-workspace/AGENTS.md`
- `agent-workspace/CLAUDE.md`
- `README.md`
- `docs/ko/architecture.md`
- `docs/ko/decisions.md`
- `docs/ko/product-overview.md`
- `docs/ko/product-development-plan.md`
- `docs/ko/beta-validation.md`
- `CHANGELOG.md`
- `pom.xml`

**검증**

`mvn clean verify`에서 112 tests가 모두 통과했다. JAR ZIP 무결성, manifest, Montoya 미포함, 고지/Web 자산 포함, 머신 절대경로와 제품 코드의 리터럴 비밀값 부재를 확인했다.

### 8. 변경 기록과 문서 동기화 규칙

**개발·수정**

- 이 개발 기록을 작업 단위 정본으로 추가하고 문서별 소유 계약을 `docs/ko/README.md`에 명시했다.
- `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`에 코드 변경과 같은 단위로 이유·영향 파일·검증·한계를 기록하도록 강제했다.
- 사용자 변경은 Changelog, 현재 구조는 Architecture, 선택 이유는 Decisions, 실제 수행 검증은 Beta Validation, 단계 상태는 Product Plan에만 기록하도록 역할을 분리했다.
- 현재 구현과 충돌하던 “LLM은 제안만”, “raw 인증정보는 전혀 보유하지 않음”, “QA는 범위 밖” 지침을 서버 검증 Judge, 명시적 메모리 전용 broker, beta.3 수동 gate에 맞게 수정했다.
- 제품 계획에서 이전 산출물의 Burp smoke가 beta.3 실검증처럼 읽히던 문장을 분리하고 새 JAR의 미완료 수동 gate를 명시했다.

**왜**

문서만으로는 정확한 줄 변경과 복구를 제공하지 못하고 Git만으로는 설계 이유와 미검증 범위를 충분히 설명하지 못한다. 두 기록을 함께 사용하되 같은 내용을 모든 문서에 복사해 불일치를 만드는 방식은 피해야 한다.

**영향 파일**

- `docs/ko/development-log.md`
- `docs/ko/README.md`
- `docs/ko/decisions.md`
- `docs/ko/product-development-plan.md`
- `README.md`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `AGENTS.md`
- `CLAUDE.md`

**검증과 남은 gate**

문서 링크와 beta.3 버전·검증 수치·P4 상태를 상호 대조했다. 이 변경은 제품 Java/Web 동작을 바꾸지 않으므로 기존 112-test 산출물을 다시 빌드한 것으로 기록하지 않는다. 이후 사용자 승인에 따라 아래 로컬 Git 기준선을 준비했다.

### 9. 로컬 Git 기준선

**개발·수정**

- 현재 디렉터리에 로컬 Git 저장소를 `main` 브랜치로 초기화했다.
- `.gitignore`가 `target/`, `.local/`, 루트 `.codex/`, IDE 파일, 환경 파일, key/certificate, `.flowscope.json`을 제외하는지 확인했다.
- 추적 후보의 자격증명 패턴, 머신 절대경로, 대용량 파일을 검사했다.
- remote는 추가하지 않았고 GitHub 또는 외부 시스템으로 전송하지 않았다.

**왜**

문서 기록에 더해 정확한 파일 diff, 기능 단위 변경 이력과 안전한 복구 지점을 남기기 위해서다. 기존 Git metadata가 없으므로 과거 이력을 임의로 재구성하지 않고 현재 beta.3를 첫 기준점으로 삼는다.

**검증**

- `git status --ignored`에서 `.local/`과 `target/`이 ignored 상태임을 확인했다.
- secret pattern 검사에서 탐지된 유일한 Bearer 문자열은 `CaptureSchemaTest`의 의도된 합성 JWT fixture(`PAYLOAD.SIG`)였다.
- 5 MiB를 넘는 추적 후보 파일은 없었고 remote 목록은 비어 있었다.
- staged 목록은 공개 소스·테스트·문서·CI·라이선스 131개 파일이고 `target/`, `.local/`은 포함되지 않았다.
- `git diff --check`는 기존 Burp XML의 CRLF HTTP fixture, 원본 기능명세의 후행 공백, 일부 EOF 공백을 보고했다. 초기 기준선에서 원본 fixture와 역사 문서를 기계적으로 고치면 검증한 소스가 달라지므로 그대로 보존하고 이후 기능 변경이 새 whitespace 오류를 만들지 않게 한다.
- 로컬 root commit은 `chore: establish FlowScope 1.2.0-beta.3 baseline`으로 생성했다. remote는 계속 비어 있다.

### 수정 과정에서 발견해 고친 결함

| 결함 | 원인 | 수정 | 회귀 검증 |
|---|---|---|---|
| `SUSPECT` 세션 주입 가능성 | 세션 존재와 주입 가능 상태를 같은 조건으로 취급 | 오직 exact-service/scope의 `ACTIVE` 세션만 주입 | `SessionBrokerTest` |
| lock 뒤 validation Evidence를 읽지 못함 | 후보 snapshot과 Evidence 조회를 모두 lock 시점으로 고정 | 후보/oracle만 lock하고 validation Evidence는 현재 저장소에서 조회 | `McpServerTest`의 실제 Judge 순서 |
| 복원된 validation이 후보 계산을 오염 | load 시 최종 probe까지 exploration 후보 입력에 포함 | COACH_PROBE/VALIDATION 제외 pre-Judge snapshot 재구성 | `McpServerTest`, `ProjectStoreTest` |
| ZAP Client status 오판 가능성 | 실제 응답의 중첩 status를 최상위 필드로만 탐색 | 중첩 구조를 탐색하는 status 처리 | `ZapClientTest` |

### 검증 결과와 미완료 gate

- 자동 회귀: JDK 21 `mvn clean verify`, 112 tests, 실패·오류·skip 0.
- 산출물: `target/flowscope-1.2.0-beta.3.jar`, 2,792,782 bytes.
- SHA-256: `faef5fcf38fd1e3d37ac7aaa883738e5cbe58c42147655b4f0574bba33ceee82`.
- 아직 beta.3 JAR의 실제 Burp Community 재로드, 실제 로그인 세션 주입, ZAP 2.17 연쇄 실행, 구독형 Codex/Claude MCP 전체 과정, 실제 프로젝트 save/load는 수행하지 않았다.
- 위 수동 beta gate를 통과하기 전에는 blind crAPI 벤치마크를 시작하지 않는다.

자세한 실행 검증 경계는 `beta-validation.md`, 설계 결정은 `decisions.md`의 D-052~D-055를 따른다.

## 2026-08-25 · 실제 사용자 인수검사와 발표 근거 문서화

### 목표와 성공 조건

- 구현자가 아는 정상 경로가 아니라 처음 설치하는 사용자의 실제 행동으로 beta.3의 설치·온보딩 실패를 찾는다.
- 각 UI 요소를 `사용자 질문 → 설계 이유 → 기각 방식 → 오탐·미탐 영향 → 발표 문장`으로 설명할 정본을 만든다.
- 실제 확인한 항목과 아직 실행하지 않은 항목을 문서에서 분리한다.

### 관측·수정

- 사용자가 Burp Community 2026.7.3에 `original-flowscope-1.2.0-beta.3.jar`를 추가했을 때 `Extension class is not a recognized type` 오류를 실제 관측했다.
- JAR 내부 진입점, Java 21 class version, 설치된 Burp와 Maven Montoya API 2026.7 class digest, 실제 Burp loader의 `BurpExtension` 판별 조건을 대조했다. 진입 클래스는 올바른 구현체였고, 사용자가 `target/flowscope-1.2.0-beta.3.jar`를 선택하자 신규 load가 통과했다.
- 원인은 runtime dependency가 없는 Maven Shade의 `original-*` intermediate를 사용자가 배포물로 오인한 것이었다. 사용자의 잘못으로 닫지 않고, 같은 폴더에 선택 불가능해야 할 유사 JAR을 노출한 packaging UX 결함으로 D-058에 기록했다.
- 실제 빈 Web 화면의 관측 범위·source filter·권한·사용자 그래프·3-way gap·그래프 조작이 각각 답하는 질문과 안전 이유를 `ui-product-rationale.md`에 통합했다.
- README/architecture가 파싱 결과에서 stable Evidence ID를 볼 수 있다고 했지만 실제 beta.3 raw table에는 해당 열과 상세 동작이 없음을 확인해 문서를 현재 동작으로 수정하고 UI 부채로 올렸다.
- 독립 clean-room 사전 감사에서 Codex MCP 설정 자동 발견 실패가 예비 보고됐으나 감사 자체는 사용자 요청으로 중단됐다. 후속으로 공식 Codex 문서와 로컬 CLI 0.147.0을 대조했고, 신뢰된 `agent-workspace`에서 프로젝트 설정의 `flowscope` 항목이 실제 발견되는 것을 확인했다. 따라서 제품 결함으로 확정하지 않고 신뢰 전제와 확인 명령이 빠진 onboarding 문서 문제로 교정했다. 빈 상태 onboarding 혼란은 열린 UX 결함으로 유지한다.

### 왜

112개 자동 테스트와 구현자 중심 standalone 확인은 실제 설치 파일 선택, 처음 보는 용어, 문서와 화면 불일치를 잡지 못했다. 제품 성공 기준을 “코드가 존재한다”가 아니라 “처음 받은 사용자가 올바른 다음 행동을 알고 전체 흐름을 완료한다”로 교정해야 했다. 발표에서도 기능 나열보다 각 선택이 막는 오탐·미탐·신뢰 문제를 설명해야 한다.

### 영향 파일

- `docs/ko/ui-product-rationale.md`
- `docs/ko/README.md`
- `docs/ko/architecture.md`
- `docs/ko/graph-ux.md`
- `docs/ko/product-overview.md`
- `docs/ko/decisions.md`
- `docs/ko/beta-validation.md`
- `docs/ko/product-development-plan.md`
- `docs/ko/development-log.md`
- `README.md`
- `agent-workspace/README.md`
- `CHANGELOG.md`
- `AGENTS.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`

### 검증

- 실제 사용자 Burp load: 올바른 fat JAR만 통과.
- entry class: Java 21, 설치된 Burp 2026.7.3의 `BurpExtension`과 assignable 및 public constructor 생성 확인.
- Maven/Burp `BurpExtension`과 `RequestOptions` class digest 일치 확인.
- 실제 Web raw table 코드의 7개 열을 대조해 Evidence ID 미노출 확인.
- 공식 Codex 문서의 trusted-project 조건을 대조하고 `agent-workspace`에서 `codex mcp get flowscope`로 project-scoped MCP discovery 확인.
- 저장소 Markdown 24개 전수 로컬 링크 검사: 누락 0.
- `git diff --check`: 통과.
- Java·Web 제품 코드는 변경하지 않았으므로 기존 beta.3 자동 테스트 결과를 새로 수행한 것처럼 기록하지 않는다. 배포 JAR과 SHA-256도 변경되지 않았다.

### 남은 한계·다음 gate

- Maven 공개 install surface에서 `original-*` JAR을 제거하거나 내부 경로로 격리해야 한다.
- 빈 상태 progressive disclosure와 ADMIN 선택성 문구를 UI에 구현해야 한다.
- 파싱 결과에 Evidence ID/상세 진입을 구현하거나 해당 화면의 역할을 다시 결정해야 한다.
- Codex project-scoped MCP discovery는 확인했지만 실행 중인 FlowScope MCP 연결과 Explorer/Judge 전체 과정은 검증해야 한다.
- 올바른 beta.3 JAR의 Web UI, HUMAN, broker, ZAP, Explorer/Judge, save/load, unload는 계속 미검증이다.

## 2026-08-25 · Evidence 보존형 트래픽 분류와 신원 안정화

### 목표와 성공 조건

- 브라우저·LLM의 보조 traffic이 graph를 압도하지 않되 캡처된 Evidence를 삭제하지 않는다.
- 경로명이나 cookie 존재 하나로 API/로그인 여부를 단정하지 않는다.
- 수집 전체와 coverage 입력의 차이, 분류 근거, 반복 횟수, stable Evidence ID를 사용자가 확인하고 되돌릴 수 있다.
- cookie가 1,000번 회전해도 검증되지 않은 1,000명의 graph identity를 만들지 않고, 명시 account binding은 계속 정확히 적용된다.

### 개발·수정

- 기존 boolean `TrafficFilter`를 `TrafficClassifier`의 class/disposition/reasons/override 계약으로 교체했다. real CORS preflight, Fetch Metadata와 MIME가 합치하는 navigation/static, no-response, non-discovery phase만 high-confidence 제외하고 telemetry·애매한 관측은 `REVIEW`로 보존했다.
- Pipeline을 `전체 정규화·Evidence ID → auth state 안정화 → traffic classification → coverage subset → analyzer/graph`로 분리했다. `records`는 전체 Evidence, `coverageRecords`는 분석 입력이다.
- request/response Content-Type, `Sec-Fetch-Dest`, `Sec-Fetch-Mode`, `Access-Control-Request-Method`, auth state와 분류 결과를 live/Burp XML/project/Web/MCP에 연결했다.
- operation별 `AUTO/INCLUDE/EXCLUDE`를 설정·프로젝트·Web API에 추가했다. classifier version을 project에 기록하고 로드 후 현재 규칙으로 다시 계산한다.
- unbound cookie/session fingerprint를 서비스별 `UNRESOLVED` graph identity로 안정화했다. 원 fingerprint는 Evidence와 수동 binding 후보에 남기고, broker가 raw credential을 exact match하거나 사용자가 binding한 경우만 `ACCOUNT_BOUND`로 바꾼다. 명시 HUMAN anonymous pass도 Authorization과 Cookie가 모두 없을 때만 `ANONYMOUS`다.
- 동일 의미 관측은 `ObservationCollapser`로 화면에서만 접고 모든 Evidence ID, repeat count, first/last timestamp를 유지했다.
- Web 좌측에 수집/분석/기본 숨김/검토 통계와 Evidence 표시 filter를, 파싱 결과에 분류/처리/반복/Evidence 열과 행→operation 상세 동선을, 상세에 reversible coverage override를 추가했다.
- MCP status/list/detail과 dataset lock gate가 전체 수집량이 아니라 discovery-eligible coverage를 명시적으로 사용하도록 수정했다.
- 신규 coverage 통계가 independent Explorer에서 HUMAN/SCANNER 수량을 노출할 수 있던 격리 우회를 코드 검토에서 발견했다. 독립 모드의 captured/coverage/excluded/review/source count를 현재 LLM run으로 제한하고 회귀 assertion을 추가했다.

### 이유와 기각한 대안

확장자 blacklist, `/analytics` 정규식, 모든 OPTIONS 제거는 사설 이미지 API·business telemetry·일반 OPTIONS를 버릴 수 있다. cookie마다 identity를 만드는 방식은 익명 추적 cookie 회전만으로 graph를 폭증시킨다. 반대로 검증되지 않은 cookie를 한 계정으로 확정 병합하면 서로 다른 사용자를 섞는다. LLM per-request 분류는 비결정적이고 비용이 크며 독립 비교를 오염시킨다. 따라서 deterministic high-confidence exclusion + ambiguous review + user override + raw Evidence retention을 선택했다(D-059).

### 영향 파일

- 핵심: `core/TrafficClassifier`, `TrafficClassification`, `TrafficOverride`, `AuthState`, `ObservationCollapser`, `Pipeline`, `RequestRecord`, `AnalysisConfig`.
- 수집·통합: `burp/FlowScopeExtension`, `core/BurpXmlParser`, `integration/SessionBroker`, `ProjectStore`, `McpServer`, `web/FlowScopeWebServer`, `SnapshotJsonWriter`.
- UI: `ui/FlowScopeControlTab`, `resources/web/index.html`.
- 테스트: `TrafficClassifierTest`, `PipelineClassificationTest`, `ObservationCollapserTest`와 session/project/MCP/Web/accuracy 회귀.
- 문서: README, architecture, decisions, research, UI rationale, product plan, beta validation, changelog, 이 개발 기록.

### 검증

- 첫 `mvn clean verify`는 UI 제목을 `트래픽 분류`에서 `Evidence 표시`로 바꾼 뒤 Web 회귀가 이전 문자열을 기대해 실패했다. 제품 계약에 맞춰 assertion을 수정했다. 이어 사용자 INCLUDE가 non-discovery phase를 우회하지 못하는 회귀를 추가했고 최종 전체 결과는 아래에 기록했다.
- 이 변경 직후 `mvn clean verify`: 123 tests, 실패·오류·skip 0. 이후 D-060 회귀가 추가됐으며 현재 전체 결과는 아래 후속 기록과 `beta-validation.md`를 따른다.
- classifier 회귀: misleading extension, private image API, true preflight/normal OPTIONS, telemetry 명칭, 보안 신호 우선, user override, no-response/non-discovery 보존을 확인했다.
- identity 회귀: 1,000 rotating cookies가 한 서비스의 `UNRESOLVED` graph identity로 안정화되고 명시 binding은 계정으로 분리됨을 확인했다.
- persistence/MCP/Web 회귀: classification/auth/override/version round trip과 captured/coverage/excluded/review 통계를 확인했다.
- Explorer 격리 회귀: independent mode에서 HUMAN의 raw·coverage source count가 모두 없고 전체 통계도 현재 LLM run 1건만 반환하는 것을 확인했다.
- standalone local browser: 1024×768에서 가로 overflow와 ellipsis 잘림 0, 여섯 mode 전환, quick-start, 파싱 행→Evidence 상세, 분류 override 조작 노출, console error 0을 확인했다.
- 이 변경 직후 fat JAR: 2,814,516 bytes, 1,295 entries, ZIP 무결성 통과, `Main-Class=io.flowscope.burp.FlowScopeExtension`, SHA-256 `64d9079759af25bc4df09ec0856fc3b5d61cee620b69d4053f37f0d965d8d354`. 현재 산출물은 후속 D-060 기록을 따른다.

### 남은 한계·다음 gate

- Fetch Metadata/MIME가 없거나 잘못된 대상과 business-specific API는 완벽히 분류할 수 없다. 애매한 `REVIEW`와 사용자 override는 정상 동작이며 오탐·미탐 0을 주장하지 않는다.
- broker의 raw credential exact match는 false merge보다 miss를 택한다. MFA/WebAuthn/device binding과 application-specific refresh는 수동 재로그인이 필요하다.
- 현재 standalone QA는 Burp Community 실제 capture/session/ZAP/MCP workflow를 대신하지 않는다. blind crAPI 전에 기존 수동 beta gate를 완료해야 한다.
- D-058의 `original-*` JAR 노출과 D-057의 empty-state progressive disclosure는 이번 변경 범위 밖의 열린 제품 부채다.

## 2026-08-25 · HUMAN 범위 밖 Evidence 혼입 수정

### 목표와 성공 조건

- HUMAN은 Burp 브라우저로 범위 밖 사이트를 방문할 수 있지만 FlowScope에는 현재 exact scope 왕복만 저장한다.
- scope가 비어 있거나 잘못된 경우 HUMAN/SCANNER/LLM 어느 source도 Evidence를 만들지 않는다.

### 개발·수정과 이유

사용자 crAPI 점검 중 scope 입력이 실패한 상태에서 네이버를 한 번 방문하자 네이버 요청이 FlowScope 그래프에 들어오는 실제 결함을 확인했다. `ActiveTrafficGuard`의 송신 gate는 의도적으로 SCANNER/LLM에만 적용됐지만, 공통 `capture()`에는 별도 scope 검사가 없었다. HUMAN 브라우저 이동 자체를 막지 않으면서 `capture()`가 RequestRecord를 만들기 전에 모든 source의 URL을 exact scope로 검사하도록 수정했다.

### 영향 파일

- `core/ActiveTrafficGuard`, `burp/FlowScopeExtension`, `ActiveTrafficGuardTest`
- README, architecture, decisions(D-060), changelog, beta validation, 이 개발 기록

### 검증과 남은 gate

- 회귀는 HUMAN active navigation이 범위 밖에서도 허용되는 기존 계약과, 같은 URL의 Evidence capture가 거부되는 새 계약을 동시에 검사한다. 빈 scope capture도 거부한다.
- 이 작업 직후 `mvn clean verify`: 124 tests, 실패·오류·skip 0. 당시 fat JAR은 2,814,634 bytes, 1,295 entries, ZIP 무결성 통과, SHA-256 `1a910883f07c38b2605f343c7fc2209740ebc41479961df8291f3ae6c4c074d8`였다. 현재 산출물은 위 source palette 작업 기록과 `beta-validation.md`를 따른다.
- 수정 전 이미 저장된 범위 밖 Evidence를 자동 삭제하지 않는다. 사용자는 새 JAR 로드 뒤 `수집 초기화`를 한 번 수행해야 한다.
- 전체 자동 회귀와 산출물 정보는 `beta-validation.md`에 기록한다. 실제 Burp 내장 브라우저에서 crAPI와 외부 사이트를 오가며 재확인하는 수동 gate는 남아 있다.

## 2026-08-26 · HUMAN exploration 경계 분리

### 목표와 성공 조건

- 로그인 세션 준비와 HUMAN pass 밖의 scope 내 요청을 삭제하지 않으면서 3-way coverage·gap에서 제외한다.
- Web quick-start에서 명시적으로 시작한 HUMAN `EXPLORATION` pass만 HUMAN 발견 성과로 계산한다.
- 로그인 캡처는 독립 phase로 남겨 향후 세션 감사와 discovery를 구분할 수 있게 한다.

### 재현·개발

- 변경 전 `TrafficClassifierTest`에 HUMAN `BASELINE` JSON API가 Evidence로는 남지만 coverage에서는 빠져야 한다는 회귀를 먼저 추가했다. 기존 코드에서 `coverageRecords` 1건이 남아 예상대로 실패했다.
- `RunPhase.SESSION_SETUP`을 추가하고, 명시적 Session Broker 로그인 캡처 중인 HUMAN 요청에만 해당 phase를 부여했다. 활성 HUMAN run context가 있으면 기존처럼 그 context의 `EXPLORATION`이 우선한다.
- `TrafficClassifier`가 HUMAN `SESSION_SETUP`/`BASELINE`을 `EXCLUDE` 하되 `RequestRecord`는 보존하도록 했다. operation override로도 이 run 경계를 우회할 수 없다.
- 저장된 프로젝트가 새 phase 규칙으로 재분류되도록 classifier version을 2로 올렸다.
- 무네트워크 온보딩 샘플의 HUMAN 레코드는 실제 탐색 산출물이므로 `EXPLORATION`으로 정정했다.

### 이유와 기각한 대안

scope는 대상 혼입을 막지만 같은 대상 안의 로그인·배경 이동·진단 구간을 구분하지는 못한다. path 정규식은 사이트별 로그인 구현을 일반화할 수 없고 business endpoint를 오분류할 수 있어 기각했다. 그래서 사용자가 이미 조작하는 로그인 캡처와 HUMAN run lease를 재사용했다.

### 영향 파일

- 코드: `RunPhase`, `TrafficClassifier`, `SampleProject`, `FlowScopeExtension`
- 테스트: `TrafficClassifierTest`, `FlowScopeExtensionPhaseTest`, `ProjectStoreTest`
- 문서: README, architecture, decisions(D-063), product plan, beta validation, changelog, 이 개발 기록

### 검증과 남은 gate

- 타겟 회귀: `mvn -Dtest=TrafficClassifierTest,FlowScopeExtensionPhaseTest,SampleProjectTest,ProjectStoreTest test`, 18 tests, 실패·오류·skip 0.
- 전체 `mvn clean verify`: 130 tests, 실패·오류·skip 0, BUILD SUCCESS.
- fat JAR: 2,814,915 bytes, 1,295 entries, ZIP 무결성 통과, `Main-Class=io.flowscope.burp.FlowScopeExtension`, SHA-256 `18460fa70e575ed04d8dfe3500c7c450a5ae413f9480a0af844a45019d4ec3fa`.
- 실제 Burp에서 로그인 캡처 중 요청이 `SESSION_SETUP`, pass 밖 요청이 기본 숨김, HUMAN pass 요청이 분석으로 표시되는지는 수동 beta gate에 남는다.

## 2026-08-26 · REVIEW를 메인 비교와 분리

### 목표와 성공 조건

- 애매한 요청과 반복 polling을 삭제하지 않으면서 확정 `INCLUDE`와 같은 graph·3-way gap 입력으로 취급하지 않는다.
- `INCLUDE/REVIEW/EXCLUDE` 수량이 서로 겹치지 않아 사용자가 분류 영향을 바로 확인할 수 있게 한다.
- UI와 Judge 모두 REVIEW Evidence에 다시 접근할 수 있어야 한다.

### 재현·개발

- 변경 전 동일 `/status` 응답 3건이 `BACKGROUND/REVIEW`로 표시되면서도 `coverageRecords` 3건에 모두 들어가는 실패 회귀를 먼저 재현했다.
- `TrafficClassification.coverageEligible()`을 `INCLUDE` 전용으로 좁히고 Pipeline의 excluded/review 집계를 처분별로 분리했다. MCP status의 excluded 수도 `captured - coverage` 계산 대신 실제 `EXCLUDE`만 센다.
- Web Evidence 표에 처분 필터를 추가했다. 기본은 `INCLUDE+REVIEW`이고 `EXCLUDE`는 사용자가 펼칠 수 있다. 메인 graph·matrix·gap은 기존 server coverage 입력을 사용하므로 `REVIEW`가 섞이지 않는다.
- MCP Judge 지침은 잠긴 후보뿐 아니라 paginated Evidence의 `REVIEW`를 별도 triage하도록 수정했다. REVIEW나 gap 자체는 취약점 증거로 승격하지 않는다.
- MCP 회귀 fixture가 API 응답임을 JSON body만으로 암묵 가정하던 부분은 실제 분류 입력인 `responseContentType=application/json`을 명시했다.

### 이유와 기각한 대안

REVIEW를 삭제하면 미탐을 복구할 수 없고, 계속 메인 graph에 넣으면 노이즈와 확정 coverage가 섞인다. 검증되지 않은 가중치 임계값은 ground truth와 calibration이 없으므로 추가하지 않았다. 따라서 Evidence 보존과 메인 비교 정확도를 분리하는 세 상태를 유지했다(D-064).

### 영향 파일

- 코드: `TrafficClassification`, `Pipeline`, `McpServer`, Web `index.html`
- 테스트: `PipelineClassificationTest`, `McpServerTest`, `FlowScopeWebServerTest`
- 실행 지침: `agent-workspace/prompts/judge.md`
- 문서: 한국어/영어 README·changelog, architecture, decisions(D-064), research, product plan, UI rationale, beta validation, 이 개발 기록

### 검증과 남은 gate

- 최초 실패: `mvn -Dtest=PipelineClassificationTest test`, REVIEW 3건이 coverage 3건이라 assertion 실패.
- 타겟 회귀: `mvn -Dtest=PipelineClassificationTest,TrafficClassifierTest,McpServerTest,FlowScopeWebServerTest test`, 38 tests, 실패·오류·skip 0.
- 전체 `mvn clean verify`: 131 tests, 실패·오류·skip 0, BUILD SUCCESS.
- fat JAR: 2,815,071 bytes, 1,295 entries, ZIP 무결성 통과, SHA-256 `5f0d60e74ae9778619c668bbc0e53797712e52ca5da7d1dbd1e6ee3cd87f95c8`.
- 1280×720 standalone: 파싱 결과 10행 → REVIEW 해제 9행 → INCLUDE도 해제 0행 → REVIEW만 선택 1행. REVIEW 상세의 `분석에 포함` 조작 노출, page overflow 0, console error 0.
- 실제 Burp Web UI에서 실제 대상 REVIEW operation 승격을 확인하는 수동 gate와 blind benchmark의 REVIEW 수·승격률 측정은 남아 있다.

## 2026-08-26 · 공개 Burp JAR 단일화

### 목표와 성공 조건

- `mvn clean verify` 뒤 사용자가 선택할 `target/*.jar`는 Burp용 fat JAR 한 개뿐이어야 한다.
- `clean` 없이 package를 반복해도 기존 fat JAR을 다시 shade하지 않고 동일 산출물을 만들어야 한다.
- 자동 테스트, manifest, ZIP 무결성과 Maven 주 artifact 계약을 유지한다.

### 재현·개발

- 변경 전 clean build의 `target/`에 fat JAR과 `original-flowscope-1.2.0-beta.3.jar` 두 개가 남는 것을 재확인했다.
- Shade 공식 parameter에는 교체 전 `original-*` 보관 파일을 삭제하는 옵션이 없음을 확인했다. 공식 AntRun 3.2.0을 Shade 뒤 같은 package phase에 배치해 정확한 intermediate 이름만 삭제하고 `target/*.jar`가 1개가 아니면 빌드를 실패시켰다.
- 첫 수정 뒤 non-clean package에서 Jar 플러그인이 기존 fat JAR을 입력으로 재사용해 중복 resource warning과 다른 크기를 만드는 결함을 추가 발견했다. Maven Jar 공식 문서가 Shade 같은 후처리 플러그인에는 `forceCreation=true`를 요구하므로 이를 명시했다.

### 이유와 기각한 대안

README에서 파일명을 구분하라는 안내만으로는 실제 오선택을 막지 못했다. Shade의 attached classifier는 thin·fat 두 JAR을 계속 노출하고, `outputFile`은 프로젝트 주 artifact를 교체·attach하지 않아 install/deploy 계약을 바꾼다. 기존 주 artifact 교체 방식을 유지하면서 공개 intermediate만 제거하는 최소 변경을 선택했다(D-058).

### 영향 파일

- 빌드: `pom.xml`
- 문서: 한국어/영어 README·changelog, decisions(D-058), product plan, UI rationale, beta validation, 이 개발 기록

### 검증과 남은 gate

- `mvn clean verify`: 131 tests, 실패·오류·skip 0, BUILD SUCCESS.
- 이어서 `clean` 없이 `mvn -DskipTests package` 재실행: 두 실행 모두 `target/*.jar` 1개, 크기 2,815,427 bytes, SHA-256 `32d7f4d4cd9651e1df4f9ca714e7deab6895f10a2080dc09b12ea3a8dd2362d3`로 동일.
- 1,295 entries, ZIP 무결성 통과, `Main-Class=io.flowscope.burp.FlowScopeExtension`, Java 21.
- 현재 재생성 JAR을 Burp Community에서 신규 load/unload하는 확인은 수동 release gate에 남는다.

## 2026-08-26 · 0-Evidence 행동 우선 onboarding

### 목표와 성공 조건

- 관측 0건에서는 분석 용어와 0 수치 대신 첫 실행 순서와 시작 조작만 보여 준다.
- Evidence가 생기면 기존 분석 작업면을 그대로 사용해 기능이나 분석 모델을 중복 구현하지 않는다.
- ADMIN이 기본 요구라는 오해를 없애고, 실제 브라우저에서 전환·overflow·console 상태를 확인한다.

### 재현·개발

- 실제 빈 standalone 프로젝트에서 좌측 필터, 권한·세션, 3-way gap, 그래프 조작과 0 상태가 처음부터 노출되는 D-057을 재현했다.
- 0건이면 `exact scope → 로그인/HUMAN pass → ZAP 기준선 → 독립 LLM Explorer/Judge` 네 단계, `빠른 시작 열기`, `샘플로 화면 익히기`만 노출하는 empty workspace를 추가했다.
- BOLA에는 서로 다른 최소 권한 계정 두 개를 권장하고 ADMIN은 BFLA 역할 비교가 필요할 때만 추가한다는 경계를 같은 화면에 명시했다.
- 샘플 또는 실제 Evidence가 생기면 기존 graph/matrix/detail 작업면으로 전환한다. 계정 설정은 빈 상태에서도 기존 화면을 재사용한다.

### 영향 파일

- Web UI: `src/main/resources/web/index.html`
- Web 계약 테스트: `src/test/java/io/flowscope/FlowScopeWebServerTest.java`
- 문서: 한국어/영어 README·changelog, architecture, decisions(D-057), UI rationale, product plan, beta validation, 이 개발 기록

### 검증과 남은 gate

- `FlowScopeWebServerTest`: 10 tests 통과.
- `mvn clean verify`: 131 tests, 실패·오류·skip 0, BUILD SUCCESS.
- 1280×720 standalone 실제 0-Evidence 화면에서 분석 rail/stage/detail 비노출, quick-start 모달, 샘플 뒤 분석 화면 전환, body overflow 0, console error 0을 확인했다.
- fat JAR: 2,816,191 bytes, 1,295 entries, ZIP 무결성 통과, `Main-Class=io.flowscope.burp.FlowScopeExtension`, SHA-256 `37bd1de531f0a837311b6830192b214fd6709e695280cab0fcc3594ef42b6232`.
- 현재 재생성 JAR의 Burp Community load/unload와 Burp에서 연 Web UI의 실제 0건→수집 전환은 수동 release gate에 남는다.

## 2026-08-26 · 인가 oracle 오탐 경계 강화

### 목표와 성공 조건

- 거부·메타데이터 응답이 소유자 확정값을 만들지 못하게 한다.
- 로그인과 비슷한 정상 redirect 경로를 deny로 오인하지 않는다.
- owner 문자열만으로 BOLA 객체 포함 및 최종 `CONFIRMED` gate가 통과하지 못하게 한다.
- 근거가 부족한 응답은 삭제하거나 정상 판정하지 않고 미확정으로 보존한다.

### 실패 재현과 수정

- 403 응답과 HEAD 200 응답의 owner 필드가 기존 코드에서 확정 owner로 등록되는 실패를 재현했다. owner 수집을 성공한 2xx OPTIONS/HEAD 이외 응답으로 제한했다.
- `/authority/profile`이 `/auth` 부분문자열 때문에 login redirect `DENY`가 되는 실패를 재현했다. 로그인·인가·오류 목적지는 완전한 경로 세그먼트만 일치시킨다.
- 응답에 대상 객체 ID가 없고 owner 문자열만 있어도 `showsObject`가 참이 되는 실패를 재현했다. 구조화 JSON의 `id` 또는 비JSON의 명시적 `id` 필드가 대상 resource ID와 일치해야 객체 Evidence로 인정한다.
- owner 값은 이메일·subject·내부 계정 ID 등 표현이 다르므로 객체 판독기에서 내부 identity 문자열과 직접 비교하지 않는다. 소유자 oracle은 별도로 확정하고, 객체 판독기는 대상 ID만 담당한다(D-065).

### 영향 파일

- 판정: `AuthorizationAnalyzer.java`, `ResponseEvidence.java`
- 회귀: `AuthorizationAnalyzerTest.java`, 신규 `ResponseEvidenceTest.java`
- 문서: 한국어/영어 README·changelog, architecture, decisions(D-065), product plan, beta validation, 이 개발 기록

### 검증과 남은 gate

- 수정 전 집중 테스트는 owner/HEAD와 redirect 2건, 객체 Evidence 2건에서 의도대로 실패했다.
- 수정 후 인가·객체 Evidence·MCP 최종 gate 집중 30 tests 통과.
- `mvn clean verify`: 137 tests, 실패·오류·skip 0, BUILD SUCCESS.
- fat JAR: 2,815,952 bytes, 1,295 entries, ZIP 무결성 통과, SHA-256 `72afef648e657ae36a2dcac75f298e69c43a475f0af666870a4fdcd2fb8eb51b`.
- 대상 응답이 객체 ID를 반환하지 않으면 자동 BOLA read 확정은 `UNDECIDED/INCONCLUSIVE`에 남는다. 실제 Burp 로그인·ZAP·Explorer/Judge 전체 workflow와 blind benchmark는 아직 통과 처리하지 않는다.

## 2026-08-26 · 신원 격리 Session Broker·ZAP·LLM 실행

### 목표와 성공 조건

- USER A/B 세션이 같은 서비스에서 섞이지 않고 성공 응답 확인 전 자동 배포되지 않는다.
- 비로그인과 선택 계정을 한 번의 사용자 조작으로 실행하되 ZAP 상태는 신원별로 초기화한다.
- 계정 레인의 기존 인증값을 제거하고 broker가 선택한 계정만 주입하며, LLM run 계정도 통제 executor까지 전달한다.
- 신원 하나라도 수집 0건 또는 단계 실패면 SCANNER 완료 gate를 열지 않는다.
- Web 자기 제어면은 scanner target이 되지 않는다.

### 실패 재현과 개발·수정

- 먼저 `UNVERIFIED`, 관리 헤더 목록, run 중 account 전환, `ZapClient.newSession`, Web 복수 계정 API를 요구하는 테스트를 추가했다. 기존 production API가 없어 test compile이 실패하는 것을 확인했다.
- 세션 material만 있고 성공 응답이 없으면 `UNVERIFIED`, 다른 계정이 같은 service에서 캡처 중이면 시작 거부, 명시 실패가 아닌 성공 응답 뒤에만 `ACTIVE`가 되도록 Session Broker를 강화했다.
- 관리형 계정 SCANNER 요청은 Authorization/Cookie/Proxy-Authorization/CSRF를 제거하고 broker 값만 주입한다. 관리형 anonymous ZAP은 fresh session을 전제로 고정 Authorization 계열만 제거하고 해당 레인에서 새로 발급된 Cookie/CSRF는 유지한다. run context가 없는 수동 scanner 요청은 변경하지 않는다.
- ZAP campaign은 비로그인 뒤 선택된 ACTIVE 계정을 순차 실행하고 각 신원 앞에서 `core/action/newSession`을 호출한다. 신원별 stage·수집·Alert·warning/error를 기록하고 Alert에 account/run provenance를 붙인다. 모든 lane 성공 뒤에만 SCANNER exploration을 완료한다.
- Web quick-start를 단일 계정 select에서 비로그인·복수 ACTIVE 계정 checkbox로 바꾸고 신원별 상태를 표시한다. 현재 Web loopback port는 target 목록과 시작 API에서 제외한다.
- LLM `account_id`가 run context 기본값으로 통제 요청에 전달되는 회귀를 추가했다.

### 이유와 기각한 대안

- 한 ZAP session에서 계정만 바꾸면 cookie jar와 crawler 상태가 교차 오염된다. 사용자가 ZAP context를 계정마다 수동 구성하는 방식은 자동화·재현성을 잃어 기각했다.
- anonymous에서 Cookie를 매 요청 삭제하면 서버가 해당 레인에 발급한 익명 session/CSRF까지 끊기므로 fresh-session 경계와 함께 lane-local 상태를 유지한다.
- 모든 localhost를 막으면 crAPI 같은 허가된 로컬 대상을 점검하지 못하므로 FlowScope Web의 실제 port만 차단한다. 결정과 한계는 D-066에 기록했다.

### 영향 파일

- 실행: `SessionBroker.java`, `RunContextRegistry.java`, `ZapClient.java`, `McpServer.java`, `FlowScopeExtension.java`, `FlowScopeWebServer.java`
- UI: `src/main/resources/web/index.html`
- 회귀: `SessionBrokerTest.java`, 신규 `RunContextRegistryTest.java`, `ZapClientTest.java`, `McpServerTest.java`, `FlowScopeWebServerTest.java`
- 문서: 한국어/영어 README·changelog, architecture, decisions(D-066), UI rationale, beta validation, 이 개발 기록

### 검증과 남은 gate

- 첫 집중 실행은 기존 Web 테스트가 material만으로 `ACTIVE`를 기대해 35 tests 중 1건 실패했다. 구현을 약화하지 않고 성공 응답을 포함한 실제 캡처 왕복으로 테스트를 수정했다.
- 수정 후 집중 Session/MCP/ZAP/Web 회귀가 통과했다.
- 1280×720·600×800 standalone에서 비로그인 scanner control, page/modal 가로 overflow 0, 좁은 폭 modal scroll, 신원/target 미선택 버튼 비활성, browser warning/error 0을 확인했다. ACTIVE USER A/B chip은 standalone fixture에 없어 자동 HTML/API 계약까지만 검증했다.
- `JAVA_HOME=/opt/homebrew/opt/openjdk@21 mvn clean verify`: 144 tests, 실패·오류·skip 0, BUILD SUCCESS.
- fat JAR: 2,823,288 bytes, 1,297 entries, ZIP 무결성 통과, 공개 JAR 1개, `Main-Class=io.flowscope.burp.FlowScopeExtension`, SHA-256 `58d5f982270ca5c868e147f5de420ef82a8a1eaf2d32509730353d4c367a41c7`.
- `ACTIVE`는 범용 transport 확인이지 application-specific `/me`, 계정 소유, role 증명이 아니다. ZAP 2.17·현재 Burp JAR·실제 로그인으로 비로그인→USER A→USER B 캠페인과 새 Web control을 확인하는 수동 gate가 남는다.

## 2026-08-26 · 요청 시점 신원 고정과 익명 3-source 실환경 검증

### 목표와 성공 조건

- USER A를 선택했지만 실제 브라우저가 USER B 또는 비로그인인 경우 USER A Evidence로 오기록하지 않는다.
- ZAP 계정 lane 전환 뒤 늦게 도착한 응답도 요청을 시작한 run/account에 남긴다.
- fresh anonymous ZAP lane은 서버 Cookie/CSRF를 유지해도 `ANONYMOUS` 신원을 유지한다.
- 현재 JAR을 Burp Community·ZAP·crAPI·MCP에 실제 연결해 HUMAN/SCANNER/LLM 분리와 exact-scope 차단을 확인한다.

### 실패 가능성 검토와 개발·수정

- 기존 Proxy 응답 경로가 응답 시점의 전역 `RunContextRegistry`를 읽어 ZAP lane 전환과 늦은 응답 사이에 경합이 있음을 확인했다. Proxy 요청의 Montoya `messageId`에 요청 시점 context와 HUMAN login-capture account를 임시 저장하고 응답에서 소비하도록 바꿨다. 테이블은 20,000건·10분 TTL이며 unload에서 비운다.
- 기존 HUMAN pass는 dropdown의 account ID를 그대로 신원으로 사용할 수 있었다. Web 시작 API에서 선택 계정의 broker 상태가 `ACTIVE`인지 검사하고, 캡처에서는 실제 요청 자격증명이 선택 계정과 exact match할 때만 해당 account ID를 사용하도록 바꿨다. 명시적 로그인 캡처 account는 우선한다.
- SYSTEM anonymous ZAP context는 lane 안에서 서버 Cookie가 발급돼도 fingerprint를 `anon`으로 고정했다. 일반 HUMAN·수동 scanner의 미연결 Cookie는 기존 `UNRESOLVED` 경계를 유지한다.
- Web UI 버전 표기를 `v1.2.0-beta.3`으로 맞추고 HUMAN 계정 선택에는 `ACTIVE` 계정만 활성화하며 나머지는 `로그인 필요`로 표시했다.

### 이유와 기각한 대안

- 화면 선택값을 실제 신원 authority로 쓰면 사용자의 단순 선택 실수가 BOLA/BFLA 비교 데이터 전체를 오염시킨다. actual broker credential match를 요구했다.
- 응답 시점 전역 context만 읽는 단순 구현은 비동기 HTTP와 순차 lane 실행에서 안전하지 않다. scanner를 매 요청마다 직렬 대기시키는 방식은 성능을 떨어뜨리고 브라우저형 crawler 동작과 맞지 않아 request-time correlation을 선택했다.
- anonymous Cookie를 모두 제거하면 상태형 공개 흐름을 끊고, Cookie fingerprint를 계정처럼 쓰면 비로그인 lane이 미확정 신원으로 바뀌므로 lane-local 상태와 FlowScope 신원을 분리했다(D-067).

### 영향 파일

- Burp 수집·신원: `src/main/java/io/flowscope/burp/FlowScopeExtension.java`
- Web 실행 gate: `src/main/java/io/flowscope/web/FlowScopeWebServer.java`
- Web UI: `src/main/resources/web/index.html`
- 회귀: `FlowScopeExtensionPhaseTest.java`, `FlowScopeWebServerTest.java`
- 문서: 한국어/영어 README·changelog, architecture, decisions(D-067), UI rationale, product plan, beta validation, 이 개발 기록

### 자동 검증

- 선택 HUMAN account exact match/mismatch, login-capture 우선, source별 account 해석, SYSTEM anonymous Cookie의 `anon` 유지 회귀를 추가했다.
- Web account HUMAN pass는 broker session이 없거나 `ACTIVE`가 아니면 거부하고 활성화 뒤에만 시작되는 회귀를 추가했다.
- `mvn clean verify`: 147 tests, 실패·오류·skip 0, BUILD SUCCESS.
- JDK 21을 명시한 fat JAR: 2,826,076 bytes, 1,298 entries, ZIP 무결성 통과, 공개 JAR 1개, `Build-Jdk-Spec=21`, SHA-256 `e8d41fbdea56101063d59ec27b378de5ee9a06d001c516122eeac8c0446b4cae`.

### 실제 crAPI 연동 검증

- 환경: Burp Community 2026.7.3, ZAP 2.17.0, crAPI `http://127.0.0.1:8888/`, exact scope 동일, HUMAN 8080·SCANNER 8081·ZAP API 8089·MCP 8787·Web 17777.
- HUMAN listener 8080에 `curl`을 프록시로 연결한 `qa-human-anon-1`: `/` 200과 `/favicon.ico` 404 두 건이 listener profile에 따라 `HUMAN/BROWSER/EXPLORATION`으로 수집됐다. 이는 실제 Burp Browser 검증이 아니다. 둘은 `REVIEW`라 메인 coverage에는 자동 포함되지 않았고 첫 dataset lock은 HUMAN 탐색 응답 부족으로 거부됐다. `qa-human-api-2`에서 당시 `API/INCLUDE`로 분류된 `/manifest.json` 200 한 건을 추가했다.
- SYSTEM ZAP `zap-baseline-1787717447157`: `COMPLETED/ALERTS_READY`, 수집 8건, native alert 22건. 8건 모두 `SCANNER/CONTROLLED/ANONYMOUS`; 정적 4건 `EXCLUDE`, `/manifest.json` 1건 `API/INCLUDE`, 나머지 3건 `REVIEW`였다. Alert 22건은 ZAP 출력 수이며 취약점 확정 수가 아니다.
- MCP initialize `2025-06-18`, 도구 24개, status를 확인했다. Codex Explorer context `qa-llm-anon-1`에서 `/manifest.json` 통제 GET 1건을 `LLM/CONTROLLED` Evidence로 만들었고 Explorer status는 자기 LLM 1건만 보였다. 범위 밖 `http://127.0.0.1:17777/` 요청은 거부됐다. run 종료 뒤 HUMAN 3·SCANNER 8·LLM 1, 총 12건을 잠갔고 finding·gap은 각각 0건이었다. 잠긴 ZAP snapshot을 읽을 수 있었고 잠금 뒤 새 Explorer는 거부됐다.
- 최종 JDK 21 JAR SHA-256 `e8d41fbd...6b4cae`를 Burp에서 제거·재로드한 뒤 Web/MCP/8080/8081 재기동과 UI `v1.2.0-beta.3` 표기를 확인했다. 재로드된 정확한 산출물에서도 HUMAN 1·SCANNER 8·LLM 1의 10건 lock, finding·gap 0, ZAP Alert 22건, Explorer 자기 Evidence 1건 시야, 범위 밖 요청 거부가 동일했다.

### 남은 한계·다음 gate

- 실제 USER A/B의 `UNVERIFIED→ACTIVE`, 선택 계정 exact match/mismatch, 복수 계정 ZAP lane과 LLM account injection은 로그인 계정이 필요해 아직 실측하지 않았다.
- 구독형 Codex/Claude가 제공 prompt 전체와 lock 이후 Judge/validation을 끝까지 수행한 것은 아니다. 이번 검증은 동일 MCP protocol을 사용한 실제 통제 요청과 가시성·scope gate까지다.
- Repeater handoff, project save/load, extension unload/재로드는 다음 P4 gate다. crAPI 알려진 정답과 공격 절차는 보지 않았다.

## 2026-08-26 · HUMAN 분류·미요청 경로 계획 재감사

### 목표와 성공 조건

- scanner와 LLM 구현은 동결하고 HUMAN/Burp 트래픽의 business operation 분류, 노이즈, 미요청 경로 표현만 공식 근거와 현재 코드로 재검토한다.
- 현재 JAR이 검증하지 않은 성능을 문서가 완료로 주장하지 않게 한다.
- 임의 가중치나 crAPI 전용 path 없이 테스트 우선 구현 계획을 고정한다.

### 조사·교정

- `TrafficClassifier.isApiMediaType()`가 모든 `+json`을 API로 인정해 표준 `application/manifest+json`도 `INCLUDE`하는 것을 코드에서 확인했다. 현재 테스트에는 manifest 회귀가 없다.
- 실제 스모크 기록과 최종 10건을 대조해 세 source의 유일한 `INCLUDE`가 `/manifest.json`이었음을 확인했다. 따라서 dataset lock은 wiring 검증이지 business API 탐색 품질 검증이 아니다.
- HUMAN 8080 스모크는 실제 Burp Browser가 아니라 `curl` 프록시 전송이었다. listener mapping의 `BROWSER` detail을 실행 도구 증명으로 사용한 문구를 정정했다.
- `AuthorizationAnalyzer.addUncrossed()`가 관측 identity와 관측 operation/resource만 교차하며 미관측 endpoint inventory를 만들지 않는 것을 확인했다.
- `SnapshotJsonWriter`가 추출된 모든 object candidate에 근거 계산 없이 `confidence=1.0`을 넣고 Web UI가 `신뢰도 100%`로 표시하는 것을 확인했다. 측정값으로 오해될 수 있어 P4-H에서 추출 근거 enum으로 교체하도록 계획했다.
- 로컬 Montoya 2026.7 API JAR을 직접 검사해 `MontoyaApi.siteMap()`, `SiteMap.requestResponses(filter)`, `HttpRequestResponse.hasResponse()`가 있음을 확인했다. Community 실제 반환 동작은 구현 전 수동 gate로 남겼다.
- W3C Fetch Metadata·Web App Manifest, PortSwigger Site Map/HTTP history/Montoya 문서, OWASP IDOR/BOLA 지침을 근거로 observed graph와 provenance-backed route candidate를 분리하는 P4-H 계획을 추가했다.

### 영향 파일

- `README.md`
- `CHANGELOG.md`, `docs/en/README.md`, `docs/en/CHANGELOG.md`
- `docs/ko/architecture.md`
- `docs/ko/product-development-plan.md`
- `docs/ko/beta-validation.md`
- `docs/ko/decisions.md` D-067 정정 및 D-068 계획 결정
- 이 개발 기록

### 검증과 남은 gate

- 이번 작업은 조사·계획·기록 정정이며 Java 코드나 JAR을 변경하지 않았다. 기존 147-test/JAR 해시는 새 기능 검증으로 재사용하지 않는다.
- 문서 정정 뒤 `JAVA_HOME=/opt/homebrew/opt/openjdk@21 mvn clean verify`를 다시 실행해 147 tests, 실패·오류·skip 0, BUILD SUCCESS를 확인했다. 결정론적 JAR은 2,826,076 bytes, SHA-256 `e8d41fbdea56101063d59ec27b378de5ee9a06d001c516122eeac8c0446b4cae`로 코드 변경 전과 동일했다.
- 다음 구현은 P4-H H1의 manifest 실패 fixture부터 시작해야 한다. classifier v3, RouteCandidate 저장 모델, graph 표현, 실제 Burp Browser pass가 끝나기 전에는 JAR을 업데이트된 HUMAN 분석 제품으로 부르지 않는다.
- 수치 가중치는 고정 corpus와 블라인드 결과 전에는 정하지 않는다. 현재 D-068은 `열림 · 구현 전 사용자 검토` 상태다.

## 2026-08-26 · 1.2.0-beta.4 · HUMAN 공격면과 미요청 route 분리

### 목표와 성공 조건

- target별 예외나 crAPI 정답을 넣지 않고 사람이 남긴 exact-scope traffic의 business graph 노이즈를 줄인다.
- 실제 request/response와 응답·Site Map에서만 발견된 미요청 route를 별도 모델·수량·시각 문법으로 분리한다.
- 후보가 coverage, 3-way gap, owner, verdict, finding, lane 완료를 오염시키지 않으며 모든 후보에 provenance가 있어야 한다.
- 고정 100% confidence와 임의 수치 가중치를 제거하고 추출·정렬 이유를 노출한다.
- 버전·한국어/영어 사용자 문서·설계·결정·계획·검증 기록을 실제 코드와 맞춘 뒤 전체 회귀, 단일 JAR, 브라우저 QA를 통과한다.

### 개발·수정

- `TrafficClassifier.VERSION`을 3으로 올리고 web manifest, source map, service worker를 `DISCOVERY_METADATA/EXCLUDE`로 분류했다. 한 record의 약한 신호만으로 API를 확정하지 않고 같은 service·정규화 operation에 강한 비사용자-override `API/INCLUDE` Evidence가 있을 때만 immutable discovery gate를 통과한 `REVIEW` 형제를 보강한다.
- `RouteCandidate`와 `RouteCandidateExtractor`를 추가했다. 저장된 exact-scope HTML link/form, `Location`, robots/sitemap, manifest, 정적 fetch/axios/XHR literal, 관측 OpenAPI와 응답 없는 Burp Site Map item을 service·method/unknown·normalized path로 합치고 모든 provenance ID를 보존한다.
- HTML manifest link는 `rel`·`href` 속성 순서와 복수 rel token을 허용한다. `fetch(url)`은 default GET, 정적인 options method는 해당 verb, 동적 options는 `UNKNOWN`으로 보존해 POST를 GET으로 꾸미지 않는다.
- Proxy history 가져오기 때 Site Map을 함께 조회하되 response가 있는 item은 기존 관측 경로에 맡기고, response가 없는 exact-scope item만 `BURP_UNREQUESTED` seed로 보존한다. scope 변경·초기화·sample에서는 stale candidate를 제거하고 project save/load에서 candidate를 왕복한다.
- candidate는 Web snapshot의 별도 root에만 기록하고 관측 `Pipeline.Result`에 주입하지 않았다. Web에는 별도 수량·목록·필터와 중립색·점선 테두리 operation 노드, provenance·적용 가능성·범주형 정렬 근거 상세를 추가했다. source edge와 authorization verdict는 만들지 않는다.
- candidate 정렬은 수치 score가 아니라 적용 가능성, 명시 method, 객체 template, state-changing, 복수 provenance의 사전식 category 순서다. 현재 모델에 없는 authorization 신호는 꾸며 넣지 않았다.
- object detail의 고정 `confidence=1.0`을 `PATH_ID/QUERY_ID/BODY_ID/GRAPHQL_VARIABLE/DERIVED/NONE` 근거로 교체하고 nested/array JSON과 multipart ID 추출을 회귀로 고정했다.
- Maven/MCP/Web/README 버전을 `1.2.0-beta.4`로 맞추고 새 산출물 이름을 `flowscope-1.2.0-beta.4.jar`로 올렸다.

### 이유와 기각한 대안

- Burp Site Map은 requested/unrequested를 구분하고 HTTP history filter는 항목을 삭제하지 않는다. 이 제품도 Evidence 보존과 분석 처분, observed와 candidate를 나눠야 사용자가 “밟은 경로”와 “참조만 본 경로”를 혼동하지 않는다.
- candidate를 HUMAN source edge나 `UNCROSSED`에 넣는 안은 사람이 하지 않은 요청을 coverage로 꾸미므로 기각했다. 모든 link를 GET으로 만드는 안도 method 근거가 없어 `UNKNOWN`으로 남겼다.
- JavaScript AST 전체 해석이나 headless browser 실행을 이번 변경에 넣는 안은 동적 실행 의미와 네트워크 부작용을 일반화할 수 없어 기각했다. 정적 literal만 보수적으로 추출한다.
- 수치 confidence/가중치는 고정 corpus와 blind benchmark 결과 없이 성능처럼 보이므로 기각했다. 화면의 이유 enum과 deterministic category order만 사용한다.

### 영향 파일

- core: `TrafficClassification`, `TrafficClassifier`, `Pipeline`, `Normalizer`, `RouteCandidate`, `RouteCandidateExtractor`
- Burp·저장·Web: `FlowScopeExtension`, `ProjectStore`, `FlowScopeWebServer`, `SnapshotJsonWriter`, `web/index.html`, `McpServer`
- 회귀: `TrafficClassifierTest`, `RouteCandidateExtractorTest`, `AdvancedNormalizerTest`, `ProjectStoreTest`, `FlowScopeWebServerTest`
- 공개 정본: root/영문 README·CHANGELOG, 한국어 architecture·decisions·product plan·UI rationale·beta validation·development log

### 검증

- 변경 전 clean 기준선은 147 tests였다. 새 enum/model/API를 테스트부터 연결한 최초 compile에서는 존재하지 않는 `RouteCandidate`, `DISCOVERY_METADATA`, `resourceEvidence` 참조가 실패했고, manifest fixture는 기존 `API/INCLUDE` 결과 때문에 실패했다. 해당 실패를 구현 후 회귀로 유지했다.
- 최종 `mvn clean verify`: 157 tests, 실패 0, 오류 0, skip 0, BUILD SUCCESS.
- 배포물은 `target/flowscope-1.2.0-beta.4.jar` 하나이며 ZIP 무결성, `Main-Class=io.flowscope.burp.FlowScopeExtension`, Java 21 bytecode 계약을 확인했다. 크기와 digest는 `beta-validation.md`에 기록했다.
- 실제 standalone Web UI를 1280×720과 600×800에서 열어 가로 overflow 0, 잘린 핵심 조작 0, console warning/error 0을 확인했다. 이 검증은 Burp suite tab이나 실제 Site Map item을 대신하지 않는다.

### 남은 한계·다음 gate

- 새 beta.4 JAR을 Burp Community에서 제거·재로드하고 suite tab/Web/MCP/listener 기동을 다시 확인해야 한다.
- 응답 없는 실제 Burp Site Map item이 `BURP_UNREQUESTED`로 나타나고 project 왕복 뒤 provenance가 유지되는지, candidate가 있는 실제 그래프를 확인해야 한다.
- 실제 Burp Browser HUMAN pass로 document/static/API 분류와 REVIEW 작업량을 측정하고 일반 MPA·SPA·GraphQL fixture confusion matrix를 공개해야 한다.
- 저장 응답은 필드별 8KiB이며 route candidate는 관측 operation을 먼저 보존한 뒤 최대 20,000개로 제한한다. 동적 JavaScript·클라이언트 런타임 생성 route는 추측하지 않는다. 모든 endpoint 또는 오탐·미탐 0을 주장하지 않는다.
- 위 gate 전에 crAPI 정답을 보거나 target 전용 규칙을 넣지 않는다. blind benchmark는 사용자 검토 뒤 시작한다.

## 2026-08-26 · 1.2.0-beta.5 · 공통 route discovery 기반

### 목표와 성공 조건

- framework·제품·benchmark target에 종속되지 않은 공통 endpoint 발견 계약을 먼저 고정한다.
- 포맷별 발견과 공통 scope/method/정규화/dedup 판단을 분리한다.
- method·관측 여부·provenance를 추측으로 승격하지 않고 프로젝트 왕복과 Web 상세에서도 대응 관계를 잃지 않는다.
- 일반 protocol fixture, 전체 회귀, 완성 fat JAR runtime, 재현 가능한 단일 배포물 검증을 통과한다.

### 개발·수정

- `RouteDiscoveryDocument`, `DiscoveredRoute`, `RouteDiscoveryAdapter` 계약을 추가하고 `RouteCandidateExtractor`를 공통 gate로 재구성했다. adapter는 네트워크·scope·저장·관측 판정을 수행하지 않는다.
- HTML은 jsoup의 로컬 HTML5 DOM으로 깨진 markup, `<base>`, link/form/formaction/script/embed/meta refresh와 inline static call site를 처리한다. jsoup의 네트워크 API는 사용하지 않는다.
- JavaScript는 fetch, axios verb, XHR.open, jQuery get/post/ajax, sendBeacon의 정적 string literal만 읽고 문자열 결합은 후보로 만들지 않는다.
- OpenAPI/Swagger는 대상 응답에서 관측한 JSON·YAML의 명시 operation과 server/base를 읽는다. 해소할 default가 없는 server variable은 임의 base로 대체하지 않는다.
- metadata는 Location, robots Allow/Disallow/Sitemap, Web App Manifest start_url/scope/id/shortcut을 처리한다. generic XML은 제품명 없이 명시 URL/method field만 읽고 DOCTYPE·외부 entity·외부 DTD/schema를 차단한다.
- 공통 코어가 http(s), exact scope, method token, schema parameter/path 정규화, candidate 상한과 `service + method + normalized path` dedup을 단독 집행한다. 같은 path의 관측 `GET`은 미관측 `UNKNOWN`을 관측으로 승격하지 않는다.
- `RouteCandidate` provenance를 `(type, evidenceId, source, runId, adapter)`로 바꿨다. 저장·복구·snapshot·Web 상세가 이 대응을 유지하며 legacy 분리 배열은 type×Evidence 조합을 꾸며내지 않고 `LEGACY_UNMAPPED/UNKNOWN/legacy-project`로 이관한다. restored/new candidate도 같은 병합 함수로 합친다.
- Jackson YAML 2.22.2, SnakeYAML 2.5, jsoup 1.23.1을 fat JAR에 포함하고 고지 파일을 추가했다. Shade service transformer로 relocated Jackson service metadata를 병합했다.
- Maven/MCP/Web/README 버전을 `1.2.0-beta.5`로 맞췄다.

### 이유와 기각한 대안

- 포맷마다 scope·method·dedup 로직을 복제하면 새 parser를 추가할 때 관측 의미가 달라진다. 그래서 세부 adapter보다 공통 불변조건을 먼저 코드로 고정했다.
- HTML 정규식은 깨진 markup과 `<base>` 해석이 브라우저 DOM과 달라 기각했다. HTML parser는 로컬 입력만 처리한다.
- target 전용 XML element명, crAPI 경로, 기존 취약점 정답은 넣지 않았다. 그런 규칙은 일반 제품 성능을 증명하지 못하고 blind 평가를 오염시킨다.
- 동적 JS 실행·전체 AST·headless browser는 네트워크 부작용과 실행 문맥을 이번 공통 계약에서 일반화할 수 없어 후속 adapter gate로 남겼다.
- 고정 fixture의 0 FP/FN을 제품 성능으로 쓰지 않는다. 같은 fixture는 구현 회귀만 검출하며 blind target 평가는 별도다.

### 영향 파일

- common core/model: `RouteCandidate`, `RouteCandidateExtractor`, `core/discovery/*`
- integration/persistence/Web: `FlowScopeExtension`, `ProjectStore`, `SnapshotJsonWriter`, `web/index.html`, `McpServer`
- build/notices: `pom.xml`, `META-INF/LICENSE-jsoup.txt`, `META-INF/NOTICE.txt`
- regression corpus/tests: `RouteCandidateExtractorTest`, `EndpointDiscoveryCorpusTest`, `endpoint-corpus.json`, `ProjectStoreTest`, `FlowScopeWebServerTest`
- 공개 정본: root/영문 README·CHANGELOG, 한국어 architecture·decisions·product plan·UI rationale·beta validation·development log

### 검증

- `mvn clean verify`: 164 tests, 실패 0, 오류 0, skip 0, BUILD SUCCESS.
- 일반 protocol fixture 7종·truth route 18개: TP 18, FP 0, FN 0. negative CSS, 범위 밖 URL, 동적 JS 결합, XXE, `GET`/`UNKNOWN` 관측 분리를 회귀로 고정했다.
- JDK 21에서 완성 fat JAR만 classpath에 두고 HTML/OpenAPI YAML/XML adapter를 직접 실행해 `FAT_JAR_DISCOVERY_SMOKE_OK`를 확인했다.
- 배포물은 `target/flowscope-1.2.0-beta.5.jar` 하나, 3,787,475 bytes, 1,940 entries, SHA-256 `e5cf26d00aa3446ec9983114d7d8c35eb850d16f815387c14becbb787b087c50`다. ZIP 무결성, `Main-Class=io.flowscope.burp.FlowScopeExtension`, Java 21, dependency class/notice/service entry를 확인했고 연속 non-clean package digest가 동일했다.

### 남은 한계·다음 gate

- beta.5 JAR의 Burp Community 제거·재로드, 실제 응답 없는 Site Map item, 실제 Burp Browser route candidate UI는 아직 수동 검증하지 않았다.
- 고정 corpus는 실제 사이트 분포, minified/bundled JavaScript, runtime route, GraphQL schema, framework 전용 descriptor를 대표하지 않는다. blind target 전에 발견률을 주장하지 않는다.
- 다음 챕터는 공통 provenance를 이용한 source/run별 독립 Explorer 후보 가시성과 dataset lock 정합성이다. 그 뒤에만 framework-specific adapter 또는 세부 탐색을 추가한다.

## 2026-08-26 · 1.2.0-beta.6 · source/run 후보 격리와 candidate lock

### 목표와 성공 조건

- 독립 Explorer가 자기 run에서 발견한 route만 보고 HUMAN/SCANNER의 후보·상태·통계를 추론할 수 없게 한다.
- 병합된 top-level 후보 상태를 단순 재사용하지 않고 provenance 단위로 observed/applicability/reason을 다시 계산한다.
- Judge가 보는 route inventory를 Pipeline dataset과 같은 lock 시점에 고정한다.
- 변경된 MCP·저장·Web 계약과 배포 버전을 문서·테스트·JAR에 일치시킨다.

### 개발·수정

- provenance에 `applicability`와 `reason`을 추가하고 project/snapshot/Web 상세까지 대응 관계를 보존했다. 기존 새-format project에 이 필드가 없으면 보수적으로 `REVIEW`로 읽는다.
- `RouteCandidateViews.forRun`을 추가했다. 지정 source/run의 provenance만 남기고 `OBSERVED_REQUEST` 존재 여부와 provenance applicability/reason으로 후보 상태를 다시 만든다.
- MCP `State`에 route candidate read view를 추가하고 Burp extension의 현재 inventory를 연결했다.
- `flowscope_list_route_candidates`를 추가했다. Explorer 중에는 현재 LLM run view, lock 뒤에는 잠긴 전체 route inventory를 최대 200개씩 반환한다. 각 항목은 정렬 근거와 provenance 대응을 포함한다.
- pre-lock `flowscope_get_status`는 active Explorer가 없어도 cross-source count·coverage·gap·finding·active run을 숨긴다. Explorer 중에는 자기 captured/coverage/classification/route candidate 수와 LLM run만 표시한다.
- 독립 Explorer가 ZAP environment/status/baseline/passive/execution과 기존 assessment/validation 목록을 읽지 못하도록 서버 gate를 추가했다.
- dataset lock에 `lockedRouteCandidates`를 추가하고 reset 시 함께 지운다. lock 결과에 잠긴 route 수를 반환한다.
- Maven/MCP/Web/README 버전을 `1.2.0-beta.6`으로 맞췄다.

### 이유와 기각한 대안

- 전역 candidate에서 provenance만 지우고 top-level `observed/applicability`를 유지하면 다른 lane의 결론이 남으므로 기각했다. 상태도 현재 provenance로 재계산해야 독립 view다.
- Explorer 시작 전에는 전체 status를 보여 주는 기존 동작도 MCP caller가 답을 먼저 볼 수 있어 서버 격리가 아니므로 제거했다.
- route list를 live state에서 계속 읽게 하면 validation traffic이나 background rebuild가 lock 뒤 Judge 입력을 바꾸므로 immutable snapshot을 선택했다.
- session 목록은 비밀 없는 계정 선택 정보이며 raw Cookie/token을 반환하지 않아 유지했다. 이 경계는 실제 구독 클라이언트 사용성 검증 뒤 재검토할 수 있다.

### 영향 파일

- core: `RouteCandidate`, `RouteCandidateViews`, `RouteCandidateExtractor`
- MCP/Burp: `McpServer`, `FlowScopeExtension`
- persistence/Web: `ProjectStore`, `SnapshotJsonWriter`, `web/index.html`
- tests: `RouteCandidateViewsTest`, `McpServerTest`, `FlowScopeWebServerTest`
- agent workflow/public docs/version: Explorer/Judge prompt와 agent-workspace README, root/영문 README·CHANGELOG, 한국어 architecture·decisions·product plan·UI rationale·beta validation·development log, `pom.xml`

### 검증

- 집중 회귀 `RouteCandidateViewsTest,McpServerTest,ProjectStoreTest,FlowScopeWebServerTest`: 33 tests, 실패·오류·skip 0.
- `mvn clean verify`: 165 tests, 실패 0, 오류 0, skip 0, BUILD SUCCESS.
- 배포물은 `target/flowscope-1.2.0-beta.6.jar` 하나, 3,791,977 bytes, 1,941 entries, SHA-256 `db8aa738accdb70991d9015b17029775774a5aa01f026403014715fbe5290ab9`다. ZIP 무결성, Main-Class, Java 21, 반복 package digest 동일성을 확인했다.
- 완성 fat JAR만 classpath에 둔 HTML/OpenAPI YAML/XML runtime smoke는 `FAT_JAR_DISCOVERY_SMOKE_OK`였다.

### 남은 한계·다음 gate

- 실제 Codex/Claude가 beta.6 MCP로 Explorer를 시작하기 전/중/lock 뒤 호출했을 때 같은 격리가 유지되는지 end-to-end 검증하지 않았다.
- extension worker가 Pipeline과 route inventory를 연속 publish한다. lock 호출과 지연 응답/rebuild가 경합하는 Burp runtime stress는 아직 자동화하지 않았다.
- beta.6 JAR의 Burp Community 재로드와 실제 candidate UI/Site Map gate는 beta.5에서 이어진다.

## 2026-08-27 · 1.2.0-beta.7 · 구독 CLI Explorer/Judge 버튼 파이프라인

### 목표와 성공 조건

- 사용자가 Web 빠른 시작에서 공급자·대상·선택 계정을 고르고 독립 LLM Explorer와 별도 Judge를 시작할 수 있게 한다.
- Explorer는 과거 대화를 재사용하지 않고 자기 run만 남기며, Judge는 세 레인 lock 뒤 별도 세션으로 시작하고 후속 질문만 같은 Judge 세션을 재개한다.
- CLI 종료 코드나 모델 문장을 완료로 믿지 않고 exact run 종료·3-lane 완료·dataset lock·Evidence validation이라는 기존 서버 gate를 유지한다.
- 토큰·provider 로그인 정보·임시파일·출력과 scope 변경이 새 subprocess 경계에서 기존 신뢰 모델을 깨지 않게 한다.

### 개발·수정

- `LocalLlmRunner`를 추가했다. Burp 시작 PATH 또는 명시적 시스템 속성의 regular executable을 찾아 shell 없이 Codex/Claude를 실행한다.
- Explorer는 owner-only 임시 workspace에서 Codex `exec --ephemeral --ignore-user-config --strict-config`·read-only/no-approval·웹 검색 비활성화 또는 Claude strict MCP/no-persistence/빈 setting sources/auto-memory 비활성화/역할별 tool allowlist로 시작한다. FlowScope가 exact run을 먼저 만들고 prompt에 target·scope·account·run ID와 번들 AGENTS/Explorer 지침을 표준입력으로 전달한다.
- Judge는 Explorer와 다른 새 provider session을 사용한다. Codex JSON의 `thread_id` 또는 Claude UUID를 보존하고 Web의 `Judge 계속`만 exact session ID로 resume한다. CLI 프로세스는 각 turn 종료 후 닫힌다.
- Web `/api/llm-run`에 상태·scope·완료 레인, Explorer/Judge 시작, 취소, Judge 후속 요청을 추가했다. 빠른 시작에 provider, target, ACTIVE account, 시작/취소/후속 controls와 상태·metadata 경고를 배치했다.
- MCP Bearer는 child environment에만 전달한다. prompt·command line·project에는 넣지 않고 Codex 모델 shell에는 전달하지 않는다. 상속된 `OPENAI_API_KEY`·`ANTHROPIC_API_KEY`를 제거하고, status에는 마스킹·64KiB 상한의 output tail만 반환한다. Codex session event는 긴 출력 tail에서 밀려나도 bounded prefix에서 복구한다.
- locked dataset에는 Explorer를 추가하지 못하게 하고 active run 또는 lock 중 Burp UI scope 변경을 거부한다. 새 exploration이 시작되면 같은 source의 과거 완료 표식을 즉시 제거해 실패한 재실행의 부분 Evidence로 Judge가 열리지 않게 했다.
- sample/reset/project load는 완료된 Judge resume handle을 무효화하며 실행 중이면 취소한다. 취소 또는 Burp unload 직후 child 생성이 완료되는 경합에서도 닫힘 상태를 재검사해 그 child를 종료하고, 종료된 runner의 새 실행을 거부한다. Claude no-persistence metadata 잔존 가능성은 삭제로 가장하지 않고 UI와 문서에 표시한다.
- `agent-workspace`의 Explorer prompt는 launcher가 pre-start한 run과 수동 fallback의 run 시작을 구분한다. 세 지침 리소스를 fat JAR에 포함했다.
- Maven/MCP/Web/README 버전을 `1.2.0-beta.7`로 맞췄다.

### 이유와 기각한 대안

- Explorer와 Judge를 한 CLI 대화에서 연속 수행하면 LLM lane이 HUMAN/ZAP 결과에 노출돼 3-way 비교가 독립 실험이 아니게 되므로 기각했다.
- 사용자 provider OAuth/token을 FlowScope가 직접 받거나 API key를 저장하는 방식은 구독 CLI 요구와 비밀 경계를 깨므로 기각했다.
- 장기 terminal 프로세스를 계속 켜 두는 대신 provider session ID로 Judge turn을 재개한다. 이는 Burp unload·오류 복구가 단순하고 사용자에게 실제 지속 의미를 정직하게 설명한다.
- `--no-session-persistence` 뒤 provider 홈을 광역 삭제하면 다른 세션을 손상할 수 있어 기각했다. Explorer ID를 저장·resume하지 않는 논리 격리와 명시적 경고를 선택했다.
- CLI 0 exit만 성공으로 쓰는 방식은 MCP run 미종료·dataset 미잠금을 놓치므로 서버 상태를 완료 조건으로 유지했다.
- 후보 가중치나 최종 판정 규칙은 이 자동화와 무관하므로 변경하지 않았다. 기존 범주형 정렬과 Evidence gate가 계속 권위다.

### 영향 파일

- 실행기·상태: `LocalLlmRunner`, `RunContextRegistry`, `McpServer`, `FlowScopeExtension`
- Web API/UI: `FlowScopeWebServer`, `web/index.html`
- prompt/build: `agent-workspace/prompts/explorer.md`, `pom.xml`
- tests: `LocalLlmRunnerTest`, `RunContextRegistryTest`, `FlowScopeExtensionPhaseTest`, `FlowScopeWebServerTest`
- 공개 정본: root/영문 README·CHANGELOG, 한국어 architecture·decisions·product plan·UI rationale·beta validation·development log

### 검증

- 구현 도중 두 테스트 픽스처 결함을 즉시 노출·수정했다: 존재하지 않는 `Orchestrator.USER` 사용, Codex Judge test의 LLM 완료 레인 누락. 제품의 active/3-lane gate를 약화하지 않았다.
- 코드 리뷰에서 긴 Codex 출력의 첫 thread ID 손실, lock 뒤 Burp UI scope 변경, 재탐색 실패 뒤 과거 완료 표식 잔존을 발견하고 각각 bounded prefix, scope mutation guard, completion invalidation 회귀로 고정했다.
- 현재 로컬 Codex CLI 0.147.0과 Claude Code 2.1.231의 `--help`에서 사용하는 ephemeral/resume/session/MCP/tool/setting 옵션을 확인했다. 사용자 승인 뒤 exact target·MCP 없이 격리 옵션의 모델 호출만 실행했다. Codex는 exit 0과 정확한 `OK`를 반환했다. Claude는 옵션 파싱과 provider 요청까지 진행했지만 HTTP 429 주간 한도(2026-08-29 09:00 KST reset 안내)로 실패했으므로 Claude 모델 실행 성공으로 기록하지 않는다.
- 최종 `mvn clean verify`: 176 tests, 실패 0, 오류 0, skip 0, BUILD SUCCESS.
- 배포물은 `target/flowscope-1.2.0-beta.7.jar` 하나, 3,824,841 bytes, 1,954 entries, SHA-256 `c8fd3f8ae1b85c9708020fb4f933c253b04fcd4090eb19837c9eab74220a21c1`다. Main-Class/Java 21/번들 지침 3종/ZIP 무결성과 연속 non-clean package digest 동일성을 확인했다.
- standalone Web UI에서 beta.7 tag와 모든 LLM controls를 DOM으로 확인했고, 423×799 viewport의 page horizontal overflow는 0이었다. modal은 세로 scroll을 유지했다.

### 남은 한계·다음 gate

- beta.7 검증 당시 실행 중인 Burp Web UI는 beta.3로 확인됐으므로 beta.7 JAR을 제거·재로드한 뒤 Codex와 Claude 각각 Explorer MCP 요청, exact run 종료, Judge lock/validation, Judge 후속 resume를 확인해야 했다. Codex 무대상 smoke를 이 gate에 소급하지 않았다. 최신 미검증 gate는 맨 위 beta.32 기록과 `beta-validation.md`를 따른다.
- Explorer 한 번은 운영자가 선택한 익명 또는 ACTIVE 계정 하나로 독립 탐색한다. USER A/B 교차 재현은 lock 뒤 Judge가 `flowscope_list_sessions`의 안전한 account ID를 골라 수행한다. 이것은 현재 의도된 경계이며 다중 계정 Explorer campaign은 구현돼 있지 않다.
- Claude no-persistence가 물리적 metadata 파일을 남기지 않는다고 보장하지 않는다. FlowScope가 보장하는 것은 Explorer session ID를 저장·resume하지 않는 논리 격리다.
- Codex는 CLI의 read-only sandbox와 no-approval, Claude는 exact tool allowlist를 사용하지만 변조된 로컬 client 설치까지 통제하지 못한다. 서버 exact scope·visibility·Evidence gate가 최종 권위다.
- 이 검증은 실행 파이프라인과 제품 상태를 검증한 것이며 endpoint 발견률·취약점 precision/recall·crAPI 성능을 검증하지 않았다. 블라인드 벤치마크는 사용자 검토 뒤 별도 수행한다.

## 이후 작업 기록 형식

새 코드·동작 변경은 완료와 동시에 아래 형식으로 이 파일에 추가한다.

```text
## 2026-08-27 · 1.2.0-beta.8 · HUMAN Evidence 보존·노이즈·그래프 1~5단계

### 목표와 성공 조건

- 8KiB preview 뒤의 query/body/route/object Evidence를 조용히 잃지 않는다.
- 로그인·화면·polling 노이즈를 메인 coverage에서 분리하되 원 Evidence와 사용자 확인 경로는 보존한다.
- path뿐 아니라 관측된 구조화 ID를 모두 추적하고, 근거 없는 객체 조합은 만들지 않는다.
- source 필터·보조 그래프·Request/Response 상세이 실제 Web UI에서 일관되게 동작한다.
- 샘플 H/S/L을 실제 HUMAN/ZAP/Codex 실행 결과로 오인하지 않게 한다.

### 개발·수정

- `StoredPayload`를 추가해 저장 전 마스킹된 textual 전문을 메시지당 기본 1MiB, digest 중복 제거 후 압축 총량 48MiB까지 GZIP·SHA-256으로 보존했다. binary와 메시지별/총량 초과 전문은 size+digest+reason metadata-only로 남겼다.
- `RequestRecord`에 request/response payload와 복수 `ResourceReference`를 추가하고 정규화·data flow·route discovery·인가 Evidence·MCP·Repeater draft가 보존 전문을 우선 사용하게 했다.
- project schema를 v2로 올려 digest별 압축 blob을 한 번 저장하고 load 때 digest·byte 수를 검증했다. schema v1은 계속 읽는다.
- classifier v4에서 HUMAN 로그인 준비를 `AUTH_SESSION/EXCLUDE`, 반복 안정 unknown을 `POLLING/REVIEW`로 분리했다. live 20,000건 초과는 dropped count로 공개한다.
- query와 중첩 JSON·배열·XML·multipart·GraphQL의 모든 명시 ID를 추출했다. 기존 인가 cell은 첫 근거 참조 하나만 primary로 사용한다.
- Web에 보조 흐름 toggle, retention/bytes/digest/reason 상세, record 누락·metadata-only 메시지 경고를 추가하고 source가 꺼지면 그 source만 가진 node도 숨기게 했다.
- 온보딩 샘플에 인증·polling Evidence를 추가해 보조 흐름을 실제로 확인할 수 있게 했다. snapshot의 엄격한 demo provenance로 sample mode를 식별하고 상단에 “실제 점검 결과 아님·대상 네트워크 요청 0건”을 표시했다.
- Maven/MCP/Web/README를 `1.2.0-beta.8`로 맞췄다.

### 이유

- 단일 8KiB 문자열은 긴 본문 뒤쪽 ID와 route 근거를 소급 복구할 수 없었고, 무제한 평문 보존은 Burp 메모리와 비밀 경계를 훼손한다.
- 보조 트래픽을 삭제하면 미탐 감사 경로가 사라지고, 메인 graph에 넣으면 coverage와 gap이 부풀기 때문에 저장·메인 분석·선택 표시를 분리했다.
- 모든 객체 참조의 단순 Cartesian product는 operation 적용 가능성을 증명하지 못하므로 primary 인가 모델은 보수적으로 유지했다.
- standalone 샘플의 H/S/L 표기가 실제 세 레인 수행으로 오해된다는 사용자 재현을 받아, 설명 문구가 아니라 지속 배너로 구분했다.

### 영향 파일

- 코어·수집: `StoredPayload`, `ResourceReference`, `RequestRecord`, `FlowScopeExtension`, `BurpXmlParser`, `Normalizer`, `TrafficClassifier`, `Pipeline`, Evidence/분석 consumer와 `SampleProject`
- 저장·통합·Web: `ProjectStore`, `McpServer`, `FlowScopeWebServer`, `SnapshotJsonWriter`, `web/index.html`
- 회귀: `StoredPayloadTest`, `ProjectStoreTest`, `TrafficClassifierTest`, `PipelineClassificationTest`, `AdvancedNormalizerTest`, `FlowScopeWebServerTest`, `SampleProjectTest`
- 문서: 루트·영문 README/CHANGELOG, `architecture.md`, `decisions.md`, `product-development-plan.md`, `ui-product-rationale.md`, `beta-validation.md`, 이 로그

### 검증

- `mvn clean verify`: JDK 26, Java `--release 21`, 183 tests, 실패·오류·skip 0.
- JS 추출본 `node --check`: 성공.
- standalone beta.8: 보조 흐름 4건을 켜도 7조합·미교차 1·일부 7·불일치 2 유지, 첫 Evidence의 88/106 bytes·SHA-256·마스킹 전문 확인, 샘플 경고 배너 표시, console warning/error 0.
- 배포물: `target/flowscope-1.2.0-beta.8.jar` 하나, 3,840,945 bytes, 1,957 entries, SHA-256 `63adff71dabdfadd686ff0c408043be14fb5a63f86c784fdb3d2a65e9394ff7e`. ZIP 무결성·Main-Class·Java 21·Montoya class 0을 확인했다.
- QA 중 첫 standalone이 stale `target/classes`의 beta.7 tag를 보여 실패로 처리했고, compile 후 reload한 beta.8만 검증 기록에 사용했다.

### 남은 한계·다음 gate

- 실제 Burp Browser HUMAN pass, 장시간 메모리, 20,000건 초과, 대용량 project save/load는 아직 수동 검증하지 않았다.
- binary·메시지당 기본 1MiB 초과·압축 전문 총량 48MiB 초과 메시지는 내용 없이 metadata-only다. 이 경우 분석은 8KiB preview 범위로 제한된다.
- 복수 object 참조를 모두 보존하지만 operation별 적용 가능성 모델이 없어 인가 cell은 primary 하나만 사용한다.
- MPA/SPA/GraphQL blind corpus의 분류 confusion matrix와 실제 미탐·오탐은 다음 gate다. 오탐·미탐 0이나 성능 우위를 주장하지 않는다.
- 이번 H/S/L은 합성 샘플 UI QA다. 실제 ZAP과 Codex Explorer를 실행한 것으로 기록하지 않는다.

## 2026-08-27 · 1.2.0-beta.9 · 기존 UI 복원과 Evidence 단계형 경로 묶음

### 목표와 성공 조건
- beta.8의 사용자 검증된 `identity → resource → operation` UI를 유지한다.
- raw URL을 보존하면서 근거가 있는 경우에만 concrete path를 같은 operation으로 자동 정렬한다.
- 근거 없는 숫자 경로의 오병합을 줄이되 객체 후보와 기존 인가 분석을 잃지 않는다.
- 코드·Web/MCP 계약·한영 문서·버전·JAR을 같은 상태로 만들고 커밋한다.

### 개발·수정
- 폐기한 operation-grid/관측 인접 Flow 실험 코드를 제거하고 기존 그래프 렌더러와 조작을 복원했다.
- `Normalizer.normalizeAll`에 service·구조·세그먼트 위치별 catalog를 추가했다. 성공 JSON 응답의 정확한 `id/*Id`, UUID/긴 hex 형식, 복수 값, source/run/method가 다른 독립 관측을 구분한다.
- path template 상태를 `LITERAL/INFERRED/CORROBORATED`로 만들고 확률이나 고정 confidence 없이 machine-readable 이유를 보존한다.
- 객체 추출과 operation template을 분리했다. 단일 `/orders/101`이 template 근거 부족으로 literal이어도 `orders:101` 객체 후보와 PATH_ID Evidence는 유지한다.
- Web operation 상세와 MCP record에 상태·이유를 추가했다. raw path와 마스킹 Request/Response는 기존대로 유지한다.
- 관측 route inventory는 record의 canonical operation을 재사용해 graph가 literal인데 observed candidate만 `{id}`가 되는 불일치를 차단했다.
- Maven/MCP/Web/README를 `1.2.0-beta.9`로 맞췄다.

### 이유
- 모든 숫자를 즉시 `{id}`로 바꾸면 `/status/200` 같은 literal route가 합쳐지고, 숫자를 전부 literal로 두면 실제 객체 operation 비교가 분열된다.
- 블랙박스 관측만으로 서버 route declaration을 확정할 수 없으므로 UUID 형식조차 `INFERRED`이며, 응답 ID 일치는 `CONFIRMED`가 아니라 `CORROBORATED`로 표현했다.
- 사용자 승인 큐를 기본 플로우에 넣으면 제품 개입이 커지므로 자동 정렬하되 원문·상태·이유를 상세에서 감사하는 구조로 정했다.
- OpenAPI의 path templating/concrete path 우선 규칙, Burp Site Map 비교의 false-match 경고, concrete/template 후보를 함께 남기는 mitmproxy2swagger의 접근을 검토했다. 이것들은 설계 근거이지 FlowScope의 성능 우위 증거가 아니다(D-074).

### 영향 파일
- 코어: `Normalizer`, `RequestRecord`, `RouteCandidateExtractor`, 신규 `PathTemplateStatus`
- 통합·Web: `SnapshotJsonWriter`, `McpServer`, `web/index.html`
- 회귀: 신규 `RouteTemplateEvidenceTest`, `RouteCandidateExtractorTest`, `AdvancedNormalizerTest`, `FlowScopeWebServerTest`
- 문서·배포: 루트/영문 README·CHANGELOG, `architecture.md`, `decisions.md`, `product-development-plan.md`, `ui-product-rationale.md`, `beta-validation.md`, 이 로그, `pom.xml`

### 검증
- 신규 테스트를 먼저 추가해 미구현 compile 실패를 확인한 뒤 구현했다.
- `mvn clean verify`: JDK 26, Java `--release 21`, 192 tests, 실패·오류·skip 0.
- standalone beta.9 합성 샘플: 이전 그래프/파싱 작업면 유지, `/api/orders/{id}` 상세에서 raw `/api/orders/101`, `CORROBORATED · RESPONSE_ID_MATCH`, 마스킹 전문 동시 확인.
- 1280×720과 600×800에서 수평 overflow 0, console warning/error 0. 1280에서 우측 상세 패널 전체 폭이 viewport 안에 위치.
- 배포물: `target/flowscope-1.2.0-beta.9.jar` 하나, 3,850,581 bytes, 1,962 entries, SHA-256 `b13313a3bcea198b9bdd19932aa65839a06f7a99728d8b6e98b2d2e0dc7471e6`. ZIP 무결성·Main-Class·Java 21을 확인했다.

### 남은 한계·다음 gate
- 복수 값/독립 관측은 route declaration의 증명이 아니므로 `INFERRED`이며 false merge 가능성이 0이라고 주장하지 않는다.
- 현재 응답 보강은 2xx JSON의 `id` 또는 부모명 기반 `*Id` 정확 일치다. 서버 명세/OpenAPI route template을 강한 oracle로 결합하는 것은 후속 gate다.
- beta.9 JAR의 Burp Community 재로드와 실제 HUMAN blind-target corpus confusion matrix는 아직 확인하지 않았다.
- 이번 H/S/L은 합성 샘플 UI QA다. 실제 ZAP/Codex Explorer를 실행한 것으로 기록하지 않는다.

## 2026-08-27 · 1.2.0-beta.10 · SQLite 내구 저장과 계정 중심 세션 화면

### 목표와 성공 조건
- 기본 프로젝트를 로컬 SQLite로 저장하되 기존 마스킹·schema 검증·JSON 호환을 깨지 않는다.
- `test1` 한 번의 로그인에서 Cookie·Authorization·subject가 관측돼도 기본 화면에는 계정 하나로 보인다.
- 연결 여부·재로그인 필요 여부와 다음 행동을 내부 enum 없이 사용자가 이해할 수 있게 표시한다.
- 전체 회귀, 반응형 Web QA, fat JAR SQLite smoke, 문서·버전·라이선스·JAR을 같은 상태로 만든다.

### 개발·수정
- `ProjectStore`의 JSON schema v2 codec을 파일 I/O와 분리해 SQLite와 JSON이 같은 유효성·마스킹 계약을 사용하게 했다.
- `SqliteProjectStore` storage schema v1을 추가해 metadata/migration, records, payload BLOB, accounts, service-scoped bindings, policy, reviews, assessments, validations, completed lanes, route candidates를 관계형 table로 저장한다.
- Burp 프로젝트 저장 기본 확장자를 `.flowscope.db`로 바꾸고 JSON은 별도 내보내기와 기존 가져오기 호환으로 유지했다. DB를 한 번 저장하거나 열면 변경 revision을 30초 checkpoint로 합쳐 transaction/임시 DB/atomic replace로 저장하고 unload 직전 마지막 저장을 시도한다.
- Web snapshot session에 `accountId`와 `artifactKind`를 추가했다. 계정 화면은 account card를 기본 단위로 사용하고 연결된 Cookie/token/subject는 접힌 기술 정보, 미연결 기록은 닫힌 고급 진단에 둔다.
- `ACTIVE/UNVERIFIED/SUSPECT/REAUTH_REQUIRED`를 일반 화면에서 `사용 가능/로그인 확인 필요/세션 이상 감지/다시 로그인 필요`와 행동 문구로 변환했다.
- HUMAN pass 계정 활성 여부가 raw fingerprint 배열이 아니라 실제 `managedSessions` broker 상태를 읽도록 수정했다.
- Xerial SQLite JDBC 3.53.1.0을 번들하고 Apache 2.0/Zentus BSD 고지를 추가했으며 DB 파일을 Git ignore에 포함했다.

### 이유
- raw 인증 지문은 principal이 아니라 한 계정을 뒷받침하는 내부 artifact다. 이를 평면 나열하면 계정 수와 로그인 상태를 사용자가 잘못 이해한다.
- 장래 self-host를 고려해 관계형 경계를 먼저 만들되, 검증되지 않은 live event-store 전환까지 한 번에 수행하지 않았다. 현재 분석 pipeline·상한을 유지한 채 내구 snapshot만 추가하는 것이 변경 범위와 실패 모드를 통제한다.
- 전체 100MiB snapshot을 매초 재작성하는 안은 Burp와 사용자 디스크 부하가 커질 수 있어 30초 checkpoint와 unload 저장으로 제한했다. 이 간격의 실제 최적값은 대용량 benchmark 전까지 성능 우위로 주장하지 않는다.
- 계정 artifact를 삭제하거나 자동 병합하면 회전/충돌 감사 근거를 잃거나 다른 사용자를 합칠 수 있어, 수집은 유지하고 UI projection만 계정 중심으로 바꿨다.

### 영향 파일
- 저장·Burp UI: `ProjectStore`, 신규 `SqliteProjectStore`, `FlowScopeExtension`, `FlowScopeControlTab`, `.gitignore`, `pom.xml`
- Web: `SnapshotJsonWriter`, `FlowScopeWebServer`, `web/index.html`
- 회귀: 신규 `SqliteProjectStoreTest`, `FlowScopeWebServerTest`
- 공개 경계: `META-INF/NOTICE.txt`, 신규 `LICENSE-sqlite-jdbc-zentus.txt`, 루트/영문 README·CHANGELOG, 한국어 설계·결정·계획·화면 근거·검증·제품 개요, 이 로그

### 검증
- `mvn clean verify`: JDK 26, Java `--release 21`, 195 tests, 실패·오류·skip 0.
- SQLite 회귀: DB header, 관계형 row, payload BLOB/digest round-trip, account/binding/policy/lane/route/assessment/validation 복원, raw Cookie 문자열 부재, 미지원 storage schema 거부.
- 계정 projection 회귀: Cookie·Authorization·subject 지문 3개가 `test1` account 하나에 연결되고 artifact kind 세 종류를 보존.
- standalone beta.10 계정 화면: 1280×720·600×800 모두 수평 overflow 0, console warning/error 0, 계정별 행동 상태와 기본으로 닫힌 고급 진단 확인.
- fat JAR 단독 JDBC smoke: macOS arm64/JDK 26에서 service discovery로 SQLite 3.53.1 in-memory 연결·query 성공.
- 배포물: `target/flowscope-1.2.0-beta.10.jar` 하나, 15,826,751 bytes, 2,157 entries, SHA-256 `60709dfc90ec2fd4af539f2fd0453fe2b22b4da0e2382f8abc4a5a9793f62988`. ZIP·Main-Class·Java 21·JDBC service/native/license 포함을 확인했다.

### 남은 한계·다음 gate
- SQLite는 현재 full snapshot checkpoint이며 append-only event store나 다중 사용자 server DB가 아니다. 20,000 live record, 48MiB 압축 전문, 100MiB project 상한은 유지한다.
- xerial native load가 자동 JDK 26에서 경고를 냈지만 fat JAR query는 성공했다. 실제 Burp Community bundled JVM에서 beta.10 로드, DB 저장→자동 checkpoint→unload→재열기 검증은 아직 하지 않았다.
- 프로젝트에는 raw broker 자격증명이 없으므로 재열기 뒤 로그인 연결은 의도적으로 다시 해야 한다.
- 실제 `test1` 로그인 화면에서 기존 beta.9 데이터가 account card 하나로 표시되는 것은 beta.10 JAR 재로드 뒤 사용자가 확인해야 한다. 자동 회귀와 합성 UI를 실환경 완료로 기록하지 않는다.

## 2026-08-27 · 1.2.0-beta.11 · source 필터와 그래프 edge 의미 정합성

### 목표와 성공 조건
- HUMAN/SCANNER/LLM 필터가 실제 메인 Evidence 수와 일치하고, 선택한 source의 전체 접근 경로만 보인다.
- 응답→요청 데이터 의존선이 접근 그래프를 흐리게 하지 않고 `흐름 순서`에서만 보인다.
- 역할 정책 입력 위치가 명확하며 분석 계산·기존 계정 projection·저장 계약은 바뀌지 않는다.
- 전체 회귀, standalone 화면, 공개 JAR 하나, 문서·버전 일치를 확인한다.

### 개발·수정
- source별 `coverageEligible` Evidence 수를 필터에 표시하고 0건 source를 비활성화했다.
- 필터 변경 시 Cytoscape graph를 다시 만들어 source 전용 node와 `identity → resource → operation` 두 edge 구간을 함께 필터링했다.
- source view가 두 접근 구간 모두에 HUMAN 파랑·실선·H, SCANNER 빨강·파선·S, LLM 검정·점선·L을 적용하도록 통일했다.
- `SERVER_FLOW_LINKS`의 응답→요청 데이터 의존 edge를 메인 graph에서 제거했다. 데이터와 설명은 `흐름 순서`에 유지했다.
- 그래프 레일의 역할 클릭 순환과 임시 override를 제거했다. 계정 역할과 API 요구 권한 수·BFLA 비교 활성 여부를 읽기 전용으로 표시한다.
- 이전 node 위치가 새 edge 구조를 왜곡하지 않도록 graph-state 저장 키를 v3으로 올리고 Web 계약 테스트를 추가했다.

### 이유
- 0건 필터와 부분적으로만 source 문법이 적용된 선은 사용자가 “체크가 작동하지 않는다”, “끊긴 선이 무엇인지 모르겠다”고 판단하게 만든다.
- 접근 관계와 응답 값 전달 관계는 의미가 다르므로 한 canvas에서 같은 계층처럼 겹치면 경로 판독성이 낮아진다.
- 역할은 신원 속성이고 요구 권한은 API 정책이다. 그래프 레일 한 번 클릭으로 계정 역할만 바꾸는 방식은 BFLA 입력의 절반을 숨긴다.

### 영향 파일
- Web·회귀: `src/main/resources/web/index.html`, `src/test/java/io/flowscope/FlowScopeWebServerTest.java`
- 버전·공개 문서: `pom.xml`, 루트/영문 README·CHANGELOG, 한국어 설계·결정·계획·화면 근거·검증, 이 로그

### 검증
- 집중 회귀 `mvn -Dtest=FlowScopeWebServerTest test`: 13 tests, 실패·오류 0.
- 전체 회귀 `mvn clean verify`: JDK 26, Java `--release 21`, 195 tests, 실패·오류·skip 0.
- standalone 합성 H4/S2/L3에서 SCANNER·LLM을 해제하자 source checked 상태가 HUMAN만 남고 관측 API가 4→3으로 재구축됐다. HUMAN 접근 경로 두 구간은 파랑·실선·H였고 메인 graph에 응답→요청 데이터 의존선이 남지 않았다.
- 600×800에서 page horizontal overflow 0, console warning/error 0, 권한 정책 내부 조작 button 0을 확인했다.
- 배포물: `target/flowscope-1.2.0-beta.11.jar` 하나, 15,826,900 bytes, 2,157 entries, SHA-256 `f81bd55ab92da93e05601e116556abe58507b4d3222d0be18ec517c532be2788`. ZIP·Main-Class·Java 21·SQLite JDBC service/native/license 포함을 확인했다.

### 남은 한계·다음 gate
- 이 변경은 관측 데이터의 시각적 출처와 조작 정합성을 고친 것이며 endpoint 발견률·인가 판정 정확도를 높였다고 주장하지 않는다.
- 실제 Burp에서 실행 중인 beta.10은 beta.11 JAR을 재로드해야 변경이 보인다.

## 2026-08-27 · 1.2.0-beta.12 · 세션 귀속 충돌 차단과 그래프 비파괴 집계

### 목표와 성공 조건
- 같은 service의 인증 지문 하나가 두 등록 계정으로 조용히 이동하지 않아야 한다.
- 충돌 캡처는 이후 응답이나 캡처 종료로 `ACTIVE`가 되지 않고 신원 귀속·세션 주입에서 제외돼야 한다.
- 같은 요청자·객체·source의 중복 접근선을 한 선으로 보여 주되 원 operation·CoverageCell·Evidence·판정은 잃지 않아야 한다.
- 긴 API·객체 경로를 노드에서 생략하지 않고, 집계선을 클릭해 원 접근 조합으로 이동할 수 있어야 한다.
- 전체 회귀, standalone 상호작용, 공개 JAR 하나, 문서·버전 일치를 확인한다.

### 개발·수정
- `AnalysisConfig.bindSession`을 `putIfAbsent` 유일성 계약으로 바꾸고 기존/요청 account ID를 가진 전용 충돌 예외를 추가했다.
- Burp 캡처 연결에서 충돌을 별도로 처리해 현재 broker 세션을 `SUSPECT`로 고정했다. 충돌 상태는 캡처 종료·요청·응답 뒤에도 유지하고 자격증명 신원 매칭에서 제외한다.
- broker Web view와 snapshot JSON에 `credentialConflict`를 추가하고 계정 카드에 `동일 인증정보 충돌`과 폐기·재로그인 안내를 표시했다.
- graph의 동일 `(identity, resource, source)` 접근선을 표시 단계에서 집계했다. 총 관측 수, 원 cell 키, gap 키, 보수적으로 병합한 표시 verdict를 edge에 보존하며 Java 분석 모델은 바꾸지 않았다.
- 집계선 상세에 원 operation별 source 관측 수·판정·갭을 나열하고 각 원 CoverageCell 상세로 이동하게 했다.
- operation/resource 라벨의 중간 생략을 제거하고 전체 문자열 줄바꿈·동적 높이·최소 논리 폭을 적용했다. identity/source 기반 taxi turn과 graph-state v4로 이전 수동 배치 오염을 피했다.

### 이유
- binding 덮어쓰기는 계정 카드 중복보다 심각한 데이터 무결성 결함이다. 과거 USER A Evidence가 USER B로 재해석될 수 있어 UI에서 숨기는 대신 엔진에서 fail-closed해야 한다.
- 동일 접근선을 그대로 겹치면 몇 개의 관계인지 알 수 없지만, coverage cell 자체를 합치면 operation별 인가 판정과 Evidence가 손실된다. 따라서 화면 edge만 집계하고 원키를 역참조하는 방식으로 제한했다.
- 긴 경로를 tooltip에만 남기는 방식은 한눈에 경로를 비교한다는 그래프 목적을 충족하지 못한다. 전체 Dagre/ELK 교체는 이번 결함 수정에 비해 범위와 회귀 위험이 커 기각하고 현재 고정 열 배치 안에서 라벨과 lane만 수정했다.

### 영향 파일
- 세션 귀속·Burp 연결: `AnalysisConfig`, `SessionBroker`, `FlowScopeExtension`, `SnapshotJsonWriter`
- Web: `src/main/resources/web/index.html`
- 회귀: `AccountSessionTest`, `SessionBrokerTest`, `FlowScopeWebServerTest`
- 버전·공개 문서: `pom.xml`, 루트/영문 README·CHANGELOG, 한국어 설계·결정·계획·화면 근거·검증, 이 로그

### 검증
- 집중 회귀 `mvn -Dtest=AccountSessionTest,SessionBrokerTest,FlowScopeWebServerTest test` 통과.
- 최종 `mvn clean verify`: JDK 26, Java `--release 21`, 198 tests, 실패·오류·skip 0.
- standalone beta.12 합성 샘플에서 `H×2` 집계선을 클릭해 USER A→orders:101 원 operation 2개(GET/PATCH), 총 2건, operation별 판정·갭과 원 cell 이동 항목을 확인했다. 화면 수평 overflow는 0이었다.
- 배포물: `target/flowscope-1.2.0-beta.12.jar` 하나, 15,829,896 bytes, 2,158 entries, SHA-256 `b684549f0468964a6d2193fa64979448eab3950b768e7c39a61864bd3b49980c`. ZIP 무결성·Main-Class·Java 21·확장 진입점·SQLite JDBC service·NOTICE 포함을 확인했다.

### 남은 한계·다음 gate
- 접근선 집계는 표시 중복을 줄일 뿐 endpoint 발견률·인가 판정 정확도를 바꾸지 않으며 전체 edge crossing 최소화를 보장하지 않는다.
- 실제 Burp Community에서 beta.12 JAR 재로드, 같은 로그인 정보를 다른 계정으로 캡처하는 충돌 UI, 실제 HUMAN 장경로·대규모 graph는 아직 확인하지 않았다.
- `output/`, `tmp/`는 기존 사용자 비추적 파일이라 수정하거나 커밋하지 않았다.

## 2026-08-28 · 마스터 계획 1단계 · 완성 목표 재정의

### 목표와 성공 조건
- 목표·비목표·측정 가능한 완료 기준이 README, 설계, 제품 계획, 결정 로그에서 같은 의미여야 한다.
- 전 공격면 발견, 오탐·미탐 0, LLM 서술만으로 최종 확정 같은 검증 불가능한 주장을 완료 조건에서 제외해야 한다.

### 개발·수정
- 허가된 exact scope의 관측 가능한 접근통제 공격면 구조화와 Evidence 기반 검증을 제품 정본 목표로 고정했다.
- 완료 판단을 공개 fixture, 정답 격리 블라인드 benchmark, `REVIEW` 작업량, false positive·false negative·unresolved 공개, Evidence 역추적으로 고정했다.
- 한국어 README, 영어 사용자 가이드, 설계, 제품 계획에 같은 계약을 반영하고 D-078에 결정과 기각 대안을 기록했다.

### 이유
- 기능 개수나 화면 존재 여부는 탐지 성능과 재현성을 증명하지 않는다.
- 블랙박스 전체 분모를 알 수 없는데 모든 endpoint 발견이나 오탐·미탐 0을 완료 조건으로 두는 안은 측정할 수 없어 기각했다.
- 한계만 선언하고 측정 기준을 두지 않는 안도 제품 개선 방향을 검증할 수 없어 기각했다.

### 영향 파일
- `README.md`, `docs/en/README.md`
- `docs/ko/architecture.md`, `docs/ko/product-development-plan.md`, `docs/ko/decisions.md`, 이 로그

### 검증
- 목표 문장, 비목표 네 항목, benchmark·FP/FN/unresolved·Evidence 역추적 계약의 문서 간 일치성을 검사했다.
- `mvn clean verify`: 198 tests, 실패·오류·skip 0.
- 제품 코드, POM, 버전, JAR은 변경하지 않았다.

### 남은 한계·다음 gate
- 이 단계는 목표 계약만 고정했으며 endpoint 발견률이나 판정 정확도를 개선한 것이 아니다.
- 마스터 계획 2단계인 우선순위 원칙은 사용자가 `다음`이라고 지시하기 전까지 시작하지 않는다.

## 2026-08-28 · 1.2.0-beta.13 · HUMAN 실행 정합성과 범용 구조 프로파일러

### 목표와 성공 조건
- HUMAN pass의 진행·완료가 실제 exact run 상태와 일치하고 Web에서 자동 갱신돼야 한다.
- pass 안에서 사용한 Repeater·Intruder가 브라우저로 오기록되지 않아야 한다.
- 특정 대상 이름이나 path를 하드코딩하지 않고 `*Id` 밖의 반복 관측 식별자를 보강하되 제어·보안 필드와 단일 관측을 객체로 만들지 않아야 한다.
- 기존 coverage·인가·분류·저장 계약, 문서, 버전, 공개 JAR 하나를 유지해야 한다.

### 개발·수정
- `/api/human-run`에 exact exploration 완료 상태를 추가하고 Web의 1초 실행 상태 동기화에 HUMAN을 포함했다. 빠른 시작은 수집 건수 대신 서버 완료 표식으로만 `pass 완료`를 표시한다.
- run context 병합에서 HUMAN Repeater·Intruder·Target의 실제 source detail과 `BURP` tool을 유지하면서 orchestrator·phase·run ID·account는 현재 pass 문맥을 상속하게 했다.
- `SemanticFieldCatalog`를 추가했다. query·JSON/form body의 `*No/*Number/*Seq/*Key/*Ref/*Uuid/*Guid/*Vin`을 동일 service·method·raw path·field 위치별로 학습하고 서로 다른 값이 둘 이상일 때만 객체 참조로 보강한다.
- 기존의 단순 소문자 `endsWith("id")`를 제거하고 `id`, camel-case `*Id/*Ids`, snake/kebab `*_id/*_ids` 경계만 강한 ID로 인정해 `guid/valid/fluid` 오탐을 막았다. `guid`는 복수 값 semantic 근거가 있을 때만 경로 collection 객체로 보강한다.
- semantic object는 `QUERY_SEMANTIC_FIELD_CORROBORATED` 또는 `BODY_SEMANTIC_FIELD_CORROBORATED` 근거를 보존한다. 제어·상태·trace/request·API/auth/token/session/secret류, 마스킹·과대 값, 단일 관측, 다른 path의 같은 필드는 승격하지 않는다.
- beta.13으로 버전과 한국어/영어 공개 문서, 설계·결정·계획·화면 근거·검증 기록을 동기화했다.

### 이유
- record가 있다는 사실은 HUMAN pass가 정상 종료됐다는 증거가 아니다. 이 둘을 섞으면 과거 Evidence나 진행 중 수집이 완료 gate처럼 보인다.
- run context는 실행 구간을 붙이기 위한 것이지 실제 HTTP 생성 도구를 지우기 위한 것이 아니다. Repeater provenance 손실은 재현·감사 설명을 틀리게 만든다.
- 어떤 URL이든 자동 구조화하려면 target별 사전보다 관측에서 반복되는 구조를 학습해야 한다. 다만 필드명 하나만으로 객체화하면 page/sort/API key까지 resource가 되므로 같은 위치의 복수 값이라는 최소 보강 근거를 요구했다.
- LLM 즉시 판정, target별 필드 목록, 일반 `*Code`, 서로 다른 endpoint의 같은 이름 합치기는 각각 비결정성·benchmark 오염·상태 enum 오탐·전파 오탐 때문에 채택하지 않았다.

### 영향 파일
- Human 수집·상태: `FlowScopeExtension`, `FlowScopeWebServer`, `web/index.html`
- 범용 객체 정규화: `Normalizer`
- 회귀: `FlowScopeExtensionPhaseTest`, `FlowScopeWebServerTest`, `AdvancedNormalizerTest`
- 버전·문서: `pom.xml`, 루트/영문 README·CHANGELOG, 한국어 설계·결정·계획·화면 근거·검증, 이 로그

### 검증
- 신규 테스트를 먼저 추가해 누락된 provenance helper와 Human 완료/동기화 계약이 컴파일·정적 계약에서 실패하는 것을 확인한 뒤 구현했다.
- 집중 회귀 `mvn -Dtest=AdvancedNormalizerTest,NormalizerTest,FlowScopeExtensionPhaseTest,FlowScopeWebServerTest test`: 통과.
- 중간 전체 회귀 `mvn clean verify`: 203 tests, 실패·오류·skip 0. 이후 ID 문자열 경계 회귀를 추가했다.
- standalone 로컬 Web 빠른 시작에서 HUMAN begin 뒤 `진행 중`, exact end 뒤 `pass 완료`로 바뀌는 것을 각각 1.3초 대기 뒤 확인했다.
- 최종 `mvn clean verify`: 204 tests, 실패·오류·skip 0.
- 배포물: `target/flowscope-1.2.0-beta.13.jar` 하나, 15,836,587 bytes, 2,161 entries, SHA-256 `d306eb9dd7be5d9fe761074b1697d1ddf04718a5fcaf342a704a2ad1eeaa62d7`. ZIP 무결성·Main-Class·Java 21과 공개 JAR 단일성을 확인했다.

### 남은 한계·다음 gate
- semantic field 보강은 route schema·소유권·취약점 확정이 아니다. 단일 관측, 아직 전송되지 않은 동적 경로, 응답 의미만으로 알 수 있는 도메인 관계는 자동 확정하지 않는다.
- 실제 Burp Community beta.13에서 Browser, Repeater, Intruder를 같은 HUMAN pass 안에 실행해 Web Evidence의 detail/run/account를 확인해야 한다.
- 일반 MPA/SPA/GraphQL 및 블라인드 대상에서 semantic field precision/recall, 객체 미탐, `REVIEW` 작업량을 측정하기 전 성능 우위를 주장하지 않는다.
- `output/`, `tmp/`는 기존 사용자 비추적 파일이라 수정하거나 커밋하지 않는다.

## 2026-08-28 · 1.2.0-beta.14 · ZAP raw completion gate와 단계별 상태

### 목표와 성공 조건
- Burp raw record에는 응답이 있으나 400ms debounce 분석 snapshot에는 아직 없는 순간에도 정상 ZAP lane을 `0건 실패`로 오판하지 않는다.
- 신원별 Traditional Spider와 Client/AJAX rendered-browser 수집량 및 현재 단계가 Web/MCP에서 구분된다.
- 기존 exact scope, fresh ZAP session, broker 세션 교체, zero-capture failure, Active Scan 승인 경계를 바꾸지 않는다.

### 개발·수정
- `McpServer.State`에 `source + runId + sourceDetail` capture count 계약을 추가하고, Burp 구현은 synchronized raw `records`를 직접 센다. 일반 구현은 현재 snapshot 기반 default를 유지한다.
- ZAP 캠페인의 global/lane 완료 count와 단계 count를 raw 계약으로 교체했다. 신원별 lane은 `PENDING → TRADITIONAL_SPIDER → CLIENT_SPIDER/AJAX_SPIDER_FALLBACK → PASSIVE_SCAN_QUEUE → ALERTS_READY/FAILED`를 갱신한다.
- lane JSON에 `traditional_captures`, `rendered_captures`를 추가하고 기존 한 줄 문자열 대신 whs_flow 작업면 문법의 상태 card로 표시한다.
- beta.14 버전, 한국어/영어 README·CHANGELOG, 설계·결정·계획·화면 근거·검증 기록을 코드와 동기화했다.

### 이유
- 임의 sleep으로 분석 snapshot을 기다리면 시스템 부하에 따라 다시 실패한다. raw append는 응답 callback에서 이미 완료됐으므로 완료 gate의 가장 가까운 사실 원천이다.
- Pipeline debounce 제거는 매 응답마다 전체 분석을 실행해 Burp callback 부하를 키우므로 기각했다.
- Traditional과 browser-rendered discovery를 합산만 하면 어떤 crawler가 실제 경로를 발견했는지와 Client/AJAX 실패 영향을 설명할 수 없다.

### 영향 파일
- scanner gate·상태: `McpServer`, `FlowScopeExtension`
- Web projection: `src/main/resources/web/index.html`
- 회귀: `McpServerTest`, `FlowScopeExtensionPhaseTest`, `FlowScopeWebServerTest`
- 버전·문서: `pom.xml`, 루트/영문 README·CHANGELOG, 한국어 설계·결정·계획·화면 근거·검증, 이 로그

### 검증
- 구현 전 raw count API와 stage JSON을 요구하는 테스트가 컴파일 실패하는 것을 확인했다.
- 집중 회귀 `mvn -Dtest=FlowScopeExtensionPhaseTest,McpServerTest,FlowScopeWebServerTest test`: 통과.
- 최종 `mvn clean verify`: 206 tests, 실패·오류·skip 0.
- standalone 1280×720 빠른 시작에서 page/modal/scanner 수평 overflow가 모두 0이고 beta.14 tag, ZAP target·identity controls, 비실행 상태가 렌더되는 것을 확인했다.
- 로컬 loopback ZAP API에서 ZAP `2.17.0`, spider `0.18.0`, client `0.20.0`, pscan `0.6.0` 설치를 읽기 전용 확인했다. beta.14 JAR을 Burp에 다시 로드하지 않은 상태라 대상 scan은 실행하지 않았다.
- 배포물: `target/flowscope-1.2.0-beta.14.jar` 하나, 15,838,496 bytes, 2,161 entries, SHA-256 `aad50e262a5ed70976da3dae21f070fd57e3354e52cc1681c00f482f814bb0aa`. ZIP 무결성·Main-Class·Java 21을 확인했다.

### 남은 한계·다음 gate
- 실제 ZAP 2.17 + Burp Community beta.14에서 Client Spider/AJAX fallback이 8081을 지나며 stage count에 귀속되는지 확인해야 한다.
- USER A/B ACTIVE broker 세션의 교체 주입, 계정 간 late response, ZAP 전역 replacer/script 간섭은 실제 캠페인으로 검증해야 한다.
- 이번 변경은 완료 판정 정확도 수정이며 endpoint 발견률·Alert recall·취약점 성능 향상을 증명하지 않는다.
- `output/`, `tmp/`는 기존 사용자 비추적 파일이라 수정하거나 커밋하지 않는다.

## 2026-08-28 · 1.2.0-beta.15 · rendered crawler 거짓 정상 완료 차단

### 목표와 성공 조건
- Client Spider가 API status `100/COMPLETED`를 반환해도 실제 Client 단계 capture가 0이면 browser-rendered 기준선을 정상 완료로 표시하지 않는다.
- AJAX fallback을 자동 실행하고, AJAX도 0이면 기존 Traditional Evidence·Alert를 보존하면서 경고 완료를 명시한다.

### 개발·수정
- 실제 beta.14 crAPI 실행에서 ZAP 전체 8건·Traditional 8건·Rendered 0건·Alert 22건의 깨끗한 `COMPLETED` 오표시를 확인했다.
- ZAP task 로그에서 Client Spider가 Firefox binary 부재로 시작 실패했지만 status API는 100을 반환한 원인을 확인했다.
- Client 종료 후 같은 run의 raw `ZAP_CLIENT_SPIDER` count 증가가 0이면 AJAX Spider로 전환한다.
- AJAX도 raw count 증가가 0이면 lane·campaign status를 `COMPLETED_WITH_WARNINGS`로 내리고 원인을 Web/MCP에 표시한다. 전체 capture 0 failure는 그대로다.
- 경고 완료도 dataset lock 뒤 `flowscope_zap_alerts`가 baseline의 마스킹 Alert snapshot을 반환하도록 정상 완료와 같은 lock 계약을 적용했다.
- Web에 warning status·lane 시각 상태를 추가하고 beta.15 버전·문서를 동기화했다.

### 이유
- ZAP API status만으로 browser process와 실제 네트워크 관측 성공을 증명할 수 없다는 결함이 실환경에서 재현됐다.
- OS별 ZAP 로그·Firefox 경로를 제품이 추측하거나 강제하는 대신 FlowScope가 직접 관측한 stage capture를 실행 결과 gate로 사용한다.
- Traditional Evidence까지 폐기하면 사실로 수집된 결과를 잃으므로 저하 완료와 완전 실패를 분리한다.

### 영향 파일
- scanner workflow·status: `McpServer`
- Web warning projection: `src/main/resources/web/index.html`
- 회귀: `McpServerTest`, `FlowScopeWebServerTest`
- 버전·문서: `pom.xml`, README·CHANGELOG, 설계·결정·계획·화면 근거·검증 기록, 이 로그

### 검증
- 구현 전 Client status 100/Client capture 0 fixture가 AJAX 미호출·`COMPLETED`로 실패하는 것을 확인했다.
- 구현 후 `mvn -Dtest=McpServerTest,FlowScopeWebServerTest test`: 통과.
- 최종 `mvn clean verify`: 207 tests, 실패·오류·skip 0.
- 배포물: `target/flowscope-1.2.0-beta.15.jar` 하나, 15,839,086 bytes, 2,161 entries, SHA-256 `40c9d12fc1a550abc77bac9de57feb588fba5587eeb37aef5d6e6ed4d36467ff`. ZIP 무결성과 공개 JAR 단일성을 확인했다.
- 실제 beta.15 Burp/ZAP 재검증은 진행 전이다.

### 남은 한계·다음 gate
- beta.15 JAR 재로드 뒤 실제 crAPI에서 Client→AJAX 전환과 `COMPLETED_WITH_WARNINGS` 또는 실제 rendered capture를 확인해야 한다.

## 2026-08-28 · 1.2.0-beta.16 · HUMAN 요청 시점 문맥과 계정 표현 정합성

### 왜 수정했는가

- Proxy는 요청 시점 run/account를 보존했지만 Repeater·Intruder·Target 응답은 응답 시점 context를 읽어 HUMAN pass 경계의 늦은 응답을 오귀속할 수 있었다.
- 초기화·샘플 교체·프로젝트 열기 전에 전송된 요청의 응답이 이후 도착하면 교체된 데이터셋에 다시 추가될 수 있었다.
- 권한 카드가 하나의 등록 계정에 연결된 Cookie·Authorization·subject fingerprint 수를 `세션 N개`로 표시해, 내부 인증 단서를 서로 다른 로그인 세션처럼 보이게 했다.

### 무엇을 변경했는가

- `InFlightRequestTracker`를 추가해 Proxy와 비-Proxy Burp 도구의 `messageId`별 요청 시점 context·로그인 캡처 account·dataset epoch를 bounded metadata로 보존했다.
- Repeater·Intruder·Target 요청도 요청 콜백에서 context를 기록하고 응답 콜백에서 동일 ID로 소비한다. 문맥이 없거나 epoch가 바뀐 응답은 현재 pass로 추측하지 않고 제외한다.
- 초기화, 샘플 교체, 프로젝트 열기에서 records lock 안의 dataset epoch를 증가시키고 저장 직전에 다시 확인해 reset 뒤 늦은 응답 재등장을 차단했다.
- 정상 수집된 비-Proxy HUMAN 응답을 `SessionBroker`에 전달해 Repeater 등에서 발생한 Set-Cookie 회전을 동일 계정의 메모리 세션에 반영했다.
- 권한 정책 카드의 보조 문구를 `등록 계정/비로그인/미확정 신원/관측 신원`으로 바꾸고, 인증 단서 개수는 계정 화면의 기술 정보에만 유지했다.

### 변경 파일

- `src/main/java/io/flowscope/burp/InFlightRequestTracker.java`
- `src/main/java/io/flowscope/burp/FlowScopeExtension.java`
- `src/main/resources/web/index.html`
- `src/test/java/io/flowscope/burp/InFlightRequestTrackerTest.java`
- `src/test/java/io/flowscope/FlowScopeWebServerTest.java`
- 버전·사용법·결정·검증 문서와 배포 JAR

### 검증

- 실패 테스트를 먼저 추가해 구현 전 compile failure와 Web 계약 failure를 확인했다.
- Montoya API 2026.7 로컬 공식 인터페이스에서 request/response 양쪽의 `messageId()` 제공을 확인했다.
- 최종 `mvn clean verify`: 211 tests, 실패·오류·skip 0. 동시 callback 80개에서도 tracker가 metadata 상한 8개만 수락하는 회귀를 포함한다.
- 배포물: `target/flowscope-1.2.0-beta.16.jar` 하나, 15,842,551 bytes, 2,162 entries, SHA-256 `979bee7198a09d56e44dc5bd0c07125e6c9117762529097e1a2cf381e5adb35f`. ZIP 무결성, 확장 진입점, 새 tracker class와 공개 JAR 단일성을 확인했다.
- 새 JAR standalone 합성 샘플에서 beta.16 tag, 1280×720 수평 overflow 0, role의 `등록 계정` 표시, 계정별 접힌 인증 단서, source 필터 해제에 따른 관측 API 4→3 재구축을 확인했다. 대상 네트워크 요청은 만들지 않았다.
- 실제 열린 Web 탭은 beta.9였으므로 beta.16 UI/late-response를 검증한 것으로 기록하지 않는다. 새 JAR 재로드 뒤 실제 Burp Browser·Repeater·초기화·SQLite 재열기 gate가 남아 있다.
- USER A/B 복수 세션 주입·late response, ZAP browser provider 설정의 교차 플랫폼 동작은 아직 수동 gate다.
- `output/`, `tmp/`는 기존 사용자 비추적 파일이라 수정하거나 커밋하지 않는다.

## 2026-08-28 · 1.2.0-beta.17 · HUMAN 원문 요청 실험실

### 왜 수정했는가

- 기존 Web은 마스킹된 Request/Response와 Burp Repeater 미전송 초안만 제공해, 보안 진단자가 Web에서 세션·객체·본문을 편집하고 응답을 비교할 수 없었다.
- raw 인증값을 기존 `RequestRecord`/SQLite/JSON에 넣으면 비밀 비영속 계약을 깨고, 반복 검증 요청을 HUMAN 탐색으로 세면 coverage와 3-way gap이 왜곡된다.

### 무엇을 변경했는가

- `TransientExchangeVault`를 추가해 live 요청 1MiB·응답 4MiB·총 32MiB 기본 상한의 UTF-8 byte 원문만 Burp 프로세스 메모리에 보존했다. oldest eviction과 byte overwrite를 적용하고 초기화·샘플 교체·프로젝트 열기·unload에서 clear한다.
- `/api/request-lab`은 특정 Evidence의 원문 또는 정직한 마스킹 폴백을 반환하고, 명시적 send에서 `ORIGINAL/ANONYMOUS/ACCOUNT`를 구분한다. snapshot·프로젝트·MCP·로그에는 raw를 추가하지 않았다.
- HUMAN 전송은 원 Evidence `HttpService`, 현재 exact scope, redirect `NEVER`, upstream TLS 검증, 30초 timeout을 강제한다. `ANONYMOUS`는 broker 관리 인증 헤더를 제거하고 `ACCOUNT`는 제거 뒤 선택 ACTIVE 계정을 주입하며 기존 Content-Length를 body byte 길이로 갱신한다.
- 전송 결과는 `HUMAN/MANUAL_HTTP/VALIDATION/CONTROLLED` Evidence로 저장해 immutable discovery gate에서 coverage·gap 제외를 유지한다.
- whs_flow 기반 화면 문법을 유지한 전체 화면 요청 실험실에 request/response 2열 편집기, 인증 모드, account 선택, 응답 시간·byte 수, 탭 메모리 10건 이력과 native Repeater fallback을 추가했다.
- 계정 JSON의 내부 인증 단서 수 필드를 `authArtifactCount`로 바로잡아 계정 1개를 여러 세션처럼 표현하지 않는 beta.16 계약과 일치시켰다.

### 근거와 기각 대안

- 공식 PortSwigger Repeater/message editor/history, ZAP Requester, mitmproxy client replay에서 편집·재전송·응답/시간 비교가 수동 검증의 공통 흐름임을 확인했다. OWASP WSTG session fixation은 별도 계정·쿠키 대조를 요구한다.
- 브라우저가 대상에 직접 fetch하는 방식은 CORS·Burp proxy·TLS·Evidence correlation을 잃어 기각했다. raw를 프로젝트/localStorage에 두는 방식과 모든 수동 요청을 discovery로 계산하는 방식도 각각 비밀 수명과 coverage 왜곡 때문에 기각했다.

### 영향 파일

- runtime: `FlowScopeExtension`, `TransientExchangeVault`, `FlowScopeWebServer`
- Web: `src/main/resources/web/index.html`
- 회귀: `TransientExchangeVaultTest`, `FlowScopeWebServerTest`
- 계정 표현: `SnapshotJsonWriter`
- 버전·사용법·설계·결정·검증·화면 근거·계획·CHANGELOG와 `AGENTS.md` 비영속 경계

### 검증

- 구현 전 `/api/request-lab`, 세 인증 모드와 UI 계약을 추가해 Web 회귀 실패를 확인한 뒤 구현했다.
- `mvn clean verify`: 215 tests, 실패·오류·skip 0.
- JavaScript `node --check` 통과.
- standalone 합성 샘플에서 1280×720 request/response 2열·page overflow 0·console 오류 0, 600×800 단일 열·page/dialog overflow 0을 확인했다. DemoState는 네트워크 전송을 구현하지 않으므로 기능 성공으로 계산하지 않았다.
- 배포물: `target/flowscope-1.2.0-beta.17.jar` 하나, 15,856,555 bytes, 2,168 entries, SHA-256 `5da5a0801c3a4f4d8cef31b7cceed6a958ead0233b159a2b5d91400d5cc5aaf1`. ZIP 무결성, `Main-Class`, Java 21, 새 vault class와 Web asset 포함을 확인했다.

### 남은 한계·다음 gate

- 새 JAR을 Burp Community에 재로드하고 허가된 로컬 대상에서 ORIGINAL, ANONYMOUS, USER A, USER B 요청의 실제 수신 헤더·응답·세션 회전·VALIDATION provenance·coverage 불변을 확인해야 한다.
- Java `String`, Montoya 내부 복사, browser textarea, crash dump/swap의 완전 소거는 보장하지 않는다. raw vault는 영구 secret store가 아니다.
- `output/`, `tmp/`는 기존 사용자 비추적 파일이라 수정하거나 커밋하지 않는다.

## 2026-08-28 · 1.2.0-beta.18 · HTTP byte 정본과 Evidence UI 안정화

### 왜 수정했는가

- beta.17은 Montoya 메시지를 `toString()`으로 바꾼 값을 raw vault에 UTF-8로 저장해, 원래 body charset과 무관한 재인코딩으로 한글·비ASCII가 깨질 수 있었다. 깨진 문자열을 다시 Repeater나 target으로 보내면 원 Evidence 재현이 아니다.
- 긴 endpoint와 접근선 횟수 라벨이 겹쳤고, 900px 이하 화면은 최소 폭 캔버스 때문에 오른쪽 API가 보이지 않았다.
- 파싱 표에서 operation은 같지만 Evidence가 여러 개인 경우 사용자가 고른 행 대신 첫 Evidence를 볼 여지가 있었고, 관측된 그래프 신원과 재사용 가능한 ACTIVE 계정 세션의 관계가 화면상 불명확했다.

### 무엇을 변경했는가

- `TransientExchangeVault`를 요청·응답 raw `byte[]`와 body offset 저장소로 바꾸고 방어 복사·상한·폐기 계약을 유지했다.
- `HttpMessageTextCodec`을 추가해 헤더 ISO-8859-1, textual body의 Content-Type charset/기본 UTF-8을 strict decode/encode한다. binary·invalid byte는 replacement character로 숨기지 않고 Web 편집 전송을 차단한다.
- 수정하지 않은 요청과 Repeater handoff는 원래 byte를 사용한다. 사용자가 편집한 요청만 선언 charset으로 재인코딩하며 Content-Length는 실제 Montoya body byte 길이로 갱신한다.
- operation 라벨을 slash-aware 줄바꿈으로 바꾸고 단일 접근선의 `×1` 라벨을 숨겼다. 좁은 화면은 같은 filter 결과의 API 목록으로 전환한다. Cytoscape가 직접 조작하는 `#cy`의 inline style을 덮지 않고, 라이브러리 밖 `graphcanvas` 래퍼의 표시 상태만 반응형 CSS가 소유한다.
- 파싱 표에 Evidence ID별 `상세 보기` 버튼과 선택 상태를 추가해 정확한 요청·응답을 연다.
- `관측 신원`과 `재사용할 등록 계정`을 문구·Request Lab 메타데이터에서 분리했다.

### 영향 파일

- runtime: `FlowScopeExtension`, `TransientExchangeVault`, `HttpMessageTextCodec`, `FlowScopeWebServer`
- Web: `src/main/resources/web/index.html`
- 회귀: `HttpMessageTextCodecTest`, `TransientExchangeVaultTest`, `FlowScopeWebServerTest`
- 문서·배포: README, architecture, decisions D-084, UI rationale, beta validation, product plan, changelog, Maven version

### 검증

- UTF-8 한글·emoji, EUC-KR, invalid UTF-8, binary, edited JSON, raw byte defensive copy/round-trip 회귀를 추가했다.
- `mvn clean verify`: 221 tests, 실패·오류·skip 0.
- standalone 합성 샘플에서 1280px page overflow 0, 600px filtered API list·page overflow 0, 목록→상세 연결, 파싱 표 선택 Evidence ID와 열린 상세 ID 일치를 확인했다. 합성 샘플은 대상 네트워크 전송 성공을 증명하지 않는다.
- 배포물: `target/flowscope-1.2.0-beta.18.jar` 하나, 15,866,589 bytes, 2,170 entries, SHA-256 `c3915f7fbb2451f00e8b858639fc5a1fa2d00ab72d397ac61c61e33b8612ac1c`. ZIP 무결성, `Main-Class`, Java 21, 새 codec·byte vault·Web asset 포함을 확인했다.

### 남은 한계·다음 gate

- beta.17에 이미 깨져 저장된 텍스트는 원래 byte를 복원할 수 없으므로 beta.18 재로드 뒤 다시 수집해야 한다.
- 실제 Burp Community에서 비ASCII ORIGINAL byte 동일성, 편집 charset, ANONYMOUS/ACCOUNT credential 처리, binary Repeater fallback, clear/unload 폐기를 수동 검증해야 한다.
- `output/`, `tmp/`는 기존 사용자 비추적 파일이라 수정하거나 커밋하지 않는다.

## 2026-08-28 · 1.2.0-beta.19 · Cytoscape 반응형 DOM 소유권 분리

### 목표와 성공 조건

- `!important` 없이 데스크톱에서는 Cytoscape 그래프, 900px 이하에서는 동일 필터 API 목록만 표시한다.
- Cytoscape가 내부 inline style을 변경해도 제품 반응형 정책이 흔들리지 않는다.

### 개발·수정과 이유

- `#cy`를 `graphcanvas` 래퍼 안으로 옮겼다. Cytoscape는 내부 노드만, FlowScope CSS는 외부 래퍼만 소유한다.
- 라이브러리 inline style을 `!important`로 덮는 beta.18 후속 수정을 폐기했다. 동작 우선 임시 해결보다 소유 경계를 분리하는 것이 라이브러리 업그레이드와 재초기화에 안정적이다(D-085).
- Web 회귀에 DOM 래퍼와 media-query 계약을 추가하고 버전을 beta.19로 올렸다.

### 검증·남은 gate

- `mvn clean verify`: 221 tests, 실패·오류·skip 0.
- beta.19 standalone에서 1280px wrapper/Cytoscape 표시·목록 숨김, 600px wrapper 숨김·API 목록 4개·page overflow 0을 확인했다. Cytoscape 내부 inline style과 제품 반응형 CSS가 더 이상 같은 요소를 경쟁하지 않는다.
- 배포물: `target/flowscope-1.2.0-beta.19.jar` 하나, 15,866,605 bytes, 2,170 entries, SHA-256 `066f237a26c59359a36c5ec59c5186ca8cbc6012c0a36904129074fdf4a3c420`. ZIP 무결성, `Main-Class`, Java 21을 확인했다.
- 실제 Burp target 전송 gate는 beta.19 JAR 재로드 뒤 수행해야 한다.
- `output/`, `tmp/`는 수정하지 않는다.

## 2026-08-28 · 1.2.0-beta.20 · 공개 설치 재현성과 ZAP 원클릭 환경

### 목표와 성공 조건

- clone 또는 Release JAR 사용자에게 완전한 3-way 구성요소와 최소 설치 순서를 정확히 안내한다.
- macOS/Linux 사용자는 한 명령으로 ZAP 2.17.0을 SCANNER `8081` Burp listener 뒤에 띄우고, API key를 화면에 복사하지 않아도 FlowScope가 읽는다.
- 설치 상태는 추측이 아니라 doctor와 실제 컨테이너 API 재조회로 확인한다.

### 개발·수정

- 공식 ZAP 2.17.0 multi-arch 이미지 digest를 고정한 Compose와 컨테이너 시작 스크립트를 추가했다. API는 loopback host publish·random key로 제한하고 Network add-on API로 Docker host의 Burp `8081` upstream을 설정·재검증한다.
- `scripts/zap-up.sh`, `zap-down.sh`, `doctor.sh`를 추가했다. key는 `~/.flowscope/zap-api-key`에 owner-only로 생성하며 출력하지 않고, Compose에는 값 대신 파일을 read-only mount한다.
- 확장이 `flowscope.zap.key` → `FLOWSCOPE_ZAP_API_KEY` → `flowscope.zap.keyFile` → 기본 key file 순서로 ZAP key를 찾도록 했다. 파일은 symlink·비정규 파일·과도한 POSIX 권한·크기·문자 집합을 검증한다.
- 한국어·영어 시작 문서를 추가하고 루트 README를 Release JAR 사용자와 소스 빌드 사용자, HUMAN-only와 완전한 3-way로 분리했다. `output/`, `tmp/`는 사용자 로컬 데이터가 실수로 공개 저장소에 들어가지 않게 ignore했다.
- 완전한 3-way의 Docker helper는 저장소 clone이 필요하고 HUMAN-only는 Release JAR만으로 시작할 수 있음을 첫 단계에 명시했다.

### 이유

- README가 ZAP과 LLM을 선택 구성처럼 보이게 했고 Docker/ZAP upstream/key 배포 방법이 없어 새 사용자가 동일한 3-way 환경을 재현하기 어려웠다.
- key를 compose 파일이나 README에 고정하는 대안은 공개 저장소와 프로세스 출력에 비밀을 남기므로 기각했다. 모든 호스트 경로를 자동 추측하는 대안도 OS·Docker 구현별 오동작을 숨기므로 지원 프로필과 수동 대안을 명시했다(D-086).

### 영향 파일

- runtime/test: `FlowScopeExtension`, `LocalMcpToken`, `LocalSecretFile`, `LocalZapApiKey`, `LocalZapApiKeyTest`, Web version contract
- setup: `infra/zap/*`, `scripts/zap-up.sh`, `scripts/zap-down.sh`, `scripts/doctor.sh`, `.gitignore`
- 문서·배포: README, 한영 getting-started, architecture, decisions D-086, product plan, UI rationale, handoff, beta validation, changelog, Maven version

### 검증

- 첫 격리 실행에서 host 포트와 고정 container 포트가 달라 API가 Burp로 전달되는 결함을 발견해 동일 포트 매핑으로 수정했다.
- macOS 기본 Bash 3.2가 정규식 반복 수량자를 처리하지 못해 wrapper가 유효 key를 거부하는 결함을 발견하고 문자 집합과 길이 검사를 분리했다.
- macOS의 `/usr/bin/java`가 활성 JDK를 찾지 못해도 Homebrew Maven은 자체 JDK로 정상 빌드하는 경우 doctor가 거짓 실패하는 결함을 재현했다. source-build gate는 실제 빌드 주체인 `mvn -version`의 Java runtime을 검사하도록 수정했다.
- `docker compose config`, `shellcheck`, 실제 ZAP 2.17.0 health/API/version/Network upstream/add-on 재조회와 wrapper up→`doctor.sh --build`(0 failure, 0 warning)→down을 통과했다. `docker inspect`의 container environment에 실제 key 값이 없음을 확인했다.
- `mvn clean verify`: 222 tests, 실패·오류·skip 0.
- 배포물: `target/flowscope-1.2.0-beta.20.jar` 하나, 15,868,036 bytes, 2,172 entries, SHA-256 `24da2c47d49833bd06feb453599cc93ca448a028368a55be14a31b040c509aee`. ZIP 무결성, `Main-Class`, Java 21 manifest를 확인했다.

### 남은 한계·다음 gate

- doctor의 listener port open은 그 프로세스가 Burp임을 증명하지 않는다. 사용자가 Burp listener 화면과 Proxy history에서 SCANNER 유입을 확인해야 한다.
- 실제 target capture, HTTPS 인증서 경로, USER A/B session injection, Codex/Claude Explorer·Judge는 beta.20 setup 검증으로 대체하지 않는다.
- Windows는 Docker wrapper 대신 상세 문서의 PowerShell/수동 ZAP Desktop 절차를 사용해야 하며 자동 wrapper는 아직 제공하지 않는다.
- 다음 gate는 beta.20 JAR을 Burp Community에 재로드한 뒤 HUMAN raw byte와 SCANNER 실제 capture를 확인하는 것이다.

## 2026-08-28 · 1.2.0-beta.22 · 첫 실행 경로 압축

### 목표와 성공 조건

- 처음 쓰는 사용자가 한 화면의 모든 설명을 해석하지 않고 현재 단계와 다음 행동 하나를 확인한다.
- 기존 범위·HUMAN·ZAP·LLM/Judge 기능과 안전 경계를 삭제하거나 약화하지 않는다.
- 넓은 화면과 모바일 폭에서 단계 전환과 레이아웃을 실제 DOM으로 확인한다.

### 개발·수정

- Web 빠른 시작을 `범위 → HUMAN → ZAP → LLM/Judge` 네 단계 내비게이션과 단계별 단일 패널로 바꿨다.
- 현재 프로젝트 상태로 첫 미완료 단계를 계산하고 자동 선택한다. 사용자가 다른 단계를 점검할 수 있으며 `현재 단계로`로 자동 추천 위치에 돌아간다.
- README 설치 절차를 `처음 한 번만 준비`와 `점검할 때마다`로 분리하고, ZAP Desktop/Docker 중 하나만 선택한다는 내용을 앞에 배치했다.
- 버전, 한영 시작 문서, 변경 기록, 설계·결정·UI 근거·제품 계획·인계·검증 문서를 beta.22로 맞췄다.

### 이유

- beta.21은 필요한 제어를 제공했지만 여섯 설명 카드와 세 실행기 제어를 동시에 노출해, 기능 발견성보다 초기 판단 부담이 컸다.
- 기능을 없애는 단순화는 3-way 제품 목표를 훼손한다. 단계별 progressive disclosure는 같은 기능을 유지하면서 현재 행동만 전면에 놓는다(D-089).

### 영향 파일

- Web UI와 회귀: `src/main/resources/web/index.html`, `FlowScopeWebServerTest`
- 버전·사용자 문서: `pom.xml`, README, 한영 getting-started/README/changelog
- 설계 기록: architecture, decisions D-089, product plan, UI rationale, handoff, beta validation, development log

### 검증

- `mvn clean verify`: 223 tests, 실패·오류·skip 0.
- standalone Web asset에서 1280px 단계 전환과 390×844 반응형 표시를 확인했다. 선택 패널 하나만 표시되고 390px에서 대화상자·단계 탭 수평 overflow가 없었다.
- 배포물: `target/flowscope-1.2.0-beta.22.jar` 하나, 15,871,087 bytes, 2,172 entries, SHA-256 `721055eb49d196342145615dde93c24162391b07dcfdbb98df46dbd42c691c38`. ZIP 무결성, `Main-Class`, Java 21 manifest를 확인했다.

### 남은 한계·다음 gate

- standalone 화면 검증은 실제 Burp API 상태 전이를 대신하지 않는다.
- beta.22 JAR을 Burp Community에서 로드한 뒤 scope→HUMAN→ZAP→Explorer→Judge 완료 상태가 첫 미완료 단계 계산에 순서대로 반영되는지 수동 확인해야 한다.
- 실제 Windows Docker Desktop, ZAP Desktop, HTTPS, USER A/B와 3-way target 실행 gate는 여전히 별도다.

## 2026-08-28 · 1.2.0-beta.21 · ZAP 배포 중립 온보딩과 Windows 설치 경로

### 목표와 성공 조건

- Windows 사용자가 수동 key·ACL·Compose 명령을 조립하지 않고 macOS/Linux와 같은 up→doctor→down 흐름을 사용한다.
- 기존 ZAP Desktop 사용자는 Docker를 설치하지 않고 같은 캠페인 엔진을 사용하며, 실행 전에 연결 문제를 확인한다.
- Windows drive path를 안전하게 전달하고 key 값이 container environment·출력·저장소에 남지 않는다.
- 실제로 검증하지 않은 Windows Docker runtime은 완료라고 쓰지 않는다.

### 개발·수정

- Windows 10/11 + Docker Desktop Linux container + PowerShell 7용 `zap-up.ps1`, `zap-down.ps1`, `doctor.ps1`을 추가했다.
- Desktop과 Docker가 함께 쓰는 owner-only `zap-key.sh`/`zap-key.ps1`을 분리하고 key 값을 출력하지 않는다.
- Web 빠른 시작에 배포 중립 ZAP 연결 상태·version·key 오류·재확인을 추가하고 연결 전 캠페인을 비활성화했다. 연결 실패 때 Desktop 설정과 Docker Quick Start를 동등하게 표시한다.
- .NET cryptographic RNG로 32-byte key를 만들고 ACL 상속을 제거한 뒤 현재 Windows SID에만 FullControl을 부여한다. doctor는 reparse point, key format, ACL, 포트, ZAP API/version/upstream/add-on, provider, Web/MCP와 선택적 Maven/JDK를 점검한다.
- OS별 bind path short syntax 대신 Compose file-backed secret을 사용해 key 파일을 `/run/secrets/flowscope-zap-api-key`에 read-only mount한다.
- GitHub `windows-latest`가 네 PowerShell 파일을 실제 parser로 검사하는 CI job과 한영 설치·문제 해결 문서를 추가하고 버전을 beta.21로 올렸다.

### 이유

- beta.20의 Windows 수동 절차는 key ACL을 사용자 판단에 맡겼고 명령 복사 단계가 길어 macOS/Linux와 제품 경험이 달랐다.
- Docker를 기본처럼 먼저 제시하면 ZAP Desktop 사용자가 불필요한 daemon을 설치하고, API 연결 실패도 캠페인 실행 뒤에야 알게 된다. 캠페인은 배포 방식이 아니라 동일 ZAP API 계약만 필요하므로 D-088처럼 분리했다.
- PowerShell 5.1 동시 지원, Windows container image, WSL이 host Burp 경계를 자동 해결한다는 주장은 런타임·인코딩·네트워크 차이를 숨기므로 beta.21 계약에서 제외했다(D-087).

### 영향 파일

- setup/CI: `scripts/zap-key.*`, `scripts/*.ps1`, `infra/zap/compose.yaml`, `.github/workflows/ci.yml`
- 코드/회귀: `ZapClient`, `FlowScopeExtension`, `FlowScopeWebServer`, Web 빠른 시작, `FlowScopeWebServerTest`
- 문서: README, 한영 getting-started/README/changelog, architecture, decisions D-087·D-088, product plan, UI rationale, handoff, beta validation

### 검증

- Docker Compose config에서 file-backed secret source와 target을 확인했다.
- 저장소 secret scan의 유일한 탐지는 MCP 마스킹 회귀의 고엔트로피 고정 fixture였으며, 실제 secret이 아닌 의미가 드러나는 저엔트로피 test token 조합으로 바꿔 scan을 깨끗하게 유지했다.
- macOS 실제 ZAP 2.17.0에 새 secret topology를 적용해 key read, API/version, Docker→Burp `8081` upstream, 필수 add-on과 `doctor.sh --build` 0 failure·0 warning을 재검증했다. container environment에 key 값이 없었다.
- 공통 `zap-key.sh`로 생성한 별도 owner-only key와 host `18093`을 사용해 refactor된 `zap-up.sh` → ZAP API `2.17.0` → `zap-down.sh` 실제 lifecycle을 다시 통과했다. 기본 `8089`와 사용자 대상 트래픽은 사용하지 않았다.
- `mvn clean verify`: 223 tests, 실패·오류·skip 0.
- [GitHub Actions run 33166311107](https://github.com/choewonwoo1817/testflowscope/actions/runs/33166311107): Ubuntu `verify`와 `windows-latest` PowerShell 7 parser job 모두 통과.
- 배포물: `target/flowscope-1.2.0-beta.21.jar` 하나, 15,870,395 bytes, 2,172 entries, SHA-256 `3b9d892115d549e3b46e7eae63d59924b3c661a65e274912c64bb922655a7d2d`. ZIP 무결성, `Main-Class`, Java 21 manifest를 확인했다.

### 남은 한계·다음 gate

- 실제 ZAP Desktop에서 key/API/upstream/add-on과 Web 연결 표시를 확인해야 한다.
- Windows 10/11 실기기에서 Docker Desktop Linux container, ACL, ZAP API/upstream, Burp SCANNER capture와 stop을 실제 확인해야 한다.
- PowerShell 5.1, Windows container mode, WSL helper는 beta.21 지원 범위가 아니다.
- 실제 HUMAN/SCANNER/LLM/Judge와 HTTPS/USER A/B target gate는 별도다.

## YYYY-MM-DD · 버전 또는 작업명

### 목표와 성공 조건
- 검증 가능한 완료 조건

### 개발·수정
- 무엇을 바꿨는가

### 이유
- 어떤 결함·요구·위험 때문에 바꿨는가
- 검토했으나 기각한 대안과 이유(아키텍처 결정이면 decisions.md에도 기록)

### 영향 파일
- 실제로 변경한 코드·테스트·문서

### 검증
- 먼저 실패한 회귀 또는 재현 방법
- 실행한 명령과 결과
- 수동 확인 환경과 결과

### 남은 한계·다음 gate
- 아직 검증하지 않은 것과 진행 조건
```

## 2026-08-31 · React shadcn 대시보드 기반

### 목표와 성공 조건

- 기존 Web UI의 기능 동등성 범위를 먼저 고정하고, `/app/` 전환에 사용할 React·TypeScript·Vite 기반의 실제 shadcn/Radix 셸을 만든다.
- 상대 asset URL로 Burp classpath 정적 배포에서도 해시 asset을 찾을 수 있고, 셸의 두 주 탐색 링크와 사이드바 전환 버튼이 컴포넌트 테스트로 검증돼야 한다.

### 개발·수정

- `docs/ko/web-ui-feature-parity.md`에 50개 기존 기능, action/API, 계획된 React·자동·Burp gate 칸을 동결했다.
- `frontend/`에 정확 고정 npm 계약, Vite 상대 `base`, Java 생성 resource 출력, Vitest jsdom 설정, capability placeholder를 추가했다.
- shadcn 4.19.1의 기존 `base-nova` 인자는 Base UI 출력을 요구해 Radix 계약과 맞지 않았다. CLI가 생성한 `radix-nova` 설정과 `radix-ui`, `tw-animate-css`, Geist 의존성 및 실제 컴포넌트 source를 사용했다.
- 최소 `SidebarProvider`/`Sidebar`/`SidebarTrigger`/`Button`/`Card` 셸과 React Query provider를 추가했다.

### 이유

- 복사된 shadcn source는 버전·스타일을 소스 tree에서 검토하고 향후 화면에 일관되게 적용할 수 있어 CDN 또는 수제 대체 컴포넌트보다 선택했다.
- Vite `base: "./"`는 `/app/` 또는 JAR classpath의 중첩 URL에서도 해시 asset을 root-relative 경로에 의존하지 않게 한다.
- Base UI `base-nova` 출력을 유지하는 대안은 Radix primitive 계약을 위반하므로 기각했다.

### 영향 파일

- `frontend/package.json`, `frontend/package-lock.json`, Vite/TypeScript 설정, shadcn 설정·source, React 셸·테스트
- `.gitignore`, `docs/ko/web-ui-feature-parity.md`, `docs/ko/ui-product-rationale.md`

### 검증

- RED: 빈 scaffold에서 `AppShell.test.tsx`는 `대시보드` accessible link가 없어서 실패했다.
- GREEN: `npm run typecheck`, `npm test -- src/app/AppShell.test.tsx`, `npm run build`가 모두 성공했고 `target/generated-resources/react-web/index.html` 및 해시 JS/CSS asset을 생성했다.

### 남은 한계·다음 gate

- 현재 셸은 navigation contract만 제공한다. parity 표의 모든 기능, Java API contract, browser E2E와 Task 14의 explicit Burp runtime parity gate는 아직 `PLANNED`다.

## 2026-09-01 · React bundle classpath 전송과 legacy 병행

### 목표와 성공 조건

- Vite가 만든 해시 React asset을 fat JAR classpath에 포함하고 `/app/`에서 안전하게 제공한다.
- 기본 `/`는 기존 UI를 유지하고 `/legacy/` fallback, `/app` trailing-slash redirect, `/api/*` 보안 gate 분리를 자동 계약으로 고정한다.

### 개발·수정

- Maven `generate-resources`에 고정 Node 24.11.1/npm 11.6.2 install, `npm ci`, typecheck/Vitest, Vite build를 연결하고 생성물을 `web/app` resource로 복사했다.
- `ClasspathWebAssets`가 raw path 한 번 decode, allowlist extension/MIME, encoded separator·NUL·dot segment 거부를 담당한다.
- `/`와 `/legacy/`는 legacy HTML, `/app`은 `308 Location: /app/`, `/app/`와 해시 asset은 React bundle을 제공한다. 정적 경로는 GET/HEAD만 허용하고 성공·누락·invalid path를 포함한 HEAD는 GET의 status/header/content length와 raw socket 빈 body를 보장한다.
- capability token은 HTML response에만 넣고 Vite JS/CSS/font과 `/api/*`에는 넣지 않았다. `/api/*`는 기존 origin/capability/authorization 흐름을 유지한다.
- Windows Node 24에서 Vite의 native output cleanup/중복 Tailwind optimizer가 `0xC0000409`로 종료되는 재현을 분리했다. target 한정 Node cleanup script와 Vite의 자체 CSS minify를 유지한 Tailwind optimizer 비활성화로 재현 가능한 build를 만들었다.
- Vite build 전 cleaner는 resolve된 정확한 `target/generated-resources/react-web`과 `target/classes/web/app`만 지운다. 따라서 Maven resources의 additive copy가 non-clean second package의 obsolete hash asset을 classpath/fat JAR에 남기지 않는다.
- 반복 가능한 release/CI 확인 명령은 `frontend`에서 실행하는 `npm run verify:incremental-package`다. Maven과 JDK `jar`가 PATH에 있어야 하며, 필요하면 각각 `FLOWSCOPE_MAVEN`, `FLOWSCOPE_JAR`로 절대 경로를 준다. 이 verifier는 script 위치에서 repository와 정확한 `target` 하위만 해석하고, `index.css`의 semantic token을 바꾼 두 번의 non-clean `-DskipTests package` 뒤 두 번째 fat JAR와 `target/classes/web/app`에 old hash가 없고 단 하나의 같은 new hash가 있는지 확인한다. 이어 source bytes를 복원하고 세 번째 recovery package를 실행해 final JAR/classes가 restored hash만 포함하고 mutated hash를 제외하는지 확인한다. verification과 recovery가 함께 실패하면 두 error를 `AggregateError`로 함께 surface한다. Maven lifecycle에 bind하지 않아 재귀 호출하지 않는다.
- 같은 command의 `test:incremental-package` Node suite는 recovery JAR 또는 classpath에 mutated CSS가 남는 경우, restored identity가 틀린 경우, 그리고 JAR/classes CSS 불일치를 각각 negative fixture로 거부한다.

### 검증

- RED: `mvn -Dtest=FlowScopeWebServerTest#redirectsAppMountToTrailingSlash test`는 변경 전 `/app`에서 `expected: <308> but was: <404>`로 실패했다.
- GREEN: `mvn -Dtest=ClasspathWebAssetsTest,FlowScopeWebServerTest test`는 frontend typecheck/Vitest/Vite build와 Java contract tests를 모두 통과했다. raw socket HEAD와 두 번의 non-clean Maven package/JAR hash 교체 회귀도 통과했다.
- fat JAR packaging과 `web/app/index.html` 및 해시 asset 포함 검증은 같은 Task 2 gate로 기록한다. Task 13 소유의 Jackson multi-release `verify-release-jar` 한계는 이 전송 계약 변경으로 감추거나 수정하지 않는다.

### 남은 한계·다음 gate

- React 셸의 개별 기능 parity와 Burp 실런타임 parity는 Task 14 gate 전까지 완료로 표시하지 않는다.

## 2026-09-01 · React typed API client와 중앙 polling

### 목표와 성공 조건

- Java `FlowScopeWebServer`의 비-deprecated `/api/*` surface를 정확한 wire type과 endpoint wrapper로 노출한다.
- capability는 매 요청 직전에 HTML meta에서만 읽고 API header에만 붙이며, polling/query key/오류/저장소에 남기지 않는다.
- Snapshot, HUMAN, ZAP, Scanner, LLM 상태를 공유되는 1초 TanStack Query polling으로 읽고, 마지막 성공 결과와 revision identity를 보존한다.

### 개발·수정

- `client.ts`는 JSON/error parsing, status contract, capability header, form/XML body media type을 중앙화했다. 기본 성공 status는 `200`이고 Scanner 및 LLM의 start/follow-up만 명시적으로 `202`를 허용한다.
- `endpoints.ts`는 snapshot, evidence, ai-preview/scenarios, replay, request-lab, clear, HUMAN, sample, policy/account/session, ZAP/scanner/LLM, XML import, owner까지 현재 dispatch되는 모든 비-deprecated route의 typed wrapper를 제공한다. legacy verdict route는 wrapper로 만들지 않았다.
- Java writer의 nullable `resource`, payload retention metadata, `completed_lanes`, source/per-source map, Scanner/LLM의 snake_case run field를 포함한 named TypeScript wire type을 추가했다.
- 하나의 application `QueryClient`와 secret-free query key를 두고, 500ms stale time, focus refetch off, read retry 1회, mutation retry 0회, 1초 shared polling 및 snapshot revision structural sharing을 설정했다.

### 검증

- RED: `npm test -- src/lib/api/client.test.ts src/lib/query/hooks.test.tsx`는 구현 전 `./client`, `./endpoints`, `./hooks` import를 resolve하지 못해 예상대로 실패했다.
- GREEN: capability header 재-read, URLSearchParams form body, exact XML media type, explicit 202, JSON/non-JSON error status/message, shared polling, final-unmount abort, revision sharing, failed-poll LLM last-success tests를 추가했다. `npm run typecheck`, focused Vitest (8 tests), `npm run verify` (3 files/9 tests), `npm run build`는 모두 성공했다.
- Task 2 package smoke는 제공된 Maven 3.9.11/JDK 21으로 `mvn -DskipTests package`를 한 번 실행했으나, frontend-maven-plugin의 선행 `npm ci`가 기존 `node_modules/lightningcss-win32-x64-msvc/lightningcss.win32-x64-msvc.node` unlink에서 Windows `EPERM (-4048)`로 실패했다. Java source나 packaging rule은 변경하지 않았고, frontend build 자체는 위 Vite gate에서 성공했다.

### 남은 한계·다음 gate

- 이 작업은 transport/query ownership만 다룬다. React page-level feature parity와 Task 14의 Burp runtime gate는 아직 `PLANNED`다.

## 2026-09-01 · React dashboard shell과 빈 상태

### 목표와 성공 조건

- 닫힌 9개 hash route로 실제 shadcn sidebar shell을 제공하고, 현재 `/api/*` shared query 결과만 대시보드에 표시한다.
- 빈 workspace의 온보딩, sample/clear mutation, 정확한 Evidence 수량, source 문자 상태, 오류 복구를 component contract로 고정한다.

### 개발·수정

- `dashboard`, `inspection`, `graph`, `matrix`, `sequence`, `scenarios`, `evidence`, `accounts`, `runs`만 허용하는 route union을 추가했다. 빈 값, 미지 route, encoded/path-like hash는 `#dashboard`로 정규화하며 path나 HTML로 해석하지 않는다. 후속 8개 화면은 기능 동등성을 주장하지 않는 탐색 자리표시자다.
- retained shadcn Sidebar/Sheet, Breadcrumb, Tooltip, Badge, Button, Card, Skeleton, Alert, AlertDialog로 sidebar, 상단 scope·HUMAN/ZAP/LLM 상태, Evidence disposition, 대시보드를 구성했다. shadcn mobile Sidebar가 900px 미만에서 Sheet 경로를 쓰도록 breakpoint를 맞췄다.
- count는 서버 `trafficStats`의 captured, coverage, review, excluded, dropped, payloadMetadataOnly를 각각 수집/분석 대상/검토 대기/제외/삭제됨/Payload 메타데이터만으로 그대로 표시하며 percentage를 만들지 않는다. gap은 `gaps`, finding 요약은 서버가 제공한 `scenarios`만 사용한다.
- empty 상태는 분석 card를 숨기고 빠른 시작과 sample 동작만 보이며, clear는 AlertDialog 확인 뒤에만 중앙 clear mutation을 실행한다. snapshot 최초 로딩은 Skeleton, 마지막 성공 data가 없는 오류는 한국어 Alert와 retry를 사용한다.

### 검증

- RED: `npm test -- src/features/dashboard/DashboardPage.test.tsx`는 기존 Task 1 shell에서 4/4가 실패했다(점검 대시보드, counts, empty/sample/clear, loading/retry 미구현).
- GREEN: `npm test -- src/features/dashboard/DashboardPage.test.tsx src/app/AppShell.test.tsx`는 2 files/5 tests를 통과했다. 9개 route/current-page/hashchange-popstate/unsafe hash, count/source/gap/finding/sample warning/no percentage, empty/sample/confirm-clear, loading/error retry와 focusable Korean navigation을 검증한다.

### 남은 한계·다음 gate

- component scope의 shell, onboarding, sample, clear, banner, count, loading/error rows만 근거를 추가했다. Inspection/Graph/Matrix/Sequence/Scenarios/Evidence/Accounts/Runs의 실제 workflow, browser E2E, Java contract, Burp runtime은 계속 `PLANNED`다.

## 2026-09-01 · Task 4 dashboard review 보정

### 개발·수정

- 상단 bar는 모든 shared query의 최초 응답 전 `상단 상태를 불러오는 중`을, prior data 없는 terminal error에는 `상단 상태를 불러올 수 없습니다.`를 표시한다. scope/Evidence/disposition 숫자는 실제 query data가 있을 때만 표시하고, background poll 오류는 기존 값을 보존한 채 `최근 동기화 오류`로 구분한다.
- `SidebarInset`만 main landmark로 유지하고 route content의 중첩 main을 named section으로 바꿨다.
- retained mobile hook은 900px media query의 `matches` 값을 사용한다. 실제 shadcn Sheet navigation은 Korean trigger와 links를 사용하며 route 선택 뒤 닫힌다.
- scope, HUMAN/ZAP/LLM state는 bounded truncate/wrap styling과 full escaped `title`/Tooltip을 함께 사용한다.

### 검증

- RED: review regression tests는 상단 loading/unavailable state 부재, stale status 부재, nested main을 각각 재현했다.
- GREEN: focused component tests는 background snapshot retry exhaustion 뒤에도 `수집 18건`/`Evidence 18`이 유지되고 empty/loading/zero로 바뀌지 않는 것과 900px 미만 Sheet route selection을 확인한다.

### 남은 한계·다음 gate

- 이 보정은 Task 4 component contracts만 넓힌다. later-page workflow, browser E2E, Java contract, Burp runtime parity는 계속 `PLANNED`다.

## 2026-09-01 · Task 4 dashboard re-review 보정

### 개발·수정

- terminal unavailable query가 하나라도 있으면 top bar는 loading과 동시에 표시하지 않고 unavailable을 우선한다.
- retained mobile hook은 guarded `matchMedia('(max-width: 899px)')`로 첫 client render를 초기화해 900px 미만 desktop-first flash를 피하고, 이후 media change와 unmount listener cleanup을 유지한다.
- Sheet test의 불필요한 `innerWidth` mutation을 제거해 global viewport descriptor를 건드리지 않는다.

### 검증

- RED: terminal unavailable과 pending sibling이 함께 있을 때 loading label이 남았고, matchMedia true 첫 render가 false였다.
- GREEN: focused shell/dashboard/hook tests는 unavailable 우선, first-render mobile, media transition, listener cleanup, and 900px Sheet navigation을 확인한다.

## 2026-09-01 · React 점검 시작·실행 상태 제어

### 목표와 성공 조건

- 기존 Java run API를 바꾸지 않고 `#inspection`에서 scope → HUMAN → ZAP → LLM·Judge의 현재 단계를 안내하고, `#runs`에서 각 lane의 서버 상태를 표시한다.
- HUMAN/ZAP/LLM form field와 성공 status, ACTIVE managed session 선택 경계, polling/mutation 오류의 last-success 보존을 component contract로 고정한다.

### 개발·수정

- `InspectionPage`는 자동 추천 단계를 scope, HUMAN 완료, ZAP 완료/경고 완료, LLM 완료 lane 순서로 결정한다. 사용자가 탭을 선택하면 polling이 해당 선택을 덮지 않고 `현재 단계로`에서만 자동 추천으로 돌아간다.
- HUMAN begin은 `action=begin&account=`만, end는 현재 nonblank `runId`와 `action=end`만 중앙 endpoint wrapper로 보낸다. ZAP baseline은 connected, exact returned scope target, anonymous 또는 ACTIVE managed account가 모두 충족될 때에만 `target`, string boolean `anonymous`, comma-separated `accounts`를 202 contract로 보낸다.
- 재사용 선택지는 `managedSessions` 중 exact `ACTIVE`, non-capturing, non-conflicted session만 사용한다. observed identity, fingerprint, raw credential, inactive session은 DOM과 form choice에 넣지 않았다.
- `RunsPage`는 HUMAN/ZAP/LLM text status, lane의 전체/Traditional/Rendered/Alert count, provider availability, bounded escaped output tail, Judge session follow-up을 actual shadcn Tabs/Card/Select/Checkbox/Progress/Alert/Accordion/Input/Button으로 표시한다. running/pending buttons prevent double submit; disabled reason is text as well as state.
- polling으로 scope가 바뀌어도 이미 선택한 target을 다른 target으로 자동 대체하지 않는다. target이 exact scanner scope 밖이면 ZAP baseline은 설명과 함께 비활성화된다. `COMPLETED_WITH_WARNINGS`는 경고를 보존한 100% progress이며, completed lane은 색만이 아닌 읽을 수 있는 label로 표시한다.
- ZAP 능동 스캔 control/action/form/endpoint는 React page에 추가하지 않았다. actual active execution and Burp approval remain the Task 14 runtime gate.

### 검증

- RED: `npm test -- src/features/inspection/InspectionPage.test.tsx src/features/runs/RunsPage.test.tsx`는 `InspectionPage`와 `RunsPage` import를 resolve하지 못해 예상대로 실패했다.
- GREEN: focused Vitest suite (2 files/20 tests) verifies automatic/manual stage selection across deterministic query refetch, exact HUMAN/ZAP/LLM forms and accepted starts, opened Select ACTIVE filtering, disconnected/out-of-scope/provider/lane/whitespace gates, readable completed lanes, warning-complete progress, escaped output, and 503 mutation/poll errors preserving the preceding successful run. It is transport simulation only; it never starts HUMAN, ZAP, or an LLM CLI.

### 남은 한계·다음 gate

- Component evidence does not demonstrate a connected ZAP, captured traffic, CLI availability, or a real LLM/Judge session. Java contract, browser E2E, and Task 14 explicit Burp runtime parity remain open.

## 2026-09-01 · React 계정·신원·세션 관리

### 개발·수정

- `#accounts`는 등록 Account(`id/label/role/target`), 관측 identity/service/비가역 fingerprint, observed binding, 재사용 managed session을 별도 카드와 진단 표로 표시한다. complete fingerprint는 text·title·tooltip·accessible name·storage에 넣지 않고, 표에는 비민감 진단 label만 제공한다. exact 값은 사용자가 bind/unbind를 명시적으로 실행할 때의 form closure 안에서만 쓴다.
- 계정 저장은 기존 id를 포함한 정확한 form을 보낸 뒤에만 form을 비우고, 수정 중 role/target과 실패 입력은 그대로 남긴다. bound observed session이 있는 계정은 client에서 삭제 버튼 대신 `연결된 세션을 먼저 해제하세요.`를 표시하며, 다른 삭제와 identity reset은 Korean AlertDialog 확인 뒤에만 전송한다.
- 관측 신원 role은 고급 accordion의 `/api/role`로 분리했고, identity merge는 관측 service와 같은 등록 account만 선택하며 같은 identity는 POST 전에 막는다. bind choice도 observed service와 account target의 exact match로 제한한다.
- managed session status는 `ACTIVE`, `CAPTURING`, `UNVERIFIED`, `REVOKED`, `credential-conflict`를 text로 남기고 begin/end/revoke를 해당 account id에만 보낸다. 모든 writes는 기존 중앙 mutation의 snapshot invalidation을 재사용하며, 실패는 각 action 옆 Alert에 보존한다.

### 검증

- RED: `npm test -- src/features/accounts/AccountsPage.test.tsx`는 구현 전 `./AccountsPage` import를 resolve하지 못해 예상대로 실패했다.
- GREEN: focused Vitest 11 tests는 exact eight form contracts, create `id=`, edit failure retention, destructive confirmation, bound-delete client gate, same-service merge/bind, begin/end/revoke state actions, every successful mutation의 snapshot refetch, and raw credential/cookie/authorization/password/capability plus complete-fingerprint exclusion from DOM/title/accessible attributes/storage/request bodies를 transport simulation으로 확인한다. 각 server failure는 해당 action/dialog에 남고 다른 form을 지우지 않는다. 이 test는 로그인·capture·target traffic을 시작하지 않는다.

### 남은 한계·다음 gate

- Component evidence only이다. Java contract/browser E2E와 Task 14 explicit Burp runtime parity는 계속 열려 있으며 이 작업은 live login/capture를 실행하지 않았다.

## 2026-09-01 · React Evidence 작업면과 XML 가져오기

### 개발·수정

- `#evidence`는 snapshot의 Evidence를 실제 shadcn Table/ScrollArea/Checkbox/Badge/Button/Alert/Skeleton으로 표시한다. 기본값은 H/S/L, INCLUDE/REVIEW, API·UNKNOWN·TELEMETRY_CANDIDATE·POLLING·BACKGROUND이며, EXCLUDE와 인증·navigation·asset·metadata·preflight은 기본 숨김이다. 이 상태는 표시만 바꾸며 숨김 수를 삭제와 구분해 알린다.
- 안정 cluster ID로 반복을 대표 행 하나로 접고, 확장하면 모든 record를 보인다. `상세 보기`는 operation의 첫 행이 아닌 눌린 `eventId`의 메타데이터를 선택한다. 상세 metadata는 classification/auth/template/first-last/repeat/coverage/source/run 문맥만 React text node로 bounded rendering하며 raw request/response는 표시하지 않는다.
- Evidence pagination은 중앙 `useEvidenceQuery`의 secret-free `[evidence, operation, offset, limit]` key와 AbortSignal을 사용한다. operation 전환 시 stale in-flight/cache를 취소·폐기하고 offset 0부터 다시 요청하며, next/back는 서버 응답의 offset/limit/total/hasMore만 따른다.
- XML Dialog는 source와 `.xml` 선택을 검증하고 file마다 `/api/import-xml?source=&name=` POST를 보낸다. filename은 URL encoding하고 본문은 `application/xml;charset=UTF-8`의 원문 그대로이며, 실패 뒤에도 다음 file을 처리한다. summary는 서버가 돌려준 imported/candidates/failed만 합산하고 filename별 server error를 보존한다. XML과 raw Evidence는 storage/log/title/ARIA에 쓰지 않는다.

### 검증

- RED: `npm test -- src/features/evidence/EvidencePage.test.tsx`는 `EvidencePage` import를 resolve하지 못해 예상대로 실패했다.
- GREEN: focused Vitest 6 tests는 filter default/source/class behavior, repeat collapse/expand, exact clicked ID, server-driven pagination/cache replacement, raw-secret DOM/localStorage/sessionStorage exclusion, XML encoded filename/media type/body/per-file continuation/server-only aggregate/error, and unsupported-file no-transport를 simulated transport/File API로 검증한다. Radix ScrollArea는 jsdom에서 test-only ResizeObserver stub을 사용했다.

### 남은 한계·다음 gate

- 이 작업은 Component evidence만 추가한다. Java import contract, browser E2E, actual XML import, raw Evidence Sheet/Request Lab, 그리고 Task 14 explicit Burp runtime parity는 열려 있다.

## 2026-09-01 · React Evidence Sheet·정책·Request Lab

### 개발·수정

- `#evidence`의 정확히 선택한 event는 shadcn Sheet에서 operation/cell/scenario 문맥, required role, traffic override, resource owner를 함께 보여 준다. 모든 policy write는 기존 중앙 URL-encoded endpoint/mutation과 snapshot invalidation을 사용하며 실패하면 Sheet와 입력을 닫지 않고 server message를 표시한다.
- Request Lab은 TanStack Query 밖의 instance-local memory owner에서 draft/request/response/current-tab history만 관리한다. raw 텍스트는 plain controlled Textarea로만 표시하고, close·selected event/revision change·unmount·`beforeunload`에서 빈 문자열로 덮어쓴 뒤 history reference를 제거한다. UTF-8 `TextEncoder` 1,048,576 byte client guard와 최대 최근 10개 결과는 Java server limit를 보완할 뿐 대체하지 않는다.
- service는 draft의 immutable 값이고, ACCOUNT는 동일 service의 `ACTIVE` managed session으로만 선택한다. credential material은 React에 전달하지 않는다. metadata(보존/charset/editability/observed identity/reusable session)를 원문보다 먼저 표시한다.
- Repeater action은 `/api/replay`의 unsent draft acknowledgement만 보여 준다. UI는 전송·결과 판정·실제 Burp 호출을 주장하거나 수행하지 않는다.

### 검증

- RED: `npm test -- src/features/evidence/RequestLabDialog.test.tsx src/lib/security/memoryOnlyRawState.test.ts`는 새 `RequestLabDialog`와 `memoryOnlyRawState` module을 resolve하지 못해 예상대로 실패했다.
- GREEN: focused Vitest 3 files/12 tests는 simulated transport로 exact policy/replay/request-lab forms and media type, ORIGINAL/ANONYMOUS/ACCOUNT, exact-service ACTIVE filtering, 1 MiB multibyte boundary, history cap, query/storage/IndexedDB/log exclusion, close/unload cleanup, exact selected Evidence와 pagination을 검증한다. 실제 Request Lab, Burp Repeater, HUMAN, ZAP, LLM, target traffic은 실행하지 않았다.

### 남은 한계·다음 gate

- Java contract, browser E2E, live Request Lab 및 Burp runtime parity는 계속 열려 있다.

## 2026-09-01 · React 공격면 그래프

### 개발·수정

- `#graph`는 기존 shared snapshot query만 읽어 `trafficDisposition === INCLUDE` Evidence를 identity → resource → operation(객체 없음은 identity → operation)으로 투영한다. REVIEW/EXCLUDE Evidence, server cell verdict, route candidate/provenance는 재계산하거나 바꾸지 않는다.
- HUMAN은 파랑 실선과 `HUMAN`, SCANNER는 빨강 파선과 `SCANNER`, LLM은 검정 점선과 `LLM`으로 동시에 표시한다. authz 보기에서는 서버 verdict의 색과 `ALLOW`/`DENY` 등 문자 label을 함께 제공하고 UNKNOWN은 알려진 값으로 합치지 않는다. 반복 edge label은 2회 이상일 때만 `×n`이다.
- bundled Cytoscape만 하나의 owned ref에서 만들고, element/style 갱신은 Cytoscape API로 수행한다. listener는 unmount/모바일 전환 때 해제한 뒤 instance를 destroy한다. 900px 이하는 같은 projection을 keyboard-accessible API 목록으로 바꾸며 canvas를 남기지 않는다.
- localStorage에는 version 5의 graph positions/viewport/locked만 한 namespaced key로 저장한다. malformed, wrong-version, non-finite, prototype-polluting, key/node-limit 초과 값은 적용하지 않으며 filter, selected Evidence, raw HTTP, capability/session/provider data는 저장하지 않는다.
- graph/list/edge/candidate selection은 operation/resource/identity/source와 exact Evidence IDs를 shared Evidence Sheet에 넘긴다. IDs는 bounded detail text로만 보이며 title, ARIA/live region, log, preference에는 넣지 않는다.

### 검증

- RED: `npm test -- src/features/graph/graphProjection.test.ts src/features/graph/graphPreferences.test.ts`는 구현 전 두 graph module import를 resolve하지 못해 예상대로 실패했다.
- GREEN: focused Vitest 5 files/11 tests는 INCLUDE projection, source/verdict text·style, exact 18 expand/collapse, support/route/UNKNOWN candidate, exact selection IDs, full slash-aware labels, v5 preference validation/reset and storage exclusion, Cytoscape listener cleanup/destroy/safe renderer failure, and canvas↔list breakpoint transition을 fixture와 mocked canvas boundary로 검증했다. target traffic, Burp, Request Lab, HUMAN, ZAP, LLM, live import는 실행하지 않았다.

### 남은 한계·다음 gate

- Component evidence만 추가했다. Java contract, browser E2E, real Cytoscape layout usability, and Task 14 explicit Burp runtime parity remain open.

## 2026-09-01 · React 권한 매트릭스와 데이터 의존 순서

### 개발·수정

- `#matrix`는 shared `useSnapshotQuery`의 `cells`, `roles`, `owners`, `requiredRoles`, `gaps`만 읽는다. 신원별은 concrete server cell만, 역할별은 server role 아래 각 구성원의 원 cell을 그대로 보여 주며 React가 verdict를 합성하거나 HTTP status로 인가 판단을 다시 하지 않는다.
- 열 머리말은 operation, 서버 required role(Unknown/unset 포함), null 객체 상태, 서버 owner를 함께 보이고 좌표 key는 null-aware JSON tuple이다. HUMAN/SCANNER/LLM는 H/S/L·실선/파선/점선·verdict text로 중복 표시하며 누락은 strike와 `미관측/놓침` text, conflict/gap은 server field의 명시 label로 남긴다. gap-only는 presentation filter여서 선택을 지우거나 snapshot을 바꾸지 않는다.
- `#sequence`는 producer/consumer event가 모두 존재하는 `flowLinks`만 observed link identity로 나눈다. finite positive producer timestamp는 시간순, unknown/equal은 server link 원순서로 안정적으로 남긴다. operation/source/masked value는 server text 그대로 escaped/bounded UI에 표시하며 data-dependency는 coverage·IDOR·authorization verdict를 바꾸지 않는 보조 정보라고 명시한다.
- matrix cell과 sequence link은 raw를 운반하지 않는 structured selection으로 shared Evidence Sheet를 연다. ID는 bounded visible detail에만 남기고 ARIA/title/live region에는 넣지 않으며, snapshot에서 선택한 cell 또는 link endpoint가 사라질 때만 selection을 해제한다.

### 검증

- RED: `npm test -- src/features/matrix/MatrixPage.test.tsx src/features/sequence/SequencePage.test.tsx`는 새 Matrix/Sequence page·projection module import를 resolve하지 못해 예상대로 실패했다.
- GREEN: focused Vitest 2 files/8 tests와 `npm run typecheck`는 server truth projection, role members/no synthetic verdict, requirements/owner/null-safe collision key, H/S/L source+reason+miss/conflict/gap semantics, gap-only selection retention, exact Evidence privacy, link timestamp/identity/server-only/masked-value behavior, auxiliary notice, and selection invalidation을 simulated snapshot으로 확인했다. target traffic, HUMAN, ZAP, LLM, Request Lab, Repeater, import는 실행하지 않았다.

### 남은 한계·다음 gate

- Java contract, browser E2E, responsive browser usability, and Task 14 explicit Burp runtime parity are open. 이 작업은 live target traffic이나 active operation을 실행하지 않았다.

### Task 10 fix round 1

- sequence timestamp는 known positive producer timestamp를 먼저 오름차순으로 정렬하고, 같은 known timestamp와 unknown timestamp는 server `flowLinks` 원순서로 안정적으로 둔다. 선택 key는 global index가 아니라 complete link JSON signature와 같은-signature occurrence만 사용하므로 무관한 앞 link 삽입으로 선택이 사라지지 않는다.
- H/S/L badge는 각 HUMAN/SCANNER/LLM text label과 함께 실제 solid/dashed/dotted border class를 가진다. matrix/sequence의 긴 markup-like operation·reason·masked value는 text node에서 bounded로 보이고 명시적으로 펼칠 수 있다. matrix Evidence ID는 3개/값 160자 initial body surface 뒤 `Evidence ID 더 보기/접기`로 전체를 열며 ARIA/title/live region에는 남기지 않는다.

### Task 10 fix round 2

- matrix/sequence의 shared Evidence Sheet는 조합한 raw context 문자열을 직접 렌더하지 않는다. identity·resource·operation을 구조화해 operation은 160자 ordinary-text surface와 `선택 상세 더 보기/접기` 뒤에만 전체를 표시한다. markup-like operation은 element로 해석되지 않고 ID·operation 모두 title/ARIA/live region에 두지 않는다.
- 동일 signature link는 occurrence별 고유 key를 갖고, unrelated link의 삽입·재정렬 뒤에도 그 occurrence 순서가 유지되는 한 선택 key를 유지한다. sequence의 HUMAN/SCANNER/LLM badge도 각각 visible source text와 solid/dashed/dotted border class를 유지한다.

### Task 10 fix round 3

- shared Evidence Sheet의 matrix identity/resource/operation과 sequence identity/operation/from/to endpoint는 하나의 bounded ordinary-text field group으로 표시한다. 어느 untrusted coordinate 값도 initial surface, title, ARIA name, live region에 전체로 남지 않고 `선택 상세 더 보기/접기` 뒤에만 escaped text로 펼쳐진다.
- exact-signature duplicate link의 두 occurrence 중 선택한 occurrence는 unrelated link 삽입·재정렬 후 그대로 남고, 그 occurrence만 제거하면 endpoint가 남아 있어도 selection을 해제한다. endpoint 삭제에 따른 해제는 별도 회귀로 유지한다.

### Task 10 fix round 4

- structured matrix/sequence 선택에서 exact `EventRecord`는 policy, Request Lab, Repeater 동작을 위해 그대로 유지하되, 같은 event ID를 generic Sheet header와 `OperationDetail` metadata가 다시 표시하지 않는다. 긴 Evidence/endpoint ID의 유일한 표시 경로는 기존 bounded structured field이며 명시적 펼치기 전 전체 값은 Sheet의 body, button accessible name, title, ARIA description/live text 어디에도 남지 않는다.
- RED는 matching long-ID event를 포함한 component fixture에서 header와 metadata의 중복 전체 ID 노출을 재현했다. 전체 ID를 무조건 숨기는 방식은 짧은 좌표의 가독성을 해치므로 채택하지 않았고, 160자를 넘는 값만 기존 `선택 상세`/`Evidence ID` control 뒤에서 펼치는 경계를 유지했다. 영향 파일은 `EvidenceSheet.tsx`, `OperationDetail.tsx`, Matrix/Sequence component tests와 Task 10 문서다. Java/live traffic은 변경하거나 실행하지 않았으며 browser/Burp runtime gate는 계속 열려 있다.
- GREEN verification은 focused 3 files/34 tests, typecheck, aggregate frontend 20 files/116 tests, production build에 성공했다. 전체 Vitest의 기존 jsdom canvas notice와 Vite의 500 kB chunk advisory는 남아 있으며 release browser/Burp gate 결과로 간주하지 않는다.

## 2026-09-01 · React 시나리오 검토 작업면

### 개발·수정

- `#scenarios`의 명시적 첫 동작은 `GET /api/ai-preview`, 다음 동작은 `POST /api/ai-scenarios`뿐이다. 둘은 중복 pending을 막고 각 action 가까이에 loading, server error, retry를 유지한다. 미리보기는 MCP Judge 입력 요약이지 전송·실행·승인 결과가 아니다.
- 생성 결과는 서버 envelope만 표시한다. `usedLlm=false`는 `결정론적 폴백`과 MCP 평가/검증 부재를 뜻하며 모델 실행 성공으로 말하지 않는다. snapshot revision이 바뀌면 이전 preview/result와 Evidence 선택을 해제하고 다시 확인하도록 알린다.
- 규칙 후보, LLM 비최종 평가, 서버 최종 검증, 사람 검토는 별도 block이다. 최종 검증은 server verdict/reason/run ID/validation·control Evidence의 빈 값까지 보이며 `INCONCLUSIVE`와 severity/risk/model 문구를 CONFIRMED로 바꾸지 않는다.
- review transport는 `ReviewStatus = UNRESOLVED | CONFIRMED | DISMISSED`를 사용한다. 각 카드가 자신의 note(최대 2,000자), pending/error/success를 보유해 실패 초안을 지키고 다른 카드 제어를 막지 않는다. raw HTTP, capability, provider output은 저장하거나 기록하지 않았다.
- 후보/평가, 검증, 정상 제어 Evidence 그룹은 exact snapshot event만 shared Evidence Sheet로 연다. 없는 ID는 사용 불가로 남기며, structured scenario selection은 bounded body text 하나만 써서 generic Sheet header/metadata/ARIA/live region에 ID를 중복하지 않는다.

### 검증

- RED: `npm test -- src/features/scenarios/ScenariosPage.test.tsx`는 새 `ScenariosPage` import를 resolve하지 못해 예상대로 실패했다.
- GREEN: focused scenario suite는 simulated transport로 preview GET→scenario POST ordering, fallback wording, final/non-final/review separation, exact capped review form 및 per-card 실패 격리, exact/missing Evidence selection, escaped bounded text, revision reset, loading/error/empty state를 검증했다. Java, browser E2E, Burp runtime, HUMAN/ZAP/LLM CLI, Request Lab send, Repeater는 실행하지 않았다.

### 남은 한계·다음 gate

- Java contract, browser E2E, 실제 Burp runtime parity 및 능동 동작은 Task 12–14 gate로 계속 열려 있다.

### Task 11 fix round 1

- scenario card는 더 이상 `snapshot.scenarios`를 fallback으로 사용하지 않는다. 현재 revision에서 preview가 성공한 뒤 `POST /api/ai-scenarios`가 돌려준 envelope만 렌더하며, 그 전에는 중립 안내만 보인다. preview 실패·snapshot revision 변경·late preview response는 생성 eligibility를 만들지 못한다.
- revision 변경은 preview/result/error/pending/selection과 card-local review surface를 함께 해제한다. stale snapshot은 같은 revision의 마지막 성공 상태를 계속 읽을 수 있지만, 다른 revision의 preview나 generated card를 현재 사실처럼 보이지 않는다.
- preview finding/gap 모든 필드는 구조화된 bounded text로 보이고, preview 및 scenario list는 처음 일부만 표시한 뒤 Korean expand/collapse로 전체를 연다. ID는 ordinary body text에만 남는다.

## 2026-09-01 · Task 12 · standalone React parity browser harness

### 개발·수정

- packaged fat JAR만 직접 기동하는 Chromium Playwright harness를 추가했다. Vite 또는 다른 포트로 우회하지 않고 `127.0.0.1:17777/app/`와 `reuseExistingServer: false`를 고정해 standalone 계약을 유지한다. launcher는 port가 비어 있지 않으면 기존 listener를 재사용·접속하지 않고 즉시 실패한다.
- Korean role/label selector로 아홉 navigation route, sample surface, graph/matrix/sequence/Evidence exact selection, responsive 1280/900/600, keyboard/overflow, console/page error 및 exact-origin request를 검증하도록 구현했다. 시나리오는 먼저 `MCP Judge 입력 미리보기` GET이 끝나 생성 가능 상태가 된 뒤에만 생성하고, 후보/평가 Evidence heading의 직접 parent group에서 서버 순서상 첫 usable Evidence를 Sheet로 연다. group을 펼친 뒤 실제 Evidence row 수를 세어 scenario structured Sheet의 `Evidence IDs (exact count)`와 방금 선택한 exact ID가 모두 일치하는지 확인하며, generic 단일-event header인 `선택 Evidence: ...`를 기대하지 않는다. 같은 card의 다른 Evidence group과 이름이 같은 button은 선택하지 않는다.
- suite는 Request Lab, HUMAN, scanner, LLM, Repeater의 active POST를 route guard로 중단한다. 허용된 metadata account CRUD는 retry별 고유 label을 사용하고 `finally`에서 정리한다. in-memory XML fixture의 서로 다른 request/response raw marker와 capability 모두 local/session storage에 남지 않는지 점검한다.

### 검증

- RED: harness/launcher가 없던 상태의 `npm run e2e`와 launcher module 부재를 재현했다. fix round 2 전 정적 contract scan은 preview-before-generate, non-first selection, XML raw marker, retry cleanup 조건이 누락됐음을 확인했고, 보강 뒤 조건이 모두 존재함을 확인했다. fix round 4 정적 RED는 scenario structured Sheet에 없는 generic `선택 Evidence: ...` assertion을 재현했다. fix round 5 정적 RED는 outer section 밖의 ancestor를 포함한 `has` locator와 임의 count regex를 재현했고, heading에서 직접 parent로 이동하는 locator 및 선택 group DOM에서 산출한 exact count assertion으로 바꾼 뒤 GREEN을 확인했다.
- GREEN: 이전 fix round에서 `npx playwright test --list`와 `node --check e2e/parity.spec.ts`는 browser/server를 기동하지 않고 harness discovery·syntax를 통과했다. fix round 4의 Windows shell에서는 Playwright `--list`가 test 목록 출력 전에 비진단 process exit해 새 PASS 근거로 쓰지 않았다. fix round 5의 정적 contract scan과 두 Node syntax check, `npm run verify` 21 files / 129 tests, `npm run typecheck`, `npm run build`, `git diff --check`는 통과했다. build의 Cytoscape 500 kB chunk advisory는 기존 advisory다.
- Controller package evidence: JDK 21 + Maven 3.9.11 `mvn -B clean package`는 4:21에 BUILD SUCCESS였고, `npm ci`는 vulnerabilities 0, frontend 21/129와 Java 258/258은 pass, final fat JAR은 생성됐다.

### 남은 한계·다음 gate

- 실제 packaged Chromium E2E는 실행하지 않았다. user-owned Burp가 mandated `127.0.0.1:17777`을 점유하고 있어 harness가 fail-fast하며, 이를 중지·attach·reuse하지 않는다. 그러므로 browser E2E PASS나 Burp runtime parity PASS를 주장하지 않으며 다음 gate는 Task 14다.

### Task 12 fix round 6 · React verdict wire 계약

- packaged `/api/snapshot`의 event/cell verdict는 Java `Verdict`의 `ALLOW`, `DENY`, `SUSPICIOUS`, `UNDECIDED`, `UNTESTED`를 소문자로 직렬화한다. React `Verdict`와 graph style이 존재하지 않는 `soft_deny/error/inconclusive`를 선언하던 불일치 때문에, matching coverage cell이 없는 `suspicious/undecided` event를 node로 투영할 때 style lookup이 `undefined`가 되어 `style.text`에서 중단됐다.
- frontend API union과 graph styles를 서버의 다섯 값으로 정확히 맞췄다. `SUSPICIOUS`는 주황색, `UNDECIDED`는 보라색 문자·색 조합을 사용하고 `ALLOW/DENY/UNTESTED`는 기존 의미를 유지한다. 알 수 없는 서버 값을 조용히 숨기는 generic fallback이나 page error suppression은 wire drift를 가리므로 추가하지 않았다.
- graph, matrix, dashboard fixture에서 허구의 verdict를 모두 제거했다. matching cell이 없는 실제 `suspicious/undecided` event 두 건을 직접 투영하는 회귀가 두 verdict와 정확한 text/color를 검증한다.

**영향 파일**

- 계약·투영: `frontend/src/lib/api/types.ts`, `frontend/src/features/graph/graphProjection.ts`
- 회귀·fixture: graph projection, matrix, dashboard component test
- 공개 정본: `CHANGELOG.md`, `docs/ko/architecture.md`, 이 개발 기록

**검증 및 남은 gate**

- RED: focused graph projection test는 `TypeError: Cannot read properties of undefined (reading 'text')`로 기존 runtime crash를 재현했다.
- GREEN: focused graph/page 2 files/10 tests, matrix/dashboard 2 files/17 tests, frontend typecheck, full frontend 21 files/130 tests, production build를 통과했다. exact JDK 21 + Maven 3.9.11 `mvn -B clean verify`도 frontend 21/130, Java 260/260, fat JAR package/relocation/release verification과 함께 `BUILD SUCCESS`였다.
- 기존 jsdom canvas notice, Vite 500 kB chunk advisory, Java deprecation diagnostic, XML DOCTYPE negative-test stderr는 유지된다. 이 fix는 browser/target/Burp/ZAP/LLM/Request Lab traffic을 실행하지 않았으며 Task 14 runtime gate를 완료로 바꾸지 않는다.

### Task 12 fix round 7 · standalone Request Lab 읽기 전용 경계

- packaged browser E2E에서 Request Lab을 열면 `FlowScopeWebServer.State`의 기본 `requestLabDraft`가 HTTP 400을 반환했다. Dialog는 오류를 처리했지만 Chromium의 `Failed to load resource` console error가 무오류 gate를 깨뜨렸다. console allowlist나 suppression 대신 standalone 상태의 제품 계약을 보완했다.
- `DemoState`는 현재 snapshot에서 exact Evidence ID만 조회하고, 요청·응답을 다시 마스킹한 뒤 `rawRequestRetained=false`, `rawResponseRetained=false`, `requestEditable=false`, 재사용 세션 `없음`인 draft를 반환한다. 알 수 없는 Evidence는 다른 레코드로 대체하지 않고 거부하며, POST 전송은 명시적인 한국어 오류로 계속 거부해 대상 네트워크 트래픽을 만들지 않는다.
- React Dialog는 서버 draft message를 표시하고, 비편집 draft의 전송 버튼뿐 아니라 `send` handler 자체에서도 전송을 거부한다. 원문은 기존 instance-local memory owner를 거치며 query cache·browser storage·로그에 추가로 저장하지 않는다.

**검증 및 남은 gate**

- RED: Java focused test는 exact/unknown sample draft에서 기본 `request lab is unavailable` 예외를 재현했고, React focused test는 standalone 제한 message가 렌더되지 않는 실패를 재현했다. 별도 POST 회귀는 기존 영문 기본 예외가 standalone 한국어 경계를 충족하지 못함을 확인했다.
- GREEN: `StandaloneTest` 3/3과 `RequestLabDialog.test.tsx` 12/12, 단일 worker 전체 frontend 21 files/131 tests, production build를 통과했다. exact JDK 21 + Maven 3.9.11 `mvn -B clean verify`도 frontend 21/131, Java 263/263, fat JAR relocation/release verification과 함께 `BUILD SUCCESS`였다. 기본 병렬 frontend 실행은 shared Windows 부하에서 기존 Accounts test의 5초 timeout이 반복됐지만 해당 파일 단독 11/11과 동일 전체 suite 단일 worker 131/131은 통과했다. 이 수정 자체는 browser·Burp·ZAP·LLM·target traffic 또는 실제 Request Lab 전송을 실행하지 않았다.

#### Fix round 1 · 낮은 viewport의 footer 접근성

- controller의 실제 packaged Chromium E2E는 안전한 standalone draft까지 도달했지만 1280×720에서 Dialog 전체 높이가 viewport를 넘겨 `닫기`가 visible/enabled 상태면서 화면 밖에 놓이는 RED를 재현했다. 공통 Dialog에는 영향을 주지 않고 Request Lab에만 `100dvh - 2rem` 최대 높이와 `header / minmax(0, 1fr) body / footer` 3행 grid를 적용했다.
- header와 footer는 고정 행에 두고 draft·metadata·request/response·history가 있는 본문만 `min-height: 0`, 세로 스크롤, overscroll containment를 갖는다. 따라서 낮은 화면에서도 footer 조작을 viewport 안에 유지하면서 모든 읽기 전용 내용은 내부 스크롤로 접근할 수 있다. raw memory owner, 비편집 send 이중 guard, storage/log 제외 및 active POST 거부는 바꾸지 않았다.
- focused Request Lab 12/12, typecheck, 단일 worker 전체 frontend 21 files/131 tests와 production build를 통과했다. 생성 CSS에서 `max-height: calc(100dvh - 2rem)`, 3행 grid, `overflow-y: auto`, `overscroll-behavior: contain`을 확인했다. 이 fix agent는 browser·Burp·target traffic을 실행하지 않았으며 packaged E2E 재검증은 controller gate로 남긴다.

### Task 12 fix round 8 · sample 상태의 점검 시작 경로

- 실제 packaged E2E의 sample snapshot에는 Evidence가 있어 대시보드의 빈 상태 온보딩 카드와 `빠른 시작` 버튼이 정상적으로 렌더되지 않는다. harness 한 항목만 빈 상태 전용 버튼을 전제해 실패했으며, 제품 UI나 sample 상태를 바꾸지 않고 다른 route 검증과 동일한 sidebar `점검 시작` 링크로 진입하도록 보정했다.
- exact-origin·active POST 차단, console/page error, storage secret, route heading 검증은 그대로 유지한다. 이 수정은 browser·Burp·target traffic을 실행하지 않았으며 packaged E2E PASS는 controller 재실행 전까지 주장하지 않는다.

### Task 12 fix round 9 · ZAP 상태 locator의 의미론적 범위

- 실제 packaged E2E에서 전역 `ZAP UNAVAILABLE`·`LLM UNAVAILABLE` badge와 Inspection의 ZAP 상태 줄이 모두 넓은 text pattern에 걸려 Playwright strict-mode가 실패했다. `3 · ZAP` tabpanel 안으로 locator를 한정하고, standalone의 exact unavailable 문구 또는 query 초기 연결 확인 문구만 anchored pattern으로 검증한다. 임의 첫 element 선택이나 전역 badge 결합은 사용하지 않는다.
- ZAP 실행 버튼의 disabled assertion과 exact-origin·active POST 차단을 포함한 보안 guard는 그대로 유지한다. 이 수정은 browser·Burp·target traffic을 실행하지 않았으며 packaged E2E PASS는 controller 재실행 전까지 주장하지 않는다.

### Task 12 fix round 10 · LLM CLI 상태 locator의 의미론적 범위

- 실제 packaged E2E에서 전역 ZAP/LLM badge, LLM card title, CLI 상태 줄이 넓은 `UNAVAILABLE` pattern에 함께 걸려 Playwright strict-mode가 실패했다. active `LLM` tabpanel 안에서 `CODEX CLI 사용할 수 없음 · CLAUDE CLI 사용할 수 없음` exact text만 검증하도록 좁혔다.
- 같은 panel의 `LLM Explorer 시작` disabled assertion과 exact-origin·active POST 차단을 포함한 보안 guard는 그대로 유지한다. 이 수정은 browser·Burp·target traffic을 실행하지 않았으며 packaged E2E PASS는 controller 재실행 전까지 주장하지 않는다.

### Task 12 closeout · packaged Chromium 자동 E2E

- controller가 exact JDK 21로 만든 latest packaged fat JAR을 fresh ASCII `PWTEST_CACHE_DIR=C:\CodexPwDiag\pw-cache-e2e-6aee210eb6fc437a97cf561dd62264d8`에서 기동해 `npm run e2e`를 다시 실행했다. 결과는 exit 0, 8/8 pass, 11.3초였다.
- suite의 route guard는 HUMAN, ZAP, LLM, Request Lab send, Repeater의 active 요청을 금지했다. 상태 변경은 정리까지 검증한 metadata-only account CRUD와 raw marker를 storage에 남기지 않는 in-memory XML import에 한정됐다. console error, uncaught page error, 외부 origin 요청, capability/raw marker의 local/session storage 잔존은 모두 0건이었다.
- 따라서 standalone packaged Chromium 자동 gate는 PASS다. 실제 target을 사용하는 HUMAN/ZAP/LLM/Request Lab/Repeater와 Burp runtime parity, root cutover는 별도 Task 14 gate로 계속 PENDING이며 이 결과로 확대 해석하지 않는다.

## 2026-09-01 · Task 13 · frontend notice와 release smoke

### 개발·수정

- `license-checker-rseidelsohn` API를 production dependency graph에만 사용해 package name/version 순서의 deterministic notice를 만든다. dev-only Vitest/Playwright는 포함하지 않고, UNKNOWN/UNLICENSED license, repository metadata, 또는 local `node_modules` license file이 없으면 fail closed 한다. 결과는 LF-normalized complete local license text만 포함하며 절대 workspace path를 출력하지 않는다.
- notice generator는 `target/generated-resources/frontend-notices/META-INF/NOTICE-frontend.txt`만 쓴다. Maven은 `npm ci` 직후 이 파일을 생성하고 generated notice root만 resource로 복사한다. primary NOTICE는 기존 Java/legacy notices를 보존한 채 frontend notice resource를 참조한다.
- release smoke는 React index, hashed JS/CSS, frontend NOTICE, legacy Cytoscape asset exactly once를 요구하고 node_modules/Playwright/Vitest 및 React asset의 legacy Cytoscape reference를 거부한다.
- 기존 generic MR-JAR regexp move가 Java 11/17/21 versioned entries를 final JAR에서 잃는 것을 확인했다. explicit version-root move로 Jackson, JSoup, SnakeYAML relocated MR entries를 보존해 Java 21 class selection, Multi-Release manifest, Shade relocations, streaming manifest, and one-public-JAR contract를 함께 유지했다.

### 검증

- RED: `node --test scripts/generate-notices.test.mjs`는 generator 부재로 `ERR_MODULE_NOT_FOUND`를 내며 실패했다. 첫 release `mvn -B clean verify`는 new `.test.mjs`가 Vitest에 discovery되어 no-suite failure를 재현했고, Node-only test path를 package Vitest command에서 명시적으로 제외했다. 다음 release RED는 기존 MR-JAR smoke의 `FastDoubleSwar` base-class selection failure였다.
- GREEN: isolated temporary package-lock/node_modules fixture와 installed graph notice test 2/2, `npm run typecheck`, full Vitest 21 files/129 tests, 그리고 exact JDK 21 + Maven 3.9.11 `mvn -B clean verify`가 pass했다. Maven lifecycle generated notice, frontend build, Java 258/258, MR relocation, one-JAR check, and `FatJarIsolationSmoke` all completed successfully.

### 남은 한계·경고

- Target/Burp/ZAP/LLM/Request Lab/browser traffic은 Task 13에서 실행하지 않았다. Existing `@types/cytoscape` deprecation, jsdom canvas notice, Vite 500 kB chunk advisory, Java deprecation diagnostic, XML DOCTYPE negative-test stderr are recorded warnings; release result is BUILD SUCCESS.

### Task 13 fix round 1

- notice generator는 license-checker가 낸 문자열, 배열의 각 element, structured `type`/`name`/`license` identifier를 모두 fail-closed로 검사한다. blank, missing, `UNKNOWN`, `UNLICENSED`는 유효한 값과 섞여도 reject하며 empty/missing local license text도 계속 reject한다. 이 변경은 허가된 license identifier를 새로 해석하거나 license text를 보완하지 않는다.
- MR-JAR relocation은 더 이상 Java version root 목록에 의존하지 않는다. package phase의 deterministic JAR rewrite가 모든 `META-INF/versions/<root>/` Jackson/JSoup/SnakeYAML source entry를 shaded path로 옮기고 sorted source-to-target map을 JAR에 기록한다. smoke는 모든 root에서 source namespace 부재, map의 exact destination, source 부재/target 존재를 검사하면서 existing known-class selection과 `Multi-Release: true` 검사를 유지한다.

### Task 13 fix round 2

- deterministic MR-JAR writer는 `JarOutputStream(OutputStream, Manifest)`의 현재 시각 manifest entry를 사용하지 않는다. serialized manifest bytes를 output timestamp를 가진 첫 `META-INF/MANIFEST.MF` entry로 명시적으로 쓰고, 나머지 entry와 relocation map도 같은 timestamp로 쓴다. equivalent input archive 두 개의 byte-for-byte output과 모든 entry timestamp를 regression으로 확인한다.
- local LICENSE directory fixture는 license-checker가 metadata를 반환하기 전에 걸러질 수 있으므로, 그것만으로 FlowScope `readFile` catch를 증명하지 않는다.

### Task 13 fix round 3

- notice collection에는 test-only metadata source를 위한 narrow `packageCollector` boundary가 있다. CLI/default 경로는 계속 programmatic `license-checker-rseidelsohn`의 production graph를 사용한다. injected metadata가 `node_modules` 아래 directory LICENSE를 가리키는 경우 실제 `readFile` error가 cause로 wrapped되어 fail closed함을 확인하고, license metadata 자체가 없는 경우와 구분한다.

## 2026-09-02 · 통합 분석 작업면 최종 whole-branch review 수정

### 개발·수정

- Request Lab send에 context generation과 `AbortController`를 연결했다. close, unmount, Evidence/event 변경, dataset revision 변경은 현재 send를 abort하고 generation을 올리므로 이전 promise의 success/error/finally가 response, error, pending state 또는 instance-local raw owner를 다시 채우지 못한다.
- 상단 탐색은 symbol/`ACCESS ANALYSIS`, dashboard·inspection·runs primary links, Scope/HUMAN/ZAP indicators, refresh/continue action과 emerald active state를 제공한다. 분석 route는 horizontal overflow의 자식이 아닌 Radix portal menu에서 열려 compact와 desktop 모두 같은 전체 route set을 유지한다.
- `xl` 미만 그래프 toolbar에 desktop rail과 동일한 filter controls를 재사용하는 Sheet를 추가했다. Cytoscape lane clamp는 rendered half-width를 반영하고, opt-in browser geometry seam으로 center/bounds를 노출해 zoom/fit/resize 및 diagonal drag 뒤의 lane containment를 실제 Chromium에서 검증한다. route candidate REVIEW는 공통 amber tone을 사용하면서 dotted border와 text 구분을 유지한다.
- Matrix는 중첩 overflow를 제거하고 하나의 bounded two-axis viewport만 사용한다. corner header는 `top-0 left-0 z-40`, operation header는 top, identity header는 left에 고정한다. Playwright는 viewport의 두 축을 실제로 끝까지 scroll하고 세 sticky offset이 유지됨을 검증한다.
- `FLOWSCOPE_E2E_ORIGIN`은 `new URL(...).origin`으로 정규화하며 외부 origin이 주어지면 Playwright `webServer`를 생략한다. stale Evidence/Sequence locator도 exact accessible surface로 좁혀 strict-mode 중복을 제거했다.

### 검증과 한계

- TDD RED는 Request Lab의 close/Evidence/revision 뒤 늦은 완료가 raw owner를 되살리는 세 실패, compact graph filter와 nav/matrix/geometry 계약의 누락을 재현했다. focused aggregate 10 files / 67 tests와 nav/dashboard 2 files / 16 tests를 통과했다.
- 최종 frontend는 `npm test -- --maxWorkers=1` 32 files / 193 tests, `npm run typecheck`, `npm run notices`, `npm run build`를 통과했다. jsdom canvas notice와 Vite 500 kB chunk advisory는 기존 비차단 진단이다.
- portable Maven 3.9.11의 `clean`, 독립 frontend notices/build, `-B '-Dskip.npm=true' verify` 순서로 Java 264 / 264와 fat-JAR relocation/release verification이 `BUILD SUCCESS`였다.
- 최초 Playwright 실행은 Unicode workspace transform cache에서 Windows exit `-1073740791`을 재현했다. repository-established fresh ASCII cache를 사용한 최종 실행은 free loopback port `61349`, `PWTEST_CACHE_DIR=C:\CodexPwDiag\pw-cache-final-6e276569abcc47b084ad2395dec76571`, normalized external origin에서 packaged Chromium 8 / 8, 14.1초, exit 0이었다. standalone gate는 실제 target/Burp/HUMAN/ZAP/LLM/Request Lab active traffic을 실행하지 않으므로 Task 14 runtime gate는 계속 PENDING이다.

## 2026-09-02 · Task 4 review fix round 1 · compact core analysis routes

### 개발·수정

- Matrix, Sequence, Scenarios, Evidence는 compact `선택 상세 열기`를 route-owned open state로 제어한다. 빈 선택에서도 Korean guidance를 열고, 실제 선택은 inspector를 열며 close는 선택과 Sheet를 함께 정리한다. desktop persistent inspector는 같은 selection body를 유지한다.
- Sequence context는 현재 deterministic `flowLinks` projection만 좁히는 identity filter를 제공한다. 서버 link order·contents·verdict는 변경하지 않으며 filter로 숨겨진 선택은 닫힌다.
- 각 route는 900px와 600px에서 실제 context Sheet control, center projection, Evidence inspector Sheet, close 후 focus/selection cleanup을 회귀로 검증한다.

### 검증과 한계

- focused 5 files/61 tests와 typecheck를 통과했다. final serial frontend gate 결과는 Task 4 report와 commit에 기록한다.
- 이 review fix는 browser/packaged JAR/Burp/target traffic을 실행하지 않았으며 그 runtime gate는 Task 6 범위다.

## 2026-09-02 · Task 5 · 운영 화면 공통 분석 작업면

### 개발·수정

- Dashboard, 점검 시작, 계정·세션, 실행 상태를 `ReferenceAnalysisWorkspace`의 context·main·inspector 슬롯으로 옮겼다. 중앙의 metrics/chart, 네 단계 점검 제어, 계정·세션 mutation, HUMAN/ZAP/LLM 실행 제어는 기존 상태 소유권과 gate를 그대로 유지한다.
- 좌측은 현재 snapshot, 점검 단계, 계정/세션 수, 실행 lane처럼 서버가 제공한 상태만 요약한다. 우측은 선택 항목이 없을 때 명시적 안내를 보이며, 연결됨·0건·선택 항목 같은 가짜 운영 상태나 지원하지 않는 동작 버튼을 추가하지 않았다.
- 독립적인 새 route별 side panel 구현은 같은 responsive Sheet와 접근성 동작을 중복하게 되어 기각했다. 공통 workspace를 재사용해 900px/600px에서도 같은 context/inspector 접근 경로를 유지한다.

### 회귀·검증과 한계

- 새 회귀는 네 화면이 `분석 필터`와 `선택 상세` landmark를 갖고 기존 chart, stage tabs, 계정 mutation, LLM tab을 그대로 노출하는지 확인한다. RED에서는 아직 workspace를 조합하지 않은 route가 새 landmark 계약을 충족하지 못했다.
- GREEN: focused 4 files/49 tests와 `npm.cmd run typecheck`를 통과했고, serial `npm.cmd test -- --maxWorkers=1`은 36 files/231 tests, exit 0으로 통과했다.
- jsdom canvas diagnostic은 기존 테스트 환경 경고다. 브라우저·packaged JAR·실제 Burp/HUMAN/ZAP/LLM traffic 검증은 수행하지 않았으며 Task 6/runtime gate가 다음 단계다.

## 2026-09-02 · Task 5 review fix round 1 · truthful HUMAN 상태와 compact 운영 여정

### 개발·수정

- Inspection과 Runs의 HUMAN 요약은 마지막으로 받은 실제 데이터가 있을 때만 그 데이터의 진행·완료·대기 상태를 쓴다. 최초 데이터가 없으면 pending은 `불러오는 중`, 오류는 `상태 확인 필요`로 context와 inspector에 함께 표시한다. 연결됨·0건·선택 항목 같은 추정 상태는 추가하지 않았다.
- Dashboard, Inspection, Accounts, Runs의 실제 route adapter는 900px와 600px에서 context와 inspector Sheet를 각각 열어 route 제공 요약/안내를 읽고, 닫은 뒤 중심 chart, stage tab, account mutation, LLM control에 다시 접근하는 회귀 여정을 갖는다. generic workspace만 검증하는 대안은 각 route의 runtime composition을 증명하지 못해 기각했다.

### 검증과 한계

- RED에서 최초 HUMAN no-data loading/error 4개 assertion이 `대기` 및 inspector 상태 부재를 재현했다. GREEN focused 4 files/61 tests, `npm.cmd run typecheck`, serial `npm.cmd test -- --maxWorkers=1` 36 files/243 tests가 모두 exit 0으로 통과했다.
- jsdom canvas diagnostic은 기존 비차단 경고다. browser, packaged JAR, Burp, 실제 HUMAN/ZAP/LLM traffic은 이 review fix에서 실행하지 않았고 다음 runtime gate로 남긴다.

## 2026-09-02 · Task 6 · Reference 분석 셸 verification

- packaged journey는 아홉 route의 five-region frame, desktop/900px/600px overflow, closed compact current-route semantics, context/inspector Sheet, graph `IDENTITY/ENDPOINT/OBJECT` lane과 diagonal drag, Matrix sticky, Request Lab draft, `/legacy/`를 다룬다.
- focused shell coverage는 15 / 15을 통과했다. final serial frontend gate는 `npm.cmd test -- --maxWorkers=1` 36 files / 255 tests, typecheck, notices, Vite 2,040-module build를 통과했다. 기존 jsdom canvas notice와 Vite 500kB advisory는 비차단 진단이다.
- Accounts의 일곱 mutation/refetch journey는 assertion 실패 없이 focused 14 / 14에서 12.67초가 걸려 per-test timeout만 15초로 좁혔다. Maven 3.9.11 `verify`는 Java 264 / 264를 통과했고, bundled Node Chromium packaged journey는 fresh ASCII cache에서 8 / 8 (19.2초), console/page error 0으로 통과했다. 전달 JAR `flowscope-1.2.0-beta.25-ui-final.jar`는 worktree source와 16,340,463 bytes 및 SHA-256 `872ECB3B4B82BB4317074F6DC4F69323F07D0950719515FD6E202A35112B0F37`가 일치한다. standalone 검증은 실제 Burp/target traffic을 대체하지 않는다.

## 2026-09-02 · Task 5 review fix round 2 · 중앙 HUMAN 상태와 초기 오류 이력의 정직성

### 개발·수정

- Inspection과 Runs의 중앙 HUMAN card는 최초 query data가 없을 때 `NOT_STARTED` 또는 pass 대기를 만들지 않고 `불러오는 중`/`상태 확인 필요`를 표시한다. 실제 HUMAN 응답이 있는 경우에만 idle, running, completed 상태를 사용하므로 refetch 오류 중 마지막 성공 상태는 유지된다.
- Inspection의 HUMAN account selector와 시작 action은 확인되지 않은 초기 상태에서 disabled다. Runs에는 지원하지 않는 HUMAN action을 새로 만들지 않았고, LLM action은 기존의 실제 LLM provider·scope gate를 그대로 사용한다.
- query 오류 alert는 오류가 난 query의 cached data가 있을 때만 마지막 성공 상태라고 말한다. 최초 data 없는 오류는 상태를 가져오지 못해 확인이 필요하다고 구분한다.

### 검증과 한계

- RED는 loading/error 중앙 card의 fabricated `NOT_STARTED`, 초기 data 없는 Inspection 시작 action, 그리고 거짓 last-success alert를 재현했다. GREEN focused 4 files/63 tests, `npm.cmd run typecheck`, serial `npm.cmd test -- --maxWorkers=1` 36 files/245 tests가 exit 0으로 통과했다.
- jsdom canvas diagnostic은 기존 비차단 경고다. browser, packaged JAR, Burp, 실제 HUMAN/ZAP/LLM traffic은 이 review fix에서 실행하지 않았고 다음 runtime gate로 남긴다.

## 2026-09-02 · Reference shell 최종 whole-branch review fix

### 개발·수정

- desktop 중심 작업면을 실제 keyboard/wheel scroll owner로 만들고 Graph는 같은 slot의 남은 높이를 전부 쓰게 했다. packaged 1280×720 Accounts route에서 처음 화면 밖의 마지막 초기화 조작까지 keyboard `End`로 도달함을 확인했다.
- 상단 Scope/HUMAN/ZAP/SCANNER/LLM는 query별 cached data, loading, unavailable의 세 상태를 독립적으로 계산한다. Scope readiness를 exact scope와 분리하고 compact에서는 모든 상태, project selector, DB, 실제 action을 wrap 안에 유지한다.
- Cytoscape max zoom을 lane 가용 폭과 zoom-scaled node 폭으로 제한했다. 선택 element ID를 graph state에 두고 preference/zoom/fit/resize/lock/reset 뒤 실제 Cytoscape selected border까지 복구한다.
- Graph inspector를 독립 open state로 바꿔 빈 Korean guidance, selection auto-open, close-selection cleanup을 desktop/900px/600px에 고정했다. Evidence 선택은 현재 snapshot membership에서 동기적으로 파생해 dataset 교체 직후 이전 ID나 Request Lab draft fetch가 재등장하지 않는다.
- import가 없는 legacy `TopBar`, `AppTopNavigation`, `WorkspaceContextBar`, `AnalysisWorkspace`와 obsolete tests를 제거했다. 보호된 dirty `AppSidebar.tsx`와 Java 5개 파일은 수정·stage하지 않았다.

### TDD·검증과 한계

- RED는 새 계약 12개 실패로 desktop scroll owner, per-query tri-state, zoom-scaled geometry, actual selection 유지, Graph inspector lifecycle, stale Evidence fetch를 재현했다. GREEN은 focused 6 files / 53 tests와 Dashboard 1 file / 16 tests였다.
- Maven 3.9.11 `clean verify` 한 번으로 frontend 34 files / 254 tests, typecheck, notices, Vite 2,040-module build, Java 264 / 264와 release JAR verifier를 통과했다. 기존 jsdom canvas, Vite 500 kB, Java native/deprecation, XXE negative-test stderr만 비차단 진단으로 남았다.
- packaged Chromium은 fresh ASCII cache와 free port `55407`에서 8 / 8, 21.0초, console/page error 0이었다. `try/finally` cleanup 뒤 exact PID `51324`와 port가 모두 사라졌다.
- 최종 source/delivery JAR은 각각 16,340,715 bytes이며 SHA-256 `F00679E620EE00A0FB1C63CCB468AB5F889C3F2FBBA56ACBD5765C99D13000C4`로 일치한다. 실제 Burp load, 실제 target traffic, HUMAN/ZAP/LLM과 active Request Lab 전송은 standalone gate가 대신하지 않는다.

## 2026-09-06 · 1.2.0-beta.44 · 셰이딩 누락 봉합과 일반 누출 검사

### 개발·수정

- 리뷰에서 fat JAR에 `com/google/debugging/sourcemap`(43) 및 `org/jspecify`(4) 클래스가 원래 네임스페이스 그대로 실려 있음을 확인했다. shade relocation이 `com.google.javascript`만 다뤘고 closure-compiler가 함께 끌어오는 이 두 패키지는 빠져 있었다. 완결성 검사(`assertAllVersionedSourceNamespacesWereRelocated`)가 `META-INF/versions/` 트리만 보고 top-level 누출은 검사하지 않아 잡히지 않았다.
- pom shade에 `com.google.debugging → io.flowscope.shaded.sourcemap`, `org.jspecify → io.flowscope.shaded.jspecify` relocation을 추가했다.
- 이름별 allowlist가 아니라 일반 검사 `assertNoForeignClassNamespace`를 추가했다. `io.flowscope`와 (네이티브 로딩 때문에 의도적으로 미relocate하는) `org.sqlite`, `module-info`, `META-INF` 외의 최상위 네임스페이스로 클래스가 하나라도 새면 빌드를 실패시킨다. 앞으로 추가되는 의존성의 누락까지 잡는다. CI에도 같은 grep 가드를 넣었다.

### 필요성·기각 대안

- `com.google` 전체를 한 규칙으로 relocate하는 방식은 이미 있는 `com.google.javascript` 규칙과 겹쳐 shade의 중복 relocation 위험이 있어 기각하고, 실제 존재하는 하위 패키지만 명시적으로 relocate했다.
- `org.sqlite`는 네이티브 라이브러리를 고정 패키지명으로 로드하므로 relocate하지 않고 검사에서 명시적으로 허용했다.

### 영향 파일·회귀

- 코드: `pom.xml`(shade relocations), `.github/workflows/ci.yml`(누출 grep 가드).
- 테스트: `FatJarIsolationSmoke.assertNoForeignClassNamespace` — org.sqlite 외 낯선 최상위 네임스페이스 0건을 강제.
- 문서: decisions D-123, 이 기록.

### 최종 검증

- JDK 21.0.12·Maven 3.9.16 `mvn clean verify` 1회, Java 382 tests·failure/error 0. 산출물 JAR에서 `com/google/*`·`org/jspecify/*` top-level 클래스 0건, `io/flowscope/shaded/sourcemap` 43·`io/flowscope/shaded/jspecify` 4 확인.

### 남은 한계

- 재현 해시는 여전히 명시 환경(Homebrew JDK 21.0.12) 한정이며 벤더 교차 재현은 미검증이다.

- 문서: decisions D-124, 이 기록.

### 최종 검증

- 집중 회귀 통과. 전체 수치는 아래 커밋의 verify에 기록.

### 남은 한계

- 다중 항목 scope의 실제 ZAP 캠페인 완주는 실환경 gate로 남는다. `includeInContext`는 여전히 단일 target이라 ZAP 스파이더 자체의 형제 항목 크롤은 별도 검토가 필요하다.

## 2026-09-07 · 미출시 · Judge·MCP 제거 1단계 — ZapCampaign 분리

### 개발·수정

- ZAP 캠페인의 상태·worker·heartbeat·lane 순회·crawler 종료·capability·Alert snapshot과 기존 ZAP 도구 구현을 `McpServer`에서 `ZapCampaign`으로 이동했다. `ZapDefinitionType/Definition`도 새 소유 모듈로 옮겨 Web parser의 MCP 타입 참조를 제거했다.
- Burp가 `startZapIntegration()`에서 캠페인 한 개를 먼저 만들고 웹이 시작·상태·취소를 직접 호출한다. MCP는 같은 인스턴스에 위임하며 host 소유 캠페인을 닫지 않는다. 확장 unload와 MCP 생성 실패 상태의 reset 경로에도 캠페인 정리를 연결했다.
- 호스트의 캠페인·MCP 참조를 `volatile`로 게시해 웹 thread와 dataset-lock callback이 초기화된 현재 참조를 읽게 했다.
- `FakeZap`에는 기존 테스트의 환경 응답 helper만 이동했다. 독립 캠페인 회귀 5개를 추가했다. Judge·MCP 실행 자체와 Client/AJAX 순서는 아직 유지했다.

### 필요성·기각 대안

- 목표는 Judge·MCP 제거다. 기존에는 MCP 삭제 또는 포트 충돌이 ZAP 초기화·웹 제어까지 끊는 결합이 있어 이 소유권부터 분리했다.
- MCP 전체 즉시 삭제, 두 개의 캠페인 생성, Client-only 동작 변경과의 일괄 병합을 기각했다. 기존 계정·scope·완료·JSON 계약을 유지한 이동부터 확인한다.

### 영향 파일·회귀

- 코드: `integration/ZapCampaign.java`, `integration/McpServer.java`, `burp/FlowScopeExtension.java`, `web/FlowScopeWebServer.java`.
- 테스트: `ZapCampaignTest`, `FakeZap`, 기존 `McpServerTest` helper 이동, `FlowScopeWebServerParsingTest` 타입 변경.
- 문서: README, architecture, decisions D-125, 이 기록, product-development-plan, ui-product-rationale, 한·영 CHANGELOG, beta-validation, 새 mcp-judge-removal-plan.
- RED: 독립 서비스 회귀를 먼저 추가한 `compiler:testCompile`은 없는 `ZapCampaign`과 생성자 계약 때문에 실패했다. GREEN: 분리 후 독립 5 + 기존 MCP 41 + 정의 parser 1, 총 47 tests가 실패·오류·skip 없이 통과했다.

### 최종 검증

- Homebrew JDK 21.0.12·Maven 3.9.16, `mvn clean verify` 2회 모두 성공. 각 회차 Java **389 tests**, failure/error/skip 0; React **37 files / 266 tests**, typecheck·Vite build·최종 JAR 검사를 통과했다. 두 번째는 MCP 참조의 volatile 게시를 반영한 최종 입력으로 실행했고 59.595초가 걸렸다. 두 회차는 소스가 달라 재현 해시 비교로 사용하지 않는다.
- 이동한 ZAP 메서드 본문 1,427줄을 원본과 비교해 접근 수식자와 dataset-lock callback 치환 외 변경이 없음을 확인했다. 산출물의 `ZapCampaign` 및 내부 클래스에 `jdeps -filter:none`을 적용해 MCP 서버·토큰·HTTP 리스너 타입 참조가 없음을 확인했다.
- 미출시 최종 작업트리 산출물 `target/flowscope-1.2.0-beta.44.jar`: 31,686,464 bytes, SHA-256 `caad2cc831d58fe3c5d6e4ef880ccf0f6de28676f58be1c554b396c626daba2d`. 기존 beta.44 릴리스 해시를 대체하거나 교차 머신 재현을 주장하지 않는다.
- jsdom canvas 미구현 알림, Vite 큰 chunk 안내, 기존 deprecated API와 XXE 거부 테스트 stderr가 남아 있다. 이번 검증은 실제 ZAP 브라우저·로그인·Burp 재로드 검증이 아니다.

### 남은 한계·다음 gate

- Judge·MCP는 아직 삭제하지 않았다. 다음 단계는 과거 프로젝트 판정 호환을 정한 뒤 Judge 실행·UI·잠금 제거, 공용 타입·실행 원장 분리, MCP transport 제거 순이다. 새 Explorer 하네스는 이후 별도 설계한다.
- 현재 ZAP 흐름은 여전히 Traditional → Client → AJAX → Passive다. 사용자 결정인 Client 필수·AJAX 제거는 다음 동작 변경에서 적용한다.
- 실제 Burp 재로드·ZAP Client 브라우저·upstream·로그인 계정 lane·취소 검증은 미실행이다. 자동 회귀가 실제 크롤링이나 탐지 효능을 증명하지 않는다.
