# FlowScope 프로젝트 개요 (목표·범위)

> 현재 제품 범위: 2026-09-08 D-133 반영. 초기 Judge·하네스 MCP 구성은 폐기한 상태를 유지하고, 판정 없는 독립 Codex Explorer를 별도 실행기로 구현했다. 다운로드 bundle·기능별 환경 점검·Explorer 준비상태 재확인을 제공하며, ZAP 계정 lane은 HUMAN Session Broker와 분리된 메모리 자격증명으로 ZAP Browser Based Authentication을 수행한 뒤 strict Client Spider 하나만 실행한다. FlowScope용 제품 MCP는 여전히 구현하지 않았다.

> **구현 상태(1.2.0-beta.45 미출시 소스):** 값 없는 `Endpoint·Parameter Surface Delta`가 OpenAPI·HTML form·JavaScript AST call-site 선언과 실제 H/S/L HTTP 관측을 분리한다. 새 Explorer는 로그인된 Codex와 exact-scope HTTP tool로 실제 LLM Evidence를 만들며 계정별 응답 차이와 미해결 항목을 남긴다. 취약점 verdict·Judge·LLM assessment는 만들지 않는다. ZAP 계정 lane은 별도 메모리 계정으로 Browser Based Authentication 성공을 확인한 뒤 계정별 crawler를 실행한다. 기존 Resource/owner/BOLA·BFLA 그래프와 판정은 `접근 대상 ID` 상세층으로 유지한다. 자동 회귀와 provider 하네스는 실제 Burp 재로드나 다양한 대상의 endpoint·parameter 효능 평가가 아니다.

## 문제의식 (Premise)
웹/API 모의해킹의 첫 병목은 **수집한 요청 목록만 보고 아직 보지 못한 endpoint와 조건부 parameter를 알아내기 어렵다는 것**이고, 다음 병목은 권한·상태·객체 흐름을 사람이 머릿속으로 재구성해야 한다는 것이다. FlowScope는 선언 산출물과 실제 H/S/L Evidence의 차이를 먼저 작업목록으로 만들고, 선택한 API의 인가 관계를 그래프와 매트릭스로 연다.

## 핵심 접근
1. **Endpoint·Parameter Surface Delta**: 선언된 API·입력과 실제 Evidence를 값 없는 범용 key로 정렬해 source별 관측·미관측을 비교.
2. **인가 상세 그래프**: Burp 트래픽을 요청자·엔드포인트·객체 관계로 시각화하고, 고카디널리티 객체는 선택 API의 상세에서만 펼친다.
3. **3자 오버레이 비교**: 동일 타깃에 대해 **사람 vs ZAP 스캐너 vs LLM** 실제 트래픽을 같은 endpoint·parameter 좌표와 인가 좌표에서 비교.
4. **판정과 이력 분리**: 현재 Evidence와 역할·소유자 정책에서 규칙 후보를 만들고 사람이 검토한다. 삭제된 LLM Judge의 평가·판정은 읽기 전용 이력으로만 보존하며 현재 결론으로 합치지 않는다.
5. **연계형**: IDOR를 대표 예시로 잡되, **여러 도구와 연계 가능한 형태**로 준비. AI 서비스/API 서비스 취약점 분석에 활용 가능한지 검토.
6. **Evidence 우선**: 트래픽 노이즈와 반복은 저장 단계에서 삭제하지 않고 class/disposition으로 분석 입력과 표시만 나눈다. 불확실한 신원·요청은 숨은 확정값으로 바꾸지 않고 `UNRESOLVED/REVIEW`로 노출한다.

## 초기 연구·공개 확장 목표 (현행 완료 기준 아님)

아래 논문·AI 제안·CVE·바운티 목표는 초기 제안의 기록이며 현재 기능이나 확보한 성과가 아니다. 당장의 완료 기준·미해결·검증 순서는 [HANDOFF](HANDOFF.md), 문서 정합성은 [전수 목록](documentation-status.md)을 따른다.
- **연구 정리**: 기술 보고서·논문 (사람 vs 스캐너 커버리지 비교, AI 시나리오 정확도 등).
- **오픈소스 공개**: 플로우 그래프 + 오버레이 + AI 제안 도구 → **GitHub Star** 획득.
- **CVE**: 도구로 발견한 취약점 제보 → CVE 발급.
- **바운티**: 취약점 제보 → 상금 (대상에 따라).

## 확장 검토
- 여러 도구와의 연계(interoperability) → 표준 내보내기/연동 지점 필요.
- AI 서비스 취약점 분석, API 서비스 취약점 분석 적용 가능성.

## 확정된 제품 범위
- **O1. 관측 비교:** HUMAN·SCANNER·LLM은 트래픽 생성 source다. HUMAN, ZAP, 독립 Explorer가 각각 실제 응답 Evidence를 만들며 과거 프로젝트의 LLM Evidence도 보존한다.
- **O2. 현재 연계:** Burp 수집·메모리 Session Broker·독립 `ZapCampaign`·Explorer account vault·Web·관계형 `.flowscope.db` 및 호환 JSON을 유지한다. MCP 서버와 Judge는 없다.
- **O3. Explorer 경계:** Explorer는 app-server dynamic HTTP tool을 exact-scope Montoya 전송에 연결해 endpoint·method·parameter·계정별 응답을 수집하며 판정하지 않는다. FlowScope Evidence용 제품 MCP는 별도 미구현 범위다.
- **ZAP 실행 경계:** 현재 새 캠페인은 strict Client Spider → passive queue → Alert만 실행한다. Traditional/AJAX Spider와 자동 fallback은 제거했으며, Client 실패·범위 안 응답 0건을 성공으로 바꾸지 않는다. 실제 Burp 8081을 통한 비로그인·로그인 Client 완주는 아직 실물 gate다.

## 계속 열린 연구 범위

- **연구 대상:** 일반 API 외 "AI 서비스" 취약점 분석의 구체 대상·방법.

---
*이 개요는 목표(what/why)를 고정한다. 구현 방식(how)은 `architecture.md`, 결정 근거는 `decisions.md`, 화면·발표 논리는 `ui-product-rationale.md`, 문헌·한계는 `research.md`를 참조한다.*
