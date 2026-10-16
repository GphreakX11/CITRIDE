"""Release image contracts: all app inputs, reproducible runtime, source-aware verification."""
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[2]


def test_docker_runtime_copies_complete_reference_and_scripted_inputs():
    text=(ROOT/'backend/Dockerfile').read_text().split('FROM runtime AS verification')[0]
    assert re.search(r'^COPY\s+data/?\s+/app/data/?\s*$',text,re.M), 'Runtime must include data/reference.json, scripted replay and all telemetry/reference files'


def test_docker_runtime_installs_locked_production_dependencies():
    text=(ROOT/'backend/Dockerfile').read_text()
    assert 'backend/uv.lock' in text
    assert re.search(r'uv sync\s+--locked\s+--no-dev',text)


def test_docker_verification_has_source_contracts_and_declared_dev_dependencies():
    text=(ROOT/'backend/Dockerfile').read_text().split('FROM runtime AS verification')[1]
    assert re.search(r'^COPY\s+(?:frontend/src\s+/app/frontend/src|frontend\s+/app/frontend)\s*$',text,re.M)
    assert 'uv sync --locked' in text
