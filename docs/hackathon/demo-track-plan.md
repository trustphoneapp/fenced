# Hackathon demo track — battle plan

Owner-selected on 2026-08-07 by in-thread direction: build the hackathon demo to win;
launch-ready at least 2 days before the deadline. Owner commits to continuous availability
("24 hours in loop") for human-gate actions and credentials.

- Competition: CockroachDB × AWS Hackathon — Build with Agentic Memory
- Submission deadline: 2026-08-18 17:00 EDT
- **Hard internal deadline: 2026-08-16 end of day — everything launch-ready.** Aug 17–18 are
  buffer for submission mechanics only, never for feature work.

## The winning concept

**Continuity Recall Ledger — the memory layer that shows its work.**

A live agent whose every answer ships with a receipt:

1. what it recalled (CockroachDB vector search),
2. what policy withheld before the model ever saw it (policy-before-retrieval), and
3. what changed after a correction or retraction propagated (outbox-driven lineage).

Judges interrogate the receipts themselves through the read-only Managed MCP server.

Why this wins vs the visible field (44+ public repos as of Aug 7): the compliance/erasure niche
(erasure-proof), coordination niche (Roshambo), and vertical-RAG niches (AURA, Griot, incident
cluster) are occupied; **disclosure receipts and correction propagation are unclaimed.**
Erasure-proof proves memory is *gone*; we prove what memory was *used, withheld, and corrected*.

## Required tool usage (submission checklist)

- CockroachDB tool 1: Distributed Vector Indexing — `agent_memory` embeddings, tenant-prefixed
  vector index, cosine recall.
- CockroachDB tool 2: Managed MCP Server (read-only) — judges query receipts/lineage in natural
  language.
- AWS service 1: Amazon Bedrock — Titan embeddings + model inference for answers.
- AWS service 2: AWS Lambda — agent execution.
- Public Apache-2.0 repo (already), README with setup/run instructions, <3-min video,
  architecture diagram, functional demo URL.

## Day-by-day (dates inclusive; slip = cut scope, never the deadline)

| Date | Build focus | Owner (human) actions |
| --- | --- | --- |
| Aug 7 (D0) | H1 slice: recall ledger core — policy-gated retrieval, disclosure receipts, correction propagation, local synthetic adapters + tests; migration 0007 | Start immediately: CockroachDB Cloud account + Basic (free) cluster on AWS; AWS account + Bedrock model-access request (Titan Embed v2 + one text model); Devpost registration |
| Aug 8 (D1) | H1 hardening + cross-model review; demo dataset design; embedding-space versioning | Confirm cluster connection string + AWS credentials available in local `.env` (never committed) |
| Aug 9 (D2) | H2: real CockroachDB — run migrations on cluster, real vector index, integration tests | Enable Managed MCP on the cluster; verify ccloud CLI login |
| Aug 10 (D3) | H3: Bedrock adapters (embeddings + inference) behind existing provider ports; Lambda handler | Verify Bedrock model access granted; sanity-test one embedding call |
| Aug 11 (D4) | H4: end-to-end loop on real infra — teach → ask (receipt) → correct → ask (changed answer + lineage receipt) | — |
| Aug 12 (D5) | H5: Managed MCP read-only exposure of receipts; ccloud usage documented; agent-skills touchpoint | Test MCP from Claude/Cursor as a judge would |
| Aug 13 (D6) | H6: thin demo web UI (answer + receipt panel side by side); deploy (Lambda + S3/CloudFront) | Approve the public demo URL |
| Aug 14 (D7) | H7: seed data, polish, failure-path demo beat, architecture diagram, README overhaul | Rehearse the 3-minute demo script |
| Aug 15 (D8) | H8: record + edit video; Devpost submission draft; full regression | Upload video to YouTube; fill Devpost form fields |
| Aug 16 (D9) | **LAUNCH-READY.** Final end-to-end test from a clean machine following README only | Submit (or hold for final check) |
| Aug 17–18 | Buffer: submission mechanics, judge-access verification only | Final submit well before 17:00 EDT Aug 18 |

## D1 local/synthetic checkpoint

- H1 recall hardening is locally reviewed and tested: standard recall is filtered before vector ranking, receipts retain IDs-only policy-withheld entries, corrections use expected-revision CAS, and reauthorization occurs before receipt/output release.
- H2 generated SQL plans now bind the access tier and revision chain; they are static only. No CockroachDB migration, transaction, provider, MCP, or cloud execution is claimed.
- Focused H1/H2/H3 tests, TypeScript, scoped lint, static schema verification, and diff hygiene pass. The broad suite remains blocked by pre-existing cleanroom/manifest failures outside this demo slice.

## Scope discipline

- The demo cut reuses what exists: migrations 0001–0006, RLS/tenant isolation, erasable
  payloads, receipts concepts, C06 revision requests, C07 outbox (as propagation transport).
- C07 local delivery semantics include receipt-before-ack, lease/reclaim, and a single-successor guard;
  CockroachDB migration/RLS/concurrency behavior remains unexecuted and is stated as a limit.
- Anything not on the day-by-day table is out of scope until after Aug 18. No new governance
  phases, no full P0 pursuit during this window.
- Cross-model review continues but is batched once per day-slice, not per edit; failed review
  fixes fold into the next day's slice.

## Authority boundaries (unchanged)

- Cloud, credentials, providers, MCP runtime, deployment, and submission remain human-gated
  (HG-5/HG-6). Every such step is performed or explicitly approved by the owner in-thread; this
  plan schedules those approvals, it does not replace them.
- Private Zintus repository remains fully prohibited.
- Credentials live only in untracked local env files; nothing sensitive is committed.

## Honest status labels

Planned ≠ implemented ≠ tested ≠ deployed ≠ demonstrated. The submission README and video state
exactly which tier each capability reached — the "honesty moat" is part of the pitch.
