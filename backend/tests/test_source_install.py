"""Add-only release intake. All writes target tmp_path or a UUID SQL schema."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import quote
from uuid import uuid4

import pytest
from rdflib import URIRef

from citride.command import CommandService
from citride.records import META_ID, META_KIND, RecordsService
from citride.scripted_sources import EXTRA_COLLECTIONS
from citride.scripted_validation import COLLECTIONS
from citride.storage import ConflictError, InvalidModelError, Repository

ROOT = Path(__file__).resolve().parents[2]
INCIDENT = 'INC-2026-1002-POH'
KINDS = ('statewideIncidents', 'assetStatuses', 'pendingDecisions', *EXTRA_COLLECTIONS)


def graph_id(kind, identifier):
    return URIRef(f'urn:citride:graph:{kind}:{quote(identifier, safe="")}')


def quads(store):
    with store._locked():
        return set(store._load().quads((None, None, None, None)))


def make_legacy(store):
    """Simulate five saved incidents and real historical case/run/audit snapshots."""
    command = CommandService(store)
    case = command.create({'eventId': 'event-dosing', 'title': 'Saved water case',
                           'priority': 'high', 'expectedBaselineRevision': 1,
                           'clientRequestId': str(uuid4())})
    command.act(case['id'], {'action': 'analyze', 'scenarioId': 'unsafe-water',
                            'evaluationHour': 1, 'horizonHours': 12,
                            'expectedVersion': case['version'], 'clientRequestId': str(uuid4())})
    core = RecordsService(store)
    bundle = next(b for b in core.model_sources if b['incident']['id'] == INCIDENT)
    with store._locked():
        ds = store._load()
        for kind in (*COLLECTIONS, 'run'):
            for row in store._records(ds, kind):
                if row.get('incidentId') == INCIDENT or (kind == 'statewideIncidents' and row['id'] == INCIDENT):
                    ds.remove_graph(graph_id(kind, row['id']))
        meta = store._record(ds, META_KIND, META_ID)
        for key, values in bundle['vocabularyAdditions'].items():
            for name in values:
                meta['config'].get(key, {}).pop(name, None)
        ids = {s['id'] for s in bundle['sources']}
        meta['config']['sources'] = [s for s in meta['config']['sources'] if s['id'] not in ids]
        store._record_graph(ds, META_KIND, meta)
        store._save(ds)
    assert len(core.records()['statewideIncidents']) == 5
    assert any(r.get('kind') == 'reviewed' for r in store.runs())
    return store


@pytest.fixture
def store(tmp_path):
    shutil.copytree(ROOT / 'data', tmp_path / 'inputs')
    seeded = Repository(tmp_path / 'state', tmp_path / 'inputs/scenario.json')
    make_legacy(seeded)
    return Repository(seeded.data_dir, seeded.scenario_path, existing_only=True)


def source_edit(store, edit):
    path = store.scenario_path.parent / 'scripted/port_houston.json'
    bundle = json.loads(path.read_text())
    edit(bundle)
    path.write_text(json.dumps(bundle))


def test_install_dry_run_apply_exact_scope_and_preserves_all_history(store):
    from citride.source_install import install_source
    before = store.path.read_bytes()
    protected = quads(store)
    baseline = store.baseline()
    runs = store.runs()
    plan = install_source(store, INCIDENT)
    assert not plan['applied']
    assert plan['counts']['statewideIncidents'] == {'add': 1, 'update': 0}
    assert plan['counts']['pendingDecisions']['add'] == 1
    assert plan['counts']['watchAssets']['add'] == 5
    assert plan['counts']['run'] == {'add': 1, 'update': 0}
    assert plan['preliminaryRunId'].startswith('preliminary-')
    assert plan['configChanges']
    assert store.path.read_bytes() == before
    assert install_source(store, INCIDENT)['token'] == plan['token']
    result = install_source(store, INCIDENT, apply=True, expected_token=plan['token'])
    assert result['applied'] and result['preliminaryRunId'] == plan['preliminaryRunId']
    meta_graph = graph_id(META_KIND, META_ID)
    after = quads(store)
    assert {q for q in protected if q[3] != meta_graph} <= after
    assert store.baseline() == baseline
    assert [r for r in store.runs() if r['id'] in {r['id'] for r in runs}] == runs
    assert len(store.runs()) == len(runs) + 1
    core = RecordsService(store)
    rows = core.records(INCIDENT)
    assert len(core.records()['statewideIncidents']) == 6
    assert rows['decisions'] == [] and len(rows['pendingDecisions']) == 1
    with store._locked():
        ds = store._load()
        for kind in KINDS:
            source_key = 'incidents' if kind == 'statewideIncidents' else kind
            expected = {r['id'] for r in core.scripted[source_key]
                        if r.get('incidentId', r['id']) == INCIDENT}
            actual = {r['id'] for r in store._records(ds, kind)
                      if r.get('incidentId', r['id']) == INCIDENT}
            assert actual == expected
        new = store._record(ds, 'run', plan['preliminaryRunId'])
        assert new['kind'] == 'preliminary' and new['incidentId'] == INCIDENT
        assert new['inputFingerprint'] == plan['preliminaryRunId'].removeprefix('preliminary-')
    allowed = {graph_id(k, i) for k, change in plan['changes'].items() for i in change['add']}
    assert {q[3] for q in after - protected} <= allowed | {meta_graph}
    installed = store.path.read_bytes()
    from citride.consequence_projection import ConsequenceService
    view = ConsequenceService(store).view(INCIDENT)
    assert not view.get('referenceOnly', False)
    assert view['cascadeCount'] == 11 and view['watchOnlyCount'] == 3
    assert view['infrastructureCount'] == 14
    bundle = next(b for b in core.model_sources if b['incident']['id'] == INCIDENT)
    nodes = {n['id']: n for n in view['nodes']}
    for identifier, window in bundle['expectedWindows'].items():
        if isinstance(window, list):
            assert nodes[identifier]['windowHours'] == window
    for kwargs in ({}, {'apply': True, 'expected_token': plan['token']}):
        with pytest.raises(InvalidModelError, match='already exists'):
            install_source(store, INCIDENT, **kwargs)
    assert store.path.read_bytes() == installed


@pytest.mark.parametrize('token', [None, 'wrong'])
def test_apply_requires_matching_token(store, token):
    from citride.source_install import install_source
    before = store.path.read_bytes()
    with pytest.raises(ConflictError):
        install_source(store, INCIDENT, apply=True, expected_token=token)
    assert store.path.read_bytes() == before


def test_state_drift_is_fenced_even_outside_target_incident(store):
    from citride.source_install import install_source
    plan = install_source(store, INCIDENT)
    with store._locked():
        ds = store._load()
        store._record_graph(ds, 'test-audit', {'id': 'concurrent-note', 'note': 'preserve'})
        store._save(ds)
    before = store.path.read_bytes()
    with pytest.raises(ConflictError):
        install_source(store, INCIDENT, apply=True, expected_token=plan['token'])
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('field', ['incident', 'dependency', 'response-option'])
def test_source_drift_requires_new_review(store, field):
    from citride.source_install import install_source
    plan = install_source(store, INCIDENT)
    def edit(bundle):
        if field == 'incident':
            bundle['incident']['summary'] += ' Revised source.'
        elif field == 'dependency':
            bundle['dependencies'][0]['assumptionNote'] += ' Revised source.'
        else:
            bundle['responseOptions'][0]['decideWithinHours'] = 3
    source_edit(store, edit)
    before = store.path.read_bytes()
    with pytest.raises(ConflictError):
        install_source(store, INCIDENT, apply=True, expected_token=plan['token'])
    assert store.path.read_bytes() == before


def test_validation_failure_does_not_mutate_disk_or_cached_dataset(store, monkeypatch):
    from citride.source_install import install_source
    plan = install_source(store, INCIDENT)
    original = quads(store)
    before = store.path.read_bytes()
    def invalid(*args, **kwargs):
        raise InvalidModelError('deliberate shared validation rejection')
    with monkeypatch.context() as patch:
        patch.setattr(RecordsService, '_validate_records', invalid)
        with pytest.raises(InvalidModelError, match='shared validation'):
            install_source(store, INCIDENT, apply=True, expected_token=plan['token'])
    assert store.path.read_bytes() == before and quads(store) == original
    assert install_source(store, INCIDENT)['token'] == plan['token']


def test_late_analysis_failure_rolls_back_all_candidate_writes(store, monkeypatch):
    from citride.source_install import install_source
    plan = install_source(store, INCIDENT)
    before = store.path.read_bytes()
    original = quads(store)
    def fail(self, dataset, incident_ids):
        self.store._record_graph(dataset, 'test-audit', {'id': 'uncommitted-analysis'})
        raise InvalidModelError('analysis rejected')
    monkeypatch.setattr(RecordsService, '_automatic_analysis', fail)
    with pytest.raises(InvalidModelError, match='analysis rejected'):
        install_source(store, INCIDENT, apply=True, expected_token=plan['token'])
    assert store.path.read_bytes() == before and quads(store) == original


def test_absent_preliminary_is_not_a_successful_install(store, monkeypatch):
    from citride.source_install import install_source
    before = store.path.read_bytes()
    monkeypatch.setattr(RecordsService, '_automatic_analysis', lambda *a: False)
    with pytest.raises(InvalidModelError, match='one new preliminary'):
        install_source(store, INCIDENT)
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('collision', ['record', 'vocabulary', 'source'])
def test_existing_owned_or_unrelated_values_are_never_overwritten(store, collision):
    from citride.source_install import install_source
    core = RecordsService(store)
    bundle = next(b for b in core.model_sources if b['incident']['id'] == INCIDENT)
    with store._locked():
        ds = store._load()
        meta = store._record(ds, META_KIND, META_ID)
        if collision == 'record':
            row = deepcopy(bundle['assetStatuses'][0])
            row['incidentId'] = 'TX-26-0412'
            store._record_graph(ds, 'assetStatuses', row)
        elif collision == 'vocabulary':
            key, value = next(iter(bundle['vocabularyAdditions']['entityIcons'].items()))
            meta['config'].setdefault('entityIcons', {})[key] = 'OperatorOwnedIcon'
        else:
            meta['config']['sources'].append({**bundle['sources'][0], 'label': 'Operator owned'})
        store._record_graph(ds, META_KIND, meta)
        store._save(ds)
    before = store.path.read_bytes()
    with pytest.raises(InvalidModelError, match='collision|overwrite'):
        install_source(store, INCIDENT)
    assert store.path.read_bytes() == before


def test_existing_reviewed_decision_is_preserved_not_duplicated(store):
    from citride.source_install import install_source
    pending = next(r for r in RecordsService(store).scripted['pendingDecisions'] if r['incidentId'] == INCIDENT)
    decision = {k: v for k, v in pending.items() if k != 'status'}
    decision.update(id='saved-source-review', decision='chosen', decidedBy='Saved operator')
    with store._locked():
        ds = store._load()
        store._record_graph(ds, 'decisions', decision)
        store._save(ds)
    plan = install_source(store, INCIDENT)
    assert plan['counts']['pendingDecisions']['add'] == 0
    assert plan['suppressedPendingDecisionIds'] == [pending['id']]
    install_source(store, INCIDENT, apply=True, expected_token=plan['token'])
    with store._locked():
        assert store._record(store._load(), 'decisions', decision['id']) == decision
    assert RecordsService(store).records(INCIDENT)['pendingDecisions'] == []


def test_cross_incident_bundle_row_is_rejected(store):
    from citride.source_install import install_source
    source_edit(store, lambda b: b['assetStatuses'][0].update(incidentId='TX-26-0412'))
    before = store.path.read_bytes()
    with pytest.raises(InvalidModelError, match='scope'):
        install_source(store, INCIDENT)
    assert store.path.read_bytes() == before


def test_unknown_incident_and_missing_initialized_metadata_fail_closed(store):
    from citride.source_install import install_source
    before = store.path.read_bytes()
    with pytest.raises(InvalidModelError, match='configured'):
        install_source(store, 'not-configured')
    assert store.path.read_bytes() == before
    with store._locked():
        ds = store._load()
        ds.remove_graph(graph_id(META_KIND, META_ID))
        store._save(ds)
    before = store.path.read_bytes()
    with pytest.raises(InvalidModelError, match='initialized'):
        install_source(store, INCIDENT)
    assert store.path.read_bytes() == before


def test_clock_does_not_change_review_token_or_preliminary_id(store, monkeypatch):
    from citride.source_install import install_source
    monkeypatch.setattr(RecordsService, '_wall_now', lambda self: datetime(2031, 1, 1, tzinfo=timezone.utc))
    first = install_source(store, INCIDENT)
    monkeypatch.setattr(RecordsService, '_wall_now', lambda self: datetime(2032, 1, 1, tzinfo=timezone.utc))
    second = install_source(store, INCIDENT)
    assert first['token'] == second['token']
    assert first['preliminaryRunId'] == second['preliminaryRunId']


def test_cli_default_dry_run_token_apply_retry_and_missing_store(store, tmp_path):
    cmd = [sys.executable, str(ROOT / 'backend/scripts/install_source_incident.py'),
           '--data-dir', str(store.data_dir), '--scenario', str(store.scenario_path), '--incident-id', INCIDENT]
    before = store.path.read_bytes()
    for flags in (['--apply'], ['--apply', '--expected-token', 'wrong'], ['--state-key', 'not-sql']):
        assert subprocess.run(cmd + flags, capture_output=True).returncode != 0
        assert store.path.read_bytes() == before
    plan = json.loads(subprocess.check_output(cmd, text=True))
    assert not plan['applied'] and store.path.read_bytes() == before
    result = json.loads(subprocess.check_output(cmd + ['--apply', '--expected-token', plan['token']], text=True))
    assert result['applied']
    installed = store.path.read_bytes()
    assert subprocess.run(cmd, capture_output=True).returncode != 0
    assert store.path.read_bytes() == installed
    cmd[cmd.index(str(store.data_dir))] = str(tmp_path / 'absent')
    assert subprocess.run(cmd, capture_output=True).returncode != 0
    assert not (tmp_path / 'absent').exists()


def test_cli_does_not_select_ambient_database_or_default_state(tmp_path):
    cmd = [sys.executable, str(ROOT / 'backend/scripts/install_source_incident.py'),
           '--scenario', str(ROOT / 'data/scenario.json'), '--incident-id', INCIDENT]
    env = {**os.environ, 'CITRIDE_DATABASE_URL': 'must-not-connect', 'TEST_SELECTED_URL': 'must-not-connect'}
    for flags in ([], ['--database-url-env', 'TEST_SELECTED_URL'],
                  ['--database-url-env', 'MISSING_INSTALL_TEST_URL', '--state-key', 'explicit']):
        result = subprocess.run(cmd + flags, capture_output=True, env=env, text=True)
        assert result.returncode == 2
        assert 'must-not-connect' not in result.stderr


def test_concurrent_installers_append_only_once(store):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from citride.source_install import install_source
    plan = install_source(store, INCIDENT)
    barrier = Barrier(2)
    def apply():
        independent = Repository(store.data_dir, store.scenario_path, existing_only=True)
        barrier.wait(timeout=10)
        try:
            return install_source(independent, INCIDENT, apply=True, expected_token=plan['token'])['applied']
        except InvalidModelError as error:
            assert 'already exists' in str(error)
            return False
    before = len(store.runs())
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: apply(), range(2)))
    assert sorted(results) == [False, True]
    assert len(store.runs()) == before + 1


def test_no_seed_reset_repair_or_baseline_write_is_used(store, monkeypatch):
    from citride.source_install import install_source
    def forbidden(*args, **kwargs):
        raise AssertionError('installation must not seed/reset/repair baseline')
    for name in ('_seed_dataset', 'reset_demo', '_repair_seen_on', '_write_baseline'):
        monkeypatch.setattr(Repository, name, forbidden)
    monkeypatch.setattr(RecordsService, 'seed', forbidden)
    existing = Repository(store.data_dir, store.scenario_path, existing_only=True)
    plan = install_source(existing, INCIDENT)
    assert install_source(existing, INCIDENT, apply=True, expected_token=plan['token'])['applied']


@pytest.mark.parametrize('tamper', ['existing', 'new'])
def test_shared_intake_side_effects_outside_plan_fail_closed(store, monkeypatch, tamper):
    from citride.source_install import install_source
    before = store.path.read_bytes()
    automatic = RecordsService._automatic_analysis
    def unsafe(self, dataset, incident_ids):
        result = automatic(self, dataset, incident_ids)
        if tamper == 'existing':
            water = next(r for r in self.store._records(dataset, 'statewideIncidents') if r['id'] == 'TX-26-0412')
            water['summary'] = 'Unexpected mutation'
            self.store._record_graph(dataset, 'statewideIncidents', water)
        else:
            self.store._record_graph(dataset, 'test-audit', {'id': 'unexpected-audit'})
        return result
    monkeypatch.setattr(RecordsService, '_automatic_analysis', unsafe)
    with pytest.raises(InvalidModelError, match='protected'):
        install_source(store, INCIDENT)
    assert store.path.read_bytes() == before


def test_invalid_source_reference_rejected_without_writes(store):
    from citride.source_install import install_source
    source_edit(store, lambda bundle: bundle['watchAssets'][0].update(entityId='nonexistent-asset'))
    before = store.path.read_bytes()
    with pytest.raises(InvalidModelError):
        install_source(store, INCIDENT)
    assert store.path.read_bytes() == before


def test_installer_uses_configured_identity_not_a_specific_incident(store):
    from citride.source_install import install_source
    target = 'FICTIONAL-CUSTOMER-INCIDENT'
    def rename(bundle):
        bundle['incident']['id'] = target
        for kind in ('assetStatuses', 'decisions', *EXTRA_COLLECTIONS):
            value = bundle.get(kind, [])
            for row in value if isinstance(value, list) else [value]:
                if row.get('incidentId') == INCIDENT:
                    row['incidentId'] = target
    source_edit(store, rename)
    plan = install_source(store, target)
    assert install_source(store, target, apply=True, expected_token=plan['token'])['applied']
    ids = {r['id'] for r in RecordsService(store).records()['statewideIncidents']}
    assert target in ids and INCIDENT not in ids and len(ids) == 6


def test_real_postgres_install_transaction_rollback_and_unrelated_state(tmp_path, monkeypatch):
    url = os.environ.get('TEST_DATABASE_URL')
    if not url:
        pytest.skip('TEST_DATABASE_URL required; never use live database credentials')
    import psycopg
    from psycopg import sql
    from psycopg.conninfo import make_conninfo
    from citride.postgres import PostgresRepository
    from citride.source_install import install_source
    schema = 'source_install_test_' + uuid4().hex
    with psycopg.connect(url, connect_timeout=10) as connection:
        connection.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
    scoped = make_conninfo(url, options=f'-csearch_path={schema}')
    try:
        seed = PostgresRepository(scoped, ROOT / 'data/scenario.json', 'install-test')
        make_legacy(seed)
        PostgresRepository(scoped, seed.scenario_path, 'untouched-test')
        store = PostgresRepository(scoped, seed.scenario_path, 'install-test', existing_only=True)
        def rows():
            with psycopg.connect(scoped) as connection:
                return connection.execute('SELECT state_key,nquads,updated_at FROM citride_state ORDER BY state_key').fetchall()
        before = rows()
        protected = quads(store)
        plan = install_source(store, INCIDENT)
        assert rows() == before
        def fail(*args):
            raise InvalidModelError('SQL validation rollback')
        with monkeypatch.context() as patch:
            patch.setattr(RecordsService, '_validate_records', fail)
            with pytest.raises(InvalidModelError):
                install_source(store, INCIDENT, apply=True, expected_token=plan['token'])
        assert rows() == before
        # Simulate failure after UPDATE to exercise real transaction rollback.
        save = store._save
        def fail_after_update(dataset):
            save(dataset)
            raise InvalidModelError('SQL post-save rollback')
        with monkeypatch.context() as patch:
            patch.setattr(store, '_save', fail_after_update)
            with pytest.raises(InvalidModelError):
                install_source(store, INCIDENT, apply=True, expected_token=plan['token'])
        assert rows() == before
        with pytest.raises(ConflictError):
            install_source(store, INCIDENT, apply=True, expected_token='stale')
        install_source(store, INCIDENT, apply=True, expected_token=plan['token'])
        assert rows()[1] == before[1]
        assert {q for q in protected if q[3] != graph_id(META_KIND, META_ID)} <= quads(store)
        installed = rows()
        with pytest.raises(InvalidModelError, match='already exists'):
            install_source(store, INCIDENT)
        assert rows() == installed
    finally:
        with psycopg.connect(url, connect_timeout=10) as connection:
            connection.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
