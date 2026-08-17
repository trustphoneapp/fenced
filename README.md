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

Live endpoints (deployed in `us-east-1`, account-isolated, arm64):

- Demo UI: <https://d2r4c62btm4zg8.cloudfront.net>
- API: <https://h6rzzov3qi.execute-api.us-east-1.amazonaws.com>

| Capability | Implemented and locally tested | Live evidence |
| --- | --- | --- |
| Fixed five-step orchestrator and receipts | Yes, E-0093 | All five steps return `200` on both the CloudFront and API Gateway origins |
| Strict HTTP boundary | Yes, E-0094 | `GET /api/health` returns `200 {"status":"healthy"}` |
| Live-only React interface | Yes, E-0095 | Served `200` through CloudFront |
| CockroachDB schema and vector indexes | Yes, migrations `0001`–`0010` | Applied to CockroachDB v26.2.5; 30 relations; both vector indexes present |
| Least-privilege database identity | Yes | `continuity_app` inherits only executor / reservation / session roles; each step runs under `SET LOCAL ROLE` |
| Policy-withheld disclosure | Yes | Live receipts recall 2 revisions and withhold 1 with `reason: sensitivity_policy` |
| Correction lineage | Yes | `correct` supersedes revision 1 to 2; `ask_after` answers from revision 2 |
| Bedrock Titan + Nova composition | Yes | Live receipts carry `amazon.titan-embed-text-v2:0`, `amazon.nova-lite-v1:0`, token counts and a provider request id |
| Read-only Managed MCP query pack | Yes, E-0096 | `dvi-plan` names the vector index; three summary-view calls are reserved to `zc_continuity_mcp_reader` |
| Rolling quota and provider control | Yes | Enforced live: quota lock taken `FOR UPDATE`, caps read from `hackathon_usage_summary_v1` |

Verified end to end against the live cluster and account on 2026-08-17.

### Vector indexing, stated precisely

`memory_facts_titan_scope_l2` is a real CockroachDB vector index over
`(tenant_id, server_purpose, embedding_space, fact_status, sensitivity, embedding vector_l2_ops)`.
`EXPLAIN` on the `dvi-plan` query names it and shows a `• vector search` node.

The live recall path does **not** use it, and that is a deliberate trade rather than an oversight.
`memory_facts` runs with row-level security forced on, and recall executes as
`zc_continuity_executor` under that policy. CockroachDB cannot combine a vector index scan with an
RLS policy on the same relation: `FORCE_INDEX` raises `42809` and `NO_FULL_SCAN` raises `XXUUU`.
Policy before retrieval is the guarantee this project exists to make, so the index hint was dropped
instead of the policy, and recall runs as a policy-filtered scan.

Two further honest limits: the query vector must be a constant for the index to be selected at all,
and the E2 grant gaps on `continuity.events` and `continuity.payload_anchors` are deliberately not
granted, because the hackathon path never writes those children.

Implemented, tested, deployed, and demonstrated are intentionally different labels, and the table
above keeps them apart rather than collapsing them into a single claim.

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
`apps/api/src/index.ts` remains an inert `503` packaging proof, so the exported `handler` there is a
fail-closed placeholder by design rather than the live path. The container image connects the live
entry to the one-request worker and production runtime; that image is built and pushed to ECR as a
single-platform arm64 manifest, which is what AWS Lambda accepts.

The live runtime reads its CockroachDB credential from Secrets Manager via `DATABASE_SECRET_ARN`. It
does not take a `COCKROACH_DATABASE_URL` environment variable in deployment; that variable is for
local runs only.

## Safety boundaries

- Policy runs before vector retrieval and again before every Bedrock transmission.
- Only fixed synthetic data is allowed; the restricted body reaches Titan during initial embedding
  but never Nova generation or the public answer.
- CockroachDB is the canonical memory and receipt store. Migrations `0001` through `0010` are
  applied to the live cluster (CockroachDB v26.2.5) and verified to expose 30 relations in the
  `continuity` schema. `0010` adds the read grants CockroachDB requires for foreign-key validation:
  unlike PostgreSQL, it checks a foreign key inside the writing statement's query plan, so a role
  that inserts into a child table must also hold `SELECT` on the referenced parent.
- The local provider-control operator does not prove a live state. Disabling prevents new
  reservations but cannot cancel an invocation already in flight; operators must first quiesce
  traffic, disable, and wait at least 25 seconds before assuming no prior invocation remains.
- Managed MCP uses official `select_query` and `explain_query` only. Effective grants are now
  measured rather than assumed: the `dvi-plan` call plans successfully, while `task-status`,
  `receipt-summary`, and `evidence-lineage` return `42501` because the summary views are reserved to
  the purpose-built `zc_continuity_mcp_reader` role, which is deliberately `NOLOGIN`. Enabling MCP
  means granting that role, not widening the application identity.
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
