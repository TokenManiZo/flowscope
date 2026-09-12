# FlowScope 팀 인계 정본

## 2026-09-13 · crAPI 실측 기반 진단 개발 시작(D-155, 미출시 브랜치 `claude/restore-pr-semantics`)

- 실제 대상(OWASP crAPI, `http://localhost:8888`)에 두 계정으로 인증 API를 브라우징해 FlowScope를 현장 검증했다. 핵심 엔진은 작동한다: 신원을 JWT `sub`에서 자동 해석하고, 교차 접근을 하지 않았는데도 `GET /identity/api/v2/vehicle/{id}` 차량 위치의 BOLA/IDOR 후보를 신원별로 생성했다.
- 실측으로 드러난 실환경 마찰(진단 도구의 최우선 결함)은 **온보딩**이다. HUMAN 탐색(run) 밖에서 브라우징하면 인증 API도 D-071로 전부 제외되고, 화면은 빈 그래프만 보이며 이유·다음 행동을 알려주지 않았다. 최소 경로는 계정·세션 캡처 없이 `HUMAN 탐색 begin → 브라우징 → end` 2동작이고 신원은 자동 해석됨을 확인했다. 계정·세션 캡처는 role과 Request Lab 재전송에만 필요하다.
- D-155로 첫 증분을 구현했다: snapshot이 run 밖 인증 API 수(`humanApiOutsideRun`)를 세고, 그래프·API·입력 차이 빈 화면이 "탐색을 시작하면 이 요청들이 비교에 포함된다"고 안내한다. D-071 coverage 경계는 그대로다.
- 검증: 집중 Java `SnapshotTrafficStatsTest` 2건·`TrafficClassifierTest` 18건, React `RunGapHint`·`ParameterMapPage` 통합, typecheck 통과. 전체 `mvn -o clean verify`와 crAPI 재로드 실측은 이어서 수행한다. 남은 실환경 항목: ZAP은 Burp 8081 listener가 있어야 수집됨(실측 확인), role 지정 없이는 BFLA 불가.


## 2026-09-12 · D-154 PR #11 원본 의미 복원(미출시 브랜치 `claude/restore-pr-semantics`)

- 사용자 지시("너무 보수적으로 하지 말 것", "PR이 보존하던 정보를 잃거나 새 제한을 추가하지 말 것")로 D-146 ③ CORROBORATED 비승격과 D-147 ① UNKNOWN 비교 라벨 억제를 PR #11 원본 의미로 되돌렸다. 독립 증인 2건과 확정 소유자는 `CONFIRMED_AUTH_BOUNDARY`를 받고, 한쪽이 UNKNOWN인 shape/type/occurrence 차이는 변경 라벨과 `UNKNOWN`을 함께 표시한다. link·gap 수는 그대로다.
- D-146 ①②(서비스 경계·중첩 PATH)와 D-147 ②(미지원 본문 진단)는 결함 수정이라 유지했다. 64자 masked preview 노출은 계속 결정 대기다.
- 검증: JDK 21 `mvn -o clean verify` BUILD SUCCESS, Java 574건(실패·오류 0, opt-in 2 skip), React 59파일/472건·typecheck, release guard 통과. 실행 중인 Burp가 17777을 점유해 같은 JAR의 standalone 서버를 17797에 띄우고 `FLOWSCOPE_E2E_ORIGIN`으로 Playwright `--retries=0` 15/15 통과(29.7s). JAR 31,942,089 bytes, SHA-256 `1a4dcdaef4ebe513f7153477e7d6bfaa15f83cadb648824d0715134b2fb936e0`.
- main 반영·push·Release는 하지 않았다. 같은 날 실제 Burp에서 범위 적용 시 `FlowScope SQLite save failed` 다이얼로그가 관측됐다. 커널 로그는 Burp 프로세스가 푼 `libsqlitejdbc.dylib`의 서명을 AMFI가 거부했다고 남겼고, `updateScopeFromUi`는 원인을 기록하지 않은 채 "범위 오류" 제목으로 띄운다. 이 결함은 이후 D-153/beta.48이 번들 드라이버 직접 연결로 수정했고, 이 브랜치는 beta.48 위로 rebase돼 그 수정을 포함한다. 실제 Burp 재로드에서의 해소 확인은 별도 gate다.

## 2026-09-12 · D-153 SQLite 수정·검증·beta.48 배포 기준

- 사용자 Burp의 `FlowScope SQLite save failed`를 beta.47 배포 JAR의 실제 저장 경로에서 재현했다. 호스트가 DriverManager를 먼저 초기화하면 `No suitable driver found`가 발생하고, 확장 드라이버를 명시적으로 로드한 대조군은 저장·재열기가 성공했다.
- 수정 범위는 번들 SQLite 직접 연결, 드라이버 선행 준비 없는 저장·재열기 회귀, 오류 안내, beta.48 배포다. schema·Evidence·ZAP·Explorer 실행 계약은 바꾸지 않는다. 멘토 보고서는 제외한다.
- 번들 JDBC 직접 연결과 오류 안내를 수정했다. 독립 JVM/SQLite/lifecycle 집중 12/12, JDK 21 전체 verify Java 575(실패·오류 0, opt-in 2 skip)·React 59파일/472건, 완성 fat JAR 실제 저장 경로, 패키지 Playwright 15/15(retry 0, 29.0초)가 통과했다. JAR 31,942,036 bytes, SHA-256 `6405e78207d0d729946aee38518678c22bdef58005fac2e5899585f651f16bfa`.
- 수정 커밋 `36a5020`은 원격 `codex/sqlite-driver-release`와 [PR #16](https://github.com/choewonwoo1817/testflowscope/pull/16)에 올라갔다. [CI 34697738243](https://github.com/choewonwoo1817/testflowscope/actions/runs/34697738243)는 전체 build·JAR/bundle·동일 러너 반복 해시·Bash/Windows 구문 검사를 통과했다(verify 9분 2초). 로컬 최종 verify도 2회 같은 JAR SHA-256으로 통과했고 ZIP CRC·내부 JAR 일치를 확인했다.
- **승인 확인:** main ruleset의 필수 리뷰 1건에 대해 사용자가 이번 PR #16의 관리자 예외 병합과 릴리스 게시를 명시적으로 승인했다. 이전 승인 부재 차단은 해소됐으며 ruleset 변경·강제 푸시·기존 태그 재작성은 하지 않는다. 후속 문서 커밋 `7810f46`의 [CI 34698310197](https://github.com/choewonwoo1817/testflowscope/actions/runs/34698310197)도 전체 검증·재현성·스크립트 검사를 통과했다(verify 8분 8초).
- **팀원 배포 식별:** [PR #16](https://github.com/choewonwoo1817/testflowscope/pull/16)의 main 병합 커밋과 `v1.2.0-beta.48` 태그를 같은 기준으로 사용한다. 배포 파일은 [beta.48 테스트 Release](https://github.com/choewonwoo1817/testflowscope/releases/tag/v1.2.0-beta.48)의 JAR·최종 문서 포함 bundle·SHA256SUMS다. 정확한 게시 시각·최종 main CI·업로드 해시는 Release 기록을 따른다. 로컬 승인 후 문서 갱신은 제품 코드를 바꾸지 않는다.
- 설치된 Burp Java 별도 probe는 출력 없이 OS 대기 상태에 남았다. 이번 임시 PID임을 재확인하고 TERM/KILL 신호를 보냈으나 마지막 확인에서 잔존했으므로 종료 완료나 성공으로 세지 않는다. 실제 사용자 Burp·기존 DB는 변경하지 않았다. 새 JAR Burp 재로드·Windows 실기기·이번 ZAP/Explorer 실물 재실행은 미실행이다.

## 2026-09-12 · D-152 beta.47 수정·검증·main 반영 완료

- beta.46 최종 문서 커밋 `15654c2`의 CI는 결과 `FAILED` 게시 후 cleanup이 끝나기 전에 다음 캠페인을 시작하면서 실패했다. 이 문제는 D-152 beta.47에서 수정했고, 아래 회귀·실물 검증과 최종 main CI를 통과했다. `570d576`의 이전 성공 기록은 해당 실행의 이력으로 보존한다.
- 정리 중에는 `RUNNING / CLEANUP`을 공개하고 worker 정리와 시작 잠금 해제가 끝나야 terminal 결과를 게시하도록 보정했다. 활성 run을 정리까지 유지하고, 시작 응답 수신/scan ID 등록과 취소를 직렬화한다. 취소된 lane과 미시작 lane도 마감한다.
- 새 latch 회귀 4건은 수정 전 모두 실패했다. 로컬 JDK 21 `mvn -o clean verify`: Java 574건(실패·오류 0, opt-in 2 skip), React 59파일·472건, release guard 통과. beta.47 패키지 Playwright는 retry 0으로 15/15 통과(30.2s). JAR은 31,942,102 bytes, SHA-256 `80d6e5357b3d73fdcfa274662f5bdfce39d792e3675c24dbbc7b9fa331e38cbe`.
- 별도 Docker ZAP(API 18889/fixture proxy 18881)에서 실물 Chromium/ChromeDriver 152.0.7977.82로 익명·정상 두 계정 Client 완료(63요청), 이어 잘못된 비밀번호 계정의 인증 단계 거부를 확인했다. opt-in 하네스 1/1, 106.6초 통과. 사용자 8089 ZAP을 검증 대상으로 쓰지 않았다. 실제 Burp·Windows 실기기와 외부 대상 효능 검증은 이 결과와 다르다.
- [PR #13 CI](https://github.com/choewonwoo1817/testflowscope/actions/runs/34693083743)가 전체 build·JAR/bundle·동일 러너 재현성·Bash/Windows 구문 검사를 통과했다(verify 9분 10초). 검증 코드 `3f9d107`, main 병합 `43706f1`은 파일 내용이 같다. 저장소의 승인 1건 규칙에 대해 소유자 관리자 예외로 PR을 병합했으며 보호 규칙을 변경하지 않았다.
- PR #11(`d3d5ed3`)·#12(`4b809b8`)의 원본 head는 이식 당시와 같았다. 현재 Surface/React/Authorization 연결부와 기능 대조표를 확인하고 이식·대체·제외 근거를 댓글로 남겨 두 PR을 종료했다. 직접 merge한 이력으로 표시하지 않았고 원본/팀원 브랜치를 삭제하지 않았다.
- 팀원용 파일은 [beta.47 테스트 Release](https://github.com/choewonwoo1817/testflowscope/releases/tag/v1.2.0-beta.47)의 JAR·설치 bundle·SHA256SUMS다. [팀원 첫 실행](team-quick-start.md)을 따른다. beta.46 태그/JAR은 이전 산출물로 보존하며 멘토 보고서는 Git·배포 파일에서 제외한다.
- 최종 배포 코드·태그는 `60a3291`이고 [main CI 34694001780](https://github.com/choewonwoo1817/testflowscope/actions/runs/34694001780)는 전체 검사·재현성 비교를 통과했다(verify 8분 35초). beta.47 Release가 게시됐으며 인증된 GitHub 경로로 설치 ZIP을 내려받아 원본과 바이트 일치·CRC를 확인했다. 저장소가 비공개이므로 팀원은 협업 권한이 있는 본인 계정으로 로그인해야 한다.

## 2026-09-12 · main 반영·beta.46 팀원 테스트 배포 기준

- 사용자 요청으로 작업 브랜치의 완료 커밋 37개를 원격 `main`에 fast-forward했다. 배포 코드 기준은 `8fe852729f21c12cdfc27af1b9e35ca8117c46ae`이며 강제 푸시는 하지 않았다.
- `v1.2.0-beta.46` 배포 자산은 검증된 JAR, 설치 번들, `SHA256SUMS.txt`다. 제품 코드는 `8fe8527`, 테스트 보정은 `570d576` 기준이다. JAR SHA-256은 D-151과 같으며, 번들에는 팀원 시작 가이드를 추가한다.
- 첫 원격 CI는 ZAP mock 회귀 2건의 대기 전제로 실패했다. scan ID 등록·terminal 상태를 최대 10초까지 기다리도록 테스트만 수정했다. 집중 16/16과 로컬 전체 `mvn -o clean verify`(Java 570, 실패·오류 0, opt-in 2 skip / React 471)가 통과했다. `570d576`의 [원격 CI 34689661662](https://github.com/choewonwoo1817/testflowscope/actions/runs/34689661662)는 전체 빌드·JAR/번들·재현성·Bash·Windows 구문 검사까지 성공했다. 실제 시작 응답 이전 취소 경합은 이 검증 범위에 포함하지 않는다.
- 팀원은 [첫 실행 가이드](team-quick-start.md)에서 ZIP 선택 → Burp listener → 필요한 경우 Docker helper → JAR 로드 → doctor → 진단 시작 순서로 준비한다. 대상 계정과 로컬 도구 로그인은 각 PC에서 준비한다. 가이드는 자동으로 bundle에 포함된다.
- 멘토 보고서 `mentor-progress-report.md`는 미추적 로컬 파일로 보존하고 Git·JAR·번들·Release 자산에서 제외했다. 아래 D-151 이전의 `push/Release 없음`은 당시 작업 이력이다.

## 2026-09-12 · D-151 전 작업면 snapshot 초안·전송 수명 통일·전체 검증 완료

- D-150 뒤 남은 판정 매트릭스·파라미터 커버리지·기존 권한 매트릭스·점검 Gap의 일시 snapshot 실패 선택 해제를 제거했다. 시나리오와 흐름 상세도 같은 공통 `EvidenceSheet` 잠금 계약으로 맞췄다. 마지막 성공 데이터·선택·검토 메모·Request Lab 초안은 남고 새 선택·정책 변경·전송·Repeater는 잠긴다.
- Request Lab은 일시 snapshot 실패가 발생해도 이미 시작한 전송을 abort하지 않는다. 같은 dataset·Evidence generation이면 완료 응답을 현재 메모리 결과에 반영하고, 실제 dataset/Evidence 변경·닫기·unload에서는 계속 취소한다.
- PR #11 `FlowScopeExtensionPersistenceTest` 9건을 현행 회귀와 대조했다. lifecycle·ProjectStore·SQLite로 대체한 사례와 D-143에서 폐기한 record-level parameter/attached-generation 전제 때문에 그대로 이식하지 않은 사례를 D-151에 명시했다.
- JDK 21 전체 검증은 Java 570건(실패·오류 0, opt-in 2 skip), React 59파일·471건과 typecheck, release guard를 통과했다. 패키지 Playwright는 retry 0으로 15/15 통과(29.2s)했다. JAR은 31,940,963 bytes, SHA-256 `4620fb37d80aaccc7f7c819100594f8bf5aaa56ce34868db51f40cc46d9c1aef`. 실제 Burp 장애 중 전송 완료와 Windows/native Linux는 미실행이다.

## 2026-09-12 · D-150 PR #11 잔존 계약 보완·전체 검증 완료

- PR #11 원본과 현행 트리를 다시 대조해 빠졌던 operation별 마스킹 Evidence/retention 200건 페이지를 `#evidence`에 복구했다. query cache는 datasetRevision·operation·offset·limit에 묶이고 화면 이탈 시 폐기된다.
- background snapshot 조회 실패는 열린 Request Lab의 미전송 편집을 유지하면서 정책·인증 변경·전송·Repeater를 잠근다. 같은 dataset이 복구되면 편집을 그대로 다시 활성화하고, dataset/Evidence/raw/session 경계 변경은 계속 폐기한다.
- `AuthorizationMatrixAnalyzer.java`의 실제 NUL 2바이트를 텍스트 `\u0000` escape로 복구했다. Masking 5건·선형 경계 2건·parameter model 4건·10,000 입력 operation 격리·project open/shutdown candidate 3건·source NUL·Fat JAR sentinel 회귀를 추가했다.
- JDK 21 `mvn -o clean verify` BUILD SUCCESS: Java 570 tests(실패·오류 0, opt-in 2 skip), React 59 files/468 tests·typecheck, Fat JAR/bundle release guard 통과. 새 JAR Playwright `--retries=0` 15/15 통과(30.3s).
- JAR: 31,940,812 bytes, SHA-256 `9c537476765bc75d8924e3e6ae7b0a138d03aac6cf74b75045fcdaef7b811103`. D-146 CORROBORATED 비승격과 D-147 UNKNOWN/미지원 본문 처리는 유지한다. 실제 Burp·Windows·native Linux는 이번 변경 기준 미실행이다.

## 2026-09-12 · D-149 잔존 리뷰 보완·전체 검증 완료

- 리뷰 7건 중 프로젝트 설치 교착과 종료 저장은 D-147에서 이미 닫혔고, D-145 이전 route/rail/테스트 수치는 역사로 구분돼 있었다. D-146의 CORROBORATED 비승격은 정확 참조 없는 동시출현을 확정 인가 경계로 과대 표시하지 않기 위해 유지한다.
- 실제 남은 Request Lab·Explorer 종료 후 record/raw 삽입을 공통 가드로 막았다. 서비스 불일치 등록 계정은 matrix 조합에서 계속 제외하면서 설정 경고에 계정·서비스·이유를 표시한다.
- 뒤처진 프런트 sample snapshot을 현재 21-record SampleProject와 route 후보까지 포함해 갱신했고 전체 일치 회귀를 추가했다. 갱신 중 발견한 Surface enum JSON 순서 비결정성도 enum 선언 순서로 고정했다.
- JDK 21 `mvn -o clean verify` BUILD SUCCESS: Java 554 tests(실패·오류 0, opt-in 2 skip), React 59 files/468 tests·typecheck, JAR/bundle release guard 통과. 새 JAR Playwright `--retries=0` 15/15 통과(32.9s).
- JAR: 31,939,756 bytes, SHA-256 `4d547badc47668094ad4a23178208e52c23843302b9b3b501ef41a595ca02db3`. 실제 Burp는 D-148의 호스트 차단 뒤 다시 실행하지 않았고, Windows·native Linux도 미실행이다.

## 2026-09-12 · D-148 코드·패키지 검증 완료, Burp 호스트 검증 차단

- 같은 Evidence ID를 가진 프로젝트 간 정책 초안/저장 상태 혼입과, Evidence·Surface·전체 관계 화면의 조회 실패 후 상세/Request Lab 재진입을 수정했다. 새 회귀 6건에서 수정 전 실패와 수정 후 통과를 확인했다.
- 최종 `mvn -o clean verify`: Java 550 tests(실패·오류 0, opt-in 2 skip), React 59 files/467 tests·typecheck 통과. 패키지 Playwright `--retries=0` 15/15 통과(33.4s).
- JAR: 31,937,310 bytes, SHA-256 `11a121f37e081494f8c24d103945abdaafb3b75e1d81d21e8676207e9e252a0c`. native Linux bridge listener 안내를 정정했고, bundle의 실행 권한·notice·자산·CRC·문서 연결을 대조했다.
- **실제 Burp는 차단 상태:** GUI 제어가 두 번 시간 초과됐다. 설치된 Burp JAR(build 53343)을 분리된 data-dir에서 실행했지만, headless JDK 21 + FlowScope와 JDK 26 + `--disable-extensions` 양쪽 모두 Burp 내부 `no ComponentUI class`/`NullPointerException`이 발생했다. 이 실행 조건에서 FlowScope를 제거해도 재현되는 호스트 오류로, 실제 로드/저장/재열기 성공을 기록하지 않는다. 사용자의 기존 Burp를 종료하거나 설정을 초기화하지 않았다.

## 2026-09-12 · 최종 연결부 보완 완료(D-147)

- 기준 `b168106` 위에서 PR #11·#12의 Evidence 비교·Graph/Matrix·프로젝트 연결부 결함을 회귀로 재현해 수정했다. 미지원 본문/불완전 multipart와 UNKNOWN metadata의 잘못된 확정 표시, Matrix의 이전 저장 응답·dataset/연결 실패 수명을 보정했다.
- 실제 extension 종료 메서드 호출 후 SQLite를 재열어 마지막 미게시 Evidence 보존을 확인했다. 설치는 별도 lifecycle monitor를 사용하고, Web 샘플 전환은 현재 진단 저장·교체가 끝나야 성공을 반환한다.
- 전체 검증: JDK 21 `mvn -o clean verify` BUILD SUCCESS, Java 550 tests(실패·오류 0, 선택형 ZAP/Codex 하네스 2 skip), React typecheck·58 files/461 tests 통과. 패키지 Playwright `--retries=0` 15/15 통과. 새 브라우저 검사는 서버 sample Evidence API → 값 변경 비교 → 파라미터 Matrix 연결을 확인한다.
- JAR: `target/flowscope-1.2.0-beta.46.jar`, 31,937,006 bytes, SHA-256 `163072aff44850fb1d968363835c565f34d0b77eea35b0eb01d23f043b6d3232`. bundle hash는 내부 문서에 기록하지 않는다.
- 현행 PR 기능표·설치 동선·인계와 이전 단계의 기각안을 대조했다. 이번 실제 Burp 재로드·Windows·실대상 효능 평가는 미실행이며 이전 결과를 새 산출물 검증으로 사용하지 않는다. 로컬 커밋·산출물까지만 완료하고 push/Release는 수행하지 않는다.

## 2026-09-12 · PR #11·#12 최종 흡수(D-145) 완료

- `11bb07b`와 Claude worktree의 미커밋 PR 흡수분을 인수해 상단 그룹 탐색, Gap/관계 그래프 통합, 파라미터 매트릭스, Evidence 단위 요청 비교, Request Lab 수명, 종료 저장을 현행 정본 위에 완성했다. 삭제된 Judge/MCP, 레거시 판정, record-level 제2정본은 복구하지 않았다.
- 실패한 프로젝트 전환에서도 Request Lab 폐기 신호가 먼저 발생하던 문제를 RED 회귀로 확인하고 서버 성공 뒤에만 신호를 보내도록 수정했다. 프로젝트 설치와 unload는 같은 monitor에서 시작 순서를 확정한다.
- JDK 21 `mvn -o clean verify`는 Java 536 tests(실패·오류 0, opt-in 2 skip), React 58 files/452 tests와 패키징을 통과했다. 패키지 JAR Playwright는 grouped navigation·Graph/Matrix·Gap·Request Lab·계정·ZAP/Explorer·반응형 14/14를 재시도 없이 통과했다.
- D-145 산출물 JAR: 31,934,375 bytes, SHA-256 `7c30e1bc80ff1e3f7933b5914cf31a117c3f758236aa62affdf5ebcda6eaf061`. bundle은 이 문서를 포함하므로 자기 해시를 내부에 기록하지 않는다.
- 실제 Burp load/unload·disk failure·대규모 Evidence 비교 비용과 Windows는 아직 운영 gate다. 자동·Standalone 통과를 실대상 탐지 성능으로 확대하지 않는다.

## 2026-09-12 · 인가 추천의 서비스·구조·관계 경계 보정 완료(D-146)

- 기준 `11bb07b`를 별도 `codex/pr11-pr12-core-repair` 작업트리에서 재검증해 타 서비스 등록 계정의 BOLA 추천 혼입, 중첩 PATH 부모 슬롯의 자식 리소스 오연결, 일반 입력 반복 동시출현의 확정 인가 경계 과대 표시를 재현하고 수정했다.
- 판정 매트릭스는 등록 계정의 설정 서비스 또는 미등록 신원의 실제 관측 서비스 안에서만 조합한다. 중첩 PATH는 `/segments/N` 순서에 맞는 resource chain prefix를 사용하고, CORROBORATED/INFERRED 동시출현은 link를 보존하되 `HUMAN_REVIEW_REQUIRED`로 표시한다.
- 수정 전 실패한 회귀 6건이 수정 후 통과했다. D-145 작업면과 합친 최종 JDK 21 `mvn -o clean verify`는 Java 542 tests(실패·오류 0, opt-in 2 skip), React 58 files/452 tests를 통과했고 패키지 Playwright 14/14도 retry 없이 통과했다.
- 최종 산출물 JAR: 31,936,476 bytes, SHA-256 `ca50d8c60dc1054ff6682ffdffa0e0883364da96e98617b787bd95b3ba499b33`. 최종 bundle 해시는 모든 내부 문서가 확정된 뒤 외부 결과에서만 식별한다.
- 실제 Burp 복수 서비스·중첩 API와 대규모 dataset precision/recall은 계속 운영 gate다.

직전 배포 기준은 beta.47 태그 `60a3291`과 D-152다. beta.48 수정·배포 현황은 맨 위 D-153 항목과 `beta-validation.md`의 최신 절을 따른다. 아래 날짜별 이식 내역·단계별 수치와 미출시 표현은 당시 산출물의 이력이며, 현재 버전이나 배포 상태를 덮어쓰지 않는다.

## 1. 현재 인수인계 상태·목표·범위

FlowScope는 허가된 범위에서 실제 HTTP 관측과 OpenAPI·HTML·JavaScript 선언을 endpoint·parameter로 정렬해, 진단자가 어느 입력을 아직 보지 못했는지 원 Evidence와 함께 확인하는 Burp 확장이다. 선택 API의 신원·접근 대상 ID·소유자·역할 비교는 인가 상세층이다. 미관측·gap·2xx만으로 취약점을 확정하지 않는다.

- **현재 실행:** HUMAN 수집/명시적 Request Lab, ZAP Browser Based Authentication 기반 독립 캠페인, 판정 없는 독립 Codex Explorer.
- **보존 데이터:** HUMAN·SCANNER·LLM source, 기존 Evidence·계정 메타데이터·정책·완료 run·실행 원장·사람 검토.
- **제거 유지:** 기존 Judge, 옛 Explorer 실행기, MCP transport/토큰/리스너, 후속 Judge 세션, 격리 브라우저, agent-workspace 설정·프롬프트·디렉터리. 옛 실행 API는 404이며 성공 stub이 아니다.
- **과거 LLM:** `LegacyAssessment`·`ValidationDecision`은 저장 호환용 읽기 전용 기록이다. 현재 규칙 후보의 결론으로 합치지 않는다.
- **새 Explorer:** `ExplorerCoordinator`가 메모리 계정 인증과 로그인된 Codex app-server를 연결한다. HTTP 도구는 exact-scope Burp Montoya 전송과 실제 LLM Observation Evidence를 만들고, 선언 도구는 같은 run의 응답 Evidence에서 직접 읽은 endpoint·parameter만 `LLM_ARTIFACT_ANALYSIS` Declaration으로 저장한다. MCP·Judge·브라우저는 없다.
- **미착수:** FlowScope Evidence·분석용 제품 MCP. 새 Explorer와 무관하며 지금 만들지 않는다.
- **현재 ZAP:** 비로그인 또는 별도 메모리 로그인 계정마다 이름 없는 temporary ZAP session/Context를 만들고 `인증 → chrome-headless strict Client → Passive → Alert → CLEANUP`을 실행한다. 모든 lane은 bundle의 FlowScope Docker Chromium runtime만 사용한다. D-152는 정리 후 terminal 게시·재시작과 수락된 시작 응답 전 취소를 보정한다. Traditional/AJAX와 지원되지 않는 verification REST 호출은 없다.

사용자 전역 모델 설정·인증 파일, 사용 중인 Burp/ZAP, 다른 Claude worktree와 서드파티 패키지 내부 MCP 파일은 제거 대상이 아니었다. 구버전 확장이 실제로 실행 중이라면 새 소스의 삭제 사실만으로 그 프로세스·포트까지 종료됐다고 판단하지 않는다.

## 1-1. PR #11·#12 1차 이식 이력 (2026-09-11, D-145 이전)

이 절은 `11bb07b` 당시 이력이다. 별도 `#parameter-map`, `RouteIconRail`, Evidence digest 미이식 판단은 D-145가 대체했다. 현재는 `#graph` 두 탭, 상단 그룹 탐색, on-demand 요청 비교를 제공한다.

**흡수한 기능과 코드 위치** (기능 대조표 전체는 `product-development-plan.md` "PR #11·#12 이식 기능 대조표")

- 관측·선언 공통 parameter coordinate와 네 결함 수정(1단계): `core/parameter/ParameterCoordinates`·`ParameterExtractor`, `core/SurfaceAnalyzer`(PATH `/segments/N` placeholder 위치, JSON 실제 타입, JS `Segment`, Surface React key). 커밋 `588de54`·`268769c`·`97a94a2`.
- 선언 의미 확장(2단계): OpenAPI union/enum `CONDITIONAL`·declaredType/Shape·servers 상한, JS `__proto__`/오버사이즈 거부. 커밋 `a1445f6`.
- 파라미터 프로파일·discovery Gap(3단계): `SurfaceAnalysis.ParameterProfile/ParameterGap`, `SurfaceAnalyzer.profile/gaps` (`SOURCE_MISSED`·`IDENTITY_MISSED`·`DEFINED_NOT_OBSERVED`·`TYPE_VARIANT_UNOBSERVED`·`CONDITION_COMBINATION_UNOBSERVED`, `RowLedger`, 32 preview). 커밋 `55edaa2`.
- 권한 대상 link·검증 cell·`AUTH_VARIANT_UNTESTED`(4단계): `core/SurfaceAuthorizationLinker`, `SurfaceAnalysis.AuthorizationTargetLink/ParameterValidationCell`, snapshot `surface.validationCells`. 커밋 `5d415ce`.
- 우선순위 Gap 그래프 화면(5a): `frontend/src/features/parameter-map/*`, route `#parameter-map`. 커밋 `56f21c9`.
- 구조화 요청 비교(5b): `EndpointFact.requestContexts`, `parameter-map/requestDiff.ts`·`ParameterRequestDiff.tsx`. 커밋 `f4e71c5`.
- 계층 관계 그래프(5c): `frontend/src/features/graph/{graphHierarchy,graphFocus,relationshipNodeCard}.ts`, `CytoscapeGraph/ResponsiveGraphList/GraphInspectorPanel/GraphPage`(Site→API 그룹→API→Object, `+18`). 커밋 `6527484`.
- snapshot 계약·캐시 회귀와 선언 preview 결정성(5d): `web/SnapshotSurfaceContractTest`, `SnapshotJsonWriter.surfaceBuildCount()`, `SurfaceAnalyzer` 선언 안정 선택. 커밋 `b3bd07d`.
- 판정 매트릭스 P/E/O·수동 테스트 추천·사람 검토(6단계, D-144): `core/AuthorizationMatrix`·`AuthorizationMatrixAnalyzer`, snapshot `authorizationMatrix`, `/api/review` cell id, `frontend/src/features/matrix/{JudgmentMatrixView,judgmentProjection}`·`MatrixPage` 두 탭. 커밋 `330cb6c`.
- 통합 검증·설계 문서(7단계): `PortedFeaturesReopenTest`, `frontend/src/features/crossScreenSelection.test.ts`(+`src/test/sample/sample-snapshot.json`), Playwright parity 확장, `docs/ko/GRAPH_IDA_REDESIGN.md`·`GRAPH_NOISE_FP_FN_REDUCTION.md`, decisions 부록. 커밋 7단계 마지막 커밋(`git log -1`, 이 문서 포함).

**제외·변경한 기능과 이유** (`product-development-plan.md` 제외·변경 목록, D-143 각 단계 기각, D-144 기각)

- PR record-level `parameterObservations` 영속·attached generation·fingerprint 캐시 → projection 재계산·단일 게시본 캐시(제2정본 없음). 64자 masked preview snapshot 노출 → 비노출 유지(코덱스 지시, 결정 대기).
- PR `graph` route를 파라미터 맵으로 교체·두 탭 wrapper → 별도 route `#parameter-map` + `#graph`는 계층 관계 그래프. PR `WorkspaceNavigation` 드롭다운 → 현행 `RouteIconRail`. PR `evidenceContext` → D-140 `datasetRevision`. PR evidence API per-record 관측·digest → 미노출.
- PR 서버 `FlowGraphBuilder` 방향 변경·legacy `index.html` 그래프/매트릭스 교체 → 미이식(legacy 전체 교체 금지, React가 정본 UI). PR `inputCoverage`·`events[].inputs` → `snapshot.surface` 프로파일로 대체.
- PR#12 후보 승격(2xx+소유관계)·`ValidationDecision` E3 승격·교차 객체 fallback → 정본 cell SUSPICIOUS/roleViolation만, 본문 미확인 성공은 수동 결과 검토, 이력 표시만(D-144).
- PR plans/specs 작업 계획서 4건 → 미이식(계약 아님), D-093~D-099는 decisions 부록 대응표.

**검증한 사용자 흐름** (`beta-validation.md` 각 단계 gate)

- 패키지 Standalone Chromium 실측: Surface 상세 canonical 표시(1단계) → HAR import로 SOURCE_MISSED gap(3단계) → snapshot link/cell(4단계) → `#parameter-map` 큐→경로 카드→상세→검증표→Evidence→Request Lab(5a), 요청 비교 탭(5b) → `#graph` Site→ORDERS→GET→객체 상세·툴팁·키보드·GAP 후보 focus·900px 목록(5c) → `#matrix` 판정 매트릭스 BFLA/BOLA 상세·기준 Evidence·사람 판정 저장(6단계).
- Playwright parity(패키지 JAR): 전체 route, 계층 그래프 카드·lane·zoom/fit/drag/lock, 판정 매트릭스 요약·상세·검토 폼, 우선순위 Gap 그래프 1920/1280/600, 반응형 900/600(매트릭스·그래프·Sheet), Request Lab, 계정, ZAP/Explorer, XML import.
- 자동 회귀: `mvn -o clean verify` Java 533 tests·frontend 47 files/371 tests, JSON·SQLite 재열기 동일성, 화면 간 Evidence 일관성.

**남은 결함·미검증**

- 실제 Burp Montoya 재로드·프로젝트 재열기·Request Lab 전송·복수 계정 귀속, Windows, ZAP 로그인 복수 계정(기존 운영 gate)은 미실행.
- Playwright `keeps graph lanes …` 검사가 한 번 첫 시도에서 resize 후 geometry 갱신 poll(5초)을 넘겨 재시도로 통과했다(flaky, 재현 조건 미확정).
- 대규모 실제 dataset의 그래프·매트릭스 interaction latency 미측정. 파라미터당 선언 32 상한·경로 후보 그룹·보조 흐름은 샘플 규모 밖이라 vitest로만 확인.
- masked preview 노출 여부는 결정 대기.

**산출물**

- 브랜치 `claude/explorer-identity-regression`, 커밋 `588de54`~7단계 마지막 커밋(`git log -1`, 이 문서 포함)(push·Release 없음). JAR `target/flowscope-1.2.0-beta.46.jar` 31,930,936 bytes(최종 verify 단일 빌드값).

## 2. 이전 단계별 진행 이력

2026-09-11 완료(자동 회귀·패키지 JAR Playwright) · PR #11·#12 이식 7단계 — 통합 검증·설계 문서·최종 인계: JSON·SQLite 재열기 뒤 Gap·검증 cell·link·판정 매트릭스·사람 검토 재계산 동일성(`PortedFeaturesReopenTest`), 패키지 샘플 snapshot 캡처로 네 화면의 동일 Evidence(`crossScreenSelection.test.ts` 4건), Playwright 우선순위 Gap 그래프 1920/1280/600·판정 매트릭스 900/600 추가, PR#11 그래프 설계 문서 2건 이식본과 decisions 부록(D-093~099 대응). `mvn -o clean verify` 533 tests·frontend 47 files/371 tests BUILD SUCCESS, JAR 31,930,936 bytes, Playwright 최종 10/10 passed(20.3s; 1·2회차는 새 e2e 테스트 순서 결함으로 실패해 테스트만 수정, 1회차 graph-lane 검사 1회 flaky 재시도 통과). 최종 인계는 위 1-1.

2026-09-11 완료(자동 회귀·패키지 Chromium 실측·Playwright) · PR #11·#12 이식 6단계 — 판정 매트릭스: PR#12 `AuthorizationMatrix`/`AuthorizationMatrixAnalyzer`를 이식하되 후보 승격은 정본 cell(BOLA: SUSPICIOUS, BFLA: roleViolation)만 따르고 본문 미확인 성공은 `수동 결과 검토`, 과거 `ValidationDecision`은 정확 cell 이력 표시만(E3·재현 자동 부여 없음)으로 guard했다(D-144). snapshot `authorizationMatrix`, `/api/review`의 매트릭스 cell id 수용(서버 Evidence 결박), React `#matrix` 두 탭(판정 매트릭스 기본: 요약·BFLA/BOLA·IDOR/실행 Evidence 보기·주의 필터·P/E/O 범례·셀 상세(추천 조합·게이트·오라클·Evidence 상세·사람 최종 판정) / 기존 권한 매트릭스). `inputCoverage`·legacy HTML 교체는 미이식. Java `AuthorizationMatrixAnalyzerTest` 10·웹 서버 검토 왕복, vitest 10건 신규, `mvn -o clean verify` 532 tests·frontend 46 files/367 tests BUILD SUCCESS, JAR 31,930,936 bytes; Standalone(17777) 실측(BFLA 후보 상세, BOLA/IDOR 후보 상세 P2·E2·O3, 사람 판정 기각 저장 `POST /api/review` 200→라벨·요약 반영, Evidence 상세 시트, 기존 매트릭스 탭, 콘솔 오류 0), Playwright parity 9/9 passed(판정 매트릭스 검사 포함). 다음: 7단계 통합 검증(화면 간 선택·Evidence·저장/재열기, 좁은 viewport 패키지 실측, PR#11 설계 문서 이식)·최종 인계.

2026-09-11 완료(자동 회귀) · PR #11·#12 이식 5단계(5d) — snapshot 계약·캐시 회귀: PR#11 Contract 9·Cache 7을 우리 `snapshot.surface` 계약으로 옮겨 `web/SnapshotSurfaceContractTest` 9건(가산 배열, 모델 dedupe·32 preview·count·불변, UNTESTED basis/실제 분리, 선언 전용 입력, 실제 ALLOW vs VALIDATION 전용 UNDECIDED cell, 민감 생략 진단 비노출, 단일 캐시 build count, 동시 poll 1회, 같은 게시본 원문 변경 무영향)으로 고정했다. 이식 중 파라미터당 선언 32 상한이 수집 순서에 의존하던 결정성 결함을 고쳐 Evidence ID 순으로 preview를 고르고 `DEFINED_NOT_OBSERVED` gap이 전체 선언 증인 수를 보존한다(D-143 5d). `mvn -o clean verify` 523 tests·frontend 44 files/357 tests BUILD SUCCESS, JAR 31,876,645 bytes. 미이식(설계상 해당 없음): attached generation·fingerprint 캐시·bounded node seam·legacy UNKNOWN shape. 다음: 6단계 PR#12 판정 매트릭스(P/E/O·BFLA/BOLA 수동 검토 추천·React·사람 검토), 7단계 통합 검증·최종 인계.

2026-09-11 완료(자동 회귀·패키지 Chromium 실측) · PR #11·#12 이식 5단계(5c) — 계층 관계 그래프: PR#11 `graphHierarchy/graphFocus/relationshipNodeCard`와 Cytoscape/목록/인스펙터 변경을 현행 `#graph`에 이식해 Site Overview(Target→API 그룹 카드: API·H/S/L·Gap·경로 후보 수) → API View(Identity→API, 위험 순 18개 + `API 18개 더 보기 (N개 남음)`) → Object View(Identity→API→Object, 18개 + `Object 18개 더 보기`)·Back·개요로 접기·GAP 미교차 후보 focus·SVG 카드·툴팁·키보드 탐색·900px 목록 동등성을 제공한다(D-142 gate 해소, D-143 5c). 선택은 서버 셀 canonical key·Evidence ID를 그대로 들고 집계 판정을 만들지 않는다. 경로 후보 필터·`datasetRevision` Request Lab key는 현행 유지, PR 두 탭 wrapper·`FlowGraphBuilder` 방향·legacy HTML 교체는 미이식(기각 기록). vitest 신규/갱신 ~40건(RED→GREEN), `mvn -o clean verify` 514 tests·frontend 44 files/357 tests BUILD SUCCESS, JAR 31,876,030 bytes; Standalone(17777) 1600×900 canvas drill(Site→ORDERS→GET→orders:101 복수 셀 상세, 툴팁, 키보드 선택·focus, GAP 후보 focus)과 900×800 목록(Identity focus·후보 dialog·Escape 복귀) 실측, 새 탭 콘솔 오류 0. Playwright parity는 `beta-validation.md` 5c gate 표. 다음: 5d snapshot 캐시·계약 테스트.

2026-09-11 완료(자동 회귀·패키지 Chromium 실측) · PR #11·#12 이식 5단계(5b) — 구조화 요청 비교: 서버 `EndpointFact.requestContexts`(evidenceId·complete·retained·discovery·contextSignature, 값 없음)를 가산하고, PR `requestDiff` 알고리즘을 Surface 관측 metadata 위로 이식해 Gap 상세 "요청 비교" 탭에서 정확한 operation의 실제 Evidence 둘을 비교한다(불완전 문맥은 UNKNOWN, 표시 형태는 구조 형태로 환원, 값 digest 비노출이라 값 변경은 UNKNOWN 표시). Java 1건·vitest 15건 신규, `mvn clean verify` 514 tests·frontend 298 tests BUILD SUCCESS, JAR 31,869,808 bytes; Standalone에서 GET `/api/orders/{id}` gap의 200 ALLOW HUMAN vs 403 DENY SCANNER 비교(`STATUS_CHANGED VERDICT_CHANGED`, PATH 행 PRESENT·SCALAR (INTEGER)/STRING·RETAINED·3 bytes) 실측. 다음: 5c 관계 그래프 계층(Site→API 그룹→API→Object, `+18`; D-142 gate), 5d snapshot 캐시·계약 테스트.

2026-09-11 완료(자동 회귀·패키지 Chromium 실측) · PR #11·#12 이식 5단계(5a) — 우선순위 큐·파라미터 Gap 그래프·검증표·Gap 상세: PR#11 parameter-map 프런트(20파일)를 `snapshot.surface` 위로 이식해 새 route `#parameter-map`("우선순위 Gap 그래프")을 추가했다. 서버 우선순위 순 큐, 위험/권한/발견 + 고급 필터, 4-lane Cytoscape 카드 그래프(목록 fallback·키보드), 선택 상세(사유·link·프로파일·Gap 근거·subject×source 검증표·Evidence 연결·정의 근거)→기존 EvidenceSheet→대표 Evidence Request Lab, 3-pane `FocusedGraphWorkspace`(큐/상세 sheet 전환). vitest 29건 신규(RED→GREEN), `mvn clean verify` 513 tests·frontend 283 tests BUILD SUCCESS, JAR 31,865,404 bytes. Standalone(17777) 1024/1600px 실측: 큐 23건, 경로 카드, 상세 sheet/pane, 검증표 4좌표, Evidence 상세, Request Lab 읽기 전용 초안, 확대·목록 전환, 콘솔 JS 오류 0. 남은 5단계: 5b Request Diff(서버 요청 문맥 가산), 5c 관계 그래프 계층(D-142 gate), 5d snapshot 캐시·계약 테스트. 주의: 로컬 vitest는 `target/frontend-runtime/node`(v24)로 실행(시스템 Node 25는 localStorage 전역으로 RequestLab 테스트 실패).

2026-09-11 완료(자동 회귀·패키지 Standalone snapshot 실측) · PR #11·#12 이식 4단계 — 권한 대상 연결: PR#11 `ParameterAuthorizationAnalyzer`를 `SurfaceAuthorizationLinker`로 이식, `SurfaceAnalyzer.analyze(..., AuthorizationAnalysis)`로 배선. `ParameterFact.authorizationTargets`(OBSERVED=정확 스칼라 리소스 참조[PATH resource 일치 또는 정본 field→resource 규칙의 query projection 재생], INFERRED=단일 리소스 동시출현, CORROBORATED=공개 완전 증인 2건, UNKNOWN), 최상위 `validationCells`(SELF/OTHER_OWNER/ANONYMOUS/OTHER_ROLE × source; SELF/OTHER_OWNER는 확인 소유자 필요; verdict는 응답 거부/metadata/모호만 직접, 성공은 정본 CoverageCell의 Evidence 결박 Decision만 재사용 — 필드 생략 요청의 집계 ALLOW·다른 응답의 객체 노출 미차용), `pg:auth:` `AUTH_VARIANT_UNTESTED` gap(applicable + operation 완전). VALIDATION(Request Lab) 행은 사실·프로파일 제외·cell/link만 연결, Evidence ID 충돌은 전 operation 판단. RED 20건 선행 → `mvn clean verify` 513 tests BUILD SUCCESS, JAR 31,846,822 bytes. Standalone(17777) 샘플 snapshot에서 link 5건(PATH OBSERVED·`/status` INFERRED·`/email` UNKNOWN), cell 40건(SELF ALLOW 정본 재사용·OTHER_OWNER SCANNER DENY·LLM SUSPICIOUS·404 UNDECIDED·OPTIONS UNDECIDED·관계 없음 non-applicable), gap 23건(CONFIRMED_AUTH_BOUNDARY 우선) 확인. 다음: 5단계 우선순위 큐·파라미터 그래프·Diff·Focused workspace(React).

2026-09-11 완료(자동 회귀·패키지 Standalone snapshot 실측) · PR #11·#12 이식 3단계 — 파라미터 프로파일과 관측 차이 분석: PR#11 `ParameterProfiler` 의미를 `SurfaceAnalysis`에 이식. `ParameterFact.profile`(source/identity/role/run/phase 카운트, 명시 null vs `ABSENT_OBSERVED_CONTEXT`, 구조·native 타입 충돌, contextSignature별 존재 상태 64 상한, serverUsageConfirmed=false)과 최상위 `parameterGaps`(SOURCE_MISSED/IDENTITY_MISSED/DEFINED_NOT_OBSERVED/TYPE_VARIANT_UNOBSERVED/CONDITION_COMBINATION_UNOBSERVED, `pg:v1:` 좌표 ID, priority reason 순 정렬, 증인 Evidence≤32+전체 수). 분모는 discovery 행(coverage-eligible·VALIDATION/COACH_PROBE 제외)이며 Evidence ID당 1행, 같은 ID 다른 내용은 둘 다 제외(`CONFLICTING_EVIDENCE`), 추출 진단·잘린 payload 행은 긍정 관측만 남기고 부재·누락·DEFINED의 증인 불가(`REQUEST_PAYLOAD_NOT_RETAINED`), 미확정 좌표 제외. RED 17건 선행 → `mvn clean verify` 493 tests BUILD SUCCESS, JAR 31,818,714 bytes. Standalone(17777) `/api/snapshot`에서 샘플 5개 입력의 profile 확인(샘플은 gap 0건이 정답), SCANNER HAR 1건(`?sort=DESC`) 가져오기 후 `/sort` profile(absent 5)과 SOURCE_MISSED HUMAN·LLM 2건 생성 확인. 다음: 4단계 권한 대상 연결(TargetLink·ValidationCell·AUTH_VARIANT_UNTESTED, D-004/D-050).

2026-09-11 완료(자동 회귀) · PR #11·#12 이식 2단계 — 선언 지원의 남은 공백 정리·이식: `Declaration`에 declaredType/declaredShape/conditionText/confidence, `Requirement.CONDITIONAL`, `Confidence`(관측 OBSERVED·선언 INFERRED). OpenAPI는 path/operation parameter `(in|name)` 병합(operation override), local `$ref`만(외부·순환 거부), oneOf/anyOf `CONDITIONAL`+`union[i];`, enum `enum[i];`(값 미복사), `type/format` 타입, binary·file 제외, `required` 미표기 OPTIONAL, `in: path` slot 타입 부착; JS는 spread 객체·`__proto__`·constructor/prototype 컨테이너·method 미해석 call-site 미선언, 리터럴 종류→declaredType; 민감 이름 선언 제외, 파라미터당 선언 32 상한+`DECLARATION_LIMIT`, servers 확장 8,192자 상한. RED 6건 선행 → `mvn clean verify` 476 tests BUILD SUCCESS(화면 변경 없음). PR과 다른 관례(scalar 배열 원소·중간 객체 미선언, JS 문자 window 미이식, multipart binary 미선언 정정)는 대조표 제외·변경 목록에 기록. 다음: 3단계 파라미터 프로파일과 관측 차이 분석.

2026-09-11 완료(자동 회귀·패키지 Chromium 실측) · PR #11·#12 이식 1단계 — 재현된 네 결함 수정: ① PATH `/segments/N`은 실제 placeholder 위치만 허용(`pathSlotPosition`; Explorer 거부, 저장 FLOW_V2는 `INVALID_PATH_POSITION` 미확정, legacy와 동일 결과); ② JSON 실제 타입 보존(`"1"`=STRING/`1`=INTEGER, 형식 신호는 `ValueSummary.format`으로 분리, distinct는 타입 포함 키; 엔진 digest는 PR 권한 연결 계약대로 원문 기준 유지); ③ JS `Segment(key, arrayElement)`로 리터럴 `*`(`~2`)와 배열 원소 wildcard 구분; ④ Surface 화면 React key를 `location:[?]canonicalPath`로, canonical 보조 줄 표시, source 필터 시 `UNRESOLVED_COORDINATE` 유지. 각 결함 실패 회귀 선행 → `mvn clean verify` 470 tests BUILD SUCCESS, JAR 31,789,381 bytes, standalone(17777) Chromium에서 PATCH `/api/orders/{id}` 상세의 `/segments/2`·`/status` canonical 표시·콘솔 오류 0 확인. `product-development-plan.md`에 PR #11·#12 기능 대조표(1~7단계)와 제외·변경 목록을 작성했다. 다음: 2단계 선언 공백(OpenAPI union/enum·CONDITIONAL·declaredType/Shape·servers 상한, JS `__proto__`/오버사이즈 거부, Confidence 표기).

2026-09-11 완료(자동 회귀) · 슬라이스 1 후속 수정(코덱스 리뷰 6건 + 구조 보존 정정): ① JS 점 이름 추정 join 제거 → PR#11 `JavascriptParameterDefinitionAdapter.walk`를 이식해 `JavascriptCallSiteAnalyzer`가 AST 세그먼트(중첩·배열 원소 `*`)를 보존, 세그먼트 없이 평탄화된 이름만 미확정; ② `DeltaState.UNRESOLVED_COORDINATE`·`coordinateResolved`로 미확정 선언(legacy 점 JSON·path slot 정렬 실패 포함)의 join·Gap 승격 불가를 데이터로 보장; ③ `fieldPath`=표시 경로/`canonicalPath`=기계 키 분리(PATH 라벨은 `orderId`, 화면에 `/segments/N` 노출 안 함); ④ 엔진 `contextSignature` 보존; ⑤ Explorer 선언을 FLOW_V2로 검증·정규화 저장(`/a//b` 등 빈 토큰은 RFC 6901대로 유효 — 새 제한 없음, `~` 이스케이프 계약만 검증, 점 표기 JSON은 pointer 재요청 안내); ⑥ distinct 값 256 상한+truncated+`DISTINCT_VALUE_LIMIT`; ⑦ OpenAPI path slot 정렬 실패 시 `UNRESOLVED_PATH_ALIGNMENT`(임의 선언 없음). 각 항목 실패 회귀 선행 후 `mvn clean verify` 466 tests BUILD SUCCESS·frontend typecheck 통과. packaged JAR·실제 Burp/ZAP/Explorer 실행은 여전히 미실행.

2026-09-11 완료(자동 회귀) · canonical parameter coordinate 통합(슬라이스 1): PR#11 파라미터 추출 엔진(`core/parameter/*`)을 SurfaceAnalyzer 관측 정본으로 이식하고, 기존 observe*(path/query/json/form/multipart)·shape()를 제거했다(production 이중 관측 없음). 관측·선언이 공유하는 공통 ParameterCoordinate(EndpointKey+ParameterLocation+canonicalPath)를 `ParameterCoordinates`로 도입해, 같은 논리 파라미터가 하나의 `ParameterFact`로 병합된다. PATH는 구조적 `/segments/N`(빈 세그먼트 제거 zero-based, 이름 무관 위치 join), JSON/GraphQL은 RFC6901 기반 FlowScope pointer(배열 `*`, literal `*`=`~2`, 중첩 `/`), QUERY/FORM/MULTIPART/HEADER/XML도 escaped token. 선언 어댑터(template path·OpenAPI·schema·HTML form·JS·query literal)는 좌표 출력만 공통형으로 바꿨고(JS body는 분석기가 AST 세그먼트를 보존해 전달 — 후속 수정에서 정정), schema 의미 확장은 슬라이스 2로 남겼다. 값 형식 분류(UUID/INTEGER/DECIMAL/BOOLEAN)는 엔진 `scalarType`으로 이관해 관측 동등성을 유지했다. `RouteCandidate.DeclaredParameter.coordinateVersion`(LEGACY_V1/FLOW_V2)을 `ProjectStore`가 선택 필드로 저장/복원(**SQLite 스키마 무변경**, codec 공유). 점 없는 legacy JSON 단일 key는 무손실 변환해 join, 점 있는 legacy JSON/GraphQL만 `LEGACY_AMBIGUOUS_COORDINATE`로 남기고 자동 join/Gap 승격하지 않는다. snapshot은 canonicalPath·observedValueTypes·distinctValueCount·byteLength·masked·parameterDiagnostics만 노출하고 raw value·digest·preview는 두지 않는다(frontend `types.ts` 가산). SurfaceAnalyzerTest에 D-143 통합 회귀 8건, ProjectStore/SqliteProjectStore 재열기 좌표 보존 2건을 추가했고 `mvn clean verify` BUILD SUCCESS·frontend typecheck 통과. 상세 계약·구현 노트는 decisions.md D-143. **미실행:** packaged JAR·실제 Burp/ZAP/Explorer·E2E(자동 회귀까지만). **슬라이스 2+:** ParameterProfile·ParameterGap·인가 타깃 연결·그래프/매트릭스 UI·OpenAPI style/explode 완전 해석.

2026-09-11 Explorer 신원 회귀: §6-2의 통합 테스트를 먼저 고정했다. 실제 gateway가 선택 계정과 주입 토큰을 transport 요청에 싣는 것, LLM lane 지문이 `Fingerprints.of`로 환원되는 것, `bindSession`→`Pipeline` 계정 신원, binding 없는 음성 대조(D-130), `ProjectStore` 저장·재열기 뒤 재유도와 원문 토큰 미저장을 `ExplorerFingerprintTest`·`ExplorerIdentityAttributionTest` 4 tests로 고정했다(구성요소 계약 회귀). 다만 이 테스트는 실제 연결부 `executeExplorerRequest()→recordFrom(forcedAccountId)`를 실행하지 않아 그 연결부 회귀는 열려 있고(코덱스 리뷰 정정), 재열기는 JSON `ProjectStore` 경로만 덮으며 실제 기본 저장인 SQLite 통합은 아직이다. 의심했던 재열기 fingerprint 불일치는 `safeForStorage` 항등성으로 결함 아님. 실제 Burp Montoya 귀속은 운영 gate.

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
| 문서 현행화 | beta.48/D-153 기준 정정 | 현행 계약·설치·완료 상태와 과거 수치/미출시 표현을 분리. 검사 범위는 documentation-status 참고 |
| 독립 LLM Explorer | D-139 구현·집중/provider·전체 자동 검증 완료, Burp gate 대기 | 메모리 인증, exact-scope HTTP Observation, Evidence-bound endpoint/parameter Declaration, 서버 중복 제거·집계, React 작업 피드 |
| 다운로드 bundle·기능별 doctor | 구현·자동/추출 검증 완료 | JAR+ZAP helper+문서 ZIP, `human/zap/explorer/full`, Explorer 재확인; Windows 실기기 대기 |
| ZAP 직접 브라우저 인증 | 별도 실물 하네스에서 정상 2계정·오류 비밀번호 차단 통과, 실제 Burp·Windows gate 대기 | 메모리 `ZapAccountVault`, 필수 성공/선택적 로그아웃 정규식, 같은 run·계정의 `ZAP_AUTHENTICATION` Evidence, Chrome Headless, Context/user 지정 Client, 임시 user/Context 정리 |
| React ZAP 기능 보존 | 구현·집중 회귀 완료 | target별 로그인 계정, 로그인/단계/경과 상태, 명세 정의 입력, 취소 복구 |
| 새 JAR 실제 Burp/ZAP 검증 | beta.47 별도 ZAP fixture 통과; 실제 Burp gate는 별도 | 현재 별도 ZAP에서 63요청·정상 두 계정·오류 비밀번호 차단 확인. D-137의 Burp 8081 결과는 과거 산출물에만 해당 |
| Client 단일 crawler | beta.47 코드·자동·별도 실물 하네스 통과 | 실제 Burp hook·Windows 실기기·실물 시작 응답 유실/timeout은 beta-validation의 미실행 범위 |
| Docker Chromium runtime | 구현·실물 preflight 완료 | Chromium/ChromeDriver `152.0.7977.82`, 실제 headless launch, tmpfs home, doctor 0 failure/0 warning, 임의 runtime 차단 |
| ZAP Docker API 경계 | 실물 daemon/API gate 완료 | 임시 8090에서 bridge gateway allowlist, exact form POST, tmpfs session, Replacer session 유지 확인. target/8081은 미검증 |
| ZAP verification REST 호환 | 결함 재현·코드/집중 회귀 수정 | 실물 2.17의 `/JSON/verification/...` 400 `no_implementor` 확인. 지원되지 않는 호출 제거; 수정 JAR 실제 로그인 재실행 대기 |
| 제품 MCP | 미착수 | Explorer 하네스가 아니며 현재 리스너·토큰·도구 없음 |
| 독립 corpus·외부 pilot | 미실행 | 내부 fixture는 구조 회귀일 뿐 발견률·오탐률 입증 아님 |

## 3. 검증과 배포 상태

[beta-validation의 D-153 기록](beta-validation.md)이 beta.48 수정 검증 정본이다. D-152/beta.47 실물 ZAP 결과와 새 SQLite 자동 검증을 합산하지 않는다. 배포 자산과 코드 기준은 위 완료 항목을 따른다. 아래 D-128~142의 결과는 당시 실행·산출물별 이력이며 현재 버전의 재검증으로 계산하지 않는다.

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
- D-139 당시 작업트리 버전은 `1.2.0-beta.46`이었고 해당 작업에서는 push·Release를 하지 않았다. 현재 배포 상태는 상단 D-153/beta.48 항목이 우선한다.
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
2. **Explorer 신원 회귀** → LLM 계정 선택→인증 준비→forced account/lane 귀속→프로젝트 재열기를 통합 테스트로 먼저 고정한다. 실패하면 구현을 추측 수정하지 않고 경계를 다시 판정한다. **2026-09-11 구성요소 계약 회귀만 고정**(`ExplorerFingerprintTest`·`ExplorerIdentityAttributionTest` 4 tests: gateway 요청 조립 + `Fingerprints.of`·`bindSession`·`Pipeline`·`ProjectStore` 공개계약). 이 테스트는 실제 연결부 `FlowScopeExtension.executeExplorerRequest()→recordFrom(forcedAccountId)`를 실행하지 않으므로 그 연결부를 지워도 통과한다 — **실제 연결부 회귀는 여전히 열림**(코덱스 리뷰 정정). 실제 Burp Montoya 귀속은 1의 운영 gate.
3. **그래프 운영 gate** → 현행 `#graph`는 Site Overview(Target→API 그룹) → API View(Identity→API) → Object View(Identity→API→Object)와 `API/Object 18개 더 보기 (N개 남음)`을 구현했다(D-143 5c). 실제 대규모 dataset에서 단계 전환·증분 표시·선택 Evidence 일치와 interaction latency를 측정한다. resource family→instance 한 단계를 더 넣는 설계는 PR #11 범위에 없고 현재 요구로 확정되지 않았으므로 별도 사용자 결정 전에는 구현하지 않는다. 제거된 `RouteIconRail`의 과거 1280×600 검사는 현행 gate가 아니다. Fact Core·판정 key는 바꾸지 않는다.
4. **ZAP 실물 운영 gate** → 같은 JAR과 FlowScope Docker Chromium에서 비로그인과 로그인 계정 최소 2개를 실행해 로그인 성공/실패, SCANNER+laneAccountId 귀속, 쿠키 격리, strict Client capture와 0건 실패, Passive/Alert, 정의 import, 취소와 임시 user/Context 정리를 확인한다.
5. **Release 게시 전 운영 gate** → Windows PowerShell 실기기에서 bundle/doctor/ZAP helper와 프로젝트 경로를 확인하고, Explorer anonymous·HTML form·JSON token, exact-scope, Evidence·선언 귀속, 큰 번들 단일 수집, OPTIONS probe 분리, steer·취소 정리를 확인한다.
6. **독립 평가** → 승인된 범위와 독립 truth를 확보해 HUMAN·ZAP 대비 추가 endpoint/parameter, 중복·노이즈·요청량·검토시간을 측정한다. 자동 회귀만으로 우월성을 주장하지 않는다.

## 7. 문서와 협업 운영

- 작업 시작 시 이 문서의 현재 상태·열린 항목, [제품 계획](product-development-plan.md), [개발 기록](development-log.md), [실제 검증](beta-validation.md)을 먼저 읽는다.
- 시작·중간 결과·검증·인계 시점마다 상태가 달라지면 같은 작업 단위에서 문서를 갱신한다. `구현 완료`, `자동 회귀 통과`, `실환경 통과`, `미착수`, `보류`를 분리한다.
- 파일별 정본·역사 여부·갱신 기준은 [문서 정합성·갱신 기준](documentation-status.md)에 있다. 구현 판단은 코드, 검증 주장은 명명된 artifact의 실행 기록을 근거로 쓴다.
- 사용자 요청: 진단자 편의, 일반적인 HTTP/선언 구조, 노이즈 최소화와 Evidence 보존을 우선한다. 모르는 것은 미확인으로 남기고, 모의 API 성공을 실물 성공으로 보고하지 않는다.
- 비공개 `mentor-progress-report.md`는 수정·커밋하지 않는다. 별도 Claude worktree·사용자 전역 설정은 이 작업의 정리 대상이 아니다. 루트 `CLAUDE.md`의 기존 사용자 인계 지침을 보존하면서 현재 실행 범위를 갱신한다.
