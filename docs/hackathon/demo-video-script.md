# Demo video script and shot list

> **RECORD ONLY AFTER E4/H19 GO.** Target runtime: 2:48. Use the deployed five-step UI and official
> Managed MCP tools only. Never substitute local fixtures or test-double tools for missing footage.

| Time | Narration | Shot | Required evidence |
| --- | --- | --- | --- |
| 0:00–0:12 | “Most memory demos show an answer. Continuity also shows which revision supported it, what policy withheld, and what a correction changed.” | Public demo hero and `LIVE · CONNECTED` badge | `{{PUBLIC_DEMO_URL}}` |
| 0:12–0:28 | “A fixed synthetic request crosses two policy gates: before Cockroach vector retrieval and before Bedrock generation. The answer is released only after its receipt commits.” | Current architecture diagram; emphasize the demonstrated path | `{{E4_BEDROCK_LAMBDA}}` |
| 0:28–0:43 | “Start creates a server-owned session and embeds three fixed synthetic facts. The browser cannot supply a tenant, prompt, memory, or model.” | Click **Start new demo**; show step success | `{{H19_TEN_RUNS}}` |
| 0:43–1:08 | “Now ask: ‘What is Continuity’s launch day, and how can judges inspect the evidence?’ The answer uses Monday revision 1 and the evidence note. Nova generation never received the restricted body; the receipt records only its withheld ID and reason.” | Run `ask_before`; show answer, recalled revisions, withheld ID and `sensitivity_policy` | `{{E4_ISOLATION_TLS_RLS}}` + `{{E4_BEDROCK_LAMBDA}}` |
| 1:08–1:25 | “Correct changes the launch fact atomically from Monday revision 1 to Sunday revision 2 and records content-free lineage.” | Run `correct`; show revision 2 | `{{H19_TEN_RUNS}}` |
| 1:25–1:48 | “The identical question now answers Sunday. Its receipt binds revision 2, the deletion fence, models, policy, tokens, and latency.” | Run `ask_after`; compare before/after panels | `{{E4_BEDROCK_LAMBDA}}` |
| 1:48–2:03 | “Latest receipt is database-only: the identical durable answer, receipt, and provider request ID return with zero new provider calls.” | Run `latest_receipt` as the fifth step; compare the visible durable fields | `{{H19_TEN_RUNS}}` + separate provider-call evidence |
| 2:03–2:23 | “CockroachDB Managed MCP uses the official `select_query` tool on three redacted views. They expose bounded status, receipt, and lineage evidence, never memory or answer bodies.” | Run the unchanged task-status, receipt, and lineage view queries | `{{E4_MCP_READ_SCOPE_OR_LIMITATION}}` |
| 2:23–2:38 | “Official `explain_query` shows the scoped Titan L2 distributed vector index and exact prefix spans.” | Show sanitized plan with named index | `{{E4_DVI_EXPLAIN}}` |
| 2:38–2:48 | “Continuity combines CockroachDB memory with Titan embeddings, Nova generation, and Lambda: agent memory that can prove what it used, withheld, and corrected.” | Stack marks, source/demo/video URLs | `{{H11B_FINAL_COMMIT_AND_GATES}}` |

## Recording safety

- Record at 1080p from a clean browser profile; crop account, browser-extension, and operator chrome.
- Show only synthetic public DTOs and redacted MCP results. Never show credentials, cookies, secret
  references, account/cluster/tenant identifiers, connection strings, raw logs, or provider errors.
- Hash and review the final file; scan every scene for leakage and verify the public upload in an
  incognito browser.
- If any required evidence is absent, inconsistent, or blocked, do not record or upload. Decision:
  `NO-GO`.
