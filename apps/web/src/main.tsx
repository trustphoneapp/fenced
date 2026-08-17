import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { failureMessage, type LiveResult, liveSteps, postDemo } from "./api.js";
import "./styles.css";

function Detail({ result }: { result: LiveResult | undefined }) {
  if (result?.revision)
    return <p className="empty">Correction committed at revision {result.revision}.</p>;
  if (!result?.answer || !result.receipt)
    return <p className="empty">Select a completed answer step to inspect its redacted receipt.</p>;
  const { receipt } = result;
  const rows = [
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
    ["Latency", `${receipt.latencyMs} ms`],
  ];
  return (
    <div className="details">
      <p className="answer">{result.answer}</p>
      <div className="evidence">
        <h3>Evidence disclosed</h3>
        <ul>
          {result.recalled?.map((entry) => (
            <li key={`${entry.factId}:${entry.revision}`}>
              recalled {entry.factId} · revision {entry.revision}
            </li>
          ))}
          {result.withheld?.map((entry) => (
            <li key={`${entry.factId}:${entry.revision}`}>
              withheld {entry.factId} · revision {entry.revision} · {entry.reason}
            </li>
          ))}
        </ul>
        <h3>Receipt</h3>
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
function App() {
  const [position, setPosition] = useState(0),
    [history, setHistory] = useState<readonly LiveResult[]>([]),
    [inspect, setInspect] = useState<number>(),
    [busy, setBusy] = useState(false),
    [connection, setConnection] = useState("LOCAL · UNCONNECTED"),
    [error, setError] = useState<string>();
  const busyRef = useRef(false),
    ticket = useRef(0),
    controller = useRef<AbortController | undefined>(undefined),
    resultFocus = useRef<HTMLElement>(null),
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
    if (history.length || error) resultFocus.current?.focus();
  }, [history, error]);
  async function run(restart = false) {
    if (busyRef.current) return;
    if (restart) controller.current?.abort();
    const next = restart ? "start" : step;
    if (!next) return;
    const current = ++ticket.current,
      currentController = new AbortController(),
      timeout = setTimeout(() => currentController.abort(), 20_000);
    controller.current = currentController;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    if (restart) {
      setConnection("LOCAL · UNCONNECTED");
      setHistory([]);
      setInspect(undefined);
      setPosition(0);
    }
    const outcome = await postDemo(next, fetch, currentController.signal);
    clearTimeout(timeout);
    if (current !== ticket.current) return;
    busyRef.current = false;
    setBusy(false);
    if (outcome.kind !== "success") {
      if (!restart && outcome.kind === "network" && connection === "LIVE · CONNECTED")
        setConnection("LIVE · CONNECTION LOST");
      setError(failureMessage(outcome.kind));
      return;
    }
    setConnection("LIVE · CONNECTED");
    setHistory((prior) => (restart ? [outcome.result] : [...prior, outcome.result]));
    setInspect(restart ? 0 : history.length);
    setPosition(restart ? 1 : position + 1);
  }
  const selected = inspect === undefined ? undefined : history[inspect];
  return (
    <main className="shell" aria-busy={busy}>
      <header>
        <p className="badge">{connection}</p>
        <p className="claim">LIVE API ONLY · NO FIXTURES</p>
        <h1>Continuity</h1>
        <p className="lede">A governed memory flow: recall, correction, and a redacted receipt.</p>
        <p className="connection" aria-live="polite">
          {busy ? `Contacting live API for ${step?.replaceAll("_", " ") ?? "start"}…` : connection}
        </p>
      </header>
      <ol className="flow" aria-label="Fixed demo steps">
        {liveSteps.map((entry, index) => (
          <li
            key={entry}
            aria-current={index === position ? "step" : undefined}
            className={index < position ? "done" : ""}
          >
            {index < position
              ? "complete"
              : index === position
                ? busy
                  ? "pending"
                  : "current"
                : "pending"}
            : {entry.replaceAll("_", " ")}
          </li>
        ))}
      </ol>
      <section className="actions" aria-label="Demo actions">
        <button type="button" onClick={() => run(position > 0)} disabled={busy}>
          {busy ? "Working…" : "Start new demo"}
        </button>
        {position > 0 && step && (
          <button type="button" onClick={() => run()} disabled={busy}>
            {busy ? "Working…" : `Run ${step.replaceAll("_", " ")}`}
          </button>
        )}
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
      <section className="panel" aria-live="polite" tabIndex={-1} ref={resultFocus}>
        <h2>{selected?.step ? selected.step.replaceAll("_", " ") : "Live result"}</h2>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <Detail result={selected} />
        )}
      </section>
    </main>
  );
}
const root = document.querySelector("#root");
if (!(root instanceof HTMLElement)) throw new Error("Web composition root is missing");
createRoot(root).render(<App />);
