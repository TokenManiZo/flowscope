# API-focused judgment matrix

The matrix lists one row per complete API operation (service, method and endpoint). In object view, selecting the API or its account summary opens only that API's underlying OBJ rows. Selecting an OBJ account cell keeps the existing inspector, owner/Public controls and review IDs. Back restores the API list page and table scroll position. Latest request opens through a separate arrow button.

Summaries select an existing server cell, prioritizing human-confirmed, reproduced and suspicious evidence over normal results. Counts show the remaining result categories. They do not infer that all objects are normal from a single object. Backend recognition, ownership and judgment logic are unchanged.

Exclusion only affects matrix presentation. At API level it excludes all rows for that operation; in focused object view it excludes an exact operation/OBJ pair. An API-wide exclusion also hides subsequently discovered objects for that operation. Function and object views keep separate exclusions. Undo, individual restore and restore-all preserve requests, graph data, owner assignments and review records. The top counters still describe all server judgments, as explained by their information hint.

Exclusions are stored in this browser's localStorage, scoped to active project directory and ID. They are not written into project files or synchronized across browsers. If no active project or storage fails, the current screen retains the setting and indicates that it is temporary. Stored data is validated and bounded; the workspace remounts on project/dataset changes. Rendered matrix pages remain bounded to 50 rows and exclusion lookups use a Set.

Validation:
- TypeScript typecheck and all 875 frontend tests passed.
- 4 new browser cases cover dark/light at 600/1280px, API focus, object exclusion/undo, API exclusion persistence, restoration and keyboard selection.
- 3 existing browser cases cover matrix, observations and inspection at 600/1280/1920px.
- All browser API responses are synthetic local fixtures; no target requests or mutations are made.
- UI build and incremental offline JAR packaging passed. UI detector reported no findings.
