import { StatusChip } from "./visualPrimitives.ts";
import { useState } from "react";
import type { CommandIncident, CommandView } from "./commandTypes";
import { displayText } from "./presentation";
import {
  impactRows,
  exposure,
  brief,
  audienceView,
  audienceMarkdown,
  responseOptions,
} from "./prototypeViews";
import type { Audience } from "./prototypeViews";
import type { ReferenceData } from "./scriptedTypes";
function download(name: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(
    new Blob([text], { type: `${type};charset=utf-8` }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export default function PrototypeCaseViews({
  incident,
  view,
  onOpenLab,
  onNote,
  locked,
  reference,
}: {
  incident: CommandIncident;
  view: CommandView;
  onOpenLab: () => void;
  onNote: (note: string) => Promise<unknown>;
  locked: boolean;
  reference?: ReferenceData;
}) {
  const [audience, setAudience] = useState<Audience>("txcc");
  const [note, setNote] = useState("");
  const [option, setOption] = useState("");
  const [feedback, setFeedback] = useState("");
  const run = incident.runSnapshot;
  const rows = run ? impactRows(run) : [];
  const estimate = run ? exposure(run, reference) : null;
  const document = brief(incident, reference);
  const options = (
    <section className="command-panel">
      <h2>Response options for review</h2>
      <p>Advisory, not approvals</p>
      <div className="prototype-alerts">
        {responseOptions(reference).map((item) => (
          <article className="command-event" key={item.id}>
            <h3>{item.title}</h3>
            <p>{item.actor}</p>
            <small>{item.basis}</small>
            <button
              className="button secondary"
              disabled={locked}
              onClick={() => {
                setOption(item.title);
                setNote("");
                setFeedback("");
              }}
            >
              Record a decision note
            </button>
          </article>
        ))}
      </div>
      {option && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!note.trim() || locked) return;
            try {
              await onNote(`Decision note — ${option}: ${note.trim()}`);
              setFeedback("Decision note saved to workspace. Not sent.");
              setOption("");
            } catch {
              setFeedback(
                "Note was not confirmed. Use workspace refresh/retry to reconcile before trying again.",
              );
            }
          }}
        >
          <label>
            {option}
            <textarea
              aria-label="Response option decision note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required
              disabled={locked}
            />
          </label>
          <button className="button primary" disabled={locked || !note.trim()}>
            Save decision note
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={locked}
            onClick={() => setOption("")}
          >
            Cancel
          </button>
        </form>
      )}
      {feedback && <p role="status">{feedback}</p>}
    </section>
  );
  if (view === "federation") {
    const result = audienceView(audience, incident, reference);
    return (
      <section className="command-panel">
        <h2>One case · audience-specific views</h2>
        <p>Draft · not sent</p>
        <nav className="investigation-steps" aria-label="Brief audience">
          {(
            [
              ["txcc", "TXCC"],
              ["water_partners", "Water-sector partners"],
              ["tdem_health", "TDEM / healthcare"],
              ["federal", "Federal partners"],
            ] as [Audience, string][]
          ).map(([id, label]) => (
            <button
              aria-pressed={audience === id}
              key={id}
              onClick={() => setAudience(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="command-dashboard-grid">
          <article>
            <h3>Shows</h3>
            {audience === "txcc" ? (
              <>
                <h4>What happened</h4>
                {document.happened.map((text, i) => (
                  <p key={i}>{displayText(text)}</p>
                ))}
                <h4>So what</h4>
                {document.soWhat.map((text, i) => (
                  <p key={i}>{displayText(text)}</p>
                ))}
              </>
            ) : (
              <pre className="prototype-audience-json">
                {JSON.stringify(result.shows, null, 2)}
              </pre>
            )}
          </article>
          <aside>
            <h3>Not shown</h3>
            <ul>
              {result.notShown.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            {audience === "txcc" && (
              <p>
                Internal case detail is included. Partner exports are separately
                allow-listed.
              </p>
            )}
          </aside>
        </div>
        <button
          className="button secondary"
          onClick={() =>
            download(`citride-${audience}-DRAFT.md`, audienceMarkdown(result))
          }
        >
          Download draft Markdown
        </button>
        <button
          className="button secondary"
          onClick={() =>
            download(
              `citride-${audience}-DRAFT.json`,
              JSON.stringify(result, null, 2),
              "application/json",
            )
          }
        >
          Download draft JSON
        </button>
      </section>
    );
  }
  if (view === "leadership")
    return (
      <>
        <section className="command-panel">
          <div className="command-panel-heading">
            <h2>Leadership brief</h2>
            <span>Draft · not sent</span>
          </div>
          <h3>1. What happened</h3>
          {document.happened.map((text, i) => (
            <p key={i}>{displayText(text)}</p>
          ))}
          <small>
            Captured sources:{" "}
            {document.sourceRefs.join(", ") || "Source not captured"}
          </small>
          <h3>2. So what</h3>
          {document.soWhat.map((text, i) => (
            <p key={i}>{displayText(text)}</p>
          ))}
          <h3>3. What can we do</h3>
          <p>
            Review source evidence, validate conditional service assumptions and
            record coordination needs.
          </p>
          <button
            className="button secondary"
            onClick={() =>
              download(
                `citride-brief-${incident.id}-DRAFT.md`,
                `# ${incident.title}\n\nDraft · not sent\n\n## What happened\n${document.happened.join("\n\n")}\n\n## So what\n${document.soWhat.join("\n\n")}\n\n## What can we do\n${document.options.map((item) => `- ${item.title} — ${item.actor}; ${item.basis}; ${item.verification}`).join("\n")}\n\nSources: ${document.sourceRefs.join(", ")}\n`,
              )
            }
          >
            Download draft Markdown
          </button>
          <button
            className="button secondary"
            onClick={() =>
              download(
                `citride-brief-${incident.id}-DRAFT.json`,
                JSON.stringify(document, null, 2),
                "application/json",
              )
            }
          >
            Download draft JSON
          </button>
        </section>
        {options}
      </>
    );
  if (view === "coordination")
    return (
      <>
        <section className="command-panel">
          <h2>Who needs attention first?</h2>
          <p>
            Prioritize captured evidence first, then the shortest modeled
            service window.
          </p>
          {rows.length ? (
            <ol>
              {rows.map((row) => (
                <li key={row.id}>
                  <strong>{displayText(row.label)}</strong>
                  <p>
                    {displayText(row.functionLabel)} ·{" "}
                    {row.windowHours
                      ? `${row.windowHours[0]}–${row.windowHours[1]} h (modeled, scenario-relative)`
                      : "Unknown timing — needs model review"}
                  </p>
                  <small>
                    {reference?.firstActions
                      .filter((action) => action.scope === "facility")
                      .map((action) =>
                        action.contactRole?.replaceAll("{facility}", row.label),
                      )
                      .join(" · ") ?? "Reference contacts unavailable"}
                  </small>
                </li>
              ))}
            </ol>
          ) : (
            <p>No captured service-impact run.</p>
          )}
        </section>
        {options}
      </>
    );
  return (
    <section className="command-panel">
      <div className="command-panel-heading">
        <div>
          <h2>What breaks next?</h2>
          <p>Modeled · not observed outages</p>
        </div>
        <button
          className="button secondary"
          disabled={locked || !run}
          onClick={onOpenLab}
        >
          Try a what-if in Scenario lab
        </button>
      </div>
      {!run ? (
        <p>No captured consequence run.</p>
      ) : (
        <>
          <p>
            {displayText(run.modelVersion)} · evaluation{" "}
            {run.request.evaluationHour} h · horizon {run.request.horizonHours}{" "}
            h · captured model revision {run.baselineRevision}
          </p>
          <h3>Dependency cascade</h3>
          <ol className="prototype-cascade">
            {rows.map((row) => (
              <li key={row.id}>
                <strong>{displayText(row.label)}</strong>
                <StatusChip status={row.state} className="cc-chip">
                  Modeled · {row.state.replaceAll("_", " ")}
                </StatusChip>
                {row.chains.map((chain, i) => (
                  <p key={i}>
                    {chain.map(displayText).join(" → ") ||
                      "Captured path unavailable"}
                  </p>
                ))}
                <details>
                  <summary>Evidence & assumptions</summary>
                  <p>Sources: {row.sourceRefs.join(", ")}</p>
                  <ul>
                    {row.assumptions.map((text, i) => (
                      <li key={i}>{displayText(text)}</li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ol>
          <h3>Planning timeline</h3>
          <p>Scenario-relative planning windows</p>
          {rows.map((row) => (
            <article className="prototype-timeline-row" key={row.id}>
              <strong>{displayText(row.label)}</strong>
              <div className="prototype-time-track">
                {row.windowHours && (
                  <span
                    style={{
                      left: `${Math.min(100, Math.max(0, (row.windowHours[0] / run.request.horizonHours) * 100))}%`,
                      width: `${Math.min(100, Math.max(0, ((row.windowHours[1] - row.windowHours[0]) / run.request.horizonHours) * 100))}%`,
                    }}
                  />
                )}
              </div>
              <small>
                {row.windowHours
                  ? `${row.windowHours[0]}–${row.windowHours[1]} h (modeled)`
                  : "Unknown — needs model review"}
              </small>
            </article>
          ))}
          <div className="command-boundary">
            <h3>Function-hours at risk</h3>
            <p>
              {estimate?.serviceHours
                .map((value) => value.toFixed(1))
                .join("–")}{" "}
              function-hours
            </p>
            <p>
              {estimate?.costUsd
                ?.map((value) =>
                  value.toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                  }),
                )
                .join("–")}{" "}
              illustrative exposure
            </p>
            <small>
              Planning estimate from scenario assumptions ·{" "}
              {estimate?.referenceVersion} · unconfirmed placeholder rates
            </small>
            {!!estimate?.notEstimated.length && (
              <>
                <h4>Not estimated</h4>
                <ul>
                  {estimate.notEstimated.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <h3>Excluded paths & model review</h3>
          <details>
            <summary>
              {run.excluded.length} excluded paths · {run.warnings.length}{" "}
              engine warnings
            </summary>
            <pre className="prototype-audience-json">
              {JSON.stringify(
                { excluded: run.excluded, warnings: run.warnings },
                null,
                2,
              )}
            </pre>
          </details>
          {rows.some((row) => row.functionId === "fire-flow") ? (
            <p>Fire flow is affected in this modeled loss scenario.</p>
          ) : (
            run.seed.lossType === "unsafe_water" && (
              <p>
                Unsafe water alone does not establish fire-flow loss;
                pressure-dependent paths remain excluded where the captured
                model records that constraint.
              </p>
            )
          )}
        </>
      )}
    </section>
  );
}
