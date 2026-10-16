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
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
import uuid

ROOT = Path(__file__).resolve().parents[1]
VIEWPORTS = ((1920, 1080), (1440, 900))


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


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--app-url', required=True, help='Existing target; never starts a server')
    refs = p.add_mutually_exclusive_group()
    refs.add_argument('--mockup', type=Path, default=ROOT / 'mockups/CITRIDE_Beta_Mockup.html')
    refs.add_argument('--mockup-dir', type=Path, help='Explicit original *.dc.html fallback, never auto-selected')
    p.add_argument('--output', type=Path, default=ROOT / 'artifacts/visual-compare')
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
    if a.capture and a.preflight:
        p.error('--capture and --preflight are mutually exclusive')
    if a.reset_demo and not a.prepare_isolated:
        p.error('--reset-demo requires --prepare-isolated; no default reset')
    if a.prepare_isolated and (not a.capture or a.confirm_isolated != a.app_url):
        p.error('--prepare-isolated requires --capture and --confirm-isolated EXACT_APP_URL')
    if a.prepare_isolated and a.case_id:
        p.error('--prepare-isolated creates a fresh case; do not pass --case-id')
    if a.capture and not (a.case_id or a.prepare_isolated):
        p.error('read-only --capture requires --case-id (no implicit create/analyze)')
    if a.timeout_ms <= 0:
        p.error('--timeout-ms must be positive')
    if a.case_id and not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', a.case_id):
        p.error('invalid --case-id')
    if a.request_id and not re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', a.request_id):
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
    for screen in SCREENS:
        ref = None
        path = (args.mockup_dir / (screen.board + '.dc.html')) if args.mockup_dir else args.mockup
        # The unified format is unknown until inspected. Only exact IDs actually
        # present in the original document are accepted; no guessed selectors.
        selector = None
        if path.is_file() and (args.mockup_dir or screen.board in elements.ids):
            selector = None if args.mockup_dir else '[id=' + json.dumps(screen.board) + ']'
            ref = dict(path=str(path.resolve()), url=path.resolve().as_uri(), selector=selector,
                       audit=audit_reference(path))
        for width, height in VIEWPORTS:
            rows.append(dict(screen=screen.name, width=width, height=height, reference=ref,
                             status='preflight-only' if ref else 'reference-unavailable',
                             valid_proof=False, issues=[],
                             reason=('Capture not requested; template warnings require rendered validation' if ref
                                     else 'Original board missing or no exact board ID discovered; no substitute supplied')))
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
        if l.size != r.size:
            raise ValueError('Viewport sizes differ; refusing resize/crop repair')
        pair = Image.new('RGB', (l.width + r.width, l.height))
        pair.paste(l.convert('RGB'), (0, 0))
        pair.paste(r.convert('RGB'), (l.width, 0))
        pair.save(output)


def write_report(output, rows, provenance, execution):
    output.mkdir(parents=True, exist_ok=True)
    report = dict(provenance=provenance, execution=execution, rows=rows,
                  valid_pairs=sum(bool(r['valid_proof']) for r in rows),
                  requested_pairs=len(rows),
                  disclaimer='Valid capture is not a visual-match assertion. Human review required. Invalid pairs are diagnostic only.')
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    cards = []
    for r in rows:
        label = html.escape(f"{r['screen']} — {r['width']}×{r['height']} — {r['status']}")
        image = ('<a href="{0}"><img loading="lazy" src="{0}" alt="Original left, app right"></a>'.format(html.escape(r['artifact']))
                 if r.get('artifact') else '')
        cards.append(f'<section><h2>{label}</h2><p>{html.escape(r.get("reason", ""))}</p>{image}</section>')
    (output / 'index.html').write_text('<!doctype html><meta charset="utf-8"><title>CITRIDE comparison coverage</title>'
        '<style>body{font:16px system-ui;background:#101827;color:#eee;padding:24px}img{width:100%;height:auto}section{margin:30px 0}a{color:#9cf}</style>'
        '<h1>Original mockup (left) / application (right)</h1>'
        '<p>Diagnostic captures are NOT valid visual proof. Missing references stay missing. '
        'No automatic visual-match claims. <a href="report.json">Machine-readable report</a></p>'
        + ''.join(cards), encoding='utf-8')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('API redirects forbidden (no-egress policy)')


class CaptureFailure(RuntimeError):
    def __init__(self, message, diagnostics):
        super().__init__(message)
        self.diagnostics = diagnostics


def api(args, path, payload=None):
    url = urljoin(args.app_url.rstrip('/') + '/', path.lstrip('/'))
    if origin(url) != origin(args.app_url):
        raise RuntimeError('API origin outside target scope')
    if payload is not None and not (args.prepare_isolated and args.confirm_isolated == args.app_url):
        raise RuntimeError('API write denied: isolated preparation not authorized')
    request = Request(url, data=None if payload is None else json.dumps(payload).encode(),
                      headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
    with build_opener(ProxyHandler({}), NoRedirect).open(request, timeout=args.timeout_ms / 1000) as response:
        return json.load(response)


def source_contract():
    checks = [('frontend/src/prototypeLocation.ts', ('caseId: identifier(query.get("case"))', '"entity-profile"')),
              ('frontend/src/commandTypes.ts', ('id: "coordination"', 'code: "C7"')),
              ('frontend/src/NetworkEvidence.tsx', ('Inspect record', 'Run search', 'Selected raw record'))]
    results = []
    for name, tokens in checks:
        path = ROOT / name
        text = path.read_text() if path.is_file() else ''
        results.append(dict(path=name, sha256=hashlib.sha256(text.encode()).hexdigest(),
                            confirmed=all(t in text for t in tokens), missing=[t for t in tokens if t not in text]))
    return results


def prepare_case(args, execution):
    baseline = api(args, '/v1/bootstrap')
    if args.prepare_isolated:
        identity = args.request_id or 'visual-' + uuid.uuid4().hex
        execution['preparation'] = dict(target=args.app_url, request_id=identity, completed=[])
        # Persist identity BEFORE any write; never automatically retry an uncertain save.
        write_report(args.output, execution.pop('_rows'), execution.pop('_provenance'), execution)
        if args.reset_demo:
            api(args, '/v1/demo/reset', dict(confirm='RESET DEMO',
                expectedBaselineRevision=baseline['baselineRevision'], clientRequestId=identity + '-reset'))
            execution['preparation']['completed'].append('reset')
            baseline = api(args, '/v1/bootstrap')
        incident = api(args, '/v1/command/incidents', dict(eventId='event-vpn-a',
            title='Watershed visual comparison', priority='high',
            expectedBaselineRevision=baseline['baselineRevision'], clientRequestId=identity + '-create'))
        execution['preparation']['completed'].append('create')
        incident = api(args, '/v1/command/incidents/' + incident['id'] + '/actions',
            dict(action='analyze', scenarioId='unsafe-water', evaluationHour=1, horizonHours=12,
                 expectedVersion=incident['version'], clientRequestId=identity + '-analyze'))
        execution['preparation']['completed'].append('analyze')
        args.case_id = incident['id']
    else:
        records = api(args, '/v1/command/incidents')
        candidates = records if isinstance(records, list) else records.get('incidents', [])
        incident = next((r for r in candidates if r['id'] == args.case_id), None)
        if incident is None:
            raise RuntimeError('Provided case not found; no read-only state was created')
    if incident.get('eventId') != 'event-vpn-a' or not incident.get('runSnapshot'):
        raise RuntimeError('Case lacks event-vpn-a and captured analysis; use a prepared case or explicit isolated preparation')
    snapshot = incident['runSnapshot']
    if snapshot.get('request', {}).get('scenarioId') != 'unsafe-water':
        raise RuntimeError('Case analysis is not the existing unsafe-water scenario')
    context = incident.get('contextSnapshot') or incident.get('context') or {}
    entity = args.entity_id
    if not entity:
        # Resolve from real case/event data, never invent an entity ID.
        event = next((e for e in baseline.get('events', []) if e.get('id') == incident['eventId']), {})
        entity = (context.get('cyberAsset') or {}).get('id') or event.get('targetAssetId')
    if not entity:
        raise RuntimeError('No entity resolved from case context; pass an existing --entity-id')
    execution['case'] = dict(id=incident['id'], version=incident['version'], entity=entity,
                             run_id=snapshot.get('id'))
    return entity


def capture_page(browser, url, args, width, height, path, is_reference=False, selector=None, screen=None):
    blocked, errors, failed, http_errors = [], [], [], []
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
    page.on('response', lambda resp: http_errors.append(dict(url=resp.url, status=resp.status)) if resp.status >= 400 else None)
    try:
        page.goto(url, wait_until='networkidle', timeout=args.timeout_ms)
        if selector:
            board = page.locator(selector)
            if board.count() != 1:
                raise RuntimeError('Original board selector is not unique')
            board.scroll_into_view_if_needed()
        if not is_reference:
            assert screen is not None
            page.locator('main').wait_for(state='visible')
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
        page.screenshot(path=str(path), full_page=False, animations='disabled')
        return dict(url=page.url, issues=issues, blocked=blocked, script_errors=errors,
                    failed_resources=failed, http_errors=http_errors)
    except Exception as error:
        raise CaptureFailure(str(error), dict(url=page.url, blocked=blocked, script_errors=errors,
                            failed_resources=failed, http_errors=http_errors)) from error
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
            with tempfile.TemporaryDirectory(prefix='citride-visual-') as d:
                for row in rows:
                    if not row['reference']:
                        continue
                    s = next(s for s in SCREENS if s.name == row['screen'])
                    try:
                        ref = row['reference']
                        left, right = Path(d) / 'original.png', Path(d) / 'app.png'
                        row['reference_capture'] = capture_page(browser, ref['url'], args, row['width'], row['height'], left,
                            is_reference=True, selector=ref['selector'], screen=s)
                        row['app_capture'] = capture_page(browser, app_route(args.app_url, s, args.case_id, entity), args,
                            row['width'], row['height'], right, screen=s)
                        row['issues'] = sorted(set(row['reference_capture']['issues'] + row['app_capture']['issues']))
                        row['valid_proof'] = not row['issues']
                        row['status'] = 'captured' if row['valid_proof'] else 'diagnostic-invalid'
                        row['reason'] = 'Original left / app right; manual review required' if row['valid_proof'] else ', '.join(row['issues'])
                        filename = f"{s.name}-{row['width']}.png"
                        compose_pair(left, right, args.output / filename)
                        row['artifact'] = filename
                    except Exception as error:
                        row.update(status='capture-failed', reason=str(error), valid_proof=False)
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
            if args.prepare_isolated:
                execution['_rows'], execution['_provenance'] = rows, provenance
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
