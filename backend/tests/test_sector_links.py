"""Part A causal sector links: detached fixtures and temporary stores only."""
from copy import deepcopy
from pathlib import Path

import pytest

from citride.command import CommandService
from citride.consequence_projection import ConsequenceService, project_consequences
from citride.engine import compute_run
from citride.records import RecordsService
from citride.storage import Repository

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def store(tmp_path):
    return Repository(tmp_path / 'state', ROOT / 'data/scenario.json')


def pairs(view):
    return {(link['fromKind'], link['from'], link['to']) for link in view['sectorLinks']}


def test_port_links_are_causal_service_bearing_and_target_colored(store):
    before = store.path.read_bytes()
    view = ConsequenceService(store).view('INC-2026-1002-POH')
    source = view['source']['id']
    assert pairs(view) == {('source', source, name) for name in ('Energy', 'Transportation', 'Chemical')} | {('sector', 'Chemical', 'Water')}
    cross = next(link for link in view['sectorLinks'] if link['fromKind'] == 'sector')
    assert cross['service'] == 'chlorine'
    # Recorded dependency depth, including the intermediate same-sector hop.
    assert cross['step'] == 3
    sectors = {s['label']: s for s in view['sectors']}
    dependencies = {d['id'] for run in store.runs() for d in run['baselineSnapshot']['dependencies']}
    assert len({link['id'] for link in view['sectorLinks']}) == len(view['sectorLinks'])
    for link in view['sectorLinks']:
        assert set(link) == {'id', 'from', 'fromKind', 'to', 'service', 'step', 'windowHours', 'dependencyIds'}
        assert link['windowHours'] == sectors[link['to']]['windowHours']
        assert link['dependencyIds'] and set(link['dependencyIds']) <= dependencies
    assert store.path.read_bytes() == before


def test_water_has_only_direct_healthcare_links_not_upstream_or_watch(store):
    view = ConsequenceService(store).view('TX-26-0412')
    assert pairs(view) == {('source', view['source']['id'], 'Healthcare')}
    assert all(link['step'] == 1 for link in view['sectorLinks'])
    assert any(node['upstream'] for node in view['nodes'])


def third_fixture():
    entities = [{'id': key, 'type': 'FixtureFacility', 'sector': sector} for key, sector in
                [('origin', 'Sector X'), ('relay', 'Sector X'), ('target', 'Sector Y'), ('watch', 'Sector Z')]]
    deps = [{'id': key, 'provider': provider, 'dependent': target, 'requiredService': service,
             'dependentFunction': 'fn-' + target, 'usableBackupMinHours': 0, 'usableBackupMaxHours': 0}
            for key, provider, target, service in [('first', 'origin', 'relay', 'input'),
                ('second', 'relay', 'target', 'output'), ('uncaptured', 'origin', 'watch', 'input')]]
    model = {'entities': entities, 'dependencies': deps, 'events': [],
             'serviceFunctions': [{'id': 'fn-' + key, 'service': 'operation'} for key in ('relay', 'target', 'watch')]}
    impacts = [{'entityId': key, 'functionId': 'fn-' + key, 'paths': [path], 'windowHours': window, 'sourceRefs': []}
               for key, path, window in [('relay', ['first'], [1, 2]), ('target', ['first', 'second'], [3, 5])]]
    run = {'baselineSnapshot': model, 'seed': {'provider': 'origin', 'lossType': 'unavailable'}, 'impacts': impacts}
    reference = {'sectors': [], 'assets': {}, 'serviceLabels': {'input': 'recorded input', 'output': 'recorded output'}, 'publicActionRules': []}
    return run, reference


def test_third_fixture_cross_sector_second_step_and_same_sector_first_impact():
    run, reference = third_fixture()
    original = deepcopy(run)
    view = project_consequences({'id': 'fixture-incident'}, run, reference, [])
    assert pairs(view) == {('source', 'origin', 'Sector X'), ('sector', 'Sector X', 'Sector Y')}
    cross = next(link for link in view['sectorLinks'] if link['fromKind'] == 'sector')
    assert cross['dependencyIds'] == ['second']
    assert cross['service'] == 'recorded output'
    assert cross['step'] == 2 and cross['windowHours'] == [3, 5]
    assert run == original


def test_links_dedupe_and_order_independent_of_impact_dependency_path_order():
    run, reference = third_fixture()
    expected = project_consequences({'id': 'i'}, run, reference, [])['sectorLinks']
    run['impacts'].append(deepcopy(run['impacts'][1]))
    run['impacts'].reverse()
    run['baselineSnapshot']['dependencies'].reverse()
    assert project_consequences({'id': 'i'}, run, reference, [])['sectorLinks'] == expected


def test_unknown_target_window_is_not_invented():
    run, reference = third_fixture()
    run['impacts'][1]['windowHours'] = None
    links = project_consequences({'id': 'i'}, run, reference, [])['sectorLinks']
    assert next(link for link in links if link['to'] == 'Sector Y')['windowHours'] is None


def test_new_preliminary_and_planning_runs_capture_versioned_links(store):
    for run in store.runs():
        assert run['sectorLinksVersion'] == 1
        assert run['sectorLinks']
    run = store.create_run({'scenarioId': 'unsafe-water', 'evaluationHour': 1, 'horizonHours': 12, 'overrides': []}, compute_run)
    assert run['sectorLinksVersion'] == 1
    assert store.run(run['id'])['sectorLinks'] == run['sectorLinks']


def test_reviewed_run_captures_links_and_projection_uses_detached_snapshot(store):
    commands = CommandService(store)
    case = commands.create({'eventId': 'event-dosing', 'title': 'Sector link review', 'priority': 'high', 'expectedBaselineRevision': 1, 'clientRequestId': 'sector-create'})
    reviewed = commands.act(case['id'], {'action': 'analyze', 'scenarioId': 'unsafe-water', 'evaluationHour': 1, 'horizonHours': 12, 'expectedVersion': case['version'], 'clientRequestId': 'sector-analyze'})
    run = reviewed['runSnapshot']
    assert run is not None
    assert run['sectorLinksVersion'] == 1 and run['sectorLinks']
    view = ConsequenceService(store).view('TX-26-0412')
    assert view['sectorLinks'] == run['sectorLinks']
    view['sectorLinks'].clear()
    assert store.run(run['id']) == run


def test_old_run_fallback_is_read_only_and_does_not_recapture_on_intake(store):
    with store._locked():
        dataset = store._load()
        for run in store._records(dataset, 'run'):
            run.pop('sectorLinks', None)
            run.pop('sectorLinksVersion', None)
            store._record_graph(dataset, 'run', run)
        store._save(dataset)
    before = store.path.read_bytes()
    old_runs = deepcopy(store.runs())
    view = ConsequenceService(store).view('INC-2026-1002-POH')
    assert ('sector', 'Chemical', 'Water') in pairs(view)
    RecordsService(store).initialize()
    assert store.runs() == old_runs
    assert store.path.read_bytes() == before


def test_captured_empty_links_are_not_replaced_with_inferred_links():
    run, reference = third_fixture()
    run['sectorLinks'] = []
    assert project_consequences({'id': 'i'}, run, reference, [])['sectorLinks'] == []


@pytest.mark.parametrize('path', [['second'], ['first', 'uncaptured'], ['missing'], ['first']])
def test_disconnected_missing_or_wrong_endpoint_paths_do_not_invent_edges(path):
    from citride.sector_links import derive_sector_links
    run, reference = third_fixture()
    run['impacts'] = [run['impacts'][1]]
    run['impacts'][0]['paths'] = [path]
    assert derive_sector_links(run, reference) == []


def test_no_analysis_exposes_empty_links():
    assert project_consequences({'id': 'i'}, None, {}, [])['sectorLinks'] == []


def test_saved_links_win_over_new_display_vocabulary_without_aliasing():
    run, reference = third_fixture()
    run['sectorLinks'] = [{'id': 'frozen', 'from': 'origin', 'fromKind': 'source', 'to': 'Sector X', 'service': 'captured label', 'step': 1, 'windowHours': [1, 2], 'dependencyIds': ['first']}]
    run['sectorLinksVersion'] = 1
    view = project_consequences({'id': 'i'}, run, reference, [])
    assert view['sectorLinks'] == run['sectorLinks']
    view['sectorLinks'][0]['dependencyIds'].clear()
    assert run['sectorLinks'][0]['dependencyIds'] == ['first']
