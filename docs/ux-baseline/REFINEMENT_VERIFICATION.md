# UI refinement verification — 2026-10-03

Branch: `codex/ux-accounts-evidence`; previous implementation: `e6c0f0b`. QA_TEMP is unchanged. Existing unrelated working-tree edits are excluded.

## Approved direction

- LLM: six browser metrics in three columns and two rows; short stop criterion; screen-state-query explanation behind a question-mark tooltip. Existing activity feed and execution controls remain in place.
- ZAP: preserve the existing account table and login settings buttons, adding a separate fold control. The proposed extra enclosing box was rejected by the user.
- API: one filter button opens source choices and comparison state. Aggregation floats over the page. The standalone toolbar was rejected by the user: filter and aggregation controls now sit inside the API comparison table header, restoring one coherent table box. No search field was added.
- API/Evidence detail: use the graph inspector's header structure without editing the graph, align metadata, distinguish recorded responses by ordinal/account/path/status, and fold supporting provenance and policy controls. Masked request and response precede retention metadata.

Before/after desktop mockups were shown in light/dark at 1280×720 and 1920×1080 before implementation. The user approved the direction and supplied the corrections above. The final correction explicitly places both controls in the API comparison box header instead of floating above the table.

## Automated verification performed

- Focused regression suite: 65 tests passed; TypeScript check passed.
- Final repository-root `mvn clean verify`: frontend 618 tests in 78 files passed; Java 792 tests, one failure, zero errors, three skipped. `JavascriptAnalysisProcessTest.timedOutWorkerIsKilledAndTheFollowingRequestSucceeds` exceeded the existing one-second worker startup limit during concurrent browser QA (expected PARSED, received LIMIT_EXCEEDED).
- `mvn -Dtest=JavascriptAnalysisProcessTest test` afterward: BUILD SUCCESS; all six process tests passed, frontend verification also passed. No Java or timeout behavior was changed.
- A preceding full run before the final API header placement had BUILD SUCCESS (792 Java tests, zero failures/errors, three skipped); it is not presented as a completed full-suite pass of the final placement. At the user's request to proceed quickly and perform QA personally, no further full-suite repetition was started.
- An earlier sandboxed Maven attempt could not open local test sockets and failed. The completed run used the required local socket permissions.
- `graphify update .`: code graph refreshed; AST only.
- Focused layout detector: no findings.

## Built web verification performed

`refinement-actual-check.mjs` runs the compiled React application against a read-only local fixture server. Both themes and both desktop sizes cover account counts, HUMAN handoff, LLM activity/transmission states, API inputs and masked Evidence, plus:

- six LLM metrics in exactly three columns and two rows; help tooltip reachable by keyboard;
- ZAP fold/reopen retains selection and restores existing settings buttons;
- filter popup exposes both source and comparison conditions; selection changes the list and resets correctly;
- source choices survive popup dismissal/reopening; Escape restores filter-button focus;
- opening filters/aggregate does not change toolbar height;
- no document horizontal overflow, console errors, external requests or real POST mutations.

Results: `refinement-product-verification.json`. Captures: `refinement-actual-captures/`. Mockup checks and before/after captures are separate: `refinement-verification.json`, `refinement-captures/`.

Manual visual review inspected the built LLM, ZAP, API and Evidence screens together. Review URL: http://127.0.0.1:18844/actual/#surface. Before/after mockup URL: http://127.0.0.1:18844/refinement.html?screen=surface.

## Limitations

The web fixture is fictional, explicitly marked, masked and read-only. It verifies the built UI, not live Burp/ZAP/Codex integration. Actual integration execution was not performed. Mobile is excluded. No QA_TEMP merge or remote push has been performed; merging requires separate user approval.
