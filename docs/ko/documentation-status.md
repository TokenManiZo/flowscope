# 문서 정합성·갱신 기준

최종 대조: 2026-09-11 D-140~142 보존형 프로젝트·Evidence·Standalone 검증과 그래프 현행 계약. 현재 미출시 beta.46 소스는 새 진단 전에 기존 SQLite 프로젝트를 저장하고, 저장 실패 시 현재 데이터셋을 유지하며, Surface Observation에서 exact Evidence·Request Lab·Repeater로 이동한다. 패키지 Standalone도 격리 workspace에서 같은 프로젝트 API를 제공한다. 그래프 현행은 단일 3-lane과 `18개 / 전체` 전환이며 사이트/API drill-down·resource family·증분 `+18`은 후속 작업이다. D-139 Explorer와 D-138 ZAP 계약은 유지한다. 대상은 현재 checkout의 프로젝트 Markdown이며, 별도 worktree·의존성·생성물·비공개 미추적 멘토 보고서·라이선스 원문을 일괄 수정하지 않는다. 역사 문서는 당시 내용을 보존하고 현행 계약 문서만 D-140~142로 갱신한다. 2026-09-11 데스크톱 rail 한국어 라벨·세로 스크롤은 [ui-product-rationale §21](ui-product-rationale.md)에 반영했고, PR #11/#12(계층 그래프·판정 매트릭스) 흡수는 검토 중이라 현행 계약으로 기록하지 않는다.

## 1. 무엇을 어디서 읽는가

- **지금 상태·다음 작업:** [HANDOFF](HANDOFF.md). 끝난 구현, 자동 회귀, 실제 운영 검증과 미착수를 구분한다.
- **현재 계약:** README·설치 안내·architecture·Surface·UI 근거. 이전 요구와 충돌하면 코드를 확인하고 해당 계약을 정정한다.
- **왜/언제 바뀌었는가:** decisions·development-log·CHANGELOG. 과거 항목을 최신 결과로 덮지 않는다.
- **실제 검증:** beta-validation의 날짜·commit·환경·해시별 기록. 같은 beta.44 이름은 같은 artifact를 뜻하지 않는다.
- **과거 제안·명세:** 연구/원 명세/superpowers 계획/이전 인계는 당시 목적과 대체 관계를 남긴다. 현재 구현 또는 재개 명령으로 읽지 않는다.

## 2. 이번에 정정한 핵심 불일치

1. 삭제한 agent-workspace·CLI·Judge/최종 제출·closed-world executor를 아직 제공한다는 한·영 안내를 제거했다. source LLM·과거 기록은 계속 보존한다.
2. 현재 없는 ZAP Active Scan 경로를 “별도 승인하면 실행”이라고 안내하던 문장을 정정했다. 정의 import 승인과 HUMAN Request Lab은 별개다.
3. Request Lab을 독립 source처럼 나열하던 문장을 H/S/L과 HUMAN VALIDATION으로 바로잡았다.
4. JS parser는 1,048,576자가 아니라 4,194,304자다. D-127에서 확인한 live payload 전달 결함은 후속 D-128이 발견용 HTML/JavaScript/JSON/XML을 기본 4MiB까지 `FULL`로 보존하고 1.4MiB capture→record 회귀를 추가해 닫았다. 8,192자 필드는 UI preview이며, 4MiB 초과와 동적 의미 해석은 계속 별도 한계다.
5. DataFlow의 옛 substring/전체 쌍 비교 설명을 현재 exact-token index로 수정했다. 인과관계/semantic taint 증명이라는 주장은 하지 않는다.
6. ZAP capability는 D-124의 전체 exact scope+선택 target union, crawler Context는 선택 target이며 서로 다르다. Alert 상한은 lane별이 아니라 캠페인 전체 20,000개, Passive 정체는 queue 감소로만 판단한다.
7. 한국어 기여 안내의 “JDK 21 이상”을 실제 Enforcer와 맞는 JDK 21·Maven 3.9.x로 정정했다.
8. 현재 인계와 과거 인계를 분리했다. 옛 결함은 일괄 닫지 않고 재검증 대기로 승계했다. 기존 사용자 인계 지침은 보존했고 멘토 보고서는 수정하지 않았다.
9. D-128 독립 Explorer의 app-server dynamic tool, 메모리 인증, actual-response Evidence, no-MCP/no-Judge 계약을 README·설치·아키텍처·제품·UI·Surface·계획·인계에 반영했다. 이전 D-126 제거 자체와 과거 실행 기록은 덮어쓰지 않았다.
10. D-129 distribution bundle, clone 없는 ZAP helper 경로, 기능별 doctor와 Explorer 설치·로그인·재확인 동선을 한·영 README/시작 가이드, 아키텍처·결정·계획·인계·UI 근거에 반영했다. 자동 설치가 불가능하거나 하지 않는 외부 선행 조건과 Windows/실물 gate를 분리했다.
11. D-130 ZAP 계정 lane을 HUMAN Session Broker와 분리했다. 별도 메모리 vault, Browser Based Authentication의 명시적 성공, account crawler, direct-auth Evidence 귀속, 임시 user/Context cleanup, React 계정·인증 상태·정의·취소, `authhelper` doctor 계약과 실물 미검증 범위를 현행 문서에 반영했다.
12. D-131은 인증 lane의 ZAP home·session·브라우저 임시 파일을 제공 Docker의 tmpfs로 제한한다. D-132는 새 캠페인을 strict Client Spider 하나로 줄이고 Traditional/AJAX 실행·fallback·필수 add-on·상태 필드를 제거했다. 과거 Evidence enum과 역사 기록은 읽기 호환을 위해 보존하며 실물 Burp 8081 gate는 완료로 쓰지 않았다.
13. D-133은 실제 Compose publish 요청의 source인 bridge gateway를 ZAP API allowlist에 포함하고 ZAP 2.17 action POST Content-Type을 exact form media type으로 고정했다. 임시 8090 daemon/API/session gate와 아직 남은 8081 target gate를 구분했다.
14. 후속 전수 대조에서 `mcp-judge-removal-plan.md`가 D-132 이전의 Traditional → Client → AJAX 흐름을 현행으로 잘못 표시한 것을 발견했다. 단계 4를 Client-only 구현 완료·실물 gate 대기로 정정하고 제품/UI 문서의 현재 결정 번호를 D-133으로 맞췄다.
15. D-134 실물 로그인 재현에서 ZAP 2.17 REST에 `verification` component가 없고 기존 FakeZap만 가짜 `OK`를 반환한 사실을 확인했다. current README·한영 시작 가이드·아키텍처·계획·인계·변경 이력은 Browser Based Authentication + session auto-detect + 명시적 인증 성공으로 정정하고, 과거 D-130 기록은 D-134가 해당 부분을 대체하는 결정 이력으로 남겼다.
16. D-135는 PR #10을 병합하지 않고 사용자 계정 입력→ZAP 인증→계정 Client→SCANNER Evidence 흐름을 현행 구조에 이식했다. ZAP Desktop/Firefox 선택 경로는 현재 계약에서 제거하고 bundle의 Dockerfile, Chromium/ChromeDriver 사전 검사, 관리 tmpfs runtime, 모든 lane의 `chrome-headless`와 직접 Client 실측을 README·한영 시작 가이드·아키텍처·제품·UI·계획·인계·변경 이력에 반영했다. 과거 D-130~132의 당시 설명은 D-135가 대체하는 이력으로 보존한다.
17. D-136은 실물에서 ZAP action `OK`와 인증 시각이 오류 비밀번호까지 통과시킨 사실을 반영한다. 로그인 성공 정규식을 필수화하고 같은 run·계정의 실제 인증 응답 Evidence로만 account Client 진입을 허용한다. 미출시 Authentication Helper 직접 빌드는 제거하고 공식 ZAP 2.17 base의 안정판 add-on으로 정상 2계정·오류 비밀번호 차단을 재검증했다. 실제 Burp 재로드와 Windows는 남은 gate로 유지한다.
18. D-137은 인증 원시 기록과 분석 snapshot 게시의 경합을 제거했다. D-138은 실제 Burp 익명 Client 완주 중 드러난 단발 probe 오표시를 보정해 일반 실패 1·2회를 `RETRYING`, 3회째를 `UNREACHABLE`로 구분한다. 실제 Burp 로그인 2계정·Windows·최종 JAR 표시 확인은 계속 열린 gate다.
19. D-139는 Explorer가 번들·문서에서 찾은 endpoint·parameter를 자유서술로만 남기던 공백을 current-run Evidence-bound Declaration으로 연결한다. 큰 artifact 단일 수집, 선언 schema·상한·중복 제거, OPTIONS probe 분리와 서버 집계를 현행 README·한영 시작 가이드·아키텍처·Surface·Explorer·계획·인계·UI·변경 이력에 반영했다. 집중/provider 검증과 아직 남은 실제 Burp gate를 구분한다.
20. D-140~141은 새 진단을 삭제형 초기화가 아니라 저장 후 전환으로 바꾸고, 분석 revision과 데이터셋 교체 revision을 분리하며, Surface Observation을 실제 Evidence 작업면에 연결한다. 반복 XML/HAR/Proxy history 병합은 계정·세션·run provenance를 보존하고, Burp XML의 명시 charset과 XML/HAR IPv6 service를 정규화한다. 자동 회귀와 실제 Burp 운영 gate를 구분해 README·한영 시작 가이드·아키텍처·계획·인계·UI·변경 이력·검증 기록에 반영한다.
21. D-142는 Standalone의 프로젝트 API 501과 Explorer 상태 500을 패키지 E2E에서 재현해 실제 SQLite workspace와 명시적 unavailable 상태로 고쳤다. 같은 대조에서 계층 graph·resource family·증분 `+18` 문서 주장이 현재 React projection과 다름을 확인해 현행 단일 3-lane/`18개 또는 전체`와 후속 설계를 분리했다.
22. D-143(슬라이스 1)은 PR#11 파라미터 엔진을 SurfaceAnalyzer 관측 정본으로 이식하고, 관측·선언이 공통 `ParameterCoordinate(canonicalPath)`로 병합하게 했다. 기존 observe*·shape() 제거, 선언 어댑터 canonical화, 값 형식 분류 동등성(scalarType), `coordinateVersion` 영속(SQLite 스키마 무변경), 점 있는 legacy JSON 모호 좌표 미join, snapshot 비밀 비노출을 architecture·Surface·decisions·development-log·CHANGELOG·인계·검증 기록에 반영했다. 자동 회귀(`mvn clean verify`)와 실제 실행 gate를 구분한다. ParameterProfile·Gap·인가 연결·그래프 UI는 슬라이스 2+.

## 3. 전수 목록

“현행화”는 모든 문장을 최신 시제로 고쳤다는 뜻이 아니다. 현행 계약의 모순은 고치고, 역사 문서는 당시 내용을 보존하면서 적용이 끝난 지시를 표시했다. 외부 문헌의 진위·모든 제품 동작을 이번에 전수 실증했다는 주장도 아니다.

| 문서 | 지위 | 이번 대조·처리 |
|---|---|---|
| [AGENTS.md](../../AGENTS.md) | 개발 지침 | 작업 단계별 진행 기록·현행 인계 우선 규칙 추가 |
| [CLAUDE.md](../../CLAUDE.md) | 개발 지침 | 기존 사용자 인계 문단 보존, 삭제된 실행기·beta.39 안내 정정 |
| [CONTRIBUTING.md](../../CONTRIBUTING.md) | 개발 지침 | JDK 21 정확히·Maven 3.9.x, 중간 상태 갱신 |
| [docs/en/CONTRIBUTING.md](../../docs/en/CONTRIBUTING.md) | 개발 지침 | 한국어 기여 계약과 동일한 빌드·기록 규칙 |
| [README.md](../../README.md) | 현행 계약 | 폐기 실행 보장 제거·현재 결과 의미·입력/보존/분석 상한 구분 |
| [docs/en/README.md](../../docs/en/README.md) | 현행 계약 | 영문 Judge/closed-world/자동 validation 안내·Passive 정체 기준 정정 |
| [docs/ko/getting-started.md](getting-started.md) | 현행 계약 | beta.46 bundle/doctor, Docker Chromium ZAP·메모리 로그인 계정, Codex Explorer 실행·포트 경계 |
| [docs/en/getting-started.md](../../docs/en/getting-started.md) | 현행 계약 | 한국어와 동일한 Explorer 설치·실행 경계 |
| [SECURITY.md](../../SECURITY.md) | 현행 계약 | 현재 Web 경계·구버전 설정 비삭제 정책 확인, artifact gate 연결 |
| [docs/en/SECURITY.md](../../docs/en/SECURITY.md) | 현행 계약 | 한국어 운영 안전·제거 경계와 대조 |
| [docs/ko/README.md](README.md) | 목차 | 현재/역사 문서 목록과 진행 갱신 기준 |
| [docs/ko/HANDOFF.md](HANDOFF.md) | 진행 | D-142 Standalone·문서 기준선과 beta.46 Burp·Explorer 신원·그래프·ZAP·Windows 다음 gate |
| [docs/ko/handoff-2026-09-04.md](handoff-2026-09-04.md) | 역사 | 기존 인계의 이전 기준선 이하 본문 보존, 현행 작업 지시와 분리 |
| [docs/ko/architecture.md](architecture.md) | 현행 계약 | data-flow exact-token·ZAP 별도 계정 vault/browser auth/direct lane 귀속·scope union/Alert 총량 |
| [docs/ko/endpoint-parameter-surface.md](endpoint-parameter-surface.md) | 현행 계약 | D-143 공통 ParameterCoordinate(canonicalPath), LLM Observation/Declaration/probe, parameter provenance와 미실행 실험 구분 |
| [docs/ko/llm-explorer.md](llm-explorer.md) | 현행 계약 | 독립 Explorer 실행·인증·HTTP/선언 도구·scope·Evidence·사용자 조작·남은 gate |
| [docs/ko/product-overview.md](product-overview.md) | 현행 계약 | D-136 HUMAN/Docker Chromium ZAP/Explorer와 인증 응답 gate, no-Judge/no-MCP 범위 |
| [docs/ko/ui-product-rationale.md](ui-product-rationale.md) | 현행+이력 | D-139 Explorer Observation/Declaration/probe와 ZAP·과거 Judge 분리 |
| [docs/ko/web-ui-feature-parity.md](web-ui-feature-parity.md) | 현행+이력 | P20 ZAP, P21/P23 D-128/D-139 Explorer, 폐기 기능 구분 |
| [docs/ko/mcp-judge-removal-plan.md](mcp-judge-removal-plan.md) | 진행 | D-126 제거 유지, D-128 별도 Explorer, D-132 Client-only 완료와 실물 gate, 제품 MCP 보류 |
| [docs/ko/product-development-plan.md](product-development-plan.md) | 진행+이력 | D-139 Explorer와 D-130~138 ZAP의 완료·남은 gate 분리 |
| [docs/ko/decisions.md](decisions.md) | 결정 이력 | D-143 공통 parameter coordinate, D-139~142, D-130~138 ZAP 결정 |
| [docs/ko/development-log.md](development-log.md) | 역사 | D-143 슬라이스 1 파라미터 좌표 통합과 이전 nav/Explorer/ZAP 작업 기록 |
| [docs/ko/beta-validation.md](beta-validation.md) | 검증 증거 | D-139 provider/자동 gate, ZAP 실물 결과와 남은 Burp·Windows gate 분리 |
| [CHANGELOG.md](../../CHANGELOG.md) | 역사 | 미출시 문서 정정·대형 번들 완료 주장 범위 제한 |
| [docs/en/CHANGELOG.md](../../docs/en/CHANGELOG.md) | 역사 | 한국어 미출시 정정과 동일, 옛 결과 보존 |
| [docs/ko/backend-evidence-architecture-plan.md](backend-evidence-architecture-plan.md) | 역사 | 기존 Judge/MCP/lock 지시 폐기·재착수 기준 확인 |
| [docs/ko/graph-ux.md](graph-ux.md) | 역사 | 초기 Swing/JGraphX 및 과거 LLM 설명과 현행 UI 분리 |
| [docs/ko/proposal.md](proposal.md) | 역사 | Judge·동결 dataset·ablation은 이전 연구 제안, 효과 입증 아님 |
| [docs/ko/research.md](research.md) | 역사 | D-126 이후 적용 경계 표시, 외부 문헌·수치를 이번에 재검증하지 않음 |
| [docs/ko/specification/functional-spec.md](specification/functional-spec.md) | 역사 | 원 요구 보존, beta.38 MCP/브라우저/Judge 구현 주석의 폐기 명시 |
| [docs/superpowers/plans/2026-09-01-unified-analysis-workspace.md](../../docs/superpowers/plans/2026-09-01-unified-analysis-workspace.md) | 역사 | 옛 worker/skill/보존 파일 지시를 현재 작업으로 재사용하지 않음 |
| [docs/superpowers/plans/2026-09-02-reference-analysis-shell.md](../../docs/superpowers/plans/2026-09-02-reference-analysis-shell.md) | 역사 | 과거 API 전부 보존 지시가 D-126 삭제를 되돌리지 않음 |
| [docs/superpowers/specs/2026-09-01-unified-analysis-workspace-design.md](../../docs/superpowers/specs/2026-09-01-unified-analysis-workspace-design.md) | 역사 | 당시 UI 승인 범위 보존·현행 UI 근거 연결 |
| [docs/superpowers/specs/2026-09-02-reference-analysis-shell-design.md](../../docs/superpowers/specs/2026-09-02-reference-analysis-shell-design.md) | 역사 | 과거 Explorer 상태/제어 요구 대체 관계 명시 |
| [docs/ko/documentation-status.md](documentation-status.md) | 목차 | 이 전수 목록과 실제 확인 범위·상시 갱신 규칙 |

## 4. 확인 범위

- 최종 점검: 관리 문서 36개와 목록 대응 일치, 추적 Markdown의 로컬 파일/디렉터리 링크 236개 모두 존재, `git diff --check` 통과. 이전 인계 본문과 사용자 CLAUDE 인계 문단 보존 확인. 외부 URL 응답·heading anchor·모든 제품 동작을 검증한 것은 아니다.
- 코드 대조: 제거된 runtime/API, 호스트 소유 ZAP, 과거 데이터 모델, JS parser·capture·record·RouteDiscoveryDocument/Surface 전달, DataFlow index, capability scope, Alert/Passive 상한, 빌드 JDK 계약.
- D-129 작업에서 `mvn clean verify`를 2회 실행했고 매회 Java 352 tests(일반 suite의 opt-in provider 1 skip), React 38 files/242 tests가 통과했다. 기능별 Bash doctor는 JDK 21/Codex 로그인 성공과 JDK 26 거부를 실제 확인했다. JAR/bundle 반복 package와 clone 없는 clean extraction도 통과했다.
- D-130~133 작업은 같은 최종 입력에서 `mvn clean verify` 2회를 실행해 매회 Java 370 tests(실패·오류 0, opt-in 1 skip), React 38 files/247 tests를 통과했고 JAR·bundle SHA-256이 각각 일치했다. Bash 5개 syntax/shellcheck, Compose와 JAR 구조도 확인했다. 실제 ZAP 2.17 daemon/API/session gate는 별도 8090에서 통과했지만 doctor는 Burp 8081이 닫혀 실패했으므로 실물 target 캠페인 성공으로 기록하지 않는다.
- D-135 최종 입력에서 JDK 21 `mvn clean verify` 1회로 Java 375 tests(실패·오류 0, opt-in 1 skip), React 38 files/247 tests와 release gate를 통과했다. Compose, Bash syntax/shellcheck, bundle Dockerfile과 JAR manifest/namespace를 확인했다. 실제 FlowScope Docker Chromium/ChromeDriver 주 버전 일치, doctor 0/0, strict Client HTTP 200 수집 1건은 확인했지만 beta.46 JAR의 Burp 로그인·복수 계정과 Windows는 미실행이다.
- D-136 최종 입력에서 JDK 21 `mvn clean verify` 1회로 Java 381 tests(실패·오류 0, opt-in 실물 하네스 2 skip), React 38 files/247 tests와 release gate를 통과했다. 별도 실물 하네스에서 익명·정상 2계정의 Client와 오류 비밀번호의 Client 전 차단을 확인했다. beta.46 JAR의 실제 Burp 재로드·8081 capture와 Windows는 미실행이다.
- D-138 작업에서 D-137 JAR을 실제 macOS Burp에 로드한 8081 경로로 익명 Client 캠페인을 59초 만에 완료했고 SCANNER/Client 14건·Alert 29건·capability 거부 0건·Passive 잔여 0건을 확인했다. D-138 상태 전이 회귀를 포함한 전체 성공 실행은 Java 383 tests(실패·오류 0, opt-in 2 skip), React 247 tests와 release gate를 통과했고 JAR이 byte-identical했다. 반복 중 기존 React 테스트 2개가 5초 timeout으로 한 번 실패했지만 단독·다음 전체 실행에서 재현되지 않았다. 로그인 2계정·Windows·최종 JAR 화면 전이는 미실행이다.
- D-139 최종 코드에서 JDK 21.0.12.1·Maven 3.9.16 `mvn clean verify`를 연속 2회 실행해 매회 Java 388 tests(실패·오류 0, opt-in 실물/provider 2 skip), React 38 files/248 tests와 release gate를 통과했다. 두 JAR은 31,669,404 bytes·9,143 entries·SHA-256 `d00bcb35e36eb5e60e843e8d1a3bf8d425b4e35c9a32ade700780cbd8f949cf6`로 동일했다. 실제 Codex provider opt-in 1/1은 HTTP Evidence→선언 tool protocol을 확인했지만 실제 Burp 대상 완주는 미실행이다.
- D-128 최종 입력에서 `mvn clean verify`를 두 번 실행했고 Java 350 tests(일반 suite의 opt-in provider 1 skip), React 38 files/241 tests가 매회 통과했다. 두 JAR은 31,626,205 bytes, 9,130 entries와 SHA-256 `762728bff34d9d4d9d9f3a695d43fc5ed6ede25a9900c6db552affdcc268d87b`로 동일했다.
- opt-in provider 하네스를 별도로 두 번 실행해 설치·로그인된 실제 Codex app-server의 dynamic HTTP tool 호출을 확인했다. 실제 Burp/ZAP, 외부 대상 요청, Windows, 독립 corpus 효능은 실행하지 않았다. 검증 범위와 명령은 [beta-validation](beta-validation.md)이 정본이다.
- 대형 응답 전달 문제는 D-128 코드와 1.4MiB 회귀로 수정·검증했다. 실제 Burp 대상에서의 운영 재현과 4MiB 초과 응답은 [HANDOFF](HANDOFF.md)의 별도 gate·한계로 추적한다.

## 5. 앞으로의 갱신 시점

1. **작업 시작:** HANDOFF·제품 계획에서 이번 범위, 시작 기준 commit, 완료 기준, 미착수 항목을 확인하고 달라졌으면 갱신한다.
2. **진행 중:** 원인 확정·실패·범위 변경·차단이 나타나면 HANDOFF와 개발 기록에 근거와 다음 행동을 적는다. 마지막 응답까지 미루지 않는다.
3. **검증 후:** 실제 실행한 명령·환경·artifact·결과만 beta-validation에 기록한다. 문서 전용 작업은 링크·정합성 확인 결과를 개발 기록에 기록하며 제품 검증을 새로 했다고 쓰지 않는다.
4. **인계/커밋 전:** 영향받은 현행 문서의 한·영 대응, 과거 계획의 대체 관계, 링크와 사용자 변경 보존을 확인한다. 진행·검증·미착수가 서로 다른 문서에서 모순되지 않게 한다.

자동 타이머나 별도 모니터링을 만드는 규칙이 아니다. 각 실제 개발 작업 안에서 AGENTS/CLAUDE/기여 지침과 함께 이행한다.
