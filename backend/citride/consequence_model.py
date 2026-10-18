"""Versioned, non-destructive C4 model/config overlay. Never edits saved snapshots.

The original supplied package is retained outside the working tree. Working
source records may contain documented, author-authorized synthetic corrections.
The overlay applies schema normalization and explicit interval parameters, not
changes to the interval engine. Overlay is used by automatic analysis only.
"""
from copy import deepcopy
import json
from pathlib import Path

from .storage import InvalidModelError


def load_c4(scenario_path):
    from .scripted_sources import load_sources
    _, models, reference = load_sources(scenario_path)
    return reference, models[0]


def consequence_model(baseline, reference, port):
    """Detached additive overlay, with collision rejection, never baseline writes."""
    if isinstance(port, list):
        model = deepcopy(baseline)
        for bundle in port:
            model = consequence_model(model, reference, bundle)
        return model
    model = deepcopy(baseline)
    additions = {k: [] for k in ('sources', 'entities', 'events', 'serviceFunctions', 'dependencies', 'scenarios')}
    source = {**port['sources'][0], 'evidenceCategory': 'simulated'}
    additions['sources'] = [source, deepcopy(reference['source'])]
    provenance = {'sourceRefs': [source['id']], 'classification': 'U', 'handling': ['SIMULATED']}
    from .billington_reference import idt_entry
    for raw in port['entities']:
        entity = deepcopy(raw)
        supplied = entity.get('idt')
        if supplied:
            # Retain the supplied code as source metadata even if canonical IDT
            # does not resolve it; never invent a canonical classification.
            if supplied.get('status') == 'coded' and not idt_entry(supplied['path']):
                entity['suppliedIdt'] = supplied
                entity['idt'] = {'status': 'unassigned'}
        else:
            entity['idt'] = {'status': 'unassigned'}
        additions['entities'].append(entity)
    entity_ids = {e['id'] for e in additions['entities']}
    for raw in port['events']:
        event = deepcopy(raw)
        target = event['seenOn']
        cyber_id = 'cyber-' + target
        if cyber_id not in entity_ids:
            additions['entities'].append({'id': cyber_id, 'type': 'CyberAsset', 'label': target + ' network identity', 'hostedBy': target, 'idt': {'status': 'not_idt_asset', 'reason': 'cyber_identity'}, **provenance})
            entity_ids.add(cyber_id)
        event['seenOn'] = cyber_id
        for technique in event.get('attackTechniques', []):
            technique.setdefault('tactic', 'Not supplied by source')
        additions['events'].append(event)
    # Initial onset [0,1] is already added by the engine. These explicit values
    # therefore produce 3–6, 6–12, 12–18, and chained 18–24 exactly.
    correction = reference.get('intervalNormalizations', {})
    functions = {}
    def function(facility, service, identifier=None):
        identifier = identifier or f'c4-{facility}-{service}'
        functions.setdefault(identifier, {'id': identifier, 'facility': facility, 'service': service,
                                          'label': service.replace('_', ' '), **provenance})
        return identifier
    seed = port['scenario']['seed']
    function(seed['provider'], seed['service'])
    for raw in port['dependencies']:
        dep = deepcopy(raw)
        alias = reference.get('serviceNormalizations', {}).get(seed['service'], {}).get(dep['requiredService'])
        if dep['provider'] == seed['provider'] and alias:
            dep['assumptionNote'] += ' Required input normalized through the configured source-service mapping.'
            dep['requiredService'] = alias
            dep['backupService'] = alias
        function(dep['provider'], dep['requiredService'])
        # Package reused function IDs across facilities; ownership is explicit.
        service = reference.get('outputServices', {}).get(dep['outputLossType'], dep['requiredService'])
        dep['dependentFunction'] = function(dep['dependent'], service, f"{dep['dependentFunction']}--{dep['dependent']}")
        dep['recovery'].setdefault('note', 'Restoration not verified; planning estimates only.')
        if dep['id'] in correction:
            values = correction[dep['id']]
            for field, value in zip(('propagationDelayMinHours', 'propagationDelayMaxHours', 'usableBackupMinHours', 'usableBackupMaxHours'), values):
                dep[field] = value
            dep['assumptionNote'] += ' C4 interval normalization: initial onset uncertainty counted once; explicit input parameters preserve the supplied expected windows without engine changes.'
        additions['dependencies'].append(dep)
    # Link source output function to the scenario service, not imported aliases.
    additions['serviceFunctions'] = list(functions.values())
    scenario = deepcopy(port['scenario'])
    scenario['seed']['assumptionNote'] = 'Explicit simulated terminal loss and 48-hour persistence; not an observed operational effect.'
    additions['scenarios'] = [scenario]
    global_ids = {item['id']: (key, item) for key in additions for item in model.get(key, [])}
    for key, rows in additions.items():
        for row in rows:
            existing = global_ids.get(row['id'])
            if existing:
                if existing != (key, row):
                    raise InvalidModelError('C4 overlay collides with baseline record ' + row['id'])
                continue
            model[key].append(row)
            global_ids[row['id']] = (key, row)
    return model
