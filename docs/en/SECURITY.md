# Security policy

## Supported versions

Security fixes are made on the latest `1.x` release.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose target traffic, bypass MCP authentication, broaden active-scan scope, or leak credentials. Use the repository's private GitHub Security Advisory reporting flow. Include the affected version, reproduction steps, impact, and a minimal proof of concept without third-party secrets or production data.

If private reporting is not enabled, contact the maintainers privately before publishing details. Expect an acknowledgement within seven days. No bounty is promised.

## Operational safety

Use FlowScope only for systems you own or have explicit permission to test. Keep the MCP server on loopback, use the generated Bearer token, configure the narrowest possible scope, and review the Burp confirmation dialog before ZAP Active Scan.

The optional `~/.flowscope/mcp-token` file is a local FlowScope credential, not a model-provider token. Keep it owner-only (`0600` on POSIX), do not commit it, and delete or replace it to rotate the credential.

Project files are masked, not anonymized. They may retain paths, identifiers, response content, and business data. Store and delete them according to the engagement's data-handling rules.
