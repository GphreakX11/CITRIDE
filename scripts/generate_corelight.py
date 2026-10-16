"""Deterministic, invented network records in Corelight/Zeek-shaped JSON.

Format compatibility is not source provenance: no sensor export is represented.
Only TCP/UDP documentation-address flows are generated; Community ID uses seed 0.
"""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import random
import string
import struct
from datetime import datetime, timedelta

LABEL = "Network · Corelight format (simulated)"
KINDS = ("conn", "ssl", "http", "dns", "modbus", "modbus_detailed", "notice", "vpn")
SHARED_SOURCE = "synthetic-campaign-01"
SOURCE_FORMAT_DISCLAIMER = (
    "Corelight/Zeek JSON log format; simulated content for the Watershed 250 demo. "
    "Generated simulated records using Corelight/Zeek field conventions, not a Corelight sensor export "
    "or evidence of actual network activity. VPN records are synthetic authentication JSON, not a Zeek log. "
    "The 300–600 connection target takes precedence over the incompatible per-10-minute volume prose; "
    "persistent HTTP sessions carry one-minute application polling."
)


def community_id(orig_h: str, orig_p: int, resp_h: str, resp_p: int, proto: str) -> str:
    """Community ID v1: canonical endpoints, seed 0, IP protocol and ports."""
    src, dst = ipaddress.ip_address(orig_h).packed, ipaddress.ip_address(resp_h).packed
    if (src, orig_p) > (dst, resp_p):
        src, dst, orig_p, resp_p = dst, src, resp_p, orig_p
    payload = struct.pack("!H", 0) + src + dst + struct.pack("!BBHH", {"tcp": 6, "udp": 17}[proto], 0, orig_p, resp_p)
    return "1:" + base64.b64encode(hashlib.sha1(payload).digest()).decode("ascii")


def generate_corelight(seed: int, epoch: datetime) -> dict[str, list[dict]]:
    rng = random.Random(seed)
    logs = {kind: [] for kind in KINDS}
    alphabet = string.ascii_letters + string.digits
    used_uids = set()

    def uid():
        while True:
            value = "C" + "".join(rng.choice(alphabet) for _ in range(17))
            if value not in used_uids:
                used_uids.add(value)
                return value

    def record(kind, identifier, hour, letter, fields, observation, target=None, anomalous=False, **extra):
        ts = (epoch + timedelta(hours=hour)).timestamp()
        row = {"ts": ts, **fields, "_path": kind, "_system_name": f"w250-sensor-{letter}", "_write_ts": round(ts + (fields["duration"] if kind == "conn" else 0) + .001, 6),
               "id": identifier, "relativeTimeHours": round(hour, 6),
               "timestamp": (epoch + timedelta(hours=hour)).isoformat().replace("+00:00", "Z"),
               "utilityId": f"utility-{letter}", "observation": observation, "anomalous": anomalous,
               "origin": "simulated", "sourceRefs": ["src-network"], "classification": "U", "handling": ["SIMULATED"], **extra}
        if target:
            row["targetAssetId"] = target
        if anomalous:
            row["sharedSourceIdentity"] = SHARED_SOURCE
            row["interpretation"] = extra.get("interpretation", "Simulated activity at A; correlation is scenario evidence, not actor attribution or proof of a physical effect.")
        logs[kind].append(row)
        return row

    def connection(identifier, hour, letter, src, dst, port, service, target=None, *, state="SF", duration=1.5, proto="tcp", anomalous=False, parents=None, observation="normal_background"):
        sport = rng.randrange(40000, 60000)
        complete = state == "SF"
        fields = {"uid": uid(), "id.orig_h": src, "id.orig_p": sport, "id.resp_h": dst, "id.resp_p": port,
                  "proto": proto, "service": service, "duration": duration, "orig_bytes": 64 if complete else 0,
                  "resp_bytes": 96 if complete else 0, "conn_state": state,
                  "local_orig": src.startswith("192.0.2."), "local_resp": dst.startswith("192.0.2."),
                  "missed_bytes": 0, "history": "Dd" if proto == "udp" else ("ShADadFf" if complete else ("Sr" if state == "REJ" else "S")),
                  "orig_pkts": 8 if complete else 1, "orig_ip_bytes": 384 if complete else 60,
                  "resp_pkts": 8 if complete else (1 if state == "REJ" else 0), "resp_ip_bytes": 416 if complete else (40 if state == "REJ" else 0),
                  "tunnel_parents": list(parents or []), "community_id": community_id(src, sport, dst, port, proto)}
        return record("conn", identifier, hour, letter, fields, observation, target, anomalous)

    def app(kind, identifier, hour, letter, conn, fields, observation, anomalous=False, **extra):
        endpoint_fields = {key: conn[key] for key in ("uid", "id.orig_h", "id.orig_p", "id.resp_h", "id.resp_p")}
        return record(kind, identifier, hour, letter, {**endpoint_fields, **fields}, observation, conn.get("targetAssetId"), anomalous, **extra)

    def tls(identifier, hour, letter, conn, name, anomalous=False):
        def fingerprint(role):
            return hashlib.md5(f"{seed}:{letter}:{role}".encode(), usedforsecurity=False).hexdigest()
        return app("ssl", identifier, hour, letter, conn,
                   {"version": "TLSv12", "cipher": "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256", "server_name": name,
                    "established": True, "ja3": fingerprint("client"), "ja3s": fingerprint("server")},
                   "offsite_vpn_tls" if anomalous else "normal_tls", anomalous)

    def read(identifier, hour, letter, conn, anomalous=False):
        app("modbus", f"modbus-{identifier}", hour, letter, conn,
            {"unit_id": 1, "func": "READ_HOLDING_REGISTERS", "pdu_type": "request"}, "unusual_source_read" if anomalous else "normal_polling", anomalous)
        app("modbus_detailed", f"detail-{identifier}", hour, letter, conn,
            {"unit_id": 1, "func": "READ_HOLDING_REGISTERS", "request_response": "request", "address": 40001, "quantity": 2, "values": []},
            "unusual_source_read" if anomalous else "normal_polling", anomalous)

    def notice(identifier, hour, letter, conn, note, message):
        return app("notice", identifier, hour, letter, conn,
                   {"note": note, "msg": message, "sub": "Simulated Watershed scenario", "src": conn["id.orig_h"],
                    "dst": conn["id.resp_h"], "p": conn["id.resp_p"], "actions": ["Notice::ACTION_LOG"], "suppress_for": 3600.0},
                   note, True, interpretation=(
                       "Probe attempts only; no completed attacker session, control write, compromise, or physical effect is established."
                       if note == "Scan::Port_Scan" else "Simulated activity at A; correlation is scenario evidence, not actor attribution or proof of a physical effect."
                   ))

    def vpn_session(letter, hour, identifier, anomalous=False):
        index = "abc".index(letter)
        conn = connection(f"conn-{identifier}", hour, letter, "203.0.113.250" if anomalous else "203.0.113.100",
                          f"198.51.100.{41 + index}", 443, "ssl", f"vpn-{letter}", duration=12600.0 if anomalous else 1800.0,
                          anomalous=anomalous, observation="offsite_vpn_login" if anomalous else "normal_vendor_vpn")
        tls(f"ssl-{identifier}", hour, letter, conn, f"vpn.utility-{letter}.example", anomalous)
        app("vpn", identifier, hour, letter, conn,
            {"user": "vendor-v-support", "action": "login", "result": "success", "outcome": "success", "sourceIp": conn["id.orig_h"],
             "assignedIp": "192.0.2.240", "gateway": f"vpn.utility-{letter}.example", "sessionId": conn["uid"]},
            "offsite_vpn_login" if anomalous else "normal_vendor_vpn", anomalous)
        return conn

    baseline_hours = [-2, -1.5, -1, -.75, -.5, -.25]
    uris = ["/api/v1/status", "/api/v1/process/tank-levels", "/api/v1/process/chemical-dosing", "/api/v1/alarms/active"]
    for index, letter in enumerate("abc"):
        hmi, plc, historian, workstation = [f"192.0.2.{base + index}" for base in (21, 11, 31, 51)]
        for n in range(61):
            hour = -2 + n / 12
            identifier = f"conn-{letter}-baseline-{baseline_hours.index(hour) + 1:03d}" if hour in baseline_hours else f"conn-{letter}-read-{n:03d}"
            conn = connection(identifier, hour, letter, hmi, plc, 502, "modbus", f"plc-{letter}", observation="normal_polling")
            read(identifier, hour, letter, conn)
        persistent = connection(f"conn-{letter}-http-persistent", -2, letter, hmi, historian, 80, "http", duration=18001.0, observation="normal_http_polling")
        for n in range(301):
            app("http", f"http-{letter}-poll-{n:03d}", -2 + n / 60, letter, persistent,
                {"trans_depth": n + 1, "method": "GET", "host": f"historian.utility-{letter}.example", "uri": uris[n % len(uris)],
                 "user_agent": "Watershed-HMI/1.0", "request_body_len": 0, "response_body_len": 256, "status_code": 200, "status_msg": "OK"}, "normal_http_polling")
        for n in range(31):
            hour = -2 + n / 6
            name = ["updates.vendor-v.example", "time.example.net", f"historian.utility-{letter}.example"][n % 3]
            conn = connection(f"conn-{letter}-dns-{n:03d}", hour, letter, workstation, "192.0.2.53", 53, "dns", proto="udp")
            app("dns", f"dns-{letter}-{n:03d}", hour, letter, conn,
                {"proto": "udp", "query": name, "qtype_name": "A", "rcode_name": "NOERROR", "answers": ["198.51.100.80" if n % 3 == 0 else "198.51.100.123" if n % 3 == 1 else historian], "TTLs": [300.0]}, "normal_name_resolution")
        for n in range(11):
            hour = -2 + n / 2
            conn = connection(f"conn-{letter}-tls-{n:03d}", hour, letter, workstation, "198.51.100.80", 443, "ssl")
            tls(f"ssl-{letter}-{n:03d}", hour, letter, conn, "updates.vendor-v.example")
            connection(f"conn-{letter}-time-{n:03d}", hour, letter, workstation, "198.51.100.123", 123, "ntp", proto="udp")

    for n, hour in enumerate((-16, -13), 1):
        vpn_session("a", hour, f"vpn-a-normal-{n:03d}")

    vpn_conn = vpn_session("a", -.5, "vpn-a-login-001", True)
    notice("notice-vpn-a", -.5, "a", vpn_conn, "W250::Offsite_VPN_Login", "Vendor account login outside its normal hours")
    inbound = connection("conn-a-unusual-001", -.1, "a", "192.0.2.240", "192.0.2.11", 502, "modbus", "plc-a", duration=370,
                         anomalous=True, parents=[vpn_conn["uid"]], observation="unusual_inbound_connection")
    read("a-unusual-read-001", -.1, "a", inbound, True)
    login = connection("conn-a-login-001", -.05, "a", "192.0.2.240", "192.0.2.21", 80, "http", "hmi-a", duration=10,
                       anomalous=True, parents=[vpn_conn["uid"]], observation="controller_authentication")
    for depth, method in enumerate(("GET", "POST"), 1):
        app("http", f"http-a-login-{depth:03d}", -.05 + (depth - 1) / 3600, "a", login,
            {"trans_depth": depth, "method": method, "host": "hmi.utility-a.example", "uri": "/login", "user_agent": "Vendor-V-Support/1.0",
             "request_body_len": 48 if method == "POST" else 0, "response_body_len": 128, "status_code": 200, "status_msg": "OK"}, "controller_authentication", True)
    app("modbus", "modbus-a-write-001", 0, "a", inbound,
        {"unit_id": 1, "func": "WRITE_SINGLE_REGISTER", "pdu_type": "request"}, "dosing_parameter_change", True)
    app("modbus_detailed", "modbus-detailed-a-write-001", 0, "a", inbound,
        {"unit_id": 1, "func": "WRITE_SINGLE_REGISTER", "request_response": "request", "address": 40011, "quantity": 1, "values": [4]},
        "dosing_parameter_change", True, previousValues=[1], interpretation="Simulated dosing setpoint register 40011 changed from 1 to 4. This network write corroborates the primary controller audit; it does not itself establish an operational loss.")
    notice("notice-modbus-a-write-001", 0, "a", inbound, "W250::Modbus_Write_New_Source", "A new VPN-pool source writes the simulated dosing register from 1 to 4.")
    for letter, hour in (("b", .5), ("c", .75)):
        index = "abc".index(letter)
        first = None
        for n, port in enumerate((502, 102, 20000, 44818)):
            conn = connection(f"conn-{letter}-unusual-001" if n == 0 else f"conn-{letter}-probe-{port}", hour + n * 5 / 3600,
                              letter, "203.0.113.250", f"192.0.2.{11 + index}", port, "modbus" if port == 502 else "-", f"plc-{letter}",
                              state="REJ" if n == 3 else "S0", duration=0, anomalous=True, observation="probing_only")
            conn["interpretation"] = "Probe attempt only; no completed attacker session, authentication, control write, compromise, or physical effect is established."
            first = first or conn
        notice(f"notice-scan-{letter}", hour, letter, first, "Scan::Port_Scan", "Shared simulated source probes four OT ports; attempts only, not compromise.")
    # Persistent sessions account for all requests rather than pretending each
    # application poll is a separate transport connection.
    http_by_uid = {}
    for row in logs["http"]:
        http_by_uid.setdefault(row["uid"], []).append(row)
    for conn in logs["conn"]:
        if conn["uid"] in http_by_uid:
            requests = http_by_uid[conn["uid"]]
            conn["orig_bytes"] = sum(row["request_body_len"] + 128 for row in requests)
            conn["resp_bytes"] = sum(row["response_body_len"] + 128 for row in requests)
            conn["orig_pkts"] = conn["resp_pkts"] = 2 * len(requests) + 4
            conn["orig_ip_bytes"] = conn["orig_bytes"] + 40 * conn["orig_pkts"]
            conn["resp_ip_bytes"] = conn["resp_bytes"] + 40 * conn["resp_pkts"]
    for rows in logs.values():
        rows.sort(key=lambda r: (r["ts"], r["id"]))
    return logs


def manifest(logs: dict[str, list[dict]], seed: int) -> dict:
    return {"generatedWithSeed": seed, "origin": "simulated", "sourceRefs": ["src-network"], "classification": "U", "handling": ["SIMULATED"],
            "label": LABEL, "sourceFormatDisclaimer": SOURCE_FORMAT_DISCLAIMER,
            "logs": [{"id": f"corelight/{kind}", "file": f"data/telemetry/corelight/{kind}.json", "recordCount": len(rows),
                      "startTs": min(r["ts"] for r in rows), "endTs": max(r["ts"] for r in rows),
                      "format": "synthetic_vpn_auth_json" if kind == "vpn" else "corelight_zeek_json", "origin": "simulated", "label": LABEL}
                     for kind, rows in logs.items()]}
