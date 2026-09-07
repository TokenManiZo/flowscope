# FlowScope 프로젝트 개요 (목표·범위)

> 현재 제품 범위: 2026-09-07 D-126 반영. 초기 2026-08-24 목표 중 Judge·하네스 MCP 구성은 폐기했다. 후속 Explorer와 FlowScope용 MCP는 별도 설계이며 현재 구현이 아니다.

> **구현 상태(1.2.0-beta.44):** 값 없는 `Endpoint·Parameter Surface Delta`가 OpenAPI·HTML form·JavaScript AST call-site 선언과 실제 H/S/L HTTP 관측을 분리한다. JavaScript는 lexical 불변 object member와 axios instance 설정까지 해석하고 동적·재할당 값은 거짓 endpoint 대신 typed issue로 표시한다. 과거 LLM 통제 요청의 실행 원장은 복원·표시하지만 새로운 LLM 실행은 제공하지 않는다. 기존 Resource/owner/BOLA·BFLA 그래프와 판정은 `접근 대상 ID` 상세층으로 유지한다. 저장소 내부 회귀는 실제 Burp 재로드나 승인된 다양한 대상의 endpoint·parameter 성능 평가가 아니다.

## 문제의식 (Premise)
웹/API 모의해킹의 첫 병목은 **수집한 요청 목록만 보고 아직 보지 못한 endpoint와 조건부 parameter를 알아내기 어렵다는 것**이고, 다음 병목은 권한·상태·객체 흐름을 사람이 머릿속으로 재구성해야 한다는 것이다. FlowScope는 선언 산출물과 실제 H/S/L Evidence의 차이를 먼저 작업목록으로 만들고, 선택한 API의 인가 관계를 그래프와 매트릭스로 연다.

## 핵심 접근
1. **Endpoint·Parameter Surface Delta**: 선언된 API·입력과 실제 Evidence를 값 없는 범용 key로 정렬해 source별 관측·미관측을 비교.
2. **인가 상세 그래프**: Burp 트래픽을 요청자·엔드포인트·객체 관계로 시각화하고, 고카디널리티 객체는 선택 API의 상세에서만 펼친다.
3. **3자 오버레이 비교**: 동일 타깃에 대해 **사람 vs ZAP 스캐너 vs LLM** 실제 트래픽을 같은 endpoint·parameter 좌표와 인가 좌표에서 비교.
4. **판정과 이력 분리**: 현재 Evidence와 역할·소유자 정책에서 규칙 후보를 만들고 사람이 검토한다. 삭제된 LLM Judge의 평가·판정은 읽기 전용 이력으로만 보존하며 현재 결론으로 합치지 않는다.
5. **연계형**: IDOR를 대표 예시로 잡되, **여러 도구와 연계 가능한 형태**로 준비. AI 서비스/API 서비스 취약점 분석에 활용 가능한지 검토.
6. **Evidence 우선**: 트래픽 노이즈와 반복은 저장 단계에서 삭제하지 않고 class/disposition으로 분석 입력과 표시만 나눈다. 불확실한 신원·요청은 숨은 확정값으로 바꾸지 않고 `UNRESOLVED/REVIEW`로 노출한다.

## 산출물 목표 (Deliverables)
- **연구 정리**: 기술 보고서·논문 (사람 vs 스캐너 커버리지 비교, AI 시나리오 정확도 등).
- **오픈소스 공개**: 플로우 그래프 + 오버레이 + AI 제안 도구 → **GitHub Star** 획득.
- **CVE**: 도구로 발견한 취약점 제보 → CVE 발급.
- **바운티**: 취약점 제보 → 상금 (대상에 따라).

## 확장 검토
- 여러 도구와의 연계(interoperability) → 표준 내보내기/연동 지점 필요.
- AI 서비스 취약점 분석, API 서비스 취약점 분석 적용 가능성.

## 확정된 제품 범위
- **O1. 관측 비교:** HUMAN·SCANNER·LLM은 트래픽 생성 source다. 현재 실행 제어는 HUMAN·ZAP에만 제공한다. 과거 프로젝트의 LLM Evidence와 source 비교를 지우거나 HUMAN으로 바꾸지 않는다.
- **O2. 현재 연계:** Burp 수집·메모리 Session Broker·독립 `ZapCampaign`·Web·관계형 `.flowscope.db` 및 호환 JSON을 유지한다. MCP 서버와 구독 CLI 하네스는 제거했다.
- **O3. 후속 설계:** Explorer는 별도 하네스에서, FlowScope용 MCP는 Evidence·분석 연계 목적으로 설계한다. 이번 변경에는 도구·포트·실행기 대체 구현을 넣지 않는다.
- **ZAP 유지 경계:** 현재 Traditional → Client → AJAX 보완 → passive queue → Alert 순서를 유지한다. Client-only 전환은 별도 실물 검증 뒤 결정할 작업이다.

## 계속 열린 연구 범위

- **연구 대상:** 일반 API 외 "AI 서비스" 취약점 분석의 구체 대상·방법.

---
*이 개요는 목표(what/why)를 고정한다. 구현 방식(how)은 `architecture.md`, 결정 근거는 `decisions.md`, 화면·발표 논리는 `ui-product-rationale.md`, 문헌·한계는 `research.md`를 참조한다.*
