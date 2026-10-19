"""Explicit source adoption regression: all state is isolated under tmp_path."""
from copy import deepcopy
from pathlib import Path
import pytest
from citride.records import RecordsService
from citride.storage import Repository, InvalidModelError, ConflictError

ROOT = Path(__file__).resolve().parents[2]
INCIDENT = 'INC-2026-1002-POH'

@pytest.fixture
def store(tmp_path):
    return Repository(tmp_path / 'state', ROOT / 'data/scenario.json')

def test_pending_is_not_a_recorded_decision_and_aliases_resolve(store):
    core = RecordsService(store)
    rows = core.records(INCIDENT)
    assert rows['decisions'] == []
    pending = rows['pendingDecisions'][0]
    assert pending['optionId'] == 'opt-isao-energy-advisory'
    assert pending['status'] == 'pending'
    assert 'decision' not in pending and 'decidedBy' not in pending
    option = next(o for o in core.reference['responseOptions'] if o['id'] == pending['optionId'])
    assert option['triggers']['impactFunctions'] == ['lng-export--sabine-lng', 'refined-product-flow--colonial']
    assert option['decideWithinHours'] == 2
    bad = {**pending, 'decision': 'chosen'}
    with pytest.raises(InvalidModelError):
        core.ingest_records({'pendingDecisions': [bad]}, 'test')
    decision = {k: v for k, v in pending.items() if k != 'status'}
    decision.update(id='actual-approval', decision='chosen', decidedBy='Operator')
    core.ingest_records({'decisions': [decision]}, 'test')
    assert core.records(INCIDENT)['pendingDecisions'] == []
    assert core.records(INCIDENT)['decisions'][0]['decision'] == 'chosen'

def legacy(store):
    with store._locked():
        ds = store._load()
        for graph in list(ds.graphs()):
            if any(str(graph.identifier).startswith('urn:citride:graph:' + k + ':') for k in ('watchAssets', 'sectorViews', 'criticalFunctions', 'consequenceScores', 'pendingDecisions')):
                ds.remove_graph(graph.identifier)
        store._save(ds)

def test_adoption_dry_run_fenced_idempotent_and_preserves_other_graphs(store):
    from citride.source_adoption import adopt_source
    legacy(store)
    before = store.path.read_bytes()
    with store._locked():
        original = set(store._load().quads((None, None, None, None)))
    plan = adopt_source(store, INCIDENT)
    assert plan['counts']['watchAssets']['add'] == 5
    assert plan['counts']['pendingDecisions']['add'] == 1
    assert store.path.read_bytes() == before
    with pytest.raises(ConflictError):
        adopt_source(store, INCIDENT, apply=True, expected_token='wrong')
    assert store.path.read_bytes() == before
    result = adopt_source(store, INCIDENT, apply=True, expected_token=plan['token'])
    assert result['applied']
    with store._locked():
        after = set(store._load().quads((None, None, None, None)))
    assert original <= after
    adopted = store.path.read_bytes()
    again = adopt_source(store, INCIDENT)
    assert all(c == {'add': 0, 'update': 0} for c in again['counts'].values())
    adopt_source(store, INCIDENT, apply=True, expected_token=again['token'])
    assert store.path.read_bytes() == adopted

def test_adoption_refuses_missing_incident_and_preserves_state(store):
    from citride.source_adoption import adopt_source
    before = store.path.read_bytes()
    with pytest.raises(InvalidModelError):
        adopt_source(store, 'unknown')
    assert store.path.read_bytes() == before

def test_existing_only_never_seeds(tmp_path):
    with pytest.raises(InvalidModelError):
        Repository(tmp_path / 'absent', ROOT / 'data/scenario.json', existing_only=True)
    assert not (tmp_path / 'absent').exists()


def test_cli_dry_run_apply_and_retry(store):
    import json
    import subprocess
    import sys
    legacy(store)
    cmd = [sys.executable, str(ROOT / 'backend/scripts/adopt_source_metadata.py'),
           '--data-dir', str(store.data_dir), '--scenario', str(store.scenario_path), '--incident-id', INCIDENT]
    before = store.path.read_bytes()
    refused = subprocess.run(cmd + ['--apply'], capture_output=True, text=True)
    assert refused.returncode != 0
    assert store.path.read_bytes() == before
    plan = json.loads(subprocess.check_output(cmd, text=True))
    assert store.path.read_bytes() == before
    result = json.loads(subprocess.check_output(cmd + ['--apply', '--expected-token', plan['token']], text=True))
    assert result['applied']
    after = store.path.read_bytes()
    next_plan = json.loads(subprocess.check_output(cmd, text=True))
    result = json.loads(subprocess.check_output(cmd + ['--apply', '--expected-token', next_plan['token']], text=True))
    assert not result['applied']
    assert store.path.read_bytes() == after


def test_update_only_preserves_saved_cases_runs_and_audit(store):
    from citride.source_adoption import adopt_source
    core = RecordsService(store)
    row = deepcopy(core.records(INCIDENT)['watchAssets'][0])
    row['reason'] = 'Old source description'
    core.ingest_records({'watchAssets': [row]}, 'scripted')
    with store._locked():
        ds = store._load()
        store._record_graph(ds, 'command-incident', {'id': 'saved-case', 'snapshot': {'immutable': True}})
        store._record_graph(ds, 'test-snapshot', {'id': 'saved-snapshot', 'inputs': {'old': True}})
        store._save(ds)
        protected = {q for q in ds.quads((None, None, None, None)) if 'graph:watchAssets:' not in str(q[3])}
    plan = adopt_source(store, INCIDENT)
    assert plan['counts']['watchAssets'] == {'add': 0, 'update': 1}
    adopt_source(store, INCIDENT, apply=True, expected_token=plan['token'])
    with store._locked():
        ds = store._load()
        assert protected == {q for q in ds.quads((None, None, None, None)) if 'graph:watchAssets:' not in str(q[3])}
    assert all(c == {'add': 0, 'update': 0} for c in adopt_source(store, INCIDENT)['counts'].values())


def test_source_update_preserves_exact_history_and_anchor(store):
    from citride.source_adoption import adopt_source
    with store._locked():
        ds = store._load()
        row = next(r for r in store._records(ds, 'watchAssets') if r['incidentId'] == INCIDENT)
        source_reason = row['reason']
        row['reason'] = 'Previous source description requiring adoption'
        row['history'] = [
            {'who': 'Operator', 'when': '2021-01-02T03:04:05+00:00',
             'what': {'action': 'review', 'note': 'Preserve the original review'}},
            {'who': 'Operator', 'when': '2021-02-03T04:05:06+00:00',
             'what': {'action': 'review', 'note': 'Preserve event order too'}},
        ]
        row['sampleDataAnchor'] = '2020-03-04T05:06:07+00:00'
        expected = deepcopy(row)
        expected['reason'] = source_reason
        store._record_graph(ds, 'watchAssets', row)
        store._save(ds)
    before = store.path.read_bytes()
    plan = adopt_source(store, INCIDENT)
    assert plan['counts']['watchAssets'] == {'add': 0, 'update': 1}
    assert plan['changes']['watchAssets']['update'] == [row['id']]
    assert store.path.read_bytes() == before
    assert adopt_source(store, INCIDENT, apply=True, expected_token=plan['token'])['applied']
    with store._locked():
        actual = store._record(store._load(), 'watchAssets', row['id'])
    assert actual['reason'] == source_reason
    assert actual['sampleDataAnchor'] == row['sampleDataAnchor']
    assert actual['history'] == row['history']
    assert actual == expected
    applied = store.path.read_bytes()
    retry = adopt_source(store, INCIDENT)
    assert all(c == {'add': 0, 'update': 0} for c in retry['counts'].values())
    assert retry['configChanges'] == []
    assert store.path.read_bytes() == applied
    assert not adopt_source(store, INCIDENT, apply=True, expected_token=retry['token'])['applied']
    assert store.path.read_bytes() == applied


def test_adoption_config_updates_and_validation_rollback(store, monkeypatch):
    from citride.source_adoption import adopt_source
    with store._locked():
        ds = store._load()
        meta = store._record(ds, 'scripted-meta', 'records-meta')
        meta['config'].pop('entityIcons', None)
        meta['config'].pop('serviceLabels', None)
        store._record_graph(ds, 'scripted-meta', meta)
        store._save(ds)
    before = store.path.read_bytes()
    plan = adopt_source(store, INCIDENT)
    assert plan['configChanges']
    assert store.path.read_bytes() == before
    validate = RecordsService._validate_records
    def reject(*args):
        raise InvalidModelError('Deliberate invalid intake')
    monkeypatch.setattr(RecordsService, '_validate_records', reject)
    with pytest.raises(InvalidModelError):
        adopt_source(store, INCIDENT, apply=True, expected_token=plan['token'])
    assert store.path.read_bytes() == before
    monkeypatch.setattr(RecordsService, '_validate_records', validate)
    assert adopt_source(store, INCIDENT)['token'] == plan['token']
    adopt_source(store, INCIDENT, apply=True, expected_token=plan['token'])
    assert RecordsService(store).records(INCIDENT)['entityIcons']
    assert not adopt_source(store, INCIDENT)['configChanges']


@pytest.mark.parametrize('has_anchor', [False, True])
@pytest.mark.parametrize('has_timing', [False, True])
def test_config_adoption_preserves_raw_legacy_metadata_and_history(store, has_anchor, has_timing):
    from citride.source_adoption import adopt_source
    from citride.records import META_KIND, META_ID
    core = RecordsService(store)
    bundle = next(b for b in core.model_sources if b['incident']['id'] == INCIDENT)
    with store._locked():
        ds = store._load()
        meta = store._record(ds, META_KIND, META_ID)
        meta.update(storyStartedAt='2021-01-02T03:04:05+00:00',
                    wallStartedAt='2022-02-03T04:05:06+00:00',
                    legacyExtension={'keep': ['unchanged', 7]})
        if has_anchor:
            meta['sampleDataAnchor'] = '2020-03-04T05:06:07+00:00'
        else:
            meta.pop('sampleDataAnchor', None)
        if has_timing:
            meta['config']['timing'] = {'speed': 24, 'note': 'Saved legacy settings'}
        else:
            meta['config'].pop('timing', None)
        expected_changes = []
        expected = deepcopy(meta)
        for key in ('entityIcons', 'serviceLabels'):
            for name, value in bundle.get('vocabularyAdditions', {}).get(key, {}).items():
                meta['config'].get(key, {}).pop(name, None)
                expected['config'].setdefault(key, {})[name] = deepcopy(value)
                expected_changes.append(key + '.' + name)
        source_ids = {s['id'] for s in bundle['sources']}
        meta['config']['sources'] = [s for s in meta['config']['sources'] if s['id'] not in source_ids]
        expected['config']['sources'] = deepcopy(meta['config']['sources'])
        for source in bundle['sources']:
            expected['config']['sources'].append({**deepcopy(source), 'evidenceCategory': source.get('evidenceCategory', 'simulated')})
            expected_changes.append('sources.' + source['id'])
        store._record_graph(ds, META_KIND, meta)
        store._record_graph(ds, 'command-incident', {'id': 'legacy-case', 'history': [{'saved': True}]})
        store._record_graph(ds, 'test-snapshot', {'id': 'legacy-snapshot', 'analysis': {'saved': True}})
        store._save(ds)
        protected = {q for q in ds.quads((None, None, None, None))
                     if str(q[3]) != 'urn:citride:graph:scripted-meta:records-meta'}
    before = store.path.read_bytes()
    plan = adopt_source(store, INCIDENT)
    assert set(plan['configChanges']) == set(expected_changes)
    assert all(c == {'add': 0, 'update': 0} for c in plan['counts'].values())
    assert store.path.read_bytes() == before
    with pytest.raises(ConflictError):
        adopt_source(store, INCIDENT, apply=True, expected_token='wrong')
    assert store.path.read_bytes() == before
    assert adopt_source(store, INCIDENT, apply=True, expected_token=plan['token'])['applied']
    with store._locked():
        ds = store._load()
        assert store._record(ds, META_KIND, META_ID) == expected
        assert protected == {q for q in ds.quads((None, None, None, None))
                             if str(q[3]) != 'urn:citride:graph:scripted-meta:records-meta'}
    applied = store.path.read_bytes()
    retry = adopt_source(store, INCIDENT)
    assert retry['configChanges'] == []
    assert not adopt_source(store, INCIDENT, apply=True, expected_token=retry['token'])['applied']
    assert store.path.read_bytes() == applied


def test_unknown_function_alias_fails_closed(store):
    from citride.scripted_sources import merge_response_options
    core = RecordsService(store)
    bundle = deepcopy(core.model_sources[0])
    bundle['responseOptions'][0]['triggers']['impactFunctions'] = ['unknown-function']
    with pytest.raises(InvalidModelError, match='Unknown response option function alias'):
        merge_response_options(core.reference, [bundle], core.analysis_model)


def test_postgres_existing_only_has_no_initialization_or_save(monkeypatch):
    from contextlib import contextmanager
    from citride.postgres import PostgresRepository
    calls = []
    class Connection:
        def execute(self, sql, params):
            calls.append((sql, params))
            return self
        def fetchone(self):
            return ('selected-state',)
    @contextmanager
    def locked(self, **kwargs):
        assert not kwargs.get('initialize')
        self._state.connection = Connection()
        yield
    monkeypatch.setattr(PostgresRepository, '_locked', locked)
    def forbidden(*args, **kwargs):
        raise AssertionError('must not seed, save, or repair')
    for name in ('_seed_dataset', '_save', '_repair_seen_on'):
        monkeypatch.setattr(PostgresRepository, name, forbidden)
    PostgresRepository('not-a-network-connection', ROOT / 'data/scenario.json', 'selected-state', existing_only=True)
    assert len(calls) == 1 and calls[0][0].startswith('SELECT state_key')
