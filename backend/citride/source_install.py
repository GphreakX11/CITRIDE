"""Explicit add-only installation into initialized state; never startup/GET intake.

This is deliberately separate from metadata adoption: an absent source incident
needs validated records AND an automatic preliminary, not a broad seed/reset.
The caller must open an existing-only repository. No historical graph is edited.
"""
from copy import deepcopy
from hashlib import sha256
import json
from urllib.parse import quote

from rdflib import URIRef

from .records import META_ID, META_KIND, RecordsService
from .scripted_sources import EXTRA_COLLECTIONS, merge_sources
from .storage import ConflictError, InvalidModelError, NotFoundError

KINDS = ('statewideIncidents', 'assetStatuses', 'pendingDecisions', *EXTRA_COLLECTIONS)


def _graph_id(kind, identifier):
    return URIRef(f'urn:citride:graph:{kind}:{quote(identifier, safe="")}')


def _bundle_records(bundle, incident_id, decisions):
    # Reuse the seed feed's normalization (stable IDs, inherited provenance and
    # decision:none -> pending). Never ingest authored completed decisions.
    source = merge_sources([{'sources': [], 'incidents': [], 'assetStatuses': [],
                             'decisions': []}], [bundle])
    records = {kind: deepcopy(source['incidents' if kind == 'statewideIncidents' else kind])
               for kind in KINDS}
    for kind, rows in records.items():
        for row in rows:
            owner = row['id'] if kind == 'statewideIncidents' else row.get('incidentId')
            if owner != incident_id:
                raise InvalidModelError('Configured bundle record is outside incident scope: ' + row['id'])
    reviewed = {(r['incidentId'], r['optionId']) for r in decisions}
    suppressed = [r['id'] for r in records['pendingDecisions']
                  if (incident_id, r['optionId']) in reviewed]
    records['pendingDecisions'] = [r for r in records['pendingDecisions'] if r['id'] not in suppressed]
    return records, sorted(suppressed)


def _add_config(config, bundle):
    """Add only missing vocabulary/source entries; reject operator-owned clashes."""
    changes = []
    for key in ('entityIcons', 'serviceLabels'):
        for name, value in bundle.get('vocabularyAdditions', {}).get(key, {}).items():
            existing = config.setdefault(key, {})
            if name in existing:
                if existing[name] != value:
                    raise InvalidModelError('Vocabulary collision; refusing overwrite: ' + key + '.' + name)
            else:
                existing[name] = deepcopy(value)
                changes.append(key + '.' + name)
    for raw in bundle['sources']:
        source = {**deepcopy(raw), 'evidenceCategory': raw.get('evidenceCategory', 'simulated')}
        existing = [r for r in config.get('sources', []) if r['id'] == source['id']]
        if existing:
            if len(existing) != 1 or {**existing[0], 'evidenceCategory': existing[0].get('evidenceCategory', 'simulated')} != source:
                raise InvalidModelError('Source collision; refusing overwrite: ' + source['id'])
        else:
            config.setdefault('sources', []).append(source)
            changes.append('sources.' + source['id'])
    return sorted(changes)


def install_source(store, incident_id, *, apply=False, expected_token=None):
    """Dry-run by default; apply the reviewed state/source under one transaction.

    A successful install appends exactly the selected bundle's incident, statuses,
    unreviewed pending choices, extra records and one deterministic preliminary.
    Config additions are limited to missing source references/display vocabulary.
    Existing cases, runs, snapshots, audit, anchors and baseline remain untouched.
    A retry with the incident already present is an error, never an update.
    """
    with store._locked():
        original = store._load()
        try:
            # Read raw metadata for writing: legacy read projections must not
            # silently migrate an existing anchor/config during this operation.
            meta = deepcopy(store._record(original, META_KIND, META_ID))
        except NotFoundError:
            raise InvalidModelError('Installation requires an existing initialized store; no seed/reset') from None
        if any(r['id'] == incident_id for r in store._records(original, 'statewideIncidents')):
            raise InvalidModelError('Incident already exists; installation never overwrites it')
        core = RecordsService(store, scenario=store._baseline(original))
        bundles = [b for b in core.model_sources if b['incident']['id'] == incident_id]
        if len(bundles) != 1:
            raise InvalidModelError('Select exactly one configured model-source incident')
        bundle = bundles[0]
        records, suppressed = _bundle_records(bundle, incident_id, store._records(original, 'decisions'))
        occupied_graphs = {graph.identifier for graph in original.graphs() if len(graph)}
        for kind, rows in records.items():
            for row in rows:
                # Even an identical orphaned row is not ours to update. A graph
                # check also rejects malformed payloads hidden from _records.
                if _graph_id(kind, row['id']) in occupied_graphs:
                    raise InvalidModelError('Record collision; refusing overwrite: ' + row['id'])
        config_changes = _add_config(meta['config'], bundle)
        old_quads = set(original.quads((None, None, None, None)))
        from .state_fingerprint import state_fingerprint
        state = state_fingerprint(original)
        # Include every loaded input used by validation/analysis, not just display
        # records. Model, option or rule drift also requires renewed review.
        fingerprint = {'operation': 'source-install-v1', 'incidentId': incident_id,
                       'state': state, 'records': records, 'config': meta['config'],
                       'modelSources': core.model_sources, 'scenario': core.scenario,
                       'reference': core.reference, 'consequenceReference': core.c4_reference}
        token = sha256(json.dumps(fingerprint, sort_keys=True, separators=(',', ':'),
                                  allow_nan=False).encode()).hexdigest()
        if apply and (not expected_token or expected_token != token):
            raise ConflictError('State or source changed; review a fresh dry-run token before apply')

        # Detached work is crucial: _load may return a cached RDF dataset. Both
        # dry runs and every failure must leave even that cached object unchanged.
        dataset = deepcopy(original)
        if config_changes:
            store._record_graph(dataset, META_KIND, meta)
        core._ingest_records(dataset, records, 'source-install')
        old_runs = {r['id'] for r in store._records(original, 'run')}
        added_runs = [r for r in store._records(dataset, 'run') if r['id'] not in old_runs]
        if (len(added_runs) != 1 or added_runs[0].get('kind') != 'preliminary'
                or added_runs[0].get('incidentId') != incident_id
                or added_runs[0]['id'] != 'preliminary-' + added_runs[0].get('inputFingerprint', '')):
            raise InvalidModelError('Installation requires exactly one new preliminary for the selected incident')
        run_id = added_runs[0]['id']
        changes = {kind: {'add': sorted(r['id'] for r in rows), 'update': []}
                   for kind, rows in records.items()}
        changes['run'] = {'add': [run_id], 'update': []}
        counts = {kind: {action: len(ids) for action, ids in change.items()}
                  for kind, change in changes.items()}
        allowed = {_graph_id(kind, identifier) for kind, change in changes.items()
                   for identifier in change['add']}
        meta_graph = _graph_id(META_KIND, META_ID)
        if config_changes:
            allowed.add(meta_graph)
        new_quads = set(dataset.quads((None, None, None, None)))
        # Defense in depth if shared intake ever grows new side effects: neither
        # deletions nor writes outside the reviewed additions may be persisted.
        if (any(q[3] != meta_graph for q in old_quads - new_quads)
                or any(q[3] not in allowed for q in new_quads - old_quads)):
            raise InvalidModelError('Installation attempted to change protected historical state')
        if store._record(dataset, META_KIND, META_ID) != meta:
            raise InvalidModelError('Installation attempted to change protected metadata')
        plan = {'incidentId': incident_id, 'token': token, 'applied': False,
                'changes': changes, 'counts': counts, 'configChanges': config_changes,
                'suppressedPendingDecisionIds': suppressed, 'preliminaryRunId': run_id}
        if apply:
            store._save(dataset)  # One atomic local replace / transactional SQL UPDATE.
            plan['applied'] = True
        return plan
