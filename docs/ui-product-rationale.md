# FlowScope UI·제품 설계 근거 및 발표 가이드

> **기준:** FlowScope 1.2.0-beta.3, 2026-08-25 현재. 이 문서는 제품 화면이 답하려는 사용자 질문, 설계 선택과 기각 이유, 발표 시 설명 순서의 정본이다. 실제 구현·검증 상태는 각각 `architecture.md`와 `beta-validation.md`를 따른다.

## 1. 한 문장으로 설명하기

FlowScope는 Burp가 수집한 **사람·ZAP·LLM의 실제 요청을 동일한 신원–객체–API 좌표에 정렬**해, 누가 무엇을 발견하거나 놓쳤는지와 BOLA/IDOR·BFLA 의심 근거를 그래프·매트릭스·원본 Evidence로 함께 보여 주는 Burp Community 확장이다.

화면 전체는 다음 세 질문에 답하도록 설계했다.

1. **누가 어디까지 실제로 갔는가?** — HUMAN/SCANNER/LLM source 비교.
2. **어떤 사용자·객체·기능 조합이 허용되거나 거부됐는가?** — identity/role/owner 인가 비교.
3. **그 판단을 실제 요청·응답으로 확인할 수 있는가?** — Evidence와 통제 재현.

## 2. 왜 일반 Burp 요청 목록만으로 부족한가

Burp Proxy history는 요청을 시간순으로 잘 보여 주지만, 다음 관계를 사용자가 머릿속에서 조립해야 한다.

- 같은 사용자의 재로그인·세션 회전;
- 서로 다른 사용자가 같은 객체를 호출한 결과;
- 사람이 발견했지만 ZAP이나 LLM이 놓친 API;
- 같은 API라도 객체와 역할에 따라 달라지는 인가 결과;
- 응답에서 얻은 식별자가 뒤 요청에 사용된 흐름;
- 후보 판정과 그 근거 Request/Response.

FlowScope는 Burp를 대체하지 않는다. Burp의 실제 트래픽을 `identity → resource → operation` 관계로 재구성하고, 세 탐지 주체의 결과를 같은 좌표에서 비교하는 보조 분석면이다.

## 3. 화면별 설계 근거

| 화면 요소 | 사용자가 묻는 질문 | 이렇게 설계한 이유 | 하지 않는 것 |
|---|---|---|---|
| 관측 범위 | 현재 실제로 본 것은 얼마나 되는가? | 관측된 `신원 × 메서드·엔드포인트 × 객체` 조합과 endpoint/method/object 수만 표시한다. | 알 수 없는 전체 API 수를 분모로 삼은 완료 퍼센트를 만들지 않는다. |
| 수집·분석·기본 숨김·검토 | 분류 때문에 무엇이 분석에서 빠졌는가? | 전체 Evidence 수와 coverage 입력을 나란히 표시해 필터의 영향을 숨기지 않는다. | `기본 숨김`을 삭제나 취약점 없음으로 표현하지 않는다. |
| 소스 필터 | 사람·ZAP·LLM 중 누가 이 경로를 밟았는가? | source를 서로 켜고 끄며 동일 좌표의 중복·고유 발견을 비교한다. HUMAN=파랑·실선·H, SCANNER=빨강·파선·S, LLM=검정·점선·L로 색·선형·문자를 중복 부호화한다. | source를 사용자 역할이나 실행 지시자와 섞거나 색 하나에만 의존하지 않는다. |
| Evidence 표시 | API·정적·navigation·preflight·애매한 관측 중 무엇을 파싱 표에서 볼 것인가? | 서버의 결정론 분류와 이유를 그대로 보여 주고 기본 숨김 class도 다시 펼칠 수 있게 한다. 체크박스는 파싱 결과 표시만 바꾸고, operation 상세의 포함/숨김/자동 판단만 서버 coverage를 재계산하는 reversible override다. | 경로명 하나로 Evidence를 삭제하거나 표시 체크박스가 이미 계산된 graph를 임의로 재판정한다고 주장하지 않는다. |
| 권한 레벨 | 이 신원은 어떤 역할로 테스트됐는가? | 사용자가 확인한 역할을 클릭으로 지정한다. 역할이 있어야 BFLA 정책 비교가 가능하다. | URL/JWT 문자열만 보고 USER/ADMIN을 자동 추정하지 않는다. |
| 사용자 그래프 | 계정별 접근 경로가 어떻게 다른가? | 로그인 세션별 그래프와 전체 overlay를 모두 제공한다. 두 저권한 계정 비교가 BOLA의 기본이다. | ADMIN 계정을 필수로 요구하지 않는다. 역할 비교가 필요한 engagement에서만 선택적으로 쓴다. |
| 동일 사용자로 병합 | 재로그인으로 바뀐 세션이 같은 계정인가? | 서비스 경계 안에서 사용자가 확인한 경우에만 새 fingerprint를 기존 계정과 연결한다. | 회전 토큰을 비슷하다는 이유로 자동 병합하지 않는다. 다른 사용자를 합치면 IDOR 판정이 뒤집힌다. |
| 3-way 갭 | 세 주체가 무엇을 놓쳤거나 다르게 판단했는가? | 미교차·일부만 발견·불일치를 분리하고 클릭하면 해당 위치로 이동한다. | 갭 자체를 취약점으로 확정하지 않는다. |
| 소스 뷰 | 발견 주체의 차이를 보고 싶은가? | 색·선형·H/S/L이 다른 평행 source overlay를 우선한다. 일반 버튼·포커스·선택 상태는 별도 중립 accent를 사용해 source 색으로 오인되지 않게 한다. | 인가 결과와 발견 주체를 한 색에 겹쳐 읽기 어렵게 만들지 않는다. |
| 인가 뷰 | 허용·거부·의심 결과를 보고 싶은가? | 동일 구조에서 verdict 중심으로 표현을 바꾼다. | status code 하나만으로 suspicious를 만들지 않는다. |
| 화면 맞춤 | 현재 그래프를 잃지 않고 전체를 볼 수 있는가? | 현재 표시 노드를 viewport에 맞춘다. | 데이터나 필터 상태를 변경하지 않는다. |
| 노드 위치 잠금 | 사용자가 정리한 위치를 유지할 수 있는가? | 자동 재배치로 비교 맥락이 흔들리지 않게 한다. | 서버 분석 결과를 고정하거나 dataset을 lock하지 않는다. UI 위치 잠금과 Judge dataset lock은 별개다. |
| 노드 접기·그룹 펼치기 | 대규모 그래프가 털뭉치가 되지 않는가? | 필터 후 객체/API를 각각 18개부터 보여 주고 그룹 노드를 눌러 단계적으로 늘린다. | 의미 기반 공격면 클러스터링이나 전체 API 추정을 주장하지 않는다. |
| 배치 초기화 | 이동·확대 후 기본 구조로 돌아갈 수 있는가? | `identity → resource → operation` 열 배치로 복구한다. | Evidence와 사용자 정책을 초기화하지 않는다. |
| 판정 매트릭스 | 같은 조합을 표로 빠르게 비교할 수 있는가? | identity/role × operation × resource cell에 source별 verdict와 갭을 정렬한다. | 그래프만 보고 놓치기 쉬운 조합 차이를 숨기지 않는다. |
| 흐름 순서 | 응답 값이 뒤 요청에 사용됐는가? | 실제로 재사용된 ID/token 값의 시간순 의존성만 연결한다. | 단순히 시간상 앞뒤라는 이유로 관계를 만들지 않는다. |
| 시나리오 | 어떤 BOLA/BFLA 후보를 왜 봐야 하는가? | 규칙 후보, LLM 의견, 서버 검증 verdict, 사람 감사 기록을 같은 Evidence ID에 연결한다. | LLM 문장이나 ZAP alert만으로 취약점을 확정하지 않는다. |
| 파싱 결과 | 어떤 요청이 어떤 좌표와 분류로 정규화됐는가? | source/identity/method/operation/resource/status에 class/disposition/repeat/Evidence ID를 함께 두고 행 선택을 operation 상세로 연결한다. 반복 접기는 표시만 줄이며 모든 Evidence ID는 상세에서 유지한다. | raw 인증정보를 표시하거나 숨긴 행을 저장소에서 삭제하지 않는다. |
| Request/Response 상세 | 판정의 실제 근거가 무엇인가? | 선택 API에서만 마스킹 전문을 지연 로드해 Burp 메시지와 판정을 연결한다. | 2만 건 전문을 polling snapshot마다 보내지 않는다. |
| 계정·세션 | ZAP과 LLM이 어느 테스트 계정으로 실행되는가? | secret-free 계정과 메모리 전용 broker 상태를 분리해 보여 준다. | 비밀번호·raw cookie/token을 프로젝트나 LLM에 전달하지 않는다. |

## 4. 3-way 갭의 정확한 의미

갭은 취약점 개수가 아니라 **다음에 확인할 비교 지점**이다.

### 미교차(UNCROSSED)

이미 관측된 사용자·API·객체 집합 안에서 아직 실행되지 않은 조합이다. 예를 들어 USER A가 `orders:101`을 읽었지만 USER B가 같은 operation/resource를 시도하지 않았다면 교차 확인 후보가 된다. 블랙박스 밖의 미관측 API를 안다고 주장하지 않는다.

### 일부만 발견(PARTIAL_DISCOVERY)

동일 cell을 HUMAN/ZAP/LLM 중 일부 source만 관측했다. 이는 특정 도구의 고유 발견 또는 다른 도구의 탐색 누락을 보여 주지만, 그 자체가 취약점은 아니다.

### 불일치(CONFLICT)

동일 cell에 대해 source별 verdict가 다르다. 세션·입력·시각·서버 상태 차이일 수도 있으므로 Request/Response와 identity/owner/role을 확인해야 한다.

### 정상만

활성 source가 모두 해당 cell을 관측했고 현재 규칙에서 특이한 인가 차이가 없다는 뜻이다. “서비스 전체가 안전하다”는 뜻이 아니다.

## 5. source와 identity/role을 분리한 이유

`source`는 요청을 만든 탐지 주체이고 `identity/role`은 서버가 보게 되는 요청자 권한이다.

```text
ZAP이 USER B 세션으로 요청
source = SCANNER
identity = USER B
role = USER
orchestrator = SYSTEM 또는 HUMAN
```

이 축을 합치면 “ZAP이 발견했다”와 “USER 권한으로 허용됐다”를 구분할 수 없다. FlowScope는 발견 성능 비교와 인가 취약점 판정을 동시에 하기 위해 두 축을 직교시킨다.

## 6. 왜 세션 병합과 역할 지정에 사람이 필요한가

- JWT payload는 서명·issuer·audience가 검증되지 않은 그룹핑 힌트다.
- opaque cookie가 회전했을 때 두 값만 보고 같은 사용자라고 증명할 수 없다.
- cookie 존재만으로 로그인 사용자라고 증명할 수 없다. 계정에 연결되지 않은 fingerprint는 서비스별 `불확실한 신원`으로 표시하고 원 fingerprint는 Evidence와 binding 후보에 남긴다.
- `/admin` 경로나 `role=admin` 문자열은 실제 서버 권한의 증거가 아니다.
- 잘못된 사용자 병합이나 역할 추정은 BOLA/BFLA의 공격자·소유자·정상 대조를 바꾼다.

따라서 사용자는 비밀값을 직접 입력하는 대신, 자신이 만든 테스트 계정의 표시 이름·역할과 로그인 구간만 확인한다. FlowScope는 그 최소 입력을 ZAP/LLM 실행에 재사용한다.

## 7. 왜 LLM을 두 번 사용하는가

### Explorer: 독립적인 세 번째 선수

Explorer가 HUMAN/ZAP 후보를 먼저 보면 독립 비교가 아니라 답을 따라가는 재검사가 된다. 서버가 다른 source의 count, cell, gap, finding, Evidence를 숨기고 Explorer 자신의 통제 요청만 허용한다.

### Judge: 잠긴 세 결과의 종합자

HUMAN/ZAP/LLM exploration이 모두 정상 종료된 뒤 후보와 owner/role oracle을 잠근다. Judge는 겹침·고유 발견·갭·ZAP alert를 읽고 좁은 재현과 정상 대조를 수행한다.

모델은 최종 문장을 작성하지만 서버가 current candidate, 동일 run, `CONTROLLED` Evidence, 반복 재현, 정상 대조를 검사한다. 조건이 부족하면 모델이 확정을 요구해도 `INCONCLUSIVE`다.

## 8. 왜 ZAP 실행 순서를 시스템이 정하는가

LLM이 그때그때 ZAP 기능을 선택하면 같은 입력에서도 결과가 달라지고, passive queue가 남았는데 완료로 처리하거나 SPA 경로를 놓칠 수 있다. 기본 scanner lane은 다음 순서로 고정한다.

```text
Traditional Spider
→ strict-scope Client Spider
→ Client 실패 시 AJAX Spider
→ passive queue가 0이 될 때까지 대기
→ native alerts 수집
```

Active Scan은 상태를 바꿀 수 있고 트래픽이 크므로 기본 baseline에서 분리하며 exact scope와 별도 Burp 승인을 요구한다. “ZAP 기능을 적게 쓴다”가 아니라 안전한 자동 기준선과 고위험 능동 스캔의 승인 경계를 분리한 것이다.

## 9. 발표 시연 순서

1. **문제 제시:** Proxy history만으로 사용자·객체·도구 간 관계를 머릿속에서 맞춰야 한다.
2. **세 lane 제시:** HUMAN, SYSTEM ZAP, 독립 LLM Explorer가 같은 exact scope를 각자 탐색한다.
3. **그래프:** source filter를 하나씩 켜 고유·중복 발견을 보여 준다.
4. **매트릭스와 갭:** 미교차·일부만 발견·불일치를 선택한다.
5. **Evidence:** 선택 cell의 실제 마스킹 Request/Response로 이동한다.
6. **인가 정책:** 계정 역할과 확인된 객체 owner가 판정축이라는 점을 보여 준다.
7. **Dataset Lock:** 세 exploration 완료 전에는 Judge가 볼 수 없음을 보여 준다.
8. **Judge:** 반복 재현과 정상 대조가 부족하면 확정되지 않는 것을 보여 준다.
9. **한계 선언:** 전체 블랙박스 분모, 미관측 API, MFA/WebAuthn, 오탐·미탐 0을 주장하지 않는다.

## 10. 발표 질의응답 핵심

### “왜 커버리지 퍼센트가 없나요?”

블랙박스에서는 전체 endpoint/object 분모를 모르므로 퍼센트가 정확하지 않다. FlowScope는 관측된 조합 수와 세 source의 교집합·차집합만 사실로 표시한다. 벤치마크 정답 집합이 사후에 주어질 때만 연구 평가 지표로 recall을 계산한다.

### “ADMIN 계정이 꼭 필요한가요?”

아니다. BOLA는 보통 서로 다른 두 저권한 계정이 핵심이다. ADMIN은 명시적인 역할 비교가 필요한 BFLA 시나리오에서만 선택적으로 쓴다.

### “LLM이 환각하면 어떻게 하나요?”

일반 LLM assessment는 최종 판정이 아니다. 최종 verdict는 FlowScope가 전송한 exact-scope `CONTROLLED` 요청과 서버가 검증한 반복 재현·정상 대조 묶음에 제한된다. 그래도 오탐·미탐 0은 보장하지 않는다.

### “Burp나 ZAP과 무엇이 다른가요?”

Burp는 수집·수동 검증, ZAP은 자동 탐색·스캔에 강하다. FlowScope의 차별점은 HUMAN/ZAP/LLM의 실제 트래픽을 같은 identity/resource/operation 좌표에 정렬하고, 고유·중복·미교차·판정 충돌과 Evidence를 한 화면에서 비교한다는 점이다.

### “왜 외부 검색과 Wayback을 막나요?”

이번 연구 질문은 외부 OSINT 능력이 아니라 세 탐지 주체가 동일한 대상 관측 조건에서 무엇을 발견하는지 비교하는 것이다. 외부 답안과 문서를 넣으면 LLM lane의 독립성과 벤치마크 의미가 사라진다.

## 11. 발표에서 허용되는 주장과 금지되는 주장

### 말해도 되는 것

- 관측된 세 source 트래픽을 동일 데이터 모델로 정렬한다.
- exact scope, provenance, 실행 신뢰도와 Evidence ID를 보존한다.
- LLM Explorer의 가시성을 서버가 제한하고 세 lane 뒤 dataset을 잠근다.
- 서버 조건을 통과한 재현·대조 Evidence만 최종 verdict에 사용한다.
- 현재 자동 회귀와 standalone UI 검증 결과는 `beta-validation.md`에 기록돼 있다.

### 아직 말하면 안 되는 것

- 모든 endpoint를 찾는다.
- 오탐과 미탐이 없다.
- 기존 도구보다 취약점을 더 잘 찾는 것이 입증됐다.
- beta.3의 Burp/ZAP/Codex/Claude 전체 실행이 통과했다.
- 화면의 0 또는 관측 조합 수가 전체 공격면 대비 완료율이다.

## 12. 2026-08-25 현재 확인된 UI·배포 부채

다음은 설계 의도가 아니라 실제 사용자 검증으로 발견된 미완료 항목이다.

1. **빈 데이터 화면의 정보 과다:** 관측 0건인데 권한·세션 병합·갭·그래프 고급 조작을 모두 노출해 무엇부터 해야 하는지 알기 어렵다. 빈 상태에서는 `scope → 로그인/HUMAN → ZAP → Explorer/Judge` 행동을 우선하고 분석 패널은 데이터가 생긴 뒤 단계적으로 보여 주는 수정이 필요하다.
2. **ADMIN 예시의 오해:** USER A·USER B·ADMIN 문구가 ADMIN 로그인이 기본 요구처럼 보인다. 두 저권한 계정을 기본 예시로 하고 ADMIN은 선택적 역할 비교임을 UI에서 명시해야 한다.
3. **Maven 중간 JAR 혼동:** `target/original-flowscope-1.2.0-beta.3.jar`를 Burp에 추가하면 의존성이 없어 일반적인 `Extension class is not a recognized type` 오류가 난다. 올바른 배포물은 `target/flowscope-1.2.0-beta.3.jar`이며, 공개 빌드는 사용자가 중간 JAR을 선택할 수 없게 산출물 구조를 정리해야 한다.
4. **파싱 결과 Evidence 진입 — 해결:** stable Evidence ID, traffic class/disposition, 반복 수를 추가했고 행 선택을 operation의 페이지형 Evidence 상세로 연결했다. 직접 단일 Evidence만 여는 별도 아이콘은 없지만 감사 추적은 끊기지 않는다.
5. **Codex 신뢰 상태 안내:** 공식 Codex 동작상 project-scoped `.codex/config.toml`은 신뢰된 프로젝트에서만 적용된다. 로컬 Codex CLI 0.147.0에서 `agent-workspace`의 `flowscope` 항목이 실제 발견되는 것을 확인했으며, 사용법에는 프로젝트 신뢰 전제와 `codex mcp get flowscope` 확인 단계를 명시했다. MCP 서버 연결과 Explorer/Judge 전체 실행은 별도 실환경 gate다.

이 부채는 숨기지 않고 개발 기록과 beta gate에 남긴다. 수정 전 발표에서는 “현재 발견되어 보완 중인 beta UX/통합 항목”으로 명시한다.
