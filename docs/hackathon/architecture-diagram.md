# Fenced — hackathon architecture

**Verified live on 2026-08-17.** All five steps return `200` on the public CloudFront and API
Gateway origins; receipts show two recalled revisions and one reference withheld by sensitivity
policy; the correction moves the launch-day fact from revision 1 to revision 2. Migrations
`0001`–`0010` are applied to CockroachDB Cloud v26.2.5.

Solid arrows are the live request path exercised by the demo. Dashed arrows are relationships that
are real but not on the per-request path (index provenance, Managed MCP read scope, IAM binding).

```mermaid
flowchart LR
  subgraph Client["Browser"]
    UI["React five-step UI<br/>sends only {step}"]
  end

  subgraph AWS["AWS us-east-1"]
    CF["CloudFront<br/>UI + /api proxy, same-origin cookie"]
    GW["API Gateway HTTP API"]
    subgraph L["Lambda · arm64 container from ECR"]
      ENTRY["image-entry<br/>resolves secret into child env only"]
      WORKER["one-request worker<br/>policy → retrieve → policy → generate → commit"]
    end
    SM["Secrets Manager<br/>CockroachDB credential"]
    subgraph BR["Amazon Bedrock"]
      TITAN["Titan Text Embeddings V2<br/>1024 dims"]
      NOVA["Nova Lite"]
    end
    OBS["CloudWatch · X-Ray · Budgets $25"]
    IAM["IAM role: 1 secret ARN + 2 model ARNs"]
  end

  subgraph CRDB["CockroachDB Cloud v26.2.5"]
    direction TB
    RLS["memory_facts<br/>RLS FORCED · SET LOCAL ROLE executor<br/>SERIALIZABLE + bounded retry"]
    DVI["VECTOR INDEX memory_facts_titan_scope_l2<br/>(tenant, purpose, space, status, sensitivity, embedding)"]
    RCPT["hackathon_answer_receipts · receipt_revisions ·<br/>receipt_withheld · response_payloads"]
    Q["hackathon_quota_lock FOR UPDATE<br/>600 Titan / 200 Nova rolling caps"]
    VIEWS["MCP summary views<br/>task_status · receipt · evidence_lineage<br/>scope-gated policies"]
  end

  subgraph MCP["CockroachDB Managed MCP · read-only"]
    AGENT["select_query · explain_query<br/>role zc_continuity_mcp_reader"]
  end

  UI --> CF --> GW --> ENTRY --> WORKER
  SM -.credential.-> ENTRY
  WORKER -->|"1 reserve quota"| Q
  WORKER -->|"2 policy before retrieval"| RLS
  WORKER -->|"embed"| TITAN
  RLS -. "index exists and is EXPLAIN-verified;<br/>live recall is a policy-filtered scan" .-> DVI
  WORKER -->|"3 policy before transmission"| NOVA
  WORKER -->|"4 commit receipt + lineage"| RCPT
  RCPT -->|"answer + receipt"| UI
  AGENT --> VIEWS
  VIEWS -. "0 rows unscoped → 1 / 1 / 2 rows scoped" .-> RCPT
  IAM -.-> L
  L -.-> OBS
```

## Receipt flow

- **recalled** — `(fact_id, revision)` pairs actually shown to Nova Lite.
- **withheld** — `(fact_id, revision, reason)`; the body never leaves CockroachDB.
- **lineage** — revision `r → r+1` recorded id-only at `correct`; the superseded body and vector are
  erased.

## What is and is not on the live path

| Component | On the per-request path | Notes |
| --- | --- | --- |
| Row-level security, `SET LOCAL ROLE`, `SERIALIZABLE` retry | Yes | Every step |
| DB-enforced provider quota (`FOR UPDATE`) | Yes | Before any Bedrock call |
| Vector index `memory_facts_titan_scope_l2` | **No** | Real and `EXPLAIN`-verified under an operator identity that bypasses RLS. CockroachDB cannot combine a vector-index scan with an RLS policy on the same relation (`FORCE_INDEX` → `42809`, `NO_FULL_SCAN` → `XXUUU`), so live recall runs as a policy-filtered ordered scan. The policy was kept; the hint was dropped. |
| Managed MCP summary views | No (agent-facing, not request-facing) | Reader sees zero rows until it binds `continuity.tenant_id` and `continuity.server_purpose` via `set_config`. |
| Secrets Manager | Yes | Resolved by `asm-exec` into the child process environment; the handler never sees the value. |

## Non-claims

No authentication, no real users, no multi-region runtime, no second provider, no autonomous
tools, no production erasure design beyond the synthetic schema, and no claim that live recall
uses the vector index.
