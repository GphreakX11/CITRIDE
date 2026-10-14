import { useId, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Crosshair,
  ExternalLink,
  MapPin,
  Minus,
  Network,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { Bootstrap, Entity } from "./types";
import { displayText } from "./presentation";
import { humanize, windowLabel } from "./api";
import {
  connectedEdges,
  graphEdges,
  infrastructureIds,
  mapPositions,
} from "./texasGraph";
import type { MapEdge } from "./texasGraph";
import { TEXAS_BOUNDARY_SOURCE, TEXAS_PATH } from "./texasOutline";
import { nodeLabels } from "./texasLabels";
import "./texas-map.css";

interface Props {
  data: Bootstrap;
  onOpenEntity: (id: string) => void;
}
const typeColor = (entity: Entity) =>
  /Cyber|PhysicalOT|PhysicalIT/.test(entity.type)
    ? "#c4a5fd"
    : /WaterServiceProvider|TreatmentPlant/.test(entity.type)
      ? "#63caff"
      : /Electric/.test(entity.type)
        ? "#ffc568"
        : /ServiceArea|Organization|Population/.test(entity.type)
          ? "#91a8bd"
          : "#63dfbb";
const edgeColor = (edge: MapEdge) =>
  edge.kind === "dependency"
    ? "#f5bc64"
    : edge.kind === "spatial"
      ? "#91a8bd"
      : "#75aaf2";

export default function TexasInfrastructureMap({ data, onOpenEntity }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [areaId, setAreaId] = useState("all");
  const [query, setQuery] = useState("");
  const [focusOnly, setFocusOnly] = useState(false);
  const [structural, setStructural] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 480, y: 360 });
  const drag = useRef<{
    x: number;
    y: number;
    cx: number;
    cy: number;
    scale: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const uid = useId().replace(/:/g, "");
  const entities = useMemo(
    () => new Map(data.entities.map((entity) => [entity.id, entity])),
    [data.entities],
  );
  const edges = useMemo(() => graphEdges(data), [data]);
  const positions = useMemo(() => mapPositions(data.entities), [data.entities]);
  const baseIds = useMemo(() => new Set(infrastructureIds(data)), [data]);
  const areas = data.entities.filter((entity) => entity.type === "ServiceArea");
  const selected = selectedId ? entities.get(selectedId) : undefined;
  const connections = selected ? connectedEdges(edges, selected.id) : [];
  const neighbors = new Set(
    connections.flatMap((edge) => [edge.source, edge.target]),
  );
  if (selected) neighbors.add(selected.id);
  const belongsToArea = (
    entity: Entity,
    area: string,
    seen = new Set<string>(),
  ): boolean => {
    if (seen.has(entity.id)) return false;
    seen.add(entity.id);
    if (
      entity.id === area ||
      entity.locatedIn === area ||
      entity.serves === area ||
      (Array.isArray(entity.serves) && entity.serves.includes(area))
    )
      return true;
    return [entity.partOf, entity.hostedBy].some(
      (id) =>
        id && entities.has(id) && belongsToArea(entities.get(id)!, area, seen),
    );
  };
  const matches = data.entities.filter(
    (entity) =>
      (areaId === "all" || belongsToArea(entity, areaId)) &&
      `${displayText(entity.label)} ${entity.id} ${humanize(entity.type.replace(/([a-z0-9])([A-Z])/g, "$1 $2"))}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const visibleIds = new Set(
    matches
      .filter((entity) => query.trim() || baseIds.has(entity.id))
      .map((entity) => entity.id),
  );
  // A selected relationship may cross an area boundary; retain both real endpoints.
  if (selected) for (const id of neighbors) visibleIds.add(id);
  const visible = data.entities.filter(
    (entity) =>
      visibleIds.has(entity.id) &&
      (!focusOnly || !selected || neighbors.has(entity.id)),
  );
  const drawnIds = new Set(visible.map((entity) => entity.id));
  const labelBounds = {
    minX: center.x - 480 / zoom,
    maxX: center.x + 480 / zoom,
    minY: center.y - 360 / zoom,
    maxY: center.y + 360 / zoom,
  };
  const labels = nodeLabels(
    visible.flatMap((entity) => {
      const point = positions.get(entity.id);
      return point &&
        point.x >= labelBounds.minX &&
        point.x <= labelBounds.maxX &&
        point.y >= labelBounds.minY &&
        point.y <= labelBounds.maxY
        ? [
            {
              id: entity.id,
              x: point.x,
              y: point.y,
              label: displayText(entity.label).replace(
                / Operating Organization$/,
                " operator",
              ),
            },
          ]
        : [];
    }),
    selected?.id,
    labelBounds,
  );
  const drawnEdges = edges.filter(
    (edge) =>
      drawnIds.has(edge.source) &&
      drawnIds.has(edge.target) &&
      (edge.kind === "dependency" || structural),
  );
  const name = (id: string) => displayText(entities.get(id)?.label ?? id);
  const choose = (id: string) => {
    setSelectedId(id);
    setQuery("");
    const entity = entities.get(id);
    if (entity && areaId !== "all" && !belongsToArea(entity, areaId))
      setAreaId("all");
    const compact = window.matchMedia("(max-width: 800px)").matches;
    if (compact) setZoom(2);
    if (zoom > 1 || compact) {
      const point = positions.get(id);
      if (point) setCenter({ x: point.x, y: point.y });
    }
  };
  const reset = () => {
    setZoom(1);
    setCenter({ x: 480, y: 360 });
  };
  const changeZoom = (next: number) => {
    const value = Math.max(1, Math.min(3, next));
    setZoom(value);
    if (value === 1) setCenter({ x: 480, y: 360 });
    else if (selected) {
      const point = positions.get(selected.id);
      if (point) setCenter({ x: point.x, y: point.y });
    }
  };
  const width = 960 / zoom,
    height = 720 / zoom;
  const relationRows = (rows: MapEdge[], outgoing: boolean) =>
    rows.map((edge) => {
      const otherId = outgoing ? edge.target : edge.source;
      const dependency = edge.dependency;
      const functionLabel = dependency
        ? data.serviceFunctions.find(
            (item) => item.id === dependency.dependentFunction,
          )?.label
        : undefined;
      return (
        <li
          key={edge.id}
          data-connection-id={edge.id}
          data-connection-kind={edge.kind}
        >
          <button className="texas-neighbor" onClick={() => choose(otherId)}>
            {outgoing ? (
              <ArrowUpRight size={17} />
            ) : (
              <ArrowDownLeft size={17} />
            )}
            <span>
              <strong>{name(otherId)}</strong>
              <small>{edge.label}</small>
            </span>
          </button>
          {dependency && (
            <div className="texas-edge-detail">
              {functionLabel && <span>{displayText(functionLabel)}</span>}
              <span>
                Propagation{" "}
                {windowLabel([
                  dependency.propagationDelayMinHours,
                  dependency.propagationDelayMaxHours,
                ])}{" "}
                · scenario-relative
              </span>
              <span>
                {dependency.usableBackupMinHours === null ||
                dependency.usableBackupMaxHours === null
                  ? "Usable backup not established"
                  : `Usable backup ${windowLabel([dependency.usableBackupMinHours, dependency.usableBackupMaxHours])}`}
              </span>
            </div>
          )}
          <small className="texas-source">
            {edge.sourceRefs.length
              ? `Evidence: ${edge.sourceRefs.join(", ")}`
              : "Source references unavailable"}
          </small>
        </li>
      );
    });

  return (
    <section
      className="command-panel texas-panel"
      aria-label="Texas infrastructure relationship map"
    >
      <div className="command-panel-heading texas-heading">
        <div>
          <h2>
            <MapPin size={19} /> Texas infrastructure network
          </h2>
          <p>
            Explore the service chain. Select an entity to follow its
            connections.
          </p>
        </div>
        <span className="texas-count">
          <Network size={15} />
          {visible.length} entities · {drawnEdges.length} connections
        </span>
      </div>
      <div className="texas-toolbar">
        <label className="texas-search">
          <Search size={17} />
          <input
            aria-label="Find infrastructure entity"
            placeholder="Find a facility, utility or asset…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedId(null);
            }}
          />
          {query && (
            <button
              aria-label="Clear entity search"
              onClick={() => setQuery("")}
            >
              <X size={16} />
            </button>
          )}
        </label>
        <label className="texas-filter">
          <span>Service area</span>
          <select
            aria-label="Service area filter"
            value={areaId}
            onChange={(event) => {
              setAreaId(event.target.value);
              setSelectedId(null);
              setQuery("");
            }}
          >
            <option value="all">All service areas</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {displayText(area.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="texas-filter">
          <span>Entity</span>
          <select
            aria-label="Map entity"
            value={selected?.id ?? ""}
            onChange={(event) =>
              event.target.value
                ? choose(event.target.value)
                : setSelectedId(null)
            }
          >
            <option value="">Select an entity…</option>
            {matches.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {displayText(entity.label)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="texas-workspace">
        <div className="texas-map-wrap">
          <div className="texas-map-actions" aria-label="Map view controls">
            <button
              aria-label="Zoom in map"
              disabled={zoom >= 3}
              onClick={() => changeZoom(zoom + 0.5)}
            >
              <Plus size={18} />
            </button>
            <button
              aria-label="Zoom out map"
              disabled={zoom <= 1}
              onClick={() => changeZoom(zoom - 0.5)}
            >
              <Minus size={18} />
            </button>
            <button aria-label="Reset map view" onClick={reset}>
              <Crosshair size={18} />
            </button>
          </div>
          <svg
            className="texas-map"
            viewBox={`${center.x - width / 2} ${center.y - height / 2} ${width} ${height}`}
            aria-label="Texas map with directed infrastructure relationships"
            onPointerDown={(event) => {
              if (
                zoom <= 1 ||
                (event.target as Element).closest("[data-node-id]")
              )
                return;
              const box = event.currentTarget.getBoundingClientRect();
              drag.current = {
                x: event.clientX,
                y: event.clientY,
                cx: center.x,
                cy: center.y,
                scale: width / box.width,
                moved: false,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start) return;
              const dx = event.clientX - start.x,
                dy = event.clientY - start.y;
              if (Math.abs(dx) + Math.abs(dy) > 6) start.moved = true;
              if (start.moved)
                setCenter({
                  x: Math.max(80, Math.min(880, start.cx - dx * start.scale)),
                  y: Math.max(60, Math.min(660, start.cy - dy * start.scale)),
                });
            }}
            onPointerUp={(event) => {
              suppressClick.current = !!drag.current?.moved;
              drag.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
              suppressClick.current = false;
            }}
          >
            <defs>
              <pattern
                id={`${uid}-grid`}
                width="60"
                height="60"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M60 0H0V60"
                  fill="none"
                  stroke="#23394e"
                  strokeWidth=".65"
                />
              </pattern>
              <linearGradient id={`${uid}-land`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#203d51" />
                <stop offset="1" stopColor="#102c3c" />
              </linearGradient>
              {(["dependency", "structural", "spatial"] as const).map(
                (kind) => (
                  <marker
                    key={kind}
                    id={`${uid}-${kind}`}
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path
                      d="M0 0L8 4L0 8Z"
                      fill={edgeColor({ kind } as MapEdge)}
                    />
                  </marker>
                ),
              )}
            </defs>
            <rect
              x="-1000"
              y="-1000"
              width="3000"
              height="3000"
              fill="#0b1827"
            />
            <rect
              x="0"
              y="0"
              width="960"
              height="720"
              fill={`url(#${uid}-grid)`}
            />
            <path
              data-texas-outline="true"
              d={TEXAS_PATH}
              fill={`url(#${uid}-land)`}
              stroke="#50758b"
              strokeWidth="2"
            />
            <text
              className="texas-state-label"
              x="480"
              y="145"
              textAnchor="middle"
            >
              T E X A S
            </text>
            <text
              className="texas-coast-label"
              x="760"
              y="615"
              transform="rotate(-32 760 615)"
            >
              GULF COAST
            </text>
            {drawnEdges.map((edge) => {
              const from = positions.get(edge.source),
                to = positions.get(edge.target);
              if (!from || !to) return null;
              const dx = to.x - from.x,
                dy = to.y - from.y,
                length = Math.hypot(dx, dy) || 1;
              const start = {
                x: from.x + (dx / length) * 20,
                y: from.y + (dy / length) * 20,
              };
              const end = {
                x: to.x - (dx / length) * 23,
                y: to.y - (dy / length) * 23,
              };
              const bend = edge.kind === "dependency" ? 22 : -18;
              const mx = (start.x + end.x) / 2 - (dy / length) * bend,
                my = (start.y + end.y) / 2 + (dx / length) * bend;
              const isRelated =
                !selected ||
                edge.source === selected.id ||
                edge.target === selected.id;
              return (
                <g
                  key={edge.id}
                  className={`texas-edge ${isRelated ? "is-connected" : "is-dim"}`}
                  data-edge-id={edge.id}
                  data-edge-source={edge.source}
                  data-edge-target={edge.target}
                  data-edge-kind={edge.kind}
                >
                  <path
                    d={`M${start.x},${start.y} Q${mx},${my} ${end.x},${end.y}`}
                    fill="none"
                    stroke={edgeColor(edge)}
                    strokeWidth={selected && isRelated ? 3.6 : 2.2}
                    strokeDasharray={
                      edge.kind === "dependency" ? undefined : "7 5"
                    }
                    markerEnd={`url(#${uid}-${edge.kind})`}
                  />
                  <title>
                    {name(edge.source)} → {name(edge.target)}: {edge.label}
                  </title>
                  {selected && isRelated && edge.kind === "dependency" && (
                    <g className="texas-edge-label">
                      <rect
                        x={mx - 60}
                        y={my - 12}
                        width="120"
                        height="24"
                        rx="6"
                      />
                      <text x={mx} y={my + 4} textAnchor="middle">
                        {humanize(
                          edge.dependency?.requiredService ?? edge.label,
                        )}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
            {visible.map((entity) => {
              const point = positions.get(entity.id);
              if (!point) return null;
              const isSelected = entity.id === selected?.id,
                isRelated = !selected || neighbors.has(entity.id);
              return (
                <g
                  key={entity.id}
                  data-node-id={entity.id}
                  className={`texas-node ${isSelected ? "is-selected" : ""} ${isRelated ? "" : "is-dim"}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Show connections for ${displayText(entity.label)}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    choose(entity.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choose(entity.id);
                    }
                  }}
                >
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="26"
                    fill="transparent"
                    className="texas-node-target"
                  />
                  {isSelected && (
                    <circle
                      className="texas-node-halo"
                      cx={point.x}
                      cy={point.y}
                      r="25"
                      fill="none"
                      stroke={typeColor(entity)}
                      strokeWidth="2"
                    />
                  )}
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={isSelected ? 14 : 11}
                    fill={typeColor(entity)}
                    stroke="#e7f4fc"
                    strokeWidth="2"
                  />
                  <rect
                    x={
                      (labels.get(entity.id)?.x ?? point.x) -
                      (labels.get(entity.id)?.width ?? 100) / 2
                    }
                    y={(labels.get(entity.id)?.y ?? point.y + 33) - 12}
                    width={labels.get(entity.id)?.width ?? 100}
                    height="25"
                    fill="transparent"
                    style={{
                      display: labels.has(entity.id) ? undefined : "none",
                    }}
                  />
                  <text
                    style={{
                      display: labels.has(entity.id) ? undefined : "none",
                    }}
                    className="texas-node-label"
                    x={labels.get(entity.id)?.x ?? point.x}
                    y={(labels.get(entity.id)?.y ?? point.y + 33) + 6}
                    textAnchor="middle"
                  >
                    {labels.get(entity.id)?.text ?? displayText(entity.label)}
                  </text>
                  <title>
                    {displayText(entity.label)} ·{" "}
                    {humanize(
                      entity.type.replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
                    )}{" "}
                    ·{" "}
                    {point.placement === "illustrative"
                      ? "Illustrative placement, not a verified address"
                      : "Source coordinates"}
                  </title>
                </g>
              );
            })}
          </svg>
          {!visible.length && (
            <div className="texas-no-match">
              No matching entities. Try another name or clear the filter.
            </div>
          )}
          <div className="texas-legend">
            <span>
              <i className="service" />
              Service dependency →
            </span>
            <span>
              <i className="structure" />
              {selected
                ? "Ownership / hosting / location"
                : "Structure / ownership"}
            </span>
            <span>
              <i className="facility" />
              Facility
            </span>
            <span>
              <i className="utility" />
              Water infrastructure
            </span>
          </div>
          <div className="texas-layer-controls">
            <label>
              <input
                type="checkbox"
                checked={structural}
                onChange={(event) => setStructural(event.target.checked)}
              />
              Context links
            </label>
            <label>
              <input
                type="checkbox"
                checked={focusOnly}
                disabled={!selected}
                onChange={(event) => setFocusOnly(event.target.checked)}
              />
              Selected neighborhood only
            </label>
            {selected && (
              <button
                className="command-link"
                onClick={() => {
                  setSelectedId(null);
                  setFocusOnly(false);
                  reset();
                }}
              >
                Clear selection
              </button>
            )}
          </div>
        </div>
        <aside
          className="texas-inspector"
          aria-label="Entity connections"
          aria-live="polite"
        >
          {selected ? (
            <>
              <div className="texas-inspector-title">
                <span className="texas-eyebrow">SELECTED ENTITY</span>
                <h3>{name(selected.id)}</h3>
                <p>
                  {humanize(
                    selected.type.replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
                  )}
                </p>
                <code>{selected.id}</code>
              </div>
              <div className="texas-inspector-stats">
                <span>
                  <strong>
                    {
                      new Set(
                        connections.map((edge) =>
                          edge.source === selected.id
                            ? edge.target
                            : edge.source,
                        ),
                      ).size
                    }
                  </strong>
                  Connected entities
                </span>
                <span>
                  <strong>
                    {
                      connections.filter((edge) => edge.kind === "dependency")
                        .length
                    }
                  </strong>
                  Service links
                </span>
              </div>
              <div className="texas-connections-scroll">
                <h4>
                  Outgoing connections{" "}
                  <span>
                    {
                      connections.filter((edge) => edge.source === selected.id)
                        .length
                    }
                  </span>
                </h4>
                <ul className="texas-connection-list">
                  {relationRows(
                    connections.filter((edge) => edge.source === selected.id),
                    true,
                  )}
                </ul>
                {!connections.some((edge) => edge.source === selected.id) && (
                  <p className="texas-quiet">
                    No recorded outgoing connections.
                  </p>
                )}
                <h4>
                  Incoming connections{" "}
                  <span>
                    {
                      connections.filter((edge) => edge.target === selected.id)
                        .length
                    }
                  </span>
                </h4>
                <ul className="texas-connection-list">
                  {relationRows(
                    connections.filter((edge) => edge.target === selected.id),
                    false,
                  )}
                </ul>
                {!connections.some((edge) => edge.target === selected.id) && (
                  <p className="texas-quiet">
                    No recorded incoming connections.
                  </p>
                )}
                <p className="texas-quiet">
                  Only explicit model links are shown. Proximity does not
                  establish a dependency.
                </p>
              </div>
              <button
                className="secondary texas-record-button"
                onClick={() => onOpenEntity(selected.id)}
              >
                <ExternalLink size={15} />
                Open entity in expert graph
              </button>
            </>
          ) : (
            <div className="texas-inspector-empty">
              <Network size={34} />
              <h3>Follow the connections</h3>
              <p>
                Select a map node or search for an entity. See who supplies it,
                what it supports, and its linked infrastructure.
              </p>
              <button
                className="secondary"
                onClick={() =>
                  choose(
                    data.entities.find(
                      (entity) => entity.type === "WaterServiceProvider",
                    )?.id ??
                      data.entities[0]?.id ??
                      "",
                  )
                }
              >
                Explore Utility A
              </button>
              <div className="texas-example-chain">
                <span>Electric supply</span>
                <span>↓</span>
                <span>Treatment plant</span>
                <span>↓</span>
                <span>Water provider</span>
                <span>↓</span>
                <span>Healthcare & essential services</span>
              </div>
            </div>
          )}
        </aside>
      </div>
      <p className="texas-provenance">
        Texas boundary backdrop · reference infrastructure placement is
        illustrative, not verified facility geography.{" "}
        <a href={TEXAS_BOUNDARY_SOURCE} target="_blank" rel="noreferrer">
          Boundary source
        </a>
      </p>
    </section>
  );
}
