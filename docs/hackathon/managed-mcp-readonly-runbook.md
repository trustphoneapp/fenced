# Managed MCP read-only showcase runbook

## Status and boundary

Verified against the live CockroachDB Cloud cluster on 2026-08-17 as `zc_continuity_mcp_reader`.
The three `select_query` calls in the pack return 0 rows until the session binds
`continuity.tenant_id` and `continuity.server_purpose` via `set_config` (itself a `SELECT`), then
return 1, 1 and 2 rows for that tenant. The `dvi-plan` `explain_query` is an operator proof taken
with an administrative identity, because the reader deliberately holds no `SELECT` on
`continuity.memory_facts`. The pack state is `LIVE_READ_ONLY_VERIFIED_2026_08_17`.

The local H5 mock is an application test double. It is not CockroachDB Managed MCP and none of its
custom names may be presented as Managed MCP tools.

## Operator-only authorization

1. Revoke the existing CockroachDB Cloud MCP OAuth grant that included write consent.
2. Start a fresh OAuth authorization and configure `mcp-cluster-id` for exactly the dedicated
   synthetic hackathon cluster. Do not place the cluster ID in source, this query pack, screenshots,
   or logs.
3. Record the provider's grant wording exactly as displayed in the live OAuth screen. Do not
   paraphrase it as “read-only.” Continue only when the displayed consent grants read access and
   presents no write consent or write tool. The wording is deliberately not invented here because
   provider text can change.
4. Record a content-free screenshot or transcript of the available tool list. The only permitted
   tool names for this showcase are `select_query` and `explain_query`. Do not attempt a write to
   create evidence; absence of write consent/tools is the required evidence.

Credentials, OAuth tokens, connection strings, tenant values, and cluster identifiers never enter
the repository or agent context.

## Canonical calls

Run `node scripts/verify-h18-managed-mcp.mjs` locally first. Then submit only the four unchanged
calls in `managed-mcp-queries.json`, in order:

1. `select_query` for `continuity.task_status_summary_v1`;
2. `select_query` for `continuity.receipt_summary_v1`;
3. `select_query` for `continuity.evidence_lineage_summary_v1`;
4. `explain_query` for the bounded DVI candidate query.

Every other MCP tool and every other query is prohibited. Do not add tenant-setting statements,
comments, multiple statements, raw-table reads, broader projections, or higher limits. The three
SELECT results expose explicit redacted metadata columns only and omit tenant and purpose identifiers.
The DVI candidate is under 16,384 characters, names the intended DVI explicitly, uses a fixed dummy
48-hex tenant, and is explained rather than executed.

## Required E4 evidence and honest limitation

Managed MCP's generic `select_query` cannot enforce this repository's exact query templates or bind
a caller to a tenant merely because this JSON file exists. Migration 0008's views use database
session settings, while the final Managed MCP operational identity and server-side tenant/purpose
binding remain unproven. A dedicated synthetic cluster reduces impact but does not prove raw-table
denial.

E4 must record the exact provider grant wording, one-cluster binding, available tool list, unchanged
canonical calls, redacted outputs, the sanitized DVI plan, and database grants observed by the live
identity. If E4 cannot prove a server-bound showcase tenant and purpose, Managed MCP stays disabled
and the README/video must disclose that generic access to the dedicated synthetic cluster was not
narrowed to the repository templates. No HG-3 runtime-success claim is allowed.

Official reference: <https://www.cockroachlabs.com/docs/cockroachcloud/connect-to-the-cockroachdb-cloud-mcp-server>
