# 포트·설정·출처 모델

## 요약

| 포트 | 쓰임 |
|---|---|
| Burp 브라우저가 쓰는 리스너 (보통 `8080`) | 사람이 보낸 요청(HUMAN)으로 기록합니다 |
| `8081` | ZAP이 보낸 요청(SCANNER)으로 기록합니다 |
| `8082` | 예전 방식의 LLM 요청용입니다. 지금 LLM 탐색은 이 포트를 쓰지 않습니다 |
| `17777` | FlowScope 웹 화면 |
| `8089` | ZAP API (Docker 컨테이너) |

- 포트를 바꾸려면 Burp를 실행하는 JVM 옵션에 `-Dflowscope.web.port=17778`처럼 값을 넣고 Burp를 다시 켭니다. 쓸 수 있는 옵션은 아래에 있습니다.
- ZAP API key는 `zap-up`이 `~/.flowscope/zap-api-key`에 만들어 두고 FlowScope가 알아서 읽습니다. 직접 넣을 필요는 없습니다.
- 기록마다 요청을 실제로 보낸 쪽(source)과 그 실행을 시작한 쪽(orchestrator)을 따로 남깁니다. 예를 들어 FlowScope가 돌린 ZAP 스캔은 보낸 쪽이 SCANNER, 시작한 쪽이 SYSTEM입니다.

처음 설치한다면 [README](../../README.md)부터 보세요.

## 자세한 내용

### Provenance 모델

`source`는 대상 요청을 실제로 생성한 주체이고, `orchestrator`는 그 도구 실행을 시작한 주체입니다. 두 값은 독립적입니다.

| 동작 | Source | Detail | Orchestrator |
|---|---|---|---|
| 수동 브라우저 | HUMAN | BROWSER | HUMAN |
| Burp Repeater | HUMAN | BURP_REPEATER | HUMAN |
| 점검자가 시작한 ZAP | SCANNER | ZAP_* | HUMAN |
| 결정론적 ZAP 기준선 | SCANNER | ZAP_* | SYSTEM |
| 새 독립 Codex Explorer | LLM | LLM_EXPLORER | LLM (`CONTROLLED`) |
| 8082 직접 fallback | LLM | 설정된 listener detail | LLM (`UNVERIFIED_RUNTIME`) |

Burp 시작 전에 다음 시스템 속성으로 기본 포트를 바꿀 수 있습니다.

```text
-Dflowscope.ports=8080:human:browser,8081:scanner:other_scanner,8082:llm:llm_explorer
-Dflowscope.web.port=17777
-Dflowscope.payload.maxBytes=1048576
-Dflowscope.payload.memoryBytes=50331648
-Dflowscope.scope=https://api.example.test/v1
-Dflowscope.zap.url=http://127.0.0.1:8089
-Dflowscope.zap.key=<zap-local-api-key>
-Dflowscope.zap.keyFile=/소유자만-읽는/zap-api-key/절대경로
```

ZAP API endpoint는 loopback 주소만 허용합니다. API key 우선순위는 `flowscope.zap.key` → `FLOWSCOPE_ZAP_API_KEY` → `flowscope.zap.keyFile` → 기본 `~/.flowscope/zap-api-key`입니다. 기본 파일은 심볼릭 링크와 group/others 권한을 거부합니다. Java client와 제공 스크립트는 key를 URL query나 프로세스 인자에 넣지 않고 `X-ZAP-API-Key` 헤더로 보냅니다. Docker ZAP API는 기본적으로 loopback, 해석된 `host.docker.internal` 주소와 컨테이너의 default Compose bridge gateway만 exact allowlist로 허용하며 `api.addrs.addr.name=.*`를 사용하지 않습니다. ZAP의 대상 트래픽은 Burp SCANNER listener를 통과하도록 설정해야 합니다. 시스템 캠페인은 run별 capability가 확인된 프록시 요청만 CONTROLLED ZAP 요청 기록으로 받으며 헤더는 대상 전송 전에 제거합니다. capability 누락은 자동으로 허용하지 않고 차단 수를 상태에 남기며 다음 단계 전에 실패시킵니다. Client status `100`만으로 실제 대상 트래픽을 증명하지 않으며, FlowScope는 같은 run의 raw `ZAP_CLIENT_SPIDER` 응답 수집 건수를 확인합니다. 0건이면 성공으로 표시하지 않습니다. `Alert 집계 미완료`는 Passive 정체 시점까지의 snapshot이므로 ZAP이 이후 분석했을 결과 전체를 뜻하지 않습니다.
