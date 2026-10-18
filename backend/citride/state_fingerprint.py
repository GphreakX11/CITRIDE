"""Semantic dataset fingerprint stable across RDF blank-node relabeling.

Grounded quads need only sorting. Quads containing blank nodes are reified in a
small auxiliary graph, retaining graph names and cross-graph identity, then
canonicalized together. Canonicalizing each named graph independently would lose
shared blank-node identity. This does not rewrite persisted historical data.
"""
from hashlib import sha256
import json
from rdflib import BNode, Graph, URIRef
from rdflib.compare import to_canonical_graph


def state_fingerprint(dataset):
    grounded = []
    anonymous = Graph()
    roles = [URIRef('urn:citride:fingerprint:' + role) for role in ('s', 'p', 'o', 'g')]
    for quad in dataset.quads((None, None, None, None)):
        if not any(isinstance(value, BNode) for value in quad):
            grounded.append(tuple(value.n3() for value in quad))
        else:
            statement = BNode()
            for role, value in zip(roles, quad):
                anonymous.add((statement, role, value))
    canonical = sorted(tuple(value.n3() for value in triple)
                       for triple in to_canonical_graph(anonymous))
    payload = {'grounded': sorted(grounded), 'anonymous': canonical}
    return sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
