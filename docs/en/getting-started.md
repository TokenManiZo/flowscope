# FlowScope installation and first run

This guide covers a reproducible HUMAN, SCANNER, and LLM/Judge setup. FlowScope is a Burp extension: Burp and the subscription-authenticated model client run on the host. Docker is an optional convenience for ZAP, not a container for the whole product.

## Supported setup paths

| Path | Requirements |
|---|---|
| Release JAR + Docker ZAP | Burp, Docker Compose v2, and either Codex CLI or Claude Code |
| Release JAR + ZAP Desktop | Burp, ZAP 2.17.0, and either model client |
| Source build | The runtime above, JDK 21+, and Maven 3.9+ |

The measured baseline is Burp Community 2026.7.3, ZAP 2.17.0, JDK 21, and macOS arm64 with Docker Engine/Desktop 29.5.3. This is not a claim that every older release or OS has been validated.

Official references: [PortSwigger extension loading](https://portswigger.net/burp/documentation/desktop/extend-burp/extensions/creating/loading-in-burp), [ZAP Docker](https://www.zaproxy.org/docs/docker/about/), [ZAP Network API](https://www.zaproxy.org/docs/desktop/addons/network/api/), [Codex CLI](https://developers.openai.com/codex/cli), and [Claude Code getting started](https://docs.anthropic.com/en/docs/claude-code/getting-started).

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

1. Download `flowscope-1.2.0-beta.20.jar` from [GitHub Releases](https://github.com/choewonwoo1817/testflowscope/releases).
2. In **Burp Settings → Tools → Proxy → Proxy listeners**, add `127.0.0.1:8080` and `127.0.0.1:8081`.
3. Load the JAR from **Extensions → Installed → Add → Java**.
4. Check Extension Output/Errors and confirm the FlowScope tab reports Web `17777` and MCP `8787`.

Release users do not need Maven. A custom Java runtime used to launch Burp must support Java 21 class files.

## ZAP with Docker on macOS/Linux

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

The Bash helper is validated on macOS/Linux, not native Windows PowerShell. Windows users can create a 64-hex-character random key in `%USERPROFILE%\.flowscope\zap-api-key`, set its absolute path as `FLOWSCOPE_ZAP_KEY_FILE`, and run the same Compose file. Restrict the file with the local Windows ACL and reload FlowScope after creating it. Compose mounts the file read-only instead of putting the key value in the container environment.

## ZAP Desktop

1. Install ZAP 2.17.0 and set its main local proxy/API to `127.0.0.1:8089`.
2. Keep the API key enabled.
3. In **Options → Network → Connection → HTTP Proxy**, enable upstream host `127.0.0.1`, port `8081`.
4. Confirm `spider`, `client`, `spiderAjax`, `pscan`, and `selenium` are installed.
5. Put the key in owner-only `~/.flowscope/zap-api-key`, or use `flowscope.zap.keyFile`, `FLOWSCOPE_ZAP_API_KEY`, or `flowscope.zap.key`.

## Codex or Claude Code

Install and sign in to one provider client using its official guide. Confirm `codex --version` or `claude --version` succeeds. FlowScope uses the executable visible to the Burp process and does not request a provider API key. If a GUI-launched Burp does not inherit the terminal PATH, set an absolute path before Burp starts:

```text
-Dflowscope.llm.codex.path=/absolute/path/to/codex
-Dflowscope.llm.claude.path=/absolute/path/to/claude
```

Do not set a global `HTTP_PROXY` or `HTTPS_PROXY` for the model client.

## Preflight and source build

After loading the JAR and starting ZAP:

```bash
./scripts/doctor.sh
```

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
4. Select the target and anonymous/ACTIVE identities, then start the isolated ZAP campaign. Active Scan is not part of this automatic baseline.
5. Select the local provider and start the independent LLM Explorer.
6. Review `REVIEW` observations. After all three lanes complete, start Judge.
7. Treat only server-gated reproduction and authorized-control bundles as final; a ZAP alert or LLM statement alone is not confirmation.
8. Attach a local `.flowscope.db` for checkpoints. Raw broker credentials are not persisted and must be recaptured after Burp restarts.

## Troubleshooting

| Symptom | Action |
|---|---|
| Extension class is not recognized | Load the single release `flowscope-*.jar` as a Java extension |
| ZAP API fails | Check `127.0.0.1:8089`, the key file, Compose logs, then reload FlowScope |
| ZAP completes with zero SCANNER captures | Verify ZAP upstream `8081`, the Burp listener, and exact scope together |
| Rendered capture warning | Inspect ZAP Firefox/Selenium/Client/AJAX logs; do not mislabel Traditional-only output as rendered coverage |
| Provider executable missing | Set the provider absolute-path system property and restart Burp |
| Account absent from ZAP/LLM choices | Recapture login until the memory-only broker reports `ACTIVE` |

Never attach target credentials, Authorization/Cookie values, ZAP keys, provider tokens, or private Request/Response bodies to a public issue.
