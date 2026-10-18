from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from citride.api import create_app


def test_planning_run_retry_is_idempotent_and_rejects_changed_payload(tmp_path):
    with TestClient(create_app(tmp_path / 'state')) as c:
        body={'scenarioId':'unsafe-water','evaluationHour':1,'horizonHours':12,'overrides':[],
              'expectedBaselineRevision':1,'clientRequestId':'planning-retry-1'}
        a=c.post('/v1/cascade-runs',json=body)
        assert a.status_code==201,a.text
        b=c.post('/v1/cascade-runs',json=body)
        assert b.status_code==201,b.text
        assert a.json()==b.json()
        runs = c.get('/v1/cascade-runs').json()['runs']
        assert len(runs) == 3
        assert sum(run['id'].startswith('preliminary-') for run in runs) == 2
        changed=c.post('/v1/cascade-runs',json={**body,'horizonHours':24})
        assert changed.status_code==409,changed.text
        runs = c.get('/v1/cascade-runs').json()['runs']
        assert len(runs) == 3
        assert sum(run['id'].startswith('preliminary-') for run in runs) == 2

def test_concurrent_planning_retries_save_exactly_one_run(tmp_path):
    with TestClient(create_app(tmp_path / 'state')) as c:
        body={'scenarioId':'unsafe-water','clientRequestId':'planning-concurrent-1'}
        c.get('/v1/bootstrap')
        with ThreadPoolExecutor(max_workers=3) as pool:
            results=list(pool.map(lambda _: c.post('/v1/cascade-runs',json=body),range(3)))
        assert all(r.status_code==201 for r in results), [r.text for r in results]
        assert len({r.json()['id'] for r in results})==1
        runs = c.get('/v1/cascade-runs').json()['runs']
        assert len(runs) == 3
        assert sum(run['id'].startswith('preliminary-') for run in runs) == 2

@pytest.mark.parametrize('key',['', 'bad/key', 'x'*129])
def test_planning_run_rejects_invalid_request_identity(tmp_path,key):
    with TestClient(create_app(tmp_path / 'state')) as c:
        assert c.post('/v1/cascade-runs',json={'scenarioId':'unsafe-water','clientRequestId':key}).status_code==422
