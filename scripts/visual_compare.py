#!/usr/bin/env python3
"""Original-reference/app capture. No server startup, inferred data, or image repair.

Default is a local, offline preflight. --capture explicitly authorizes browser GETs
against --app-url. Only --prepare-isolated authorizes versioned API writes.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import html
from html.parser import HTMLParser
import json
import ipaddress
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
import uuid

ROOT = Path(__file__).resolve().parents[1]
VIEWPORTS = ((1920, 1080),)


@dataclass(frozen=True)
class Screen:
    name: str
    mode: str
    view: str
    board: str
    tab: str = ''


SCREENS = tuple(
    [Screen(name, 'command', view, board) for name, view, board in (
        ('C1', 'command', 'Main'), ('C2', 'cop', 'C2'), ('C3', 'cyber', 'C3'),
        ('C4', 'consequence', 'C4'), ('C5', 'uctf', 'C5'),
        ('C6', 'leadership', 'Brief'), ('C7', 'federation', 'C6'))]
    + [Screen(name, 'analyst', view, board) for name, view, board in (
        ('A1', 'command', 'A1'), ('CaseFile', 'case-file', 'CaseFile'),
        ('A2', 'cop', 'A2'), ('Entity', 'entity-profile', 'Entity'))]
    + [Screen('A3-' + tab, 'analyst', 'cyber', 'A3', tab)
       for tab in ('timeline', 'hunt', 'raw')]
    + [Screen(name, 'analyst', view, name) for name, view in (
        ('A4', 'consequence'), ('A5', 'coordination'), ('A6', 'uctf'))]
    + [Screen('Advanced-' + view, 'analyst', view, 'Advanced-' + view)
       for view in ('overview', 'incident', 'blueprint', 'relationships',
                    'reasoning', 'lab', 'evidence', 'sources')]
)


def origin(url):
    p = urlsplit(url)
    return (p.scheme.lower(), p.hostname, p.port or (443 if p.scheme == 'https' else 80))


def loopback_target(url):
    """Never resolve an arbitrary hostname or contact a hosted deployment."""
    host = urlsplit(url).hostname
    if host == 'localhost':
        return True
    try:
        return ipaddress.ip_address(host or '').is_loopback
    except ValueError:
        return False


def selected_screens(args):
    names = getattr(args, 'screens', None)
    screens = {s.name: s for s in SCREENS}
    return list(SCREENS) if names is None else [screens[name] for name in names]


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--app-url', required=True, help='Existing target; never starts a server')
    refs = p.add_mutually_exclusive_group()
    refs.add_argument('--mockup', type=Path, default=ROOT / '.specs/billington-beta/mockups/CITRIDE_Beta_Mockup.html')
    refs.add_argument('--mockup-dir', type=Path, help='Explicit original *.dc.html fallback, never auto-selected')
    p.add_argument('--output', type=Path, default=ROOT / 'artifacts/visual-compare')
    p.add_argument('--screens', help='Comma-separated screen codes, e.g. C4,C1 (A3 includes its three tabs)')
    p.add_argument('--case-id', help='Existing case required for read-only capture')
    p.add_argument('--entity-id', help='Existing entity; otherwise selected from the saved case context')
    p.add_argument('--capture', action='store_true', help='Authorize browser capture of the supplied existing target')
    p.add_argument('--preflight', action='store_true', help='Offline source/reference inspection only (default)')
    p.add_argument('--prepare-isolated', action='store_true', help='Authorize create/analyze on a confirmed isolated target')
    p.add_argument('--reset-demo', action='store_true', help='Also reset, only with --prepare-isolated')
    p.add_argument('--confirm-isolated', metavar='EXACT_APP_URL', help='Exact isolated target scope acknowledgment')
    p.add_argument('--request-id', help='Stable idempotency identity for preparation/reconciliation')
    p.add_argument('--timeout-ms', type=int, default=30000)
    a = p.parse_args(argv)
    u = urlsplit(a.app_url)
    if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password or u.query or u.fragment:
        p.error('--app-url must be an http(s) target without credentials, query, or fragment')
    try:
        origin(a.app_url)
    except ValueError:
        p.error('invalid --app-url port')
    if a.capture and not loopback_target(a.app_url):
        p.error('--capture is restricted to loopback targets; no production contact')
    if a.capture and a.preflight:
        p.error('--capture and --preflight are mutually exclusive')
    if a.reset_demo and not a.prepare_isolated:
        p.error('--reset-demo requires --prepare-isolated; no default reset')
    if a.prepare_isolated and (not a.capture or a.confirm_isolated != a.app_url):
        p.error('--prepare-isolated requires --capture and --confirm-isolated EXACT_APP_URL')
    if a.prepare_isolated and a.case_id:
        p.error('--prepare-isolated creates a fresh case; do not pass --case-id')
    if a.capture and not (a.case_id or a.prepare_isolated or (a.output / 'preparation.json').is_file()):
        p.error('read-only --capture requires --case-id or a saved preparation journal (no implicit writes)')
    if a.screens is not None:
        names = [name.strip() for name in a.screens.split(',')]
        names = [expanded for name in names for expanded in
                 (['A3-timeline', 'A3-hunt', 'A3-raw'] if name == 'A3' else [name])]
        unknown = sorted(set(names) - {s.name for s in SCREENS})
        if unknown:
            p.error('unknown --screens: ' + ', '.join(unknown))
        a.screens = list(dict.fromkeys(names))
    if a.timeout_ms <= 0:
        p.error('--timeout-ms must be positive')
    if a.case_id and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', a.case_id):
        p.error('invalid --case-id')
    if a.entity_id and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', a.entity_id):
        p.error('invalid --entity-id')
    if a.request_id and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}', a.request_id):
        p.error('--request-id must be a 1–100 character identifier')
    return a


def app_route(base, screen, case_id, entity_id):
    p = urlsplit(base)
    q = dict(mode=screen.mode, view=screen.view, focus='1', case=case_id, entity=entity_id)
    if screen.tab:
        q['tab'] = screen.tab
    return urlunsplit((p.scheme, p.netloc, p.path or '/', urlencode({k: v for k, v in q.items() if v}), ''))


class Elements(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.add(attrs['id'])
        if tag == 'script' and attrs.get('src'):
            self.scripts.append(attrs['src'])


def audit_reference(path):
    text = path.read_text(encoding='utf-8')
    elements = Elements()
    elements.feed(text)
    missing = [s for s in elements.scripts if not urlsplit(s).scheme
               and not (path.parent / urlsplit(s).path).exists()]
    return {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'template_tokens': bool(re.search(r'{{[\s\S]*?}}', text)),
            'missing_local_scripts': missing,
            'external_scripts': [s for s in elements.scripts if urlsplit(s).scheme in ('http', 'https')]}


def preflight(args):
    provenance: dict = {'kind': 'individual-original-boards' if args.mockup_dir else 'unified-original',
                  'source': str((args.mockup_dir or args.mockup).resolve()),
                  'notes': 'No application image or generated reference is ever substituted.'}
    if args.mockup_dir:
        provenance['documents'] = [str(p.resolve()) for name in ('README.md', 'feature-map.md', 'design.md')
                                   if (p := args.mockup_dir / name).is_file()]
    elements = Elements()
    if not args.mockup_dir and args.mockup.is_file():
        elements.feed(args.mockup.read_text(encoding='utf-8'))
    rows = []
    audit = audit_reference(args.mockup) if not args.mockup_dir and args.mockup.is_file() else None
    for screen in selected_screens(args):
        ref = None
        board = 'Advanced' if screen.name.startswith('Advanced-') else screen.board
        path = (args.mockup_dir / (screen.board + '.dc.html')) if args.mockup_dir else args.mockup
        # tpl-* is inert markup, NOT a screenshot target. Execute the complete
        # unmodified document's own router and capture its entire rendered page.
        routed = 'tpl-' + board in elements.ids
        if path.is_file() and (args.mockup_dir or routed or board in elements.ids):
            fragment = '#/' + board if routed else ''
            if routed and screen.name.startswith('Advanced-'):
                fragment += '/' + screen.view
            ref = dict(path=str(path.resolve()), url=path.resolve().as_uri() + fragment,
                       selector=None, board=board, routed=routed,
                       audit=audit_reference(path) if args.mockup_dir else audit)
        for width, height in VIEWPORTS:
            rows.append(dict(screen=screen.name, width=width, height=height, full_page=True, reference=ref,
                             provenance=provenance,
                             status='preflight-only' if ref else 'reference-unavailable',
                             valid_proof=False, capture_valid=False, visual_conformance='not-reviewed', issues=[],
                             reason=('Capture not requested; original runtime must be validated' if ref
                                     else 'Original board missing or no exact template/board discovered; no substitute supplied')))
    return rows, provenance


def request_allowed(url, method, app_origin):
    scheme = urlsplit(url).scheme
    if method not in ('GET', 'HEAD'):
        return False
    if scheme in ('data', 'blob', 'about'):
        return True
    if app_origin is None:
        return scheme == 'file'
    return scheme in ('http', 'https') and origin(url) == origin(app_origin)


def render_issues(text, errors, blocked):
    issues = []
    if re.search(r'{{[\s\S]*?}}', text):
        issues.append('unresolved-template')
    if errors:
        issues.append('script-error')
    if blocked:
        issues.append('blocked-egress')
    return issues


def compose_pair(left, right, output):
    from PIL import Image
    with Image.open(left) as l, Image.open(right) as r:
        if l.width != r.width:
            raise ValueError('Viewport widths differ; refusing resize/crop repair')
        pair = Image.new('RGB', (l.width + r.width, max(l.height, r.height)), 'white')
        pair.paste(l.convert('RGB'), (0, 0))
        pair.paste(r.convert('RGB'), (l.width, 0))
        pair.save(output)
        return dict(reference=list(l.size), app=list(r.size), composed=list(pair.size),
                    alignment='top', padding='white', rescaled=False, cropped=False)


def atomic_json(path, value):
    """Durably replace a journal/report; an interrupted write never truncates it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(value, handle, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_report(output, rows, provenance, execution):
    output.mkdir(parents=True, exist_ok=True)
    old = {}
    if (output / 'report.json').is_file():
        # Do not silently discard evidence if an existing report cannot be read.
        old = json.loads((output / 'report.json').read_text(encoding='utf-8'))
    key = lambda row: (row['screen'], row['width'], row['height'])
    merged = {key(row): row for row in old.get('rows', [])}
    for row in rows:
        previous = merged.get(key(row))
        if previous and previous.get('artifact') and not row.get('artifact'):
            previous = dict(previous, latest_attempt=row)
            merged[key(row)] = previous
        else:
            merged[key(row)] = row
    all_rows = list(merged.values())
    history = old.get('executions', [])
    clean_execution = {k: v for k, v in execution.items() if not k.startswith('_')}
    if not history or history[-1] != clean_execution:
        history.append(clean_execution)
    report = dict(provenance=provenance, execution=clean_execution, executions=history, rows=all_rows,
                  valid_pairs=sum(bool(r.get('capture_valid', r.get('valid_proof'))) for r in all_rows),
                  requested_pairs=len(all_rows), latest_requested_pairs=len(rows),
                  disclaimer='Capture validity is not visual conformance. Human checklist review required. Invalid pairs are diagnostic only.')
    atomic_json(output / 'report.json', report)
    cards = []
    for r in all_rows:
        extent = 'full page' if r.get('full_page') else 'legacy viewport-only evidence'
        label = html.escape(f"{r['screen']} — {r['width']}×{r['height']} viewport, {extent} — {r['status']}")
        image = ('<a href="{0}"><img loading="lazy" src="{0}" alt="Original left, app right; top aligned, padding only"></a>'.format(html.escape(r['artifact'], quote=True))
                 if r.get('artifact') else '')
        validity = 'valid' if r.get('capture_valid', r.get('valid_proof')) else 'invalid / not captured'
        review = html.escape(r.get('visual_conformance', 'not-reviewed'))
        attempt = ('<p>Latest attempt: ' + html.escape(r['latest_attempt'].get('reason', '')) + '</p>'
                   if r.get('latest_attempt') else '')
        case = html.escape(str(r.get('case', {}).get('id', 'not captured')))
        cards.append(f'<section><h2>{label}</h2><p>Capture: {validity}. Visual conformance: {review}. Case: {case}.</p>'
                     f'<p>{html.escape(r.get("reason", ""))}</p>{attempt}{image}</section>')
    (output / 'index.html').write_text('<!doctype html><meta charset="utf-8"><title>CITRIDE comparison coverage</title>'
        '<style>body{font:16px system-ui;background:#101827;color:#eee;padding:24px}img{width:100%;height:auto}section{margin:30px 0}a{color:#9cf}</style>'
        '<h1>Original mockup (left) / application (right)</h1>'
        '<p>1920×1080 viewport; full-page screenshots; top-aligned with white padding, never rescaled or cropped. '
        'Capture validity does NOT assert visual conformance. Human review required. '
        '<a href="report.json">Machine-readable report</a></p>' + ''.join(cards), encoding='utf-8')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('API redirects forbidden (no-egress policy)')


class CaptureFailure(RuntimeError):
    def __init__(self, message, diagnostics):
        super().__init__(message)
        self.diagnostics = diagnostics


def api(args, path, payload=None):
    if payload is not None and not (args.prepare_isolated and args.confirm_isolated == args.app_url):
        raise RuntimeError('API write denied: isolated preparation not authorized')
    if not args.capture or not loopback_target(args.app_url):
        raise RuntimeError('API denied: explicit loopback capture required; no production contact')
    if not path.startswith('/') or path.startswith('//') or urlsplit(path).query or urlsplit(path).fragment:
        raise RuntimeError('API path outside target scope')
    url = urljoin(args.app_url.rstrip('/') + '/', path.lstrip('/'))
    if origin(url) != origin(args.app_url):
        raise RuntimeError('API origin outside target scope')
    if payload is not None:
        allowed = path in ('/v1/demo/reset', '/v1/command/incidents', '/v1/cascade-runs') or bool(
            re.fullmatch(r'/v1/command/incidents/[A-Za-z0-9_.:-]+/actions', path)
            and payload.get('action') == 'analyze')
        if not allowed or (path == '/v1/demo/reset' and not args.reset_demo):
            raise RuntimeError('API write denied: operation outside preparation scope')
    request = Request(url, data=None if payload is None else json.dumps(payload).encode(),
                      headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
    with build_opener(ProxyHandler({}), NoRedirect).open(request, timeout=args.timeout_ms / 1000) as response:
        return json.load(response)


def source_contract():
    checks = [('frontend/src/prototypeLocation.ts', ('caseId: identifier(query.get("case"))', '"entity-profile"')),
              ('frontend/src/commandTypes.ts', ('id: "coordination"', 'code: "C7"')),
              ('frontend/src/NetworkEvidence.tsx', ('Inspect record', 'Run search', 'Selected raw record')),
              ('frontend/src/CommandWorkspace.tsx', ('data-casework-loaded={loaded}', 'aria-busy={loading || busy}', '/v1/command/records')),
              ('frontend/src/dependencyNetwork.ts', ('export function quickWhatIfRequest(', 'backupMinHours: reserveHours', 'What-if from case'))]
    results = []
    for name, tokens in checks:
        path = ROOT / name
        text = path.read_text() if path.is_file() else ''
        results.append(dict(path=name, sha256=hashlib.sha256(text.encode()).hexdigest(),
                            confirmed=all(t in text for t in tokens), missing=[t for t in tokens if t not in text]))
    return results


def load_journal(args):
    path = args.output / 'preparation.json'
    if not path.is_file():
        return None
    journal = json.loads(path.read_text(encoding='utf-8'))
    if journal.get('target') != args.app_url:
        raise RuntimeError('Preparation journal target differs; use a separate --output directory')
    # Recover IDs from durable accepted responses even if the process stopped
    # between the response checkpoint and its convenience-ID checkpoint.
    for entry in journal.get('steps', []):
        response = entry.get('response') or {}
        if entry.get('status') != 'accepted':
            continue
        if entry.get('step') in ('create', 'analyze') and response.get('id'):
            journal['case_id'] = response['id']
            journal['case_version'] = response.get('version')
        if entry.get('step') == 'analyze':
            journal['run_id'] = (response.get('runSnapshot') or {}).get('id')
        if entry.get('step') == 'what-if' and response.get('id'):
            journal['what_if_run_id'] = response['id']
    return journal


def journal_write(args, journal, step, path, payload):
    """Persist intent, then accepted response, before issuing another operation.

    Any interrupted/pending step is uncertain, never automatically retried.
    Responses retain case/run IDs even when later preparation/capture fails.
    """
    entry = dict(step=step, path=path, payload=payload, status='pending')
    journal['steps'].append(entry)
    atomic_json(args.output / 'preparation.json', journal)
    try:
        response = api(args, path, payload)
    except Exception as error:
        entry.update(status='uncertain', error=str(error))
        atomic_json(args.output / 'preparation.json', journal)
        raise
    entry.update(status='accepted', response=response)
    journal['completed'].append(step)
    # Even an incomplete accepted response is durable before ID extraction.
    atomic_json(args.output / 'preparation.json', journal)
    if step in ('create', 'analyze'):
        journal['case_id'] = response['id']
        journal['case_version'] = response['version']
    if step == 'analyze':
        journal['run_id'] = (response.get('runSnapshot') or {}).get('id')
    if step == 'what-if':
        journal['what_if_run_id'] = response['id']
    atomic_json(args.output / 'preparation.json', journal)
    return response


def what_if_payload(incident, identity):
    """Same shape as quickWhatIfRequest + CommandWorkspace.runPlanning.

    Resolve the treated-water dependency from the captured run, not a guessed
    dependency ID or a mutable live model.
    """
    run = incident['runSnapshot']
    baseline = run.get('baselineSnapshot') or {}
    entities = [e for e in baseline.get('entities', []) if e.get('label') == 'Dialysis Center X']
    if len(entities) != 1:
        raise RuntimeError('Captured model must contain exactly one Dialysis Center X')
    entity_id = entities[0]['id']
    impacts = [i for i in run.get('impacts', []) if i.get('entityId') == entity_id]
    dependencies = [d for d in baseline.get('dependencies', [])
                    if d.get('dependent') == entity_id and d.get('requiredService') == 'treated_water'
                    and any(d['id'] in path for impact in impacts for path in impact.get('paths', []))]
    if len(dependencies) != 1:
        raise RuntimeError('Dialysis Center X must have exactly one captured impacted treated-water dependency')
    return dict(run['request'], overrides=[dict(dependencyId=dependencies[0]['id'], backupMinHours=6,
                backupMaxHours=6, note='What-if from case ' + incident['title'])],
                expectedBaselineRevision=run['baselineRevision'], clientRequestId=identity + '-what-if')


def prepare_case(args, execution):
    journal = load_journal(args)
    if journal:
        execution['preparation'] = journal
        if args.prepare_isolated:
            raise RuntimeError('Preparation journal already exists; no writes/reset replayed. Resume with --capture only in this --output directory')
        if not args.case_id:
            args.case_id = journal.get('case_id')
        elif journal.get('case_id') and args.case_id != journal['case_id']:
            raise RuntimeError('Selected case differs from preparation journal; use a separate --output directory')
    if not args.prepare_isolated and not args.case_id:
        raise RuntimeError('Journal has no accepted case ID; reconcile its pending request read-only; no reset/retry performed')
    baseline = api(args, '/v1/bootstrap')
    if args.prepare_isolated:
        identity = args.request_id or 'visual-' + uuid.uuid4().hex
        journal = dict(target=args.app_url, request_id=identity, completed=[], steps=[])
        execution['preparation'] = journal
        # Exclusive claim prevents concurrent preparers from resetting each other.
        args.output.mkdir(parents=True, exist_ok=True)
        with (args.output / 'preparation.json').open('x', encoding='utf-8') as handle:
            json.dump(journal, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        if args.reset_demo:
            journal_write(args, journal, 'reset', '/v1/demo/reset', dict(confirm='RESET DEMO',
                expectedBaselineRevision=baseline['baselineRevision'], clientRequestId=identity + '-reset'))
            baseline = api(args, '/v1/bootstrap')
        incident = journal_write(args, journal, 'create', '/v1/command/incidents', dict(eventId='event-vpn-a',
            title='Watershed', priority='high', expectedBaselineRevision=baseline['baselineRevision'],
            clientRequestId=identity + '-create'))
        args.case_id = incident['id']
        incident = journal_write(args, journal, 'analyze', '/v1/command/incidents/' + incident['id'] + '/actions',
            dict(action='analyze', scenarioId='unsafe-water', evaluationHour=1, horizonHours=12,
                 expectedVersion=incident['version'], clientRequestId=identity + '-analyze'))
        planning = journal_write(args, journal, 'what-if', '/v1/cascade-runs', what_if_payload(incident, identity))
        if planning.get('id') == incident['runSnapshot'].get('id'):
            raise RuntimeError('What-if unexpectedly replaced the captured case run')
    else:
        records = api(args, '/v1/command/incidents')
        candidates = records if isinstance(records, list) else records.get('incidents', [])
        incident = next((r for r in candidates if r['id'] == args.case_id), None)
        if incident is None:
            raise RuntimeError('Provided case not found; no read-only state was created')
        if journal and journal.get('what_if_run_id'):
            if (incident.get('runSnapshot') or {}).get('id') != journal.get('run_id'):
                raise RuntimeError('Case captured run changed since preparation; no saved what-if substituted')
            planning = api(args, '/v1/cascade-runs/' + journal['what_if_run_id'])
            expected = what_if_payload(incident, journal['request_id'])
            # The backend adds a provenance sourceRef when accepting an override.
            # Validate that generated reference before comparing the original intent;
            # do not mistake persisted provenance for an altered planning request.
            actual_request = dict(planning.get('request', {}))
            actual_overrides = []
            for override in actual_request.get('overrides', []):
                value = dict(override)
                source_ref = value.pop('sourceRef', None)
                if source_ref is not None and source_ref != f"urn:citride:run:{planning['id']}:override:{value.get('dependencyId')}":
                    raise RuntimeError('Saved what-if override provenance does not match its run/dependency')
                actual_overrides.append(value)
            actual_request['overrides'] = actual_overrides
            if (planning.get('baselineRevision') != incident['runSnapshot']['baselineRevision']
                    or any(actual_request.get(field) != expected[field]
                           for field in ('scenarioId', 'evaluationHour', 'horizonHours', 'overrides'))):
                raise RuntimeError('Saved what-if no longer matches the journal/case')
    if incident.get('eventId') != 'event-vpn-a' or not incident.get('runSnapshot'):
        raise RuntimeError('Case lacks event-vpn-a and captured analysis; use a prepared case or explicit isolated preparation')
    snapshot = incident['runSnapshot']
    request = snapshot.get('request', {})
    if request.get('scenarioId') != 'unsafe-water':
        raise RuntimeError('Case analysis is not the existing unsafe-water scenario')
    if any(field in request and request[field] != value for field, value in [('evaluationHour', 1), ('horizonHours', 12)]):
        raise RuntimeError('Case analysis must use evaluationHour=1 and horizonHours=12')
    context = incident.get('contextSnapshot') or incident.get('context') or {}
    entity = args.entity_id
    if not entity:
        event = next((e for e in baseline.get('events', []) if e.get('id') == incident['eventId']), {})
        entity = (context.get('cyberAsset') or {}).get('id') or event.get('targetAssetId')
    if not entity:
        raise RuntimeError('No entity resolved from case context; pass an existing --entity-id')
    execution['case'] = dict(id=incident['id'], version=incident['version'], entity=entity,
                             title=incident.get('title'), run_id=snapshot.get('id'),
                             what_if_run_id=journal.get('what_if_run_id') if journal else None)
    return entity


def capture_page(browser, url, args, width, height, path, is_reference=False, selector=None, screen=None):
    if (width, height) != VIEWPORTS[0]:
        raise RuntimeError('Only the 1920×1080 full-page capture viewport is authorized')
    blocked, errors, failed, http_errors = [], [], [], []
    loaded_api, readiness = {}, {}
    context = browser.new_context(viewport={'width': width, 'height': height},
                                  device_scale_factor=1, service_workers='block', reduced_motion='reduce')
    def route(request_route):
        req = request_route.request
        if request_allowed(req.url, req.method, None if is_reference else args.app_url):
            request_route.continue_()
        else:
            blocked.append(dict(url=req.url, method=req.method))
            request_route.abort('blockedbyclient')
    context.route('**/*', route)
    # Playwright >=1.48: prevent websocket egress too (never needed for capture).
    if not hasattr(context, 'route_web_socket'):
        context.close()
        raise RuntimeError('Playwright >=1.48 required to enforce websocket no-egress')
    context.route_web_socket('**/*', lambda ws: (blocked.append(dict(url=ws.url, method='WEBSOCKET')), ws.close()))
    page = context.new_page()
    page.set_default_timeout(args.timeout_ms)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
    page.on('requestfailed', lambda req: failed.append(dict(url=req.url, failure=req.failure)))
    def response_received(resp):
        if resp.status >= 400:
            http_errors.append(dict(url=resp.url, status=resp.status))
        endpoint = urlsplit(resp.url).path
        if not is_reference and endpoint.startswith('/v1/') and resp.ok:
            try:
                loaded_api[endpoint] = resp.json()
            except Exception as error:
                errors.append('Invalid API JSON at ' + endpoint + ': ' + str(error))
    page.on('response', response_received)
    try:
        page.goto(url, wait_until='networkidle', timeout=args.timeout_ms)
        if is_reference and urlsplit(url).fragment.startswith('/'):
            # Only observe the original runtime; never inject renderers or state.
            page.wait_for_function("document.querySelector('#app')?.innerText.trim().length > 100")
            if urlsplit(page.url).fragment != urlsplit(url).fragment:
                raise RuntimeError('Original board router changed the requested hash')
            board = urlsplit(url).fragment.split('/')[1]
            if not page.evaluate("board => typeof screenFromHash === 'function' && screenFromHash() === board && document.title === 'CITRIDE Beta Mockup · ' + TITLES[board]", board):
                raise RuntimeError('Original runtime did not render the requested board title')
        if not is_reference:
            assert screen is not None
            page.locator('main').wait_for(state='visible')
            # This source-owned marker is set only after incidents, records and
            # reference Promise.all resolves. A heading/URL alone is not readiness.
            page.wait_for_function("""() => {
                const workspace = document.querySelector('[data-casework-loaded]');
                return workspace?.dataset.caseworkLoaded === 'true'
                    && workspace.getAttribute('aria-busy') === 'false'
                    && !/Loading saved|Loading the Watershed model|Loading cases[.…]/i.test(document.body.innerText);
            }""")
            required = ('/v1/bootstrap', '/v1/telemetry', '/v1/cascade-runs',
                        '/v1/command/incidents', '/v1/command/records', '/v1/reference')
            missing = [endpoint for endpoint in required if endpoint not in loaded_api]
            if missing:
                raise RuntimeError('Browser did not load required saved records: ' + ', '.join(missing))
            incidents = loaded_api['/v1/command/incidents']
            incidents = incidents if isinstance(incidents, list) else incidents.get('incidents', [])
            incident = next((item for item in incidents if item.get('id') == args.case_id), None)
            expected = getattr(args, 'capture_case', {})
            if not incident or not incident.get('runSnapshot'):
                raise RuntimeError('Browser case records lack the selected analyzed case')
            if expected.get('run_id') and incident['runSnapshot'].get('id') != expected['run_id']:
                raise RuntimeError('Browser loaded a different captured case analysis')
            if expected.get('version') and incident.get('version') != expected['version']:
                raise RuntimeError('Browser case version changed since read-only preparation')
            readiness.update(records_loaded=list(required), case_id=incident['id'],
                             case_version=incident['version'], run_id=incident['runSnapshot'].get('id'))
            # Actual source-derived controls; both interactions are local/read-only.
            if screen.tab == 'hunt':
                page.get_by_role('button', name='Run search', exact=True).click()
            if screen.tab == 'raw':
                button = page.get_by_role('button', name='Inspect record', exact=True).first
                button.wait_for(state='visible')
                button.click()
                page.get_by_label('Selected raw record', exact=True).wait_for(state='visible')
            page.wait_for_load_state('networkidle')
            query = dict(parse_qsl(urlsplit(page.url).query))
            if query.get('case') != args.case_id or query.get('view') != screen.view or query.get('mode') != screen.mode:
                raise RuntimeError('App did not retain selected case/mode/view in actual URL')
        if is_reference and screen is not None and screen.tab:
            tab_name = dict(timeline='Incident timeline', hunt='Threat hunt', raw='Raw records')[screen.tab]
            tab = page.get_by_role('tab', name=tab_name, exact=True)
            if tab.count() == 1:
                tab.click()
                page.wait_for_load_state('networkidle')
        page.evaluate('document.fonts.ready')
        text = page.locator('body').inner_text()
        issues = render_issues(text, errors, blocked)
        # Check unresolved attribute bindings too, not script source literals.
        if page.evaluate(r"Array.from(document.querySelectorAll('*')).some(e=>Array.from(e.attributes).some(a=>/\{\{[\s\S]*?\}\}/.test(a.value)))"):
            issues = sorted(set(issues + ['unresolved-template']))
        if failed:
            issues.append('failed-resources')
        if http_errors:
            issues.append('http-error')
        if not text.strip():
            issues.append('blank-render')
        if not is_reference and re.search(r'Loading workspace|Unable to load|Access required|Sign in', text, re.I):
            issues.append('app-not-ready')
        if is_reference and screen is not None and screen.tab:
            # A static A3 board with all conditional panels visible is NOT proof
            # of an initialized tab. No code is injected to synthesize tab state.
            tab_name = dict(timeline='Incident timeline', hunt='Threat hunt', raw='Raw records')[screen.tab]
            tab = page.get_by_role('tab', name=tab_name, exact=True)
            if tab.count() == 1:
                if tab.get_attribute('aria-selected') != 'true':
                    issues.append('reference-tab-not-active')
            else:
                issues.append('reference-tab-unavailable')
        if not is_reference and page.locator('main [role="alert"], .command-error').count():
            issues.append('app-error-state')
        page.evaluate('window.scrollTo(0, 0)')
        page.screenshot(path=str(path), full_page=True, animations='disabled')
        return dict(url=page.url, issues=issues, blocked=blocked, script_errors=errors,
                    failed_resources=failed, http_errors=http_errors, readiness=readiness,
                    full_page=True, viewport=[width, height])
    except Exception as error:
        raise CaptureFailure(str(error), dict(url=page.url, blocked=blocked, script_errors=errors,
                            failed_resources=failed, http_errors=http_errors,
                            loaded_api=list(loaded_api), readiness=readiness)) from error
    finally:
        context.close()


def capture(args, rows, execution):
    from PIL import Image  # Check composition dependency before isolated API writes.
    from playwright.sync_api import BrowserContext, sync_playwright
    if not hasattr(BrowserContext, 'route_web_socket'):
        raise RuntimeError('Playwright >=1.48 required to enforce websocket no-egress')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        execution['browser_started'] = True
        try:
            if not hasattr(browser, 'new_context'):
                raise RuntimeError('Chromium context support unavailable')
            entity = prepare_case(args, execution)
            args.capture_case = execution['case']
            with tempfile.TemporaryDirectory(prefix='citride-visual-') as d:
                for row in rows:
                    if not row['reference']:
                        continue
                    s = next(s for s in SCREENS if s.name == row['screen'])
                    row['case'] = execution['case']
                    row['target'] = args.app_url
                    try:
                        ref = row['reference']
                        left, right = Path(d) / 'original.png', Path(d) / 'app.png'
                        row['reference_capture'] = capture_page(browser, ref['url'], args, row['width'], row['height'], left,
                            is_reference=True, selector=ref['selector'], screen=s)
                        row['app_capture'] = capture_page(browser, app_route(args.app_url, s, args.case_id, entity), args,
                            row['width'], row['height'], right, screen=s)
                        row['issues'] = sorted(set(row['reference_capture']['issues'] + row['app_capture']['issues']))
                        row['valid_proof'] = not row['issues']
                        row['capture_valid'] = row['valid_proof']
                        row['status'] = 'captured' if row['valid_proof'] else 'diagnostic-invalid'
                        row['reason'] = 'Original left / app right; manual review required' if row['valid_proof'] else ', '.join(row['issues'])
                        filename = f"{s.name}.png"
                        row['dimensions'] = compose_pair(left, right, args.output / filename)
                        row['artifact'] = filename
                    except Exception as error:
                        row.update(status='capture-failed', reason=str(error), valid_proof=False, capture_valid=False)
                        if isinstance(error, CaptureFailure):
                            row['failure_diagnostics'] = error.diagnostics
        finally:
            browser.close()


def main(argv=None):
    args = parse_args(argv)
    rows, provenance = preflight(args)
    execution = dict(capture=args.capture, target=args.app_url, source_contract=source_contract(),
                     browser_started=False, writes_authorized=args.prepare_isolated,
                     reset_requested=args.reset_demo)
    args.output.mkdir(parents=True, exist_ok=True)
    if args.capture:
        try:
            if not all(c['confirmed'] for c in execution['source_contract']):
                raise RuntimeError('Source contract changed; inspect routes/selectors before capture')
            if not any(r['reference'] for r in rows):
                raise RuntimeError('No original references available; explicitly supply --mockup-dir if appropriate')
            capture(args, rows, execution)
        except Exception as error:
            execution.pop('_rows', None)
            execution.pop('_provenance', None)
            execution['error'] = str(error)
            for r in rows:
                if r['status'] == 'preflight-only':
                    r.update(status='capture-blocked', reason=str(error))
    write_report(args.output, rows, provenance, execution)
    valid = sum(bool(r['valid_proof']) for r in rows)
    print(json.dumps(dict(report=str((args.output / 'report.json').resolve()),
                          contact_sheet=str((args.output / 'index.html').resolve()),
                          requested_pairs=len(rows), valid_pairs=valid,
                          capture=args.capture, error=execution.get('error'))))
    return 0 if args.capture and valid == len(rows) else 2


if __name__ == '__main__':
    sys.exit(main())
