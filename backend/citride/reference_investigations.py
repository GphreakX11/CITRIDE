"""Versioned, canonical report-only case snapshots; never model/OT updates."""
from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path

from .pcap_reference import PCAP_EVENT_ID, pcap_context, pcap_task_labels

EVENT_ID = "reference:waterutil-fuel-v2"

@lru_cache(maxsize=1)
def _manifest() -> dict:
    return json.loads((Path(__file__).parent / "reference_data/waterutil-fuel-v2.json").read_text(encoding="utf-8"))

def reference_context(event_id: str, baseline_revision: int) -> dict | None:
    if event_id == PCAP_EVENT_ID:
        return pcap_context(event_id, baseline_revision)
    if event_id != EVENT_ID:
        return None
    manifest = deepcopy(_manifest())
    source = manifest["source"]
    event = {
        "id": EVENT_ID,
        "type": "ReferenceInvestigation",
        "label": "Water utility / fuel terminal compromise · report reference",
        "description": "Author-supplied intrusion scenario. Packet indices and outcomes are report claims, not independently validated observations. No service outage or operational action is established.",
        "sourceRefs": [source["id"]],
        "referenceInvestigation": manifest,
    }
    return {
        "event": event, "baselineRevision": baseline_revision,
        "cyberAsset": None, "physicalAsset": None, "facility": None,
        "provider": None, "serviceArea": None,
        "scenarios": [], "downstreamDependencies": [],
        "sourceRefs": [source["id"]],
        "warnings": ["Report-only reference investigation: no PCAP or endpoint evidence was supplied.", "Assets are scoped to this case, not mapped to existing facilities, geography, service dependencies or current outages."],
    }

def reference_task_labels(record: dict) -> tuple[str, ...] | None:
    event = record["eventSnapshot"]
    if event.get("id") not in (EVENT_ID, PCAP_EVENT_ID) and event.get("type") not in ("ReferenceInvestigation", "PacketCaptureInvestigation") and "referenceInvestigation" not in event and "pcapEvidence" not in event:
        return None
    expected = reference_context(event.get("id"), record["baselineRevision"])
    if expected is None or record["contextSnapshot"] != expected or event != expected["event"]:
        from .storage import InvalidModelError
        raise InvalidModelError("Reference investigation snapshot does not match its canonical source")
    if record["runId"] is not None or record["decisions"]:
        from .storage import InvalidModelError
        raise InvalidModelError("Report-only reference investigations cannot contain modeled impacts or analysis runs")
    return pcap_task_labels() if event["id"] == PCAP_EVENT_ID else tuple(task["label"] for task in _manifest()["tasks"])
