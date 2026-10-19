from copy import deepcopy
from pathlib import Path
from citride.consequence_projection import source_systems, ConsequenceService
from citride.storage import Repository


def test_source_systems_require_linked_events_type_and_source_containment():
    model = {'entities': [
        {'id':'source','type':'PortFacility'},
        {'id':'host','type':'PhysicalITAsset','partOf':'source'},
        {'id':'observed','type':'PhysicalITAsset','hostedBy':'host'},
        {'id':'identity','type':'CyberAsset','hostedBy':'observed'},
        {'id':'peer','type':'PhysicalITAsset','partOf':'other'},
        {'id':'unused','type':'PhysicalITAsset','partOf':'source'},
        {'id':'cycle','type':'PhysicalITAsset','partOf':'cycle'},
    ], 'events':[{'id':f'event-{x}','seenOn':x} for x in ['observed','peer','cycle','source','unused']]}
    incident={'linkedEventIds':['event-observed','event-peer','event-cycle','event-source']}
    before=deepcopy(model)
    result=source_systems(model,incident,'source')
    assert [e['id'] for e in result]==['observed']
    assert result[0]['eventRefs']==['event-observed']
    identity_model=deepcopy(model)
    identity_model['events'][0]['seenOn']='identity'
    assert source_systems(identity_model,incident,'source')==result
    assert source_systems(model,{},'source')==[]
    assert model==before


def test_houston_projection_exposes_only_recorded_source_systems_without_writes(tmp_path):
    store=Repository(tmp_path/'state',Path(__file__).resolve().parents[2]/'data/scenario.json')
    before=store.path.read_bytes()
    value=ConsequenceService(store).view('INC-2026-1002-POH')
    assert any(e['id']=='poh-tos' for e in value['sourceSystems'])
    assert all(e['type']=='PhysicalITAsset' and e['eventRefs'] for e in value['sourceSystems'])
    assert store.path.read_bytes()==before
