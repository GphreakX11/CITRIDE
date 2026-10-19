"""Read-only Houston review captures against an ISOLATED loopback API and final build.

Run with backend/.venv/bin/python scripts/verify_houston_ui.py --url http://127.0.0.1:8097
Requires Playwright Chromium and a real API seeded in its own temporary directory.
Does not seed/reset/import data or contact production. Captures do not themselves
establish visual acceptance: inspect each image against Carmen's original reference.
"""
import argparse
import json
import mimetypes
from pathlib import Path
import subprocess
from urllib.parse import urlencode, urlsplit
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--dist', type=Path, default=ROOT / 'frontend/dist')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    origin = args.url.rstrip('/')
    if urlsplit(origin).hostname not in {'127.0.0.1', 'localhost', '::1'}:
        parser.error('Only an isolated loopback server is allowed; never production.')
    if not (args.dist / 'index.html').is_file():
        parser.error('Build the actual frontend first.')
    args.output.mkdir(parents=True, exist_ok=True)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip()
    records = json.load(urlopen(origin + '/v1/command/records', timeout=30))
    wanted = ('INC-2026-1002-POH', 'TX-26-0412')
    by_id = {item['id']: item for item in records['statewideIncidents']}
    missing = set(wanted) - by_id.keys()
    if missing:
        raise SystemExit('Isolated data missing requested incidents: ' + ', '.join(sorted(missing)))
    report = {'revision': revision, 'dirtyWorktree': bool(dirty), 'origin': origin,
              'evidenceClass': 'local built assets + real isolated API; Chromium, not physical iPhone/Safari',
              'captures': [], 'errors': [], 'blockedRequests': [], 'visualAcceptance': 'pending image inspection'}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(reduced_motion='reduce')

        def guard(route):
            request = route.request
            parsed = urlsplit(request.url)
            if not request.url.startswith(origin + '/') or request.method not in {'GET', 'HEAD', 'OPTIONS'}:
                report['blockedRequests'].append({'method': request.method, 'path': parsed.path})
                route.abort()
                return
            if not parsed.path.startswith(('/v1/', '/health')):
                asset = args.dist / ('index.html' if parsed.path == '/' else parsed.path.lstrip('/'))
                if asset.resolve().is_relative_to(args.dist.resolve()) and asset.is_file():
                    route.fulfill(path=str(asset), content_type=mimetypes.guess_type(asset)[0] or 'application/octet-stream')
                    return
            route.continue_()

        context.route('**/*', guard)
        for width in (1440, 393):
            page = context.new_page()
            page.set_viewport_size({'width': width, 'height': 900 if width > 600 else 852})
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            cases = [('c1-overview', 'command', None, None)]
            for incident in wanted:
                short = 'houston' if incident == wanted[0] else 'water'
                cases += [(f'c2-{short}', 'cop', incident, None),
                          (f'c4-{short}', 'consequence', incident, None)]
            cases += [('c2-houston-energy', 'cop', wanted[0], 'Energy'),
                      ('c2-houston-water', 'cop', wanted[0], 'Water'),
                      ('c2-water-healthcare', 'cop', wanted[1], 'Healthcare')]
            for name, view, incident, sector in cases:
                row = {'name': name, 'width': width}
                try:
                    params = {'mode': 'command', 'view': view}
                    if incident:
                        params['incidentId'] = incident
                        params['incident'] = incident
                    if sector:
                        params['sector'] = sector
                    response = page.goto(origin + '/?' + urlencode(params), wait_until='networkidle', timeout=90000)
                    assert response and response.ok, 'Document did not load successfully'
                    page.wait_for_function("() => document.querySelector('main')?.innerText.length > 50")
                    if view == 'consequence':
                        page.locator('.c4-tiles').wait_for(timeout=30000)
                    if incident:
                        page.get_by_text(incident, exact=False).first.wait_for(timeout=30000)
                    page.evaluate('() => document.fonts.ready')
                    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
                    row.update(page.evaluate("""() => ({
                        overflow: document.documentElement.scrollWidth > innerWidth + 1,
                        renderedView: document.querySelector('[data-view]')?.dataset.view,
                        alerts: [...document.querySelectorAll('[role=alert]')].map(x => x.innerText).filter(Boolean),
                        horizontalOffenders: [...document.querySelectorAll('main *')].filter(x => {
                          const r=x.getBoundingClientRect(); return r.width>0 && r.right>innerWidth+1;
                        }).slice(0,12).map(x => ({tag:x.tagName,class:x.className,text:x.textContent.slice(0,100)}))
                    })"""))
                    path = args.output / f'{name}-{width}.png'
                    page.screenshot(path=str(path), full_page=True)
                    row['screenshot'] = str(path)
                    row['url'] = page.url
                    assert row['renderedView'] == view, 'Wrong view rendered'
                    assert not row['overflow'], 'Horizontal overflow'
                    assert not row['alerts'], 'Visible error alert'
                except Exception as error:
                    row['error'] = str(error)
                    page.screenshot(path=str(args.output / f'{name}-{width}-failure.png'), full_page=True)
                report['captures'].append(row)
            page.close()
        browser.close()
    (args.output / 'browser-report.json').write_text(json.dumps(report, indent=2))
    failures = [row for row in report['captures'] if row.get('error')]
    print(json.dumps({'revision': revision, 'dirtyWorktree': bool(dirty),
                      'captures': len(report['captures']), 'failures': failures,
                      'errors': report['errors'], 'blockedRequests': report['blockedRequests']}, indent=2))
    if failures or report['errors'] or report['blockedRequests']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
