# FlowScope contributor instructions

These rules apply to the repository. Keep changes minimal, evidence-driven, and testable.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them; don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No flexibility or configurability that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't improve adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it; don't delete it.

When your changes create orphans:

- Remove imports, variables, and functions that your changes made unused.
- Don't remove pre-existing dead code unless asked.

Every changed line must trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- Add validation → write tests for invalid inputs, then make them pass.
- Fix the bug → write a test that reproduces it, then make it pass.
- Refactor X → ensure tests pass before and after.

For multi-step work, use this form:

1. Step → verify: check
2. Step → verify: check
3. Step → verify: check

Strong success criteria let you loop independently. Weak criteria require clarification.

These guidelines are working when diffs contain fewer unnecessary changes, implementations need fewer rewrites, and material ambiguity is resolved before coding.

## Product invariants

- `source` is the traffic generator: `HUMAN`, `SCANNER`, `LLM`. It is not identity or role.
- `orchestrator` is independent. ZAP started by an LLM remains `source=SCANNER, orchestrator=LLM`.
- Do not claim a vulnerability from status alone. BOLA/BFLA need stored Evidence plus owner/role policy.
- The old Explorer/Judge harness and MCP are removed (D-126). Do not recreate them implicitly. The separate Explorer implemented in D-128/D-139 remains in place; the future FlowScope Evidence MCP is not implemented.
- Historical LLM assessments/verdicts are read-only archive data, never current findings. Preserve their Evidence references and existing human audit records when loading/saving projects.
- Never persist, export, log, or expose through snapshots raw authorization headers, cookies, passwords, API keys, or provider tokens. Operator-requested live HTTP editing may retain bounded raw text only in current-process memory and must clear it on dataset replacement and unload.
- Active traffic must be exact-scope guarded. No ZAP Active Scan entry point is currently exposed. Keep existing explicit approval for definition imports and HUMAN Request Lab actions.
- Black-box coverage has no knowable denominator; never display a completion percentage.

Read `README.md` and the affected code and tests before changing architecture or user-visible behavior. Record material design choices and rejected alternatives in the commit or pull-request description.

Build and test from the repository root with `mvn clean verify`.

## Change records

- Keep each implementation, regression test, and necessary README update in one focused commit.
- Update `README.md` only when installation, operation, or user-visible behavior changes.
- In the commit or pull-request description, state the reason, affected area, verification performed, and remaining limitations.
- Separate automated verification from actual-runtime verification, and never present inherited or planned checks as completed.
