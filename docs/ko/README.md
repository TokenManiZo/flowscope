# FlowScope 한국어 문서

프로젝트의 기본 문서는 한국어입니다. 설치와 사용 방법은 저장소 루트의 [README](../../README.md)를 먼저 확인하세요. 영어 문서는 [docs/en](../en/README.md)에 분리되어 있습니다.

현재 진행상황은 [팀 인계 정본](HANDOFF.md), 문서별 정본·역사 구분과 점검 결과는 [문서 정합성·갱신 기준](documentation-status.md)에서 확인합니다.

현재 배포는 beta.47입니다. 팀원은 [첫 실행 가이드](team-quick-start.md)를 사용하세요. 비공개 저장소의 다운로드에는 협업 권한이 있는 본인 GitHub 계정 로그인이 필요합니다.

## 현재 전환 상태

Judge·기존 Explorer 하네스·MCP 실행 경로는 제거한 상태를 유지합니다(D-126). D-128은 MCP나 브라우저를 복원하지 않고 Codex app-server dynamic tool과 Java exact-scope gateway로 독립 Explorer를 새로 구현했습니다. D-135는 ZAP을 bundle의 FlowScope Docker Chromium 단일 runtime과 `chrome-headless` Client Spider로 고정했습니다. HUMAN·ZAP과 H/S/L 비교는 유지하며 Explorer는 취약점 판정을 만들지 않습니다. 과거 연구·명세의 Judge/MCP 및 ZAP Desktop/Firefox 선택 경로는 현재 기능 안내가 아닙니다.

## 문서 목록

- [Judge·MCP 제거 및 후속 경계](mcp-judge-removal-plan.md): 삭제·보존 범위, 회귀 결과와 다음 gate
- [LLM Explorer](llm-explorer.md): 현재 실행 구조, 메모리 인증, exact-scope 경계, 사용법과 남은 gate
- [팀 인계 정본](HANDOFF.md): 현재 구현, 코드 지도, 알려진 결함, 다음 작업 순서와 완료 기준
- [이전 인계 보존본](handoff-2026-09-04.md): 2026-09-04 기준 상세 연혁·리뷰·실행법. 현행 작업 지시가 아님
- [문서 정합성·갱신 기준](documentation-status.md): 저장소 Markdown 전수 목록, 이번 정정·검증 범위와 갱신 시점
- [설치·첫 실행](getting-started.md): Release JAR, Burp listener, FlowScope Docker Chromium ZAP, 환경 점검
- [팀원 첫 실행](team-quick-start.md): ZIP 선택, Windows/macOS 준비 순서, 계정별 환경 점검, 업데이트
- [아키텍처](architecture.md): 구성 요소, 데이터 흐름, 신뢰 경계
- [설계 결정](decisions.md): 주요 판단과 선택 근거
- [개발 기록](development-log.md): 변경 내용, 이유, 검증 결과
- [제품 개요](product-overview.md): 문제 정의와 제품 범위
- [리서치](research.md): 참고 기술과 근거
- [그래프 UX](graph-ux.md): 초기 Swing/JGraphX 조사 기록. 현재 구현 계획은 아님
- [UI·제품 근거](ui-product-rationale.md): 화면 설계 이유
- [제품 개발 계획](product-development-plan.md): 단계별 개발 계획
- [Endpoint·Parameter Surface Delta](endpoint-parameter-surface.md): API·입력 선언/관측 사실 모델, 범용 추출 경계와 블라인드 검증 계획
- [백엔드 Evidence·분석 재정비 계획](backend-evidence-architecture-plan.md): 과거 백엔드 재정비 계획. Judge/MCP·dataset lock 지시는 D-126에서 폐기
- [제안서](proposal.md): 연구 가설·평가 설계. 현재 제품 동작 정본은 아님
- [베타 검증](beta-validation.md): 현재 베타 검증 증거
- [기능 명세](specification/functional-spec.md): 원 기능 요구사항과 이후 대체 관계. 현재 구현·완료를 뜻하지 않음

## 문서 원칙

- 현재 구현과 검증 결과만 사실로 기록합니다.
- 계획, 미구현 기능, 알려진 한계를 구현 완료처럼 표현하지 않습니다.
- 설계나 동작이 바뀌면 관련 문서와 변경 기록을 같은 변경에서 갱신합니다.
- 시작·중간 결과/차단·검증·인계 시 상태가 달라지면 HANDOFF·해당 계획·개발 기록을 즉시 갱신합니다.
- 변경 이력과 과거 버전 절은 당시 사실을 보존하며, 현재 계약과 우선순위는 `HANDOFF.md`, `architecture.md`, `beta-validation.md`의 최신 절을 따릅니다.
- 로컬 트래픽, 인증 정보, 생성 산출물은 공개 문서나 저장소에 포함하지 않습니다.
