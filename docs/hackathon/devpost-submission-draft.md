# Devpost submission draft

> **NOT APPROVED FOR SUBMISSION.** Replace every placeholder token only with reviewed executed
> evidence. Any unresolved required placeholder means `NO-GO`.

## Project name

Zintus Continuity

## Tagline

Agent memory that shows its work: recalled revisions, policy withholds, and correction lineage.

## Inspiration

Agent answers often hide retrieval. Continuity treats evidence as part of the product: a judge can
see which memory revisions supported an answer, which ID-only references policy withheld, and how a
correction changed the next answer.

## What it does

Continuity runs one fixed, synthetic five-step scenario. It stores versioned agent memory in
CockroachDB, uses a scoped Titan-1024 L2 vector query, gives only authorized memory to Nova Lite,
and commits a content-free disclosure receipt before releasing the answer. A correction supersedes
Monday revision 1 with Sunday revision 2; the fifth `latest_receipt` step returns the durable answer
and receipt with zero new provider calls.

The public demo and those live claims require: `{{E4_MIGRATION_0008}}`,
`{{E4_MIGRATION_0009}}`, `{{E4_ISOLATION_TLS_RLS}}`, `{{E4_DVI_EXPLAIN}}`,
`{{E4_PROVIDER_CONTROL}}`, `{{E4_BEDROCK_LAMBDA}}`, and `{{H19_TEN_RUNS}}`.

## How we built it

- TypeScript, React, and a fixed-operation HTTP API
- CockroachDB Cloud tables for memory revisions, receipts, ID-only lineage, and separately erasable
  response bodies
- CockroachDB Distributed Vector Indexing with normalized Titan embeddings and L2 distance
- Amazon Titan Text Embeddings V2, Amazon Nova Lite, API Gateway, Lambda, S3, and CloudFront
- Official Managed MCP `select_query` and `explain_query`, conditional on
  `{{E4_MCP_READ_SCOPE_OR_LIMITATION}}`

## Challenges

We made every authority boundary fail closed: policy before retrieval and transmission, caller-free
tenant/content selection, durable idempotency, snapshot revalidation, bounded provider calls, and
receipts that never contain withheld bodies. We also kept deployed and demonstrated claims separate
from local code until evidence existed.

## Accomplishments

Our differentiator is a judge-visible receipt that connects an answer to recalled revisions,
policy-withheld references, provider metadata, and correction lineage. Local implementation and
adversarial tests are recorded in E-0090 through E-0098. Live qualification remains conditional on
the checklist.

## What we learned

Memory governance is a data-flow property, not a prompt. The database role, retrieval projection,
provider authorization, correction transaction, and public receipt must agree on the same revision
and deletion fence.

## Known limitations

The demo is fixed-fixture and synthetic, not authenticated or production-ready. Managed MCP remains
disabled unless its real no-write scope and tenant boundary are proven. The inline synthetic memory
schema is not a complete encrypted or backup-erasure design. No SQS path, second provider, autonomous
tools, learning, multi-region runtime, private integration, or competitor-universe claim is made.

## Links

- Try it: `{{PUBLIC_DEMO_URL}}`
- Source: `{{PUBLIC_REPOSITORY_URL}}`
- Video: `{{PUBLIC_VIDEO_URL}}`
- Final engineering evidence: `{{H11B_FINAL_COMMIT_AND_GATES}}`
- Latency: `{{H19_LATENCY_P50_P95_MAX}}`
- Cost and headroom: `{{H19_COST_CURRENT_FORECAST_HEADROOM}}`
- Human eligibility and disclosures: `{{OWNER_LEGAL_FIELDS_CONFIRMED}}`
- Human gates: `{{HG5_APPROVAL}}`, `{{HG6_APPROVAL}}`

## Built with

CockroachDB, Distributed Vector Indexing, CockroachDB Managed MCP, Amazon Bedrock, AWS Lambda,
Amazon API Gateway, Amazon S3, Amazon CloudFront, TypeScript, React, and Vitest. Include a service in
the submitted tags only when its corresponding checklist evidence is `PASS`.
