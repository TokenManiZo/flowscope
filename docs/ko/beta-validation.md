# FlowScope 1.2.0-beta.38 사전 벤치마크 검증 기록

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

standalone의 `request lab is unavailable`은 DemoState가 대상 네트워크 전송을 의도적으로 구현하지 않은 정상 경계다. 위 렌더 검증은 layout과 JS 오류 부재만 증명하며 실제 Burp/Montoya 전송 성공을 대신하지 않는다.

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

다음은 beta.3 당시 구현과 자동 회귀는 끝났지만 그 JAR의 실환경에서 끝까지 확인하지 않은 항목이다. 최신 beta.34의 미검증 gate는 이 문서 맨 위와 `HANDOFF.md`를 따른다.

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
