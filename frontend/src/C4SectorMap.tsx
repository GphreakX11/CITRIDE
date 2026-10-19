
import { hours, windowTone, type ConsequenceProjection } from "./consequencesModel.ts";
import { sectorScore } from "./C4Metadata.tsx";

// A sector overview is deliberately not the asset/supply-chain drawing on C2.
// Its scope comes from the supplied sector views, never an incident or place ID.
export function C4SectorMap({value, sector, onSector, onSelect}: {
  value: ConsequenceProjection; sector: string | null;
  onSector: (sector: string) => void; onSelect: (id: string) => void;
}) {
  const arrow = `sector-${encodeURIComponent((value.incident?.id ?? value.source?.id ?? 'unrecorded')).replaceAll('%', '-')}`;
  const views = [...new Map((value.sectorViews ?? []).flatMap(r => r.sectors).map(s => [s.sector, s])).values()];
  const rows = Math.max(1, Math.ceil(views.length / 2));
  const sectors = views.map((s, i) => ({
    ...s, x: i % 2 ? 74 : 26, y: 10 + (Math.floor(i / 2) + .5) * 80 / rows,
    window: value.sectors.find(r => r.label === s.sector)?.windowHours,
  }));
  const watches = (value.watchAssets ?? []).map(w => {
    const node = value.nodes.find(n => n.id === w.entityId);
    // Entity sector is authoritative; item membership is a fallback for sparse projections.
    const parent = sectors.find(s => s.sector === node?.sector)
      ?? sectors.find(s => s.items.some(item => item.entityId === w.entityId));
    return { ...w, node, parent };
  });
  const maxWatches = Math.max(1, ...sectors.map(s => watches.filter(w => w.parent === s).length));
  const height = Math.max(760, rows * Math.max(330, maxWatches * 190));
  const satellites = watches.map(w => {
    const siblings = watches.filter(other => other.parent === w.parent);
    const index = siblings.indexOf(w);
    return {...w, x: w.parent ? (w.parent.x < 50 ? 8 : 92) : 50,
      y: w.parent ? w.parent.y + (index - (siblings.length - 1) / 2) * 19000 / height : 5};
  });
  return <><div className="c4-sector-map-scroll c4-desktop-map" tabIndex={0} aria-label="Scrollable sector map" ref={node => { if (node && node.dataset.centeredIncident !== (value.incident?.id ?? value.source?.id ?? 'unrecorded')) { node.scrollLeft = Math.max(0, (node.scrollWidth - node.clientWidth) / 2); node.dataset.centeredIncident = (value.incident?.id ?? value.source?.id ?? 'unrecorded'); } }}>
    <div className="c4-sector-map" aria-label="Sector consequence map" style={{height}}>
      <svg viewBox={`0 0 1100 ${height}`} preserveAspectRatio="none" aria-label="Sector summary and campaign watch relationships">
        <defs><marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><polygon points="0,0 10,5 0,10" fill="context-stroke"/></marker></defs>
        {sectors.map(s => { const dx = s.x * 11 - 550, dy = s.y * height / 100 - height / 2; const length = Math.hypot(dx, dy); return <path key={s.sector} className={`c4-map-link tone-${windowTone(s.window)}`}
          markerEnd={`url(#${arrow})`} data-relationship="sector-summary" d={`M${550 + dx * 105 / length} ${height / 2 + dy * 105 / length} L${s.x * 11 - dx * 80 / length} ${s.y * height / 100 - dy * 80 / length}`}/>; })}
        {satellites.map((w, i) => <g key={i} data-relationship="watch" data-watch-sector={w.parent?.sector}>
          <title>{`${w.reason} · watch posture only, not a service dependency`}</title>
          <path className="c4-watch-edge" d={`M${(w.parent?.x ?? 50) * 11} ${(w.parent?.y ?? 50) * height / 100} L${w.x * 11} ${w.y * height / 100}`}/>
          <text className="c4-watch-label" x={((w.parent?.x ?? 50) + w.x) * 5.5} y={((w.parent?.y ?? 50) + w.y) * height / 200 - 16}>
            {/login pattern/i.test(w.reason) ? "same login pattern" : "same campaign"}
          </text>
        </g>)}
      </svg>
      <button className="c4-map-source tone-red" data-map-role="source" style={{left: '50%', top: '50%'}}
        onClick={() => value.source && onSelect(value.source.id)}>
        <strong>{value.source?.label || value.source?.name || 'Source not recorded'}</strong><small>Source</small>
      </button>
      {sectors.map(s => <button key={s.sector} className={`c4-map-sector tone-${windowTone(s.window)}`}
        data-map-role="sector" data-sector={s.sector} aria-pressed={sector === s.sector}
        aria-controls="c4-sector-details" style={{left: `${s.x}%`, top: `${s.y}%`}}
        onClick={() => onSector(s.sector)}>
        <strong>{s.sector}</strong><small>{sectorScore(value, s.sector) == null ? 'Score not recorded' : `Score ${sectorScore(value, s.sector)}`}</small>
        <small>{hours(s.window)}</small>
      </button>)}
      {satellites.map((w, i) => <button key={i} className="c4-map-watch tone-amber" data-map-role="watch"
        style={{left: `${w.x}%`, top: `${w.y}%`}} onClick={() => onSelect(w.entityId)} title={w.reason}>
        <strong>{w.entity?.label || w.entity?.name || w.node?.label || w.node?.name || w.entityId}</strong>
        <small>{/login pattern/i.test(w.reason) ? 'Same login pattern' : 'Same campaign'}</small>
        {w.inCascade && <small>Also at risk · {hours(w.node?.windowHours)}</small>}
      </button>)}
    </div>
  </div>
  <div className="c4-mobile-map" aria-label="Sector consequence map, compact layout">
    <button className="c4-mobile-source tone-red" onClick={() => value.source && onSelect(value.source.id)}><strong>{value.source?.label || value.source?.name || 'Source not recorded'}</strong><small>Source · impacts flow to sectors below ↓</small></button>
    <div className="c4-mobile-sectors">{sectors.map(s => <section key={s.sector} className="c4-mobile-sector">
      <button data-sector={s.sector} className={`tone-${windowTone(s.window)}`} aria-pressed={sector === s.sector} aria-controls="c4-sector-details" onClick={() => onSector(s.sector)}><strong>↓ {s.sector}</strong><small>{sectorScore(value,s.sector) == null ? 'Score not recorded' : `Score ${sectorScore(value,s.sector)}`} · {hours(s.window)}</small></button>
      {satellites.filter(w => w.parent?.sector === s.sector).map(w => <button key={w.entityId} className="c4-mobile-watch tone-amber" onClick={() => onSelect(w.entityId)}><strong>{w.entity?.label || w.entity?.name || w.node?.name || w.entityId}</strong><small>{/login pattern/i.test(w.reason) ? 'Same login pattern' : 'Same campaign'} · watch relationship</small>{w.inCascade && <small>Also at risk · {hours(w.node?.windowHours)}</small>}</button>)}
    </section>)}</div>
    <p className="c4-mobile-map-note">Dashed amber: watch relationship, not a service dependency.</p>
  </div></>;
}
