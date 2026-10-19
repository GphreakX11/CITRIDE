"""Explicit bounded metadata adoption. Never called by startup or a read API."""
from copy import deepcopy
from hashlib import sha256
import json
from .records import RecordsService, META_KIND, META_ID
from .scripted_sources import EXTRA_COLLECTIONS
from .storage import InvalidModelError, ConflictError

KINDS = (*EXTRA_COLLECTIONS, 'pendingDecisions')

def adopt_source(store, incident_id, *, apply=False, expected_token=None):
    """Plan by default; apply only the identical reviewed state/source under one lock.

    Does not ingest incidents: no automatic analysis, baseline, case, run or snapshot
    changes. Older analyses remain historical truth, not recalculated source truth.
    """
    core = RecordsService(store)
    bundles = [b for b in core.model_sources if b['incident']['id'] == incident_id]
    if len(bundles) != 1:
        raise InvalidModelError('Select exactly one configured model-source incident')
    bundle = bundles[0]
    with store._locked():
        original = store._load()
        dataset = deepcopy(original)  # Validation failure cannot poison a cached dataset.
        # Validate the read projection, but never persist its legacy normalization.
        # Adoption may change only the configuration entries listed in its plan.
        projected_meta = core._meta(dataset)
        if projected_meta is None or not any(r['id'] == incident_id for r in store._records(dataset, 'statewideIncidents')):
            raise InvalidModelError('Adoption requires existing initialized incident; no seed/reset is allowed')
        meta = deepcopy(store._record(dataset, META_KIND, META_ID))
        config = deepcopy(meta['config'])
        config_changes = []
        for key in ('entityIcons', 'serviceLabels'):
            for name, value in bundle.get('vocabularyAdditions', {}).get(key, {}).items():
                if config.get(key, {}).get(name) != value:
                    config.setdefault(key, {})[name] = deepcopy(value)
                    config_changes.append(key + '.' + name)
        for source in bundle['sources']:
            if not any(r['id'] == source['id'] for r in config.get('sources', [])):
                config.setdefault('sources', []).append({**deepcopy(source), 'evidenceCategory': source.get('evidenceCategory', 'simulated')})
                config_changes.append('sources.' + source['id'])
        meta['config'] = config
        if config_changes:
            store._record_graph(dataset, META_KIND, meta)
        records, changes, counts = {}, {}, {}
        recorded = {(r['incidentId'], r['optionId']) for r in store._records(dataset, 'decisions')}
        for kind in KINDS:
            existing = {r['id']: r for r in store._records(dataset, kind)}
            records[kind], changes[kind] = [], {'add': [], 'update': []}
            for raw in core.scripted.get(kind, []):
                if raw['incidentId'] != incident_id:
                    continue
                if kind == 'pendingDecisions' and (incident_id, raw['optionId']) in recorded:
                    continue
                prior = existing.get(raw['id'])
                if prior and (prior['incidentId'] != incident_id or prior.get('origin') != raw.get('origin')):
                    raise InvalidModelError('Refusing to overwrite differently owned metadata: ' + raw['id'])
                item = {**deepcopy(prior or {}), **deepcopy(raw)}
                # Preserve operational history/anchor and origin; only source fields update.
                for key in ('history', 'sampleDataAnchor', 'origin'):
                    if prior and key in prior:
                        item[key] = deepcopy(prior[key])
                if prior is None or item != prior:
                    records[kind].append(item)
                    changes[kind]['add' if prior is None else 'update'].append(item['id'])
            counts[kind] = {k: len(v) for k, v in changes[kind].items()}
        from .state_fingerprint import state_fingerprint
        state = state_fingerprint(original)
        token = sha256((state + json.dumps({'records': records, 'config': config}, sort_keys=True)).encode()).hexdigest()
        plan = {'incidentId': incident_id, 'token': token, 'counts': counts, 'changes': changes, 'configChanges': config_changes, 'applied': False}
        if apply and (not expected_token or expected_token != token):
            raise ConflictError('State or source changed; review a fresh dry-run token before apply')
        # Always exercise the actual shared validator/ingest, including dry runs.
        # Source adoption is scripted metadata intake, not an operational action:
        # use its no-audit-append mode so existing history stays exactly intact.
        # The ingest still preserves each existing record's origin and validates.
        core._ingest_records(dataset, records, 'scripted')
        if apply and (config_changes or any(records.values())):
            store._save(dataset)
            plan['applied'] = True
        return plan
