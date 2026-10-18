"""Versioned, non-destructive C4 model/config overlay. Never edits saved snapshots.

The original supplied port JSON is preserved byte-for-byte. Corrections below
are schema normalization and explicitly documented interval parameters, not
changes to the interval engine. Overlay is used by automatic analysis only.
"""
from copy import deepcopy
import json
from pathlib import Path

from .storage import InvalidModelError


def load_c4(scenario_path):
    for root in (Path(scenario_path).parent, Path(__file__).resolve().parents[2] / 'data', Path(__file__).parent / 'demo_data'):
        reference = root / 'scripted/c4_reference.json'
        port = root / 'scripted/port_houston.json'
        if reference.is_file() and port.is_file():
            return json.loads(reference.read_text()), json.loads(port.read_text())
    raise InvalidModelError('C4 reference/model configuration is missing')


def consequence_model(baseline, reference, port):
    """Detached additive overlay, with collision rejection, never baseline writes."""
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
            technique.setdefault('tactic', 'Not supplied by exercise')
        additions['events'].append(event)
    # Initial onset [0,1] is already added by the engine. These explicit values
    # therefore produce 3–6, 6–12, 12–18, and chained 18–24 exactly.
    correction = {'poh-dep-sabine': (0, 0, 3, 5), 'poh-dep-colonial': (0, 0, 3, 5),
                  'poh-dep-tankers': (0, 0, 6, 11), 'poh-dep-scp': (1, 1, 11, 16),
                  'poh-dep-freeport': (1, 1, 11, 16), 'poh-dep-cl2': (0, 0, 0, 0)}
    functions = {}
    def function(facility, service, identifier=None):
        identifier = identifier or f'c4-{facility}-{service}'
        functions.setdefault(identifier, {'id': identifier, 'facility': facility, 'service': service,
                                          'label': service.replace('_', ' '), **provenance})
        return identifier
    function('poh-port', 'terminal_operations', 'terminal-operations')
    for raw in port['dependencies']:
        dep = deepcopy(raw)
        if dep['provider'] == 'poh-port' and dep['requiredService'] in ('petroleum_products', 'chemical_feedstock'):
            dep['assumptionNote'] += ' Required input normalized to terminal_operations: the terminal handles these cargoes; cargo production is not a separate port output-loss seed.'
            dep['requiredService'] = 'terminal_operations'
            dep['backupService'] = 'terminal_operations'
        function(dep['provider'], dep['requiredService'])
        # Package reused function IDs across facilities; ownership is explicit.
        service = 'chlorine_supply' if dep['outputLossType'] == 'chlorine_unavailable' else dep['requiredService']
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
