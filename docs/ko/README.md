# FlowScope 한국어 문서

프로젝트의 기본 문서는 한국어입니다. 설치와 사용 방법은 저장소 루트의 [README](../../README.md)를 먼저 확인하세요. 영어 문서는 [docs/en](../en/README.md)에 분리되어 있습니다.

## 문서 목록

- [팀 인계 정본](HANDOFF.md): 현재 구현, 코드 지도, 알려진 결함, 다음 작업 순서와 완료 기준
- [설치·첫 실행](getting-started.md): Release JAR, Burp listener, ZAP Docker/Desktop, 구독 CLI, 환경 점검
- [아키텍처](architecture.md): 구성 요소, 데이터 흐름, 신뢰 경계
- [설계 결정](decisions.md): 주요 판단과 선택 근거
- [개발 기록](development-log.md): 변경 내용, 이유, 검증 결과
- [제품 개요](product-overview.md): 문제 정의와 제품 범위
- [리서치](research.md): 참고 기술과 근거
- [그래프 UX](graph-ux.md): 초기 Swing/JGraphX 조사 기록. 현재 구현 계획은 아님
- [UI·제품 근거](ui-product-rationale.md): 화면 설계 이유
- [제품 개발 계획](product-development-plan.md): 단계별 개발 계획
- [백엔드 Evidence·분석 재정비 계획](backend-evidence-architecture-plan.md): HUMAN 수집 정본부터 3-way 검증까지의 단계별 구현·삭제·검증 계획
- [제안서](proposal.md): 연구 가설·평가 설계. 현재 제품 동작 정본은 아님
- [베타 검증](beta-validation.md): 현재 베타 검증 증거
- [기능 명세](specification/functional-spec.md): 기능별 요구사항

## 문서 원칙

- 현재 구현과 검증 결과만 사실로 기록합니다.
- 계획, 미구현 기능, 알려진 한계를 구현 완료처럼 표현하지 않습니다.
- 설계나 동작이 바뀌면 관련 문서와 변경 기록을 같은 변경에서 갱신합니다.
- 변경 이력과 과거 버전 절은 당시 사실을 보존하며, 현재 계약과 우선순위는 `HANDOFF.md`, `architecture.md`, `beta-validation.md`의 최신 절을 따릅니다.
- 로컬 트래픽, 인증 정보, 생성 산출물은 공개 문서나 저장소에 포함하지 않습니다.
