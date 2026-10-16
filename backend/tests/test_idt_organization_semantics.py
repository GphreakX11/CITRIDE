"""IDT includes operating agencies without turning them into physical facilities."""
import json
from pathlib import Path

from rdflib import Graph, Namespace, OWL
from citride.reasoning import compute_inference, ontology_document

C=Namespace('urn:citride:')
ROOT=Path(__file__).resolve().parents[2]


def test_coded_water_agencies_are_consistent_but_are_not_physical_facilities_or_assets():
    data=json.loads((ROOT/'data/scenario.json').read_text())
    run=compute_inference(data,'idt-agency-consistency',idt_load_mode='assigned_closure')
    facts=run['assertedFacts']+run['inferredFacts']
    for id in ['org-a','org-b','org-c']:
        classes={f['object']['iri'] for f in facts if f['subject']['id']==id and f['predicate']['iri'].endswith('#type')}
        assert str(C.IDT_12_10_2) in classes
        assert str(C.InfrastructureEntity) in classes
        assert not classes.intersection({str(C.PhysicalFacility),str(C.PhysicalAsset),str(C.CyberAsset)})
    assert run['diagnostics'][0]['status']=='passed'


def test_organization_disjointness_remains_for_concrete_physical_and_cyber_categories():
    graph=Graph().parse(data=ontology_document(),format='turtle')
    assert (C.Organization,OWL.disjointWith,C.InfrastructureEntity) not in graph
    for target in [C.PhysicalFacility,C.PhysicalAsset,C.CyberAsset]:
        assert (C.Organization,OWL.disjointWith,target) in graph
