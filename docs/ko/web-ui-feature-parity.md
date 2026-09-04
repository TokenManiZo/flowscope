# React Web UI 기능 동등성 인벤토리

이 표는 기존 Web UI가 제공하는 동작을 React 전환 전에 고정한 이력과 beta.44 통합 상태를 함께 기록한다. React는 `/`와 `/app/`의 기본 UI이고 legacy는 `/legacy/`에 남아 있다. component/standalone 통과와 실제 Burp runtime 동등성은 분리하며, 런타임 항목은 explicit Burp gate 전에는 완료로 표시하지 않는다.

| ID | Existing capability | Existing action/API | React route | Unit/component test | Java contract test | Browser E2E | Burp gate | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | 빈 온보딩 | legacy empty workspace / `/api/snapshot` | `#dashboard` | `DashboardPage.test.tsx` | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 4) |
| P02 | 샘플 로드 | `POST /api/sample` | `#dashboard` | `DashboardPage.test.tsx` | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 4) |
| P03 | 3-source XML 가져오기 | `POST /api/import-xml` | `#evidence` | `EvidencePage.test.tsx` (file별 encoded name/XML media type, aggregate/error, no live import) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 7; import/Burp gate open) |
| P04 | 트래픽 지우기 | `POST /api/clear` | `#dashboard` | `DashboardPage.test.tsx` | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 4) |
| P05 | 샘플 배너 | legacy sample state / `/api/snapshot` | `#dashboard` | `DashboardPage.test.tsx` | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 4) |
| P06 | 퍼센트 없는 coverage 수량 | `/api/snapshot` | `#dashboard` | `DashboardPage.test.tsx` | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 4) |
| P07 | source 필터 | legacy snapshot source filter | `#evidence` | `EvidencePage.test.tsx` (H/S/L defaults and presentation-only filtering) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 7; Burp gate open) |
| P08 | traffic class/disposition 필터 | legacy snapshot class/disposition filter | `#evidence` | `EvidencePage.test.tsx` (legacy defaults, hidden-not-deleted, unknown preservation) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 7; Burp gate open) |
| P09 | 반복 Evidence 펼치기 | `GET /api/evidence` | `#evidence` | `EvidencePage.test.tsx` (stable cluster representative/expand) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 7; Burp gate open) |
| P10 | identity 필터 | `/api/snapshot` identity projection | PLANNED | PLANNED | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | PLANNED |
| P11 | identity 병합 | `POST /api/identity-merge` | `#accounts` | `AccountsPage.test.tsx` (same-service target, equal-id client gate, exact form) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 6; Burp gate open) |
| P12 | 계정 생성·수정·삭제 | `POST /api/account-save`, `POST /api/account-delete` | `#accounts` | `AccountsPage.test.tsx` (edit preservation, action-local failure, bound deletion gate, confirmation/exact form) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 6; Burp gate open) |
| P13 | identity 역할 | `POST /api/role` | `#accounts` | `AccountsPage.test.tsx` (advanced observed-identity role exact form) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 6; Burp gate open) |
| P14 | 로그인 캡처 시작·종료·취소 | `POST /api/session-capture` | `#accounts` | `AccountsPage.test.tsx` (managed state text, exact begin/end/revoke form, pending gate, snapshot refetch) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 6; Burp gate open) |
| P15 | 세션 bind/unbind | `POST /api/session-bind`, `POST /api/session-unbind` | `#accounts` | `AccountsPage.test.tsx` (service-matched choice, exact bind/unbind forms, complete fingerprint DOM/attribute/storage exclusion) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 6; Burp gate open) |
| P16 | identity 초기화 | `POST /api/identity-reset` | `#accounts` | `AccountsPage.test.tsx` (confirmation and empty form) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 6; Burp gate open) |
| P17 | 4단계 빠른 시작 | legacy setup panels | `#inspection` | `InspectionPage.test.tsx` (automatic/manual stage; polling pin) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 5; Burp gate open) |
| P18 | HUMAN 시작·종료 | `GET/POST /api/human-run` | `#inspection` | `InspectionPage.test.tsx` (exact begin/end forms) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 5; Burp gate open) |
| P19 | ZAP 상태 새로고침 | `GET /api/zap-status` | `#inspection` | `InspectionPage.test.tsx` (disconnected/exact-scope/identity gate) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 5; Burp gate open) |
| P20 | 격리된 anonymous/account ZAP baseline | `GET/POST /api/scanner-run` | `#inspection`, `#runs` | `InspectionPage.test.tsx`, `RunsPage.test.tsx` (202 form, out-of-scope disable, lane state/error retention) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 5; Burp gate open) |
| P21 | LLM Explorer | `POST /api/llm-run` action=start | `#runs` | `RunsPage.test.tsx` (exact 202 form, provider/scope reason, error retention) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 5; Burp gate open) |
| P22 | LLM Judge | `POST /api/llm-run` action=start | `#runs` | `RunsPage.test.tsx` (completed-lane gate/exact 202 form) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 5; Burp gate open) |
| P23 | LLM 취소 | `POST /api/llm-run` action=cancel | `#runs` | `RunsPage.test.tsx` (exact 200 form) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 5; Burp gate open) |
| P24 | Judge 후속 질문 | `POST /api/llm-run` action=followup | `#runs` | `RunsPage.test.tsx` (eligible session/exact 202 form) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 5; Burp gate open) |
| P25 | run 상태 | `GET /api/llm-run`, `GET /api/scanner-run`, snapshot `runExecutions` | `#runs` | `InspectionPage.test.tsx`, `RunsPage.test.tsx` (문자 상태·단계·count/error retention, 가짜 완료율 없음, 실행 실패/응답 분리) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (beta.44 통합; Burp gate open) |
| P26 | graph source/authz 보기 | `/api/snapshot` graph projection | `#graph` | `graphProjection.test.ts`, `CytoscapeGraph.test.tsx` (source/authz text·style, exact selection, lifecycle) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 9; runtime gate open) |
| P27 | graph 페이지·collapse·layout 지속 | legacy graph state | `#graph` | `graphProjection.test.ts`, `graphPreferences.test.ts` (18-item page, expand/collapse, validated v5 layout only) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 9; runtime gate open) |
| P28 | route 후보 | `/api/snapshot` route candidates | `#graph` | `graphProjection.test.ts`, `ResponsiveGraphList.test.tsx` (UNKNOWN candidate distinction, provenance/detail selection) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 9; runtime gate open) |
| P29 | support traffic | `/api/snapshot` support traffic | `#graph` | `graphProjection.test.ts` (presentation-only INCLUDE support toggle) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 9; runtime gate open) |
| P30 | 반응형 graph 목록 | legacy responsive graph list | `#graph` | `ResponsiveGraphList.test.tsx`, `GraphPage.test.tsx`, `GraphPage.lifecycle.test.tsx` (same projection/list semantics; ≤900px real canvas↔list lifecycle) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 9; runtime gate open) |
| P31 | operation 상세 | snapshot exact event + 필요 시 `GET /api/request-lab` | `#evidence` | `EvidencePage.test.tsx` (exact selection, unused bulk payload fetch 없음), `RequestLabDialog.test.tsx` (Sheet detail transport simulation) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (beta.44 통합; runtime gate open) |
| P32 | owner 지정 | `POST /api/owner` | `#evidence` | `RequestLabDialog.test.tsx` (exact URL-encoded form, simulated transport) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 8; runtime gate open) |
| P33 | required role | `POST /api/requirement` | `#evidence` | `RequestLabDialog.test.tsx` (exact URL-encoded form, simulated transport) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 8; runtime gate open) |
| P34 | traffic override | `POST /api/traffic-override` | `#evidence` | `RequestLabDialog.test.tsx` (exact AUTO/INCLUDE/EXCLUDE form, simulated transport) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 8; runtime gate open) |
| P35 | matrix identity/role 모드 | `/api/snapshot` matrix projection | `#matrix` | `MatrixPage.test.tsx` (server cells/role members, H/S/L line classes, matching long Evidence ID bounded across the whole Sheet without header/metadata duplication) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 10; runtime gate open) |
| P36 | gap-only matrix | `/api/snapshot` gap projection | `#matrix` | `MatrixPage.test.tsx` (server gap/missed-source filter, collision-safe keys, selection retention/invalidation) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 10; runtime gate open) |
| P37 | sequence data dependency | `/api/snapshot` sequence projection | `#sequence` | `SequencePage.test.tsx` (valid server-only links, timestamp fallback, duplicate lifecycle, H/S/L line classes, matching long endpoint IDs bounded across the whole Sheet with expand/collapse privacy) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 10; runtime gate open) |
| P38 | scenario 미리보기 | `GET /api/ai-preview` | `#scenarios` | `ScenariosPage.test.tsx` (GET ordering, bounded/escaped complete preview fields/lists, loading/error/retry, late-response and revision reset) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 11; runtime gate open) |
| P39 | scenario 생성 및 deterministic fallback | `POST /api/ai-scenarios` | `#scenarios` | `ScenariosPage.test.tsx` (preview-before-POST gate, envelope-only cards, duplicate gate, empty/error/retry, bounded list, `usedLlm` wording, stale revision reset) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 11; runtime gate open) |
| P40 | human review 및 scenario Evidence 링크 | `POST /api/review`, snapshot exact event selection | `#scenarios` | `ScenariosPage.test.tsx` (exact status/note cap, per-card failure/success isolation, validation/assessment/review separation, exact/missing Evidence selection) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 11; runtime gate open) |
| P41 | Evidence 표 | `GET /api/evidence` | `#evidence` | `EvidencePage.test.tsx` (table, filters, repeat count, safe text) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 7; Burp gate open) |
| P42 | 선택 Evidence 원문 상세 | `GET /api/request-lab?evidenceId=` | `#evidence` | `EvidencePage.test.tsx` (일반 표에서 원문 묶음 선조회 없음), `RequestLabDialog.test.tsx` (선택한 하나의 bounded memory-only draft) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (beta.44 통합; active send gate open) |
| P43 | 정확한 Evidence 선택 | `GET /api/evidence` eventId selection | `#evidence` | `EvidencePage.test.tsx` (duplicate operation exact clicked eventId) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 7; Burp gate open) |
| P44 | Request Lab 열기·전송·이력·정리 | `GET/POST /api/request-lab` | `#evidence` | `RequestLabDialog.test.tsx`, `memoryOnlyRawState.test.ts` (mode/form, exact-service ACTIVE account filtering, cache/storage/log exclusion, 1 MiB guard, ten-result cap, close/unmount/event/revision late-send isolation; simulated transport) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 8 + final review; live Request Lab gate open) |
| P45 | Repeater handoff | `POST /api/replay` | `#evidence` | `RequestLabDialog.test.tsx` (exact form and unsent-draft acknowledgement; simulated transport) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 8; Burp runtime gate open) |
| P46 | 로딩·오류 복구 | legacy fetch/snapshot recovery | `#dashboard` | `DashboardPage.test.tsx` (initial/terminal/background recovery) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 4 review round 1) |
| P47 | 키보드 접근 | legacy interactive controls | closed hash navigation | `DashboardPage.test.tsx`, `AppShell.test.tsx` (900px Sheet/current route) | PLANNED | PLANNED | Task 14 explicit Burp runtime parity gate | COMPONENT PASS (Task 4 review round 1 shell scope) |
| P48 | `/app/` | React compatibility mount | React `/app/` | `FlowScopeWebServerTest` | `FlowScopeWebServerTest` | beta.44 no-cache `/app/` 200 확인 | Task 14 explicit Burp runtime parity gate | BETA.44 STANDALONE PASS (Burp gate open) |
| P49 | `/legacy/` | legacy fallback mount | legacy `/legacy/` asset | `FlowScopeWebServerTest` | `FlowScopeWebServerTest` | beta.44 no-cache legacy 화면·console 확인 | Task 14 explicit Burp runtime parity gate | BETA.44 STANDALONE PASS (Burp gate open) |
| P50 | root cutover | default UI route resolver | React `/` | `DashboardPage.test.tsx`, `ReferenceAppShell.test.tsx` | `FlowScopeWebServerTest` | beta.44 no-cache `/`→`#surface`와 전체 route 전환 확인 | Task 14 explicit Burp runtime parity gate | BETA.44 STANDALONE PASS (Burp gate open) |
| P51 | Endpoint·Parameter Surface Delta와 실행 실패 구분 | snapshot `surface`, `runExecutions` | `#surface` | `SurfacePage.test.tsx` (H/S/L 표시 필터, delta 재계산, provenance·입력 shape·Evidence, parser issue, 전부 실패 실행, 퍼센트 금지) | `FlowScopeWebServerTest`, `SnapshotJsonWriterScaleTest` | beta.44 no-cache Surface 필터와 Graph bounded snapshot 회귀 확인 | actual Burp HUMAN/ZAP/LLM gate | BETA.44 STANDALONE PASS (Burp gate open) |

### Task 2 정적 전송 계약

| 계약 | Java contract test | 상태 |
| --- | --- | --- |
| `/app`는 `308 Location: /app/`, `/`와 `/app/`는 React HTML, `/legacy/`는 legacy HTML | `FlowScopeWebServerTest` | AUTOMATED PASS |
| static은 `GET`/`HEAD`만 허용하고 성공·누락·잘못된 path의 `HEAD`는 GET과 같은 status/header/Content-Length 및 raw socket body 0을 사용 | `FlowScopeWebServerTest` | AUTOMATED PASS |
| encoded slash/backslash, NUL, dot segment, 허용하지 않은 확장자와 누락 resource는 `404` | `ClasspathWebAssetsTest`, `FlowScopeWebServerTest` | AUTOMATED PASS |
| Vite 해시 JS/CSS/font asset은 classpath에서 MIME과 함께 제공하고 capability token은 HTML에만 주입 | `ClasspathWebAssetsTest`, `FlowScopeWebServerTest` | AUTOMATED PASS |
| 연속 non-clean package와 restored-source recovery 뒤 단일 Vite hash만 `target/classes/web/app`과 fat JAR에 남는다 | `npm run verify:incremental-package` three-package Maven/JAR verifier | AUTOMATED PASS |
| `/api/*` authorization/origin/capability gate는 정적 resolver와 분리 | `FlowScopeWebServerTest` | AUTOMATED PASS |

### Task 12 standalone browser harness gate

| Gate | 근거 | 상태 |
| --- | --- | --- |
| standalone Chromium harness | `frontend/playwright.config.ts`, packaged-JAR launcher, exact-origin/active-route guards, Korean UI journeys | IMPLEMENTED |
| frontend static verification | `npm run verify` 21 files / 131 tests, `npm run typecheck`, `npm run build` | AUTOMATED PASS |
| package verification | JDK 21 + Maven 3.9.11 `mvn -B clean verify`, Java 263 / 263, final fat JAR | AUTOMATED PASS |
| packaged Chromium browser E2E | latest JDK 21 fat JAR, fresh ASCII `PWTEST_CACHE_DIR`, `npm run e2e`; 8 / 8 passed in 11.3s. exact-origin·active-route·console/pageerror·external-origin·storage-secret guards 포함 | AUTOMATED PACKAGED CHROMIUM PASS |
| actual Burp runtime parity | explicit Task 14 gate | PENDING |

### Task 7 통합 검증 및 최종 패키지 — 역사 기록, 아래 최종 review gate가 대체함

| Gate | 근거 | 상태 |
| --- | --- | --- |
| stable frontend suite | 역사 기록: 31 files / 177 tests. 이 수치는 Fix Round 1의 178 tests/clean-room Chromium 근거로 먼저 대체됐고, 다시 아래 최종 review의 32 files / 193 tests로 대체됐다. | HISTORICAL — SUPERSEDED |
| frontend type/build | 당시 `npm run typecheck`, `npm run build` PASS. 아래 최종 review에서 새로 실행했다. | HISTORICAL — SUPERSEDED |
| Java/fat-JAR verification | 당시 portable Maven JUnit 264 / 264와 fat-JAR PASS. 아래 최종 review에서 새 source JAR로 다시 실행했다. | HISTORICAL — SUPERSEDED |
| packaged standalone browser QA | 당시 in-app browser 수동 QA PASS. Fix Round 1의 clean-room Chromium과 아래 실제 packaged Playwright 8 / 8이 이 근거를 대체한다. | HISTORICAL — SUPERSEDED |
| packaged Playwright journey | 당시 port/process 충돌과 Playwright `-1073740791` 때문에 PENDING이었던 기록이다. 아래 최종 review는 free loopback port와 fresh ASCII cache에서 전 8개 journey를 실제 실행했다. | HISTORICAL — SUPERSEDED |

### 최종 whole-branch review 수정 gate

| Gate | 근거 | 상태 |
| --- | --- | --- |
| stable frontend suite | `npm test -- --maxWorkers=1`: 32 files / 193 tests, `npm run typecheck` | PASS |
| frontend package inputs | Maven clean 뒤 `npm run notices`, `npm run build`; Vite 2,038 modules, generated NOTICE와 React assets | PASS |
| Java/fat-JAR verification | portable Maven 3.9.11 `-B '-Dskip.npm=true' verify`: JUnit 264 / 264, fat-JAR relocation/release verification | PASS |
| packaged Playwright journey | final JAR을 free loopback port `61349`에서 기동하고 external origin에 `/app/?...`를 포함해 normalization을 검증. fresh ASCII `PWTEST_CACHE_DIR=C:\CodexPwDiag\pw-cache-final-6e276569abcc47b084ad2395dec76571`, Chromium 8 / 8 passed in 14.1s. graph center/bounds zoom·fit·resize·diagonal Y drag와 matrix 양축 sticky retention 포함 | AUTOMATED PACKAGED CHROMIUM PASS |
| actual Burp runtime parity | standalone은 실제 target/Burp/HUMAN/ZAP/LLM/Request Lab active traffic을 실행하지 않음 | PENDING (Task 14) |

### Task 6 Reference 분석 셸 gate

| Gate | 근거 | 상태 |
| --- | --- | --- |
| frame/Sheet unit | shell current-route와 closed compact Sheet coverage | PASS (15 / 15 focused) |
| serial frontend | `npm.cmd test -- --maxWorkers=1`: 36 files / 255 tests | PASS |
| static package | typecheck, notices, Vite 2,040 modules | PASS |
| packaged Chromium | bundled Node Chromium, fresh ASCII `PWTEST_CACHE_DIR=C:\\CodexPwDiag\\pw-cache-reference-shell-green-17`, 8 / 8 passed in 19.2s; exact PID `67892`와 port `56062` cleanup 확인 | AUTOMATED PACKAGED CHROMIUM PASS |
| actual Burp runtime | target traffic, active Request Lab, HUMAN/ZAP/LLM | PENDING |

### Reference shell 최종 review fix gate

| Gate | 근거 | 상태 |
| --- | --- | --- |
| focused TDD | workspace/topbar/graph/Evidence 6 files / 53 tests, Dashboard 1 file / 16 tests | PASS |
| full frontend + Java | Maven 3.9.11 `mvn -B clean verify`: frontend 34 files / 254 tests, typecheck, notices, Vite 2,040 modules, Java 264 / 264, release JAR verifier | PASS |
| desktop scroll + compact status | 1280×720 Accounts route에서 focus 후 keyboard `End`로 마지막 `매핑·트래픽 초기화` 조작에 실제 도달; 900px/600px status/project/DB/action visibility 및 banner horizontal overflow 0 | AUTOMATED PACKAGED CHROMIUM PASS |
| graph geometry + selection | 동적 max zoom에 머문 상태에서 세 lane node bounds 확인; zoom/fit/resize/drag/lock/reset마다 E2E geometry seam의 actual selected element 유지 | AUTOMATED PACKAGED CHROMIUM PASS |
| packaged journey | explicit JDK 24, free loopback port `55407`, fresh ASCII `PWTEST_CACHE_DIR=C:\\CodexPwDiag\\pw-cache-reference-shell-final-fix-20260902-g`; 8 / 8 passed in 21.0s, console/page errors 0, exact PID `51324`와 port cleanup 확인 | PASS |
| delivery JAR | source와 `flowscope-1.2.0-beta.25-ui-final.jar` 모두 16,340,715 bytes, SHA-256 `F00679E620EE00A0FB1C63CCB468AB5F889C3F2FBBA56ACBD5765C99D13000C4` | IDENTICAL |
| actual Burp runtime | 실제 target/Burp/HUMAN/ZAP/LLM 및 active Request Lab traffic | PENDING — standalone 결과로 대체하지 않음 |
