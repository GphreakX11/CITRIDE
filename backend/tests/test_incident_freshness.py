"""Incident-scoped freshness, not just immutable-record preservation."""
from copy import deepcopy
import pytest
from test_overnight_checks import store, legacy, no_remote_configuration, install, open_case, reviewed, WATER
from citride.records import RecordsService


def intake(store):
    with store._locked():
        dataset = store._load()
        RecordsService(store)._automatic_analysis(dataset, {WATER})
        store._save(dataset)


def test_unrelated_install_does_not_recompute_water_preliminary(legacy):
    before = [r for r in legacy.runs() if r.get('incidentId') == WATER]
    assert len(before) == 1
    install(legacy)
    intake(legacy)
    after = [r for r in legacy.runs() if r.get('incidentId') == WATER]
    assert after == before


@pytest.mark.parametrize('collection,identifier,field,value', [
    ('events', 'event-dosing', 'label', 'Changed water evidence'),
    ('dependencies', 'dep-water-hospital', 'usableBackupMaxHours', 9),
])
def test_scoped_freshness_changes_only_affected_incident(store, collection, identifier, field, value):
    from citride.incident_freshness import incident_inputs
    model = store.baseline()
    before = deepcopy(model)
    # Select a real water edge rather than assuming a display-specific ID.
    row = (next(r for r in model[collection] if r['id'] == identifier) if collection == 'events'
           else next(r for r in model[collection] if r['provider'] == 'utility-a'))
    row[field] = value
    model['baselineRevision'] += 1
    assert incident_inputs(before, 'event-dosing') != incident_inputs(model, 'event-dosing')
    assert incident_inputs(before, 'poh-ev-cred') == incident_inputs(model, 'poh-ev-cred')


def test_parameter_assertion_evidence_is_a_scoped_input(store):
    from citride.incident_freshness import incident_inputs
    model = store.baseline()
    edge = next(r for r in model['dependencies'] if r['provider'] == 'utility-a')
    edge['parameterAssertionRefs'] = {'usableBackupMaxHours': 'freshness-assumption'}
    model['assumptions'].append({'id': 'freshness-assumption', 'note': 'before'})
    before = incident_inputs(model, 'event-dosing')
    model['assumptions'][-1]['note'] = 'after'
    assert before != incident_inputs(model, 'event-dosing')


@pytest.mark.parametrize('own_change', [False, True])
def test_real_legacy_fingerprint_fallback_preserves_runs(legacy, own_change):
    from hashlib import sha256
    import json
    from citride.legacy_record_time import project_saved_record
    from citride.source_install import _graph_id
    with legacy._locked():
        dataset = legacy._load()
        incident = next(r for r in legacy._records(dataset, 'statewideIncidents') if r['id'] == WATER)
        run = next(r for r in legacy._records(dataset, 'run') if r.get('incidentId') == WATER)
        snapshot = run['baselineSnapshot']
        from datetime import datetime
        service = RecordsService(legacy)
        anchor = datetime.fromisoformat(incident.get('sampleDataAnchor', service._anchor(service._meta(dataset))).replace('Z', '+00:00'))
        payload = {'incident': {k: v for k, v in project_saved_record(incident).items() if k not in {'caseId', 'runId', 'openedAt', 'history'}},
                   'model': snapshot, 'anchor': anchor.isoformat(), 'scenarioId': run['scenarioId']}
        fingerprint = sha256(json.dumps(payload, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        dataset.remove_graph(_graph_id('run', run['id']))
        run.update(id='preliminary-' + fingerprint, inputFingerprint=fingerprint)
        legacy._record_graph(dataset, 'run', run)
        legacy._save(dataset)
    original = deepcopy(legacy.runs())
    install(legacy)
    if own_change:
        with legacy._locked():
            dataset = legacy._load()
            model = legacy._baseline(dataset)
            next(r for r in model['events'] if r['id'] == 'event-dosing')['label'] += ' changed'
            model['baselineRevision'] += 1
            legacy._write_baseline(dataset, model)
            legacy._save(dataset)
    intake(legacy)
    assert all(legacy.run(r['id']) == r for r in original)
    assert len([r for r in legacy.runs() if r.get('incidentId') == WATER]) == 1 + own_change


def test_context_and_legacy_run_freshness_are_read_only(legacy):
    from citride.incident_freshness import incident_inputs
    from citride.incident_context import incident_context
    from citride.command import CommandService
    case = reviewed(legacy, open_case(legacy))
    runs = deepcopy(legacy.runs())
    old = legacy.baseline()
    install(legacy)
    current = legacy.baseline()
    assert incident_inputs(old, 'event-dosing') == incident_inputs(current, 'event-dosing')
    assert incident_context(current, 'event-dosing', freshness=True)['freshnessInputs'] == incident_inputs(current, 'event-dosing')
    assert CommandService(legacy).get(case['id']) == case
    assert all(legacy.run(r['id']) == r for r in runs)
    from fastapi.testclient import TestClient
    from citride.api import create_app
    before_bytes = legacy.path.read_bytes()
    with TestClient(create_app(legacy.data_dir, legacy.scenario_path)) as client:
        for _ in range(2):
            result = client.get('/v1/incident-context', params={'eventId': 'event-dosing', 'freshness': 'true'})
            assert result.status_code == 200
            assert result.json()['freshnessInputs'] == incident_inputs(current, 'event-dosing')
    assert legacy.path.read_bytes() == before_bytes
    # Repeated reads must not append an automatically refreshed run.
    assert incident_context(current, 'event-dosing') == incident_context(current, 'event-dosing')
    assert all(legacy.run(r['id']) == r for r in runs)
