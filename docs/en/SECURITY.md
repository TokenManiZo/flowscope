# Security policy

## Supported versions

Security fixes are made on the latest `1.x` release.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose target traffic, bypass local control-plane authentication, broaden active-request scope, or leak credentials. Use the repository's private GitHub Security Advisory reporting flow. Include the affected version, reproduction steps, impact, and a minimal proof of concept without third-party secrets or production data.

If private reporting is not enabled, contact the maintainers privately before publishing details. Expect an acknowledgement within seven days. No bounty is promised.

## Operational safety

Use FlowScope only for systems you own or have explicit permission to test. The current Web server retains loopback binding and capability authentication. Configure an explicit narrow scope and check the actual target before starting a ZAP campaign or sending a Request Lab request.

After D-126, the JAR provides no MCP listener, MCP token generation, or subscription CLI launcher. Upgrades do not modify or delete old user-global MCP configurations or token files. Disconnect an obsolete FlowScope entry in its client if no longer needed. A replacement MCP connection is not implemented.

Project files are masked, not anonymized. They may retain paths, identifiers, response content, and business data. Store and delete them according to the engagement's data-handling rules.
