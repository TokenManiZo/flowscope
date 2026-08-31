# FlowScope UI·제품 설계 근거 및 발표 가이드

> **기준:** FlowScope 1.2.0-beta.32, 2026-08-31 현재. 이 문서는 제품 화면이 답하려는 사용자 질문, 설계 선택과 기각 이유, 발표 시 설명 순서의 정본이다. beta.32는 UI를 바꾸지 않고 완료·잠금 백엔드만 강화했다. 실제 구현·검증 상태는 각각 `architecture.md`와 `beta-validation.md`를 따른다.

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
| 빠른 시작 | 지금 바로 무엇을 해야 하는가? | `범위 → HUMAN → ZAP → LLM·Judge` 네 단계 상태를 항상 보이되, 첫 미완료 단계의 설명과 제어만 연다. 사용자가 단계 탭을 누르면 원하는 설정을 확인할 수 있고 `현재 단계로`로 복귀한다. | 여섯 단계 설명과 세 실행기의 모든 입력·버튼을 동시에 펼쳐 사용자가 다음 행동을 찾게 하지 않는다. 수집 건수만으로 단계를 완료 처리하지 않는다. |
| 관측 범위 | 현재 실제로 본 것은 얼마나 되는가? | 관측된 `신원 × 메서드·엔드포인트 × 객체` 조합과 endpoint/method/object 수만 표시한다. | 알 수 없는 전체 API 수를 분모로 삼은 완료 퍼센트를 만들지 않는다. |
| 수집·메인 비교·기본 숨김·검토 대기 | 분류 때문에 무엇이 메인 비교에서 빠졌는가? | 전체 Evidence와 서로 겹치지 않는 `INCLUDE/EXCLUDE/REVIEW` 수를 나란히 표시해 분류 영향을 숨기지 않는다. | `기본 숨김`이나 `검토 대기`를 삭제·정상·취약점 없음으로 표현하지 않는다. |
| 샘플 데이터 배너 | 지금 보이는 H/S/L이 실제 실행 결과인가? | 고정 `demo.flowscope.test` 합성 record만 있을 때 상단에 “실제 점검 결과 아님·네트워크 요청 0건”을 계속 표시한다. | 샘플 source 수를 HUMAN/ZAP/Codex 실행 또는 성능 검증으로 표현하지 않는다. |
| 소스 필터 | 사람·ZAP·LLM 중 누가 이 경로를 밟았는가? | source마다 메인 Evidence 수를 표시하고 0건 source는 비활성화한다. 체크 변경 시 해당 source만 가진 node와 `identity → resource → operation` 전체 구간을 다시 계산한다. HUMAN=파랑·실선·H, SCANNER=빨강·파선·S, LLM=검정·점선·L로 색·선형·문자를 중복 부호화한다. | 0건 필터가 동작하는 것처럼 보이게 하거나, 객체 경유선만 중립색으로 남겨 다른 source처럼 보이게 하지 않는다. |
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
| 미요청 route | 응답이나 Site Map에는 있지만 아직 실제 요청하지 않은 경로가 있는가? | source edge 없는 중립색·점선 테두리 노드와 별도 수량·필터로 관측 그래프 옆에 표시하고 provenance의 type·Evidence·source·run·adapter 대응과 범주형 정렬 이유를 연다. | HUMAN/ZAP/LLM의 관측 요청, `UNCROSSED`, coverage, verdict, finding으로 계산하지 않는다. |
| 소스 뷰 | 발견 주체의 차이를 보고 싶은가? | 색·선형·H/S/L이 다른 평행 source overlay를 우선한다. 일반 버튼·포커스·선택 상태는 별도 중립 accent를 사용해 source 색으로 오인되지 않게 한다. | 인가 결과와 발견 주체를 한 색에 겹쳐 읽기 어렵게 만들지 않는다. |
| 중복 접근선 | 같은 사용자가 같은 객체에서 여러 API를 호출했을 때 왜 선이 겹치는가? | 같은 `요청자·객체·source` 접근선은 하나로 접고 `H/S/L×관측 수`를 표시한다. 선을 누르면 원 operation 목록과 각 판정·갭을 열어 Evidence로 이동한다. | 원 CoverageCell이나 Evidence를 합치거나 삭제하지 않고, 서로 다른 source를 한 선으로 합치지 않는다. |
| 긴 경로 라벨 | API가 중간 생략돼 서로 다른 경로를 구분할 수 없는가? | 원 operation 문자열을 모두 유지하고 노드 안에서 여러 줄로 나누며 내용에 맞춰 높이를 늘린다. | 그래프 공간을 아끼기 위해 경로 중간을 `…`로 지워 핵심 세그먼트를 숨기지 않는다. |
| 경로 묶음 | `/orders/101`과 `/orders/202`는 같은 API인가? | raw path를 유지하면서 operation은 Evidence가 있는 위치만 `{id}`로 묶는다. 상세에 `LITERAL/INFERRED/CORROBORATED`와 이유를 표시한다. | 모든 숫자를 ID로 단정하거나 route declaration 없이 “확정”이라 표시하지 않는다. |
| 인가 뷰 | 허용·거부·의심 결과를 보고 싶은가? | 동일 구조에서 verdict 중심으로 표현을 바꾼다. | status code 하나만으로 suspicious를 만들지 않는다. |
| 화면 맞춤 | 현재 그래프를 잃지 않고 전체를 볼 수 있는가? | 현재 표시 노드를 viewport에 맞춘다. | 데이터나 필터 상태를 변경하지 않는다. |
| 노드 위치 잠금 | 사용자가 정리한 위치를 유지할 수 있는가? | 자동 재배치로 비교 맥락이 흔들리지 않게 한다. | 서버 분석 결과를 고정하거나 dataset을 lock하지 않는다. UI 위치 잠금과 Judge dataset lock은 별개다. |
| 노드 접기·그룹 펼치기 | 대규모 그래프가 털뭉치가 되지 않는가? | 필터 후 객체/API를 각각 18개부터 보여 주고 그룹 노드를 눌러 단계적으로 늘린다. | 의미 기반 공격면 클러스터링이나 전체 API 추정을 주장하지 않는다. |
| 배치 초기화 | 이동·확대 후 기본 구조로 돌아갈 수 있는가? | `identity → resource → operation` 열 배치로 복구한다. | Evidence와 사용자 정책을 초기화하지 않는다. |
| 판정 매트릭스 | 같은 조합을 표로 빠르게 비교할 수 있는가? | identity/role × operation × resource cell에 source별 verdict와 갭을 정렬한다. | 그래프만 보고 놓치기 쉬운 조합 차이를 숨기지 않는다. |
| 흐름 순서 | 응답 값이 뒤 요청에 사용됐는가? | 실제로 재사용된 ID/token 값의 시간순 의존성만 연결하고 메인 접근 그래프와 분리한다. | 단순히 시간상 앞뒤라는 이유로 관계를 만들거나 접근선 위에 보조 의존선을 겹쳐 출처를 혼동시키지 않는다. |
| 시나리오 | 어떤 BOLA/BFLA 후보를 왜 봐야 하는가? | 규칙 후보, LLM 의견, 서버 검증 verdict, 사람 감사 기록을 같은 Evidence ID에 연결한다. | LLM 문장이나 ZAP alert만으로 취약점을 확정하지 않는다. |
| 파싱 결과 | 어떤 요청이 어떤 좌표와 분류로 정규화됐는가? | source/identity/method/operation/resource/status에 class/disposition/repeat/Evidence ID를 함께 두고 행 선택을 operation 상세로 연결한다. 반복 접기는 표시만 줄이며 모든 Evidence ID는 상세에서 유지한다. | raw 인증정보를 표시하거나 숨긴 행을 저장소에서 삭제하지 않는다. |
| Request/Response 상세 | 판정의 실제 근거가 무엇인가? | 선택 API에서만 마스킹 전문을 지연 로드해 Burp 메시지와 판정을 연결하고, 전문 보존 여부·원 byte 수·SHA-256 또는 binary/메시지별/압축 총량 metadata-only 이유를 표시한다. 수집 통계에는 전문 미보존 메시지 수도 공개한다. | preview 8KiB를 완전한 전문이라고 부르거나 2만 건 전문을 polling snapshot마다 보내지 않는다. |
| 요청 실험실 | 진단자가 값·세션을 바꾸고 응답을 바로 비교할 수 있는가? | 특정 Evidence에서만 전체 화면 편집기를 열고 `원문 그대로/비로그인/등록 계정`을 명시적으로 선택한다. 대상 서비스·exact scope·TLS·redirect 경계는 서버가 강제하고 결과는 HUMAN `VALIDATION`으로 분리한다. 원문은 bounded Burp 메모리와 현재 탭에만 존재하며 10건 화면 이력은 새로고침 시 사라진다. | raw를 프로젝트·MCP·로그·localStorage에 저장하거나, 반복 검증 요청을 discovery coverage로 부풀리거나, status 하나로 취약점을 확정하지 않는다. |
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

따라서 사용자는 비밀값을 직접 입력하는 대신, 자신이 만든 테스트 계정의 표시 이름·역할과 로그인 구간만 확인한다. FlowScope는 그 최소 입력을 ZAP/LLM 실행에 재사용한다.

기본 화면의 정보 단위는 fingerprint가 아니라 `AccountProfile`이다. 한 번의 로그인에서 Cookie·Bearer·JWT subject가 함께 관측되어도 `test1` 카드 하나만 보이며 상태와 다음 행동을 한국어로 표시한다. 비가역 fingerprint는 같은 카드의 접힌 **기술 정보**로 들어가고, 계정에 아직 연결되지 않은 기록만 **고급 세션 진단**에서 다룬다. 내부 구현 단서를 세 계정처럼 평면 나열하면 사용자가 실제 principal 수를 오해하므로, 수집은 세밀하게 유지하면서 표현만 계정 중심 projection으로 바꿨다.

캡처 종료 시 자격증명은 있으나 성공 응답이 없으면 계정 카드를 `UNVERIFIED`로 표시한다. 이 상태를 ACTIVE처럼 숨겨 자동 실행하면 로그인 폼·실패 응답에서 우연히 본 Cookie를 실제 계정 세션으로 오인할 수 있다. 반대로 ACTIVE도 서비스 고유 인증 의미를 보편적으로 증명하는 값은 아니므로 역할과 계정 연결은 사용자가 확인한다.

빠른 시작의 HUMAN 계정 선택에는 `ACTIVE` 계정만 표시한다. 이 선택은 브라우저 신원을 덮어쓰는 라벨이 아니다. 실제 요청의 자격증명이 선택한 broker 계정과 exact match할 때만 해당 계정으로 기록하고, 불일치는 미확정 상태로 남긴다. 사용자가 dropdown 하나를 잘못 선택해 USER A/B 비교 Evidence 전체를 오염시키는 것보다 재로그인 안내가 드러나는 편이 안전하다.

같은 서비스의 동일 인증 지문이 이미 다른 등록 계정에 연결돼 있으면 새 계정으로 자동 이동하지 않는다. 현재 캡처는 `동일 인증정보 충돌`로 표시하고 신원 귀속과 ZAP/LLM 주입에서 제외한다. 사용자가 기존 연결을 해제하거나 잘못 만든 세션을 폐기하고 올바른 계정으로 다시 로그인해야 한다. 계정 카드 중복을 화면에서만 숨기면 실제 binding 오염이 남기 때문에 엔진과 UI를 함께 fail-closed로 처리한다.

## 7. 왜 LLM을 두 번 사용하는가

### Explorer: 독립적인 세 번째 선수

Explorer가 HUMAN/ZAP 후보를 먼저 보면 독립 비교가 아니라 답을 따라가는 재검사가 된다. 서버가 다른 source의 count, cell, gap, finding, Evidence를 숨기고 Explorer 자신의 통제 요청만 허용한다.

빠른 시작의 `LLM Explorer 시작`은 편의를 위해 같은 대화를 재활용하지 않는다. 사용자가 공급자·target·계정을 고르면 FlowScope가 새 임시 작업공간과 비영속 CLI 실행을 만들고 exact scope와 선발급 run을 자동 주입한다. 종료 조건도 문장 출력이 아니라 그 exact run의 정상 종료다. 따라서 “버튼을 눌렀다”나 “CLI가 0으로 끝났다”만으로 LLM lane 완료를 표시하지 않는다.

beta.6부터 미요청 route도 같은 경계를 따른다. Explorer는 자신의 run 응답에서 발견한 provenance만 보며, 병합 후보에 HUMAN 근거가 있어도 observed/applicability/reason을 자기 run 기준으로 다시 계산한다. pre-lock status는 다른 lane의 active run·수량·기존 판정 목록을 공개하지 않고, Explorer가 활성화된 동안에는 ZAP 상태·실행도 차단한다. lock 뒤에는 그 시점의 route inventory만 Judge에게 보여 준다.

### Judge: 잠긴 세 결과의 종합자

HUMAN/ZAP/LLM exploration이 모두 정상 종료된 뒤 후보와 owner/role oracle을 잠근다. Judge는 겹침·고유 발견·갭·ZAP alert를 읽고 좁은 재현과 정상 대조를 수행한다.

모델은 최종 문장을 작성하지만 서버가 current candidate, 동일 run, `CONTROLLED` Evidence, 반복 재현, 정상 대조를 검사한다. 조건이 부족하면 모델이 확정을 요구해도 `INCONCLUSIVE`다.

Judge는 Explorer와 다른 새 provider session으로 시작한다. 완료 뒤 `Judge 계속`은 같은 Judge session ID만 재개하므로 사용자는 판정 근거를 후속 질문할 수 있다. CLI 프로세스를 계속 켜 두지는 않는다. Explorer 세션과 Judge 세션을 섞지 않으며, Claude의 no-persistence metadata 잔존 가능성은 UI에 한계로 표시하고 사용자의 provider 저장소를 임의 삭제하지 않는다.

## 8. 왜 ZAP 실행 순서를 시스템이 정하는가

빠른 시작은 캠페인보다 먼저 **로컬 ZAP 연결**을 확인한다. 연결 성공은 loopback API와 key가 맞는다는 뜻일 뿐이며 Desktop인지 Docker인지는 표시하지 않는다. 기존 GUI 점검자는 Desktop 설정을, 재현 가능한 팀 환경이 필요한 사용자는 Docker Quick Start를 같은 카드에서 선택한다. 연결되지 않은 상태에서 캠페인을 눌러 긴 오류를 받는 것보다 실행 버튼을 비활성화하고 원인을 먼저 보여 주는 것이 복구 비용이 낮다. 다만 API 연결 성공을 Burp upstream·필수 add-on·실제 target capture 성공으로 확대 해석하지 않는다.

LLM이 그때그때 ZAP 기능을 선택하면 같은 입력에서도 결과가 달라지고, passive queue가 남았는데 완료로 처리하거나 SPA 경로를 놓칠 수 있다. 기본 scanner lane은 다음 순서로 고정한다.

```text
Traditional Spider
→ strict-scope Client Spider
→ Client 실패 또는 실제 rendered capture 0건이면 AJAX Spider
→ passive queue가 0이 될 때까지 대기
→ native alerts 수집
```

ZAP API의 Client 상태 `100/COMPLETED`는 브라우저 프로세스가 실제로 트래픽을 만들었다는 충분조건이 아니다. 실제 crAPI 실행에서 Firefox binary 부재로 Client task가 내부 실패했지만 status는 완료가 됐고 FlowScope rendered count는 0이었다. 따라서 FlowScope는 raw Client capture 증가가 없으면 AJAX를 실행하고, AJAX도 0이면 수집된 Traditional Evidence와 Alert를 버리지 않으면서 `COMPLETED_WITH_WARNINGS`와 원인을 표시한다. 이 상태는 깨끗한 rendered-browser 기준선 완료가 아니다.

Active Scan은 상태를 바꿀 수 있고 트래픽이 크므로 기본 baseline에서 분리하며 exact scope와 별도 Burp 승인을 요구한다. “ZAP 기능을 적게 쓴다”가 아니라 안전한 자동 기준선과 고위험 능동 스캔의 승인 경계를 분리한 것이다.

비로그인과 USER A/B를 한 ZAP 세션에서 연속 실행하면 cookie jar와 crawler state가 섞여 “누가 밟았나” 비교 자체가 오염된다. 빠른 시작은 신원을 복수 선택하게 하고, 실행기는 비로그인 → 선택 계정 순서로 각 신원 앞에서 fresh ZAP session을 만든다. 화면은 whs_flow 작업면의 카드·간격 문법을 유지한 신원별 lane card로 현재 단계, 전체 수집, Traditional 수집, Client/AJAX rendered 수집, Alert, 주의·실패 원인을 분리한다. 한 문장 상태는 실패한 신원과 실패 단계를 찾기 어려워 기각했다. 계정 레인은 broker 자격증명으로 완전 교체하고, 비로그인 레인은 fresh session 안에서 새로 생긴 익명 Cookie/CSRF를 유지해 상태형 공개 흐름을 끊지 않는다.

FlowScope Web URL이 exact scope에 실수로 들어와도 scanner target에서 숨기고 시작 요청을 거부한다. 모든 localhost를 막으면 crAPI 같은 로컬 허가 대상을 점검할 수 없으므로 현재 Web port만 제어면으로 판별한다.

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
- beta.7의 Burp/ZAP/Codex/Claude 전체 실행이 통과했다.
- 화면의 0 또는 관측 조합 수가 전체 공격면 대비 완료율이다.

## 12. 2026-08-26 현재 확인된 UI·배포 부채

다음은 설계 의도가 아니라 실제 사용자 검증으로 발견된 미완료 항목이다.

1. **빈 데이터 화면의 정보 과다 — 해결:** 관측 0건이면 분석 패널을 숨기고 `scope → 로그인/HUMAN → ZAP → Explorer/Judge` 네 단계와 빠른 시작·샘플 조작을 먼저 보여 준다. Evidence가 생기면 기존 분석 작업면으로 전환한다.
2. **ADMIN 예시의 오해 — 해결:** 빈 상태에 BOLA는 서로 다른 최소 권한 계정 두 개를 권장하고 ADMIN은 BFLA 역할 비교가 필요할 때만 추가한다는 경계를 명시했다.
3. **Maven 중간 JAR 혼동 — build 해결·beta.32 실로드 대기:** 과거 `target/original-flowscope-1.2.0-beta.3.jar` 오선택으로 `Extension class is not a recognized type` 오류가 발생했다. 현재 package는 중간 파일을 제거하고 공개 JAR 수가 하나가 아니면 실패하므로 선택할 파일은 `target/flowscope-1.2.0-beta.32.jar` 하나다. beta.32도 manifest-first와 streaming manifest 자동 검증을 유지하지만, 현재 Browser·Repeater·초기화·저장/재열기와 신원별 ZAP 안전 캠페인, LLM Explorer/Judge는 별도 Burp 수동 gate다.
4. **파싱 결과 Evidence 진입 — 해결:** stable Evidence ID, traffic class/disposition, 반복 수와 명시적 `상세 보기` 버튼을 제공한다. 버튼은 operation 첫 항목이 아니라 선택한 Evidence ID를 상세의 첫 열린 블록으로 고정하며, Web 재동기화 뒤에도 같은 선택을 유지한다.
5. **구독 CLI 자동 실행 — 준비 자동화 완료, beta.31 Burp 실환경 gate:** 빠른 시작은 표준 설치 경로의 Codex/Claude 실행 파일과 공식 로그인 상태를 비동기 확인하고 READY provider를 자동 선택한다. 상태는 30초 캐시하되 시작 직전에 재검증하며 수동 경로 입력과 **다시 확인**은 비표준 설치·상태 변경용 fallback이다. 새 Explorer와 별도 Judge, Judge 후속 provider session ID, Codex login-only 임시 home, read/write 도구와 Evidence gate는 유지한다. 실제 Burp에서 자동 선택→MCP 대상 요청→route frontier→run 종료가 끝까지 성공하는지는 beta.31 JAR 재로드 뒤 확인해야 한다. Claude Explorer는 no-persistence flag에도 provider metadata가 남을 가능성이 있어 UI에 경고한다.
6. **ZAP API 정의 입력 — 선택 고급 설정:** 기본 사용자는 대상·신원만 고르면 된다. OpenAPI·GraphQL·Postman·SOAP 정의를 이미 가진 진단자만 `형식 URL` 한 줄 입력을 펼쳐 쓴다. FlowScope는 파일명을 추측하거나 외부 문서를 검색하지 않고 exact-scope URL만 허용하며, import 성공 수와 실패 경고를 lane 카드에 함께 표시한다. 이 입력은 endpoint 발견률을 높일 수 있지만 Active Scan 승인이 아니며 정의가 생성하는 모든 업무 요청의 무해성을 보증하지 않는다.

### beta.18의 가독성·정확성 보정

- **긴 경로:** 글자 수 기준 임의 절단은 서로 다른 endpoint를 같은 라벨처럼 보이게 하므로 전체 operation을 유지하고 `/` 경계에서 줄바꿈한다. 한 segment만 매우 길 때만 그 segment 내부를 제한적으로 나눈다.
- **접근선:** source 색·선형 자체가 1회 관측을 표현하므로 `H×1` 같은 라벨은 숨기고 반복 관측에만 `×N`을 붙인다. 이는 선 교차 지점의 불필요한 텍스트 겹침을 줄이되 Evidence 수를 삭제하지 않는다.
- **좁은 화면:** 900px 이하에서 데스크톱 그래프를 축소·가로 스크롤시키지 않고 동일한 source·identity 필터 결과를 API 목록으로 바꾼다. 목록 항목은 source, 관측 신원, 객체, Evidence 수를 보존하고 같은 상세 패널을 연다.
- **신원 문구:** `관측 신원`은 트래픽 분류 결과이고 `재사용할 등록 계정`은 Session Broker가 ACTIVE로 확인한 자격증명이다. 하나가 보인다고 다른 하나가 존재한다고 추론하지 않으며 요청 실험실에 두 상태를 함께 표시한다.
- **문자 깨짐:** raw byte를 먼저 보존하고 문자셋 디코딩이 손실 없이 성공한 텍스트만 Web 편집한다. 이미 beta.17 String 경로에서 깨진 Evidence는 화면 보정으로 복원할 수 없어 재수집을 요구한다.

해결 표시는 항목별 자동 회귀와 명시된 실측 범위까지의 상태다. 복수 로그인 계정, 실제 구독 클라이언트의 Explorer/Judge 전체 실행, 저장·복구·unload는 계속 beta gate로 남긴다.
