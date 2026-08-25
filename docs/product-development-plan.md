# FlowScope 1.2 Beta 제품 개발·검증 계획

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

## 4. 2026-08-25 beta.3 구현 상태

- P0~P3: 코드 구현 완료. Web UI 정본화, exact-scope 수집 차단, 구조적 마스킹, memory-only session broker, 통제 LLM 실행, Explorer 서버 격리, dataset lock, 시스템 ZAP baseline, 서버 검증 LLM verdict를 구현했다.
- P4 브라우저 QA: beta.3 standalone UI에서 완료. 1500×900, 900×700, 600×800에서 quick-start, 계정·세션, Matrix의 페이지형 Request/Response 지연 로드와 반응형 레이아웃을 확인했고 콘솔 오류는 없었다. Standalone 검증은 Burp suite tab 검증을 대신하지 않는다.
- P4 Burp Community QA: beta.3 산출물 기준 미완료. 이전 산출물에서 load/unload, listener 분류, MCP/Web, Repeater 초안, project round trip smoke를 수행한 기록은 있으나 memory-only broker, controlled executor, dataset lock/Judge, 시스템 ZAP baseline이 추가된 beta.3의 통과로 소급하지 않는다.
- beta.3 수동 gate: 실제 Burp Community load/unload·브라우저 로그인 캡처·세션 주입·통제 LLM 요청·ZAP 2.17 연쇄 workflow·구독형 Codex/Claude Explorer/Judge·프로젝트 save/load를 새 JAR로 확인해야 한다. 정확한 완료/미완료 경계는 `beta-validation.md`에 기록한다.
- P5 crAPI 블라인드 벤치마크: 사용자 검토 전까지 보류한다. 정답·공격 절차·라벨을 코드, 프롬프트, 실행 컨텍스트에 넣지 않는다.
