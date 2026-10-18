"""Data-configured sample feeds use the same validated durable intake as records."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from .storage import InvalidModelError

EXTRA_COLLECTIONS = ('watchAssets', 'sectorViews', 'criticalFunctions', 'consequenceScores')

def load_sources(scenario_path):
    roots = (Path(scenario_path).parent, Path(__file__).resolve().parents[2] / 'data', Path(__file__).parent / 'demo_data', Path(__file__).parent / 'data')
    for root in roots:
        manifest = root / 'scripted/sources.json'
        if manifest.is_file():
            config = json.loads(manifest.read_text())
            # Local customized source files take precedence over packaged defaults.
            def load(name):
                if Path(name).name != name:
                    raise InvalidModelError('Scripted source must be a filename')
                for base in roots:
                    path = base / 'scripted' / name
                    if path.is_file():
                        return json.loads(path.read_text())
                raise InvalidModelError('Missing scripted source: ' + name)
            return [load(n) for n in config['records']], [load(n) for n in config['models']], load(config['reference'])
    raise InvalidModelError('Scripted source list is missing')

def stable_id(kind, incident_id, key):
    return kind + '-' + sha256((incident_id + ':' + key).encode()).hexdigest()[:32]

def supplemental_records(bundle):
    incident = bundle['incident']
    provenance = {k: deepcopy(incident[k]) for k in ('origin', 'sourceRefs', 'classification', 'handling')}
    result = {k: [] for k in EXTRA_COLLECTIONS}
    for kind in EXTRA_COLLECTIONS:
        value = incident.get(kind) if kind == 'consequenceScores' else bundle.get(kind, [])
        rows = value if isinstance(value, list) else [value] if value else []
        for raw in rows:
            row = {**provenance, 'incidentId': incident['id'], **deepcopy(raw)}
            key = row.get('entityId') or row.get('function') or kind
            row.setdefault('id', stable_id(kind, incident['id'], key))
            result[kind].append(row)
    return result

def merge_sources(record_sources, model_sources):
    from .scripted_validation import COLLECTIONS, INPUT_KEYS
    data = deepcopy(record_sources[0])
    for kind in (*EXTRA_COLLECTIONS, 'pendingDecisions'):
        data.setdefault(kind, [])
    for source in record_sources[1:]:
        data['sources'].extend(deepcopy(source.get('sources', [])))
        for kind in COLLECTIONS:
            key = INPUT_KEYS.get(kind, kind)
            data.setdefault(key, []).extend(deepcopy(source.get(key, [])))
    for bundle in model_sources:
        for key in ('entityIcons', 'serviceLabels'):
            data.setdefault(key, {}).update(deepcopy(bundle.get('vocabularyAdditions', {}).get(key, {})))
        data['sources'].extend([{**s, 'evidenceCategory': s.get('evidenceCategory', 'simulated')} for s in bundle['sources']])
        data['incidents'].append(deepcopy(bundle['incident']))
        data['assetStatuses'].extend(deepcopy(bundle.get('assetStatuses', [])))
        for raw in bundle.get('decisions', []):
            row = deepcopy(raw)
            if row.get('decision') == 'none':
                row.pop('decision')
                row['status'] = 'pending'
                data['pendingDecisions'].append(row)
            else:
                data['decisions'].append(row)
        for kind, rows in supplemental_records(bundle).items():
            data[kind].extend(rows)
    return data

def merge_response_options(reference, bundles, model):
    """Expand source function aliases by dependency ownership, never by label guessing."""
    result = deepcopy(reference)
    known = {row['id'] for row in model['serviceFunctions']}
    for bundle in bundles:
        aliases = {}
        for dep in bundle['dependencies']:
            aliases.setdefault(dep['dependentFunction'], []).append(dep['dependentFunction'] + '--' + dep['dependent'])
        for raw in bundle.get('responseOptions', []):
            option = deepcopy(raw)
            values = option.get('triggers', {}).get('impactFunctions', [])
            normalized = []
            for value in values:
                targets = [value] if value in known else aliases.get(value, [])
                if not targets or any(t not in known for t in targets):
                    raise InvalidModelError('Unknown response option function alias: ' + value)
                normalized.extend(targets)
            option.setdefault('triggers', {})['impactFunctions'] = list(dict.fromkeys(normalized))
            existing = next((r for r in result['responseOptions'] if r['id'] == option['id']), None)
            if existing is not None and existing != option:
                raise InvalidModelError('Response option ID collision: ' + option['id'])
            if existing is None:
                result['responseOptions'].append(option)
        for source in bundle['sources']:
            if not any(r['id'] == source['id'] for r in result['sources']):
                result['sources'].append({**deepcopy(source), 'evidenceCategory': source.get('evidenceCategory', 'simulated')})
    return result
