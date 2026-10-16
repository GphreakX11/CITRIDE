"""Strict checks for generated demo logs, separate from the lossless real-log reader.

Never impose these simulated-only provenance/address rules on a real export.
"""

from __future__ import annotations

import base64
from datetime import datetime
import ipaddress
import math
import re

COMMON = (
    "_path",
    "_system_name",
    "_write_ts",
    "id",
    "relativeTimeHours",
    "utilityId",
    "observation",
    "anomalous",
    "origin",
    "sourceRefs",
    "classification",
    "handling",
)
ENDPOINTS = ("ts", "uid", "id.orig_h", "id.orig_p", "id.resp_h", "id.resp_p")
REQUIRED = {
    "conn": (
        *ENDPOINTS,
        "proto",
        "duration",
        "orig_bytes",
        "resp_bytes",
        "conn_state",
        "local_orig",
        "local_resp",
        "missed_bytes",
        "history",
        "orig_pkts",
        "orig_ip_bytes",
        "resp_pkts",
        "resp_ip_bytes",
        "tunnel_parents",
        "community_id",
    ),
    "ssl": (
        *ENDPOINTS,
        "version",
        "cipher",
        "server_name",
        "established",
        "ja3",
        "ja3s",
    ),
    "http": (
        *ENDPOINTS,
        "trans_depth",
        "method",
        "host",
        "uri",
        "user_agent",
        "request_body_len",
        "response_body_len",
        "status_code",
        "status_msg",
    ),
    "dns": (
        *ENDPOINTS,
        "proto",
        "query",
        "qtype_name",
        "rcode_name",
        "answers",
        "TTLs",
    ),
    "modbus": (*ENDPOINTS, "unit_id", "func", "pdu_type"),
    "modbus_detailed": (
        *ENDPOINTS,
        "unit_id",
        "func",
        "request_response",
        "address",
        "quantity",
        "values",
    ),
    "notice": (
        *ENDPOINTS,
        "note",
        "msg",
        "sub",
        "src",
        "dst",
        "p",
        "actions",
        "suppress_for",
    ),
    "vpn": ("ts", "user", "gateway", "result"),
}
NETWORKS = tuple(
    ipaddress.ip_network(n)
    for n in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24")
)
IP_FIELDS = {
    "id.orig_h",
    "id.resp_h",
    "src",
    "dst",
    "sourceIp",
    "client_ip",
    "gatewayIp",
}
NAME_FIELDS = {"host", "server_name", "query"}
IP_IN_TEXT = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])")


def _doc_address(value):
    try:
        address = ipaddress.ip_address(value)
        return any(address in network for network in NETWORKS)
    except (ValueError, TypeError):
        return False


def _reserved_name(value):
    return isinstance(value, str) and value.lower().rstrip(".").endswith(
        (".example", ".example.net", ".test")
    )


def _finite(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def validate_demo_logs(
    logs: dict[str, list[dict]], events=(), *, require_all=False
) -> list[dict]:
    """Return actionable record/field diagnostics without modifying source objects."""
    errors = []

    def error(code, log, record, field, message):
        errors.append(
            {
                "code": code,
                "log": log,
                "recordId": record.get("id"),
                "field": field,
                "message": message,
            }
        )

    seen_ids = set()
    for log, records in logs.items():
        if (
            log not in REQUIRED
        ):  # Legacy audit/sensor streams participate only in reference resolution.
            continue
        for record in records:
            for field in (*COMMON, *REQUIRED[log]):
                if field not in record:
                    error(
                        "required",
                        log,
                        record,
                        field,
                        "Required generated-log field is missing",
                    )
            if record.get("_path") != log:
                error("path", log, record, "_path", "Log path does not match its file")
            if record.get("id") in seen_ids:
                error(
                    "duplicate_id",
                    log,
                    record,
                    "id",
                    "Generated record IDs must be globally unique",
                )
            seen_ids.add(record.get("id"))
            if record.get("origin") != "simulated":
                error(
                    "origin",
                    log,
                    record,
                    "origin",
                    "Generated content must explicitly say simulated",
                )
            if (
                record.get("classification") != "U"
                or record.get("handling") != ["SIMULATED"]
                or record.get("sourceRefs") != ["src-network"]
            ):
                error(
                    "provenance",
                    log,
                    record,
                    "sourceRefs",
                    "Generated network provenance must retain its source and handling",
                )
            utility = record.get("utilityId")
            if (
                utility not in ("utility-a", "utility-b", "utility-c")
                or record.get("_system_name") != "w250-sensor-" + str(utility)[-1:]
            ):
                error(
                    "sensor",
                    log,
                    record,
                    "_system_name",
                    "Sensor name must match its utility",
                )
            for field in ("ts", "relativeTimeHours"):
                if not _finite(record.get(field)):
                    error("time", log, record, field, "Time must be a finite number")
            written = record.get("_write_ts")
            if not _finite(written):
                try:
                    datetime.fromisoformat(written.replace("Z", "+00:00"))
                except (ValueError, AttributeError, TypeError):
                    error(
                        "time",
                        log,
                        record,
                        "_write_ts",
                        "Write time must be a numeric or ISO timestamp",
                    )
            if "uid" in record and not re.fullmatch(
                r"C[A-Za-z0-9]{17}", str(record["uid"])
            ):
                error(
                    "uid",
                    log,
                    record,
                    "uid",
                    "Expected C followed by 17 base62 characters",
                )
            if "community_id" in record:
                value = record["community_id"]
                try:
                    valid = (
                        isinstance(value, str)
                        and value.startswith("1:")
                        and len(base64.b64decode(value[2:], validate=True)) == 20
                    )
                except (ValueError, TypeError):
                    valid = False
                if not valid:
                    error(
                        "community_id",
                        log,
                        record,
                        "community_id",
                        "Expected a Community ID v1 base64 SHA-1 value",
                    )
            for field, value in record.items():
                if field in IP_FIELDS and not _doc_address(value):
                    error(
                        "address",
                        log,
                        record,
                        field,
                        "Use an RFC5737 documentation-range IPv4 address",
                    )
                if field in NAME_FIELDS and not _reserved_name(value):
                    error(
                        "name",
                        log,
                        record,
                        field,
                        "Use a reserved example/test DNS name",
                    )
                values = value if isinstance(value, list) else [value]
                for item in values:
                    if isinstance(item, str):
                        for address in IP_IN_TEXT.findall(item):
                            if not _doc_address(address):
                                error(
                                    "address",
                                    log,
                                    record,
                                    field,
                                    "Non-documentation address in generated field",
                                )
            for field in ("ja3", "ja3s"):
                if field in record and not re.fullmatch(
                    r"[0-9a-f]{32}", str(record[field])
                ):
                    error(
                        "fingerprint",
                        log,
                        record,
                        field,
                        "Expected a seeded 32-character hexadecimal fingerprint",
                    )
            if record.get("anomalous") is True and not record.get("interpretation"):
                error(
                    "interpretation",
                    log,
                    record,
                    "interpretation",
                    "Anomalous observations require a bounded interpretation",
                )
    if require_all:
        for log in REQUIRED.keys() - logs.keys():
            error("required_stream", log, {}, "_path", "Generated stream is missing")
    indexes = {log: {row.get("id") for row in records} for log, records in logs.items()}
    for event in events:
        refs = [event["rawRef"]] if event.get("rawRef") else []
        refs += event.get("networkEvidenceRefs", [])
        for ref in refs:
            stream = str(ref.get("streamId", ""))
            key = (
                stream.removeprefix("corelight/")
                if stream.startswith("corelight/")
                else stream
            )
            if ref.get("recordId") not in indexes.get(key, set()):
                error(
                    "raw_reference",
                    stream,
                    event,
                    "rawRef",
                    "Event raw/supplemental record does not resolve in the named stream",
                )
    return errors
