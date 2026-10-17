import { StatusChip } from "./visualPrimitives.ts";
import { useEffect, useRef, useState, type RefObject } from "react";
import { fittedTexasMarkerLayout, FITTED_TEXAS_VIEWBOX } from "./fittedTexasMap.ts";

import { idtEntry, idtSectorName } from "./idt.ts";
import { words } from "./commandCenterModel.ts";
import { analysisLabel } from "./caseFilePresentation.ts";
import { TEXAS_PATH, TEXAS_BOUNDARY_SOURCE } from "./texasOutline.ts";
import {
  statewideFootprint,
  type Coordinate,
  type StatewideFootprintModel,
  type StatewideFootprintProps,
} from "./statewideFootprint.ts";
import { InfrastructureIcon } from "./InfrastructureIcon.tsx";
import { infrastructureKind, infrastructureLabel } from "./infrastructureIcons.ts";
import "./statewide-footprint.css";
import "./infrastructure-map.css";

export type { StatewideFootprintProps } from "./statewideFootprint.ts";
const count = (v: number | null) =>
  v === null ? "Not recorded" : v.toLocaleString("en-US");
const windowLabel = (v: Coordinate | null) =>
  v ? `${v[0]}–${v[1]} h` : "Timing unknown";

function RecordedFootprints({ model }: { model: StatewideFootprintModel }) {
  return (
    <details
      className="sf-recorded-footprints"
      aria-label="Captured service footprints"
    >
      <summary>Recorded service footprints · local geometry and related probes</summary>
      <div className="sf-legend" aria-label="Service footprint legend">
        <span><i className="sf-legend-attack" />Attacked utility</span>
        <span><i className="sf-legend-probe" />Probed utility</span>
        <span><i className="sf-legend-facility" />Facility at risk (modeled)</span>
      </div>
      {model.layers
        .filter((layer) => layer.utility)
        .map((layer) => {
          const coordinates = [
            ...layer.serviceAreas.flatMap((area) => area.rings.flat()),
            ...layer.facilities.flatMap((f) =>
              f.coordinates ? [f.coordinates] : [],
            ),
            ...layer.excluded.flatMap((f) =>
              f.coordinates ? [f.coordinates] : [],
            ),
            ...(layer.utility?.coordinates ? [layer.utility.coordinates] : []),
          ];
          const xs = coordinates.map((p) => p[0]),
            ys = coordinates.map((p) => p[1]);
          const minX = Math.min(...xs),
            maxX = Math.max(...xs),
            minY = Math.min(...ys),
            maxY = Math.max(...ys);
          const project = (p: Coordinate): Coordinate => [
            55 + ((p[0] - minX) / (maxX - minX || 1)) * 610,
            235 - ((p[1] - minY) / (maxY - minY || 1)) * 190,
          ];
          const utilityPoint = layer.utility?.coordinates
            ? project(layer.utility.coordinates)
            : null;
          const muted = model.active?.caseId !== layer.caseId;
          return (
            <section
              key={layer.caseId}
              className={`sf-local-footprint ${muted ? "sf-muted" : ""}`}
              data-footprint-case={layer.caseId}
            >
              <h3>
                {layer.utility!.label} service area ·{" "}
                {count(layer.utility!.people)} people
              </h3>
              <p className="sf-caption">
                {layer.run ? analysisLabel(layer.run) : "Not yet modeled"} ·
                recorded local coordinates
              </p>
              {coordinates.length ? (
                <svg
                  viewBox="0 0 720 285"
                  role="img"
                  aria-label={`${layer.utility!.label} recorded service outline and captured facilities`}
                >
                  {layer.serviceAreas.flatMap((area) =>
                    area.rings.map((ring, index) => (
                      <polygon
                        key={`${area.id}-${index}`}
                        data-service-area={area.id}
                        points={ring.map((p) => project(p).join(",")).join(" ")}
                        className="sf-service-outline"
                      >
                        <title>{`${area.label} · recorded schematic boundary`}</title>
                      </polygon>
                    )),
                  )}
                  {utilityPoint && (
                    <g
                      transform={`translate(${utilityPoint.join(" ")})`}
                      className={`sf-utility sf-${layer.utility!.status}`}
                    >
                      <circle r="10" />
                      <text x="15" y="5">
                        {layer.utility!.label} ·{" "}
                        {layer.utility!.label &&
                          (layer.utility!.status === "under-attack"
                            ? "Under attack"
                            : layer.utility!.status === "probed"
                              ? "Probed"
                              : "No active attack label")}
                      </text>
                    </g>
                  )}
                  {layer.facilities.map((f) =>
                    f.coordinates ? (
                      <g
                        key={`${f.id}-${f.functionId}`}
                        data-modeled-facility={f.id}
                        transform={`translate(${project(f.coordinates).join(" ")})`}
                        className="sf-facility"
                      >
                        <path d="M 0 -7 L 7 0 L 0 7 L -7 0 Z" />
                        <text x="12" y="-9">
                          {f.label} · {windowLabel(f.windowHours)}
                        </text>
                        <title>{`${f.label}: modeled, ${windowLabel(f.windowHours)}`}</title>
                      </g>
                    ) : null,
                  )}
                  {layer.excluded.map((f) =>
                    f.coordinates ? (
                      <g
                        key={f.id}
                        transform={`translate(${project(f.coordinates).join(" ")})`}
                        className="sf-excluded"
                      >
                        <circle r="6" />
                        <text x="10" y="19">
                          {f.label} · not affected
                        </text>
                        <title>{f.reason}</title>
                      </g>
                    ) : null,
                  )}
                </svg>
              ) : (
                <p>Recorded geometry unavailable; no boundary inferred.</p>
              )}
              <div className="sf-probes" aria-label="Related probes">
                {layer.probed.map((p) => (
                  <span key={p.id} className="sf-probe">
                    <i aria-hidden="true" />
                    {p.label} · Probed{" "}
                    <small>
                      {count(p.people)} people · no modeled consequence
                    </small>
                  </span>
                ))}
              </div>
              {!layer.run && (
                <p>Not yet modeled · no captured facility windows.</p>
              )}
            </section>
          );
        })}
    </details>
  );
}

/** Stateless rendering also makes navigation callbacks independently testable. */
export function StatewideFootprintView({
  model,
  onPick,
  onOpenAnalyst,
  mapRef,
  mapSize = { width: 640, height: 448 },
  compact = false,
  activeOnly = false,
}: {
  model: StatewideFootprintModel;
  onPick: (id: string) => void;
  onOpenAnalyst: StatewideFootprintProps["onOpenAnalyst"];
  mapRef?: RefObject<HTMLDivElement | null>;
  mapSize?: { width: number; height: number };
  compact?: boolean;
  activeOnly?: boolean;
}) {
  const row = model.active;
  const rows = activeOnly ? model.rows.filter(item => item.status !== "closed") : model.rows;
  // Fit the same source set in both views: hiding a closed incident must not
  // move another incident or fabricate a pin for an unknown source location.
  const { markers, capacityExceeded } = fittedTexasMarkerLayout(
    model.rows.flatMap((item) => {
      const p = item.location?.schematic;
      return p && Number.isFinite(p.x) && Number.isFinite(p.y)
        ? [{ id: item.id, x: p.x, y: p.y }]
        : [];
    }),
    mapSize.width,
    mapSize.height,
  );

  return (
    <section className={`sf-statewide${compact ? " sf-compact" : ""}`} aria-label="Statewide incident footprint">
      <header className="sf-heading">
        <p>{activeOnly ? "Active infrastructure incidents" : "Infrastructure & incidents"}</p>
        <span className="infrastructure-map-count">{markers.filter(marker => rows.some(item => item.id === marker.id)).length} mapped</span>
      </header>

      <div className="sf-layout">
        <section className="sf-map-panel" aria-label="Statewide map">
          <div className="sf-state-map" ref={mapRef}>
            <svg
              className="sf-state-boundary"
              viewBox={FITTED_TEXAS_VIEWBOX}
              aria-hidden="true"
              focusable="false"
              data-state-boundary="texas"
              data-boundary-source={TEXAS_BOUNDARY_SOURCE}
            >
              <path d={TEXAS_PATH} />
            </svg>

            {rows.map((item) => {
              const position = item.location?.schematic;
              if (
                !position ||
                !Number.isFinite(position.x) ||
                !Number.isFinite(position.y)
              )
                return null;
              const marker = markers.find((m) => m.id === item.id);
              if (!marker) return null;
              const kind = infrastructureKind(item);
              return (
                <button
                  type="button"
                  key={item.id}
                  data-incident-pin={item.id}
                  data-infrastructure-kind={kind}
                  className={`sf-incident-pin ${item.id === row?.id ? "sf-selected" : "sf-muted"}`}
                  style={{
                    left: `${marker.x}px`,
                    top: `${marker.y}px`,
                    transform: "translate(-50%, -50%)",
                  }}
                  aria-pressed={item.id === row?.id}
                  aria-label={`${item.title} · ${item.id} · ${words(item.status ?? "unknown")}`}
                  onClick={() => onPick(item.id)}
                  title={`${item.title} · ${item.id} · ${item.location?.label ?? ""}`}
                >
                  <InfrastructureIcon kind={kind} size={26} />
                  <span className="sf-pin-label">
                    {item.title}
                    <small>
                      {item.id} · {words(item.status ?? "unknown")}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>

          {capacityExceeded && <p role="status">Too many incidents for separate touch targets at this width. Every incident is available in the list below.</p>}
          <div className="sf-legend infrastructure-map-legend" aria-label="Infrastructure types">
            {[...new Set(rows.filter(item => markers.some(marker => marker.id === item.id)).map(infrastructureKind))].sort((a, b) => infrastructureLabel(a).localeCompare(infrastructureLabel(b))).map((kind) => (
              <span key={kind} data-infrastructure-kind={kind}>
                <InfrastructureIcon kind={kind} size={18} />
                {infrastructureLabel(kind)}
              </span>
            ))}
          </div>
          <details className="sf-incident-index" open={capacityExceeded || undefined}>
            <summary>{activeOnly ? "Active incidents" : "All incidents"} · {rows.length}</summary>
            <nav className="sf-incident-nav" aria-label="Statewide incidents">
              {rows.map((item) => (
                <button type="button" key={item.id} aria-pressed={item.id === row?.id} onClick={() => onPick(item.id)}>
                  <span className="sf-nav-icon" data-infrastructure-kind={infrastructureKind(item)}><InfrastructureIcon kind={infrastructureKind(item)} size={22} /></span>
                  <span className="sf-nav-title">{item.title}</span>
                  <StatusChip status={item.severity}>{words(item.severity ?? "unknown")}</StatusChip>
                </button>
              ))}
            </nav>
          </details>
          <RecordedFootprints model={model} />
          {rows.some((item) => !item.location?.schematic) && (
            <p className="sf-caption">Some incident locations are unknown.</p>
          )}
        </section>
        {!compact && <aside
          className="sf-summary"
          aria-label="Read-only summary"
          aria-live="polite"
        >
          <p className="sf-eyebrow">Selected incident · read-only summary</p>
          {row ? (
            <>
              <h2>{row.title}</h2>
              <p className="sf-id">
                {row.id} ·{" "}
                {model.elapsed === null
                  ? "Elapsed unknown"
                  : `${Math.floor(model.elapsed / 60)}h ${model.elapsed % 60}m elapsed`}
              </p>
              <div className="sf-chips">
                <StatusChip status={row.severity}>
                  Severity: {words(row.severity ?? "unknown")}
                </StatusChip>
                <StatusChip status={row.status}>
                  {words(row.status ?? "unknown")}
                </StatusChip>
              </div>
              <details className="sf-incident-detail"><summary>Recorded incident detail</summary><p>{row.summary}</p></details>
              <dl>
                <dt>Location</dt>
                <dd>{row.location?.label ?? "Not recorded"}</dd>
                <dt>IDT sectors</dt>
                <dd>
                  {row.sectors
                    ?.map(
                      (code) =>
                        `${idtEntry(code, model.idtIndex)?.name ?? idtSectorName(code) ?? "Unassigned"} (${code})`,
                    )
                    .join(" · ") ?? "Not recorded"}
                </dd>
                <dt>People in affected service</dt>
                <dd>{count(model.people)}</dd>
                {model.probed.length > 0 && (
                  <>
                    <dt>Also probed</dt>
                    <dd>
                      {model.probed.map((p) => p.label).join(" and ")} (
                      {count(model.probedPeople)} people) · probing only
                    </dd>
                  </>
                )}
              </dl>
              <section className="sf-facility-summary">
                <h3>Facilities at risk (modeled)</h3>
                {model.run ? (
                  <>
                    <p className="sf-caption">{analysisLabel(model.run)}</p>
                    <ul>
                      {model.facilities.map((f) => (
                        <li key={`${f.id}-${f.functionId}`}>
                          <span>{f.label}</span>
                          <strong>{windowLabel(f.windowHours)}</strong>
                        </li>
                      ))}
                    </ul>
                    {!model.facilities.length && (
                      <p>No facilities at risk in this analysis.</p>
                    )}
                  </>
                ) : (
                  <p>Not yet modeled.</p>
                )}
                {model.excluded.map((f) => (
                  <p key={f.id} className="sf-excluded-note">
                    {f.label} · not affected <small>{f.reason}</small>
                  </p>
                ))}
                {model.boilWaterRule && (
                  <p className="sf-notice">
                    {model.boilWaterRule.label}
                    <small>{String(model.boilWaterRule.decidedBy ?? "")}</small>
                  </p>
                )}
              </section>
              <p className="sf-decisions">
                <strong>{model.decisionsWaiting} decisions waiting</strong> ·
                recorded response options
              </p>
              <button
                type="button"
                className="sf-open"
                data-open-analyst="true"
                onClick={() =>
                  onOpenAnalyst("cop", model.caseRecord?.id, model.utility?.id)
                }
              >
                Open in Analyst
              </button>
            </>
          ) : (
            <p>No statewide incident records available.</p>
          )}
        </aside>}
      </div>
    </section>
  );
}

export default function StatewideFootprint(props: StatewideFootprintProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState({ width: 640, height: 448 });
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const measure = () => {
      const { width, height } = map.getBoundingClientRect();
      setMapSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(map);
    return () => observer.disconnect();
  }, []);
  const [selection, setSelection] = useState<{
    scope: string | null;
    id: string | null;
  }>({ scope: null, id: null });
  const scope = props.selected?.id ?? null;
  const model = statewideFootprint(
    props,
    props.pickedIncidentId ?? (selection.scope === scope ? selection.id : null),
  );
  const pick = (id: string) => {
    setSelection({ scope, id });
    if (props.onPickIncident) {
      props.onPickIncident(id);
      return;
    }
    const caseId = model.rows.find((row) => row.id === id)?.caseId;
    if (caseId && caseId !== props.selected?.id) props.onSelect?.(caseId);
  };
  return (
    <StatewideFootprintView
      model={model}
      onPick={pick}
      onOpenAnalyst={props.onOpenAnalyst}
      mapRef={mapRef}
      mapSize={mapSize}
      compact={props.compact}
      activeOnly={props.activeOnly}
    />
  );
}
