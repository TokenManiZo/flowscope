# FlowScope 팀 인계 정본

최종 갱신: 2026-09-11 D-140~142 자동 회귀와 패키지 Standalone E2E 완료, 운영 gate 대기. 새 진단 시작 시 기존 화면을 삭제하는 대신 현재 상태를 `~/.flowscope/projects/<진단명--scope--시각>/project.flowscope.db`에 먼저 저장하고 새 exact scope의 빈 프로젝트로 전환한다. React 상단 프로젝트 선택기·저장 상태·새 진단 대화상자와 Surface→Evidence/Request Lab/Repeater를 실제 API에 연결하고 삭제형 `/api/clear`는 거부한다. Standalone도 격리된 SQLite workspace로 같은 프로젝트 API를 검증하며 Explorer 사용 불가는 500이 아닌 명시적 상태로 표시한다. JDK 21 전체 verify 2회가 React 250·Java 407 tests와 최종 JAR gate를 통과했고, clean JAR의 Chromium E2E 8/8이 통과했다. 실제 Burp 재로드·프로젝트 재열기·최종 ZAP/Explorer 운영 검증 전이므로 릴리스 완료로 간주하지 않는다. 구현·회귀·문서는 한 작업 단위로 묶되 push·Release는 하지 않는다. 이 문서는 **현재 진행상황과 다음 gate**만 기록한다. 예전 실행법·상세 연혁·리뷰 원문은 [2026-09-04 인계 보존본](handoff-2026-09-04.md)으로 분리했다.

## 1. 현재 인수인계 상태·목표·범위

FlowScope는 허가된 범위에서 실제 HTTP 관측과 OpenAPI·HTML·JavaScript 선언을 endpoint·parameter로 정렬해, 진단자가 어느 입력을 아직 보지 못했는지 원 Evidence와 함께 확인하는 Burp 확장이다. 선택 API의 신원·접근 대상 ID·소유자·역할 비교는 인가 상세층이다. 미관측·gap·2xx만으로 취약점을 확정하지 않는다.

- **현재 실행:** HUMAN 수집/명시적 Request Lab, ZAP Browser Based Authentication 기반 독립 캠페인, 판정 없는 독립 Codex Explorer.
- **보존 데이터:** HUMAN·SCANNER·LLM source, 기존 Evidence·계정 메타데이터·정책·완료 run·실행 원장·사람 검토.
- **제거 유지:** 기존 Judge, 옛 Explorer 실행기, MCP transport/토큰/리스너, 후속 Judge 세션, 격리 브라우저, agent-workspace 설정·프롬프트·디렉터리. 옛 실행 API는 404이며 성공 stub이 아니다.
- **과거 LLM:** `LegacyAssessment`·`ValidationDecision`은 저장 호환용 읽기 전용 기록이다. 현재 규칙 후보의 결론으로 합치지 않는다.
- **새 Explorer:** `ExplorerCoordinator`가 메모리 계정 인증과 로그인된 Codex app-server를 연결한다. HTTP 도구는 exact-scope Burp Montoya 전송과 실제 LLM Observation Evidence를 만들고, 선언 도구는 같은 run의 응답 Evidence에서 직접 읽은 endpoint·parameter만 `LLM_ARTIFACT_ANALYSIS` Declaration으로 저장한다. MCP·Judge·브라우저는 없다.
- **미착수:** FlowScope Evidence·분석용 제품 MCP. 새 Explorer와 무관하며 지금 만들지 않는다.
- **ZAP beta.46 작업:** 비로그인 또는 별도 메모리 로그인 계정마다 이름 없는 temporary ZAP session/Context를 만들고 `인증 → chrome-headless strict Client → Passive → Alert`를 실행한다. 모든 lane은 bundle의 FlowScope Docker Chromium runtime만 사용한다. D-132 이후 Traditional/AJAX를, D-134 이후 ZAP 2.17 REST에 없는 verification component를 호출하지 않는다.

사용자 전역 모델 설정·인증 파일, 사용 중인 Burp/ZAP, 다른 Claude worktree와 서드파티 패키지 내부 MCP 파일은 제거 대상이 아니었다. 구버전 확장이 실제로 실행 중이라면 새 소스의 삭제 사실만으로 그 프로세스·포트까지 종료됐다고 판단하지 않는다.

## 2. 진행상황

2026-09-11 D-142: 패키지 Standalone에서 React의 **새 진단 시작**이 501, Explorer 상태 조회가 500이던 실제 E2E 회귀를 수정했다. Standalone이 격리 가능한 `ProjectWorkspace`·SQLite를 사용해 프로젝트 생성·저장·전환·재열기를 수행하고, 샘플 저장 전 header를 마스킹하며, 실행할 수 없는 Explorer 상태를 명시적으로 반환한다. E2E는 삭제된 초기화/Judge 계약 대신 보존형 프로젝트와 독립 Explorer 계약을 검사한다. 현행 그래프 코드가 단일 `IDENTITY / ENDPOINT / OBJECT` canvas와 `18개 / 전체` 전환임을 다시 대조해, 구현되지 않은 사이트/API drill-down·resource family·증분 `+18` 주장을 현행 문서에서 후속 작업으로 분리했다. JDK 21 전체 verify 2회는 React 250·Java 407 tests, clean JAR Chromium E2E는 8/8을 통과했다.

2026-09-10 D-140~141: 기존 `/api/clear`와 scope 교체가 메모리 Evidence를 잃을 수 있던 경로를 보존 후 전환하는 프로젝트 workspace로 교체했다. 저장·검증 실패 시 현재 진단을 유지하고, 새 프로젝트는 디스크에 빈 DB를 만든 뒤에만 메모리 상태를 전환한다. 분석 revision과 데이터셋 교체 revision을 분리해 Request Lab 초안 수명을 바로잡고, Surface Observation에서 exact Evidence·Request Lab·Repeater로 이동하게 했다. 반복 import는 fingerprint·lane account·run을 병합 키에 포함하며 XML/HAR가 같은 multiset 억제를 사용한다. EUC-KR와 XML/HAR IPv6 회귀를 추가했다. 집중 Java 65개, React 250개와 JDK 21 전체 verify 2회(Java 405개, opt-in 2 skip)가 통과했다. 실제 Burp 프로젝트/Request Lab 운영 gate는 남았다.

2026-09-09 D-139: 실제 Explorer run이 HTTP Evidence는 남겼지만 번들에서 찾은 API·입력을 자유서술 요약에만 두어 Surface에 연결하지 못했고, 모델 요약의 요청/endpoint 개수도 저장된 Evidence와 일치하지 않았다. `flowscope_record_discoveries` dynamic tool과 Evidence-bound 선언 모델을 추가해 endpoint·값 없는 parameter·locator/reason을 기존 RouteCandidate/Surface/프로젝트 경로에 연결했다. current-run Evidence가 없거나 scope 밖·알 수 없는 필드·인증 header·상한 초과인 선언은 거부한다. Explorer가 보낸 OPTIONS는 probe로 분리하되 일반 HUMAN OPTIONS와 산출물에 선언된 OPTIONS API는 보존한다. 실제 로그인된 Codex app-server가 HTTP 도구 뒤 선언 도구를 호출하는 opt-in 하네스가 통과했고, 최종 전체 verify 2회도 React 248·Java 388 tests와 byte-identical JAR을 확인했다. 실제 Burp 리얼 대상 완주는 별도 gate다.

2026-09-09 D-138: D-137 JAR을 실제 Burp에 로드한 macOS 환경에서 `127.0.0.1:8089` ZAP 2.17.0 상태를 10회 연속 확인했고, 새 비로그인 캠페인 `zap-baseline-1788925829413`이 59초 만에 `ALERTS_READY`로 완료됐다. SCANNER 14건, Client 14건, Alert 29건, capability 거부 0건, Passive 잔여 0건이었다. 실행 도중 단 한 번의 상태 probe 실패도 곧바로 `UNREACHABLE`와 helper 재실행 안내로 확정하는 UI/API 판정 결함을 확인했다. 일반 통신 실패 1·2회는 `RETRYING`, 3회 연속 실패부터 `UNREACHABLE`, API key 401/403은 즉시 `AUTH_FAILED`가 되도록 회귀와 코드를 추가했다. 최종 D-138 JAR을 실제 Burp에 재로드해 `RETRYING` 표시 자체를 확인하는 gate는 남는다.

2026-09-09 D-137: 실제 Burp 수집 순서를 대조해, 원시 로그인 응답 추가 뒤 분석 snapshot 게시가 지연되는 동안 D-136 인증 gate가 정상 로그인을 실패 처리할 수 있음을 회귀로 재현했다. 인증 전용 읽기를 현재 run·계정의 동기화된 원시 `ZAP_AUTHENTICATION` 기록으로 분리했고, 빈 분석 snapshot 상태에서도 복수 계정 캠페인 회귀가 통과했다. 별도 실물 ZAP 2.17/Chromium 하네스도 익명·정상 계정 2개 완료(65 requests)와 오류 비밀번호의 Client 전 차단을 재확인했다. 새 JAR의 실제 Burp 재로드/8081/UI와 Windows gate는 남았다.

2026-09-09 후속 실물 검증: 사용자 8089 ZAP을 건드리지 않고 별도 Compose project(API 18889, 기록 프록시 18881, 합성 exact-scope target)에서 공식 ZAP 2.17 base의 Chromium/ChromeDriver, Authentication Helper 0.41.0, Client 0.30.0으로 익명 → alice → bob lane을 완주했다. 두 로그인 계정은 각각 `/api/me`에서 자기 사용자 응답을 받았고 다른 계정 세션 혼입은 0건이었다. 이어 같은 사용자명과 틀린 비밀번호는 `ZAP_AUTHENTICATION` 실패 응답이 로그인 성공 정규식과 불일치해 Client Spider 시작 전에 차단됐다. 이 과정에서 ZAP action `OK`와 `lastSuccessfulAuthTimeInMs`만 사용하면 틀린 비밀번호도 통과하는 결함을 실증해 해당 fallback을 폐기했다. 현재 코드는 같은 run·`laneAccountId`의 실제 인증 응답 Evidence를 필수 성공 정규식과 선택적 로그아웃 정규식으로 확인한다. 실제 Burp beta.46 JAR 재로드와 Windows 실기기는 계속 별도 gate다.

2026-09-09 진행 중: geckodriver/noexec 실패 경로를 폐기하고 digest 고정 ZAP 2.17 base에 Chromium과 같은 Debian 저장소의 ChromeDriver를 설치하는 FlowScope 이미지를 추가했다. 시작 전 두 실행 파일·동일 주 버전·실제 headless 기동을 확인하고, 비로그인·로그인 모두 `chrome-headless`를 명시한다. 실제 컨테이너에서 Chromium/ChromeDriver `152.0.7977.82`, doctor 실패·경고 0건, exact Context Client HTTP 200 수집 1건과 status 100을 확인했다. beta.46 JAR의 실제 Burp 재로드·로그인/복수 계정은 아직 확인하지 않았다.

| 작업 | 현재 상태 | 근거 / 남은 확인 |
|---|---|---|
| ZAP 캠페인 분리 | 구현 완료 | `5a47af9`, 호스트 소유 `ZapCampaign`, Web 직접 호출 |
| 기존 Judge·하네스 MCP 제거 | 구현·자동 회귀 완료 | `57d1bb4`, 클래스/JAR 부재·폐기 route 404 |
| 과거 프로젝트 호환 | 구현·자동 회귀 완료 | JSON v4 / SQLite v3, 원 Evidence ID·과거 평가 분리 |
| 빈 agent-workspace 정리 | 완료 | `962edfe`, 정확한 빈 디렉터리만 제거 |
| 문서 현행화 | 2026-09-11 D-142 계약 갱신 | [전수 목록·확인 범위](documentation-status.md); Standalone 프로젝트 API와 현행 단일 3-lane 그래프를 완료 기능·후속 graph 설계와 구분 |
| 독립 LLM Explorer | D-139 구현·집중/provider·전체 자동 검증 완료, Burp gate 대기 | 메모리 인증, exact-scope HTTP Observation, Evidence-bound endpoint/parameter Declaration, 서버 중복 제거·집계, React 작업 피드 |
| 다운로드 bundle·기능별 doctor | 구현·자동/추출 검증 완료 | JAR+ZAP helper+문서 ZIP, `human/zap/explorer/full`, Explorer 재확인; Windows 실기기 대기 |
| ZAP 직접 브라우저 인증 | 별도 실물 하네스에서 정상 2계정·오류 비밀번호 차단 통과, 실제 Burp·Windows gate 대기 | 메모리 `ZapAccountVault`, 필수 성공/선택적 로그아웃 정규식, 같은 run·계정의 `ZAP_AUTHENTICATION` Evidence, Chrome Headless, Context/user 지정 Client, 임시 user/Context 정리 |
| React ZAP 기능 보존 | 구현·집중 회귀 완료 | target별 로그인 계정, 로그인/단계/경과 상태, 명세 정의 입력, 취소 복구 |
| 새 JAR 실제 Burp/ZAP 검증 | D-137 JAR 익명 lane 완료, D-138 재로드 대기 | 실제 Burp 8081 익명 Client 14건·Alert 29건·거부 0건; 로그인 2계정·Windows·D-138 표시 gate는 남음 |
| Client 단일 crawler | 코드·전체 자동 회귀·직접 실물 Client 완료 | 관리 Docker `chrome-headless`로 exact Context HTTP 200 수집. capability/로그인·취소·0건 실패의 beta.46 Burp 8081 gate는 남음 |
| Docker Chromium runtime | 구현·실물 preflight 완료 | Chromium/ChromeDriver `152.0.7977.82`, 실제 headless launch, tmpfs home, doctor 0 failure/0 warning, 임의 runtime 차단 |
| ZAP Docker API 경계 | 실물 daemon/API gate 완료 | 임시 8090에서 bridge gateway allowlist, exact form POST, tmpfs session, Replacer session 유지 확인. target/8081은 미검증 |
| ZAP verification REST 호환 | 결함 재현·코드/집중 회귀 수정 | 실물 2.17의 `/JSON/verification/...` 400 `no_implementor` 확인. 지원되지 않는 호출 제거; 수정 JAR 실제 로그인 재실행 대기 |
| 제품 MCP | 미착수 | Explorer 하네스가 아니며 현재 리스너·토큰·도구 없음 |
| 독립 corpus·외부 pilot | 미실행 | 내부 fixture는 구조 회귀일 뿐 발견률·오탐률 입증 아님 |

## 3. 검증과 배포 상태

[beta-validation의 D-130~138 기록](beta-validation.md)이 현재 ZAP 작업의 자동·실물 검증 정본이며, D-129는 배포 작업, D-128과 D-139는 Explorer 구현·provider 검증의 정본이다.

- 같은 최종 D-128 입력에서 `mvn clean verify` 2회: 매회 Java 350 tests(일반 suite의 opt-in provider 1 skip), React 38 files / 241 tests 통과. JAR SHA-256과 크기가 동일했다.
- D-129 작업에서 `mvn clean verify` 2회: 매회 Java 352 tests(일반 suite의 opt-in provider 1 skip), React 38 files / 242 tests 통과. 반복 package의 JAR/bundle 동일성과 clone 없는 clean extraction을 확인했다.
- D-130~133 최종 입력에서 `mvn clean verify` 2회: 매회 Java 370 tests(실패·오류 0, 일반 suite의 opt-in provider 1 skip), React 38 files / 247 tests와 release JAR/bundle 생성 통과. 두 JAR·bundle의 SHA-256은 각각 동일했고 최종 JAR SHA-256은 `78868e06a2af099df26e5cbc9254daf42bacc791bdee8aaa1c321e940612cb24`다.
- D-135 최종 입력에서 JDK 21 `mvn clean verify` 1회: Java 375 tests(실패·오류 0, opt-in provider 1 skip), React 38 files / 247 tests와 release gate 통과. beta.46 JAR은 31,649,129 bytes, 9,140 entries, SHA-256 `d03c5a602f8c06f3e345468f1b69adb5557b6b3cfc04fd500a04e8dec87ca8c3`이다. FlowScope Docker에서 Chromium/ChromeDriver `152.0.7977.82`, doctor 0/0, 실제 strict Client HTTP 200 수집 1건을 별도로 확인했다.
- D-136 최종 입력에서 JDK 21 `mvn clean verify` 1회: Java 381 tests(실패·오류 0, opt-in 실물 하네스 2 skip), React 38 files / 247 tests와 release gate 통과. beta.46 JAR은 31,651,530 bytes, 9,140 entries, SHA-256 `8708565ff18c04bbe94af26cce7c6da37cb732ea47fcedd9e78888ffbbd53b44`이다. 별도 실물 ZAP 하네스는 익명·정상 2계정과 오류 비밀번호의 Client 전 차단을 확인했다.
- D-137 최종 입력에서 JDK 21 `mvn clean verify` 1회: Java 381 tests(실패·오류 0, opt-in 실물/provider 하네스 2 skip), React 38 files / 247 tests와 release gate 통과. beta.46 JAR은 31,652,617 bytes, 9,140 entries, SHA-256 `50993c1b2526a58ff8fd29f8f8eb488b0bf83f645c3553d4ec7fc968052891e0`이다. 실물 ZAP 하네스는 익명·정상 2계정과 오류 비밀번호 차단을 다시 확인했다.
- D-138 JDK 21 전체 성공 실행은 매회 Java 383 tests(실패·오류 0, opt-in 실물/provider 하네스 2 skip), React 38 files / 247 tests와 release gate를 통과했다. 성공한 beta.46 JAR은 31,653,652 bytes, 9,141 entries, SHA-256 `8481edf973e226d1cd21c8862364542a7d572b9ba56af1bf12eb8915b5ff8c3a`로 동일하다. 반복 중 기존 React 테스트 2개의 5초 timeout 실패가 한 번 있었으나 단독 22/22와 다음 전체 247/247은 통과했다. 테스트 시간 변동성과 최종 Burp reload는 대기한다.
- D-139 최종 코드에서 JDK 21 `mvn clean verify` 2회: 매회 Java 388 tests(실패·오류 0, opt-in 실물/provider 하네스 2 skip), React 38 files / 248 tests와 release gate 통과. beta.46 JAR은 31,669,404 bytes, 9,143 entries, SHA-256 `d00bcb35e36eb5e60e843e8d1a3bf8d425b4e35c9a32ade700780cbd8f949cf6`로 동일하다.
- D-140~142 최종 입력에서 JDK 21 `mvn clean verify` 2회: 매회 Java 407 tests(실패·오류 0, opt-in 실물/provider 하네스 2 skip), React 38 files / 250 tests와 release JAR/bundle gate 통과. clean fat JAR을 새 임시 project workspace로 기동한 Chromium E2E 8/8도 통과했다. 이 검증은 Standalone Web·SQLite·React 계약이며 실제 Burp/ZAP/Codex 실행이 아니다.
- 별도 opt-in 실제 Codex app-server 하네스가 dynamic HTTP tool로 응답 Evidence를 만든 뒤 그 ID로 구조화 선언 도구를 호출하는 경로를 확인했다. 이는 Burp Montoya/실제 대상 전체 실행이 아니다.
- D-126 당시 Chromium E2E는 과거 UI 기준 기록이다. D-142에서 현재 clean JAR 기준 E2E 8/8을 새로 실행했지만, 이를 실제 Burp gate로 재사용하지 않는다.
- 작업트리 버전 문자열은 `1.2.0-beta.46`이다. D-139 전체 자동 검증과 JAR 식별값은 위와 같이 확정했으며 push·Release는 하지 않았다.
- 실제 Burp load와 ZAP 비로그인 lane은 D-137 JAR에서 확인했다. unload/reload, HUMAN 로그인/캡처, ZAP 복수 로그인 lane, Request Lab 실제 전송, Windows 운영 검증과 최종 D-138 상태 표시는 새 JAR 기준 미실행이다.

## 4. 현재 구조와 코드 위치

| 기능 | 구현 위치 | 현재 책임 |
|---|---|---|
| Burp 수집·호스트 수명 | [FlowScopeExtension](../../src/main/java/io/flowscope/burp/FlowScopeExtension.java) | scope/run/계정 문맥, capture, Web·ZAP 소유 |
| ZAP 실행·상태·취소 | [ZapCampaign](../../src/main/java/io/flowscope/integration/ZapCampaign.java), [ZapClient](../../src/main/java/io/flowscope/integration/ZapClient.java) | MCP 없는 캠페인, 신원 격리·capability·Browser Based Authentication·계정 crawler·정리 |
| ZAP 계정 | [ZapAccountVault](../../src/main/java/io/flowscope/integration/ZapAccountVault.java), [ZapBrowserAuthenticator](../../src/main/java/io/flowscope/integration/ZapBrowserAuthenticator.java) | 자격증명 메모리 수명, 명시적 로그인 성공, 안전한 계정 메타데이터 |
| HUMAN 세션 | [SessionBroker](../../src/main/java/io/flowscope/integration/SessionBroker.java) | 명시적 HUMAN 캡처와 Request Lab 인증정보 재사용. ZAP 계정 lane에는 사용하지 않음 |
| LLM Explorer | [ExplorerCoordinator](../../src/main/java/io/flowscope/explorer/ExplorerCoordinator.java), [CodexAppServerProvider](../../src/main/java/io/flowscope/explorer/CodexAppServerProvider.java), [ExplorerHttpGateway](../../src/main/java/io/flowscope/explorer/ExplorerHttpGateway.java), [ExplorerAccountVault](../../src/main/java/io/flowscope/explorer/ExplorerAccountVault.java) | Codex 수명, 메모리 인증, exact-scope HTTP Observation, Evidence-bound 선언, 서버 집계, 상태·취소·Evidence 완료 gate |
| 분석·표면 | [Pipeline](../../src/main/java/io/flowscope/core/Pipeline.java), [SurfaceAnalyzer](../../src/main/java/io/flowscope/core/SurfaceAnalyzer.java), [RouteCandidateExtractor](../../src/main/java/io/flowscope/core/RouteCandidateExtractor.java) | 관측/선언/probe 분리, 정규화·분류·인가 후보 |
| Web·UI | [FlowScopeWebServer](../../src/main/java/io/flowscope/web/FlowScopeWebServer.java), [SnapshotJsonWriter](../../src/main/java/io/flowscope/web/SnapshotJsonWriter.java), [React](../../frontend/src) | 기본 Surface, 선택 인가 상세, 현재 규칙·사람 검토, 과거 이력 |
| 프로젝트·저장 | [ProjectWorkspace](../../src/main/java/io/flowscope/integration/ProjectWorkspace.java), [ProjectStore](../../src/main/java/io/flowscope/integration/ProjectStore.java), [SqliteProjectStore](../../src/main/java/io/flowscope/integration/SqliteProjectStore.java) | 보존 후 전환, 마스킹 데이터·schema 호환, raw 세션 비저장 |

빠른 시작은 `범위 → HUMAN → ZAP → Explorer → H/S/L Evidence 검토`다. Explorer는 별도 화면에서 시작하며 취약점 판정은 하지 않는다. 설치는 [시작 가이드](getting-started.md), 실행 계약은 [LLM Explorer](llm-explorer.md), 데이터 계약은 [아키텍처](architecture.md)와 [Surface](endpoint-parameter-surface.md)를 따른다.

## 5. 미해결 결함·실환경 gate

### D-127에서 발견한 대형 응답 연결 결함의 처리

D-128은 발견용 HTML/JavaScript/JSON/XML 응답을 기본 4MiB까지 `FULL` payload로 보존하게 바꿨다. `body/respText`는 8,192자 UI preview로 유지하지만 `RequestRecord.responseBodyForAnalysis()`가 payload 전문을 우선 읽으므로 RouteCandidate/Surface 분석까지 전달된다. 1.4MiB JavaScript의 뒤쪽 call-site를 포함한 capture→record 회귀가 통과했다.

- 자동 회귀로 닫힌 범위: 4MiB 이하 발견용 textual 응답의 capture·마스킹·payload 보존·분석문 전달.
- 아직 열린 범위: 4MiB 초과 응답, superagent·임의 wrapper와 일반 함수 간 URL 조립, 런타임에서만 받은 lazy chunk. parser 크기 상한을 높여도 의미 해석 문제는 해결되지 않는다.
- 실제 Burp에서 대형 번들을 받아 endpoint/parameter를 추출하는 운영 gate와 독립 corpus 효능 측정은 아직 실행하지 않았다.

### 실환경 gate 및 이전 리뷰에서 이어받은 항목

- ZAP 시작 API 반환과 취소가 겹치는 race: 현재 취소 회귀는 scan ID 등록 후 상태 polling 중인 경우다. 모든 시작/취소 타이밍의 정리를 증명하지 않는다.
- FlowScope Docker 이미지에서 Chromium/ChromeDriver 동일 주 버전과 실제 headless 기동, `authhelper`·`client`·`selenium` add-on, 비로그인 strict Client HTTP 200 수집을 확인했다. beta.46 JAR의 Browser Based Authentication 성공, Client capability 전달, 복수 계정 세션 격리, 다중 scope, 취소 후 Client 정지는 mock이나 직접 ZAP API가 아닌 Burp 8081 capture 환경으로 다시 확인해야 한다.
- CAPTCHA·MFA·WebAuthn·복합 SSO는 자동 로그인의 지원 범위로 주장하지 않는다. 인증 응답 Evidence가 필수 로그인 성공 정규식과 일치하지 않으면 계정 lane을 실패 처리한다.
- SessionBroker ACTIVE 의미·보조 쿠키 회전, 지문/계정 바인딩, owner 별칭은 계속 재검증 대기다. history/import 병합 키, 보존형 프로젝트 전환, XML 명시 문자셋과 XML/HAR IPv6는 D-140~141 자동 회귀를 통과했지만 실제 Burp 프로젝트 재열기·legacy/binary XML 운영 검증은 남는다. [이전 결함 목록](handoff-2026-09-04.md)의 나머지는 코드와 항목별 재대조해야 한다.
- 제거한 LLM 프로세스 종료·Judge 동작은 현행 실행 gate에서 제외한다. 다만 과거 데이터 호환과 읽기 전용 표시 검사는 유지한다.
- 외부 pilot·전체 발견률·오탐/미탐률·성능 우월성은 미측정이다. 합성 테스트 통과로 수치나 완성률을 만들지 않는다.

## 6. 다음 작업·제품 결정 보류 사항과 완료 기준

1. **프로젝트·Evidence 운영 gate** → 최종 JAR을 실제 Burp에 재로드해 수집→자동 저장→새 진단→이전 프로젝트 재열기, 저장 실패 시 현재 데이터 유지, Surface→Request Lab/Repeater와 HUMAN VALIDATION 귀속을 확인한다.
2. **Explorer 신원 회귀** → LLM 계정 선택→인증 준비→forced account/lane 귀속→프로젝트 재열기를 통합 테스트로 먼저 고정한다. 실패하면 구현을 추측 수정하지 않고 경계를 다시 판정한다.
3. **그래프 정보계층 구현** → Surface를 사이트/API 개요로 유지하고, Graph는 기본 Identity→API, API 선택 뒤 resource family, family 선택 뒤 instance로 단계화한다. 노드는 실제 `+18` 증분과 남은 수를 표시하고, desktop 내비는 아이콘만이 아니라 라벨을 기본 제공한다. Fact Core와 판정 key는 바꾸지 않는다.
4. **ZAP 실물 운영 gate** → 같은 JAR과 FlowScope Docker Chromium에서 비로그인과 로그인 계정 최소 2개를 실행해 로그인 성공/실패, SCANNER+laneAccountId 귀속, 쿠키 격리, strict Client capture와 0건 실패, Passive/Alert, 정의 import, 취소와 임시 user/Context 정리를 확인한다.
5. **Release 게시 전 운영 gate** → Windows PowerShell 실기기에서 bundle/doctor/ZAP helper와 프로젝트 경로를 확인하고, Explorer anonymous·HTML form·JSON token, exact-scope, Evidence·선언 귀속, 큰 번들 단일 수집, OPTIONS probe 분리, steer·취소 정리를 확인한다.
6. **독립 평가** → 승인된 범위와 독립 truth를 확보해 HUMAN·ZAP 대비 추가 endpoint/parameter, 중복·노이즈·요청량·검토시간을 측정한다. 자동 회귀만으로 우월성을 주장하지 않는다.

## 7. 문서와 협업 운영

- 작업 시작 시 이 문서의 현재 상태·열린 항목, [제품 계획](product-development-plan.md), [개발 기록](development-log.md), [실제 검증](beta-validation.md)을 먼저 읽는다.
- 시작·중간 결과·검증·인계 시점마다 상태가 달라지면 같은 작업 단위에서 문서를 갱신한다. `구현 완료`, `자동 회귀 통과`, `실환경 통과`, `미착수`, `보류`를 분리한다.
- 파일별 정본·역사 여부·갱신 기준은 [문서 정합성·갱신 기준](documentation-status.md)에 있다. 구현 판단은 코드, 검증 주장은 명명된 artifact의 실행 기록을 근거로 쓴다.
- 사용자 요청: 진단자 편의, 일반적인 HTTP/선언 구조, 노이즈 최소화와 Evidence 보존을 우선한다. 모르는 것은 미확인으로 남기고, 모의 API 성공을 실물 성공으로 보고하지 않는다.
- 비공개 `mentor-progress-report.md`는 수정·커밋하지 않는다. 별도 Claude worktree·사용자 전역 설정은 이 작업의 정리 대상이 아니다. 루트 `CLAUDE.md`의 기존 사용자 인계 지침을 보존하면서 현재 실행 범위를 갱신한다.
