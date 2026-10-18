"""C4 foundation checks: owned tmp_path RDF only; no external storage."""
import base64
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from citride.api import create_app
from citride.command import CommandService
from citride.consequence_projection import ConsequenceService
from citride.records import RecordsService
from citride.storage import Repository

ROOT = Path(__file__).resolve().parents[2]

@pytest.fixture
def store(tmp_path):
    return Repository(tmp_path / 'state', ROOT / 'data/scenario.json')


def test_port_all_seven_original_windows_and_nonaffected(store):
    service = ConsequenceService(store)
    view = service.view('INC-2026-1002-POH')
    expected = json.loads((ROOT / 'data/scripted/port_houston.json').read_text())['expectedWindows']
    nodes = {n['id']: n for n in view['nodes']}
    numeric = {k: v for k, v in expected.items() if isinstance(v, list)}
    assert len(numeric) == 7
    for identifier, window in numeric.items():
        assert nodes[identifier]['windowHours'] == window
    assert nodes['harris-ems']['notAffected']
    assert nodes['grid-houston']['upstream']
    assert nodes['grid-houston']['windowHours'] is None
    assert view['atRisk'] == 8  # modeled entities, never the unsupported target 14
    assert store.baseline()['defaultScenarioId'] == 'unsafe-water'
    assert service.view()['incident']['id'] == 'TX-26-0412'
    assert service.view()['atRisk'] == 3


def test_authenticated_get_is_read_only(tmp_path, monkeypatch):
    monkeypatch.setenv('CITRIDE_DEMO_PASSWORD', 'c4-test-only')
    state = tmp_path / 'state'
    with TestClient(create_app(state)) as client:
        assert client.get('/v1/command/consequences').status_code == 401
        assert not state.exists()
        client.headers['Authorization'] = 'Basic ' + base64.b64encode(b'demo:c4-test-only').decode()
        response = client.get('/v1/command/consequences', params={'incidentId': 'INC-2026-1002-POH'})
        assert response.status_code == 200, response.text
        view = response.json()
        assert view['analysis']['kind'] == 'preliminary'
        assert view['operationsTimeZone'] == 'America/Chicago'
        assert datetime.fromisoformat(view['now']).utcoffset().total_seconds() == 0
        before = (state / 'citride.nq').read_bytes()
        assert client.get('/v1/command/consequences').status_code == 200
        assert client.get('/v1/command/consequences?incidentId=absent').status_code == 404
        assert client.get('/v1/command/consequences?incidentId=bad%20id').status_code == 422
        assert (state / 'citride.nq').read_bytes() == before


def test_legacy_startup_does_not_persist_analysis_or_migrate(store):
    with store._locked():
        ds = store._load()
        meta = store._record(ds, 'scripted-meta', 'records-meta')
        meta.pop('sampleDataAnchor')
        meta['incidentOrigin'] = '2025-01-01T00:00:00+00:00'
        store._record_graph(ds, 'scripted-meta', meta)
        for graph in list(ds.graphs()):
            if str(graph.identifier).startswith('urn:citride:graph:run:'):
                ds.remove_graph(graph.identifier)
        store._save(ds)
    before = store.path.read_bytes()
    core = RecordsService(store)
    core.initialize()
    view = ConsequenceService(store, core).view()
    assert view['analysis']['kind'] == 'reference_preview'
    assert view['analysis']['persisted'] is False
    assert view['analysis']['referenceOnly'] is True
    assert store.runs() == []
    assert store.path.read_bytes() == before
    # All read surfaces must preserve an already populated, analysis-free store.
    with TestClient(create_app(store.data_dir, store.scenario_path)) as client:
        for path in ('/v1/command/records', '/v1/workspace', '/health', '/v1/command/consequences'):
            assert client.get(path).status_code == 200
            assert store.path.read_bytes() == before
        assert client.get('/v1/cascade-runs').json()['runs'] == []


def test_intake_idempotent_capture_precedence_and_frozen_times(store):
    core = RecordsService(store)
    before = deepcopy(store.runs())
    records = core.records()
    incident = next(i for i in records['statewideIncidents'] if i['id'] == 'TX-26-0412')
    with store._locked():
        raw = store._record(store._load(), 'statewideIncidents', incident['id'])
    core.ingest_records({'statewideIncidents': [raw]}, 'scripted')
    assert store.runs() == before
    commands = CommandService(store)
    case = commands.create({'eventId': 'event-dosing', 'title': 'C4 isolated review', 'priority': 'high', 'expectedBaselineRevision': 1, 'clientRequestId': 'c4-create'})
    reviewed = commands.act(case['id'], {'action': 'analyze', 'scenarioId': 'unsafe-water', 'evaluationHour': 1, 'horizonHours': 12, 'expectedVersion': case['version'], 'clientRequestId': 'c4-analyze'})
    view = ConsequenceService(store, core).view()
    assert view['analysis']['kind'] == 'reviewed'
    assert view['incident']['startedAt'] == incident['startedAt']
    for run in before:
        assert store.run(run['id']) == run
    assert reviewed['runSnapshot']['kind'] == 'reviewed'
    assert core.records()['now'] != '2025-01-01T00:00:00+00:00'


def test_clock_rejects_naive_datetime(store):
    core = RecordsService(store, now=lambda: datetime(2030, 1, 1))
    from citride.storage import InvalidModelError
    with pytest.raises(InvalidModelError, match='aware'):
        core.now()


def test_legacy_clock_metadata_never_simulates_now(store):
    actual = datetime(2030, 1, 1, 6, tzinfo=timezone(timedelta(hours=6)))
    core = RecordsService(store, now=lambda: actual)
    with store._locked():
        dataset = store._load()
        meta = store._record(dataset, 'scripted-meta', 'records-meta')
        meta['storyStartedAt'] = '2025-01-01T00:00:00Z'
        store._record_graph(dataset, 'scripted-meta', meta)
        store._save(dataset)
    before = store.path.read_bytes()
    envelope = core.records()
    expected = actual.astimezone(timezone.utc).isoformat()
    assert envelope['now'] == envelope['storyNow'] == core.story_now() == expected
    assert envelope['timing']['storyClock'] == {
        'deprecated': True, 'now': expected, 'operationsTimeZone': 'America/Chicago',
    }
    assert store.path.read_bytes() == before


def test_sample_anchor_and_explicit_reset_are_isolated(store):
    original = RecordsService(store).records()['sampleDataAnchor']
    before = deepcopy(store.runs())
    RecordsService(store, now=lambda: datetime(2035, 1, 1, tzinfo=timezone.utc)).initialize()
    assert RecordsService(store).records()['sampleDataAnchor'] == original
    assert store.runs() == before
    store.reset_demo(1, 'c4-test-reset')
    assert store.baseline()['defaultScenarioId'] == 'unsafe-water'
    assert {r['scenarioId'] for r in store.runs()} == {'unsafe-water', 'port-terminal-down'}
    assert ConsequenceService(store).view()['analysis']['kind'] == 'preliminary'


def test_packaging_includes_c4_inputs(tmp_path, monkeypatch):
    from importlib.util import module_from_spec, spec_from_file_location
    spec = spec_from_file_location('c4_prepare', ROOT / 'backend/scripts/prepare_vercel.py')
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, 'TARGET_ROOT', tmp_path / 'bundle')
    module.main()
    from citride.consequence_model import load_c4
    ref, port = load_c4(tmp_path / 'bundle/scenario.json')
    assert ref['operationsTimeZone'] == 'America/Chicago'
    assert port['expectedWindows']['houston-water-plants'] == [18, 24]
