# FlowScope installation and first run

This guide targets the D-128/D-139 standalone Explorer, the D-135 FlowScope Docker Chromium ZAP runtime, and the D-138 connection-state contract. Check the [handoff](../ko/HANDOFF.md) and [artifact record](../ko/beta-validation.md) to distinguish it from older JARs.

The current source provides HUMAN, ZAP, and a standalone Codex Explorer. The old Judge, MCP server, and browser harness remain removed; the replacement uses Codex app-server dynamic tools behind a Java exact-scope gateway (D-128). An authenticated ZAP lane uses a dedicated memory-only login account and proceeds only when an observed authentication response for the same run/account matches the required logged-in regex and no later response matches the optional logged-out regex (D-136). Every ZAP lane uses the bundle's FlowScope Docker image, its co-installed Chromium/ChromeDriver, and the explicit `chrome-headless` Client Spider (D-135). H/S/L Evidence comparison and existing projects remain supported. This work is not published as a Release yet; build the JAR or distribution bundle from this source.

## Supported setup paths

| Path | Requirements |
|---|---|
| HUMAN only | Release JAR and Burp |
| HUMAN + ZAP | Distribution bundle, Burp, and Docker Compose v2 |
| LLM Explorer | The JAR or bundle, Burp, official Codex CLI, and a valid Codex login |
| Source build | The runtime above, JDK 21 exactly, and Maven 3.9.x |

Download users do not install Maven, Node.js, npm, host Chrome, ChromeDriver, or ZAP Desktop. Prefer `flowscope-1.2.0-beta.46-bundle.zip`; it contains the Burp JAR, ZAP Dockerfile/Compose/helpers, macOS/Linux/Windows doctors, and current manuals. The JAR alone is sufficient for HUMAN and Explorer, but it does not contain the ZAP helpers.

The measured runtime baseline is Burp Community 2026.7.3, ZAP 2.17.0, JDK 21, and macOS arm64 with Docker Engine/Desktop 29.5.3. Windows 10/11 with Docker Desktop Linux containers and PowerShell 7 is the beta.21 support contract; GitHub `windows-latest` parses all PowerShell helpers, but a real Windows Docker Desktop target run remains an explicit validation gate.

Official references: [PortSwigger extension loading](https://portswigger.net/burp/documentation/desktop/extend-burp/extensions/creating/loading-in-burp), [ZAP Docker](https://www.zaproxy.org/docs/docker/about/), [ZAP Network API](https://www.zaproxy.org/docs/desktop/addons/network/api/), [Docker Desktop host networking](https://docs.docker.com/desktop/features/networking/networking-how-tos/), [Compose file-backed secrets](https://docs.docker.com/reference/compose-file/services/), [Microsoft Set-Acl](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-acl), [Microsoft cryptographic RNG](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.randomnumbergenerator.getbytes), [GitHub Actions PowerShell shell](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

## Ports

| Address | Owner | Purpose |
|---|---|---|
| `127.0.0.1:8080` | Burp | HUMAN traffic |
| `127.0.0.1:8081` | Burp | SCANNER traffic from ZAP |
| `127.0.0.1:8082` | Burp | Legacy direct-LLM observation fallback; not used by the new Explorer |
| `127.0.0.1:8089` | ZAP | Local ZAP proxy/API |
| `127.0.0.1:17777` | FlowScope | Local Web workspace |

## Release bundle installation

1. Download and extract `flowscope-1.2.0-beta.46-bundle.zip` from [GitHub Releases](https://github.com/choewonwoo1817/testflowscope/releases). If the bundle is not published yet, clone the repository and build it using the source-build instructions. HUMAN/Explorer users may download only the JAR.
2. Keep the extracted directory structure. `scripts/zap-up.*` uses the relative `infra/zap/compose.yaml` path.
3. In **Burp Settings → Tools → Proxy → Proxy listeners**, add `127.0.0.1:8080` for HUMAN and add `127.0.0.1:8081` only when using ZAP. Native Linux Docker Engine also requires the specific bridge-IP listener described below.
4. Load the bundle-root JAR from **Extensions → Installed → Add → Java**.
5. Check Extension Output/Errors and confirm the FlowScope tab reports Web `17777`.

Release users do not need Maven. A custom Java runtime used to launch Burp must support Java 21 class files.

At Web `127.0.0.1:17777`, use the top **점검** (Inspection) link to open Scope, HUMAN, ZAP, and Evidence-review stages. Under **분석** (Analysis), **API·입력 차이** compares declarations with observations, **점검 Gap 그래프** contains priority and full-relationship tabs, and **권한 매트릭스** contains judgment, parameter coverage, and legacy authorization tabs. Unobserved inputs and incomplete parsing are distinct states, neither a vulnerability verdict nor proof of a failed lane.

For a new target, use **New assessment** in the top bar and enter a project name plus the authorized exact scope. FlowScope first saves the current assessment to `~/.flowscope/projects/<name--scope--time>/project.flowscope.db`, creates the new empty database, and only then replaces the active scope and screen. A failed save leaves the current Evidence and scope active and reports the cause. The project selector can reopen a previous database. Projects contain masked Evidence, policy, completed runs, the execution ledger, and human review, but not raw Authorization/Cookie values, passwords, API keys, provider tokens, or the live Request Lab exchange; authentication must be prepared again after reopening.

Selecting an actual Observation on **API·입력 차이**, or a row on **Evidence**, opens its exact Evidence and Request Lab. The Evidence screen pages through 200 masked request/response records and payload-retention metadata for the same operation. Only the one selected Evidence item can use the bounded in-process live raw copy for editing or Burp Repeater. A declaration-only row from OpenAPI, HTML, or JavaScript has no fabricated Evidence action. A temporary snapshot failure preserves the unsent draft and disables sends until the same dataset recovers; dataset, Evidence, raw-retention, or session changes close it.

## Start the FlowScope Docker Chromium runtime

FlowScope checks the ZAP API at `127.0.0.1:8089` and verifies that `zapHomePath` is under the managed tmpfs `/run/flowscope-zap/`. **Quick Start → FlowScope Docker ZAP** shows reachability, version, key, and runtime mismatch before a campaign can start. An arbitrary ZAP Desktop or API instance is not accepted merely because it is reachable.

A generic timeout or transient communication failure is shown as `RETRYING` for the first two consecutive probes and becomes `UNREACHABLE` on the third. An HTTP 401/403 API-key error becomes `AUTH_FAILED` immediately, and a wrong runtime is also reported immediately. `CONNECTED` means that the managed ZAP control API is ready; it does not mean that Client Spider or a campaign has completed.

### Docker Quick Start on macOS/Linux

Docker Desktop uses the Burp loopback listener above. With default **native Linux Docker Engine** settings, the bundle's `host.docker.internal:host-gateway` mapping resolves to the host's default bridge IP, so a listener bound only to `127.0.0.1:8081` cannot accept that container connection. Start Docker and read the actual bridge IP ([official Docker mapping reference](https://docs.docker.com/reference/cli/dockerd/#configure-host-gateway-ip)):

```bash
docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'
```

In Burp **Proxy listeners**, keep the loopback listener and add another listener on port `8081`, selecting the returned host bridge IP as its **Specific address**. Do not substitute an example address or select **All interfaces / `0.0.0.0`**. If the Docker daemon overrides `host-gateway`, first identify the host interface IP matching that override. Keep HUMAN, FlowScope Web, and the ZAP API on loopback, and retain the authorized target's exact scope. These are native Linux configuration instructions, not a claim that a native Linux target run has been verified.

From the extracted bundle root or repository root:

```bash
./scripts/zap-up.sh
```

The helper builds the FlowScope image from the official ZAP 2.17.0 multi-architecture base pinned by digest, installs Chromium and ChromeDriver from the same Debian repository, verifies matching major versions and an actual headless launch, creates a 32-byte random key at `~/.flowscope/zap-api-key`, restricts it to mode `0600` on POSIX systems, configures the official ZAP Network API to use `host.docker.internal:8081` as the upstream Burp proxy, and publishes the ZAP API only on host loopback `127.0.0.1:8089`. Chromium runs as the image's unprivileged `zap` user with `--no-sandbox` because the default Docker namespace blocks Chromium's sandbox; FlowScope does not add broad container capabilities or relax seccomp. FlowScope reads the default key file when the extension loads. Reload the extension if the key was created after it loaded.

```bash
docker compose -p flowscope-zap -f infra/zap/compose.yaml ps
docker compose -p flowscope-zap -f infra/zap/compose.yaml logs
./scripts/zap-down.sh
```

### Docker Quick Start on Windows

From a non-administrator PowerShell 7 session in the extracted bundle root or repository root:

```powershell
.\scripts\zap-up.ps1
.\scripts\doctor.ps1 -Mode zap
```

The helper creates a 32-byte key with .NET's cryptographic RNG, disables ACL inheritance, grants the current Windows user FullControl, and passes the file through a Compose file-backed secret rather than a container environment value. Docker Desktop's documented `host.docker.internal` name connects ZAP to host Burp `8081`.

```powershell
docker compose -p flowscope-zap -f infra/zap/compose.yaml ps
docker compose -p flowscope-zap -f infra/zap/compose.yaml logs
.\scripts\zap-down.ps1
```

PowerShell 5.1, Windows container mode, and running the helper inside WSL are outside the beta.21 Windows support contract. The scripts are parsed on GitHub `windows-latest`; actual Windows Docker Desktop API, upstream, TLS, and target capture are not yet marked complete.

## LLM Explorer

Install the [official Codex CLI](https://learn.chatgpt.com/docs/codex/cli). On macOS/Linux the official standalone command is `curl -fsSL https://chatgpt.com/codex/install.sh | sh`; follow the official page for Windows. As the same OS user that runs Burp, run `codex` and complete **Sign in with ChatGPT**. Apply exact scope, open **Explorer**, use **Recheck** if readiness is not READY, select anonymous mode or add a memory-only HTML-form/JSON-API account, choose a start URL, and start the run. The activity feed shows elapsed time, actual requests and Evidence IDs, unresolved items, failures, steering, and cancellation.

FlowScope does not require an MCP token, port 8787, Chrome/Playwright, a provider API key, or a separately installed Node runtime. The model receives opaque account handles rather than credentials; Java injects memory-only session material after scope/method/header/budget checks. Historical Judge output remains read-only. See the [Explorer contract](../ko/llm-explorer.md).

## Preflight and source build

Run only the checks needed for the selected feature set. `full` is the default and checks every path.

```bash
./scripts/doctor.sh --mode human
./scripts/doctor.sh --mode zap
./scripts/doctor.sh --mode explorer
./scripts/doctor.sh --mode full
```

Windows uses `.\scripts\doctor.ps1 -Mode human|zap|explorer|full`; add `-Build` for source-build checks.

`human` checks HUMAN `8080` and Web; `zap` adds SCANNER `8081`, the loopback ZAP key/API/upstream and required add-ons; `explorer` checks the Codex executable and current OS user's login; `full` checks all of them. An open port does not prove that the process is Burp, so verify the listener table manually. The current Bash doctor checks host loopback and configured upstream values; it does not prove container reachability to the native Linux bridge listener. If you changed defaults, set `FLOWSCOPE_HUMAN_PORT`, `FLOWSCOPE_BURP_SCANNER_PORT`, `FLOWSCOPE_ZAP_PORT`, `FLOWSCOPE_WEB_PORT` in the same shell so doctor checks the same contract.

Source contributors additionally run:

```bash
./scripts/doctor.sh --mode full --build
mvn clean verify
```

## First HUMAN/ZAP/LLM run

1. Set an authorized exact scope in the FlowScope Burp tab.
2. Register HUMAN test accounts and capture any required HUMAN login through `8080`. ZAP uses a separate memory-only browser-login account entered in the ZAP step.
3. Start a HUMAN pass, explore with the Burp browser, and end the pass.
4. Select the target and anonymous lane and/or register a ZAP browser-login account with label, role, exact-scope login URL, username, password, and a required logged-in response regex such as text that appears only after successful login. The credentials remain only in current Burp-process memory and are not written to projects, snapshots, or logs. An optional logged-out regex can identify a failed-login page. If you already have an API definition, optionally add one line per definition as `OPENAPI URL`, `POSTMAN URL`, `SOAP URL`, or `GRAPHQL ENDPOINT [SCHEMA_URL]`, then start the isolated ZAP campaign. Every URL must remain in exact scope. Because an import can generate write-method example requests, a non-empty list requires a separate Burp approval. An authenticated lane creates an unnamed temporary ZAP session and Context and runs Chrome Headless Browser Based Authentication with auto-detected session handling. The ZAP action's `OK` result and authentication timestamp are not treated as proof. FlowScope proceeds only when the actual `ZAP_AUTHENTICATION` response Evidence for the same run and account matches the logged-in regex and no later response matches the optional logged-out regex. It then uses one strict, account-bound `chrome-headless` Client Spider; the anonymous lane explicitly uses the same browser. Identity lanes run serially to isolate ZAP state; use the session/login/Client/Passive/Alert progress line, campaign/stage elapsed time, deadline, worker signal, traffic change, queue position, Passive remaining/task fields, alert-snapshot status, and the one-second activity feed to distinguish a healthy wait, partial completion, and failure. Client failure or zero in-scope responses fail the lane; FlowScope does not run an automatic Traditional/AJAX fallback. A lane that cannot clear old work blocks later identities instead of mixing their traffic. Active Scan is not part of this automatic baseline.
5. Inspect endpoint/parameter observations, declarations and parsing status.
6. Run the standalone Explorer with anonymous and/or memory-only accounts. HTTP responses become LLM Observation Evidence, while endpoints and value-free parameters read from those artifacts are stored as separate current-run Evidence-bound Declarations. OPTIONS capability probes are counted separately. Zero response Evidence is a failure, not completion.
7. Compare H/S/L endpoint and parameter observations in **API·입력 차이**.
8. Review current rule candidates and their Evidence; save human review independently of LLM prose. Historical LLM verdicts are not revalidated or promoted.
9. Attach a local `.flowscope.db` for checkpoints. Raw broker credentials are not persisted and must be recaptured after Burp restarts.

ZAP authentication exchanges remain auditable `ZAP_AUTHENTICATION / SESSION_SETUP` Evidence, but they do not count as scanner discovery, crawler capture, or lane completion. A lane that authenticates but captures no crawler response therefore does not complete successfully.

### Importing an existing ZAP traffic export

Use **Scanner XML/HAR** in the Web header and select a `.har` created by ZAP's **Save Selected Entries as HAR** action. FlowScope imports only the HAR HTTP request/response entries as `SCANNER / HAR_IMPORT / IMPORT` Evidence and removes entries outside the current exact scope. This fallback does not reconstruct identity-isolated fresh sessions, rendered-crawl completion, the passive queue, or native alerts, so importing a file never marks the ZAP baseline complete. Use the normal campaign path when ZAP alerts are required for comparison.

## Automation boundary

FlowScope validates exact scope, collects in-scope HUMAN traffic, checks the FlowScope Docker ZAP/Codex readiness, performs memory-only Explorer login, and stores only actual HTTP responses as Evidence. The operator still installs Burp, Docker, and Codex; creates Burp listeners; enters authorized scope; and completes any CAPTCHA, MFA, WebAuthn, or SSO interaction.

FlowScope does not silently alter Burp settings, install third-party software/add-ons, or bypass interactive authentication. A failed optional lane does not disable the other lanes. Codex app-server is documented by OpenAI as experimental, so after a Codex CLI update recheck READY and confirm that the run records at least one response Evidence.

## Troubleshooting

| Symptom | Action |
|---|---|
| Extension class is not recognized | Load the single release `flowscope-*.jar` as a Java extension |
| ZAP API fails | Run the OS-appropriate doctor, check `127.0.0.1:8089`, the key file and Compose logs, then reload FlowScope |
| Windows key ACL fails | Rerun `zap-up.ps1` as the normal user and keep the key under the NTFS user profile, not a network/FAT path |
| Windows ZAP cannot reach Burp | Confirm Docker Desktop Linux-container mode, Burp `127.0.0.1:8081`, Windows Firewall, and `host.docker.internal` |
| ZAP completes with zero SCANNER captures | Verify ZAP upstream `8081`, the Burp listener, and exact scope together |
| Campaign rejects ZAP outgoing proxy | Run the FlowScope `zap-down` and `zap-up` helpers, then verify `host.docker.internal:8081` with doctor |
| API definition import warning | Check exact-scope URLs and the matching `openapi`, `graphql`, `postman`, or `soap` add-on; other crawler Evidence remains available |
| Client lane failed or captured zero responses | Inspect Docker/ZAP logs, Chromium/ChromeDriver/Selenium/Client state, outgoing proxy, exact scope, and the capability rule; FlowScope does not convert this to a successful fallback |
| Account absent from ZAP choices | Register a ZAP browser-login account for the currently selected target origin; credentials are intentionally cleared on reload or dataset replacement |
| ZAP authentication failed | Check the login URL, credentials, Chromium/Selenium/Auth Helper state. FlowScope does not bypass CAPTCHA, MFA, WebAuthn, or external SSO and does not relabel a failed login as an authenticated lane |
| Codex readiness is not READY | Sign in by running `codex` as the same OS user, then use Explorer **Recheck** or run `doctor --mode explorer` |

Never attach target credentials, Authorization/Cookie values, ZAP keys, provider tokens, or private Request/Response bodies to a public issue.
