import { object, text, type RecordItem } from './scriptedTypes.ts';
import { pathToSource, sectorOf, watchAssetsFor } from './incidentPresentation.ts';
import type { ConsequenceProjection } from './consequencesModel.ts';

/** Presentation of central API records; no model execution or sample-file reads. */
export function incidentViewModel(record: RecordItem, projection: ConsequenceProjection | null, records: { watchAssets?: readonly RecordItem[] }, sector = 'all') {
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
  return {
    service: typeof service.value === 'number' ? `${service.value.toLocaleString()} ${text(service.unit)}${service.note ? ` · ${text(service.note)}` : ''}` : null,
    economic: Array.isArray(dollars) && dollars.length === 2 ? `$${Number(dollars[0]).toLocaleString()}–$${Number(dollars[1]).toLocaleString()} / day · ${text(economic.basis, 'planning estimate')}` : null,
    sectors, visible,
    watch: watchAssetsFor(record, records),

  };
}
