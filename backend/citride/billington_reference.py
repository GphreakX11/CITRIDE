"""Offline, read-only IDT v4 reference. No Repository, state writes or OWL calls.

Integrate with ``app.include_router(idt_router)`` inside the existing app so its
DemoAccessMiddleware also guards this route. This module does not create an app
or weaken auth. Repository-root reference files must accompany a deployment;
missing/corrupt artifacts fail closed (503), with no network fallback.
"""
from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
from hashlib import sha256
import json
from pathlib import Path
import re

from fastapi import APIRouter, HTTPException

REFERENCE_DIR = Path(__file__).resolve().parents[2] / "data/reference/idt"
VERSION = "IDT v4 (22 Jun 2011)"
SOURCE_SHA256 = "ffeddc10b98cca1cd15abd53d70ba8a2bafd593760c8704e76834860fcf193a2"
PATH = re.compile(r"[1-9][0-9]*(?:\.[1-9][0-9]*)*")
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")


class ReferenceUnavailableError(ValueError):
    """Approved local reference is absent or invalid; never substitute data."""


def validate_assignment(value, entries: dict) -> dict | None:
    """Accept known paths only. A below-level code is NOT a type assertion."""
    if not isinstance(value, dict):
        return None
    status = value.get("status")
    if status == "coded" and isinstance(value.get("path"), str) and value["path"] in entries:
        return {"status": status, "path": value["path"]}
    if status == "below_idt_level":
        parent, path = value.get("parentEntity"), value.get("parentPath")
        if isinstance(parent, str) and IDENTIFIER.fullmatch(parent) and isinstance(path, str) and path in entries:
            return {"status": status, "parentEntity": parent, "parentPath": path}
    if status == "not_idt_asset" and value.get("reason") in ("cyber_identity", "service_area", "population_group"):
        return {"status": status, "reason": value["reason"]}
    if status == "unassigned":
        return {"status": status}
    return None


@lru_cache(maxsize=1)
def _reference() -> tuple[dict, dict]:
    try:
        path = REFERENCE_DIR / "idt_v4.json"
        if path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError("Reference size exceeds budget")
        contents = path.read_bytes()
        data = json.loads(contents)
        turtle_path = REFERENCE_DIR / "idt_v4.ttl"
        if turtle_path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError("Turtle size exceeds budget")
        if (data["version"] != VERSION or data["sourceSha256"] != SOURCE_SHA256
                or data["semanticStatus"] != "reference_only" or data["runtimeOntologyLoaded"] is not False
                or data["entryCount"] != 1985 or data["sectorCount"] != 18
                or sha256(turtle_path.read_bytes()).hexdigest() != data["ttlSha256"]):
            raise ValueError("Reference metadata/hash mismatch")
        entries = {entry["path"]: entry for entry in data["entries"]}
        if len(data["entries"]) != 1985 or len(entries) != 1985:
            raise ValueError("Reference count/uniqueness mismatch")
        for key, entry in entries.items():
            if not PATH.fullmatch(key) or len(key.split(".")) > 5:
                raise ValueError("Invalid reference path")
            parent = key.rsplit(".", 1)[0] if "." in key else None
            if entry["parent"] != parent or (parent is not None and parent not in entries):
                raise ValueError("Reference ancestry mismatch")
            if entry["level"] != len(key.split(".")):
                raise ValueError("Reference level mismatch")
            for field in ("name", "description", "idtId", "crossReference", "naics"):
                if entry[field] is not None and not isinstance(entry[field], str):
                    raise ValueError("Reference source fields must remain text or null")
        if sum(entry["parent"] is None for entry in entries.values()) != 18:
            raise ValueError("Reference sector count mismatch")
        if len(data["assignments"]) != 67:
            raise ValueError("Reference assignment count mismatch")
        for identifier, assignment in data["assignments"].items():
            if not IDENTIFIER.fullmatch(identifier) or validate_assignment(assignment, entries) != assignment:
                raise ValueError("Invalid reference assignment")
        data["jsonSha256"] = sha256(contents).hexdigest()
        return data, entries
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        raise ReferenceUnavailableError("The approved local IDT v4 reference is unavailable") from error


def idt_reference() -> dict:
    """Detached full lookup response, with hash of the checked-in JSON bytes."""
    return deepcopy(_reference()[0])


def idt_entry(path: str) -> dict | None:
    return deepcopy(_reference()[1].get(path))


def lineage(path: str) -> list[dict]:
    """Leaf-to-sector workbook ancestry (lookup, not OWL entailment)."""
    entries = _reference()[1]
    result = []
    entry = entries.get(path)
    while entry is not None:
        result.append(deepcopy(entry))
        entry = entries.get(entry["parent"])
    return result


def assignment_for_id(identifier: str) -> dict | None:
    """Exact stakeholder seed/proposed-ID lookup only; unknown IDs stay unknown."""
    return deepcopy(_reference()[0]["assignments"].get(identifier))


def assignment_for(entity: dict, *, allow_seed_lookup: bool = False) -> dict | None:
    """Captured assignment wins; malformed/absent historical data stays unknown.

    Explicitly opt into seed lookup for current inventory display, never captured
    run/case snapshots. No input entity is modified and no RDF is materialized.
    """
    if not isinstance(entity, dict):
        return None
    if "idt" in entity:
        return validate_assignment(entity["idt"], _reference()[1])
    identifier = entity.get("id")
    return assignment_for_id(identifier) if allow_seed_lookup and isinstance(identifier, str) else None


def sector_of(entity: dict, *, allow_seed_lookup: bool = False) -> dict | None:
    assignment = assignment_for(entity, allow_seed_lookup=allow_seed_lookup)
    if assignment is None:
        return None
    path = assignment.get("path", assignment.get("parentPath"))
    return idt_entry(path.split(".")[0]) if path else None


idt_router = APIRouter(prefix="/v1/reference", tags=["reference"])


@idt_router.get("/idt")
def get_idt_reference() -> dict:
    try:
        return idt_reference()
    except ReferenceUnavailableError as error:
        raise HTTPException(status_code=503, detail="IDT v4 reference is unavailable.") from error
