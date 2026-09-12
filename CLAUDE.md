# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# 프로젝트 지침 — FlowScope (project-specific, 위 규칙과 병합)

사람·스캐너·LLM 세 소스의 API 점검 트래픽을 한 그래프에 겹쳐 비교해 **IDOR 등 인가 취약점**을 찾는 도구. 화이트햇스쿨 2단계 팀 프로젝트(토큰많이조). 대화·설명은 한국어.

**현재 단계: 제품 구현·하드닝.** 사용자가 제품 완성을 승인했다. 기능 변경은 테스트로 고정하고, 아키텍처 결정은 결정로그에 append한 뒤 `mvn clean verify`로 검증한다.

이 파일은 제품 개발 지침이며 진단 프롬프트가 아니다. 기존 Judge·Explorer 하네스·MCP와 `agent-workspace`는 D-126에서 삭제했다. 새 Explorer 하네스와 FlowScope Evidence용 MCP는 별도 설계 대기이며, 현재 구현하거나 옛 실행기를 복원하지 않는다. HUMAN·ZAP 실행과 H/S/L 관측 데이터·과거 LLM 읽기 전용 이력은 보존한다.

새 Claude 작업자는 코드를 수정하기 전에 반드시 `docs/ko/HANDOFF.md`의 **현재 인수인계 상태**, **미해결 결함**, **실환경 gate**, **제품 결정 보류 사항**을 끝까지 읽는다. 과거 대화 요약이나 오래된 버전 문구보다 현재 코드·테스트·`beta-validation.md`를 우선한다.

## 먼저 읽을 것
- `docs/ko/architecture.md` — 데이터 모델·파이프라인·모듈 계약 (어떻게)
- `docs/ko/decisions.md` — 모든 설계 결정 + 검토한 대안 + 기각 이유 (D-000~). **새 결정은 반드시 여기 append**
- `docs/ko/specification/functional-spec.md` — 기능명세서 F-01~F-24
- `docs/ko/ui-product-rationale.md` — 화면별 사용자 질문·설계 이유·발표 논리·현재 UX 부채
- `README.md` — 사용자 설치·운영·신뢰 경계

## 핵심 용어 — 두 축은 직교한다 (D-001)
- **source** = 탐지 수단 {human, scanner, llm} → **3-way 비교 축** ("누가 발견/놓쳤나")
- **idn** = 요청자 · **role** = 권한 {User/LV1/LV2/Admin/Unknown} → **취약 판정 축**
- **op** = 정규화 엔드포인트 · **resource** = 자원(`orders:101`) · **owner** = 소유자(속성, 노드 아님)
- **verdict 5종**: allow/deny/suspicious(=IDOR후보)/undecided/untested · **갭 3종**: 미교차/일부만발견/불일치
- **재전송(resend)** = 소스 아님, 별도 격리 (D-008)

## 척추
- **판정 오라클**: status 단독 금지 → status taxonomy + owner + 응답 본문(타 소유 객체 포함 여부) (D-004/013/015)
- **소유자 추정**: 본문 소유필드 1순위 → F-06 신뢰도 → 최후에만 first-accessor, 부족하면 미확정→판정 제외 (D-005/012)

## 하지 말 것 (프로토타입에서 실측 검증된 함정)
- ❌ `owner = 첫 2xx 신원` — 공격자가 먼저 관측되면 IDOR가 뒤집힘 (D-012)
- ❌ 쓰기(POST/PUT/PATCH/DELETE) 2xx를 빈 본문이라 undecided 강등 — 쓰기형 IDOR 미탐 (D-013)
- ❌ role을 토큰 substring(`/adm/`)으로 자동추정 — 명세 F-10 위반 (D-018)
- ❌ 3xx·soft-403(200+error 본문)을 성공 처리 (D-015)
- ❌ 대상 응답 본문을 `innerHTML` 직접 삽입 — 자기 XSS, `textContent`/escape 사용 (D-020)
- ❌ 커버리지 퍼센트 (블랙박스, 분모 불가지) (D-002) · ❌ 미교차를 전체 조합 공간에서 산출 (D-003)

## 구축 순서 (D-011, D-049, D-053~D-055)
L0 그래프(수집+정규화+시각화, 오라클 불필요) → L1 IDOR 최소(소유자+타인접근) → L2 풀 비교(미교차·불일치·5-state+BFLA)는 초기 계층 설계다. 현재 기본 화면은 Endpoint·Parameter Surface Delta이며 인가 그래프는 상세층이다. 현재 규칙 후보와 사람 검토를 Evidence에 연결하고, 과거 LLM assessment/validation은 읽기 전용 이력으로 분리한다. 자동 Judge와 최종 verdict 제출 gate는 제거됐다.

## 작업 방식
- **결정로그 디스코플린**: 선택할 때 "더 나은 방식 있나?"를 묻고, 있으면 교체·없으면 **기각 이유를 결정로그에 기록**. 리뷰 지적도 코드에서 검증 후 반영.
- **현재는 beta.48 SQLite 연결 수정·검증·팀원 배포 단계(D-153)** — 상태의 정본은 `docs/ko/HANDOFF.md`다. beta.46의 원격 CI 후속 실패와 수정 검증을 분리하며, 새 산출물의 실제 Burp·Windows 결과는 자동/Standalone/별도 ZAP fixture 결과와 구분한다. 제거한 Judge/MCP 실행이나 ZAP Desktop/Firefox 경로를 다음 gate로 안내하지 않는다. 알려진 정답·풀이를 미리 보지 않으며, 자동 회귀나 직접 Client 1건을 대상 탐색 성공·독립 benchmark 효과로 확대하지 않는다.

## 변경 기록과 문서 동기화

작업 시작, 중간 결과·차단 발견, 검증 종료, 인계 때 상태가 달라지면 `docs/ko/HANDOFF.md`와 해당 계획·개발 기록을 같은 작업 단위에서 갱신한다. 문서 전수 목록과 적용 범위는 `docs/ko/documentation-status.md`를 따른다. 구현 완료·자동 회귀 통과·실환경 통과·미착수를 구분하고, 과거 계획의 명령·테스트 수·버전 문구를 현행으로 재사용하지 않는다.

모든 코드·동작 변경은 같은 작업 단위에서 `docs/ko/development-log.md`에 개발/수정 내용, 이유, 영향 파일, 회귀·최종 검증, 남은 한계를 기록한다. 사용자 동작은 `README.md`, 현재 구조는 `docs/ko/architecture.md`, 설계 선택·기각 이유는 `docs/ko/decisions.md`, 화면·발표 논리는 `docs/ko/ui-product-rationale.md`, 릴리스 변경은 `CHANGELOG.md`, 실제 수행한 검증만 `docs/ko/beta-validation.md`, 단계 변화는 `docs/ko/product-development-plan.md`에 함께 반영한다. 관련 없는 역사 문서를 형식적으로 고치지 말고, 계획·추정·이전 산출물의 결과를 현재 검증처럼 기록하지 않는다. Git을 사용할 수 있으면 구현·회귀 테스트·관련 문서를 하나의 기능 단위 커밋에 포함한다.
