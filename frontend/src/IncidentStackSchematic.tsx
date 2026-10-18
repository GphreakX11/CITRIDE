import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Building2, Droplets, Factory, Flame, HeartHandshake, HeartPulse, Hospital, Zap, Plus, Minus, Maximize2 } from "lucide-react";
import type { IncidentStackModel } from "./incidentStack.ts";
import { infrastructureSymbol } from "./infrastructureSymbols.ts";
import { schematicItems, schematicLayout, wrapSchematicText } from "./incidentSchematicLayout.ts";
import type { SchematicFilter } from "./incidentSchematicLayout.ts";
import "./incident-schematic.css";

export interface IncidentStackSchematicProps {
  model: IncidentStackModel;
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
  query?: string;
}
export const incidentSchematicIcons = { water: Droplets, plant: Factory, hospital: Hospital, dialysis: HeartPulse, care: HeartHandshake, power: Zap, fire: Flame, facility: Building2 };
const symbols = incidentSchematicIcons;
const filters: { key: SchematicFilter; label: string }[] = [{ key: "all", label: "All" }, { key: "water", label: "Water" }, { key: "healthcare", label: "Healthcare" }, { key: "power", label: "Power" }, { key: "emergency", label: "Emergency" }];
const initialView = { zoom: 1, x: 0, y: 0 };
const dash = (line: string) => line === "dashed" ? "7 6" : line === "dotted" ? "2 5" : undefined;
const shortLines = (text: string, max: number) => {
  const lines = wrapSchematicText(text, max);
  return lines.slice(0, 2).map((line, i) => line.length > max || (i === 1 && lines.length > 2) ? `${line.slice(0, max - 1)}…` : line);
};

/** Selected-incident topology only; no geography or inferred operational evidence. */
export default function IncidentStackSchematic({ model, selectedEntityId, onSelectEntity, query = "" }: IncidentStackSchematicProps) {
  const [filter, setFilter] = useState<SchematicFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [view, setView] = useState(initialView);
  const [width, setWidth] = useState(1000);
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const uid = `schematic-${useId().replace(/[^\w-]/g, "")}`;
  const search = query.trim().toLocaleLowerCase();
  const scope = model.sourceId ?? model.incident?.id ?? "";
  useEffect(() => { setExpanded(new Set()); setView(initialView); setFilter("all"); }, [scope]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const resize = () => setWidth(element.clientWidth || 1000);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!selectedEntityId) return;
    const group = model.facilityGroups.find(g => g.nodes.some(n => n.entity.id === selectedEntityId));
    if (group && model.aggregateFacilities) setExpanded(previous => previous.has(group.id) ? previous : new Set([...previous, group.id]));
    setFilter("all");
  }, [selectedEntityId, model.facilityGroups, model.aggregateFacilities]);
  const items = useMemo(() => schematicItems(model, expanded, filter), [model, expanded, filter]);
  const layout = useMemo(() => schematicLayout(items, width), [items, width]);
  // A list selection must be visible even when its sector was collapsed/off-screen.
  useEffect(() => {
    const p = selectedEntityId && layout.positions.get(selectedEntityId);
    if (p && host.current) host.current.scrollTo({ top: Math.max(0, p.y - 220), left: Math.max(0, p.x - width / 2), behavior: "auto" });
    setView(initialView);
  }, [selectedEntityId, layout, width]);
  const memberToItem = new Map(items.flatMap(item => item.members.map(n => [n.entity.id, item.id] as const)));
  const edges = model.edges.flatMap(edge => {
    const source = memberToItem.get(edge.source), target = memberToItem.get(edge.target);
    return source && target && source !== target ? [{ ...edge, renderedSource: source, renderedTarget: target }] : [];
  });
  const zoom = (delta: number) => setView(v => ({ ...v, zoom: Math.max(1, Math.min(2.6, v.zoom + delta)) }));
  const service = [model.serviceAreaLabel ?? "Recorded service area", model.people === null ? null : `${model.people.toLocaleString()} people`, model.footPrintModel.boilWaterRule?.label].filter(Boolean).join(" · ");
  return <section className="incident-schematic" data-incident-schematic data-infrastructure-map data-map-scope={scope}>
    <div className="ics-toolbar">
      <h2>What it touches{model.sourceLabel ? ` · ${model.sourceLabel}` : ""}</h2>
      <div className="ics-filters" role="group" aria-label="Infrastructure categories">{filters.map(f => <button type="button" key={f.key} aria-pressed={filter === f.key} onClick={() => { setFilter(f.key); setView(initialView); }}>{f.label}</button>)}</div>
    </div>
    {expanded.size > 0 && <div className="ics-collapse">{model.facilityGroups.filter(g => expanded.has(g.id)).map(g => <button key={g.id} type="button" onClick={() => { setExpanded(previous => { const next = new Set(previous); next.delete(g.id); return next; }); if (g.nodes.some(n => n.entity.id === selectedEntityId)) onSelectEntity(null); }}>Collapse {g.label}</button>)}</div>}
    <div className="ics-canvas-shell">
      <div className="ics-navigation" role="group" aria-label="Schematic navigation">
        <button type="button" aria-label="Zoom in schematic" disabled={view.zoom >= 2.6} onClick={() => zoom(.3)}><Plus size={17} /></button>
        <button type="button" aria-label="Zoom out schematic" disabled={view.zoom <= 1} onClick={() => zoom(-.3)}><Minus size={17} /></button>
        <button type="button" aria-label="Reset schematic" onClick={() => { setView(initialView); host.current?.scrollTo({ top: 0, left: 0 }); }}><Maximize2 size={17} /></button>
      </div>
      <div className="ics-viewport" ref={host}>
        <svg width={layout.width} height={layout.height} role="group" aria-label="Selected incident infrastructure schematic"
          onPointerDown={event => { if (event.button !== 0 || (event.target as Element).closest("[data-map-marker]")) return; drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, vx: view.x, vy: view.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { const d = drag.current; if (d?.id === event.pointerId) setView(v => ({ ...v, x: d.vx + event.clientX - d.x, y: d.vy + event.clientY - d.y })); }}
          onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { drag.current = null; }}>
          <defs><marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 1 L9 5 L0 9" fill="none" stroke="context-stroke" strokeWidth="1.6" /></marker></defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
            <rect className="ics-service-area" x={layout.width * .33} y="72" width={layout.width * .64} height={layout.height - 88} rx="85" />
            <rect className="ics-label-backing" x={layout.width * .36} y="42" width={layout.width * .59} height="27" rx="5" />
            <text className="ics-area-label" x={layout.width * .37} y="60">{service.length > 78 ? `${service.slice(0, 77)}…` : service}<title>{service}</title></text>
            {edges.map((edge, index) => {
              const a = layout.positions.get(edge.renderedSource)!, b = layout.positions.get(edge.renderedTarget)!;
              const length = Math.hypot(b.x - a.x, b.y - a.y);
              if (!length) return null;
              const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
              const textLines = shortLines(edge.label || "Recorded service", 25);
              const duplicates = edges.filter(e => e.renderedSource === edge.renderedSource && e.renderedTarget === edge.renderedTarget);
              const offset = (duplicates.findIndex(e => e.id === edge.id) - (duplicates.length - 1) / 2) * 32;
              const mx = (a.x + b.x) / 2 - dy * offset, my = (a.y + b.y) / 2 + dx * offset;
              return <g key={`${edge.id}-${index}`} className={`ics-tone-${edge.tone}`} data-edge-source={edge.source} data-edge-target={edge.target} data-edge-label={edge.label}>
                <path className="ics-edge" d={`M${a.x + dx * 39},${a.y + dy * 39} Q${mx},${my} ${b.x - dx * 40},${b.y - dy * 40}`} strokeDasharray={dash(edge.line)} markerEnd={`url(#${uid}-arrow)`} />
                <rect className="ics-label-backing" x={mx - 95} y={my - 12} width="190" height={textLines.length * 17 + 7} rx="5" />
                <text className="ics-edge-label" textAnchor="middle" x={mx} y={my + 2}>{textLines.map((line, i) => <tspan key={i} x={mx} dy={i ? 17 : 0}>{line}</tspan>)}<title>{edge.label}</title></text>
              </g>;
            })}
            {items.map(item => {
              const p = layout.positions.get(item.id)!;
              const kind = infrastructureSymbol(item.node.entity).kind;
              const Icon = symbols[kind];
              const active = item.members.some(n => n.entity.id === selectedEntityId);
              const match = !!search && item.members.some(n => `${n.entity.label} ${n.state.label} ${n.classification?.label ?? ""}`.toLocaleLowerCase().includes(search));
              const names = shortLines(item.name, 27), secondary = shortLines(item.secondary, 33);
              const activate = () => item.aggregate ? setExpanded(previous => new Set([...previous, item.groupId!])) : onSelectEntity(active ? null : item.id);
              return <g key={item.id} transform={`translate(${p.x} ${p.y})`} className={`ics-node ics-tone-${item.state.tone} ${active ? "is-selected" : ""} ${match ? "is-match" : ""}`} role="button" tabIndex={0} aria-label={`${item.aggregate ? "Expand" : "Select"} ${item.name} · ${item.secondary}`} aria-pressed={active} aria-expanded={item.aggregate ? false : undefined} data-map-marker={item.id} data-entity-id={item.aggregate ? undefined : item.id} data-icon-kind={kind} data-state-line={item.state.line} data-query-match={match || undefined}
                onClick={event => { event.stopPropagation(); activate(); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } if (event.key === "Escape") { event.preventDefault(); onSelectEntity(null); } }}>
                <title>{item.name} · {item.secondary}</title>
                <circle className="ics-selection" r="44" />
                <circle className="ics-disc" r="33" strokeDasharray={dash(item.state.line)} />
                {item.state.doubleRing && <circle className="ics-double-ring" r="39" />}
                <Icon className="ics-icon" x={-15} y={-15} width={30} height={30} strokeWidth={1.8} aria-hidden="true" />
                {kind === "plant" && <g transform="translate(24 23)" aria-hidden="true"><circle className="ics-water-badge" r="11" /><Droplets x={-7} y={-7} width={14} height={14} /></g>}
                <rect className="ics-label-backing" x="-118" y="41" width="236" height={(names.length + secondary.length) * 18 + 8} rx="5" />
                <text className="ics-name" textAnchor="middle" y="58">{names.map((line, i) => <tspan x="0" key={i} dy={i ? 18 : 0}>{line}</tspan>)}</text>
                <text className="ics-secondary" textAnchor="middle" y={58 + names.length * 18}>{secondary.map((line, i) => <tspan x="0" key={i} dy={i ? 18 : 0}>{line}</tspan>)}</text>
              </g>;
            })}
          </g>
        </svg>
        {!items.length && <p className="ics-empty">No facilities in this category.</p>}
      </div>
    </div>
    <div className="ics-legend" aria-label="Modeled state legend"><span className="ics-tone-red">◎ Source / attacked / under 4 h</span><span className="ics-tone-amber">○ 4 h or later / probed</span><span className="ics-tone-green">○ Normal upstream</span><span className="ics-tone-grey">◌ Not affected / in area / unknown</span><span>Schematic positions · {model.run ? "saved case · modeled, not observed" : "reference inventory · not yet modeled"} · drag to move</span></div>
  </section>;
}
