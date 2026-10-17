import type { GraphNode, GraphView } from "../sectorNetwork.ts";
import { layeredLayout, radialLayout } from "../sectorNetwork.ts";
import { displayText } from "../presentation.ts";
import "../sector-graph.css";

const W = 1000;

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (!line) line = word;
    else if ((line + " " + word).length <= max) line += " " + word;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.slice(0, 3);
}
function radius(n: GraphNode, layout: "radial" | "layered") {
  if (layout === "layered") return n.kind === "source" ? 76 : 66;
  if (n.kind === "source") return 74;
  return Math.min(82, 52 + 9 * Math.sqrt(n.weight));
}

export interface SectorGraphProps {
  view: GraphView;
  layout: "radial" | "layered";
  selectedId?: string | null;
  onSelect?: (node: GraphNode) => void;
  ariaLabel: string;
}

/** Linked dependency drawing. Labels, tones and links all come from the view. */
export default function SectorGraph({
  view,
  layout,
  selectedId = null,
  onSelect,
  ariaLabel,
}: SectorGraphProps) {
  const tallest = Math.max(
    1,
    ...[...new Set(view.nodes.map((n) => n.depth))].map(
      (d) => view.nodes.filter((n) => n.depth === d).length,
    ),
  );
  const H = layout === "radial" ? 460 : Math.max(420, tallest * 172 + 40);
  const pos =
    layout === "radial" ? radialLayout(view, W, H) : layeredLayout(view, W, H);
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  return (
    <div className="sg-wrap">
      <div className="sg-head">
        <strong>{view.title}</strong>
        <span>{view.hint}</span>
      </div>
      <svg
        className="sg-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={ariaLabel}
      >
        {view.edges.map((e) => {
          const a = pos.get(e.from),
            b = pos.get(e.to);
          if (!a || !b) return null;
          return (
            <g key={e.id} className={`sg-edge sg-${e.tone}`} data-edge={e.id}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                strokeDasharray={e.dashed ? "7 6" : undefined}
              />
            </g>
          );
        })}
        {view.nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const r = radius(n, layout);
          const lines = wrap(
            displayText(n.label),
            layout === "layered" ? 18 : r > 62 ? 15 : 13,
          );
          const clickable =
            !!onSelect &&
            n.kind !== "source" &&
            (n.kind === "sector" || n.kind === "people" || !!n.entityId);
          const subLines =
            n.sub.length > 24 && n.sub.includes(" · ")
              ? [
                  n.sub.slice(0, n.sub.indexOf(" · ")),
                  n.sub.slice(n.sub.indexOf(" · ") + 3),
                ]
              : [n.sub];
          const top =
            p.y - (lines.length * 17 + 14 + subLines.length * 15) / 2 + 12;
          return (
            <g
              key={n.id}
              className={`sg-node sg-${n.tone} sg-${n.line}${selectedId && (selectedId === n.id || selectedId === n.entityId) ? " sg-selected" : ""}${clickable ? " sg-click" : ""}`}
              data-node={n.id}
              data-kind={n.kind}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={
                n.kind === "sector" || n.kind === "people"
                  ? `Show IDT sector ${n.idt.replace(/^IDT /, "")} · ${n.label}: ${n.sub}`
                  : `Show ${n.label}: ${n.sub}`
              }
              onClick={clickable ? () => onSelect?.(n) : undefined}
              onKeyDown={
                clickable
                  ? (ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        onSelect?.(n);
                      }
                    }
                  : undefined
              }
            >
              <circle cx={p.x} cy={p.y} r={r} />
              {lines.map((l, i) => (
                <text
                  key={i}
                  className="sg-label"
                  x={p.x}
                  y={top + i * 17}
                  textAnchor="middle"
                >
                  {l}
                </text>
              ))}
              {n.idt && (
                <text
                  className="sg-idt"
                  x={p.x}
                  y={top + lines.length * 17}
                  textAnchor="middle"
                >
                  {n.idt}
                </text>
              )}
              {subLines.map((l, i) => (
                <text
                  key={`s${i}`}
                  className="sg-sub"
                  x={p.x}
                  y={top + lines.length * 17 + 16 + i * 15}
                  textAnchor="middle"
                >
                  {l.length > 30 ? l.slice(0, 29) + "…" : l}
                </text>
              ))}
              <title>{`${n.label} · ${n.idt} · ${n.sub}`}</title>
            </g>
          );
        })}
        {view.edges.map((e) => {
          const a = pos.get(e.from),
            b = pos.get(e.to);
          if (!a || !b) return null;
          const mx = (a.x + b.x) / 2,
            my = (a.y + b.y) / 2;
          const w = Math.min(260, e.label.length * 6.6 + 12);
          return (
            <g
              key={`label-${e.id}`}
              className={`sg-edge-label sg-${e.tone}`}
              aria-hidden="true"
            >
              <rect x={mx - w / 2} y={my - 12} width={w} height={22} rx={6} />
              <text x={mx} y={my + 4} textAnchor="middle">
                {e.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="sg-legend" aria-label="Legend">
        <li className="sg-red">At risk</li>
        <li className="sg-amber">Later window</li>
        <li className="sg-green">Normal · upstream</li>
        <li className="sg-grey">Connected, not affected (dashed)</li>
        <li className="sg-grey sg-dot">In area, no dependency (dotted)</li>
      </ul>
      {byId.size === 1 && (
        <p className="sg-empty">No captured dependencies around this source.</p>
      )}
    </div>
  );
}
