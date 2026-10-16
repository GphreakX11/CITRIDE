"""Independent acceptance checks for the deterministic Corelight-format fixture."""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import ipaddress
import json
import re
import struct
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

ROOT = Path(__file__).resolve().parents[2]
KINDS = ('conn', 'ssl', 'http', 'dns', 'modbus', 'modbus_detailed', 'notice', 'vpn')
LABEL = 'Network · Corelight format (simulated)'


def load(kind):
    return json.loads((ROOT / 'data/telemetry/corelight' / f'{kind}.json').read_text())


def test_eight_arrays_manifest_and_compatibility():
    manifest = load('manifest')
    assert 'Corelight/Zeek JSON log format; simulated content for the Watershed 250 demo.' in manifest['sourceFormatDisclaimer']
    assert {r['id'] for r in manifest['logs']} == {f'corelight/{k}' for k in KINDS}
    assert 'not' in manifest['sourceFormatDisclaimer'].lower()
    for entry in manifest['logs']:
        kind = entry['id'].split('/')[1]
        rows = load(kind)
        assert isinstance(rows, list) and rows
        assert entry['file'] == f'data/telemetry/corelight/{kind}.json'
        assert entry['recordCount'] == len(rows)
        assert entry['startTs'] == min(r['ts'] for r in rows)
        assert entry['endTs'] == max(r['ts'] for r in rows)
        assert entry['origin'] == 'simulated'
        assert entry['label'] == LABEL
        assert entry['format'] == ('synthetic_vpn_auth_json' if kind == 'vpn' else 'corelight_zeek_json')
    assert json.loads((ROOT / 'data/telemetry/network.json').read_text())['records'] == load('conn')


def test_schema_provenance_chronology_and_reserved_endpoints():
    common = {'_path', '_system_name', '_write_ts', 'id', 'relativeTimeHours', 'utilityId', 'observation', 'anomalous', 'origin', 'sourceRefs', 'classification', 'handling', 'ts'}
    fields = {
        'conn': {'uid', 'proto', 'service', 'duration', 'orig_bytes', 'resp_bytes', 'conn_state', 'local_orig', 'local_resp', 'missed_bytes', 'history', 'orig_pkts', 'orig_ip_bytes', 'resp_pkts', 'resp_ip_bytes', 'tunnel_parents', 'community_id'},
        'ssl': {'uid', 'version', 'cipher', 'server_name', 'established', 'ja3', 'ja3s'},
        'http': {'uid', 'trans_depth', 'method', 'host', 'uri', 'user_agent', 'request_body_len', 'response_body_len', 'status_code', 'status_msg'},
        'dns': {'uid', 'proto', 'query', 'qtype_name', 'rcode_name', 'answers', 'TTLs'},
        'modbus': {'uid', 'unit_id', 'func', 'pdu_type'},
        'modbus_detailed': {'uid', 'unit_id', 'func', 'request_response', 'address', 'quantity', 'values'},
        'notice': {'uid', 'note', 'msg', 'sub', 'src', 'dst', 'p', 'actions', 'suppress_for'},
        'vpn': {'uid', 'user', 'gateway', 'result', 'action', 'outcome', 'sourceIp', 'assignedIp'},
    }
    networks = [ipaddress.ip_network(n) for n in ('192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24')]
    origin = datetime.fromisoformat(json.loads((ROOT / 'data/scenario.json').read_text())['incidentOrigin'].replace('Z', '+00:00'))
    assert origin.astimezone(ZoneInfo('America/Chicago')).hour == 2
    ids = []
    for kind in KINDS:
        rows = load(kind)
        assert [r['ts'] for r in rows] == sorted(r['ts'] for r in rows)
        for row in rows:
            ids.append(row['id'])
            assert common | fields[kind] <= row.keys()
            assert row['_path'] == kind and row['_system_name'] in {'w250-sensor-a', 'w250-sensor-b', 'w250-sensor-c'}
            assert row['origin'] == 'simulated' and row['sourceRefs'] == ['src-network']
            assert row['classification'] == 'U' and row['handling'] == ['SIMULATED']
            assert row['ts'] == pytest.approx(origin.timestamp() + row['relativeTimeHours'] * 3600, abs=.002)
            assert row['_write_ts'] >= row['ts']
            assert re.fullmatch(r'C[0-9A-Za-z]{17}', row['uid'])
            if row['anomalous']:
                assert row['interpretation']
            for key in ('id.orig_h', 'id.resp_h', 'sourceIp', 'assignedIp', 'src', 'dst'):
                if key in row:
                    assert any(ipaddress.ip_address(row[key]) in net for net in networks)
            for key in ('server_name', 'host', 'query'):
                if key in row:
                    assert row[key].endswith(('.example', '.example.net', '.test'))
    assert len(ids) == len(set(ids))


def test_read_timestamps_are_exact_five_minute_ticks():
    for row in load('modbus'):
        if not row['anomalous']:
            time = datetime.fromtimestamp(row['ts'], ZoneInfo('America/Chicago'))
            assert time.minute % 5 == 0 and time.second == 0 and time.microsecond == 0


def independent_community_id(row):
    # Wire-format implementation independent of the generator's tuple handling.
    endpoints = [(ipaddress.ip_address(row['id.orig_h']).packed, row['id.orig_p']), (ipaddress.ip_address(row['id.resp_h']).packed, row['id.resp_p'])]
    (a, ap), (b, bp) = sorted(endpoints)
    protocol = {'tcp': 6, 'udp': 17}[row['proto']]
    wire = bytes(2) + a + b + bytes([protocol, 0]) + struct.pack('!HH', ap, bp)
    return '1:' + base64.b64encode(hashlib.sha1(wire).digest()).decode()


def test_community_ids_and_seeded_uids():
    rows = load('conn')
    assert len({r['uid'] for r in rows}) == len(rows)
    for row in rows:
        assert row['community_id'] == independent_community_id(row)
    module_spec = importlib.util.spec_from_file_location('corelight_fixture', ROOT / 'scripts/generate_corelight.py')
    assert module_spec is not None and module_spec.loader is not None
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    scenario = json.loads((ROOT / 'data/scenario.json').read_text())
    epoch = datetime.fromisoformat(scenario['incidentOrigin'].replace('Z', '+00:00'))
    first = module.generate_corelight(250, epoch)
    assert first == module.generate_corelight(250, epoch)
    assert first['conn'] == rows
    assert first['conn'][0]['uid'] != module.generate_corelight(251, epoch)['conn'][0]['uid']


def test_background_volume_persistent_polling_and_old_ids():
    conns = load('conn')
    assert 300 <= len(conns) <= 600
    for letter in 'abc':
        utility = f'utility-{letter}'
        assert {f'conn-{letter}-baseline-{i:03d}' for i in range(1, 7)} <= {r['id'] for r in conns}
        reads = [r for r in load('modbus') if r['utilityId'] == utility and not r['anomalous']]
        assert {round(-2 + n / 12, 6) for n in range(61)} <= {r['relativeTimeHours'] for r in reads}
        polls = [r for r in load('http') if r['utilityId'] == utility and not r['anomalous']]
        assert len(polls) == 301 and len({r['uid'] for r in polls}) < 10
        assert all(r['method'] == 'GET' and r['status_code'] == 200 for r in polls)
        assert {r['uri'] for r in polls} == {'/api/v1/status', '/api/v1/process/tank-levels', '/api/v1/process/chemical-dosing', '/api/v1/alarms/active'}


def test_attack_chain_and_probes_only():
    conns = {r['id']: r for r in load('conn')}
    vpn = next(r for r in load('vpn') if r['id'] == 'vpn-a-login-001')
    assert vpn['relativeTimeHours'] == -.5 and vpn['user'] == 'vendor-v-support' and vpn['outcome'] == 'success'
    vpn_conn = next(r for r in conns.values() if r['uid'] == vpn['uid'])
    assert vpn_conn['id.orig_h'] == '203.0.113.250' and vpn_conn['id.resp_h'] == '198.51.100.41'
    assert vpn_conn['id.resp_p'] == 443 and vpn_conn['conn_state'] == 'SF'
    inbound = conns['conn-a-unusual-001']
    assert inbound['id.orig_h'] == '192.0.2.240' and inbound['relativeTimeHours'] == -.1
    assert inbound['tunnel_parents'] == [vpn['uid']]
    login = [r for r in load('http') if r['anomalous']]
    assert [(r['method'], r['uri']) for r in login] == [('GET', '/login'), ('POST', '/login')]
    writes = [r for r in load('modbus_detailed') if r['func'] == 'WRITE_SINGLE_REGISTER']
    assert len(writes) == 1
    assert writes[0]['relativeTimeHours'] == 0 and writes[0]['address'] == 40011 and writes[0]['values'] == [4]
    assert writes[0]['quantity'] == 1 and writes[0]['previousValues'] == [1]
    assert {r['note'] for r in load('notice')} == {'W250::Offsite_VPN_Login', 'W250::Modbus_Write_New_Source', 'Scan::Port_Scan'}
    for letter, hour in [('b', .5), ('c', .75)]:
        probes = [r for r in conns.values() if r['utilityId'] == f'utility-{letter}' and r['anomalous']]
        assert {r['id.resp_p'] for r in probes} == {502, 102, 20000, 44818}
        assert all(r['conn_state'] in {'S0', 'REJ'} and r['id.orig_h'] == '203.0.113.250' for r in probes)
        assert max(r['ts'] for r in probes) - min(r['ts'] for r in probes) <= 20
        assert min(r['relativeTimeHours'] for r in probes) == hour
        assert not any(r['anomalous'] and r['utilityId'] == f'utility-{letter}' for r in load('modbus'))
    assert {-16, -13} <= {r['relativeTimeHours'] for r in load('vpn') if not r['anomalous']}


def test_event_refs_controller_origins_and_inventory():
    scenario = json.loads((ROOT / 'data/scenario.json').read_text())
    streams = {f'corelight/{k}': {r['id']: r for r in load(k)} for k in KINDS}
    for kind in ('controller', 'sensors', 'enterprise'):
        rows = json.loads((ROOT / f'data/telemetry/{kind}.json').read_text())['records']
        streams[kind] = {r['id']: r for r in rows}
        assert all(r['origin'] == 'simulated' for r in rows)
    entities = {r['id']: r for r in scenario['entities']}
    events = {r['id']: r for r in scenario['events']}
    assert events['event-vpn-a']['seenOn'] == 'cyber-vpn-a'
    assert entities['cyber-vpn-a']['type'] == 'CyberAsset'
    canonical = json.loads((ROOT / 'data/reference/idt/idt_v4.json').read_text())['assignments']
    for letter in 'abc':
        assert entities[f'cyber-workstation-{letter}']['ipAddress'] == f'192.0.2.{51 + "abc".index(letter)}'
        for prefix in ('vpn', 'cyber-vpn'):
            assert entities[f'{prefix}-{letter}']['idt'] == canonical[f'{prefix}-{letter}']
    assert len({r['ipAddress'] for r in entities.values() if 'ipAddress' in r}) == len([r for r in entities.values() if 'ipAddress' in r])
    for event in events.values():
        for ref in [event['rawRef'], *event.get('networkEvidenceRefs', [])]:
            assert ref['recordId'] in streams[ref['streamId']]
        raw = streams[event['rawRef']['streamId']][event['rawRef']['recordId']]
        assert raw['relativeTimeHours'] == event['relativeTimeHours']
    assert events['event-inbound-a']['rawRef']['streamId'] == 'corelight/conn'
    assert any(r['streamId'] == 'corelight/modbus_detailed' for r in events['event-dosing']['networkEvidenceRefs'])
    for record_id in ('controller-auth-001', 'controller-change-001'):
        assert streams['controller'][record_id]['sourceIp'] == '192.0.2.240'


def test_application_rows_join_conn_and_standard_fields_precede_metadata():
    conns = {r['uid']: r for r in load('conn')}
    for kind in KINDS:
        for row in load(kind):
            conn = conns[row['uid']]
            for key in ('id.orig_h', 'id.orig_p', 'id.resp_h', 'id.resp_p'):
                assert row[key] == conn[key]
            keys = list(row)
            assert keys[0:2] == ['ts', 'uid']
            assert keys.index('id.resp_p') < keys.index('_path') < keys.index('origin')
            assert conn['ts'] <= row['ts'] + .002
            assert row['ts'] <= conn['ts'] + conn['duration'] + .002
            if kind == 'ssl':
                assert re.fullmatch('[0-9a-f]{32}', row['ja3'])
                assert re.fullmatch('[0-9a-f]{32}', row['ja3s'])
            if kind == 'notice' and row['utilityId'] != 'utility-a':
                assert 'attempt' in row['interpretation'].lower()
    for letter in 'abc':
        conn = next(r for r in conns.values() if r['id'] == f'conn-{letter}-http-persistent')
        polls = [r for r in load('http') if r['uid'] == conn['uid']]
        assert conn['resp_bytes'] >= sum(r['response_body_len'] for r in polls)
        assert conn['_write_ts'] >= conn['ts'] + conn['duration']
