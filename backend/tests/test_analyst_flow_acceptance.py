from copy import deepcopy
from fastapi.testclient import TestClient
from citride.api import create_app


def test_case_what_if_is_separate_saved_run_and_hunt_update_is_readable(tmp_path):
    with TestClient(create_app(tmp_path / "state")) as client:
        reset = client.post('/v1/demo/reset', json={'expectedBaselineRevision': 1, 'clientRequestId': 'analyst-reset-fixture-1', 'confirm': 'RESET DEMO'})
        assert reset.status_code == 200, reset.text
        baseline = client.get('/v1/bootstrap').json()
        opened = client.post('/v1/command/incidents', json={
            'eventId': 'event-vpn-a', 'title': 'Analyst acceptance case', 'priority': 'high',
            'expectedBaselineRevision': baseline['baselineRevision'], 'clientRequestId': 'analyst-case-fixture-1'})
        assert opened.status_code == 201, opened.text
        case = opened.json()
        analyzed = client.post(f"/v1/command/incidents/{case['id']}/actions", json={
            'action': 'analyze', 'scenarioId': 'unsafe-water', 'evaluationHour': 1, 'horizonHours': 12,
            'expectedVersion': case['version'], 'clientRequestId': 'analyst-analysis-fixture-1'})
        assert analyzed.status_code == 200, analyzed.text
        case = analyzed.json()
        before = deepcopy(case)
        request = deepcopy(case['runSnapshot']['request'])
        request['overrides'] = [{'dependencyId': 'dep-a-x', 'backupMinHours': 6,
                                 'backupMaxHours': 6, 'note': f"What-if from case {case['title']}"}]
        request['clientRequestId'] = 'analyst-what-if-1'
        request['expectedBaselineRevision'] = case['runSnapshot']['baselineRevision']
        result = client.post('/v1/cascade-runs', json=request)
        assert result.status_code == 201, result.text
        what_if = result.json()
        assert what_if['id'] != case['runSnapshot']['id']
        impact = next(i for i in what_if['impacts'] if i['entityId'] == 'dialysis-x')
        original = next(i for i in case['runSnapshot']['impacts'] if i['entityId'] == 'dialysis-x')
        assert original['windowHours'] == [2, 4]
        assert impact['windowHours'] == [6, 8]
        assert what_if['request']['overrides'][0]['note'] == f"What-if from case {case['title']}"
        assert client.get(f"/v1/command/incidents/{case['id']}").json() == before
        assert client.get(f"/v1/cascade-runs/{what_if['id']}").json() == what_if
        records = client.get('/v1/command/records').json()
        hunt = next(h for h in records['hunts'] if h.get('caseId') == case['id'] or h.get('incidentId') in (case['id'], 'TX-26-0412'))
        update = client.post(f"/v1/command/incidents/{case['id']}/actions", json={
            'action': 'record_hunt', 'huntId': hunt['id'], 'status': 'findings',
            'resultNote': 'Completed session in A; B and C remain probing only.',
            'expectedVersion': case['version'], 'clientRequestId': 'analyst-hunt-acceptance-1'})
        assert update.status_code == 200, update.text
        saved = client.get('/v1/command/records').json()
        changed = next(h for h in saved['hunts'] if h['id'] == hunt['id'])
        assert changed['status'] == 'findings'
        assert changed['resultNote'] == 'Completed session in A; B and C remain probing only.'
