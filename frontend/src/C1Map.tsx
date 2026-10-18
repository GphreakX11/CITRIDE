import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { StatewideFootprintModel } from "./statewideFootprint.ts";
import { FITTED_TEXAS_VIEWBOX } from "./fittedTexasMap.ts";
import { TEXAS_PATH, TEXAS_BOUNDARY_SOURCE } from "./texasOutline.ts";
import { InfrastructureIcon } from "./InfrastructureIcon.tsx";
import { infrastructureKind, infrastructureLabel } from "./infrastructureIcons.ts";
import { statusTone } from "./statusTone.ts";
import { C1_CITIES, c1TexasLonLat, c1FittedPoint, c1IncidentLayout, c1PlaceLabels, c1GeographicAnchor } from "./c1MapLayout.ts";
import "./c1-map.css";
import { c1PulseStyle } from "./c1Pulse.ts";

export interface C1MapProps {
  model: StatewideFootprintModel;
  cascadingIds: ReadonlySet<string>;
  riskCaseIds?: ReadonlySet<string>;
  onPick: (id: string) => void;
}
const severity = (value?: string) => value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : "Unknown";
const short = (value: string, length = 33) => value.length > length ? `${value.slice(0, length - 1)}…` : value;

/** C1 is statewide and selection-free. The parent owns its panel and heading. */
export function C1Map({ model, cascadingIds, riskCaseIds, onPick }: C1MapProps) {
  const uid = `c1-map-${useId().replaceAll(":", "")}`;
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const rows = useMemo(() => model.rows.filter(row => row.status?.toLowerCase() !== "closed"), [model.rows]);
  const { markers, capacityExceeded } = useMemo(() => c1IncidentLayout(rows.flatMap(row => {
    const point = c1GeographicAnchor(row);
    return point ? [point] : [];
  }), size.width, size.height), [rows, size]);
  const byId = new Map(markers.map(marker => [marker.id, marker]));
  const layers = model.layers.flatMap(layer => {
    const row = rows.find(item => item.caseId === layer.caseId);
    const marker = row && byId.get(row.id);
    return marker && row ? [{ layer, marker, row }] : [];
  });
  // Captured local XY is not longitude/latitude. Preserve its relative direction
  // around the fitted source; the complete map explicitly says approximate.
  const probes = layers.flatMap(({ layer, marker }) => {
    const source = layer.utility?.coordinates;
    if (!source) return [];
    const recorded = layer.probed.filter(probe => probe.coordinates?.every(Number.isFinite));
    const maxDelta = Math.max(1, ...recorded.map(probe => Math.hypot(probe.coordinates![0] - source[0], probe.coordinates![1] - source[1])));
    return recorded.flatMap(probe => {
      const point = probe.coordinates!;
      // Layer geometry is explicitly recorded local XY. Even values that happen
      // to resemble Texas coordinates are not evidence of a geographic CRS.
      const dx = (point[0] - source[0]) / maxDelta * 100;
      const dy = -(point[1] - source[1]) / maxDelta * 100;
      const distance = Math.hypot(dx, dy);
      // Separate approximate probe glyphs from the source without changing data.
      if (!distance) return [];
      const separation = Math.max(1, 48 / distance);
      const target = { x: marker.x + dx * separation, y: marker.y + dy * separation };
      if (target.x < 12 || target.y < 12 || target.x > size.width - 12 || target.y > size.height - 12) return [];
      return [{ ...target, id: `${layer.caseId}:${probe.id}`, label: `${probe.label} · probed`, source: marker, caseId: layer.caseId }];
    });
  });
  const obstacles = [...markers.map(marker => ({ x: marker.x - 24, y: marker.y - 24, width: 48, height: 48 })),
    ...probes.map(probe => ({ x: probe.x - 10, y: probe.y - 10, width: 20, height: 20 }))];
  const layout = c1PlaceLabels([
    ...markers.map(marker => ({ ...marker, width: Math.max(200, Math.min(300, (short(rows.find(row => row.id === marker.id)?.title ?? "Untitled incident").length * 8) + 20)) })),
    ...probes.map(probe => ({ ...probe, width: Math.min(240, probe.label.length * 7 + 16), height: 24 })),
  ], obstacles, size.width, size.height);
  const fallback = capacityExceeded || markers.some(marker => layout.missing.includes(marker.id));
  const listRows = fallback ? rows : rows.filter(row => !byId.has(row.id));
  const cascade = (id: string, caseId?: string) => cascadingIds.has(id) || Boolean(caseId && cascadingIds.has(caseId));
  const scale = Math.min(size.width / 800, size.height / 620);
  const offset = { x: (size.width - 800 * scale) / 2 - 80 * scale, y: (size.height - 620 * scale) / 2 - 45 * scale };
  return <div className="c1-map">
    <div className="c1-map-canvas" ref={host}>
      {size.width > 0 && size.height > 0 && <svg className="c1-map-svg" viewBox={`0 0 ${size.width} ${size.height}`} role="group" aria-label="Statewide incident map">
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0" className="c1-map-gradient-start"/><stop offset="1" className="c1-map-gradient-end"/></linearGradient>
          <radialGradient id={`${uid}-glow`}><stop offset="0" className="c1-map-glow-start"/><stop offset="1" className="c1-map-glow-end"/></radialGradient>
          <clipPath id={`${uid}-clip`}><path d={TEXAS_PATH}/></clipPath>
          <pattern id={`${uid}-grid`} width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" className="c1-map-grid-dot"/></pattern>
        </defs>
        <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`} data-viewbox={FITTED_TEXAS_VIEWBOX} data-boundary-source={TEXAS_BOUNDARY_SOURCE} aria-hidden="true">
          <path d={TEXAS_PATH} className="c1-map-shadow" transform="translate(4 6)"/>
          <path d={TEXAS_PATH} fill={`url(#${uid}-fill)`} className="c1-map-outline"/>
          <rect x="80" y="45" width="800" height="620" fill={`url(#${uid}-grid)`} clipPath={`url(#${uid}-clip)`}/>
        </g>
        <g className="c1-map-cities" aria-label="City reference points">
          {C1_CITIES.map(city => { const point = c1FittedPoint(c1TexasLonLat(city.lon, city.lat), size.width, size.height); return <g key={city.name} transform={`translate(${point.x} ${point.y})`}><circle r="2.5"/><text x="6" y="4">{city.name}</text></g>; })}
        </g>
        {!fallback && <>
          {layers.filter(({ layer }) => layer.utility && layer.run && (riskCaseIds ? riskCaseIds.has(layer.caseId) : layer.facilities.some(facility => facility.id !== layer.utility!.id && facility.windowHours))).map(({ layer, marker }) => <g key={layer.caseId} data-service-area-case={layer.caseId} aria-label={`${layer.utility!.label} · Service area at risk`}><circle cx={marker.x} cy={marker.y} r="66" fill={`url(#${uid}-glow)`}/><circle cx={marker.x} cy={marker.y} r="44" className="c1-map-service"/></g>)}
          {probes.map(probe => <g key={probe.id} className="c1-map-probe" data-probe-case={probe.caseId}><title>{`${probe.label} · recorded position, approximate display`}</title><line x1={probe.source.x} y1={probe.source.y} x2={probe.x} y2={probe.y}/><circle cx={probe.x} cy={probe.y} r="8"/></g>)}
          {markers.map(marker => { const row = rows.find(item => item.id === marker.id)!; const cascading = cascade(row.id, row.caseId); return <g key={row.id} className={`c1-map-marker c1-map-tone-${statusTone(row.severity)}${row.severity === "critical" ? " c1-map-critical" : ""}`} data-incident-pin={row.id} data-cascading={cascading || undefined} transform={`translate(${marker.x} ${marker.y})`} role="button" tabIndex={0} aria-label={`${row.title ?? "Untitled incident"} · ${row.id} · ${severity(row.severity)}${cascading ? " · CASCADING IMPACT" : ""}`} onClick={() => onPick(row.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPick(row.id); } }}>
            <title>{`${row.title ?? "Untitled incident"} · ${row.id}${cascading ? " · CASCADING IMPACT" : ""}`}</title>
            {cascading && <g aria-hidden="true" className="c1-map-cascade" style={c1PulseStyle(row.id)}><circle r="24" className="c1-map-cascade-ring"/><circle r="24" className="c1-map-cascade-ring c1-map-cascade-ring-second"/></g>}
            <circle r="22" className="c1-map-marker-disc"/>
            <g transform="translate(-12 -12)"><InfrastructureIcon kind={infrastructureKind(row)} size={24}/></g>
          </g>; })}
          {layout.labels.map(label => { const row = rows.find(item => item.id === label.id); const probe = probes.find(item => item.id === label.id); return <g key={label.id} className={`c1-map-label ${row ? `c1-map-tone-${statusTone(row.severity)}` : "c1-map-tone-amber"}`} transform={`translate(${label.x} ${label.y})`} aria-hidden="true"><rect width={label.width} height={label.height} rx="6"/>{row ? <><text x="10" y="18" className="c1-map-label-title">{short(row.title ?? "Untitled incident")}</text><text x="10" y="35" className="c1-map-label-meta">{row.id} · {severity(row.severity)}</text></> : <text x="8" y="17" className="c1-map-label-meta">{short(probe?.label ?? "", 30)}</text>}</g>; })}
        </>}
      </svg>}
    </div>
    {listRows.length > 0 && <div className="c1-map-fallback"><p>{fallback ? "Map labels cannot fit safely at this size. Select an incident below." : "Incident positions not recorded:"}</p><ul>{listRows.map(row => <li key={row.id}><button type="button" className={`c1-map-list-button c1-map-tone-${statusTone(row.severity)}`} onClick={() => onPick(row.id)}><InfrastructureIcon kind={infrastructureKind(row)} size={22}/><span>{row.title ?? "Untitled incident"}<small>{row.id} · {severity(row.severity)}{cascade(row.id, row.caseId) ? " · CASCADING IMPACT" : ""}</small></span></button></li>)}</ul></div>}
    <div className="c1-map-legend" aria-label="Map legend">
      <span className="c1-map-tone-red"><i className="c1-map-key-ring c1-map-key-critical"/>Critical</span><span className="c1-map-tone-red"><i className="c1-map-key-ring"/>High</span><span className="c1-map-tone-amber"><i className="c1-map-key-ring"/>Medium</span><span className="c1-map-tone-blue"><i className="c1-map-key-ring"/>Low</span><span><i className="c1-map-key-probe"/>Same attacker probed</span><span><i className="c1-map-key-service"/>Service area at risk</span><span><i className="c1-map-key-cascade"/>Cascading impact (pulsing)</span>
    </div>
    <div className="c1-map-pictograms" aria-label="Infrastructure pictograms">{[...new Set(rows.map(infrastructureKind))].map(kind => <span key={kind}><InfrastructureIcon kind={kind} size={16}/>{infrastructureLabel(kind)}</span>)}</div>
    <p className="c1-map-caption">Approximate positions · click an incident to select it</p>
    {probes.some(probe => fallback || layout.missing.includes(probe.id)) && <p className="c1-map-probe-note">Linked probes: {probes.filter(probe => fallback || layout.missing.includes(probe.id)).map(probe => probe.label).join(" · ")}</p>}
  </div>;
}
export default C1Map;
