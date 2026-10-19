"""Large generic server contract, independent of authored demo identities."""
from citride.sector_links import derive_sector_links


def test_three_hundred_recorded_asset_paths_group_without_losing_causality():
    entities = [{"id": "origin", "sector": "Origin", "type": "Facility"}]
    dependencies, impacts = [], []
    for index in range(300):
        entity_id, dependency_id = f"asset-{index}", f"dependency-{index}"
        entities.append({"id": entity_id, "sector": f"Zone {index % 12}", "type": "Facility"})
        dependencies.append({"id": dependency_id, "provider": "origin", "dependent": entity_id, "requiredService": "recorded_input"})
        impacts.append({"entityId": entity_id, "windowHours": [index % 4 + 1, index % 5 + 6], "paths": [[dependency_id]]})
    run = {"seed": {"provider": "origin"}, "baselineSnapshot": {"entities": entities, "dependencies": dependencies}, "impacts": impacts}
    reference = {"sectors": [], "serviceLabels": {"recorded_input": "recorded input"}}
    links = derive_sector_links(run, reference)
    assert len(links) == 12
    assert all(link["fromKind"] == "source" and link["from"] == "origin" and link["step"] == 1 and link["service"] == "recorded input" for link in links)
    assert set().union(*(set(link["dependencyIds"]) for link in links)) == {dependency["id"] for dependency in dependencies}
    by_id = {entity["id"]: entity for entity in entities}
    for link in links:
        members = [impact for impact in impacts if by_id[impact["entityId"]]["sector"] == link["to"]]
        assert link["windowHours"] == [min(impact["windowHours"][0] for impact in members), max(impact["windowHours"][1] for impact in members)]
        assert len(link["dependencyIds"]) == len(members)
