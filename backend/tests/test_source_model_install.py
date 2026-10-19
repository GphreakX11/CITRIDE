"""Normalized intake and explicit model-only installation on disposable stores."""
from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess
import sys
from uuid import uuid4

import pytest
from rdflib import Literal, URIRef

from citride import MODEL_VERSION
from citride.consequence_model import MODEL_COLLECTIONS, intake_source_models, normalize_source_model
from citride.engine import compute_run
from citride.records import META_ID, META_KIND
from citride.scripted_sources import load_sources
from citride.source_install import _graph_id
from citride.source_model_install import RECEIPT_KIND, SNAPSHOT_KIND, install_source_model
from citride.storage import BASELINE, ConflictError, InvalidModelError, Repository
from citride.validation import validate_baseline

ROOT = Path(__file__).resolve().parents[2]
SCENARIO = ROOT / 'data/scenario.json'


def inputs(path=SCENARIO):
    _, bundles, reference = load_sources(path)
    return json.loads(path.read_text()), bundles[0], reference


def quads(store):
    with store._locked():
        return set(store._load().quads((None, None, None, None)))


@pytest.fixture
def store(tmp_path):
    shutil.copytree(ROOT / 'data', tmp_path / 'inputs')
    scenario = tmp_path / 'inputs/scenario.json'
    seeded = Repository(tmp_path / 'state', scenario)
    from citride.command import CommandService
    command = CommandService(seeded)
    case = command.create({'eventId': 'event-dosing', 'title': 'Saved original case', 'priority': 'high',
                           'expectedBaselineRevision': 1, 'clientRequestId': str(uuid4())})
    command.act(case['id'], {'action': 'analyze', 'scenarioId': 'unsafe-water', 'evaluationHour': 1,
                             'horizonHours': 12, 'expectedVersion': case['version'], 'clientRequestId': str(uuid4())})
    # Earlier release: incident already present, infrastructure not yet stored.
    baseline, _, _ = inputs(scenario)
    baseline.update(baselineRevision=1, modelVersion=MODEL_VERSION)
    with seeded._locked():
        dataset = seeded._load()
        seeded._write_baseline(dataset, baseline)
        meta = seeded._record(dataset, META_KIND, META_ID)
        meta['opaqueLegacyMetadata'] = {'keep': ['exact', 17, None]}
        seeded._record_graph(dataset, META_KIND, meta)
        seeded._record_graph(dataset, SNAPSHOT_KIND, {'id': 'older-revision', 'opaque': 'unchanged'})
        seeded._save(dataset)
    return Repository(seeded.data_dir, scenario, existing_only=True)


def incident_id(store):
    return inputs(store.scenario_path)[1]['incident']['id']


def test_normalization_validates_preserves_inputs_and_expected_windows():
    baseline, bundle, reference = inputs()
    original = deepcopy((baseline, bundle, reference))
    model = intake_source_models(baseline, reference, [bundle])
    assert (baseline, bundle, reference) == original
    assert validate_baseline(model) == []
    assert intake_source_models(model, reference, [bundle]) == model
    for key in MODEL_COLLECTIONS:
        assert model[key][:len(baseline[key])] == baseline[key]
        for row in model[key][len(baseline[key]):]:
            assert 'SIMULATED' in row['handling'] and row['assumptionNote'].strip()
    assert len(model['events']) == 13
    assert sum(not event.get('attackTechniques') for event in bundle['events']) == 3
    result = compute_run(model, {'scenarioId': bundle['scenario']['id'],
                                'evaluationHour': 0, 'horizonHours': 48, 'overrides': []}, 'test-intake')
    impacts = {row['entityId']: row['windowHours'] for row in result['impacts']}
    for identifier, window in bundle['expectedWindows'].items():
        if isinstance(window, list):
            assert impacts[identifier] == window
    assert {tuple(window) for window in impacts.values()} >= {(3, 6), (6, 12), (12, 18), (18, 24)}


def test_fresh_seed_contains_model_before_record_seed(tmp_path, monkeypatch):
    from citride.records import RecordsService
    original = RecordsService.seed
    observed = []
    def seed(self, dataset):
        observed.append(len(self.store._baseline(dataset)['events']))
        return original(self, dataset)
    monkeypatch.setattr(RecordsService, 'seed', seed)
    repo = Repository(tmp_path / 'new', SCENARIO)
    assert observed == [13]
    assert len(repo.baseline()['events']) == 13
    before = repo.path.read_bytes()
    plan = install_source_model(repo, incident_id(repo))
    assert plan['noop'] and plan['baselineRevision'] == 1
    result = install_source_model(repo, incident_id(repo), apply=True, expected_token=plan['token'])
    assert result['noop'] and not result['applied']
    assert repo.path.read_bytes() == before


def test_custom_event_free_fixture_does_not_load_application_sources(tmp_path, monkeypatch):
    baseline, _, _ = inputs()
    baseline['events'] = []
    for scenario in baseline['scenarios']:
        scenario['seed']['eventRefs'] = []
    path = tmp_path / 'fixture.json'
    path.write_text(json.dumps(baseline))
    def forbidden(*args):
        raise AssertionError('event-free fixtures must not read application feeds')
    monkeypatch.setattr('citride.scripted_sources.load_sources', forbidden)
    store = Repository(tmp_path / 'empty', path)
    assert store.baseline()['events'] == []
    assert store.baseline()['entities'] == baseline['entities']


def test_generic_renamed_bundle_multiple_sources_and_existing_cyber_identity():
    baseline, bundle, reference = inputs()
    identifiers = {row['id'] for key in ('entities', 'events', 'dependencies', 'sources') for row in bundle[key]}
    identifiers.add(bundle['scenario']['id'])
    mapping = {identifier: 'third-' + str(index) for index, identifier in enumerate(sorted(identifiers))}
    def renamed(value):
        if isinstance(value, str):
            return mapping.get(value, value)
        if isinstance(value, list):
            return [renamed(v) for v in value]
        if isinstance(value, dict):
            return {mapping.get(k, k): renamed(v) for k, v in value.items()}
        return value
    bundle, reference = renamed(bundle), renamed(reference)
    bundle['sources'].append({**deepcopy(bundle['sources'][0]), 'id': 'third-extra-source'})
    event = bundle['events'][0]
    bundle['entities'].append({'id': 'third-cyber', 'type': 'CyberAsset', 'label': 'Direct cyber identity',
                               'hostedBy': event['seenOn'],
                               'idt': {'status': 'not_idt_asset', 'reason': 'cyber_identity'}})
    event['seenOn'] = 'third-cyber'
    model = intake_source_models(baseline, reference, [bundle])
    assert validate_baseline(model) == []
    assert next(r for r in model['events'] if r['id'] == event['id'])['seenOn'] == 'third-cyber'
    assert not any(r['id'] == 'cyber-third-cyber' for r in model['entities'])
    assert any(r['id'] == 'third-extra-source' for r in model['sources'])


def test_dry_run_apply_preserves_all_records_metadata_history_and_replay(store):
    with store._locked():
        dataset = store._load()
        opaque = (URIRef('urn:opaque:subject'), URIRef('urn:opaque:predicate'), Literal('keep raw baseline metadata'))
        dataset.graph(BASELINE).add(opaque)
        store._save(dataset)
    before_bytes, before, baseline = store.path.read_bytes(), quads(store), store.baseline()
    runs = store.runs()
    plan = install_source_model(store, incident_id(store))
    assert not plan['applied'] and not plan['noop']
    assert plan['counts']['events'] == {'add': 6, 'update': 0}
    assert all(change['update'] == [] for change in plan['changes'].values())
    assert store.path.read_bytes() == before_bytes and quads(store) == before
    assert install_source_model(store, incident_id(store)) == plan
    result = install_source_model(store, incident_id(store), apply=True, expected_token=plan['token'])
    assert result['applied'] and result['baselineRevision'] == 2
    after = quads(store)
    assert {q for q in before if q[3] != BASELINE} <= after
    allowed = {BASELINE, _graph_id(RECEIPT_KIND, plan['receiptId']), _graph_id(SNAPSHOT_KIND, plan['baselineSnapshotId'])}
    assert plan['counts']['run'] == {'add': 1, 'update': 0}
    allowed |= {_graph_id('run', identifier) for identifier in plan['preliminaryRunIds']}
    assert {q[3] for q in after - before} <= allowed
    current_runs = {run['id']: run for run in store.runs()}
    assert all(current_runs[run['id']] == run for run in runs)
    assert set(current_runs) - {run['id'] for run in runs} == set(plan['preliminaryRunIds'])
    current = store.baseline()
    for key, value in baseline.items():
        if key in MODEL_COLLECTIONS:
            assert current[key][:len(value)] == value
        elif key != 'baselineRevision':
            assert current[key] == value
    with store._locked():
        assert opaque in store._load().graph(BASELINE)
        assert store._record(store._load(), SNAPSHOT_KIND, plan['baselineSnapshotId'])['baselineSnapshot'] == baseline
    installed_bytes = store.path.read_bytes()
    replay = install_source_model(store, incident_id(store), apply=True, expected_token=plan['token'])
    assert replay['noop'] and replay['replayed'] and not replay['applied']
    assert store.path.read_bytes() == installed_bytes


@pytest.mark.parametrize('token', [None, 'wrong'])
def test_apply_requires_reviewed_token(store, token):
    before = store.path.read_bytes()
    with pytest.raises(ConflictError):
        install_source_model(store, incident_id(store), apply=True, expected_token=token)
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('drift', ['state', 'source', 'reference'])
def test_state_and_source_drift_are_fenced(store, drift):
    plan = install_source_model(store, incident_id(store))
    if drift == 'state':
        with store._locked():
            dataset = store._load()
            store._record_graph(dataset, 'test-audit', {'id': 'concurrent', 'note': 'keep'})
            store._save(dataset)
    else:
        manifest = json.loads((store.scenario_path.parent / 'scripted/sources.json').read_text())
        name = manifest['models'][0] if drift == 'source' else manifest['reference']
        path = store.scenario_path.parent / 'scripted' / name
        data = json.loads(path.read_text())
        data['note'] = 'Concurrent source revision, even if normalized output is identical.'
        path.write_text(json.dumps(data))
    before = store.path.read_bytes()
    with pytest.raises(ConflictError):
        install_source_model(store, incident_id(store), apply=True, expected_token=plan['token'])
    assert store.path.read_bytes() == before


@pytest.mark.parametrize('collision', ['same-kind', 'cross-kind', 'historical', 'orphan-receipt'])
def test_collisions_never_overwrite(store, collision):
    baseline, bundle, reference = inputs(store.scenario_path)
    plan = install_source_model(store, incident_id(store))
    with store._locked():
        dataset = store._load()
        if collision in ('same-kind', 'cross-kind'):
            baseline = store._baseline(dataset)
            row = normalize_source_model(bundle, reference)['entities'][0]
            row['label'] = 'Operator-owned content'
            baseline['entities' if collision == 'same-kind' else 'sources'].append(row)
            store._write_baseline(dataset, baseline)
        elif collision == 'historical':
            store._record_graph(dataset, SNAPSHOT_KIND, {'id': plan['baselineSnapshotId'], 'doNotOverwrite': True})
        else:
            dataset.graph(_graph_id(RECEIPT_KIND, plan['receiptId'])).add(
                (URIRef('urn:opaque:s'), URIRef('urn:opaque:p'), Literal('orphan')))
        store._save(dataset)
    before = store.path.read_bytes()
    with pytest.raises(InvalidModelError, match='colli'):
        install_source_model(store, incident_id(store))
    assert store.path.read_bytes() == before


def test_validation_and_late_side_effect_failures_leave_disk_and_cache_unchanged(store, monkeypatch):
    before, original = store.path.read_bytes(), quads(store)
    with monkeypatch.context() as patch:
        patch.setattr('citride.consequence_model.validate_baseline', lambda model: ['deliberate validation rejection'])
        with pytest.raises(InvalidModelError, match='validation rejection'):
            install_source_model(store, incident_id(store))
    record_graph = store._record_graph
    def side_effect(dataset, kind, row):
        record_graph(dataset, kind, row)
        record_graph(dataset, 'test-audit', {'id': 'unexpected-side-effect'})
    monkeypatch.setattr(store, '_record_graph', side_effect)
    with pytest.raises(InvalidModelError, match='protected historical state'):
        install_source_model(store, incident_id(store))
    assert store.path.read_bytes() == before and quads(store) == original


def test_cli_separate_process_token_apply_and_replay(store):
    args = [sys.executable, str(ROOT / 'scripts/install_source_model.py'), '--data-dir', str(store.data_dir),
            '--scenario', str(store.scenario_path), '--incident-id', incident_id(store)]
    dry = subprocess.run(args, capture_output=True, text=True)
    assert dry.returncode == 0, dry.stderr
    token = (
        json.loads(dry.stdout)['token']
    )
    applied = subprocess.run(args + ['--apply', '--expected-token', token], capture_output=True, text=True)
    assert applied.returncode == 0, applied.stderr
    assert json.loads(applied.stdout)['applied']
    replay = subprocess.run(args + ['--apply', '--expected-token', token], capture_output=True, text=True)
    assert replay.returncode == 0, replay.stderr
    assert json.loads(replay.stdout)['noop']


def test_canonical_collections_preserve_explicit_functions_and_scenarios():
    baseline, bundle, reference = inputs()
    normalized = normalize_source_model(bundle, reference)
    assert normalize_source_model(normalized, {}) == normalized
    assert validate_baseline(intake_source_models(baseline, {}, [normalized])) == []


@pytest.mark.parametrize('fault', ['duplicate', 'blank-note', 'bad-interval', 'unknown-endpoint'])
def test_invalid_model_input_is_rejected_without_mutation(fault):
    baseline, bundle, reference = inputs()
    if fault == 'duplicate':
        bundle['events'].append(deepcopy(bundle['events'][0]))
    elif fault == 'blank-note':
        bundle['sources'][0]['assumptionNote'] = ' '
    elif fault == 'bad-interval':
        reference['intervalNormalizations'][bundle['dependencies'][0]['id']] = [1, 2]
    else:
        bundle['dependencies'][0]['provider'] = 'unknown-provider'
    before = deepcopy((baseline, bundle, reference))
    with pytest.raises(InvalidModelError):
        intake_source_models(baseline, reference, [bundle])
    assert (baseline, bundle, reference) == before


def test_save_failure_leaves_existing_store_unchanged(store, monkeypatch):
    plan = install_source_model(store, incident_id(store))
    before, original = store.path.read_bytes(), quads(store)
    def fail(dataset):
        raise OSError('simulated failure before atomic replace')
    monkeypatch.setattr(store, '_save', fail)
    with pytest.raises(OSError, match='before atomic replace'):
        install_source_model(store, incident_id(store), apply=True, expected_token=plan['token'])
    assert store.path.read_bytes() == before and quads(store) == original


def test_cli_never_creates_missing_store(tmp_path):
    path = tmp_path / 'must-not-exist'
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/install_source_model.py'),
                             '--data-dir', str(path), '--scenario', str(SCENARIO), '--incident-id', 'not-installed'],
                            capture_output=True, text=True)
    assert result.returncode == 1 and 'existing store' in result.stderr
    assert not path.exists()
