# Demo video script and shot list

Finalized 2026-08-17 from two research passes: general hackathon-video and short-form technique
research, and the official rules read directly from `cockroachdb-ai.devpost.com` on this date.
Target runtime **2:45**, strictly under the rule's **"less than three (3) minutes."**

## What the rules require of this specific video (quoted verbatim)

- Must show **"the Project functioning on the device for which it was built"** — record the live
  CloudFront demo in a real browser, not a mock or a slide.
- Must show **"the CockroachDB memory layer at work"** — every beat below is a live database
  round-trip; none are illustrative-only.
- **"Uploaded to and made publicly visible on YouTube or Vimeo."**
- **No third-party trademarks or copyrighted music** without permission. This script has no music
  cue; use silence or a royalty-free track if one is added, and confirm its license before upload.
- Upload with time to spare — Devpost's own guidance flags processing time as a real failure mode
  this close to the 2026-08-18 5:00pm EDT deadline.

## Hook (0:00–0:05)

**Use:** *"Your AI just told you 'Monday.' Would you bet on that — without seeing the receipt?"*

Reasoning: "Monday" is the literal answer the live demo gives at 0:34 and flips to "Sunday" at
1:10, so the hook is not a mood-setter, it is the first half of a payoff the viewer watches land on
screen ninety seconds later.

Alternates, if a re-shoot is needed:
- *"Most agent memory is a black box. This one hands you the SQL."*
- *"We're about to show you a query that returns zero rows on purpose. That's the feature."*

## Script

Every on-screen label below is the exact text the live page renders — copy it as spoken, do not
paraphrase headings.

| Time | Beat | Narration | On screen |
| --- | --- | --- | --- |
| 0:00–0:05 | Hook | "Your AI just told you 'Monday.' Would you bet on that — without seeing the receipt?" | Live page, cursor resting on **Run all five steps** |
| 0:05–0:18 | Setup | "This is Fenced. Every answer ships a disclosure receipt: what was recalled, what was withheld, what changed. Enforced inside CockroachDB, not bolted on." | Cut to **What runs when you click** architecture panel, then back to the hero |
| 0:18–0:34 | Step 1 — Start | "Step one: start. It mints a session, seeds three synthetic facts, and embeds them with Amazon Titan v2 — stored as vectors inside CockroachDB." | Click **Run all five steps**; step-1 card fills in, badge flips to `SESSION · LIVE` |
| 0:34–0:55 | Step 2 — Ask (before) | "Step two, ask before. Nova Lite answers a fixed question using memory recalled under CockroachDB row-level security — forced on, no exceptions. The answer: Monday. Two facts recalled at revision one. One withheld — reason: sensitivity policy. Its body never reached the model." | Receipt renders: **Recalled** group (green), **Withheld** group (rust) with the `sensitivity_policy` chip |
| 0:55–1:10 | Step 3 — Correct | "Step three: correct. We supersede the launch-day fact — revision one to revision two — in one CockroachDB SERIALIZABLE transaction. Nothing is deleted; the old revision stays on record." | **Correct** card; revision chip flips 1 → 2 |
| 1:10–1:28 | Step 4 — Ask (after) | "Step four, same question, same session. Recall now binds to revision two, and the answer flips to Sunday. Here's the diff, live. The withheld fact? Still withheld. Correcting memory didn't loosen the policy that hides it." | **Before vs after correction** panel: word diff highlights Monday → Sunday; withheld group unchanged |
| 1:28–1:42 | Step 5 — Latest receipt | "Step five: latest receipt. This replays the exact same receipt from CockroachDB — zero new Bedrock calls. If this were regenerated, none of this would be provable. It's a database read." | **Check it yourself** panel: four client-computed checks, all passing |
| 1:42–2:05 | Proof — Managed MCP | "Now, Cockroach proofs. Same SQL as our published Managed MCP query pack, run as a least-privilege, no-login reader role. Unscoped: zero rows across three tenant views. Bind the session's tenant scope — itself just a SELECT — and it reads real counts. An unscoped agent reads an empty database." | Click **Show Cockroach proofs**; **Managed MCP read scoping** card: `0 rows → N rows` per view |
| 2:05–2:30 | Proof — honest tradeoff | "This card is the live recall plan — an EXPLAIN of the real SQL, under row-level security. It doesn't use the vector index. This one proves the index exists: eight columns, embedding included. We didn't use it here, because CockroachDB can't combine a vector-index scan with row-level security on one relation. We kept the security, and disclosed the cost." | **Live recall plan** card, then **Vector index definition** card |
| 2:30–2:45 | Close | "Every claim on this screen is a live CockroachDB read, not a mock. Fenced: memory you can audit." | Pull back to the full page — five-step timeline, both receipts, diff panel, three proof cards; end on the repo and demo URLs |

## Production checklist

- **Tool:** Screen Studio (auto-zoom-on-click; least post time for this deadline). Fallback:
  CleanShot X.
- **Browser:** fixed window near 1600×1000, zoom 125–150% before recording, bookmarks bar and
  extensions hidden.
- **Audio:** record narration separately from the screen capture and sync in post — a flubbed line
  gets re-recorded without redoing the screen action. Quiet room, 6–8 inches from the mic, one
  level check first.
- **Emphasis:** click-zoom into each proof card individually. Burned-in arrow or callout on the
  number that changes (`0 rows → N rows`). Burned-in plain-English caption under every monospace
  block — a judge skimming muted still gets the point.
- **Pacing:** hold every result screen at least 2.5–3 seconds before cutting. Cut loading/API-wait
  moments entirely rather than speed-ramping.
- **Captions:** burn in every spoken line. A persistent small lower-third naming the project
  ("Fenced — CockroachDB × AWS") through at least the first few seconds helps a viewer
  who starts muted or skips around.

## Tool disclosure this video must support

Say once, plainly, ideally in the close or as an on-screen card before it — this maps directly to
the submission's required tool identification, not just to narration:

- CockroachDB: **Distributed Vector Indexing** (`memory_facts_titan_scope_l2`, shown in the Vector
  index definition card) and **Managed MCP Server** (shown in the Managed MCP read scoping card) —
  the two tools this project qualifies on, out of the four available. ccloud CLI and the Agent
  Skills Repo are not used and are not claimed.
- AWS: **Amazon Bedrock** (Titan v2 embeddings, Nova Lite generation) and **AWS Lambda** (the
  container that runs every step), both visible in the architecture panel.

## Recording safety

The proofs the video shows are already redacted server-side and verified live: no tenant id,
connection URL, cluster host, or database user appears in the Managed MCP or EXPLAIN output. Two
things still to check by hand before upload regardless:

- No browser devtools, network tab, or raw cookie header enters frame — the receipt UI is the
  proof surface, not the request internals.
- No account id, email, or other personal identifier from the recording machine appears in browser
  chrome, bookmarks, or window titles.
- Watch the final export once, full screen, with sound, before uploading.
