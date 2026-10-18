"""Unsaved reference projections for older stores; never mutate a repository."""
from copy import deepcopy
from hashlib import sha256
import json

from .consequences import preliminaryScenarioFor
from .engine import compute_run


def reference_preview(incident, model, reference, now):
    match = preliminaryScenarioFor(incident, model, reference['eventLossRules'])
    if match is None:
        return None
    scenario, event = match
    fingerprint = sha256(json.dumps({'incident': incident, 'model': model}, sort_keys=True).encode()).hexdigest()
    run = compute_run(deepcopy(model), {
        'scenarioId': scenario['id'],
        'evaluationHour': model['defaultEvaluationHour'],
        'horizonHours': scenario.get('horizonHours', model['defaultHorizonHours']),
        'overrides': [],
    }, 'reference-preview-' + fingerprint)
    run.update(kind='reference_preview', persisted=False, referenceOnly=True,
               incidentId=incident['id'], createdAt=now, computedAt=now,
               triggerEventId=event['id'], triggerEventAt=event.get('timestamp'),
               createdAtBasis='Actual computation time of an unsaved read-only reference projection; not historical case analysis.')
    return run
