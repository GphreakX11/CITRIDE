"""Partial Part B discovery against an explicitly disposable loopback API.
Does not open cases or claim complete link coverage. Writes receipts, not snapshots.
"""
import argparse,json,mimetypes
from pathlib import Path
from urllib.parse import urlencode,urlsplit
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--origin',required=True);p.add_argument('--output',required=True);args=p.parse_args()
assert urlsplit(args.origin).hostname in {'127.0.0.1','localhost','::1'},'loopback only'
root=Path(__file__).resolve().parents[1];dist=root/'dist';out=Path(args.output)
report={'scope':'PARTIAL: port/water, no-case only; no third/customer/50-record UI fixture; no case creation','pages':[],'errors':[],'blocked':[]}
with sync_playwright() as pw:
 browser=pw.chromium.launch();ctx=browser.new_context()
 def guard(route):
  req=route.request;u=urlsplit(req.url)
  if not req.url.startswith(args.origin+'/') or req.method not in {'GET','HEAD','OPTIONS'}:
   report['blocked'].append({'url':req.url,'method':req.method});route.abort();return
  if not u.path.startswith(('/v1/','/health')):
   asset=dist/('index.html' if u.path=='/' else u.path.lstrip('/'))
   if asset.resolve().is_relative_to(dist.resolve()) and asset.is_file():route.fulfill(path=str(asset),content_type=mimetypes.guess_type(asset)[0] or 'application/octet-stream');return
  route.continue_()
 ctx.route('**/*',guard);page=ctx.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
 for incident in ['INC-2026-1002-POH','TX-26-0412']:
  for view in ['command','cop','cyber','consequence','uctf','leadership','federation']:
   url=args.origin+'/?'+urlencode({'mode':'command','view':view,'incident':incident,'incidentId':incident})
   row={'incident':incident,'requestedView':view,'links':[]};report['pages'].append(row)
   try:
    page.goto(url,wait_until='networkidle',timeout=20000)
    row['renderedView']=page.locator('[data-view]').first.get_attribute('data-view')
    assert row['renderedView']==view, 'requested screen did not render'
    row['inventory']=page.locator('main a, main button').evaluate_all("els=>els.filter(e=>e.getBoundingClientRect().width && !e.disabled).map((e)=>({text:e.innerText.trim(),href:e.getAttribute('href'),className:e.className,border:getComputedStyle(e).borderStyle})).filter(e=>e.href || /[↗→]|in Analyst/.test(e.text))")
    # Each chosen navigation button is followed from a fresh source reload.
    labels=list(dict.fromkeys(x['text'] for x in row['inventory'] if 'Analyst' in x['text'] and x['text']))
    for label in labels:
     landing={'text':label};row['links'].append(landing)
     try:
      page.goto(url,wait_until='networkidle',timeout=20000)
      target=page.get_by_role('button',name=label,exact=True).first
      if not target.count():target=page.get_by_role('link',name=label,exact=True).first
      target.click(timeout=3000);page.wait_for_load_state('networkidle');page.wait_for_timeout(100)
      landing.update({'url':page.url,'view':page.locator('[data-view]').first.get_attribute('data-view'),'alerts':page.locator('[data-alert-id]').count(),'openCase':page.get_by_role('button',name='Open case',exact=True).count(),'empty':[text for text in ['No incident selected','Select a case','Choose a saved case'] if page.get_by_text(text,exact=False).count()]})
      q=dict(__import__('urllib.parse',fromlist=['parse_qsl']).parse_qsl(urlsplit(page.url).query))
      landing['passed']=q.get('mode')=='analyst' and landing['view']=='command' and q.get('incidentId',q.get('incident'))==incident and landing['alerts']>0 and landing['openCase']>0 and not landing['empty']
     except Exception as e:landing['error']=str(e)
   except Exception as e:row['error']=str(e)
 browser.close()
out.write_text(json.dumps(report,indent=2));print(json.dumps({'pages':len(report['pages']),'followed':sum(len(r['links']) for r in report['pages']),'errors':report['errors'],'output':str(out)}))
if report['errors'] or report['blocked'] or any(r.get('error') or any(not link.get('passed') for link in r['links']) for r in report['pages']):
 raise SystemExit(1)
