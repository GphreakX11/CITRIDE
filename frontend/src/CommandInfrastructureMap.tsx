import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Building2,
  Droplets,
  Factory,
  Flame,
  HeartHandshake,
  HeartPulse,
  Hospital,
  Zap,
  Plus,
  Minus,
  Maximize2,
  Move,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  X,
} from "lucide-react";
import type { Bootstrap } from "./types.ts";
import type { CommandIncident } from "./commandTypes.ts";
import { commandInfrastructureModel } from "./commandInfrastructureModel.ts";
import { infrastructureSymbol } from "./infrastructureSymbols.ts";
import type { InfrastructureKind } from "./infrastructureSymbols.ts";
import {
  capturedClassification,
  planningWindow,
  timeLabel,
  words,
} from "./commandCenterModel.ts";
import { displayText } from "./presentation.ts";
import { nodeLabels } from "./texasLabels.ts";
import { TEXAS_PATH, TEXAS_BOUNDARY_SOURCE } from "./texasOutline.ts";
import "./command-infrastructure-map.css";
import type { IncidentStackModel } from "./incidentStack.ts";
import IncidentStackSchematic from "./IncidentStackSchematic.tsx";

const symbols = {
  water: Droplets,
  plant: Factory,
  hospital: Hospital,
  dialysis: HeartPulse,
  care: HeartHandshake,
  power: Zap,
  fire: Flame,
  facility: Building2,
};
const groups: { kind: InfrastructureKind; label: string }[] = [
  { kind: "water", label: "Water" },
  { kind: "hospital", label: "Healthcare" },
  { kind: "power", label: "Power" },
  { kind: "fire", label: "Emergency" },
];
const initialView = { zoom: 1, x: 480, y: 360 };
interface Props {
  data: Bootstrap;
  incidents: readonly CommandIncident[];
  selected: CommandIncident | null;
  selectedEntityId?: string | null;
  onSelectEntity?: (id: string | null) => void;
  onOpenEntity: (id: string, caseId?: string) => void;
  onSelectCase: (id: string) => void;
  stack?: IncidentStackModel;
  facilityQuery?: string;
}

/** Stack callers use C2 topology; all other callers retain the legacy explorer. */
export default function CommandInfrastructureMap(props: Props) {
  if (props.stack) return <IncidentStackSchematic model={props.stack} selectedEntityId={props.selectedEntityId ?? null} onSelectEntity={props.onSelectEntity ?? (() => {})} query={props.facilityQuery} />;
  return <LegacyCommandInfrastructureMap {...props} />;
}

/** Read-only exploration: all interaction is local view state or explicit navigation. */
function LegacyCommandInfrastructureMap({
  data,
  incidents,
  selected,
  selectedEntityId = null,
  onSelectEntity,
  onOpenEntity,
  onSelectCase,
}: Props) {
  const model = useMemo(
    () => commandInfrastructureModel(data, incidents, selected),
    [data, incidents, selected],
  );
  const [localId, setLocalId] = useState<string | null>(null);
  const [view, setView] = useState(initialView);
  const [filter, setFilter] = useState("all");
  const [size, setSize] = useState({ width: 720, height: 480 });
  const viewport = useRef<HTMLDivElement>(null);
  const index = useRef<HTMLDetailsElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    cx: number;
    cy: number;
    moved: boolean;
  } | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const activeId = onSelectEntity ? selectedEntityId : localId;
  const node = model.nodes.find((n) => n.entity.id === activeId) ?? null;
  const matches = (kind: InfrastructureKind) =>
    filter === "all" ||
    (filter === "water"
      ? ["water", "plant"].includes(kind)
      : filter === "hospital"
        ? ["hospital", "dialysis", "care"].includes(kind)
        : filter === kind);
  const visible = model.nodes.filter((n) =>
    matches(infrastructureSymbol(n.entity).kind),
  );
  const ids = new Set(visible.map((n) => n.entity.id));
  const width = 960 / view.zoom,
    height = 720 / view.zoom;
  const left = view.x - width / 2,
    top = view.y - height / 2;
  const scale = Math.min(size.width / width, size.height / height);
  const ox = (size.width - width * scale) / 2,
    oy = (size.height - height * scale) / 2;
  const screen = (id: string) => {
    const p = model.positions.get(id)!;
    return { x: (p.x - left) * scale + ox, y: (p.y - top) * scale + oy };
  };
  const labels = nodeLabels(
    visible.flatMap((n) => {
      const p = screen(n.entity.id);
      return p.x >= 0 && p.x <= size.width && p.y >= 0 && p.y <= size.height
        ? [{ id: n.entity.id, ...p, label: displayText(n.entity.label) }]
        : [];
    }),
    node?.entity.id,
    { minX: 0, minY: 0, maxX: size.width, maxY: size.height },
  );
  useEffect(() => {
    if (!viewport.current) return;
    const element = viewport.current;
    const resize = () =>
      setSize({
        width: element.clientWidth || 720,
        height: element.clientHeight || 480,
      });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const choose = (id: string | null, locate = false) => {
    setLocalId(id);
    onSelectEntity?.(id);
    if (index.current) index.current.open = false;
    if (id && locate) {
      const p = model.positions.get(id);
      if (p) setView({ x: p.x, y: p.y, zoom: Math.max(1.6, view.zoom) });
    }
  };
  const changeFilter = (next: string) => {
    setFilter(next);
    choose(null);
    setView(initialView);
  };
  const zoom = (delta: number) =>
    setView((current) => ({
      ...current,
      zoom: Math.max(1, Math.min(3, current.zoom + delta)),
    }));
  const pan = (x: number, y: number) =>
    setView((current) => ({
      ...current,
      x: Math.max(0, Math.min(960, current.x + x / current.zoom)),
      y: Math.max(0, Math.min(720, current.y + y / current.zoom)),
    }));
  const state = (n: (typeof model.nodes)[number]) =>
    n.impacts.length ? "modeled" : n.context ? "context" : "reference";
  const related = node
    ? incidents.filter((i) => node.caseIds.includes(i.id))
    : [];
  const connections = node
    ? model.edges.filter(
        (e) => e.source === node.entity.id || e.target === node.entity.id,
      )
    : [];
  const position = node ? model.positions.get(node.entity.id) : null;
  const Symbol = node ? symbols[infrastructureSymbol(node.entity).kind] : Move;
  return (
    <section
      className="infrastructure-explorer"
      data-infrastructure-map
      data-map-scope={selected?.id ?? "all"}
    >
      <div className="im-heading">
        <div>
          <span className="im-eyebrow">INFRASTRUCTURE EXPLORER</span>
          <p>{model.scopeLabel}</p>
        </div>
        <span className="im-count">
          {visible.length} of {model.nodes.length} facilities
        </span>
      </div>
      <div
        className="im-filters"
        role="group"
        aria-label="Infrastructure categories"
      >
        <button
          type="button"
          aria-pressed={filter === "all"}
          onClick={() => changeFilter("all")}
        >
          All infrastructure
        </button>
        {groups.map((g) => {
          const Icon = symbols[g.kind];
          return (
            <button
              type="button"
              key={g.kind}
              aria-pressed={filter === g.kind}
              onClick={() => changeFilter(g.kind)}
            >
              <Icon size={15} aria-hidden="true" />
              {g.label}
            </button>
          );
        })}
      </div>
      <div className="im-layout">
        <div>
          <div className="im-viewport" ref={viewport}>
            <svg
              className="im-map"
              viewBox={`${left} ${top} ${width} ${height}`}
              role="group"
              aria-label="Interactive infrastructure map"
              onPointerDown={(e) => {
                if (
                  e.button !== 0 ||
                  (e.target as Element).closest("[data-map-marker]")
                )
                  return;
                drag.current = {
                  id: e.pointerId,
                  x: e.clientX,
                  y: e.clientY,
                  cx: view.x,
                  cy: view.y,
                  moved: false,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.id !== e.pointerId) return;
                const dx = e.clientX - d.x,
                  dy = e.clientY - d.y;
                if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
                if (d.moved)
                  setView((current) => ({
                    ...current,
                    x: Math.max(0, Math.min(960, d.cx - dx / scale)),
                    y: Math.max(0, Math.min(720, d.cy - dy / scale)),
                  }));
              }}
              onPointerUp={(e) => {
                if (drag.current?.id === e.pointerId) drag.current = null;
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
            >
              <defs>
                <linearGradient id={`${uid}-land`} x1="0" y1="0" x2="1" y2="1">
                  <stop stopColor="#183b50" />
                  <stop offset="1" stopColor="#12263e" />
                </linearGradient>
                <marker
                  id={`${uid}-arrow`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M 0 1 L 9 5 L 0 9"
                    fill="none"
                    stroke="context-stroke"
                    strokeWidth="1.5"
                  />
                </marker>
              </defs>
              <path
                className="im-outline"
                d={TEXAS_PATH}
                fill={`url(#${uid}-land)`}
              />
              <g aria-hidden="true" className="im-connections">
                {model.edges
                  .filter((e) => ids.has(e.source) && ids.has(e.target))
                  .map((e) => {
                    const a = model.positions.get(e.source)!,
                      b = model.positions.get(e.target)!;
                    const dx = b.x - a.x,
                      dy = b.y - a.y,
                      length = Math.hypot(dx, dy);
                    if (!length) return null;
                    const trim = Math.min(24 / scale, length / 3);
                    return (
                      <line
                        key={e.id}
                        data-edge-source={e.source}
                        data-edge-target={e.target}
                        data-edge-captured={e.caseIds.length > 0}
                        x1={a.x + (dx / length) * trim}
                        y1={a.y + (dy / length) * trim}
                        x2={b.x - (dx / length) * trim}
                        y2={b.y - (dy / length) * trim}
                        className={`${e.modeled ? "modeled" : "reference"} ${node && (e.source === node.entity.id || e.target === node.entity.id) ? "focused" : ""}`}
                        markerEnd={`url(#${uid}-arrow)`}
                      >
                        <title>
                          {e.label} ·{" "}
                          {e.caseIds.length
                            ? "Captured dependency"
                            : "Reference dependency"}
                        </title>
                      </line>
                    );
                  })}
              </g>
              {visible.map((n) => {
                const p = model.positions.get(n.entity.id)!,
                  label = labels.get(n.entity.id),
                  descriptor = infrastructureSymbol(n.entity),
                  Icon = symbols[descriptor.kind];
                const selectedNode = node?.entity.id === n.entity.id;
                const inFrame =
                  screen(n.entity.id).x >= 0 &&
                  screen(n.entity.id).x <= size.width &&
                  screen(n.entity.id).y >= 0 &&
                  screen(n.entity.id).y <= size.height;
                return (
                  <g
                    key={n.entity.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Select ${displayText(n.entity.label)} · ${descriptor.label}`}
                    aria-pressed={selectedNode}
                    data-map-marker={n.entity.id}
                    data-icon-kind={descriptor.kind}
                    data-impact-count={n.impacts.length}
                    className={`im-marker ${state(n)} ${selectedNode ? "selected" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      choose(n.entity.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        choose(n.entity.id, !inFrame);
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        choose(null);
                      }
                    }}
                  >
                    <title>
                      {displayText(n.entity.label)} · {descriptor.label}
                      {n.impacts.length
                        ? " · Captured modeled consequence"
                        : " · No outage status asserted"}
                    </title>
                    {label && (
                      <line
                        className="im-label-leader"
                        aria-hidden="true"
                        x1={p.x}
                        y1={p.y}
                        x2={left + (label.x - ox) / scale}
                        y2={top + (label.y - oy) / scale}
                      />
                    )}
                    <g
                      transform={`translate(${p.x} ${p.y}) scale(${1 / scale})`}
                    >
                      <circle className="im-selection-ring" r="24" />
                      <circle className="im-hit-area" r="22" />
                      <circle className="im-icon-background" r="17" />
                      <Icon
                        x={-10}
                        y={-10}
                        width={20}
                        height={20}
                        strokeWidth={1.8}
                        aria-hidden="true"
                        className="im-facility-icon"
                      />
                      {descriptor.kind === "plant" && (
                        <g
                          transform="translate(11 10)"
                          className="im-plant-water"
                          aria-hidden="true"
                        >
                          <circle r="6" fill="#142840" />
                          <Droplets
                            x={-4}
                            y={-4}
                            width={8}
                            height={8}
                            strokeWidth={2}
                          />
                        </g>
                      )}
                    </g>
                    {label && (
                      <text
                        className={`im-label ${selectedNode ? "selected" : ""}`}
                        x={left + (label.x - ox) / scale}
                        y={top + (label.y - oy) / scale}
                        fontSize={12 / scale}
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {label.text}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            <div
              className="im-map-controls"
              role="group"
              aria-label="Map navigation"
            >
              <button
                type="button"
                aria-label="Zoom in infrastructure map"
                disabled={view.zoom >= 3}
                onClick={() => zoom(0.4)}
              >
                <Plus size={17} />
              </button>
              <button
                type="button"
                aria-label="Zoom out infrastructure map"
                disabled={view.zoom <= 1}
                onClick={() => zoom(-0.4)}
              >
                <Minus size={17} />
              </button>
              <button
                type="button"
                aria-label="Reset infrastructure map"
                onClick={() => setView(initialView)}
              >
                <Maximize2 size={17} />
              </button>
            </div>
            <div
              className="im-pan-controls"
              role="group"
              aria-label="Pan infrastructure map"
            >
              <button
                type="button"
                aria-label="Pan map left"
                onClick={() => pan(-120, 0)}
              >
                <ArrowLeft size={14} />
              </button>
              <button
                type="button"
                aria-label="Pan map up"
                onClick={() => pan(0, -120)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                aria-label="Pan map down"
                onClick={() => pan(0, 120)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                type="button"
                aria-label="Pan map right"
                onClick={() => pan(120, 0)}
              >
                <ArrowRight size={14} />
              </button>
            </div>
            {!visible.length && (
              <div className="im-map-empty">
                No facilities in this category.
              </div>
            )}
          </div>
          {node && (
            <button
              type="button"
              className="im-detail-jump"
              aria-label="Show selected facility details"
              onClick={() => {
                inspector.current?.scrollIntoView({ block: "start" });
                inspector.current?.focus({ preventScroll: true });
              }}
            >
              Details: {displayText(node.entity.label)}{" "}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          )}
          <div className="im-legend" aria-label="Map evidence legend">
            <span>
              <i className="modeled" />
              Modeled consequence
            </span>
            <span>
              <i className="context" />
              Case context
            </span>
            <span>
              <i className="reference" />
              Reference record
            </span>
          </div>
          <p className="im-help">
            Select an icon to inspect. Drag to pan; use + / − to zoom.
          </p>
          <details className="im-index" ref={index}>
            <summary>Browse {visible.length} facilities</summary>
            <div>
              {visible.map((n) => {
                const Icon = symbols[infrastructureSymbol(n.entity).kind];
                return (
                  <button
                    type="button"
                    key={n.entity.id}
                    aria-pressed={node?.entity.id === n.entity.id}
                    onClick={() => choose(n.entity.id, true)}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{displayText(n.entity.label)}</span>
                  </button>
                );
              })}
            </div>
          </details>
        </div>
        <aside
          className="im-inspector"
          ref={inspector}
          tabIndex={-1}
          aria-label="Infrastructure details"
        >
          {node ? (
            <>
              <div className="im-inspector-heading">
                <span
                  className={`im-detail-symbol ${infrastructureSymbol(node.entity).kind}`}
                >
                  <Symbol size={24} aria-hidden="true" />
                </span>
                <button
                  type="button"
                  aria-label="Clear infrastructure selection"
                  onClick={() => choose(null)}
                >
                  <X size={17} />
                </button>
              </div>
              <span className="im-eyebrow">
                {infrastructureSymbol(node.entity).label}
              </span>
              <h3>{displayText(node.entity.label)}</h3>
              <span className={`im-status ${state(node)}`}>
                {node.impacts.length
                  ? "Captured modeled consequence"
                  : node.context
                    ? "Captured case context"
                    : "Reference inventory"}
              </span>
              <button
                type="button"
                className="im-open-analyst"
                onClick={() =>
                  onOpenEntity(
                    node.entity.id,
                    selected?.id ?? node.impacts[0]?.caseId ?? node.caseIds[0],
                  )
                }
              >
                {!data.entities.some((e) => e.id === node.entity.id)
                  ? "Open saved case in Analyst"
                  : model.captured
                    ? "Inspect current record in Analyst"
                    : "Inspect in Analyst"}{" "}
                <ExternalLink size={15} aria-hidden="true" />
              </button>
              {!node.impacts.length && (
                <p className="im-muted">No modeled impact for this facility.</p>
              )}
              <dl className="im-facts">
                <dt>Record basis</dt>
                <dd>
                  {model.captured || node.capturedOnly
                    ? "Saved case snapshot"
                    : "Current reference inventory"}
                </dd>
                <dt>Map position</dt>
                <dd>
                  {position?.placement === "source-coordinate"
                    ? "Recorded coordinate"
                    : "Illustrative topology position"}
                </dd>
                <dt>IDT</dt>
                <dd>{capturedClassification(node.entity).lineage}</dd>
              </dl>
              {node.renamed && (
                <p className="im-note">
                  Current and saved record labels differ.
                </p>
              )}
              {node.impacts.map((impact, i) => (
                <article className="im-impact" key={`${impact.caseId}:${i}`}>
                  <span className="im-eyebrow">
                    CAPTURED RESULT · {words(impact.state)}
                  </span>
                  <h4>{displayText(impact.entityLabel)}</h4>
                  <p>{displayText(impact.functionLabel)}</p>
                  <strong>{planningWindow(impact.windowHours)}</strong>
                  <p className="im-muted">{impact.caseTitle}</p>
                  <details>
                    <summary>Model and source basis</summary>
                    <p>
                      {impact.modelVersion ?? "Model version not captured"} ·{" "}
                      {timeLabel(impact.capturedAt)}
                    </p>
                    <p>
                      Sources: {impact.sourceRefs.join(", ") || "Not captured"}
                    </p>
                    {impact.assumptions.map((a, j) => (
                      <p key={j}>{a}</p>
                    ))}
                  </details>
                </article>
              ))}
              <details className="im-links">
                <summary>
                  {connections.length} recorded dependency links
                </summary>
                {connections.map((e) => (
                  <div key={e.id}>
                    <span>
                      {e.source === node.entity.id ? "Supplies" : "Depends on"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        choose(
                          e.source === node.entity.id ? e.target : e.source,
                          true,
                        )
                      }
                    >
                      {displayText(
                        model.nodes.find(
                          (n) =>
                            n.entity.id ===
                            (e.source === node.entity.id ? e.target : e.source),
                        )?.entity.label ?? "Label unavailable",
                      )}
                    </button>
                    <small>
                      {e.label} · {e.caseIds.length ? "captured" : "reference"}
                    </small>
                  </div>
                ))}
              </details>
              {related.length > 0 && (
                <div className="im-cases">
                  <h4>Linked saved cases</h4>
                  {related.map((i) => (
                    <button
                      type="button"
                      key={i.id}
                      onClick={() => onSelectCase(i.id)}
                    >
                      {i.title}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="im-inspector-empty">
              <Move size={28} aria-hidden="true" />
              <h3>Explore the infrastructure</h3>
              <p>
                Select a facility icon to see its role, captured consequences
                and recorded dependencies.
              </p>
              <p className="im-muted">
                Use the facility list below the map for precise keyboard or
                touch selection.
              </p>
            </div>
          )}
        </aside>
      </div>
      {model.missingRecords > 0 && (
        <p className="im-note">
          {model.missingRecords} records cannot be placed.
        </p>
      )}
      <p className="im-provenance">
        Schematic positions ·{" "}
        {model.captured ? "Saved case" : "Reference inventory"}{" "}
        <a href={TEXAS_BOUNDARY_SOURCE} target="_blank" rel="noreferrer">
          Texas boundary source
        </a>
      </p>
    </section>
  );
}
