import { useState, type ReactNode } from "react";
import type { Source } from "../types.ts";
import {
  planningWindow,
  sourceLabels,
  timeLabel,
  words,
  type ConsequenceModel,
} from "../commandCenterModel.ts";
import { displayText } from "../presentation.ts";
import { IdtChip } from "../IdtChip.tsx";
import type { IdtIndex } from "../idt.ts";
import { expandUpstream, explorationNetwork } from "../dependencyNetwork.ts";
import "../command-center-views.css";
import "../analyst-consequences.css";

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="command-panel cc-panel">
      <div className="command-panel-heading">
        <h2>{title}</h2>
        {note && <span>{note}</span>}
      </div>
      {children}
    </section>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="cc-empty">{children}</p>;
}
function Sources({ refs, sources }: { refs: string[]; sources: Source[] }) {
  return (
    <div className="cc-sources" aria-label="Source provenance">
      {sourceLabels(refs, sources).map((source) => (
        <details key={source.id}>
          <summary>{displayText(source.label)}</summary>
          <p>{source.description}</p>
          <small>Origin: {source.origin}</small>
        </details>
      ))}
      {!refs.length && (
        <span className="command-muted">No source references captured</span>
      )}
    </div>
  );
}
function ImpactList({ model }: { model: ConsequenceModel }) {
  return model.run ? (
    <ul className="command-record-list">
      {model.rows.map((row) => (
        <li key={row.id}>
          <strong>{displayText(row.label)}</strong>
          <span> · {displayText(row.functionLabel)}</span>
          <small>
            Modeled {words(row.state)} · {planningWindow(row.windowHours)}
          </small>
        </li>
      ))}
      {!model.rows.length && <li>No modeled impacts.</li>}
    </ul>
  ) : (
    <Empty>No analysis recorded.</Empty>
  );
}

/** Sector membership only: no source-to-facility dependency or outage is inferred. */
export function SavedInventoryNetwork({ model }: { model: ConsequenceModel }) {
  const sectors = model.inventorySectors;
  const height =
    100 + Math.max(1, ...sectors.map((sector) => sector.nodes.length)) * 62;
  return (
    <Panel title="Saved inventory sector context" note="Captured baseline">
      {sectors.length ? (
        <>
          <div className="cc-network-graphic">
            <svg
              viewBox={`0 0 ${sectors.length * 240} ${height}`}
              role="img"
              aria-label="Saved inventory sectors and physical facilities; classification context, not impact propagation"
            >
              {sectors.map((sector, i) => {
                const x = i * 240 + 120;
                return (
                  <g key={sector.key} data-captured-sector={sector.sector}>
                    <text x={x} y="28" textAnchor="middle">
                      {sector.label}
                    </text>
                    {sector.nodes.map((node, j) => {
                      const y = 75 + j * 62;
                      const status = node.modeled
                        ? "Captured modeled result; not observed"
                        : "Captured context; no modeled impact";
                      return (
                        <g
                          key={node.id}
                          data-captured-facility={node.id}
                          data-modeled-impact={node.modeled}
                        >
                          <line
                            x1={x}
                            y1="38"
                            x2={x}
                            y2={y}
                            style={{
                              stroke: "#5a799e",
                              strokeDasharray: "3 4",
                            }}
                          />
                          <circle
                            cx={x}
                            cy={y}
                            r="10"
                            style={{
                              fill: node.modeled ? "#683c23" : "#1e4368",
                              stroke: node.modeled ? "#ffb66f" : "#86beff",
                            }}
                          />
                          <text x={x} y={y + 26} textAnchor="middle">
                            {displayText(node.label)}
                          </text>
                          <title>{`${displayText(node.label)} · ${node.classification.lineage} · ${status}`}</title>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="cc-sector-buttons">
            {sectors.map((sector) => (
              <details key={sector.key} className="cc-sector-button">
                <summary>
                  {sector.label} · {sector.nodes.length} captured facilities
                </summary>
                <ul className="command-record-list">
                  {sector.nodes.map((node) => (
                    <li key={node.id}>
                      <strong>{displayText(node.label)}</strong>
                      <small>{node.classification.lineage}</small>
                      <small>
                        {node.modeled
                          ? "Captured modeled result; not observed"
                          : "Captured context; no modeled impact"}
                      </small>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </>
      ) : (
        <Empty>No captured physical-facility sector context.</Empty>
      )}
    </Panel>
  );
}
export interface DependencyNetworkProps {
  model: ConsequenceModel;
  mode: "display" | "explore";
  idtIndex?: IdtIndex | null;
  onWhatIf?: (entityId: string) => void;
  onOpenMap?: (entityId: string) => void;
  onOpenEntity?: (entityId: string) => void;
  onPropose?: (entityId: string, role?: "provider" | "dependent") => void;
}
export default function DependencyNetwork({
  model,
  mode,
  idtIndex = null,
  onWhatIf,
  onOpenMap,
  onOpenEntity,
  onPropose,
}: DependencyNetworkProps) {
  const [sector, setSector] = useState<string | null>(null);
  const [asset, setAsset] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showUnaffected, setShowUnaffected] = useState(true);
  const [ownership, setOwnership] = useState(false);
  const [cyberLinks, setCyberLinks] = useState(false);
  const group = model.groups.find((item) => item.key === sector);
  const rows = group?.items ?? model.rows;
  const row =
    rows.find((item) => item.id === asset || item.entityId === asset) ??
    rows[0];
  const focusedId = asset ?? row?.entityId ?? model.run?.seed.provider;
  const entity = model.captured.entities.find((item) => item.id === focusedId);
  const network = explorationNetwork(model, {
    expanded,
    showUnaffected,
    ownership,
    cyberLinks,
  });
  const selectedRow = model.rows.find((item) => item.entityId === focusedId);
  const dependencies = model.captured.dependencies.filter(
    (d) => d.dependent === focusedId,
  );
  const count = model.groups.length;
  const chooseSector = (key: string) => {
    setSector(key);
    setAsset(null);
  };
  const services = (items: ConsequenceModel["rows"]) => [
    ...new Set(
      items.flatMap((impact) =>
        impact.dependencies.map((dependency) =>
          words(dependency.requiredService),
        ),
      ),
    ),
  ];
  return (
    <>
      <SavedInventoryNetwork model={model} />
      <div className="cc-network-layout">
        <Panel
          title={group ? group.label : "Captured Dependency Network"}
          note="Modeled · not observed outages"
        >
          {group && (
            <button
              className="command-link"
              onClick={() => {
                setSector(null);
                setAsset(null);
              }}
            >
              ← All sectors
            </button>
          )}
          {!group && (
            <>
              <div className="cc-network-graphic">
                <svg
                  viewBox="0 0 640 360"
                  role="img"
                  aria-label="Captured source linked to modeled impact groups"
                >
                  {model.groups.map((item, i) => {
                    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
                    const x = 320 + Math.cos(angle) * 225,
                      y = 180 + Math.sin(angle) * 120;
                    const radius = 18 + Math.sqrt(item.count) * 6;
                    return (
                      <g
                        key={item.key}
                        role="button"
                        tabIndex={0}
                        aria-label={`Show ${item.label}: ${item.count} facilities`}
                        onClick={() => chooseSector(item.key)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            chooseSector(item.key);
                          }
                        }}
                      >
                        <line x1="320" y1="180" x2={x} y2={y} />
                        <circle cx={x} cy={y} r={radius} />
                        <text x={x} y={y + 5} textAnchor="middle">
                          {item.count}
                        </text>
                        <title>{`${item.label}: ${item.count} modeled facilities · ${services(item.items).join(", ") || "Dependency labels not captured"}`}</title>
                      </g>
                    );
                  })}
                  <circle
                    cx="320"
                    cy="180"
                    r="38"
                    className="cc-network-source"
                  />
                  <text x="320" y="245" textAnchor="middle">
                    {displayText(model.sourceLabel)}
                  </text>
                </svg>
              </div>

              <div className="cc-sector-buttons">
                {model.groups.map((item) => (
                  <button
                    key={item.key}
                    className="cc-sector-button"
                    onClick={() => chooseSector(item.key)}
                  >
                    <strong>{item.label}</strong>
                    <span>
                      {item.count} facilities · {planningWindow(item.earliest)}
                    </span>
                    <small>
                      {services(item.items).join(" · ") ||
                        "Dependency labels not captured"}
                    </small>
                  </button>
                ))}
              </div>
            </>
          )}
          {group && (
            <ul className="command-record-list">
              {rows.map((item) => (
                <li key={item.id}>
                  <button
                    className="command-link"
                    onClick={() =>
                      setAsset(mode === "explore" ? item.entityId : item.id)
                    }
                    aria-pressed={row?.id === item.id}
                  >
                    {displayText(item.label)} ·{" "}
                    {displayText(item.functionLabel)}
                  </button>
                  <small>
                    {words(item.state)} · {planningWindow(item.windowHours)} ·
                    modeled
                  </small>
                </li>
              ))}
            </ul>
          )}
          {!model.rows.length && <Empty>No modeled impacts.</Empty>}
          {mode === "explore" && (
            <div className="a4-exploration">
              <fieldset className="a4-toggles">
                <legend>Explore captured dependencies</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={showUnaffected}
                    onChange={(e) => setShowUnaffected(e.target.checked)}
                  />
                  Show unaffected paths
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={ownership}
                    onChange={(e) => setOwnership(e.target.checked)}
                  />
                  Ownership
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={cyberLinks}
                    onChange={(e) => setCyberLinks(e.target.checked)}
                  />
                  Cyber links
                </label>
              </fieldset>
              <p>
                Context links are not propagated consequences. No modeled result
                does not establish unaffected operations.
              </p>
              <ul className="a4-network-nodes">
                {network.nodes.map((node) => (
                  <li key={node.id} data-explore-node={node.id}>
                    <button
                      className="command-link"
                      aria-pressed={focusedId === node.id}
                      onClick={() => setAsset(node.id)}
                      onDoubleClick={() => onOpenEntity?.(node.id)}
                    >
                      {displayText(node.label)}
                    </button>
                    <small>
                      {model.rows.some((r) => r.entityId === node.id)
                        ? "Captured modeled result"
                        : "Captured context; no modeled impact"}
                    </small>
                    <button
                      className="command-link"
                      aria-label={`Expand upstream of ${node.label}`}
                      onClick={() => {
                        setAsset(node.id);
                        setExpanded((previous) => [
                          ...new Set([
                            ...previous,
                            ...expandUpstream(model, node.id),
                          ]),
                        ]);
                      }}
                    >
                      Expand upstream
                    </button>
                  </li>
                ))}
              </ul>
              <ul className="a4-network-links">
                {network.edges.map((edge) => (
                  <li key={edge.id} data-explore-edge={edge.id}>
                    {displayText(
                      model.captured.entities.find(
                        (e) => e.id === edge.provider,
                      )?.label ?? "Unknown provider",
                    )}{" "}
                    →{" "}
                    {displayText(
                      model.captured.entities.find(
                        (e) => e.id === edge.dependent,
                      )?.label ?? "Unknown dependent",
                    )}{" "}
                    · {words(edge.requiredService)}
                    {edge.excludedReason
                      ? ` · Not carried: ${edge.excludedReason}`
                      : " · Captured dependency"}
                  </li>
                ))}
                {network.relations.map((link) => (
                  <li key={link.id}>
                    {displayText(
                      model.captured.entities.find((e) => e.id === link.from)
                        ?.label ?? "Unknown entity",
                    )}{" "}
                    →{" "}
                    {displayText(
                      model.captured.entities.find((e) => e.id === link.to)
                        ?.label ?? "Unknown entity",
                    )}{" "}
                    · {link.kind}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
        <Panel title="Why It's at Risk" note="Modeled · not observed outages">
          {mode === "explore" && entity ? (
            <aside aria-label="Dependency details">
              <h3 onDoubleClick={() => onOpenEntity?.(entity.id)}>
                {displayText(entity.label)}
              </h3>
              <IdtChip entity={entity} index={idtIndex} />
              <dl className="cc-facts">
                <dt>Function</dt>
                <dd>
                  {selectedRow
                    ? displayText(selectedRow.functionLabel)
                    : "No modeled function result"}
                </dd>
                <dt>Modeled state</dt>
                <dd>
                  {selectedRow
                    ? words(selectedRow.state)
                    : "Captured context only"}
                </dd>
                <dt>Window</dt>
                <dd>{planningWindow(selectedRow?.windowHours ?? null)}</dd>
                {dependencies.map((d) => (
                  <div key={d.id}>
                    <dt>Reserve</dt>
                    <dd>
                      {d.usableBackupMinHours === null ||
                      d.usableBackupMaxHours === null
                        ? "Unknown captured reserve"
                        : `${d.usableBackupMinHours}–${d.usableBackupMaxHours} hours`}
                    </dd>
                    <dt>Propagation delay</dt>
                    <dd>
                      {d.propagationDelayMinHours}–{d.propagationDelayMaxHours}{" "}
                      hours
                    </dd>
                    <dt>Loss fraction</dt>
                    <dd>{d.lossOfFunction}</dd>
                    <dt>Assumption</dt>
                    <dd>{displayText(d.assumptionNote)}</dd>
                  </div>
                ))}
              </dl>
              <h4>Captured assumptions</h4>
              <ul>
                {selectedRow?.assumptions.map((a, i) => (
                  <li key={i}>{displayText(a)}</li>
                ))}
              </ul>
              <Sources
                refs={[
                  ...new Set([
                    ...entity.sourceRefs,
                    ...dependencies.flatMap((d) => d.sourceRefs),
                    ...(selectedRow?.sourceRefs ?? []),
                  ]),
                ]}
                sources={model.captured.sources}
              />
              <div className="a4-actions">
                <button
                  disabled={!selectedRow || !onWhatIf}
                  onClick={() => onWhatIf?.(entity.id)}
                >
                  Run a what-if on this
                </button>
                <button onClick={() => onOpenMap?.(entity.id)}>
                  Open on A2 map
                </button>
                <button onClick={() => onPropose?.(entity.id, "dependent")}>
                  Propose missing dependency
                </button>
                <button onClick={() => onOpenEntity?.(entity.id)}>
                  Open entity profile
                </button>
              </div>
            </aside>
          ) : row ? (
            <>
              <h3>{displayText(row.label)}</h3>
              <p>{row.classification.lineage}</p>
              <dl className="cc-facts">
                <dt>Modeled state</dt>
                <dd>{words(row.state)}</dd>
                <dt>Window</dt>
                <dd>{planningWindow(row.windowHours)}</dd>
                <dt>Reserve</dt>
                <dd>
                  {row.dependencies.length
                    ? [
                        ...new Set(
                          row.dependencies.map((dependency) =>
                            dependency.usableBackupMinHours === null ||
                            dependency.usableBackupMaxHours === null
                              ? "Unknown captured reserve"
                              : `${dependency.usableBackupMinHours}–${dependency.usableBackupMaxHours} hours`,
                          ),
                        ),
                      ].join("; ")
                    : "No dependency reserve captured"}
                </dd>
                <dt>Path</dt>
                <dd>
                  {row.chains.flat().map(displayText).join(" → ") ||
                    "Path labels not captured"}
                </dd>
              </dl>
              <h4>Captured assumptions</h4>
              <ul>
                {row.assumptions.map((assumption, i) => (
                  <li key={i}>{displayText(assumption)}</li>
                ))}
              </ul>
              <Sources refs={row.sourceRefs} sources={model.captured.sources} />
            </>
          ) : (
            <Empty>No modeled result to inspect.</Empty>
          )}
        </Panel>
      </div>
      <Panel title="Who Runs Out First" note="Modeled · not observed outages">
        <ImpactList model={model} />
      </Panel>
      <Panel title="By Sector">
        <div className="command-table-wrap">
          <table className="command-table">
            <thead>
              <tr>
                <th scope="col">Captured classification</th>
                <th scope="col">Facilities in results</th>
                <th scope="col">Earliest window</th>
              </tr>
            </thead>
            <tbody>
              {model.groups.map((item) => (
                <tr key={item.key}>
                  <td>
                    <button
                      className="command-link"
                      onClick={() => chooseSector(item.key)}
                    >
                      {item.label}
                    </button>
                  </td>
                  <td>{item.count}</td>
                  <td>{planningWindow(item.earliest)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="command-muted">
          Consequence model: {model.run?.modelVersion} · Captured{" "}
          {timeLabel(model.run?.createdAt)} · Baseline revision{" "}
          {model.run?.baselineRevision}
        </p>
        {!!model.run?.warnings.length && (
          <p className="cc-notice">
            Needs model review:{" "}
            {model.run.warnings
              .map((warning) =>
                typeof warning === "string" ? warning : JSON.stringify(warning),
              )
              .join("; ")}
          </p>
        )}
        <p className="command-muted">
          {model.run?.excluded.length} excluded path records
        </p>
      </Panel>
    </>
  );
}
