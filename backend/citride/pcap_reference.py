"""Canonical packet-derived evidence reference; no model updates or OT calls."""

from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path
from fastapi import APIRouter

PCAP_EVENT_ID = "capture:corelight-waterutil-v2"
SHA256 = "fc7211eb3d6c9e87267e79fd52d157bc003b3d44e9a95cd1f7e32c7d47537e45"


@lru_cache(maxsize=1)
def _capture():
    result = json.loads(
        (
            Path(__file__).parent / "reference_data/corelight-waterutil-v2.json"
        ).read_text()
    )
    if (
        result["source"]["sha256"] != SHA256
        or result["version"] != "corelight-waterutil-pcap-review-v1"
    ):
        raise ValueError("Approved packet reference fingerprint does not match")
    return result


def pcap_context(event_id, baseline_revision):
    if event_id != PCAP_EVENT_ID:
        return None
    evidence = deepcopy(_capture())
    event = {
        "id": PCAP_EVENT_ID,
        "type": "PacketCaptureInvestigation",
        "label": "Corelight capture — water-sector network observations",
        "description": "Offline packet review: management-like exchanges, DNS/TLS and probing. No vendor VPN, dosing change or physical outage is established.",
        "sourceRefs": [evidence["source"]["id"]],
        "pcapEvidence": evidence,
    }
    return {
        "event": event,
        "baselineRevision": baseline_revision,
        "cyberAsset": None,
        "physicalAsset": None,
        "facility": None,
        "provider": None,
        "serviceArea": None,
        "scenarios": [],
        "downstreamDependencies": [],
        "sourceRefs": event["sourceRefs"],
        "warnings": [
            "Capture hosts are case-local. No independently verified inventory links them to synthetic utility assets.",
            "Conditional service models and supplemental scenario data are separate from observed packet evidence.",
        ],
    }


def pcap_task_labels():
    return tuple(row["label"] for row in _capture()["tasks"])


pcap_router = APIRouter(prefix="/v1/reference", tags=["reference"])


@pcap_router.get("/pcap")
def get_pcap():
    return deepcopy(_capture())
