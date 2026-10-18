import type { StatewideFootprintModel, Coordinate } from "./statewideFootprint.ts";
import { analysisLabel } from "./caseFilePresentation.ts";
import "./statewide-footprint.css";

const count = (value: number | null) => value === null ? "Not recorded" : value.toLocaleString("en-US");
const windowLabel = (value: Coordinate | null) => value ? `${value[0]}–${value[1]} h` : "Timing unknown";

/** C2 retains the original local footprint cards; this is not a statewide map. */
export default function IncidentRecordedFootprints({ model }: { model: StatewideFootprintModel }) {
  return <details className="sf-recorded-footprints" aria-label="Captured service footprints">
    <summary>Recorded service footprints · local geometry and related probes</summary>
    <div className="sf-legend" aria-label="Service footprint legend"><span><i className="sf-legend-attack"/>Attacked utility</span><span><i className="sf-legend-probe"/>Probed utility</span><span><i className="sf-legend-facility"/>Facility at risk (modeled)</span></div>
    {model.layers.filter(layer => layer.utility).map(layer => {
      const coordinates = [...layer.serviceAreas.flatMap(area => area.rings.flat()), ...layer.facilities.flatMap(f => f.coordinates ? [f.coordinates] : []), ...layer.excluded.flatMap(f => f.coordinates ? [f.coordinates] : []), ...(layer.utility?.coordinates ? [layer.utility.coordinates] : [])];
      const xs = coordinates.map(p => p[0]), ys = coordinates.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const project = (p: Coordinate): Coordinate => [55 + ((p[0] - minX) / (maxX - minX || 1)) * 610, 235 - ((p[1] - minY) / (maxY - minY || 1)) * 190];
      const utilityPoint = layer.utility?.coordinates ? project(layer.utility.coordinates) : null;
      const muted = model.active?.caseId !== layer.caseId;
      return <section key={layer.caseId} className={`sf-local-footprint ${muted ? "sf-muted" : ""}`} data-footprint-case={layer.caseId}>
        <h3>{layer.utility!.label} service area · {count(layer.utility!.people)} people</h3>
        <p className="sf-caption">{layer.run ? analysisLabel(layer.run) : "Not yet modeled"} · recorded local coordinates</p>
        {coordinates.length ? <svg viewBox="0 0 720 285" role="img" aria-label={`${layer.utility!.label} recorded service outline and captured facilities`}>
          {layer.serviceAreas.flatMap(area => area.rings.map((ring, index) => <polygon key={`${area.id}-${index}`} data-service-area={area.id} points={ring.map(p => project(p).join(",")).join(" ")} className="sf-service-outline"><title>{area.label} · recorded schematic boundary</title></polygon>))}
          {utilityPoint && <g transform={`translate(${utilityPoint.join(" ")})`} className={`sf-utility sf-${layer.utility!.status}`}><circle r="10"/><text x="15" y="5">{layer.utility!.label} · {layer.utility!.status === "under-attack" ? "Under attack" : layer.utility!.status === "probed" ? "Probed" : "No active attack label"}</text></g>}
          {layer.facilities.map(f => f.coordinates ? <g key={`${f.id}-${f.functionId}`} data-modeled-facility={f.id} transform={`translate(${project(f.coordinates).join(" ")})`} className="sf-facility"><path d="M 0 -7 L 7 0 L 0 7 L -7 0 Z"/><text x="12" y="-9">{f.label} · {windowLabel(f.windowHours)}</text><title>{f.label}: modeled, {windowLabel(f.windowHours)}</title></g> : null)}
          {layer.excluded.map(f => f.coordinates ? <g key={f.id} transform={`translate(${project(f.coordinates).join(" ")})`} className="sf-excluded"><circle r="6"/><text x="10" y="19">{f.label} · not affected</text><title>{f.reason}</title></g> : null)}
        </svg> : <p>Recorded geometry unavailable; no boundary inferred.</p>}
        <div className="sf-probes" aria-label="Related probes">{layer.probed.map(probe => <span key={probe.id} className="sf-probe"><i aria-hidden="true"/>{probe.label} · Probed <small>{count(probe.people)} people · no modeled consequence</small></span>)}</div>
        {!layer.run && <p>Not yet modeled · no captured facility windows.</p>}
      </section>;
    })}
  </details>;
}
