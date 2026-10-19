"""Generic source-model normalization at intake, never a read-time model overlay.

The compatibility helper remains for callers importing detached source fixtures.
Durable readers must read the repository baseline rather than reapply this step.
"""
from copy import deepcopy

from .storage import InvalidModelError
from .validation import validate_baseline

MODEL_COLLECTIONS = ('sources', 'entities', 'events', 'serviceFunctions', 'dependencies', 'scenarios')
ASSUMPTION_NOTE = 'Illustrative simulated source model; not verified operational evidence.'


def load_c4(scenario_path):
    from .scripted_sources import load_sources
    _, models, reference = load_sources(scenario_path)
    return reference, models[0]


def _mark(row, provenance=None):
    row = deepcopy(row)
    for key, value in (provenance or {}).items():
        row.setdefault(key, deepcopy(value))
    row.setdefault('classification', 'U')
    row.setdefault('handling', ['SIMULATED'])
    row.setdefault('assumptionNote', ASSUMPTION_NOTE)
    if not isinstance(row['assumptionNote'], str) or not row['assumptionNote'].strip():
        raise InvalidModelError('Source model assumptionNote must be nonblank')
    return row


def normalize_source_model(bundle, reference):
    """Return detached six-collection intake records for one configured bundle.

    Preserve authored records, canonical functions and cyber identities; adapt
    legacy singular scenarios, physical seenOn endpoints and function aliases.
    Reference-configured service/interval corrections are applied once here.
    Validation of the merged model belongs to intake_source_models, allowing
    explicit links to records already present in the receiving baseline.
    """
    try:
        return _normalize(bundle, reference)
    except (KeyError, TypeError, AttributeError, IndexError, ValueError) as error:
        raise InvalidModelError('Malformed source model: ' + str(error)) from None


def _normalize(bundle, reference):
    from .billington_reference import idt_entry
    additions = {key: [] for key in MODEL_COLLECTIONS}
    for key in MODEL_COLLECTIONS:
        if key in bundle and (not isinstance(bundle[key], list) or
                              any(not isinstance(row, dict) for row in bundle[key])):
            raise InvalidModelError('Source model collection must contain objects: ' + key)
    supplied_ids = set()
    for key in MODEL_COLLECTIONS:
        for row in bundle.get(key, []):
            identifier = row['id']
            if identifier in supplied_ids:
                raise InvalidModelError('Source model duplicate id: ' + identifier)
            supplied_ids.add(identifier)
    additions['sources'] = [_mark({**row, 'evidenceCategory': row.get('evidenceCategory', 'simulated')})
                            for row in bundle['sources']]
    if not additions['sources']:
        raise InvalidModelError('Source model requires at least one source')
    provenance = {'sourceRefs': [row['id'] for row in additions['sources']],
                  'classification': 'U', 'handling': ['SIMULATED']}
    if reference.get('source'):
        additions['sources'].append(_mark(reference['source']))
    for raw in bundle['entities']:
        entity = _mark(raw, provenance)
        if entity['id'] == bundle.get('incident', {}).get('sourceProvider'):
            # Previously supplied by the display overlay. Persist this authored
            # planning context with the source entity at the same intake as its
            # graph, so Analyst and Command read identical owner/action data.
            for field in ('alternatives', 'thresholds', 'responseOwners'):
                if field in bundle:
                    entity[field] = deepcopy(bundle[field])
        supplied = entity.get('idt')
        if supplied:
            if supplied.get('status') == 'coded' and not idt_entry(supplied['path']):
                entity['suppliedIdt'] = supplied
                entity['idt'] = {'status': 'unassigned'}
        else:
            entity['idt'] = {'status': 'unassigned'}
        additions['entities'].append(entity)
    entities = {e['id']: e for e in additions['entities']}
    for raw in bundle['events']:
        event = _mark(raw, provenance)
        target = event['seenOn']
        if entities.get(target, {}).get('type') != 'CyberAsset':
            cyber_id = 'cyber-' + target
            cyber = _mark({'id': cyber_id, 'type': 'CyberAsset',
                           'label': target + ' network identity', 'hostedBy': target,
                           'idt': {'status': 'not_idt_asset', 'reason': 'cyber_identity'}}, provenance)
            if cyber_id in entities and entities[cyber_id] != cyber:
                raise InvalidModelError('Generated cyber identity collision: ' + cyber_id)
            if cyber_id not in entities:
                additions['entities'].append(cyber)
                entities[cyber_id] = cyber
            event['seenOn'] = cyber_id
        for technique in event.get('attackTechniques', []):
            technique.setdefault('tactic', 'Not supplied by source')
        additions['events'].append(event)

    functions = {row['id']: _mark(row, provenance) for row in bundle.get('serviceFunctions', [])}
    def function(facility, service, identifier=None):
        if identifier is None:
            matches = [row['id'] for row in functions.values()
                       if row['facility'] == facility and row['service'] == service]
            if matches:
                return matches[0]
            identifier = f'c4-{facility}-{service}'
        row = _mark({'id': identifier, 'facility': facility, 'service': service,
                     'label': service.replace('_', ' ')}, provenance)
        if identifier in functions:
            if any(functions[identifier][key] != row[key] for key in ('facility', 'service')):
                raise InvalidModelError('Service function ownership collision: ' + identifier)
        else:
            functions[identifier] = row
        return identifier

    scenarios = bundle.get('scenarios', [bundle['scenario']] if 'scenario' in bundle else [])
    if not scenarios:
        raise InvalidModelError('Source model requires a scenario')
    for raw in scenarios:
        scenario = _mark(raw, provenance)
        scenario['seed'] = _mark(scenario['seed'], provenance)
        scenario['seed'].setdefault('assumptionNote', ASSUMPTION_NOTE)
        function(scenario['seed']['provider'], scenario['seed']['service'])
        additions['scenarios'].append(scenario)
    correction = reference.get('intervalNormalizations', {})
    for raw in bundle['dependencies']:
        dep = _mark(raw, provenance)
        aliases = {reference.get('serviceNormalizations', {}).get(scenario['seed']['service'], {}).get(dep['requiredService'])
                   for scenario in scenarios if dep['provider'] == scenario['seed']['provider']}
        aliases.discard(None)
        if len(aliases) > 1:
            raise InvalidModelError('Ambiguous source-service normalization: ' + dep['id'])
        if aliases:
            dep['requiredService'] = aliases.pop()
            dep['backupService'] = dep['requiredService']
            dep['assumptionNote'] += ' Required input normalized through the configured source-service mapping.'
        function(dep['provider'], dep['requiredService'])
        service = reference.get('outputServices', {}).get(dep['outputLossType'], dep['requiredService'])
        supplied = functions.get(dep['dependentFunction'])
        if supplied is None:
            dep['dependentFunction'] = function(dep['dependent'], service,
                                                f"{dep['dependentFunction']}--{dep['dependent']}")
        elif supplied['facility'] != dep['dependent']:
            raise InvalidModelError('Service function ownership collision: ' + dep['dependentFunction'])
        dep.setdefault('recovery', {'status': 'unknown'}).setdefault(
            'note', 'Restoration not verified; planning estimates only.')
        if dep['id'] in correction:
            values = correction[dep['id']]
            if not isinstance(values, list) or len(values) != 4:
                raise InvalidModelError('Interval normalization must contain four values: ' + dep['id'])
            for field, value in zip(('propagationDelayMinHours', 'propagationDelayMaxHours',
                                     'usableBackupMinHours', 'usableBackupMaxHours'), values):
                dep[field] = value
            dep['assumptionNote'] += ' Intake interval normalization: initial onset uncertainty counted once; explicit input parameters preserve the supplied expected windows without engine changes.'
        additions['dependencies'].append(dep)
    additions['serviceFunctions'] = list(functions.values())
    return additions


def merge_model_records(baseline, additions):
    """Add exact missing rows; reject cross-collection or unequal ID collisions."""
    model = deepcopy(baseline)
    occupied = {row['id']: (key, row) for key, rows in model.items() if isinstance(rows, list)
                for row in rows if isinstance(row, dict) and 'id' in row}
    for key in MODEL_COLLECTIONS:
        for row in additions[key]:
            existing = occupied.get(row['id'])
            if existing:
                if existing != (key, row):
                    raise InvalidModelError('Source model collides with baseline record ' + row['id'])
            else:
                model.setdefault(key, []).append(deepcopy(row))
                occupied[row['id']] = (key, row)
    errors = validate_baseline(model)
    if errors:
        raise InvalidModelError('Invalid source model intake: ' + '; '.join(errors))
    return model


def intake_source_models(baseline, reference, bundles):
    """Normalize configured inputs once and validate each add-only merge."""
    model = deepcopy(baseline)
    for bundle in bundles if isinstance(bundles, list) else [bundles]:
        model = merge_model_records(model, normalize_source_model(bundle, reference))
    return model


def consequence_model(baseline, reference, bundle):
    """Compatibility entry point for fixture/intake callers, not durable reads."""
    return intake_source_models(baseline, reference, bundle)
