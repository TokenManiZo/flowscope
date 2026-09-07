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
- The old Explorer/Judge harness and MCP are removed (D-126). Do not recreate them implicitly. A separate Explorer harness and a future FlowScope Evidence MCP are not implemented.
- Historical LLM assessments/verdicts are read-only archive data, never current findings. Preserve their Evidence references and existing human audit records when loading/saving projects.
- Never persist, export, log, or expose through snapshots raw authorization headers, cookies, passwords, API keys, or provider tokens. Operator-requested live HTTP editing may retain bounded raw text only in current-process memory and must clear it on dataset replacement and unload.
- Active traffic must be exact-scope guarded. No ZAP Active Scan entry point is currently exposed. Keep existing explicit approval for definition imports and HUMAN Request Lab actions.
- Black-box coverage has no knowable denominator; never display a completion percentage.

Read `docs/ko/architecture.md`, `docs/ko/decisions.md`, and `README.md` before changing architecture. Read `docs/ko/ui-product-rationale.md` before changing UI labels, onboarding, graph/matrix behavior, or presentation claims. Append architecture decisions to `docs/ko/decisions.md`.

Build and test from the repository root with `mvn clean verify`.

## Change records and documentation

Read `docs/ko/HANDOFF.md` for current progress and `docs/ko/documentation-status.md` for the document inventory before starting work. Update current status when work starts, a material result or blocker appears, verification finishes, and work is handed off; do not wait until the final response. Separate implementation, automated verification, actual-runtime verification, and unstarted work. Keep historical results attached to their original artifact. Review every document for relevance, but do not rewrite unaffected history just to change its date.

Every code or behavior change must update `docs/ko/development-log.md` in the same work unit with:

- what was developed or fixed;
- why it was necessary and which alternative was rejected;
- the code, test, and documentation files affected;
- the reproducing regression and final verification result;
- remaining limitations and the next gate.

Also update the document that owns the changed contract:

- `README.md` for installation, operation, and user-visible behavior;
- `docs/ko/architecture.md` for the current data flow, modules, or invariants;
- `docs/ko/decisions.md` for material design/security choices and rejected alternatives;
- `CHANGELOG.md` for release-facing changes;
- `docs/ko/beta-validation.md` only for checks actually performed on the named artifact;
- `docs/ko/product-development-plan.md` for phase/gate state.
- `docs/ko/ui-product-rationale.md` for screen purpose, presentation narrative, and known UX debts.

Do not mechanically edit historical research, proposals, or the original specification when they are unaffected. Do not claim inherited, planned, or assumed validation as completed. If Git is available, keep the implementation, regression test, and matching documentation in one focused commit.
