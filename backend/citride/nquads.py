"""Linear line framing with RDFLib's unchanged N-Quads term/quad parser.

RDFLib's chunk reader repeatedly scans the growing buffer for each long line.
Captured reasoning JSON is a single multi-megabyte literal, so that framing is
quadratic even for a small graph. Universal-newline StringIO handles framing in
linear time; RDFLib still validates every term, escape, graph and datatype.
There is no global parser registration or dependency monkeypatch.
"""
from io import StringIO

from rdflib import Dataset
from rdflib.parser import InputSource
from rdflib.plugins.parsers.nquads import NQuadsParser


class _LineFramedNQuadsParser(NQuadsParser):
    def readline(self):
        line = self.file.readline()
        return None if line == "" else line.rstrip("\r\n")


def parse_nquads(text: str) -> Dataset:
    dataset = Dataset()
    source = InputSource()
    with StringIO(text, newline=None) as stream:
        source.setCharacterStream(stream)
        _LineFramedNQuadsParser().parse(source, dataset)
    return dataset
