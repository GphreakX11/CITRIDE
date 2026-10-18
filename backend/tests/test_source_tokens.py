"""Stable review fences include named graphs and shared blank-node identities."""
import json
from pathlib import Path
import subprocess
import sys
import pytest
from rdflib import BNode, URIRef, Literal
from citride.storage import Repository
from citride.records import RecordsService
ROOT=Path(__file__).resolve().parents[2]
INCIDENT='INC-2026-1002-POH'

@pytest.mark.parametrize('operation',['install','adopt'])
def test_token_survives_new_process_with_historical_blank_nodes(tmp_path,operation):
    store=Repository(tmp_path/'state',ROOT/'data/scenario.json')
    with store._locked():
        ds=store._load()
        if operation=='install':
            for graph in list(ds.graphs()):
                for kind in ('statewideIncidents','assetStatuses','pendingDecisions','watchAssets','sectorViews','criticalFunctions','consequenceScores','run'):
                    for row in store._records(ds,kind):
                        if row.get('incidentId')==INCIDENT or kind=='statewideIncidents' and row['id']==INCIDENT:
                            from urllib.parse import quote
                            ds.remove_graph(URIRef(f'urn:citride:graph:{kind}:{quote(row["id"],safe="")}'))
        node=BNode();g=ds.graph(URIRef('urn:test:historical-proof'))
        g.add((node,URIRef('urn:test:proof'),Literal('preserve historical proof')))
        ds.graph(URIRef('urn:test:other-proof')).add((URIRef('urn:test:subject'),URIRef('urn:test:ref'),node))
        store._save(ds)
    script='install_source_incident.py' if operation=='install' else 'adopt_source_metadata.py'
    cmd=[sys.executable,str(ROOT/'backend/scripts'/script),'--data-dir',str(store.data_dir),'--scenario',str(store.scenario_path),'--incident-id',INCIDENT]
    one=json.loads(subprocess.check_output(cmd,text=True));two=json.loads(subprocess.check_output(cmd,text=True))
    assert one['token']==two['token']
    result=json.loads(subprocess.check_output(cmd+['--apply','--expected-token',one['token']],text=True))
    assert isinstance(result['applied'],bool)


def test_fingerprint_preserves_cross_graph_blank_node_identity():
    from rdflib import Dataset
    from citride.state_fingerprint import state_fingerprint
    def sample(shared):
        ds=Dataset();n=BNode();m=n if shared else BNode()
        ds.graph(URIRef('urn:g1')).add((URIRef('urn:s'),URIRef('urn:p'),n))
        ds.graph(URIRef('urn:g2')).add((URIRef('urn:s'),URIRef('urn:p'),m))
        return ds
    assert state_fingerprint(sample(True))==state_fingerprint(sample(True))
    assert state_fingerprint(sample(True))!=state_fingerprint(sample(False))
