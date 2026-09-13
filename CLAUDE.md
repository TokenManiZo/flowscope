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

**현재 단계: 제품 구현·하드닝.** 기능 변경은 테스트로 고정하고 `mvn clean verify`로 검증한다. 중요한 설계 선택과 기각한 대안은 커밋 또는 PR 설명에 남긴다.

이 파일은 제품 개발 지침이며 진단 프롬프트가 아니다. 기존 Judge·Explorer 하네스·MCP와 `agent-workspace`는 D-126에서 삭제했다. 새 Explorer 하네스와 FlowScope Evidence용 MCP는 별도 설계 대기이며, 현재 구현하거나 옛 실행기를 복원하지 않는다. HUMAN·ZAP 실행과 H/S/L 관측 데이터·과거 LLM 읽기 전용 이력은 보존한다.

새 Claude 작업자는 수정 전에 `AGENTS.md`, `README.md`, 영향받는 코드와 테스트를 확인한다. 오래된 대화 요약보다 현재 코드와 테스트를 우선한다.

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
- **설계 결정 규율**: 선택할 때 "더 나은 방식 있나?"를 묻고, 있으면 교체·없으면 기각 이유를 커밋 또는 PR 설명에 기록한다. 리뷰 지적도 코드에서 검증 후 반영한다.
- 자동 회귀, Standalone, 별도 ZAP fixture, 실제 Burp·Windows 결과를 구분한다. 제거한 Judge/MCP 실행이나 ZAP Desktop/Firefox 경로를 복원하지 않으며, 제한된 실측을 전체 효능으로 확대하지 않는다.

## 변경 기록

구현·회귀 테스트·필요한 README 수정은 한 기능 단위 커밋에 포함한다. 커밋 또는 PR 설명에 이유, 영향 범위, 실제 수행한 검증, 남은 한계를 기록하고 자동 검증과 실환경 검증을 구분한다.
