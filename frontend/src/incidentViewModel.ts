import { object, text, type RecordItem } from './scriptedTypes.ts';
import { pathToSource, sectorOf, watchAssetsFor } from './incidentPresentation.ts';
import type { ConsequenceProjection } from './consequencesModel.ts';
import type { Bootstrap } from './types.ts';
import { utilityForEvent, peopleServed } from './whoActsFirst.ts';

/** Presentation of central API records; no model execution or sample-file reads. */
export function incidentViewModel(record: RecordItem, projection: ConsequenceProjection | null, records: { watchAssets?: readonly RecordItem[]; assetStatuses?: readonly RecordItem[] }, sector = 'all', data?: Bootstrap) {
  const service = object(record.serviceAffected ?? projection?.serviceAffected);
  const economic = object(record.economicImpactPerDay ?? projection?.economic);
  const dollars = economic.usd ?? economic.dailyUsd;
  const nodes = projection?.nodes ?? [];
  const sectors = [...new Set(nodes.map(node => sectorOf(node)).filter((s): s is string => !!s))];
  const visible = new Set<string>();
  for (const node of nodes) if (sector === 'all' || sectorOf(node)?.toLowerCase() === sector) {
    visible.add(node.id);
    for (const id of pathToSource(node.id, projection)) visible.add(id);
  }
  if (projection?.source?.id) visible.add(projection.source.id);
  const probedIds = new Set((records.assetStatuses ?? []).filter(s=>s.incidentId===record.id && ['probed','probing_only'].includes(s.status ?? '')).map(s=>s.entityId).filter((s):s is string=>!!s));
  if(data) for(const event of data.events ?? []) if(record.linkedEventIds?.includes(event.id) && ['probed','probing_only'].includes(String(object(event).observation))) { const id=utilityForEvent(event,data); if(id)probedIds.add(id); }
  const probed = [...probedIds].map(id=>({id,label:data?.entities.find(e=>e.id===id)?.label ?? id,people:data ? peopleServed(id,data) : null}));
  const probedPeople=probed.length && probed.every(p=>p.people!=null) ? probed.reduce((sum,p)=>sum+(p.people ?? 0),0) : null;
  return {
    probed,probedPeople,
    service: typeof service.value === 'number' ? `${service.value.toLocaleString()} ${text(service.unit)}${service.note ? ` · ${text(service.note)}` : ''}` : null,
    economic: Array.isArray(dollars) && dollars.length === 2 ? `$${Number(dollars[0]).toLocaleString()}–$${Number(dollars[1]).toLocaleString()} / day · ${text(economic.basis, 'planning estimate')}` : null,
    sectors, visible,
    watch: (watchAssetsFor(record, records).length ? watchAssetsFor(record, records) : (projection?.watchAssets ?? []).map((w,i)=>({...w,id:`projection-watch-${i}`}))) as RecordItem[],

  };
}
