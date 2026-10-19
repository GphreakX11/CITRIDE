"""Real computed-style/navigation regression; disposable loopback QA only.
Run explicitly with --origin http://127.0.0.1:PORT --out PRIVATE_DIRECTORY.
Never creates cases or permits browser writes.
"""
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import urlopen
import argparse, json, subprocess
from playwright.sync_api import sync_playwright, ViewportSize

parser = argparse.ArgumentParser()
parser.add_argument('--origin', required=True)
parser.add_argument('--incident', default='INC-2026-1002-POH')
parser.add_argument('--case-id')
parser.add_argument('--out', required=True)
args = parser.parse_args()
parsed = urlparse(args.origin)
assert parsed.scheme == 'http' and parsed.hostname == '127.0.0.1' and parsed.port
out = Path(args.out); out.mkdir(parents=True, exist_ok=False, mode=0o700)
repo = Path(__file__).resolve().parents[2]
sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
with urlopen(args.origin + '/v1/command/incidents', timeout=30) as response:
    cases = json.load(response)['incidents']
case_id = args.case_id
if case_id: assert any(case['id'] == case_id for case in cases), 'Requested saved case does not exist in this QA store'
# The visual regression is valid with no saved case too; retain any chosen context.
query = {'mode': 'command', 'view': 'consequence', 'incidentId': args.incident}
if case_id: query['case'] = case_id
receipt = {'sha': sha, 'origin': args.origin, 'incident': args.incident,
           'case': case_id, 'checks': [], 'pageErrors': [], 'blockedWrites': [], 'passed': False}
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for profile, viewport in [('desktop', {'width': 1440, 'height': 1000}),
                                  ('phone', {'width': 390, 'height': 844})]:
            context = browser.new_context(viewport=ViewportSize(width=viewport['width'], height=viewport['height']), service_workers='block')
            page = context.new_page()
            page.on('pageerror', lambda error: receipt['pageErrors'].append(str(error)))
            def guard(route):
                if route.request.method not in {'GET', 'HEAD', 'OPTIONS'}:
                    receipt['blockedWrites'].append({'method': route.request.method, 'url': route.request.url})
                    route.abort()
                elif urlparse(route.request.url).netloc != parsed.netloc:
                    route.abort()
                else:
                    route.continue_()
            context.route('**/*', guard)
            page.goto(args.origin + '/?' + urlencode(query), wait_until='networkidle')
            link = page.locator('.c4-banner button' if profile == 'desktop' else '.c4-phone-brief button')
            link.wait_for(state='attached')
            styles = link.evaluate('(el) => {const s=getComputedStyle(el);return {border:s.borderTopStyle,width:s.borderTopWidth,label:el.textContent}}')
            command = page.locator('.c4-picker summary')
            command_style = command.evaluate('(el) => getComputedStyle(el).borderTopStyle')
            geometry = page.evaluate('() => ({width:innerWidth, documentWidth:document.documentElement.scrollWidth})')
            row = {'profile': profile, 'analyst': styles, 'commandPickerBorder': command_style, 'geometry': geometry}
            receipt['checks'].append(row)
            page.screenshot(path=str(out / (profile + '-c4.png')), full_page=True)
            assert styles['border'] == 'dashed', f'{profile}: Analyst link must be dashed, got {styles}'
            assert float(styles['width'].removesuffix('px')) > 0
            assert styles['label'].strip().endswith('↗')
            assert command_style == 'solid', 'Command picker must remain solid'
            assert geometry['documentWidth'] <= geometry['width'], f'{profile}: horizontal document overflow'
            row['clickedLabel'] = link.inner_text()
            link.click()
            page.wait_for_url(lambda url: parse_qs(urlparse(url).query).get('mode') == ['analyst'])
            page.wait_for_load_state('networkidle')
            landing = parse_qs(urlparse(page.url).query)
            row['landing'] = landing
            assert landing.get('incidentId') == [args.incident]
            if case_id: assert landing.get('case') == [case_id]
            page.reload(wait_until='networkidle')
            assert parse_qs(urlparse(page.url).query).get('mode') == ['analyst']
            row['reloadPass'] = True
            context.close()
        browser.close()
    assert not receipt['pageErrors'] and not receipt['blockedWrites']
    receipt['passed'] = True
finally:
    (out / 'receipt.json').write_text(json.dumps(receipt, indent=2))
print(json.dumps(receipt, indent=2))
