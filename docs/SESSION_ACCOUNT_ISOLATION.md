# 계정별 세션 격리와 검증

## 문제 정의

한 브라우저 프로필에서 USER A를 로그아웃하고 USER B로 로그인해도 이것을 두 개의 독립 세션으로 볼 수 없다. 서버가 A의 세션 Cookie를 완전히 폐기하지 않거나 브라우저의 Cookie, localStorage, IndexedDB, sessionStorage 중 일부가 남을 수 있기 때문이다. 로그인 요청과 최종 인증 상태가 여러 redirect와 후속 요청에 걸쳐 형성되는 서비스도 있다.

FlowScope는 다음 세 대상을 분리한다.

- **등록 계정**: 운영자가 지정한 USER A, USER B 같은 논리 신원이다.
- **관측 요청 신원**: 요청의 비가역 인증 지문과 기존 명시적 결박으로 판별한 신원이다.
- **재사용 세션 슬롯**: Cookie·Authorization을 현재 프로세스 메모리에서만 보관하는 계정별 실행 자격이다.

인증값이 관측됐다는 사실은 로그인 성공이나 계정 신원을 증명하지 않는다. 따라서 충돌 요청은 자동 병합하거나 다른 계정 슬롯을 회전시키지 않는다.

## 이번 재현의 원인과 방어

재현 순서는 `USER B 로그인 → 같은 브라우저에서 로그아웃 → TEST 1 로그인 캡처`였다. TEST 1 캡처 중 요청 자격이 기존 USER B 슬롯과 일치하면 요청 단계에서는 TEST 1 캡처를 억제한다. 기존 구현은 이 억제 상태를 응답까지 보존하지 않아 응답의 새 `Set-Cookie`를 USER B 슬롯에 반영할 수 있었다.

수정 후에는 요청 ID별 in-flight 문맥에 **캡처 충돌로 억제됨**을 보존한다. 해당 응답은 USER B와 TEST 1 어느 쪽의 재사용 세션도 갱신하지 않는다. HTTP 교환 자체는 HUMAN Evidence로 남을 수 있지만, 세션 신원 승격과는 분리된다. raw Cookie·Authorization은 새 로그·DB·내보내기 데이터에 추가하지 않는다.

이 방어는 교차 계정 오염을 막지만 같은 브라우저 프로필을 두 계정으로 분리해 주지는 않는다. TEST 1은 별도의 검증된 교환이 들어올 때까지 `UNVERIFIED`가 정상이다.

## 권장 운영 절차

1. 계정마다 별도 Chrome 프로필 또는 별도 자동화 BrowserContext를 사용한다. 시크릿 모드는 같은 시크릿 세션의 창끼리 상태를 공유할 수 있으므로 계정 전환 전에 모든 시크릿 창을 닫고 새 세션을 시작한다.
2. TEST 1의 **로그인 연결 시작**을 누른 뒤 TEST 1 전용 컨텍스트에서 로그인한다.
3. 최종 redirect가 끝난 후 계정 식별 정보나 로그인 전용 화면이 보이는 인증된 요청을 한 번 발생시킨다.
4. 캡처를 종료한다. 계속 `UNVERIFIED`이면 Burp Proxy history 또는 Repeater에서 TEST 1로 인증된 요청과 응답을 직접 확인한다.
5. 확인한 항목을 우클릭하고 **FlowScope 계정 세션으로 사용 → TEST 1**을 선택한다.
6. USER B와 TEST 1 각각의 슬롯이 `ACTIVE`인지 확인한 뒤 교차 신원 검증을 시작한다.

로그아웃만 반복하거나, DevTools에서 Cookie 일부만 지우거나, 브라우저의 현재 로그인 상태를 계정 이름과 자동 병합하는 방법은 사용하지 않는다.

## 도구별 설계 비교

| 도구/방식 | 세션 분리 방법 | 성공 확인 | FlowScope에 적용할 점 |
|---|---|---|---|
| Burp Session Handling | URL·도구 범위별 규칙, Cookie jar, macro | 응답 header/body/redirect의 문자열·정규식으로 유효성 검사 | 유효성 검사와 갱신을 별도 단계로 두고 추적 가능한 규칙을 사용한다. Burp 기본 Cookie jar는 도구 전체에서 공유되므로 계정별 정본으로 사용하지 않는다. |
| ZAP Authentication | Context 안에 Session Management, Authentication Method, Verification Strategy, Users를 분리 | Logged-in 또는 logged-out indicator 필수 | 계정 자격과 로그인 판정 규칙을 분리하고 계정별 fresh Context를 사용한다. |
| Playwright | 계정/역할마다 독립 BrowserContext와 storageState | 최종 URL 또는 인증된 UI 요소를 기다린 뒤 상태 저장 | 장기적으로 HUMAN 로그인도 계정별 비영속 BrowserContext로 격리하는 모델이 가장 명확하다. |
| AuthMatrix | 사용자·역할 표에 사용자별 Cookie/Header를 명시적으로 등록 | 요청별 success/failure regex | 운영자가 확인한 요청을 특정 계정에 결박하는 현재 FlowScope 우클릭 경로와 가장 가깝다. |
| Autorize | 고권한 요청을 저권한·비로그인 인증으로 교체해 재전송 | content/header/regex/length 비교 | 원 요청과 교체 인증을 분리하되 응답 유사도만으로 취약점을 확정하지 않는다. |

## 권장 상태 기계

```text
CAPTURING
   │ 자격 관측
   ▼
UNVERIFIED ── 명시적 로그인 성공/신원 확인 ──▶ ACTIVE
   │ 다른 계정 자격 충돌                         │ 만료·401·로그인 redirect
   └──────────── 격리 유지 ◀─────────────────────┤
                                                  ▼
                                      SUSPECT / REAUTH_REQUIRED
                                                  │ 운영자 폐기
                                                  ▼
                                               REVOKED
```

`ACTIVE` 승격은 장기적으로 다음 중 하나를 요구하는 것이 좋다.

- 계정별 검증 URL과 로그인 성공 정규식
- `/me` 같은 신원 endpoint의 기대 subject
- 최종 URL과 로그인된 UI indicator의 조합
- 운영자가 응답을 확인한 Burp 항목의 명시적 가져오기

단순히 2xx/3xx 응답을 받았거나 Cookie가 생겼다는 조건만으로는 충분하지 않다. 200 로그인 실패 페이지, 302 로그인 화면 회귀, 403 인증됨/인가 실패를 구분할 수 없기 때문이다.

## 회귀 테스트 표

| 시나리오 | 기대 결과 |
|---|---|
| TEST 1 캡처 중 무자격 로그인 요청 | TEST 1 후보 자격 관측, 성공 검증 전 `UNVERIFIED` |
| TEST 1 캡처 중 USER B 자격 요청 | 캡처 충돌 상태를 응답까지 보존, 어느 슬롯도 갱신하지 않음 |
| TEST 1 캡처 중 TEST 1 자격 요청 | TEST 1 요청·응답 문맥 유지 |
| 캡처가 없고 USER B 자격 요청 | 기존 규칙대로 USER B Evidence 귀속 및 허용된 세션 회전 |
| 늦은 응답 또는 데이터셋 교체 후 응답 | 현재 계정/run으로 추측하지 않고 제외 |
| 동일 자격을 두 등록 계정에 결박 | 자동 이동·병합 없이 충돌 표시 |

## 다음 구현 우선순위

1. **완료**: 충돌로 억제된 요청의 응답이 기존 계정 세션을 갱신하지 못하게 fail-closed 처리한다.
2. **완료**: UI와 README에서 계정별 브라우저 컨텍스트와 확인된 요청 가져오기를 안내한다.
3. **다음 후보**: 계정별 검증 URL/성공 indicator 또는 기대 subject를 등록해 `ACTIVE` 승격 oracle을 강화한다.
4. **다음 후보**: Playwright형 비영속 BrowserContext를 HUMAN 계정별로 생성·폐기하는 로그인 도우미를 제공한다.
5. **다음 후보**: 만료 시 계정별 재인증 workflow와 세션 유효성 검사 기록을 제공한다.

3~5는 이번 수정에 포함하지 않는다. 대상별 로그인 의미와 운영 UX 결정이 필요하고, 새 브라우저 런타임을 섣불리 추가하면 현재의 명시적 메모리 세션 모델보다 복잡해지기 때문이다.

## 남은 코드 한계

- 현재 HUMAN 자동 캡처의 `responseConfirmed`는 401, 로그인 redirect, 명시적 invalid-token 본문을 제외한 2xx~4xx 응답을 넓게 받아들인다. 대상별 로그인 성공 indicator나 기대 subject가 없으므로 `ACTIVE`는 계정 신원을 암호학적으로 증명하는 상태가 아니다.
- 요청의 Cookie를 인증 Cookie와 분석/추적 Cookie로 분류하지 않는다. 모든 적용 Cookie가 매칭 조건에 들어가므로 추적 Cookie 회전이나 누락이 신원 감지를 불안정하게 만들 수 있다.
- HTTP 프록시는 localStorage·IndexedDB·Service Worker 내부 상태를 직접 격리하거나 관찰하지 못한다. 이 문제는 계정별 BrowserContext로 해결해야 한다.
- 같은 이름의 Cookie가 서로 다른 path에 존재하는 복잡한 대상은 요청 `Cookie` 헤더만으로 정확한 원본 path를 복원하기 어렵다.

따라서 이번 변경은 **오귀속을 막는 P0 안전 수정**이고, 완전한 다중 계정 세션 오케스트레이션은 계정별 브라우저 격리와 대상별 신원 검증 oracle을 추가해야 완성된다.

## 공식 자료와 관련 연구

### 구현·운영 자료

- PortSwigger, [Sessions settings](https://portswigger.net/burp/documentation/desktop/settings/sessions): shared Cookie jar, session handling rule, macro의 책임과 범위.
- PortSwigger, [Session handling rule editor](https://portswigger.net/burp/documentation/desktop/settings/sessions/session-handling-rules): 세션 유효성 검사, macro 재로그인, in-browser recovery.
- ZAP, [Authentication](https://www.zaproxy.org/docs/desktop/start/features/authentication/): Context, Session Management, Authentication, Verification Strategy, Users의 분리.
- Playwright, [Authentication](https://playwright.dev/docs/auth): 역할별 storageState, 최종 URL/UI 확인, 병렬 worker별 고유 계정.
- Playwright, [BrowserContext](https://playwright.dev/docs/api/class-browsercontext): 독립 비영속 브라우저 세션.
- OWASP WSTG, [Testing for IDOR](https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/05-Authorization/04-Insecure_Direct_Object_References/): 서로 다른 사용자 소유 객체를 이용한 수평 권한 검사.
- [AuthMatrix](https://github.com/SecurityInnovation/AuthMatrix): 사용자·역할·요청 매트릭스, 사용자별 Cookie/Header, 인증 갱신 chain.
- [Autorize](https://github.com/PortSwigger/autorize): 고권한 트래픽을 저권한/비로그인 자격으로 재전송하는 인가 검사.

### 논문

- Rennhard et al., [Automating the Detection of Access Control Vulnerabilities in Web Applications](https://doi.org/10.1007/s42979-022-01271-1), SN Computer Science, 2022. 두 사용자 세션을 기반으로 요청을 교차 재생하는 재현 가능한 black-box 접근제어 검사와 false positive 저감을 다룬다.
- Mai et al., [Metamorphic Security Testing for Web Systems](https://arxiv.org/abs/1912.05278), ICST 2020. 사용자·입력을 바꾼 실행 사이에 성립해야 할 관계로 test oracle 문제를 줄인다.
- Chaleshtari et al., [Metamorphic Testing for Web System Security](https://arxiv.org/abs/2208.09505), IEEE TSE. Web 상호작용용 metamorphic relation과 자동 입력 변환을 확장한다.
- Esposito et al., [A2CT: Automated Detection of Function and Object-Level Access Control Vulnerabilities in Web Applications](https://www.scitepress.org/Papers/2025/130927/130927.pdf), ICISSP 2025. 여러 사용자 쌍, 새 인증 상태, 요청 재생과 결과 검증을 결합한다.
- Dharmaadi et al., [BACFuzz: Exposing the Silence on Broken Access Control Vulnerabilities in Web Applications](https://arxiv.org/abs/2507.15984), 2025. 응답만으로 판별하기 어려운 silent authorization failure를 runtime/SQL oracle로 보완한다.
- Zhong, [A Survey of Prevent and Detect Access Control Vulnerabilities](https://arxiv.org/abs/2304.10600), 2023. 설계·분석·테스트·runtime monitoring 전반의 접근제어 취약점 연구를 분류한다.

이 자료들은 공통적으로 **세션 획득**, **신원 확인**, **요청 교체**, **결과 oracle**을 서로 다른 단계로 취급한다. FlowScope도 관측 지문만으로 계정이나 취약점을 확정하지 않고 이 네 단계를 분리해야 한다.
