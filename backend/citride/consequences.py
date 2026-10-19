"""Shared automatic intake and immutable analysis precedence (no engine changes)."""
from copy import deepcopy
from datetime import timedelta
from hashlib import sha256
import json

from .engine import compute_run
from .scripted_validation import aware_time
from .legacy_record_time import project_saved_record


def preliminaryScenarioFor(incident, model, rules):
    """Resolve exactly one provider/loss scenario, using records, never names.

    Explicit scenario IDs are a constraint, not permission to bypass provider,
    event and loss compatibility. Ambiguous provider/scenario => no model.
    """
    entities = {r['id']: r for r in model['entities']}
    events = [r for r in model['events'] if r['id'] in incident.get('linkedEventIds', [])]
    def ancestors(identifier):
        seen = set()
        while identifier in entities and identifier not in seen:
            seen.add(identifier)
            entity = entities[identifier]
            yield identifier
            identifier = entity.get('hostedBy') or entity.get('partOf')
    provider = incident.get('sourceProvider')
    if provider is None:
        candidates = {s['seed']['provider'] for s in model['scenarios'] for e in events
                      if e['id'] in s['seed'].get('eventRefs', []) and s['seed']['provider'] in set(ancestors(e.get('seenOn')))}
        if len(candidates) != 1:
            return None
        provider = next(iter(candidates))
    if provider not in entities:
        return None
    matches = []
    for event in sorted(events, key=lambda e: (e.get('relativeTimeHours', 0), e['id'])):
        for rule in rules:
            if entities[provider]['type'] not in rule['providerTypes'] or event.get('observation') not in rule['observations']:
                continue
            for scenario in model['scenarios']:
                seed = scenario['seed']
                if seed['provider'] == provider and seed['lossType'] == rule['lossType'] and (not incident.get('preliminaryScenario') or scenario['id'] == incident['preliminaryScenario']):
                    matches.append((scenario, event))
    if len({s['id'] for s, _ in matches}) != 1:
        return None
    return matches[0] if matches else None


def bestAnalysisFor(incident, runs, cases):
    """Captured run wins even when a newer preliminary exists. Detached return."""
    indexed = {r['id']: r for r in runs}
    linked = [c for c in cases if c.get('id') == incident.get('caseId') or c.get('eventId') in incident.get('linkedEventIds', [])]
    reviewed = [indexed[c['runId']] for c in linked if c.get('runId') in indexed and indexed[c['runId']].get('kind') != 'preliminary']
    if reviewed:
        return {**deepcopy(max(reviewed, key=lambda r: (r.get('createdAt', ''), r['id']))), 'kind': 'reviewed'}
    preliminary = [r for r in runs if r.get('incidentId') == incident['id'] and r.get('kind') == 'preliminary']
    return deepcopy(max(preliminary, key=lambda r: (r.get('computedAt', r.get('createdAt', '')), r['id']))) if preliminary else None


def automatic_intake(store, dataset, incidents, model, reference, now, anchor, service_labels=None):
    """One transaction-neutral path for seed, reload, feed create/update."""
    changed = False
    existing = store._records(dataset, 'run')
    for incident in incidents:
        match = preliminaryScenarioFor(incident, model, reference['eventLossRules'])
        if match is None:
            # Invalidate the selection without erasing immutable past runs.
            continue
        scenario, event = match
        payload = {'incident': {k: v for k, v in project_saved_record(incident).items() if k not in {'caseId', 'runId', 'openedAt', 'history'}},
                   'model': model, 'anchor': anchor.isoformat(), 'scenarioId': scenario['id']}
        digest = sha256(json.dumps(payload, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        identifier = 'preliminary-' + digest
        if any(r['id'] == identifier for r in existing):
            continue
        horizon = scenario.get('horizonHours', model['defaultHorizonHours'])
        run = compute_run(deepcopy(model), {'scenarioId': scenario['id'], 'evaluationHour': model['defaultEvaluationHour'], 'horizonHours': horizon, 'overrides': []}, identifier)
        # This is the authored trigger timestamp, not a claim the server was
        # running then. computedAt records when computation actually happened.
        from datetime import datetime
        trigger = datetime.fromisoformat(event['timestamp'].replace('Z', '+00:00')) if event.get('origin') not in ('scripted', 'simulated') and aware_time(event.get('timestamp')) else anchor + timedelta(hours=event.get('relativeTimeHours', 0))
        if incident.get('origin') in ('scripted', 'simulated') and aware_time(incident.get('reportedAt')):
            trigger = datetime.fromisoformat(incident['reportedAt'].replace('Z', '+00:00'))
        run.update(kind='preliminary', trigger='automatic', incidentId=incident['id'], triggerEventId=event['id'],
                   createdAt=(trigger + timedelta(minutes=1)).isoformat(), computedAt=now.isoformat(),
                   effectiveAt=(trigger + timedelta(minutes=1)).isoformat(), triggerEventAt=trigger.isoformat(),
                   createdAtBasis='scripted effective analysis time; computedAt is actual execution time' if incident.get('origin') in ('scripted', 'simulated') else 'trigger plus one minute', inputFingerprint=digest)
        from .sector_links import capture_sector_links
        capture_sector_links(run, reference, service_labels)
        store._record_graph(dataset, 'run', run)
        existing.append(run)
        changed = True
    return changed
