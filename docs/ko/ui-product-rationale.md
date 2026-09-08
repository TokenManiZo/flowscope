# FlowScope UI·제품 설계 근거 및 발표 가이드

> **현재 계약: 2026-09-08, D-134 (미출시 beta.45 변경).** 기존 Judge·MCP는 제거된 상태를 유지하고 판정 없는 독립 Codex Explorer를 제공한다. ZAP 계정 lane은 HUMAN Session Broker를 재사용하지 않고 메모리 전용 로그인 계정으로 ZAP Browser Based Authentication과 session auto-detect를 실행한 뒤 명시적인 인증 성공이 있을 때만 strict Client Spider 하나를 실행한다. ZAP 2.17 REST에 없는 verification auto-detect action은 호출하지 않는다. 다운로드 bundle·기능별 환경 점검·Explorer 준비상태 재확인이 현재 설치 동선이며, 현재 조작은 HUMAN·ZAP·Explorer와 Evidence/사람 검토다. H/S/L은 관측 데이터의 source다. 아래 beta별 과거 부채/검증 기록은 당시 상태이지 현행 사용법이 아니다.

## 1. 한 문장으로 설명하기

FlowScope는 Burp가 수집한 **사람·ZAP·LLM의 실제 요청과 대상 산출물에 선언된 API·입력을 같은 좌표에 정렬**해, 진단자가 아직 보지 못한 endpoint·parameter를 먼저 찾고 선택한 API의 BOLA/IDOR·BFLA 근거를 그래프·매트릭스·원 Evidence로 확인하게 하는 Burp Community 확장이다.

화면 전체는 다음 세 질문에 답하도록 설계했다.

1. **어떤 API·입력이 선언됐고 HUMAN/SCANNER/LLM 중 누가 실제로 관측했는가?** — Endpoint·Parameter Surface Delta.
2. **선택한 API에서 어떤 사용자·객체·기능 조합이 허용되거나 거부됐는가?** — identity/role/owner 인가 비교.
3. **그 판단을 실제 요청·응답으로 확인할 수 있는가?** — Evidence와 통제 재현.

새 Explorer는 `IDLE/AUTHENTICATING/RUNNING/COMPLETED/FAILED/CANCELLED`와 시도·응답·Evidence·미해결을 분리한다. LLM 응답 Evidence 0건은 “못 찾음”이나 완료로 바꾸지 않고 실패 원인을 표시한다. 실패 시도는 실제 HTTP Evidence가 아니므로 그래프 노드를 만들지 않는다. Codex가 READY가 아니면 Explorer만 사용할 수 없음을 명시하고 공식 설치 안내와 **다시 확인**을 같은 화면에 둔다. HUMAN·ZAP은 이 실패로 비활성화하지 않는다.

## 2. 왜 일반 Burp 요청 목록만으로 부족한가

Burp Proxy history는 요청을 시간순으로 잘 보여 주지만, 다음 관계를 사용자가 머릿속에서 조립해야 한다.

- 같은 사용자의 재로그인·세션 회전;
- 서로 다른 사용자가 같은 객체를 호출한 결과;
- 사람이 발견했지만 ZAP이나 LLM이 놓친 API;
- 같은 API라도 객체와 역할에 따라 달라지는 인가 결과;
- 응답에서 얻은 식별자가 뒤 요청에 사용된 흐름;
- 후보 판정과 그 근거 Request/Response.

FlowScope는 Burp를 대체하지 않는다. Burp의 실제 트래픽을 `Identity → API → Object` 관계로 재구성하고, 세 탐지 주체의 결과를 같은 좌표에서 비교하는 보조 분석면이다.

## 3. 화면별 설계 근거

| 화면 요소 | 사용자가 묻는 질문 | 이렇게 설계한 이유 | 하지 않는 것 |
|---|---|---|---|
| API·입력 차이 | 내가 아직 확인하지 못한 endpoint와 parameter는 어디인가? 분석기가 산출물을 실제로 읽었는가? | OpenAPI·HTML form·JavaScript AST의 선언과 실제 H/S/L HTTP Evidence를 분리해 endpoint 행과 입력 badge로 정렬한다. source 필터, Evidence/provenance와 산출물별 정상·부분·실패·상한을 함께 연결한다. | 선언 미관측을 취약점·도달 가능·lane 실패로 부르거나, parser 실패를 빈 결과로 숨기거나, 서버 전용 표면까지 안다는 전체 퍼센트를 만들지 않는다. |
| 인가 그래프 | 선택한 API의 신원·객체·source 관계는 무엇인가? | 기존 `Identity → API → Object`와 owner/BOLA/BFLA Evidence를 상세층에 보존해 첫 화면의 고카디널리티 노이즈와 판정 근거 손실을 함께 피한다. | Resource를 코어에서 삭제하거나 모든 객체 인스턴스를 첫 화면에 펼치지 않는다. |
| 빠른 시작 | 지금 바로 무엇을 해야 하는가? | `범위 → HUMAN → ZAP → Evidence 검토` 네 단계 상태를 항상 보이되, 첫 미완료 단계의 설명과 제어만 연다. 사용자가 단계 탭을 누르면 원하는 설정을 확인할 수 있고 `현재 단계로`로 복귀한다. | 여섯 단계 설명과 세 실행기의 모든 입력·버튼을 동시에 펼쳐 사용자가 다음 행동을 찾게 하지 않는다. 수집 건수만으로 단계를 완료 처리하지 않는다. |
| 실행 상태와 gate | 어느 lane이 끝났고 왜 실행할 수 없는가? | completed lane과 `COMPLETED_WITH_WARNINGS`를 텍스트·수치로 함께 표시하고, scope·연결·pending gate는 비활성 button만이 아니라 바로 옆 설명으로 보인다. polling이 바뀌어도 사용자가 고른 target을 다른 target으로 바꾸지 않는다. | 색만으로 완료·경고를 알리거나, scope 밖 target을 조용히 첫 scope target으로 바꿔 다른 대상으로 실행하지 않는다. |
| 관측 범위 | 현재 실제로 본 것은 얼마나 되는가? | 관측된 `신원 × 메서드·엔드포인트 × 객체` 조합과 endpoint/method/object 수만 표시한다. | 알 수 없는 전체 API 수를 분모로 삼은 완료 퍼센트를 만들지 않는다. |
| 수집·메인 비교·기본 숨김·검토 대기 | 분류 때문에 무엇이 메인 비교에서 빠졌는가? | 전체 Evidence와 서로 겹치지 않는 `INCLUDE/EXCLUDE/REVIEW` 수를 나란히 표시해 분류 영향을 숨기지 않는다. | `기본 숨김`이나 `검토 대기`를 삭제·정상·취약점 없음으로 표현하지 않는다. |
| 샘플 데이터 배너 | 지금 보이는 H/S/L이 실제 실행 결과인가? | 고정 `demo.flowscope.test` 합성 record만 있을 때 상단에 “실제 점검 결과 아님·네트워크 요청 0건”을 계속 표시한다. | 샘플 source 수를 HUMAN/ZAP/Codex 실행 또는 성능 검증으로 표현하지 않는다. |
| 소스 필터 | 사람·ZAP·LLM 중 누가 이 경로를 밟았는가? | source마다 메인 Evidence 수를 표시하고 0건 source는 비활성화한다. 체크 변경 시 해당 source의 `identity → API → object` 전체 구간을 다시 계산한다. HUMAN=파랑·실선·H, SCANNER=빨강·파선·S, LLM=검정·점선·L로 색·선형·문자를 중복 부호화한다. | 0건 필터가 동작하는 것처럼 보이게 하거나, 일부 구간만 중립색으로 남겨 다른 source처럼 보이게 하지 않는다. |
| Evidence 표시 | 메인 비교·검토 대기·기본 숨김과 API·인증·navigation·polling 중 무엇을 파싱 표에서 볼 것인가? | 처분과 class를 직교 필터로 제공하고 기본값은 `INCLUDE+REVIEW`다. 체크박스는 표시만 바꾸며, operation 상세의 포함/숨김/자동 판단만 서버 coverage를 재계산하는 reversible override다. | 경로명 하나로 Evidence를 삭제하거나 표시 체크박스가 이미 계산된 graph를 임의로 재판정한다고 주장하지 않는다. |
| 보조 흐름 표시 | 로그인을 포함한 실제 브라우저 흐름은 어디로 갔는가? | `인증·화면·반복 보조 흐름 표시`를 켜면 `AUTH_SESSION/NAVIGATION/POLLING/BACKGROUND`를 중립 보조 edge로 표시한다. 메인 graph 위치 맥락은 보이되 cell·gap·verdict는 바꾸지 않는다. | 보조 요청을 삭제하거나 HUMAN 탐색 성과로 계산하지 않는다. |
| 권한 정책 | BFLA 역할 비교가 현재 가능한가? | 그래프 레일은 계정 역할과 API 요구 권한 개수를 읽기 전용으로 요약한다. 계정 역할은 `계정·세션`, API 요구 권한은 해당 API 상세라는 맥락 있는 위치에서만 수정한다. 요구 권한이 0개면 BFLA 비교 비활성을 명시한다. | 그래프를 보다가 한 번 클릭한 것만으로 역할을 순환 변경하거나 URL/JWT 문자열로 USER/ADMIN을 자동 추정하지 않는다. |
| 사용자 그래프 | 계정별 접근 경로가 어떻게 다른가? | 로그인 세션별 그래프와 전체 overlay를 모두 제공한다. 두 저권한 계정 비교가 BOLA의 기본이다. | ADMIN 계정을 필수로 요구하지 않는다. 역할 비교가 필요한 engagement에서만 선택적으로 쓴다. |
| HUMAN pass 상태 | 지금 사람 기준선이 실제 진행·완료됐는가? | 1초마다 서버 run 상태를 다시 읽고, exact exploration run이 같은 ID로 종료된 경우에만 `pass 완료`를 표시한다. | 과거·현재 수집 건수가 있다는 이유로 완료 처리하지 않는다. |
| HUMAN 도구 provenance | 브라우저 외 Repeater·Intruder 요청도 사람이 한 것으로 보이는가? | source는 HUMAN으로 유지하고 같은 pass의 run·phase·account를 공유하되 detail/tool은 실제 Burp 도구로 보존한다. | 모든 HUMAN 요청을 `BROWSER`로 덮어 실행 경로를 숨기지 않는다. |
| 스캐너 XML/HAR | 이미 ZAP에서 저장한 요청·응답을 다시 쓸 수 있는가? | 스캐너 입력만 `.xml,.har`를 받고 파일 확장자로 Burp XML과 ZAP HAR 어댑터를 분리한다. HAR는 `SCANNER/HAR_IMPORT` Evidence로 표시하고 exact scope 밖 entry는 제외한다. | HAR에 없는 native Alert·fresh session·campaign 완료를 복원했다고 표시하거나 HUMAN/LLM HAR로 source를 임의 변경하지 않는다. |
| 자동 구조 프로파일 | 서비스마다 다른 객체 필드명을 어떻게 다루는가? | 명시 `*Id`는 기존처럼 보존하고, `*No/*Number/*Seq/*Key/*Ref/*Uuid/*Guid/*Vin`은 같은 위치에서 복수 값이 관측될 때만 범주형 근거로 보강한다. | target별 사전, 이름 하나만의 확정, `pageNo/sortKey/apiKey` 객체화를 하지 않는다. |
| 동일 사용자로 병합 | 재로그인으로 바뀐 세션이 같은 계정인가? | 서비스 경계 안에서 사용자가 확인한 경우에만 새 fingerprint를 기존 계정과 연결한다. | 회전 토큰을 비슷하다는 이유로 자동 병합하지 않는다. 다른 사용자를 합치면 IDOR 판정이 뒤집힌다. |
| 3-way 갭 | 세 주체가 무엇을 놓쳤거나 다르게 판단했는가? | 미교차·일부만 발견·불일치를 분리하고 클릭하면 해당 위치로 이동한다. | 갭 자체를 취약점으로 확정하지 않는다. |
| 미요청 route | 응답이나 Site Map에는 있지만 아직 실제 요청하지 않은 경로가 있는가? | source edge 없는 중립색·점선 테두리 노드와 별도 수량·필터로 관측 그래프 옆에 표시하고 provenance의 type·Evidence·source·run·adapter 대응과 범주형 정렬 이유를 연다. | 실제 H/S/L 요청 관측이나 `UNCROSSED`, coverage, verdict, finding으로 계산하지 않는다. |
| 소스 뷰 | 발견 주체의 차이를 보고 싶은가? | 색·선형·H/S/L이 다른 평행 source overlay를 우선한다. 일반 버튼·포커스·선택 상태는 별도 중립 accent를 사용해 source 색으로 오인되지 않게 한다. | 인가 결과와 발견 주체를 한 색에 겹쳐 읽기 어렵게 만들지 않는다. |
| 계층 그래프 | 사이트 전체와 한 객체의 Evidence를 한 화면에 모두 그려야 하는가? | 사이트에서는 Target→API Group, 그룹에서는 Identity→API, API 선택 뒤에만 Identity→API→Object를 표시한다. Object는 family로 먼저 접고 눌렀을 때 인스턴스를 펼친다. | 접기 때문에 원 CoverageCell이나 Evidence를 합치거나 삭제하지 않고, path group을 업무 의미나 취약점으로 해석하지 않는다. |
| 긴 경로 라벨 | API가 중간 생략돼 서로 다른 경로를 구분할 수 없는가? | 원 operation 문자열을 모두 유지하고 노드 안에서 여러 줄로 나누며 내용에 맞춰 높이를 늘린다. | 그래프 공간을 아끼기 위해 경로 중간을 `…`로 지워 핵심 세그먼트를 숨기지 않는다. |
| 경로 묶음 | `/orders/101`과 `/orders/202`는 같은 API인가? | raw path를 유지하면서 operation은 Evidence가 있는 위치만 `{id}`로 묶는다. 상세에 `LITERAL/INFERRED/CORROBORATED`와 이유를 표시한다. | 모든 숫자를 ID로 단정하거나 route declaration 없이 “확정”이라 표시하지 않는다. |
| 인가 뷰 | 허용·거부·의심 결과를 보고 싶은가? | 동일 구조에서 verdict 중심으로 표현을 바꾼다. | status code 하나만으로 suspicious를 만들지 않는다. |
| 화면 맞춤 | 현재 그래프를 잃지 않고 전체를 볼 수 있는가? | 현재 표시 노드를 viewport에 맞춘다. | 데이터나 필터 상태를 변경하지 않는다. |
| 노드 위치 잠금 | 사용자가 정리한 위치를 유지할 수 있는가? | 자동 재배치로 비교 맥락이 흔들리지 않게 한다. | 서버 분석 결과를 고정하거나 dataset을 lock하지 않는다. Judge dataset lock은 제거됐으며 UI 위치 잠금은 유지한다. |
| 노드 접기·그룹 펼치기 | 대규모 그래프가 털뭉치가 되지 않는가? | API는 18개 단위로 늘리고, 객체는 패밀리 노드를 기본으로 두어 선택한 패밀리의 인스턴스만 펼친다. | 의미 기반 공격면 클러스터링이나 전체 API 추정을 주장하지 않는다. |
| 배치 초기화 | 이동·확대 후 기본 구조로 돌아갈 수 있는가? | 현재 계층의 기본 배치로 복구한다. 첫 화면은 `Identity → API`, 사이트 개요와 객체 상세는 각각 독립 viewport를 사용한다. | Evidence와 사용자 정책을 초기화하지 않는다. |
| 판정 매트릭스 | 같은 조합을 표로 빠르게 비교할 수 있는가? | identity/role × operation × resource cell에 source별 verdict와 갭을 정렬한다. | 그래프만 보고 놓치기 쉬운 조합 차이를 숨기지 않는다. |
| 흐름 순서 | 응답 값이 뒤 요청에 사용됐는가? | 실제로 재사용된 ID/token 값의 시간순 의존성만 연결하고 메인 접근 그래프와 분리한다. | 단순히 시간상 앞뒤라는 이유로 관계를 만들거나 접근선 위에 보조 의존선을 겹쳐 출처를 혼동시키지 않는다. |
| 시나리오 | 어떤 BOLA/BFLA 후보를 왜 봐야 하는가? | 현재 규칙 후보와 사람 검토를 Evidence에 연결하고, 과거 LLM 기록은 별도 읽기 전용으로 분리한다. | LLM 문장이나 ZAP alert만으로 취약점을 확정하지 않는다. |
| 파싱 결과 | 어떤 요청이 어떤 좌표와 분류로 정규화됐는가? | source/identity/method/operation/resource/status에 class/disposition/repeat/Evidence ID를 함께 두고 행 선택을 operation 상세로 연결한다. 반복 접기는 표시만 줄이며 모든 Evidence ID는 상세에서 유지한다. | raw 인증정보를 표시하거나 숨긴 행을 저장소에서 삭제하지 않는다. |
| Request/Response 상세 | 판정의 실제 근거가 무엇인가? | 선택 API에서만 마스킹 전문을 지연 로드해 Burp 메시지와 판정을 연결하고, 전문 보존 여부·원 byte 수·SHA-256 또는 binary/메시지별/압축 총량 metadata-only 이유를 표시한다. 수집 통계에는 전문 미보존 메시지 수도 공개한다. | preview 8,192자를 완전한 전문이라고 부르거나 2만 건 전문을 polling snapshot마다 보내지 않는다. |
| 요청 실험실 | 진단자가 값·세션을 바꾸고 응답을 바로 비교할 수 있는가? | 특정 Evidence에서만 전체 화면 편집기를 열고 `원문 그대로/비로그인/등록 계정`을 명시적으로 선택한다. Evidence generation이 늦은 응답을 폐기하고 전송 중 draft를 잠그며, 서버 operation ID 멱등성이 동일 상태 변경을 한 번만 실행한다. 응답을 받지 못한 동일 draft 재시도는 같은 ID를 사용한다. 대상 서비스·exact scope·TLS·redirect 경계는 서버가 강제하고 결과는 HUMAN `VALIDATION`으로 분리한다. 원문은 bounded Burp 메모리와 현재 탭에만 존재하며 10건 화면 이력은 새로고침 시 사라진다. | raw를 프로젝트·MCP·로그·localStorage·멱등 cache에 저장하거나, 반복 검증 요청을 discovery coverage로 부풀리거나, status 하나로 취약점을 확정하지 않는다. |
| 계정·세션 | HUMAN/Request Lab과 ZAP이 각각 어느 테스트 계정으로 실행되는가? | HUMAN/Request Lab은 명시적 로그인 캡처의 Session Broker를, ZAP은 별도 메모리 전용 로그인 계정과 ZAP 인증 결과를 보여 준다. | 두 저장소를 같은 세션으로 오인하거나 비밀번호·raw cookie/token을 프로젝트·snapshot·로그·LLM에 전달하지 않는다. |
| LLM Explorer | LLM이 지금 무엇을 요청했고 어떤 근거를 남겼는가? | 메모리 계정·시작 URL·실행 상태·경과시간·실제 요청/Evidence ID·미해결·실패를 한 화면에 두고 steer·취소를 제공한다. | 모델 문장을 취약점 판정으로 표시하거나 로그인 비밀·raw 세션·도구 인자를 피드에 노출하지 않는다. |

## 4. 3-way 갭의 정확한 의미

갭은 취약점 개수가 아니라 **다음에 확인할 비교 지점**이다.

### 미교차(UNCROSSED)

이미 관측된 사용자·API·객체 집합 안에서 아직 실행되지 않은 조합이다. 예를 들어 USER A가 `orders:101`을 읽었지만 USER B가 같은 operation/resource를 시도하지 않았다면 교차 확인 후보가 된다. 블랙박스 밖의 미관측 API를 안다고 주장하지 않는다.

### 일부만 발견(PARTIAL_DISCOVERY)

동일 cell을 HUMAN·SCANNER·LLM 중 활성 비교 source 일부만 관측했다. Request Lab은 HUMAN의 VALIDATION phase이지 별도 source나 discovery 관측이 아니다. 이는 특정 도구의 고유 발견 또는 다른 도구의 탐색 누락을 보여 주지만, 그 자체가 취약점은 아니다.

### 불일치(CONFLICT)

동일 cell에 대해 source별 verdict가 다르다. 세션·입력·시각·서버 상태 차이일 수도 있으므로 Request/Response와 identity/owner/role을 확인해야 한다.

### 정상만

활성 source가 모두 해당 cell을 관측했고 현재 규칙에서 특이한 인가 차이가 없다는 뜻이다. “서비스 전체가 안전하다”는 뜻이 아니다.

### 미요청 route는 3-way 갭이 아니다

`UNCROSSED`는 이미 관측한 identity·operation·resource 집합 안의 비어 있는 cell이다. 미요청 route는 저장된 same-scope 응답이나 응답 없는 Burp Site Map 항목에 provenance가 있지만 request/response가 아직 없는 후보다. provenance의 source는 “어느 lane의 문서에서 참조를 발견했는가”이지 그 route를 요청했다는 뜻이 아니다. 그래서 전용 수량과 중립 노드로만 표시하고, 실제 응답이 수집되기 전에는 관측 source edge나 인가 판정을 부여하지 않는다.

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

따라서 HUMAN/Request Lab은 사용자가 Burp 브라우저에서 명시적으로 캡처해 `ACTIVE`가 된 메모리 Session Broker만 재사용한다. ZAP 계정 lane은 별도다. 사용자가 target·로그인 URL·ID·비밀번호·역할을 등록하면 자격증명은 현재 Burp 프로세스 메모리에만 두고 ZAP Browser Based Authentication API 호출 시 사용한다. 둘을 한 저장소로 합치면 Burp 브라우저 세션과 ZAP의 Firefox 세션을 같은 것으로 오인하므로 분리한다.

기본 화면의 정보 단위는 fingerprint가 아니라 `AccountProfile`이다. 한 번의 로그인에서 Cookie·Bearer·JWT subject가 함께 관측되어도 `test1` 카드 하나만 보이며 상태와 다음 행동을 한국어로 표시한다. 비가역 fingerprint는 같은 카드의 접힌 **기술 정보**로 들어가고, 계정에 아직 연결되지 않은 기록만 **고급 세션 진단**에서 다룬다. 내부 구현 단서를 세 계정처럼 평면 나열하면 사용자가 실제 principal 수를 오해하므로, 수집은 세밀하게 유지하면서 표현만 계정 중심 projection으로 바꿨다.

캡처 종료 시 자격증명은 있으나 성공 응답이 없으면 계정 카드를 `UNVERIFIED`로 표시한다. 이 상태를 ACTIVE처럼 숨겨 자동 실행하면 로그인 폼·실패 응답에서 우연히 본 Cookie를 실제 계정 세션으로 오인할 수 있다. 반대로 ACTIVE도 서비스 고유 인증 의미를 보편적으로 증명하는 값은 아니므로 역할과 계정 연결은 사용자가 확인한다.

빠른 시작의 HUMAN 계정 선택에는 `ACTIVE` Session Broker 계정만 표시한다. 이 선택은 브라우저 신원을 덮어쓰는 라벨이 아니다. 실제 요청의 자격증명이 선택한 broker 계정과 exact match할 때만 해당 계정으로 기록하고, 불일치는 미확정 상태로 남긴다. ZAP 실행 신원에는 해당 target에 등록한 ZAP 로그인 계정만 표시하며, `ANONYMOUS`는 로그인 계정 역할로 등록할 수 없다.

같은 서비스의 동일 인증 지문이 이미 다른 등록 계정에 연결돼 있으면 새 HUMAN 계정으로 자동 이동하지 않는다. 현재 캡처는 `동일 인증정보 충돌`로 표시하고 HUMAN/Request Lab 주입에서 제외한다. ZAP은 cookie fingerprint로 계정을 추측하지 않는다. 해당 lane에서 ZAP이 명시적으로 `authSuccessful=true`를 반환한 뒤에만 안전한 `laneAccountId`를 SCANNER Evidence 신원으로 사용한다.

## 7. LLM 실행과 과거 기록의 분리

기존 Explorer/Judge 버튼·MCP 설정·후속 Judge 대화는 제거 상태를 유지한다. D-128 Explorer는 별도 `/api/explorer-run`·`/api/explorer-accounts` 계약과 화면으로 제공하며, 옛 API를 다시 쓰거나 성공 stub로 만들지 않는다. app-server dynamic tool은 실제 HTTP 관측만 만들고 판정·assessment를 저장하지 않는다. Evidence 중심 FlowScope MCP는 여전히 별도 미구현 범위다.

LLM source 색·필터와 저장된 Evidence는 호환 분석을 위해 유지한다. React 시나리오의 `과거 LLM 기록 · 읽기 전용`에는 원 시각·Evidence ID·과거 verdict를 표시하되 현재 규칙 후보에 합치지 않는다. 누락된 Evidence를 다른 요청으로 대체하지 않고 `현재 데이터에 없음`으로 표시한다. 날짜는 문자열로 직렬화하고 비밀값은 마스킹한다.

## 8. 왜 ZAP 실행 순서를 시스템이 정하는가

빠른 시작은 캠페인보다 먼저 **로컬 ZAP 연결**을 확인한다. 연결 성공은 loopback API와 key가 맞는다는 뜻일 뿐이며 Desktop인지 Docker인지는 표시하지 않는다. 기존 GUI 점검자는 Desktop 설정을, 재현 가능한 팀 환경이 필요한 사용자는 Docker Quick Start를 같은 카드에서 선택한다. 연결되지 않은 상태에서 캠페인을 눌러 긴 오류를 받는 것보다 실행 버튼을 비활성화하고 원인을 먼저 보여 주는 것이 복구 비용이 낮다. 다만 API 연결 성공을 Burp upstream·필수 add-on·실제 target capture 성공으로 확대 해석하지 않는다.

LLM이 그때그때 ZAP 기능을 선택하면 같은 입력에서도 결과가 달라지고, passive queue가 남았는데 완료로 처리하거나 SPA 경로를 놓칠 수 있다. 기본 scanner lane은 다음 순서로 고정한다.

```text
strict-scope Client Spider
→ Passive queue·현재 task 진행 추적
→ native alerts 수집
```

ZAP API의 Client 상태 `100/COMPLETED`는 브라우저 프로세스가 실제로 범위 안 응답을 만들었다는 충분조건이 아니다. 실제 과거 crAPI 실행에서도 Firefox binary 부재와 status 완료가 동시에 관측됐다. 따라서 FlowScope는 같은 run의 raw `ZAP_CLIENT_SPIDER` 응답 수를 확인하고 0건이면 lane을 실패시킨다. D-132 이후 새 캠페인은 Traditional/AJAX를 실행하거나 fallback하지 않는다. ZAP 공식 문서는 Client Spider를 modern app의 권장 crawler로 설명하지만, 이 선택이 임의 대상에서 Traditional의 모든 정적 링크까지 더 잘 찾는다는 제품 실측은 아니다. 화면은 단일 Client 단계와 그 실제 capture·실패를 보여 주며, 부족한 범위를 다른 crawler 결과로 숨기지 않는다.

현재 FlowScope에는 Active Scan 실행 API·버튼이 없다. D-126에서 MCP 전용 진입점과 adapter를 삭제했다. 별도 승인하면 현재 제품에서 실행할 수 있다고 안내하지 않는다. API 정의 import의 Burp 승인과 HUMAN Request Lab 명시적 전송은 유지하며, 이를 Active Scan과 혼동하지 않는다.

비로그인과 USER A/B를 한 ZAP 세션에서 연속 실행하면 cookie jar와 crawler state가 섞여 “누가 밟았나” 비교 자체가 오염된다. 빠른 시작은 신원을 복수 선택하게 하고, 실행기는 비로그인 → 선택 계정 순서로 각 신원 앞에서 이름 없는 temporary ZAP session과 임시 Context를 만든다. 계정 lane은 Browser Based Authentication으로 로그인하고 명시적 성공 뒤 Client `userName`·`firefox-headless`를 사용한다. FlowScope의 8081 capture는 capability 검증 뒤 ZAP이 만든 Cookie/Authorization을 보존하고, 해당 run의 `laneAccountId`로만 귀속한다. 화면은 신원별 lane card로 로그인 상태·브라우저·현재 단계·전체/Client 수집·Alert·주의·실패 원인을 분리한다. 종료·실패·취소 때 임시 user·Context를 제거하고 정리 확인 실패 시 후속 신원으로 넘어가지 않는다.

beta.38에서는 직렬 실행의 후속 계정이 0건 `PENDING`으로 오래 보이면서 정지로 오인되는 실제 수동 회귀를 계기로 관측 가능성을 보강했다. 캠페인·lane·stage 경과시간과 단계 최대시간, 마지막 ZAP status heartbeat, 마지막 raw capture/status 변화, queue 위치와 “현재 lane 완료 후 시작” 이유를 1초 polling 화면에 표시한다. heartbeat가 정상이어도 새 트래픽이 없을 수 있으므로 이를 실패로 바꾸지 않고 `응답 정상·새 트래픽 없음`으로 구분한다. 반대로 10초 넘게 status 응답이 없거나 deadline을 넘으면 별도 경고 상태를 표시한다. D-132 이후 각 lane은 `세션 / 로그인 / Client / Passive / Alert` 진행선과 Client 수집 건수, Passive 남은 건수·현재 task·Alert 집계 완결성을 표시한다. 별도 실시간 실행 기록에는 서버가 실제로 수행한 단계 시작·queue 감소·Alert 집계·격리 정리만 최신순으로 보여 준다. 반복 poll 전체를 기록하지 않고 실제 변화가 있을 때만 최대 120건을 메모리에 남긴다. Passive가 절대 30분 또는 10분 무진행 경계에 도달하면 현재 결과를 숨기거나 전부 실패로 바꾸지 않고 부분 완료로 표시한다. 다만 미처리 queue를 비운 뒤 current task까지 0임을 확인하지 못하면 후속 신원을 시작하지 않는다.

세션 설정·정의 import는 동기 ZAP API 호출이라 status 응답을 주기적으로 받을 수 없다. 이 구간에 가짜 “ZAP 응답 정상”을 표시하지 않고 worker heartbeat를 별도로 갱신해 `응답 대기/응답 수신`을 구분하며, 화면 age도 `작업 신호`라고 부른다. 또한 SYSTEM run capability가 없는 8081 요청은 조용히 0건으로 끝내지 않고 `출처 검증 차단 N건`과 Replacer/outgoing proxy 확인 문구를 표시한다. 차단 요청을 익명 또는 선택 계정으로 수집하는 대안은 그래프의 신원 provenance를 훼손하므로 제공하지 않는다.

beta.39에서는 사이트 집계가 기본 그래프를 대체한 회귀를 복구했다. 사용자의 첫 질문은 “누가 어떤 API를 밟았는가”이므로 `identity → API`를 기본으로 두고, “사이트에 어떤 API 영역이 있는가”에 답하는 사이트 개요는 선택형으로 두었다. 개요의 H/S/L 숫자는 반복 request 횟수가 아닌 소스별 고유 API 수를 표시하고, 상세 tooltip에 전체 request 수를 남긴다. 사이트·API·객체의 pan/zoom은 별도로 저장해 전환 후 노드가 범위 밖으로 사라지지 않게 한다. 이 변경은 Fact Core나 판정을 바꾸지 않고 표현 계층만 수정한다(D-106).

beta.41에서는 외부 리뷰의 핵심 질문인 “누가 어떤 API·입력을 보았고 아직 무엇이 미관측인가”를 먼저 답하기 위해 Endpoint·Parameter Surface Delta를 기본 작업면으로 바꿨다. beta.42는 JavaScript AST와 산출물별 parser 상태를 추가했고, beta.43은 parser 성공 안에 숨던 call-site 해석 실패를 별도로 드러낸다. 기본 Surface 화면에서는 Surface 요약과 source filter만 보이고, 인가·owner·gap 제어는 해당 상세 화면에서만 보인다. 기존 `identity → API`와 내부 Resource/owner/BOLA·BFLA는 **인가 그래프**에 유지하되 사용자에게는 Resource를 `접근 대상 ID`로 설명한다. 이 변경은 탐색 차이와 판정 기계를 한 화면에 섞지 않는 정보 계층 변경이다(D-113~D-115).

Surface의 H/S/L checkbox는 행을 단순히 숨기는 옵션이 아니다. 선택된 source만 endpoint·parameter 관측 badge, delta 상태, 통계와 상세 Evidence에 반영해 체크 전후 의미가 일관되게 바뀐다. 해제한 source의 Evidence는 저장소에서 삭제되지 않는다.

ZAP 캠페인의 실행 버튼은 시작 후 **검사 취소**로 바뀐다. 취소 클릭 즉시 화면만 종료된 것처럼 숨기지 않고, 서버가 소유 crawler·run capability·context 정리를 수행한 뒤 `CANCELLED` terminal 상태와 정리 실패 경고를 반환한다. 1초 상태 poll 한 번이 실패해도 전체 lane과 실행 이벤트를 `FAILED` 빈 화면으로 덮지 않고 마지막 정상 snapshot을 유지하며 별도 `상태 갱신 실패` 경고를 표시한다. 사용자는 실제 scanner 실패와 UI 통신 실패를 구분할 수 있다. lane 상세에는 `laneAccountId` 자체를 추가 노출하기보다 등록 계정 label을 유지하고, 저장된 provenance는 Evidence 상세·분석 결합에 사용한다.

FlowScope Web URL이 exact scope에 실수로 들어와도 scanner target에서 숨기고 시작 요청을 거부한다. 모든 localhost를 막으면 crAPI 같은 로컬 허가 대상을 점검할 수 없으므로 현재 Web port만 제어면으로 판별한다.

## 9. 발표 시연 순서

1. **문제 제시:** Proxy history만으로 조건부 endpoint·parameter와 source별 미관측을 찾아내고, 다시 사용자·객체 관계까지 머릿속에서 맞춰야 한다.
2. **관측 source 제시:** HUMAN·ZAP·독립 Explorer를 각각 실행하고 실제 H/S/L Evidence를 구분한다. 자동 회귀만 통과한 실환경 동작을 시연 성공처럼 말하지 않는다.
3. **API·입력 차이:** 선언과 실제 Evidence를 endpoint/parameter로 정렬하고 H/S/L badge, provenance와 산출물 파싱 상태를 연다.
4. **인가 그래프:** 선택 API의 identity→API→object만 열어 고카디널리티 노이즈를 피한다.
5. **매트릭스와 갭:** 미교차·일부만 발견·불일치를 선택한다.
6. **Evidence:** 선택 cell의 실제 마스킹 Request/Response로 이동한다.
7. **인가 정책:** 계정 역할과 확인된 객체 owner가 판정축이라는 점을 보여 준다.
8. **Evidence 검토:** 현재 규칙 후보·사람 검토와 과거 LLM 기록을 분리해 확인한다.
9. **한계 선언:** 전체 블랙박스 분모, 동적 번들 전체, 서버 전용 endpoint, 오탐·미탐 0을 주장하지 않는다.

## 10. 발표 질의응답 핵심

### “왜 커버리지 퍼센트가 없나요?”

블랙박스에서는 전체 endpoint/parameter/object 분모를 모르므로 퍼센트가 정확하지 않다. FlowScope는 현재 받은 산출물의 선언과 실제 관측, 세 source의 교집합·차집합만 사실로 표시한다. 런타임에서 숨긴 별도 fixture truth가 있을 때만 연구 평가 지표로 precision/recall을 계산한다.

### “ADMIN 계정이 꼭 필요한가요?”

아니다. BOLA는 보통 서로 다른 두 저권한 계정이 핵심이다. ADMIN은 명시적인 역할 비교가 필요한 BFLA 시나리오에서만 선택적으로 쓴다.

### “LLM이 환각하면 어떻게 하나요?”

Explorer 모델은 endpoint·parameter 관측만 수행하고 판정하지 않는다. 모델 요약은 사실로 승격하지 않고 실제 요청·응답 Evidence만 H/S/L 비교에 들어간다. 과거 LLM 평가·판정은 원 기록으로만 보존한다.

### “Burp나 ZAP과 무엇이 다른가요?”

Burp는 수집·수동 검증, ZAP은 자동 탐색·스캔에 강하다. FlowScope의 비교 기능은 HUMAN·SCANNER·LLM source의 실제 관측과 대상 산출물의 선언을 같은 Endpoint/Parameter 좌표에 정렬하고, 선택 API에서만 Identity/Object 인가 근거와 Evidence를 연결한다는 점이다.

### “새 Explorer에서 외부 정보는 어떻게 다루나요?”

Explorer는 모델 일반 네트워크를 끄고 Java exact-scope dynamic HTTP tool만 제공한다. 대상 응답·번들·문서는 비신뢰 데이터이며 모델 명령으로 취급하지 않는다. 자격증명은 모델이 아니라 메모리 vault가 주입한다. 실제 Burp/외부 corpus gate 전에는 발견률이나 완전성을 주장하지 않는다.

## 11. 발표에서 허용되는 주장과 금지되는 주장

### 말해도 되는 것

- 관측된 세 source 트래픽을 동일 데이터 모델로 정렬한다.
- OpenAPI·HTML form·JavaScript AST call-site에서 직접 확인한 endpoint·parameter 선언과 실제 관측을 분리해 표시한다.
- exact scope, provenance, 실행 신뢰도와 Evidence ID를 보존한다.
- 기존 Judge·MCP 실행 기능을 제거했고, H/S/L 데이터 의미와 사람 검토를 보존한다.
- 현재 규칙 후보와 사람 검토를 원 Evidence에 연결한다. 자동 최종 Judge 판정은 제공하지 않는다.
- 현재 자동 회귀와 standalone UI 검증 결과는 `beta-validation.md`에 기록돼 있다.

### 아직 말하면 안 되는 것

- 모든 endpoint를 찾는다.
- 오탐과 미탐이 없다.
- 기존 도구보다 취약점을 더 잘 찾는 것이 입증됐다.
- beta.7의 Burp/ZAP/Codex/Claude 전체 실행이 통과했다.
- 화면의 0 또는 관측 조합 수가 전체 공격면 대비 완료율이다.
- JavaScript AST call-site 추출이 동적 번들·lazy chunk·서버 전용 endpoint 전체를 복원한다.

## 12. 과거 UI·배포 부채와 수정 기록

아래는 2026-08-26 이후 당시 버전의 기록이다. 이 절의 “현재”·“해결”·테스트 수·CLI 사용법은 현행 지시가 아니다. D-126이 Explorer/Judge·MCP를 폐기했으며 현재 완료·남은 gate는 [HANDOFF](HANDOFF.md)와 [검증 기록](beta-validation.md)의 최신 절을 따른다.

1. **빈 데이터 화면의 정보 과다 — 해결:** 관측 0건이면 분석 패널을 숨기고 `scope → 로그인/HUMAN → ZAP → Explorer/Judge` 네 단계와 빠른 시작·샘플 조작을 먼저 보여 준다. Evidence가 생기면 기존 분석 작업면으로 전환한다.
2. **ADMIN 예시의 오해 — 해결:** 빈 상태에 BOLA는 서로 다른 최소 권한 계정 두 개를 권장하고 ADMIN은 BFLA 역할 비교가 필요할 때만 추가한다는 경계를 명시했다.
3. **Maven 중간 JAR 혼동 — build 해결·beta.43 실로드 대기:** 과거 `target/original-flowscope-1.2.0-beta.3.jar` 오선택으로 `Extension class is not a recognized type` 오류가 발생했다. 현재 package는 중간 파일을 제거하고 공개 JAR 수가 하나가 아니면 실패하므로 선택할 파일은 `target/flowscope-1.2.0-beta.43.jar` 하나다. beta.43도 manifest-first와 streaming manifest 자동 검증을 유지하지만, 현재 Browser·Repeater·초기화·저장/재열기와 신원별 ZAP 안전 캠페인, LLM Explorer/Judge는 별도 Burp 수동 gate다.
4. **파싱 결과 Evidence 진입 — 해결:** stable Evidence ID, traffic class/disposition, 반복 수와 명시적 `상세 보기` 버튼을 제공한다. 버튼은 operation 첫 항목이 아니라 선택한 Evidence ID를 상세의 첫 열린 블록으로 고정하며, Web 재동기화 뒤에도 같은 선택을 유지한다.
5. **구독 CLI 자동 실행 — beta.31 준비 자동화 구현, beta.43 Burp 실환경 gate:** 빠른 시작은 표준 설치 경로의 Codex/Claude 실행 파일과 공식 로그인 상태를 비동기 확인하고 READY provider를 자동 선택한다. 상태는 30초 캐시하되 시작 직전에 재검증하며 수동 경로 입력과 **다시 확인**은 비표준 설치·상태 변경용 fallback이다. 새 Explorer와 별도 Judge, Judge 후속 provider session ID, Codex login-only 임시 home, read/write 도구와 exact-run Evidence gate는 유지한다. 실제 Burp에서 자동 선택→MCP 대상 요청→route frontier→run 종료→동결 dataset 저장·재열기가 끝까지 성공하는지는 beta.43 JAR 재로드 뒤 확인해야 한다. Claude Explorer는 no-persistence flag에도 provider metadata가 남을 가능성이 있어 UI에 경고한다.
6. **ZAP API 정의 입력 — 선택 고급 설정:** 기본 사용자는 대상·신원만 고르면 된다. OpenAPI·GraphQL·Postman·SOAP 정의를 이미 가진 진단자만 `형식 URL` 한 줄 입력을 펼쳐 쓴다. FlowScope는 파일명을 추측하거나 외부 문서를 검색하지 않고 exact-scope URL만 허용하며, import 성공 수와 실패 경고를 lane 카드에 함께 표시한다. 이 입력은 endpoint 발견률을 높일 수 있지만 Active Scan 승인이 아니며 정의가 생성하는 모든 업무 요청의 무해성을 보증하지 않는다.

### beta.18의 가독성·정확성 보정

- **긴 경로:** 글자 수 기준 임의 절단은 서로 다른 endpoint를 같은 라벨처럼 보이게 하므로 전체 operation을 유지하고 `/` 경계에서 줄바꿈한다. 한 segment만 매우 길 때만 그 segment 내부를 제한적으로 나눈다.
- **접근선:** source 색·선형 자체가 1회 관측을 표현하므로 `H×1` 같은 라벨은 숨기고 반복 관측에만 `×N`을 붙인다. 이는 선 교차 지점의 불필요한 텍스트 겹침을 줄이되 Evidence 수를 삭제하지 않는다.
- **좁은 화면:** 900px 이하에서 데스크톱 그래프를 축소·가로 스크롤시키지 않고 동일한 source·identity 필터 결과를 API 목록으로 바꾼다. 목록 항목은 source, 관측 신원, 객체, Evidence 수를 보존하고 같은 상세 패널을 연다.
- **신원 문구:** `관측 신원`은 트래픽 분류 결과이고 `재사용할 등록 계정`은 Session Broker가 ACTIVE로 확인한 자격증명이다. 하나가 보인다고 다른 하나가 존재한다고 추론하지 않으며 요청 실험실에 두 상태를 함께 표시한다.
- **문자 깨짐:** raw byte를 먼저 보존하고 문자셋 디코딩이 손실 없이 성공한 텍스트만 Web 편집한다. 이미 beta.17 String 경로에서 깨진 Evidence는 화면 보정으로 복원할 수 없어 재수집을 요구한다.

해결 표시는 항목별 자동 회귀와 명시된 실측 범위까지의 상태다. 복수 로그인 계정, 실제 구독 클라이언트의 Explorer/Judge 전체 실행, 저장·복구·unload는 계속 beta gate로 남긴다.

## 13. React 셸 전환의 첫 단계

React 작업면은 실제 shadcn/Radix source와 상단 탐색 정보 구조를 사용한다. FlowScope symbol과 `ACCESS ANALYSIS`, `분석 대시보드`·`점검 시작`·`실행 기록`, Scope/HUMAN/ZAP 상태, `점검 계속`을 한 줄의 primary shell에 두고, 여섯 분석 작업면은 overflow strip 밖 Radix portal 메뉴에서 연다. 따라서 데스크톱과 좁은 화면 모두 같은 route 집합에 키보드로 접근하며 emerald active state를 문자 `aria-current`와 함께 제공한다. `base-nova`가 현재 CLI에서 Base UI로 해석되는 출력은 Radix primitive 계약과 맞지 않아 사용하지 않았고, CLI가 생성한 `radix-nova` source를 선택했다.

Vite asset은 상대 경로로 생성한다. 이는 Burp가 `/`와 `/app/`에서 같은 classpath 해시 asset을 제공할 때 root-relative asset 경로가 깨지는 것을 피하기 위한 배포 선택이다. beta.44 통합에서는 React를 `/`의 기본 UI로 전환하고 `/legacy/`를 기존 작업면의 복구·비교 경로로 유지한다. 실제 Request Lab 전송과 Burp runtime 동등성은 별도 실환경 gate 전까지 주장하지 않는다.

## 14. React 대시보드 정보 계층

React 대시보드는 먼저 **현재 route와 exact scope**, 이어서 HUMAN/ZAP 실행 상태와 저장된 LLM 관측·Evidence disposition, 마지막으로 data가 있을 때만 count·source·gap/finding·다음 행동을 배치한다. 수량은 서버가 준 Evidence 분류별 절대값이며 전체 공격면의 completion rate가 아니다. source는 색에 기대지 않고 `H · HUMAN`, `S · ZAP`, `L · LLM` 문자와 관측/대기 상태를 같이 쓴다.

관측 0건에서는 분석 요약을 숨기고 `첫 점검을 시작하세요`, 빠른 시작, 샘플 진입만 남긴다. 샘플 경고는 실제 실행 결과처럼 보이는 것을 막으며, destructive clear는 선택 전 AlertDialog로 멈춘다. 아홉 route는 안전한 hash allowlist이고, primary strip과 portal 분석 메뉴가 Korean navigation label을 유지하므로 좁은 화면에서도 route를 잘라내지 않는다.

상단 상태가 아직 오지 않았거나 terminal failure라면 `0`으로 채운 상태를 보여 주지 않는다. loading/unavailable을 분리하고, 이미 확인한 값의 다음 poll이 실패하면 기존 값을 유지하면서 동기화 오류만 알린다. 긴 scope와 실행 상태는 레이아웃 안에서 줄이되 full escaped 값은 Tooltip 또는 title로 계속 확인할 수 있다.

900px 미만의 첫 화면도 media query 결과를 즉시 따라 Sidebar Sheet 경로를 선택한다. unavailable 상태는 loading보다 우선하므로 두 상반된 상태를 같은 시점에 읽게 하지 않는다.

## 15. React 점검 시작과 실행 상태의 안전 경계

D-125는 ZAP 소유권을 추출했고, D-126은 기존 MCP와 LLM 실행기를 삭제했다. 웹 시작·조회·취소는 독립 `ZapCampaign`을 계속 사용한다. ZAP crawler 순서는 이번 변경에서 바꾸지 않는다.

`점검 시작`은 scope → HUMAN → ZAP → Evidence 검토의 한 단계만 자동 추천한다. 사용자가 다른 탭을 살펴보는 중 polling이 화면을 빼앗지 않도록 수동 선택을 유지하고, `현재 단계로`를 눌렀을 때만 실제 server state의 다음 단계로 돌아간다. 1/4~4/4는 순서이지 완료율이므로 progress percentage로 그리지 않는다.

HUMAN의 `재사용할 등록 계정`은 observed identity와 다르다. React HUMAN 선택지는 현재 target에 대응하고 status가 정확히 `ACTIVE`인 managed session으로 한정하며, 관측 fingerprint나 historical/inactive session, credential material을 제어면에 노출하지 않는다. React ZAP 선택지는 별도 `/api/zap-accounts` 메모리 vault의 target별 계정만 사용한다. ID·비밀번호는 저장·snapshot·응답으로 되돌려 보내지 않고 등록 직후 form에서도 지운다. 실행 중에는 계정 추가·삭제를 막는다.

ZAP 설정에는 기존 기능인 exact-scope OpenAPI·GraphQL·Postman·SOAP 정의 입력과 캠페인 취소를 함께 둔다. 시작 요청은 정의가 있을 때만 `definitions`를 보내고, 취소는 서버의 기존 `action=cancel` 상태 기계를 호출한다. 로그인·정의 import·crawler·Passive·Alert 단계를 진행 상태에서 분리해 “미발견”과 “실행 실패”를 같은 0건으로 보이지 않는다.

실행 상태는 color만으로 정상·경고·실패를 말하지 않는다. `RUNNING`, `COMPLETED`, `COMPLETED_WITH_WARNINGS`, `FAILED`, `CANCELLED`, `NOT_STARTED`, `UNAVAILABLE`와 신원별 lane count를 문자로 남기고, poll이 실패해도 마지막 성공 상태를 0이나 실패로 덮지 않는다. output tail은 plain text의 bounded accordion으로만 보여 주며 HTML로 해석하지 않는다. 현재 ZAP Active Scan 진입점은 없으며 별도 승인만으로 활성화되지 않는다.

새 Explorer 탭·작업 피드는 D-128 계약으로 제공한다. 실행 상태에는 HUMAN·ZAP와 별도로 LLM 인증 준비, 실제 HTTP 시도·응답 Evidence, 미해결·실패·취소를 표시하며 Judge 상태는 만들지 않는다.

## 16. React 계정·세션 화면의 개념 경계

`#accounts`는 등록 계정, 관측 신원, 비가역 fingerprint binding, HUMAN용 메모리 broker managed session을 한 이름으로 합치지 않는다. 등록 계정은 사람이 입력한 label/role/target 정책이고, 관측 신원과 fingerprint는 Evidence에서 얻은 진단 단서이며, binding은 그 둘을 명시적으로 연결한 기록이다. managed session은 로그인 capture 뒤 HUMAN pass·Request Lab에만 재사용된다. ZAP 브라우저 로그인 계정은 점검 시작의 ZAP 영역에서 별도 등록·폐기한다.

따라서 일반 화면은 등록 계정마다 다음 행동과 `ACTIVE`/`CAPTURING`/`UNVERIFIED`/`REVOKED`/`credential-conflict` 상태를 글자로 제시한다. 고급 진단은 complete fingerprint 대신 비민감 관측 세션 label과 observed service만 보여 주며, exact fingerprint는 사용자가 bind/unbind를 명시적으로 실행하는 form에만 남는다. 같은 service target의 등록 계정만 bind 선택지에 넣고 role 변경도 등록 계정 role과 별도로 `관측 신원 역할` accordion에 둔다. 이 분리는 cookie·token·subject 단서를 계정이나 재사용 credential로 오인하는 것을 막는다.

삭제와 identity reset은 초기화되는 범위를 Korean AlertDialog에서 다시 설명한다. bound account는 먼저 unbind하도록 client에서 막되, race로 온 server error는 해당 action에 남긴다. 이 화면의 component tests는 transport만 모사하며 실제 로그인, capture, target traffic, Burp runtime parity를 주장하지 않는다.

## 17. Evidence Sheet와 Request Lab의 원문 경계

Evidence Sheet는 비교 가능한 policy metadata와 exact Evidence selection을 한쪽 작업면에 유지하지만, raw request/response를 일반 Evidence 표나 TanStack Query cache에 넣지 않는다. policy 오류도 Sheet를 닫지 않아 사용자가 무엇을 수정하다 실패했는지 계속 확인할 수 있다.

Request Lab은 고정된 관측 service를 보여 주며 브라우저가 target을 다시 쓰거나 redirect를 따라가지 않는다. raw request/response와 현재 탭의 send history는 dialog instance의 메모리에만 존재하고 close, Evidence/event 교체, dataset revision change, unmount, browser unload에서 즉시 비운다. 진행 중 send는 context generation과 `AbortController`를 함께 사용하므로 이전 context의 늦은 success/error/finally가 response, error, pending 상태나 메모리 원문 owner를 다시 채우지 못한다. `ACCOUNT` 선택은 observed identity가 아니라 같은 service의 `ACTIVE` managed session이라는 별도 조건을 충족해야 하며 credential 자체는 UI에 노출하지 않는다.

Repeater는 검토 가능한 **미전송 초안**을 여는 handoff이다. 이 구분은 사용자가 UI acknowledgement를 실제 HTTP 전송 또는 Burp의 security judgement로 오해하지 않게 한다. 실제 Request Lab 및 Burp 결과는 Component test 범위 밖의 runtime gate에서 검증한다.

## 18. React 공격면 그래프의 투영 경계

`#graph`는 독립 분석기가 아니라 현재 shared snapshot의 표시 투영이다. 주 그래프는 서버가 이미 `INCLUDE`로 처분한 Evidence만 사용하고, REVIEW/EXCLUDE를 숨기거나 재분류하지 않는다. source/identity/view/route/support controls도 presentation-only이므로 coverage, cell, verdict, Evidence 자체를 변경하지 않는다.

선은 source별로 분리해 HUMAN/SCANNER/LLM의 독립 관측을 색·선형·문자로 중복 부호화한다. 같은 identity·resource·source라도 operation이 다른 GET/PATCH 관계는 합치지 않는다. operation/resource/identity 집계 노드는 여러 cell outcome이 섞이면 첫 event verdict를 대표값으로 쓰지 않고 `UNKNOWN`으로 표시하며, 정확한 판정은 edge나 Evidence 좌표에서 확인한다. authz 보기의 색과 text는 server-provided cell/event verdict를 읽기만 하며, UNKNOWN route method나 provenance는 관측 traffic 또는 authorization 결과가 아니다. route 후보는 현재 source 필터에 맞는 provenance가 있을 때만 표시하고 identity를 알 수 없으므로 특정 identity 필터에서는 숨긴다. `미관측 후보`와 provenance/applicability/review reason을 명시해 실제 요청과 섞이지 않게 한다. REVIEW applicability는 공통 amber 의미색을 쓰되 점선 테두리와 REVIEW 문자를 유지해 관측 verdict와 혼동하지 않는다.

좁은 화면은 canvas를 축소한 모방이 아니라 같은 filtered projection의 API 목록을 사용한다. `xl` 미만에서는 toolbar의 `그래프 필터`가 Sheet를 열어 데스크톱 rail과 동일한 source/identity/review/focus/route/support/authz controls를 재사용하므로 화면 폭에 따라 필터 능력이 줄지 않는다. 모든 graph/list 선택은 정확한 Evidence ID 집합과 좌표를 shared Evidence Sheet로 전달하지만, 그 선택과 raw material은 layout preference나 ARIA/title/log에 남기지 않는다. graph preference는 사용자 배치와 viewport/lock만 저장하며 reset도 그 key만 제거한다.

## 19. React 매트릭스와 흐름 순서의 서버 판단 경계

`#matrix`는 서버가 만든 cell을 새 판정으로 압축하지 않는다. 신원별은 원 cell, 역할별은 해당 server role의 구성원별 원 cell을 나란히 보여 준다. 그래서 같은 역할의 ALLOW/DENY 또는 source conflict가 평균이나 단일 role verdict로 가려지지 않는다. operation별 required role, resource owner, null object는 모두 server map의 값만 말하며 gap-only는 행렬을 바꾸는 것이 아니라 현재 보기를 좁힌다. 표는 하나의 bounded 양방향 scroll viewport만 소유하며 corner는 `top/left` 최고 z-index, operation header는 `top`, identity header는 `left`에 고정해 두 축을 함께 스크롤해도 비교 기준을 유지한다.

색 또는 선형 하나가 의미를 독점하지 않도록 HUMAN/SCANNER/LLM는 H/S/L, source 이름, 실선/파선/점선, verdict 문자를 함께 제공한다. 미관측과 놓침, conflict와 gap도 text를 남기며 긴 server reason, identity, resource, operation, endpoint ID, Evidence ID는 bounded ordinary-text detail에서만 명시적으로 펼친다. matrix/sequence 선택은 좌표와 exact action용 `EventRecord`를 함께 Sheet에 전달하되, ID 표시는 structured bounded surface 하나로만 보낸다. generic header/metadata의 중복 ID, assistive name, title, live announcement, preference에는 남기지 않는다.

`#sequence`는 관측된 data dependency의 설명용 보기다. 서버 `flowLinks`가 가리키는 producer·consumer event가 둘 다 있을 때만 그 link를 보이고, identity/source/operation/masked value를 추론하거나 보완하지 않는다. known timestamp는 시간순으로, unknown/equal은 서버 link 순서로 유지하지만 이 순서는 coverage·BOLA/IDOR·authorization verdict에 어떠한 변경도 만들지 않는다. 완전히 같은 link signature만 occurrence ordinal로 구분하므로 unrelated link의 삽입·재정렬은 기존 선택을 바꾸지 않지만, 선택한 occurrence가 사라지면 endpoint가 남아도 detail을 닫는다.

## 20. React 시나리오의 판단과 사람 검토 경계

현재 `snapshot.scenarios`의 규칙 후보를 바로 표시한다. 옛 preview/generation API와 버튼은 제거했으며, 화면 열기가 모델 실행이나 취약점 확정을 유발하지 않는다. `legacyLlm`은 별도 읽기 전용 구역이다.

현재 규칙 후보의 사람 검토는 `UNRESOLVED/CONFIRMED/DISMISSED`와 2,000자 제한 메모를 명시적으로 저장한다. 후보 전환 중 늦게 도착한 저장 응답은 다른 후보에 표시하지 않는다. revision 변경 시 선택·Evidence 상세를 초기화한다. 과거 assessment ID를 새 review 대상으로 허용하지 않으며 저장돼 있던 사람 감사 기록 자체는 프로젝트에서 삭제하지 않는다.

## 21. Reference analysis shell과 검증 경계

모든 route는 status·rail·context·workbench·inspector를 공유한다. desktop은 persistent pane을 쓰고 compact에서는 같은 node를 accessible Sheet로 옮긴다. 닫힌 route button도 current route 이름과 `aria-current`을 먼저 보여 준다. HUMAN solid blue, SCANNER/ZAP dashed red, LLM dotted gray, REVIEW amber는 text와 line style을 병행한다. Graph의 operation은 ENDPOINT, resource는 OBJECT lane에 놓이며 diagonal drag도 lane X를 넘지 않는다. standalone browser pass는 Burp/target/active Request Lab validation을 대체하지 않는다.

## 22. Reference shell 최종 review의 사실성·조작성 경계

상단 상태는 전체 query를 하나의 성공처럼 묶지 않는다. 각 Scope/HUMAN/ZAP/SCANNER 상태은 마지막으로 확인한 서버 data를 먼저 보여 주고, data가 한 번도 없을 때만 `불러오는 중` 또는 `확인 불가`를 표시한다. Scope 문자열과 `SCOPE READY`도 별개다. 이것은 잠깐 비어 보이는 비용을 감수하고서라도 `WAITING`, `0`, exact scope 같은 미확인 값을 만들어 내지 않기 위한 선택이다. 좁은 화면에서는 같은 실제 상태와 project/DB/action을 줄바꿈해 유지한다.

desktop 중앙 영역은 긴 운영 화면의 명시적 scroll owner이고 Graph는 그 영역의 남은 높이를 canvas로 사용한다. Graph zoom은 node의 실제 렌더 폭과 lane 폭에서 안전 상한을 계산한다. 지원 상한에서도 node 전체가 자기 lane 안에 남으며, zoom·fit·resize·lock·preference 변경은 semantic inspector 선택뿐 아니라 Cytoscape의 실제 selected element와 테두리도 유지한다.

Graph inspector는 빈 안내를 사용자가 직접 열 수 있지만 선택하면 자동으로 열리고 닫으면 선택도 정리된다. Evidence inspector와 Request Lab은 현재 snapshot에 실제로 존재하는 event에만 연결된다. snapshot 교체 직후 effect를 기다리는 한 frame 동안에도 이전 ID나 이전 Request Lab fetch가 살아나지 않게 현재 membership을 render에서 동기적으로 확인한다. standalone Chromium은 이 UI 계약을 검증하지만 실제 Burp/target/HUMAN/ZAP 및 Request Lab 전송은 여전히 별도 runtime gate다.
