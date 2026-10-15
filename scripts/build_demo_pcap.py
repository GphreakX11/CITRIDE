#!/usr/bin/env python3
"""Build a redacted offline demo reference from PCAP bytes; never replay traffic."""

import argparse
import json
from pathlib import Path
from analyze_demo_pcap import analyze


def build(path):
    data = analyze(Path(path))
    flows = {row["id"]: row for row in data["tcp_flows"]}
    observations = []
    for row in data["http_messages"]:
        if row["kind"] != "request":
            continue
        flow = flows[row["flow"]]
        responses = [
            r
            for r in data["http_messages"]
            if r["flow"] == row["flow"] and r["kind"] == "response"
        ]
        observations.append(
            {
                "id": "packet-" + str(row["packet"]),
                "packet": row["packet"],
                "timeUtc": flow["first_utc"],
                "kind": "HTTP",
                "source": flow["source"],
                "destination": flow["destination"],
                "summary": row["method"] + " " + row["path"],
                "detail": "Plaintext TCP; destination port "
                + str(flow["destination_port"])
                + ". Response statuses: "
                + ", ".join(str(r["status"]) for r in responses),
                "boundary": "Request/status only. Does not establish complete transfer, execution or PLC changes.",
            }
        )
    for row in data["tls_sni"]:
        flow = flows[row["flow"]]
        observations.append(
            {
                "id": "packet-" + str(row["packet"]),
                "packet": row["packet"],
                "timeUtc": flow["first_utc"],
                "kind": "TLS SNI",
                "source": flow["source"],
                "destination": flow["destination"],
                "summary": row["name"],
                "detail": "ClientHello server-name indication; application bytes remain opaque.",
                "boundary": "No decryption. SNI does not prove server identity, C2 commands or exfiltration.",
            }
        )
    observations.sort(key=lambda row: row["packet"])
    return {
        "version": "corelight-waterutil-pcap-review-v1",
        "source": {
            "id": "source:corelight-waterutil-pcap-v2",
            "filename": "cyberav3ngers-waterutil-v2.pcap",
            "sha256": data["source"]["sha256"],
            "bytes": data["source"]["bytes"],
            "delivery": "Corelight-provided demo capture (user-attributed)",
            "method": "Offline stdlib packet/TCP-stream review; not a Corelight sensor or Zeek log export",
        },
        "capture": data["capture"],
        "protocolCounts": data["ip_protocol_counts"],
        "tcpFlowCount": data["tcp_flow_count"],
        "httpRequestCount": len(
            [r for r in data["http_messages"] if r["kind"] == "request"]
        ),
        "tlsSniCount": len(data["tls_sni"]),
        "observations": observations,
        "facts": [
            "Packet-backed network probing and management-like exchanges are available for review.",
            "HTTP GET/PUT paths and responses do not prove endpoint execution or complete file transfer.",
            "TLS application contents were not decrypted.",
        ],
        "notEstablished": [
            "Vendor VPN authentication",
            "PLC dosing/setpoint change",
            "Physical water-quality drift",
            "Separate utility A/B/C ownership or cross-utility scope",
            "Malware execution, encrypted commands or exfiltration",
            "Actual service outage",
        ],
        "redactions": [
            "HTTP queries, headers, bodies and credential values are omitted.",
            "Unknown names and paths are allow-list redacted by the offline analyzer.",
            "Original packet bytes are not bundled with this prototype.",
        ],
        "tasks": [
            {
                "label": "Review source evidence",
                "acceptance": "Review the capture fingerprint, packet references and protocol limitations.",
            },
            {
                "label": "Validate asset and utility mapping",
                "acceptance": "Confirm capture hosts against an independently supplied inventory before linking to the service model.",
            },
            {
                "label": "Review operational implications",
                "acceptance": "Keep unobserved dosing changes, physical consequences and actions unconfirmed.",
            },
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pcap", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = build(args.pcap)
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2) + "\n")
    print(
        json.dumps(
            {
                "output": str(target.resolve()),
                "packet_count": result["capture"]["packet_count"],
                "observation_count": len(result["observations"]),
                "sha256": result["source"]["sha256"],
            }
        )
    )
