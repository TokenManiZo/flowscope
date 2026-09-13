# 기여 가이드

FlowScope는 Evidence와 provenance 모델을 보존하는 범위에서 작고 명확한 버그 수정과 기능 기여를 받습니다. 영문 가이드는 [`docs/en/CONTRIBUTING.md`](docs/en/CONTRIBUTING.md)에 있습니다.

1. `AGENTS.md`, `docs/ko/architecture.md`, `docs/ko/decisions.md`를 읽습니다. UI·onboarding·문구·발표 변경이면 `docs/ko/ui-product-rationale.md`도 읽습니다.
2. 회귀 테스트를 포함한 최소 변경을 만듭니다. 관련 없는 코드는 refactor하지 않습니다.
3. `docs/ko/development-log.md`에 변경 내용, 이유, 영향 파일, 검증, 남은 한계를 추가합니다.
4. 계약이 바뀐 문서만 갱신합니다. 사용자 동작은 루트 README, 현재 구조는 architecture, 중요한 선택은 decisions, release 변화는 changelog, 실제 수행 검증은 beta validation, gate 상태는 product plan이 정본입니다.
5. 저장소 루트에서 JDK 21 정확히와 Maven 3.9.x로 `mvn clean verify`를 실행합니다. 빌드 JDK와 이미 빌드된 JAR의 실행 JDK 범위를 혼동하지 않습니다.
6. release JAR에 Montoya API class가 포함되지 않고 third-party license notice가 포함되는지 확인합니다.
7. Pull Request에 보안 영향과 오탐·미탐 영향을 적습니다.

실제 대상 트래픽, credential, token, 고객명, proprietary API schema를 제출하지 마십시오. synthetic fixture를 사용합니다.

아키텍처 변경은 다음 불변 조건을 지켜야 합니다.

- source와 orchestrator는 독립적입니다.
- 현재 Judge·MCP·옛 브라우저 실행기는 제거된 상태입니다(D-126). D-128 독립 Codex Explorer는 dynamic HTTP tool로 실제 관측만 만들며 판정하지 않습니다. 이전 LLM 평가·판정은 읽기 전용 이력이고 FlowScope용 제품 MCP는 별도 미구현 계획입니다.
- active request에는 exact scope와 필요한 승인이 적용됩니다.
- raw 인증정보는 저장·로그·노출하지 않습니다. 명시적 메모리 전용 Session Broker lifecycle에서만 존재할 수 있습니다.
- 블랙박스 커버리지 퍼센트를 표시하지 않습니다.

## Git과 문서 규칙

- 작업 시작·중간 결과/차단·검증·인계 시점의 상태는 [현재 인계](docs/ko/HANDOFF.md)와 해당 계획·개발 기록에 갱신합니다. [문서 전수 목록](docs/ko/documentation-status.md)을 확인하고 현재 계약과 과거 기록을 구분합니다. 문서 전용 수정은 수행한 링크·코드 대조만 기록하며 이전 빌드를 새 검증으로 쓰지 않습니다.
- 하나의 일관된 동작 변경마다 focused commit 하나를 사용하고, 회귀 테스트와 관련 문서를 같은 commit에 포함합니다.
- formatting, 관련 없는 cleanup, 생성된 `target/`, 로컬 `.flowscope.json`, credential, 대상 트래픽을 제품 commit에 섞지 않습니다.
- commit message는 `fix: reject suspect broker sessions`처럼 바뀐 동작을 나타내며 `update files` 같은 모호한 표현을 피합니다.
- 이전 artifact의 검증을 현재 artifact의 결과처럼 `docs/ko/beta-validation.md`에 기록하지 않습니다. 정확한 version, command·environment, 결과, 실행하지 않은 항목을 구분합니다.
- 변경과 관련된 문서가 없다면 PR 기록에 그 이유를 명시합니다.
