# 변경 이력

영문 변경 이력은 [`docs/en/CHANGELOG.md`](docs/en/CHANGELOG.md)에 보존합니다.

## 1.2.0-beta.3 — 2026-08-25

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
- Web 빠른 시작에 HUMAN session 제어와 ZAP target/account/progress 제어를 추가하고 긴 문자열 대응 개선
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
