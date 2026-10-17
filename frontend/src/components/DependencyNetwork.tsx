import { useState, type ReactNode } from "react";
import type { Source } from "../types.ts";
import {
  capturedClassification,
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
import { consequenceGraph, explorationView } from "../sectorNetwork.ts";
import SectorGraph from "./SectorGraph.tsx";
import "../command-center-views.css";
import "../analyst-consequences.css";

const capturedLineage = (
  entity: Parameters<typeof capturedClassification>[0],
) => capturedClassification(entity).lineage;
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
  /** Reference boil-water rule label when it applies to this run. */
  boilWaterLabel?: string | null;
}
/** Display the captured interval verbatim; the axis is a view, not a new model. */
function PlanningTimeline({ model }: { model: ConsequenceModel }) {
  return (
    <div className="cc-planning-timeline">
      {model.rows.map((row) => (
        <div className="cc-planning-row" key={row.id}>
          <span>{displayText(row.label)}</span>
          <div className="cc-planning-track" aria-hidden="true">
            {row.windowHours && (
              <span
                className={`cc-planning-bar ${(row.windowHours[0] >= 4) ? "later" : "urgent"}`}
                data-window-start={row.windowHours[0]} data-window-end={row.windowHours[1]}
                style={{ left: `${row.windowHours[0] / 12 * 100}%`, width: `${(row.windowHours[1] - row.windowHours[0]) / 12 * 100}%` }}
              />
            )}
          </div>
          <span className="cc-planning-window">{planningWindow(row.windowHours)}</span>
        </div>
      ))}
      {!model.rows.length && <Empty>No modeled impacts.</Empty>}
      <div className="cc-planning-row cc-planning-axis" aria-label="Planning axis: 0 to 12 hours">
        <span /><div>{[0, 3, 6, 9, 12].map((hour) => <span key={hour}>{hour} h</span>)}</div><span />
      </div>
    </div>
  );
}

/** Roll up captured graph members, never the unrelated saved inventory. */
function SectorRollup({ model, graph, notice, onChoose }: {
  model: ConsequenceModel;
  graph: ReturnType<typeof consequenceGraph>;
  notice: string | null;
  onChoose: (key: string) => void;
}) {
  const source = model.captured.entities.find((entity) => entity.id === model.run?.seed.provider);
  const sourceClass = capturedClassification(source);
  const sectorNodes = graph?.overview.nodes.filter((node) => node.sectorKey && node.direction !== "up") ?? [];
  const entries = sectorNodes.map((node) => {
    const key = node.sectorKey!;
    const classificationKey = key.replace(/^self:/, "");
    const members = graph?.sectorView(key)?.nodes.filter((member) =>
      member.kind === "facility" && member.line !== "dotted" && member.entityId !== source?.id &&
      capturedClassification(model.captured.entities.find((entity) => entity.id === member.entityId)).key === classificationKey,
    ) ?? [];
    const ids = new Set(members.map((member) => member.entityId));
    const rows = model.rows.filter((row) => ids.has(row.entityId));
    const proofs = members.map((member) => model.run?.excluded.filter((value) => {
      const exclusion = value as { dependencyId?: string; reason?: string };
      return model.captured.dependencies.some((dependency) =>
        dependency.id === exclusion.dependencyId && dependency.dependent === member.entityId,
      );
    }) ?? []);
    const explicitUnaffected = members.length > 0 && proofs.every((items) => items.length > 0);
    const reasons = [...new Set(proofs.flat().map((value) => displayText((value as { reason?: string }).reason ?? "Captured excluded dependency")))];
    return {
      key, classificationKey,
      label: `${node.label.replace(/ customers$/, "")} (${node.idt.replace(/^IDT /, "")})`,
      affected: node.direction === "self"
        ? `${model.sourceLabel}${model.people !== null ? ` · ${model.people.toLocaleString("en-US")} people` : " · Population not captured"}`
        : `${new Set(rows.map((row) => row.entityId)).size} of ${members.length}`,
      window: node.direction === "self" ? "Now" : rows.find((row) => row.windowHours) ? planningWindow(rows.find((row) => row.windowHours)!.windowHours) : "—",
      note: node.direction === "self"
        ? notice ?? "Scenario source · no matching boil-water rule"
        : rows.length ? [...new Set(rows.map((row) => displayText(row.label)))].join(", ")
          : explicitUnaffected ? `Not affected: ${reasons.join("; ")}` : "No modeled impact; unaffected not established",
    };
  });
  // A source without a customer node still has captured sector membership.
  if (sourceClass.classified && !entries.some((entry) => entry.classificationKey === sourceClass.key))
    entries.unshift({ key: sourceClass.key, classificationKey: sourceClass.key,
      label: sourceClass.label, affected: model.sourceLabel, window: "Now", note: "Scenario source" });
  // Keep unclassified modeled groups explicit rather than silently discarding them.
  for (const group of model.groups)
    if (!entries.some((entry) => entry.classificationKey === group.key))
      entries.push({ key: group.key, classificationKey: group.key, label: group.label,
        affected: `${group.count} facilities`, window: planningWindow(group.earliest),
        note: group.items.map((row) => displayText(row.label)).join(", ") });
  entries.sort((a, b) => Number(b.classificationKey === sourceClass.key) - Number(a.classificationKey === sourceClass.key));
  return (
    <div className="command-table-wrap">
      <table className="command-table cc-sector-rollup">
        <thead><tr><th scope="col">Sector (IDT)</th><th scope="col">Affected</th><th scope="col">Earliest window</th><th scope="col">Note</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.key}>
          <td><button className="command-link" onClick={() => onChoose(entry.key)}>{entry.label}</button></td>
          <td>{entry.affected}</td><td>{entry.window}</td><td>{entry.note}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

export default function DependencyNetwork({
  model,
  mode,
  idtIndex = null,
  onWhatIf,
  onOpenMap,
  onOpenEntity,
  onPropose,
  boilWaterLabel = null,
}: DependencyNetworkProps) {
  const [sector, setSector] = useState<string | null>(null);
  const [asset, setAsset] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showUnaffected, setShowUnaffected] = useState(true);
  const [ownership, setOwnership] = useState(false);
  const [cyberLinks, setCyberLinks] = useState(false);
  const [graphSector, setGraphSector] = useState<string | null>(null);
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
  const graph = consequenceGraph(model, { boilWaterLabel });
  const drill = graph && graphSector ? graph.sectorView(graphSector) : null;
  const exploreView =
    mode === "explore" ? explorationView(model, network) : null;
  const pickedEntity =
    asset && !rows.some((item) => item.id === asset || item.entityId === asset)
      ? model.captured.entities.find((item) => item.id === asset)
      : undefined;
  const pickedReason = (() => {
    if (!pickedEntity) return null;
    const dep = model.captured.dependencies.find(
      (d) => d.dependent === pickedEntity.id,
    );
    const ex = (model.run?.excluded ?? []).find(
      (value) => (value as { dependencyId?: string }).dependencyId === dep?.id,
    ) as { reason?: string } | undefined;
    return ex?.reason ?? null;
  })();
  const dependencies = model.captured.dependencies.filter(
    (d) => d.dependent === focusedId,
  );
  const chooseSector = (key: string) => {
    setSector(key);
    setGraphSector(key);
    setAsset(null);
  };
  return (
    <div className={`cc-dependency-network cc-dependency-${mode}`}>
      <div className="cc-network-layout">
        <Panel
          title="Sector dependencies"
          note="Modeled · not observed outages"
        >
          {drill && (
            <button
              className="command-link sg-back"
              onClick={() => {
                setGraphSector(null);
                setSector(null);
                setAsset(null);
              }}
            >
              ← All sectors
            </button>
          )}
          {graph && (
            <SectorGraph
              view={drill ?? graph.overview}
              layout={drill ? "layered" : "radial"}
              selectedId={drill ? (asset ?? row?.entityId ?? null) : null}
              ariaLabel={
                drill
                  ? `${drill.title}: facilities and their dependency links`
                  : "Sectors linked to the incident source by captured dependencies"
              }
              onSelect={(node) => {
                if (!drill && node.sectorKey) {
                  setGraphSector(node.sectorKey);
                  setSector(node.sectorKey.replace(/^self:/, ""));
                  setAsset(null);
                } else if (node.entityId) {
                  const match = model.rows.find(
                    (item) => item.entityId === node.entityId,
                  );
                  setAsset(
                    mode === "explore"
                      ? node.entityId
                      : (match?.id ?? node.entityId),
                  );
                }
              }}
            />
          )}
          {!model.rows.length && <Empty>No modeled impacts.</Empty>}
          {mode === "explore" && (
            <div className="a4-exploration">
              {exploreView && (
                <SectorGraph
                  view={exploreView}
                  layout="layered"
                  selectedId={focusedId ?? null}
                  ariaLabel="Explore captured dependencies"
                  onSelect={(node) => node.entityId && setAsset(node.entityId)}
                />
              )}
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
              <details>
                <summary>List view</summary>
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
              </details>
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
                <button
                  onClick={() =>
                    setExpanded((previous) => [
                      ...new Set([
                        ...previous,
                        ...expandUpstream(model, entity.id),
                      ]),
                    ])
                  }
                >
                  Expand upstream
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
          ) : pickedEntity ? (
            <>
              <h3>{displayText(pickedEntity.label)}</h3>
              <p>{capturedLineage(pickedEntity)}</p>
              <dl className="cc-facts">
                <dt>Modeled state</dt>
                <dd>
                  {pickedReason
                    ? "Not affected"
                    : "No modeled impact in this run"}
                </dd>
                {pickedReason && (
                  <>
                    <dt>Why</dt>
                    <dd>{displayText(pickedReason)}</dd>
                  </>
                )}
              </dl>
            </>
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
                              : dependency.usableBackupMinHours ===
                                  dependency.usableBackupMaxHours
                                ? `${dependency.usableBackupMinHours} hours`
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
              <details className="cc-inspector-evidence">
                <summary>Captured assumptions and sources</summary>
                <ul>
                  {row.assumptions.map((assumption, i) => (
                    <li key={i}>{displayText(assumption)}</li>
                  ))}
                </ul>
                <Sources refs={row.sourceRefs} sources={model.captured.sources} />
              </details>
            </>
          ) : (
            <Empty>No modeled result to inspect.</Empty>
          )}
        </Panel>
      </div>
      <Panel title="Who runs out first" note="Planning windows from scenario assumptions, not countdowns · next 12 hours">
        <PlanningTimeline model={model} />
      </Panel>
      <Panel title="By Sector">
        <SectorRollup model={model} graph={graph} notice={boilWaterLabel} onChoose={chooseSector} />
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
      <details className="sg-inventory">
        <summary>Saved inventory by sector (context, not dependencies)</summary>
        <SavedInventoryNetwork model={model} />
      </details>
    </div>
  );
}
