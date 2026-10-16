"""Large captured JSON literals must not trigger quadratic N-Quads line reads."""
from unittest.mock import patch

import pytest
from rdflib import Dataset, Literal, URIRef
from rdflib.compare import isomorphic

from citride.nquads import parse_nquads


def assert_same_graphs(left, right):
    names = {g.identifier for g in left.graphs() if len(g)}
    assert names == {g.identifier for g in right.graphs() if len(g)}
    assert all(isomorphic(left.graph(name), right.graph(name)) for name in names)


@pytest.mark.parametrize("ending", ["\n", "\r", "\r\n"])
@pytest.mark.parametrize("trailing", [True, False])
def test_uses_standard_quad_semantics_with_universal_line_endings(ending, trailing):
    lines = [
        '# blank lines and comments remain legal',
        '',
        '<urn:s> <urn:p> "quoted \\"value\\" and café \\u2603"@en <urn:g> .',
        '_:a <urn:p> _:b <urn:other> .',
        '_:b <urn:p> "42"^^<http://www.w3.org/2001/XMLSchema#integer> <urn:other> .',
        '<urn:s> <urn:p> "default graph" .',
    ]
    text = ending.join(lines) + (ending if trailing else '')
    expected = Dataset().parse(data=text, format='nquads')
    assert_same_graphs(expected, parse_nquads(text))


def test_multi_megabyte_json_literal_avoids_rdflibs_chunk_rescanning():
    text = '<urn:s> <urn:p> "' + ('a' * (3 * 1024 * 1024)) + '"^^<http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON> <urn:g> .\n'
    # Structural performance regression, not a machine-dependent time assertion.
    with patch('rdflib.plugins.parsers.ntriples.r_line') as regex:
        regex.match.side_effect = AssertionError('quadratic chunk line reader used')
        result = parse_nquads(text)
        regex.match.assert_not_called()
    value = result.graph(URIRef('urn:g')).value(URIRef('urn:s'), URIRef('urn:p'))
    assert isinstance(value, Literal)
    assert len(str(value)) == 3 * 1024 * 1024


def test_malformed_rdf_still_fails_in_standard_parser():
    with pytest.raises(Exception):
        parse_nquads('<urn:s> <urn:p> "unterminated <urn:g> .\n')
