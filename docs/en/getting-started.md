# FlowScope installation and first run

This guide covers a reproducible HUMAN, SCANNER, and LLM/Judge setup. FlowScope is a Burp extension: Burp and the subscription-authenticated model client run on the host. Docker is an optional convenience for ZAP, not a container for the whole product.

## Supported setup paths

| Path | Requirements |
|---|---|
| Release JAR + ZAP Desktop | Burp, ZAP 2.17.0, and either model client |
| Release JAR + Docker ZAP | Burp, Docker Compose v2, and either Codex CLI or Claude Code |
| Source build | The runtime above, JDK 21+, and Maven 3.9+ |

The measured runtime baseline is Burp Community 2026.7.3, ZAP 2.17.0, JDK 21, and macOS arm64 with Docker Engine/Desktop 29.5.3. Windows 10/11 with Docker Desktop Linux containers and PowerShell 7 is the beta.21 support contract; GitHub `windows-latest` parses all PowerShell helpers, but a real Windows Docker Desktop target run remains an explicit validation gate.

Official references: [PortSwigger extension loading](https://portswigger.net/burp/documentation/desktop/extend-burp/extensions/creating/loading-in-burp), [ZAP Docker](https://www.zaproxy.org/docs/docker/about/), [ZAP Network API](https://www.zaproxy.org/docs/desktop/addons/network/api/), [Docker Desktop host networking](https://docs.docker.com/desktop/features/networking/networking-how-tos/), [Compose file-backed secrets](https://docs.docker.com/reference/compose-file/services/), [Microsoft Set-Acl](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-acl), [Microsoft cryptographic RNG](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.randomnumbergenerator.getbytes), [GitHub Actions PowerShell shell](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [Codex CLI](https://developers.openai.com/codex/cli), and [Claude Code getting started](https://docs.anthropic.com/en/docs/claude-code/getting-started).

## Ports

| Address | Owner | Purpose |
|---|---|---|
| `127.0.0.1:8080` | Burp | HUMAN traffic |
| `127.0.0.1:8081` | Burp | SCANNER traffic from ZAP |
| `127.0.0.1:8082` | Burp | Optional direct LLM fallback |
| `127.0.0.1:8089` | ZAP | Local ZAP proxy/API |
| `127.0.0.1:8787` | FlowScope | Authenticated local MCP |
| `127.0.0.1:17777` | FlowScope | Local Web workspace |

## Release installation

Clone `https://github.com/choewonwoo1817/testflowscope.git` first if you want the ZAP key helper, Docker Quick Start, and local documentation for the complete three-way setup. HUMAN-only users can download only the release JAR.

1. If `flowscope-1.2.0-beta.42.jar` is published on [GitHub Releases](https://github.com/choewonwoo1817/testflowscope/releases), download it there. Otherwise clone the repository and use the source-build section to create the same JAR locally.
2. In **Burp Settings → Tools → Proxy → Proxy listeners**, add `127.0.0.1:8080` and `127.0.0.1:8081`.
3. Load the JAR from **Extensions → Installed → Add → Java**.
4. Check Extension Output/Errors and confirm the FlowScope tab reports Web `17777` and MCP `8787`.

Release users do not need Maven. A custom Java runtime used to launch Burp must support Java 21 class files.

Open **Quick Start** at Web `127.0.0.1:17777`. It shows Scope, HUMAN, ZAP, and LLM/Judge status but opens only the first incomplete panel. Complete the visible panel, use a stage tab to inspect another setting, or select **Current stage** to return to the required step. After collection, inspect the default **API·입력 차이** surface for endpoint/parameter declaration-versus-observation deltas and artifact parsing failures, then drill into **인가 그래프** and the matrix. An unobserved item is not a vulnerability or a failed lane.

## Choose ZAP Desktop or Docker

FlowScope checks a compatible ZAP API at `127.0.0.1:8089`. **Quick Start → Local ZAP connection** shows reachability, version, and key mismatch before a campaign can start. It intentionally does not guess whether the API belongs to Desktop or Docker. Run only one path because both use port `8089`.

Use Desktop to preserve an existing GUI testing workflow. Use the optional Docker Quick Start when the team needs a pinned ZAP/add-on environment.

### Docker Quick Start on macOS/Linux

From the repository root:

```bash
./scripts/zap-up.sh
```

The script runs the official ZAP 2.17.0 multi-architecture image pinned by digest, creates a 32-byte random key at `~/.flowscope/zap-api-key`, restricts it to mode `0600` on POSIX systems, configures the official ZAP Network API to use `host.docker.internal:8081` as the upstream Burp proxy, and publishes the ZAP API only on host loopback `127.0.0.1:8089`. FlowScope reads that default key file when the extension loads. Reload the extension if the key was created after it loaded.

```bash
docker compose -p flowscope-zap -f infra/zap/compose.yaml ps
docker compose -p flowscope-zap -f infra/zap/compose.yaml logs
./scripts/zap-down.sh
```

### Docker Quick Start on Windows

From a non-administrator PowerShell 7 session in the repository root:

```powershell
.\scripts\zap-up.ps1
.\scripts\doctor.ps1
```

The helper creates a 32-byte key with .NET's cryptographic RNG, disables ACL inheritance, grants the current Windows user FullControl, and passes the file through a Compose file-backed secret rather than a container environment value. Docker Desktop's documented `host.docker.internal` name connects ZAP to host Burp `8081`.

```powershell
docker compose -p flowscope-zap -f infra/zap/compose.yaml ps
docker compose -p flowscope-zap -f infra/zap/compose.yaml logs
.\scripts\zap-down.ps1
```

PowerShell 5.1, Windows container mode, and running the helper inside WSL are outside the beta.21 Windows support contract. The scripts are parsed on GitHub `windows-latest`; actual Windows Docker Desktop API, upstream, TLS, and target capture are not yet marked complete.

## ZAP Desktop

1. Install ZAP 2.17.0.
2. Create an owner-only key without printing its value: `./scripts/zap-key.sh` on macOS/Linux or `.\scripts\zap-key.ps1` in Windows PowerShell 7.
3. Set the main local proxy/API to `127.0.0.1:8089` and set the ZAP API key to the value stored in `~/.flowscope/zap-api-key`. Keep key checks enabled.
4. In **Options → Network → Connection → HTTP Proxy**, enable upstream host `127.0.0.1`, port `8081`.
5. Confirm `spider`, `client`, `spiderAjax`, `pscan`, `pscanrules`, `selenium`, `openapi`, `websocket`, and `network` are installed. Explicit GraphQL, Postman, or SOAP imports also require the matching add-on.
6. FlowScope reads owner-only `~/.flowscope/zap-api-key` by default; alternatives are `flowscope.zap.keyFile`, `FLOWSCOPE_ZAP_API_KEY`, and `flowscope.zap.key`. Reload the extension if the key was created after loading it.

## Codex or Claude Code

Install and sign in to one provider client using its official guide. FlowScope searches inherited PATH plus standard macOS/Linux user, Homebrew, version-manager, Windows WinGet, and npm launcher locations. It runs `codex login status` or `claude auth status --json` without provider API keys, caches only sanitized readiness, auto-selects a ready provider, and rechecks immediately before launch. A Codex button run still requires the normal login file at `$CODEX_HOME/auth.json` or `~/.codex/auth.json`; only that file is linked into an owner-only temporary home. Non-standard portable installs can set an absolute path before Burp starts:

```text
-Dflowscope.llm.codex.path=/absolute/path/to/codex
-Dflowscope.llm.claude.path=/absolute/path/to/claude
```

Do not set a global `HTTP_PROXY` or `HTTPS_PROXY` for the model client.

After resolving the executable, FlowScope prepends its parent directory to the child process `PATH`. This fixes GUI-launched Burp environments where an `#!/usr/bin/env node` launcher and its runtime share the installation directory. Provider API keys are still removed. If the launcher and runtime are installed in different directories, configure the absolute launcher path above and make the runtime directory visible to the Burp process as well.

## Preflight and source build

After loading the JAR and starting ZAP:

```bash
./scripts/doctor.sh
```

Windows uses `.\scripts\doctor.ps1`; add `-Build` for source-build checks.

The check covers Burp listener reachability, the loopback ZAP API and upstream proxy, required ZAP add-ons, one model executable, and FlowScope Web/MCP ports. An open port does not prove that the process is Burp, so verify the listener table manually. If you changed defaults, set `FLOWSCOPE_HUMAN_PORT`, `FLOWSCOPE_BURP_SCANNER_PORT`, `FLOWSCOPE_ZAP_PORT`, `FLOWSCOPE_WEB_PORT`, and `FLOWSCOPE_MCP_PORT` in the same shell so doctor checks the same contract.

Source contributors additionally run:

```bash
./scripts/doctor.sh --build
mvn clean verify
```

## First three-way run

1. Set an authorized exact scope in the FlowScope Burp tab.
2. Register test accounts and capture any required login through HUMAN `8080` until the broker reports the account usable.
3. Start a HUMAN pass, explore with the Burp browser, and end the pass.
4. Select the target and anonymous/ACTIVE identities. If you already have an API definition, optionally add one line per definition as `OPENAPI URL`, `POSTMAN URL`, `SOAP URL`, or `GRAPHQL ENDPOINT [SCHEMA_URL]`, then start the isolated ZAP campaign. Every URL must remain in exact scope. Because an import can generate write-method example requests, a non-empty list requires a separate Burp approval. Identity lanes run serially to isolate ZAP state; use the six-stage progress line, campaign/stage elapsed time, deadline, last ZAP response and traffic change, queue position, Passive remaining/task fields, alert-snapshot status, and the one-second activity feed to distinguish a healthy wait, partial completion, and failure. A lane that cannot clear old Passive work blocks later identities instead of mixing their traffic. Active Scan is not part of this automatic baseline.
5. Start the independent LLM Explorer; FlowScope auto-selects a locally READY provider. No model API key or manual MCP configuration is required after the official CLI is installed and signed in. Explorer creates the first Evidence with the controlled HTTP executor and repeatedly requests the server-provided `pending_concrete_paths`; normalized display templates do not discard observed object values. An installed Chrome/Chromium/Edge browser is needed only when an own-run HTML/script signal recommends the SPA/JavaScript/UI fallback; Playwright, Chrome MCP, and a separate driver are not. When required, Explorer opens an isolated temporary profile, observes exact-scope DOM, links, forms, and SPA network routes, and replays relevant requests through the controlled executor to create Evidence. Click/fill actions require Burp approval, and password/file inputs are blocked. Use readiness refresh only when login state has just changed. The live activity feed shows actual model messages, FlowScope tool states, the injected instructions, and the Evidence completion gate; it never claims to expose hidden reasoning or raw credential-bearing tool payloads. Completion requires exact-scope controlled response Evidence, review of both frontiers, and no pending safe concrete path. Skipped/unavailable recommended rendering or schema templates without observed values are returned as explicit completion limitations.
6. Review `REVIEW` observations. After all three lanes complete, start Judge.
7. Treat only server-gated reproduction and authorized-control bundles as final; a ZAP alert or LLM statement alone is not confirmation.
8. Attach a local `.flowscope.db` for checkpoints. Raw broker credentials are not persisted and must be recaptured after Burp restarts.

### Importing an existing ZAP traffic export

Use **Scanner XML/HAR** in the Web header and select a `.har` created by ZAP's **Save Selected Entries as HAR** action. FlowScope imports only the HAR HTTP request/response entries as `SCANNER / HAR_IMPORT / IMPORT` Evidence and removes entries outside the current exact scope. This fallback does not reconstruct identity-isolated fresh sessions, rendered-crawl completion, the passive queue, or native alerts, so importing a file never marks the ZAP baseline complete. Use the normal campaign path when ZAP alerts are required for comparison.

## Troubleshooting

| Symptom | Action |
|---|---|
| Extension class is not recognized | Load the single release `flowscope-*.jar` as a Java extension |
| ZAP API fails | Run the OS-appropriate doctor, check `127.0.0.1:8089`, the key file and Compose logs, then reload FlowScope |
| Windows key ACL fails | Rerun `zap-up.ps1` as the normal user and keep the key under the NTFS user profile, not a network/FAT path |
| Windows ZAP cannot reach Burp | Confirm Docker Desktop Linux-container mode, Burp `127.0.0.1:8081`, Windows Firewall, and `host.docker.internal` |
| ZAP completes with zero SCANNER captures | Verify ZAP upstream `8081`, the Burp listener, and exact scope together |
| Campaign rejects ZAP outgoing proxy | Enable the Network HTTP proxy and use `127.0.0.1:8081` for Desktop or `host.docker.internal:8081` for Docker |
| API definition import warning | Check exact-scope URLs and the matching `openapi`, `graphql`, `postman`, or `soap` add-on; other crawler Evidence remains available |
| Rendered capture warning | Inspect ZAP Firefox/Selenium/Client/AJAX logs; do not mislabel Traditional-only output as rendered coverage |
| Explorer exits but the LLM lane fails | Inspect the output tail for a cancelled target read or zero response Evidence, fix scope/session/approval state, then start a new Explorer |
| Supported Chrome/Chromium/Edge executable was not found | Install one supported browser, or set the absolute executable with Burp JVM option `-Dflowscope.browser.path=...`, then reload the extension |
| Provider executable missing | Set the provider absolute-path system property and restart Burp |
| Account absent from ZAP/LLM choices | Recapture login until the memory-only broker reports `ACTIVE` |

Never attach target credentials, Authorization/Cookie values, ZAP keys, provider tokens, or private Request/Response bodies to a public issue.
