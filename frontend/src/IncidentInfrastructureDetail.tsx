import { useEffect, useRef } from 'react';
import { useConsequenceSelection, writeConsequenceSelection } from './consequenceSelection.ts';
import { assetConsequenceModel } from './AssetConsequenceView/viewModel.ts';
import IncidentDependencyMap from './IncidentDependencyMap.tsx';
import type { C4Watch, ConsequenceProjection } from './consequencesModel.ts';
import { sectorOf } from './incidentPresentation.ts';
import { formatTime } from './displayTime.ts';

interface Props {
  value: ConsequenceProjection;
  entityIcons?: Record<string, string>;
  watchAssets?: readonly C4Watch[];
  onSelectEntity?: (id: string | null) => void;
  onInspect: (id: string) => void;
}
/** Asset-level detail retained alongside the sector overview; no local model execution. */
export default function IncidentInfrastructureDetail({ value, entityIcons, watchAssets = [], onSelectEntity, onInspect }: Props) {
  const [selection] = useConsequenceSelection();
  const model = assetConsequenceModel(value, selection, watchAssets);
  // A watch-only asset is not a modeled service dependency, even if an edge is supplied.
  const nodes = model.nodes.map(node => node.watch?.length && !node.windowHours && !node.source && !node.upstream ? { ...node, status: 'on_watch' } : node);
  const sourceId = value.source?.id ?? nodes.find(node => node.source)?.id ?? '';
  const selectedId = nodes.some(node => node.id === selection.entityId) ? selection.entityId : null;
  const roster = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedId) roster.current?.querySelector<HTMLDetailsElement>('details[open]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, selection.sector]);
  const select = (id: string | null) => {
    writeConsequenceSelection({ entityId: id, sector: id && !model.items.some(item => item.id === id) ? 'all' : selection.sector });
    onSelectEntity?.(id);
  };
  const changeSector = (sector: string) => {
    const clearSelection = selectedId !== null && !assetConsequenceModel(value, { sector }, watchAssets).items.some(item => item.id === selectedId);
    writeConsequenceSelection({ sector, ...(clearSelection ? { entityId: null } : {}) });
    if (clearSelection) onSelectEntity?.(null);
  };
  return <section className="iv-infrastructure-detail" aria-label="Incident infrastructure detail">
    <section className="iv-panel iv-detail-map" aria-label="What it touches">
      <h2>What it touches · {value.source?.label ?? value.source?.name ?? 'Recorded infrastructure'}</h2>
      <div className="iv-detail-filters" role="group" aria-label="Infrastructure sectors">
        {['All', ...model.sectors].map(sector => <button key={sector} aria-pressed={selection.sector === sector.toLowerCase()} onClick={() => changeSector(sector.toLowerCase())}>{sector}</button>)}
      </div>
      {nodes.length ? <IncidentDependencyMap key={value.incident?.id} nodes={nodes} edges={value.edges} sourceId={sourceId} visible={model.visible} entityIcons={value.entityIcons ?? entityIcons} attackedSystem={value.sourceSystems?.[0]} watchRelationships={model.watches} selectedId={selectedId} onSelect={select} /> : <p role="status">No infrastructure assets recorded in this analysis.</p>}
    </section>
    <aside className="iv-panel iv-detail-roster" aria-label="Infrastructure roster">
      <h2>Infrastructure</h2><p className="iv-hint">Modeled {formatTime(value.analysis?.createdAt, undefined, 'Time not recorded')} · not observed outages. Select an asset here or on the drawing to see why it matters.</p>
      <div className="iv-detail-scroll" ref={roster}>
        {model.groups.map(group => {
          const items = model.items.filter(item => item.group === group);
          return items.length > 0 && <section key={group}><h3 className="iv-group-caption">{group} · {items.length}</h3>
            {items.map(item => <details key={item.id} data-infrastructure-id={item.id} className={`iv-detail-asset${selectedId === item.id ? ' selected' : ''}`} open={selectedId === item.id}>
              <summary onClick={event => { event.preventDefault(); select(selectedId === item.id ? null : item.id); }}><strong>{item.name}</strong><span className={`tone-${item.state.tone}`}> · {item.state.label}</span><small>{sectorOf(item) ?? 'Unassigned'}{item.idt?.path ? ` · IDT ${item.idt.path}` : ''}</small></summary>
              <p>{item.why}</p><p>Recorded path: {item.pathsText}</p>
              {item.sourceRefs.length > 0 && <p>Sources: {item.sourceRefs.join(' · ')}</p>}
              <button className="command-link" onClick={() => onInspect(item.id)}>Inspect current record in Analyst ↗</button>
            </details>)}
          </section>;
        })}
        {!model.items.length && <p role="status">No infrastructure assets in this sector.</p>}
      </div>
    </aside>
  </section>;
}
