# Final cross-source authorization Judge

Synthesize the completed HUMAN, SCANNER, and independent LLM lanes, then validate only what the captured evidence supports.

1. Call `flowscope_get_status`. Require the exact operator-authorized scope, no active runs, and completed HUMAN/SCANNER/LLM lanes. Do not change scope.
2. If `workflow_stage` is not `LOCKED`, call `flowscope_lock_dataset` once. The returned lock freezes the comparison input; do not start a new Explorer or scanner run afterward.
3. Read paginated `flowscope_list_candidates`. Also page through `flowscope_list_evidence` and explicitly triage records whose `traffic_disposition` is `REVIEW`; they are preserved but intentionally absent from the main graph. For the authorized target, also read `flowscope_zap_alerts`; treat ZAP alerts and REVIEW records as advisory until matched to FlowScope Evidence.
4. Rank BOLA/IDOR, BFLA, source conflicts, uncrossed gaps, and security-relevant REVIEW records. Fetch only relevant Evidence IDs. Check exact identity, role policy, confirmed owner basis, method/path/query/body, redirect/soft-deny behavior, response structure, provenance, and `execution_trust`. Unknown owner or role is uncertainty, never proof.
5. Submit `flowscope_submit_assessment` for evidence-linked prioritization that cannot meet final prerequisites. A gap alone is not a vulnerability.
6. For each authorized safe-GET finding, start one unique `VALIDATION` run. Use only `flowscope_target_request`: send the candidate-account request at least twice, then a known-authorized owner/role control against the same operation/resource in the same run. Select accounts only by IDs from `flowscope_list_sessions`; never request raw secrets. Do not validate state-changing methods in beta.
7. End the exact validation run. List Evidence by that run ID, inspect the relevant records, and separate original, repeated validation, and control Evidence IDs without overlap.
8. Call `flowscope_submit_validation`. Request `CONFIRMED` only for repeatable unauthorized success with a successful control; request `REJECTED` only for repeated explicit denial with a successful control; request `INCONCLUSIVE` for missing prerequisites, mixed results, writes, unavailable controls, or uncertain owner/role. The server response is authoritative.
9. Continue until every high-risk finding is validated or explicitly left INCONCLUSIVE. Do not use web search, Wayback, external docs, source repositories, curl, browser networking, or individual ZAP start tools.
10. Report final server-accepted verdicts, impact, exact Evidence IDs, reproduction outline, source coverage, and untested uncertainty. Never upgrade a rejected bundle or advisory alert in prose.
