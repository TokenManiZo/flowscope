# FlowScope documentation

The repository root [`README.md`](../README.md) is the canonical installation and operating guide.

- [`architecture.md`](architecture.md) — current data model, pipeline, UI, security boundaries, and module map.
- [`decisions.md`](decisions.md) — architecture decisions, rejected alternatives, validation history, and inherited limitations.
- [`development-log.md`](development-log.md) — work-by-work record of what changed, why, affected files, verification, and remaining gates.
- [`product-overview.md`](product-overview.md) — current product objective and research scope.
- [`research.md`](research.md) — related work, evidence strength, and explicit limitations.
- [`graph-ux.md`](graph-ux.md) — graph interaction research and the rationale behind the current visual model.
- [`product-development-plan.md`](product-development-plan.md) — reviewed 1.2 implementation and verification plan.
- [`proposal.md`](proposal.md) — historical research proposal; it does not override the current product overview.
- [`specification/functional-spec.md`](specification/functional-spec.md) — original F-01–F-24 requirements and reference images; current behavior is defined by the architecture and code.

Office/PDF review packages, obsolete prototype copies, build outputs, and machine-specific MCP configuration are intentionally excluded from the public repository.

## Documentation contract

- Update the root `README.md` when installation, operation, or user-visible trust boundaries change.
- Update `architecture.md` when the current module/data flow or invariant changes.
- Append to `decisions.md` when choosing among material alternatives or changing a security boundary.
- Append to `development-log.md` for every code or behavior change, including the reason, affected files, verification, and remaining limitation.
- Update `CHANGELOG.md` for release-facing changes and `beta-validation.md` only with checks actually performed on the named artifact.
- Update `product-development-plan.md` when a phase or gate changes state.

Historical research, the original functional specification, and the proposal are not mechanically rewritten for unrelated implementation changes. Their historical status is preserved and current documents link to superseding decisions.
