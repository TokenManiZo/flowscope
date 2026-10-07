# 판정 규칙·데이터 처리·한계

## 요약

- 응답 코드가 200이라는 것만으로 접근에 성공했다고 보지 않습니다. 401, 403, 로그인 화면으로 돌려보내는 응답, "권한이 없습니다" 같은 문구가 담긴 응답은 막힌 것으로 봅니다.
- 다른 사람 것으로 확인된 데이터를 바꾸는 요청(PUT, PATCH, DELETE 등)이 성공하면, 응답 내용이 비어 있어도 위험한 후보로 봅니다.
- 계정의 역할(일반 사용자, 관리자 등)은 사람이 정한 값만 씁니다. 주소에 admin이 들어 있다고 관리자 기능으로 짐작하지 않습니다.
- 데이터의 주인은 응답에 적힌 소유자 정보로 판단하고, 확실하지 않으면 판단하지 않습니다. 주인은 화면에서 직접 정할 수 있습니다.
- 모든 결과는 후보입니다. 자동으로 취약점을 확정하지 않고 사람이 확인해서 판정합니다.
- 저장하기 전에 쿠키, 토큰, 비밀번호를 가립니다. 다만 가리는 건 잘 알려진 인증 값뿐이라 응답 안의 개인정보나 업무 데이터는 남을 수 있습니다.
- 웹 화면은 `127.0.0.1`에서만 열리고, Burp에서 FlowScope를 내리면 같이 꺼집니다.
- CAPTCHA, 2단계 인증, 기기 인증이 있는 로그인은 자동으로 따라가지 못해서 다시 로그인해야 할 수 있습니다.
- 실행해야만 나타나는 API나 아직 받지 않은 JavaScript 파일 속 API는 찾지 못합니다. 검토 대기로 분류된 요청을 확인하지 않으면 실제 API가 비교에서 빠질 수 있습니다.

처음 설치한다면 [README](../../README.md)부터 보세요.

## 자세한 내용

### 판정 규칙과 신뢰 경계

- 2xx status만으로 성공 접근을 확정하지 않습니다.
- 401/403, 로그인 redirect, soft-deny 응답 문구는 거부 Evidence로 취급합니다.
- OPTIONS/HEAD는 소유권 성공 Evidence에서 제외합니다.
- 확인된 타인 소유 객체에 대한 write 성공은 빈 body여도 고위험 BOLA 후보입니다.
- BFLA의 신원 역할은 명시 입력만 사용합니다. endpoint 요구 역할은 사람의 명시 P3가 우선하며, 대상 신원을 제외한 여러 신원의 일관된 성공/차단 분포가 있을 때만 P2 정책 확인 후보를 제안합니다. P2만으로 취약점을 확정하지 않고 경로나 token 문자열로 ADMIN을 추정하지 않습니다.
- 자동 owner 추출은 의도적으로 보수적입니다. 충돌하거나 신뢰도가 낮은 첫 접근자는 finding을 만들지 않습니다. 운영자는 Web 그래프 상세에서 owner를 확인할 수 있습니다.
- E2는 같은 좌표에 다른 신원 Evidence가 있다는 이유만으로 부여하지 않습니다. O2/O3 소유자 또는 요구 역할을 충족한 권한자의 성공 응답과 대상 응답이 모두 현재 계정에 귀속되고 관측 시각을 확인할 수 있으며, 대상 ID·JSON 구조·동적 필드를 정규화한 응답 길이가 일치할 때만 **비통제 관측 차등**으로 표시합니다. O1 첫 접근자, soft-deny, 의미가 다른 응답, 시각 미상 기준선은 E1로 남고 E3는 자동 부여하지 않습니다.
- JWT payload는 검증되지 않은 grouping hint이며 인증 증명이 아닙니다. 가능한 경우 identity를 service·issuer·audience·subject로 namespace합니다.

### 로컬 Web 경계

Web 서버는 `127.0.0.1`에만 bind하며 Host·Origin, 무작위 capability, 요청 크기와 CSP를 검사합니다. 확장 unload 때 종료됩니다. MCP endpoint는 없습니다.

### 데이터 처리

- 명시적 HUMAN 로그인 캡처의 raw Authorization/Cookie/CSRF와 Explorer 브라우저 로그인으로 받은 쿠키·인증 헤더는 각각의 메모리 전용 vault에만 존재합니다. Explorer는 비밀번호를 받지 않습니다. ZAP 계정의 ID·비밀번호도 FlowScope에서는 메모리 vault에만 두지만, 로그인 구성 시 로컬 ZAP API의 `POST` body로 전달되며 ZAP 2.17은 Context를 임시 session DB에 기록합니다. 따라서 인증 lane은 FlowScope Docker의 1GiB tmpfs ZAP home과 tmpfs `/tmp`에서만 허용하고 container 종료 시 폐기합니다. Web snapshot·프로젝트·Evidence·FlowScope 로그에는 저장하지 않습니다. Java·HTTP library와 ZAP이 만드는 일시적 메모리 사본까지 물리적으로 지우는 hardware vault는 아닙니다.
- 요청·응답은 가리지 않고 원문 그대로 저장합니다. Authorization, Cookie, Set-Cookie, password, token, secret, API key도 그대로 Evidence·프로젝트 파일·JSON 내보내기·화면에 남고, LLM 탐색을 쓰면 Codex로 전달됩니다.
- FlowScope는 허가된 테스트 환경 전용입니다. 계정 등록과 로그인에는 **테스트 계정만** 사용하고 실제·운영 자격증명은 쓰지 마십시오. 캡처 트래픽은 인증값까지 로컬 프로젝트 파일에 원문으로 남고 LLM Explorer로 전달될 수 있습니다.
- 인증 grouping은 subject 또는 짧은 단방향 fingerprint를 사용하며 raw opaque token은 보존하지 않습니다. Cookie 존재만으로 로그인 사용자를 확정하지 않습니다. 연결되지 않은 fingerprint는 감사·binding 후보로 남지만 broker exact match 또는 명시적 account binding 전에는 서비스별 `UNRESOLVED` graph identity 하나로 표시합니다.
- 트래픽 분류는 저장 Evidence를 삭제하지 않습니다. operation별 `include/exclude/auto` override도 응답 없음, unknown source, 비탐색 validation 트래픽을 discovery coverage로 만들 수 없습니다. 반복 관측은 화면에서만 접고 모든 Evidence ID·count·first/last timestamp를 유지합니다.
- body와 message preview는 필드별 8,192자입니다. 일반 textual 전문은 기본 1MiB, 발견용 HTML/JavaScript/JSON/XML 응답은 기본 4MiB, digest 중복 제거 후 압축 총량은 48MiB까지 보존하며, 실시간 수집은 20,000건에서 멈춥니다.
- SQLite 프로젝트와 JSON 내보내기에는 인증값을 포함한 원문과 application data가 남습니다. POSIX에서는 owner read/write로 기록하며 engagement 데이터 정책에 따라 비밀 자료로 보호하십시오.
- SQLite 자동 저장과 JSON 내보내기는 임시 파일을 거쳐 저장하고 지원되는 경우 atomic replace를 사용합니다. SQLite는 현재 메모리 분석 상태의 내구성 snapshot이며 20,000건 live 상한을 없애는 서버용 event store는 아닙니다.

### 정직한 한계

- 현재 결과는 결정론적 규칙 후보와 사람 검토입니다. 자동 LLM 최종 판정은 없으며, 과거 verdict는 당시 기록으로만 표시합니다. 어느 쪽도 business impact의 자동 증명이나 보고서 검토의 대체물이 아닙니다.
- owner 추출은 일반적인 scalar owner/user/account 필드와 명시적 nested owner/user/author/account/customer principal object를 인식합니다. 도메인 고유 소유권은 운영자가 확인해야 합니다.
- 세션 자동화는 일반 cookie, bearer/CSRF header, 회전, 만료 hint, 의심 응답을 다룹니다. CAPTCHA, MFA, WebAuthn, device binding, 애플리케이션 고유 refresh/login protocol은 수동 재캡처가 필요할 수 있습니다.
- `ACTIVE`는 자격증명이 포함된 캡처에서 401·로그인 redirect·invalid-token이 아닌 HTTP 응답을 관측했다는 범용 transport 증거입니다. 서비스 고유 `/me` 의미나 계정 소유를 자동 증명하지 않으므로 실제 역할·계정 연결은 운영자가 확인해야 합니다.
- `ACTIVE` 세션은 검증 강도를 함께 가집니다. **운영자 확인**(운영자가 확인한 Burp 교환을 계정으로 가져옴), **규칙 확인**(저장된 검증 규칙의 URL과 성공 표식이 응답에서 모두 일치), **약검증**(성공 표식 없이 2xx~4xx만으로 ACTIVE가 된 하위호환), **미검증**(비-ACTIVE). "FlowScope 계정 세션으로 사용" 시 로그인 성공을 나타내는 **응답 표식**(예: 사용자명, `"id":"..."`)을 선택적으로 입력할 수 있으며, 자격값(쿠키·토큰·비밀번호)은 거부됩니다. 표식을 입력하면 이후 자동 캡처가 그 검증 endpoint에서 표식을 확인해 **규칙 확인**으로 승격할 수 있고, 비우면 그 세션은 **운영자 확인**이 되지만 자동 승격 규칙은 만들지 않습니다. **능동 교차 신원 재전송은 운영자 확인·규칙 확인 세션만** 사용하며(프론트·백엔드 모두 강제), **약검증** 세션은 Request Lab에는 하위호환으로 쓰이지만 재전송에는 쓰이지 않습니다.
- 안정 신호가 없는 opaque 회전 token은 자동 상관할 수 없습니다. 운영자가 확인된 fingerprint를 등록 계정에 명시적으로 연결할 수 있습니다.
- Fetch Metadata와 MIME은 없거나 잘못될 수 있고 business API가 document·asset·telemetry와 비슷할 수 있습니다. 분류기는 여러 고신뢰 신호가 합치할 때만 제외하고 애매한 요청을 메인 그래프 밖 `REVIEW`로 보존하며 이유와 reversible override를 제공합니다. `REVIEW`를 확인하지 않으면 실제 API가 메인 비교에서 빠질 수 있으므로 트래픽 노이즈를 완벽하게 분류한다고 주장하지 않습니다.
- 미요청 route는 보존된 textual 응답(일반 기본 1MiB, 발견용 MIME 기본 4MiB; 전문 미보존 시 8,192자 preview)과 응답 없는 Burp Site Map 항목에서 최대 20,000개까지 추출합니다. JavaScript AST가 정적으로 확인한 문자열·template·단순 결합은 처리하지만 임의 wrapper 의미, 런타임 계산, 클라이언트 실행으로만 생기는 경로, 받지 않은 lazy chunk와 대상 밖 문서는 추측하지 않으므로 후보 목록도 전체 공격면이 아닙니다. 후보 우선순위는 공개된 범주형 근거이며 확률이나 취약성 점수가 아닙니다.
- 데이터 흐름은 제한된 exact-value matching이며 완전한 semantic taint analysis가 아닙니다.
- Burp Repeater로 보내기는 메모리 원문 또는 저장된 원문을 미전송 초안으로 엽니다. Web 요청 실험실의 명시적 전송은 HUMAN `VALIDATION` Evidence로 보존하며 탐색 완료나 자동 LLM verdict를 만들지 않습니다.
- 기존 agent workspace·MCP·Judge 실행기는 제거된 상태입니다. 새 Explorer는 Codex app-server dynamic tool과 Java exact-scope gateway를 사용하며, 브라우저는 사용자가 직접 로그인한 FlowScope Chromium 창 하나만 조작합니다. 현재 MCP 연결은 지원하지 않습니다.
- source별 active run context와 정확한 run ID의 완료·취소 경계를 유지합니다. LLM run은 같은 run의 신뢰 가능한 응답 Evidence ID가 없으면 완료되지 않습니다.
- Explorer는 정적·응답 기반 frontier를 넓게 따라가지만 runtime에서만 로드되는 lazy chunk, CAPTCHA/MFA/WebAuthn, 서버 전용 endpoint와 임의 JavaScript wrapper를 완전 발견하지 못할 수 있습니다. POST의 업무 의미도 범용 블랙박스에서 완전히 판별할 수 없으므로 조회·검색 요청으로 제한하고 승인된 테스트 환경에서만 사용합니다.
- 그래프의 API 그룹은 경로의 첫 안정 세그먼트(`/api`, `/rest`, `/v1` 접두 제외)로 묶는 표시 단위이지 의미 기반 clustering이나 전체 API 추정이 아닙니다. API·접근 대상 ID의 18개 증분은 정렬 뒤 표시 제한이며 숨긴 항목의 Evidence는 선택·상세에 그대로 남습니다. 20,000건 수집 상한은 별도로 Burp를 보호합니다.
- Montoya `2026.7`에 맞춰 컴파일했습니다. 실제 engagement에서 사용하는 Burp 버전으로 release JAR을 확인해야 합니다.

### 라이브 교차 신원 재전송 설계 근거

- [Autorize](https://github.com/Quitten/Autorize/blob/master/README.md)의 관측 요청→저권한/비로그인 재전송과 다중 저권한 사용자 지원을 HUMAN 트래픽 fan-out의 기준으로 삼았습니다.
- [AuthMatrix](https://github.com/SecurityInnovation/AuthMatrix)의 사용자·역할·요청 조합과 응답 기반 성공/실패 규칙을 참고하되, FlowScope에서는 별도 판정기를 만들지 않고 기존 P/E/O 정책·Evidence 오라클을 사용합니다.
- [ZAP Access Control Testing](https://www.zaproxy.org/docs/desktop/addons/access-control-testing/)의 사용자별 Allowed/Denied/Unknown 기대와 scope 제한을 반영해 등록 계정 상태와 exact scope를 독립 게이트로 둡니다.
- Burp 계정 세션은 Autorize의 명시적 인증 헤더 교체와 AuthMatrix의 Repeater 기반 사용자별 쿠키·헤더 등록을 따라, 사용자가 확인한 요청을 등록 계정에 직접 결박합니다. Burp Montoya의 [CookieJar](https://portswigger.github.io/burp-extensions-montoya-api/javadoc/burp/api/montoya/http/sessions/CookieJar.html)는 사용자별 격리 저장소가 아닌 공유 jar이므로 계정별 재전송 자격의 정본으로 쓰지 않습니다. 토큰 문자열이나 응답 내용으로 계정 이름·역할을 자동 추론하지 않으며, ZAP의 [Authentication/Session Management/Verification](https://www.zaproxy.org/docs/getting-further/authentication/authentication-methods/) 분리와 마찬가지로 계정 결박과 세션 유효성은 별도 상태로 취급합니다. ZAP Browser Based Authentication은 [공식 browser auth 방식](https://www.zaproxy.org/docs/desktop/addons/authentication-helper/browser-auth/)으로 로그인하고 실제 성공 Evidence를 얻은 경우에만 같은 등록 계정의 메모리 세션을 갱신합니다.
- [AuthScope (CCS 2017)](https://acmccs.github.io/papers/p799-zuoA.pdf)의 인증 후 요청 필드 치환·응답 차등 관찰을 근거로 삼되, 상태코드 하나만으로 취약점을 확정하지 않습니다.
- [OWASP API1:2023 BOLA](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/)와 [OWASP API5:2023 BFLA](https://api-security.owasp.org/editions/2023/en/0xa5-broken-function-level-authorization/)에 따라 객체 소유 관계와 기능별 역할 요구를 별도 정책 축으로 유지합니다.
