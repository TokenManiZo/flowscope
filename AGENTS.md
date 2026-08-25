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
- Ordinary LLM assessments may be `LIKELY`, `INCONCLUSIVE`, or `REJECTED`; they are never final.
- A final LLM verdict may be `CONFIRMED`, `INCONCLUSIVE`, or `REJECTED` only when the server accepts a current, Evidence-bound reproduction and authorized-control bundle. Human records remain audit/override inputs.
- Never store raw authorization headers, cookies, passwords, API keys, or provider tokens.
- Active traffic must be exact-scope guarded. ZAP Active Scan requires an explicit Burp confirmation.
- Black-box coverage has no knowable denominator; never display a completion percentage.

Read `docs/architecture.md`, `docs/decisions.md`, and `README.md` before changing architecture. Read `docs/ui-product-rationale.md` before changing UI labels, onboarding, graph/matrix behavior, or presentation claims. Append architecture decisions to `docs/decisions.md`.

Build and test from the repository root with `mvn clean verify`.

## Change records and documentation

Every code or behavior change must update `docs/development-log.md` in the same work unit with:

- what was developed or fixed;
- why it was necessary and which alternative was rejected;
- the code, test, and documentation files affected;
- the reproducing regression and final verification result;
- remaining limitations and the next gate.

Also update the document that owns the changed contract:

- `README.md` for installation, operation, and user-visible behavior;
- `docs/architecture.md` for the current data flow, modules, or invariants;
- `docs/decisions.md` for material design/security choices and rejected alternatives;
- `CHANGELOG.md` for release-facing changes;
- `docs/beta-validation.md` only for checks actually performed on the named artifact;
- `docs/product-development-plan.md` for phase/gate state.
- `docs/ui-product-rationale.md` for screen purpose, presentation narrative, and known UX debts.

Do not mechanically edit historical research, proposals, or the original specification when they are unaffected. Do not claim inherited, planned, or assumed validation as completed. If Git is available, keep the implementation, regression test, and matching documentation in one focused commit.
