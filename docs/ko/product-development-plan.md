# FlowScope 1.2.0-beta.39 제품 개발·검증 계획

> **읽는 법:** 맨 위 beta.39 절만 현재 우선순위다. 아래 beta.38 이하 절은 각 버전에서 세운 계획과 당시 검증 상태를 보존한 이력이며, 남은 작업의 현재 우선순위는 `HANDOFF.md`와 beta.39 절을 따른다.

## 0. beta.39 우선순위: 통합 회귀 복구와 실제 Burp gate

1. API 문맥 없는 401/403 scanner probe와 `/manifest.json`을 메인 API 그래프에서 분리하되 Evidence는 보존한다.
2. Explorer의 실제 방문 사실과 BOLA/BFLA coverage 자격을 분리해 제외된 navigation/static route가 완료를 영구 차단하지 않게 한다.
3. 기본 `identity → API`, 선택형 사이트 개요, 계층별 viewport와 고유 API 집계를 회귀로 고정한다.
4. 전체 verify·독립 Web 검증 후 beta.39 JAR을 실제 Burp에 재로드하고 crAPI HUMAN/ZAP/LLM을 새 run으로 실행한다.

**현재 상태:** 1~3은 코드·최소 회귀·전체 303 tests·독립 Web API↔사이트 전환을 통과했다. 4의 실제 Burp beta.39 재로드·crAPI 재실행·장시간 ZAP 계정 전환은 대기한다.

## 0. beta.38 우선순위: ZAP 장시간 실행 관측 가능성

1. campaign/lane/stage 시간, 단계 제한, ZAP heartbeat와 raw capture/status 변화를 상태 API의 명시 계약으로 만든다.
2. 후속 신원이 직렬 대기 중인 이유와 queue 위치를 표시해 정지·오류와 구분한다.
3. heartbeat 부재, 응답 정상 무변화, deadline 초과를 서로 다른 운영 상태로 보여 주되 자동 취약점·성공 판정으로 쓰지 않는다.
4. 전체 verify와 재현 JAR을 통과한 뒤 실제 Burp에서 장시간 AJAX → test1 전환을 확인한다.

**현재 상태:** 1~3 코드, inline JavaScript parse, 전체 verify 299 tests 연속 2회와 byte-for-byte 동일한 beta.38 JAR을 완료했다. 4의 실제 Burp beta.38 재로드·장시간 AJAX→test1 전환·heartbeat 단절/timeout 표시는 대기한다.

## 0. beta.37 우선순위: Explorer 입력 무결성과 그래프 Fact Core

1. Explorer run에서 선택한 account를 고정하고 target tool의 account override를 서버에서 거부한다.
2. rendered discovery는 선택형 8082 listener에 의존하지 않게 CDP direct worker로 유지하되 exact scope와 service별 broker header 경계를 강제한다.
3. CLICK/FILL selector가 아니라 실제 비안전 HTTP request 단위로 Burp 승인을 받고, browser runtime route를 discovery-only frontier에 등록해 controlled replay를 완료 조건으로 만든다.
4. coverage 관측을 `GraphObservationFact`로 투영해 Evidence·identity·API·object·source·run·HTTP outcome을 보존하고, 화면은 Site→API Group→Identity→API→Object family/instance 순으로 단계적으로 연다.
5. 전체 `mvn clean verify`, JavaScript parse, 단일 JAR smoke를 통과한 뒤 beta.37을 실제 Burp에 재로드해 현재 beta.34 화면과 구분한다. crAPI 고카디널리티 객체에서 선 교차·라벨 가독성·클릭 drill-down을 확인하고, beta.36 대비 route replay·노이즈·시간·메모리와 blind endpoint/finding 성능을 별도 측정한다.

**현재 상태:** 1~4 코드, inline JavaScript parse, 전체 `mvn clean verify` 299 tests 연속 2회와 동일 SHA-256 JAR은 통과했다. 5의 실제 Burp beta.37 재로드·고카디널리티 화면·블라인드 효능은 아직 완료로 기록하지 않는다.

## 0. beta.36 우선순위: SPA browser discovery와 Evidence replay 분리

1. 설치된 Chrome/Chromium/Edge를 임시 profile·CDP로 실행하되 Playwright/Chrome MCP/ChromeDriver를 새 사용자 의존성으로 만들지 않는다.
2. CDP에서 exact scope 밖 request를 차단하고 run 시작 시 선택한 broker account를 고정 주입한다. 기본 Chrome profile과 provider 브라우저를 재사용하지 않는다.
3. DOM·링크·폼·버튼·SPA runtime network는 discovery hint로만 반환하고, controlled executor 재현만 Evidence·완료·Judge lock 자격을 갖는다.
4. direct navigation/snapshot은 자동 허용하되 CLICK/FILL은 Burp 승인, password/file block, arbitrary JavaScript 비노출을 강제한다.
5. 로컬 Chrome smoke와 자동 계약을 통과한 뒤 beta.36 JAR을 실제 Burp에 재로드해 HTTPS, 8082 proxy, ACTIVE account session, SPA API 발견→replay→Evidence→run 종료를 확인한다. 이어 동일 target에서 beta.35 HTTP-only 대비 새 route 수, 유효 API 수, 중복/노이즈, 소요시간·메모리를 측정한다.

**현재 상태:** 1~4 코드와 run 실패·취소 cleanup, 로컬 설치 Chrome의 임시-profile/CDP/exact-scope/DOM/network/click smoke, MCP discovery-only 계약 회귀를 완료했다. 전체 `mvn clean verify` 296 tests와 beta.36 JAR smoke도 통과했으며 정확한 산출물은 `beta-validation.md`에 기록했다. 실제 Burp HTTPS·broker account·8082 통합과 블라인드 성능 비교는 아직 완료로 주장하지 않는다.

## 0. beta.35 우선순위: Explorer 안전 개방과 실증 가능한 완료 gate

1. own-run INDEPENDENT safe concrete route를 모두 요청하기 전에는 다른 레인 힌트를 공개하지 않는다.
2. 독립 frontier가 소진되면 HUMAN·SCANNER의 source/run/Evidence/provenance/응답을 제거한 route 문자열만 ASSISTED hint로 제공한다.
3. controlled response Evidence, 두 frontier 조회, 종료 시점 safe concrete route 0건을 Explorer 완료 조건으로 통합한다.
4. `{id}` 동적 route는 실제 관측값이 없으면 만들지 않고, POST/PUT/PATCH/DELETE는 기존 명시 승인·Burp 확인을 유지한다.
5. 다음 수직 단위는 JavaScript 실행이 필요한 SPA를 위한 격리 browser worker와 Explorer 작업 피드/개입 계약이다. browser worker가 없을 때의 HTTP-only 한계를 UI와 결과에 명시하고, 블라인드 target에서 HTTP-only 대비 추가 route와 자원 비용을 측정한다.

**현재 상태:** 1~4 코드, 전체 `mvn clean verify` 294 tests와 beta.35 JAR smoke는 완료했다. 두 번째 재현 build, 실제 Burp+허가 target Explorer와 browser worker는 아직 완료하지 않았다. ASSISTED 발견은 독립 LLM coverage가 아니라 별도 보완 단계로 측정한다.

## 0. beta.34 우선순위: P1 복잡도·메모리 경계 완료와 효능 gate

1. Snapshot 반복 cluster를 선형 projection으로 바꾸고 Evidence ID를 페이지 조회한다.
2. DataFlow 중첩 순회·substring을 신원별 exact-token index로 바꾼다.
3. live HTTP decode 전 byte 상한, 프로젝트 streaming GZIP 복원 상한, assessment retained-byte 상한을 공통 gate로 고정한다.
4. 20,000건 stress와 공격 입력 회귀를 통과하되 자동 테스트를 탐지 효능으로 표현하지 않는다.
5. 다음 개발은 P2 세션·신원 무결성을 먼저 닫고, 이후 정답 격리 benchmark에서 H → H+ZAP → H+ZAP+LLM → Judge의 고유 유효 발견, FP/FN/INCONCLUSIVE, 검토시간과 자원을 증분 측정한다. 유의미한 증가가 없는 레이어는 기본 경로에서 낮추거나 제거한다.

**현재 상태:** 1~4 코드와 293개 전체 자동 회귀·연속 두 재현 빌드는 완료했다. 실제 Burp 20,000건 RSS·polling, end-to-end 3-way와 블라인드 효능은 아직 완료하지 않았다. 다음 코드 우선순위는 `HANDOFF.md`의 P2이며, UI 재설계나 새로운 탐색 휴리스틱을 먼저 추가하지 않는다.

## 0. beta.33 우선순위: 비동기 게시·요청 실험·후보 표시 무결성

1. Request Lab은 Evidence 선택 generation과 전송 중 불변 draft를 사용해 늦은 응답이 현재 선택을 덮지 못하게 한다.
2. UI 잠금뿐 아니라 서버 operation ID 멱등성으로 동일 요청의 중복 상태 변경을 한 번만 실행한다. ID 재사용 시 입력 digest가 다르면 거부한다.
3. 분석 결과는 dataset/config publication epoch가 같은 경우에만 게시해 clear·즉시 rebuild·background rebuild 경합에서 이전 결과가 부활하지 않게 한다.
4. 빈 authorization cell은 서버가 만든 exact `UNCROSSED` candidate key가 있을 때만 미교차 후보로 표시하고, 그 외에는 일반 미검증으로 남긴다.
5. P1의 남은 대용량·복잡도 결함은 Snapshot cluster 출력, DataFlow index, bounded decode/decompression, LLM retained-byte 순으로 실패 fixture와 수치 예산을 먼저 만든 뒤 수정한다.

**현재 상태:** 1~4의 코드와 집중 회귀는 완료했다. 전체 `clean verify`·재현 JAR 수치는 `beta-validation.md`에 실제 실행 결과만 기록하며, 실제 Burp Request Lab 지연 응답·상태 변경과 clear/rebuild 동시성 수동 gate는 아직 완료로 주장하지 않는다.

## 이전 우선순위: beta.32 Evidence 신뢰·exact run 완료·재열기 무결성

1. HUMAN/SCANNER/LLM 정상 완료를 `LaneCompletionPolicy` 한 경로로 통합하고 실패·취소를 abort로 분리한다.
2. 8082 직접 fallback의 `UNVERIFIED_RUNTIME`을 원 Evidence로만 보존하고 coverage·Explorer 완료·dataset lock에서 제외한다.
3. 완료 시점 Evidence ID를 exact run과 함께 동결하고 잠금 입력도 그 ID들로만 구성한다.
4. JSON schema v3와 SQLite storage schema v2에 exact completed run을 저장하고 source-only legacy 표식은 완료로 복원하지 않는다.
5. 무작위 run ID 대조, 전체 자동 회귀, 재현 JAR smoke를 통과한 뒤 실제 Burp 3-way 저장→재열기→재잠금을 수동 gate로 수행한다.

**현재 상태:** 1~4 코드와 자동 회귀는 완료했다. 실제 beta.32 JAR 수동 통합 gate와 blind benchmark는 남아 있으며 `beta-validation.md`에서 수행 결과만 기록한다.

## 이전 우선순위: beta.31 외부 사용자의 LLM 환경 자동 준비

1. 사용자는 공식 Codex/Claude CLI 설치와 최초 구독 로그인만 수행한다.
2. FlowScope가 운영체제 표준 경로·런타임 환경에서 실행 파일을 찾고 공식 auth status로 준비 상태를 자동 확인한다.
3. Web polling은 캐시만 읽고 READY provider를 자동 선택한다. 실행 직전에는 다시 확인해 stale 상태로 시작하지 않는다.
4. 전체 회귀, 두 로컬 로그인 CLI preflight, 재현 JAR을 통과한 뒤 beta.31 Burp MCP Explorer를 수동 통합 gate로 수행한다.

**해당 버전 종료 당시 상태:** 코드와 집중 회귀, 로컬 Codex·Claude auth status 확인은 완료했다. 전체 자동 회귀·재현 배포물 수치는 `beta-validation.md`를 따르며 실제 beta.31 Burp Explorer 완주는 남았다.

## 0. beta.30 우선순위: 로그인 후 원클릭 실행과 관측 가능한 Explorer

1. 공식 Codex/Claude CLI 설치와 로그인 이후에는 API key 입력·MCP 설정 복사 없이 Web 버튼으로 새 실행을 시작한다.
2. 설치와 로그인 준비 상태를 구분하고 실패 원인을 대상 요청 전에 사용자에게 보여 준다.
3. 실제 provider JSONL에서 모델 메시지·FlowScope tool 상태·Evidence 완료 gate만 bounded event로 노출한다. reasoning/thinking과 raw tool payload는 표시하지 않는다.
4. 자동 회귀, 실제 구독 CLI smoke, 재현 JAR을 확인한 뒤 beta.30 JAR의 Burp MCP target run을 수동 통합 gate로 수행한다.

**해당 버전 종료 당시 상태:** 코드, 265개 전체 회귀, 실제 로그인 Codex CLI smoke와 재현 JAR은 완료했다. beta.30 JAR 재로드 뒤 실제 Burp MCP target run과 Claude 로그인 환경 gate는 대기 중이었으며 수치는 `beta-validation.md`를 따른다.

## 마스터 계획 1단계 — 완성 목표 재정의

정본 목표는 다음과 같다.

> 허가된 exact scope에서 관측 가능한 접근통제 공격면을 최대한 구조화하고, 신원·작업·객체·상태 흐름의 차이를 재현 가능한 Evidence로 검증해 사람이 놓치기 쉬운 경로와 인가 후보를 드러낸다.

완성 기준은 기능 개수나 화면 존재 여부가 아니다. 공개 fixture와 정답 격리 블라인드 benchmark에서 endpoint·객체·분류·finding 측정값, 사용자 `REVIEW` 작업량, false positive·false negative·unresolved를 함께 공개하고, 후보와 verdict를 원 Request/Response·재현·정상 대조 Evidence까지 역추적할 수 있어야 한다.

## 0. beta.29 우선순위: 실제 Codex Explorer 실행 격리와 성공 오라클 완결

1. 사용자 home의 skill 목록을 끄는 설정 문자열에 의존하지 않고 로그인만 연결한 임시 `CODEX_HOME`으로 provider 실행 환경을 구조적으로 격리한다.
2. 첫 target call을 exact entry GET read로 고정하고, 이후에는 같은 run 응답에서 파생된 route frontier만 순회시킨다.
3. server-side `end_run` gate와 launcher-side exact Evidence gate를 함께 두고 0건 완료 표식은 취소한다.
4. unit/integration 회귀와 실제 구독 Codex strict/ephemeral smoke를 통과한 뒤 단일 JAR을 만든다.
5. 새 JAR 재로드 뒤 실제 Burp MCP에서 target read, route 재열거, Evidence 저장, 정상 종료를 확인한다. 이 gate 전에는 Explorer 실대상 완주를 주장하지 않는다.

**해당 버전 종료 당시 상태:** 1~4의 코드·자동 회귀와 로컬 Codex 0.147.0 구독 smoke를 완료했다. 5의 beta.29 Burp 재로드 통합 gate와 블라인드 benchmark는 대기 중이었다.

## 0. beta.28 우선순위: Explorer 무성과 성공 차단과 명시 API 정의 탐색

1. Codex/Claude Explorer의 안전 read와 승인형 write를 MCP 계약부터 분리하고, 실제 응답 Evidence가 없는 run은 완료시키지 않는다.
2. Codex 실행별로 사용자 skill·plugin·외부 browser surface를 격리하고 로컬 prompt-input smoke와 회귀로 확인한다.
3. ZAP outgoing proxy를 대상 전송 전에 fail-closed 검사하고, 운영자가 제공한 exact-scope OpenAPI·GraphQL·Postman·SOAP 정의를 신원별 Context에서 bounded import한다.
4. 정의 import 실패는 기존 crawler/passive Evidence를 버리지 않고 단계·형식·원인을 사용자에게 표시한다.
5. 자동 회귀와 JAR smoke 뒤 실제 Burp에서 Codex target read/0건 실패, ZAP 네 형식 import, 복수 계정 campaign, 3-lane lock과 Judge를 확인한다.

**해당 버전 종료 당시 상태:** 1~4의 코드, 258개 전체 자동 회귀, 완성 JAR smoke와 동일 소스 2회 SHA-256 일치를 완료했다. 5의 실제 Burp 재로드 통합 gate와 블라인드 benchmark는 대기 중이었으며, 완료 전에는 탐지 성능 향상이나 3-way 실환경 완주를 주장하지 않는다.

## 0. beta.27 우선순위: 안전 ZAP 기준선 완결과 구독 CLI 실행 복구

1. 신원별 ZAP 기준선이 외부 설정에 조용히 의존하지 않도록 필수 안전 add-on, 선택 target subtree 전용 Context, passive engine·전체 rule·scope-only 상태를 spider 전에 확인·적용한다.
2. Traditional, Client, AJAX의 서로 다른 탐색면을 모두 실행하되 단계 실패·0건을 숨기지 않고 남은 Evidence와 함께 경고 완료로 보존한다.
3. ZAP Alert를 첫 500개에서 자르지 않고 페이지 단위로 수집하되 신원별 메모리 상한과 truncation 상태를 공개한다.
4. GUI Burp의 축소된 환경에서도 로그인된 Codex/Claude CLI 런타임을 찾도록 실행 파일 경로 전달을 보강하고, 기존 Session Broker·Judge Evidence gate를 전체 회귀로 재검증한다.
5. 자동 회귀와 JAR smoke 뒤 실제 beta.27 Burp에서 ZAP key/upstream/add-on, 계정별 capture, Explorer 종료, dataset lock, Judge 재현·대조를 순서대로 확인한다.

**해당 버전 종료 당시 상태:** 1~4의 코드, 253개 전체 자동 회귀와 beta.27 JAR 산출물 검증을 완료했다. 5의 실제 Burp 통합 gate는 대기 중이었으며 완료 전에는 성능 향상이나 3-way 완주를 주장하지 않는다.

## 0. beta.26 우선순위: 기존 ZAP HAR를 SCANNER Evidence로 재사용

1. ZAP에서 내보낸 HAR 1.2 HTTP 요청·응답을 기존 SCANNER 데이터 모델로 손실 없이 가능한 범위까지 변환한다.
2. 인증 마스킹, exact scope, 입력/payload 상한과 항목 단위 오류 격리를 live/XML 경계와 일치시킨다.
3. HAR 파일에는 없는 native Alert, fresh session, campaign completion을 추론하지 않는다.
4. 합성 회귀 뒤 실제 ZAP 2.17 HAR를 beta.26 Burp에서 업로드해 Evidence 상세·source·candidate를 수동 확인한다.

**해당 버전 종료 당시 상태:** 1~3과 249개 자동 회귀, 완성 JAR smoke는 완료했다. 4와 원격 CI는 대기 중이었으며 HAR import를 live ZAP 기준선 완료로 계산하지 않는다.

## 0. beta.25 우선순위: 배포 JAR streaming·MR 경로 완결

1. 완성 JAR의 manifest를 `JarFile`뿐 아니라 순차 `JarInputStream`에서도 읽을 수 있게 한다.
2. MR-JAR relocation에서 Java version 숫자 하드코딩을 제거하되 원 package 누출과 실제 versioned class 선택을 자동 검증한다.
3. 완성 artifact 검증을 CI 전용 명령이 아니라 로컬 `mvn clean verify`에도 연결한다.
4. 실제 Burp load/unload와 외부 배포 도구 호환성은 자동 gate와 구분해 수행한다.

**해당 버전 종료 당시 상태:** 1~3과 243개 자동 회귀, 완성 JAR smoke, 반복 SHA-256은 완료했다. 4와 원격 CI는 대기 중이었다.

## 0. beta.24 우선순위: 판정 오라클·게시 경계 하드닝

1. 자원 타입에 맞는 실무형 ID 필드를 인식하되 중첩 자원의 최종 대상만 객체 노출 증거로 쓴다.
2. soft-deny를 오류 봉투로 제한하고 객체·소유자·DataFlow 응답 판독에 공통 크기·깊이·순회 상한을 둔다.
3. 실제 비인증과 지문 추출 실패를 분리하고 미확정 권한을 Judge 정상 대조로 사용하지 않는다.
4. 정책 전체 교체와 계정 갱신을 원자화하고 Burp/Web/MCP 게시 분석을 수집 DTO와 분리한다.
5. 리뷰 주장을 호출 경로와 회귀로 독립 판별해 미재현·의미가 다른 제안은 기각 사유를 기록한다.

**해당 버전 종료 당시 상태:** 1~5와 `mvn clean verify` 243개 회귀는 완료했다. 실제 beta.24 Burp load/unload·SQLite 저장/재열기·3-way/Judge 실행과 블라인드 정확도는 수행하지 않았다.

## 0. beta.23 우선순위: 배포물·CI 하드닝

1. Apache-2.0 의존성의 원 NOTICE와 포함된 제3자 라이선스 텍스트를 fat JAR에 보존하고 프로젝트 고지의 실제 저작물 귀속을 바로잡는다.
2. Jackson·jsoup·SnakeYAML의 base/MR-JAR 클래스를 함께 격리하되 sqlite-jdbc JNI 패키지는 변경하지 않고 다중 classloader 동시 연결을 회귀로 고정한다.
3. `clean verify`가 쓰는 Maven 플러그인과 GitHub Actions를 고정하고, 단일 JAR·MR-JAR·NOTICE·비누출 패키지·Bash/PowerShell·반복 SHA-256을 CI에서 검사한다.
4. 실제 Burp Community에서 beta.23 JAR load/unload와 SQLite 프로젝트 저장·재열기를 확인한다.

**해당 버전 종료 당시 상태:** 1~3은 로컬 코드·패키징·자동 회귀에서 완료했다. 원격 CI와 실제 Burp load/unload·프로젝트 저장/재열기는 실행하지 않았으므로 beta.23 실환경 완료로 계산하지 않는다.

다음은 완료 주장이 아니다.

- 블랙박스 대상의 모든 endpoint·객체·상태 발견
- 오탐·미탐 0
- LLM 서술만으로 취약점 최종 확정
- 자동화 단계 종료 또는 HTTP 상태만으로 점검 충분성 판정

**상태: 목표·비목표·측정 가능한 완료 기준을 README·설계·결정 문서에 동일하게 고정함. 후속 우선순위 작업은 별도 단계다.**

## 0. beta.22 우선순위: 첫 실행 경로 압축

1. 빠른 시작의 여섯 설명과 세 실행기 제어를 네 단계 진행 내비게이션으로 줄인다. → 검증: 기본 노출 panel 1개, 네 단계 직접 이동.
2. scope·HUMAN exact run·ZAP campaign·LLM completed lane/Judge 상태로 첫 미완료 단계를 선택한다. → 검증: 수집 건수만으로 완료하지 않는 Web 계약 회귀.
3. README를 처음 한 번 준비와 점검할 때마다 수행할 네 단계로 분리한다. → 검증: JAR/listener/ZAP/CLI 명령과 상세 가이드 링크 정합성.
4. 데스크톱과 390px 화면에서 단계 라벨·버튼·panel의 가로 잘림이 없는지 확인한다.

**해당 버전 종료 당시 상태:** beta.22 단계형 Web UI와 한영 사용자 문서를 구현했다. 자동 회귀·standalone 반응형 검증 범위까지만 완료로 기록하며, 실제 Burp의 scope/HUMAN/ZAP/LLM 상태 전환은 수동 gate로 남았다.

## 0. beta.21 우선순위: ZAP 배포 중립 온보딩·Windows 재현성과 기존 HUMAN 실환경 gate

1. Release JAR·소스 빌드·완전한 3-way 요구사항을 분리하고 ZAP/LLM을 완전한 흐름의 필수 구성으로 고친다. → 검증: 한영 README와 상세 시작 문서 링크·버전·포트 정합성.
2. ZAP Desktop과 선택형 Docker가 동일한 loopback API 계약을 사용하고 Web에서 실행 전 연결·버전·key 오류를 확인한다. → 검증: 연결 상태 API/UI 계약, 연결 전 캠페인 비활성화, 배포 방식 미추측.
3. macOS/Linux Bash와 Windows PowerShell 7에서 owner-only API key를 독립 생성하고, 선택한 Docker 경로에서는 공식 ZAP 2.17.0 digest 이미지와 Docker-host Burp `8081` upstream을 한 명령으로 준비한다. → 검증: key script, Compose config, ShellCheck, Windows CI parser, macOS 실제 container health/API/version/upstream/add-on 재조회.
4. FlowScope가 기본 `~/.flowscope/zap-api-key`를 링크·권한 검증 후 읽는다. → 검증: 명시 key/환경/key file 우선순위와 file validation 회귀.
5. doctor로 listener, ZAP, add-on, provider CLI, Web/MCP를 점검하되 포트 open만으로 Burp 신원을 증명한다고 주장하지 않는다.
6. 아래의 HUMAN 원문 byte·Evidence UI 실제 Burp gate를 이어서 수행한다.

**해당 버전 종료 당시 상태:** beta.21에 Desktop/Docker 공통 연결 확인 UI와 독립 key helper, 한영 설치 코드·문서, macOS의 공식 ZAP 2.17.0 실제 기동·loopback API/version·Docker→Burp SCANNER `8081` upstream·필수 add-on·doctor, Windows PowerShell helper와 CI parser gate를 구현했다. 실제 ZAP Desktop 수동 설정, Windows 실기기 Docker Desktop target capture, HTTPS, USER A/B, LLM/Judge end-to-end는 이번 setup 검증으로 대체하지 않는다.

## 0. beta.19 우선순위: HUMAN 원문 byte·Evidence UI 실환경 gate

1. live 요청·응답 원문을 프로젝트 모델과 분리된 bounded process-memory vault에만 둔다. → 검증: retain/상한/오래된 항목 제거/clear 회귀와 snapshot 비밀 부재.
2. 사용자가 특정 Evidence를 선택하면 큰 Web 편집기에서 요청과 응답을 나란히 보고 `원문/비로그인/등록 계정`으로 명시 전송한다. → 검증: localhost capability API 계약, Web 문구·모드·전송 결과 회귀.
3. 원 서비스와 exact scope를 고정하고 redirect 금지·TLS 검증·timeout·Content-Length 정합성을 적용한다. 결과는 HUMAN `VALIDATION/CONTROLLED`로 기록해 discovery coverage를 늘리지 않는다. → 검증: 자동 계약과 실제 Burp Community 수동 gate.
4. 초기화·샘플 교체·프로젝트 열기·unload에서 raw vault를 폐기하고, imported/binary/상한 초과 Evidence는 마스킹 폴백을 정직하게 표시한다.
5. 현재 JAR을 재로드한 뒤 실제 HUMAN Evidence에서 비ASCII 원문 byte, ORIGINAL, ANONYMOUS, USER A, USER B 전송의 서버 수신 헤더·응답·Evidence phase·coverage 불변과 binary Repeater fallback을 확인한다.

**해당 버전 종료 당시 상태:** raw byte 정본·strict charset·Evidence ID 상세·라이브러리 외부 반응형 그래프 래퍼와 beta.19의 221개 자동 회귀, standalone 1280px/600px UI 검증 완료. beta.19 JAR의 Burp ORIGINAL/ANONYMOUS/USER A/USER B byte 전송 gate는 남았으며, 통과 전에는 실환경 완료로 표시하지 않는다.

## 0. beta.16 우선순위: HUMAN 요청 시점 문맥과 principal 표현

1. Proxy뿐 아니라 Repeater·Intruder·Target도 요청 시점 HUMAN run/account를 응답까지 보존한다. → 검증: `messageId` correlation·pass 경계 tracker 회귀.
2. 초기화·샘플 교체·프로젝트 열기 전 요청의 늦은 응답이 새 데이터셋에 들어오지 않는다. → 검증: dataset epoch 회귀.
3. 하나의 등록 계정에 연결된 Cookie·Authorization·subject를 여러 세션처럼 표시하지 않는다. → 검증: 권한 카드 principal-kind Web 계약과 계정 화면 artifact projection 회귀.
4. beta.16 JAR을 Burp Community에 재로드해 실제 Browser pass, pass 중 Repeater, pass 종료 뒤 늦은 응답, 초기화 직후 응답, SQLite 저장·재열기를 확인한다.

**해당 버전 종료 당시 상태:** 코드·211개 자동 회귀·단일 배포 JAR 무결성 완료. 실제 beta.16 Burp 수동 gate와 독립 HUMAN fixture confusion matrix는 남아 있었다.

## 0. beta.15 우선순위: rendered scanner 거짓 정상 완료 차단

1. Client Spider status가 완료여도 해당 신원·run의 실제 Client capture가 0이면 AJAX fallback을 실행한다. → 검증: Client status 100/Client capture 0 fixture에서 AJAX 호출과 rendered capture 1.
2. AJAX까지 0이면 Traditional Evidence와 Alert는 보존하되 `COMPLETED_WITH_WARNINGS`로 깨끗한 browser-rendered 기준선과 구분한다. → 검증: raw Traditional 1/Client 0/AJAX 0 fixture와 Web warning 상태 계약.
3. 전체 capture 0 failure, exact scope, fresh session, account credential replacement, Active Scan 별도 승인은 바꾸지 않는다.
4. beta.15 JAR을 Burp Community에 재로드한 뒤 실제 crAPI에서 Client→AJAX 전환·stage count·경고를 확인한다. 이후에만 LLM Explorer 실제 세션 검증으로 넘어간다.

**해당 버전 종료 당시 상태:** 코드·207개 자동 회귀·배포 JAR 무결성 완료. 실제 beta.15 anonymous crAPI 실행에서 Client→AJAX fallback 뒤 전체 226건(Traditional 8, Rendered 218)과 native Alert 30건, warning-completed 상태를 관측했다. 이 수치는 endpoint 충분성이나 취약점 탐지 성능으로 해석하지 않는다.

## 0. beta.14 우선순위: ZAP 완료 판정과 단계 관측 정합성

1. ZAP 완료 gate는 비동기 분석 snapshot이 아니라 응답 callback 직후 raw capture를 센다. → 검증: snapshot 0건/raw counter 1건 fixture가 `COMPLETED`.
2. 신원별 Traditional과 Client/AJAX rendered-browser capture를 분리한다. → 검증: stage별 sourceDetail fixture와 JSON count.
3. 레인 진행 상태가 `PENDING → TRADITIONAL → CLIENT/AJAX → PASSIVE → ALERTS_READY/FAILED`로 보인다. → 검증: Web 카드 계약과 기존 캠페인 failure/completion 회귀.
4. zero-capture, exact scope, fresh session, account credential replacement, Active Scan 별도 승인은 그대로 유지한다.

**해당 버전 종료 당시 상태:** 구현, 206개 자동 회귀 완료. 실제 ZAP 2.17 + Burp Community beta.14에서 raw Traditional count는 확인했지만 Client 내부 browser 실패가 status 100으로 숨고 rendered capture가 0인 결함을 발견해 beta.15가 완료 gate를 보강했다. USER A/B 세션 주입과 late-response 경계는 남아 있었다.

## 0. beta.13 우선순위: HUMAN 실행 정합성과 범용 구조 프로파일링

1. HUMAN `pass 완료`는 record 수가 아니라 exact exploration run 종료로만 판정한다. → 검증: idle/begin/end/rebegin의 `completed=false/false/true/false`.
2. HUMAN 실행 상태를 scanner/LLM과 같은 주기로 갱신한다. → 검증: Web timer 계약과 실제 로컬 화면의 `진행 중 → pass 완료` 전이.
3. pass 안의 Repeater·Intruder·Target은 run/phase/account를 상속하되 실제 Burp provenance를 유지한다. → 검증: detail/tool 회귀.
4. target별 사전 없이 `*Id` 외 도메인 식별자를 찾되 동일 service·method·path·field 위치의 복수 값으로만 보강한다. → 검증: `customerNo/documentSeq/accountRef` 양성 fixture와 단일 관측·`pageNo/sortKey/apiKey/statusCode` 음성 fixture.
5. 이 구조 파악을 소유권·취약점 확정으로 확대하지 않는다. → 검증: 기존 primary 하나·Cartesian product 금지·전체 인가/분류 회귀 유지.

**해당 버전 종료 당시 상태:** 구현, 204개 자동 회귀, standalone HUMAN 시작·종료 상태 전이 확인 완료. 실제 Burp Browser/Repeater/Intruder provenance와 다양한 블라인드 대상의 semantic field precision/recall 측정은 남아 있었다.

## 0. beta.12 우선순위: 세션 귀속과 HUMAN 그래프 표시 정합성

1. 같은 서비스의 인증 지문 하나를 두 등록 계정에 동시에 귀속하지 않는다. → 검증: 두 번째 binding 거부, 충돌 세션 `SUSPECT`, 신원 조회·주입 제외.
2. 같은 요청자·객체·source의 접근선은 표시에서만 집계한다. → 검증: 한 집계선에 원 CoverageCell 키와 총 관측 수를 유지하고 분석 cell 수는 불변.
3. 집계선을 클릭해 원 operation별 관측·판정·갭·Evidence로 돌아갈 수 있어야 한다. → 검증: Web 계약과 standalone 상호작용.
4. 긴 operation/resource 라벨은 생략하지 않고 줄바꿈·동적 높이로 표시한다. → 검증: 전체 경로 표시와 브라우저 렌더에서 글자 잘림 없음.
5. graph-state 키를 v4로 올려 이전 수동 위치가 새 노드 크기와 접근 lane을 왜곡하지 않게 한다.

beta.11의 source 전체 접근 경로 필터와 아래 원칙은 그대로 유지한다.

1. source 필터가 단순 스타일 토글이 아니라 해당 source의 node와 전체 접근 경로를 함께 재계산한다. → 검증: HUMAN-only 선택에서 SCANNER/LLM 전용 node·edge 0.
2. 실제 메인 비교 Evidence가 0건인 source는 0건과 비활성 상태를 함께 표시한다. → 검증: 빈 SCANNER/LLM 데이터에서 조작 가능한 것처럼 보이지 않음.
3. `identity → resource`와 `resource → operation` 모두 같은 source 색·선형·문자를 사용한다. → 검증: 경로 중간에 출처 없는 중립 접근선이 남지 않음.
4. 응답→요청 값 전달은 메인 접근 그래프에서 제거하고 `흐름 순서`에만 둔다. → 검증: 메인 graph의 flow edge 0, 기존 sequence 데이터 유지.
5. 역할 정책은 그래프에서 임의 순환하지 않고 계정 역할·API 요구 권한의 현재 상태만 요약한다. → 검증: 역할 변경은 계정·세션/API 상세이라는 명시적 문맥에서만 가능.

beta.10의 계정 중심 세션 표현과 로컬 SQLite 저장은 그대로 유지한다.

## 0-A. beta.10 계정·저장 기준

1. 한 테스트 계정을 Cookie·Authorization·subject별 별도 사용자처럼 표시하지 않는다. → 검증: 세 fingerprint가 한 account ID로 projection되고 기본 화면은 계정 카드 하나.
2. broker 상태를 내부 enum이 아닌 `로그인 필요/확인 중/사용 가능/다시 로그인 필요`와 다음 행동으로 설명한다. → 검증: Web 정적 계약과 브라우저 상호작용.
3. 기본 프로젝트 저장을 로컬 SQLite로 전환하되 raw 인증값 금지와 schema v2 검증을 유지한다. → 검증: DB header·관계형 row·round-trip·비밀 문자열 부재.
4. DB를 한 번 저장/열면 변경 revision을 30초 checkpoint로 합쳐 자동 저장하고 JSON을 호환 형식으로 남긴다. → 검증: 저장/로드 회귀와 실제 Burp unload/reload gate.
5. SQLite를 서버 event store로 과장하지 않는다. 현재 메모리 20,000건 상한과 100MiB project 상한은 유지하고, append/event migration은 실제 부하 측정 뒤 결정한다.

beta.9의 HUMAN 경로 묶음 정확도와 아래 원칙은 그대로 유지한다.

1. beta.8의 `identity → resource → operation` UI와 조작을 유지한다. → 검증: 기존 Web 계약과 실제 화면 회귀.
2. raw path와 canonical operation을 분리한다. → 검증: `/orders/101` 원문이 상세에 남고 근거가 있을 때만 `/orders/{id}`로 정렬.
3. template 상태를 `LITERAL/INFERRED/CORROBORATED` 범주형 근거로 노출한다. → 검증: `/status/200` 단일 관측은 literal, UUID·복수 값은 inferred, 응답 ID 일치는 corroborated.
4. 객체 후보와 operation template을 분리한다. → 검증: template 근거가 부족한 단일 객체 요청도 resource와 인가 분석에서 사라지지 않음.
5. 기존 coverage/gap/BOLA/BFLA 산출의 회귀를 막는다. → 검증: 기존 전체 테스트와 신규 route corpus를 함께 통과.

후속 route oracle(OpenAPI 등)과 인증 우회·순서 우회·상태 전이·중복 실행·method 변형·민감 기능·Mass Assignment·과도한 데이터·rate-limit 분석은 이 기본 좌표의 독립 모듈이다. beta.9의 경로 묶음 회귀와 beta.10의 계정 projection·저장 gate를 깨면서 근거 없는 가중치나 취약점 자동 확정 규칙을 추가하지 않는다.

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
11. 관측된 조합의 `UNCROSSED`와 아직 요청하지 않은 route candidate를 섞지 않는다. 전자는 현재 Evidence에서 계산하는 사실이고, 후자는 in-scope 응답이나 Burp Site Map에 정확한 provenance가 있는 탐색 후보다.
12. 후보 우선순위에 임의 숫자 가중치를 먼저 넣지 않는다. 검증된 규격 신호와 provenance를 범주형으로 보존하고, 고정된 라벨 corpus와 블라인드 결과가 생긴 뒤에만 수치 점수의 필요성과 calibration을 판단한다.
13. LLM 버튼 자동화는 공급자 API/OAuth를 내장하지 않는다. 사용자의 로컬 로그인 Codex/Claude CLI를 새 프로세스로 실행하되 Explorer는 비영속·no-resume, Judge는 별도 새 세션·명시적 resume로 분리한다. CLI 0 종료만 완료로 믿지 않고 MCP run 종료와 dataset lock을 서버 상태로 확인한다.

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
- Cytoscape.js/Jackson/SnakeYAML/jsoup/sqlite-jdbc/FlowScope 라이선스와 Apache NOTICE를 JAR에 동봉한다.
- README, architecture, decisions, changelog, agent workspace의 실제 UI 경로와 버전을 맞춘다.
- 성공 기준: fresh `mvn clean verify`, fat JAR manifest/의존/라이선스 검사, 절대경로·비밀·불필요 산출물 검사를 통과한다.

### P4 — 실제 UI·Burp QA

- standalone Web UI를 데스크톱 브라우저에서 1500×900과 좁은 폭으로 확인한다.
- 그래프 필터, 노드 펼치기, Matrix, 시나리오, 계정/세션, Request/Response, sample/reset을 클릭 검증한다.
- Burp Community에서 JAR load/unload, 3개 listener 수집, Proxy history, Repeater handoff, project round trip, MCP 연결을 검증한다.
- 실제 로그인으로 USER A/B를 ACTIVE로 만든 뒤 비로그인→USER A→USER B ZAP fresh-session campaign, 신원별 수집/Alert, LLM account 주입을 검증한다.
- Web 버튼으로 Codex와 Claude 각각 새 Explorer → exact run 종료 → 별도 Judge lock → 같은 Judge 후속 resume를 실행하고, Explorer 대화가 Judge에 재사용되지 않으며 MCP 밖 네트워크 도구가 제공되지 않는지 확인한다.
- 성공 기준: 브라우저 콘솔 오류 0, 잘린 핵심 조작 0, unload 후 포트 해제, 세 source가 실제 포트대로 분리된다.

### P4-H — HUMAN/Burp 그래프 핵심 교정 (SCANNER·LLM 동결)

이 단계는 P5 전에 먼저 끝낸다. 목표는 “요청을 많이 저장함”이 아니라, 실제 사람이 밟은 business operation과 응답에서 발견한 미요청 후보를 섞지 않고 IDA식 그래프에서 추적 가능하게 만드는 것이다.

#### H0. beta.3 기준선과 검증 기록 교정

- beta.3의 `TrafficClassifier.VERSION=2`는 `application/manifest+json`을 일반 `+json` API로 포함했다. 당시 crAPI 익명 스모크의 HUMAN/SCANNER/LLM `INCLUDE`는 모두 `/manifest.json`이므로 business API 탐색 성공으로 인정하지 않는다.
- 8080 HUMAN 스모크는 Burp Browser가 아니라 `curl`을 HUMAN listener에 연결한 전송 확인이었다. `sourceDetail=BROWSER`는 listener profile에서 붙은 provenance이지 실제 브라우저 사용 증명이 아니다.
- beta.3의 `UNCROSSED`는 관측 identity × 관측 operation/resource 중 확정 owner가 있는 미실행 cell만 계산했고 미관측 endpoint inventory는 없었다.
- beta.3 Web snapshot은 추출된 모든 object candidate에 근거 계산 없이 `confidence=1.0`을 넣고 UI는 이를 `신뢰도 100%`로 표시했다. beta.4에서는 H4의 추출 근거 표시로 교체한다.
- 성공 기준: README, 결정 로그, 검증 기록과 개발 계획이 이 경계를 동일하게 말하고, 기존 JAR의 성능을 소급 과장하지 않는다.

#### H1. 분류기 v4 — 규격 신호 기반 결정론 cascade

먼저 일반 목적 라벨 fixture를 작성하고 실패를 재현한 뒤 최소 규칙으로 수정한다. target 이름이나 crAPI path는 규칙에 넣지 않는다.

1. scope, response 존재, source, HUMAN phase 같은 변경 불가능한 discovery gate를 먼저 적용한다.
2. CORS preflight, document/navigation, script/style/image/font, web app manifest, source map, service worker 같은 브라우저 보조 관측은 Evidence를 삭제하지 않고 `DISCOVERY_METADATA` 또는 기존 비분석 class로 분리한다. 이 데이터는 business graph에는 들어가지 않지만 route candidate 추출에는 사용할 수 있다.
3. 명시적 GraphQL/gRPC/protobuf, unsafe business request, Fetch destination `empty`와 API representation의 합치처럼 강한 API 신호만 `INCLUDE`한다.
4. 같은 정규화 operation의 다른 관측에 강한 API Evidence가 있으면 그 교차 관측을 보조 신호로 사용한다. 충돌하거나 보안 관련성이 있으나 용도가 불명확하면 삭제하지 않고 `REVIEW`에 둔다.
5. operation 단위 사용자 override는 유지하되, override 전후 reason과 영향 record 수를 표시한다.

필수 fixture는 실제 browser document, JSON fetch API, `text/plain` API, GraphQL variables, nested/array object ID, multipart, authenticated image API, 일반 image, CSS/JS/font, source map, web manifest, service worker, CORS preflight, 일반 OPTIONS, redirect, 401/403, 응답 없는 요청을 포함한다.

성공 기준:

- web manifest·명확한 정적 자원·진짜 preflight가 business `INCLUDE`가 되는 알려진 회귀가 0이다.
- JSON이 아닌 API와 객체를 다루는 정적 경로가 단순 확장자 때문에 사라지는 알려진 회귀가 0이다.
- 모든 분류 결과에 machine-readable reason이 있고 원 Evidence는 그대로 남는다.
- fixture confusion matrix와 `REVIEW` 작업량을 공개한다. 오탐·미탐 0이나 근거 없는 정밀도 목표값은 주장하지 않는다.

#### H2. Route Candidate Inventory — 관측과 후보를 분리

**현재 상태: beta.37은 기존 공통 코어·source/run 격리·Session Broker·ZAP 안전 기준선·독립 Explorer/Judge·Evidence 판정 경계를 유지하면서 Explorer account 고정, browser 실제 request 단위 write 승인, runtime route replay gate, `GraphObservationFact`, 사이트/API/객체 계층 투영과 객체 family 접기를 추가했다. 실제 beta.37 Burp 3-way 저장·재열기, HTTPS/broker browser 통합, 고카디널리티 그래프 가독성, 20,000건 polling/RSS와 블라인드 target 검증은 대기 중이다.**

새 모델은 최소한 다음을 보존한다.

```text
RouteCandidate {
  service, methodOrUnknown, pathTemplate,
  provenance[{type, evidenceId, source, runId, adapter, applicability, reason}],
  observed, applicability, reviewReason
}
```

후보 입력은 사용자가 허가한 exact scope 안에서 실제로 받은 데이터만 사용한다.

- Burp Montoya `siteMap().requestResponses(filter)`의 in-scope 항목. `hasResponse=false`인 항목은 관측 요청으로 승격하지 않고 `BURP_UNREQUESTED` 후보로만 저장한다.
- 관측 HTML의 `a[href]`, `form[action/method]`, script/embed/manifest link와 같은 명시적 URL 참조. 깨진 HTML과 `<base>`는 HTML5 DOM 규칙으로 처리한다.
- 관측 응답의 same-scope `Location`과 표준 sitemap/robots/web manifest 항목.
- 관측 JavaScript의 `fetch`/XHR/axios/jQuery/sendBeacon 명시적 URL literal. 문자열 조합·동적 계산은 추측하지 않는다.
- 대상 내부에서 실제로 관측된 OpenAPI/Swagger JSON·YAML 문서만 사용한다. 외부 검색, Wayback, 저장소, 사전 정답은 사용하지 않는다.
- 제품명에 종속되지 않은 XML의 명시 URL/method attribute·element만 읽는다. DOCTYPE·외부 entity·외부 DTD/schema는 차단한다.

포맷별 어댑터는 발견만 하고, 공통 코어가 exact scope·지원 scheme·method token·정규화·dedup을 단독 집행한다. URL만 있고 method 근거가 없으면 `GET`으로 꾸미지 않고 `UNKNOWN`으로 둔다. 후보 dedup key는 service + method/unknown + normalized path이고, 각 provenance는 Evidence ID뿐 아니라 source·run·adapter 대응을 유지한다.

성공 기준: 모든 후보를 클릭해 “어느 응답/어느 Site Map 항목에서 나왔는지” 확인할 수 있고, provenance 없는 후보는 0이며, 후보가 coverage·finding·dataset lane 완료를 증가시키지 않는다.

#### H3. 그래프·갭 표현

- 실제 HUMAN 요청은 기존 파랑·실선으로 유지한다.
- 아직 요청하지 않은 후보는 source edge로 위장하지 않고 중립색 빈 노드·점선 테두리로 표시한다. `미요청 후보` 필터에서만 켜고 끌 수 있게 한다.
- `REVIEW`는 분류 보류, `미요청 후보`는 아직 request/response가 없는 공격면 후보이므로 서로 다른 상태와 개수로 표시한다.
- 기존 `UNCROSSED`는 이름과 계산을 유지한다. 별도 `UNOBSERVED_ROUTE`는 candidate inventory 중 observed operation으로 매칭되지 않은 항목만 표시한다.
- candidate를 눌러 Burp Browser로 열거나 Repeater 초안을 만드는 동작은 자동 전송하지 않으며, 사용자가 요청해 실제 response가 들어온 뒤에만 observed로 전환한다.

성공 기준: 한 화면에서 observed/candidate/review를 혼동하지 않고, 빈 후보를 취약점·미탐 확정으로 표현하지 않으며, Request/Response 없는 노드가 인가 verdict를 갖지 않는다.

#### H4. 객체 적용 가능성·가중치 경계

- 전체 identity × 전체 resource의 단순 곱을 만들지 않는다. operation마다 실제 path/query/body/schema Evidence로 접근 가능한 `R(o)`만 연결한다.
- `C_total = Σ |I|·|R(o)|`는 `R(o)`가 Evidence로 확인된 경우에만 연구용 후보 공간으로 계산한다. route 후보만 있고 객체 적용 가능성이 불명확하면 객체 조합을 생성하지 않는다.
- 우선순위 1차판은 임의 숫자 합산이 아니라 설명 가능한 사전식 정렬이다: 명시적 method·object reference·authorization 관련 응답·복수 독립 provenance·state-changing 여부. 각 항목은 원 Evidence를 가리킨다.
- 숫자 가중치는 고정 corpus와 블라인드 benchmark에서 feature별 precision/recall 및 review 비용을 측정하고, 동일 데이터로 규칙을 만들고 성능을 주장하는 누수를 막은 뒤에만 별도 결정한다.

성공 기준: 후보 정렬 이유를 사람이 읽을 수 있고, 검증되지 않은 object cross-product와 임의 confidence 퍼센트가 없다. 현재 object candidate의 고정 `신뢰도 100%`도 제거하고 `PATH_ID/QUERY_ID/BODY_ID/GRAPHQL_VARIABLE/USER_CONFIRMED` 같은 추출 근거로 대체한다.

#### H5. 검증 순서

1. protocol fixture 회귀 → 분류 결과와 candidate truth set 대조.
2. 실제 Burp Browser HUMAN pass → Fetch Metadata가 있는 요청과 없는 요청을 모두 저장해 listener label과 실제 browser 동작을 구분.
3. 일반 local MPA, SPA, GraphQL fixture → route candidate precision/recall, API 분류 confusion matrix, REVIEW 건수·승격률, graph node 감소량을 기록.
4. fresh project save/load → candidate provenance와 override 왕복, raw credential 부재 확인.
5. 위 gate가 끝난 뒤에만 P5 crAPI 블라인드 benchmark를 시작하며 정답은 lock 이후 확인.

중단 조건은 provenance 없는 candidate 생성, protocol fixture 회귀, 후보의 coverage/finding 오염, 실제 Burp Browser에서 재현되지 않는 자동 테스트 통과다. 이 경우 임의 예외를 더하지 않고 원인을 고친다.

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

## 4. 2026-08-26 beta.6 구현 상태

- P4-H H1: classifier v3가 web manifest·source map·service worker를 `DISCOVERY_METADATA/EXCLUDE`로 분리하고, 같은 service·정규화 operation의 강한 API Evidence로만 immutable discovery gate를 통과한 `REVIEW` 형제 관측을 보강한다. manifest·다른 service·응답 없음 회귀와 보조 metadata fixture를 자동 테스트로 고정했다. 공개 confusion matrix와 실제 Burp Browser corpus 평가는 남아 있다.
- P4-H H2: `RouteCandidate`와 공통 discovery pipeline을 추가했다. exact-scope HTML5 DOM, 표준 metadata, 정적 JS call site, OpenAPI/Swagger JSON·YAML, generic XML, 응답 없는 Burp Site Map item을 같은 core gate로 정규화·병합하며 provenance의 source/run/adapter 대응을 저장·복구한다. 문자열 조합과 범위 밖 참조는 후보로 만들지 않는다. 일반 protocol fixture 7종·truth route 18개 회귀는 TP 18/FP 0/FN 0이지만 이는 대상 성능 수치가 아니다. Community의 실제 Site Map 미응답 item과 blind target 결과는 수동 gate다.
- P4-H H2 visibility: provenance별 applicability/reason을 보존하고 Explorer MCP에는 현재 LLM run view만 재계산해 제공한다. pre-lock cross-lane status/ZAP/판정 조회를 차단하고 lock 시 route inventory도 고정한다. 실제 구독 클라이언트와 worker 경합은 수동 gate다.
- P4-H H3: Web graph에 source edge 없는 중립색·점선 테두리 후보와 전용 수량·필터·상세를 추가했다. `REVIEW`, `UNCROSSED`, 미요청 route를 서로 다른 상태로 설명하며 candidate는 coverage·gap·verdict·finding·lane 완료를 바꾸지 않는다. standalone 1280×720·600×800에서 overflow와 console 오류 0을 확인했지만 실제 candidate가 있는 Burp 화면은 수동 확인이 남았다.
- P4-H H4: object의 고정 `신뢰도 100%`를 `PATH_ID/QUERY_ID/BODY_ID/GRAPHQL_VARIABLE/DERIVED/NONE` 근거로 교체했다. route 후보는 적용 가능성 → 명시 method → 객체 template → 상태 변경 → 복수 provenance의 범주형 사전식 순서를 쓰고 이유를 화면에 노출한다. authorization 관련 응답 신호는 미요청 candidate에 아직 연결하지 않으며, 수치 가중치는 benchmark 전까지 도입하지 않는다.
- beta.6 자동 검증: 최종 `mvn clean verify` 수치와 JAR digest는 `beta-validation.md`와 `development-log.md`에 기록한다. 고정 corpus와 fat-JAR parser smoke, MCP run visibility 회귀는 공통 파이프라인·격리·패키징 검증이며 Burp Community 재로드나 blind target 성능을 대신하지 않는다.

- P0~P3: 코드 구현 완료. Web UI 정본화, exact-scope 수집 차단, 구조적 마스킹, memory-only session broker, 통제 LLM 실행, Explorer 서버 격리, dataset lock, 신원별 fresh-session 시스템 ZAP campaign, 서버 검증 LLM verdict를 구현했다.
- P4 브라우저 QA: 기존 beta.3 standalone UI의 1500×900, 900×700, 600×800, 1024×768, 1280×720 검증은 통과했다. 이번 scanner control도 1280×720·600×800에서 비로그인 선택, 가로 overflow 0, 좁은 폭 modal scroll, 신원/target 미선택 버튼 비활성, warning/error 0을 확인했다. Standalone fixture에는 ACTIVE broker 계정이 없어 USER A/B 복수 chip 렌더는 HTML/API 계약까지만 통과했으며, Standalone 검증은 Burp suite tab 검증을 대신하지 않는다.
- P4 Burp Community QA: 당시 beta.3 fat JAR을 Community 2026.7.3에 로드해 suite tab, Web UI 17777, MCP 8787, HUMAN 8080, SCANNER 8081을 실제 기동했다. exact scope `http://127.0.0.1:8888/`에서 HUMAN listener 8080 전송 3건, ZAP 2.17 SYSTEM baseline 8건, MCP LLM Explorer 통제 요청 1건이 각각 HUMAN/SCANNER/LLM으로 분리됐다. 이 HUMAN 전송은 실제 Burp Browser가 아니라 8080을 프록시로 사용한 `curl` 스모크였다. ZAP 8건은 모두 `CONTROLLED/ANONYMOUS`였고 LLM의 범위 밖 FlowScope Web 요청은 거부됐다. `REVIEW`뿐인 HUMAN lane에서는 lock이 거부됐고 classifier v2가 web manifest를 `API/INCLUDE`로 오분류한 `/manifest.json`을 추가한 뒤 12건을 잠갔다. 따라서 이 결과는 포트 분리·lock·scope guard의 wiring 검증이지 HUMAN business API 탐색이나 분류 품질 검증이 아니다. finding·gap 0과 잠금 뒤 Explorer 재시작 거부는 관측 사실 그대로 유지한다.
- beta.6 잔여 수동 gate: 새 JAR의 Burp Community 재로드와 Site Map candidate, 실제 Burp Browser HUMAN pass, 브라우저 `UNVERIFIED→ACTIVE` 실제 로그인, USER A/B broker 주입과 복수 ZAP lane, 구독형 Codex/Claude prompt 전체와 Judge, Repeater handoff, project save/load, extension unload 후 포트 해제를 확인해야 한다. beta.3에서 통과한 packaging·익명 3-source 연결·MCP protocol·가시성 격리·범위 차단을 새 JAR의 실검증으로 소급하지 않는다.
- HUMAN 탐색 경계: HUMAN pass의 시작·종료와 `EXPLORATION` run ID 상태 전이는 8080 `curl` 스모크로 확인했다. 실제 Burp Browser 탐색은 미검증이다. 로그인 캡처 `SESSION_SETUP`, pass 밖 `BASELINE`, 선택 ACTIVE 계정의 exact credential match는 자동 회귀를 통과했으며 실제 로그인 계정으로 재확인해야 한다.
- 분류 경계: `REVIEW`를 Evidence·검토 대기에 보존하면서 메인 graph·3-way gap 입력에서는 보류하고, UI 처분 필터와 수량을 `INCLUDE/REVIEW/EXCLUDE`로 분리했다. 1280×720 standalone의 필터·상세·overflow·console 검증은 통과했고, 실제 Burp 대상에서 REVIEW 승격·숨김 작업량은 beta gate와 blind benchmark에서 측정해야 한다.
- 판정 경계: 거부/HEAD owner 오염, auth 부분문자열 redirect 오탐, owner-only 객체 Evidence를 차단했다. 불충분한 BOLA read 응답은 안전으로 폐기하지 않고 `UNDECIDED/INCONCLUSIVE`에 남긴다. 자동 회귀는 통과했으며 실제 Judge workflow는 beta gate다.
- P5 crAPI 블라인드 벤치마크: 사용자 검토 전까지 보류한다. 정답·공격 절차·라벨을 코드, 프롬프트, 실행 컨텍스트에 넣지 않는다.

## 5. 2026-08-27 beta.7 구현 상태

- Web 빠른 시작에 Codex/Claude 공급자, exact target, ACTIVE 계정, `LLM Explorer 시작`, `Judge 시작`, 취소, `Judge 계속`을 추가했다. LLM 사용자는 버튼만으로 실행할 수 있고 기존 `agent-workspace` 절차는 환경 호환 수동 폴백이다.
- Explorer는 전용 owner-only 임시 작업공간과 새 비영속 프로세스를 사용한다. Codex는 ephemeral·read-only·no-approval·user-config 무시·웹 검색 비활성화·모델 shell MCP token 제외, Claude는 strict 임시 MCP 설정·빈 setting sources·auto-memory 비활성화·제한 도구·no-persistence를 적용한다. FlowScope가 exact LLM run을 먼저 발급하고 모델이 동일 run을 끝내지 않으면 완료 레인을 열지 않고 abort한다.
- Judge는 Explorer와 분리된 새 provider session이다. 잠긴 3-lane dataset을 실제 MCP 상태로 확인해야 성공하며, 완료 뒤 저장한 Codex thread ID 또는 Claude session ID로만 후속 요청을 resume한다. 장기 실행 terminal을 유지하는 구조는 아니다.
- MCP 토큰은 자식 환경에만 전달하고 command line·prompt·project에 포함하지 않는다. 상속된 OpenAI·Anthropic API key는 제거한다. CLI는 shell 없이 regular executable 경로로 실행하고, 임시 workspace와 출력은 각각 안전한 경로 삭제·마스킹/상한을 적용한다. 긴 Codex 출력에서도 시작부 session ID를 보존하고 취소·Burp unload 직후 늦게 생성된 child를 즉시 종료하는 회귀를 추가했다.
- active run 또는 Judge lock 상태에서 Burp UI scope 변경을 거부한다. 같은 source 재탐색 시작 시 과거 완료 표식을 무효화하고 세 레인이 다시 완료될 때까지 Judge UI·서버 lock을 닫아 부분 재실행 오염을 차단했다.
- Claude의 `--no-session-persistence`가 일부 버전에서 metadata를 남길 수 있는 한계는 삭제로 위장하지 않는다. Explorer는 그 ID를 저장·resume하지 않고 UI에서 잔존 가능성을 경고한다.
- 자동 검증은 실행 인자, fresh/no-resume, exact run 종료 실패, 3-lane/lock gate, inactive account 차단, Claude Judge resume, 긴 Codex 출력의 session ID, Web API와 scope 변경 차단을 다룬다. 실제 구독 로그인 상태의 Codex/Claude, Burp MCP 왕복, 대상 요청, Judge 후속 resume는 beta.7 JAR 재로드 후 수동 gate다.

## 6. 2026-08-27 beta.8 HUMAN 핵심 1~5단계 상태

1. **수집 계약:** 마스킹된 textual 요청·응답 전문을 메시지당 기본 1MiB, digest 중복 제거 후 압축 총량 48MiB까지 보존하고 8KiB preview와 분리했다. binary·메시지별/총량 상한 초과 전문은 size+digest+사유만 남긴다. live 20,000건 초과는 dropped count와 불완전 경고로 노출한다.
2. **저장 계약:** project schema v2가 digest별 압축 blob을 한 번 저장하고 record reference를 검증해 복구한다. legacy schema v1은 preview-only 상태 그대로 읽는다. raw session과 provider credential은 계속 저장하지 않는다.
3. **결정론 노이즈 분류:** 로그인 준비는 `AUTH_SESSION/EXCLUDE`, 반복 안정 unknown은 `POLLING/REVIEW`다. Evidence는 삭제하지 않으며 `INCLUDE`만 coverage·gap·인가 판정에 사용한다.
4. **endpoint/object 정규화:** path 외에 query와 중첩 JSON·배열·XML·multipart·GraphQL의 명시 ID를 모두 추출해 근거와 함께 보존한다. 기존 인가 모델은 primary 하나만 사용하고 Evidence 없는 객체 곱을 만들지 않는다.
5. **HUMAN 그래프:** 메인 business graph와 별도로 인증·navigation·polling·background 보조 흐름을 사용자가 켜서 볼 수 있다. 보조 edge는 cell·gap·verdict를 만들지 않고, source 필터는 해당 source 전용 node까지 숨긴다. Evidence 상세는 전문 보존/metadata-only 상태와 누락 경고를 표시한다. 번들 H/S/L 샘플은 실제 실행으로 오인하지 않게 지속 배너를 표시한다.

자동 회귀와 standalone UI까지 통과해야 이 다섯 단계를 완료로 기록한다. 실제 Burp Browser 장시간 수집, 20,000건 부하, project 저장/복구, 다양한 MPA/SPA/GraphQL의 confusion matrix는 다음 수동·블라인드 gate다. 이 gate 전에는 미탐·오탐 0이나 제품 성능 우위를 주장하지 않는다.

## 7. 근거와 계획 해석

- [W3C Fetch Metadata](https://www.w3.org/TR/fetch-metadata/)는 `Sec-Fetch-Dest`가 `empty`, `image`, `document`, `iframe` 등 요청 목적을 전달한다고 정의한다. 분류 신호로 쓰되 헤더 누락 가능성 때문에 단독 절대판정으로 쓰지 않는다.
- [W3C Web App Manifest](https://www.w3.org/TR/appmanifest/)는 `application/manifest+json`과 `.webmanifest`를 웹 앱 manifest로 정의하고 `.json` 확장도 허용한다. 따라서 모든 `+json`을 business API로 보는 현재 규칙은 잘못이다.
- [PortSwigger Site Map 문서](https://portswigger.net/burp/documentation/desktop/tools/target/site-map/getting-started)는 응답에서 URL이 참조됐지만 request-response가 완료되지 않은 항목을 별도 회색 후보로 표시한다. 이는 FlowScope도 observed와 candidate를 분리해야 한다는 직접적인 제품 근거다.
- [Montoya SiteMap API](https://portswigger.github.io/burp-extensions-montoya-api/javadoc/burp/api/montoya/sitemap/SiteMap.html)는 extension이 Site Map item을 조회할 수 있고, `HttpRequestResponse.hasResponse()`로 응답 유무를 구분할 수 있다. 실제 Community 동작 여부는 H2 수동 gate에서 확인한다.
- [Burp HTTP history filtering](https://portswigger.net/burp/documentation/desktop/tools/proxy/http-history/filter-settings)은 filter가 표시만 바꾸고 항목을 삭제하지 않는다고 명시한다. FlowScope의 Evidence 보존과 분석 처분 분리 원칙을 유지한다.
- [OWASP WSTG IDOR](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/04-Testing_for_Insecure_Direct_Object_References)는 object reference 위치를 먼저 매핑하고 서로 다른 사용자 소유 객체로 권한을 검증하도록 한다. 그래서 route 후보와 object applicability를 증거 없이 Cartesian product로 만들지 않는다.
- [OWASP API1:2023 BOLA](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)는 object ID가 path/query/header/body 어디에도 있을 수 있음을 명시한다. 정규화 corpus가 path 숫자만 다뤄서는 안 되는 근거다.

위 문서가 정하는 것은 프로토콜 의미와 Burp가 제공하는 관측면이다. 어떤 feature에 몇 점을 줄지는 표준이 정하지 않으므로, 가중치 보류와 범주형 정렬은 이 근거들에서 내린 설계 판단이다.
