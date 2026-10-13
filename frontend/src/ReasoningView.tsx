import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  FileText,
  Loader2,
  Play,
  RefreshCw,
} from "lucide-react";
import { api, describe, humanize } from "./api";
import { displayText } from "./presentation";
import type {
  Bootstrap,
  InferenceFact,
  InferenceProof,
  InferenceRun,
  InferenceRunSummary,
  OntologyMetadata,
} from "./types";
import "./reasoning.css";

function failureMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

function factText(fact: InferenceFact): string {
  return `${displayText(fact.subject.label)} → ${fact.predicate.label} → ${displayText(fact.object.label)}`;
}

function createdLabel(timestamp?: string): string {
  if (!timestamp) return "Time not recorded";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

function diagnosticLabel(value: unknown): string {
  if (value && typeof value === "object" && "message" in value) {
    const record = value as Record<string, unknown>;
    const status =
      typeof record.status === "string" ? `${humanize(record.status)} · ` : "";
    if (typeof record.message === "string") return `${status}${record.message}`;
  }
  return describe(value);
}

export default function ReasoningView({ data }: { data: Bootstrap }) {
  const [metadata, setMetadata] = useState<OntologyMetadata | null>(null);
  const [history, setHistory] = useState<InferenceRunSummary[]>([]);
  const [run, setRun] = useState<InferenceRun | null>(null);
  const [selectedFactId, setSelectedFactId] = useState("");
  const [proof, setProof] = useState<InferenceProof | null>(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [proofError, setProofError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<"all" | "asserted" | "inferred">(
    "inferred",
  );
  const [search, setSearch] = useState("");
  const [predicate, setPredicate] = useState("");
  const capturedRunId = useRef("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    async function refresh() {
      try {
        const [ontology, list] = await Promise.all([
          api<OntologyMetadata>("/v1/ontology"),
          api<{ runs: InferenceRunSummary[] }>("/v1/inference-runs"),
        ]);
        if (!active) return;
        setMetadata(ontology);
        setHistory(list.runs);
        const runId = capturedRunId.current || list.runs[0]?.id;
        if (runId) {
          const result = await api<InferenceRun>(
            `/v1/inference-runs/${encodeURIComponent(runId)}`,
          );
          if (active) {
            capturedRunId.current = result.id;
            setRun(result);
          }
        }
      } catch (failure) {
        if (active) setError(failureMessage(failure));
      } finally {
        if (active) setLoading(false);
      }
    }
    void refresh();
    return () => {
      active = false;
    };
  }, [data.baselineRevision, reloadKey]);

  useEffect(() => {
    let active = true;
    setProof(null);
    setProofError("");
    setProofLoading(false);
    if (!run || !selectedFactId) return;
    setProofLoading(true);
    api<InferenceProof>(
      `/v1/inference-runs/${encodeURIComponent(run.id)}/facts/${encodeURIComponent(selectedFactId)}`,
    )
      .then((result) => {
        if (active) setProof(result);
      })
      .catch((failure) => {
        if (active) setProofError(failureMessage(failure));
      })
      .finally(() => {
        if (active) setProofLoading(false);
      });
    return () => {
      active = false;
    };
  }, [run?.id, selectedFactId]);

  async function perform(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function acceptRun(result: InferenceRun) {
    capturedRunId.current = result.id;
    setSelectedFactId("");
    setRun(result);
  }

  async function createRun() {
    await perform(async () => {
      const result = await api<InferenceRun>("/v1/inference-runs", {
        expectedBaselineRevision: data.baselineRevision,
      });
      acceptRun(result);
      const list = await api<{ runs: InferenceRunSummary[] }>(
        "/v1/inference-runs",
      );
      setHistory(list.runs);
    });
  }

  async function loadRun(id: string) {
    await perform(async () => {
      acceptRun(
        await api<InferenceRun>(`/v1/inference-runs/${encodeURIComponent(id)}`),
      );
    });
  }

  const facts = useMemo(
    () => [...(run?.inferredFacts ?? []), ...(run?.assertedFacts ?? [])],
    [run],
  );
  const predicates = useMemo(
    () =>
      [
        ...new Map(
          facts.map((fact) => [fact.predicate.iri, fact.predicate]),
        ).values(),
      ].sort((left, right) => left.label.localeCompare(right.label)),
    [facts],
  );
  const filteredFacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return facts.filter((fact) => {
      if (filter !== "all" && fact.status !== filter) return false;
      if (predicate && fact.predicate.iri !== predicate) return false;
      return (
        !query ||
        [
          displayText(fact.subject.label),
          fact.subject.id,
          fact.subject.iri,
          fact.predicate.label,
          fact.predicate.iri,
          displayText(fact.object.label),
          fact.object.id,
          fact.object.iri,
        ].some((value) => value?.toLowerCase().includes(query))
      );
    });
  }, [facts, filter, predicate, search]);

  const selectedFact = facts.find((fact) => fact.id === selectedFactId);
  const baselineStale =
    run?.staleReasons?.baselineRevision ||
    (run !== null && run.baselineRevision !== data.baselineRevision);
  const ontologyStale =
    run?.staleReasons?.ontology ||
    (run !== null &&
      metadata !== null &&
      run.ontology.sha256 !== metadata.sha256);
  const stale = Boolean(run?.stale || baselineStale || ontologyStale);
  const displayedOntology = run?.ontology ?? metadata;
  const displayedEngine = run?.engine ?? metadata?.engine;
  const limitations = run?.limitations ?? metadata?.limitations ?? [];
  const scopeDescriptions = new Set([
    ...limitations,
    ...(metadata?.limitations ?? []),
  ]);
  const actualWarnings = (run?.warnings ?? []).filter(
    (warning) => typeof warning !== "string" || !scopeDescriptions.has(warning),
  );

  function focusPredicate(iri: string) {
    setFilter("inferred");
    setPredicate(iri);
    setSearch("");
  }

  return (
    <div className="reasoning-view">
      <div className="notice">
        <BookOpen size={19} aria-hidden="true" />
        <div>
          <strong>Infer relationship context from the approved model</strong>
          <p>
            OWL reasoning describes infrastructure, event context, and service
            dependencies. The scenario lab separately calculates physical
            service loss and impact timing. Inference runs never change the
            baseline.
          </p>
        </div>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
          <button
            type="button"
            className="text-button"
            disabled={loading || busy}
            onClick={() => setReloadKey((current) => current + 1)}
          >
            Retry loading ontology and history
          </button>
        </div>
      )}

      <section className="card reasoning-controls" aria-busy={loading || busy}>
        <div className="panel-heading">
          <div>
            <div className="eyebrow">FORMAL ONTOLOGY INFERENCE</div>
            <h2>Run OWL inference</h2>
          </div>
          <button
            type="button"
            className="button primary"
            disabled={busy || loading || !metadata}
            onClick={() => void createRun()}
          >
            {busy ? (
              <Loader2 size={16} className="spin" aria-hidden="true" />
            ) : (
              <Play size={16} aria-hidden="true" />
            )}
            {busy ? "Working…" : "Run OWL inference"}
          </button>
        </div>
        <div className="reasoning-metadata">
          <div>
            <span>Reasoning profile</span>
            <strong>{run?.profile ?? metadata?.profile ?? "Loading…"}</strong>
          </div>
          <div>
            <span>Engine</span>
            <strong>
              {displayedEngine
                ? `${displayedEngine.name} ${displayedEngine.version}`
                : "Loading…"}
            </strong>
          </div>
          <div>
            <span>Ontology version</span>
            <strong>{displayedOntology?.version ?? "Loading…"}</strong>
          </div>
          <div>
            <span>{run ? "Captured baseline" : "Current baseline"}</span>
            <strong>r{run?.baselineRevision ?? data.baselineRevision}</strong>
          </div>
        </div>
        {displayedOntology && (
          <details className="reasoning-ontology-details">
            <summary>Ontology identity and rules</summary>
            <p>
              <strong>Ontology:</strong> <code>{displayedOntology.id}</code>
            </p>
            <p>
              <strong>SHA-256:</strong> <code>{displayedOntology.sha256}</code>
            </p>
            <ul className="reasoning-axiom-list">
              {displayedOntology.axioms.map((axiom) => (
                <li key={axiom.id}>
                  <strong>{axiom.label}</strong>
                  <p>{axiom.description}</p>
                  <code>{axiom.id}</code>
                </li>
              ))}
            </ul>
            {metadata?.limitations?.map((limitation) => (
              <p key={limitation}>{limitation}</p>
            ))}
          </details>
        )}
        {loading && (
          <p className="reasoning-loading" role="status">
            <Loader2 size={15} className="spin" aria-hidden="true" />
            Loading ontology and saved inference runs…
          </p>
        )}
      </section>

      {run && (
        <>
          <div className="reasoning-run-heading">
            <div>
              <span className={`badge ${stale ? "state-at_risk" : "modeled"}`}>
                {stale ? "STALE SNAPSHOT" : "CURRENT SNAPSHOT"}
              </span>
              <p>
                Run <code>{run.id}</code> · {createdLabel(run.createdAt)}
              </p>
            </div>
            <button
              type="button"
              className="button secondary"
              disabled={busy || loading}
              onClick={() => void loadRun(run.id)}
            >
              <RefreshCw size={15} aria-hidden="true" />
              Refresh run status
            </button>
          </div>
          {stale && (
            <div className="alert warning" role="status">
              {baselineStale && (
                <p>
                  Baseline changed: this run captures r{run.baselineRevision};
                  the current baseline is r
                  {run.currentBaselineRevision ?? data.baselineRevision}.
                </p>
              )}
              {ontologyStale && <p>The ontology has changed since this run.</p>}
              <p>
                The saved facts and sources remain unchanged. Run OWL inference
                again to capture the current model.
              </p>
            </div>
          )}

          <div className="reasoning-result-grid">
            <section className="card reasoning-facts">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">USEFUL MODEL FACTS</div>
                  <h2>Inferred and asserted relationships</h2>
                </div>
                <span className="badge modeled">SNAPSHOT</span>
              </div>
              <div className="reasoning-counts">
                <span>
                  <strong>{run.inferredFacts.length}</strong> inferred facts
                </span>
                <span>
                  <strong>{run.assertedFacts.length}</strong> asserted facts
                </span>
              </div>
              <p className="reasoning-projection-note">
                This view selects useful model facts from the OWL closure. It
                omits generic built-in and datatype triples.
              </p>
              <div className="reasoning-filters">
                <label>
                  Fact status
                  <select
                    value={filter}
                    onChange={(event) =>
                      setFilter(event.target.value as typeof filter)
                    }
                  >
                    <option value="inferred">Inferred facts</option>
                    <option value="asserted">Asserted facts</option>
                    <option value="all">All facts</option>
                  </select>
                </label>
                <label>
                  Relationship
                  <select
                    value={predicate}
                    onChange={(event) => setPredicate(event.target.value)}
                  >
                    <option value="">All relationships</option>
                    {predicates.map((relation) => (
                      <option key={relation.iri} value={relation.iri}>
                        {relation.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Search facts
                  <input
                    type="search"
                    placeholder="Entity, event, relation, or ID"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              </div>
              <div
                className="reasoning-examples"
                aria-label="Inference examples"
              >
                <span>Explore:</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => focusPredicate("urn:citride:seenAtFacility")}
                >
                  Event → facility context
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    focusPredicate("urn:citride:associatedWithFacility")
                  }
                >
                  Controller → facility context
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => focusPredicate("urn:citride:dependsOn")}
                >
                  Approved dependencies
                </button>
              </div>
              <p className="reasoning-result-count" role="status">
                {filteredFacts.length} matching facts. Select a fact to inspect
                its source trail.
              </p>
              <div className="table-wrap reasoning-fact-table">
                <table>
                  <thead>
                    <tr>
                      <th>Relationship fact</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFacts.map((fact) => (
                      <tr
                        key={fact.id}
                        className={
                          selectedFactId === fact.id ? "selected-row" : ""
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="reasoning-fact-button"
                            aria-pressed={selectedFactId === fact.id}
                            onClick={() => setSelectedFactId(fact.id)}
                          >
                            <strong>{displayText(fact.subject.label)}</strong>
                            <span>
                              <ArrowRight size={12} aria-hidden="true" />
                              {fact.predicate.label}
                              <ArrowRight size={12} aria-hidden="true" />
                            </span>
                            <strong>{displayText(fact.object.label)}</strong>
                          </button>
                        </td>
                        <td>
                          <span className={`badge reasoning-${fact.status}`}>
                            {fact.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!filteredFacts.length && (
                <div className="empty-state small-empty">
                  <h3>No matching facts</h3>
                  <p>Change the fact status, relationship, or search filter.</p>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setFilter("all");
                      setPredicate("");
                      setSearch("");
                    }}
                  >
                    Show all facts
                  </button>
                </div>
              )}
              <p className="notice compact">
                A depends on relation comes only from an approved dependency
                record. Geographic exposure or probe activity does not create an
                operational dependency or assert a physical service loss.
              </p>
            </section>

            <section className="card reasoning-proof" aria-busy={proofLoading}>
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">CAPTURED SOURCE TRAIL</div>
                  <h2>Why this fact follows</h2>
                </div>
                <FileText size={17} aria-hidden="true" />
              </div>
              {!selectedFact && (
                <div className="empty-state small-empty">
                  <BookOpen size={25} aria-hidden="true" />
                  <h3>Select a relationship fact</h3>
                  <p>
                    Inspect its declared premises, ontology rules, and original
                    sources from the same saved run.
                  </p>
                </div>
              )}
              {selectedFact && (
                <div className="reasoning-proof-content">
                  <p className="reasoning-selected-fact">
                    {factText(selectedFact)}
                  </p>
                  <span className={`badge reasoning-${selectedFact.status}`}>
                    {selectedFact.status}
                  </span>
                  <details>
                    <summary>Fact identifiers</summary>
                    <p>
                      Fact: <code>{selectedFact.id}</code>
                    </p>
                    <p>
                      Subject: <code>{selectedFact.subject.iri}</code>
                    </p>
                    <p>
                      Predicate: <code>{selectedFact.predicate.iri}</code>
                    </p>
                    <p>
                      Object: <code>{selectedFact.object.iri}</code>
                    </p>
                    <p>
                      Sources:{" "}
                      <code>
                        {selectedFact.sourceRefs.join(", ") || "None recorded"}
                      </code>
                    </p>
                    <p>
                      Rules:{" "}
                      <code>
                        {selectedFact.axiomIds.join(", ") || "Asserted fact"}
                      </code>
                    </p>
                  </details>
                  {proofLoading && (
                    <p className="reasoning-loading" role="status">
                      <Loader2 size={15} className="spin" aria-hidden="true" />
                      Loading the captured proof and sources…
                    </p>
                  )}
                  {proofError && (
                    <p className="error-text" role="alert">
                      {proofError}
                    </p>
                  )}
                  {proof && (
                    <>
                      <h4>Premise trail</h4>
                      {proof.proofFacts.length ? (
                        <ol className="reasoning-premises">
                          {proof.proofFacts.map((fact) => (
                            <li key={fact.id}>
                              <p>{factText(fact)}</p>
                              <span
                                className={`badge reasoning-${fact.status}`}
                              >
                                {fact.status}
                              </span>
                              <code>{fact.id}</code>
                              {!!fact.premiseFactIds.length && (
                                <p className="reasoning-premise-refs">
                                  Premises: {fact.premiseFactIds.join(", ")}
                                </p>
                              )}
                              {!!fact.axiomIds.length && (
                                <p className="reasoning-premise-refs">
                                  Rules: {fact.axiomIds.join(", ")}
                                </p>
                              )}
                              {!!fact.sourceRefs.length && (
                                <p className="reasoning-premise-refs">
                                  Sources: {fact.sourceRefs.join(", ")}
                                </p>
                              )}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="muted-text">
                          This fact is declared in the captured baseline.
                        </p>
                      )}
                      {!!proof.fact.premiseFactIds.length && (
                        <p className="reasoning-premise-refs">
                          Selected fact premises:{" "}
                          {proof.fact.premiseFactIds.join(", ")}
                        </p>
                      )}
                      <h4>Ontology rules</h4>
                      {proof.axioms.length ? (
                        <ul className="reasoning-axiom-list">
                          {proof.axioms.map((axiom) => (
                            <li key={axiom.id}>
                              <strong>{axiom.label}</strong>
                              <p>{axiom.description}</p>
                              <code>{axiom.id}</code>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted-text">
                          No inference rule is needed for an asserted fact.
                        </p>
                      )}
                      <h4>Captured sources</h4>
                      {proof.sources.length ? (
                        <ul className="reasoning-source-list">
                          {proof.sources.map((source) => (
                            <li key={source.id}>
                              <strong>
                                {displayText(
                                  source.label ?? source.title ?? source.id,
                                )}
                              </strong>
                              <code>{source.id}</code>
                              {source.description && (
                                <p>{displayText(source.description)}</p>
                              )}
                              <details>
                                <summary>Source record</summary>
                                <pre>{JSON.stringify(source, null, 2)}</pre>
                              </details>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted-text">
                          No source record was attached to this fact.
                        </p>
                      )}
                      <p className="reasoning-witness-note">
                        OWL entailment is computed by owlrl. This replayable
                        witness is assembled separately from supported ontology
                        rules and captured source facts.
                      </p>
                    </>
                  )}
                </div>
              )}
            </section>
          </div>

          {(actualWarnings.length > 0 ||
            limitations.length > 0 ||
            run.diagnostics.length > 0) && (
            <section className="card reasoning-diagnostics">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">REASONER RESULTS</div>
                  <h2>Diagnostics and limits</h2>
                </div>
              </div>
              {!!actualWarnings.length && (
                <div className="alert warning">
                  <strong>Warnings</strong>
                  <ul>
                    {actualWarnings.map((warning, index) => (
                      <li key={index}>{diagnosticLabel(warning)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!limitations.length && (
                <div className="reasoning-scope">
                  <strong>Scope of this version</strong>
                  <ul>
                    {limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                </div>
              )}
              <ul className="reasoning-diagnostic-list">
                {run.diagnostics.map((diagnostic, index) => (
                  <li key={index}>{diagnosticLabel(diagnostic)}</li>
                ))}
              </ul>
              <details>
                <summary>Captured inference statistics</summary>
                <pre>{JSON.stringify(run.statistics, null, 2)}</pre>
              </details>
            </section>
          )}
        </>
      )}

      {!run && !loading && !error && (
        <section className="card empty-state">
          <BookOpen size={28} aria-hidden="true" />
          <h2>No saved inference run yet</h2>
          <p>
            Run OWL inference to derive relationship context from the promoted
            entities, events, and approved dependency records.
          </p>
        </section>
      )}

      <section className="card reasoning-history">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">IMMUTABLE INFERENCE SNAPSHOTS</div>
            <h2>Inference run history</h2>
          </div>
          <span className="badge modeled">{history.length} RUNS</span>
        </div>
        {history.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Baseline</th>
                  <th>Ontology</th>
                  <th>Inferred facts</th>
                  <th>Open snapshot</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr
                    key={item.id}
                    className={run?.id === item.id ? "selected-row" : ""}
                  >
                    <td>
                      {createdLabel(item.createdAt)}
                      <code className="cell-subtitle">{item.id}</code>
                    </td>
                    <td>r{item.baselineRevision}</td>
                    <td>{item.ontologyVersion}</td>
                    <td>{item.inferredCount}</td>
                    <td>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy || loading}
                        aria-label={`Load inference run ${item.id}`}
                        onClick={() => void loadRun(item.id)}
                      >
                        Load run
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="reasoning-empty-history">
            {loading
              ? "Loading saved inference runs…"
              : error
                ? "Saved inference history is temporarily unavailable."
                : "No inference runs have been saved."}
          </p>
        )}
      </section>
    </div>
  );
}
