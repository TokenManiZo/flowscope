# FlowScope 프로젝트 개요 (목표·범위)

**현행 미출시 버전 1.2.0-beta.49(D-154~D-164, released beta.48 기반). 직전 유지보수 D-153/beta.48:** 호스트 JDBC 초기화 순서로 프로젝트 저장이 실패하는 결함을 수정한다. 제품의 목적·관측/선언/판정 축·ZAP/Explorer 기능 범위는 바꾸지 않는다. 새 산출물의 검증·게시 현황은 [HANDOFF](HANDOFF.md)를 따르며, 아래 beta.47 실물/배포 결과는 이전 산출물의 근거다.

> D-152(beta.47)에서 확정한 기능 범위(현행 유지): 초기 Judge·하네스 MCP 구성은 폐기한 상태를 유지하고, 판정 없는 독립 Codex Explorer를 별도 실행기로 제공한다. 다운로드 bundle·기능별 환경 점검·Explorer 준비상태 재확인을 제공하며, ZAP 계정 lane은 HUMAN Session Broker와 분리된 메모리 자격증명으로 ZAP Browser Based Authentication과 session auto-detect를 수행한다. ZAP API의 `OK`나 인증 시각이 아니라 같은 run·계정에서 관측한 인증 응답 Evidence가 사용자의 필수 로그인 성공 정규식과 일치할 때만 strict Client Spider 하나를 실행한다. 모든 ZAP lane은 bundle의 FlowScope Docker Chromium runtime과 `chrome-headless`를 사용한다. ZAP 일반 통신 실패는 3회 연속일 때 `UNREACHABLE`로 확정하며, 종료 정리는 `RUNNING / CLEANUP`으로 표시하고 정리가 끝난 뒤 최종 상태를 공개한다. 제품 MCP는 미구현이다.

> **직전 beta.47 구현·배포 기록:** 당시 테스트 Release가 게시됐다. `Endpoint·Parameter Surface Delta`는 OpenAPI·HTML form·JavaScript 선언과 실제 H/S/L 관측을 분리한다. Explorer는 현재 run의 실제 응답과 그 산출물 선언을 수집하며 취약점 verdict를 만들지 않는다. PR #11·#12의 파라미터 프로파일·Gap·관계 그래프·판정 매트릭스를 현재 Surface/Authorization 정본에 연결했다. beta.47은 별도 실제 ZAP fixture에서 익명·정상 두 계정·오류 비밀번호 거부를 확인했으며, 최종 main CI·패키지 UI 회귀도 통과했다. 이전 D-137의 Burp 8081 실행 결과를 새 JAR 검증으로 재사용하지 않는다. 실제 Burp hook·Windows 실기기·외부 대상 효능은 별도 미실측 범위다.

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
- **ZAP 실행 경계:** FlowScope Docker Chromium의 strict Client Spider → passive queue → Alert → cleanup 순서다. Traditional/AJAX와 자동 fallback은 없으며 Client 실패·범위 안 응답 0건을 성공으로 바꾸지 않는다. D-152는 cleanup 전 최종 상태 공개와 시작 응답 전 취소 경합을 보정했다. beta.47 별도 실물 fixture에서 익명·정상 두 계정 Client 63요청과 오류 비밀번호 거부를 확인했다. 실제 Burp hook과 Windows 실기기는 별도 gate다.

## 계속 열린 연구 범위

- **연구 대상:** 일반 API 외 "AI 서비스" 취약점 분석의 구체 대상·방법.

---
*이 개요는 목표(what/why)를 고정한다. 구현 방식(how)은 `architecture.md`, 결정 근거는 `decisions.md`, 화면·발표 논리는 `ui-product-rationale.md`, 문헌·한계는 `research.md`를 참조한다.*
