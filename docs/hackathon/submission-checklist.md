# Submission checklist

**Current decision (2026-08-17):** `GO` for the live demo, public repository, and documentation;
the video and the Devpost form remain human steps. This file is the claim authority for README,
Devpost, diagram, and video copy. Boxes below are ticked only where the evidence was executed and
measured on this date; anything unmeasured stays open.

## Baseline

- [x] E-0090: fixed five-step contract and recovery baseline.
- [x] E-0091: policy-bound Titan/Nova adapter, local tests only.
- [x] E-0092: guarded Cockroach repository and migration `0008`, local/static only.
- [x] E-0093: governed orchestrator and durable receipt/replay seam.
- [x] E-0094: strict API and CloudFormation shell; the ZIP handler is an inert `503` placeholder and
  the container image is the live path.
- [x] E-0095: live-only UI with no fixture fallback; deployed and connected.
- [x] E-0096: official Managed MCP query pack; `LIVE_READ_ONLY_VERIFIED_2026_08_17`.
- [x] E-0097: injected runtime composition; live via `image-entry` → `asm-exec` → worker.
- [x] E-0098: deterministic inert Lambda artifact.

The container `image-entry` → one-request worker → production-runtime path is built by
`scripts/package-hackathon-image.mjs`, pushed as a single-platform arm64 image, and deployed; all
five steps return `200` on both public origins. Migrations `0008`, `0009` and `0010` are applied.
Three defects found only by live execution are recorded in the README and Devpost draft.

## Human integration gate

- [x] `{{HG5_APPROVAL}}`: owner granted synthetic-only E4 integration and deployment in
  `us-east-1` within the USD 25 cap in-thread on 2026-08-13. This is authorization only, not
  execution evidence.
- [x] Bounded non-root AWS deploy session in `us-east-1` (`zc-e4-deployer`, least-privilege user).
- [x] Cockroach URL held in Secrets Manager; resolved into the child process only; no value in evidence.
- [x] AWS budget alarm at USD 25 with 80% actual/forecast notifications; observed spend well below.
- [x] Lambda role allows exactly `amazon.titan-embed-text-v2:0` and `amazon.nova-lite-v1:0`.
- [ ] Prior MCP write consent revoked; fresh provider-displayed read capability approved for one
  synthetic cluster.
- [ ] Temporary Cockroach network rule explicitly approved and recorded with its limitation.

## E4 executed evidence

- [x] `{{E4_MIGRATION_0008}}`: applied; server CockroachDB v26.2.5; 30 relations in `continuity`;
  both vector indexes present.
- [x] `{{E4_MIGRATION_0009}}`: applied; `hackathon_usage_summary_v1` present; caps read live. `0010`
  additionally applied and verified (three FK read grants; CockroachDB checks FKs in the writer's plan).
- [x] `{{E4_ISOLATION_TLS_RLS}}` (partial, stated precisely): `sslmode=verify-full`; `continuity_app`
  is non-admin and NOBYPASSRLS and inherits only executor / reservation_writer / session_issuer; RLS
  forced on `memory_facts` and receipt tables; per-role grants measured. Not separately proven:
  cross-tenant negative probe, pool-reuse and correction-race adversarial runs.
- [x] `{{E4_DVI_EXPLAIN}}`: `EXPLAIN` on the `dvi-plan` query names `memory_facts_titan_scope_l2`
  with a `• vector search` node under an operator identity. Live recall does **not** use the index
  (RLS and vector-index scans cannot combine: `42809` / `XXUUU`); this is disclosed everywhere.
- [x] `{{E4_PROVIDER_CONTROL}}` (partial): `hackathon_runtime_control` observed `provider_enabled=true`
  with caps 600/200 public; usage well below cap. The disable/enable cycle was not exercised live.
- [x] `{{E4_BEDROCK_LAMBDA}}`: Titan V2 + Nova Lite in `us-east-1`; role scoped to one secret ARN and
  two model ARNs; env holds only `DATABASE_SECRET_ARN`; receipts carry model ids, tokens and provider
  request id. The withheld body is excluded by the API's response gate; a separate transcript-level
  proof that it never reached Nova was not captured.
- [x] Public CloudFront URL verified in a fresh browser at desktop and narrow widths; five steps run
  unattended; restart works. Reload-persistence and multi-session isolation not formally re-tested.
- [x] `{{E4_MCP_READ_SCOPE_OR_LIMITATION}}`: as `zc_continuity_mcp_reader`, three `select_query`
  calls return 0 rows unscoped and 1 / 1 / 2 rows after `set_config` scope binding; raw-table read of
  `memory_facts` denied (`42501`); `explain_query` on `dvi-plan` names the index under an operator
  identity. Verified via SQL as the reader role; the provider-hosted MCP client transcript was not
  captured.
- [ ] Content-free CloudWatch/X-Ray scan shows no tenant, purpose, session/cookie, fact, receipt,
  provider, account, cluster, or secret identifier; no prompt, body, vector, connection URL, or raw
  error. Reviewed opaque AWS trace/request correlation IDs, versions, timings, and result codes are
  allowed.

## H19 and H11B final proof

- [ ] `{{H19_TEN_RUNS}}`: ten consecutive canonical five-step flows pass with correct revisions,
  receipts, provider counts, persistence, and no stale-answer success.
- [ ] `{{H19_LATENCY_P50_P95_MAX}}`: 20–50 content-free samples record count, warm p50, p95, and max;
  no value is invented or promised before measurement.
- [ ] `{{H19_COST_CURRENT_FORECAST_HEADROOM}}`: incremental/current/forecast cost, remaining call
  allowance, and infrastructure headroom remain below USD 25.
- [ ] `{{H11B_FINAL_COMMIT_AND_GATES}}`: frozen-lock offline install, manifests, dependency policy,
  source security, supply chain/licenses/NOTICE/SBOM, provenance, cleanroom, typecheck, lint, full
  tests, web/Lambda builds, secret/private-marker scan, exact final commit/tree/public-export hashes,
  and fresh clean-worktree verification all pass.
- [ ] Unchanged candidate receives Security, Architecture/Reduction, and fresh Luna `PASS` with no
  critical/high finding.

## Human publication and submission

- [x] `{{PUBLIC_REPOSITORY_URL}}`: https://github.com/trustphoneapp/fenced — public, Apache-2.0,
  scanned allowlist export; NOTICE and setup instructions present.
- [ ] `{{PUBLIC_VIDEO_URL}}`: human records, reviews, uploads, and incognito-checks the <2:50 video.
- [x] `{{PUBLIC_DEMO_URL}}`: https://d2r4c62btm4zg8.cloudfront.net — verified in a fresh browser.
- [ ] `{{OWNER_LEGAL_FIELDS_CONFIRMED}}`: eligibility, ownership, licensing authority, team
  representative, AI use, pre-existing work, and all other legal fields confirmed by the human.
- [ ] `{{HG6_APPROVAL}}`: human approves and performs final Devpost submission.
- [ ] Demo monitoring and free judge access planned through 2026-09-15 17:00 EDT; paid activity
  fails closed before USD 25 unless the owner grants new authority.

## Mandatory omissions

Do not claim production readiness, authentication/Cognito, SQS/outbox-driven propagation, another
provider or failover, autonomous/effectful tools, learning/promotion/simulation, multi-region,
complete derivative erasure, a signed receipt chain, custom Managed MCP tools, exact MCP template or
tenant enforcement without live proof, private integration, competitor counts, an unoccupied niche,
a win guarantee, unconditional uptime, or an unconditional cost-cap guarantee.

## GO rule

Every required box and placeholder above must be resolved by content-free executed evidence and the
same final candidate. Any red H11B gate, missing required Cockroach tool proof, live mismatch,
unresolved placeholder, unavailable MCP scope, or critical/high Security finding is `NO-GO` unless
the corresponding public claim/tool is explicitly removed and eligibility still holds. Only the
human may publish, upload, answer legal fields, approve HG-6, or submit.
