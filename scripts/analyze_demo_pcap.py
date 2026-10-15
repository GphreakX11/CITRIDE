#!/usr/bin/env python3
"""Offline classic-PCAP evidence inventory. Stdlib only; no sockets/subprocesses.
Never writes packet bytes, HTTP bodies, headers, authentication values, or MQTT
contents. Named fields are allowlisted. Source documents are hashed, not echoed.
Usage: python3 -B analyze_pcap.py --pcap FILE --claims FILE --output FILE
TCP reassembly is sequence-based per SYN-delimited connection and direction;
IPv4 fragments/IPv6 are counted but not decoded. Not a Zeek/Corelight replacement.
"""

import argparse
import csv
import io
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import struct

MAX_INPUT = 64 * 1024 * 1024
PATHS = {
    "/",
    "/info.html",
    "/config/network.json",
    "/usr/bin/iocontrol",
    "/etc/rc3.d/S93InitSystemd.sh",
    "/project/WaterUtil_Main.vlp",
    "/project/WaterUtil_Pump2.vlp",
    "/api/v1/status",
    "/api/v1/process/tank-levels",
    "/api/v1/process/chemical-dosing",
    "/api/v1/alarms/active",
    "/v2/terminal/heartbeat",
    "/dns-query",
}
NAMES = {
    "plc01.waterutil.local",
    "plc02.waterutil.local",
    "plc01.waterutil.local.local",
    "gasboy-orpt01.fuel.local",
    "cam-pumphouse.waterutil.local",
    "hmi-ws01.waterutil.local",
    "scada01.waterutil.local",
    "historian01.waterutil.local",
    "syslog01.waterutil.local",
    "dns01.waterutil.local",
    "gw01.waterutil.local",
    "time.nist.gov",
    "stream.hikvision-cloud.com",
    "api.paymentgateway.com",
    "update.microsoft.com",
    "ctldl.windowsupdate.com",
    "cloudflare-dns.com",
    "uuokhhfsdlk.tylarion867mino.com",
    "ocferda.com",
    "855958ce.ocferda.com",
}
SMB_COMMANDS = {
    0: "NEGOTIATE",
    1: "SESSION_SETUP",
    2: "LOGOFF",
    3: "TREE_CONNECT",
    4: "TREE_DISCONNECT",
    5: "CREATE",
    6: "CLOSE",
    7: "FLUSH",
    8: "READ",
    9: "WRITE",
    10: "LOCK",
    11: "IOCTL",
    13: "ECHO",
}


def name_safe(s):
    return (
        s.lower().rstrip(".")
        if s.lower().rstrip(".") in NAMES
        else "[unlisted-name-redacted]"
    )


def utc(ns):
    sec, frac = divmod(ns, 10**9)
    return (
        datetime.fromtimestamp(sec, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        + f".{frac:09d}Z"
    )


def sha(data):
    return hashlib.sha256(data).hexdigest()


def dns_name(b, pos, depth=0):
    if depth > 20:
        raise ValueError("DNS pointer depth")
    labels = []
    while True:
        if pos >= len(b):
            raise ValueError("DNS boundary")
        n = b[pos]
        pos += 1
        if n == 0:
            return ".".join(labels), pos
        if n & 192 == 192:
            if pos >= len(b):
                raise ValueError("DNS pointer boundary")
            nxt = ((n & 63) << 8) | b[pos]
            suffix, _ = dns_name(b, nxt, depth + 1)
            labels.append(suffix)
            return ".".join(labels), pos + 1
        if n > 63 or pos + n > len(b):
            raise ValueError("DNS label boundary")
        labels.append(b[pos : pos + n].decode("ascii", errors="replace"))
        pos += n


def dns_decode(b):
    if len(b) < 12:
        raise ValueError("DNS short")
    _, flags, nq, na, nn, ne = struct.unpack("!6H", b[:12])
    pos = 12
    if nq + na + nn + ne > 2048:
        raise ValueError("DNS limit")
    qs = []
    ans = []
    for _ in range(nq):
        n, pos = dns_name(b, pos)
        qt, qc = struct.unpack_from("!HH", b, pos)
        pos += 4
        qs.append({"name": name_safe(n), "type": qt})
    for i in range(na + nn + ne):
        n, pos = dns_name(b, pos)
        typ, cls, ttl, size = struct.unpack_from("!HHIH", b, pos)
        pos += 10
        val = b[pos : pos + size]
        if len(val) != size:
            raise ValueError("DNS answer boundary")
        if i < na and typ in (1, 28) and size in (4, 16):
            ans.append(
                {
                    "name": name_safe(n),
                    "type": typ,
                    "address": str(ipaddress.ip_address(val)),
                }
            )
        pos += size
    return bool(flags & 0x8000), qs, ans


def client_sni(h):
    # TLS Handshake ClientHello (body only), not application decryption.
    p = 34
    if len(h) <= p:
        return []
    p += 1 + h[p]
    if p + 2 > len(h):
        return []
    p += 2 + int.from_bytes(h[p : p + 2], "big")
    if p >= len(h):
        return []
    p += 1 + h[p]
    if p + 2 > len(h):
        return []
    end = p + 2 + int.from_bytes(h[p : p + 2], "big")
    p += 2
    out = []
    while p + 4 <= min(end, len(h)):
        typ, size = struct.unpack_from("!HH", h, p)
        p += 4
        v = h[p : p + size]
        p += size
        if typ == 0 and len(v) >= 2:
            q = 2
            while q + 3 <= len(v):
                kind = v[q]
                z = int.from_bytes(v[q + 1 : q + 3], "big")
                q += 3
                if q + z > len(v):
                    break
                if kind == 0:
                    out.append(
                        name_safe(v[q : q + z].decode("ascii", errors="replace"))
                    )
                q += z
    return out


def reassemble(segments):
    if not segments:
        return [], {
            "payload_segments": 0,
            "duplicate_bytes": 0,
            "conflicting_overlap_bytes": 0,
            "gap_bytes": 0,
            "contiguous_regions": 0,
        }
    base = segments[0][0]
    cells = {}
    dupes = 0
    conflicts = 0
    for seq, b, pkt in segments:
        off = ((seq - base + 2**31) % (2**32)) - 2**31
        for i, x in enumerate(b):
            k = off + i
            if k in cells:
                dupes += 1
                conflicts += cells[k][0] != x
            else:
                cells[k] = (x, pkt)
    regions = []
    prev = None
    buf = bytearray()
    orig = []
    gap = 0
    for k in sorted(cells):
        if prev is not None and k != prev + 1:
            regions.append((bytes(buf), orig))
            gap += k - prev - 1
            buf = bytearray()
            orig = []
        buf.append(cells[k][0])
        orig.append(cells[k][1])
        prev = k
    if buf:
        regions.append((bytes(buf), orig))
    return regions, {
        "payload_segments": len(segments),
        "duplicate_bytes": dupes,
        "conflicting_overlap_bytes": conflicts,
        "gap_bytes": gap,
        "contiguous_regions": len(regions),
    }


def parse_http(b, orig, context, flow):
    out = []
    # Only complete header blocks; bodies are counted but never emitted.
    pattern = rb"(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) [^\r\n ]+ HTTP/1\.[01]\r\n|HTTP/1\.[01] [0-9]{3}[^\r\n]*\r\n"
    for m in re.finditer(pattern, b):
        end = b.find(b"\r\n\r\n", m.start())
        if end < 0:
            continue
        lines = b[m.start() : end].split(b"\r\n")
        first = lines[0].split(b" ")
        headers = {}
        for line in lines[1:]:
            if b":" in line:
                k, v = line.split(b":", 1)
                headers[k.lower()] = v.strip()
        row = {"flow": flow, "packet": orig[m.start()], "visibility": context}
        if first[0].startswith(b"HTTP/"):
            row.update(kind="response", status=int(first[1]))
        else:
            target = first[1].split(b"?", 1)[0].decode("ascii", errors="replace")
            row.update(
                kind="request",
                method=first[0].decode("ascii"),
                path=target if target in PATHS else "[unlisted-path-redacted]",
                query_omitted=b"?" in first[1],
            )
        cl = headers.get(b"content-length")
        if cl and cl.isdigit():
            size = int(cl)
            row["declared_body_bytes"] = size
            row["available_body_bytes"] = min(size, len(b) - (end + 4))
            row["body_complete_within_region"] = size <= len(b) - (end + 4)
            body = b[end + 4 : end + 4 + size]
            if row["kind"] == "response":
                try:
                    obj = json.loads(body)
                    if isinstance(obj, dict):
                        field_allowlist = {
                            "status",
                            "timestamp",
                            "chlorine_ppm",
                            "chlorine_mg_l",
                            "chlorine_mgl",
                            "ph",
                            "pH",
                            "turbidity",
                            "turbidity_ntu",
                            "dose_rate",
                            "dosing_rate",
                            "dosing_rate_ml_min",
                            "pump_rate",
                            "setpoint",
                            "target_ppm",
                            "flow_rate",
                            "tank_level",
                            "tank1",
                            "tank2",
                            "alarms",
                            "level",
                            "online",
                            "uptime",
                            "device",
                            "mode",
                            "chemical",
                            "rate",
                            "unit",
                            "units",
                            "pump",
                            "dosing",
                            "chlorine",
                            "enabled",
                        }
                        row["json_allowlisted_field_names"] = sorted(
                            set(obj) & field_allowlist
                        )
                        row["json_other_field_count"] = len(set(obj) - field_allowlist)
                except (ValueError, UnicodeDecodeError):
                    pass
                row["device_product_markers"] = [
                    label
                    for marker, label in [
                        (b"Unitronics", "Unitronics"),
                        (b"Gasboy", "Gasboy"),
                    ]
                    if marker.lower() in body.lower()
                ]
        # Preserve no header values, bodies, account identifiers, or tokens.
        out.append(row)
    return out


def parse_stream(regions, flow, direction, smb_counts):
    http = []
    tls = []
    ssh = []
    smb = []
    for b, orig in regions:
        if not b:
            continue
        is_tls = len(b) >= 5 and b[0] in (20, 21, 22, 23) and b[1] == 3
        if is_tls:
            p = 0
            hs = bytearray()
            hs_orig = []
            while p + 5 <= len(b) and b[p] in (20, 21, 22, 23) and b[p + 1] == 3:
                typ = b[p]
                size = int.from_bytes(b[p + 3 : p + 5], "big")
                end = p + 5 + size
                row = {
                    "flow": flow,
                    "direction": direction,
                    "packet": orig[p],
                    "record_type": {
                        20: "change_cipher_spec",
                        21: "alert",
                        22: "handshake",
                        23: "application_data",
                    }[typ],
                    "declared_bytes": size,
                    "complete": end <= len(b),
                }
                if end > len(b):
                    tls.append(row)
                    break
                v = b[p + 5 : end]
                vo = orig[p + 5 : end]
                if typ == 22:
                    hs.extend(v)
                    hs_orig.extend(vo)
                    while len(hs) >= 4:
                        htyp = hs[0]
                        length = int.from_bytes(hs[1:4], "big")
                        if 4 + length > len(hs):
                            break
                        if htyp == 1:
                            row["client_hello"] = True
                            row["sni"] = client_sni(bytes(hs[4 : 4 + length]))
                        if htyp == 2:
                            row["server_hello"] = True
                        del hs[: 4 + length]
                        del hs_orig[: 4 + length]
                if typ == 23:
                    row["application_visibility"] = "opaque_record_bytes_not_decrypted"
                    if re.match(rb"(GET|POST|PUT|HTTP/1\.)", v):
                        row["application_visibility"] = (
                            "plaintext_HTTP_inside_TLS_application_data_record_NOT_decrypted"
                        )
                        http.extend(
                            parse_http(v, vo, row["application_visibility"], flow)
                        )
                    # MQTT framing requires a plausible variable-length remaining length.
                    if v and 1 <= (v[0] >> 4) <= 14:
                        q = 1
                        remain = 0
                        mult = 1
                        while q < len(v) and q <= 4:
                            x = v[q]
                            q += 1
                            remain += (x & 127) * mult
                            mult *= 128
                            if not x & 128:
                                break
                        if q + remain == len(v) and (
                            (v[0] >> 4) != 1 or v[q : q + 6] == b"\x00\x04MQTT"
                        ):
                            row["application_visibility"] = (
                                "plaintext_MQTT_frame_inside_TLS_application_data_record_NOT_decrypted"
                            )
                            row["mqtt_packet_type"] = {
                                1: "CONNECT",
                                2: "CONNACK",
                                3: "PUBLISH",
                                4: "PUBACK",
                                12: "PINGREQ",
                                13: "PINGRESP",
                                14: "DISCONNECT",
                            }.get(v[0] >> 4, "other")
                tls.append(row)
                p = end
        else:
            http.extend(parse_http(b, orig, "direct_plaintext_TCP", flow))
        if b.startswith(b"SSH-"):
            ssh.append(
                {
                    "flow": flow,
                    "direction": direction,
                    "packet": orig[0],
                    "identification_present": True,
                    "auth_result": "not_decoded",
                }
            )
        # NetBIOS-session-framed SMB2; never emit share/file/user strings.
        p = 0
        while p + 4 <= len(b) and b[p] == 0:
            size = int.from_bytes(b[p + 1 : p + 4], "big")
            end = p + 4 + size
            if end > len(b) or size < 64:
                break
            v = b[p + 4 : end]
            if v[:4] != b"\xfeSMB":
                break
            command = int.from_bytes(v[12:14], "little")
            flags = int.from_bytes(v[16:20], "little")
            status = int.from_bytes(v[8:12], "little") if flags & 1 else None
            cmd = SMB_COMMANDS.get(command, "other")
            smb_counts[cmd] += 1
            sm = {
                "flow": flow,
                "direction": direction,
                "packet": orig[p],
                "command": cmd,
                "response": bool(flags & 1),
                "status": status,
            }
            if command == 9 and not flags & 1 and len(v) >= 80:
                doff = int.from_bytes(v[66:68], "little")
                dlen = int.from_bytes(v[68:72], "little")
                content = v[doff : doff + dlen]
                sm["write_declared_bytes"] = dlen
                sm["write_available_bytes"] = len(content)
                if content and b"," in content.split(b"\n")[0]:
                    try:
                        rows = list(csv.reader(io.StringIO(content.decode("utf-8"))))
                        sm["csv_data_row_count"] = max(0, len(rows) - 1)
                        allowed = {
                            "timestamp",
                            "ts",
                            "chlorine_ppm",
                            "chlorine_mg_l",
                            "ph",
                            "pH",
                            "turbidity_ntu",
                            "dose_rate",
                            "dosing_rate",
                            "pump_rate",
                            "setpoint",
                            "target_ppm",
                            "flow_rate",
                            "tank",
                            "level",
                            "level_pct",
                            "rate",
                            "chemical",
                            "pump",
                            "status",
                            "alarm",
                            "message",
                        }
                        sm["csv_allowlisted_header_fields"] = sorted(
                            set(rows[0]) & allowed
                        )
                        sm["csv_other_header_field_count"] = len(set(rows[0]) - allowed)
                    except (ValueError, UnicodeDecodeError):
                        pass
            smb.append(sm)
            p = end
    return http, tls, ssh, smb


def analyze(pcap, claims=None):
    data = Path(pcap).read_bytes()
    if len(data) > MAX_INPUT:
        raise ValueError("Input exceeds offline bound")
    if len(data) < 24:
        raise ValueError("Missing PCAP header")
    magics = {
        b"\xa1\xb2\x3c\x4d": (">", 1),
        b"\x4d\x3c\xb2\xa1": ("<", 1),
        b"\xa1\xb2\xc3\xd4": (">", 1000),
        b"\xd4\xc3\xb2\xa1": ("<", 1000),
    }
    if data[:4] not in magics:
        raise ValueError("Unsupported capture format")
    order, scale = magics[data[:4]]
    major, minor, tz, sig, snap, link = struct.unpack_from(order + "HHiIII", data, 4)
    if link != 1:
        raise ValueError("Only Ethernet link type supported")
    pos = 24
    times = []
    n = 0
    clip = 0
    wire_total = 0
    cap_total = 0
    short = 0
    frags = 0
    eth = Counter()
    protocol = Counter()
    ipcounts = Counter()
    dns = []
    ntp = []
    arp_count = 0
    icmpv6 = Counter()
    ipv6_endpoints = Counter()
    stp_count = 0
    ip_versions = Counter()
    endpoint_groups = {}
    flows = {}
    active = {}
    epochs = Counter()
    syns = defaultdict(lambda: defaultdict(set))
    syn_packets = Counter()
    while pos < len(data):
        if pos + 16 > len(data):
            raise ValueError("Incomplete record header")
        sec, frac, cap, wire = struct.unpack_from(order + "IIII", data, pos)
        pos += 16
        if pos + cap > len(data):
            raise ValueError("Incomplete record payload")
        b = data[pos : pos + cap]
        pos += cap
        n += 1
        ts = sec * 10**9 + frac * scale
        times.append(ts)
        cap_total += cap
        wire_total += wire
        clip += cap < wire
        if len(b) < 14:
            short += 1
            continue
        typ = int.from_bytes(b[12:14], "big")
        off = 14
        while typ in (0x8100, 0x88A8) and off + 4 <= len(b):
            typ = int.from_bytes(b[off + 2 : off + 4], "big")
            off += 4
        eth[f"0x{typ:04x}"] += 1
        if typ <= 1500 and b[off : off + 3] == b"\x42\x42\x03":
            stp_count += 1
        if typ == 0x0806:
            arp_count += 1
        if typ == 0x86DD:
            ip6 = b[off:]
            ip_versions["IPv6"] += 1
            if len(ip6) < 40:
                short += 1
                continue
            src6 = str(ipaddress.ip_address(ip6[8:24]))
            dst6 = str(ipaddress.ip_address(ip6[24:40]))
            ipcounts[src6] += 1
            ipcounts[dst6] += 1
            plen = int.from_bytes(ip6[4:6], "big")
            if len(ip6) < 40 + plen:
                short += 1
            nh = ip6[6]
            protocol["ICMPv6" if nh == 58 else f"IPv6_next_header_{nh}"] += 1
            ipv6_endpoints[(src6, dst6)] += 1
            if nh == 58 and len(ip6) > 40:
                icmpv6[str(ip6[40])] += 1
            continue
        if typ != 0x0800:
            continue
        ip_versions["IPv4"] += 1
        ip = b[off:]
        if len(ip) < 20:
            short += 1
            continue
        ihl = (ip[0] & 15) * 4
        total = int.from_bytes(ip[2:4], "big")
        proto = ip[9]
        if ihl < 20 or ihl > len(ip):
            short += 1
            continue
        if len(ip) < total:
            short += 1
        src = str(ipaddress.ip_address(ip[12:16]))
        dst = str(ipaddress.ip_address(ip[16:20]))
        ipcounts[src] += 1
        ipcounts[dst] += 1
        protocol[{6: "TCP", 17: "UDP", 1: "ICMP"}.get(proto, str(proto))] += 1
        flagoff = int.from_bytes(ip[6:8], "big")
        if flagoff & 0x3FFF:
            frags += 1
            continue
        t = ip[ihl:total]
        if proto not in (6, 17) or len(t) < (20 if proto == 6 else 8):
            continue
        sport, dport = struct.unpack_from("!HH", t)
        g = (src, dst, proto)
        if g not in endpoint_groups:
            endpoint_groups[g] = {
                "source": src,
                "destination": dst,
                "transport": "TCP" if proto == 6 else "UDP",
                "source_ports": set(),
                "destination_ports": set(),
                "packets": 0,
                "first_packet": n,
                "last_packet": n,
            }
        eg = endpoint_groups[g]
        eg["source_ports"].add(sport)
        eg["destination_ports"].add(dport)
        eg["packets"] += 1
        eg["last_packet"] = n
        if proto == 17:
            ulen = int.from_bytes(t[4:6], "big")
            payload = t[8:ulen]
            if sport in (53, 5353) or dport in (53, 5353):
                try:
                    response, qs, ans = dns_decode(payload)
                    dns.append(
                        {
                            "packet": n,
                            "source": src,
                            "destination": dst,
                            "transport": "mDNS" if 5353 in (sport, dport) else "DNS",
                            "response": response,
                            "questions": qs,
                            "address_answers": ans,
                        }
                    )
                except (ValueError, struct.error, IndexError):
                    protocol["DNS_decode_error"] += 1
            if 123 in (sport, dport):
                ntp.append(n)
            continue
        seq = int.from_bytes(t[4:8], "big")
        flags = t[13]
        hlen = (t[12] >> 4) * 4
        if hlen < 20 or hlen > len(t):
            short += 1
            continue
        payload = t[hlen:]
        canonical = tuple(sorted(((src, sport), (dst, dport))))
        if flags & 2 and not flags & 16:
            syns[src][dst].add(dport)
            syn_packets[src] += 1
            prior = active.get(canonical)
            if prior is None or flows[prior].get("_initial_syn") != (src, sport, seq):
                epochs[canonical] += 1
                fid = f"tcp-{len(flows) + 1:03d}"
                active[canonical] = fid
                flows[fid] = {
                    "id": fid,
                    "source": src,
                    "source_port": sport,
                    "destination": dst,
                    "destination_port": dport,
                    "first_packet": n,
                    "last_packet": n,
                    "first_ns": ts,
                    "last_ns": ts,
                    "packets": 0,
                    "tcp_payload_bytes": 0,
                    "_segments": defaultdict(list),
                    "_initial_syn": (src, sport, seq),
                    "syn_seen": True,
                    "syn_ack_seen": False,
                    "fin_seen": False,
                    "rst_seen": False,
                }
        if canonical not in active:
            fid = f"tcp-{len(flows) + 1:03d}"
            active[canonical] = fid
            flows[fid] = {
                "id": fid,
                "source": src,
                "source_port": sport,
                "destination": dst,
                "destination_port": dport,
                "first_packet": n,
                "last_packet": n,
                "first_ns": ts,
                "last_ns": ts,
                "packets": 0,
                "tcp_payload_bytes": 0,
                "_segments": defaultdict(list),
                "syn_seen": False,
                "syn_ack_seen": False,
                "fin_seen": False,
                "rst_seen": False,
            }
        fid = active[canonical]
        f = flows[fid]
        f["packets"] += 1
        f["last_packet"] = n
        f["last_ns"] = ts
        f["tcp_payload_bytes"] += len(payload)
        f["syn_ack_seen"] |= bool(flags & 2 and flags & 16)
        f["fin_seen"] |= bool(flags & 1)
        f["rst_seen"] |= bool(flags & 4)
        direction = (
            "initiator_to_responder"
            if (src, sport) == (f["source"], f["source_port"])
            else "responder_to_initiator"
        )
        if payload:
            f["_segments"][direction].append(
                ((seq + int(bool(flags & 2))) % (2**32), payload, n)
            )
    http = []
    tls = []
    ssh = []
    smb = []
    reasm = []
    smb_counts = Counter()
    for fid, f in flows.items():
        for direction, segs in f.pop("_segments").items():
            regions, st = reassemble(segs)
            reasm.append({"flow": fid, "direction": direction, **st})
            h, t, s, m = parse_stream(regions, fid, direction, smb_counts)
            http += h
            tls += t
            ssh += s
            smb += m
        f.pop("_initial_syn", None)
        f["first_utc"] = utc(f.pop("first_ns"))
        f["last_utc"] = utc(f.pop("last_ns"))
    for v in endpoint_groups.values():
        v["source_ports"] = sorted(v["source_ports"])
        v["destination_ports"] = sorted(v["destination_ports"])
    sni = []
    for t in tls:
        for name in t.get("sni", []):
            sni.append({"flow": t["flow"], "packet": t["packet"], "name": name})
    out = {
        "schema_version": "1.0",
        "method": {
            "offline_only": True,
            "stdlib_only": True,
            "no_packet_execution": True,
            "no_traffic_replay": True,
            "no_indicator_network_access": True,
            "raw_payload_exported": False,
            "credentials_exported": False,
            "path_name_policy": "Fixed allowlists; unknown names and paths replaced; HTTP queries, headers and bodies omitted.",
            "reassembly": "TCP sequence bytes, first-seen wins on overlaps; SYN-delimited epochs; gaps become separate contiguous regions. No decryption.",
            "limits": [
                "Classic Ethernet PCAP only; IPv4 TCP/UDP application decoding; IPv6 base-header/ICMPv6 inventory only; IPv4 fragments and IPv6 extension chains not decoded.",
                "Does not validate transport/IP checksums or authenticate packet source identities.",
                "SMB2 limited to NetBIOS framing and command/status fields; SSH auth not decoded.",
                "HTTP complete-header scanning may find embedded plaintext; visibility explicitly identifies TLS-record-wrapped plaintext.",
            ],
        },
        "source": {
            "path": str(Path(pcap).resolve()),
            "bytes": len(data),
            "sha256": sha(data),
        },
        "capture": {
            "format": "classic PCAP",
            "magic_hex": data[:4].hex(),
            "byte_order": "big" if order == ">" else "little",
            "timestamp_resolution": "nanoseconds" if scale == 1 else "microseconds",
            "version": f"{major}.{minor}",
            "link_type": link,
            "link_type_name": "Ethernet",
            "snaplen": snap,
            "packet_count": n,
            "first_packet_utc": utc(times[0]),
            "last_packet_utc": utc(times[-1]),
            "min_utc": utc(min(times)),
            "max_utc": utc(max(times)),
            "duration_seconds": str(Decimal(max(times) - min(times)) / Decimal(10**9)),
            "out_of_order_timestamps": sum(b < a for a, b in zip(times, times[1:])),
            "captured_packet_bytes": cap_total,
            "original_packet_bytes": wire_total,
            "snaplen_truncated_packets": clip,
            "short_network_headers_or_ip_lengths": short,
            "ipv4_fragment_packets": frags,
            "file_framing_complete": pos == len(data),
        },
        "ethernet_type_counts": dict(eth),
        "ip_version_counts": dict(ip_versions),
        "ip_protocol_counts": dict(protocol),
        "ip_addresses": sorted(
            ipcounts,
            key=lambda s: (
                ipaddress.ip_address(s).version,
                int(ipaddress.ip_address(s)),
            ),
        ),
        "ipv6_endpoint_pairs": [
            {"source": s, "destination": d, "packets": c}
            for (s, d), c in ipv6_endpoints.items()
        ],
        "icmpv6_type_counts": dict(icmpv6),
        "transport_endpoint_groups": list(endpoint_groups.values()),
        "tcp_flow_count": len(flows),
        "tcp_flows": list(flows.values()),
        "syn_destination_inventory": [
            {
                "source": s,
                "syn_packets": syn_packets[s],
                "destinations": [
                    {"address": d, "ports": sorted(ps)} for d, ps in ds.items()
                ],
            }
            for s, ds in syns.items()
        ],
        "tcp_reassembly": reasm,
        "http_messages": sorted(http, key=lambda x: x["packet"]),
        "tls_sni": sorted(sni, key=lambda x: x["packet"]),
        "tls_record_counts": dict(Counter(x["record_type"] for x in tls)),
        "tls_application_visibility_counts": dict(
            Counter(
                x["application_visibility"]
                for x in tls
                if "application_visibility" in x
            )
        ),
        "tls_records": sorted(tls, key=lambda x: x["packet"]),
        "dns_names": sorted(
            {q["name"] for d in dns for q in d["questions"]}
            | {a["name"] for d in dns for a in d["address_answers"]}
        ),
        "dns_events": dns,
        "other_protocols": {
            "stp_llc_packets": stp_count,
            "arp_packets": arp_count,
            "ntp_port_packets": len(ntp),
            "ssh_identifications": ssh,
            "smb2_command_counts": dict(smb_counts),
            "smb2_messages": sorted(smb, key=lambda x: x["packet"]),
        },
    }
    if claims:
        cb = Path(claims).read_bytes()
        out["original_markdown"] = {
            "path": str(Path(claims).resolve()),
            "sha256": sha(cb),
            "bytes": len(cb),
            "lines": len(cb.splitlines()),
            "raw_text_exported": False,
        }
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--pcap", required=True)
    ap.add_argument("--claims")
    ap.add_argument("--output", required=True)
    args = ap.parse_args()
    result = analyze(args.pcap, args.claims)
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2) + "\n")
    path.chmod(0o600)
    print(
        json.dumps(
            {
                "result_path": str(path.resolve()),
                "packet_count": result["capture"]["packet_count"],
                "duration_seconds": result["capture"]["duration_seconds"],
                "tcp_flows": result["tcp_flow_count"],
                "http_messages": len(result["http_messages"]),
                "tls_sni_observations": len(result["tls_sni"]),
                "dns_names": len(result["dns_names"]),
                "source_sha256": result["source"]["sha256"],
            }
        )
    )


if __name__ == "__main__":
    main()
