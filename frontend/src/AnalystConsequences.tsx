import { StatusChip } from "./visualPrimitives.ts";
import { useState } from "react";
import type { Bootstrap, Run, RunRequest } from "./types.ts";
import type { CommandAction, CommandIncident } from "./commandTypes.ts";
import type { ReferenceData } from "./scriptedTypes.ts";
import type { IdtIndex } from "./idt.ts";
import DependencyNetwork from "./components/DependencyNetwork.tsx";
import { boilWaterLabel } from "./statewideFootprint.ts";
import {
  asRecord,
  consequenceModel,
  planningWindow,
  timeLabel,
  words,
} from "./commandCenterModel.ts";
import { displayText } from "./presentation.ts";
import { excludedSentence, quickWhatIfRequest } from "./dependencyNetwork.ts";
import { exposureAvoided, exposureDollars, runExposure } from "./exposure.ts";
import "./analyst-consequences.css";

export interface AnalystConsequencesProps {
  data: Bootstrap;
  incident: CommandIncident;
  reference: ReferenceData | null;
  idtIndex: IdtIndex | null;
  busy?: boolean;
  uncertain?: boolean;
  onAnalyze: (scenarioId: string, horizonHours: number) => void;
  onMutate: (action: CommandAction) => Promise<void>;
  onOpenMap: (id: string) => void;
  onOpenEntity: (id: string) => void;
  onPropose: (id: string, role?: "provider" | "dependent") => void;
  onOpenLab: () => void;
  onWhatIf?: (request: RunRequest) => Promise<Run>;
  /** The workspace gates this result by its originating case ID. */
  lastPlanningRun?: Run | null;
}
// Compare captured data, not today's inventory or just a coincident revision.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

function matchesCapturedBaseline(base: Run, result: Run): boolean {
  return (
    base.baselineSnapshot != null &&
    result.baselineSnapshot != null &&
    base.baselineRevision === result.baselineRevision &&
    base.modelVersion === result.modelVersion &&
    (result.request.expectedBaselineRevision === undefined ||
      result.request.expectedBaselineRevision === base.baselineRevision) &&
    result.scenarioId === result.request.scenarioId &&
    canonical(base.baselineSnapshot) === canonical(result.baselineSnapshot)
  );
}
/** A case-keyed child prevents one case's session-only experiment leaking to another. */
export default function AnalystConsequences(props: AnalystConsequencesProps) {
  return (
    <CaseConsequences
      key={`${props.incident.id}:${props.incident.runId ?? "uncaptured"}`}
      {...props}
    />
  );
}
function CaseConsequences({
  data,
  incident,
  reference,
  idtIndex,
  busy = false,
  uncertain = false,
  onAnalyze,
  onMutate,
  onOpenMap,
  onOpenEntity,
  onPropose,
  onOpenLab,
  onWhatIf,
  lastPlanningRun,
}: AnalystConsequencesProps) {
  const model = consequenceModel(incident),
    run = model.run;
  const linked = incident.contextSnapshot.scenarios;
  const scenarios = data.scenarios.filter(
    (s) =>
      ["unsafe-water", "low-pressure", "power-loss"].includes(s.id) ||
      linked.some((l) => l.id === s.id),
  );
  const [scenarioId, setScenarioId] = useState(
    run?.request.scenarioId ?? linked[0]?.id ?? scenarios[0]?.id ?? "",
  );
  const [horizon, setHorizon] = useState(run?.request.horizonHours ?? 12);
  const options = model.rows.flatMap((row) =>
    model.captured.dependencies
      .filter(
        (d) =>
          d.dependent === row.entityId &&
          d.requiredService === "treated_water" &&
          row.paths.some((path) => path.includes(d.id)),
      )
      .map((d) => ({ dependency: d, row })),
  );
  const [dependencyId, setDependencyId] = useState(
    options[0]?.dependency.id ?? "",
  );
  const [reserve, setReserve] = useState("6");
  const [whatIf, setWhatIf] = useState<{ baseId: string; run: Run } | null>(
    null,
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{
    message: string;
    planningRunId?: string | null;
  } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const blocked = busy || uncertain || running || reviewing;
  const selected = options.find((o) => o.dependency.id === dependencyId);
  const candidate =
    lastPlanningRun ??
    (whatIf && whatIf.baseId === run?.id ? whatIf.run : null);
  const planningResult =
    run && candidate && matchesCapturedBaseline(run, candidate)
      ? candidate
      : null;
  const override =
    planningResult?.request.overrides.length === 1
      ? planningResult.request.overrides[0]
      : null;
  const savedOption = options.find(
    (option) => option.dependency.id === override?.dependencyId,
  );
  const currentWhatIf =
    run &&
    planningResult &&
    override &&
    savedOption &&
    override.note === `What-if from case ${incident.title}` &&
    typeof override.backupMinHours === "number" &&
    Number.isFinite(override.backupMinHours) &&
    override.backupMinHours >= 0 &&
    override.backupMinHours === override.backupMaxHours &&
    (["scenarioId", "evaluationHour", "horizonHours"] as const).every(
      (field) => run.request[field] === planningResult.request[field],
    )
      ? planningResult
      : null;
  const exploration =
    planningResult?.request.overrides.length === 0 ? planningResult : null;
  const graphModel = exploration
    ? consequenceModel({
        ...incident,
        runId: exploration.id,
        runSnapshot: exploration,
      })
    : model;
  const rates = reference?.planningRates ?? [],
    version = reference?.referenceVersion ?? "unavailable";
  const avoided =
    run && currentWhatIf
      ? exposureAvoided(run, currentWhatIf, rates, version)
      : null;
  const exposure = run ? runExposure(run, rates, version) : null;
  async function tryWhatIf() {
    if (!onWhatIf || blocked) return;
    setRunning(true);
    setError(null);
    try {
      const result = await onWhatIf(
        quickWhatIfRequest(incident, dependencyId, Number(reserve)),
      );
      setWhatIf({ baseId: run!.id, run: result });
    } catch (e) {
      setError({
        message: e instanceof Error ? e.message : String(e),
        planningRunId: lastPlanningRun?.id ?? null,
      });
    } finally {
      setRunning(false);
    }
  }
  async function review(decisionId: string, note: string) {
    if (blocked || !note.trim()) return;
    setReviewing(true);
    setError(null);
    try {
      await onMutate({
        action: "review_decision",
        decisionId,
        note: note.trim(),
      });
      setNotes((previous) => ({ ...previous, [decisionId]: "" }));
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      setReviewing(false);
    }
  }
  return (
    <div className="analyst-consequences command-center-views">
      <section className="command-panel a4-run">
        <h2>Run analysis</h2>
        <div className="a4-controls">
          <fieldset className="a4-scenarios" disabled={blocked}>
            <legend>Scenario</legend>
            {scenarios.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                aria-pressed={scenarioId === scenario.id}
                onClick={() => setScenarioId(scenario.id)}
              >
                {displayText(scenario.label)}
              </button>
            ))}
          </fieldset>
          <label className="a4-native-scenario">
            Scenario
            <select
              aria-label="Analysis scenario"
              value={scenarioId}
              disabled={blocked}
              onChange={(e) => setScenarioId(e.target.value)}
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {displayText(s.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Planning horizon
            <select
              aria-label="Analysis horizon"
              value={horizon}
              disabled={blocked}
              onChange={(e) => setHorizon(Number(e.target.value))}
            >
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
            </select>
          </label>
          <button
            className="button primary"
            disabled={blocked || !scenarioId}
            onClick={() => onAnalyze(scenarioId, horizon)}
          >
            Run analysis
          </button>
        </div>
        <p>
          {run
            ? `Captured run ${run.id} · ${displayText(run.request.scenarioId)} · ${run.request.horizonHours} hours. This run feeds C4.`
            : "No captured consequence run."}
        </p>
        <p className="command-muted">
          Changing the scenario never changes the captured run. Alternate
          analyses and what-ifs are separate saved runs, not case replacements.
        </p>
        {uncertain && (
          <p role="status">
            Resolve the uncertain workflow before recording changes or running
            analysis.
          </p>
        )}
      </section>
      <section className="a4-explore" aria-label="Explore dependency graph">
        <h2>Explore dependencies</h2>
        {exploration && (
          <p role="status">
            Exploratory graph · separate run {exploration.id} ·{" "}
            {displayText(exploration.request.scenarioId)} ·{" "}
            {exploration.request.horizonHours} hours. Captured impacts and
            reviews below remain unchanged; captured run {run?.id} still feeds
            C4.
          </p>
        )}
        <DependencyNetwork
          key={graphModel.run?.id ?? "none"}
          model={graphModel}
          mode="explore"
          idtIndex={idtIndex}
          boilWaterLabel={boilWaterLabel(
            graphModel.run,
            graphModel.captured.entities,
            reference ?? null,
          )}
          onOpenMap={onOpenMap}
          onOpenEntity={onOpenEntity}
          onPropose={onPropose}
          onWhatIf={
            exploration
              ? undefined
              : (id) => {
                  const option = options.find((o) => o.row.entityId === id);
                  if (option) {
                    setDependencyId(option.dependency.id);
                    setReserve(
                      String(option.dependency.usableBackupMinHours ?? 0),
                    );
                    if (typeof document !== "undefined")
                      document.getElementById("a4-what-if")?.scrollIntoView?.({
                        block: "start",
                        behavior: "smooth",
                      });
                  }
                }
          }
        />
      </section>
      <section className="command-panel a4-review">
        <header className="a4-review-heading"><h2>Review each impact</h2>
          <span className="a4-reviewed-summary">{incident.decisions.filter((decision) => decision.reviewed).length} of {incident.decisions.length} reviewed · Advisory, not approvals</span>
        </header>
        <small>Modeled impacts · not observed outages</small>
        {model.rows.map((row) => {
          const decision = incident.decisions.find(
            (d) =>
              d.entityId === row.entityId && d.functionId === row.functionId,
          );
          return (
            <article key={row.id} className="a4-impact">
              <h3>{displayText(row.label)}</h3>
              <p>
                {displayText(row.label)} may experience{" "}
                <StatusChip status={row.state}>{words(row.state)}</StatusChip>{" "}
                {displayText(row.functionLabel)} within{" "}
                {planningWindow(row.windowHours)} under the captured scenario
                assumptions.
              </p>
              {decision && (
                <>
                  {decision.reviewed && <div className="a4-reviewed-summary"><StatusChip status="reviewed">Reviewed {timeLabel(decision.reviewedAt)}</StatusChip>{decision.reviewNote && <p>{displayText(decision.reviewNote)}</p>}</div>}
                  <details className="a4-review-editor" open={!decision.reviewed}>
                  <summary>{decision.reviewed ? "Edit review note" : "Review this impact"}</summary>
                  <label>
                    Required review note
                    <textarea
                      aria-label={`Review note for ${row.entityId}`}
                      value={notes[decision.id] ?? ""}
                      disabled={blocked}
                      onChange={(e) =>
                        setNotes((previous) => ({
                          ...previous,
                          [decision.id]: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    disabled={blocked || !(notes[decision.id] ?? "").trim()}
                    onClick={() =>
                      review(decision.id, notes[decision.id] ?? "")
                    }
                  >
                    Record review
                  </button>
                  {decision.reviewed && <small>Impact review recorded.</small>}
                  </details>
                </>
              )}
            </article>
          );
        })}
        {!model.rows.length && <p>No captured modeled impacts.</p>}
        <h3>Not affected</h3>
        {run?.excluded.length ? (
          <ul>
            {run.excluded.map((item, i) => (
              <li key={i}>{displayText(excludedSentence(item, model))}</li>
            ))}
          </ul>
        ) : (
          <p>No explicit excluded paths captured.</p>
        )}
        <details className="a4-model-review"><summary>Assumptions and model review</summary>
        <h3>Needs model review</h3>
        <ul>
          {model.rows
            .filter((r) => !r.windowHours)
            .map((r) => (
              <li key={r.id}>{displayText(r.label)}: timing unknown.</li>
            ))}
          {run?.warnings.map((warning, i) => (
            <li key={`w${i}`}>
              {displayText(
                typeof warning === "string" ? warning : JSON.stringify(warning),
              )}
            </li>
          ))}
          {run?.excluded
            .filter((e) =>
              String(asRecord(e).reason).startsWith("requires_model_review"),
            )
            .map((e, i) => (
              <li key={`e${i}`}>{displayText(excludedSentence(e, model))}</li>
            ))}
        </ul>
        {!run?.warnings.length &&
          !model.rows.some((r) => !r.windowHours) &&
          !run?.excluded.some((e) =>
            String(asRecord(e).reason).startsWith("requires_model_review"),
          ) && <p>No captured model-review flags.</p>}
        </details>
      </section>
      <section className="command-panel a4-what-if" id="a4-what-if">
        <h2>Try a what-if</h2>
        <p>
          Change a facility's clean-water reserve and compare it with the
          captured run.
        </p>
        <div className="a4-controls">
          <label>
            Impacted facility
            <select
              aria-label="What-if impacted facility"
              value={dependencyId}
              disabled={blocked || !options.length}
              onChange={(e) => setDependencyId(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.dependency.id} value={o.dependency.id}>
                  {displayText(o.row.label)} ·{" "}
                  {words(o.dependency.requiredService)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Clean-water reserve hours
            <input
              aria-label="Clean-water reserve hours"
              type="number"
              min="0"
              step="0.5"
              value={reserve}
              disabled={blocked}
              onChange={(e) => setReserve(e.target.value)}
            />
          </label>
          <button
            disabled={
              blocked ||
              !onWhatIf ||
              !selected ||
              !reserve.trim() ||
              !Number.isFinite(Number(reserve)) ||
              Number(reserve) < 0
            }
            onClick={tryWhatIf}
          >
            {running ? "Running what-if…" : "Run separate what-if"}
          </button>
        </div>
        <p>What-if from case {incident.title}</p>
        {!onWhatIf && (
          <p>
            Quick what-if is not connected. Open the full scenario lab; no API
            request will be made here.
          </p>
        )}
        {exposure && (
          <p>
            Captured exposure:{" "}
            {exposure.serviceHours.map((n) => n.toFixed(1)).join("–")}{" "}
            service-hours; {exposureDollars(exposure.costUsd)} · rate version{" "}
            {version}. Planning estimate from scenario assumptions.
            {exposure.notEstimated.length
              ? ` ${exposure.notEstimated.length} impacts not fully estimated.`
              : ""}
          </p>
        )}
        {currentWhatIf && (
          <>
            <h3>Before / after · separate run {currentWhatIf.id}</h3>
            <p>
              Saved what-if: {displayText(savedOption!.row.label)} · clean-water
              reserve {override!.backupMinHours} hours. Controls above are the
              next draft, not the saved result.
            </p>
            <div className="command-table-wrap">
              <table className="command-table">
                <thead>
                  <tr>
                    <th>Facility / function</th>
                    <th>Captured window</th>
                    <th>What-if window</th>
                  </tr>
                </thead>
                <tbody>
                  {model.rows.map((row) => {
                    const after = currentWhatIf.impacts.find(
                      (i) =>
                        i.entityId === row.entityId &&
                        i.functionId === row.functionId,
                    );
                    return (
                      <tr key={row.id}>
                        <td>
                          {displayText(row.label)} ·{" "}
                          {displayText(row.functionLabel)}
                        </td>
                        <td>{planningWindow(row.windowHours)}</td>
                        <td>
                          {after
                            ? planningWindow(after.windowHours)
                            : "No impact in what-if results"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {avoided &&
              ("incomparable" in avoided ? (
                <p>{avoided.incomparable}</p>
              ) : (
                <p className="a4-avoided">
                  Exposure avoided:{" "}
                  {avoided.serviceHours.map((n) => n.toFixed(1)).join("–")}{" "}
                  service-hours; {exposureDollars(avoided.costUsd)} · rate
                  version {version}. Planning estimate from scenario
                  assumptions.
                </p>
              ))}
            <p>Case unchanged: captured run {run?.id} still feeds C4.</p>
          </>
        )}
      </section>
      {error &&
        !(
          error.planningRunId !== undefined &&
          planningResult &&
          planningResult.id !== error.planningRunId
        ) && <p role="alert">{error.message}</p>}
      <button className="button" onClick={onOpenLab}>
        Open full scenario lab
      </button>
    </div>
  );
}
