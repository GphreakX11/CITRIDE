import type { AnalystIncidentContextValue } from "./analystIncidentContext.ts";
import { useAnalystIncident } from "./analystIncidentContext.ts";
import {
  analystIncidentScreenModel,
  handlesAnalystIncidentView,
  incidentEventTechniques,
  incidentProjection,
} from "./AnalystIncidentScreensModel.ts";
import { formatTime } from "./displayTime.ts";
import { hours } from "./consequencesModel.ts";
import "./AnalystIncidentScreens.css";

export { handlesAnalystIncidentView } from "./AnalystIncidentScreensModel.ts";

export interface AnalystIncidentScreenProps {
  context: AnalystIncidentContextValue;
  /** Navigation only: host navigates to A1 (`command`), retaining incident focus. */
  onOpenAlerts: () => void;
  /** Host selects the asset and navigates to Entity Profile. */
  onOpenEntity: (entityId: string) => void;
}
export interface AnalystIncidentScreensProps extends Omit<
  AnalystIncidentScreenProps,
  "context"
> {
  view: string;
  /** Omit inside AnalystIncidentProvider. Explicit context also supports embedding. */
  context?: AnalystIncidentContextValue | null;
}

function OpenAlerts({
  context,
  onOpenAlerts,
  review = false,
}: Pick<AnalystIncidentScreenProps, "context" | "onOpenAlerts"> & {
  review?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={context.locked || !context.selectedIncident}
      onClick={() => {
        if (!context.locked && context.selectedIncident) onOpenAlerts();
      }}
    >
      {review
        ? "Open a case to review and capture"
        : "Open case from this incident’s alerts"}
    </button>
  );
}

export function AnalystIncidentInvestigationMap(
  props: AnalystIncidentScreenProps,
) {
  const { context, onOpenEntity } = props;
  const model = analystIncidentScreenModel(
    context.mainStore,
    context.selectedIncident,
    context.projection,
  );
  const name = (id: string) =>
    context.mainStore.entities.find((entity) => entity.id === id)?.label ?? id;
  return (
    <section
      className="analyst-incident-screen"
      aria-label="Incident investigation map"
    >
      <h2>Investigation Map</h2>
      <p>
        Current main-store assets and directed service dependencies. Modeled
        context is not observed compromise.
      </p>
      <div className="analyst-incident-assets">
        {model.entities.map((entity) => (
          <article key={entity.id}>
            <button
              type="button"
              disabled={context.locked}
              onClick={() => {
                if (!context.locked) onOpenEntity(entity.id);
              }}
            >
              {entity.label}
            </button>
            <p>
              {entity.type} ·{" "}
              {model.observedEntityIds.has(entity.id)
                ? "Linked event asset or recorded host"
                : "Dependency / modeled context"}
            </p>
          </article>
        ))}
      </div>
      {!model.entities.length && (
        <p>No incident-linked assets available in the current main store.</p>
      )}
      <h3>Directed dependencies</h3>
      <ul>
        {model.dependencies.map((dependency) => (
          <li key={dependency.id}>
            <strong>
              {name(dependency.provider)} → {name(dependency.dependent)}
            </strong>
            <p>
              {dependency.requiredService} · {dependency.dependencyType} ·
              propagation{" "}
              {hours([
                dependency.propagationDelayMinHours,
                dependency.propagationDelayMaxHours,
              ])}
            </p>
            <p>{dependency.assumptionNote || "No assumption note recorded."}</p>
            <details>
              <summary>Recorded dependency and provenance</summary>
              <pre>{JSON.stringify(dependency, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ul>
      {!model.dependencies.length && (
        <p>
          No directed dependencies recorded for the available incident assets.
          Coverage is unknown, not proof of independence.
        </p>
      )}
      {!!model.missingEventIds.length && (
        <p role="status">
          {model.missingEventIds.length} linked event records are unavailable in
          the main store.
        </p>
      )}
    </section>
  );
}

export function AnalystIncidentCyberEvidence({
  context,
}: AnalystIncidentScreenProps) {
  const model = analystIncidentScreenModel(
    context.mainStore,
    context.selectedIncident,
  );
  const events = [...model.events].sort(
    (a, b) =>
      (context.eventTimestamp(b) ?? "").localeCompare(
        context.eventTimestamp(a) ?? "",
      ) || a.id.localeCompare(b.id),
  );
  return (
    <section
      className="analyst-incident-screen"
      aria-label="Incident cyber evidence"
    >
      <h2>Cyber Evidence</h2>
      <p>
        Only events explicitly linked to this incident. Recorded techniques are
        evidence annotations, not confirmed attribution.
      </p>
      {events.map((event) => (
        <article key={event.id}>
          <h3>{event.label ?? event.title ?? event.id}</h3>
          <p>
            <time dateTime={context.eventTimestamp(event)}>
              {formatTime(
                context.eventTimestamp(event),
                undefined,
                "Time not recorded",
              )}
            </time>{" "}
            ·{" "}
            {typeof event.origin === "string"
              ? event.origin
              : "Origin not recorded"}
          </p>
          <p>{event.description ?? "No event description recorded."}</p>
          <h4>Recorded techniques</h4>
          <ul>
            {incidentEventTechniques(event).map((technique, index) => (
              <li key={`${technique.id}-${index}`}>
                {technique.id}
                {technique.name && ` · ${technique.name}`}
                {technique.tactic && ` · ${technique.tactic}`}
              </li>
            ))}
          </ul>
          {!incidentEventTechniques(event).length && (
            <p>No techniques recorded for this event.</p>
          )}
          <details>
            <summary>Actual event and evidence references</summary>
            <pre>{JSON.stringify(event, null, 2)}</pre>
          </details>
        </article>
      ))}
      {!events.length && (
        <p>No linked event records available for this incident.</p>
      )}
      {!!model.missingEventIds.length && (
        <p role="status">
          Unavailable linked events: {model.missingEventIds.join(", ")}
        </p>
      )}
    </section>
  );
}

export function AnalystIncidentConsequenceAnalysis(
  props: AnalystIncidentScreenProps,
) {
  const { context } = props;
  const projection = incidentProjection(
    context.selectedIncident,
    context.projection,
  );
  return (
    <section
      className="analyst-incident-screen"
      aria-label="Incident preliminary consequence analysis"
    >
      <h2>Consequence Analysis</h2>
      <h3>Preliminary estimate</h3>
      <p>
        Automatic modeled analysis · not observed outages or a captured case
        run.
      </p>
      <OpenAlerts {...props} review />
      {context.projectionLoading && (
        <p role="status">Loading automatic preliminary analysis…</p>
      )}
      {context.projectionError && (
        <p role="alert">
          Automatic analysis unavailable: {context.projectionError}
        </p>
      )}
      {!projection &&
        !context.projectionLoading &&
        !context.projectionError && (
          <p>No automatic analysis available for this incident.</p>
        )}
      {projection && (
        <>
          <p>
            {projection.source?.name ??
              projection.source?.label ??
              "Source not recorded"}{" "}
            · Modeled{" "}
            {formatTime(
              projection.analysis?.computedAt ?? projection.analysis?.createdAt,
              projection.operationsTimeZone,
              "time not recorded",
            )}{" "}
            · Model {projection.analysis?.modelVersion ?? "not recorded"}
          </p>
          {projection.confidence && (
            <p>
              Confidence: {projection.confidence.level} ·{" "}
              {projection.confidence.note}
            </p>
          )}
          <h3>Assets and modeled windows</h3>
          <div className="analyst-incident-table">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Sector</th>
                  <th>Recorded / modeled status</th>
                  <th>Window</th>
                </tr>
              </thead>
              <tbody>
                {projection.nodes.map((node) => (
                  <tr key={node.id}>
                    <td>{node.name ?? node.label ?? node.id}</td>
                    <td>{node.sector}</td>
                    <td>{node.status ?? "Not recorded"}</td>
                    <td>{hours(node.windowHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!projection.nodes.length && <p>No modeled assets returned.</p>}
          <h3>By sector</h3>
          <ul>
            {projection.sectors.map((sector) => (
              <li key={sector.label}>
                {sector.label} · {hours(sector.windowHours)} · {sector.atRisk}{" "}
                at risk
              </li>
            ))}
          </ul>
          <details>
            <summary>Automatic analysis, paths and assumptions</summary>
            <pre>{JSON.stringify(projection, null, 2)}</pre>
          </details>
        </>
      )}
    </section>
  );
}

export function AnalystIncidentNoCase(
  props: AnalystIncidentScreenProps & { title: string },
) {
  return (
    <section className="analyst-incident-screen" aria-label={props.title}>
      <h2>{props.title}</h2>
      <h3>No case yet for this incident</h3>
      <p>
        Case reviews, response tracking and captured evidence become available
        after you explicitly open a case from an alert.
      </p>
      <OpenAlerts {...props} />
    </section>
  );
}

/** No writes, fake cases, fallback incidents, or mutation forms. Existing saved-case
 * screens stay the host's responsibility, including explicitly chosen closed cases.
 */
export default function AnalystIncidentScreens({
  view,
  context: supplied,
  ...callbacks
}: AnalystIncidentScreensProps) {
  const provided = useAnalystIncident();
  const context = supplied === undefined ? provided : supplied;
  if (!context || !handlesAnalystIncidentView(view, context.activeCase))
    return null;
  if (!context.selectedIncident)
    return (
      <section className="analyst-incident-screen" role="status">
        No open incident is available for this customer.
      </section>
    );
  const props = { ...callbacks, context };
  switch (view) {
    case "cop":
      return <AnalystIncidentInvestigationMap {...props} />;
    case "cyber":
      return <AnalystIncidentCyberEvidence {...props} />;
    case "consequence":
      return <AnalystIncidentConsequenceAnalysis {...props} />;
    case "coordination":
      return <AnalystIncidentNoCase {...props} title="Coordination" />;
    case "uctf":
      return <AnalystIncidentNoCase {...props} title="Response Tracking" />;
    case "case-file":
      return <AnalystIncidentNoCase {...props} title="Case File" />;
  }
}
