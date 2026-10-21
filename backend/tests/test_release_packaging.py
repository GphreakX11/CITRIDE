"""Release image contracts: all app inputs, reproducible runtime, source-aware verification."""
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[2]


def _docker_stage(name):
    text=(ROOT/'backend/Dockerfile').read_text()
    stage=re.search(
        rf'^FROM\s+(\S+)\s+AS\s+{re.escape(name)}\s*\n(.*?)(?=^FROM\s|\Z)',
        text,re.M|re.S,
    )
    assert stage is not None, f'Missing Docker stage: {name}'
    return stage.group(1),stage.group(2)


def test_docker_runtime_copies_complete_reference_and_scripted_inputs():
    base,_=_docker_stage('runtime')
    assert base == 'dependencies', 'Runtime must inherit the complete dependency/input stage'
    _,text=_docker_stage('dependencies')
    assert re.search(r'^COPY\s+data/?\s+/app/data/?\s*$',text,re.M), 'Runtime must include data/reference.json, scripted replay and all telemetry/reference files'


def test_docker_runtime_installs_locked_production_dependencies():
    base,_=_docker_stage('runtime')
    assert base == 'dependencies'
    _,text=_docker_stage('dependencies')
    assert 'backend/uv.lock' in text
    assert re.search(r'uv sync\s+--locked\s+--no-dev',text)


def test_docker_verification_has_source_contracts_and_declared_dev_dependencies():
    base,text=_docker_stage('verification')
    assert base == 'dependencies', 'Verification must install dev dependencies before dropping privilege'
    assert re.search(r'^COPY\s+(?:frontend/src\s+/app/frontend/src|frontend\s+/app/frontend)\s*$',text,re.M)
    assert re.search(r'^COPY\s+vercel\.json\s+/app/vercel\.json\s*$',text,re.M), 'Deployment-control verification tests require the Vercel configuration input'
    assert re.search(r'^COPY\s+backend/scripts\s+/app/backend/scripts\s*$',text,re.M), 'Verification tests import backend operator and packaging scripts'
    assert 'uv sync --locked' in text
    assert re.search(r'^RUN\s+uv sync\s+--locked\s+--project\s+/app/backend\s*$',text,re.M), 'Verification must include declared dev dependencies, not --no-dev'


def test_docker_runnable_stages_share_inputs_without_runtime_auth_inheritance():
    _,dependencies=_docker_stage('dependencies')
    runtime_base,runtime=_docker_stage('runtime')
    verification_base,verification=_docker_stage('verification')
    assert runtime_base == verification_base == 'dependencies'
    assert 'ENV CITRIDE_REQUIRE_AUTH=1' in runtime
    assert 'CITRIDE_REQUIRE_AUTH' not in dependencies
    assert 'CITRIDE_REQUIRE_AUTH' not in verification
    assert 'USER 10001:10001' in runtime
    assert 'USER 10001:10001' in verification
