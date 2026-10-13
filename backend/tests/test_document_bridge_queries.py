"""SPARQL acceptance for the locally implemented portions of the target bridges."""

from fastapi.testclient import TestClient
from rdflib import Dataset
from citride.api import create_app


CONTEXT_QUERY = """
PREFIX c: <urn:citride:>
PREFIX r: <urn:citride:record:>
SELECT DISTINCT ?asset ?facility ?provider ?area
WHERE {
  GRAPH <urn:citride:graph:baseline> {
    r:event-dosing c:seenOn ?cyber .
    ?cyber c:hostedBy ?asset .
    ?asset c:partOf+ ?facility .
    ?facility a c:TreatmentPlant ; c:partOf+ ?provider .
    ?provider a c:WaterServiceProvider ; c:serves ?area .
  }
}
"""

DEPENDENCY_QUERY = """
PREFIX c: <urn:citride:>
PREFIX r: <urn:citride:record:>
SELECT DISTINCT ?dependent ?function
WHERE {
  GRAPH <urn:citride:graph:baseline> {
    ?dependency a c:Dependency ; c:provider r:utility-a ;
                c:dependent ?dependent ; c:dependentFunction ?function .
  }
}
"""


def query_export(client, query):
    response = client.get("/v1/graph/export")
    assert response.status_code == 200, response.text
    dataset = Dataset()
    dataset.parse(data=response.text, format="nquads")
    result = dataset.query(query)
    return [{str(key): str(value) for key, value in row.asdict().items()} for row in result]


def test_event_to_facility_and_region_bridge(tmp_path):
    with TestClient(create_app(tmp_path / "state")) as client:
        assert query_export(client, CONTEXT_QUERY) == [{
            "asset": "urn:citride:record:plc-a",
            "facility": "urn:citride:record:plant-a",
            "provider": "urn:citride:record:utility-a",
            "area": "urn:citride:record:area-a",
        }]
        probe = CONTEXT_QUERY.replace("r:event-dosing", "r:event-probe-b")
        rows = query_export(client, probe)
        assert len(rows) == 1
        assert rows[0]["provider"] == "urn:citride:record:utility-b"


def test_service_dependencies_exclude_geographic_overlap(tmp_path):
    with TestClient(create_app(tmp_path / "state")) as client:
        dependents = {row["dependent"] for row in query_export(client, DEPENDENCY_QUERY)}
        assert dependents == {
            "urn:citride:record:dialysis-x", "urn:citride:record:hospital-y",
            "urn:citride:record:nursing-z", "urn:citride:record:fire-f",
        }
        assert "urn:citride:record:facility-q" not in dependents
