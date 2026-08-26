# FlowScope 1.2.0-beta.3 제품 개발·검증 계획

이 계획은 `whs_flow` 화면을 실제 제품 작업면으로 채택한다는 결정과 FlowScope의 기존 수집·분석·MCP 신뢰 경계를 함께 만족시키도록 다시 검토한 실행 기준이다. 성공 기준은 “화면이 보임”이 아니라 실제 Evidence가 끝까지 보존되고, 거짓 자동화 없이 재현 가능하며, 공개 JAR 하나로 설치되는 것이다.

## 1. 계획 검토에서 바로잡은 전제

1. `jdk.httpserver`를 새로 쓰지 않는다. Burp Community의 축소 런타임에서 해당 모듈을 보장할 수 없으므로 기존 `LoopbackHttpServer`를 Web UI에도 재사용한다.
2. Montoya가 보장하지 않는 Repeater 결과 자동 상관을 완료 기능으로 쓰지 않는다. 저장된 마스킹 요청은 미전송 초안으로만 열고, 자동 최종 판정에는 FlowScope 통제 실행기가 별도 VALIDATION run으로 캡처한 `CONTROLLED` Evidence만 사용한다. 직접 8082 관측은 폴백이며 결정적 판정에 쓰지 않는다.
3. 비교 UI의 자동 principal/HMAC 계정 식별 주장을 가져오지 않는다. 계정은 비밀 없는 표시 정보만 저장하고 `(service, fingerprint)` 연결은 사용자가 확정한다.
4. 객체 ID가 없는 엔드포인트에 가짜 resource를 만들지 않는다. 이 경우 그래프는 identity에서 operation으로 직접 연결하고 BFLA는 명시적 역할 정책으로 분석한다.
5. 일반 LLM assessment는 `LIKELY / INCONCLUSIVE / REJECTED`만 제출한다. 최종 `CONFIRMED / INCONCLUSIVE / REJECTED`는 서버가 현재 후보와 원본/반복 재현/정상 대조 Evidence 집합을 검증한 경우에만 저장한다. 사람 판정은 감사·오버라이드 기록이다.
6. 2만 건 전체의 Request/Response를 매초 전송하지 않는다. snapshot은 메타데이터만, 전문은 선택 시 지연 로드한다.
7. crAPI 정답을 코드나 프롬프트에 넣지 않는다. 제품 완료 뒤 독립 HUMAN/ZAP/LLM pass와 블라인드 채점으로 검증한다.
8. LLM에게 ZAP 기능 선택을 맡기지 않는다. 기본 scanner lane은 Traditional Spider, strict Client Spider, AJAX fallback, passive queue, native alert 순서의 시스템 workflow다.
9. Explorer의 독립성은 프롬프트 약속이 아니라 서버 가시성 제한과 세 레인 dataset lock으로 강제한다.
10. 트래픽 노이즈는 수집 단계에서 삭제하지 않는다. 모든 Evidence를 보존하고 결정론 분류로 `INCLUDE/REVIEW/EXCLUDE`를 나누며, 메인 coverage에는 `INCLUDE`만 넣고 사용자가 operation 단위로 되돌릴 수 있게 한다.

## 2. 구현 단계와 성공 기준

### P0 — 정본·경계 고정

- Web UI를 그래프/매트릭스/상세의 유일한 정본으로 고정한다.
- Burp 탭은 scope, 포트, 프로젝트, MCP, Web 열기만 담당한다.
- HUMAN/SCANNER/LLM source와 orchestrator를 분리한다.
- 성공 기준: 문서·코드·UI 어디에도 이중 그래프, 검증 없는 LLM 확정, Repeater 자동 상관이라는 상충 주장이 없다.

### P1 — localhost Web 제품면

- `whs_flow` 정보 구조와 시각 문법을 그대로 활용해 그래프, 매트릭스, 흐름 순서, 시나리오, 파싱 결과, 계정·세션 화면을 제공한다.
- Cytoscape.js는 JAR에 vendoring하고 네트워크 CDN 의존성을 없앤다.
- Host/Origin/capability/CSP/no-store/frame 보호와 25MiB XML·1MiB form 상한을 적용한다.
- 긴 endpoint/service/Evidence는 줄바꿈·스크롤·전체 텍스트 상세로 확인 가능하게 한다.
- 성공 기준: 샘플에서 여섯 모드와 우측 상세가 동작하고, 잘린 값도 상세에서 전부 읽을 수 있으며, 잘못된 capability/origin/method가 거부된다.

### P2 — Evidence·정책·세션 작업

- 선택 API의 마스킹 Request/Response를 200건 단위로 지연 로드해 전부 탐색할 수 있게 한다.
- 등록 계정, 서비스 경계 세션 연결/해제, identity role, endpoint requirement, resource owner를 UI에서 수정한다.
- rule finding, MCP assessment, 서버 검증 최종 판정을 같은 시나리오 화면에 두고 사람 감사·오버라이드를 저장한다.
- Repeater는 첫 Evidence의 마스킹된 미전송 초안만 연다.
- HTTP 문맥 기반 비파괴 traffic classification, captured/coverage 통계, operation별 override, 반복 Evidence 표시 접기를 제공한다. cookie 회전은 검증된 account binding 전까지 서비스별 `UNRESOLVED` graph identity로 안정화한다.
- 사용자가 명시적으로 시작한 HUMAN 로그인 캡처만 memory-only broker에 넣고, service+scope+ACTIVE 상태가 맞는 계정에 한해 ZAP/LLM에 주입한다. raw 값은 project/Web/MCP에 저장·노출하지 않는다.
- 성공 기준: 비밀번호·raw token을 저장/표시하지 않고, 다른 service의 세션 연결은 실패하며, Evidence 집합이 바뀐 과거 판정은 승계되지 않는다.

### P3 — 공개 배포 정리

- JGraphX 코드·의존·고지를 공개 정본에서 제거하고 이전 구현은 `.local/archive/`에만 보존한다.
- Cytoscape.js/Jackson/FlowScope 라이선스를 JAR에 동봉한다.
- README, architecture, decisions, changelog, agent workspace의 실제 UI 경로와 버전을 맞춘다.
- 성공 기준: fresh `mvn clean verify`, fat JAR manifest/의존/라이선스 검사, 절대경로·비밀·불필요 산출물 검사를 통과한다.

### P4 — 실제 UI·Burp QA

- standalone Web UI를 데스크톱 브라우저에서 1500×900과 좁은 폭으로 확인한다.
- 그래프 필터, 노드 펼치기, Matrix, 시나리오, 계정/세션, Request/Response, sample/reset을 클릭 검증한다.
- Burp Community에서 JAR load/unload, 3개 listener 수집, Proxy history, Repeater handoff, project round trip, MCP 연결을 검증한다.
- 실제 로그인으로 USER A/B를 ACTIVE로 만든 뒤 비로그인→USER A→USER B ZAP fresh-session campaign, 신원별 수집/Alert, LLM account 주입을 검증한다.
- 성공 기준: 브라우저 콘솔 오류 0, 잘린 핵심 조작 0, unload 후 포트 해제, 세 source가 실제 포트대로 분리된다.

### P5 — crAPI 블라인드 벤치마크

- 정답 목록을 보지 않은 상태에서 새 프로젝트로 시작한다.
- HUMAN, 시스템 ZAP, LLM Explorer를 독립 수행하고 dataset을 잠근 뒤에만 Judge가 cross-source Evidence를 읽는다.
- 각 후보는 Evidence ID, 재현 절차, 관측 source, 서버 검증 verdict를 먼저 고정한 뒤 라벨 정답과 독립적으로 채점한다. 사람은 애매한 케이스를 사후 판정하되 제품 verdict를 소급 변경하지 않는다.
- 정답 대조는 모든 pass와 판정이 잠긴 뒤 별도 단계에서만 수행한다.
- 성공 기준: 소스별 고유/중복 발견, false positive, unresolved, 준비·실행 시간을 재현 가능한 보고서로 남긴다. 커버리지 퍼센트는 알려진 벤치마크 정답 집합에 대한 사후 평가에서만 사용하고 제품의 블랙박스 화면에는 표시하지 않는다.

## 3. 완료 정의

- 루트 공개 소스만으로 `mvn clean verify`와 단일 JAR 생성이 된다.
- Burp Community에서 설치·수집·Web 열기·MCP·Repeater handoff·저장/복구가 실제로 동작한다.
- HUMAN/SCANNER/LLM을 필터링하고 중복·부분 발견·불일치·미교차를 같은 데이터셋에서 읽을 수 있다.
- Request/Response와 판정 근거를 Evidence ID로 추적할 수 있다.
- 도구가 하지 않은 요청, 응답, 신원, 소유자, 취약점 확정을 UI나 문서가 했다고 주장하지 않는다.

## 4. 2026-08-26 beta.3 구현 상태

- P0~P3: 코드 구현 완료. Web UI 정본화, exact-scope 수집 차단, 구조적 마스킹, memory-only session broker, 통제 LLM 실행, Explorer 서버 격리, dataset lock, 신원별 fresh-session 시스템 ZAP campaign, 서버 검증 LLM verdict를 구현했다.
- P4 브라우저 QA: 기존 beta.3 standalone UI의 1500×900, 900×700, 600×800, 1024×768, 1280×720 검증은 통과했다. 이번 scanner control도 1280×720·600×800에서 비로그인 선택, 가로 overflow 0, 좁은 폭 modal scroll, 신원/target 미선택 버튼 비활성, warning/error 0을 확인했다. Standalone fixture에는 ACTIVE broker 계정이 없어 USER A/B 복수 chip 렌더는 HTML/API 계약까지만 통과했으며, Standalone 검증은 Burp suite tab 검증을 대신하지 않는다.
- P4 Burp Community QA: 현재 beta.3 fat JAR을 Community 2026.7.3에 로드해 suite tab, Web UI 17777, MCP 8787, HUMAN 8080, SCANNER 8081을 실제 기동했다. exact scope `http://127.0.0.1:8888/`에서 anonymous HUMAN 3건, ZAP 2.17 SYSTEM baseline 8건, MCP LLM Explorer 통제 요청 1건이 각각 HUMAN/SCANNER/LLM으로 분리됐다. ZAP 8건은 모두 `CONTROLLED/ANONYMOUS`였고 LLM의 범위 밖 FlowScope Web 요청은 거부됐다. `REVIEW`뿐인 HUMAN lane에서는 lock이 거부됐고 API `INCLUDE` Evidence 추가 뒤 12건을 잠갔으며 후보·gap은 꾸미지 않고 0건으로 남았다. 잠금 뒤 Explorer 재시작도 거부됐다.
- beta.3 잔여 수동 gate: 브라우저 `UNVERIFIED→ACTIVE` 실제 로그인, USER A/B broker 주입과 복수 ZAP lane, 구독형 Codex/Claude prompt 전체와 Judge, Repeater handoff, project save/load, extension unload 후 포트 해제를 확인해야 한다. packaging 단일화, 익명 3-source 연결, MCP protocol·가시성 격리·범위 차단은 통과했다. 정확한 완료/미완료 경계는 `beta-validation.md`에 기록한다.
- HUMAN 탐색 경계: anonymous HUMAN pass의 시작·종료와 `EXPLORATION` run ID는 실제 Burp에서 확인했다. 로그인 캡처 `SESSION_SETUP`, pass 밖 `BASELINE`, 선택 ACTIVE 계정의 exact credential match는 자동 회귀를 통과했으며 실제 로그인 계정으로 재확인해야 한다.
- 분류 경계: `REVIEW`를 Evidence·검토 대기에 보존하면서 메인 graph·3-way gap 입력에서는 보류하고, UI 처분 필터와 수량을 `INCLUDE/REVIEW/EXCLUDE`로 분리했다. 1280×720 standalone의 필터·상세·overflow·console 검증은 통과했고, 실제 Burp 대상에서 REVIEW 승격·숨김 작업량은 beta gate와 blind benchmark에서 측정해야 한다.
- 판정 경계: 거부/HEAD owner 오염, auth 부분문자열 redirect 오탐, owner-only 객체 Evidence를 차단했다. 불충분한 BOLA read 응답은 안전으로 폐기하지 않고 `UNDECIDED/INCONCLUSIVE`에 남긴다. 자동 회귀는 통과했으며 실제 Judge workflow는 beta gate다.
- P5 crAPI 블라인드 벤치마크: 사용자 검토 전까지 보류한다. 정답·공격 절차·라벨을 코드, 프롬프트, 실행 컨텍스트에 넣지 않는다.
