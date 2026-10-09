# API-focused judgment matrix

The matrix lists one row per graph display API key, retaining original service/method/operation coordinates for each judgment. In object view, selecting the API or its account summary opens only that API's underlying OBJ rows. Selecting an OBJ account cell keeps the existing inspector, owner/Public controls and review IDs. Back restores the API list page and table scroll position. Latest request opens through a separate arrow button.

Summaries select an existing server cell, prioritizing human-confirmed, reproduced and suspicious evidence over normal results. Counts show the remaining result categories. They do not infer that all objects are normal from a single object. Backend recognition, ownership and judgment logic are unchanged.

Exclusion only affects matrix presentation. At API level it excludes all rows for that operation; in focused object view it excludes an exact operation/OBJ pair. An API-wide exclusion also hides subsequently discovered objects for that operation. Function and object views keep separate exclusions. Undo, individual restore and restore-all preserve requests, graph data, owner assignments and review records. The top counters still describe all server judgments, as explained by their information hint.

Exclusions are stored in this browser's localStorage, scoped to active project directory and ID. They are not written into project files or synchronized across browsers. If no active project or storage fails, the current screen retains the setting and indicates that it is temporary. Stored data is validated and bounded; the workspace remounts on project/dataset changes. Rendered matrix pages remain bounded to 50 rows and exclusion lookups use a Set.

Validation:
- TypeScript typecheck and all 875 frontend tests passed.
- 4 new browser cases cover dark/light at 600/1280px, API focus, object exclusion/undo, API exclusion persistence, restoration and keyboard selection.
- 3 existing browser cases cover matrix, observations and inspection at 600/1280/1920px.
- All browser API responses are synthetic local fixtures; no target requests or mutations are made.
- UI build and incremental offline JAR packaging passed. UI detector reported no findings.

## Status copy and contextual help

Status labels now distinguish `BOLA/IDOR 후보` / `BFLA 후보`, `접근 테스트 필요`, and `응답 확인 필요`. Owner/policy/configuration labels are shorter. All server statuses have a short explanation describing the reason and next action. Backend status values, authority, review IDs and summaries are unchanged.

Each table status has a separate question-mark control, outside the result-selection button, so opening help does not select a result or drill into an API. The inspector uses the same explanations. Keyboard Enter and Escape work; help popovers retain a 16px viewport margin in both themes and narrow screens.

Validation: 876 frontend tests, TypeScript checks, four dark/light browser cases at 600/1280px including help keyboard navigation and viewport bounds, UI build and offline JAR packaging passed. Detector reported no findings.

## Graph API grouping parity and readability

The initial API list grouped exact original operations and therefore split opaque IDs which the graph already collected under one API. The matrix now resolves `displayObjects.apiKey` and the graph's collapsed `apiFamily`, including query/body members of a family. When collected metadata is absent, it uses the graph's existing `operationShapeKey` fallback. Ambiguous collected mappings retain their original operation rather than being merged speculatively. The backend recognizer, OBJ hashes, owner settings, review IDs and endpoint policies are unchanged. Only core matrix rows participate.

Grouped rows retain their complete member operations. Drill-down includes all original operation/OBJ rows; latest-request navigation selects among member operations. Group-wide exclusions hide all members including subsequently collected members. Legacy exact-operation exclusions still apply. Fixed subroutes such as `/posts/recent`, services and methods stay separate according to graph metadata/shape rules.

Status and empty boxes share the same height, account columns have equal widths, status text is larger, and actions sit below the API path. Paths retain bounded wrapping and full hover/accessibility text. Dense summary counts are kept on one line with full text available on hover.

Validation: full 878-test frontend suite passed; after final typography changes all 46 matrix tests and TypeScript passed. Seven final browser cases passed across dark/light and 600/1280/1920px, including eight opaque original paths grouped under one API, unchanged original review ID, latest member request, whole-group exclusion/restoration, and equal status box heights. UI build/offline JAR packaging passed; detector found no issues.
