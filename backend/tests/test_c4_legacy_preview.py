"""Older populated stores get truthful previews without deployment migrations."""
from pathlib import Path
from rdflib import URIRef
import pytest
from citride.storage import Repository
from citride.records import RecordsService
from citride.consequence_projection import ConsequenceService

ROOT = Path(__file__).resolve().parents[2]

@pytest.fixture
def legacy(tmp_path):
    store = Repository(tmp_path / 'state', ROOT / 'data/scenario.json')
    records = RecordsService(store)
    port_id = records.model_sources[0]['incident']['id']
    with store._locked():
        dataset = store._load()
        for run in store._records(dataset, 'run'):
            if run.get('kind') == 'preliminary':
                dataset.remove_graph(URIRef('urn:citride:graph:run:' + run['id']))
        dataset.remove_graph(URIRef('urn:citride:graph:statewideIncidents:' + port_id))
        store._save(dataset)
    return store, records, port_id


def test_legacy_water_preview_is_explicit_and_never_saved(legacy, monkeypatch):
    store, records, _ = legacy
    before = store.path.read_bytes()
    def forbidden(*args, **kwargs):
        pytest.fail('GET projection must not write, initialize or mutate record graphs')
    monkeypatch.setattr(store, '_save', forbidden)
    monkeypatch.setattr(store, '_record_graph', forbidden)
    monkeypatch.setattr(records, 'initialize', forbidden)
    result = ConsequenceService(store, records).view()
    assert result['incident']['id'] == 'TX-26-0412'
    assert all(n['name'] == n.get('label', n['id']) for n in result['nodes'])
    assert result['analysisState'] == 'reference_preview'
    assert result['analysis']['kind'] == 'reference_preview'
    assert result['analysis']['persisted'] is False
    assert result['analysis']['referenceOnly'] is True
    assert result['atRisk'] == 3
    assert 'unsaved' in result['analysis']['createdAtBasis']
    assert store.path.read_bytes() == before


def test_uninstalled_incident_is_not_synthesized_from_a_display_catalog(legacy):
    store, records, port_id = legacy
    before = store.path.read_bytes()
    from citride.storage import NotFoundError
    with pytest.raises(NotFoundError, match='Incident was not found'):
        ConsequenceService(store, records).view(port_id)
    assert port_id not in {r['id'] for r in records.records()['statewideIncidents']}
    assert store.path.read_bytes() == before


def test_unmapped_event_is_not_promoted_to_a_reference_loss(legacy):
    store, records, _ = legacy
    before = store.path.read_bytes()
    view = ConsequenceService(store, records).view('TX-26-0398')
    assert view['analysis'] is None
    assert view['analysisState'] == 'no_analysis'
    assert view['nodes'] == []
    assert store.path.read_bytes() == before
