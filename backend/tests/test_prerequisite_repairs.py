"""Prerequisite-only acceptance; every store/config copy belongs to tmp_path."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import ast
from pathlib import Path
import shutil

from fastapi.testclient import TestClient
import pytest

from citride.api import create_app
from citride.command import CommandService
from citride.consequence_projection import ConsequenceService
from citride.records import RecordsService
from citride.scripted_validation import validate_scripted
from citride.storage import Repository

ROOT = Path(__file__).resolve().parents[2]
RETIRED = {'storyNow', 'storyClock', 'storyStartedAt', 'wallStartedAt', 'openedStoryAt', 'storyTimezone'}


def assert_real_contract(value):
    if isinstance(value, dict):
        assert not RETIRED.intersection(value)
        for child in value.values():
            assert_real_contract(child)
    elif isinstance(value, list):
        for child in value:
            assert_real_contract(child)


@pytest.fixture
def state(tmp_path, monkeypatch):
    for key in ('DATABASE_URL', 'CITRIDE_DATABASE_URL', 'TEST_DATABASE_URL', 'VERCEL', 'VERCEL_ENV', 'CITRIDE_DEMO_PASSWORD', 'CITRIDE_DEMO_USERNAME'):
        monkeypatch.delenv(key, raising=False)
    inputs = tmp_path / 'inputs'
    inputs.mkdir()
    for relative in ('scenario.json', 'reference.json', 'scripted/watershed_beta.json', 'scripted/c4_reference.json', 'scripted/port_houston.json'):
        target = inputs / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / 'data' / relative, target)
    clock = [datetime(2032, 4, 2, 12, tzinfo=timezone.utc)]
    monkeypatch.setattr(RecordsService, '_wall_now', lambda self: clock[0])
    monkeypatch.setattr('citride.command._timestamp', lambda: clock[0].isoformat())
    store = Repository(tmp_path / 'state', inputs / 'scenario.json')
    return store, clock, inputs


def configure(inputs, identifier):
    path = inputs / 'scripted/c4_reference.json'
    config = json.loads(path.read_text())
    if identifier is None:
        config.pop('featuredIncidentId', None)
    else:
        config['featuredIncidentId'] = identifier
    path.write_text(json.dumps(config))


def test_api_removes_clock_aliases_and_exposes_featured_configuration(state):
    store, clock, _ = state
    assert not hasattr(RecordsService(store), 'story_now')
    with TestClient(create_app(store.data_dir, store.scenario_path)) as client:
        for path in ('/health', '/v1/command/records', '/v1/workspace', '/v1/command/consequences'):
            response = client.get(path)
            assert response.status_code == 200, response.text
            body = response.json()
            assert_real_contract(body)
            envelope = body['records'] if path == '/v1/workspace' else body
            assert envelope['now'] == clock[0].isoformat()
            if path != '/health':
                assert envelope['featuredIncidentId'] == 'TX-26-0412'


@pytest.mark.parametrize('configured', ['INC-2026-1002-POH', 'CUSTOMER-NORTH-0007'])
def test_alternate_configured_incident_and_explicit_override(state, configured):
    store, _, inputs = state
    core = RecordsService(store)
    alternate = deepcopy(core.records()['statewideIncidents'][0])
    alternate.update(id='CUSTOMER-NORTH-0007', title='Northern power incident', severity='low', status='open', linkedEventIds=[], location={'label': 'Northern district'})
    for key in ('caseId', 'sourceProvider', 'preliminaryScenario'):
        alternate.pop(key, None)
    core.ingest_records({'statewideIncidents': [alternate]}, 'partner-feed')
    configure(inputs, configured)
    core = RecordsService(store)
    service = ConsequenceService(store, core)
    before = store.path.read_bytes()
    assert core.records()['featuredIncidentId'] == configured
    assert service.view()['featuredIncidentId'] == configured
    assert service.view()['incident']['id'] == configured
    assert service.view('TX-26-0412')['incident']['id'] == 'TX-26-0412'
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('configured', [None, 'missing-incident', 'TX-26-0398'])
def test_missing_or_closed_featured_falls_back_to_highest_severity_open(state, configured):
    store, _, inputs = state
    configure(inputs, configured)
    view = ConsequenceService(store).view()
    assert view['featuredIncidentId'] == configured
    assert view['incident']['id'] == 'INC-2026-1002-POH'


def test_fallback_ties_are_deterministic_and_no_open_means_no_default(state):
    store, _, inputs = state
    configure(inputs, None)
    with store._locked():
        dataset = store._load()
        saved_incidents = store._records(dataset, 'statewideIncidents')
        for incident in saved_incidents:
            incident.update(status='closed', severity='critical')
            store._record_graph(dataset, 'statewideIncidents', incident)
        for identifier in ('ZZ-02', 'AA-01'):
            item = {**saved_incidents[0], 'id': identifier, 'status': 'open', 'linkedEventIds': [],
                    'startedAt': '2032-04-02T11:00:00Z' if identifier == 'ZZ-02' else '2032-04-02T10:00:00Z'}
            store._record_graph(dataset, 'statewideIncidents', item)
        # An unsupported persisted status must not be treated as open.
        store._record_graph(dataset, 'statewideIncidents', {**saved_incidents[0], 'id': '00-UNKNOWN', 'status': 'invalid', 'linkedEventIds': []})
        store._save(dataset)
    assert ConsequenceService(store).view()['incident']['id'] == 'AA-01'
    with store._locked():
        dataset = store._load()
        for identifier in ('ZZ-02', 'AA-01'):
            item = store._record(dataset, 'statewideIncidents', identifier)
            item['status'] = 'closed'
            store._record_graph(dataset, 'statewideIncidents', item)
        store._save(dataset)
    view = ConsequenceService(store).view()
    assert view['incident'] is None
    assert view['analysis'] is None
    assert view['featuredIncidentId'] is None
    # Explicit historical selection still works; only automatic selection is open-only.
    assert ConsequenceService(store).view('TX-26-0398')['incident']['status'] == 'closed'


def test_reloads_reanchor_and_persist_port_and_both_preliminaries(state):
    store, clock, _ = state
    first = RecordsService(store).records()
    records = first
    for iteration in range(2):
        anchor = clock[0] - timedelta(hours=1)
        records = RecordsService(store).records()
        assert records['sampleDataAnchor'] == anchor.isoformat()
        water = next(row for row in records['statewideIncidents'] if row['id'] == 'TX-26-0412')
        port = next(row for row in records['statewideIncidents'] if row['id'] == 'INC-2026-1002-POH')
        assert datetime.fromisoformat(water['startedAt']) == anchor
        assert datetime.fromisoformat(port['reportedAt']) == anchor + timedelta(hours=0.27)
        with store._locked():
            dataset = store._load()
            assert store._record(dataset, 'statewideIncidents', port['id'])['reportedAt'] == port['reportedAt']
            runs = store._records(dataset, 'run')
        assert {run['incidentId'] for run in runs if run['kind'] == 'preliminary'} == {water['id'], port['id']}
        before = store.path.read_bytes()
        restarted = Repository(store.data_dir, store.scenario_path)
        assert RecordsService(restarted).records() == records
        assert restarted.path.read_bytes() == before
        if iteration == 0:
            clock[0] += timedelta(hours=1)
            store.reset_demo(1, 'owned-reload')
    assert first['sampleDataAnchor'] != records['sampleDataAnchor']


def test_legacy_projection_preserves_records_cases_runs_and_bytes(state):
    store, clock, _ = state
    commands = CommandService(store)
    case = commands.create({'eventId': 'event-dosing', 'title': 'Saved review', 'priority': 'high', 'expectedBaselineRevision': 1, 'clientRequestId': 'legacy-case'})
    case_before = commands.get(case['id'])
    with store._locked():
        dataset = store._load()
        meta = store._record(dataset, 'scripted-meta', 'records-meta')
        meta.pop('sampleDataAnchor')
        meta.update(incidentOrigin='2025-01-01T00:00:00+00:00', storyStartedAt='2025-01-01T01:00:00+00:00', wallStartedAt='2031-01-01T12:00:00+00:00')
        meta['config']['timing'] = {'storyClock': {'startRelativeHours': 1, 'advancesWithWallClock': True}, 'storyTimezone': 'America/Chicago'}
        store._record_graph(dataset, 'scripted-meta', meta)
        contact = store._record(dataset, 'contacts', 'contact-1')
        contact.pop('at', None)
        contact.pop('timeOrigins', None)
        contact.pop('sampleDataAnchor', None)
        contact.pop('openedAt', None)
        contact.update(openedStoryAt='2025-01-01T02:00:00+00:00', offsetMinutes=15)
        store._record_graph(dataset, 'contacts', contact)
        store._save(dataset)
    before = store.path.read_bytes()
    runs = deepcopy(store.runs())
    core = RecordsService(store)
    core.initialize()
    records = core.records()
    assert_real_contract(records)
    migrated = next(row for row in records['contacts'] if row['id'] == contact['id'])
    assert migrated['openedAt'] == contact['openedStoryAt']
    assert migrated['at'] == '2025-01-01T02:15:00+00:00'
    assert records['sampleDataAnchor'] == '2025-01-01T00:00:00+00:00'
    assert records['now'] == clock[0].isoformat()
    assert commands.get(case['id']) == case_before
    assert store.runs() == runs
    with TestClient(create_app(store.data_dir, store.scenario_path)) as client:
        for path in ('/health', '/v1/command/records', '/v1/workspace', '/v1/command/consequences'):
            response = client.get(path)
            assert response.status_code == 200, response.text
            assert_real_contract(response.json())
            assert store.path.read_bytes() == before


def test_canonical_opened_at_wins_over_legacy_without_changing_input():
    from citride.record_time import resolve_record_times
    old = {'openedAt': '2030-01-01T00:00:00Z', 'openedStoryAt': '2025-01-01T00:00:00Z', 'offsetMinutes': 10}
    original = deepcopy(old)
    value = resolve_record_times(old, '2024-01-01T00:00:00Z')
    assert old == original
    assert value['at'] == '2030-01-01T00:10:00+00:00'
    assert_real_contract(value)


def test_opening_case_stamps_actual_time_and_preserves_frozen_records(state):
    store, clock, _ = state
    core = RecordsService(store)
    before = core.records()['contacts']
    clock[0] += timedelta(minutes=30)
    case = CommandService(store).create({'eventId': 'event-dosing', 'title': 'Current review', 'priority': 'high', 'expectedBaselineRevision': 1, 'clientRequestId': 'current-case'})
    records = core.records(case['id'])
    assert records['statewideIncidents'][0]['openedAt'] == case['createdAt'] == clock[0].isoformat()
    assert {r['id']: r.get('at') for r in records['contacts']} == {r['id']: r.get('at') for r in before}
    assert_real_contract(records)


def test_scripted_timing_is_anchor_only_and_validates_opened_at(state):
    store, _, inputs = state
    data = json.loads((inputs / 'scripted/watershed_beta.json').read_text())
    assert data['timing'] == {'note': 'Sample record times are offsets from the sample-data anchor (one hour before load).'}
    core = RecordsService(store)
    assert validate_scripted(data, core._validation_scenario) == []
    data['contacts'][0]['openedAt'] = 'not-a-time'
    assert any('openedAt' in error for error in validate_scripted(data, core._validation_scenario))


def test_missing_main_store_incident_is_never_synthesized_from_source(state):
    from rdflib import URIRef
    from citride.storage import NotFoundError
    store, _, inputs = state
    configure(inputs, 'INC-2026-1002-POH')
    with store._locked():
        dataset = store._load()
        dataset.remove_graph(URIRef('urn:citride:graph:statewideIncidents:INC-2026-1002-POH'))
        for incident in store._records(dataset, 'statewideIncidents'):
            incident['status'] = 'closed'
            store._record_graph(dataset, 'statewideIncidents', incident)
        store._save(dataset)
    before = store.path.read_bytes()
    service = ConsequenceService(store)
    assert service.view()['incident'] is None
    with pytest.raises(NotFoundError):
        service.view('INC-2026-1002-POH')
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('field,target,unit', [
    ('relativeTimeHours', 'at', 'hours'),
    ('startedRelativeHours', 'startedAt', 'hours'),
    ('reportedRelativeHours', 'reportedAt', 'hours'),
    ('closedRelativeHours', 'closedAt', 'hours'),
    ('offsetMinutes', 'at', 'minutes'),
    ('dueOffsetMinutes', 'dueAt', 'minutes'),
    ('doneOffsetMinutes', 'doneAt', 'minutes'),
    ('etaOffsetMinutes', 'etaAt', 'minutes'),
])
def test_all_relative_fields_resolve_once_and_absolute_timestamps_win(field, target, unit):
    from citride.record_time import resolve_record_times
    anchor = datetime(2032, 4, 2, tzinfo=timezone.utc)
    raw = {field: 2}
    value = resolve_record_times(raw, anchor.isoformat())
    assert datetime.fromisoformat(value[target]) == anchor + timedelta(**{unit: 2})
    assert raw == {field: 2}
    assert resolve_record_times(value, (anchor + timedelta(days=1)).isoformat()) == value
    explicit = {field: 2, target: '2024-01-01T00:00:00Z'}
    assert resolve_record_times(explicit, anchor.isoformat())[target] == explicit[target]


def test_retired_timing_is_not_accepted_as_new_intake_configuration(state):
    store, _, _ = state
    core = RecordsService(store)
    data = deepcopy(core.scripted)
    data['timing']['storyClock'] = {'startRelativeHours': 1, 'advancesWithWallClock': True}
    assert any('timing' in error for error in validate_scripted(data, core._validation_scenario))


def test_active_clock_api_has_no_retired_aliases_or_duplicate_literal_keys():
    for path in (ROOT / 'backend/citride').glob('*.py'):
        text = path.read_text()
        assert not any(name in text for name in ('storyNow', 'storyClock', 'story_now'))
        if path.name != 'legacy_record_time.py':
            assert not any(name in text for name in ('openedStoryAt', 'storyStartedAt', 'wallStartedAt'))
        assert 'TX-26-0412' not in text
        for node in ast.walk(ast.parse(text)):
            if isinstance(node, ast.Dict):
                keys = [key.value for key in node.keys if isinstance(key, ast.Constant) and isinstance(key.value, str)]
                assert len(keys) == len(set(keys)), (path.name, node.lineno, keys)
    def unique_pairs(pairs):
        assert len(pairs) == len(dict(pairs)), pairs
        return dict(pairs)
    for name in ('c4_reference.json', 'watershed_beta.json'):
        json.loads((ROOT / 'data/scripted' / name).read_text(), object_pairs_hook=unique_pairs)
