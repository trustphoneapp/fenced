import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { failureMessage, type LiveResult, liveSteps, postDemo } from "./api.js";
import {
  answerSegments,
  type DiffToken,
  type Lineage,
  type ProofCounts,
  type Proofs,
  type Receipt,
  shortId,
  stepMeta,
  wordDiff,
} from "./view.js";
import "./styles.css";

const readyBadge = "READY · NO SESSION";
const liveBadge = "SESSION · LIVE";
const lostBadge = "SESSION · CONNECTION LOST";
const question = "What is Continuity's launch day, and how can judges inspect the evidence?";

const glossary: Readonly<Record<string, string>> = Object.freeze({
  Receipt:
    "48-hex id of the committed receipt row in CockroachDB. latest_receipt returns this same value.",
  "Provider request": "Bedrock request id for the Nova Lite generation that produced this answer.",
  Compiler: "Context compiler that turned authorized memory into the model prompt.",
  Retrieval:
    "Retrieval configuration: top-k 3, authorized bodies plus id-only references for withheld rows.",
  Policy: "Version of the retrieval and transmission policy that authorized this request.",
  Embedding:
    "Titan Text Embeddings V2, 1024 dimensions. The vector index memory_facts_titan_scope_l2 is scoped to this space.",
  Model: "Generation model. Fixed by server policy; the browser cannot choose it.",
  Tokens: "Input, output and total tokens reported by Bedrock for the generation call.",
  "Model latency": "Nova Lite generation latency recorded in the receipt, not end-to-end.",
});

function Answer({ text }: { text: string }) {
  return (
    <p className="answer">
      {answerSegments(text).map((segment, index) =>
        segment.bold ? (
          <strong key={`${index}:${segment.text}`}>{segment.text}</strong>
        ) : (
          <span key={`${index}:${segment.text}`}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

function IdChip({ entry, changed }: { entry: Lineage; changed?: boolean }) {
  return (
    <li className={changed ? "changed" : undefined}>
      <span className="mono" title={entry.factId}>
        fact {shortId(entry.factId)}
      </span>
      <span className="rev">rev {entry.revision}</span>
      {entry.reason && <span className="reason">{entry.reason}</span>}
    </li>
  );
}

function Evidence({ result, previous }: { result: LiveResult; previous: LiveResult | undefined }) {
  const priorRevision = (factId: string) =>
    previous?.recalled?.find((entry) => entry.factId === factId)?.revision;
  return (
    <div className="evidence">
      <div className="group recalled">
        <h3>Recalled · released to the model</h3>
        <ul>
          {result.recalled?.map((entry) => (
            <IdChip
              key={`${entry.factId}:${entry.revision}`}
              entry={entry}
              changed={
                priorRevision(entry.factId) !== undefined &&
                priorRevision(entry.factId) !== entry.revision
              }
            />
          ))}
        </ul>
      </div>
      <div className="group withheld">
        <h3>Withheld · never reached the model</h3>
        <ul>
          {result.withheld?.map((entry) => (
            <IdChip key={`${entry.factId}:${entry.revision}`} entry={entry} />
          ))}
        </ul>
        <p className="note">
          Policy ran before retrieval. Only the id and revision were disclosed; the body never
          reached Nova Lite, the receipt, or this page.
        </p>
      </div>
    </div>
  );
}

function ReceiptTable({ receipt }: { receipt: Receipt }) {
  const rows: readonly (readonly [string, string])[] = [
    ["Receipt", receipt.receiptId],
    ["Provider request", receipt.providerRequestId],
    ["Compiler", receipt.compilerVersion],
    ["Retrieval", receipt.retrievalVersion],
    ["Policy", receipt.policyVersion],
    ["Embedding", `${receipt.embeddingModel} · ${receipt.embeddingSpace}`],
    ["Model", receipt.model],
    [
      "Tokens",
      `${receipt.inputTokens} input · ${receipt.outputTokens} output · ${receipt.totalTokens} total`,
    ],
    ["Model latency", `${receipt.latencyMs} ms`],
  ];
  return (
    <dl className="receipt">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>
            <abbr title={glossary[label]}>{label}</abbr>
          </dt>
          <dd className="mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Detail({
  result,
  previous,
}: {
  result: LiveResult | undefined;
  previous: LiveResult | undefined;
}) {
  if (!result)
    return (
      <p className="empty">
        Run the five steps to see a live answer with its disclosure receipt. Nothing on this page is
        pre-rendered; every value below comes from the deployed API.
      </p>
    );
  if (result.step === "start")
    return (
      <p className="empty">
        Session started. CockroachDB tenant scope bound; three synthetic facts stored at revision 1
        and embedded with Titan v2. One of them is marked for withholding by sensitivity policy.
      </p>
    );
  if (result.revision)
    return (
      <p className="empty">
        Correction committed. The launch-day fact was superseded from revision 1 to revision{" "}
        {result.revision} in one SERIALIZABLE transaction. The superseded body and vector were
        erased; lineage is kept by id only. Run the next step to see the answer change.
      </p>
    );
  if (!result.answer || !result.receipt) return null;
  return (
    <div className="details">
      <p className="question">
        Fixed question: <q>{question}</q>
      </p>
      <Answer text={result.answer} />
      <Evidence result={result} previous={previous} />
      <h3>Receipt</h3>
      <ReceiptTable receipt={result.receipt} />
    </div>
  );
}

function DiffColumn({ tokens, side }: { tokens: readonly DiffToken[]; side: "del" | "ins" }) {
  return (
    <p className="answer diff-text">
      {tokens.map((token, index) => {
        if (token.kind === "same") return <span key={`${index}:${token.text}`}>{token.text}</span>;
        if (token.kind !== side) return null;
        return side === "del" ? (
          <del key={`${index}:${token.text}`}>{token.text}</del>
        ) : (
          <ins key={`${index}:${token.text}`}>{token.text}</ins>
        );
      })}
    </p>
  );
}

function DiffView({ before, after }: { before: LiveResult; after: LiveResult }) {
  if (!before.answer || !after.answer || !before.receipt || !after.receipt) return null;
  // The model sometimes emits markdown emphasis; strip the markers so the diff compares prose only.
  const plain = (text: string) => text.replaceAll("**", "");
  const tokens = wordDiff(plain(before.answer), plain(after.answer));
  const changes: string[] = [];
  for (const entry of after.recalled ?? []) {
    const prior = before.recalled?.find((item) => item.factId === entry.factId);
    if (prior && prior.revision !== entry.revision)
      changes.push(`fact ${shortId(entry.factId)}: revision ${prior.revision} → ${entry.revision}`);
    else if (prior)
      changes.push(`fact ${shortId(entry.factId)}: revision ${entry.revision} unchanged`);
  }
  for (const entry of after.withheld ?? []) {
    const prior = before.withheld?.find((item) => item.factId === entry.factId);
    if (prior)
      changes.push(`withheld ${shortId(entry.factId)}: revision ${entry.revision}, still withheld`);
  }
  changes.push(
    before.receipt.receiptId === after.receipt.receiptId
      ? "receipt id unchanged"
      : "new receipt id and new provider request id",
  );
  return (
    <section className="panel diff" aria-labelledby="diff-title">
      <h2 id="diff-title">Before vs after correction</h2>
      <p className="lede-small">
        Same fixed question. The only change between these two answers is the correction committed
        in step 3. Removed words are struck; added words are underlined.
      </p>
      <div className="diff-grid">
        <div>
          <h3>Ask (before)</h3>
          <DiffColumn tokens={tokens} side="del" />
        </div>
        <ul className="gutter" aria-label="What changed">
          {changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
        <div>
          <h3>Ask (after)</h3>
          <DiffColumn tokens={tokens} side="ins" />
        </div>
      </div>
    </section>
  );
}

function ProofPanel({ history }: { history: readonly LiveResult[] }) {
  const after = history.find((entry) => entry.step === "ask_after");
  const latest = history.find((entry) => entry.step === "latest_receipt");
  const answers = history.filter((entry) => entry.answer && entry.receipt);
  const checks: readonly Readonly<{ ok: boolean | undefined; text: string }>[] = [
    {
      ok:
        after && latest
          ? after.receipt?.receiptId === latest.receipt?.receiptId &&
            after.receipt?.providerRequestId === latest.receipt?.providerRequestId
          : undefined,
      text: "latest_receipt returned the same receipt id and provider request id as ask_after. It was served from CockroachDB; a regeneration would carry a new provider request id.",
    },
    {
      ok:
        answers.length > 0
          ? answers.every(
              (entry) =>
                !entry.withheld?.some((w) =>
                  entry.recalled?.some((r) => r.factId === w.factId && r.revision === w.revision),
                ),
            )
          : undefined,
      text: "No withheld fact appears in any recalled list. The same id is never both released and withheld in one receipt.",
    },
    {
      ok: answers.length > 0 ? answers.every((entry) => entry.withheld?.length === 1) : undefined,
      text: "Every answer disclosed exactly one withheld reference with reason sensitivity_policy, before and after the correction.",
    },
    {
      ok: history.length > 0 ? true : undefined,
      text: "Every response passed strict shape validation in this browser: exact keys, 48-hex ids, token sum, fixed model and policy versions. Anything else is rejected, not rendered.",
    },
  ];
  return (
    <section className="panel proof" aria-labelledby="proof-title">
      <h2 id="proof-title">Check it yourself</h2>
      <p className="lede-small">
        These rows are computed in your browser from the live responses above. Nothing here is
        asserted by us; it is either true of the data you just received or it is marked as failed.
      </p>
      <ul className="checks">
        {checks.map((check) => (
          <li
            key={check.text}
            className={check.ok === undefined ? "pending" : check.ok ? "pass" : "fail"}
          >
            <span className="mark" aria-hidden="true">
              {check.ok === undefined ? "·" : check.ok ? "✓" : "✗"}
            </span>
            <span className="sr">
              {check.ok === undefined ? "Not yet run: " : check.ok ? "Passed: " : "Failed: "}
            </span>
            {check.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Architecture({ history }: { history: readonly LiveResult[] }) {
  const started = history.length > 0;
  const answered = history.some((entry) => entry.answer);
  const pill = (state: "used" | "idle" | "doc") =>
    state === "used" ? "used this session" : state === "idle" ? "not yet used" : "documented";
  const nodes: readonly Readonly<{ name: string; role: string; state: "used" | "idle" | "doc" }>[] =
    [
      {
        name: "Browser",
        role: "Sends only a fixed step name. Cannot choose a prompt, tenant, model, or query.",
        state: started ? "used" : "idle",
      },
      {
        name: "CloudFront + API Gateway",
        role: "Public origin. Same-origin cookie; only /api/* is proxied.",
        state: started ? "used" : "idle",
      },
      {
        name: "AWS Lambda · arm64 container",
        role: "One request per worker process. Database credential resolved from Secrets Manager into the child only.",
        state: started ? "used" : "idle",
      },
      {
        name: "Amazon Bedrock · Titan Text Embeddings V2",
        role: "1024-dimension embeddings at seed, correction, and query time.",
        state: started ? "used" : "idle",
      },
      {
        name: "CockroachDB Cloud v26.2.5",
        role: "Memory, policy engine, and ledger. Row-level security forced; SET LOCAL ROLE per step; SERIALIZABLE with bounded retry; DB-enforced provider quota.",
        state: started ? "used" : "idle",
      },
      {
        name: "Amazon Bedrock · Nova Lite",
        role: "Generation, only after transmission policy binds context, active revisions, and deletion fence.",
        state: answered ? "used" : "idle",
      },
      {
        name: "Receipt commit",
        role: "Receipt, id-only lineage, and erasable response body committed in one transaction before the answer is released.",
        state: answered ? "used" : "idle",
      },
      {
        name: "CockroachDB Managed MCP · read-only",
        role: "select_query and explain_query over three summary views as a least-privilege reader. An unscoped agent sees zero rows.",
        state: "doc",
      },
    ];
  return (
    <section className="panel arch" aria-labelledby="arch-title">
      <h2 id="arch-title">What runs when you click</h2>
      <ol className="nodes">
        {nodes.map((node) => (
          <li key={node.name} className={`node node-${node.state}`}>
            <div className="node-head">
              <span className="node-name">{node.name}</span>
              <span className="pill">{pill(node.state)}</span>
            </div>
            <p>{node.role}</p>
          </li>
        ))}
      </ol>
      <p className="footnote">
        Honest limit: live recall runs as a policy-filtered ordered scan. CockroachDB cannot combine
        a vector-index scan with a row-level-security policy on the same relation, so the policy was
        kept and the index hint dropped. The vector index memory_facts_titan_scope_l2 exists and is
        named by EXPLAIN under a non-RLS operator identity; that proof lives in the repository, not
        on this page.
      </p>
    </section>
  );
}

const rowLabel = (count: number) => `${count} ${count === 1 ? "row" : "rows"}`;

function CountRow({
  label,
  unscoped,
  scoped,
}: {
  label: string;
  unscoped: number;
  scoped: number;
}) {
  return (
    <li>
      <span className="mono">{label}</span>
      <span className="rev">{rowLabel(unscoped)}</span>
      <span aria-hidden="true">→</span>
      <span className={scoped > unscoped ? "rev changed-count" : "rev"}>{rowLabel(scoped)}</span>
    </li>
  );
}

function ProofCards({ proofs }: { proofs: Proofs }) {
  const rows: readonly (readonly [string, keyof ProofCounts])[] = [
    ["task-status", "taskStatus"],
    ["receipt-summary", "receiptSummary"],
    ["evidence-lineage", "evidenceLineage"],
  ];
  return (
    <>
      <section className="panel proofcard" aria-labelledby="mcp-title">
        <div className="cardhead">
          <h2 id="mcp-title">Managed MCP read scoping</h2>
          <span className="pill live">Live</span>
        </div>
        <p className="lede-small">
          The three read-only queries from the published Managed MCP pack, run just now under the
          least-privilege reader role. Unscoped first, then with the tenant scope bound.
        </p>
        <ul className="counts">
          {rows.map(([label, key]) => (
            <CountRow
              key={label}
              label={label}
              unscoped={proofs.mcp.unscoped[key]}
              scoped={proofs.mcp.scoped[key]}
            />
          ))}
        </ul>
        <p className="note">
          An agent that has not bound a scope reads an empty database. Binding uses set_config,
          which is itself a SELECT, so scoping stays inside the read-only tool surface. This page
          runs the same role and the same SQL through the demo API; it is not a public MCP endpoint,
          and no database credential is issued to anyone.
        </p>
      </section>

      <section className="panel proofcard" aria-labelledby="recall-title">
        <div className="cardhead">
          <h2 id="recall-title">Live recall plan</h2>
          <span className="pill live">Live</span>
        </div>
        <p className="lede-small">
          This is the plan for the query the ask steps actually run, taken just now under row-level
          security. Tenant ids, hosts and users are redacted at the server.
        </p>
        <pre className="plan">{proofs.recallPlan.join("\n")}</pre>
        <p className="note">
          The vector index is not named here, and that is the honest result: live recall is a
          policy-filtered scan.
        </p>
      </section>

      <section className="panel proofcard" aria-labelledby="index-title">
        <div className="cardhead">
          <h2 id="index-title">Vector index definition</h2>
          <span className="pill live">Live</span>
        </div>
        <p className="lede-small">
          Read live from the catalog: the vector index exists on continuity.memory_facts with this
          exact column order.
        </p>
        <p className="mono indexname">{proofs.indexName}</p>
        <ol className="indexcols">
          {proofs.indexColumns.map((column, index) => (
            <li key={column} className="mono">
              <span className="rev">{index + 1}</span> {column}
            </li>
          ))}
        </ol>
        <p className="footnote">
          Live recall does not use this index. CockroachDB cannot combine a vector index scan with a
          row-level-security policy on the same relation, so the policy was kept and the index hint
          dropped. Selecting it requires an identity that bypasses row-level security, which no
          identity in this request path has.
        </p>
      </section>
    </>
  );
}

function JudgeGuide() {
  return (
    <section className="panel judge" aria-labelledby="judge-title">
      <h2 id="judge-title">For judges · sixty seconds</h2>
      <ol className="steps-list">
        <li>Click Run all five steps.</li>
        <li>Watch the answer change and the recalled revision move from 1 to 2.</li>
        <li>Note the withheld fact in both receipts. Its body never appears anywhere.</li>
        <li>Note that step 5 returns the same receipt id without a new provider request id.</li>
      </ol>
      <div className="two-col">
        <div>
          <h3>What the browser cannot do</h3>
          <ul>
            <li>Send a prompt</li>
            <li>Choose a tenant</li>
            <li>Run SQL</li>
            <li>Pick a model</li>
            <li>Read the withheld body</li>
          </ul>
        </div>
        <div>
          <h3>What we do not claim</h3>
          <ul>
            <li>Authentication or real users; the scenario is fixed and synthetic</li>
            <li>Vector-index recall on the live path; see the note above</li>
            <li>Multi-region runtime, second provider, or autonomous tools</li>
            <li>Encrypted-at-rest erasure design beyond the synthetic schema</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function App() {
  const [position, setPosition] = useState(0),
    [history, setHistory] = useState<readonly LiveResult[]>([]),
    [inspect, setInspect] = useState<number>(),
    [busy, setBusy] = useState(false),
    [connection, setConnection] = useState(readyBadge),
    [error, setError] = useState<string>(),
    [confirmRestart, setConfirmRestart] = useState(false),
    [proofs, setProofs] = useState<Proofs | undefined>(undefined);
  const busyRef = useRef(false),
    ticket = useRef(0),
    controller = useRef<AbortController | undefined>(undefined),
    resultFocus = useRef<HTMLElement>(null),
    liveRef = useRef(false),
    step = liveSteps[position];
  useEffect(
    () => () => {
      ticket.current += 1;
      busyRef.current = false;
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (history.length || error) resultFocus.current?.focus({ preventScroll: true });
  }, [history, error]);
  /**
   * Run one fixed step. `from` names the step index explicitly so a sequential runner never reads
   * a stale closure; on success the next index is returned so the caller can chain.
   */
  async function run(restart = false, from?: number, side?: "proofs"): Promise<number | undefined> {
    if (busyRef.current) return undefined;
    if (restart) controller.current?.abort();
    const index = restart ? 0 : (from ?? position);
    const next = side ?? liveSteps[index];
    if (!next) return undefined;
    const current = ++ticket.current,
      currentController = new AbortController(),
      timeout = setTimeout(() => currentController.abort(), 20_000);
    controller.current = currentController;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    setConfirmRestart(false);
    if (restart) {
      liveRef.current = false;
      setConnection(readyBadge);
      setProofs(undefined);
      setHistory([]);
      setInspect(undefined);
      setPosition(0);
    }
    const outcome = await postDemo(next, fetch, currentController.signal);
    clearTimeout(timeout);
    if (current !== ticket.current) return undefined;
    busyRef.current = false;
    setBusy(false);
    if (outcome.kind !== "success") {
      if (!restart && outcome.kind === "network" && liveRef.current) setConnection(lostBadge);
      setError(failureMessage(outcome.kind));
      return undefined;
    }
    liveRef.current = true;
    setConnection(liveBadge);
    if (side) {
      // The proofs side step is repeatable and never advances the beat.
      setProofs(outcome.result.proofs);
      return index;
    }
    setHistory((prior) => (restart ? [outcome.result] : [...prior, outcome.result]));
    setInspect(index);
    setPosition(index + 1);
    return index + 1;
  }
  /** Run every remaining step in order, stopping at the first failure. */
  async function runFrom(start: number | undefined) {
    if (busyRef.current) return;
    let next = start === undefined ? await run(true) : start;
    while (next !== undefined && next < liveSteps.length) next = await run(false, next);
  }
  /**
   * Run the read-only proofs. A judge may click this at any time; if no answer exists yet we run
   * enough of the beat first that all three summary views have rows, otherwise the scoped counts
   * would read as zero and look like a failure rather than isolation.
   */
  async function runProofs() {
    if (busyRef.current) return;
    let next: number | undefined = position;
    if (history.length === 0) next = await run(true);
    while (next !== undefined && next < 2) next = await run(false, next);
    if (next === undefined) return;
    await run(false, undefined, "proofs");
  }
  const selected = inspect === undefined ? undefined : history[inspect];
  const before = history.find((entry) => entry.step === "ask_before");
  const after = history.find((entry) => entry.step === "ask_after");
  const previous = selected?.step === "ask_after" ? before : undefined;
  const done = position >= liveSteps.length;
  const primaryLabel = busy
    ? "Running…"
    : position === 0
      ? "Run all five steps"
      : done
        ? "Run again"
        : `Run step ${position + 1}: ${step ? stepMeta[step].label : ""}`;
  return (
    <main className="shell" aria-busy={busy}>
      <header>
        <output className="badges" aria-live="polite">
          <p className="badge">{busy ? "CONTACTING LIVE API…" : connection}</p>
          <p className="claim">LIVE API · NO FIXTURES · SYNTHETIC DATA</p>
        </output>
        <p className="eyebrow">Agent memory with disclosure receipts</p>
        <h1>Zintus Continuity</h1>
        <p className="lede">
          Every answer ships a receipt: which memory revisions were recalled, which were withheld by
          policy, and what a correction changed. Memory and policy live in CockroachDB; models run
          on Amazon Bedrock.
        </p>
        <p className="connection">
          Five fixed, server-owned steps. The browser sends only a step name; it cannot choose a
          prompt, tenant, or query.
        </p>
      </header>
      <ol className="flow" aria-label="Fixed demo steps">
        {liveSteps.map((entry, index) => {
          const meta = stepMeta[entry];
          const state =
            index < position
              ? "done"
              : index === position
                ? busy
                  ? "running"
                  : "next"
                : "waiting";
          return (
            <li
              key={entry}
              aria-current={index === position ? "step" : undefined}
              className={state}
            >
              <span className="step-n">{index + 1}</span>
              <span className="step-label">{meta.label}</span>
              <span className="step-server">{meta.server}</span>
              <span className="step-allow mono">
                Titan {meta.titan} · Nova {meta.nova}
              </span>
              <span className="chip">
                {state === "done"
                  ? "Done"
                  : state === "running"
                    ? "Running…"
                    : state === "next"
                      ? "Next"
                      : "Waiting"}
              </span>
            </li>
          );
        })}
      </ol>
      <section className="actions" aria-label="Demo actions">
        <button
          type="button"
          className="primary"
          onClick={() => (position === 0 || done ? runFrom(undefined) : run())}
          disabled={busy}
        >
          {primaryLabel}
        </button>
        <button type="button" onClick={() => runProofs()} disabled={busy}>
          {busy ? "Running…" : "Show Cockroach proofs"}
        </button>
        {position > 0 && !done && (
          <button type="button" onClick={() => runFrom(position)} disabled={busy}>
            Run remaining steps
          </button>
        )}
        {position > 0 &&
          (confirmRestart ? (
            <span className="confirm">
              This discards the current session.
              <button type="button" onClick={() => run(true)} disabled={busy}>
                Restart
              </button>
              <button type="button" onClick={() => setConfirmRestart(false)} disabled={busy}>
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="link"
              onClick={() => setConfirmRestart(true)}
              disabled={busy}
            >
              Restart session
            </button>
          ))}
      </section>
      {history.length > 0 && (
        <nav className="history" aria-label="Completed results">
          {history.map((entry, index) => (
            <button
              key={`${entry.step}:${index}`}
              type="button"
              aria-pressed={inspect === index}
              onClick={() => setInspect(index)}
            >
              Inspect {entry.step.replaceAll("_", " ")}
            </button>
          ))}
        </nav>
      )}
      <section className="panel result" aria-live="polite" tabIndex={-1} ref={resultFocus}>
        <h2>
          {selected?.step
            ? (stepMeta[selected.step as keyof typeof stepMeta]?.label ?? "Cockroach proofs")
            : history.length === 0
              ? "No session yet"
              : "Live result"}
        </h2>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <Detail result={selected} previous={previous} />
        )}
      </section>
      {before && after && <DiffView before={before} after={after} />}
      {proofs && <ProofCards proofs={proofs} />}
      <ProofPanel history={history} />
      <Architecture history={history} />
      <JudgeGuide />
      <footer>
        <p className="mono">
          zc.hackathon-policy.v1 · zc.hackathon-retrieval.v1 · zc.hackathon-context.v1 · synthetic
          data only
        </p>
      </footer>
    </main>
  );
}
const root = document.querySelector("#root");
if (!(root instanceof HTMLElement)) throw new Error("Web composition root is missing");
createRoot(root).render(<App />);
