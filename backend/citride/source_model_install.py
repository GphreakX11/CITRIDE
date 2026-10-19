"""Explicit, add-only baseline model installation for an initialized repository.

No incident replacement, metadata adoption, case writes or saved-run edits occur.
One new preliminary may be appended from the newly installed main-store model.
The repository lock/transaction and single save are shared with source_install.
"""
from copy import deepcopy
from hashlib import sha256
import json

from rdflib import Dataset

from .consequence_model import MODEL_COLLECTIONS, merge_model_records, normalize_source_model
from .scripted_sources import load_sources
from .source_install import _graph_id
from .state_fingerprint import state_fingerprint
from .storage import BASELINE, ConflictError, InvalidModelError, NotFoundError

RECEIPT_KIND = 'source-model-install'
SNAPSHOT_KIND = 'baseline-revision'


def _hash(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                             allow_nan=False).encode()).hexdigest()


def install_source_model(store, incident_id, *, apply=False, expected_token=None):
    """Plan/apply one configured incident's six normalized model collections.

    Returns token, changes/counts (add IDs, never updates), baseline revisions,
    snapshot ID and receipt ID. Apply needs the exact dry-run token. Successful
    token retries are no-ops; a changed installed record/source is a collision.
    Existing incident and metadata are required and remain byte-for-byte records.
    """
    from .records import META_ID, META_KIND
    with store._locked():
        original = store._load()
        try:
            store._record(original, META_KIND, META_ID)
            store._record(original, 'statewideIncidents', incident_id)
        except NotFoundError:
            raise InvalidModelError('Model installation requires an initialized store and existing incident; no seed/reset') from None
        _, bundles, reference = load_sources(store.scenario_path)
        selected = [bundle for bundle in bundles if bundle.get('incident', {}).get('id') == incident_id]
        if len(selected) != 1:
            raise InvalidModelError('Select exactly one configured model-source incident')
        bundle = selected[0]
        additions = normalize_source_model(bundle, reference)
        baseline = store._baseline(original)
        candidate = merge_model_records(baseline, additions)
        changes = {key: {'add': sorted(row['id'] for row in candidate[key]
                                     if row['id'] not in {r['id'] for r in baseline.get(key, [])}),
                         'update': []} for key in MODEL_COLLECTIONS}
        changed = any(change['add'] for change in changes.values())
        source_hash = _hash({'bundle': bundle, 'reference': reference, 'normalized': additions})
        receipt_id = 'source-model-' + _hash(incident_id)
        try:
            receipt = store._record(original, RECEIPT_KIND, receipt_id)
        except NotFoundError:
            receipt = None
        if receipt is not None:
            if changed or receipt.get('sourceFingerprint') != source_hash:
                raise ConflictError('Installed source model changed; add-only replay cannot repair or replace it')
            if apply and expected_token != receipt['token']:
                raise ConflictError('Replay requires the original reviewed dry-run token')
            result = deepcopy(receipt['plan'])
            result.update(applied=False, noop=True, replayed=True)
            return result
        revision = baseline['baselineRevision']
        if type(revision) is not int or revision < 1:
            raise InvalidModelError('Existing baseline requires a positive integer revision')
        snapshot_id = 'baseline-' + str(revision)
        snapshot = {'id': snapshot_id, 'baselineRevision': revision,
                    'baselineSnapshot': deepcopy(baseline)}
        occupied = {graph.identifier for graph in original.graphs() if len(graph)}
        receipt_graph = _graph_id(RECEIPT_KIND, receipt_id)
        snapshot_graph = _graph_id(SNAPSHOT_KIND, snapshot_id)
        if receipt_graph in occupied:
            raise InvalidModelError('Installation receipt graph collision; refusing overwrite')
        snapshot_exists = snapshot_graph in occupied
        if changed and snapshot_exists:
            try:
                existing_snapshot = store._record(original, SNAPSHOT_KIND, snapshot_id)
            except NotFoundError:
                raise InvalidModelError('Historical baseline graph collision; refusing overwrite') from None
            if existing_snapshot != snapshot:
                raise InvalidModelError('Historical baseline snapshot collision; refusing overwrite')
        token = _hash({'operation': 'source-model-install-v1', 'incidentId': incident_id,
                       'state': state_fingerprint(original), 'source': source_hash,
                       'changes': changes})
        if apply and (not expected_token or expected_token != token):
            raise ConflictError('State or source changed; review a fresh dry-run token before apply')
        plan = {'incidentId': incident_id, 'token': token, 'applied': False,
                'noop': not changed, 'replayed': False, 'changes': changes,
                'counts': {key: {action: len(ids) for action, ids in change.items()}
                           for key, change in changes.items()},
                'previousBaselineRevision': revision,
                'baselineRevision': revision + int(changed),
                'baselineSnapshotId': snapshot_id if changed else None,
                'receiptId': receipt_id if changed else None}
        if not changed:
            return plan  # Fresh stores/repeated intake without a receipt: no writes.

        # Detached candidate: dry runs and exceptions cannot mutate cached state.
        dataset = deepcopy(original)
        candidate['baselineRevision'] = revision + 1
        # Preserve opaque baseline triples not materialized by the JSON adapter.
        canonical = Dataset()
        store._write_baseline(canonical, baseline)
        extra = set(original.graph(BASELINE)) - set(canonical.graph(BASELINE))
        store._write_baseline(dataset, candidate)
        for triple in extra:
            dataset.graph(BASELINE).add(triple)
        if not snapshot_exists:
            store._record_graph(dataset, SNAPSHOT_KIND, snapshot)
        # Use the same main-store automatic intake as a fresh seed. Historical
        # runs (including an earlier overlay-based preliminary) remain intact;
        # the new revision gets its own immutable preliminary and input digest.
        from .records import RecordsService
        old_runs = {r['id'] for r in store._records(original, 'run')}
        RecordsService(store, scenario=candidate)._automatic_analysis(dataset, {incident_id})
        new_runs = sorted(r['id'] for r in store._records(dataset, 'run') if r['id'] not in old_runs)
        plan['changes']['run'] = {'add': new_runs, 'update': []}
        plan['counts']['run'] = {'add': len(new_runs), 'update': 0}
        plan['preliminaryRunIds'] = new_runs
        store._record_graph(dataset, RECEIPT_KIND, {
            'id': receipt_id, 'incidentId': incident_id, 'sourceFingerprint': source_hash,
            'token': token, 'plan': deepcopy(plan),
        })
        old_quads = set(original.quads((None, None, None, None)))
        new_quads = set(dataset.quads((None, None, None, None)))
        allowed = {BASELINE, receipt_graph} | ({snapshot_graph} if not snapshot_exists else set()) | {_graph_id('run', identifier) for identifier in new_runs}
        if (any(q[3] != BASELINE for q in old_quads - new_quads)
                or any(q[3] not in allowed for q in new_quads - old_quads)):
            raise InvalidModelError('Model installation attempted to change protected historical state')
        if store._baseline(dataset) != candidate:
            raise InvalidModelError('Model installation did not preserve the reviewed baseline')
        if apply:
            store._save(dataset)
            plan['applied'] = True
        return plan
