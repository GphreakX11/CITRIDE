"""Read-only semantic inputs for one event, independent of global revisions.

Keep the projection aligned with frontend/incidentFreshness.ts. Traverse provider
outgoing dependencies plus structural/provenance references, never unrelated
siblings or other scenarios. Includes newly added edges, not only captured IDs.
"""
from copy import deepcopy

COLLECTIONS = ('entities', 'events', 'scenarios', 'dependencies', 'serviceFunctions', 'sources', 'assumptions')
LINKS = ('seenOn', 'hostedBy', 'partOf', 'serves', 'locatedIn', 'provider', 'dependent', 'dependentFunction', 'sourceRefs', 'assumptionRefs', 'eventRefs')


def incident_inputs(model, event_id):
    rows = {key: model.get(key, []) for key in COLLECTIONS}
    selected = {event_id}
    scenarios = [r for r in rows['scenarios'] if event_id in r.get('seed', {}).get('eventRefs', [])]
    selected.update(r['id'] for r in scenarios)
    def refs(record):
        for key in LINKS:
            value = record.get(key, [])
            yield from value if isinstance(value, list) else [value]
        assertions = record.get('parameterAssertionRefs', {})
        if isinstance(assertions, dict):
            yield from assertions.values()
        if isinstance(record.get('seed'), dict):
            yield from refs(record['seed'])
    while True:
        previous = set(selected)
        for key, records in rows.items():
            for row in records:
                if key == 'dependencies' and row.get('provider') in selected:
                    selected.add(row['id'])
                if row['id'] in selected:
                    selected.update(refs(row))
        if selected == previous:
            break
    result = {key: sorted((deepcopy(r) for r in records if r['id'] in selected), key=lambda r: r['id'])
              for key, records in rows.items()}
    for key in ('defaultEvaluationHour', 'defaultHorizonHours'):
        if key in model:
            result[key] = model[key]
    return result
