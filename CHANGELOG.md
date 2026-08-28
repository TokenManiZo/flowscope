# 변경 이력

영문 변경 이력은 [`docs/en/CHANGELOG.md`](docs/en/CHANGELOG.md)에 보존합니다.

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
- 현재 beta.3 JAR을 Burp Community 2026.7.3·ZAP 2.17·crAPI·로컬 MCP에 연결해 HUMAN listener/SCANNER/LLM 전송 경로와 범위 밖 LLM 차단을 실측. HUMAN은 8080 `curl` wiring이며 실제 Burp Browser 검증은 아님
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
