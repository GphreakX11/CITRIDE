import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, GitPullRequest, Save, X } from "lucide-react";
import { api, humanize } from "./api";
import { displayText } from "./presentation";
import type { Bootstrap, Dependency, Proposal, Validation } from "./types";

interface Props {
  data: Bootstrap;
  initial: Dependency | null;
  onClose: () => void;
  onPromoted: () => Promise<void>;
}

const physicalTypes = new Set([
  "WaterServiceProvider",
  "TreatmentPlant",
  "DialysisCenter",
  "Hospital",
  "HealthcareFacility",
  "NursingHome",
  "FireService",
  "ElectricSupplyFacility",
]);
const ownerOf = (item: Bootstrap["serviceFunctions"][number]) =>
  item.facility ?? item.entityId ?? item.entity ?? item.belongsTo;

function newDependency(data: Bootstrap): Dependency {
  const template = data.dependencies[0];
  return {
    id: `dep-${crypto.randomUUID()}`,
    revision: 1,
    provider: template.provider,
    dependent: template.dependent,
    requiredService: template.requiredService,
    dependentFunction: template.dependentFunction,
    dependencyType: "physical",
    coupling: "tight",
    lossTypes: [...template.lossTypes],
    propagationDelayMinHours: 0,
    propagationDelayMaxHours: 0,
    usableBackupMinHours: null,
    usableBackupMaxHours: null,
    validForLossTypes: [],
    lossOfFunction: 1,
    outputLossType: null,
    sourceRefs: [],
    assumptionNote: "",
    classification: "U",
    handling: ["SIMULATED"],
  };
}

export default function RelationshipEditor({
  data,
  initial,
  onClose,
  onPromoted,
}: Props) {
  const [draft, setDraft] = useState<Dependency>(() =>
    initial
      ? { ...initial, assumptionNote: displayText(initial.assumptionNote) }
      : newDependency(data),
  );
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [promoted, setPromoted] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    function onKeydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const targets = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ].filter((target) => target.getClientRects().length > 0);
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first) {
        event.preventDefault();
        dialog.current.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      } else if (!dialog.current.contains(document.activeElement)) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("keydown", onKeydown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);
  const physical = data.entities.filter((entity) =>
    physicalTypes.has(entity.type),
  );
  const functions = data.serviceFunctions.filter(
    (item) => ownerOf(item) === draft.dependent,
  );
  const services = data.serviceFunctions
    .filter((item) => ownerOf(item) === draft.provider && item.service)
    .map((item) => item.service!);
  const dependentService = functions.find(
    (item) => item.id === draft.dependentFunction,
  )?.service;
  const outputLossOptions: Record<string, string[]> = {
    water_treatment: ["water_treatment_unavailable"],
    treated_water: ["unsafe_water", "no_water", "low_pressure"],
    electricity: ["electricity_lost"],
  };
  const outputLossTypes = outputLossOptions[dependentService ?? ""] ?? [];
  const lossTypes = useMemo(
    () => [
      ...new Set(
        data.dependencies
          .flatMap((item) => [...item.lossTypes, ...item.validForLossTypes])
          .concat(data.scenarios.map((item) => item.seed.lossType)),
      ),
    ],
    [data],
  );
  function update(change: Partial<Dependency>) {
    setDraft((current) => ({ ...current, ...change }));
    setProposal(null);
    setValidation(null);
    setError("");
  }
  async function action(name: string, operation: () => Promise<void>) {
    setBusy(name);
    setError("");
    try {
      await operation();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy("");
    }
  }
  const numberField = (
    key:
      | "propagationDelayMinHours"
      | "propagationDelayMaxHours"
      | "usableBackupMinHours"
      | "usableBackupMaxHours",
    label: string,
    optional = false,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min="0"
        step="0.25"
        required={!optional}
        value={draft[key] ?? ""}
        placeholder={optional ? "Unknown" : undefined}
        disabled={promoted}
        onChange={(event) =>
          update({
            [key]:
              event.target.value === "" && optional
                ? null
                : Number(event.target.value),
          })
        }
      />
    </label>
  );

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="editor-modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-heading"
        tabIndex={-1}
      >
        <header className="modal-heading">
          <div>
            <span className="eyebrow">
              Baseline revision {data.baselineRevision}
            </span>
            <h2 id="editor-heading">
              {initial
                ? "Edit operational dependency"
                : "Create operational dependency"}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close relationship editor"
            onClick={onClose}
            disabled={Boolean(busy)}
          >
            <X size={20} />
          </button>
        </header>
        <div className="stage-track">
          <span className={proposal ? "complete" : "active"}>
            <i>1</i>Stage
          </span>
          <span
            className={
              validation?.valid ? "complete" : proposal ? "active" : ""
            }
          >
            <i>2</i>Validate
          </span>
          <span
            className={
              promoted ? "complete" : validation?.valid ? "active" : ""
            }
          >
            <i>3</i>Promote
          </span>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action("Staging", async () => {
              setProposal(
                await api<Proposal>("/v1/dependency-proposals", {
                  dependency: draft,
                  expectedBaselineRevision: data.baselineRevision,
                }),
              );
              setValidation(null);
            });
          }}
        >
          <div className="editor-body">
            <p className="notice compact">
              This creates a modeled operational dependency. Geographic
              proximity and infrastructure ownership do not establish a
              dependency.
            </p>
            <fieldset disabled={promoted || Boolean(busy)}>
              <legend>Connection & function</legend>
              <div className="form-grid">
                <label>
                  Provider
                  <select
                    data-initial-focus
                    value={draft.provider}
                    onChange={(event) => {
                      const provider = event.target.value;
                      const service =
                        data.serviceFunctions.find(
                          (item) => ownerOf(item) === provider,
                        )?.service ?? "";
                      update({ provider, requiredService: service });
                    }}
                  >
                    {physical.map((item) => (
                      <option key={item.id} value={item.id}>
                        {displayText(item.label)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Dependent facility
                  <select
                    value={draft.dependent}
                    onChange={(event) => {
                      const dependent = event.target.value;
                      const dependentFunction =
                        data.serviceFunctions.find(
                          (item) => ownerOf(item) === dependent,
                        )?.id ?? "";
                      update({
                        dependent,
                        dependentFunction,
                        outputLossType: null,
                      });
                    }}
                  >
                    {physical.map((item) => (
                      <option key={item.id} value={item.id}>
                        {displayText(item.label)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Required service
                  <select
                    required
                    value={draft.requiredService}
                    onChange={(event) =>
                      update({ requiredService: event.target.value })
                    }
                  >
                    {!services.includes(draft.requiredService) && (
                      <option value={draft.requiredService}>
                        {draft.requiredService
                          ? humanize(draft.requiredService)
                          : "Choose service"}
                      </option>
                    )}
                    {[...new Set(services)].map((service) => (
                      <option key={service} value={service}>
                        {humanize(service)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Dependent function
                  <select
                    required
                    value={draft.dependentFunction}
                    onChange={(event) =>
                      update({
                        dependentFunction: event.target.value,
                        outputLossType: null,
                      })
                    }
                  >
                    {functions.length === 0 && (
                      <option value="">No configured function</option>
                    )}
                    {functions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {displayText(item.label)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Coupling
                  <select
                    value={draft.coupling}
                    onChange={(event) =>
                      update({ coupling: event.target.value })
                    }
                  >
                    {["tight", "loose"].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Function loss fraction
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    required
                    value={draft.lossOfFunction}
                    onChange={(event) =>
                      update({ lossOfFunction: Number(event.target.value) })
                    }
                  />
                  <span className="field-help">
                    0 = no loss · 1 = complete loss
                  </span>
                </label>
              </div>
            </fieldset>
            <fieldset disabled={promoted || Boolean(busy)}>
              <legend>Loss applicability</legend>
              <div className="checkbox-grid">
                {lossTypes.map((loss) => (
                  <label key={loss}>
                    <input
                      type="checkbox"
                      checked={draft.lossTypes.includes(loss)}
                      onChange={(event) =>
                        update({
                          lossTypes: event.target.checked
                            ? [...draft.lossTypes, loss]
                            : draft.lossTypes.filter((item) => item !== loss),
                        })
                      }
                    />
                    {humanize(loss)}
                  </label>
                ))}
              </div>
              <label className="block-field">
                Propagated loss type
                <select
                  value={draft.outputLossType ?? ""}
                  onChange={(event) =>
                    update({ outputLossType: event.target.value || null })
                  }
                >
                  <option value="">
                    Do not propagate beyond this function
                  </option>
                  {outputLossTypes.map((loss) => (
                    <option key={loss} value={loss}>
                      {humanize(loss)}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <fieldset disabled={promoted || Boolean(busy)}>
              <legend>Timing & usable backup</legend>
              <div className="form-grid">
                {numberField(
                  "propagationDelayMinHours",
                  "Minimum delay (hours)",
                )}
                {numberField(
                  "propagationDelayMaxHours",
                  "Maximum delay (hours)",
                )}
                {numberField(
                  "usableBackupMinHours",
                  "Minimum backup (hours)",
                  true,
                )}
                {numberField(
                  "usableBackupMaxHours",
                  "Maximum backup (hours)",
                  true,
                )}
              </div>
              <p className="field-help">
                Leave both backup fields empty for unknown reserve. Enter 0 for
                a known absence of usable backup. Backup applies only to the
                checked loss types below.
              </p>
              <div className="checkbox-grid">
                {lossTypes.map((loss) => (
                  <label key={loss}>
                    <input
                      type="checkbox"
                      checked={draft.validForLossTypes.includes(loss)}
                      onChange={(event) =>
                        update({
                          validForLossTypes: event.target.checked
                            ? [...draft.validForLossTypes, loss]
                            : draft.validForLossTypes.filter(
                                (item) => item !== loss,
                              ),
                        })
                      }
                    />
                    {humanize(loss)}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset disabled={promoted || Boolean(busy)}>
              <legend>Provenance & assumptions</legend>
              <div className="source-checkboxes">
                {data.sources.map((source) => (
                  <label key={source.id}>
                    <input
                      type="checkbox"
                      checked={draft.sourceRefs.includes(source.id)}
                      onChange={(event) =>
                        update({
                          sourceRefs: event.target.checked
                            ? [...draft.sourceRefs, source.id]
                            : draft.sourceRefs.filter(
                                (item) => item !== source.id,
                              ),
                        })
                      }
                    />
                    {displayText(source.label ?? source.title ?? source.id)}
                    <code>{source.id}</code>
                  </label>
                ))}
              </div>
              <label className="block-field">
                Assumption note
                <textarea
                  required
                  rows={3}
                  placeholder="Document the dependency, timing, and reserve assumptions."
                  value={draft.assumptionNote}
                  onChange={(event) =>
                    update({ assumptionNote: event.target.value })
                  }
                />
              </label>
            </fieldset>
            {error && (
              <div role="alert" className="alert error">
                {error}
                <p>
                  For a baseline conflict, close this editor and reload the
                  model before staging again.
                </p>
              </div>
            )}
            {proposal && (
              <div className="notice compact">
                <GitPullRequest size={16} />
                Proposal {proposal.id} staged. Baseline stays unchanged until
                promotion.
              </div>
            )}
            {validation && (
              <div
                className={`alert ${validation.valid ? "success" : "warning"}`}
                role="status"
              >
                {validation.valid
                  ? "Validation passed. Ready to promote."
                  : "Review required before promotion."}
                {validation.errors.length > 0 && (
                  <ul>
                    {validation.errors.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {promoted && (
              <div className="alert success" role="status">
                <CheckCircle2 size={18} />
                Dependency promoted. The baseline has been refreshed; earlier
                runs retain their original snapshot.
              </div>
            )}
          </div>
          <footer className="modal-footer">
            <span className="badge simulation">MODEL EDITOR · U</span>
            <div className="button-row">
              {promoted ? (
                <button
                  type="button"
                  className="button primary"
                  onClick={onClose}
                >
                  Done
                </button>
              ) : (
                <>
                  <button
                    type="submit"
                    className="button secondary"
                    disabled={Boolean(busy)}
                  >
                    <Save size={16} />
                    {busy === "Staging"
                      ? "Staging…"
                      : proposal
                        ? "Stage again"
                        : "Stage proposal"}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!proposal || Boolean(busy)}
                    onClick={() =>
                      void action("Validating", async () =>
                        setValidation(
                          await api<Validation>(
                            `/v1/dependency-proposals/${proposal!.id}/validate`,
                            {},
                          ),
                        ),
                      )
                    }
                  >
                    <Check size={16} />
                    {busy === "Validating" ? "Validating…" : "Validate"}
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={!validation?.valid || Boolean(busy)}
                    onClick={() =>
                      void action("Promoting", async () => {
                        await api(
                          `/v1/dependency-proposals/${proposal!.id}/promote`,
                          {},
                        );
                        await onPromoted();
                        setPromoted(true);
                      })
                    }
                  >
                    {busy === "Promoting" ? "Promoting…" : "Promote"}
                  </button>
                </>
              )}
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
