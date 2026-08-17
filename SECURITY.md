# Security policy

## Supported versions

The project is pre-release. Security fixes apply to the current `main` branch until the first supported release is published.

## Reporting a vulnerability

Do not open a public issue containing exploit details, secrets, personal data, or tenant data. Contact the repository owner privately using the security-reporting channel listed in the public repository settings. Until that channel exists, do not publish the repository as production-ready.

Include affected commit, impact, reproduction steps using synthetic data, and any suggested mitigation. Receipt of a report is not permission to access other users' data.

## Security invariants

- The private Zintus repository is never a source dependency.
- Tenant identity is derived from authenticated server context.
- Policy is evaluated before retrieval and again before provider transmission.
- Model output and retrieved memory are untrusted data.
- Managed MCP is read-only for the hackathon.
- Event payloads are erasable independently from immutable audit metadata.
- Secrets, prompts, memory values, and tool payloads are excluded from ordinary logs.
- Deletion revokes retrieval synchronously and cleans derived artifacts asynchronously.
- Release is blocked by tenant escape, secret leakage, policy false-allow, tombstone retrieval, duplicate external effects, or unresolved high-severity production advisories.
