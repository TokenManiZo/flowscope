# FlowScope 1.2.0-beta.48 사전 벤치마크 검증 기록

## 2026-09-12 · D-153 SQLite 연결 수정 검증

- beta.47 배포 JAR에서 호스트 DriverManager 선행 초기화→격리 확장 SqliteProjectStore.save 경로가 `No suitable driver found`로 실패했다. 명시적 드라이버 초기화 대조군은 저장·재열기가 성공했다.
- 새 독립 JVM 회귀가 같은 원인으로 RED. 직접 SQLite 연결 수정 뒤 집중 SqliteClassLoaderIsolationTest 2 + SqliteProjectStoreTest 3 + FlowScopeExtensionLifecycleTest 7 = 12/12 통과했다. Evidence ID는 정본 EvidenceIds로 생성해 보존을 확인한다.
- JDK 21.0.12.1·Maven 3.9.16 `mvn -o clean verify`: Java 575(실패·오류 0, opt-in 2 skip), React 59파일/472건·typecheck·fat JAR/bundle guard 통과. 최초 sandbox 실행은 npm ci에서 진행하지 않아 중단했고, 네트워크/로컬 테스트 서버 허용 실행은 1분 12초에 성공했다.
- beta.48 JAR의 Standalone(별도 17848/임시 프로젝트) Playwright `--retries=0`: 15/15, 29.0초. JAR 31,942,036 bytes, SHA-256 `6405e78207d0d729946aee38518678c22bdef58005fac2e5899585f651f16bfa`. bundle은 최종 문서 반영 뒤 재조립하며 자기 hash를 내부 문서에 기록하지 않는다.
- 최종 커밋 `36a5020`에서 두 번째 `mvn -o clean verify`도 같은 수치로 성공(1분 14초), JAR SHA-256 동일. 최종 JAR의 독립 JVM 저장·재열기 probe, 설치 ZIP CRC와 내부 JAR 바이트 일치도 통과했다.
- [PR #16 CI 34697738243](https://github.com/choewonwoo1817/testflowscope/actions/runs/34697738243): 전체 build·JAR/ZIP 검사·동일 러너 반복 해시·Bash/Windows 구문 검사 통과(verify 9분 2초). 후속 문서 커밋 `7810f46`의 [CI 34698310197](https://github.com/choewonwoo1817/testflowscope/actions/runs/34698310197)도 같은 검사 통과(verify 8분 8초). 사용자는 이번 PR의 관리자 예외 병합과 main·Release 게시를 명시적으로 승인했다. 최종 main CI·태그·업로드 자산 식별은 [beta.48 Release](https://github.com/choewonwoo1817/testflowscope/releases/tag/v1.2.0-beta.48) 기록을 따른다.
- 설치된 Burp 번들 Java의 별도 probe는 60초 이상 출력 없이 OS 대기 상태였다. 임시 PID를 재확인해 TERM/KILL을 보냈지만 마지막 확인에서도 남아 있었으며 성공/종료 완료로 기록하지 않는다. 실제 사용자 Burp 새 JAR 재로드·Windows 실기기·ZAP/Explorer 실물 재실행은 미실행이다. 아래 beta.47 결과를 beta.48 실물 결과로 합산하지 않는다.

## 2026-09-13 · crAPI 실측 현장 검증(D-155)

| 검사 | 실제 결과 |
|---|---|
| 대상 | OWASP crAPI 로컬 스택(Docker, `http://localhost:8888`). 두 계정(alice/bob) 가입·로그인·차량 등록·자기 리소스 조회를 Burp 프록시(8080) 경유로 실행. 교차 접근은 수행하지 않음. |
| 핵심 엔진 | HUMAN 탐색 run 안에서 인증 API가 INCLUDE되고 신원이 JWT에서 자동 해석됨. 교차 접근 없이 `GET /identity/api/v2/vehicle/{id}` 차량 위치의 BOLA/IDOR 후보 2건(User A↔User B)과 `AUTH_VARIANT_UNTESTED` gap 생성 확인. |
| 온보딩 실측 | run 밖 브라우징은 인증 API 36건이 전부 `HUMAN_OUTSIDE_EXPLORATION_RUN`으로 제외(D-071). 최소 경로는 계정·세션 캡처 없이 `HUMAN 탐색 begin→browse→end` 2동작·신원 자동 해석. |
| ZAP | Burp에 8081 listener가 없어 Client Spider 수집 0건으로 실패 재현. listener 추가 후 naver 대상에서 13건 수집 성공. |
| D-155 회귀 | `SnapshotTrafficStatsTest` 2, `TrafficClassifierTest` 18, React `RunGapHint`·`ParameterMapPage` 통합, typecheck 통과. 전체 `mvn -o clean verify`와 crAPI 재빌드 재로드는 이어서 수행. |
| 미실행 | role 지정 기반 BFLA, 대규모 실대상 성능, crAPI 재빌드 JAR의 실제 Burp 재로드. |


## 2026-09-12 · D-154 PR 원본 의미 복원 검증(미출시 브랜치)

| 검사 | 실제 결과 |
|---|---|
| 집중 회귀 | `SurfaceAuthorizationLinkTest` 24건·`SurfaceParameterProfileTest` 18건 통과. 새 테스트는 단일 동시출현 INFERRED→`HUMAN_REVIEW_REQUIRED`, 독립 2건 CORROBORATED+확정 소유자→`CONFIRMED_AUTH_BOUNDARY`·`CORROBORATED_EVIDENCE`를 검사한다. Vitest `requestDiff`·`ParameterRequestDiff`·`ParameterMapPage` 3파일 32건 통과. |
| 전체 빌드 | JDK 21.0.12.1 `mvn -o clean verify` BUILD SUCCESS(1분 13초). Java 574건, 실패·오류 0, opt-in 2 skip. React 59파일/472건·typecheck, JAR/bundle release guard 통과. `SampleProjectTest` 골든 fixture 일치(sample에 CORROBORATED link 없음). |
| 패키지 브라우저 | 실행 중인 Burp가 17777을 점유해 같은 JAR의 standalone 서버를 17797·임시 projects dir로 띄우고 `FLOWSCOPE_E2E_ORIGIN`으로 Playwright `--retries=0` 15/15 통과(29.7s). |
| 산출물 | JAR 31,942,089 bytes, SHA-256 `1a4dcdaef4ebe513f7153477e7d6bfaa15f83cadb648824d0715134b2fb936e0`. bundle은 이 검증 기록 이전 문서로 조립됐으며 main 반영 시 재조립한다. |
| 미실행 | 실제 Burp·Windows·외부 대상. 같은 날 실제 Burp에서 범위 적용 시 `FlowScope SQLite save failed`가 관측됐고(커널 로그 AMFI가 `libsqlitejdbc.dylib` 서명을 거부), 원인 문자열이 기록되지 않는 결함은 별도 항목이다. |

## 2026-09-12 · D-152 beta.47 ZAP 종료·재시작 보정

| 검사 | 실제 결과 |
|---|---|
| 수정 전 재현 | 새 latch 테스트 4건 모두 실패: 정상/실패 결과의 cleanup 전 게시, 취소 시 정리 단계 미표시, 수락된 시작 응답 전 취소로 scan ID 소실. 후속 활성 run 유지 단언도 3건 실패했다. |
| 수정 후 집중 | ZAP 7+16=23건 통과. cleanup 차단 중 RUNNING/CLEANUP·활성 run 유지, terminal 뒤 즉시 재시작, 취소 lane 마감과 반환된 scan ID의 stop을 확인했다. |
| 전체 빌드 | JDK 21 `mvn -o clean verify` BUILD SUCCESS. Java 574, 실패·오류 0, opt-in 2 skip. React 59파일/472건·타입검사와 JAR/bundle release guard 통과. |
| 원격 CI | [PR #13 CI 34693083743](https://github.com/choewonwoo1817/testflowscope/actions/runs/34693083743), 코드 `3f9d107`: verify 9분 10초 성공, 전체 build·JAR/bundle 검사·동일 러너 반복 SHA-256 비교·Bash/Windows 구문 검사 통과. main 병합 `43706f1`과 검증 코드의 파일 내용이 같다. |
| 최종 배포 | 태그/배포 코드 `60a3291`, [main CI 34694001780](https://github.com/choewonwoo1817/testflowscope/actions/runs/34694001780) verify 8분 35초 성공. beta.47 Release 게시 뒤 인증된 GitHub 경로로 ZIP·체크섬을 다운로드해 원본과 바이트 일치·CRC를 확인했다. 비공개 저장소이므로 익명 요청의 404는 접근 조건에 따른 결과다. |
| 패키지 브라우저 | beta.47 JAR의 Standalone Playwright `--retries=0`: 15/15, 30.2초. Graph/Matrix/Evidence/Request Lab·계정·실행 상태·반응형 동선 검사. |
| 실물 ZAP | 사용자 8089와 다른 Compose project `flowscope-beta47-gate`, API 18889, 기록 proxy 18881, 전용 임시 key. Docker Chromium/ChromeDriver 152.0.7977.82. 익명·정상 2계정 Client 63요청 완료 뒤 다음 캠페인의 잘못된 비밀번호 계정은 인증 단계에서 거부됐다. opt-in 1/1, 106.6초, 실패·skip 0. 외부로 전달하지 않는 로컬 fixture다. |
| JAR | 31,942,102 bytes, SHA-256 `80d6e5357b3d73fdcfa274662f5bdfce39d792e3675c24dbbc7b9fa331e38cbe`. bundle은 최종 문서를 넣어 재조립하며 자신의 hash를 내부에 기록하지 않는다. |
| 미실행 | 실제 Burp hook과 Windows/native Linux 실기기, 외부 대상의 효능, 실물 ZAP의 시작 API 응답 유실/timeout. 지연 응답·취소의 결정적 회귀는 mock API로 검증했다. |

## 2026-09-12 · main 배포 CI 첫 실행과 상태 대기 보정

- 원격 [CI 34689208640](https://github.com/choewonwoo1817/testflowscope/actions/runs/34689208640), 소스 `8fe8527`: React 471건, Bash/ShellCheck와 Windows PowerShell 구문 검사 통과. Java 570건 중 실패 2, 오류 0, opt-in 2 skip. 패키지 검사·재현성 단계는 도달하지 않았다.
- 실패는 `cancellingZapBaselineStopsOwnedCrawlerClearsCapabilityAndAbortsRun`의 scan ID 등록 전 취소와 `scannerCampaignResetsZapAndRunsAnonymousThenEachActiveAccount`의 2초 대기 종료 시 아직 세 번째 계정 인증 중인 상태였다.
- 테스트를 scan ID 게시·terminal 상태의 monotonic 최대 10초 대기로 바꿨다. 제품 코드를 변경하거나 실패·정리 단언을 제거하지 않았다. 로컬 JDK 21 집중 `ZapCampaignRegressionTest` 16/16 통과.
- 후속 로컬 전체 `mvn -o clean verify`: 2026-09-12 19:53 KST BUILD SUCCESS, Java 570건(실패·오류 0, opt-in 2 skip), React 59파일·471건·타입검사, JAR/bundle guard 통과.
- 원격 [CI 34689661662](https://github.com/choewonwoo1817/testflowscope/actions/runs/34689661662), 소스 `570d576`: `verify` 8분 22초 성공. 전체 build, JAR·bundle 검사, 동일 러너에서 재빌드한 JAR·bundle 해시 비교와 Bash/ShellCheck·Windows PowerShell 구문 검사가 모두 통과했다. 이는 Windows 실기기에서 Burp/Docker를 실행한 검증은 아니다.

## 2026-09-12 · D-151 전 작업면 snapshot 초안·전송 수명 최종 검증

| 항목 | 실제 결과 |
|---|---|
| 코드 대조 | Evidence·Surface·전체 관계 그래프 외에 판정 매트릭스, 파라미터 커버리지, 기존 권한 매트릭스, 점검 Gap, 시나리오, 흐름 상세가 오류 시 선택을 지우는 경로를 확인했다. `RequestLabDialog`가 `suspended` 전환에서 진행 중 controller를 abort하던 경로도 확인했다. |
| 전체 빌드 | JDK 21.0.12.1, Maven 3.9.16 `mvn -o clean verify` BUILD SUCCESS. Java 570 tests, 실패·오류 0, opt-in 2 skip. React 59 files/471 tests·typecheck, JAR/bundle release guard 통과. |
| 추가 회귀 | 판정 검토 메모·Evidence 상세 보존/잠금/복구, 파라미터·기존 권한 매트릭스 상세 보존, Gap 상세와 연결 Evidence·Request Lab 잠금, 시나리오·흐름 상세 잠금, 진행 중 Request Lab 전송의 non-abort·동일 문맥 결과 1회 반영을 확인했다. |
| PR #11 persistence | 원 9건을 D-151에서 사례별 대조했다. lifecycle·ProjectStore·SQLite로 의미를 옮긴 항목과 D-143에서 제거된 record-level parameter/attached-generation 전제 때문에 그대로 이식하지 않은 항목을 구분했다. 원 테스트와 바이트 동일한 9/9 포팅이라고 주장하지 않는다. |
| 패키지 브라우저 | Node·JDK 21 PATH를 명시한 `npm run e2e -- --retries=0 --reporter=line`: 15/15 passed, 29.2s. sample의 Graph/Matrix/Evidence/Request Lab/계정/ZAP/Explorer/XML과 1920/1280/900/600px 동선을 검사했다. 첫 시도는 npm script가 `env node`를 찾지 못해 제품 서버 시작 전에 종료됐고 성공 결과에 포함하지 않았다. |
| 산출물 | JAR 31,940,963 bytes, SHA-256 `4620fb37d80aaccc7f7c819100594f8bf5aaa56ce34868db51f40cc46d9c1aef`. 최종 문서를 반영해 bundle을 다시 조립하고 ZIP CRC·중첩 JAR 바이트·D-151 HANDOFF/검증/문서 상태 일치를 확인했다. bundle 자기 hash는 내부 문서에 기록하지 않는다. |
| 미실행 | 실제 Burp background 장애 중 전송 완료, Windows/native Linux, 실제 대상 네트워크 단절. 자동 회귀와 Standalone 결과를 이 운영 gate의 통과로 바꾸지 않는다. |

## 2026-09-12 · D-150 PR #11 잔존 계약 최종 검증

| 항목 | 실제 결과 |
|---|---|
| 코드 대조 | `pr11` branch와 `e174a80`을 다시 비교해 operation Evidence page, Masking/model/authorization-work/persistence 회귀, Fat JAR sentinel, raw NUL 누락을 확인했다. 별도 attached parameter 모델은 D-143 Surface 단일 Fact 대체 관계를 유지했다. |
| 전체 빌드 | JDK 21.0.12.1, Maven 3.9.16 `mvn -o clean verify` BUILD SUCCESS. Java 570 tests, 실패·오류 0, opt-in 2 skip. React 59 files/468 tests·typecheck, JAR/bundle release guard 통과. |
| 추가 회귀 | Masking 5, 선형 경계 2, parameter model 4, Surface authorization 10,000 inputs 1, extension lifecycle 총 7(신규 3), source NUL 1. release verify가 JAR 모든 entry의 12 fixture sentinel을 검사한다. |
| snapshot 장애 | Evidence·Surface·graph-list·graph-canvas 4개 경로에서 Request Lab 편집 후 실제 snapshot 503/retry 실패를 주입했다. 편집값 보존·모든 전송 비활성·같은 dataset 복구 뒤 raw/session metadata 재검증과 편집 재활성을 확인했다. |
| 패키지 브라우저 | 명시적 JDK 21 PATH에서 `npm run e2e -- --retries=0 --reporter=line`: 15/15 passed, 30.3s. 실제 sample operation의 Evidence ID와 마스킹 retention 페이지, 기존 Graph/Matrix/Request Lab/계정/ZAP/Explorer/XML/반응형 동선을 검사했다. |
| 산출물 | JAR 31,940,812 bytes, SHA-256 `9c537476765bc75d8924e3e6ae7b0a138d03aac6cf74b75045fcdaef7b811103`. 최종 문서를 반영해 bundle을 다시 조립하고 ZIP CRC·중첩 JAR 바이트·D-150 문서 일치를 확인했다. bundle 자기 hash는 내부 문서에 기록하지 않는다. |
| 유지한 의미 | UNKNOWN과 알려진 metadata 한쪽만 있으면 확정 SHAPE/TYPE/OCCURRENCE 변경을 만들지 않는다. unsupported/malformed body는 불완전 문맥이고, CORROBORATED 동시출현은 link를 유지하되 확정 인가 경계로 승격하지 않는다. |
| 미실행 | 실제 Burp snapshot 장애·project import 경합, Windows/native Linux, 대규모 실제 operation page 체감 성능. |

## 2026-09-12 · D-149 종료·서비스·샘플 경계 최종 검증

| 항목 | 실제 결과 |
|---|---|
| 회귀 재현 | 종료 flag 뒤 Request Lab/Explorer record·raw 추가, 다른 서비스 등록 계정의 matrix 제외 사유 미표시, 14-record 샘플 fixture와 현재 21-record SampleProject 불일치가 수정 전 회귀에서 실패했다. snapshot 갱신 중 JVM별 Surface enum 배열 순서 차이도 재현했다. |
| 집중 검증 | `FlowScopeExtensionLifecycleTest` 4/4, `AuthorizationMatrixAnalyzerTest` 14/14, `SampleProjectTest` 2/2, React matrix 3 files/33 tests와 typecheck 통과. |
| 전체 빌드 | JDK 21.0.12.1, Maven 3.9.16 `mvn -o clean verify` BUILD SUCCESS. Java 554 tests, 실패·오류 0, opt-in 2 skip. React 59 files/468 tests·typecheck, JAR/bundle release guard 통과. localhost test server 때문에 승인된 샌드박스 밖에서 실행했다. |
| 패키지 브라우저 | 명시적 JDK 21 PATH에서 `npm run e2e -- --retries=0 --reporter=line`: 15/15 passed, 32.9s. 현재 sample·Graph/Matrix·Evidence/Request Lab·계정·ZAP/Explorer 상태·XML·1920/1280/900/600px 동선을 검사했다. 외부 대상 요청은 하지 않았다. |
| 샘플 계약 | 합성 sample snapshot은 events 21, Surface endpoints 8, route candidates 8. Java가 동일 입력으로 만든 전체 value-free snapshot과 프런트 fixture가 일치한다. 실제 탐지 효능 근거가 아니다. |
| 산출물 | JAR 31,939,756 bytes, SHA-256 `4d547badc47668094ad4a23178208e52c23843302b9b3b501ef41a595ca02db3`. 최종 문서를 반영해 bundle을 다시 조립했고 ZIP CRC, 중첩 JAR 바이트, D-149 HANDOFF·문서 상태 일치를 확인했다. bundle 자기 hash는 내부 문서에 기록하지 않는다. |
| 실패 실행 구분 | POM 보정 전 기본 macOS AWT에서 Swing test가 정지했고 headless 고정 뒤 통과했다. 샌드박스 내부 전체 실행은 loopback bind 74건이 `Operation not permitted`로 실패했으며 같은 코드의 승인된 실행은 전부 통과했다. E2E 두 번은 각각 잘못된 Node 상대 경로와 `java` PATH 부재로 서버 시작 전에 실패했고, 위 최종 실행만 성공 결과다. |
| 실환경 경계 | 실제 Burp는 D-148의 호스트 내부 오류 뒤 이번 변경에서 재시도하지 않았다. Windows·native Linux와 실제 unload 도중 통제 응답 도착, 복수 서비스 계정 경고도 미실행이다. |

## 2026-09-12 · D-148 최종 사용자 동선·배포 점검

| 항목 | 실제 결과 |
|---|---|
| 코드 회귀 | 동일 Evidence ID의 프로젝트 전환 2건, React Query HTTP 503 주입의 Evidence/Surface/관계 목록/관계 canvas 4건이 RED→GREEN. 실제 정책 editor·Request Lab의 폐기/재진입을 검사했다. |
| 전체 빌드 | JDK 21.0.12.1 `mvn -o clean verify` BUILD SUCCESS. Java 550 tests, 실패·오류 0, opt-in 2 skip. React 59 files/467 tests·typecheck 통과. |
| 패키지 브라우저 | `npm run e2e -- --retries=0 --reporter=line` 15/15 passed, 33.4s. 임시 SQLite 작업공간·저장된 sample Evidence·제한된 외부 요청 경계에서 실행했다. |
| 배포물 대조 | 기준 `0774d4c` ZIP/JAR CRC·중첩 JAR 동일성, React 자산, notice/license 9종, helper 8개 mode 0755, Bash 5개 문법/ShellCheck·Compose 구성 통과. 미추적 멘토 보고서·프로젝트·설정·key 파일 비포함. 최종 입력도 같은 packaging 계약을 사용한다. |
| Linux 안내 | host-gateway의 native Linux bridge 매핑과 loopback listener 차이를 공식 Docker 문서로 확인해 한·영 가이드를 수정했다. 실제 설정 변경이나 native Linux 실측은 수행하지 않았다. |
| JAR | 31,937,310 bytes, SHA-256 `11a121f37e081494f8c24d103945abdaafb3b75e1d81d21e8676207e9e252a0c`. bundle은 문서 확정 후 조립하며 자기 hash는 내부에 기록하지 않는다. |
| 실제 Burp | **BLOCKED_HOST_RUNTIME.** GUI 제어 2회 timeout. 설치 JAR build 53343의 분리된 headless JDK 21 실행과 확장 전부 비활성화 JDK 26 기준선에서 모두 `java.lang.Error: no ComponentUI class for burp.Zhxc` 및 `burp.Zsz7`의 NullPointerException 발생. FlowScope 로드/프로젝트 재열기 성공은 확인하지 못했다. |
| 운영체제 | Darwin 호스트. Windows·native Linux의 실제 실행 검증은 수행하지 않았다. |

Burp의 headless/config/data-dir 옵션은 설치 JAR `--help`와 [공식 실행 안내](https://portswigger.net/burp/documentation/desktop/troubleshooting/launch-from-command-line)로 확인했다. 호스트 측 원본 Burp 프로세스나 사용자의 settings를 초기화하지 않았다. 검증용 headless 프로세스는 종료했고 도움말/버전 프로세스 2개는 TERM/KILL 뒤 OS `UE` 상태로 남은 것을 기록했다. 이 결과는 호스트 복구가 완료됐다는 주장이 아니다.

## 2026-09-12 · D-147 PR 연결부 최종 검증

| 항목 | 실제 확인 결과 |
|---|---|
| 기준·회귀 재현 | `b168106`에서 미지원 본문/불완전 multipart, 공개 FORM 좌표, UNKNOWN/충돌 diff, Matrix 늦은 응답·dataset/연결 실패, 종료 직전 Evidence 저장·설치 records 잠금 문제를 실패 회귀로 확인했다. |
| 전체 검증 | JDK 21.0.12.1 `mvn -o clean verify` BUILD SUCCESS. Java 550 tests, 실패·오류 0, 선택형 ZAP/Codex 하네스 2 skip. React typecheck·58 files/461 tests 통과. |
| 패키지 브라우저 | `npm run e2e -- --retries=0 --reporter=line`: 15/15 passed, 29.4s. 기존 동선과 실제 sample Evidence API를 읽어 비교·파라미터 Matrix를 여는 새 동선을 검증했다. 외부 origin·능동 대상 요청·page/console error 검사 통과. |
| 저장 무결성 | 실제 extension shutdown 호출 뒤 임시 SQLite 재열기에서 마지막 Evidence 보존. 실제 프로젝트 설치 메서드의 preparation 중 records monitor 획득 가능. 파일 경로 오류로 sample 보존 실패를 주입해 원 dataset 보존·호출자 실패를 확인했다. |
| 문서 | 현행/이력 모순 정정, 수정 문서 19개의 로컬 링크 135개 모두 존재, `git diff --check` 통과. 외부 URL/heading anchor 검증이 아니다. |
| 산출물 | JAR 31,937,006 bytes, SHA-256 `163072aff44850fb1d968363835c565f34d0b77eea35b0eb01d23f043b6d3232`. bundle은 최종 문서와 함께 조립하며 자기 해시를 내부에 기록하지 않는다. |
| 미실행 | 실제 Burp 재로드·Windows·외부 대상 탐색/정확도 측정. opt-in 하네스 skip을 실환경 통과로 계산하지 않는다. |

전체 검증의 첫 실행은 제한 환경 npm 설치 대기로 중단됐다. 이어진 실행에서 기존 UI 테스트가 UNKNOWN 타입을 확정 TYPE_CHANGED로 기대해 실패했으며, fixture를 바꾸지 않고 기대를 현행 의미로 정정한 뒤 최종 전체 검증이 통과했다. 위 수치는 이 최종 실행만을 가리킨다.

## 2026-09-12 · 미출시 · PR #11·#12 최종 작업면·Evidence 비교 흡수(D-145) gate

| 항목 | 실제 확인 결과 |
|---|---|
| 수정 전 재현 | Claude 미커밋 트리의 Maven 회귀는 통과했지만 패키지 Playwright는 grouped menu 접근성 이름 불일치로 14건 중 1건 실패·9건 미실행. 실패한 프로젝트 열기에도 dataset replacement signal이 발생하는 RED 회귀와 프로젝트 설치/unload TOCTOU를 확인했다. |
| 자동 회귀 | JDK 21 `mvn -o clean verify` BUILD SUCCESS. Java 536 tests(실패·오류 0, opt-in 2 skip), React typecheck·58 files/452 tests 통과. 실패 전환은 Request Lab 편집과 signal 0회를 보존하고, install/unload 원자 경계 회귀는 15/15를 통과했다. |
| 패키지 Playwright | `npm run e2e -- --reporter=line`: 14/14 passed(29.3s), retry 0. grouped navigation, Dashboard→Gap, Gap 카드/필터/tooltip/600px Sheet, 관계 그래프, 세 Matrix tab, Request Lab, 계정, ZAP/Explorer, XML, 900/600px shell을 같은 JAR에서 확인했다. 외부 origin·능동 대상 요청·console/page error 0. |
| 산출물 | JAR 31,934,375 bytes, SHA-256 `7c30e1bc80ff1e3f7933b5914cf31a117c3f758236aa62affdf5ebcda6eaf061`. bundle은 이 문서를 포함하므로 자기 hash/size를 내부에 고정하지 않는다. |
| 미실측 | 실제 Burp load/unload·disk failure·Windows, 대규모 Evidence 비교 비용, 실제 대상의 탐지 precision/recall. |

## 2026-09-12 · 미출시 · 인가 추천 서비스·구조·관계 경계(D-146) gate

| 항목 | 실제 확인 결과 |
|---|---|
| 수정 전 재현 | 별도 probe와 실패 회귀 6건에서 타 서비스 등록 계정 추천 혼입, 중첩 PATH 부모 슬롯의 자식 리소스 연결, 반복 `sort` 동시출현의 `CONFIRMED_AUTH_BOUNDARY` 과대 표시를 확인했다. |
| 수정 후 집중 회귀 | `AuthorizationMatrixAnalyzerTest` 12건 중 신규 서비스 경계 3건, `SurfaceAuthorizationLinkTest` 23건 중 신규 중첩 PATH·반복 ID·동시출현 경계 3건 통과. 두 focused class 35/35 GREEN. |
| D-145 통합 `mvn -o clean verify` | BUILD SUCCESS. Java 542 tests(실패·오류 0, opt-in 2 skip), frontend typecheck·vitest 58 files/452 tests 통과. |
| 통합 Playwright | 최종 14/14 passed(29.0s), retry 0. 첫 통합 실행은 이미 fit된 geometry가 반드시 바뀐다고 가정한 검사 1건이 retry됐고, 제품의 E2E seam이 fit 명령 소비 version을 게시하도록 바꾼 뒤 최종 재실행했다. |
| 최종 산출물 | JAR 31,936,476 bytes, SHA-256 `ca50d8c60dc1054ff6682ffdffa0e0883364da96e98617b787bd95b3ba499b33`. bundle hash는 모든 내부 문서 확정 뒤 외부 결과에서 식별한다. |
| 미실측 | 실제 Burp 복수 서비스·중첩 API, 대규모 dataset의 추천 precision/recall은 별도 운영 gate다. |

## 2026-09-11 · 미출시 · PR #11·#12 이식 7단계(통합 검증·최종 인계) gate

| 항목 | 실제 확인 결과 |
|---|---|
| 저장·재열기 통합 | `PortedFeaturesReopenTest`: 샘플 프로젝트 + 매트릭스 검토(object CONFIRMED·function DISMISSED) → JSON·SQLite 저장·재열기 → Evidence ID 순서 동일, `surface` 6개 배열·`cells`·`gaps`·`authorizationMatrix`(reviewStatus 포함) JSON 동일, 비밀 문자열 없음. GREEN. |
| 화면 간 선택·Evidence | `crossScreenSelection.test.ts` 4건(캡처 snapshot 무값 확인, 큐 Gap→검증 cell→정본 cell Evidence 포함, Object View·판정 매트릭스·기존 매트릭스 동일 Evidence, 경로 후보 중립). GREEN. |
| JDK 21 `mvn -o clean verify` | BUILD SUCCESS. Java 533 tests(실패·오류 0, opt-in 2 skip). frontend typecheck·vitest 47 files/371 tests 포함. |
| 산출물 JAR | `target/flowscope-1.2.0-beta.46.jar` 31,930,936 bytes(이 verify의 단일 빌드값). |
| Playwright parity(패키지 JAR, 격리 workspace) | 최종 10/10 passed(20.3s; 우선순위 Gap 그래프 1920/1280/600·판정 매트릭스 900/600 검사 포함). 같은 JAR로 3회 실행: 1·2회차는 새 우선순위 Gap 그래프 테스트의 순서 결함(모달 Sheet 아래 workspace 가시성, 600px 진입 전에 상세를 닫아 큐 sheet가 자동 열림)으로 실패해 테스트만 수정(제품 코드 변경 없음). 1회차에서 graph-lane 검사(zoom·fit 기하 polling) 1회 flaky, 재시도 통과. |
| 미실측 | 실제 Burp 재로드·프로젝트 재열기·Windows·ZAP 복수 계정(기존 운영 gate). 대규모 dataset interaction latency. |

## 2026-09-11 · 미출시 · PR #11·#12 이식 6단계(판정 매트릭스 P/E/O) gate

| 항목 | 실제 확인 결과 |
|---|---|
| 회귀 | Java `AuthorizationMatrixAnalyzerTest` 10건(PR 7건 이식 + guard: 본문 미확인 성공→수동 검토, 소유자 미확정→검토, BOLA 의심 비누설, 과거 검증 이력 비승격·정확 좌표), `FlowScopeWebServerTest` 매트릭스 cell 검토 왕복(서버 Evidence 결박·DISMISSED·미존재 id 400); vitest `judgmentProjection` 4·`JudgmentMatrixView` 5(요약·칩, 상세·저장·기각 mutation, 기준/대상 Evidence 시트, 주의 필터·Evidence 목록·선택 해제, 로딩/없음/오류)·`MatrixPage` 탭 1 → 모두 GREEN. |
| JDK 21 `mvn -o clean verify` | BUILD SUCCESS(1분 6초). Java 532 tests(실패·오류 0, opt-in 2 skip). frontend typecheck·vitest 46 files/367 tests 포함. |
| 산출물 JAR | `target/flowscope-1.2.0-beta.46.jar` 31,930,936 bytes(이 verify의 단일 빌드값). |
| 패키지 Chromium 실측 | Standalone(17777) 샘플, `?fresh=6#matrix`, 1600×900 새 탭. 기본 탭 `판정 매트릭스`(aria-selected), 요약 `BFLA 테스트 추천 0 · BOLA/IDOR 테스트 추천 4 · 수동 검토 대기 7 · 사용자 취약점 확정 0 · 정상·기각 0`, 기능 표 열 `USER A User / USER B User / ADMIN Admin`, 행 `GET /api/admin/users P3 · 사람 확인 정책` 등 5행, 셀 15개(`교차 실행 공백` gap / `응답 관측 · 기대 정책 미정` unknown / `BFLA 후보 · 통제 재현 필요` risk), 범례 P/E/O. BFLA 후보 셀 클릭 → 상세: `USER A · POST /api/admin/invites`, 기대 차단→실제 응답 갈림 HTTP 200/403, HUMAN=DENY·LLM=SUSPICIOUS, P3 사람 확인 정책·E1 단일 관측, 게이트(세션 PASS·기준선/통제/반복/전제조건/오라클 UNKNOWN), 오라클 생성 후 확인 미충족, Evidence 2건, 사람 최종 판정 폼. `BOLA/IDOR · 계정 × 객체` 탭 → 4행(orders:101 소유 USER A ×3 op, orders:202 소유 USER B), 셀 `BOLA/IDOR 후보: USER B · GET …orders:101`(risk) 클릭 → 관계 SAME_ROLE_FOREIGN·기법 IDOR/BOLA·소유자 USER A, 기대 차단→실제 응답 갈림 200/403, LLM=SUSPICIOUS·SCANNER=DENY, P2 소유관계·E2 차등 비교·O3 확정(사용자 명시 소유자), 정상 기준선 PASS·결과 오라클 PASS(읽기 의미 응답 충족 예), Evidence 2 → 검증 메모 "shared object confirmed by owner" 입력 → `정상·기각` 클릭 → `POST /api/review` 200, 헤딩·셀 라벨 `BOLA/IDOR 후보 · 정상/기각`, 요약 수동 검토 대기 6·정상·기각 1 → `Evidence 상세 열기` → `Evidence 상세` dialog(매트릭스 선택 좌표 acct-demo-user-b / orders:101 / GET /api/orders/{id}, Evidence IDs 2, GET /api/orders/101 HTTP 403 acct-demo-user-b/User) → Escape → `기존 권한 매트릭스` 탭 → `권한 매트릭스 표`·`권한 셀 Evidence 열기` 7. 콘솔 오류 0, `/api/*` 200. 실측 중 발견: 저장 뒤 서버 메시지가 snapshot 갱신으로 즉시 사라짐 → 다른 cell로 옮길 때만 지우도록 수정. 재빌드 JAR 재실측: `BOLA/IDOR 수동 테스트 추천: USER B · PATCH …orders:101` 상세의 추천 조합(USER A → USER B, 상태변경 경고, 기준 ev-ade77aee8c742e10) → `기준 Evidence 상세 열기` → 시트(acct-demo-user-a · PATCH /api/orders/{id} · orders:101, PATCH /api/orders/101 HTTP 200) → Escape → 메모 입력 후 `판정 저장`(UNRESOLVED) → `POST /api/review` 200, 상태 메시지 "Evidence에 묶인 사람 감사·오버라이드 기록을 저장했습니다." 유지, 메모 값 유지, 콘솔 오류 0. |
| Playwright parity | 9/9 passed(17.8s, 재빌드 JAR을 `scripts/start-e2e-server.mjs`가 격리 workspace로 기동). 새 검사 `shows the judgment matrix with server recommendations and a server-bound review form`: 권한 매트릭스 → 판정 매트릭스 탭 → 요약 목록에 `BOLA/IDOR 테스트 추천` → BOLA/IDOR 탭 → `BOLA/IDOR (후보|수동 테스트 추천|수동 결과 검토)` 셀 클릭 → 상세의 `독립 신뢰도 축`·`테스트 유효성 게이트`·`사람 최종 판정`·`판정 저장` 활성·E3 미표시. 기존 검사는 `navigate("권한 매트릭스")`가 `기존 권한 매트릭스` 탭을 연 뒤 그대로 통과. 콘솔 오류·외부 origin·능동 요청 0. | |
| 미실측 | 프로젝트 저장·재열기 뒤 매트릭스 검토 보존은 7단계 통합 검증. 실제 Burp 미실행. |

## 2026-09-11 · 미출시 · PR #11·#12 이식 5단계(5d snapshot 계약·캐시) gate

| 항목 | 실제 확인 결과 |
|---|---|
| 회귀 | `web/SnapshotSurfaceContractTest` 9건 신규. 첫 실행 3 RED(명시 Evidence ID가 Pipeline 내용 digest로 재부여됨·`List.of()` 동일 인스턴스·선언 preview 순서 의존) → 앞 둘 테스트 가정 수정, 셋째는 `SurfaceAnalyzer` 결정성 결함 수정 후 9/9 GREEN. `SurfaceAnalyzerTest`·`SurfaceParameterProfileTest`·`SurfaceAuthorizationLinkTest` 포함 83/83. |
| JDK 21 `mvn -o clean verify` | BUILD SUCCESS(1분 6초). Java 523 tests(실패·오류 0, opt-in 2 skip). frontend typecheck·vitest 44 files/357 tests 포함. |
| 산출물 JAR | `target/flowscope-1.2.0-beta.46.jar` 31,876,645 bytes(이 verify의 단일 빌드값). |
| 미실측 | UI 변경 없음(5c 실측 유지). PR fingerprint 캐시·attached generation 항목은 설계상 해당 없음(D-143 5d). 실제 Burp 미실행. |

## 2026-09-11 · 미출시 · PR #11·#12 이식 5단계(5c 계층 관계 그래프) gate

| 항목 | 실제 확인 결과 |
|---|---|
| 회귀 | 착수 시 RED: graph 11 테스트 파일 중 9 실패(신규 모듈 4 파일 로드 실패 + 22 assertion 실패) → 구현 후 11/11 GREEN. vitest `graphHierarchy.test.ts` 22·`relationshipNodeCard.test.ts` 4·`CytoscapeGraph/ResponsiveGraphList/GraphInspectorPanel/GraphPage(.lifecycle)/graphProjection/graphPreferences` 이식 테스트. |
| JDK 21 `mvn -o clean verify` | BUILD SUCCESS(1분 6초). Java 514 tests(실패·오류 0, opt-in 2 skip). frontend typecheck·vitest 44 files/357 tests 포함. |
| 산출물 JAR | `target/flowscope-1.2.0-beta.46.jar` 31,876,030 bytes(이 verify의 단일 빌드값). |
| 패키지 Chromium 실측 | Standalone(17777) 샘플, `?fresh=5c&flowscope-e2e-geometry=1#graph`. 1600×900: Site Overview lane `TARGET / API GROUP`, 카드 TARGET `https://demo.flowscope.test:443 · 2 API groups`, `ADMIN APIs · 1 APIs · H 1 / S 0 / L 1 · Gap 1 · 경로 후보 0`, `ORDERS APIs · 3 APIs · H 3 / S 2 / L 2 · Gap 7 · 경로 후보 0`(카드 224×124) → ORDERS tap → API View `IDENTITY / API`(acct-demo-user-a·b, GET UNKNOWN 5 Evidence / OPTIONS UNDECIDED / PATCH ALLOW 순, HUMAN 실선·SCANNER 파선·LLM 점선 edge 7) → GET tap → Object View `IDENTITY / API / OBJECT`(orders:101 owner acct-demo-user-a, orders:202 owner acct-demo-user-b, identity→operation 5·operation→resource 5 edge) → orders:101 tap → 선택 상세 `복수 셀`·원본 셀 2(ALLOW / SUSPICIOUS·소스 판정 충돌)·Gap ID 3 → 신원 hover 툴팁 `Identity acct-demo-user-a; verdict UNKNOWN; 2 Evidence` → canvas focus + ArrowDown + Enter → acct-demo-user-b 선택, 해당 경로 `focused=yes` 6·나머지 `no` 4 → GAP `미교차 후보 acct-demo-user-b · PATCH /api/orders/{id} · orders:101` 클릭 → PATCH Object View, 중립 후보 edge 2 `yes`(#6b7280)·HUMAN 2 `no`. 900×800: canvas 없음, Identity focus 버튼 2, RESOURCE 항목 1, Source Evidence 경로 4(후보 2 `포커스 경로`) → 후보 클릭 → `선택 상세` dialog(`미교차 후보`, gap-a9601d09b142, aria-pressed) → Escape → acct-demo-user-a 클릭(aria-pressed=true, HUMAN 경로만 `yes`) → Escape → 후보 focus 복귀. 새 탭 콘솔 오류 0, `/api/*` 전부 200. |
| Playwright parity(`npm run e2e` 동등, 패키지 JAR을 `scripts/start-e2e-server.mjs`가 격리 workspace로 기동) | 8/8 passed(16.6s). 그래프 검사: Site lane `TARGET / API GROUP`, 카드 SVG parsererror/script/image/foreignObject/href 0·224×124, `API 목록 보기`→`ORDERS APIs`→`GET /api/orders/{id}` drill(API View→Object View)→`그래프 보기` lane `IDENTITY / API / OBJECT`, 노드 click 선택 유지·zoom/fit/resize/drag/lock/초기화/최대 zoom 검사, 목록 첫 항목 선택→상세 dd 3개 일치; 반응형 검사 900/600px에서 목록 drill→선택 상세 dialog. 콘솔 오류·외부 origin·능동 요청 0. |
| 미실측 | 보조 흐름·경로 후보 그룹·`18개 더 보기`(샘플 3 API·2 객체), resource family 접기(PR#11 범위 밖). 실제 Burp 미실행. |

## 2026-09-11 · 미출시 · PR #11·#12 이식 5단계(5b 구조화 요청 비교) gate

| 항목 | 실제 확인 결과 |
|---|---|
| 회귀 | Java `SurfaceParameterProfileTest` 요청 문맥 1건(완전 행 complete/retained/discovery, 잘린 payload complete=false·retained=false, 파서 실패 complete=false, VALIDATION discovery=false), vitest `requestDiff.test.ts` 11·`ParameterRequestDiff.test.tsx` 3·page 요청 비교 탭 1 → 모두 GREEN(parameter-map 44/44). |
| JDK 21 `mvn clean verify` | BUILD SUCCESS(1분 5초). Java 514 tests(실패·오류 0, opt-in 2 skip). frontend typecheck·vitest 42 files/298 tests 포함. |
| 산출물 JAR | `target/flowscope-1.2.0-beta.46.jar` 31,869,808 bytes(이 verify의 단일 빌드값). |
| 패키지 Chromium 실측 | Standalone(17777) 샘플, `?fresh=5b#parameter-map`, 1024×768. 큐 "전체 23개 보기" → GET `/api/orders/{id}` `PATH /segments/2` gap(LLM · UNKNOWN · OTHER_ROLE) 선택 → 상세 sheet "요청 비교" 탭: 연결 실제 EventRecord 5건, 기준 요청 select에 ev-47af985ca3b863d0 등 5개 옵션(신원/역할/source/HTTP 표시) → 기준 ev-47af…(acct-demo-user-a HUMAN 200)·비교 ev-6094…(acct-demo-user-b SCANNER 403) 선택 → 표: `응답 / 서버 표시 판정` 행 `STATUS_CHANGED VERDICT_CHANGED`(200·ALLOW vs 403·DENY), `PATH /segments/2` 행 변경 `UNKNOWN`(값 digest 비노출), 양쪽 PRESENT·SCALAR (INTEGER) / STRING·RETAINED·길이 3 bytes·관측 신뢰 OBSERVED·같은 `ctx:v1:sha256:…` 문맥; 콘솔 `Uncaught`/`TypeError` 0. |
| 미실측 | 잘린 payload(INCOMPLETE_CONTEXT)·미기록 완전성 표시는 vitest로만(샘플에 잘린 요청 없음). 실제 Burp 실행 미실행. |

## 2026-09-11 · 미출시 · PR #11·#12 이식 5단계(5a 우선순위 Gap 그래프 화면) gate

| 항목 | 실제 확인 결과 |
|---|---|
| RED→GREEN | `parameterProjection.test.ts` 13건·`ParameterMapPage.test.tsx` 16건을 구현과 함께 작성해 첫 실행 26/29 통과, 실패 3건은 테스트 전제 오류(WRITE_METHOD 정렬 순서, 대상 근거 없는 fixture, rerender 시 QueryClientProvider 누락)로 정정 → 29/29. 캔버스는 cytoscape mock(throw)으로 목록 fallback을 검증. |
| JDK 21 `mvn clean verify` | BUILD SUCCESS(1분 4초). Java 513 tests(실패·오류 0, opt-in 2 skip). frontend typecheck·vitest 40 files/283 tests 포함. |
| 산출물 JAR | `target/flowscope-1.2.0-beta.46.jar` 31,865,404 bytes(이 verify의 단일 빌드값). 번들에 `parameter-map` route 포함 확인(`unzip -p … index-*.js`). |
| 패키지 Chromium 실측 | `java -Djava.awt.headless=true -Dflowscope.web.port=17777 -cp <jar> io.flowscope.Standalone`, 샘플 데이터, 캐시 회피용 `?fresh=5a#parameter-map`. 1024×768: rail에 "우선순위 Gap 그래프" 추가, 큐 23건(AUTH_VARIANT_UNTESTED, CONFIRMED_AUTH_BOUNDARY 우선), "먼저 확인" 요약, 4-lane 목록 fallback(anon·ANONYMOUS / PATCH `/api/orders/{id}` HTTP 200×1·1 Evidence / PATH `/segments/2` INTEGER·STRING / orders:101 OBSERVED owner acct-demo-user-a); 큐 첫 항목 클릭 → 상세 sheet(`data-gap-id`, 사유 확인된 권한 경계·권한 변형 미검증·쓰기 메서드, 입력→권한 대상 orders:101 OBSERVED/EXACT_SCALAR_RESOURCE_REFERENCE 연결 근거 1건, 프로파일 관측 1건 HUMAN×1·acct-demo-user-a×1·USER×1, Gap 근거 1건 ev-ade77…) → 검증표 펼치기(HUMAN × SELF/OTHER_OWNER/ANONYMOUS/OTHER_ROLE 4좌표, 미검증 3·적용 불가 0) → Evidence 탭(연결 EventRecord 1건) → `Evidence 상세 ev-ade77aee8c742e10`(EvidenceSheet: PATCH `/api/orders/101` 200 acct-demo-user-a/User, 연결 셀 allow, 정책 폼, Request Lab/Repeater) → 닫기 → `Request Lab 열기`(대표 Evidence 초안: PATCH `/api/orders/101`, Authorization `***MASKED***`, 응답 200, Standalone 읽기 전용) → 닫기. 1600×900: 큐·Cytoscape 캔버스(카드 4장, 선택 경로 강조·비선택 흐림, edge 라벨 `Gap 주체 H`·`관측 H × 1`·`관계 근거`)·상세 pane 3열, 확대 버튼 동작, `Gap 목록 보기` 전환. 콘솔 `Uncaught`/`TypeError` 0(403 항목은 이전 인스턴스 토큰의 잔여). |
| 미실측 | 900px 미만 큐 sheet·600px 경로 목록은 vitest로만(7단계 packaged 실측 예정). 실제 Burp 실행 미실행(운영 gate). |

## 2026-09-11 · 미출시 · PR #11·#12 이식 4단계(권한 대상 연결) gate

| 항목 | 실제 확인 결과 |
|---|---|
| RED→GREEN | `SurfaceAuthorizationLinkTest` 20건(PR `ParameterAuthorizationAnalyzerTest` 이식)을 link·cell 없는 stub에서 실행해 15 실패·2 오류(불변식·부정 단언 3건만 통과) 확인 → 구현 후 20/20 GREEN. 기존 비노출 회귀 3곳은 인가 객체 키 필드 제외·`pg:auth:` 허용으로 범위만 정정(값·digest·preview 금지 유지). |
| JDK 21 `mvn clean verify` | BUILD SUCCESS(1분 4초). Java 513 tests(실패·오류 0, opt-in 2 skip). frontend typecheck·vitest 38 files/252 tests 포함. |
| 산출물 JAR | `target/flowscope-1.2.0-beta.46.jar` 31,846,822 bytes(이 verify의 단일 빌드값). |
| 패키지 Standalone 실측 | `java -Djava.awt.headless=true -Dflowscope.web.port=17777 -cp <jar> io.flowscope.Standalone`, 샘플 데이터(소유자 orders:101=user-a, orders:202=user-b). React가 발급한 capability 토큰으로 `/api/snapshot`을 읽어 `authorizationTargets` 5건(GET/PATCH/OPTIONS `/api/orders/{id}` `/segments/2` → `orders:101`·`orders:202` OBSERVED/EXACT_SCALAR_RESOURCE_REFERENCE, PATCH `/status` → INFERRED/SINGLE_RESOURCE_COOCCURRENCE, POST `/api/admin/invites` `/email` → UNKNOWN), `validationCells` 40건(SELF·HUMAN ALLOW "소유자의 정상 접근"=정본 재사용, OTHER_OWNER·SCANNER DENY=RESPONSE_DENIAL_EVIDENCE, OTHER_OWNER·LLM SUSPICIOUS=정본 "비소유자의 응답에 타 소유 객체가 포함됨", LLM 404 → UNDECIDED/AMBIGUOUS_RESPONSE_EVIDENCE, OPTIONS → UNDECIDED/METADATA_METHOD_NOT_AUTHORIZATION_PROOF, `/email` 8건 applicable=false/SUBJECT_RELATION_NOT_ESTABLISHED, UNTESTED는 evidenceCount 0·basis 1~3), `parameterGaps` 23건 전부 AUTH_VARIANT_UNTESTED(CONFIRMED_AUTH_BOUNDARY 우선, PATCH는 WRITE_METHOD, INFERRED link는 HUMAN_REVIEW_REQUIRED), `digest` 필드 없음을 확인. |
| 화면 변경 | 없음(`types.ts` optional 가산만) — 화면 조작 실측은 5·6단계에서. |
| 실제 Burp 실행 | 미실행(운영 gate). Request Lab VALIDATION 전송의 cell 연결은 unit test(`VALIDATION_Evidence는…`)로만 확인. |

## 2026-09-11 · 미출시 · PR #11·#12 이식 3단계(파라미터 프로파일·discovery Gap) gate

| 항목 | 실제 확인 결과 |
|---|---|
| RED→GREEN | `SurfaceParameterProfileTest` 17건(PR `ParameterProfilerTest` 동작 이식)을 빈 프로파일·gap 없는 상태에서 실행해 12 실패·3 오류(부정 단언 2건만 통과) 확인 → 구현 후 17/17 GREEN. 기존 비노출 회귀 1건은 `ctx:v1:`·`pg:v1:` 구조/좌표 digest 허용으로 범위만 정정(값 digest 금지 유지). |
| JDK 21 `mvn clean verify` | BUILD SUCCESS(1분 4초). Java 493 tests(실패·오류 0, opt-in 2 skip). frontend typecheck·vitest 38 files/252 tests 포함. |
| 산출물 JAR | `target/flowscope-1.2.0-beta.46.jar` 31,818,714 bytes(이 verify의 단일 빌드값). |
| 패키지 Standalone 실측 | `java -Djava.awt.headless=true -Dflowscope.web.port=17777 -cp <jar> io.flowscope.Standalone`, 샘플 데이터. 화면(React)에서 발급된 capability 토큰으로 `/api/snapshot`을 읽어 `surface.endpoints[].parameters[].profile` 5건(GET `/api/orders/{id}` `/segments/2`: HUMAN 2·SCANNER 1·LLM 2, user-a 2·user-b 3, EXPLORATION 5, absent 0; POST `/api/admin/invites` `/email`: HUMAN 1·LLM 1)과 `parameterGaps` 0건(샘플은 모든 요청이 각 입력을 포함해 누락 조건이 없음)을 확인. 이어 `/api/import-har?source=scanner`로 `GET /api/orders/101?sort=DESC` 1건 가져오기(`imported:1`) → revision 2에서 `/sort` profile(SCANNER 1·IMPORT·identityCounts 비어 있음(미해결 신원)·absent 5·contextPresence 2키)과 SOURCE_MISSED 2건(HUMAN·LLM, 각 증인 2, `SOURCE_DISCREPANCY,HUMAN_REVIEW_REQUIRED`, OPEN, `pg:v1:sha256:` ID), IDENTITY_MISSED 없음(미해결 신원은 비교 신원이 아님), `digest`·preview 필드 없음. 가져오기는 메모리 상태만 바꿨고(activeProjectDatabase 없음) 프로젝트 저장은 하지 않았다. |
| 화면 변경 | 없음(`types.ts` optional 가산만) — Chromium 화면 조작 실측은 5단계에서. |
| 실제 Burp 실행 | 미실행(운영 gate). |

## 2026-09-11 · 미출시 · PR #11·#12 이식 2단계(선언 의미 확장) gate

| 항목 | 실제 확인 결과 |
|---|---|
| RED→GREEN | 선언 공백 6건 실패 회귀 선행(operation override·union/enum·path 타입, swagger body/formData·binary, 외부/순환/민감, JS 거부 규칙·리터럴 타입, 선언 32 상한, servers 확장 상한) → 구현 후 GREEN. 기존 multipart binary 단언 1건 정정(근거: 개발 기록). |
| JDK 21 `mvn clean verify` | BUILD SUCCESS. Java 476 tests(실패·오류 0, opt-in 2 skip). frontend typecheck·vitest 포함. |
| 산출물 JAR | `target/flowscope-1.2.0-beta.46.jar` 31,795,884 bytes. |
| Chromium 실측 | 미실행 — 화면 변경 없음(`types.ts` optional 필드 가산만). |
| 실제 Burp 실행 | 미실행(운영 gate). |

## 2026-09-11 · 미출시 · PR #11·#12 이식 1단계(네 결함 수정) gate

| 항목 | 실제 확인 결과 |
|---|---|
| RED→GREEN | 네 결함 각각 실패 회귀 선행: Java 5건(`/segments/0` 200, FLOW_V2 `/segments/0` 확정, `"1"`→INTEGER, distinct 1, `/payload/*` 미병합)·React 1건(canonical 미표시) 실패 확인 → 구현 후 GREEN. |
| JDK 21 `mvn clean verify` | BUILD SUCCESS. Java 470 tests(실패·오류 0, opt-in 2 skip). frontend typecheck·vitest(SurfacePage 4/4) 포함. |
| 산출물 JAR | `target/flowscope-1.2.0-beta.46.jar` 31,789,381 bytes(이 verify의 단일 빌드값, 제3자 재현 미주장). |
| 패키지 Chromium 실측 | `java -Djava.awt.headless=true -Dflowscope.web.port=17777 -cp <jar> io.flowscope.Standalone`, 샘플 프로젝트. API·입력 차이 → PATCH `/api/orders/{id}` "상세 보기" → 입력 필드에 `PATH · id`/`/segments/2`(H · INTEGER), `JSON_BODY · status`/`/status`(H · STRING) 표시, 콘솔 오류 0건. 미확정 라벨·리터럴/중첩 동시 표시는 샘플에 해당 데이터가 없어 unit test(`SurfacePage.test.tsx`)로만 확인. |
| 실제 Burp 실행 | 미실행(운영 gate). |

## 2026-09-11 · 미출시 · 슬라이스 1 후속 수정(리뷰 6건·JS AST 구조 보존) gate

| 항목 | 실제 확인 결과 |
|---|---|
| RED→GREEN | 리뷰 10항목 각각 실패 회귀를 먼저 두어 RED 10건(동작 실패, 컴파일 오류 없음) 확인 → 구현 후 GREEN. 이어 구조 보존 정정(JS AST 세그먼트·`/a//b` 수용·분석기 세그먼트 보존) RED 3건 확인 → GREEN. |
| JDK 21 `mvn clean verify` | BUILD SUCCESS. Java 466 tests(실패·오류 0, opt-in 하네스 2 skip). |
| frontend | `npm run typecheck` 통과. SurfacePage vitest 3/3(후속 수정 직후 실행, 이후 frontend 무변경). AccountsPage/graphPreferences/EvidencePage의 `localStorage.clear` 선존 환경 결함은 이 변경과 무관(base 커밋 동일 재현). |
| 산출물 JAR·실제 실행 | 미빌드·미실행(자동 회귀까지). |

## 2026-09-11 · 미출시 · canonical parameter coordinate 통합(슬라이스 1, D-143) gate

| 항목 | 실제 확인 결과 |
|---|---|
| JDK 21 `mvn clean verify` | BUILD SUCCESS. Java 회귀 실패·오류 0(opt-in 하네스 2 skip). `ParameterExtractorTest`(포팅 39) 통과, `SurfaceAnalyzerTest`에 D-143 통합 회귀 8건, `ProjectStoreTest`·`SqliteProjectStoreTest`에 FLOW_V2 재열기 좌표·버전·Evidence 보존 각 1건 추가. `SurfaceHeldOutEvaluationTest` truth를 canonical로 갱신 후 통과. |
| frontend `npm run typecheck` | 통과(가산 타입 `canonicalPath`/`observedValueTypes`/`distinctValueCount`/`coordinateVersion`/`parameterDiagnostics`). |
| frontend vitest | SurfacePage 3-way 테스트 통과. AccountsPage·graphPreferences·EvidencePage의 `localStorage.clear is not a function`(jsdom setup 미폴리필) 실패는 **base 커밋에도 동일 재현**(내 2개 파일을 base로 되돌려 확인) — 이 변경과 무관한 선존 환경 결함이라 손대지 않음. |
| 산출물 JAR | **미빌드.** 이 슬라이스는 자동 회귀까지만 수행했다. 산출물 해시는 직전 nav 커밋(`2baf0adc…`)을 정본으로 두고 갱신하지 않는다. |
| 관측 동등성 | 제거한 observe*의 값 형식 분류(UUID/INTEGER/DECIMAL/BOOLEAN)를 엔진 `scalarType`으로 이관해 동등 유지. PATH 통합 테스트가 처음 실패해 실측 → Pipeline이 단일 숫자 세그먼트를 corroboration 없이 {id}로 승격하지 않는 정규화 특성 확인(테스트 전제 오류였고 구현 결함 아님, 두 UUID 입력으로 수정). |
| 실제 실행 | 미검증. 실제 Burp/ZAP/Explorer HTTP 경로·packaged Chromium E2E는 이 슬라이스에서 실행하지 않음(운영 gate). |

## 2026-09-11 · 미출시 · 데스크톱 내비 라벨·Explorer 신원 계약 회귀 gate

| 항목 | 실제 확인 결과 |
|---|---|
| JDK 21 `mvn clean verify` | BUILD SUCCESS. React 38 files / 251 tests, Java 411 tests(실패·오류 0, opt-in 하네스 2 skip). |
| 산출물 JAR | 31,732,411 bytes · 9,161 entries · SHA-256 `2baf0adc568ca6f3a9074d7330c71736171208a62c73f92f9b12b544a71ee7e8` · React asset `index-DtgDy0ib.js`. 이 verify 실행의 단일 빌드값이다(제3자 재현 미주장). nav가 React 번들을 바꿔 7f64c71의 `90334b08…`과 다르다. |
| 데스크톱 rail 실제 렌더(코덱스 실측) | packaged Chromium 1280×600에서 마지막 메뉴 `실행 상태`가 viewport 밖(615px>600px)으로 잘림 확인 → rail `<nav>` `overflow-y-auto`로 세로 스크롤. **스크롤 수정 후 마지막 메뉴 in-viewport E2E는 미실행(브라우저 gate).** |
| Explorer 신원 연결부 | 미검증. 신규 4 tests는 구성요소 계약만; 실제 `executeExplorerRequest()→recordFrom(forcedAccountId)` 연결부·Burp Montoya 귀속은 열림. 재열기는 JSON `ProjectStore`만 덮고 SQLite 통합은 미실행. |

## 2026-09-11 · 미출시 D-142 · 패키지 Standalone 프로젝트·현행 UI 계약 gate

D-140~141의 보존형 프로젝트와 Evidence 계약을 패키지 fat JAR의 실제 Standalone Web 경로까지 연결하고, E2E가 폐기된 초기화/Judge 계약이 아니라 현행 프로젝트·독립 Explorer 계약을 검사하도록 바로잡았다. 같은 코드 대조에서 계층 그래프·resource family·증분 `+18`은 현행 구현이 아님을 문서에 명시했다.

| 항목 | 실제 확인 결과 |
|---|---|
| 실패 재현 | 패키지 Standalone의 `POST /api/projects/start`가 501, `GET /api/explorer-run`이 500이었고, E2E는 삭제된 `매핑·트래픽 초기화`와 LLM 탭 부재를 기대해 실패함. HUMAN 계정 Select에는 Radix가 허용하지 않는 빈 문자열 option이 남아 있었음 |
| 프로젝트 회귀 | Standalone에서 첫 프로젝트 생성→샘플 저장→두 번째 프로젝트 생성→첫 프로젝트 재열기와 SQLite 파일 존재를 확인 |
| Explorer 상태 | Standalone은 실행 불가를 예외로 던지지 않고 `status=IDLE`, `providerReadiness=UNAVAILABLE`과 원인을 반환 |
| React E2E | clean fat JAR을 새 임시 project workspace에서 기동해 Chromium 8/8 통과. 새 진단·저장/재열기 API, 전체 route, 그래프/매트릭스/Evidence, ZAP·Explorer 상태, XML import, 1280/900/600px 동선 확인 |
| 전체 빌드 | JDK 21.0.12.1·Maven 3.9.16 `mvn clean verify` 2회 성공 |
| Java | 매회 407 tests, failures/errors 0, opt-in 실물 ZAP·provider 하네스 2 skip |
| React | 매회 38 files / 250 tests, typecheck·notices·Vite build 통과 |
| 최종 JAR | 31,732,361 bytes / 9,161 entries / 첫 entry `META-INF/MANIFEST.MF` / SHA-256 `90334b08e0b3c5f35e0d4dc99b5c5e3af0fd085ff2505a8411a9ee7a0f370eec` |
| 미실행 | 실제 Burp 수집·자동 저장·재열기, Explorer account 귀속, ZAP 로그인 복수 계정/취소, Windows Docker Desktop, 계층 graph UX |

E2E 서버는 테스트마다 별도 임시 project root를 사용하고 종료 뒤 제거한다. 이는 패키지 React·local HTTP·SQLite 수명주기의 회귀 증거이며 Burp Montoya, ZAP Docker, Codex provider, 외부 대상 탐색을 통과했다는 뜻이 아니다.

## 2026-09-10 · 미출시 D-140~141 · 보존형 프로젝트·Evidence 작업면·가져오기 무결성 gate

D-139의 Explorer 선언과 D-138의 ZAP 계약을 유지한 채, 다른 대상을 시작할 때 현재 진단을 잃지 않는 프로젝트 수명주기와 Surface Observation의 실제 Evidence 작업 동선, 반복 import의 provenance·문자셋·IPv6 무결성을 보강했다.

| 항목 | 실제 확인 결과 |
|---|---|
| 프로젝트 회귀 | 사용자 workspace 이름·scope 정규화, 경로 이탈·Windows 예약 이름 거부, 충돌 없는 진단 디렉터리, 외부 DB 열기, 저장 상태 직렬화 통과 |
| 데이터셋·작업면 | `revision`과 `datasetRevision` 분리, 같은 데이터셋의 polling 중 Request Lab draft 보존, Surface Observation의 exact Evidence·Request Lab·Repeater 연결, Declaration-only 동작 부재 회귀 통과 |
| 병합 무결성 | 같은 HTTP라도 session fingerprint·lane account·run이 다르면 보존하고, 같은 provenance의 기존 multiplicity만 제외하는 회귀 통과 |
| XML/HAR | Burp XML EUC-KR request/response body 보존, XML IPv6 service 복원, HAR IPv6 단일 대괄호 정규화 회귀 통과 |
| 전체 빌드 | JDK 21.0.12.1·Maven 3.9.16 `mvn clean verify` 2회 성공. 최종 실행 1분 12초 |
| Java | 최종 실행 405 tests, failures/errors 0, opt-in 실물 ZAP·provider 하네스 2 skip |
| React | 최종 실행 38 files / 250 tests, typecheck·notices·Vite build 통과 |
| 최종 JAR | 31,728,851 bytes / 9,161 entries / 첫 entry `META-INF/MANIFEST.MF` / SHA-256 `91ff618304388408fe3a69e99ec72ef7ceed72a32f50dfc99ba7927db0003b6a` |
| 미실행 | 실제 Burp 새 진단 저장·재열기, disk-full/강제 종료, Surface→Request Lab→Repeater, XML binary·모든 legacy charset, Windows 프로젝트 경로, 최종 ZAP/Explorer 운영 gate |

자동 테스트는 저장 순서·직렬화·화면 연결과 parser 계약을 검증한다. 실제 파일시스템 장애에서의 내구성, Burp Montoya 원문 전달, 재시작 뒤 인증 세션 복구를 증명하지 않는다. raw Authorization/Cookie, 비밀번호, API key, provider token과 live Request Lab 원문을 프로젝트에 저장하지 않으므로 재열기 뒤 재로그인이 필요한 것은 의도된 경계다.

## 2026-09-09 · 미출시 D-139 · Explorer Evidence-bound 선언·서버 집계 gate

D-128 Explorer의 실제 provider 경로를 유지하면서, 응답 산출물에서 읽은 endpoint·parameter가 자유서술에만 남던 공백을 구조화했다. 선언은 현재 run의 응답 Evidence ID를 요구하고 실제 HTTP Observation·취약점 판정과 분리된다.

| 항목 | 실제 확인 결과 |
|---|---|
| 구조 회귀 | current-run 응답 Evidence 요구, scope 밖·가짜 Evidence·알 수 없는 필드·인증 header 거부, endpoint/parameter/provenance 중복 제거, UTF-8 64KiB inline·4MiB artifact 경계, 프로젝트 저장·재열기 통과 |
| Surface/UI | LLM 선언이 값 없는 parameter provenance와 함께 source filter에 연결되고, LLM Explorer OPTIONS probe는 기능 endpoint와 분리됨. 일반 HUMAN OPTIONS와 선언된 OPTIONS API는 보존 |
| 서버 집계 | 모델 마지막 메시지의 숫자를 사용하지 않고 HTTP 시도·응답 Evidence, endpoint·parameter 선언, probe를 coordinator가 계산하는 회귀 통과 |
| 실물 provider | 설치·로그인된 로컬 Codex app-server를 opt-in으로 실행해 local fixture의 HTTP dynamic tool → 응답 Evidence ID → 선언 dynamic tool 호출 1/1 통과 |
| 전체 빌드 | 최종 코드에서 JDK 21.0.12.1·Maven 3.9.16 `mvn clean verify` 연속 2회 성공 |
| Java | 매회 388 tests, failures/errors 0, opt-in 실물 ZAP·provider 하네스 2 skip |
| React | 매회 38 files / 248 tests, typecheck·notices·Vite build 통과 |
| 최종 JAR | 31,669,404 bytes / 9,143 entries / 첫 entry `META-INF/MANIFEST.MF` / SHA-256 `d00bcb35e36eb5e60e843e8d1a3bf8d425b4e35c9a32ade700780cbd8f949cf6`; 두 clean build가 byte-for-byte 동일 |
| 미실행 | 새 JAR의 실제 Burp load/unload, 실제 대상·계정·대형 번들 Explorer 완주, Windows, 독립 corpus endpoint/parameter 효능 측정 |

실물 provider 하네스는 Codex app-server가 두 dynamic tool을 실제 호출하고 FlowScope가 Evidence 결박 선언을 수락하는 protocol gate다. Burp Montoya 대상 전송이나 임의 SPA 번들의 완전한 의미 해석을 대신하지 않는다. 응답 산출물에 없는 server-only route, runtime-only lazy chunk, 임의 wrapper·동적 URL은 계속 미확정이며 선언을 실제 접근 성공이나 취약점으로 표시하지 않는다.

## 2026-09-09 · 미출시 D-138 · 실제 Burp 익명 Client 완주와 ZAP 상태 재시도

D-137 JAR을 실제 Burp에 로드한 macOS 환경에서 FlowScope Web·Docker ZAP·Burp scanner listener·crAPI를 함께 확인했다. 실행 전 `127.0.0.1:8089` ZAP 상태 probe 10회는 모두 `CONNECTED`와 version `2.17.0`을 반환했다. 같은 환경의 새 비로그인 캠페인은 다음과 같이 완료됐다.

| 항목 | 실측 결과 |
|---|---|
| run | `zap-baseline-1788925829413` |
| 단계 | `INITIALIZING → SESSION_SETUP → CLIENT_SPIDER → PASSIVE_SCAN_QUEUE → ALERTS_READY` |
| 소요 | 59초 |
| 수집 | SCANNER 14건, Client 14건, run에 연결된 고유 Evidence ID 10개 |
| 분석 | Alert 29건, snapshot complete, Passive 잔여 0 |
| 격리 | capability 거부 0건, 오류·경고 없음 |
| Surface | 현재 메인 비교에 포함된 operation 1개; 나머지 분류·필터 품질은 별도 평가 대상 |

이 결과는 실제 macOS Burp 8081 upstream에서 익명 `chrome-headless` Client 요청이 FlowScope SCANNER Evidence로 들어오고 캠페인이 종료됨을 확인한다. 로그인 계정 2개, 실패 계정, 정의 import, 취소, Windows Docker Desktop, 임의 대상의 발견 폭을 확인한 결과는 아니다.

같은 실행 중 ZAP이 살아 있고 뒤 probe가 성공했는데 한 번의 일반 probe 오류를 즉시 `UNREACHABLE`로 표시하는 결함을 분리했다. D-138은 일반 실패 1·2회를 `RETRYING`, 3회 연속 실패를 `UNREACHABLE`로 전이하고 성공 시 즉시 초기화한다. HTTP 401/403은 첫 응답에서 `AUTH_FAILED`다. JDK 21 전체 `mvn clean verify` 성공 실행은 매회 Java 383 tests(실패·오류 0, opt-in 실물 하네스 2 skip), React 38 files/247 tests와 release gate를 통과했다. 성공 빌드의 JAR은 31,653,652 bytes, 9,141 entries, SHA-256 `8481edf973e226d1cd21c8862364542a7d572b9ba56af1bf12eb8915b5ff8c3a`로 동일했다. 반복 중 한 실행은 기존 `InspectionPage.test.tsx` 두 항목이 각각 5초 timeout을 넘겨 실패했지만, 즉시 단독 재실행 22/22와 다음 전체 실행 247/247은 통과해 제품 회귀는 재현되지 않았다. 반복 부하에서의 테스트 시간 변동성은 남은 테스트 인프라 부채다. 최종 D-138 JAR의 실제 Burp 재로드와 화면 상태 전이 확인은 대기한다.

## 2026-09-09 · 미출시 D-137 · 인증 Evidence snapshot 지연 제거

D-136 코드를 실제 Burp 수집 순서와 대조하자 response handler의 원시 기록 추가와 분석 snapshot 게시 사이에 지연이 있었다. 분석 snapshot을 의도적으로 빈 상태로 유지한 회귀에서 기존 코드는 익명 lane 뒤 첫 인증 계정을 실패 처리해 후속 계정을 실행하지 못했다. 인증 gate를 현재 run·계정의 동기화된 원시 `ZAP_AUTHENTICATION` 기록으로 분리한 뒤 같은 회귀가 통과했다.

| 항목 | 실제 확인 결과 |
|---|---|
| RED 재현 | 원시 인증 응답은 존재하지만 `snapshot().records`가 비어 있으면 기대 lane `anonymous, zap-user-a, zap-user-b` 중 `anonymous`만 실행되고 테스트 실패 |
| 수정 | Burp 원시 저장소의 현재 run·계정·인증 source/detail만 복사하는 `authenticationEvidence` 경계 추가; 전체 Pipeline 강제 재실행·고정 sleep 없음 |
| 집중 회귀 | stale snapshot 계정 캠페인과 `ZapBrowserAuthenticatorTest` 통과 |
| 실물 하네스 | 사용자 8089와 분리한 API 18889/기록 프록시 18881에서 ZAP 2.17/Chromium으로 익명+정상 계정 2개 Client 완료(65 requests), 오류 비밀번호는 인증 단계 실패·Client 시작 전 차단 |
| 전체 자동 회귀 | JDK 21 `mvn clean verify`: Java 381 tests, failures/errors 0, opt-in 실물/provider 하네스 2 skip; React 38 files / 247 tests, typecheck·notices·Vite build와 release gate 통과 |
| 최종 산출물 | JAR 31,652,617 bytes / 9,140 entries / SHA-256 `50993c1b2526a58ff8fd29f8f8eb488b0bf83f645c3553d4ec7fc968052891e0`; distribution bundle 생성·구조 gate 통과. 검증 문서를 bundle에 포함하므로 자기 참조 hash는 정본에 고정하지 않음 |
| 남은 gate | 새 JAR을 실제 Burp에 재로드한 8081/UI 실행과 Windows Docker Desktop |

## 2026-09-09 · 미출시 D-136 · 인증 응답 Evidence gate

D-135의 Docker Chromium 경로를 그대로 사용하되, ZAP API action 응답을 로그인 성공으로 간주하던 계약을 폐기했다. 사용자 8089 ZAP과 격리한 실물 하네스에서 `authenticateAsUser`의 `OK`와 인증 시각만 검사하면 틀린 비밀번호도 통과해 Client Spider가 시작되는 것을 먼저 재현했다. 현재 구현은 사용자가 등록한 필수 로그인 성공 정규식과 선택적 로그아웃 정규식을 ZAP Context에 설정하고, 같은 run·`laneAccountId`·`ZAP_AUTHENTICATION`의 실제 응답 Evidence를 별도로 확인한다.

| 항목 | 실제 확인 결과 |
|---|---|
| 환경 | macOS arm64, Docker Engine/Desktop 29.5.3, digest 고정 공식 ZAP 2.17 base |
| 격리된 실물 하네스 | Compose project `flowscope-zap-runtime-test`, ZAP API 18889, 기록 프록시 18881, 합성 exact-scope target `http://flowscope-runtime.test/`; 사용자 8089 ZAP과 포트·project 분리 |
| 공식 add-on | Authentication Helper 0.41.0, Client 0.30.0. 잠시 검토한 미출시 0.43.0 직접 build와 Common Library binary는 최종 distribution에서 제거 |
| 오수락 재현 | ZAP action `OK`와 `lastSuccessfulAuthTimeInMs` 조합은 같은 사용자명의 틀린 비밀번호도 성공으로 처리해 Client Spider를 시작함. 성공 증거로 사용할 수 없음을 실물로 반증 |
| 정상 계정 | 익명 → alice → bob lane 완료. alice/bob은 각각 Client 단계의 `/api/me`에서 자기 사용자 응답을 받았고 계정 간 session 혼입과 capability 거부는 0건 |
| 오류 계정 | alice 사용자명과 틀린 비밀번호의 실제 인증 응답이 로그인 성공 정규식과 불일치해 lane이 `FAILED`; 해당 계정 Client Spider 요청 0건 |
| 집중 회귀 | ZAP account/auth/client/campaign/Web Java 회귀와 React Inspection 22 tests 통과 |
| 전체 자동 회귀 | JDK 21 `mvn clean verify`: Java 381 tests, failures/errors 0, opt-in 실물 하네스 2 skip; React 38 files / 247 tests, typecheck·notices·Vite build와 release gate 통과 |
| 최종 산출물 | JAR 31,651,530 bytes / 9,140 entries / SHA-256 `8708565ff18c04bbe94af26cce7c6da37cb732ea47fcedd9e78888ffbbd53b44` |
| 미실행 | 최종 JAR의 실제 Burp load/unload와 8081 capture, 승인 대상의 실제 로그인 화면, Windows Docker Desktop, CAPTCHA·MFA·WebAuthn·외부 SSO |

이 결과는 합성 로그인 폼과 기록 프록시에서 account lane의 실제 브라우저 요청·응답·실패 차단을 확인한 것이다. 실제 대상별 성공/실패 문구를 자동으로 의미 해석했다는 뜻은 아니며, 성공 정규식은 로그인 전·실패 화면에는 없고 성공 응답에만 나타나는 값을 진단자가 제공해야 한다. API action의 수락이나 status code만으로 로그인 성공을 확정하지 않는다.

## 2026-09-09 · 미출시 D-135 · FlowScope Docker Chromium ZAP 단일 runtime

PR #10은 충돌 상태의 옛 MCP/Session Broker 구조와 Firefox fallback을 포함하므로 병합하지 않았다. 대신 사용자가 Web에서 로그인 URL·ID·비밀번호를 등록하고 ZAP이 Browser Based Authentication을 수행한 뒤 계정 지정 Client Spider를 실행하는 흐름을 현행 `ZapAccountVault`·`ZapCampaign`·React에 유지했다. 실행 환경은 distribution bundle의 custom Docker image 하나로 줄이고 비로그인·로그인 모두 `chrome-headless`를 명시했다.

| 항목 | 실제 확인 결과 |
|---|---|
| 환경 | macOS arm64, Docker Engine/Desktop 29.5.3, ZAP 2.17.0 digest base |
| custom image | Debian 저장소의 Chromium `152.0.7977.82`, ChromeDriver `152.0.7977.82`; 컨테이너 user `zap` |
| 시작 전 browser gate | browser/driver 실행 파일·version 파싱·동일 주 버전·임시 profile의 실제 `--headless=new --dump-dom about:blank` 기동을 확인한 뒤에만 ZAP 시작 |
| sandbox 경계 | Docker 기본 namespace에서 Chromium sandbox가 `Failed to move to new namespace ... Operation not permitted`로 실패함을 직접 확인. broad capability/seccomp 완화 없이 Chromium 인수에만 `--no-sandbox` 사용 |
| managed runtime gate | 모든 캠페인이 `zapHomePath=/run/flowscope-zap/...`를 요구. 임의 disk-backed/API runtime은 비로그인도 시작 전에 거부 |
| 실제 helper/doctor | `./scripts/zap-up.sh`가 image build·recreate·health 완료. `./scripts/doctor.sh --mode zap`은 HUMAN 8080, SCANNER 8081, key, ZAP 2.17 API, Burp upstream, 필수 add-on, Web을 확인해 failures 0 / warnings 0 |
| 실제 Client Spider | exact Context와 target `http://127.0.0.1:8888/`, `browser=chrome-headless`, `subtreeOnly=true`, `scopeCheck=STRICT`로 실물 ZAP API 실행. scan id 0, status 100, target HTTP 200 수집 1건 확인 |
| 집중 자동 회귀 | `ZapStartupScriptTest,ZapClientTest,ZapCampaignRegressionTest,ZapBrowserAuthenticatorTest,FlowScopeWebServerTest`: Java 68 tests, failures/errors 0 |
| 전체 자동 회귀 | JDK 21 `mvn clean verify`: Java 375 tests, failures/errors 0, opt-in provider 1 skip; React 38 files / 247 tests, typecheck·notices·Vite build 통과 |
| 최종 산출물 | JAR 31,649,129 bytes / 9,140 entries / SHA-256 `d03c5a602f8c06f3e345468f1b69adb5557b6b3cfc04fd500a04e8dec87ca8c3`; streaming manifest의 Java 21·Main-Class·Multi-Release 확인 |
| 배포 구조 | bundle에 `infra/zap/Dockerfile` 포함, macOS/Linux·Windows `zap-up`이 `docker compose up --build --wait` 사용, CI가 Dockerfile 존재를 검사 |
| 미실행 | beta.46 JAR의 실제 Burp load/unload, ZAP Browser Based Authentication 성공/실패, SCANNER `laneAccountId` 귀속, 복수 계정 격리·취소, Windows Docker Desktop 실기기 |

이 검증은 가짜 ZAP의 `OK`가 아니라 실물 컨테이너의 Chromium WebDriver와 Client Spider가 실제 HTTP 응답을 만든 사실까지 확인한다. 다만 직접 ZAP API로 실행한 비로그인 Client 한 건이 FlowScope의 전체 계정 캠페인, Burp capture, 로그인 성공을 대신하지 않는다. 다운로드 사용자는 호스트 Chrome·ChromeDriver·ZAP Desktop을 별도로 설치할 필요가 없지만, Docker Desktop/Engine과 최초 image build를 위한 package network는 필요하다. Debian package version은 Dockerfile에 숫자로 고정하지 않았으므로 이 로컬 `152.0.7977.82`를 모든 향후 빌드의 동일 버전이라고 주장하지 않는다.

## 2026-09-08 · 미출시 D-134 · ZAP 2.17 로그인 REST 호환 수정

실제 Burp 로그인 lane에서 D-133까지의 빌드가 session·Context 생성 후 HTTP 400 `no_implementor`로 중단되는 것을 재현했다. 실행 중인 공식 ZAP 2.17.0 Docker API에는 `authentication`과 `sessionManagement` component가 있지만 기존 코드가 호출한 `/JSON/verification/action/setVerificationMethod/`는 없었다. 제공 Compose 컨테이너를 현재 정의로 다시 만든 뒤 tmpfs `/run/flowscope-zap`과 ZAP doctor 0 failure/0 warning을 확인했고, 그 다음에야 이 두 번째 실패를 분리해 확인했다.

| 항목 | 실제 확인 결과 |
|---|---|
| 환경 | macOS arm64, Homebrew JDK 21.0.12.1, 공식 ZAP 2.17.0 Docker 컨테이너 |
| 실물 실패 재현 | 로그인 lane의 verification action에서 HTTP 400 `no_implementor`; ZAP 로그의 `ApiException: NO_IMPLEMENTOR`와 API component 부재 확인 |
| 코드 수정 | 지원되지 않는 verification action 제거. Browser Based Authentication, Auto-Detect Session Management, temporary user/credentials, 명시적 `authSuccessful=true`, strict Client 범위 안 응답 gate 유지 |
| FakeZap 회귀 | 존재하지 않는 verification endpoint의 가짜 `OK` 제거; 인증 흐름이 `/JSON/verification/`을 호출하지 않는다고 명시적으로 검사 |
| 집중 Java | `ZapClientTest,ZapBrowserAuthenticatorTest` 통과 |
| 전체 빌드 | JDK 21에서 `mvn clean verify` 1회 성공, 1분 47초 |
| Java | 370 tests, failures/errors 0, opt-in provider 하네스 1 skip |
| React | 38 files / 247 tests, typecheck·Vite build 통과 |
| 산출물 | JAR 31,649,145 bytes / 9,140 entries / SHA-256 `6dca01097eb75e5c2809b23ce8aabdc2083b2e071e6d94367e76ada73e349860` |
| 정적 검사 | `git diff --check` 통과 |
| 미실행 | 수정 JAR의 실제 Burp 재로드 후 대상 Browser Based Authentication, Client capture, capability 전달, 복수 계정 격리, Windows 실기기 |

이 검증은 존재하지 않는 REST 호출이 다시 추가되지 않고 기존 빌드 계약이 깨지지 않았음을 확인한다. 실제 인증 성공이나 Client Spider의 대상 탐색 성공은 아직 확인하지 않았으므로 완료로 기록하지 않는다. ZAP 공식 문서가 API auto-detection을 지원하지 않는다고 명시하는 것과 Automation Framework의 verification `autodetect` 설정은 서로 다른 인터페이스다. 이번 수정은 현재 REST 캠페인을 유지하며 지원되지 않는 호출만 제거했다.

## 2026-09-08 · 미출시 D-130~D-133 · ZAP 직접 인증·휘발성 환경·Client 단일 실행·Docker API gate

`352ce1a`의 D-129 distribution bundle 위에 ZAP 직접 브라우저 인증 계정 lane, 휘발성 Docker 작업공간, Client Spider 단일 실행과 실물 Docker API 호환 수정을 추가한 미출시 작업 결과다.

| 항목 | 실제 확인 결과 |
|---|---|
| 환경 | macOS arm64, Homebrew JDK 21.0.12.1, 로컬 공식 ZAP 2.17.0 Docker 컨테이너 |
| 전체 빌드 | 같은 코드 입력에서 `mvn clean verify` 2회 성공 |
| Java | 매회 370 tests, failures/errors 0, opt-in provider 하네스 1 skip |
| React | 매회 38 files / 247 tests, typecheck·notices·Vite build 통과 |
| 집중 Java | `ZapAccountVaultTest,ZapBrowserAuthenticatorTest,ZapClientTest,ZapCampaignRegressionTest,TrafficClassifierTest,PipelineClassificationTest,FlowScopeWebServerTest,FlowScopeExtensionPhaseTest` 통과 |
| 집중 React | `InspectionPage.test.tsx`, `client.test.ts` 28 tests 통과, typecheck 통과 |
| 비밀·귀속 계약 | Web/snapshot은 username/password를 반환하지 않음, 임시 secret copy 폐기, 명시적 `authSuccessful=true` 뒤에만 account crawler·SCANNER lane identity 사용 |
| 격리·정리 계약 | lane별 휘발성 ZAP session/Context/user, account Client Spider, direct-auth header 보존, ZAP campaign initiator 제한, 로그인 준비 traffic의 coverage/count 제외, 성공/실패/취소의 user/Context cleanup 자동 회귀 |
| Client 단일 실행 | 새 캠페인은 Traditional/AJAX를 호출하지 않으며 Client 실패·terminal 대기 실패·범위 안 Client 응답 0건을 lane 실패로 유지. 상태는 `client_captures`만 노출 |
| UI 기능 보존 | target별 ZAP 로그인 계정, 로그인/브라우저/경과/heartbeat, Client 진행·수집량, OpenAPI·GraphQL·Postman·SOAP 정의 입력, 캠페인 취소 component 회귀 |
| 실물 선행 조건 | 컨테이너에 Firefox와 `authhelper`·`client`·`selenium` add-on 존재 확인 |
| 실물 Docker API | 기존 8089와 분리한 임시 8090 project에서 host 요청의 Compose bridge gateway allowlist, API 준비, exact form POST 200을 확인. charset 포함 form·JSON POST는 ZAP 2.17에서 400 `content_type_not_supported` |
| 실물 session/Replacer | `zapHomePath`가 `/run/flowscope-zap/` tmpfs 아래임, initiator 18 Replacer 규칙이 이름 없는 `newSession` 뒤에도 유지됨, tmpfs session 파일 408개, `/home/zap/.ZAP/session` 파일 0개 확인 |
| 실제 doctor | ZAP API/version/upstream/add-on/Web 통과. Burp SCANNER listener `127.0.0.1:8081`은 CLOSED |
| 산출물 | JAR 31,649,268 bytes / 9,140 entries, bundle 57 entries. JAR SHA-256 `78868e06a2af099df26e5cbc9254daf42bacc791bdee8aaa1c321e940612cb24` |
| 반복 패키징 | D-133 회귀를 포함한 두 clean verify의 JAR·bundle SHA-256이 각각 동일. 이 문서의 최종 수치까지 포함한 clean package 2회에서도 JAR·bundle SHA-256이 각각 동일. bundle은 이 문서를 포함하므로 자기 크기·해시를 문서 안에 고정하지 않음 |
| 정적 운영 검사 | `git diff --check`, Bash 5개 `bash -n`·`shellcheck`, `docker compose config --quiet`, manifest 첫 엔트리·폐기 MCP/Judge 클래스 부재·MR namespace 검사 통과 |
| 미실행 | 실제 target browser 로그인, Burp 8081 capture, 복수 계정 격리, Windows PowerShell 실기기 |

현재 자동 결과는 FlowScope의 API 호출 순서·상태·비밀·정리 계약을 검증한다. FakeZap은 실제 Firefox 로그인이나 대상 크롤링을 수행하지 않는다. 별도 실물 gate는 Docker API 접근·form 호환·tmpfs session·Replacer 규칙 수명까지만 확인했다. `doctor.sh --mode zap`은 ZAP API 2.17.0, upstream 8081 설정, 필수 add-on과 Web을 확인했지만 실제 Burp listener가 닫혀 1 failure로 종료했다. 따라서 실물 target end-to-end 성공을 주장하지 않는다. CAPTCHA·MFA·WebAuthn·복합 SSO 지원도 검증하지 않았다. PowerShell은 이 머신에 `pwsh`가 없어 파싱하지 못했다.

## 2026-09-08 · 미출시 D-129 · 다운로드 bundle·환경 점검 gate

`5da5b08`의 D-128 Explorer 위에 distribution bundle, 기능별 doctor와 Explorer readiness 재확인을 추가한 작업트리다. 원격 Release에는 아직 게시하지 않았다.

| 항목 | 실제 확인 결과 |
|---|---|
| 환경 | macOS arm64, Homebrew JDK 21.0.12.1, Maven 3.9.16, Maven 고정 Node 24.11.1 |
| 전체 빌드 | `mvn clean verify` 2회 성공, 52.042초 / 50.949초 |
| Java | 매회 352 tests, failures/errors 0, opt-in provider 하네스 1 skip |
| React | 매회 38 files / 242 tests, typecheck·notices·Vite build 통과 |
| readiness 회귀 | provider cache 무효화, 실행 중 재확인 거부, Web `recheck` 위임, 설치·로그인 안내와 READY 전 시작 비활성 |
| 셸 점검 | Bash helper 5개 `bash -n`·`shellcheck` 통과. 실제 `doctor.sh --mode explorer --build`는 Codex·로그인·Web·Maven·JDK 21 확인 0 failures; 기본 JDK 26은 1 failure로 종료 |
| 산출물 구조 | JAR 1개 9,130 entries. bundle 1개 57 entries이며 JAR, LICENSE/NOTICE/README/SECURITY, 한·영 문서, doctor/ZAP helper, ZAP Compose를 포함 |
| 반복 패키징 | 같은 입력의 `mvn clean package -DskipTests` 2회에서 JAR과 bundle SHA-256이 각각 동일. JAR은 31,627,230 bytes, SHA-256 `8401c18017b172e39137abfb62b8fc5f3a81cf7c54b9c2b18cd84b78ea8ed977` |
| clean extraction | `/tmp`의 새 디렉터리에 bundle을 풀어 필수 파일, Bash 실행 권한·구문, ZAP key helper, `docker compose config --quiet`, 추출본 Explorer/build doctor를 통과 |
| 현재 자동화 경계 | 다운로드 사용자는 Maven·Node.js·npm 불필요. HUMAN/Explorer만 쓰면 JAR 단독 가능. ZAP helper까지 쓰면 bundle 필요 |
| 미실행 | Windows PowerShell 실기기, 실제 Burp 최종 JAR load/unload, 실물 ZAP/Explorer 전체 대상 실행 |

이 표는 설치·배포 동선과 회귀 결과다. endpoint 발견률, 취약점 판정 정확도, ZAP 실물 크롤링, 모든 Codex CLI 버전 호환을 증명하지 않는다. bundle은 이 문서 자체를 포함하므로 자기 SHA-256을 내부에 기록하지 않는다. 게시할 최종 bundle 해시는 Release 자산과 외부 결과에서 식별한다.

## 2026-09-07 · 미출시 D-128 · 독립 LLM Explorer 자동·실물 provider gate

`453c0ba`에서 시작해 로컬 commit `5da5b08`로 고정한 D-128 JAR이다. 원격 Release에는 게시하지 않았다.

| 항목 | 실제 확인 결과 |
|---|---|
| 환경 | macOS arm64, Homebrew JDK 21.0.12.1, Maven 3.9.16, Maven 고정 Node 24.11.1 |
| 최종 빌드 | 같은 최종 코드·문서 입력에서 `mvn clean verify` 2회 성공, 51.681초 / 50.270초 |
| Java | 매회 350 tests, failures/errors 0, opt-in provider 하네스 1 skip |
| React | 매회 38 files / 241 tests, typecheck·notices·Vite build 통과 |
| Explorer 회귀 | account secret 비노출/폐기, HTML form·JSON login·redirect·validation, GET password form 거부, exact scope, 보호 header 주입/차단, method·요청 상한·성공 중복 차단·전송 실패 재시도, 실제 응답 완료 gate, 취소 경합, Web API·React 피드 |
| 대형 발견 응답 | HTML/JavaScript/JSON/XML 분석 상한 4MiB와 1.4MiB JavaScript capture→record 회귀 통과 |
| 실물 provider | `-Dflowscope.harness=true`로 설치·로그인된 로컬 Codex app-server를 실제 실행해 experimental dynamic HTTP tool 호출과 구조화된 종료 결과 확인, exit 0 |
| 산출물 | `target/flowscope-1.2.0-beta.44.jar`, 31,626,205 bytes, 9,130 entries |
| SHA-256 | 두 clean verify 모두 `762728bff34d9d4d9d9f3a695d43fc5ed6ede25a9900c6db552affdcc268d87b` |
| JAR 경계 | `io/flowscope/explorer/*`와 `explorer/explorer-system.md` 포함. `McpServer`, agent-workspace, Judge runtime class/resource는 없음. 기존 manifest/MR/namespace/license 검사는 Maven release gate 통과 |

실물 provider 하네스는 로컬 fixture에 대한 dynamic-tool 프로토콜과 모델 호출 가능성을 확인한다. 실제 Burp Montoya 대상 전송, anonymous·HTML form·JSON token 계정 전체 실행, TLS/redirect, steer·취소 후 프로세스 정리, Windows 탐지는 확인하지 않는다. crAPI나 외부 대상의 endpoint·parameter 발견률, 미탐·오탐, HUMAN/ZAP 대비 우월성도 측정하지 않았다. app-server dynamic tools는 experimental API이므로 이번 설치본 통과를 향후 모든 Codex CLI 호환 보장으로 확대하지 않는다.

직접 shell curl 방식은 `networkAccess=false` sandbox에서 loopback gateway에 연결되지 않는 실패를 확인했고, 광범위 네트워크 허용은 exact-scope gateway를 우회할 수 있어 최종 구현으로 쓰지 않았다. 현재는 모델 일반 네트워크를 끄고 Java가 app-server의 `item/tool/call`을 받아 capability를 모델/자식 환경에 노출하지 않은 채 gateway를 호출한다.

## 2026-09-07 · 미출시 D-126 · Judge·Explorer 하네스·MCP 제거 최종 gate

`57d1bb4`의 **제거 완료 소스**로 만든 JAR이다. 아래 1단계 분리 JAR 및 이전 beta.44 Release와 다르며 원격 배포하지 않았다.

| 항목 | 실제 확인 결과 |
|---|---|
| 환경 | macOS arm64, Homebrew JDK 21.0.12, Maven 3.9.16, Maven 고정 Node 24.11.1 |
| 최종 빌드 | 같은 최종 소스에서 `mvn clean verify` 2회 성공, 51.778초 / 48.489초 |
| Java | 매회 335 tests, failure/error/skip 0 |
| React | 매회 37 files / 238 tests, typecheck·고지 생성·Vite build 통과 |
| 삭제 부재 회귀 | `RetiredHarnessTest` classpath 검사, `FatJarIsolationSmoke` 최종 JAR 클래스·nested 클래스·agent-workspace 부재 검사 |
| 폐기 API | `/api/llm-run`, `/api/ai-preview`, `/api/ai-scenarios`, `/mcp` GET/POST 404 — Web 회귀 |
| 보존 회귀 | ZAP 캠페인 13개 직접 상태 회귀 + 기존 3개, HUMAN 완료·계정·scope·capability·Request Lab·인가·Surface·그래프·JSON/SQLite 전체 기존 suite |
| 과거 데이터 | 기존 평가 4MiB 제한 회귀, 같은 현재 finding ID의 과거 CONFIRMED가 현재 후보에 합쳐지지 않음, JSON→SQLite 평가/판정/Evidence ID 왕복, snapshot 날짜·비밀 마스킹·read-only, 과거 평가 ID의 새 review 거부 |
| 산출물 | `target/flowscope-1.2.0-beta.44.jar`, 31,535,956 bytes, 9,098 entries |
| SHA-256 | 두 빌드 모두 `acfeb7c745f69040239eca77f0933e76d3588338e18683979b050d44498bd981` |
| 기존 JAR 검사 | streaming manifest, MR relocation 전수 경계, namespace·서드파티 고지·격리 class loading·SQLite gate 통과 |
| 최종 packaged browser | 위 해시 JAR의 별도 `127.0.0.1:38177` standalone에서 Playwright Chromium 8 / 8 통과, 24.0초. 새 브라우저 context로 화면 전환·그래프/매트릭스/sequence·규칙 후보/Evidence·계정 메타데이터·읽기 전용 Request Lab·ZAP 설정·옛 LLM 제어 부재·legacy를 검사 |
| 브라우저 경계 | 외부 origin·능동 실행 API를 테스트에서 차단하며 console/pageerror·브라우저 저장소 secret 회귀 유지. 실제 target HTTP 전송은 하지 않음 |
| 셸 | `bash -n scripts/doctor.sh`와 `git diff --check` 통과. 이 머신에 `pwsh`가 없어 PowerShell 파싱은 미실행 |

최종 브라우저 명령은 고정 Node PATH와 테스트 전용 임시 `PLAYWRIGHT_BROWSERS_PATH`, `FLOWSCOPE_E2E_ORIGIN=http://127.0.0.1:38177`로 `npm run e2e -- --reporter=line`을 실행했다. 최초에는 해당 테스트 Chromium이 설치되지 않아 실패했고 임시 cache에 headless shell을 설치했다. 제품의 Explorer 브라우저 기능이나 새 사용자 설치 의존성을 추가한 것이 아니다. 최초 E2E의 기본 route·옛 후보/평가 문구 기대도 현재 계약에 맞췄으며, 최종 8개는 실패·재시도 없이 통과했다.

실물 ZAP API/Firefox·Client 확장·로그인 계정·upstream capability, 실제 Burp load/unload·HUMAN 캡처·Request Lab 전송, Windows 실환경은 **미실행**이다. mock은 FlowScope의 상태 처리만 증명한다. 크롤러 시작 API 반환 중 취소 경합은 남은 gate이며 이번 제거로 해결했다고 주장하지 않는다. 반복 JAR 해시 일치는 이 머신·고정 도구·같은 소스에서만 검증했으며 임의 OS/JDK 전체 재현 보장이 아니다. 사용자 Burp/ZAP 프로세스나 전역 모델 인증·MCP 설정은 건드리지 않았다.


## 이전 산출물 검증 이력 — 현재 gate와 분리

아래 수치·성공·실패·재실행 대기는 각 당시 산출물 기준이다. D-126으로 제거된 옛 Explorer/Judge/MCP 재실행은 현행 gate가 아니다. D-122의 helper/parser 회귀만으로는 live record 전달을 증명하지 못했지만, 후속 D-128이 발견용 응답의 4MiB `FULL` 보존과 1.4MiB capture→record 회귀로 해당 연결을 닫았다. 이는 실제 Burp 대상의 대형 번들 운영 검증이나 4MiB 초과 지원을 뜻하지 않는다. 이번 문서 감사는 이전 측정값을 바꾸거나 실환경 검증으로 승격하지 않는다.

## 2026-09-07 · 미출시 작업트리 · ZAP 캠페인 분리 gate

`c006679` 기반의 Judge·MCP 제거 **1단계** 산출물이다. Judge·MCP 자체는 남아 있으며 기존 beta.44 릴리스 검증을 대체하지 않는다.

| 항목 | 실제 확인 결과 |
|---|---|
| 환경 | macOS 14.8.3 arm64, Homebrew JDK 21.0.12, Maven 3.9.16 |
| 전체 빌드 | `mvn clean verify` 2회 모두 성공. 두 번째는 MCP 참조 volatile 게시까지 반영한 최종 입력, 59.595초. 소스가 다른 두 회차이므로 재현 해시 비교가 아님 |
| Java | 389 tests, failure/error/skip 0 |
| React | 37 files / 266 tests, typecheck·Vite build 통과 |
| 분리 회귀 | MCP 없는 완료·진행·합성 Evidence, MCP 포트 bind 실패, 공유 adapter 종료와 캠페인 종료 소유권, scope·독립 Explorer·lock 거부 |
| 기존 회귀 | HUMAN 캡처 분류·인가 규칙·Session Broker·Web·JSON/SQLite·Explorer/MCP 및 ZAP adapter 테스트 통과 |
| 이동 검증 | ZAP 메서드 본문 1,427줄은 접근 수식자·lock provider 치환 외 원본과 동일. `jdeps -filter:none`에서 캠페인 및 내부 클래스의 MCP transport 타입 참조 없음 |
| 산출물 | `target/flowscope-1.2.0-beta.44.jar`, 31,686,464 bytes |
| SHA-256 | `caad2cc831d58fe3c5d6e4ef880ccf0f6de28676f58be1c554b396c626daba2d` |
| 검사 범위 | manifest·MR relocation·namespace·라이선스 등 기존 최종 JAR gate 통과. 두 번 빌드 동일성과 교차 머신 재현은 이번에 검사하지 않음 |
| 미실행 | 실제 Burp 재로드, 실물 ZAP Client 브라우저·capability upstream·로그인 lane·취소, endpoint 발견률 평가 |

FakeZap은 기존 ZAP HTTP 응답을 모사한다. 위 회귀는 오케스트레이션과 데이터 경계를 검증하며 실제 크롤링 성공을 증명하지 않는다.

## 1.2.0-beta.44 SPA 번들 분석·자산 frontier·익명 계정 gate

| 검증 항목 | 현재 확인 결과 |
|---|---|
| 실환경 측정 | 실제 Explorer가 `SUCCEEDED`로 끝났으나 수집 4건(`/`, `main.js`, `manifest.json`, `main.css`)이 전부 정적 자산·문서로 분류돼 메인 비교 0건. surface extraction이 번들 evidence에 `PARTIAL` |
| 번들 실측 | crAPI `main.js` 1,655,900 bytes. 경로 문자열 58개 전부 1MB 지점 이후, 64KB 프리뷰 안 0개. `identity/api`·`community/api`·`workshop/api` 0회이며 API 경로는 번들에 없음 |
| 분석 상한 회귀 | `JavascriptCallSiteAnalyzerTest` — 1.2MB 뒤의 `fetch` call site를 `PARSED`로 해석. 4,194,304자 초과는 여전히 `LIMIT_EXCEEDED` |
| 보존 경계 회귀 | `BoundedHttpCaptureTest` — 1.4MB 스크립트가 `complete=false`·`OVER_LIMIT_METADATA_ONLY`·`payload.text()==null`을 유지한 채 분석문에는 1MB 이후 call site 포함. CSS·PNG·null 미디어는 프리뷰 상한 64KB 불변 |
| 자산 frontier 회귀 | `McpServerTest` — `.css`·`.woff2`가 `pending_targets`에서 제외되고 `.js`와 API 경로는 유지 |
| 익명 계정 회귀 | `McpServerTest` — 익명 run에서 `account_id=ANONYMOUS`가 오류 아님. `LocalLlmRunnerTest` — 프롬프트에 `Never pass account_id` 포함, 옛 `Selected Explorer account_id: ANONYMOUS` 부재 |
| 전체 회귀 | JDK 21.0.12·Maven 3.9.16 `mvn clean verify` 1회, Java 382 tests(직전 378 + 신규 4)·failure/error/skip 0, React typecheck·vitest는 같은 verify 안에서 통과. 산출물 `flowscope-1.2.0-beta.44.jar` 31,676,803 bytes. 문서의 beta.44 릴리스 SHA-256은 이 빌드에 적용되지 않음 |
| 기존 회귀 조정 | `SurfaceAnalyzerTest`의 입력상한 사례를 1,048,577자에서 4,194,305자로 올려 새 상한을 계속 검사한다. 단언은 그대로이며 약화하지 않았다 |
| 실제 Burp 재실행 | **대기** — 수정 JAR로 Explorer 재실행 시 번들에서 화면 경로가 후보로 잡히는지, CSS 요청이 사라지는지, 계정 인자 실패가 0건인지 확인 |
| 미해결 | crAPI API 경로는 번들에 없어 이 수정만으로는 드러나지 않는다. 화면 경로 브라우저 순회가 별도 필요 |

## 1.2.0-beta.44 통제 요청 target 계약 gate

| 검증 항목 | 현재 확인 결과 |
|---|---|
| 실환경 재현 | 실제 Explorer가 `{"method":"GET","target":"/chatbot/genai/state"}`를 보내 `target is outside configured scope`로 실패(원장 `SCOPE_BLOCKED` 1). 스키마에 형식 설명 없음, 후보 출력이 `service`와 경로를 분리 |
| 후보 출력 회귀 | `McpServerTest` — `pending_concrete_paths[0]="/v1/coupons"`일 때 `pending_targets[0]="https://api.example.test:443/v1/coupons"` |
| 형식 오류 회귀 | 상대 경로 `target`이 실행기 전에 거부되고 오류 문구에 `absolute URL`·`pending_targets` 포함, 원장 outcome `INVALID_REQUEST`(`SCOPE_BLOCKED` 아님) |
| 스키마 회귀 | `tools/list`의 `target` 설명에 `Absolute URL only` 포함 |
| 전체 회귀 | JDK 21.0.12·Maven 3.9.16 `mvn clean verify` 1회, Java 378 tests(직전 377 + 신규 1)·failure/error/skip 0, React typecheck·vitest는 같은 verify 안에서 통과. 산출물 `flowscope-1.2.0-beta.44.jar` 31,675,820 bytes. 문서의 beta.44 릴리스 SHA-256은 이 빌드에 적용되지 않음 |
| 실제 Burp 재실행 | **대기** — 수정 JAR로 Explorer 재실행 시 상대 경로 실패 0건, `pending_targets` 사용 확인 |

## 1.2.0-beta.44 LLM 작업 피드 가시성 gate

| 검증 항목 | 현재 확인 결과 |
|---|---|
| 실환경 재현 | 실제 Explorer 실행의 도구 호출 11건 실패가 피드에 전부 `COMPLETED`로 표시되고 사유가 없었음. 출력 tail 원문에만 `{"error":"target is outside configured scope"}`가 있었음 |
| 실패 상태·사유 회귀 | `LocalLlmRunnerTest` — Codex `item.completed`의 `status:"failed"` item이 `FAILED`, 제목 `대상 읽기 · GET /chatbot/genai/state`, 사유에 scope 오류 문장, 인자의 `authorization` 값 미노출. 성공 item은 `완료`와 `durationMillis`·`elapsedMillis` 보유 |
| 한국어 지시 | 프롬프트 미리보기에 운영자용 메시지 한국어 지시 포함 회귀 통과 |
| React 피드 | `RunsPage.test.tsx` — LLM 탭에 `LLM 작업 피드` 영역, 행동명, `실패 · ...` 사유, `1.2s`·`1m 05s` 경과, `87ms` 소요 렌더링 |
| 전체 회귀 | JDK 21.0.12·Maven 3.9.16 `mvn clean verify` 1회, Java 377 tests(직전 376 + 신규 1)·failure/error/skip 0, React typecheck·vitest는 같은 verify의 `npm run verify` 단계에서 통과. 산출물 `flowscope-1.2.0-beta.44.jar` 31,675,235 bytes. 문서의 beta.44 릴리스 SHA-256은 이 빌드에 적용되지 않음 |
| 실제 Burp 재실행 | **대기** — 수정 JAR로 Explorer를 다시 실행해 실패 항목이 빨갛게, 성공 항목이 행동명·소요 시간으로 보이고 모델 보고가 한국어인지 확인 |

## 1.2.0-beta.44 Explorer 완료 교착 gate

| 검증 항목 | 현재 확인 결과 |
|---|---|
| 실환경 재현 | 실제 Burp(scope `http://127.0.0.1:8888/`, 계정 미등록·ANONYMOUS)에서 Codex Explorer 2회 실행이 모두 `LLM이 활성 run을 정상 종료하지 않았습니다`로 실패. 스냅샷 `events`에는 각 run의 `LLM_EXPLORER`·`CONTROLLED`·200 기록이 9건·12건 존재했고 두 번째 run에 `HEAD /`·`OPTIONS /chatbot/genai/state` 포함. `runExecutions`는 `시도 11·응답 0·실패 11`(`SCOPE_BLOCKED` 1·`INVALID_REQUEST` 10)과 `시도 12·응답 0·실패 12`(`INVALID_REQUEST` 12) |
| 원인 확인 | `FlowScopeExtension` 통제 실행기가 `Pipeline.runIsolated` 뒤 원본 `record.evidenceId`(항상 `null`)를 반환. `RunExecutionLedger.Attempt`의 `HTTP_RESPONSE` Evidence ID 요구로 `recordExecution`이 예외, `attemptRecorded` 전이라 `INVALID_REQUEST` 재기록. `end_run`이 `ALL_FAILED`를 응답 Evidence보다 먼저 검사 |
| 재현 회귀 | 수정 전 `McpServerTest` 신규 테스트가 `outcome=INVALID_REQUEST, status=0, evidenceId=null`로 실패함을 확인. 수정 후 통과 |
| ID 일치 회귀 | `EvidenceIdsTest` — 원본에 부여한 ID가 `runIsolated` 스냅샷 복사본과 동일 |
| 전체 회귀 | JDK 21.0.12·Maven 3.9.16 `mvn clean verify` 1회, Java 376 tests(기존 374 + 신규 2)·failure/error/skip 0, React 테스트는 같은 verify 안에서 통과. 산출물 `flowscope-1.2.0-beta.44.jar` 31,672,053 bytes. 소스가 바뀌었으므로 아래 gate에 기록된 beta.44 SHA-256은 이 빌드에 적용되지 않으며, 릴리스 해시는 병합 뒤 D-118 환경에서 다시 만든다 |
| 실제 Burp 재실행 | **대기** — 수정 JAR로 같은 대상의 Explorer를 다시 실행해 `RESPONSES_OBSERVED`와 정상 `end_run`을 확인해야 함 |

이 gate는 응답 Evidence가 있는 run이 원장 회계 오류로 닫히지 않는 문제를 자동 회귀로 고정한다. 같은 실행에서 확인된 `target` 절대 URL 계약 부재(모델이 `service`와 경로를 이어 붙이지 않아 `SCOPE_BLOCKED`)와 작업 피드의 도구 실패 미표시는 이 gate의 범위가 아니며 별도로 남아 있다.

## 1.2.0-beta.44 LLM 실행 실패 가시성 gate

| 검증 항목 | 현재 확인 결과 |
|---|---|
| 실행 품질 | 실행 전 `NOT_ATTEMPTED`, TLS 실패만 있는 `ALL_FAILED`, 응답+timeout의 `PARTIAL_FAILURE`, 응답만 있는 `RESPONSES_OBSERVED` 회귀 통과 |
| Evidence 분리 | 실패 시도는 `RequestRecord`/snapshot event를 만들지 않고 HTTP 응답 시도만 status·Evidence ID를 갖는 회귀 통과 |
| 비밀 경계 | target query를 실행 원장 path에서 제거하고 header·body·raw exception을 schema에 두지 않는 회귀 통과 |
| 완료 gate | 통제 요청이 전부 실패한 Explorer의 종료 거부 회귀 통과. 일부 실패 completion limitation은 전체 완료 fixture에서 추가 확인 예정 |
| 저장 | JSON v4·SQLite v3에 typed 실행 시도를 저장·재열고, query가 복원되지 않는 회귀 통과 |
| Web 계약 | snapshot `runExecutions`와 UI의 실행 품질·시도·응답·실패 표시 문자열 회귀 통과 |
| 집중 회귀 | `RunExecutionLedgerTest,McpServerTest,ProjectStoreTest,SqliteProjectStoreTest,SnapshotJsonWriterScaleTest,FlowScopeWebServerTest` 통과 |
| 전체 회귀 | 아래 React 통합과 MR-JAR 전수 회귀를 포함한 고정 최종 입력에서 JDK 21.0.12·Maven 3.9.16 `mvn clean verify` 연속 2회, 매회 React 37 files/265 tests와 Java 374 tests, failure/error/skip 0 |
| 배포물 | 위 명시 환경의 `target/flowscope-1.2.0-beta.44.jar` 하나, 31,672,031 bytes, 9,126 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `46be5678854a5a78e2ed399a395651317dec5a573ccc0cee22821715a757a372`; 두 clean build가 byte-for-byte 동일 |
| 교차 JDK 재현 | 수정 전 같은 Mac에서 JDK 21.0.12 JAR과 JDK 26.0.2 JAR이 정확히 194 bytes·30 Java class만 달랐고 React asset은 동일했다. JDK 21 source build 강제 후 JDK 26 `mvn validate`가 설명 메시지로 실패함을 확인 |
| MR-JAR 완전성 | 결정적 writer가 모든 entry를 정렬·고정 timestamp로 기록하고 12개 실제 source→target map·원 source namespace 0을 확인. 합성 Java 22/23/24/31/32 root와 미래 Closure MR class 회귀 2건 통과 |
| 실제 Burp | **대기** — beta.44 JAR에서 정상 HTTPS·신뢰되지 않은 인증서·DNS/timeout과 저장·재열기 확인 필요 |

이 gate는 실패 상태를 잃지 않는 데이터·화면 계약을 확인한다. 합성 typed exception은 실제 Montoya/운영체제별 예외 계층의 완전한 분류를 증명하지 않는다. 미분류 응답 전 오류는 `OTHER_FAILURE`로 남으며 실제 Burp gate 전에는 TLS·DNS 분류의 실환경 완료를 주장하지 않는다.

## 1.2.0-beta.44 React 통합 gate

| 검증 항목 | 현재 확인 결과 |
|---|---|
| 코어 보존 | beta.25 기반 PR의 Java/Maven/LLM 구현은 병합하지 않고 beta.44의 Surface·실행 원장·세션/ZAP·MR-JAR 계약을 유지 |
| 기본 작업면 | `/` no-cache 접속이 `#surface`로 열리고 endpoint 4개·parameter 5개 샘플과 H/S/L 표시 필터 동작 확인 |
| 그래프 snapshot 호환 | cluster 전체 member 배열이 없는 실제 bounded snapshot에서 기존 React가 `undefined.length`로 중단되는 회귀를 재현하고 representative `eventId` fallback으로 수정; focused regression 통과 |
| 주요 화면 | Surface, Dashboard, Graph canvas, Runs, Evidence, Accounts, Inspection, Matrix, Sequence, Scenarios 전환 후 새 browser warning/error 0건 |
| 정적 경로 | `/`·`/app/` 200, `/app` 308→`/app/`, `/legacy/` 200, HEAD content length/type와 fat JAR의 단일 해시 JS/CSS 확인 |
| 전체 회귀·배포물 | 위 beta.44 LLM gate의 최종 265 React/374 Java tests와 명시 환경 산출물 수치를 공유 |
| 실제 Burp | **대기** — 실제 Montoya snapshot, HUMAN/ZAP/LLM, 관리 세션, live Request Lab을 beta.44 JAR로 재확인해야 함 |

이 gate는 standalone sample과 정적 HTTP 계약에서 최신 코어와 React 표시 계층의 연결을 검증한다. 실제 Burp 트래픽·ZAP·LLM 실행이나 보안 finding 정확도를 검증한 결과가 아니다. Vite main JS는 minified 1,046.59 kB(gzip 316.16 kB)로 chunk-size 경고가 남아 있으며, 기능 실패가 아니라 실제 초기 로드 성능 측정 전의 최적화 부채로 기록한다.

## 1.2.0-beta.43 lexical URL 해석·검토면 gate

| 검증 항목 | 현재 확인 결과 |
|---|---|
| object member·scope | 같은 이름의 inner/outer object map과 정적 dot/bracket member를 lexical `Scope/Var`로 분리해 올바른 route를 만드는 회귀 통과 |
| axios 결합 | 서로 다른 `axios.create` instance, 정적 `baseURL`, 요청별 `baseURL` override, absolute URL과 `allowAbsoluteUrls=false` 결합 회귀 통과. 동적 baseURL은 거짓 상대 endpoint를 만들지 않음 |
| stale value 차단 | 재할당된 URL binding과 object property를 초기값으로 해석하지 않고 endpoint 0건·typed issue 2건으로 남기는 음성 회귀 통과 |
| 실패 가시성 | 동적 URL, unresolved member, 동적 axios baseURL, 함수 반환 URL, 제한된 HTTP-like wrapper를 산출물별 issue로 Surface에 연결하고 Web이 issue 수·Evidence·line을 표시하는 계약 회귀 통과 |
| 화면 집중 | no-cache standalone에서 기본 Surface의 rail은 `surface/shared`만, 인가 화면은 `auth/shared`만 보이는 것을 확인. `객체` 버튼 대신 `접근 대상`, 인가 rail의 `접근 대상 ID` 표현 확인 |
| 기존 Surface | standalone sample에서 endpoint card 4개, 입력 field 5개와 source delta가 렌더됨. 분석 산출물이 없는 sample은 0개로 표시돼 issue 표시를 꾸며내지 않음 |
| 브라우저 오류 | no-cache URL로 기본 Surface → 인가 그래프 → sample Surface를 전환한 뒤 warning/error 0건 |
| 전체 회귀 | OpenJDK 26.0.2에서 Java `release 21` 대상으로 `mvn clean verify` 연속 2회, 매회 349 tests, failure/error/skip 0 |
| 배포물 | `target/flowscope-1.2.0-beta.43.jar` 하나, 31,081,416 bytes, 9,105 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `f783066814e577efce4fb2e42dceb4ce3a11482c6bd574fbaf6e00a2e8cef4f6`; 두 clean build가 byte-for-byte 동일 |
| relocation·고지 | relocated Closure 6,846 entries, 원래 `com/google/javascript/` 0 entries, `META-INF/NOTICE`, `META-INF/LICENSE.txt`, `THIRD_PARTY_NOTICES` 존재 확인 |
| 실제 Burp·외부 효능 | **대기** — 실제 Burp beta.43 재로드, 실제 bundle/corpus의 endpoint·parameter precision/recall·검토시간과 framework별 지원 Tier는 확인하지 않음 |

이 gate는 확인된 JavaScript 문법 계약, 거짓 endpoint 차단, Surface 직렬화/UI 연결과 전체 회귀를 검증한다. HTTP-like wrapper issue는 제한된 이름 근거만 쓰므로 모든 application wrapper를 찾아낸다는 뜻이 아니다. 함수 간 data flow, axios defaults mutation·interceptor, source map, 받지 않은 lazy chunk와 서버 전용 route도 미지원이다. 자동 회귀와 저장소 내부 fixture를 실제 앱의 탐지율 또는 취약점 발견 성능으로 확대하지 않는다.

## 1.2.0-beta.42 AST 선언·실패 가시성 gate

| 검증 항목 | 현재 확인 결과 |
|---|---|
| HTTP·parameter observation | query/path/중첩 JSON/form-urlencoded/multipart와 GraphQL operation별 variables를 값 없이 source/run/identity/status/Evidence에 연결하는 회귀 통과 |
| OpenAPI·HTML declaration | OpenAPI 3.1 path/query와 JSON requestBody, HTML form과 submitter `formaction/formmethod`의 endpoint·parameter 선언 회귀 통과 |
| JavaScript AST | 실행 없는 Closure `ECMASCRIPT_NEXT` parser로 ESM import, async/optional chaining, fetch template·query, axios import/create/direct call, XHR binding, jQuery, sendBeacon, 정적·동적 import를 확인. 임의 함수·가짜 `.open`·무관 객체 key 음성 회귀 통과 |
| 실패 가시성·경계 | JavaScript 1,048,576자, AST traversal 250,000, call/asset 각 20,000, call당 parameter 1,024, cache 128개 상한. 입력 초과와 OpenAPI parse 실패가 `surface.extractions`에서 빈 성공과 구분됨 |
| 비밀·cache | Surface에 parameter 값·인증정보를 넣지 않음. JavaScript cache key는 원문이 아닌 SHA-256 digest이며 dataset 교체·초기화에서 비움 |
| asset/API 분리 | HTML navigation·script asset과 Next build manifest chunk는 route inventory에 남지만 API surface endpoint로 올라가지 않는 회귀 통과 |
| truth 분리 fixture | analyzer 입력과 분리한 held-out truth에서 endpoint 7, parameter 18, client asset 5 exact set 일치. application wrapper 1개는 `UNRECOGNIZED_APPLICATION_WRAPPER` 비지원으로 유지 |
| Web 수동 확인 | standalone `127.0.0.1:17779` sample에서 beta.42·`API·입력 차이`, extraction summary, LLM filter 해제 후 해당 관측 제거, 기존 인가 그래프 전환 확인. warning/error 0건 |
| 전체 회귀 | `mvn clean verify` 연속 2회, 매회 340 tests, failure/error/skip 0. inline Web JavaScript `node --check` 통과 |
| 배포물 | `target/flowscope-1.2.0-beta.42.jar` 하나, 31,069,397 bytes, 9,099 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `c8f53c170058a4803730e2419660ff77e21603ad9506f0156c54951623651a58`; 두 clean build가 byte-for-byte 동일 |
| relocation·고지 | relocated Closure 6,846 entries, 원래 `com/google/javascript/` 0 entries. Closure notice, `META-INF/LICENSE.txt`, `THIRD_PARTY_NOTICES` 존재 확인 |
| 실제 Burp·외부 pilot | **대기** — 실제 Burp beta.42 재로드, 승인된 외부 exact scope, 실제 bundle precision/recall·검토량·성능과 지원 Tier 조정은 수행하지 않음 |

이 gate는 당시 구현한 1~4와 5의 저장소 내부 구조 fixture, 6의 parser/limit 실패 일부, 7의 Next pages chunk 연결, 8의 공통 asset/GraphQL 관측 회귀를 검증한다. 같은 저장소의 held-out fixture는 analyzer가 truth를 입력으로 받지 않는다는 점에서는 분리됐지만 외부 corpus나 real-world pilot은 아니다. 따라서 Next.js 전체, Vue/Nuxt·Angular 전체, GraphQL schema, lazy chunk 전체 또는 취약점 탐지 우월성을 증명하지 않는다. 9~10은 승인된 외부 pilot 뒤에만 완료할 수 있다.

## 1.2.0-beta.41 Endpoint·Parameter Surface Delta gate

| 검증 항목 | 현재 확인 결과 |
|---|---|
| 관측 입력 | query, canonical path 변수 위치, 중첩 JSON·배열, form-urlencoded, multipart 이름과 값 없는 shape/source/run/identity/status/Evidence ID 회귀 통과. parameter도 observation 단위 provenance를 보존 |
| 선언 입력 | OpenAPI/Swagger path·query와 JSON/form-urlencoded/multipart requestBody/local `$ref`, HTML form, 정적 JavaScript literal URL query와 직접 연결된 request-object key 회귀 통과 |
| JavaScript 오귀속 방지 | 요청 호출이 끝난 뒤 다른 문장에 나타난 `JSON.stringify` 객체 key를 앞 요청의 파라미터로 붙이지 않는 음성 회귀 통과; 동적 문자열/data-flow는 지원한다고 주장하지 않음 |
| 범용성 회귀 | 업무명과 무관한 임의 route·field 이름으로 동일한 구조 규칙이 작동함을 확인; host·업무명·React/Next.js 이름을 조건으로 쓰지 않음 |
| 비밀 경계 | surface에는 실제 parameter value와 raw 인증정보를 넣지 않고 shape와 Evidence 참조만 직렬화하는 회귀 통과 |
| snapshot 비용 경계 | 동일 revision·동일 result·동일 route candidate 목록에서는 `SurfaceAnalysis`를 재사용하고 입력 revision이 바뀌면 재계산하도록 구현; 실제 Burp 20,000건 polling RSS/latency는 미측정 |
| Web 계약 | 기본 메뉴 `놓친 API·입력`, 기존 화면 `인가 그래프`, snapshot `surface`와 beta.41 버전 계약 회귀 통과 |
| 독립 Web 수동 확인 | standalone `127.0.0.1:17779` 샘플에서 기본 Surface 목록과 기존 인가 그래프 전환 확인. LLM filter 해제 시 `/api/admin/invites`가 `H·L/두 출처`에서 `H·L—/관측됨`으로 바뀌고 상세 Evidence도 H만 남음. browser warning/error 0건 |
| 전체 회귀 | `mvn clean verify` 연속 2회, 매회 330 tests, failure/error/skip 0 |
| 배포물 | `target/flowscope-1.2.0-beta.41.jar` 하나, 16,062,971 bytes, 2,082 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `2f3902f0178a3b53db3f1ec8c8e86ce8533cf7fd0384197e8926482ad2bf4c1b`; 두 clean build가 byte-for-byte 동일 |
| 실제 Burp·효능 | **대기** — beta.41 실제 확장 재로드, HUMAN/ZAP/LLM 실데이터 정합성, 개발 corpus와 분리한 server-truth fixture의 endpoint/parameter precision·recall과 task-time은 수행하지 않음 |

이 gate는 값 없는 데이터 계약, 지원하는 명시 문법, UI 연결과 회귀 안정성을 검증한다. standalone 샘플은 합성 데이터이며 실제 대상 네트워크 요청을 만들지 않는다. 따라서 이 결과는 동적 JavaScript, lazy chunk 전체, 서버 전용 route, 모든 프레임워크 또는 실제 취약점 탐지 성능을 증명하지 않는다. 블랙박스 전체 공격면의 완료율도 아니다.

## 1.2.0-beta.40 Explorer 1~10·concrete frontier gate

| 검증 항목 | 현재 확인 결과 |
|---|---|
| template/concrete 분리 | `/orders/42`, `/orders/77`을 하나의 `/orders/{id}` template으로 정렬하면서 두 실제 path와 서로 다른 query를 보존하는 회귀 통과 |
| 비밀·상한 | secret-bearing query는 raw 값을 남기지 않고 path만 보존; 후보당 concrete 200개와 `concrete_paths_truncated=true` 회귀 통과 |
| schema 정직성 | 실제 값 없는 OpenAPI `{id}` template에 concrete 값을 발명하지 않는 회귀 통과 |
| persistence/snapshot | JSON project round-trip과 Web snapshot에 concrete path·초과 표시를 보존하는 회귀 통과 |
| Explorer server gate | `pending_concrete_paths`, `review_dimensions`, `explorer_guidance` 구조 응답, query 포함 exact 방문 전 종료 거부, INDEPENDENT→ASSISTED 소진과 limitation 포함 종료 회귀 통과 |
| rendered 경계 | own-run HTML script 신호에서 조건부 browser 권고; 미사용·미설치 상태는 `PARTIAL_WITH_LIMITATIONS`, browser가 route를 추가로 찾지 못해도 실제 사용 여부는 보존, browser 결과는 controlled HTTP replay 전 Evidence가 아님 |
| 실제 로컬 HTTP fixture | 매 실행 운영체제가 배정한 새 loopback 포트에서 HTML→외부 JavaScript→API/profile/order/notices route를 연쇄 발견하고 exact-scope 밖 링크 제외, 관측 POST의 묵시 GET 실행 금지 통과 |
| process 종료 | resistant fake parent/descendant에 graceful→forced 종료와 alive 확인 회귀 통과. 실제 로컬 Codex·Claude 즉시 취소 후 해당 smoke의 잔존 `flowscope-llm-*` process/workspace 없음 확인 |
| 전체 회귀 | `mvn clean verify` 연속 2회, 매회 324 tests, failure/error/skip 0 |
| 배포물 | `target/flowscope-1.2.0-beta.40.jar` 하나, 16,025,306 bytes, 2,066 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `b472c9eae70afd4dd6d818af576e458570ac9b3116e2dc288ee6a62f0bf4ff55`; 두 clean build가 byte-for-byte 동일 |
| 실제 Burp/provider 장기 실행 | **대기** — 실제 Session Broker 계정 주입, SPA browser recall, Codex/Claude 1~10 장기 완주와 endpoint/finding 효능은 수행하지 않음 |

이 gate는 route 값 손실, 서버 frontier 상태 기계, 로컬 HTTP 연쇄 발견과 알려진 provider process-tree 종료를 검증한다. 로컬 fixture는 하네스가 실제 HTTP 응답으로 확장됨을 증명하지만 실제 사이트의 모든 endpoint를 발견한다는 뜻이 아니다. `PARTIAL_WITH_LIMITATIONS`도 블랙박스 공격면의 완료율이 아니다. descendants는 종료 시작 시점 snapshot이므로 이후 분리된 daemon까지 종료됨을 증명하지 않으며, 실제 Burp+provider·ZAP·복수 계정과 블라인드 BOLA/BFLA/IDOR precision·recall은 별도 gate다.

## 1.2.0-beta.39 통합 회귀 복구 gate

| 검증 항목 | 현재 확인 결과 |
|---|---|
| 분류 재현 | API 문맥 없는 403 static directory는 `UNKNOWN/REVIEW`, JSON API 403은 `API/INCLUDE`, 일반 JSON `/manifest.json`은 `DISCOVERY_METADATA/EXCLUDE` 회귀 통과 |
| Explorer 재현 | coverage 제외된 navigation route라도 exact LLM run의 controlled response가 있으면 방문 완료로 인정하고 INDEPENDENT→ASSISTED→run 종료 회귀 통과 |
| Web 계약 | API 기본 선택, Site 선택형 유지, source별 고유 operation 집계, graph level별 viewport v5 문자열 회귀 통과 |
| ZAP 넓은 기준선 | Client 성공 뒤에도 AJAX 실행, Client 실패 시 소유 scan stop 뒤 AJAX 실행, 비로그인·ACTIVE 계정 fresh-session 직렬 실행 회귀 통과 |
| Passive 정체·격리 | queue 감소가 없는 정체에서 기존 Evidence·현재 Alert 보존, 부분 완료·미완결 snapshot 표시, current task 진단·cleanup 성공 경로와 Passive 전 조기 실패 cleanup 실패 시 후속 계정 `NOT_RUN/BLOCKED_BY_ISOLATION` 회귀 통과 |
| ZAP 진행 표시 | 여섯 단계 진행선, live Traditional/rendered count, Passive 남은 수·현재 task, Alert snapshot 완결성, bounded 실행 이벤트와 1초 Web 표시 계약 통과 |
| 출처·신원 provenance | native Burp Scanner의 ZAP context 배제, SYSTEM run capability 일치/불일치, `laneAccountId` JSON·SQLite round-trip 회귀 통과 |
| capability 실패·blocking liveness | capability 누락 1건을 다음 crawler 전에 terminal failure로 원인화하고 차단 수를 상태에 보존하는 회귀, 지연된 `newSession` 동안 worker heartbeat와 `응답 대기` 표시 회귀 통과 |
| 범위·API | AJAX `contextName/inScope/subtreeOnly`, IPv6 exact subtree, API key header 전송·query 미포함, 비정상 ZAP HTTP 오류 보존 회귀 통과 |
| 취소·Web 상태 | Web/MCP 취소 계약, transient Web poll 경고가 기존 snapshot을 보존하는 계약, loopback IPv6 제어면 제외 회귀 통과 |
| 전체 회귀 | inline JavaScript `node --check`, `mvn clean verify` 연속 2회, 매회 315 tests, failure/error/skip 0 |
| 독립 Web 수동 확인 | `127.0.0.1:17779` 샘플에서 API 기본 그래프, Site→API 전환·복귀, 화면 배치, browser error/warning 0건 확인 |
| 배포물 | `target/flowscope-1.2.0-beta.39.jar`, 16,018,159 bytes, 2,066 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `c1095a2ffdff7f2334cff6fd9aab0fc2ecb8379aca908e44b2e53da9b1662748`; manifest의 `Multi-Release: true` 확인, 두 clean build가 byte-for-byte 동일 |
| 실제 Burp 재로드 | **대기** — beta.39 JAR의 crAPI HUMAN/ZAP/LLM 재실행은 아직 수행하지 않음 |

이 gate는 확인된 분류·Explorer·그래프 회귀와 mock ZAP의 Passive 정체, run capability 거부 원인화, blocking worker heartbeat, crawler 종료, 신원 provenance 경로를 닫는다. 실제 Burp/ZAP 장시간 운영, Replacer capability의 Traditional·Client·AJAX·definition end-to-end 전달, 취소 후 quiescence, 10분/30분 운영 경계의 대상별 최적성, crAPI의 endpoint recall 또는 BOLA/BFLA/IDOR 효능을 증명하지는 않는다.

## 1.2.0-beta.38 ZAP 실행 관측 가능성 gate

| 검증 항목 | 현재 확인 결과 |
|---|---|
| 실측 원인 분리 | beta.37 실행 중 ZAP API에서 AJAX `running`, Traditional `100/FINISHED`, passive queue 7을 확인. 후속 `test1`은 직렬 lane 대기였음 |
| 상태 계약 | campaign/lane/stage elapsed·timeout, heartbeat/progress age, ZAP status, activity state, queue position/total·wait reason 회귀 통과 |
| Web 계약 | 전체·단계 시간, 최대시간, 마지막 응답·트래픽 변화, pending 대기 이유와 상태 분류 문자열 회귀 및 inline JavaScript parse 통과 |
| 전체 회귀 | `mvn clean verify` 연속 2회, 매회 299 tests, failure/error/skip 0; inline JavaScript parse 통과 |
| 배포물 | `target/flowscope-1.2.0-beta.38.jar`, 15,997,237 bytes, 2,063 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `ce799b0f34dc749fee202a1532f501d9421c9c08794a171af57d0c5e20cba987`; 두 clean build가 byte-for-byte 동일 |
| 실제 Burp 재로드 | **대기** — beta.38 화면의 장시간 AJAX→후속 계정 전환, heartbeat 단절·timeout 표시는 아직 수동 확인하지 않음 |

실측은 현재 로컬 crAPI/ZAP 프로세스가 그 시점에 살아 있었음을 확인한 것이며 AJAX crawler 내부의 완전한 건강이나 탐색 효능을 증명하지 않는다. `RESPONDING_NO_NEW_TRAFFIC`도 실패가 아니라 status API는 응답하지만 capture/status 변화가 30초 넘게 없다는 관측이다.

## 1.2.0-beta.37 Explorer 입력 무결성·Graph Fact gate

| 검증 항목 | 현재 확인 결과 |
|---|---|
| Explorer account | 활성 run의 계정과 다른 `account_id` override를 서버가 거부하는 MCP 회귀 통과 |
| browser 실행 경계 | browser worker는 8082 listener 없이 CDP로 실행하고, exact scope 밖 request는 전송 전에 차단 |
| 상태 변경 승인 | 실제 headless Chrome이 만든 POST를 Burp 승인 callback이 거부했을 때 대상 서버 수신 0건, URL·body preview 마스킹 회귀 통과 |
| runtime route | SPA network route가 `BROWSER_RUNTIME/evidence_backed=false` frontier에 등록되고 controlled replay 전 완료 대상에서 빠지지 않는 MCP 회귀 통과 |
| graph fact | Evidence·identity·service·method/operation·API group 근거·object family·source/run/phase·response outcome 투영 회귀 통과 |
| graph 표시 | Site→API Group→Identity→API→Object 계층, object family 기본 접기, 접힌 family의 중복 API→Object 선 제거, 후보 선택 시 해당 family 펼치기 구현. inline JavaScript parse 통과 |
| 전체 자동 회귀 | `mvn clean verify` 연속 2회, 매회 299 tests, failure/error/skip 0. 완성 JAR manifest/classloader smoke 통과 |
| 배포물 | `target/flowscope-1.2.0-beta.37.jar`, 15,991,612 bytes, 2,062 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `58458a6a9eea2ea3b452a79fc307e054d5984fd3b1d8ccaa175b23b6a88c52ef`. 두 clean build가 byte-for-byte 동일 |

현재 자동 검증은 입력 무결성, discovery/Evidence 분리, fact 투영, Web 계약과 재현 빌드를 확인한다. 실제 beta.37 JAR을 Burp에 재로드한 화면·HTTPS/broker browser 통합과 허가 대상의 endpoint recall·BOLA/BFLA/IDOR TP/FP/FN, 고카디널리티 가독성·검토시간·Burp 상주 메모리는 측정하지 않았다. HTTP 2xx나 그래프 edge만으로 취약점 또는 인가 허용을 주장하지 않는다.

최초 검증일은 2026-08-25, 최신 자동 재검증일은 2026-09-01이다. 이 문서는 벤치마크에 들어가기 전까지 구현한 범위와 실제 확인한 범위를 분리해 기록한다. crAPI의 알려진 취약점 목록·정답·공격 절차는 열거나 코드와 프롬프트에 주입하지 않았다.

## 1.2.0-beta.36 격리 Chrome discovery·controlled replay gate

| 구분 | 결과 |
|---|---|
| 실제 브라우저 smoke | 로컬 설치 Chrome을 headless·incognito 임시 profile로 실행해 CDP 연결, DOM title/text, same-scope link, runtime network, broker header 전달, click 이동과 query secret 출력 마스킹을 확인 |
| exact scope | DOM의 범위 밖 link를 반환하지 않고 범위 밖 직접 navigate를 거부. `Fetch.requestPaused`가 실제 browser request를 전송 전에 scope 검사하는 코드 계약 포함 |
| 신뢰 분리 | browser tool 결과는 `DISCOVERY_ONLY`, Evidence ID 부재. 관련 request는 controlled target executor로 재현해야 Evidence·LLM 완료·Judge lock 자격을 얻는 MCP 회귀 통과 |
| 상호작용 경계 | CLICK/FILL만 노출하고 `confirmed=true`와 Burp 승인을 요구. password/file selector와 arbitrary JavaScript tool은 차단 |
| 생명주기 | MCP 정상 종료뿐 아니라 Explorer CLI 실패·취소·초기화에서도 exact run browser cleanup을 실행하는 launcher 계약과 실패 회귀 통과 |
| 전체 자동 회귀 | JDK 21 `mvn clean verify` 1회, 296 tests, failure/error/skip 0, 완성 JAR manifest/classloader smoke 통과 |
| 배포물 | `target/flowscope-1.2.0-beta.36.jar`, 15,981,411 bytes, 2,058 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `46846d19f49dd93b20704f7762c425b15d83d7a37951367736f6d20bde07a548` |

이 검증은 로컬 HTTP와 proxy 없는 browser worker 핵심, MCP 신뢰 경계, 기존 전체 회귀를 확인한다. beta.36 JAR을 실제 Burp에 재로드한 HTTPS·8082 proxy·ACTIVE broker account·SPA 탐색→controlled replay→Evidence→정상 종료와 beta.35 대비 blind route recall·노이즈·시간·메모리는 아직 측정하지 않았다. 따라서 실제 대상의 endpoint 발견률이나 취약점 탐지 성능 향상을 주장하지 않는다. 이번 작업에서 두 번째 clean build를 실행하지 않았으므로 beta.36 byte-for-byte 재현성도 새로 주장하지 않는다.

## 1.2.0-beta.35 Explorer 독립-first/보조 frontier gate

| 구분 | 결과 |
|---|---|
| 독립 frontier | own-run concrete GET/HEAD/OPTIONS/UNKNOWN route가 남아 있으면 ASSISTED 전환과 종료를 거부하는 MCP 회귀 통과 |
| 보조 frontier | 독립 frontier 소진 뒤 cross-lane route 문자열은 반환하되 source, run ID, Evidence ID, adapter, provenance, 응답과 기존 관측 성공 여부가 JSON 결과에 없음을 확인 |
| 종료 재검사 | ASSISTED concrete safe route가 남아 있으면 종료 거부, own-run 관측으로 모두 소진되면 exact LLM run 완료 회귀 통과 |
| 기존 경계 | Session Broker 인증 원문 비노출, exact scope, GET/HEAD/OPTIONS read와 승인형 write 분리, 0-Evidence 거부 회귀 포함 |
| 전체 자동 회귀 | JDK 21 `mvn clean verify` 1회, 294 tests, failure/error/skip 0, 완성 JAR manifest/classloader smoke 통과 |
| 배포물 | `target/flowscope-1.2.0-beta.35.jar`, 15,957,571 bytes, 2,052 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `6377fdfbbf7160871e33cdb72f5558e0cd5e9f20361dd84cb91ed12f19e0b978` |

이 검증은 서버 상태 기계와 정보 비노출을 확인한다. JavaScript 실행, DOM 상호작용, SPA runtime network browser worker와 실제 Burp+허가 target의 route recall 증가는 검증하지 않았다. beta.35 JAR의 byte-for-byte 재현성은 이번 작업에서 두 번째 clean build를 아직 수행하지 않았으므로 완료로 기록하지 않는다.

## 1.2.0-beta.34 복잡도·메모리 경계 gate

| 구분 | 결과 |
|---|---|
| Snapshot cluster | 20,000건 동일 cluster event에 전체 ID 목록을 복제하지 않고 ID를 200건 페이지 API로 분리. `SnapshotJsonWriterScaleTest` 통과, 최종 연속 두 full verify의 test time 0.912초·0.804초, serialized snapshot 32MiB 미만 |
| DataFlow | 신원별 exact-token index, 가장 가까운 이전 producer, 전역 최신 100,000 value 상한, `123`/`1234` 음성 대조와 20,000건·10,000 link 5초 예산·오래된 값 축출 회귀 통과 |
| 별도 stress 실행 | 최종 코드의 Snapshot+DataFlow Maven 실행 3.91초, 최대 RSS 378,273,792 bytes·peak memory footprint 176,901,248 bytes. Maven/JUnit JVM 포함 개발 머신 측정이며 Burp 상주 RSS가 아님 |
| live HTTP | 2MiB text/binary fixture에서 1MiB 저장 상한 전에 최대 64KiB만 decode·mask하고 metadata-only size/reason 보존. 같은 미리보기라도 실제 크기가 다르면 digest가 다르고, raw vault는 초과 배열 없이 요청·응답 크기만 수용 |
| 프로젝트 복원 | GZIP이 선언 크기보다 많이 풀리거나 payload 1MiB·서로 다른 복원 평문 합계 48MiB를 넘으면 거부. metadata-only 항목의 압축 blob도 거부하고 동일 digest 복원 cache 회귀 통과 |
| LLM assessment | verdict enum, 필드 길이, Evidence 1~200개, 1,000건·총 4MiB 경계를 runtime과 프로젝트 codec에 공통 적용하는 회귀 통과 |
| 전체 자동 회귀 | JDK 21 `mvn clean verify` 연속 2회, 매회 293 tests, failure/error/skip 0 |
| 현재 환경 진단 | `scripts/doctor.sh` 실패 0·경고 0. HUMAN/SCANNER 포트, ZAP 2.17 API·upstream·필수 add-on, Codex 0.147.0, Claude Code 2.1.236, Web 17777, MCP 8787 확인. 이는 실제 3-way 완주나 탐지 효능을 뜻하지 않음 |
| 배포물 | `target/flowscope-1.2.0-beta.34.jar` 하나, 15,953,677 bytes, 2,051 entries, 첫 entry `META-INF/MANIFEST.MF`, SHA-256 `16835b7d5707279615b8d757ad3086e4bdcdc37d95c3d8c26fd5854c79d34a8a`; 연속 두 clean verify에서 byte-for-byte 동일 |

이 gate는 특정 제곱 경로, 대용량 입력과 일부 DataFlow 오연결을 자동 재현해 닫는다. 실제 Burp callback/polling의 20,000건 상주 RSS, 운영체제별 JAR load, endpoint·객체·취약점 발견률을 측정한 것은 아니다. 효능은 정답 격리 benchmark에서 H, H+ZAP, H+ZAP+LLM, Judge 증분을 따로 측정하고, 고유 유효 발견이나 검토시간 개선이 없는 레이어는 기본 경로에서 낮추거나 제거한다.

## 1.2.0-beta.33 Request Lab·분석 게시·후보 표시 무결성 gate

| 구분 | 결과 |
|---|---|
| Request Lab 비동기 | Evidence generation·immutable event ID·in-flight control의 정적 계약 회귀 통과. 늦은 GET/POST/Repeater 응답은 현재 generation과 다르면 화면에 적용하지 않고, 서버 응답을 받지 못한 동일 draft의 재시도는 같은 operation ID를 재사용 |
| 서버 단일 실행 | 동일 operation ID·동일 입력의 순차 및 동시 HTTP 요청이 실제 `sendRequestLab` 1회로 합쳐지는 회귀 통과. 같은 ID의 다른 입력은 HTTP 400 |
| raw 보존 경계 | 멱등 입력은 길이 구분 SHA-256으로 비교하고 완료 cache는 compact 결과만 최대 256건 보존. raw 요청·전체 응답을 cache하지 않음 |
| 분석 게시 | `AnalysisPublicationGateTest`에서 입력 invalidation 뒤 오래된 결과 게시 거부, 현재 epoch 결과 게시 허용 통과 |
| 빈 셀 의미 | exact server `UNCROSSED` candidate key만 `미교차`; 후보 없는 빈 셀은 `일반 미검증`이고 gap 필터에서 제외되는 정적 계약 통과 |
| standalone Web | beta.33 standalone 샘플의 판정 매트릭스 10개 셀 중 후보 없는 빈 셀 2개가 `data-gap=false`·`일반 미검증 조합`으로 렌더되고 브라우저 console error/warning 0건 확인 |
| 전체 자동 회귀 | JDK 21에서 `mvn clean verify`, 278 tests, 실패·오류·skip 0 + 완성 JAR manifest/classloader smoke 통과 |
| 반복 빌드 | 같은 source·JDK 21의 연속 clean verify 2회에서 byte-for-byte 동일, SHA-256 일치 |
| 배포물 | `target/flowscope-1.2.0-beta.33.jar` 하나, 15,944,891 bytes, 2,048 entries, SHA-256 `2d8588fa78abf713005f738a3a7c990e1d2b9838bdb937dfd012b87a223b082b`; 첫 entry `META-INF/MANIFEST.MF` |

이 gate는 localhost HTTP 동시 요청, 게시 epoch와 화면 문자열 계약을 자동 검증한다. 실제 Burp에서 고지연 A→B Evidence 선택, 상태 변경 endpoint 수신 횟수, clear/rebuild callback 경합을 관측한 것은 아니며 beta.33 JAR 재로드 수동 gate가 남아 있다. 전체 회귀 중 XXE 거부 fixture의 XML parser fatal log와 SQLite native-access 경고가 출력됐지만 실패·오류는 0이었다. 이를 실제 Burp bundled JVM 호환 완료로 해석하지 않는다.

## 1.2.0-beta.32 exact-run 완료·신뢰·고정 dataset gate

| 구분 | 결과 |
|---|---|
| 신뢰 정책 | 목적별 `SourceTrustPolicy` 회귀에서 8082 `UNVERIFIED_RUNTIME`은 raw record에 남고 coverage·Explorer 시야·완료·lock·결정적 verdict에는 사용되지 않음 |
| 완료 정책 | HUMAN OBSERVED/CONTROLLED, SCANNER·LLM CONTROLLED의 exact source/run/EXPLORATION/응답 Evidence만 완료. 실패·취소·구형 clear는 완료를 생성하지 않음 |
| dataset lock | 완료 시점 Evidence ID를 동결하고 lock은 세 lane의 동결 ID만 선택. 같은 run의 후발 record와 lock 뒤 live record가 snapshot을 바꾸지 않는 회귀 통과 |
| 프로젝트 호환 | JSON v3·SQLite v2 exact completed run 왕복, JSON v1/v2·SQLite v1 읽기, source-only legacy 완료 비승격, 현재 스키마 lane/run 불일치 거부 회귀 통과 |
| 전체 자동 회귀 | JDK 21에서 `mvn clean verify`, 275 tests, 실패·오류·skip 0 + 완성 JAR manifest/classloader smoke 통과 |
| 반복 빌드 | 같은 source·JDK 21의 연속 clean verify 2회에서 byte-for-byte 동일, SHA-256 일치 |
| 배포물 | `target/flowscope-1.2.0-beta.32.jar` 하나, 15,940,500 bytes, 2,046 entries, SHA-256 `a105c9539eddedecc212a66782958165ea890bd0ed5c528dac249f7a22fc2b27`; 첫 entry `META-INF/MANIFEST.MF` |

이 gate는 완료와 Judge 입력 데이터의 무결성을 자동 회귀로 확인한다. 실제 Burp에서 beta.32를 재로드한 Codex/Claude Explorer, ZAP 대상 캠페인, 세 lane 잠금과 Judge 재현 성공을 뜻하지 않는다. 포트 기반 traffic attribution은 실제 프로세스 신원 증명이 아니며, 8082 직접 traffic은 이 한계 때문에 보존 전용으로 격리한다.

## 1.2.0-beta.31 구독 CLI 자동 탐지·로그인 preflight

| 구분 | 결과 |
|---|---|
| 실제 Codex 상태 | 로컬 Codex CLI 0.147.0의 `codex login status`가 exit 0과 ChatGPT 로그인 상태를 반환. account 식별자는 저장하지 않음 |
| 실제 Claude 상태 | 로컬 Claude Code 2.1.236의 `claude auth status --json`이 exit 0, `loggedIn=true`, `authMethod=claude.ai`를 반환. 이메일 등 원문은 저장하지 않음 |
| 자동 탐지 회귀 | 표준 `~/.local/bin`, Windows `.exe/.cmd/.bat`, 축소 PATH와 기존 실행 부모 PATH 보정 통과 |
| 준비 상태 회귀 | Codex/Claude READY·로그아웃 parser, provider account 문자열 비보존, Web refresh API와 READY 자동 선택 계약 통과 |
| 전체 자동 회귀 | `mvn clean verify`, 268 tests, 실패·오류·skip 0 + 완성 JAR manifest/classloader smoke 통과 |
| 환경 진단 | `scripts/doctor.sh`, Codex·Claude·Web·MCP·ZAP 포함 실패 0, 경고 0 |
| 반복 빌드 | 같은 소스의 clean verify 2회에서 크기·엔트리 수·SHA-256 일치, manifest 첫 엔트리 확인 |
| 배포물 | `target/flowscope-1.2.0-beta.31.jar`, 15,926,130 bytes, 2,040 entries, SHA-256 `824fe15277d06b89ad976870b47694935674f7b7926e07cdd5b9eed1af3140e4` |

아직 확인하지 않은 것은 beta.31 JAR을 실제 Burp에 재로드한 Web readiness badge·READY provider 자동 선택, Codex/Claude→FlowScope MCP target read, route frontier, 응답 Evidence 저장과 정상 `end_run`이다. 공식 auth status와 자동 회귀를 실제 대상 Explorer 완주나 취약점 탐지 성능으로 표현하지 않는다. macOS의 로그인된 두 CLI에서 preflight는 확인했지만 Windows/Linux 실기기 설치 경로는 코드 회귀만 수행했다.

## 1.2.0-beta.30 로그인 준비 상태·LLM 작업 피드

| 구분 | 결과 |
|---|---|
| 로그인 기반 실행 | 로컬 로그인 Codex CLI를 API key 없이 owner-only 임시 home에서 실행해 `FLOWSCOPE_BETA30_LOGIN_OK`, exit 0 확인 |
| 활동 event | Codex JSONL의 system/model/tool/completion을 실행 중 게시하고 reasoning event와 raw tool credential이 활동 목록에 남지 않는 회귀 통과 |
| 상태·prompt 보호 | live output은 64 KiB secret-masked tail, provider line은 32 KiB, 활동 200건, prompt preview 24 KiB 상한 회귀 통과 |
| Web UI | provider별 준비 메시지, 읽기 전용 `LLM 작업 피드`, 주입 지침, 약 1초 상태 동기화 정적 계약과 465px 폭 브라우저 렌더 확인. 글자 가로 잘림 없음 |
| 전체 자동 회귀 | `mvn clean verify`, 265 tests, 실패·오류·skip 0 + 완성 JAR manifest/classloader smoke 통과 |
| 반복 빌드 | 같은 소스의 clean verify 2회에서 크기·엔트리 수·SHA-256 일치 |
| 배포물 | `target/flowscope-1.2.0-beta.30.jar`, 15,918,273 bytes, 2,038 entries, SHA-256 `bc6924767024d82000fb7c8b71140c01f88784ab2613dcb2b58a7734f5088f6f` |

아직 확인하지 않은 것은 beta.30 JAR을 Burp에 재로드한 실제 `/api/llm-run` readiness, Codex→FlowScope MCP target read, route frontier, 응답 Evidence 저장, 작업 피드 전환과 정상 `end_run`이다. 로컬 CLI smoke와 parser 회귀를 실제 대상 Explorer 완주로 표현하지 않는다. Claude는 사용 가능한 로그인 환경에서 별도 확인해야 하며 Codex 성공으로 대체하지 않는다.

## 1.2.0-beta.29 Codex Explorer 격리·이중 완료 gate

| 구분 | 결과 |
|---|---|
| 실제 실패 재현 | beta.28 output tail에서 전역 `ctf-goal` skill 로드, 첫 GET의 write tool 오선택·취소, 응답 Evidence 0건 성공 표시를 확인 |
| Codex home 격리 | 임시 home이 login만 노출하고 원 skill/plugin을 상속하지 않는 회귀, login 부재 fail-fast 메시지 통과 |
| 명령 경계 | `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, strict config와 skill/plugin/browser/shell 계열 feature disable 인자 회귀 통과 |
| MCP 도구 표면 | 활성 Explorer의 `tools/list`가 정확히 8개 역할 도구만 반환하고 scope·ZAP·Judge 도구를 숨기는 회귀 통과 |
| 완료 이중 gate | MCP의 same source/run/phase response Evidence gate 유지. launcher exact-run Evidence가 false면 완료 lane 취소와 `FAILED` 게시 회귀 통과 |
| 실제 구독 CLI smoke | 로컬 Codex 0.147.0에서 원 `auth.json`만 연결한 임시 `CODEX_HOME`과 제품 격리 옵션으로 `FLOWSCOPE_CODEX_OK`, exit 0 확인. API key 미사용 |
| 전체 자동 회귀 | `mvn clean verify`, 263 tests, 실패·오류·skip 0 + 완성 JAR manifest/classloader smoke 통과 |
| 반복 빌드 | 같은 소스의 clean verify 2회에서 SHA-256 일치 |
| 배포물 | `target/flowscope-1.2.0-beta.29.jar`, 15,910,427 bytes, 2,037 entries, SHA-256 `348c6504ab782486d6baa82f72db5486df030dc72b684b386d2d7683a6c55d89` |

아직 확인하지 않은 것은 beta.29 JAR을 Burp에 재로드한 실제 MCP target read, 응답 기반 route frontier 순회, Evidence 저장과 정상 `end_run`이다. Codex 단독 smoke나 자동 회귀를 실대상 탐색 완주·취약점 탐지 성능으로 표현하지 않는다.

## 1.2.0-beta.28 Explorer 성과 gate·ZAP 정의 탐색 gate

| 구분 | 결과 |
|---|---|
| LLM 도구 경계 | GET·HEAD·OPTIONS 전용 `flowscope_target_read`와 POST·PUT·PATCH·DELETE 전용 승인형 `flowscope_target_request`의 schema·annotation·method 거부 회귀 통과 |
| Explorer 완료 조건 | 같은 LLM run·EXPLORATION phase의 응답 Evidence가 0건이면 `flowscope_end_run`을 거부하고 context를 유지하는 회귀 통과 |
| Codex 실행 격리 | 실행별 feature disable과 발견된 user/plugin `SKILL.md` disable 인자, 사용자 파일 불변 회귀 통과. 로컬 Codex 0.147.0 `prompt-input` smoke에서 전역 `ctf-goal` 지침이 빠진 것을 확인 |
| ZAP 전송 사전 검사 | 로컬 ZAP 2.17.0의 outgoing proxy enabled와 `host.docker.internal:8081`, `network` 포함 필수 add-on을 확인. mock에서 proxy off·host/port 불일치·선택 형식 add-on 누락을 대상 전송 전에 거부 |
| 명시 API 정의 | OpenAPI·GraphQL·Postman·SOAP의 installed 2.17 add-on API parameter, 최대 20개 입력, exact-scope URL/endpoint, 정의별 최대 1,000 message, 중복 제거, 성공 수·경고 표시 회귀 통과. 정의가 있으면 대상 전송 전 Burp 승인 거부 회귀 통과 |
| 전체 자동 회귀 | `mvn clean verify`, 258 tests, 실패·오류·skip 0 + 완성 JAR manifest/classloader smoke 통과 |
| 반복 빌드 | 같은 소스의 `mvn clean verify` 2회에서 beta.28 JAR SHA-256 일치 |
| helper·환경 | Bash helper 전체 `bash -n`, `git diff --check`, `scripts/doctor.sh` 통과. doctor 결과 HUMAN·SCANNER·Web·MCP port, ZAP API/upstream/add-on, Codex·Claude 실행기 모두 실패·경고 0 |
| 배포물 | `target/flowscope-1.2.0-beta.28.jar`, 15,909,724 bytes, 2,037 entries, SHA-256 `87aace2eb47d97b721196714a21fbc5faff2e37f178c8b037c8be447d1fdd1f4` |

이 gate는 코드 계약, localhost mock, 로컬 실행 환경의 read-only 상태와 Codex prompt 조립을 확인했다. beta.28 JAR을 실제 Burp에 재로드한 Codex target read·0건 실패 표시, 네 정의 형식의 실제 ZAP 요청, 복수 계정 인증 주입, 3-lane lock과 Judge 재현·대조는 아직 수행하지 않았다. PowerShell helper의 로컬 실행과 원격 GitHub Actions도 이번 작업에서 실행하지 않았다. 자동 회귀를 취약점 탐지율 또는 3-way 실환경 완주로 표현하지 않는다.

## 1.2.0-beta.27 안전 ZAP·구독 CLI 실행 gate

| 구분 | 결과 |
|---|---|
| ZAP 사전 검사 | version 응답과 `spider/client/spiderAjax/pscan/pscanrules/selenium/openapi/websocket` 설치를 target traffic 전에 검사하는 회귀 통과. 누락 시 SCANNER context가 활성화되지 않음 |
| 신원별 안전 단계 | fresh session 뒤 선택 target subtree Context 생성·include·in-scope → passive engine·전체 rule 활성 확인·scope-only → Traditional → Client → AJAX → passive queue 0 순서, rendered 단계 경고 보존 회귀 통과 |
| Alert snapshot | `numberOfAlerts`와 500개 페이지로 501개 Alert를 모두 수집하고 account/run 태그, 마스킹, Web/MCP pagination을 확인. 신원별 상한 20,000과 truncation warning 적용 |
| Session Broker·Judge | account/service별 ACTIVE credential 주입, Explorer exact-scope 요청, H/S/L 완료 전 lock 거부, 별도 Judge 반복 재현·정상 대조 Evidence final verdict gate의 기존 회귀 재통과 |
| CLI 오류 재현 | `PATH=/usr/bin:/bin`의 `/usr/bin/env node`는 status 127·`No such file or directory`; `/opt/homebrew/bin` 선두 추가 뒤 status 0. 실행 파일 부모 prepend와 `Path` 키 보존 회귀 통과 |
| 로컬 ZAP read-only | API version `2.17.0`, 필수 add-on 8개, passive scanner 61개 확인. 대상 캠페인과 전역 passive 설정 변경은 실행하지 않음 |
| 전체 자동 회귀 | `mvn clean verify`, 253 tests, 실패·오류·skip 0 + 완성 JAR manifest/classloader smoke 통과 |
| 반복 빌드 | 같은 소스의 `mvn clean verify` 2회에서 beta.27 JAR SHA-256 일치 |
| helper 정적 검사 | Bash helper 전체 `bash -n`과 `git diff --check` 통과. 로컬 `pwsh` 부재로 수정된 `doctor.ps1` parser와 원격 Windows CI는 미실행 |
| 배포물 | `target/flowscope-1.2.0-beta.27.jar`, 15,900,678 bytes, 2,035 entries, SHA-256 `8c0235d47aa61055984cdd4902f721f482072393d4644a8321512fb18a5ffd62` |

이 gate는 코드 경계, mock ZAP API, 로컬 read-only preflight와 CLI runtime lookup 조건을 확인했다. beta.27 JAR을 실제 Burp에 재로드한 신원별 ZAP target campaign, Alert 500개 초과 실데이터, Codex Explorer target 요청·정상 종료, Judge 재현·대조는 아직 수행하지 않았다. 자동 회귀를 취약점 탐지율 또는 3-way 실환경 완주로 표현하지 않는다.

## 1.2.0-beta.26 ZAP HAR import gate

| 구분 | 결과 |
|---|---|
| 형식 계약 | HAR 1.2 `log.entries`에서 request method/URL/query/header/postData와 response status/header/content, startedDateTime을 SCANNER Evidence로 변환 |
| 신뢰 경계 | `source=SCANNER`, `sourceDetail=HAR_IMPORT`, `tool=ZAP`, `phase=IMPORT`, `executionTrust=IMPORTED` 고정. HAR import로 native Alert·ZAP campaign completion을 생성하지 않음 |
| 데이터 경계 | 25MiB 문서, JSON 깊이 128, token 1,000,000, 기존 payload 1MiB/압축 총량 48MiB, 인증 마스킹, current exact scope 적용. status 0은 response-less, binary base64는 metadata-only |
| 회귀 | `HarParserTest` 5개와 `FlowScopeWebServerTest` scanner-only API/UI 계약 통과 |
| 전체 자동 회귀 | `mvn clean verify`, 249 tests, 실패·오류·skip 0 + 완성 JAR manifest/classloader smoke 통과 |
| 배포물 | `target/flowscope-1.2.0-beta.26.jar`, 15,896,042 bytes, 2,034 entries, SHA-256 `ca5d969fb4d056e35b9dd6c420d211131f3a806c4105a5ec69ce7a45d762f232` |

이 gate는 합성 HAR와 localhost Web API로 import 계약을 확인했다. 실제 ZAP 2.17 UI가 내보낸 HAR의 beta.26 Burp 업로드, imported Evidence 상세 수동 확인, 원격 GitHub Actions는 아직 수행하지 않았다. HAR는 Alert 파일이 아니므로 live scanner 캠페인과 취약점 성능 gate를 대체하지 않는다.

## 1.2.0-beta.25 JAR streaming·MR relocation gate

| 구분 | 결과 |
|---|---|
| 결함 재현 | beta.24 완성 JAR은 `JarFile.isMultiRelease()==true`였지만 manifest가 선두에 없어 `JarInputStream.getManifest()==null` |
| manifest | Ant `<jar>`의 명시 manifest와 고정 `Created-By`로 재구성. 첫 엔트리 `META-INF/MANIFEST.MF`; streaming reader에서 Main-Class=`io.flowscope.burp.FlowScopeExtension`, Java-Version=`21`, Multi-Release=`true` 확인 |
| MR relocation | version 숫자 하드코딩 제거. `META-INF/versions/*` wildcard+mapper로 Jackson 7개, jsoup 3개, SnakeYAML 2개 versioned class 이동; 원 versioned package 누출 0 |
| 전체 자동 회귀 | `mvn clean verify`, 243 tests, 실패·오류·skip 0 + 완성 JAR manifest/classloader smoke 통과 |
| 반복 빌드 | 동일 소스·로컬 Maven/JDK의 clean package 2회 SHA-256 일치 |
| 배포물 | `target/flowscope-1.2.0-beta.25.jar`, 15,884,423 bytes, 2,031 entries, SHA-256 `6d422a88e78961ca50b92e2d78aa4ccf93af0026020a6a40badb2d447f74a34c` |

이 gate는 packaging 구조와 현재 dependency class의 실행을 검증한다. 실제 Burp load/unload, 외부 SBOM·서명 도구 전체와의 호환성, 원격 GitHub Actions는 아직 수행하지 않았다.

## 1.2.0-beta.24 판정 오라클·게시 격리 gate

| 구분 | 결과 |
|---|---|
| 리뷰 독립 판별 | C-01/02/03/08/09/10/12/13/14의 재현 경로를 수정. C-06은 `isBelow` 자체가 아니라 이를 권한 충분으로 역해석한 Judge 호출부만 결함으로 확정. C-07 생산 Pipeline stale 재현 실패, C-15 척도 통합 기각. C-04 부모 ID 확대 기각. C-05의 “비어 있지 않은 미지원 Authorization이 blank” 설명은 코드와 불일치 |
| 객체·거부 오라클 | `orderId/order_uuid/orderNo`와 generic `id/uuid/guid/pk`의 자원 한정 exact scalar match, 중첩 최종 자원 ID, 정상 데이터 내부 deny 문구 음성, 최상위 오류 봉투 양성 회귀 통과 |
| 입력 경계 | 1,000,000자·깊이 128·token/node 100,000 bounded JSON과 반복 순회. 소유자 판독과 DataFlow 후단도 같은 경계 사용. malformed/non-JSON DataFlow fallback 64KiB·값 1,000개 |
| 신원·정책 | `anon`과 `unresolved` 분리 및 둘의 계정 바인딩 거부, service canonicalization, unbind 재분석, UNKNOWN BFLA control 거부, 단일 monitor 정책 snapshot 회귀 통과 |
| 게시·키 무결성 | Burp/Web/MCP/Standalone isolated analysis copy, raw vault runtime ID 연결, 정책 snapshot, 위험 cell의 versioned framing, 기존 cell/review ID 및 legacy Evidence ID 보존 이행, LF/CRLF earliest delimiter 회귀 통과 |
| 전체 자동 회귀 | `mvn clean verify`, 243 tests, 실패·오류·skip 0 |
| 배포물 | `target/flowscope-1.2.0-beta.24.jar`, 15,924,691 bytes, 2,031 entries, SHA-256 `e7ccd253d08399b675feced3908ba76873ef2680124cc2e1281102cbb441f5f5`, ZIP·Main-Class·Java 21·Multi-Release manifest 검증 통과 |

이 gate는 결정론 오라클과 동시 게시 경계를 합성/자동 회귀로 확인한 것이다. `RequestRecord` 내부 DTO의 공개 가변 필드, DataFlow substring 소비 판정과 전체 조합 O(N²)은 남아 있다. beta.24 JAR의 실제 Burp load/unload, SQLite 저장·재열기, USER A/B·ZAP·LLM·Judge 전체 실행과 블라인드 탐지율은 아직 수행하지 않았다.

## 1.2.0-beta.23 배포물·CI 하드닝 gate

| 구분 | 결과 |
|---|---|
| 결함 확인 | 기존 fat JAR이 Jackson 원 NOTICE와 모든 MR-JAR class를 제거했고 SnakeYAML 귀속이 Jackson 항목에 섞였음. zero-match JAR shell 검사는 리터럴 glob을 한 파일로 셌고, Bash helper·반복 package SHA·action/plugin 고정 검사가 없었음 |
| 라이선스 | Apache NOTICE transformer로 Jackson 원 NOTICE를 `META-INF/NOTICE`에 병합. FastDoubleParser·ThirdParty·Schubfach 라이선스 3개 보존과 프로젝트 NOTICE의 별도 SnakeYAML 항목을 확인 |
| 패키징 | Jackson·jsoup·SnakeYAML base/MR-JAR 경로를 `io/flowscope/shaded`로 격리. Java 9/11/17/21 versioned class와 sqlite-jdbc Java 9 native-image class 보존, 원 Java package 누출 0. 완성 fat JAR smoke에서 JDK 21의 실제 versioned resource 선택과 relocated Jackson JSON 파싱 성공 |
| SQLite 격리 | sqlite-jdbc 3.53.1.0을 parent가 분리된 두 `URLClassLoader`에서 동시에 로드하고 두 in-memory connection의 `SELECT 1` 성공 |
| 자동 회귀 | `mvn clean verify`, 224 tests, 실패·오류·skip 0 |
| 스크립트 | Bash 5개가 로컬 `bash -n`과 ShellCheck 통과. PowerShell 4개는 기존 parser CI를 유지하며 이번 로컬 macOS에서는 실행하지 않음 |
| 반복 빌드 | 동일 소스·로컬 Maven/JDK에서 clean package 2회의 SHA-256 일치 |
| 배포물 | `target/flowscope-1.2.0-beta.23.jar`, 15,914,146 bytes, 2,029 entries, SHA-256 `832cec2068163a7dcfab23ea375cc6f61c8b2327a02d4035bbb7acd5c8d8dcc8`, ZIP·Main-Class·Java 21·Multi-Release manifest 검증 통과 |

이 gate는 배포물 구성과 현재 sqlite-jdbc의 classloader 동시 로드를 검증한 것이다. 임의의 미래 Burp 확장 조합에서 네이티브 충돌 확률 0을 증명하지 않으며, beta.23 JAR의 실제 Burp load/unload·프로젝트 저장/재열기와 원격 GitHub Actions는 아직 수행하지 않았다.

## 1.2.0-beta.22 첫 실행 경로 압축 gate

| 구분 | 결과 |
|---|---|
| 결함 확인 | 빠른 시작 한 화면에 범위·HUMAN·ZAP·LLM/Judge 설명과 제어가 모두 펼쳐져, 처음 쓰는 사용자가 현재 상태와 다음 행동을 직접 대조해야 했음 |
| 구현 | `범위 → HUMAN → ZAP → LLM/Judge` 네 단계 탭과 단계별 단일 패널로 재구성. 저장된 실행 상태에서 첫 미완료 단계를 자동 선택하고, 사용자가 다른 단계를 본 뒤에는 `현재 단계로`로 복귀 가능 |
| 문서 | README 시작 절차를 `처음 한 번만 준비`와 `점검할 때마다`로 분리하고, Docker가 선택 사항이며 ZAP Desktop/Docker 중 하나만 사용한다는 경계를 앞에 배치 |
| 자동 회귀 | `mvn clean verify`, 223 tests, 실패·오류·skip 0. 단계 마커, 패널 격리, HUMAN 완료 기준, 첫 미완료 단계 선택 계약 포함 |
| 브라우저 gate | standalone asset을 1280px와 390×844에서 확인. 단계 탭 전환 시 선택한 패널 하나만 표시되고, 390px에서 대화상자와 단계 탭의 수평 overflow가 없음을 DOM 측정 |
| 배포물 | `target/flowscope-1.2.0-beta.22.jar`, 15,871,087 bytes, 2,172 entries, SHA-256 `721055eb49d196342145615dde93c24162391b07dcfdbb98df46dbd42c691c38`, ZIP·Main-Class·Java 21 manifest 검증 통과 |

standalone gate는 정적 화면의 배치·탭 동작만 검증한다. 실제 Burp 상태에서 scope 저장, HUMAN 완료, ZAP 캠페인, Explorer와 Judge가 차례로 다음 단계에 반영되는 end-to-end 흐름은 별도 수동 gate이며 완료로 기록하지 않는다.

## 1.2.0-beta.21 ZAP 온보딩·Windows 설치 경로 gate

| 구분 | 결과 |
|---|---|
| 공식 근거 | Docker Desktop `host.docker.internal`, Compose file-backed secret, Microsoft cryptographic RNG·Set-Acl, GitHub Actions Windows `pwsh` 계약 확인 |
| 구현 | Desktop/Docker 공통 `zap-key.sh`·`zap-key.ps1`, Web ZAP 연결/version/key 상태와 연결 전 캠페인 차단, Windows PowerShell 7 `zap-up.ps1`·`zap-down.ps1`·`doctor.ps1`; 32-byte key, ACL 상속 제거·현재 SID 전용 FullControl, reparse point 거부, custom port, ZAP/API/upstream/add-on/provider/Web/MCP/build 진단 |
| Compose 회귀 | key를 container environment가 아닌 file-backed secret으로 전환. macOS 실제 ZAP 2.17.0에서 `/run/secrets/flowscope-zap-api-key` read, loopback API/version, `host.docker.internal:8081` upstream, 필수 add-on, doctor 0 failure·0 warning 재확인 |
| 원격 CI | [GitHub Actions run 33166311107](https://github.com/choewonwoo1817/testflowscope/actions/runs/33166311107)에서 Ubuntu `verify`와 `windows-latest` PowerShell 7 parser gate 모두 통과 |
| 자동 회귀 | `mvn clean verify`, 223 tests, 실패·오류·skip 0 |
| 배포물 | `target/flowscope-1.2.0-beta.21.jar`, 15,870,395 bytes, 2,172 entries, SHA-256 `3b9d892115d549e3b46e7eae63d59924b3c661a65e274912c64bb922655a7d2d`, ZIP·Main-Class·Java 21 manifest 검증 통과 |

이 gate는 배포 중립 연결 상태, Desktop key 준비, Windows용 실행 파일과 OS 독립 secret topology를 구현한 것이다. 실제 ZAP Desktop 수동 설정과 Windows 10/11 실기기의 Docker Desktop daemon, 방화벽, Burp listener, ZAP API/upstream, HTTPS와 target SCANNER capture는 아직 실행하지 않았으므로 완료로 계산하지 않는다.

## 1.2.0-beta.20 공개 설치·ZAP 환경 gate

| 구분 | 결과 |
|---|---|
| 자동 회귀 | `mvn clean verify`, 222 tests, 실패·오류·skip 0. ZAP API key의 system property→환경변수→지정 파일→기본 파일 우선순위와 파일 검증 회귀 포함 |
| Compose 정적 검증 | `docker compose config`와 `shellcheck` 통과. ZAP 이미지는 `ghcr.io/zaproxy/zaproxy:2.17.0`의 확인한 multi-arch digest로 고정 |
| 실제 컨테이너 | macOS arm64·Docker 29.5.3에서 ZAP 2.17.0을 별도 loopback 포트로 기동하고 health·API version·Network upstream `host.docker.internal:8081`·필수 add-on을 API로 재조회 |
| 설치 진단 | wrapper가 owner-only 64자리 hex key를 생성하고 key 값을 출력하거나 container environment에 넣지 않음. `doctor.sh --build`에서 HUMAN/SCANNER listener, key 권한, ZAP/version/upstream/add-on, provider CLI, Web/MCP, Maven/JDK를 0 failure·0 warning으로 점검한 뒤 `zap-down.sh`로 컨테이너·네트워크 종료 확인 |
| 배포물 | `target/flowscope-1.2.0-beta.20.jar`, 15,868,036 bytes, 2,172 entries, SHA-256 `24da2c47d49833bd06feb453599cc93ca448a028368a55be14a31b040c509aee`, ZIP·Main-Class·Java 21 manifest 검증 통과 |

이 gate는 설치 재현성과 ZAP→Burp 프록시 설정을 확인한 것이다. 실제 target SCANNER capture, HTTPS 인증서 경로, USER A/B session injection, Codex/Claude Explorer, Judge 결과는 수행하지 않았으므로 성공으로 계산하지 않는다.

## 1.2.0-beta.19 반응형 소유 경계 gate

| 구분 | 결과 |
|---|---|
| 결함 확인 | Cytoscape가 `#cy`에 쓰는 inline `display:block`을 좁은 화면 CSS가 덮어야 했고, beta.18의 `!important`는 라이브러리 내부 표현과 제품 반응형 정책을 같은 요소에서 충돌시켰음 |
| 수정 | Cytoscape는 `#cy`만 소유하고, FlowScope는 외부 `graphcanvas` 래퍼의 표시 상태만 소유하도록 DOM 책임을 분리. `!important` 제거 |
| 자동 회귀 | `mvn clean verify`, 221 tests, 실패·오류·skip 0. 반응형 CSS가 `graphcanvas`를 숨기고 래퍼 안에 `#cy`가 존재하는 Web 계약 포함 |
| 브라우저 gate | beta.19 standalone에서 1280px는 wrapper/Cytoscape 표시·목록 숨김, 600px는 wrapper 숨김·API 목록 4개 표시·page overflow 0 확인. Cytoscape 내부 inline `display:block`은 유지되지만 숨겨진 부모 밖으로 렌더되지 않음 |
| 배포물 | `target/flowscope-1.2.0-beta.19.jar`, 15,866,605 bytes, 2,170 entries, SHA-256 `066f237a26c59359a36c5ec59c5186ca8cbc6012c0a36904129074fdf4a3c420`, ZIP·Main-Class·Java 21 검증 통과 |

이 변경은 분석 데이터나 그래프 모델을 바꾸지 않고 렌더링 소유권만 정리한다.

## 1.2.0-beta.18 HTTP byte·Evidence UI gate

| 구분 | 결과 |
|---|---|
| 결함 확인 | beta.17 vault가 Montoya 메시지를 `String`으로 바꾼 뒤 UTF-8로 다시 저장해 한글 같은 비ASCII byte가 손실될 수 있었음. 긴 operation 라벨·접근선 텍스트가 겹치고, 좁은 화면의 고정 최소 폭 그래프가 잘렸으며, 파싱 행 선택과 관측 신원/ACTIVE 세션 문구가 불명확했음 |
| 구현 | raw request/response byte+body offset 보존, strict charset codec, 수정 없는 byte replay, binary/해독 실패 Web 편집 차단, slash-aware label, 반복일 때만 edge count, 900px 이하 필터 동등 API 목록, Evidence ID별 상세 버튼, 관측 신원/재사용 세션 분리 |
| 집중 회귀 | UTF-8 한글·emoji, 명시 EUC-KR, invalid UTF-8, binary 차단, 편집 재인코딩, vault 방어 복사·원 byte 일치, Request Lab API charset/identity/session, 반응형 목록·명시 상세 UI 계약 통과 |
| 전체 자동 회귀 | Java `--release 21`로 `mvn clean verify`, 221 tests, 실패·오류·skip 0 |
| 배포물 | `target/flowscope-1.2.0-beta.18.jar`, 15,866,589 bytes, SHA-256 `c3915f7fbb2451f00e8b858639fc5a1fa2d00ab72d397ac61c61e33b8612ac1c` |
| JAR 무결성 | ZIP 무결성 통과, 2,170 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, `Java-Version=21`, 공개 `target/*.jar` 1개, 새 codec·byte vault·Web asset 포함 |
| standalone UI | 합성 샘플·대상 요청 0건. 1280×720에서 page 수평 overflow 0과 새 신원 문구 확인. 600×800에서 Cytoscape를 숨기고 동일 필터 API 목록 4개 표시·page overflow 0. 목록 클릭으로 상세 열림. 파싱 표의 scanner Evidence를 눌러 선택 행 ID와 자동으로 펼친 상세 ID가 동일함을 확인 |
| 실제 beta.18 | 아직 수행하지 않음. Burp Community에서 새로 수집한 비ASCII live 요청/응답, 수정 없는 ORIGINAL byte 동일성, 편집 UTF-8/명시 charset, ANONYMOUS/ACCOUNT 헤더, binary Repeater fallback, 초기화/unload 폐기를 확인해야 함 |

beta.17에서 이미 깨진 문자열에는 원래 byte 정보가 없으므로 beta.18 UI가 이를 복원하지 않는다. JAR 재로드 후 해당 Evidence를 재수집해야 한다. standalone 검증은 레이아웃·선택 계약이며 실제 target 전송 성공을 대신하지 않는다.

## 1.2.0-beta.17 HUMAN 요청 실험실 gate

| 구분 | 결과 |
|---|---|
| 결함 확인 | 기존 Web은 마스킹 Evidence와 Repeater handoff만 제공해 진단자가 Web에서 세션·객체 값을 편집하고 응답을 비교할 수 없었음 |
| 공식 근거 | Burp Repeater/message editor/history, ZAP Requester, mitmproxy client replay의 편집·재전송·응답/시간 비교 흐름과 OWASP WSTG의 별도 계정·쿠키 대조 절차 확인 |
| 실패 우선 회귀 | `/api/request-lab`, UI 모드, raw snapshot 비노출 계약을 먼저 추가해 구현 전 Web 회귀 실패 확인 |
| 집중 회귀 | raw request/response retain, 메시지 상한, 총량 eviction, clear, capability API draft/send, snapshot raw 비밀 부재, Web 모드·문구 계약 통과 |
| 전체 자동 회귀 | Java `--release 21`로 `mvn clean verify`, 215 tests, 실패·오류·skip 0 |
| 배포물 | `target/flowscope-1.2.0-beta.17.jar`, 15,856,555 bytes, SHA-256 `5da5a0801c3a4f4d8cef31b7cceed6a958ead0233b159a2b5d91400d5cc5aaf1` |
| JAR 무결성 | ZIP 무결성 통과, 2,168 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, `Java-Version=21`, 공개 `target/*.jar` 1개, `TransientExchangeVault`·새 Web asset 포함 |
| standalone UI | 합성 샘플·대상 요청 0건. 1280×720에서 요청 실험실 1,244×684, request/response 양쪽 표시, page overflow 0; 600×800에서 단일 열 526px, 양쪽 편집기 높이 210px, page/dialog overflow 0; console warning/error 0 |
| 실제 beta.17 | 아직 수행하지 않음. Burp Community에서 live 원문, ORIGINAL/ANONYMOUS/USER A/USER B 수신 헤더, response, HUMAN VALIDATION provenance, discovery coverage 불변, reset/unload 폐기를 확인해야 함 |

standalone은 선택한 합성 샘플 Evidence의 마스킹된 읽기 전용 Request Lab 초안만 제공한다. `rawRequestRetained=false`, `rawResponseRetained=false`, `requestEditable=false`, 재사용 세션 없음으로 고정하며 POST 전송은 계속 거부한다. 위 렌더 검증은 layout과 무대상 읽기 계약만 증명하며 실제 Burp/Montoya 전송 성공을 대신하지 않는다.

## 1.2.0-beta.16 HUMAN 요청 문맥·표현 gate

| 구분 | 결과 |
|---|---|
| 결함 확인 | 비-Proxy Burp 도구가 응답 시점 HUMAN context를 읽어 pass 경계의 늦은 응답을 오귀속할 수 있었고, 권한 카드가 인증 artifact 수를 `세션 N개`로 표시함 |
| API 근거 | 로컬 Montoya API 2026.7의 `HttpRequestToBeSent`·`HttpResponseReceived` 양쪽에서 동일 상관키 `messageId()` 제공 확인 |
| 실패 우선 회귀 | tracker 구현 전 compile failure, principal-kind 표현 구현 전 Web 계약 failure 확인 |
| 집중 회귀 | 요청 시점 context/account/epoch 보존, capacity·TTL, 초기화 세대 거부, account 단일 표현 계약 통과 |
| 전체 자동 회귀 | Java `--release 21`로 `mvn clean verify`, 211 tests, 실패·오류·skip 0. 동시 Burp callback에서도 in-flight metadata 상한을 넘지 않는 회귀 포함 |
| 배포물 | `target/flowscope-1.2.0-beta.16.jar`, 15,842,551 bytes, SHA-256 `979bee7198a09d56e44dc5bd0c07125e6c9117762529097e1a2cf381e5adb35f` |
| JAR 무결성 | ZIP 무결성 통과, 2,162 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, 공개 `target/*.jar` 1개 |
| standalone UI | 새 beta.16 JAR을 별도 loopback 포트에서 실행해 1280×720 수평 overflow 0, role 카드의 `등록 계정` 단일 표시, 계정 카드 1개당 접힌 인증 단서, SCANNER·LLM 해제 시 관측 API 4→3 재구축을 확인. 합성 샘플이며 대상 요청 0건 |
| 실제 beta.16 | 아직 수행하지 않음. Burp Browser HUMAN pass, pass 중 Repeater, pass 종료 뒤 늦은 응답, 초기화 직후 응답, SQLite 저장·재열기 확인 필요 |

현재 열린 사용자 Web 탭은 beta.9였으므로 그 화면을 beta.16 렌더 검증으로 계산하지 않는다. 자동 회귀는 코드 계약을 확인하지만 실제 Burp callback 순서와 사용자 작업면을 대신하지 않는다.

## 1.2.0-beta.15 rendered crawler 완료 gate

| 구분 | 결과 |
|---|---|
| 결함 재현 | 실제 beta.14 crAPI anonymous ZAP 실행에서 전체 8건·Traditional 8건·Rendered 0건·native Alert 22건인데 UI가 `COMPLETED`로 표시됨 |
| 원인 확인 | ZAP 2.17 task 로그에 Client Spider가 Firefox browser binary를 찾지 못해 시작 실패한 사실이 남았지만 Client status API는 `100`을 반환함 |
| 실패 우선 회귀 | Client status 100과 Client capture 0을 만든 fixture에서 기존 구현이 AJAX를 호출하지 않고 `COMPLETED`가 되는 것을 재현함 |
| 수정 집중 회귀 | 동일 fixture에서 AJAX 호출·rendered capture 1·`COMPLETED_WITH_WARNINGS`, Traditional 1/Client 0/AJAX 0 fixture의 Evidence 보존·경고 완료, Web 경고 상태 계약 통과 |
| 전체 자동 회귀 | Java `--release 21`로 `mvn clean verify`, 207 tests, 실패·오류·skip 0 |
| 배포물 | `target/flowscope-1.2.0-beta.15.jar`, 15,839,086 bytes, SHA-256 `40c9d12fc1a550abc77bac9de57feb588fba5587eeb37aef5d6e6ed4d36467ff` |
| JAR 무결성 | ZIP 무결성 통과, 2,161 entries, 공개 `target/*.jar` 1개 |
| 실제 beta.15 | 같은 crAPI anonymous 실행에서 Client→AJAX fallback, 전체 226건·Traditional 8건·Rendered 218건·native Alert 30건과 warning-completed UI를 관측함 |

`COMPLETED_WITH_WARNINGS`는 scanner exploration 데이터가 존재해 비교에는 사용할 수 있지만 browser-rendered discovery가 정상 완료됐다는 뜻은 아니다. Firefox 부재는 이번 로컬 환경의 확인된 원인이고, 일반 제품 판정은 OS·브라우저 이름을 추측하지 않고 단계별 raw capture 0만 사실로 표시한다.

## 1.2.0-beta.14 자동·standalone 사전검증

| 구분 | 결과 |
|---|---|
| 자동 회귀 | Java `--release 21`로 `mvn clean verify`, 206 tests, 실패·오류·skip 0 |
| raw completion gate | 분석 snapshot 0건/raw SCANNER count 1건 fixture에서 ZAP 캠페인 `COMPLETED`; raw `source + runId + sourceDetail` count 단위 테스트 통과 |
| stage projection | Traditional 1건, Client rendered 1건을 lane JSON의 `traditional_captures/rendered_captures`로 분리하고 기존 3-lane zero-capture failure/completion 회귀 통과 |
| Web scanner UI | whs_flow 기반 작업면의 lane card 계약, 상태·단계·전체/Traditional/Rendered/Alert·warning/error 이스케이프 렌더 회귀 통과 |
| standalone Web | 1280×720 빠른 시작 modal에서 전체 page·modal·scanner 영역 수평 overflow 0, beta.14 tag와 scanner controls 렌더 확인. 실제 RUNNING lane card는 네트워크 실행 없이 조작하지 않음 |
| 로컬 ZAP 환경 | loopback API에서 ZAP `2.17.0`, `spider 0.18.0`, `client 0.20.0`, `pscan 0.6.0` 설치 상태를 읽기 전용 확인. beta.14 대상 스캔은 실행하지 않음 |
| 배포물 | `target/flowscope-1.2.0-beta.14.jar`, 15,838,496 bytes, SHA-256 `aad50e262a5ed70976da3dae21f070fd57e3354e52cc1681c00f482f814bb0aa` |
| JAR 무결성 | ZIP 무결성 통과, 2,161 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, `Java-Version=21`, 공개 `target/*.jar` 1개 |

이 자동 검증 뒤 beta.14 JAR을 실제 Burp Community와 ZAP 2.17에 연결했다. crAPI에서 등록 계정 `test1`의 로그인 캡처가 `ACTIVE`가 됐고 HUMAN pass로 정상 UI route를 이동한 결과 HUMAN 17건이 exact exploration run에 귀속됐다. anonymous ZAP은 전체 8건·Traditional 8건·Rendered 0건·native Alert 22건으로 끝났다. ZAP Client task는 Firefox binary 부재로 실패했지만 status API가 100을 반환해 beta.14가 이를 깨끗한 완료로 오표시했고, 이 사실이 beta.15 수정의 재현 근거가 됐다. USER A/B 복수 세션 주입과 late-response 경계는 아직 실행하지 않았으며 endpoint 발견률, Alert 완전성, 취약점 탐지 성능 개선으로 해석하지 않는다.

## 1.2.0-beta.13 자동·standalone 사전검증

| 구분 | 결과 |
|---|---|
| 자동 회귀 | Java `--release 21`로 `mvn clean verify`, 204 tests, 실패·오류·skip 0 |
| HUMAN run | idle/begin/end/rebegin의 완료 상태 `false/false/true/false`, Web 1초 동기화, record count 기반 완료 문구 부재 회귀 통과 |
| HUMAN provenance | pass 중 Repeater·Intruder detail과 `BURP` tool 유지, 브라우저 및 통제 LLM context tool 유지 회귀 통과 |
| 범용 구조 프로파일 | 동일 service·method·path·field 위치의 `customerNo/documentSeq/accountRef/guid` 복수 값은 semantic object로 보강하고 단일 관측·다른 path·`pageNo/sortKey/apiKey/statusCode/valid/fluid`는 제외하는 회귀 통과 |
| standalone Human UI | 빠른 시작에서 `HUMAN pass 시작` 뒤 1.3초 내 `진행 중`, exact 종료 뒤 1.3초 내 `pass 완료` 표시 확인 |
| 배포물 | `target/flowscope-1.2.0-beta.13.jar`, 15,836,587 bytes, SHA-256 `d306eb9dd7be5d9fe761074b1697d1ddf04718a5fcaf342a704a2ad1eeaa62d7` |
| JAR 무결성 | ZIP 무결성 통과, 2,161 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, `Java-Version=21`, 공개 `target/*.jar` 1개 |

이 검증은 Human 실행 상태와 provenance, 제한된 semantic identifier 보강의 결정론을 확인한 것이다. `*_SEMANTIC_FIELD_CORROBORATED`는 도메인 schema·소유권·인가 취약점 증명이 아니며, 동적 JavaScript에서 아직 전송되지 않은 경로나 단일 관측 식별자를 찾는다는 뜻도 아니다. 실제 Burp Community beta.13 재로드, Browser/Repeater/Intruder 캡처, 다양한 블라인드 대상의 field-level precision/recall·REVIEW 비용은 수동·벤치마크 gate로 남아 있다.

## 1.2.0-beta.12 자동·standalone 사전검증

| 구분 | 결과 |
|---|---|
| 자동 회귀 | JDK 26에서 Java `--release 21`로 `mvn clean verify`, 198 tests, 실패·오류·skip 0 |
| 세션 귀속 | 같은 service/fingerprint의 다른 account 재연결 거부, broker 충돌 `SUSPECT` 고정, 종료·추가 응답 뒤 비재활성, 충돌 세션 신원 매칭 제외 회귀 통과 |
| Web 계약 | 동일 identity/resource/source 접근선 집계와 원 CoverageCell 키 보존, 집계 상세 이동, 전체 경로 줄바꿈·동적 높이, graph-state v4, 충돌 행동 문구 회귀 통과 |
| standalone graph | 번들 합성 샘플에서 USER A→orders:101 HUMAN 접근선이 `H×2` 한 선으로 보이고 클릭 시 원 operation 2개(GET/PATCH), 총 2건, 각 판정·갭 및 원 cell 이동 항목을 표시. 화면 전체 수평 overflow 0 |
| 배포물 | `target/flowscope-1.2.0-beta.12.jar`, 15,829,896 bytes, SHA-256 `b684549f0468964a6d2193fa64979448eab3950b768e7c39a61864bd3b49980c` |
| JAR 무결성 | ZIP 무결성 통과, 2,158 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, `Java-Version=21`, 확장 진입점·SQLite JDBC class/service·번들 고지 포함, 공개 `target/*.jar` 1개 |

이 검증은 계정 귀속 fail-closed와 그래프 표시 중복·라벨·상세 이동을 확인한 것이다. 집계 전후 Java coverage cell과 Evidence는 그대로이고, endpoint 발견률·인가 판정 정확도·오탐·미탐 0을 입증하지 않는다. 실제 Burp Community에서 beta.12 JAR 재로드, 서로 다른 등록 계정에 동일 로그인 정보가 들어오는 충돌 절차, 실제 HUMAN 장경로·대규모 그래프는 수동 gate로 남아 있다.

## 1.2.0-beta.11 자동·standalone 사전검증

| 구분 | 결과 |
|---|---|
| 자동 회귀 | JDK 26에서 Java `--release 21`로 `mvn clean verify`, 195 tests, 실패·오류·skip 0 |
| Web 계약 | source별 메인 Evidence 수, 0건 source 비활성, 필터 변경 시 graph 재구축, 두 접근 구간의 source 문법, 메인 graph의 flow edge 부재, role cycle 부재 회귀 통과 |
| standalone source 필터 | 합성 H4/S2/L3에서 SCANNER·LLM을 해제하자 checked 상태가 H만 남고 관측 API가 4→3으로 재구축됨. HUMAN 접근 경로 두 구간이 파랑·실선·H로 표시되고 응답→요청 데이터 의존선은 메인 graph에 나타나지 않음 |
| standalone 정책·반응형 | 권한 정책은 계정 역할 2개와 API 요구 권한 2개를 읽기 전용으로 표시하고 조작 button 0. 600×800에서 page horizontal overflow 0, console warning/error 0 |
| 배포물 | `target/flowscope-1.2.0-beta.11.jar`, 15,826,900 bytes, SHA-256 `f81bd55ab92da93e05601e116556abe58507b4d3222d0be18ec517c532be2788` |
| JAR 무결성 | ZIP 무결성 통과, 2,157 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, `Java-Version=21`, SQLite JDBC class/service와 macOS/Linux/Windows native 자원·번들 고지 포함, 공개 `target/*.jar` 1개 |

이 검증은 그래프 표현과 필터 상호작용의 정합성을 확인한 것이다. coverage·gap·verdict 계산은 beta.10과 동일하며, 실제 Burp Community의 beta.11 재로드와 실제 HUMAN 데이터에서 0건 SCANNER/LLM 비활성 표시를 확인하는 수동 gate가 남아 있다. endpoint 발견률, 취약점 탐지율, 오탐·미탐 0을 주장하지 않는다.

## 1.2.0-beta.10 자동·standalone 사전검증

| 구분 | 결과 |
|---|---|
| 자동 회귀 | JDK 26에서 Java `--release 21`로 `mvn clean verify`, 195 tests, 실패·오류·skip 0 |
| SQLite 프로젝트 | SQLite header와 storage schema v1 관계형 table, record/payload/account/session binding/policy/review/assessment/validation/completed lane/route round-trip, payload BLOB 분리, raw Cookie 문자열 부재, 미지원 schema 거부 회귀 통과 |
| 계정 projection | Cookie·Authorization·subject 지문 3개가 같은 service의 `test1` account ID 하나로 반환되고, Web 기본 화면은 계정 카드·행동 상태를 우선하며 내부 지문은 접힌 기술 정보/고급 진단으로 분리하는 계약 통과 |
| standalone UI | beta.10 합성 샘플의 계정 화면에서 등록 계정 카드, `로그인 필요` 행동 안내, 닫힌 `고급 세션 진단` 확인. 1280×720과 600×800 모두 page horizontal overflow 0, console warning/error 0 |
| fat JAR SQLite smoke | JDK 26/macOS arm64에서 배포 JAR만 classpath에 두고 JDBC service discovery로 in-memory SQLite 3.53.1 연결·query 성공 |
| 배포물 | `target/flowscope-1.2.0-beta.10.jar`, 15,826,751 bytes, SHA-256 `60709dfc90ec2fd4af539f2fd0453fe2b22b4da0e2382f8abc4a5a9793f62988` |
| JAR 무결성 | ZIP 무결성 통과, 2,157 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, `Java-Version=21`, SQLite JDBC class/service 및 macOS/Linux/Windows native 자원·번들 고지 포함, 공개 `target/*.jar` 1개 |

SQLite 자동 저장은 사용자가 DB를 처음 저장/연 뒤 30초 checkpoint와 정상 unload 직전 저장을 시도하는 전체 snapshot 방식이다. append-only event store나 다중 사용자 server backend가 아니며 live 20,000 record·project 100MiB 상한을 유지한다. 자동 JDK 26에서는 native access 경고가 있었지만 연결과 query는 성공했다. beta.10 fat JAR을 실제 Burp Community bundled JVM에서 로드해 DB 저장→변경→unload→재열기와 raw broker 재로그인을 확인하는 gate는 아직 남아 있다. 따라서 실환경 내구성, 무제한 수집, 오탐·미탐 0을 주장하지 않는다.

## 1.2.0-beta.9 자동·standalone 사전검증

| 구분 | 결과 |
|---|---|
| 자동 회귀 | JDK 26에서 Java `--release 21`로 `mvn clean verify`, 192 tests, 실패·오류·skip 0 |
| 경로 묶음 corpus | 서로 다른 `/orders/101`·`/orders/202`, 응답 ID 일치, 다른 method 전파, UUID/긴 hex, 근거 없는 단일 `/status/200`, 날짜·API version, service 경계, 중첩 generic ID, raw path 보존 8개 회귀와 route inventory 10개 회귀 통과 |
| 기존 분석 회귀 | 단일 숫자 operation을 literal로 유지하더라도 path 객체 후보는 보존해 기존 BOLA/BFLA·owner·private object API·graph 회귀 전체 통과 |
| Web/MCP 계약 | snapshot과 MCP record에 `pathTemplateStatus/path_template_status` 및 범주형 이유 노출, operation 상세에서 원문 요청과 `CORROBORATED · RESPONSE_ID_MATCH`를 함께 확인 |
| standalone UI | beta.9 합성 샘플에서 beta.8의 `identity → resource → operation` 작업면과 7조합·미교차 1·일부 7·불일치 2 유지. 1280×720과 600×800에서 page horizontal overflow 0, console warning/error 0. 1280 화면에서 상세의 경로 근거와 Request/Response가 보이며 우측 패널이 viewport 안에 위치 |
| 배포물 | `target/flowscope-1.2.0-beta.9.jar`, 3,850,581 bytes, SHA-256 `b13313a3bcea198b9bdd19932aa65839a06f7a99728d8b6e98b2d2e0dc7471e6` |
| JAR 무결성 | ZIP 무결성 통과, 1,962 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, `Java-Version=21`, 공개 `target/*.jar` 1개 |

`CORROBORATED`는 서버 route declaration 확정이 아니라 성공 응답의 정확한 ID 값이 경로 변수 추론을 보강했다는 뜻이다. UUID/긴 hex와 복수 값 반복은 `INFERRED`로만 표시한다. 복수 값 반복 역시 실제 route의 증명은 아니므로 raw path와 이유를 유지한다. beta.9 JAR의 Burp Community 재로드, 실제 HUMAN 장시간 수집, 독립 blind-target path-template confusion matrix는 아직 수동 gate다. 따라서 오탐·미탐 0이나 실제 대상 취약점 탐지 성능을 주장하지 않는다.

## 1.2.0-beta.8 자동·standalone 사전검증

| 구분 | 결과 |
|---|---|
| 자동 회귀 | JDK 26에서 Java `--release 21`로 `mvn clean verify`, 183 tests, 실패·오류·skip 0 |
| 전문 보존 | textual GZIP round-trip, 1MiB 초과·binary·압축 총량 초과 metadata-only, metadata 전환 시 digest/byte 유지, digest/byte 손상 거부, Evidence ID·반복 collapse의 payload digest 사용 회귀 통과 |
| project schema v2 | 같은 digest blob 1회 저장, request/response reference round-trip, 8KiB를 넘는 masked 전문 복구, legacy schema v1 읽기, 저장 전 비밀 재검사 회귀 통과 |
| 분류기 v4 | HUMAN `SESSION_SETUP → AUTH_SESSION/EXCLUDE`, 반복 안정 unknown 3건 → `POLLING/REVIEW`, 원 Evidence와 메인 coverage 분리 회귀 통과 |
| 객체 추출 | path/query와 중첩 JSON·배열·XML·multipart·GraphQL의 복수 명시 ID를 근거별로 보존하고 보수적 primary 하나만 인가 cell에 사용 |
| Web 계약 | snapshot dropped count와 metadata-only message count, 전문 retention/bytes/digest/reason, 복수 objects, AUTH_SESSION/POLLING filter, source-only node hide와 선택적 보조 흐름 정적 계약 회귀 통과 |
| standalone UI | 새로 컴파일한 beta.8 샘플에서 보조 흐름 4건을 켜도 관측 7조합·미교차 1·일부 7·불일치 2가 유지됨. Evidence를 펼쳐 Request 88 bytes·Response 106 bytes, 압축 보존·SHA-256·마스킹 전문을 확인. “실제 HUMAN/ZAP/LLM 점검 결과가 아님·대상 네트워크 요청 0건” 배너가 지속 표시되고 console warning/error 0 |
| 배포물 | `target/flowscope-1.2.0-beta.8.jar`, 3,840,945 bytes, SHA-256 `63adff71dabdfadd686ff0c408043be14fb5a63f86c784fdb3d2a65e9394ff7e` |
| JAR 무결성 | ZIP 무결성 통과, 1,957 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, `Java-Version=21`, Montoya class 0, 번들 AGENTS와 Web 자산·`StoredPayload` 포함, 공개 `target/*.jar` 1개 |

standalone은 네트워크 대상 요청을 만들지 않는 샘플 UI 검증이다. beta.8 JAR의 Burp Community 재로드, 실제 Burp Browser 장시간 수집, 20,000건 초과 경고, 대용량 project 저장/복구, 다양한 blind MPA/SPA/GraphQL 분류·추출 성능은 아직 확인하지 않았다. 따라서 이 표는 오탐·미탐 0, 무제한 수집, 실제 대상 취약점 탐지 성능의 근거가 아니다.

## 1.2.0-beta.7 자동 사전검증

| 구분 | 결과 |
|---|---|
| 자동 회귀 | JDK 26에서 Java `--release 21`로 `mvn clean verify`, 176 tests, 실패·오류·skip 0 |
| 로컬 CLI 계약 | 현재 설치 Codex CLI 0.147.0과 Claude Code 2.1.231 help에서 사용 인자 확인. Explorer fresh/no-resume, Judge 별도 session/exact resume, 사용자 설정·auto-memory 배제, 역할별 명령과 환경 token 전달 회귀 통과 |
| 무대상 CLI smoke | 사용자 승인 뒤 exact target·MCP 없이 동일 격리 계열 인자로 Codex가 exit 0·정확한 `OK`를 반환. Claude는 provider 요청까지 진입했으나 HTTP 429 주간 한도로 실패했으므로 성공 아님 |
| Explorer 완료 gate | 선발급 exact LLM run을 CLI가 종료하지 않으면 abort·FAILED, inactive account와 locked dataset 시작 거부, 새 exploration 시작 시 과거 완료 표식 무효화 회귀 통과 |
| Judge gate | HUMAN·SCANNER·LLM 완료 전 시작 거부, 실제 dataset lock 미완료 시 실패, Claude exact session resume, 96KiB Codex 출력 시작부 thread ID 보존 회귀 통과 |
| Web/Burp 상태 | `/api/llm-run` 시작·상태·취소·후속 계약, 완료 레인 목록, 세 레인 전 Judge UI 비활성, active run/lock 중 Burp UI scope 변경 차단 회귀 통과 |
| 비밀·프로세스 경계 | MCP Bearer는 child environment에만 있고 prompt·Codex 모델 shell에 없음, OpenAI/Anthropic API key 비상속, shell 없는 executable 호출, 임시 workspace owner-only/정리, 취소·unload 경합 child 종료, 공개 output 마스킹·상한 적용 |
| standalone UI | beta.7 tag와 빠른 시작의 공급자·target·account·Explorer/Judge·후속 controls를 확인. 423×799 viewport에서 page horizontal overflow 0, modal 세로 scroll과 상단 카드 가독성 확인 |
| 배포물 | `target/flowscope-1.2.0-beta.7.jar`, 3,824,841 bytes, SHA-256 `c8fd3f8ae1b85c9708020fb4f933c253b04fcd4090eb19837c9eab74220a21c1` |
| JAR 무결성 | ZIP 무결성 통과, 1,954 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, `Java-Version=21`, 번들 AGENTS/Explorer/Judge 3개 리소스 포함, 공개 `target/*.jar` 1개, 연속 non-clean package SHA-256 동일 |

이 결과는 beta.7 당시 실행 명령 생성, 상태 불변식, Web API/UI와 패키징의 자동·standalone 검증과 Codex 무대상 CLI smoke다. 당시 Burp가 beta.3 UI를 실행 중이었으므로 beta.7 JAR의 구독 로그인 Codex/Claude→MCP 대상 요청→exact run 종료→별도 Judge lock·validation·후속 resume end-to-end는 확인하지 못했다. Claude의 no-persistence metadata 파일 0개도 보장하지 않았다. 이후 버전의 현재 검증 상태는 이 문서 맨 위 최신 절을 따르며, 이 역사 기록을 버튼 자동화의 실환경 성공이나 취약점 탐지 성능 근거로 사용하지 않는다.

## 1.2.0-beta.6 자동 사전검증

| 구분 | 결과 |
|---|---|
| 자동 회귀 | JDK 26에서 Java `--release 21`로 `mvn clean verify`, 165 tests, 실패·오류·skip 0 |
| run별 후보 view | HUMAN observed와 LLM literal이 병합된 후보를 LLM run으로 자르면 LLM provenance 1개·`observed=false`·`REVIEW`로 재계산되고 HUMAN-only 후보는 0건 노출되는 회귀 통과 |
| pre-lock 격리 | active Explorer 전 다른 source count·record count·active run을 status에서 숨김. Explorer 중 ZAP baseline 상태와 assessment/validation 목록 접근 거부 회귀 통과 |
| candidate lock | lock 응답에 route candidate 수 포함, lock 뒤 live state 후보를 교체해도 `flowscope_list_route_candidates`가 잠긴 목록을 반환하는 회귀 통과 |
| 배포물 | `target/flowscope-1.2.0-beta.6.jar`, 3,791,977 bytes, SHA-256 `db8aa738accdb70991d9015b17029775774a5aa01f026403014715fbe5290ab9` |
| JAR 무결성 | ZIP 무결성 통과, 1,941 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, `Java-Version=21`, 공개 `target/*.jar` 1개, 연속 non-clean package 크기·SHA-256 동일 |
| fat JAR runtime | JDK 21에서 완성 JAR만 classpath에 두고 HTML5 DOM·OpenAPI YAML·generic XML adapter를 직접 실행, `FAT_JAR_DISCOVERY_SMOKE_OK` 확인 |

이 결과는 서버 가시성 규칙과 candidate snapshot의 결정론적 회귀다. 실제 구독형 Codex/Claude가 beta.6 MCP에 연결된 end-to-end Explorer/Judge 실행과 지연 응답/rebuild 경합은 아직 확인하지 않았다. 자동 회귀를 실환경 격리 완료로 소급하지 않는다.

## 1.2.0-beta.5 자동 사전검증

| 구분 | 결과 |
|---|---|
| 자동 회귀 | JDK 26에서 Java `--release 21`로 `mvn clean verify`, 164 tests, 실패·오류·skip 0 |
| 공통 discovery corpus | target 비종속 protocol fixture 7종, truth route 18개에서 TP 18·FP 0·FN 0. 이는 구현 회귀 수치이며 blind target 성능 수치가 아님 |
| 공통 경계 회귀 | exact scope, unsupported scheme, 동적 JS 문자열, XML XXE, method 없는 `UNKNOWN`, 같은 path의 관측 `GET`/미관측 `UNKNOWN` 분리, provenance source/run/adapter 병합 통과 |
| 배포물 | `target/flowscope-1.2.0-beta.5.jar`, 3,787,475 bytes, SHA-256 `e5cf26d00aa3446ec9983114d7d8c35eb850d16f815387c14becbb787b087c50` |
| JAR 무결성 | ZIP 무결성 통과, 1,940 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, `Java-Version=21`, 공개 `target/*.jar` 1개, 연속 non-clean package 크기·SHA-256 동일 |
| fat JAR runtime | JDK 21에서 완성 JAR만 classpath에 두고 HTML5 DOM·OpenAPI YAML·generic XML adapter를 직접 실행, `FAT_JAR_DISCOVERY_SMOKE_OK` 확인 |
| 의존성 패키징 | jsoup 1.23.1, Jackson YAML 2.22.2, SnakeYAML 2.5 class와 고지 포함; relocated Jackson service metadata 병합 확인 |
| 저장·Web 계약 | provenance `(type, evidenceId, source, runId, adapter)` project 왕복, legacy migration, snapshot/Web 상세 대응 관계 회귀 통과 |

이 결과는 공통 route discovery의 코드·고정 fixture·패키징을 검증한 것이다. 실제 Burp Community에서 beta.5 JAR 재로드, 응답 없는 Site Map 항목, 실제 Burp Browser corpus, blind target endpoint 발견률은 아직 검증하지 않았다. 고정 corpus의 TP/FP/FN을 실제 대상 성능으로 소급하지 않는다.

## 1.2.0-beta.4 자동 사전검증

| 구분 | 결과 |
|---|---|
| 자동 회귀 | JDK 26에서 Java `--release 21`로 `mvn clean verify`, 157 tests, 실패·오류·skip 0 |
| 배포물 | `target/flowscope-1.2.0-beta.4.jar`, 2,848,251 bytes, SHA-256 `89f1744cc5702611c474c7eb6baba2f7a79797c184c5c915f635ee5f21eb7f5a` |
| JAR 무결성 | ZIP 무결성 통과, `Main-Class=io.flowscope.burp.FlowScopeExtension`, `Java-Version=21`, 공개 `target/*.jar` 1개, 연속 non-clean package 크기·SHA-256 동일 |
| 분류기 v3 | manifest·source map·service worker 분리, 같은 service·operation API Evidence 교차 보강, 응답 없음·다른 service gate와 원 Evidence 보존 회귀 통과 |
| route candidate | exact-scope HTML/form/Location/robots/sitemap/manifest/정적 JS/OpenAPI/Site Map seed 추출, 범위 밖·동적 조합 배제, coverage·finding 비오염 회귀 통과 |
| 객체 근거 | 고정 confidence 제거, path/query/body/GraphQL/derived 근거와 nested/array JSON·multipart 회귀 통과 |
| 저장·Web 계약 | candidate project 왕복, snapshot provenance·범주형 정렬 이유, 전용 수량·필터·상세 계약 통과 |
| 실제 standalone UI | 1280×720과 600×800에서 가로 overflow 0, 잘린 핵심 조작 0, console warning/error 0 |

이 결과는 Java/Web 자동 회귀와 standalone 브라우저 화면을 검증한 것이다. beta.4 JAR을 Burp Community에 제거·재로드한 결과, 응답 없는 실제 Site Map 항목의 Montoya 반환, 실제 Burp Browser HUMAN pass, candidate가 존재하는 Burp 데이터 화면은 아직 확인하지 않았다. 아래 beta.3 실환경 결과를 beta.4에 소급하지 않는다.

## beta.3 자동 검증 통과

| 구분 | 결과 |
|---|---|
| 자동 회귀 | JDK 21.0.12, Java `--release 21`로 `mvn clean verify`, 147 tests, 실패·오류·skip 0 |
| 배포물 | `target/flowscope-1.2.0-beta.3.jar`, 2,826,076 bytes, SHA-256 `e8d41fbdea56101063d59ec27b378de5ee9a06d001c516122eeac8c0446b4cae` |
| JAR 무결성 | ZIP 무결성 통과, 1,298 entries, `Main-Class=io.flowscope.burp.FlowScopeExtension`, Java 21 |
| 배포 계약 | 공개 `target/*.jar` 정확히 1개, 반복 package 크기·SHA-256 동일, Montoya 미포함, FlowScope/Jackson/Cytoscape 고지와 Web 자산 포함, 개발 머신 절대경로·제품 코드의 리터럴 비밀값 없음 |
| Session Broker | successful response 전 `UNVERIFIED`, 같은-service 동시 캡처 거부, 계정별 Cookie·Authorization·CSRF 주입, 회전·삭제·scope·expiry, `SUSPECT` 차단, revoke/clear 메모리 제거 |
| 실행 신뢰도 | `CONTROLLED`, `OBSERVED`, `UNVERIFIED_RUNTIME`, `IMPORTED`, `UNKNOWN` 구분과 최종 판정 gate 검증 |
| LLM Explorer | 실행 중 다른 lane·후보·gap·finding 격리, exact-scope controlled request, run `account_id`의 executor 전달, 쓰기 확인, broker 소유 헤더와 CR/LF 거부 |
| Dataset lock | HUMAN·SCANNER·LLM의 성공한 response-bearing exploration을 요구하고 빈 lane·active run·scope 변경 거부 |
| LLM Judge | lock 이후 후보/오라클 고정, 실제 validation Evidence 추가, 저장 후 복원 시 pre-Judge snapshot 재구성, 서버 권위 verdict 검증 |
| ZAP campaign | 비로그인 → USER A → USER B 순서, 신원별 `core/newSession`, account context 전환, Traditional Spider → Client Spider → AJAX fallback → passive queue drain → native alerts, zero-capture/실패 gate와 alert 마스킹 검증 |
| Web scanner guard | 비로그인·복수 ACTIVE 계정 form contract, 신원별 상태 JSON, 현재 FlowScope Web loopback port의 target 목록 제외와 시작 거부 검증 |
| 프로젝트 | raw session 미저장, 명시적 완료 lane 저장, 중단된 기록으로 완료 상태를 추론하지 않음 |
| Traffic classification | `INCLUDE`만 main coverage, `REVIEW` 검토 대기, `EXCLUDE` 기본 숨김으로 상호 배타 집계, operation override, no Evidence deletion, classifier version persistence |
| Identity 안정화 | `ANONYMOUS/ACCOUNT_BOUND/UNRESOLVED`, 1,000 rotating cookies의 graph identity 폭증 방지, 명시 binding 보존 |
| Capture scope | HUMAN 브라우저의 범위 밖 이동은 허용하되 모든 source의 저장 Evidence는 현재 exact scope로 제한 |
| HUMAN run 경계 | 로그인 캡처 `SESSION_SETUP`·pass 밖 `BASELINE`은 Evidence로 보존하되 coverage에서 제외하고, 명시적 `EXPLORATION` pass만 HUMAN 3-way 비교에 포함 |
| 요청 시점 provenance | Proxy `messageId`로 request-time run/account 문맥을 응답까지 고정, HUMAN 선택 계정 exact credential match, SYSTEM anonymous Cookie의 `anon` 유지 |
| Authorization oracle | owner는 성공한 2xx 비메타데이터 응답에서만 확정, login redirect는 완전한 경로 세그먼트, BOLA read는 대상 객체 ID가 있는 응답만 객체 Evidence로 인정 |

## UI 검증 통과

새 beta.3 산출물의 standalone Web UI로 다음을 확인했다.

- 1500×900, 900×700, 600×800 viewport에서 quick-start, 계정 관리, matrix가 수평으로 잘리거나 주요 조작을 숨기지 않았다.
- 작은 화면에서는 modal이 세로 스크롤되고 계정 카드와 표가 화면 폭에 맞게 재배치된다.
- matrix cell에서 해당 API의 Evidence 목록과 마스킹된 Request/Response를 필요할 때 펼칠 수 있다.
- 브라우저 콘솔 오류는 0건이었다.
- 현재 분류 UI를 1024×768에서 추가 검증했다. page horizontal overflow와 ellipsis 잘림은 0건이었고, 여섯 mode 전환, quick-start, 파싱 행의 stable Evidence ID→operation 상세, classification/repeat 표시와 override 조작이 동작했다.
- 현재 source palette를 1280×720에서 추가 검증했다. HUMAN 파랑·실선, SCANNER 빨강·파선, LLM 검정·점선과 H/S/L 노드 표기가 범례·그래프에 일치했고, body 가로·세로 overflow와 클라이언트 오류는 0건이었다.
- `INCLUDE/REVIEW/EXCLUDE` 처분 필터를 1280×720 standalone에서 확인했다. 파싱 결과 10행에서 REVIEW 해제 시 9행, INCLUDE까지 해제 시 0행, REVIEW만 선택 시 1행이었고 해당 상세에 검토 상태와 `분석에 포함` override가 표시됐다. page overflow와 console error는 0이었다.
- 실제 0-Evidence 입력으로 1280×720 standalone 빈 상태를 확인했다. 분석 rail·stage·detail은 숨겨지고 네 단계와 빠른 시작·샘플 조작만 보였으며, quick-start 모달이 열리고 샘플 뒤 기존 분석 화면으로 전환됐다. body overflow와 console error는 0이었다.

Standalone UI는 레이아웃과 클라이언트 동작 검증이다. Burp Community의 실제 suite tab 동작을 대신하지 않는다.

신원별 scanner control은 1280×720과 600×800 standalone에서 비로그인 선택 상태를 실제 렌더했다. 두 폭에서 page horizontal overflow 0, modal horizontal overflow 0, 좁은 폭 modal vertical scroll 가능, 신원 미선택·대상 미선택 실행 버튼 비활성, 브라우저 warning/error 0을 확인했다. Standalone fixture에는 ACTIVE broker 계정이 없어 USER A/B 복수 chip 렌더는 HTML/API 계약 테스트 통과로만 기록하며 Burp 결과로 소급하지 않는다.

## 실제 사용자 확인

- Burp Community 2026.7.3에서 당시 beta.3 fat JAR을 로드했다. FlowScope suite tab과 Web `127.0.0.1:17777`, MCP `127.0.0.1:8787`, HUMAN `8080`, SCANNER `8081` listener가 동시에 기동했고 Web·crAPI root가 HTTP 200을 반환했다.
- exact scope `http://127.0.0.1:8888/`에서 HUMAN listener 8080을 프록시로 사용한 `curl`로 `/`와 `/favicon.ico` 2건을 먼저 수집했다. 두 건은 listener profile에 따라 `HUMAN/BROWSER/qa-human-anon-1`로 기록됐지만 실제 Burp Browser 사용 검증은 아니다. 둘은 `REVIEW`라 메인 coverage에는 들어가지 않았고 dataset lock은 `completed lanes need captured exploration responses before lock: [HUMAN]`으로 거부됐다. 두 번째 HUMAN run에서 당시 `API/INCLUDE`로 분류된 `/manifest.json` 1건을 추가한 뒤에만 잠금 조건을 충족했다.
- ZAP 2.17 SYSTEM anonymous baseline은 5초 내 `COMPLETED/ALERTS_READY`, FlowScope 수집 8건, native alert 22건으로 끝났다. 8건 모두 같은 run의 `SCANNER/CONTROLLED/ANONYMOUS`였고, 정적 자산 4건은 `EXCLUDE`, `/manifest.json` 1건은 `API/INCLUDE`, 나머지 3건은 `REVIEW`였다. 이는 취약점 22개를 확정했다는 뜻이 아니라 ZAP 원시 Alert 수집을 확인한 결과다. 8건의 `sourceDetail`은 모두 `ZAP_SPIDER`였으며 Client/AJAX 단계의 실제 캡처는 확인되지 않았다.
- 로컬 MCP는 `2025-06-18` initialize, tools/list 24개, status를 실제 응답했다. `qa-llm-anon-1` Explorer는 다른 source를 숨긴 상태에서 `/manifest.json` 통제 요청 1건을 `LLM/CONTROLLED` Evidence로 만들었고, scope 밖 FlowScope Web 요청은 `target is outside configured scope`로 거부됐다. HUMAN 3·SCANNER 8·LLM 1의 총 12건을 잠근 결과 finding 0·gap 0이었고, 잠긴 ZAP alert snapshot 조회와 잠금 뒤 Explorer 재시작 거부를 확인했다. 이 확인은 구독형 Codex/Claude prompt 전체 완료를 의미하지 않는다.

### 위 스모크의 사후 정확성 재검토

W3C Web App Manifest 규격상 `application/manifest+json`은 웹 앱 manifest media type이다. 현재 classifier v2는 모든 `+json`을 API representation으로 인정하므로 `/manifest.json`을 business `API/INCLUDE`로 오분류했다. 최종 재로드 뒤 10건 데이터에서도 세 source의 유일한 `INCLUDE`는 각각 이 manifest였다.

따라서 위 dataset lock은 다음만 증명한다.

- 세 source의 전송 경로와 provenance가 분리됐다.
- exact-scope 밖 MCP 요청이 차단됐다.
- 세 lane 완료와 dataset lock 상태 전이가 동작했다.

반대로 실제 Burp Browser HUMAN 탐색, business API 분류 품질, Client/AJAX spider 기여, endpoint/object 탐지 성능은 증명하지 않는다. 이 경계는 `product-development-plan.md`의 P4-H를 통과하기 전까지 미검증으로 유지한다.
- 위 검증 뒤 JDK 21로 최종 생성한 SHA-256 `e8d41fbd...6b4cae` JAR을 Burp에서 제거·재로드해 Web/MCP/8080/8081 재기동을 확인했다. 재로드로 비워진 scope를 같은 승인 대상에 다시 적용한 뒤 HUMAN 1·SCANNER 8·LLM 1, 총 10건을 다시 잠갔고 finding·gap은 0이었다. 두 번째 실행에서도 ZAP 8건·Alert 22건, Explorer 자기 Evidence 1건 시야, 범위 밖 요청 거부가 동일했다.
- 같은 `target/`에 생성된 thin intermediate `original-flowscope-1.2.0-beta.3.jar`를 먼저 선택했을 때 `Extension class is not a recognized type`으로 실패했다. 이는 확장 진입 코드 실패가 아니라 빠진 runtime dependency를 가진 중간 산출물 선택이었지만, 배포 폴더가 사용자를 오도한 실제 packaging UX 결함이다.
- 현재 빌드는 위 결함을 수정해 `original-*`를 package 끝에 제거하고 공개 JAR 수가 하나가 아니면 실패한다. `mvn clean verify` 직후와 이어진 non-clean `mvn -DskipTests package`의 유일한 JAR은 크기·SHA-256이 동일했다.
- 현재 확인은 익명 세 lane과 제어면에 한정한다. 로그인 계정·저장/복구·Repeater·unload는 아래 잔여 gate로 유지한다.

## 독립 clean-room 사전 감사와 후속 재검증

사전 감사 전체는 완료 전에 중단됐으므로 최종 clean-room 통과로 부르지 않는다. 다만 아래 개별 항목은 중단 전 결과와 이후 직접 재검증 결과를 구분해 기록한다.

- clean clone의 `mvn clean verify` 112 tests와 재생성 JAR SHA-256 동일성은 통과했다.
- 중단 시점의 예비 보고에는 Codex MCP 자동 발견 실패가 포함됐으나, 공식 문서와 로컬 Codex CLI 0.147.0으로 다시 확인한 결과 신뢰된 `agent-workspace`에서 번들 `.codex/config.toml`의 `flowscope` 항목이 정상 발견됐다. 사용법에 신뢰 프로젝트 전제와 `codex mcp get flowscope` 확인 단계를 추가했다. MCP protocol과 통제 Explorer 요청은 현재 실제 서버에서 확인했고, 구독형 클라이언트의 prompt 전체와 Judge는 아직 검증하지 않았다.
- 파싱 결과 표에서 stable Evidence ID와 상세 진입이 없던 결함은 이번 변경에서 class/disposition/repeat/Evidence 열과 행→operation 상세 동선으로 수정했고 자동·standalone 검증을 통과했다.
- 빈 상태의 정보 과다 결함은 행동 우선 progressive disclosure로 수정했고 Web 계약 테스트와 1280×720 standalone 검증을 통과했다. Burp 내 Web UI 결과로 소급하지 않는다.

## 아직 실환경에서 검증하지 않은 것

다음은 beta.3 당시 구현과 자동 회귀는 끝났지만 그 JAR의 실환경에서 끝까지 확인하지 않은 항목이다. 최신 beta.44의 미검증 gate는 이 문서 맨 위와 `HANDOFF.md`를 따른다.

- Burp Community에서 extension unload 뒤 Web/MCP 포트 해제와 재로드, Repeater handoff, project save/load 왕복
- 실제 HUMAN 로그인 캡처·pass 전·pass 중 요청이 각각 `SESSION_SETUP`·기본 숨김·분석 포함으로 보이는지, 선택 ACTIVE 계정과 다른 브라우저 자격증명이 계정으로 오기록되지 않는지
- 실제 Burp 대상 트래픽의 `REVIEW`가 메인 그래프에서는 빠지고 파싱 결과의 검토 대기에서 다시 포함·숨김 처리되는지
- 실제 사이트 로그인으로 `UNVERIFIED → ACTIVE`가 전환되고 그 세션을 ZAP·LLM controlled request에 주입해 회전·만료·재인증하는 전체 과정
- ZAP 2.17 환경에서 USER A·USER B fresh-session lane과 신원별 native alert 수집. 비로그인 lane은 통과했다.
- 구독형 Codex 또는 Claude가 MCP로 독립 Explorer pass와 lock 이후 Judge pass를 끝까지 수행하는 과정

따라서 현재 산출물을 “실환경까지 완벽히 검증된 제품”이라고 부르지 않는다. 위 항목은 벤치마크 정답을 보지 않고 수행할 다음 수동 beta gate다.

## 알려진 한계

- CAPTCHA, MFA, WebAuthn, device binding과 서비스 고유 refresh 절차는 범용 자동화할 수 없다. 세션이 `SUSPECT` 또는 `REAUTH_REQUIRED`가 되면 사용자가 HUMAN lane에서 다시 로그인해야 한다.
- `ACTIVE`는 자격증명 material 뒤 명시적 실패가 아닌 HTTP 응답을 관측했다는 transport-level 확인이며 서비스 고유 인증 endpoint, 계정 소유, role을 자동 증명하지 않는다.
- 폐쇄형 탐색은 제공된 agent workspace의 계약이다. 변조된 agent나 운영체제 수준의 외부 네트워크 접근까지 방화벽처럼 막지는 않는다.
- ZAP native alert는 참고 정보다. FlowScope Evidence와 controlled 재현이 없는 alert만으로 취약점을 확정하지 않는다.
- beta.3의 자동 decisive validation은 안전한 읽기 요청 중심이다. 상태 변경 요청은 별도 확인이 있어도 일반화된 자동 확정을 하지 않는다.
- 오탐과 미탐을 0으로 보장하지 않는다. 최종 상태는 LLM의 설명만이 아니라 서버가 확인한 Evidence와 gate로 제한한다.

## 다음 gate

실제 USER A/B 로그인 계정을 준비해 broker·복수 ZAP lane·LLM 계정 주입을 먼저 검증한다. 이어 구독형 Explorer/Judge, 저장·복구·unload gate를 끝낸 뒤에만 blind crAPI 벤치마크를 시작하고, 종료 전까지 알려진 정답과 풀이를 보지 않는다.
