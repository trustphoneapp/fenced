# Zintus Continuity

Zintus Continuity is an agent-memory prototype that shows its work. Each answer includes a
content-free receipt describing which memory revisions were recalled, which were withheld by
policy, and which correction changed the result.

This independent Apache-2.0 project was created for the CockroachDB × AWS Build the Future of
Agentic Memory hackathon. It has no private-product source dependency or integration.

## Five-step demo

The public contract accepts only these server-owned synthetic operations, in order:

1. `start` creates an opaque demo session and embeds three fixed synthetic facts.
2. `ask_before` answers the fixed launch-day/evidence question from authorized memory.
3. `correct` supersedes the public launch-day fact from Monday revision 1 to Sunday revision 2.
4. `ask_after` answers the same question from the corrected revision.
5. `latest_receipt` returns the durable answer and receipt without another provider call.

No prompt, memory, tenant, purpose, provider, model, SQL, or tool input is accepted from the
browser.

## Current status

| Capability | Implemented and locally tested | Live evidence |
| --- | --- | --- |
| Fixed five-step orchestrator and receipts | Yes, E-0093 | Not yet |
| Strict HTTP boundary and CloudFormation shell | Yes, E-0094 | Standard ZIP handler is intentionally `503` |
| Live-only React interface | Yes, E-0095 | Unconnected until deployment |
| Read-only Managed MCP query pack | Local preparation, E-0096 | Blocked pending scope proof |
| Injected CockroachDB/Bedrock composition | Local container-image candidate | Unbuilt and not deployed |
| Deterministic Lambda ZIP | Yes, E-0098 | Local inert `503` artifact only |
| Rolling quota and provider control | Local source/tests only | Not applied or executed live |

The current release decision is **NO-GO** until every required item in the
[submission checklist](docs/hackathon/submission-checklist.md) has executed evidence. Implemented,
tested, deployed, and demonstrated are intentionally different labels.

## Local verification

Prerequisites: Node.js 24 and the already sealed pnpm 11.9.0 available on `PATH`. Do not reactivate
Corepack unless deliberately regenerating the trust evidence. With the reviewed dependency store
already available:

```bash
node scripts/safe-pnpm-install.mjs --offline
node scripts/safe-verify.mjs
node scripts/verify-h18-managed-mcp.mjs
node scripts/package-hackathon-lambda.mjs
```

The web interface deliberately has no static-result fallback. The standard ZIP entry
`apps/api/src/index.ts` remains an inert `503` packaging proof. A separate, committed local-source
container image candidate connects `image-entry` to the one-request worker and production runtime,
but its context has not been built, pushed, deployed, or executed live.

## Safety boundaries

- Policy runs before vector retrieval and again before every Bedrock transmission.
- Only fixed synthetic data is allowed; the restricted body reaches Titan during initial embedding
  but never Nova generation or the public answer.
- CockroachDB remains the intended canonical memory and receipt store; migrations `0008` and the
  additive `0009` rolling-24-hour session-quota repair still require live E4 application and
  attestation.
- The local provider-control operator does not prove a live state. Disabling prevents new
  reservations but cannot cancel an invocation already in flight; operators must first quiesce
  traffic, disable, and wait at least 25 seconds before assuming no prior invocation remains.
- Managed MCP uses official `select_query` and `explain_query` only. It remains disabled unless E4
  proves fresh no-write consent, one-cluster scope, effective grants, and truthful tenant binding.
- The hackathon schema stores synthetic memory inline and is not a production erasure design.
- No Cognito authentication, SQS worker path, second provider, autonomous tools, multi-region
  runtime, production readiness, private integration, or uptime guarantee is claimed.

## Project references

- [Architecture](docs/hackathon/architecture-diagram.md)
- [Devpost draft](docs/hackathon/devpost-submission-draft.md)
- [Demo script](docs/hackathon/demo-video-script.md)
- [Submission checklist](docs/hackathon/submission-checklist.md)

Licensed under [Apache License 2.0](LICENSE). Final ownership, eligibility, disclosure, repository
publication, video upload, and Devpost submission remain human decisions.
