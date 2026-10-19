"""Causal sector links, derived only from immutable captured impact paths.

Version 1 groups equal directed sector/service links across assets, retaining
all traversed dependency IDs and the earliest recorded step. Same-sector hops
remain part of path validation; first-step impacts in the source sector are
not discarded. Watch and merely reachable edges never enter this projection.
"""
from copy import deepcopy
from hashlib import sha256
import json

SECTOR_LINKS_VERSION = 1


def sector_label(entity, rules):
    if entity.get('sector'):
        return entity['sector']
    prefix = entity.get('idt', {}).get('path', '').split('.')[0]
    return next((rule['label'] for rule in rules if entity['type'] in rule.get('types', [])),
                next((rule['label'] for rule in rules if rule['prefix'] == prefix), 'Unclassified'))


def derive_sector_links(run, reference):
    model = run['baselineSnapshot']
    entities = {row['id']: row for row in model['entities']}
    dependencies = {row['id']: row for row in model['dependencies']}
    source = run['seed']['provider']
    labels = {key: sector_label({**row, **reference.get('assets', {}).get(key, {})}, reference.get('sectors', []))
              for key, row in entities.items()}
    # Match the projection's target-sector timing aggregation, not the source
    # window or the geometry of a rendered arrow. Unknown stays unknown.
    entity_windows = {}
    for impact in run['impacts']:
        if impact.get('windowHours') is not None:
            entity_windows.setdefault(impact['entityId'], []).append(impact['windowHours'])
    sector_windows = {}
    for key, windows in entity_windows.items():
        if key in labels:
            sector_windows.setdefault(labels[key], []).append([min(w[0] for w in windows), min(w[1] for w in windows)])
    grouped = {}
    for impact in run['impacts']:
        for path in impact.get('paths', []):
            current, chain = source, []
            for dep_id in path:
                dep = dependencies.get(dep_id)
                if dep is None or dep.get('provider') != current or dep.get('dependent') not in entities:
                    break
                chain.append(dep)
                current = dep['dependent']
            else:
                if not chain or current != impact['entityId']:
                    continue
                for step, dep in enumerate(chain, 1):
                    provider, target = dep['provider'], dep['dependent']
                    if step == 1:
                        kind, start = 'source', source
                    elif labels[provider] != labels[target]:
                        kind, start = 'sector', labels[provider]
                    else:
                        continue
                    service_key = dep['requiredService']
                    service = reference.get('serviceLabels', {}).get(service_key, service_key.replace('_', ' '))
                    key = (kind, start, labels[target], service)
                    row = grouped.setdefault(key, {'step': step, 'dependencyIds': set()})
                    row['step'] = min(row['step'], step)
                    row['dependencyIds'].add(dep['id'])
    links = []
    for key, row in sorted(grouped.items()):
        kind, start, target, service = key
        windows = sector_windows.get(target, [])
        identifier = sha256(json.dumps(key, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        links.append({'id': 'sector-link-' + identifier, 'from': start, 'fromKind': kind,
                      'to': target, 'service': service, 'step': row['step'],
                      'windowHours': [min(w[0] for w in windows), max(w[1] for w in windows)] if windows else None,
                      'dependencyIds': sorted(row['dependencyIds'])})
    return links


def capture_sector_links(run, reference, service_labels=None):
    """Call only for newly computed runs, before their first durable write."""
    refs = {**reference, 'serviceLabels': {**reference.get('serviceLabels', {}), **(service_labels or {})}}
    run['sectorLinks'] = derive_sector_links(run, refs)
    run['sectorLinksVersion'] = SECTOR_LINKS_VERSION
    return run


def capture_for_store(run, store, baseline):
    """Capture planning/reviewed runs with the same configured display data."""
    from .records import RecordsService
    records = RecordsService(store, scenario=baseline)
    return capture_sector_links(run, records.c4_reference, records.reference.get('serviceLabels'))


def projected_sector_links(run, reference):
    # Absence is the legacy marker. An explicitly captured empty list is truth,
    # not permission to infer replacement edges from today's model/vocabulary.
    if 'sectorLinks' in run:
        return deepcopy(run['sectorLinks'])
    return derive_sector_links(run, reference)
