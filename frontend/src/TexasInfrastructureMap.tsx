import { useEffect, useId, useMemo, useRef } from "react";
import type { MapViewState, RelationshipDirection } from "./mapViewState";
import { IdtChip } from "./IdtChip";
import type { IdtIndex } from "./idt";
import {
  relationshipStory,
  serviceConnections,
  serviceNeighborhood,
} from "./relationshipStory";
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
import type { CommandIncident } from "./commandTypes";
import { utilityMapStatus, peopleServed } from "./whoActsFirst";
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
import { containedTexasAnchor, texasContainsMarker } from "./texasMapLayout";
import { InfrastructureIcon } from "./InfrastructureIcon";
import { infrastructureKind, infrastructureLabel } from "./infrastructureIcons";
import "./infrastructure-map.css";
import "./texas-map.css";

/** Separate visual glyphs only; edges and captured positions stay anchored. */
export function infrastructureSymbolPositions(
  source: ReadonlyMap<string, { x: number; y: number }>,
) {
  const points = [...source].sort(([a], [b]) => a.localeCompare(b))
    .map(([id, p]) => ({ id, x: p.x, y: p.y }));
  // 19px core radius × maximum 1.8 responsive scale, plus a clear gap.
  const separation = 76;
  for (let pass = 0; pass < 64; pass++) {
    let adjusted = false;
    for (const p of points) {
      if (!texasContainsMarker(p, 1000, 700, 72)) {
        const safe = containedTexasAnchor({ x: p.x / 10, y: p.y / 7 }, 1000, 700, 72);
        p.x = safe.x; p.y = safe.y;
        adjusted = true;
      }
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= separation) continue;
        const ux = distance ? dx / distance : 1;
        const uy = distance ? dy / distance : 0;
        const shift = (separation - distance) / 2 + 0.01;
        a.x -= ux * shift; a.y -= uy * shift;
        b.x += ux * shift; b.y += uy * shift;
        adjusted = true;
      }
    }
    if (!adjusted) break;
  }
  return new Map(points.map(({ id, x, y }) => [id, { x, y }]));
}

interface Props {
  idtIndex?: IdtIndex | null;
  data: Bootstrap;
  onOpenEntity: (id: string) => void;
  incidents?: CommandIncident[];
  onOpenEntityProfile?: (id: string) => void;
  selectedId: string | null;
  onSelectEntity: (id: string | null) => void;
  mapState: MapViewState;
  onMapStateChange: (state: MapViewState) => void;
}
const edgeColor = (edge: MapEdge) =>
  edge.kind === "dependency"
    ? "#f5bc64"
    : edge.kind === "spatial"
      ? "#91a8bd"
      : "#75aaf2";

export default function TexasInfrastructureMap({
  idtIndex = null,
  data,
  onOpenEntity,
  incidents = [],
  onOpenEntityProfile,
  selectedId,
  onSelectEntity,
  mapState,
  onMapStateChange,
}: Props) {
  const { areaId, query, focusOnly, structural, zoom, center, direction } =
    mapState;
  const updateView = (patch: Partial<MapViewState>) =>
    onMapStateChange({ ...mapState, ...patch });
  const connectionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    connectionsRef.current?.scrollTo({ top: 0 });
  }, [selectedId, direction]);
  const mapRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Compensate for a narrow SVG viewport without changing graph positions,
    // labels, pan coordinates or the user's zoom. Bound enlargement in dense
    // neighborhoods; selecting a mobile node still uses the existing 2× zoom.
    const resizeMarkers = () => {
      const box = map.getBoundingClientRect();
      const scale = Math.min(box.width / 960, box.height / 720) * zoom;
      if (scale <= 0) return;
      map.style.setProperty(
        "--texas-marker-scale",
        String(Math.max(1, Math.min(1.8, 18 / (26 * scale)))),
      );
    };
    resizeMarkers();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resizeMarkers);
    observer.observe(map);
    return () => observer.disconnect();
  }, [zoom]);
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
  const story = selected
    ? relationshipStory(
        edges,
        selected.id,
        data.entities,
        data.serviceFunctions,
      )
    : undefined;
  const directional = !!selected && direction !== "all";
  const serviceEdges = selected
    ? serviceConnections(edges, selected.id, direction)
    : [];
  const activeConnections = directional
    ? serviceEdges
    : connections.filter((edge) => edge.kind === "dependency" || structural);
  const neighbors = new Set(
    activeConnections.flatMap((edge) => [edge.source, edge.target]),
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
      (!(focusOnly || directional) || !selected || neighbors.has(entity.id)),
  );
  const drawnIds = new Set(visible.map((entity) => entity.id));
  const symbols = infrastructureSymbolPositions(new Map(visible.flatMap(entity => {
    const position = positions.get(entity.id);
    return position ? [[entity.id, position] as const] : [];
  })));
  const visibleKinds = [
    ...new Set(
      visible
        .filter((entity) => positions.has(entity.id))
        .map(infrastructureKind),
    ),
  ].sort((a, b) =>
    infrastructureLabel(a).localeCompare(infrastructureLabel(b)),
  );
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
      (directional
        ? serviceEdges.includes(edge)
        : edge.kind === "dependency" || structural),
  );
  const name = (id: string) => displayText(entities.get(id)?.label ?? id);
  const openProfile = onOpenEntityProfile ?? onOpenEntity;
  const statuses = new Map(
    data.entities
      .filter((e) => e.type === "WaterServiceProvider")
      .map((e) => [e.id, utilityMapStatus(e.id, data, incidents)]),
  );
  const statusChip = (id: string) => {
    const status = statuses.get(id);
    return status?.label ? (
      <span className={`texas-status ${status.status}`}>{status.label}</span>
    ) : null;
  };
  const profileLink = (entity: Entity) => (
    <button
      key={entity.id}
      className="command-link"
      data-entity-profile={entity.id}
      onClick={() => openProfile(entity.id)}
    >
      {name(entity.id)}
    </button>
  );
  const choose = (id: string) => {
    if (!entities.has(id)) return;
    onSelectEntity(id);
    const entity = entities.get(id);
    const compact = window.matchMedia("(max-width: 800px)").matches;
    const point = positions.get(id);
    updateView({
      query: "",
      areaId:
        entity && areaId !== "all" && !belongsToArea(entity, areaId)
          ? "all"
          : areaId,
      zoom: compact ? 2 : zoom,
      center:
        point && (zoom > 1 || compact) ? { x: point.x, y: point.y } : center,
    });
  };
  const reset = () => {
    updateView({ zoom: 1, center: { x: 480, y: 360 } });
  };
  const changeZoom = (next: number) => {
    const value = Math.max(1, Math.min(3, next));
    const point = selected ? positions.get(selected.id) : undefined;
    updateView({
      zoom: value,
      center:
        value === 1
          ? { x: 480, y: 360 }
          : point
            ? { x: point.x, y: point.y }
            : center,
    });
  };
  const showDirection = (next: RelationshipDirection) => {
    // Fit actual direct counterparts, rather than hiding them outside a retained zoom.
    const ids = selected
      ? serviceNeighborhood(edges, selected.id, next)
      : new Set<string>();
    const points = [...ids].flatMap((id) =>
      positions.has(id) ? [positions.get(id)!] : [],
    );
    if (!points.length) {
      updateView({ direction: next });
      return;
    }
    const xs = points.map((point) => point.x),
      ys = points.map((point) => point.y);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const fittedZoom = Math.max(
      1,
      Math.min(3, 960 / (maxX - minX + 240), 720 / (maxY - minY + 200)),
    );
    updateView({
      direction: next,
      zoom: fittedZoom,
      center:
        fittedZoom === 1
          ? { x: 480, y: 360 }
          : { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    });
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
              <code>{dependency.id}</code>
              <span>
                Service function:{" "}
                {displayText(functionLabel ?? dependency.dependentFunction)}
              </span>
              <span>
                Applies to recorded loss types:{" "}
                {dependency.lossTypes.map(humanize).join(", ") ||
                  "not established"}
              </span>
              <span>
                If supply is lost: modeled propagation{" "}
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
              <span>
                Modeled impact if supply is lost:{" "}
                {dependency.outputLossType
                  ? humanize(dependency.outputLossType)
                  : "output loss type not established"}
                . Not a current outage.
              </span>
              {dependency.validForLossTypes.length > 0 && (
                <span>
                  Backup applies to:{" "}
                  {dependency.validForLossTypes.map(humanize).join(", ")}
                </span>
              )}
              {dependency.assumptionNote && (
                <span>
                  Assumption: {displayText(dependency.assumptionNote)}
                </span>
              )}
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

  function serviceSection(side: "suppliers" | "dependents") {
    const outbound = side === "dependents";
    const rows = story?.[side] ?? [];
    const ids = outbound ? story?.dependentIds : story?.supplierIds;
    return (
      <section key={side} className="texas-service-section">
        <h4>
          {outbound ? "What depends on this" : "What supplies this"}{" "}
          <span>{ids?.length ?? 0}</span>
        </h4>
        <ul className="texas-connection-list">
          {outbound
            ? story?.dependentRows.map((row) => (
                <li key={row.entityId}>
                  <button
                    className="texas-neighbor"
                    onClick={() => choose(row.entityId)}
                  >
                    {displayText(row.summary)}
                  </button>
                  <button
                    className="command-link"
                    onClick={() => openProfile(row.entityId)}
                  >
                    Open {name(row.entityId)} entity profile
                  </button>
                </li>
              ))
            : [...new Set(rows.map((edge) => edge.source))].map((id) => (
                <li key={id}>
                  <button className="texas-neighbor" onClick={() => choose(id)}>
                    <ArrowDownLeft size={17} />
                    <strong>{name(id)}</strong>
                  </button>
                  <button
                    className="command-link"
                    onClick={() => openProfile(id)}
                  >
                    Open {name(id)} entity profile
                  </button>
                </li>
              ))}
        </ul>
        {!rows.length && (
          <p className="texas-quiet">
            {outbound
              ? "No directly supported entities recorded."
              : "No direct suppliers recorded."}
          </p>
        )}
      </section>
    );
  }

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
              updateView({ query: event.target.value });
              onSelectEntity(null);
            }}
          />
          {query && (
            <button
              aria-label="Clear entity search"
              onClick={() => {
                updateView({ query: "" });
                onSelectEntity(null);
              }}
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
              updateView({ areaId: event.target.value, query: "" });
              onSelectEntity(null);
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
                : onSelectEntity(null)
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
      <div
        className="texas-direction-controls"
        role="group"
        aria-label="Explore direct service connections"
      >
        {(
          [
            ["suppliers", "What supplies this?"],
            ["dependents", "What depends on this?"],
            ["all", "All service connections"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            disabled={!selected}
            aria-pressed={direction === value}
            onClick={() => showDirection(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="texas-workspace" data-relationship-direction={direction}>
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
            ref={mapRef}
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
                updateView({
                  center: {
                    x: Math.max(80, Math.min(880, start.cx - dx * start.scale)),
                    y: Math.max(60, Math.min(660, start.cy - dy * start.scale)),
                  },
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
            <clipPath id={`${uid}-icon-leaders`}><path d={TEXAS_PATH} /></clipPath>
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
                    {`${name(edge.source)} → ${name(edge.target)}: ${edge.label}`}
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
              const kind = infrastructureKind(entity);
              const symbol = symbols.get(entity.id) ?? point;
              const shifted = Math.hypot(symbol.x - point.x, symbol.y - point.y) > 0.5;
              return (
                <g
                  key={entity.id}
                  data-node-id={entity.id}
                  data-infrastructure-kind={kind}
                  data-utility-status={statuses.get(entity.id)?.status}
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
                  {shifted && <g clipPath={`url(#${uid}-icon-leaders)`}>
                    <line x1={point.x} y1={point.y} x2={symbol.x} y2={symbol.y} className="texas-icon-leader" />
                    <circle cx={point.x} cy={point.y} r="2" className="texas-icon-anchor" />
                  </g>}
                  <g transform={`translate(${symbol.x} ${symbol.y})`}>
                    <g className="texas-node-symbol">
                      {isSelected && (
                        <circle
                          className="texas-node-halo"
                          r="24"
                          fill="none"
                          strokeWidth="2"
                        />
                      )}
                      <circle r="19" className="texas-node-core" />
                      <g transform="translate(-13 -13)">
                        <InfrastructureIcon kind={kind} size={26} />
                      </g>
                    </g>
                  </g>
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
                  {statuses.get(entity.id)?.label && (
                    <text
                      className={`texas-node-status ${statuses.get(entity.id)?.status}`}
                      x={point.x}
                      y={(labels.get(entity.id)?.y ?? point.y + 33) + 23}
                      textAnchor="middle"
                    >
                      {statuses.get(entity.id)?.label}
                    </text>
                  )}
                  <title>
                    {`${displayText(entity.label)} · ${humanize(entity.type.replace(/([a-z0-9])([A-Z])/g, "$1 $2"))} · ${point.placement === "illustrative" ? "Illustrative placement, not a verified address" : "Source coordinates"}${statuses.get(entity.id)?.label ? ` · ${statuses.get(entity.id)?.label}` : ""}`}
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
          <div
            className="texas-legend texas-infrastructure-legend"
            role="group"
            aria-label="Visible infrastructure types"
          >
            {visibleKinds.map((kind) => (
              <span key={kind} data-infrastructure-kind={kind}>
                <span className="texas-legend-marker">
                  <InfrastructureIcon kind={kind} size={20} />
                </span>
                {infrastructureLabel(kind)}
              </span>
            ))}
            {!visibleKinds.length && (
              <span>No infrastructure types visible</span>
            )}
          </div>
          <div
            className="texas-legend"
            role="group"
            aria-label="Relationship and status legend"
          >
            <span>
              <i className="under-attack" />
              Under attack · open/monitoring case + effect or suspected
              compromise
            </span>
            <span>
              <i className="probed" />
              Probed · probing only, not compromise
            </span>
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
          </div>
          <div className="texas-layer-controls">
            {directional && (
              <p className="texas-quiet">
                Direct service connections only. Choose All service connections
                to show optional context links.
              </p>
            )}
            <label>
              <input
                type="checkbox"
                checked={structural}
                aria-label="Context links"
                onChange={(event) =>
                  updateView({ structural: event.target.checked })
                }
              />
              Show ownership &amp; cyber links
            </label>
            <label>
              <input
                type="checkbox"
                checked={focusOnly || directional}
                disabled={!selected || directional}
                onChange={(event) =>
                  updateView({ focusOnly: event.target.checked })
                }
              />
              Selected neighborhood only
            </label>
            {selected && (
              <button
                className="command-link"
                onClick={() => {
                  onSelectEntity(null);
                  updateView({
                    focusOnly: false,
                    direction: "all",
                    zoom: 1,
                    center: { x: 480, y: 360 },
                  });
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
                {statusChip(selected.id)}
                <p>
                  {humanize(
                    selected.type.replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
                  )}
                </p>
                <IdtChip entity={selected} index={idtIndex} />
                <code>{selected.id}</code>
              </div>
              <div className="texas-connections-scroll" ref={connectionsRef}>
                <p
                  className="texas-relationship-story"
                  data-relationship-summary
                >
                  {displayText(story?.summary ?? "")}
                </p>
                <details className="texas-context-details">
                  <summary>Advanced · IDs and raw links</summary>
                  <p>{displayText(story?.advancedSummary ?? "")}</p>
                  <code>{selected.id}</code>
                  <div className="texas-inspector-stats">
                    <span>
                      <strong>{story?.supplierIds.length ?? 0}</strong>Direct
                      suppliers
                    </span>
                    <span>
                      <strong>{story?.dependentIds.length ?? 0}</strong>
                      Supported entities
                    </span>
                  </div>
                  <ul className="texas-connection-list">
                    {relationRows(story?.suppliers ?? [], false)}
                    {relationRows(story?.dependents ?? [], true)}
                  </ul>
                </details>
                {(direction === "dependents"
                  ? (["dependents", "suppliers"] as const)
                  : (["suppliers", "dependents"] as const)
                ).map(serviceSection)}
                <details className="texas-context-details">
                  <summary>
                    Ownership, hosting &amp; location (
                    {story?.context.length ?? 0} links)
                  </summary>
                  <p className="texas-quiet">
                    Context only, not service dependencies. Select a linked
                    entity to explore its own records.
                  </p>
                  <ul className="texas-connection-list">
                    {relationRows(
                      (story?.context ?? []).filter(
                        (edge) => edge.source === selected.id,
                      ),
                      true,
                    )}
                    {relationRows(
                      (story?.context ?? []).filter(
                        (edge) => edge.target === selected.id,
                      ),
                      false,
                    )}
                  </ul>
                  {!story?.context.length && (
                    <p className="texas-quiet">No context links recorded.</p>
                  )}
                </details>
              </div>
              <button
                className="secondary texas-record-button"
                onClick={() => openProfile(selected.id)}
              >
                <ExternalLink size={15} />
                Open entity profile
              </button>
            </>
          ) : (
            <div className="texas-inspector-empty">
              <Network size={34} />
              <h3>Follow the connections</h3>
              <p>
                Select a map node to see supplies, dependents and linked
                records.
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
      <section className="texas-service-areas" aria-label="Service areas">
        <h3>Service areas</h3>
        <div className="texas-area-grid">
          {areas.map((area) => {
            const providers = data.entities.filter(
              (entity) =>
                entity.type === "WaterServiceProvider" &&
                (entity.serves === area.id ||
                  (Array.isArray(entity.serves) &&
                    entity.serves.includes(area.id))),
            );
            const activeCases = incidents.filter(
              (incident) =>
                (incident.status === "open" ||
                  incident.status === "monitoring") &&
                (incident.contextSnapshot?.serviceArea?.id === area.id ||
                  providers.some(
                    (provider) =>
                      incident.contextSnapshot?.provider?.id === provider.id,
                  )),
            );
            const members = data.entities.filter(
              (entity) =>
                entity.id !== area.id &&
                !providers.includes(entity) &&
                belongsToArea(entity, area.id),
            );
            const groups = [
              [
                "Facilities",
                members.filter(
                  (entity) =>
                    !/Cyber|PhysicalOT|PhysicalIT|Population/.test(entity.type),
                ),
              ],
              [
                "Plant equipment",
                members.filter((entity) =>
                  /PhysicalOT|PhysicalIT/.test(entity.type),
                ),
              ],
              [
                "Cyber identities",
                members.filter((entity) => /Cyber/.test(entity.type)),
              ],
              [
                "Population records",
                members.filter((entity) => /Population/.test(entity.type)),
              ],
            ] as const;
            return (
              <section
                key={area.id}
                className="texas-area-card"
                data-service-area={area.id}
              >
                <h4>
                  {profileLink(area)}{" "}
                  <span>
                    {activeCases.length}{" "}
                    {activeCases.length === 1 ? "case" : "cases"}
                  </span>
                </h4>
                <div className="texas-area-records">
                  {providers.map((provider) => (
                    <div key={provider.id}>
                      {profileLink(provider)} {statusChip(provider.id)} ·{" "}
                      {peopleServed(provider.id, data)?.toLocaleString() ??
                        "Unknown"}{" "}
                      people
                    </div>
                  ))}
                </div>
                {groups.map(([label, records]) => (
                  <div key={label}>
                    <strong>
                      {label} ({records.length})
                    </strong>
                    <div className="texas-area-records">
                      {records.map(profileLink)}
                      {!records.length && <span>None recorded</span>}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </section>
      <p className="texas-provenance">
        Illustrative map ·{" "}
        <a href={TEXAS_BOUNDARY_SOURCE} target="_blank" rel="noreferrer">
          Boundary source
        </a>
      </p>
    </section>
  );
}
