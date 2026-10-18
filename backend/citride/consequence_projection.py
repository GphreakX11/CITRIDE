"""Read-only, record-driven C4 projection; never treats graph reachability as loss."""
from copy import deepcopy

from .billington_reference import lineage
from .consequences import bestAnalysisFor, preliminaryScenarioFor
from .consequence_model import consequence_model
from .records import RecordsService
from .storage import NotFoundError


def project_consequences(incident, analysis, reference, planning_rates, statuses=()):
    empty = {'incident': deepcopy(incident), 'analysis': None, 'nodes': [], 'edges': [], 'sectors': []}
    if analysis is None:
        return empty
    model = analysis['baselineSnapshot']
    entities = {r['id']: deepcopy(r) for r in model['entities']}
    functions = {r['id']: r for r in model['serviceFunctions']}
    dependencies = {r['id']: r for r in model['dependencies']}
    source_id = analysis['seed']['provider']
    source = entities[source_id]
    # Supplementary planning metadata does not replace evidence/model fields.
    def asset(identifier):
        return {**entities[identifier], **deepcopy(reference.get('assets', {}).get(identifier, {}))}
    source = asset(source_id)
    impacts = analysis['impacts']
    affected = {i['entityId'] for i in impacts}
    sector_rules = reference['sectors']
    def sector(entity):
        path = entity.get('idt', {}).get('path', '').split('.')[0]
        # Supplied package has inconsistent sector codes. Explicit typed
        # reference mappings take precedence, not names or UI heuristics.
        return next((r for r in sector_rules if entity['type'] in r.get('types', [])), next((r for r in sector_rules if r['prefix'] == path), {'label': 'Unclassified'}))
    adjacency = {}
    for dep in dependencies.values():
        adjacency.setdefault(dep['provider'], []).append(dep['dependent'])
    reachable, frontier = set(), [source_id]
    while frontier:
        current = frontier.pop()
        for target in adjacency.get(current, []):
            if target != source_id and target not in reachable:
                reachable.add(target)
                frontier.append(target)
    upstream = {d['provider'] for d in dependencies.values() if d['dependent'] == source_id}
    # Collapse structural treatment suppliers to their actual upstream supply.
    for identifier in list(upstream):
        upstream |= {d['provider'] for d in dependencies.values() if d['dependent'] == identifier}
    area = source.get('serves')
    from .validation import FACILITY_TYPES
    in_area = {e['id'] for e in entities.values() if area and e.get('locatedIn') == area and e['type'] in FACILITY_TYPES} - reachable - upstream - {source_id}
    people = [e for e in entities.values() if area and e.get('locatedIn') == area and e['type'] == 'PopulationGroup']
    population = sum(e['count'] for e in people) if people and all(type(e.get('count')) is int for e in people) else None
    states = {r['entityId']: r['status'] for r in statuses}
    nodes = []
    for identifier in sorted({source_id} | reachable | upstream | in_area):
        if identifier not in entities:
            continue
        entity = asset(identifier)
        rows = [i for i in impacts if i['entityId'] == identifier]
        known = [i['windowHours'] for i in rows if i.get('windowHours') is not None]
        paths = [path for row in rows for path in row['paths']]
        path_deps = [dependencies[d] for path in paths for d in path if d in dependencies]
        reserves = [[d['usableBackupMinHours'], d['usableBackupMaxHours']] for d in path_deps[-1:] if d.get('usableBackupMinHours') is not None and d.get('usableBackupMaxHours') is not None]
        node = {**entity, 'name': entity.get('name') or entity.get('label') or identifier,
                'sector': sector(entity)['label'], 'source': identifier == source_id,
                'upstream': identifier in upstream, 'status': states.get(identifier),
                'connected': identifier in reachable, 'inArea': identifier in in_area,
                'notAffected': identifier in reachable and not rows,
                'windowHours': [min(w[0] for w in known), min(w[1] for w in known)] if known else None,
                'impactCount': len(rows), 'order': min((len(p) for p in paths), default=None),
                'paths': paths, 'reserves': reserves, 'sourceRefs': sorted({s for row in rows for s in row['sourceRefs']}),
                'idtPath': ' → '.join(e['name'] for e in reversed(lineage(entity.get('idt', {}).get('path', '')))),
                'reserveLabel': 'Clean-water reserve' if any(d['requiredService'] == 'treated_water' for d in path_deps) else 'Buffer before it runs out'}
        nodes.append(node)
    edges = []
    for dep in dependencies.values():
        if dep['provider'] not in {n['id'] for n in nodes} or dep['dependent'] not in {n['id'] for n in nodes}:
            continue
        function = functions[dep['dependentFunction']]
        label_key = function['service'] if function['service'] in ('fire_flow', 'dialysis_treatment', 'sterilization_support') else dep['requiredService']
        edges.append({'id': dep['id'], 'from': dep['provider'], 'to': dep['dependent'], 'label': reference['serviceLabels'].get(label_key, label_key.replace('_', ' '))})
    public_action = next((r for r in reference['publicActionRules'] if source['type'] in r['assetTypes'] and analysis['seed']['lossType'] in r['lossTypes']), None)
    restoration = source.get('restoration', {}).get(analysis['seed']['lossType'])
    alternatives = deepcopy(source.get('alternatives', []))
    for n in nodes:
        if n['id'] != source_id:
            alternatives.extend(deepcopy(n.get('alternatives', [])))
    touched = {e.get('seenOn') for e in model['events'] if e['id'] in incident.get('linkedEventIds', [])}
    # Traverse hosting/containment to identify explicitly named providers only.
    for target in list(touched):
        visited = set()
        while target in entities and target not in visited:
            visited.add(target)
            touched.add(target)
            target = entities[target].get('hostedBy') or entities[target].get('partOf')
    touched |= {r.get('entityId') for r in statuses}
    for alt in alternatives:
        alt['checkFirst'] = alt.get('providerId') in touched
    thresholds = [deepcopy(t) for n in nodes for t in n.get('thresholds', [])]
    # The source's 12h planning threshold has a separate record to preserve
    # the supplied source fields; no timing value is synthesized here.
    if source_id + '-threshold' in reference.get('assets', {}):
        thresholds.extend(deepcopy(reference['assets'][source_id + '-threshold'].get('thresholds', [])))
    owners = deepcopy(source.get('responseOwners', []))
    for s in {n['sector'] for n in nodes if n['source'] or n['impactCount']}:
        rule = next((r for r in sector_rules if r['label'] == s), {})
        for key, role in (('regulator', 'Regulator'), ('sectorLead', 'Sector lead')):
            if key in rule:
                owners.append({'role': role, 'who': rule[key], 'does': s + ' coordination'})
    owners = [dict(items) for items in dict.fromkeys(tuple(sorted(r.items())) for r in owners)]
    economic = next((r for r in reference.get('economicRules', []) if r['assetType'] == source['type'] and r['lossType'] == analysis['seed']['lossType']), None)
    if economic is None:
        rates = {r['functionId']: r for r in planning_rates}
        if impacts and all(i['functionId'] in rates for i in impacts):
            economic = {'dailyUsd': [round(sum(rates[i['functionId']][b] * i['lossOfFunction'] * 24 for i in impacts)) for b in ('low', 'high')], 'basis': 'planning rates × modeled lost-service fraction × 24 hours; illustrative full-day exposure, not observed losses'}
    missing_reserves = any(d.get('usableBackupMinHours') is None or d.get('usableBackupMaxHours') is None for i in impacts for path in i['paths'] for d in (dependencies[k] for k in path))
    confidence = incident.get('confidence') or {'level': 'low' if restoration is None or missing_reserves else 'medium' if any('SIMULATED' in d.get('handling', []) for d in dependencies.values()) else 'high', 'note': 'Conditional dependency model; planning restoration and reserve values are not verified operational evidence.'}
    known = [i['windowHours'] for i in impacts if i.get('windowHours') is not None]
    sectors = []
    for name in sorted({n['sector'] for n in nodes}):
        group = [n for n in nodes if n['sector'] == name]
        windows = [n['windowHours'] for n in group if n['windowHours'] is not None]
        sectors.append({'label': name, 'source': any(n['source'] for n in group), 'atRisk': len({n['id'] for n in group if n['impactCount']}), 'windowHours': [min(w[0] for w in windows), max(w[1] for w in windows)] if windows else None, 'order': min((n['order'] for n in group if n['order'] is not None), default=None), 'spread': source.get('spread'), 'nodes': [n['id'] for n in group]})
    return {'incident': deepcopy(incident), 'analysis': {k: deepcopy(analysis.get(k)) for k in ('kind', 'persisted', 'referenceOnly', 'createdAt', 'computedAt', 'effectiveAt', 'triggerEventAt', 'createdAtBasis', 'modelVersion', 'request', 'seed')},
            'source': source, 'people': population, 'serviceAffected': incident.get('serviceAffected'),
            'atRisk': len(affected - {source_id}), 'earliestWindow': min(known, key=lambda w: (w[0], w[1])) if known else None,
            'restoration': restoration, 'economic': economic, 'publicAction': public_action,
            'nodes': nodes, 'edges': edges, 'sectors': sectors, 'alternatives': alternatives,
            'thresholds': sorted(thresholds, key=lambda t: t['hours']), 'responseOwners': owners, 'confidence': confidence}


class ConsequenceService:
    def __init__(self, store, records=None):
        self.store = store
        self.records = records or RecordsService(store)

    def view(self, incident_id=None):
        # Resolve records and run precedence from a single locked snapshot.
        with self.store._locked():
            dataset = self.store._load()
            envelope = self.records.records(_dataset=dataset)
            incidents = deepcopy(envelope['statewideIncidents'])
            # New package scenarios remain explicitly reference-only on older
            # stores. Do not invent a persisted incident or mutate its register.
            port_id = self.records.port['incident']['id']
            if not any(row['id'] == port_id for row in incidents):
                prototype = next(row for row in self.records.scripted['incidents'] if row['id'] == port_id)
                incidents.append({**deepcopy(prototype), 'referenceOnly': True})
            if incident_id:
                incident = next((r for r in incidents if incident_id in (r['id'], r.get('caseId'))), None)
                if incident is None:
                    raise NotFoundError('Incident was not found')
            else:
                # README's explicit water default supersedes earlier severity
                # default; otherwise deterministic highest-severity open case.
                incident = next((r for r in incidents if r['id'] == 'TX-26-0412' and r['status'] != 'closed'), None)
                if incident is None:
                    rank = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}
                    incident = next(iter(sorted(incidents, key=lambda r: (r['status'] == 'closed', rank.get(r.get('severity'), 4), r['id']))), None)
            if incident is None:
                return {'now': envelope['now'], 'operationsTimeZone': envelope['operationsTimeZone'], 'incidents': [], 'incident': None, 'analysis': None, 'nodes': [], 'edges': [], 'sectors': []}
            runs = self.store._records(dataset, 'run')
            cases = self.store._records(dataset, 'command-incident')
            # Reject stale preliminaries when update removed the causal mapping.
            model = consequence_model(self.store._baseline(dataset), self.records.c4_reference, self.records.port)
            if preliminaryScenarioFor(incident, model, self.records.c4_reference['eventLossRules']) is None:
                runs = [r for r in runs if r.get('kind') != 'preliminary']
            analysis = bestAnalysisFor(incident, runs, cases)
            if analysis is None:
                from .consequence_preview import reference_preview
                analysis = reference_preview(incident, model, self.records.c4_reference, envelope['now'])
            if analysis and analysis['kind'] == 'reviewed':
                from .command import CommandService
                case = next(c for c in cases if c.get('runId') == analysis['id'])
                analysis = CommandService(self.store)._public(dataset, case)['runSnapshot']
                analysis = {**analysis, 'kind': 'reviewed'}
            refs = deepcopy(self.records.c4_reference)
            if analysis and analysis['seed']['provider'] == self.records.port['incident']['sourceProvider']:
                source_id = analysis['seed']['provider']
                refs['assets'].setdefault(source_id, {}).update({k: deepcopy(self.records.port[k]) for k in ('alternatives', 'thresholds', 'responseOwners')})
            view = project_consequences(incident, analysis, refs, self.records.reference['planningRates'], [r for r in envelope['assetStatuses'] if r['incidentId'] == incident['id']])
            return {**view, 'now': envelope['now'], 'operationsTimeZone': envelope['operationsTimeZone'], 'incidents': incidents,
                    'analysisState': ('reference_preview' if analysis['kind'] == 'reference_preview' else 'ready') if analysis else 'no_analysis',
                    'criticalFunctions': deepcopy(self.records.port.get('criticalFunctions', [])) if incident['id'] == self.records.port['incident']['id'] else [],
                    'atRiskBasis': 'Distinct dependent entities with computed impacts; no unverified aggregation/member count is assumed.'}
