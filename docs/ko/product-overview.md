# FlowScope 프로젝트 개요 (목표·범위)

> 사용자 확정 스코프("예상 아웃풋", 2026-08-24). 이 문서가 목표의 정본이며, `proposal.md`(초기 추정본)를 대체한다.

> **구현 상태(1.2.0-beta.41):** 값 없는 `Endpoint·Parameter Surface Delta`를 추가해 OpenAPI·HTML form·정적 JavaScript의 선언과 실제 H/S/L HTTP 관측을 분리하고, 이를 Web 기본 작업목록으로 표시한다. 기존 Resource/owner/BOLA·BFLA 그래프와 판정은 선택 API의 상세층으로 유지한다. 자동 회귀는 통과했지만 실제 Burp beta.41 재로드와 다양한 blind target의 endpoint·parameter precision/recall 평가는 아직 완료하지 않았다.

## 문제의식 (Premise)
웹/API 모의해킹의 첫 병목은 **수집한 요청 목록만 보고 아직 보지 못한 endpoint와 조건부 parameter를 알아내기 어렵다는 것**이고, 다음 병목은 권한·상태·객체 흐름을 사람이 머릿속으로 재구성해야 한다는 것이다. FlowScope는 선언 산출물과 실제 H/S/L Evidence의 차이를 먼저 작업목록으로 만들고, 선택한 API의 인가 관계를 그래프와 매트릭스로 연다.

## 핵심 접근
1. **Endpoint·Parameter Surface Delta**: 선언된 API·입력과 실제 Evidence를 값 없는 범용 key로 정렬해 source별 관측·미관측을 비교.
2. **인가 상세 그래프**: Burp 트래픽을 요청자·엔드포인트·객체 관계로 시각화하고, 고카디널리티 객체는 선택 API의 상세에서만 펼친다.
3. **3자 오버레이 비교**: 동일 타깃에 대해 **사람 vs ZAP 스캐너 vs LLM** 실제 트래픽을 같은 endpoint·parameter 좌표와 인가 좌표에서 비교.
4. **AI 선수+Judge**: LLM이 서버 격리 상태에서 독립적인 세 번째 점검 트래픽을 남긴 뒤, 잠긴 3자 차등과 Evidence를 종합해 **BOLA/IDOR·BFLA 시나리오**를 제안·검증한다. 최종 판정은 FlowScope 통제 실행기로 수집한 별도 검증 run의 반복 재현·정상 대조 Evidence를 서버가 확인한 경우에만 허용한다.
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
- **O1. 오버레이 소스 수 + LLM 역할 — ✅ 확정(2026-08-25 갱신):** 최종 완성형 = **3자 오버레이(사람/스캐너/AI) + AI Judge**. AI가 1인 2역:
  - **선수**: AI도 직접 공격 트래픽을 남겨 3자 겹침에 참여.
  - **Judge**: 서버가 잠근 3자 결과를 보고 시나리오를 제안하고 통제 요청으로 재현·대조.
  - **순환 방지:** Explorer가 활성화되면 서버가 HUMAN/SCANNER 상태와 후보를 숨긴다. 세 레인의 정확한 완료 뒤 snapshot을 잠가야 Judge가 읽는다.
  - **판정 경계:** 일반 assessment는 CONFIRMED가 될 수 없고, 최종 verdict는 현재 결정론 후보에 묶인 별도 VALIDATION run의 `CONTROLLED` 반복 재현·정상 대조 Evidence만 사용한다.
  - **ZAP 분리:** 기본 scanner lane은 SYSTEM이 passive 전체 rule·scope-only와 Traditional → Client → AJAX → passive queue → paginated Alert 순서를 결정하며 LLM이 임의로 기능을 선택하지 않는다.
- **O2. 연계 인터페이스 — ✅ 확정:** 로컬 MCP(상태/통제 target request/Evidence/ZAP/assessment/validation) + 관계형 `.flowscope.db` 내구 checkpoint + 호환 `.flowscope.json` import/export + 메모리 전용 account session broker.

## 계속 열린 연구 범위

- **O3. 타깃 범위:** 일반 API 외 "AI 서비스" 취약점 분석의 구체 대상·방법.

---
*이 개요는 목표(what/why)를 고정한다. 구현 방식(how)은 `architecture.md`, 결정 근거는 `decisions.md`, 화면·발표 논리는 `ui-product-rationale.md`, 문헌·한계는 `research.md`를 참조한다.*
