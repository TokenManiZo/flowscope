# Contributing

FlowScope accepts focused bug fixes and features that preserve its evidence and provenance model.

1. Read `../../AGENTS.md`, `../ko/architecture.md`, and `../ko/decisions.md`. For UI, onboarding, copy, or presentation changes, also read `../ko/ui-product-rationale.md`.
2. Create a small change with a regression test. Do not refactor unrelated code.
3. Append the work to `../ko/development-log.md`: what changed, why, affected files, verification, and remaining limits.
4. Update only the documentation whose contract is affected: README for users, architecture for current structure, decisions for material choices, changelog for release-visible changes, validation for checks actually performed, and the product plan for gate status.
5. Run `mvn clean verify` from the repository root on JDK 21.
6. Confirm the release JAR does not bundle Montoya API classes and does include third-party license notices.
7. Describe the security and false-positive impact in the pull request.

Do not submit real target traffic, credentials, tokens, customer names, or proprietary API schemas. Use synthetic fixtures.

Architectural changes must preserve these invariants:

- source and orchestrator remain independent;
- LLM prose cannot confirm a finding; only a server-accepted current controlled Evidence bundle can produce a final verdict;
- active requests require exact scope and appropriate approval;
- raw authentication material is never persisted, logged, or exposed; it may exist only in the explicit memory-only Session Broker lifecycle;
- no black-box coverage percentage is presented.

## Git and documentation discipline

- Use one focused commit per coherent behavior change. Include its regression test and matching documentation in the same commit.
- Do not mix formatting, unrelated cleanup, generated `target/` files, local `.flowscope.json` projects, credentials, or target traffic into a product commit.
- Commit messages should state the behavior, for example `fix: reject suspect broker sessions`, not a vague activity such as `update files`.
- Never rewrite `../ko/beta-validation.md` to claim a check inherited from an older artifact. Record the exact version, command/environment, result, and anything not run.
- When no documentation file is affected, state why in the change/PR record instead of silently omitting the review.
