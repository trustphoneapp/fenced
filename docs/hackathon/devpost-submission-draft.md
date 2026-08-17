# Devpost submission draft

> Evidence-backed as of 2026-08-17. Every claim below was measured against the live deployment and
> the live CockroachDB cluster. The video link is the only outstanding field.

## Project name

Zintus Continuity

## Tagline

Agent memory that shows its work: recalled revisions, policy withholds, and correction lineage.

## Inspiration

Agent answers hide their retrieval. You get fluent text and no way to ask which memory produced it,
what the agent was not allowed to see, or what changed after a correction. That gap is not a UX
problem, it is an evidence problem, and it is the reason agent memory is hard to operate in
regulated settings. Continuity treats the evidence as part of the product rather than as logging.

## What it does

Continuity runs one fixed, synthetic five-step scenario:

1. `start` opens an opaque session and seeds versioned synthetic facts.
2. `ask_before` answers a question from authorized memory.
3. `correct` supersedes the launch-day fact from revision 1 (Monday) to revision 2 (Sunday).
4. `ask_after` answers the same question and now uses revision 2.
5. `latest_receipt` returns the durable answer and receipt with no new provider call.

Every answer ships a content-free disclosure receipt. A live receipt from the deployed demo shows
two recalled revisions, one reference withheld by policy, and full provider metadata:

```
recalled : fact 1111… revision 2, fact 3333… revision 1
withheld : fact 2222… revision 1, reason "sensitivity_policy"
receipt  : embeddingModel amazon.titan-embed-text-v2:0
           model          amazon.nova-lite-v1:0
           inputTokens 201  outputTokens 30  totalTokens 231
           policyVersion zc.hackathon-policy.v1
           retrievalVersion zc.hackathon-retrieval.v1
           providerRequestId b2f731d9-…  receiptId ceb949f2…
```

The withheld entry is the point. The restricted fact is referenced by id and reason only. Its body
never reaches Nova generation and never reaches the browser.

## How we built it

- CockroachDB Cloud v26.2.5 stores memory revisions, receipts, id-only lineage, and quota state.
- **Distributed Vector Indexing**: `memory_facts_titan_scope_l2` indexes 1024-dimension Titan
  embeddings under a five-column scope prefix. `EXPLAIN` names the index and emits a
  `• vector search` node.
- **Managed MCP Server**: a read-only pack of `select_query` and `explain_query` calls over three
  summary views, bound to `zc_continuity_mcp_reader`, which can read those views and nothing else.
- Amazon Bedrock supplies Titan Text Embeddings V2 and Nova Lite. AWS Lambda runs an arm64 container
  image behind API Gateway, with CloudFront serving the interface and Secrets Manager holding the
  database credential.
- Policy runs before retrieval and again before every transmission. Each step executes under
  `SET LOCAL ROLE` in a `SERIALIZABLE` transaction with bounded retry.

## Challenges we ran into

Three defects each stopped the deployed demo, and none appeared in CloudWatch because the container
entry intentionally discards its child's stderr.

The container replaces the child environment wholesale and had dropped `LD_LIBRARY_PATH`, so the
pinned python runtime could not resolve `libpython3.13.so.1.0` and exited 127 before the secret
resolver ran. The pool port then walked only one prototype level, but `pg` exports
`BoundPool extends Pool`, so `connect` sits two levels up and every real pool was rejected. Finally,
CockroachDB validates foreign keys inside the writing statement's query plan rather than with the
table owner's rights as PostgreSQL does, so the session role needed `SELECT` on the parents it
references and `INSERT continuity.hackathon_sessions` failed with `42501`.

The most interesting problem was a genuine conflict between two things we wanted. `memory_facts`
runs with row-level security forced on, and CockroachDB cannot combine a vector index scan with an
RLS policy on the same relation: `FORCE_INDEX` raises `42809` and `NO_FULL_SCAN` raises `XXUUU`.
Policy before retrieval is the guarantee this project exists to make, so we dropped the index hint
rather than the policy, and we say so in the README instead of quietly claiming both.

## Accomplishments that we're proud of

The receipt is judge-visible and falsifiable. Anyone can run the five steps and watch the answer
change from Monday to Sunday while the recalled revision changes from 1 to 2, with the restricted
fact withheld by id in both.

Managed MCP demonstrates isolation rather than asserting it. A connected agent sees an empty
database until it binds a tenant scope:

| Managed MCP call | unscoped | scoped |
| --- | --- | --- |
| `task-status` | 0 rows | 1 row |
| `receipt-summary` | 0 rows | 1 row |
| `evidence-lineage` | 0 rows | 2 rows |

## What we learned

Memory governance is a data-flow property, not a prompt. The database role, retrieval projection,
provider authorization, correction transaction, and public receipt must all agree on the same
revision and deletion fence, or the receipt is fiction.

We also learned that CockroachDB's differences from PostgreSQL are load-bearing rather than
cosmetic: foreign keys are checked in the query plan, `array_fill()` does not exist, a vector index
requires a constant query vector, and a vector index scan cannot carry an RLS policy. Each of those
turned into a real defect that static review did not catch and only live execution exposed.

## What's next for Zintus Continuity

Reconciling vector indexing with row-level security, either by scoping retrieval through a
security-definer boundary or by pushing the tenant predicate into the index scan. Beyond that:
authenticated multi-tenant sessions, encrypted payload storage with real erasure, and receipts
exported as portable evidence.

## Known limitations

The demo is fixed-fixture and synthetic, and it is not authenticated. The live recall path performs
a policy-filtered scan rather than a vector index scan, for the reason given above. The inline
synthetic memory schema is not a complete encrypted or backup-erasure design. No SQS path, second
provider, autonomous tools, learning, or multi-region runtime is claimed.

## Links

- Try it: <https://d2r4c62btm4zg8.cloudfront.net>
- API: <https://h6rzzov3qi.execute-api.us-east-1.amazonaws.com>
- Source: <https://github.com/trustphoneapp/zintus-continuity>
- Video: `{{PUBLIC_VIDEO_URL}}`

Measured end-to-end latency on the deployed demo, CloudFront origin: `start` 2.2 s, `ask_before`
2.8 s, `correct` 1.7 s, `ask_after` 2.5 s, `latest_receipt` 1.6 s. Cold start adds roughly 0.4 s of
init. Spend is bounded by a $25 budget alarm and by rolling caps of 600 Titan and 200 Nova public
calls enforced in the database.

## Built with

CockroachDB, CockroachDB Distributed Vector Indexing, CockroachDB Managed MCP, Amazon Bedrock,
Amazon Titan Text Embeddings V2, Amazon Nova Lite, AWS Lambda, Amazon API Gateway, Amazon CloudFront,
AWS Secrets Manager, Amazon ECR, AWS IAM, Amazon CloudWatch, AWS X-Ray, TypeScript, React, Vitest.
