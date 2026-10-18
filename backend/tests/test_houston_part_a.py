"""Part A intake/projection regression, isolated temporary stores only."""
from copy import deepcopy
import json
from pathlib import Path
import pytest
from citride.records import RecordsService
from citride.consequence_projection import ConsequenceService
from citride.storage import Repository, InvalidModelError

ROOT = Path(__file__).resolve().parents[2]
INCIDENT = 'INC-2026-1002-POH'

@pytest.fixture
def store(tmp_path):
    return Repository(tmp_path / 'state', ROOT / 'data/scenario.json')

def test_durable_new_collections_and_union_counts(store):
    core = RecordsService(store)
    records = core.records(INCIDENT)
    assert len(records['watchAssets']) == 5
    assert len(records['criticalFunctions']) == 5
    assert len(records['sectorViews']) == len(records['consequenceScores']) == 1
    for name in ('watchAssets', 'criticalFunctions', 'sectorViews', 'consequenceScores'):
        assert all(r['id'] and r['classification'] == 'U' and 'SIMULATED' in r['handling'] for r in records[name])
        with store._locked():
            assert len(store._records(store._load(), name)) == len(records[name])
    before = store.path.read_bytes()
    view = ConsequenceService(store, core).view(INCIDENT)
    assert view['cascadeCount'] == 11
    assert view['watchCount'] == 5
    assert view['watchOnlyCount'] == 3
    assert view['infrastructureCount'] == 14
    watches = {r['entityId']: r for r in records['watchAssets']}
    assert watches['motiva-refinery']['status'] == 'monitoring'
    nodes = {n['id']: n for n in view['nodes']}
    assert nodes['crude-tankers']['windowHours'] == [6, 12]
    assert nodes['feedstock-pipelines']['windowHours'] == [12, 18]
    assert nodes['chemical-barges']['windowHours'] == [12, 18]
    assert len(view['criticalFunctions']) == 5
    assert {s['label']: s.get('score') for s in view['sectors']}['Energy'] == 82
    assert store.path.read_bytes() == before

def test_reference_exposes_configured_icons_and_service_labels_without_writes(store):
    before = store.path.read_bytes()
    core = RecordsService(store)
    assert core.reference['entityIcons']['VesselGroup'] == 'Ship'
    assert core.reference['entityIcons']['PortFacility'] == 'Container'
    assert core.reference['serviceLabels']['chlorine_supply'] == 'chlorine'
    assert store.path.read_bytes() == before


def test_invalid_new_record_is_atomic(store):
    core = RecordsService(store)
    row = deepcopy(core.records(INCIDENT)['watchAssets'][0])
    row['entityId'] = 'unknown-entity'
    before = store.path.read_bytes()
    with pytest.raises(InvalidModelError):
        core.ingest_records({'watchAssets': [row]}, 'test-feed')
    assert store.path.read_bytes() == before
    score = deepcopy(core.records(INCIDENT)['consequenceScores'][0])
    score['sectors'][0]['score'] = 101
    with pytest.raises(InvalidModelError):
        core.ingest_records({'consequenceScores': [score]}, 'test-feed')
    assert store.path.read_bytes() == before

def test_supplied_expected_windows_oracle(store):
    source = json.loads((ROOT / 'data/scripted/port_houston.json').read_text())
    nodes = {n['id']: n for n in ConsequenceService(store).view(INCIDENT)['nodes']}
    mismatches = {k: {'expected': v, 'actual': nodes.get(k, {}).get('windowHours')} for k, v in source['expectedWindows'].items() if isinstance(v, list) and nodes.get(k, {}).get('windowHours') != v}
    assert not mismatches, mismatches


def test_third_customer_source_list_and_isolated_projection(tmp_path):
    import shutil
    from citride.scripted_sources import load_sources
    inputs = tmp_path / 'customer-data'
    (inputs / 'scripted').mkdir(parents=True)
    for name in ('scenario.json', 'reference.json'):
        shutil.copyfile(ROOT / 'data' / name, inputs / name)
    for name in ('watershed_beta.json', 'port_houston.json', 'c4_reference.json', 'sources.json'):
        shutil.copyfile(ROOT / 'data/scripted' / name, inputs / 'scripted' / name)
    _, models, reference = load_sources(inputs / 'scenario.json')
    bundle = models[0]
    identifiers = set()
    def collect(value):
        if isinstance(value, dict):
            if isinstance(value.get('id'), str):
                identifiers.add(value['id'])
            for child in value.values():
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)
    collect(bundle)
    def remap(value):
        if isinstance(value, str):
            return 'third-' + value if value in identifiers else value
        if isinstance(value, list):
            return [remap(v) for v in value]
        if isinstance(value, dict):
            return {remap(k): remap(v) for k, v in value.items()}
        return value
    third = remap(bundle)
    assert isinstance(third, dict)
    third['incident'].update(title='Fictional North Coast cargo incident', customerId='customer-third')
    third['incident']['location'] = {'label': 'Fictional North Coast', 'latitude': 44, 'longitude': -70}
    for entity in third['entities']:
        entity.update(sector='Fictional logistics', schematic={'x': 20, 'y': 40})
    (inputs / 'scripted/third.json').write_text(json.dumps(third))
    manifest = json.loads((inputs / 'scripted/sources.json').read_text())
    manifest['models'].append('third.json')
    (inputs / 'scripted/sources.json').write_text(json.dumps(manifest))
    reference.update(featuredIncidentId=third['incident']['id'], operationsTimeZone='America/New_York')
    (inputs / 'scripted/c4_reference.json').write_text(json.dumps(reference))
    store = Repository(tmp_path / 'third-state', inputs / 'scenario.json')
    view = ConsequenceService(store).view()
    assert view['incident']['id'] == third['incident']['id']
    assert view['operationsTimeZone'] == 'America/New_York'
    assert view['cascadeCount'] == 11
    assert len(view['watchAssets']) == 5
    assert all(r['incidentId'] == third['incident']['id'] for r in view['watchAssets'])
    assert all(n['sector'] == 'Fictional logistics' for n in view['nodes'])
    original = Repository(tmp_path / 'original-state', ROOT / 'data/scenario.json')
    assert third['incident']['id'] not in {r['id'] for r in RecordsService(original).records()['statewideIncidents']}


def test_larger_intake_50_incidents_300_assets(store):
    core = RecordsService(store)
    prototype = deepcopy(core.scripted['incidents'][0])
    provenance = {k: deepcopy(prototype[k]) for k in ('origin', 'sourceRefs', 'classification', 'handling')}
    incidents, assets, watches = [], [], []
    for number in range(50):
        incident = {**deepcopy(prototype), 'id': f'fixture-incident-{number}', 'linkedEventIds': [], 'status': 'open'}
        incident.pop('preliminaryScenario', None)
        incident.pop('caseId', None)
        incidents.append(incident)
        for index in range(6):
            entity_id = f'fixture-asset-{number}-{index}'
            assets.append({'id': entity_id, 'type': 'PortFacility', 'label': entity_id, 'sector': 'Fictional logistics', 'schematic': {'x': index * 30, 'y': number * 10}, **provenance})
            watches.append({'id': 'watch-' + entity_id, 'incidentId': incident['id'], 'entityId': entity_id, 'status': 'monitoring', 'reason': 'Isolated fixture observation', **provenance})
    # Validation model only: this test does not pretend to provision a customer or run cascades.
    core._validation_scenario['entities'].extend(assets)
    core.ingest_records({'statewideIncidents': incidents, 'watchAssets': watches}, 'fixture-feed')
    rows = core.records()
    assert len([r for r in rows['statewideIncidents'] if r['id'].startswith('fixture-incident-')]) == 50
    assert len([r for r in rows['watchAssets'] if r['id'].startswith('watch-fixture-')]) == 300
    assert len(core.records('fixture-incident-49')['watchAssets']) == 6
    assert core.records('fixture-incident-49')['statewideIncidents'][0]['consequenceSummary']['watchOnlyCount'] == 6


def test_http_contract_and_stable_reingest(store, monkeypatch):
    from fastapi.testclient import TestClient
    from citride.api import create_app
    monkeypatch.delenv('CITRIDE_DEMO_PASSWORD', raising=False)
    core = RecordsService(store)
    original_runs = deepcopy(store.runs())
    watched = core.records(INCIDENT)['watchAssets']
    core.ingest_records({'watchAssets': watched}, 'scripted')
    assert [r['id'] for r in core.records(INCIDENT)['watchAssets']] == [r['id'] for r in watched]
    assert store.runs() == original_runs
    before = store.path.read_bytes()
    with TestClient(create_app(store.data_dir, store.scenario_path)) as client:
        records = client.get('/v1/command/records', params={'incidentId': INCIDENT}).json()
        result = client.get('/v1/command/consequences', params={'incidentId': INCIDENT})
        assert result.status_code == 200
        view = result.json()
        assert len(records['watchAssets']) == len(view['watchAssets']) == 5
        assert view['infrastructureCount'] == 14
        assert view['entityIcons']['PortFacility'] == 'Container'
        assert view['serviceLabels']['chlorine_supply'] == 'chlorine'
        incident = next(i for i in records['statewideIncidents'] if i['id'] == INCIDENT)
        assert incident['consequenceSummary']['cascadeCount'] == view['cascadeCount']
    assert store.path.read_bytes() == before
